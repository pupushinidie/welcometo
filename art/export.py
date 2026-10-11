"""按 spec.md 导出：候选整理到 out/cand/，选中的写到 out/final/（结构同 public/art/）。
选哪张看 selection.json（没有就用 DEFAULT）。

用法：~/miniconda3/envs/quant/bin/python art/export.py
"""
from __future__ import annotations

import colorsys
import json
import pathlib
import shutil

from PIL import Image, ImageDraw

from lib import R1, alpha_clean, place, recolor, trim, v2
from mock import code_fence
from tokens import ACTIONS, P, PLANS

ART = pathlib.Path(__file__).resolve().parent
CAND = ART / "out" / "cand"
FINAL = ART / "out" / "final"
ASSETS = ART.parent / "assets"
SAMPLE = ASSETS / "work" / "raw"
STREET_COLORS = {1: P["street1"][0], 2: P["street2"][0], 3: P["street3"][0]}

DEFAULT = {
    "bg-night": "s11", "bg-day": "s11",
    "houses": "B", "lot": "lot0", "mini": "mini16", "strip": "v2", "fence": "post",
    "park-empty": "pe7", "park-tree": "pt0", "pool": "pf15",
    "act-fence": "1", "act-improve": "0", "act-park": "0", "act-pool": "3", "act-temp": "18", "act-bis": "0",
    "stamp-ok": "0", "stamp-no": "0",
    "cards": "frame84", "plans": "rivet91",
}
HOUSE_SETS = {
    "A": [("house-ranch", 0), ("house-twostory", 9), ("house-ranch", 33)],
    "B": [("house-ranch", 16), ("house-twostory", 3), ("house-ranch", 44)],
    "C": [("house-ranch", 8), ("house-twostory", 26), ("house-ranch", 23)],
}
ICON_CANDS = {
    "act-fence": ("ic-fence", [1, 24, 20]),
    "act-improve": ("ic-improve", [0, 9, 16]),
    "act-park": ("ic-park", [0, 3, 32]),
    "act-pool": ("ic-pool", [3, 35, 13]),
    "act-temp": ("ic-temp", [18, 4, 33]),
    "act-bis": ("ic-bis", [0, 2, 16]),
}


def save(im: Image.Image, rel: str, root=FINAL):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p)
    return p


# ---------- 小图 ----------

def lot(i: int) -> Image.Image:
    im = v2("lot-empty", i)
    a = im.getchannel("A")
    # 找草地顶（最宽的一行不透明的第一行），只留草皮 4 行，去掉下面的厚土
    rows = [sum(1 for x in range(im.width) if a.getpixel((x, y)) > 128) for y in range(im.height)]
    top = next(y for y, n in enumerate(rows) if n >= im.width * 0.8)
    im = im.crop((0, 0, im.width, top + 4))
    d = ImageDraw.Draw(im)
    for x in range(im.width):
        if im.getpixel((x, top + 3))[3] > 128:
            d.point((x, top + 3), fill=P["grass"][2] + (255,))
    return place(alpha_clean(im), (32, 32), "bottom")


def house(name: str, i: int, street: int) -> Image.Image:
    return recolor(place(alpha_clean(v2(name, i)), (32, 32), "bottom"), STREET_COLORS[street])


def pool_empty_from(full: Image.Image) -> Image.Image:
    """把满水泳池的水换成干池底（浅灰蓝瓷砖 + 格线）。"""
    im = full.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.45 <= h <= 0.56 and s > 0.35:
                # 干池：很淡的水色池底 + 斜纹，一眼看出「这里能建泳池，还没建」
                tile = (0xD4, 0xF0, 0xEE) if (x + y) % 3 else (0xA8, 0xD8, 0xDA)
                px[x, y] = tile + (255,)
    return im


