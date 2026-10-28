# 视频制作与投稿工具

按用途分类。下文命令除特别注明外，均从仓库根目录执行。

| 目录 | 内容 | 主要依赖 |
| --- | --- | --- |
| [render/](render/) | MP4 渲染、时间线导出、指定时间抽帧；Node 配置也放在此目录 | Node、浏览器、ffmpeg |
| [fonts/](fonts/) | 字体子集化脚本 | Python、fontTools、对应字体文件 |
| [preview/](preview/) | JPG 关键帧拼图 | Python、Pillow |
| [upload/](upload/) | 统一投稿入口、公共预检、分平台适配器与本地程序 | Windows PowerShell、biliup、sph |

## 渲染

### render_local.mjs

当前的本地导出入口。安装依赖：

```powershell
npm --prefix tools/render install
```

它使用系统 Chrome / Edge 和 Puppeteer，支持导出时间线、并行截帧、NVENC / x264 编码和混入音轨。输入页面和输出文件路径相对当前工作目录解析。

完整的计时器视频导出命令见 [仓库 README](../README.md#本地导出一期视频)。每期视频的时间线、临时音频和抽帧结果放入该项目的 `work/`。

### render2.mjs

保留的较早渲染脚本，基于 Playwright Chromium，支持：

```text
node tools/render/render2.mjs info <film.html> <timeline.json>
node tools/render/render2.mjs frames <film.html> <frames目录> <秒数列表> [scale]
node tools/render/render2.mjs video <film.html> <output.mp4> <from> <to> [fps] [scale]
```

秒数列表用英文逗号分隔，例如 `0,5,10`；scale 为 1 时是 1080p，为 2 时是 4K。视频模式导出画面，不混入音轨。此脚本需要另行准备 `playwright` 包及其 Chromium；当前 `package.json` 的默认依赖只覆盖 `render_local.mjs` 使用的 Puppeteer。

## 字体处理

`fonts/build_fonts.py` 读取画面源码中的字符，生成内嵌 WOFF 的 CSS：

```text
python tools/fonts/build_fonts.py <film.js> <fonts.css>
```

依赖 Python 的 `fontTools` 包。脚本当前直接引用 Linux 的 `/usr/share/fonts/` 下 Noto、Inter 和 DejaVu 字体；运行前需准备对应文件，或调整脚本中的字体路径。项目已有 `fonts.css` 时可直接预览和渲染，无须重新生成。

根目录的 [fonts/](../fonts/) 保存授权文本；这里的 `tools/fonts/` 保存字体处理工具。

## 预览图

`preview/sheet.py` 将一个目录内按文件名排序的 JPG 图片拼成双列预览图。默认每张拼图放 6 帧，可通过第三个参数调整：

```text
python tools/preview/sheet.py <frames目录> <输出文件前缀> [每张帧数]
```

依赖 Pillow。输入帧目录和输出前缀的父目录须已存在；输出名为 `<前缀>_00.jpg`、`<前缀>_01.jpg` 等。建议将输入帧和输出图放在项目的 `work/` 内。

## 双平台投稿

统一入口位于 [upload/](upload/)，默认依次上传 Bilibili 和视频号。`common/` 管理公共解析和进程调用，`bilibili/`、`sph/` 分别管理平台适配器、程序和登录状态。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -List
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Project 2026-10-16-32bit-ms-timer -Yes
```

`-DryRun` 只预览本地参数；`-Platforms bilibili` 或 `-Platforms sph` 可只发布一个平台。双击 `upload/上传视频.bat` 可先勾选平台，再选择项目；默认两个平台都勾选，↑/↓ 移动、空格取消或恢复勾选，回车确认。首次视频号登录运行 `upload.ps1 -Login -Platforms sph`。

项目外层的成片与 JSON 命名规则保持不变，平台差异写进 JSON 的 `sph` 对象，结果记录放入该期 `work/upload/`。程序、Cookie、浏览器会话和运行产物仅存本地，不提交 Git。完整字段、安装、登录及失败补传见 [使用说明](upload/使用说明.md)。
