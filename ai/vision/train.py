"""CaseFlow inspection model: experiments, threshold choice, calibration and ONNX export.

python3 train.py <experiment> [epochs]
  experiments: scratch128 | mnv3_128 | mnv3_128_aug | mnv3_192_aug
Each run writes runs/<experiment>/{model.pt, metrics.json}.
"""
import json, os, sys, time, random
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms as T
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
from PIL import Image

CLASSES = ['OK', 'LID_MISSING', 'LID_MISALIGNED', 'SCRATCH', 'CRACK', 'CONTAMINATION', 'DENT']
ROOT = '/tmp/aidata/jpg'
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
torch.set_num_threads(os.cpu_count())


def seed_all(s=7):
    random.seed(s); np.random.seed(s); torch.manual_seed(s)


def listing(split):
    items = []
    for ci, c in enumerate(CLASSES):
        d = os.path.join(ROOT, split, c)
        for f in sorted(os.listdir(d)):
            items.append((os.path.join(d, f), ci))
    return items


class Cases(Dataset):
    def __init__(self, items, tf):
        self.items, self.tf = items, tf
    def __len__(self):
        return len(self.items)
    def __getitem__(self, i):
        p, y = self.items[i]
        return self.tf(Image.open(p).convert('RGB')), y


class AddNoise:
    def __call__(self, x):
        return (x + torch.randn_like(x) * random.uniform(0, 0.04)).clamp(0, 1)


def transforms(size, aug):
    base = [T.Resize((size, size))]
    if aug:
        # what changes on a real line without changing the verdict: lighting, white balance, focus, sensor noise,
        # where the case sits under the camera. No flips of the label-bearing geometry beyond what is symmetric.
        base += [T.RandomAffine(degrees=8, translate=(0.06, 0.06), scale=(0.9, 1.1)),
                 T.ColorJitter(0.35, 0.35, 0.25, 0.03),
                 T.RandomApply([T.GaussianBlur(5, (0.1, 1.4))], p=0.35),
                 T.RandomHorizontalFlip()]
    base += [T.ToTensor()]
    if aug:
        base += [T.RandomApply([AddNoise()], p=0.5)]
    base += [T.Normalize(MEAN, STD)]
    return T.Compose(base)


class SmallCNN(nn.Module):
    def __init__(self, n):
        super().__init__()
        def blk(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(), nn.MaxPool2d(2))
        self.f = nn.Sequential(blk(3, 24), blk(24, 48), blk(48, 96), blk(96, 128), nn.AdaptiveAvgPool2d(1))
        self.h = nn.Linear(128, n)
    def forward(self, x):
        return self.h(self.f(x).flatten(1))


def build(name):
    if name.startswith('scratch'):
        return SmallCNN(len(CLASSES))
    m = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT)
    m.classifier[3] = nn.Linear(m.classifier[3].in_features, len(CLASSES))
    return m


EXPS = {
    'scratch128': dict(size=128, aug=False),
    'mnv3_128': dict(size=128, aug=False),
    'mnv3_128_aug': dict(size=128, aug=True),
    'mnv3_192_aug': dict(size=192, aug=True),
}


@torch.no_grad()
def predict(model, loader):
    model.eval()
    logits, ys = [], []
    for x, y in loader:
        logits.append(model(x)); ys.append(y)
    return torch.cat(logits), torch.cat(ys)


