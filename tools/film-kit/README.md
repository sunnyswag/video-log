# film-kit 使用文档

给每期视频的动画 / 配乐作者（通常是 AI 执行者）：只读本文和示例，就能从零做出一期视频。所有命令默认从仓库根目录执行；示例项目以 `2026-11-01-my-topic` 代称，换成自己的目录名。

| 文件 | 用途 |
| --- | --- |
| [engine.js](engine.js) | 逐帧动画引擎（文件头注释是权威 API 说明） |
| [template/film.html](template/film.html) | 预览页模板，复制到每期 `work/` |
| [examples/hello/](examples/hello/) | 最小画面示例（15 秒、两个场景） |
| [audio_kit.py](audio_kit.py) | 离线配乐积木（文件头注释是权威说明） |
| [examples/audio_example.py](examples/audio_example.py) | 自包含配乐示例，`python3 -B tools/film-kit/examples/audio_example.py /tmp/demo.wav` |
| [../render/render_local.mjs](../render/render_local.mjs) | 本地时间线导出 / 抽帧 / 整片导出 |
| [../render/ci/README.md](../render/ci/README.md) | 云端分段渲染的完整机制 |
| [../fonts/build_fonts.py](../fonts/build_fonts.py) / [../check/sensitive.py](../check/sensitive.py) / [../preview/sheet.py](../preview/sheet.py) | 字体子集化 / 敏感词检查 / 关键帧拼图 |

完整参考实现：[2026-10-16-32bit-ms-timer/work/](../../2026-10-16-32bit-ms-timer/work/)（旧版、未用引擎的成片一期）；用引擎移植后的同一期画面在 `.trash/engine-port/work/film.js`（含完整的风格包写法；注意它比正式项目多一层目录，引擎路径是 `../../../`，正式项目是 `../../tools/film-kit/engine.js`）。

## 1. 总览：一期视频怎么做

一期项目的文件组成：

```text
YYYY-MM-DD-topic/
├── topic.mp4          # 成片（本地保存，不提交 Git）
├── topic.json/.srt    # 投稿信息与字幕
├── cover.jpg          # 封面（可选）
└── work/
    ├── film.html      # 预览页（复制 tools/film-kit/template/film.html）
    ├── film.js        # 全部画面代码：风格、场景、字幕文本、cue
    ├── fonts.css      # build_fonts.py 生成的字体子集（提交；CI 不装字体）
    ├── audio.py       # 配乐合成脚本（CI 调用）
    ├── timeline.json  # 导出的完整时间线（配乐输入）
    └── render.json    # CI 渲染清单（提交）
```

从零到成片：

```bash
# 0) 一次性准备：Node 18+、ffmpeg、Python 的 numpy/scipy/fontTools
npm --prefix tools/render install
python3 -m pip install numpy scipy fontTools

# 1) 新建目录，复制预览页模板（模板里的引擎路径已是 ../../tools/film-kit/engine.js）
mkdir -p 2026-11-01-my-topic/work
cp tools/film-kit/template/film.html 2026-11-01-my-topic/work/

# 2) 写 work/film.js（风格 + 场景，见第 2、3 节）；
#    用内嵌字体时在 film.html 的 <head> 加 <link rel="stylesheet" href="fonts.css">，
#    并在 create() 里填 fontsNeeded

# 3) 生成字体子集（film.js 里的文字改了就要重跑；字体文件须已在上述目录，仓库不存字体）
NOTO_DIR=~/.local/share/fonts/video-log/noto \
INTER_DIR=~/.local/share/fonts/video-log/inter \
python3 tools/fonts/build_fonts.py 2026-11-01-my-topic/work/film.js 2026-11-01-my-topic/work/fonts.css

# 4) 本地抽帧拼图审阅（须在 AI 沙箱外跑，Chrome 路径见第 6 节）
export CHROME_PATH=~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome
node tools/render/render_local.mjs 2026-11-01-my-topic/work/film.html --frames captions --out-dir /tmp/vc --scale 1
python3 tools/preview/sheet.py /tmp/vc /tmp/vc-sheet

# 5) 导出时间线，本地试跑配乐（audio.py 骨架见第 5 节）
node tools/render/render_local.mjs 2026-11-01-my-topic/work/film.html 2026-11-01-my-topic/work/timeline.json
python3 2026-11-01-my-topic/work/audio.py 2026-11-01-my-topic/work/timeline.json /tmp/audio.wav

# 6) 写 work/render.json（字段见第 7 节），例如：
#    {"page":"film.html","audio":"audio.py","name":"my-topic","fps":30}

# 7) 敏感词检查（公开前必须本地过一次；词表见第 8 节）
python3 tools/check/sensitive.py 2026-11-01-my-topic

# 8) 提交推送（fonts.css、render.json 都要提交；MP4/WAV 不提交）
git add 2026-11-01-my-topic && git commit -m "新增一期：my-topic" && git push

# 9) 触发云端渲染（workflow 须已在默认分支；建议先用 to=4 快速测试，见第 7 节）
gh workflow run render.yml -f project=2026-11-01-my-topic -f to=4

# 10) 下载成片
gh run list --workflow=render.yml --limit 3
gh run download <run-id> -n my-topic-scale-2 -D /tmp/my-topic
```

