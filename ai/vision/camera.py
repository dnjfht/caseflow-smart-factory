"""Turn the clean renders into what an inspection camera would hand over: sensor noise, a little defocus, JPEG.
python3 camera.py   (reads /tmp/aidata/{train,val,test,pool}, writes /tmp/aidata/jpg/...; test also -> test_hard)
"""
import os, random
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

SRC, DST = '/tmp/aidata', '/tmp/aidata/jpg'


def camera(im, rnd, hard=False):
    if hard:
        # a worse day on the line: dimmer or brighter lamp, more noise, soft focus, heavier compression
        im = ImageEnhance.Brightness(im).enhance(rnd.uniform(0.7, 1.3))
        im = ImageEnhance.Color(im).enhance(rnd.uniform(0.75, 1.2))
        im = im.filter(ImageFilter.GaussianBlur(rnd.uniform(0.6, 1.3)))
        sigma, q = rnd.uniform(6, 10), rnd.randint(55, 70)
    else:
        if rnd.random() < 0.3:
            im = im.filter(ImageFilter.GaussianBlur(rnd.uniform(0.2, 0.6)))
        sigma, q = rnd.uniform(1, 4), rnd.randint(80, 95)
    a = np.asarray(im).astype(np.float32)
    a += np.random.default_rng(rnd.randint(0, 1 << 30)).normal(0, sigma, a.shape)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8)), q


def run(split, hard=False, out=None):
    out = out or split
    for c in sorted(os.listdir(os.path.join(SRC, split))):
        os.makedirs(os.path.join(DST, out, c), exist_ok=True)
        for f in sorted(os.listdir(os.path.join(SRC, split, c))):
            dst = os.path.join(DST, out, c, f.replace('.png', '.jpg'))
            if os.path.exists(dst):
                continue
            rnd = random.Random(f + ('hard' if hard else ''))
            im, q = camera(Image.open(os.path.join(SRC, split, c, f)).convert('RGB'), rnd, hard)
            im.save(dst, quality=q)


if __name__ == '__main__':
    import sys
    for s in sys.argv[1:] or ['train', 'val', 'test', 'pool']:
        if os.path.isdir(os.path.join(SRC, s)):
            run(s)
            if s == 'test':
                run('test', hard=True, out='test_hard')
