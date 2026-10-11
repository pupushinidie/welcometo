"""把一批 v2 候选（64 张）拼成总览图：8x8，每格左半夜间底、右半奶油底，左上角写编号。
用法：python art/sheet.py <名字> [倍数]  → out/r1/_sheets/<名字>.png
"""
from __future__ import annotations

import pathlib
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ART = pathlib.Path(__file__).resolve().parent
R1 = ART / "out" / "r1"
FONT = ImageFont.truetype(str(pathlib.Path.home() / "projects/mahjong/art/out/fusion12.ttf"), 12)


def idx(p: pathlib.Path) -> int:
    m = re.search(r"-(\d+)\.png$", p.name)
    return int(m.group(1)) if m else 0


def make(name: str, scale: int = 3) -> pathlib.Path:
    files = sorted((R1 / name).glob("*.png"), key=idx)
    first = Image.open(files[0])
    w, h = first.size[0] * scale, first.size[1] * scale
    cw, ch = w + 8, h + 16
    cols = 8
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch), (40, 32, 48))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGBA").resize((w, h), Image.NEAREST)
        x, y = (i % cols) * cw + 4, (i // cols) * ch + 14
        d.rectangle([x, y, x + w // 2 - 1, y + h - 1], fill=(75, 58, 94))
        d.rectangle([x + w // 2, y, x + w - 1, y + h - 1], fill=(250, 244, 228))
        sheet.paste(im, (x, y), im)
        d.text((x, y - 13), str(idx(f)), font=FONT, fill=(255, 230, 120))
    out = R1 / "_sheets" / f"{name}.png"
    out.parent.mkdir(exist_ok=True)
    sheet.save(out)
    return out


if __name__ == "__main__":
    print(make(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3))
