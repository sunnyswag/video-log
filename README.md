# video-log

我在 B 站发的视频，制作过程中生成的产物都放在这里：动画源码、配乐音效的合成脚本、字幕/旁白稿、封面。一期视频一个文件夹。

这些视频的画面、配乐和音效**全部由 AI 写代码生成**：画面是 Canvas 逐帧绘制的网页动画，配乐和音效用 numpy 合成，最后用浏览器逐帧截图、ffmpeg 编码成视频。没有用视频生成模型，也没有素材库。

## 视频列表

| 日期 | 视频 | 风格 | 源码 |
| --- | --- | --- | --- |
| 2026-10-16 | 32 位 ms 计时器的故事（事故） | 赛博朋克 HUD | [2026-10-16-32bit-ms-timer](2026-10-16-32bit-ms-timer/) |

## 怎么看、怎么改

- **直接预览**：下载对应文件夹，用 Chrome / Edge 打开里面的 `film.html`。空格播放/暂停，←/→ 跳 5 秒（预览里没有声音，声音在成片里）。
- **改内容**：画面、字幕文字、每句字幕的时间点都在 `film.js` 里。字幕时长按字数自动计算，画面动作跟着字幕走，改字不用手动对时间轴。
- **导出视频**：见下面的 `tools/render_local.mjs`。

## 工具

| 文件 | 作用 |
| --- | --- |
| `tools/render_local.mjs` | 把 `film.html` 逐帧导出成 MP4。多个页面并行截帧；有 NVIDIA 显卡时用 NVENC 编码，没有就用 x264 |
| `tools/build_fonts.py` | 把用到的字符从字体里子集化，生成内嵌字体的 `fonts.css`，保证任何电脑上渲染一致 |
| `tools/sheet.py` | 把抽出来的关键帧拼成预览图，方便检查画面 |
| `<视频>/audio_hud.py` | 读时间线（字幕、音效点、章节），合成配乐和音效，输出 wav |

### 本地导出一期视频

需要 Node 18+、Chrome 或 Edge、ffmpeg（要用显卡编码，需要带 `h264_nvenc` 的版本，比如 [gyan.dev 的 full 版](https://www.gyan.dev/ffmpeg/builds/)）。

```bash
cd tools && npm install && cd ..
cd 2026-10-16-32bit-ms-timer

# 1. 导出时间线，合成配乐音效
node ../tools/render_local.mjs film.html timeline.json
python3 audio_hud.py timeline.json audio.wav          # 需要 numpy、scipy

# 2. 导出 4K 视频并混入音轨（--scale 1 是 1080p）
node ../tools/render_local.mjs film.html out.mp4 --scale 2 --audio audio.wav
```

常用参数：`--from` / `--to` 只导出一段，`--workers` 并行截帧的页面数，`--encoder nvenc|x264` 强制指定编码器。

## 字体

`fonts.css` 里内嵌的是下面几款字体的子集，均为开源授权，授权文本见 [fonts/](fonts/)：

- Noto Sans CJK SC（SIL Open Font License 1.1）
- Inter / Inter Display（SIL Open Font License 1.1）
- DejaVu Sans Mono（Bitstream Vera / DejaVu License）
