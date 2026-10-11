"""拼一张玩家表样机（三条街 10/11/12 房），用来挑房子、看接缝、看夜/日两种底。
用法：python art/mock.py  → out/r1/_mock-*.png；也被 export 后的 final 总览复用（--final）。
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

from lib import R1, place, recolor, scale, v2
from tokens import P

ART = pathlib.Path(__file__).resolve().parent
FONT = ImageFont.truetype(str(pathlib.Path.home() / "projects/mahjong/art/out/fusion12.ttf"), 12)
STREETS = [10, 11, 12]
POOLS = [{3, 7, 8}, {1, 4, 8}, {2, 7, 11}]
COLORS = [P["street1"][0], P["street2"][0], P["street3"][0]]
FILLED = [  # 样机里填了数字的房子（位: 号）
    {1: 1, 2: 3, 3: 4, 5: 7, 6: 8, 7: 9, 10: 15},
    {1: 0, 2: 2, 4: 5, 5: 6, 8: 10, 9: 11},
    {2: 1, 3: 3, 4: 4, 7: 8, 8: 9, 9: 10, 11: 14, 12: 16},
]
FENCES = [{3, 7}, {2, 5, 9}, {4, 8, 11}]  # 第 k 位右边有栅栏
BUILT_POOLS = [{3}, {8}, {7}]


def plate(d, x, y, w, text):
    d.rectangle([x, y, x + w - 1, y + 11], fill=(245, 239, 226), outline=P["outline"])
    tw = d.textlength(text, font=FONT)
    d.text((x + (w - tw) / 2, y - 1), text, font=FONT, fill=P["outline"])


def build(houses: list[Image.Image], lot: Image.Image, strip: Image.Image, fence: Image.Image,
          pool_e: Image.Image, pool_f: Image.Image, bg: Image.Image, k: int = 2) -> Image.Image:
    cell, gap = 32, 3
    width = 12 * (cell + gap) + 20
    height = 3 * 52 + 12
    sheet = Image.new("RGBA", (width, height))
    d = ImageDraw.Draw(sheet)
    for s, n in enumerate(STREETS):
        y0 = 6 + s * 52
        for x in range(0, width, strip.width):
            sheet.paste(strip, (x, y0 + 32 - 4))
        for i in range(1, n + 1):
            x = 10 + (i - 1) * (cell + gap)
            if i in FILLED[s]:
                h = recolor(houses[(s * 7 + i) % len(houses)], COLORS[s])
                sheet.alpha_composite(h, (x, y0))
                plate(d, x + 6, y0 + 36, 20, str(FILLED[s][i]))
            else:
                sheet.alpha_composite(lot, (x, y0))
                d.rectangle([x + 6, y0 + 36, x + 25, y0 + 47], outline=(200, 190, 175))
            if i in POOLS[s]:
                sheet.alpha_composite(pool_f if i in BUILT_POOLS[s] else pool_e, (x - 2, y0 - 4))
            if i in FENCES[s]:
                sheet.alpha_composite(fence, (x + cell + gap // 2 - fence.width // 2, y0 + 32 - fence.height + 2))
    bgk = bg.resize((width * k + 80, int((width * k + 80) * 288 / 512)), Image.NEAREST).convert("RGBA")
    shade = Image.new("RGBA", bgk.size, (30, 20, 40, 110) if bg.getpixel((5, 5))[2] < 140 else (255, 250, 240, 90))
    bgk.alpha_composite(shade)
    big = scale(sheet, k)
    out = bgk.copy()
    panel = Image.new("RGBA", (big.width + 24, big.height + 24), (40, 30, 50, 170) if shade.getpixel((0, 0))[0] < 100 else (255, 250, 240, 200))
    out.alpha_composite(panel, (28, 28))
    out.alpha_composite(big, (40, 40))
    return out


def code_fence() -> Image.Image:
    """8x32 立柱式栅栏：尖顶白柱 + 两根横档短头。"""
    im = Image.new("RGBA", (8, 32))
    d = ImageDraw.Draw(im)
    o, w, sh = P["outline"], P["white"][0], P["white"][1]
    d.rectangle([2, 3, 5, 31], fill=o)
    d.rectangle([3, 4, 4, 30], fill=w)
    d.point([(3, 2), (4, 2)], fill=o)
    d.point([(4, 4), (4, 5)], fill=sh)
    d.line([(4, 6), (4, 30)], fill=sh)
    for y in (12, 22):
        d.rectangle([0, y, 7, y + 3], fill=o)
        d.rectangle([1, y + 1, 6, y + 2], fill=w)
        d.line([(1, y + 2), (6, y + 2)], fill=sh)
    return im


if __name__ == "__main__":
    lot = place(v2("lot-empty", 0), (32, 32), "bottom")
    strip = Image.open(ART / "out/code/street-strip-v2.png").convert("RGBA")
    pe = place(v2("pool-empty", 1), (16, 16))
    pf = place(v2("pool-full", 15), (16, 16))
    fence = code_fence()
    sets = {
        "A": [("house-ranch", 0), ("house-twostory", 9), ("house-ranch", 33)],
        "B": [("house-ranch", 16), ("house-twostory", 3), ("house-ranch", 44)],
        "C": [("house-ranch", 8), ("house-twostory", 26), ("house-ranch", 23)],
    }
    night = Image.open(ART.parent / "assets/work/raw/pastel-scene.png")
    for key, items in sets.items():
        hs = [place(v2(n, i), (32, 32), "bottom") for n, i in items]
        build(hs, lot, strip, fence, pe, pf, night).save(R1 / f"_mock-{key}.png")
    print("ok")
