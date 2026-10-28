# video-log

视频项目按录制或项目开始日期与主题归档，一期一个目录。这里保存成片、字幕、封面，以及制作过程中使用的源码和剪辑资料。

## 目录约定

```text
video-log/
├── YYYY-MM-DD-topic/       # 视频项目
│   ├── topic.mp4           # 投稿成片（本地保存，不提交 Git）
│   ├── topic.json          # 投稿信息
│   ├── topic.srt           # 字幕（可选）
│   ├── cover.jpg           # 封面（可选，由 JSON 指定）
│   └── work/               # 源码、原始素材、中间产物和制作说明
├── tools/
│   ├── render/             # 动画渲染、时间线导出、抽帧
│   ├── fonts/              # 字体子集化
│   ├── preview/            # 关键帧拼图
│   └── upload/      # 双平台投稿（bilibili/、sph/、common/）
└── fonts/                  # 字体授权文本
```

- 项目目录使用 `YYYY-MM-DD-英文主题`；日期取录制或项目开始日。
- 新项目外层放最终投稿文件，工作资料放 `work/`。历史项目保留已有内部结构和各版剪辑。
- 单 P 的 MP4、投稿 JSON 和可选 SRT 使用同一文件名主体；多 P 在 JSON 的 `videos` 数组中指定视频文件名。
- MP4、WAV、登录凭据、`biliup.exe`、`sph.exe`、浏览器登录态和 Node 依赖由 Git 忽略。换电脑时需另行迁移所需的大文件和本地工具。

## 视频项目

下表记录本地资料是否已配置投稿文件，不代表 B 站发布或审核状态。

| 日期 | 主题 | 项目目录 | 本地资料 |
| --- | --- | --- | --- |
| 2026-10-16 | 32 位 ms 计时器的故事（事故） | [32bit-ms-timer](2026-10-16-32bit-ms-timer/) | 投稿文件齐备；[制作说明与源码](2026-10-16-32bit-ms-timer/work/README.md) |
| 2026-09-28 | 整数除法的四舍五入 | [integer-division-rounding](2026-09-28-integer-division-rounding/) | 已配置投稿文件，另有重录版本 |
| 2026-08-02 | 阻塞、非阻塞与同步、异步 | [blocking-nonblocking-sync-async](2026-08-02-blocking-nonblocking-sync-async/) | 已配置投稿文件，保留剪辑版本 |
| 2026-04-12 | AI coding 与软件工程 | [ai-coding-software-engineering](2026-04-12-ai-coding-software-engineering/) | 历史归档，尚未补投稿配置 |
| 2026-03-16 | C 语言宏使用心得 | [c-language-macros](2026-03-16-c-language-macros/) | 历史归档，尚未补投稿配置 |

## 工具

| 分类 | 入口 | 用途 |
| --- | --- | --- |
| 渲染 | [render_local.mjs](tools/render/render_local.mjs) | 导出时间线或 MP4；支持并行截帧、NVENC / x264 和混入音轨 |
| 渲染 | [render2.mjs](tools/render/render2.mjs) | 较早的 Playwright 版本，提供时间线、指定时间抽帧和视频导出 |
| 字体 | [build_fonts.py](tools/fonts/build_fonts.py) | 从字体中提取所需字符，生成内嵌 WOFF 的 CSS |
| 预览 | [sheet.py](tools/preview/sheet.py) | 将已有 JPG 关键帧拼成预览图 |
| 投稿 | [使用说明](tools/upload/使用说明.md) | 本地预检、选择项目、一条命令投稿 B 站和视频号 |

各工具的依赖、用法与运行条件见 [tools/README.md](tools/README.md)。视频专用的配乐和音效脚本保存在对应项目的 `work/` 中。

## 投稿流程

以下命令从仓库根目录执行：

```powershell
# 列出项目并检查投稿文件
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -List
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Check

# 打开交互投稿入口
.\tools\upload\上传视频.bat
```

先选择上传平台：默认勾选 Bilibili 和视频号，用方向键移动、空格取消或恢复勾选，回车确认（至少选一个）。随后用方向键选择项目，回车查看已选平台的摘要，输入 `YES` 后上传。命令行直接指定项目即可一条命令发布：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Project 2026-10-16-32bit-ms-timer -Yes
```

首次视频号登录运行 `upload.ps1 -Login -Platforms sph`。B 站工具和 Cookie 保存在 `tools/upload/bilibili/`，视频号程序和会话放在 `tools/upload/sph/`。`-List`、`-Check`、`-DryRun` 只读取本地资料；`-Platforms bilibili` 或 `-Platforms sph` 可单独投稿。上传结果在各期 `work/upload/`。

上传完成后到各平台确认稿件状态，B 站 SRT 字幕仍手动上传。字段、短标题、多 P 处理和失败补传见 [投稿工具使用说明](tools/upload/使用说明.md)。

## 制作与预览

计时器视频的画面由 Canvas 绘制，配乐与音效由 Python 合成。用 Chrome / Edge 打开 [work/film.html](2026-10-16-32bit-ms-timer/work/film.html) 可预览动画：空格播放或暂停，方向键跳转；网页预览不带声音。画面、字幕和时间点在同目录的 [film.js](2026-10-16-32bit-ms-timer/work/film.js) 中。

### 本地导出一期视频

需要 Node 18+、Chrome 或 Edge、已加入 PATH 的 ffmpeg，以及 Python 的 numpy、scipy。渲染工具的 Node 依赖安装在 `tools/render/`。从仓库根目录执行：

```powershell
npm --prefix tools/render install
python -m pip install numpy scipy

Push-Location 2026-10-16-32bit-ms-timer/work

# 1. 导出时间线，合成配乐与音效
node ../../tools/render/render_local.mjs film.html timeline.json
python audio_v2.py timeline.json audio.wav

# 2. 导出 4K 成片并混入音轨（--scale 1 为 1080p）
# 此命令会覆盖项目外层的同名成片
node ../../tools/render/render_local.mjs film.html ../32bit-ms-timer.mp4 --scale 2 --audio audio.wav

Pop-Location
```

可用 `--from` / `--to` 导出片段，`--workers` 设置并行页面数，`--encoder nvenc|x264` 指定编码器。NVENC 需要兼容的 NVIDIA 显卡及支持该编码器的 ffmpeg；默认会在 NVENC 不可用时改用 x264。

## 字体与授权

项目的 `work/fonts.css` 内嵌字体子集，可直接用于预览和渲染。只有修改字符或字体时才需要运行字体工具；其当前字体路径为 Linux 路径，使用前须准备对应字体或调整路径，详见 [工具说明](tools/README.md#字体处理)。

所用字体的授权文本保存在根目录的 [fonts/](fonts/)：

- Noto Sans CJK SC（SIL Open Font License 1.1）
- Inter / Inter Display（SIL Open Font License 1.1）
- DejaVu Sans Mono（Bitstream Vera / DejaVu License）
