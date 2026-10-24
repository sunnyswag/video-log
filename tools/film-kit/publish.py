"""由时间线生成投稿用的字幕 SRT 和简介里的章节时间戳。

用法：
  python3 tools/film-kit/publish.py srt <timeline.json> <out.srt>
  python3 tools/film-kit/publish.py chapters <timeline.json>      打印 “00:22 第一章｜…” 形式的章节行

时间线由 render_local.mjs 导出：captions 用 t0/t1（秒）与 plain（去掉 {} [] ^^ 的纯文本）；
chapterInfo 带章节标题（没有时退回 chapters 的序号）。
"""
import json, sys


def ts(t, sep=','):
    ms = round(t * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{sep}{ms % 1000:03d}'


def srt(tl, out):
    lines = []
    for i, c in enumerate(tl['captions'], 1):
        text = c.get('plain') or c['text']
        lines += [str(i), f"{ts(c['t0'])} --> {ts(c['t1'])}", text, '']
    open(out, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'{len(tl["captions"])} 条字幕 → {out}')


def chapters(tl):
    info = tl.get('chapterInfo') or [{'t': c['t'], 'zh': f"第 {c['n']} 段"} for c in tl['chapters']]
    for c in info:
        m, s = divmod(int(c['t']), 60)
        print(f"{m:02d}:{s:02d} {c.get('zh') or c.get('title') or ''}")


if __name__ == '__main__':
    cmd, path = sys.argv[1], sys.argv[2]
    tl = json.load(open(path, encoding='utf-8'))
    srt(tl, sys.argv[3]) if cmd == 'srt' else chapters(tl)
