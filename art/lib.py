"""共用小工具：换墙色、裁边、居中、描边。"""
from __future__ import annotations

import colorsys
import pathlib

from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
R1 = ART / "out" / "r1"


def v2(name: str, i: int) -> Image.Image:
    p = R1 / name / (f"{name}.png" if i == 0 else f"{name}-{i}.png")
    return Image.open(p).convert("RGBA")


def mint_mask(px, x, y, hue_lo=0.36, hue_hi=0.50, sat_min=0.15):
    r, g, b, a = px[x, y]
    if a < 128:
        return None
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if hue_lo <= h <= hue_hi and s >= sat_min and v >= 0.35:
        return (h, s, v)
    return None


def recolor(im: Image.Image, target: tuple, base=(0x8F, 0xD3, 0xB0), **kw) -> Image.Image:
    """把薄荷绿墙面换成 target（保留明暗关系）。base 是原图墙面的代表色。"""
    im = im.copy()
    px = im.load()
    bh, bs, bv = colorsys.rgb_to_hsv(*(c / 255 for c in base))
    th, ts, tv = colorsys.rgb_to_hsv(*(c / 255 for c in target))
    for y in range(im.height):
        for x in range(im.width):
            m = mint_mask(px, x, y, **kw)
            if not m:
                continue
            h, s, v = m
            ns = min(1, s * ts / max(bs, 1e-3))
            nv = min(1, v * tv / max(bv, 1e-3))
            r, g, b = colorsys.hsv_to_rgb(th, ns, nv)
            px[x, y] = (round(r * 255), round(g * 255), round(b * 255), px[x, y][3])
    return im


def trim(im: Image.Image) -> Image.Image:
    box = im.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    return im.crop(box) if box else im


def place(im: Image.Image, size: tuple, anchor="center") -> Image.Image:
    """裁边后放进 size 画布：center 居中；bottom 底边贴齐、水平居中。"""
    im = trim(im)
    if im.width > size[0] or im.height > size[1]:
        raise ValueError(f"{im.size} 放不进 {size}")
    out = Image.new("RGBA", size)
    x = (size[0] - im.width) // 2
    y = (size[1] - im.height) // 2 if anchor == "center" else size[1] - im.height
    out.paste(im, (x, y), im)
    return out


def alpha_clean(im: Image.Image, thr=128) -> Image.Image:
    """半透明像素二值化（像素图不要半透明毛边）。"""
    im = im.copy()
    a = im.getchannel("A").point(lambda v: 255 if v >= thr else 0)
    im.putalpha(a)
    return im


def scale(im: Image.Image, k: int) -> Image.Image:
    return im.resize((im.width * k, im.height * k), Image.NEAREST)
