"""定稿总览：用 out/final 的图拼一张 1440x790 的牌桌示意（夜、日各一张），数字用代码叠（示意界面做法）。
用法：python art/overview.py → out/overview-night.png / out/overview-day.png
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

from mock import BUILT_POOLS, FENCES, FILLED, POOLS, STREETS
from tokens import P

ART = pathlib.Path(__file__).resolve().parent
F = ART / "out" / "final"
FONT = str(pathlib.Path.home() / "projects/mahjong/art/out/fusion12.ttf")
F24 = ImageFont.truetype(FONT, 24)
F48 = ImageFont.truetype(FONT, 48)
F12 = ImageFont.truetype(FONT, 12)
K = 2


def img(rel, k=K):
    im = Image.open(F / rel).convert("RGBA")
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def outlined(d, xy, text, font, fill, stroke=(255, 255, 255)):
    d.text(xy, text, font=font, fill=fill, stroke_width=2, stroke_fill=stroke)


def build(theme: str) -> Image.Image:
    W, H = 1440, 790
    bg = Image.open(F / f"bg/street-{theme}.png").convert("RGBA")
    scale = max(W / bg.width, H / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.NEAREST).crop((0, 0, W, H))
    night = theme == "night"
    bg.alpha_composite(Image.new("RGBA", (W, H), (30, 20, 40, 115) if night else (255, 250, 240, 90)))
    d = ImageDraw.Draw(bg)
    ink = (245, 239, 226) if night else P["outline"]
    panel = (40, 30, 52, 205) if night else (255, 251, 242, 225)

    # 顶栏
    bg.alpha_composite(Image.new("RGBA", (W, 44), (25, 18, 32, 220) if night else (255, 250, 240, 235)))
    d.text((20, 10), "欢迎来到 · 第 7 回合", font=F24, fill=ink)

    # 目标卡
    for n in (1, 2, 3):
        card = img(f"plans/plan-{n}.png" if n != 2 else "plans/plan-2-ok.png")
        x, y = 40 + (n - 1) * 176, 58
        bg.alpha_composite(card, (x, y))
        outlined(d, (x + 12, y + 6), str(n), F24, P["outline"])
        minis = [1, 2, 2] if n == 1 else [3, 4] if n == 2 else [1, 4, 5]
        mx = x + 30
        for size in minis:
            for _ in range(size):
                mini = img("houses/house-mini-1.png", 1)
                bg.alpha_composite(mini, (mx, y + 40))
                mx += 12
            mx += 8
        outlined(d, (x + 124, y + 64), "8" if n != 2 else "5", F24, P["outline"])
        if n == 2:
            bg.alpha_composite(img("icons/stamp-ok.png"), (x + 104, y + 4))

    # 玩家表
    sx, sy = 30, 170
    sheet_w = 12 * 70 + 220
    bg.alpha_composite(Image.new("RGBA", (sheet_w + 20, 3 * 104 + 150), panel), (sx - 10, sy - 10))
    for s, n in enumerate(STREETS):
        y0 = sy + s * 104
        strip = img("sheet/street-strip.png")
        for x in range(sx, sx + 12 * 70, strip.width):
            bg.alpha_composite(strip, (x, y0 + 56))
        for i in range(1, n + 1):
            x = sx + (i - 1) * 70
            if i in FILLED[s]:
                t = "abc"[(s * 7 + i) % 3]
                bg.alpha_composite(img(f"houses/house-{s + 1}-{t}.png"), (x, y0))
                d.rectangle([x + 10, y0 + 74, x + 53, y0 + 100], fill=(245, 239, 226), outline=P["outline"], width=2)
                txt = str(FILLED[s][i])
                tw = d.textlength(txt, font=F24)
                d.text((x + 32 - tw / 2, y0 + 75), txt, font=F24, fill=P["outline"])
            else:
                bg.alpha_composite(img("houses/lot-empty.png"), (x, y0))
                d.rectangle([x + 10, y0 + 74, x + 53, y0 + 100], outline=(150, 140, 130), width=2)
            if i in POOLS[s]:
                bg.alpha_composite(img("sheet/pool-full.png" if i in BUILT_POOLS[s] else "sheet/pool-empty.png"), (x - 4, y0 - 6))
            if i in FENCES[s]:
                fence = img("sheet/fence.png")
                bg.alpha_composite(fence, (x + 67 - fence.width // 2, y0 + 64 - fence.height + 4))
        # 公园轨
        px0 = sx + 12 * 70 + 10
        vals = [[0, 2, 4, 10], [0, 2, 4, 6, 14], [0, 2, 4, 6, 8, 18]][s]
        for k, v in enumerate(vals[1:]):
            im = img("sheet/park-tree.png" if k < s + 1 else "sheet/park-empty.png")
            bg.alpha_composite(im, (px0 + k * 40, y0 + 12))
            d.text((px0 + k * 40 + 8, y0 + 50), str(v), font=F12, fill=ink)
    # 计分区（示意）
    yb = sy + 3 * 104 + 6
    for k, name in enumerate(["act-pool", "act-temp", "act-bis", "act-improve", "act-fence", "act-park"]):
        bg.alpha_composite(img(f"icons/{name}.png", 1), (sx + k * 150, yb))
        d.text((sx + k * 150 + 40, yb + 6), ["泳池 6", "临时工 3", "bis -1", "改造", "小区", "公园"][k], font=F24, fill=ink)
    for k in range(3):
        bg.alpha_composite(img("icons/stamp-no.png", 1) if k == 0 else Image.new("RGBA", (24, 24), (0, 0, 0, 0)), (sx + k * 32, yb + 50))
        d.rectangle([sx + k * 32, yb + 50, sx + k * 32 + 23, yb + 73], outline=(150, 140, 130))
    d.text((sx + 110, yb + 52), "拒批", font=F24, fill=ink)

    # 三组建造牌
    cx = sx + sheet_w + 40
    for k, (num, act) in enumerate([(3, "pool"), (8, "fence"), (12, "bis")]):
        y = 60 + k * 150
        nc = img("cards/num.png")
        bg.alpha_composite(nc, (cx, y))
        txt = str(num)
        tw = d.textlength(txt, font=F48)
        outlined(d, (cx + 48 - tw / 2, y + 36), txt, F48, P["outline"])
        bg.alpha_composite(img(f"cards/act-{act}.png"), (cx + 104, y))
        if k == 1:
            d.rectangle([cx - 6, y - 6, cx + 205, y + 133], outline=(0xE8, 0x73, 0x5C), width=4)
    bg.alpha_composite(img("cards/back.png", 1), (cx, 520))
    d.text((cx + 56, 540), "剩 57 张", font=F24, fill=ink)
    # 特效示意：泳池动画第 3 帧、彩纸第 4 帧
    conf = Image.open(F / "fx/confetti.png").convert("RGBA").crop((64 * 3, 0, 64 * 4, 64))
    bg.alpha_composite(conf.resize((128, 128), Image.NEAREST), (40 + 176 - 10, 40))
    return bg.convert("RGB")


if __name__ == "__main__":
    for t in ("night", "day"):
        build(t).save(ART / "out" / f"overview-{t}.png")
    print("ok")
