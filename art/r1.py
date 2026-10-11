"""欢迎来到 正式美术第一轮候选（PixelLab）。结果在 art/out/r1/。

方向：糖果色黄昏街（开工样张 sample-pastel）。照 art/spec.md。
- 场景 /create-image-pixen 512x288：夜（黄昏）、日两套，同一套提示词同一批种子，夜日能配对。样张那张（种子 11）也算候选。
- 小图（<=42px）全部 /generate-image-v2，一次 64 个：房子三种房型（薄荷绿，之后用代码换成各街主色）、空地、6 个行动图标、公园、泳池、栅栏、印章、小房子。
- 牌面底板 / 目标卡底板 /create-image-pixflux（透明底），之后代码换色 + 叠图标；数字一律代码画。
- 封面 pixflux 384x192，不画人、不画字。

用法：PIXELLAB_PRIORITY=1 ~/miniconda3/envs/quant/bin/python art/r1.py [名字 ...]；出过的跳过。一个进程，线程池并发。
"""
from __future__ import annotations

import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

ART = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ART))
import pixellab  # noqa: E402

OUT = ART / "out" / "r1"
NO_TEXT = "no text, no letters, no numbers"
ICON = "pixel art, bold dark outline, soft flat shading, light from top left, simple, readable, 1950s retro pastel style"

NIGHT = ("side view of a 1950s American suburban street at dusk, a row of pastel mid-century ranch houses "
         "in mint green, salmon pink, baby blue and butter yellow, white picket fences, tidy lawns, small round trees, "
         "a turquoise backyard swimming pool, warm glowing windows and porch lights, purple and peach twilight sky "
         "with first stars, retro atomic age style, clean bold outlines, cozy, no text, no letters, no numbers, no signs")
DAY = ("side view of a 1950s American suburban street on a sunny morning, a row of pastel mid-century ranch houses "
       "in mint green, salmon pink, baby blue and butter yellow, white picket fences, tidy green lawns, small round trees, "
       "a turquoise backyard swimming pool, clear light blue sky with soft white clouds, bright cheerful sunlight, "
       "retro atomic age style, clean bold outlines, cozy, no text, no letters, no numbers, no signs")
COVER_A = ("1950s pastel suburban street corner at golden dusk, a row of mint green, salmon pink, baby blue and butter yellow "
           "ranch houses with white picket fences, a turquoise backyard swimming pool, a big round tree, warm glowing windows, "
           "peach and lavender sky, no people, cozy 16-bit pixel art game cover illustration, crisp clean pixels, " + NO_TEXT + ", no logo, no signs")
COVER_B = ("aerial three quarter view of a cheerful 1950s pastel suburban neighborhood, three parallel streets of small colorful houses, "
           "white picket fences dividing the yards, green parks with round trees, several turquoise swimming pools, "
           "sunny afternoon, no people, no cars, cozy 16-bit pixel art game cover illustration, " + NO_TEXT + ", no logo, no signs")

