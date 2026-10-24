import sys, glob
from PIL import Image, ImageDraw
files = sorted(glob.glob(sys.argv[1] + '/*.jpg'))
per = int(sys.argv[3]) if len(sys.argv) > 3 else 6
W, H = 960, 540
for k in range(0, len(files), per):
    chunk = files[k:k + per]
    sheet = Image.new('RGB', (W * 2, H * ((len(chunk) + 1) // 2)), 'black')
    for i, f in enumerate(chunk):
        im = Image.open(f).resize((W, H))
        d = ImageDraw.Draw(im); d.rectangle([0, 0, 120, 26], fill='red'); d.text((6, 6), f.split('_')[-1][:-4], fill='white')
        sheet.paste(im, ((i % 2) * W, (i // 2) * H))
    sheet.save(f'{sys.argv[2]}_{k // per:02d}.jpg', quality=82)
