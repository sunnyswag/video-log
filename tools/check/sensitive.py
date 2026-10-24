"""敏感词检查：扫描视频项目里会公开的文本（画面源码、字幕、投稿信息、封面页），命中就以非 0 退出。

用法：
  python3 tools/check/sensitive.py <目录或文件>... [--show]

词表来源（按顺序取第一个存在的）：
  1. 环境变量 SENSITIVE_WORDS（多行文本；CI 里来自 GitHub Secret）
  2. ~/.config/video-log/sensitive.txt（本机）
词表本身不进仓库。每行一个词，# 开头是注释：
  - 纯 ASCII 的词：不区分大小写，前后不能紧挨字母或数字（下划线、点、斜杠都算分隔）
  - 含中文的词：按子串匹配
  - re: 开头：正则，不区分大小写
默认只打印“文件:行:列 命中第 N 条”，不打印命中的词，免得在公开的 CI 日志里泄露词表；本机加 --show 才显示原文。
词表为空时直接失败（宁可拦错，不能放过）。
"""
import os, re, sys

SKIP_EXT = {'.mp4', '.mkv', '.mov', '.wav', '.m4a', '.mp3', '.aac', '.flac', '.jpg', '.jpeg', '.png', '.gif', '.webp',
            '.woff', '.woff2', '.ttf', '.otf', '.ttc', '.zip', '.pdf'}
SKIP_NAME = {'fonts.css'}          # 字体子集是 base64，字符都来自已扫描的 film.js
SKIP_DIR = {'node_modules', '.git', 'preview', '.trash'}


def load_words():
    raw = os.environ.get('SENSITIVE_WORDS')
    if raw is None:
        p = os.path.expanduser('~/.config/video-log/sensitive.txt')
        raw = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    pats = []
    for line in raw.splitlines():
        w = line.strip()
        if not w or w.startswith('#'):
            continue
        if w.startswith('re:'):
            pats.append(re.compile(w[3:], re.I))
        elif w.isascii():
            pats.append(re.compile(r'(?<![A-Za-z0-9])' + re.escape(w) + r'(?![A-Za-z0-9])', re.I))
        else:
            pats.append(re.compile(re.escape(w), re.I))
    return pats


def walk(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIR]
            for f in files:
                yield os.path.join(root, f)


def main():
    show = '--show' in sys.argv
    paths = [a for a in sys.argv[1:] if a != '--show']
    if not paths:
        print(__doc__); return 2
    pats = load_words()
    if not pats:
        print('敏感词表为空：请设置 SENSITIVE_WORDS 或 ~/.config/video-log/sensitive.txt'); return 2
    hits = n = 0
    for f in walk(paths):
        name = os.path.basename(f)
        for k, pat in enumerate(pats, 1):     # 文件名也算公开内容
            if pat.search(f):
                hits += 1; print(f'{f}: 路径命中第 {k} 条' + (f'（{pat.search(f).group(0)}）' if show else ''))
        if name in SKIP_NAME or os.path.splitext(name)[1].lower() in SKIP_EXT:
            continue
        try:
            text = open(f, encoding='utf-8').read()
        except (UnicodeDecodeError, OSError):
            continue
        n += 1
        for i, line in enumerate(text.splitlines(), 1):
            for k, pat in enumerate(pats, 1):
                for m in pat.finditer(line):
                    hits += 1
                    print(f'{f}:{i}:{m.start() + 1}: 命中第 {k} 条' + (f'（{m.group(0)}）' if show else ''))
    print(f'检查了 {n} 个文本文件，词表 {len(pats)} 条，命中 {hits} 处')
    return 1 if hits else 0


if __name__ == '__main__':
    sys.exit(main())