## 2. 引擎 API

时间单位一律为**秒**；所有绘图使用 W×H 逻辑坐标，引擎按画布实际尺寸自动缩放。engine.js 是普通 `<script>`，暴露全局 `FilmKit`。

### 创建

- `FilmKit.create({W=1920, H=1080, FPS=30, fonts, fontsNeeded, theme, code, captions, ...钩子}) → film`
  `fonts` 是字体族映射（默认键 `cjk/disp/mono`）；`theme` 是颜色映射（默认含 `bg/white/cyan/red/amber/green/blue/pink/code/comment/punct/constant`）；`code` 可扩展 `{keywords, types}` 供代码高亮；`captions` 见下；其余键即钩子（见后）。`fontsNeeded` 原样进入 `FILM.fontsNeeded`，填 CSS 字体简写数组（如 `'700 32px "FCJK","Noto Sans CJK SC",sans-serif'`），播放器会等这些字体就绪后再渲染。

### 场景

- `film.addScene({id, chapter=0, dur, pre=.55, post=.7, captions, cues, effects, draw})`
  `id` 必须非空且全局唯一；`pre/post` 是场景首尾的字幕缓冲；省略 `dur` 时由最后一句字幕结束时间 + `post` 推算。也兼容旧片的 `chap/sfx/fx` 字段名。
- `draw(g, lt, sc, frame)`：`lt` 是场景局部时间；`sc` 含 `start/d` 和局部字幕起止数组 `cs/ce`（供卡点）。
- `film.sceneAt(t)` 返回 t 秒所在场景；`film.effectsAt(t, type)` 返回命中的特效窗口，带 `progress/remaining`。

### 字幕

- 场景内 `captions: [{t, text, dur?, end?}]`，**局部时间**；每句默认时长 `max(2, .8 + 字数×.175)`，最后一句默认结束于 `dur−.3`。或用 `caps: [文本 | [文本, 时长]]` 自动排句（二者选一）。
- 富文本标记（不嵌套）：`{重点}` → emphasis、`[危险]` → danger、`^强调^` → accent。
- 全局 `captions` 配置：`font{f,s,w}`、`colors{emphasis,danger,accent}`（默认取 `theme.cyan/red/amber`）、`maxWidth`、`lineHeight`、`baseY`（数值或 `行数=>y`）、`slide`、`fadeIn/fadeOut`、`revealDuration(字数)=>秒`、`wrap`（`'wrap'` 或旧片 `'balanced'`）、`enabled`。

### 章节、cue 与特效

- `film.chapter(n, zh, en, desc)`：在**当前总时间**登记章节 n（编号不能重复）；只登记、不绘制章节卡——章节卡是一个普通场景，自己在开头 `addScene`（先 `chapter` 再 `addScene`）。
- `cues: [{t, type, v=1}]`：进 `FILM.cues`，是配乐音效的触发点；也支持 `sc=>数组`（卡点用 `sc.cs/ce`）。
- `effects: [{t, type, a, dur}]`：视觉特效窗口（抖动、闪光、故障等），画面在钩子里用 `film.effectsAt` 查询；也支持 `sc=>数组`。

### 钩子