def pool_shimmer(full: Image.Image) -> Image.Image:
    """4 帧水波：首帧 = 静态图；高光像素沿对角线移动。"""
    frames = [full.copy()]
    water = []
    px = full.load()
    for y in range(full.height):
        for x in range(full.width):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.45 <= h <= 0.56 and s > 0.35:
                water.append((x, y))
    hi = P["water"][0] + (255,)
    base = P["water"][1] + (255,)
    for f in range(1, 4):
        im = full.copy()
        q = im.load()
        for x, y in water:
            # 原来的高光变回水色，新高光按 (x+y+f*2)%6 的斜线出现
            r, g, b, a = q[x, y]
            if r > 150:
                q[x, y] = base
            if (x + y + f * 2) % 6 == 0 and (x * 3 + y) % 5 < 2:
                q[x, y] = hi
        frames.append(im)
    sheet = Image.new("RGBA", (full.width * 4, full.height))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * full.width, 0))
    return sheet


def icon(name: str, i: int, size=32) -> Image.Image:
    return place(alpha_clean(v2(name, i)), (size, size))


def fence_variant(kind: str) -> Image.Image:
    if kind == "post":
        return code_fence()
    if kind == "pickets":
        im = Image.new("RGBA", (8, 32))
        d = ImageDraw.Draw(im)
        o, w, sh = P["outline"], P["white"][0], P["white"][1]
        for k, top in enumerate((8, 4, 8)):
            x = k * 2 + 1
            d.rectangle([x - 1, top - 1, x + 2, 31], fill=o)
        for k, top in enumerate((8, 4, 8)):
            x = k * 2 + 1
            d.rectangle([x, top, x + 1, 30], fill=w if k != 2 else sh)
        return im
    im = trim(alpha_clean(v2("fence-post", int(kind))))
    return place(im, (max(8, im.width), 32), "bottom")


# ---------- 卡面 ----------

def rounded(w, h, face, border, inner_light=None):
    im = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(im)
    o = P["outline"] + (255,)
    d.rectangle([1, 0, w - 2, h - 1], fill=o)
    d.rectangle([0, 1, w - 1, h - 2], fill=o)
    d.rectangle([1, 1, w - 2, h - 2], fill=border + (255,))
    d.rectangle([3, 3, w - 4, h - 4], fill=o)
    d.rectangle([4, 4, w - 5, h - 5], fill=face + (255,))
    if inner_light:
        d.line([(4, 4), (w - 5, 4)], fill=inner_light + (255,))
    for x, y in ((1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)):
        im.putpixel((x, y), o)
    return im


def lighten(c, k):
    return tuple(min(255, round(v + (255 - v) * k)) for v in c)


def darken(c, k):
    return tuple(round(v * (1 - k)) for v in c)


def sparkle(d, x, y, col):
    d.point([(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)], fill=col + (255,))


def card_frame84(color) -> Image.Image:
    base = Image.open(R1 / "card-blank-s84.png").convert("RGBA")
    return recolor(alpha_clean(base), color, base=(162, 226, 160), hue_lo=0.25, hue_hi=0.45, sat_min=0.12)


def card_code(color) -> Image.Image:
    im = rounded(48, 64, color, P["white"][0], lighten(color, 0.35))
    d = ImageDraw.Draw(im)
    sparkle(d, 8, 8, lighten(color, 0.6))
    sparkle(d, 39, 55, lighten(color, 0.6))
    return im


def card_flat(color) -> Image.Image:
    im = Image.new("RGBA", (48, 64))
    d = ImageDraw.Draw(im)
    o = P["outline"] + (255,)
    d.rectangle([1, 0, 46, 63], fill=o)
    d.rectangle([0, 1, 47, 62], fill=o)
    d.rectangle([1, 1, 46, 62], fill=color + (255,))
    d.rectangle([3, 3, 44, 60], outline=(255, 255, 255, 255))
    return im


CARD_STYLES = {"frame84": card_frame84, "code": card_code, "flat": card_flat}