# 名字: (接口, 提示词, 宽, 高, 透明, 种子们)
JOBS = {
    "bg-night": ("/create-image-pixen", NIGHT, 512, 288, False, (12, 13, 14)),
    "bg-day": ("/create-image-pixen", DAY, 512, 288, False, (12, 13, 14)),
    "cover": ("/create-image-pixflux", COVER_A, 384, 192, False, (71, 72)),
    "cover-b": ("/create-image-pixflux", COVER_B, 384, 192, False, (73, 74)),
    "card-blank": ("/create-image-pixflux",
                   "a blank retro 1950s game card seen straight on, rounded corners, plain mint green face, thin cream inner border, "
                   "tiny four point sparkle ornaments in two corners, large empty center, flat pastel pixel art, " + NO_TEXT,
                   48, 64, True, (81, 82, 83, 84)),
    "plan-blank": ("/create-image-pixflux",
                   "a blank retro 1950s city planning permit card in landscape orientation, rounded corners, plain teal face, "
                   "cream inner border with small rivets in the corners, large empty center, flat pastel pixel art, " + NO_TEXT,
                   80, 48, True, (91, 92, 93, 94)),
    # 房子：薄荷绿统一出，代码换墙色
    "house-ranch": ("/generate-image-v2",
                    "side view of a small 1950s suburban ranch house, mint green clapboard walls, low brown shingle roof, white trim, "
                    "a front door and two warm windows, a thin strip of lawn at the bottom, centered, fills the canvas, " + ICON,
                    32, 32, True, (101,)),
    "house-twostory": ("/generate-image-v2",
                       "side view of a small two story 1950s suburban house, mint green walls, steep gable roof with a brick chimney, "
                       "brown shingles, white trim, front door and windows, a thin strip of lawn at the bottom, centered, fills the canvas, " + ICON,
                       32, 32, True, (102,)),
    "house-porch": ("/generate-image-v2",
                    "side view of a small 1950s bungalow house with a little front porch and awning, mint green walls, brown roof, "
                    "white trim and porch posts, a thin strip of lawn at the bottom, centered, fills the canvas, " + ICON,
                    32, 32, True, (103,)),
    "lot-empty": ("/generate-image-v2",
                  "side view of an empty grass building lot, a flat strip of green lawn at the bottom with a small wooden survey stake "
                  "tied with an orange ribbon, nothing else, empty sky above, " + ICON, 32, 32, True, (104,)),
    "house-mini": ("/generate-image-v2", "tiny pixel art house icon, mint green walls, brown roof, white door, front view, bold dark outline",
                   16, 16, True, (105,)),
    "ic-fence": ("/generate-image-v2", "pixel art icon of a short white wooden picket fence section with three pointed pickets and two rails on a tiny grass tuft, fills the canvas, " + ICON,
                 32, 32, True, (111,)),
    "ic-improve": ("/generate-image-v2", "pixel art icon of a claw hammer, steel grey head and red painted wooden handle, diagonal, fills the canvas, " + ICON,
                   32, 32, True, (112,)),
    "ic-park": ("/generate-image-v2", "pixel art icon of a round leafy green park tree with a brown trunk on a small grass patch, fills the canvas, " + ICON,
                32, 32, True, (113,)),
    "ic-pool": ("/generate-image-v2", "pixel art icon of a small kidney shaped backyard swimming pool seen from above, turquoise water with white ripples, white tile rim and a silver ladder, fills the canvas, " + ICON,
                32, 32, True, (114,)),
    "ic-temp": ("/generate-image-v2", "pixel art icon of a yellow construction hard hat helmet, side view, fills the canvas, " + ICON,
                32, 32, True, (115,)),
    "ic-bis": ("/generate-image-v2", "pixel art icon of two identical tiny lilac purple houses, the second one overlapping slightly behind the first like a copy, fills the canvas, " + ICON,
               32, 32, True, (116,)),
    "park-empty": ("/generate-image-v2", "tiny pixel art of a small round patch of brown soil with a thin green sapling sprout, bold dark outline",
                   16, 16, True, (121,)),
    "park-tree": ("/generate-image-v2", "tiny pixel art of a round leafy green tree with a short brown trunk, side view, bold dark outline",
                  16, 16, True, (122,)),
    "pool-empty": ("/generate-image-v2", "tiny pixel art of an empty dry rectangular swimming pool seen from above, pale grey tiles and white rim, no water, bold dark outline",
                   16, 16, True, (123,)),
    "pool-full": ("/generate-image-v2", "tiny pixel art of a rectangular swimming pool seen from above full of bright turquoise water with white sparkles, white rim, bold dark outline",
                  16, 16, True, (124,)),
    "fence-post": ("/generate-image-v2", "pixel art of a narrow white wooden picket fence segment standing upright, two tall pointed pickets side by side, bold dark outline",
                   16, 32, True, (125,)),
    "stamp-ok": ("/generate-image-v2", "pixel art of a round green rubber stamp impression with a big check mark in the center, slightly worn ink, no text",
                 24, 24, True, (131,)),
    "stamp-no": ("/generate-image-v2", "pixel art of a square red rubber stamp impression with a big X cross in the center, slightly worn ink, no text",
                 24, 24, True, (132,)),
}


def run(name: str, seed: int) -> None:
    endpoint, prompt, width, height, transparent, _ = JOBS[name]
    if endpoint == "/generate-image-v2":
        folder = OUT / name
        if folder.exists() and any(folder.glob("*.png")):
            return
        pixellab.generate_async(name, {
            "description": prompt, "image_size": {"width": width, "height": height},
            "no_background": transparent, "seed": seed,
        }, folder, endpoint=endpoint)
    else:
        target = f"{name}-s{seed}"
        if (OUT / f"{target}.png").exists():
            return
        body = {"description": prompt, "image_size": {"width": width, "height": height}, "seed": seed}
        if endpoint == "/create-image-pixen":
            body["detail"] = "highly detailed"
        else:
            body["no_background"] = transparent
        pixellab.generate_image(target, body, OUT, endpoint=endpoint)
    print(name, seed, "ok", flush=True)


if __name__ == "__main__":
    names = sys.argv[1:] or list(JOBS)
    tasks = [(n, s) for n in names for s in JOBS[n][5]]
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(run, n, s): (n, s) for n, s in tasks}
        for future, key in futures.items():
            try:
                future.result()
            except Exception as exc:  # noqa: BLE001
                print("FAIL", key, exc, flush=True)