- `prepare(env) => cache`：`env = {cw, ch, W, H, FPS, scaleX, scaleY, mk}`，**不含时间**；只创建与时间无关的离屏资源（静态背景、暗角、颗粒图等），返回值即每帧 `frame.cache`。
- 每帧调用顺序：
  `drawBackground → beforeScene → scene.draw → drawTransition → drawChrome → beforeCaptions → drawCaptionBackground → drawCaption → afterCaptions`
  `beforeScene` 与 `scene.draw` 共用一次 save/restore（适合场景淡入淡出/整体位移）；其余每个钩子单独隔离状态。
- `frame = {canvas, t, lt, sc, cw, ch, W, H, FPS, scaleX, scaleY, cache, film}`。
- 自定义字幕样式用 `drawCaption(g, layout, frame)`：`layout = {caption, font, alpha, ain, aout, wipe, dy, lines:[{segments, visible, width, x, y, reveal}]}`。
- `drawCover(g, frame)` 可选：封面；不提供则渲染第 0 秒画面。

### 导出与工具

- `film.finish()`：封存构建器，生成并设置 `window.FILM`（重复调用返回同一对象）；之后不能再改时间线。`FILM` 含 `W/H/FPS/duration/scenes/captions/cues/chapters/chapterInfo/fontsNeeded/render/drawCover`。
- `film.render(canvas, t)` / `film.drawCover(canvas)`：与 `FILM` 上的方法相同。
- `film.prepare(cw, ch)`、`film.invalidate()`：手动预热 / 在字体或资源变化后清缓存。
- 绑定本片字体与颜色的工具：`film.txt(g, s, x, y, o)`（o：`f/s/w/a/b/c/al/ls/sh/sb/stroke/lw/noFill`）、`film.tw`、`film.fontStr`、`film.tokenize`、`film.drawCode(g, x, y, lines, o)`（o：`s/lh/p/t/diff/hl/hlA/width/cursor`，`p` 为打字进度）、`film.parseRich`、`film.capLines`。
- 与画风无关的工具同时挂在 `FilmKit` 和 `FilmKit.utils`：`TAU clamp lerp seg eo eio eback hash pulse blink typed plain capDur rng rgba mk parseRich splitRich`。`FilmKit.rng(seed)` 返回可重复随机序列；`FilmKit.mk(w,h)` 建离屏画布；`FilmKit.splitRich(segments, at)` 按字符位置分割富文本。

### 最小示例（摘自 examples/hello/film.js）

```js
const W = 1920, H = 1080, ink = '#243c43', accent = '#c76e42';
const film = FilmKit.create({
  W, H, FPS: 30,
  fonts: { cjk: 'sans-serif', disp: 'sans-serif', mono: 'monospace' },
  fontsNeeded: [],                                  // 用 fonts.css 时改为 ['700 32px "FCJK"', …]
  theme: { bg: '#f3f0e7', white: ink, cyan: accent, red: '#a23b4d', amber: '#84702e' },
  captions: { font: { s: 38, w: 500 }, baseY: 965 },
  prepare({ mk, cw, ch }) {                         // 只建与时间无关的资源
    const paper = mk(cw, ch), g = paper.getContext('2d');
    g.fillStyle = '#f3f0e7'; g.fillRect(0, 0, cw, ch);
    return { paper };
  },
  drawBackground(g, { cache }) { g.drawImage(cache.paper, 0, 0, W, H); },
});
film.chapter(1, '你好，时间线', 'HELLO, TIMELINE', '风格与场景交给你，时间交给引擎');
film.addScene({
  id: 'hello', chapter: 1, dur: 7.5,
  captions: [{ t: .7, text: '从一个{确定的时刻}开始。' }, { t: 3.8, text: '每一帧，都可以直接抵达。' }],
  cues: [{ t: 1.2, type: 'blip', v: .6 }],
  draw(g, t) {
    const { TAU, eo, seg } = FilmKit;
    film.txt(g, '你好，时间线。', 160, 445, { s: 100, w: 700, c: ink });
    g.strokeStyle = accent; g.lineWidth = 12; g.lineCap = 'round';
    g.beginPath(); g.arc(1420, 470, 180, -TAU / 4, -TAU / 4 + TAU * .8 * eo(seg(t, .15, 1.8))); g.stroke();
  },
});
film.finish();
```

## 3. 风格包怎么写

引擎负责与画风无关的部分：时间线与场景排期、字幕排版与出场动画（换行、reveal、淡入淡出）、富文本解析、章节登记、逐帧调度、离屏缓存、代码高亮、确定性约束。**其余全部归风格包**，在 `create()` 的钩子和自己的图元函数里实现：

