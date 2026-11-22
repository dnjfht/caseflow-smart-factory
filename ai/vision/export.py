"""Export the chosen run for the MES: ONNX model + model card (thresholds, metrics) + the production image pool.
python3 export.py <run> <resources-dir>
"""
import json, os, shutil, sys, datetime
import numpy as np, torch, torch.nn.functional as F
import onnxruntime as ort
from torch.utils.data import DataLoader
sys.path.insert(0, os.path.dirname(__file__))
from train import CLASSES, MEAN, STD, EXPS, build, Cases, listing, transforms, predict, summarize, ROOT

run, res = sys.argv[1], sys.argv[2]
cfg = EXPS[run]
m = json.load(open(f'/tmp/aigen/runs/{run}/metrics.json'))
model = build(run); model.load_state_dict(torch.load(f'/tmp/aigen/runs/{run}/model.pt')); model.eval()
size, temp = cfg['size'], m['temperature']
ESCAPE_COST, DEFECT_RATE = 10.0, 0.15  # a shipped defect costs ~10 good cases (return, claim); 15% of cases defective

def probs(split):
    l, y = predict(model, DataLoader(Cases(listing(split), transforms(size, False)), batch_size=96))
    return F.softmax(l / temp, 1).numpy(), y.numpy()

def rates(p, y, t):
    pd = 1 - p[:, 0]; d = y != 0; r = pd >= t
    return float((~r & d).sum() / d.sum()), float((r & ~d).sum() / (~d).sum())

P = {s: probs(s) for s in ['val', 'test', 'test_hard']}
tau_rows = []
for t in np.round(np.arange(0.05, 0.91, 0.05), 2):
    ve, vf = rates(*P['val'], t); te, tf = rates(*P['test'], t)
    tau_rows.append(dict(tau=float(t), val_escape=ve, val_false_reject=vf, val_cost=ESCAPE_COST * DEFECT_RATE * ve + (1 - DEFECT_RATE) * vf,
                         test_escape=te, test_false_reject=tf))
tau = min(tau_rows, key=lambda r: r['val_cost'])['tau']  # chosen on validation only

# cause confidence: a rejected case names its cause only if P(cause)/P(defect) clears this; else manual review.
p, y = P['val']
pdef = 1 - p[:, 0]; rej = (pdef >= tau) & (y != 0)
share = p[:, 1:].max(1) / np.maximum(pdef, 1e-9); cause = p[:, 1:].argmax(1) + 1
cause_rows = []
for c in np.round(np.arange(0.3, 0.96, 0.05), 2):
    named = rej & (share >= c)
    acc = float((cause[named] == y[named]).mean()) if named.any() else 1.0
    cause_rows.append(dict(min=float(c), named_accuracy=acc, unsure_rate=float((rej & (share < c)).sum() / max(1, rej.sum()))))
# lowest bar whose named causes are at least 98% right: as few cases sent to manual review as that allows
pick = next((r for r in cause_rows if r['named_accuracy'] >= 0.98), cause_rows[-1])

os.makedirs(f'{res}/ai/pool', exist_ok=True)
onnx_path = f'{res}/ai/model.onnx'
torch.onnx.export(model, torch.randn(1, 3, size, size), onnx_path, input_names=['image'], output_names=['logits'],
                  opset_version=17, dynamo=False)
# the exported model must say what the trained one says
x = torch.randn(4, 3, size, size)
sess = ort.InferenceSession(onnx_path)
diff = max(float(np.abs(sess.run(None, {'image': x[i:i + 1].numpy()})[0] - model(x[i:i + 1]).detach().numpy()).max()) for i in range(4))
assert diff < 1e-3, diff

pool = listing('pool')
with open(f'{res}/ai/pool.csv', 'w') as f:
    for path, c in pool:
        shutil.copy(path, f'{res}/ai/pool/{os.path.basename(path)}')
        f.write(f'{os.path.basename(path)},{CLASSES[c]}\n')

def at_tau(split):
    l, yy = predict(model, DataLoader(Cases(listing(split), transforms(size, False)), batch_size=96))
    return summarize(l, yy, temp, tau)
flat = lambda s: {k: s[k] for k in ['accuracy', 'defect_escape', 'false_reject', 'cause_accuracy', 'ece', 'per_class_recall', 'confusion']}
card = dict(version=f'v1-{datetime.date.today():%Y%m%d}', experiment=run, classes=CLASSES, input_size=size, mean=MEAN, std=STD,
            temperature=temp, threshold=dict(reject_p_defect=tau, cause_min_confidence=pick['min']),
            production=dict(defect_rate=DEFECT_RATE, pool_size=len(pool)),
            test=flat(at_tau('test')), test_hard=flat(at_tau('test_hard')), tau_table=tau_rows, escape_cost=ESCAPE_COST,
            cause_threshold_table=cause_rows, onnx_max_abs_diff=diff,
            model_bytes=os.path.getsize(onnx_path))
json.dump(card, open(f'{res}/ai/model.json', 'w'), indent=1)
print(json.dumps({k: card[k] for k in ['version', 'temperature', 'threshold', 'test', 'test_hard', 'onnx_max_abs_diff', 'model_bytes']}, indent=1))
