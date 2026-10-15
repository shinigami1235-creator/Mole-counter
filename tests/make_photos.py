"""Synthetic skin photos with known mole sizes for testing Mole Counter.
Photo A is the last visit, photo B is this visit: camera moved, rotated 5
degrees and 12% further away, warmer light, mole 4 grown by 1.5 mm, mole 2
gone, one new 3 mm mole. Prints the truth as JSON."""
import json, math, random, sys
from PIL import Image, ImageDraw, ImageFilter

PPM = 10.0          # pixels per mm on photo A
W, H = 3200, 2400   # 320 x 240 mm of skin
OUT = sys.argv[1] if len(sys.argv) > 1 else "."

moles = [  # x mm, y mm, diameter mm, darkness 0..1, aspect
    (40, 40, 2.0, 0.65, 1.0), (95, 55, 3.0, 0.7, 1.1), (160, 45, 5.0, 0.75, 1.2),
    (250, 70, 8.0, 0.55, 1.1), (60, 150, 4.0, 0.7, 1.0), (150, 160, 6.5, 0.8, 1.15),
    (230, 180, 1.6, 0.5, 1.0), (285, 140, 2.5, 0.6, 1.0), (110, 210, 3.5, 0.7, 1.05),
]
landmarks = [(20, 220), (300, 215), (170, 15), (300, 20)]  # ink dots, mm

def skin(w, h, base, seed):
    rnd = random.Random(seed)
    im = Image.new("RGB", (w // 8, h // 8))
    px = im.load()
    for y in range(h // 8):
        for x in range(w // 8):
            t = x / (w / 8)
            n = rnd.uniform(-6, 6)
            px[x, y] = (int(base[0] + 12 * t + n), int(base[1] + 8 * t + n), int(base[2] + 6 * t + n))
    im = im.resize((w, h), Image.BICUBIC)
    noise = Image.effect_noise((w, h), 10).convert("RGB")
    return Image.blend(im, noise, 0.06)

def render(seed, base, xform, mole_list, ppm, ruler):
    im = skin(W, H, base, seed)
    d = ImageDraw.Draw(im)
    for (x, y, dia, dark, asp) in mole_list:
        cx, cy = xform(x, y)
        r = dia * ppm / 2
        col = (int(base[0] * (1 - dark) + 60 * dark), int(base[1] * (1 - dark) + 35 * dark), int(base[2] * (1 - dark) + 25 * dark))
        d.ellipse((cx - r * asp, cy - r / asp * 1.0 if False else cy - r, cx + r * asp, cy + r), fill=col)
    for (x, y) in landmarks:
        cx, cy = xform(x, y)
        d.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=(30, 40, 110))
    # hair
    hx, hy = xform(200, 110)
    d.line((hx - 300, hy + 40, hx + 250, hy - 30), fill=(70, 50, 40), width=3)
    if ruler:
        x0, y0 = xform(15, 232)
        d.rectangle((x0, y0 - 10, x0 + 80 * ppm, y0 + 30), fill=(245, 245, 240))
        for mm in range(0, 81):
            L = 22 if mm % 10 == 0 else 14 if mm % 5 == 0 else 8
            d.line((x0 + mm * ppm, y0 - 10, x0 + mm * ppm, y0 - 10 + L), fill=(20, 20, 20), width=2)
    return im.filter(ImageFilter.GaussianBlur(1.2))

# Photo A
fa = lambda x, y: (x * PPM, y * PPM)
A = render(1, (214, 168, 140), fa, moles, PPM, True)
A.save(f"{OUT}/visit-a.jpg", quality=92)

# Photo B
ang, sc, ox, oy = math.radians(5), 0.88, 90, -40
def fb(x, y):
    X, Y = x * PPM - W / 2, y * PPM - H / 2
    return (sc * (math.cos(ang) * X - math.sin(ang) * Y) + W / 2 + ox,
            sc * (math.sin(ang) * X + math.cos(ang) * Y) + H / 2 + oy)
mb = [m for i, m in enumerate(moles) if i != 1]
mb = [(x, y, d + (1.5 if (x, y) == (150, 160) else 0), k, a) for (x, y, d, k, a) in mb]
mb.append((200, 120, 3.0, 0.7, 1.0))
B = render(2, (222, 170, 132), fb, mb, PPM * sc, True)
B.save(f"{OUT}/visit-b.jpg", quality=92)

json.dump({
    "ppmA": PPM, "ppmB": PPM * sc,
    "rulerA": [fa(15, 232 - 1), fa(25, 232 - 1)],
    "rulerB": [fb(15, 231), fb(25, 231)],
    "landmarksA": [fa(*p) for p in landmarks], "landmarksB": [fb(*p) for p in landmarks],
    "molesA": moles, "molesB": mb,
}, open(f"{OUT}/truth.json", "w"), indent=1)
print("ok")
