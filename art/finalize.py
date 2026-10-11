"""动画检查（照宝石商人/骷髅牌 finalize.py 的做法，按欢迎来到的 spec 改）。

python finalize.py report [目录]   默认查 out/final
- 循环：和首帧比最大变化 < 3% 太静、> 60% 走形（粒子满屏的除外）；末帧→首帧接缝不超过相邻最大 1.5 倍；坏帧（峰值 ≥ 中位 3 倍且 ≥ 25%）
- once：最后一帧全透明；hold：停在最后一帧（不查空）
- 中间不许有空帧；pool-full-anim 首帧必须和 sheet/pool-full.png 一样
退出码：有问题时 1。
"""
from __future__ import annotations
import pathlib, sys
from PIL import Image, ImageChops

ART = pathlib.Path(__file__).resolve().parent
FINAL = ART / "out" / "final"
SPEC = {
    "sheet/pool-full-anim.png": (4, "loop"),
    "fx/confetti.png": (8, "once"), "fx/build-puff.png": (6, "once"), "fx/sparkle.png": (6, "once"),
}
WHOLE = {"sheet/pool-full-anim.png"}  # 整池水都在闪


def frames_of(sheet, n):
    w = sheet.width // n
    return [sheet.crop((i * w, 0, (i + 1) * w, sheet.height)) for i in range(n)]


def diff_ratio(a, b):
    d = ImageChops.difference(a.convert("RGBA"), b.convert("RGBA")).convert("L").point(lambda v: 255 if v > 24 else 0)
    changed = sum(1 for v in d.get_flattened_data() if v)
    area = max(1, sum(1 for v in a.getchannel("A").get_flattened_data() if v), sum(1 for v in b.getchannel("A").get_flattened_data() if v))
    return changed / area


def check(root, rel):
    n, kind = SPEC[rel]
    path = root / rel
    if not path.exists():
        return ["缺文件"]
    sheet = Image.open(path).convert("RGBA")
    if sheet.width % n:
        return [f"宽 {sheet.width} 不能被 {n} 整除"]
    fr = frames_of(sheet, n)
    vs0 = [diff_ratio(fr[0], f) for f in fr[1:]]
    steps = [diff_ratio(fr[i], fr[i + 1]) for i in range(n - 1)]
    empty = [f.getchannel("A").getbbox() is None for f in fr]
    problems = []
    if any(empty[:-1]):
        problems.append(f"中间有空帧 {[i for i, e in enumerate(empty[:-1]) if e]}")
    if kind == "loop":
        worst = max(vs0)
        if worst < 0.03:
            problems.append(f"太静（最大变化 {worst:.1%}）")
        if worst > 0.6 and rel not in WHOLE:
            problems.append(f"走形?（最大变化 {worst:.1%}）")
        seam = diff_ratio(fr[-1], fr[0])
        if seam > max(steps) * 1.5 + 0.02:
            problems.append(f"循环接缝跳（末→首 {seam:.1%}，相邻最大 {max(steps):.1%}）")
        srt = sorted(steps + [seam])
        if srt[-1] >= 0.25 and srt[-1] >= 3 * srt[len(srt) // 2]:
            problems.append(f"疑似坏帧（峰值 {srt[-1]:.1%}，中位 {srt[len(srt) // 2]:.1%}）")
    elif kind == "once" and not empty[-1]:
        problems.append("最后一帧不是空的")
    if rel == "sheet/pool-full-anim.png":
        still = Image.open(root / "sheet" / "pool-full.png").convert("RGBA")
        if ImageChops.difference(still, fr[0]).getbbox():
            problems.append("首帧和 sheet/pool-full.png 不一样")
    info = f"帧 {n}，和首帧比最大 {max(vs0):.1%}，相邻最大 {max(steps):.1%}"
    return problems or [f"ok（{info}）"]


def report(root=FINAL):
    bad = 0
    for rel in SPEC:
        res = check(root, rel)
        ok = len(res) == 1 and res[0].startswith("ok")
        bad += 0 if ok else 1
        print(f"{'✓' if ok else '✗'} {rel}: {'；'.join(res)}")
    print(f"共 {len(SPEC)} 条，有问题 {bad} 条")
    return bad


if __name__ == "__main__":
    args = sys.argv[1:] or ["report"]
    sys.exit(1 if report(pathlib.Path(args[1]) if len(args) > 1 else FINAL) else 0)