def summarize(logits, ys, temp=1.0, tau=None):
    p = F.softmax(logits / temp, 1).numpy()
    y = ys.numpy()
    pred = p.argmax(1)
    acc = float((pred == y).mean())
    p_def = 1 - p[:, 0]
    is_def = y != 0
    reject = p_def >= (0.5 if tau is None else tau) if tau is not None else pred != 0
    escape = float((~reject & is_def).sum() / max(1, is_def.sum()))      # defects shipped as good
    false_rej = float((reject & ~is_def).sum() / max(1, (~is_def).sum()))  # good cases rejected
    # cause accuracy over the defects the line rejected
    cause_mask = reject & is_def
    cause_pred = p[:, 1:].argmax(1) + 1
    cause_acc = float((cause_pred[cause_mask] == y[cause_mask]).mean()) if cause_mask.any() else 0.0
    conf = np.zeros((len(CLASSES), len(CLASSES)), int)
    for a, b in zip(y, pred):
        conf[a, b] += 1
    per_class = {c: float(conf[i, i] / max(1, conf[i].sum())) for i, c in enumerate(CLASSES)}
    # expected calibration error, 10 bins
    confs = p.max(1); correct = pred == y; ece = 0.0
    for lo in np.linspace(0, 0.9, 10):
        m = (confs > lo) & (confs <= lo + 0.1)
        if m.any():
            ece += m.mean() * abs(confs[m].mean() - correct[m].mean())
    return dict(accuracy=acc, defect_escape=escape, false_reject=false_rej, cause_accuracy=cause_acc,
                per_class_recall=per_class, ece=float(ece), confusion=conf.tolist())


def fit_temperature(logits, ys):
    t = torch.ones(1, requires_grad=True)
    opt = torch.optim.LBFGS([t], lr=0.05, max_iter=200)
    def step():
        opt.zero_grad(); l = F.cross_entropy(logits / t, ys); l.backward(); return l
    opt.step(step)
    return float(t.detach())


def choose_tau(logits, ys, temp, max_escape=0.01):
    """the highest reject threshold on P(defect) that still lets at most max_escape of defects through (val set)"""
    p = F.softmax(logits / temp, 1).numpy(); y = ys.numpy()
    p_def = 1 - p[:, 0]; is_def = y != 0
    best = None
    for tau in np.round(np.arange(0.02, 0.96, 0.01), 2):
        rej = p_def >= tau
        esc = (~rej & is_def).sum() / is_def.sum()
        fr = (rej & ~is_def).sum() / (~is_def).sum()
        if esc <= max_escape:
            best = (float(tau), float(esc), float(fr))
    return best


def main():
    name = sys.argv[1]
    epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    cfg = EXPS[name]
    seed_all()
    out = f'/tmp/aigen/runs/{name}'; os.makedirs(out, exist_ok=True)
    tr = DataLoader(Cases(listing('train'), transforms(cfg['size'], cfg['aug'])), batch_size=48, shuffle=True, num_workers=2)
    ev = lambda split: DataLoader(Cases(listing(split), transforms(cfg['size'], False)), batch_size=96, num_workers=2)
    model = build(name)
    lr = 3e-3 if name.startswith('scratch') else 1e-3
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=epochs * len(tr))
    history = []
    t0 = time.time()
    for ep in range(epochs):
        model.train(); tot = n = 0
        for x, y in tr:
            opt.zero_grad()
            loss = F.cross_entropy(model(x), y, label_smoothing=0.05)
            loss.backward(); opt.step(); sched.step()
            tot += float(loss) * len(y); n += len(y)
        vl, vy = predict(model, ev('val'))
        va = summarize(vl, vy)
        history.append(dict(epoch=ep + 1, train_loss=tot / n, val_accuracy=va['accuracy'], val_escape=va['defect_escape']))
        print(name, history[-1], f'{time.time() - t0:.0f}s', flush=True)
    vl, vy = predict(model, ev('val'))
    temp = fit_temperature(vl, vy)
    tau = choose_tau(vl, vy, temp)
    res = dict(experiment=name, config=cfg, epochs=epochs, train_seconds=round(time.time() - t0), history=history,
               temperature=temp, tau=tau)
    for split in ['test', 'test_hard']:
        if not os.path.isdir(os.path.join(ROOT, split)):
            continue
        tl, ty = predict(model, ev(split))
        res[split] = dict(argmax=summarize(tl, ty), calibrated_tau=summarize(tl, ty, temp, tau[0] if tau else None),
                          raw_ece=summarize(tl, ty)['ece'], calibrated_ece=summarize(tl, ty, temp)['ece'])
    torch.save(model.state_dict(), f'{out}/model.pt')
    json.dump(res, open(f'{out}/metrics.json', 'w'), indent=1)
    print(json.dumps({k: res[k] for k in ['temperature', 'tau']}), flush=True)


if __name__ == '__main__':
    main()
