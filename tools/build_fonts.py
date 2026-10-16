"""把 film.js 用到的字符从系统字体里子集化，生成 fonts.css（base64 内嵌 woff），
保证在任何电脑上打开 film.html 都和成片字体一致。"""
import base64, io, sys, string
from fontTools.ttLib import TTFont
from fontTools import subset

src = open(sys.argv[1], encoding='utf-8').read()
chars = set(src) | set(string.printable) | set('0123456789−—·…“”‘’²³¹⁰⁴⁵⁶⁷⁸⁹≈≥≤←→↑×÷μ')
text = ''.join(sorted(c for c in chars if ord(c) >= 32))

N = '/usr/share/fonts/opentype/noto/'
I = '/usr/share/fonts/opentype/inter/'
D = '/usr/share/fonts/truetype/dejavu/'
SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
faces = [
    ('FSup', 500, I + 'Inter-Medium.otf', None),
    ('FSup', 700, I + 'Inter-Bold.otf', None),
    ('FSup', 900, I + 'Inter-Black.otf', None),
    ('FCJK', 500, N + 'NotoSansCJK-Medium.ttc', 2),
    ('FCJK', 700, N + 'NotoSansCJK-Bold.ttc', 2),
    ('FCJK', 900, N + 'NotoSansCJK-Black.ttc', 2),
    ('FDisp', 800, I + 'InterDisplay-ExtraBold.otf', None),
    ('FDisp', 900, I + 'InterDisplay-Black.otf', None),
    ('FMono', 400, D + 'DejaVuSansMono.ttf', None),
    ('FMono', 700, D + 'DejaVuSansMono-Bold.ttf', None),
    ('FMonoCJK', 400, N + 'NotoSansCJK-Regular.ttc', 7),
    ('FMonoCJK', 700, N + 'NotoSansCJK-Bold.ttc', 7),
]
css = []
total = 0
for fam, w, path, idx in faces:
    f = TTFont(path, fontNumber=idx) if idx is not None else TTFont(path)
    opts = subset.Options()
    opts.flavor = 'woff'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    tx = SUP if fam == 'FSup' else (''.join(c for c in text if c not in SUP) if fam == 'FCJK' else text)
    sub.populate(text=tx)
    sub.subset(f)
    buf = io.BytesIO()
    f.flavor = 'woff'
    f.save(buf)
    b = buf.getvalue(); total += len(b)
    css.append("@font-face{font-family:'%s';font-weight:%d;font-style:normal;src:url(data:font/woff;base64,%s) format('woff');}"
               % (fam, w, base64.b64encode(b).decode()))
    print(fam, w, len(b), 'bytes', file=sys.stderr)
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(css))
print('total', total, 'chars', len(text), file=sys.stderr)
