# 把几张截图拼成一张总览图：python montage.py <输出.png> <列数> <缩放宽度> <图...>
import sys
from PIL import Image, ImageDraw
out, cols, width, *files = sys.argv[1:]
cols, width = int(cols), int(width)
ims = [Image.open(f).convert("RGB") for f in files]
ims = [im.resize((width, int(im.height * width / im.width))) for im in ims]
rows = (len(ims) + cols - 1) // cols
h = max(im.height for im in ims) + 18
sheet = Image.new("RGB", (cols * width + (cols - 1) * 6, rows * h), "white")
d = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * (width + 6), (i // cols) * h
    sheet.paste(im, (x, y + 18))
    d.text((x + 4, y + 2), f.split("/")[-1], fill="black")
sheet.save(out)