- **背景**：`prepare` 里预渲染静态层（渐变、网格、噪点、暗角），`drawBackground` 每帧贴上并画时间相关元素（移动光带等）。
- **章节卡**：写一个 `chapterCard(n, zh, en, desc)` 包装函数——先 `film.chapter(...)` 登记再 `addScene` 一个 3 秒左右的无字幕场景，画面（大编号、标题、进度格）完全自定。
- **字幕样式**：`captions` 配置管排版；`drawCaptionBackground` 画底部压暗带；`drawCaption` 画自定义描边、reveal 光标、装饰括号等。
- **外框 / HUD**：`drawChrome` 画每帧常驻装饰（四角框、标题行、时间码、章节进度条）。
- **转场**：`beforeScene` 做场景淡入淡出或抖动（改 `globalAlpha` / `translate`，与场景 draw 共用状态）；`drawTransition` 画整屏转场遮罩。
- **后处理**：`beforeCaptions`（如 bloom，避免糊住字幕）和 `afterCaptions`（扫描线、颗粒、故障切片、闪光——会盖在字幕之上）。
- **封面**：`drawCover`，可复用风格图元另排一版构图。

字幕富文本到主题色的映射：`{}`→emphasis、`[]`→danger、`^^`→accent，默认取 `theme.cyan/red/amber`，用 `captions.colors` 覆盖。换主题只改 `theme` + `captions.colors` + 风格图元里的常量。

参考：`examples/hello/film.js`（最简）；`.trash/engine-port/work/film.js`（HUD 风格完整一期，重点看 `prepareStyle`、`fxAmount`（用 `effectsAt` 聚合特效强度）、`drawChrome`、`drawBloom`、`drawFinish`、`drawCover` 的写法）。

## 4. 纯函数约束与常见坑

云端渲染会把整片切成 K 段并行、任意帧独立调用，因此：

- `FILM.render(canvas, t)` 必须是 t 的**纯函数**：同一 t 无论何时、哪个进程调用，画面都相同。
- 不依赖上一帧：不累加变量、不跨帧读写状态。引擎每帧都会清空画布并重置变换，你只需管自己的钩子。
- 不读真实时钟：禁用 `Date.now()`、`performance.now()`、`new Date()`；动画相位一律由 t 推导（逐帧变化用帧号 `Math.floor(t * FPS)`）。
- 随机数必须播种：用 `FilmKit.rng(seed)`。要么在 `prepare` 里预生成静态资源（星点、颗粒图），要么每帧用固定种子重新生成。
- 可写的离屏缓冲（bloom 降采样图、故障切片的 tmp）**每帧使用前必须清空**（`clearRect`），否则残留上一帧。
- 预览页协议：页面暴露 `window.__ready / __seek(t) / __pause / __duration`（模板另有 `__play`），画面在 `<canvas id="c">`。模板已实现，不要改。
- 字幕时间必须落在场景内且结束晚于开始，否则 `addScene` 直接抛错。
- 本机 headless Chromium 下 `page.screenshot` 会超时；抽帧和时间线导出走 `render_local.mjs`（内部用 `canvas.toDataURL`）。
- AI 执行者沙箱里起不来 Chromium（`setsockopt: Operation not permitted`）：**预览抽帧、时间线导出必须在沙箱外跑**；执行者写完代码后，在报告里写清需要运行的命令（本文第 6 节的命令可直接引用）。
- 字体：`fonts.css` 由 `build_fonts.py` 从 film.js 用到的字符子集化生成并提交到仓库，CI 不装字体。**改了 film.js 里的任何文字都要重新生成 fonts.css**，否则成片会缺字回退。

## 5. 配乐（audio_kit.py）

采样率固定 48 kHz，数组为浮点 `(N,)` 单声道 / `(N,2)` 立体声，时间均为秒。导入 audio_kit 不读文件、不渲染、不建全局随机流；`add` / `place_cues` 原地叠加，其余 DSP 返回新数组。响度目标默认 -24.3832 dBFS RMS、峰值 0.89（约 -1.01 dBFS），`normalize` 峰值优先。