def action_card(style: str, act: str, ic: Image.Image) -> Image.Image:
    im = CARD_STYLES[style](ACTIONS[act])
    d = ImageDraw.Draw(im)
    # 图标下方的空带（界面可写行动名）
    band = lighten(ACTIONS[act], 0.45)
    d.rectangle([8, 47, 39, 56], fill=band + (255,))
    im.alpha_composite(ic, (8, 10))
    return im


def num_card(style: str) -> Image.Image:
    return CARD_STYLES[style]((0xFB, 0xF3, 0xDF))


def back_card(style: str, mini: Image.Image) -> Image.Image:
    col = (0x8F, 0xD3, 0xB0)
    im = CARD_STYLES[style](col)
    d = ImageDraw.Draw(im)
    stripe = lighten(col, 0.25) + (255,)
    for y in range(6, 58):
        for x in range(6, 42):
            if (x + y) % 6 == 0 and im.getpixel((x, y))[:3] == col:
                d.point((x, y), fill=stripe)
    big = mini.resize((32, 32), Image.NEAREST)
    im.alpha_composite(big, (8, 16))
    return im


# ---------- 目标卡 ----------

def plan_rivet91(color, approved=False) -> Image.Image:
    base = alpha_clean(Image.open(R1 / "plan-blank-s91.png").convert("RGBA"))
    # 框原色是青绿，中间透明：先把中间填奶油色（从中心洪水填充透明区）
    im = base.copy()
    px = im.load()
    w, h = im.size
    stack, seen = [(w // 2, h // 2)], set()
    cream = (0xFB, 0xF3, 0xDF, 255) if not approved else (0xF4, 0xEF, 0xE6, 255)
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or px[x, y][3] > 0:
            continue
        seen.add((x, y))
        px[x, y] = cream
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    teal = [im.getpixel((x, y))[:3] for x in range(w) for y in range(h)
            if im.getpixel((x, y))[3] > 128 and 0.35 <= colorsys.rgb_to_hsv(*(c / 255 for c in im.getpixel((x, y))[:3]))[0] <= 0.55
            and colorsys.rgb_to_hsv(*(c / 255 for c in im.getpixel((x, y))[:3]))[1] > 0.1]
    teal.sort(key=sum)
    src = teal[len(teal) // 2]
    return recolor(im, color, base=src, hue_lo=0.35, hue_hi=0.55, sat_min=0.1)


def plan_cream94(color, approved=False) -> Image.Image:
    base = alpha_clean(Image.open(R1 / "plan-blank-s94.png").convert("RGBA"))
    im = base.copy()
    px = im.load()
    w, h = im.size
    stack, seen = [(w // 2, h // 2)], set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or px[x, y][3] > 0:
            continue
        seen.add((x, y))
        px[x, y] = color + (255,)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return im


def plan_code(color, approved=False) -> Image.Image:
    im = rounded(80, 48, (0xFB, 0xF3, 0xDF), color, None)
    d = ImageDraw.Draw(im)
    d.rectangle([4, 4, 19, 15], fill=color + (255,))  # 左上编号块
    d.rectangle([58, 32, 75, 43], fill=lighten(color, 0.5) + (255,))  # 右下分值块
    return im


PLAN_STYLES = {"rivet91": plan_rivet91, "cream94": plan_cream94, "code": plan_code}


# ---------- 总流程 ----------

def preview(im: Image.Image, k: int, path: pathlib.Path):
    """候选预览：左半夜间底、右半奶油底，放大 k 倍。"""
    big = im.resize((im.width * k, im.height * k), Image.NEAREST)
    pad = 8
    W = Image.new("RGBA", (big.width + pad * 2, big.height + pad * 2), (75, 58, 94, 255))
    d = ImageDraw.Draw(W)
    d.rectangle([W.width // 2, 0, W.width, W.height], fill=(250, 244, 228, 255))
    W.alpha_composite(big, (pad, pad))
    path.parent.mkdir(parents=True, exist_ok=True)
    W.convert("RGB").save(path)
    return path


def row(images: list[Image.Image], gap=4) -> Image.Image:
    h = max(i.height for i in images)
    W = Image.new("RGBA", (sum(i.width for i in images) + gap * (len(images) - 1), h))
    x = 0
    for i in images:
        W.alpha_composite(i, (x, h - i.height))
        x += i.width + gap
    return W


def main():
    sel = DEFAULT | (json.loads((ART / "selection.json").read_text())["pick"] if (ART / "selection.json").exists() else {})
    if FINAL.exists():
        shutil.rmtree(FINAL)
    cand = {}

    # 背景
    bgn = {"s11": SAMPLE / "pastel-scene.png", **{f"s{s}": R1 / f"bg-night-s{s}.png" for s in (12, 13, 14)}}
    bgd = {"s11": SAMPLE / "pastel-day.png", **{f"s{s}": R1 / f"bg-day-s{s}.png" for s in (12, 13, 14)}}
    cand["bg-night"] = {k: str(v) for k, v in bgn.items()}
    cand["bg-day"] = {k: str(v) for k, v in bgd.items()}
    shutil.copy(bgn[sel["bg-night"]], (FINAL / "bg").mkdir(parents=True, exist_ok=True) or FINAL / "bg/street-night.png")
    shutil.copy(bgd[sel["bg-day"]], FINAL / "bg/street-day.png")

    # 房子
    cand["houses"] = {}
    for key, items in HOUSE_SETS.items():
        imgs = [house(n, i, s) for s in (1, 2, 3) for n, i in items]
        p = preview(row(imgs[:3]), 3, CAND / f"houses-{key}-1.png")
        rows = [row(imgs[k * 3:(k + 1) * 3]) for k in range(3)]
        sheet = Image.new("RGBA", (rows[0].width, 3 * 36))
        for k, r in enumerate(rows):
            sheet.alpha_composite(r, (0, k * 36))
        cand["houses"][key] = str(preview(sheet, 3, CAND / f"houses-{key}.png"))
        p.unlink()
        if key == sel["houses"]:
            for s in (1, 2, 3):
                for t, (n, i) in zip("abc", items):
                    save(house(n, i, s), f"houses/house-{s}-{t}.png")

    lots = {f"lot{i}": lot(i) for i in (0, 5, 35)}
    cand["lot"] = {k: str(preview(v, 4, CAND / f"lot-{k}.png")) for k, v in lots.items()}
    save(lots[sel["lot"]], "houses/lot-empty.png")

    minis = {f"mini{i}": place(alpha_clean(v2("house-mini", i)), (16, 16), "bottom") for i in (16, 0, 9)}
    cand["mini"] = {k: str(preview(row([recolor(v, STREET_COLORS[s]) for s in (1, 2, 3)]), 5, CAND / f"mini-{k}.png")) for k, v in minis.items()}
    for s in (1, 2, 3):
        save(recolor(minis[sel["mini"]], STREET_COLORS[s]), f"houses/house-mini-{s}.png")

    strips = {f"v{v}": Image.open(ART / f"out/code/street-strip-v{v}.png").convert("RGBA") for v in (1, 2, 3)}
    cand["strip"] = {k: str(preview(row([v] * 4, gap=0), 4, CAND / f"strip-{k}.png")) for k, v in strips.items()}
    save(strips[sel["strip"]], "sheet/street-strip.png")

    fences = {k: fence_variant(k) for k in ("post", "pickets", "13")}
    cand["fence"] = {k: str(preview(v, 4, CAND / f"fence-{k}.png")) for k, v in fences.items()}
    save(fences[sel["fence"]], "sheet/fence.png")

    pes = {f"pe{i}": place(alpha_clean(v2("park-empty", i)), (16, 16), "bottom") for i in (7, 14, 22)}
    pts = {f"pt{i}": place(alpha_clean(v2("park-tree", i)), (16, 16), "bottom") for i in (0, 5, 32)}
    cand["park-empty"] = {k: str(preview(v, 5, CAND / f"park-empty-{k}.png")) for k, v in pes.items()}
    cand["park-tree"] = {k: str(preview(v, 5, CAND / f"park-tree-{k}.png")) for k, v in pts.items()}
    save(pes[sel["park-empty"]], "sheet/park-empty.png")
    save(pts[sel["park-tree"]], "sheet/park-tree.png")

    pools = {f"pf{i}": place(alpha_clean(v2("pool-full", i)), (16, 16)) for i in (15, 17, 24)}
    cand["pool"] = {}
    for k, full in pools.items():
        cand["pool"][k] = str(preview(row([pool_empty_from(full), full]), 5, CAND / f"pool-{k}.png"))
    full = pools[sel["pool"]]
    save(full, "sheet/pool-full.png")
    save(pool_empty_from(full), "sheet/pool-empty.png")
    save(pool_shimmer(full), "sheet/pool-full-anim.png")

    # 图标
    icons = {}
    for key, (name, idxs) in ICON_CANDS.items():
        opts = {str(i): icon(name, i) for i in idxs}
        cand[key] = {k: str(preview(v, 3, CAND / f"{key}-{k}.png")) for k, v in opts.items()}
        icons[key] = opts[sel[key]]
        save(icons[key], f"icons/{key}.png")
    for key, name, idxs in (("stamp-ok", "stamp-ok", (0, 9, 16)), ("stamp-no", "stamp-no", (0, 6, 16))):
        opts = {str(i): icon(name, i, 24) for i in idxs}
        cand[key] = {k: str(preview(v, 4, CAND / f"{key}-{k}.png")) for k, v in opts.items()}
        save(opts[sel[key]], f"icons/{key}.png")

    # 建造牌
    mini_back = minis[sel["mini"]]
    cand["cards"] = {}
    for style in CARD_STYLES:
        faces = [num_card(style)] + [action_card(style, a, icons[f"act-{a}"]) for a in ACTIONS] + [back_card(style, mini_back)]
        cand["cards"][style] = str(preview(row(faces), 2, CAND / f"cards-{style}.png"))
        if style == sel["cards"]:
            save(faces[0], "cards/num.png")
            for a, f in zip(ACTIONS, faces[1:7]):
                save(f, f"cards/act-{a}.png")
            save(faces[7], "cards/back.png")

    # 目标卡
    cand["plans"] = {}
    for style, fn in PLAN_STYLES.items():
        faces = [fn(PLANS[n][0]) for n in (1, 2, 3)] + [fn(PLANS[n][1], True) for n in (1, 2, 3)]
        top, bot = row(faces[:3]), row(faces[3:])
        sheet = Image.new("RGBA", (top.width, top.height * 2 + 4))
        sheet.alpha_composite(top, (0, 0))
        sheet.alpha_composite(bot, (0, top.height + 4))
        cand["plans"][style] = str(preview(sheet, 2, CAND / f"plans-{style}.png"))
        if style == sel["plans"]:
            for n in (1, 2, 3):
                save(faces[n - 1], f"plans/plan-{n}.png")
                save(faces[n + 2], f"plans/plan-{n}-ok.png")

    # 特效（代码画）
    for name in ("confetti", "build-puff", "sparkle"):
        shutil.copy(ART / f"out/code/{name}.png", (FINAL / "fx").mkdir(parents=True, exist_ok=True) or FINAL / f"fx/{name}.png")

    (ART / "out" / "cand.json").write_text(json.dumps(cand, ensure_ascii=False, indent=1))
    print("final:", sum(1 for _ in FINAL.rglob("*.png")), "files")


if __name__ == "__main__":
    main()
