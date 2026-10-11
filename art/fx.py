"""代码画的像素素材：街道条、彩纸、尘土、星光（spec 2.2 / 2.6）。输出到 out/code/。

用法：~/miniconda3/envs/quant/bin/python art/fx.py
"""
from __future__ import annotations

import math
import pathlib
import random

from PIL import Image, ImageDraw

from tokens import CONFETTI, P

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out" / "code"
OUT.mkdir(parents=True, exist_ok=True)
O = P["outline"] + (255,)


def rgba(c, a=255):
    return tuple(c[:3]) + (a,)


def street_strip(variant: int) -> Image.Image:
    """32x12：上 6px 草地（带草丛），下 4px 人行道（每 16px 一道缝），最下 2px 路沿。左右无缝。"""
    rnd = random.Random(variant)
    im = Image.new("RGBA", (32, 12))
    px = im.load()
    g_hi, g_mid, g_lo = P["grass"]
    w_face, w_seam = P["walk"]
    for x in range(32):
        for y in range(12):
            if y < 6:
                c = g_mid if y else g_hi
                if y == 5:
                    c = g_lo
            elif y < 10:
                c = w_face
                if x % 16 == 15 or y == 6:
                    c = w_seam
            else:
                c = P["outline"] if y == 11 else w_seam
            px[x, y] = rgba(c)
    # 草丛：周期 32 内随机，x 取模保证接缝
    for _ in range(7 + variant):
        x = rnd.randrange(32)
        y = rnd.randrange(1, 4)
        px[x, y] = rgba(g_hi)
        px[(x + 1) % 32, y + 1] = rgba(g_hi)
        if rnd.random() < 0.5:
            px[x, y + 1] = rgba(g_lo)
    if variant == 2:  # 小黄花
        for x in (5, 21):
            px[x, 2] = rgba(P["yellow"])
    return im


def confetti() -> Image.Image:
    rnd = random.Random(7)
    n, size = 8, 64
    parts = []
    for i in range(56):
        ang = rnd.uniform(-math.pi * 0.95, -math.pi * 0.05)
        spd = rnd.uniform(3, 7.5)
        parts.append((math.cos(ang) * spd, math.sin(ang) * spd, rnd.choice(CONFETTI), rnd.choice([(3, 2), (2, 3), (3, 3), (2, 2)])))
    sheet = Image.new("RGBA", (size * n, size))
    for f in range(n - 1):  # 最后一帧空白收尾
        t = f + 0.6
        fr = Image.new("RGBA", (size, size))
        d = ImageDraw.Draw(fr)
        for vx, vy, col, (w, h) in parts:
            x = 32 + vx * t * 0.9
            y = 40 + vy * t * 0.9 + 0.55 * t * t
            if f % 2:
                w, h = h, w
            if 0 <= x < size - 2 and 0 <= y < size - 2:
                d.rectangle([int(x) - 1, int(y) - 1, int(x) + w, int(y) + h], fill=O)
                d.rectangle([int(x), int(y), int(x) + w - 1, int(y) + h - 1], fill=rgba(col))
        sheet.paste(fr, (f * size, 0))
    return sheet


def build_puff() -> Image.Image:
    n, size = 6, 32
    sheet = Image.new("RGBA", (size * n, size))
    light, dark = (0xF2, 0xEA, 0xDC), (0xC9, 0xBF, 0xB0)
    puffs = [(-9, 0), (-3, -2), (4, -1), (10, 0)]
    for f in range(n - 1):
        fr = Image.new("RGBA", (size, size))
        d = ImageDraw.Draw(fr)
        r = [3, 4, 5, 4, 3][f]
        spread = 1 + f * 0.9
        lift = f * 1.5
        for i, (dx, dy) in enumerate(puffs):
            if f == 4 and i % 2:
                continue
            cx = 16 + dx * (0.7 + f * 0.12)
            cy = 28 + dy - lift
            d.ellipse([cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1], fill=O)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba(dark))
            d.ellipse([cx - r, cy - r, cx + r - 1, cy + r - 2], fill=rgba(light))
        sheet.paste(fr, (f * size, 0))
    return sheet


def sparkle() -> Image.Image:
    n, size = 6, 16
    sheet = Image.new("RGBA", (size * n, size))
    hi, core = (0xFF, 0xF6, 0xC8), (0xFF, 0xFF, 0xFF)
    sizes = [1, 3, 5, 4, 2]
    for f in range(n - 1):
        fr = Image.new("RGBA", (size, size))
        px = fr.load()
        for cx, cy, k in ((8, 8, 0), (3, 4, 2), (12, 12, 1)):
            s = sizes[(f + k) % 5] if k else sizes[f]
            s = max(0, s - k)
            for i in range(-s, s + 1):
                for x, y in ((cx + i, cy), (cx, cy + i)):
                    if 0 <= x < size and 0 <= y < size:
                        px[x, y] = rgba(hi if abs(i) > 0 else core)
        sheet.paste(fr, (f * size, 0))
    return sheet


if __name__ == "__main__":
    for v in (1, 2, 3):
        street_strip(v).save(OUT / f"street-strip-v{v}.png")
    confetti().save(OUT / "confetti.png")
    build_puff().save(OUT / "build-puff.png")
    sparkle().save(OUT / "sparkle.png")
    print("ok")