**基础**：`SR`；`tvec(d)` 采样时间数组；`mtof(m)` MIDI→Hz；`add(buf, sig, t, gain, pan)` 原地叠加（负起点/尾音裁切）；`fade(x, fin, fout)`；`read_timeline(path)` 读时间线；`write_wav(path, x)` 写 PCM16（样本须有限且在 [-1,1]，先 normalize/limit_bus，否则报错）；`rms_db/peak_db` 测量；`normalize(x, target_rms_db, peak_db, mask)`；`limit_bus(x, ceiling_db)`。
**滤波与包络**：`lp/hp/bp`（Butterworth）；`adsr(dur, a, d, s, r)`（release 含在 dur 内）。
**音色—参考片**：`pad_voice/pad_chord` 暖垫、`pluck` FM 拨弦、`bass` 正弦低音、`kick`、`hat`、`clap`。
**音色—明快 MG / 像素终端 / 安静叙事**：`marimba`、`woodblock`、`shaker`、`sq` 带限方波、`chip_square`、`chip_triangle`、`fm_piano`、`electric_piano`。
**效果与混音**：`delay`（乒乓）、`reverb`（统计混响，**输出长等于输入**，须事先预留尾音）、`duck`（侧链，可用 key 数组或 times 时刻）。
**编曲调度**：`timeline_sections(info, 'chapters'|'scenes')` 生成段落表（名分别为章节号 / 场景 id）；`section_at(t, sections)`；`schedule_bars(sections, patterns, duration, bpm, beats=4, lookahead, extra_bars)` 全片固定 BPM 网格，逐小节产出 `{t, beat, chord, layers, density, …}`；`place_cues(buf, cues, fx, pan, strict)` 按 `fx[type](v) → 波形` 摆音效（推荐 `functools.partial` 绑定 rng/参数，遇未知类型 strict 默认报错）。
**音效**：`s_tick`、`s_blip`、`s_confirm`、`s_error`、`s_whoosh`；cue 类型到音效的映射由每期自己定义。

关键坑：

- 尾音要预留：总线按 `duration + 尾音`（参考片 +1.5 秒）分配；CI 会把成品 WAV 裁到 `帧数/fps`。
- 噪声音色（`hat/clap/shaker/s_tick/s_whoosh/reverb`）的 `rng` 参数：整数种子可复现（默认 0），传 `np.random.Generator` 则消费其状态。
- CI 从 `work/` 执行 `python3 <audio> <时间线绝对路径> <输出 WAV 绝对路径>`，收到的是**完整**时间线；即使 `to=4` 试渲染也要能合成完整配乐。

`work/audio.py` 骨架：

```python
"""一期配乐。用法：python3 audio.py timeline.json out.wav"""
import sys
from functools import partial
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/film-kit'))
import audio_kit as ak
PATTERNS = {'intro': dict(prog=[(48, [72, 76, 79])], layers=dict(pluck=.4)), '1': dict(prog=[(45, [69, 72, 76])], layers=dict(pluck=.8))}
def render(info):
    n = int((info['duration'] + 1.5) * ak.SR)                  # 预留尾音
    music, sfx = np.zeros((n, 2)), np.zeros((n, 2))
    for bar in ak.schedule_bars(ak.timeline_sections(info, 'chapters'), PATTERNS, info['duration'], bpm=96):
        for k, m in enumerate(bar['chord'][1]):
            ak.add(music, ak.pluck(ak.mtof(m)), bar['t'] + k * bar['beat'] / 2, bar['layers']['pluck'])
    music = ak.fade(ak.reverb(music, rng=3), .2, 1.2)          # reverb 不加长，尾音靠 n 预留
    fx = dict(blip=partial(ak.s_blip), confirm=ak.s_confirm)   # cue.type → 波形，fx[type](v)
    ak.place_cues(sfx, info['cues'], fx)
    return ak.normalize(ak.duck(music, key=sfx) + sfx)         # 默认 -24.38 dBFS RMS / 0.89 峰值
if __name__ == '__main__':
    ak.write_wav(sys.argv[2], render(ak.read_timeline(sys.argv[1])))
```

## 6. 本地预览与审阅

- 用 Chrome/Edge 直接打开 `work/film.html`：空格播放/暂停，←/→ 跳 5 秒；预览无声，声音看成片。
- 本机 Chromium：`~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`（`--chrome` 参数或 `CHROME_PATH` 环境变量，二者优先于系统安装路径）。
- 抽帧拼图（`captions` = 每句字幕中点；也可逗号分隔秒数；时间须在 `[0, duration)` 内；输出目录要用空目录，文件名如 `f_0061.50.jpg`）：

```bash
export CHROME_PATH=~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome
node tools/render/render_local.mjs 2026-11-01-my-topic/work/film.html --frames captions --out-dir /tmp/vc --scale 1
python3 tools/preview/sheet.py /tmp/vc /tmp/vc-sheet        # 每 6 张拼一张，输出 vc-sheet_00.jpg、_01.jpg…
node tools/render/render_local.mjs 2026-11-01-my-topic/work/film.html --frames 0,61.5,120 --out-dir /tmp/vp --scale 1
```

- 时间线导出（给配乐用，不启动 ffmpeg）：

```bash
node tools/render/render_local.mjs 2026-11-01-my-topic/work/film.html 2026-11-01-my-topic/work/timeline.json
```

- 本地整片导出（可选，一般交给云端）：`node tools/render/render_local.mjs <work>/film.html out.mp4 --scale 2 --audio audio.wav`，其余选项见 `render_local.mjs` 文件头注释。

## 7. 云端渲染（GitHub Actions）

前提：`work/render.json` 已提交；workflow（`.github/workflows/render.yml`，名 **Render video**）已在默认分支；仓库 secret `SENSITIVE_WORDS`（多行词表）已配置。

`work/render.json` 字段：

| 字段 | 约定 |
| --- | --- |
| `page` | 必填；work 内相对 `.html` 路径，页面提供 `__ready/__pause/__seek/__duration/FILM` 和 canvas `#c` |
| `audio` | 必填；work 内相对 `.py` 路径；CI 从 work 执行 `python3 <audio> <时间线绝对路径> <输出 WAV 绝对路径>` |
| `name` | 必填；成片文件名主体，只含字母、数字、点、下划线、短横线，字母或数字开头 |
| `fps` | 默认 30；1–120 整数 |

workflow 输入（Actions 页 → Render video → Run workflow，或 `gh workflow run`）：

| 输入 | 默认 | 说明 |
| --- | --- | --- |
| `project` | 必填 | 仓库顶层目录名，如 `2026-11-01-my-topic` |
| `scale` | `2` | `1` = 1080p；`2` = 3840×2160 |
| `segments` | `10` | 1–20 个并行渲染段 |
| `to` | 空 | 正数且 ≤ 时长；空 = 整片 |

- 设计尺寸 1920×1080，成片 4K（scale 2）30 fps。分段按整数帧切：`N = floor(秒×fps)`，第 i 段为 `[floor(iN/K), floor((i+1)N/K))`。
- **快速测试**：先 `to=4` 渲染前 4 秒校准速度与画面；配乐仍合成完整时长再裁剪，不会提前缩短时间线。
- 产物 artifact：`<name>-scale-<scale>` 内 `<name>.mp4`（保留 7 天）；`<name>-preview` 内 `sheet_*.jpg` 和 `timeline.json`；中间产物保留 1 天。任一分段失败不会产出成片。

```bash
gh workflow run render.yml -f project=2026-11-01-my-topic          # 整片
gh workflow run render.yml -f project=2026-11-01-my-topic -f to=4  # 快速测试
gh run list --workflow=render.yml --limit 3
gh run download <run-id> -n my-topic-scale-2 -D /tmp/my-topic
```

机制细节（job 图、校验、本地复现流水线 `tools/render/ci/pipeline.mjs`）见 [../render/ci/README.md](../render/ci/README.md)。

## 8. 脱敏要求

这是公开仓库，视频发布后所有提交内容都可被关联到本人：

- 项目内所有文本（film.js、audio.py、cover.html、投稿 JSON、README、文件名和目录名）**不得出现**：公司名、品牌、产品型号、项目代号、内部域名、人名。
- 画面里的代码只能是**重写的示意代码**，不能照抄任何原始仓库的代码、路径或注释。
- 敏感词表不在仓库里：本机 `~/.config/video-log/sensitive.txt`，CI 用 secret `SENSITIVE_WORDS`；每行一个词，`#` 注释，`re:` 开头为正则。词表为空时检查直接失败（宁可拦错）。
- 公开前必须本地过：`python3 tools/check/sensitive.py <项目目录>`（扫文本文件和文件路径，跳过二进制、`fonts.css`、`preview/`、`.trash/`）。CI prepare 阶段会再查一次，命中则整个渲染失败、不会上传产物。
