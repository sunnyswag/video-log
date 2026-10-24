# 本地验证记录（2026-10-24）

环境：Node 22.22.3、FFmpeg 6.1.1（libx264）、Python + numpy/scipy/Pillow/PyYAML；依赖通过现有 node_modules 软链读取。
没有网络安装、Git 提交、推送或分支操作。测试媒体全部在 `/tmp`，未修改参考片已有文件。

## 真实参考片：浏览器启动被沙箱阻止

执行过以下两条命令，均退出 1：

```bash
CHROME_PATH=~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome \
node tools/render/render_local.mjs 2026-10-16-32bit-ms-timer/work/film.html \
  --frames captions --out-dir /tmp/video-render-ci-check/captions --scale 1

CHROME_PATH=~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome \
node tools/render/render_local.mjs 2026-10-16-32bit-ms-timer/work/film.html \
  --frames captions --out-dir /tmp/video-render-ci-check/captions --scale 1 --no-sandbox
```

共同错误：

```text
Failed to launch the browser process!
ERROR:third_party/crashpad/crashpad/util/linux/socket.cc:45
setsockopt: Operation not permitted (1)
```

错误发生在打开 film.html 之前。没有继续尝试绕过沙箱。
因此**真实参考片 JPEG、字幕拼图、0–4 秒视频及其边界像素数字均未取得**，不能把下面的合成图测试替代为真实片通过。
已有 timeline.json 中有 67 句字幕，完整抽帧成功后应有 67 张 JPEG、12 张默认每页 6 帧的拼图。

在沙箱外，从仓库根目录执行：

```bash
export CHROME_PATH=~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome
RENDER_NO_SANDBOX=1 bash tools/render/ci/verify_local.sh /tmp/video-render-reference
```

输出目录须为空。预计产物：

- `/tmp/video-render-reference/captions/f_*.jpg`
- `/tmp/video-render-reference/captions-sheet_00.jpg` 至 `_11.jpg`
- `/tmp/video-render-reference/whole.mp4`、`joined.mp4`、`parts/part-0000.mp4`、`part-0001.mp4`
- `/tmp/video-render-reference/boundary/*.png` 和 `pixels.json`

脚本会实际比较整段与拼接的解码帧数，以及第 59 帧（1.966667 秒）和第 60 帧（2 秒）的逐像素差异。

## 已通过：规划、配置、工作流

- `node tools/render/ci/plan_segments.test.mjs`：4 项测试通过；覆盖 150 组帧率/总帧数/分段数，验证全部采样值、不重不漏、尾部不足一帧舍去、段数大于帧数、非法输入和文件名冲突。
- 参考片规划：356 秒 = 10,680 帧，默认 10 段各 1,068 帧；0–4 秒 = 120 帧，两段 `[0,60)` / `[60,120)`。
- JS、Python、Bash 语法检查及 `git diff --check` 通过。
- PyYAML 成功解析 `.github/workflows/render.yml`；另用 BaseLoader 保留 YAML 1.1 会识别为布尔值的 `on` 键，逐项断言 dispatch 字段、step/job outputs、needs、fromJSON matrix、fail-fast、超时与 secret 作用域。
- `prepare.outputs.matrix/name` 均引用 `steps.prepare.outputs.*`；render 依赖 prepare，assemble 依赖 prepare 和 render。所有错误步骤会阻止后续产物上传。
- 空 SENSITIVE_WORDS：退出 1，提示配置 secret；非空测试词表但缺少 sensitive.py：退出 1，明确不能跳过。
- 锁文件根依赖与未修改的 package.json 完全匹配，包含 84 个依赖包。网络受限，未本地执行下载型 npm ci；云端依赖安装待验证。

## 已通过：FFmpeg 合成图的分段与混音

用 FFmpeg `testsrc2=size=1920x1080:rate=30:duration=4` 生成同一动画序列。
整段与两个按帧裁出的片段均采用 `libx264 / medium / CRF 17 / yuv420p / 30fps`。
用新增 concat.mjs 拼接，再用 verify_pixels.py 提取 PNG 比较：

| 项目 | 结果 |
| --- | --- |
| 整段解码帧数 | 120 |
| 两段各自帧数 | 60、60 |
| 拼接解码帧数 | 120 |
| 拼接视频 / 容器时长 | 4.000000 秒 |
| 全部 120 帧 PTS | 符合 n/30，校验通过 |

逐像素差异（每帧 2,073,600 个 RGB 像素；通道值范围 0–255）：

| 帧 | 整段 vs 拼接：不同像素数 | 最大通道差 | 平均绝对通道差 | 原分段 vs 拼接：不同像素数 |
| --- | --- | --- | --- | --- |
| 59 | 168,993 | 58 | 0.3076408179 | **0** |
| 60 | 160,772 | 48 | 0.2255459105 | **0** |

原分段与拼接的最大/平均通道差也都是 0。整段编码与独立分段编码的差异来自 CRF/GOP/参考帧决策；concat 没有再次压缩。
详细结果：`/tmp/video-ci-synthetic/boundary/pixels.json`；PNG 在同目录。

另验证两个非整毫秒段长样例，均通过最终解码帧数、逐帧 PTS、帧率、起点、流及容器时长检查：

- 17 帧 / 10 段，包含一帧段：`/tmp/video-ci-17-frames/joined.mp4`，时长 17/30 秒。
- `to=6.05` 向下量化为 181 帧 / 10 段：`/tmp/video-ci-181-frames/joined.mp4`，时长 181/30 秒。

音画合成与预览：

- 1080p、120 帧合成图 + 4 秒测试音轨，完整运行 pipeline assemble；输出 H.264 + 48kHz AAC，视频/音频/容器均 4 秒。
- 已打开并检查 `/tmp/video-ci-synthetic/final/sheet_00.jpg`（1920×540）：包含按参考时间线提取的 2.90 秒画面，标签正常。它是测试图拼图，不是参考片画面。
- 3840×2160、6 帧 / 2 段、0.2 秒：完整合成校验通过。区间无字幕中点时正确退回首帧，并生成 `/tmp/video-ci-4k/final/sheet_00.jpg`。
- 负例：按 121 帧规划读取实际 120 帧片段，被帧数校验拒绝；向 4 秒视频提供 0.5 秒配乐，被长度校验拒绝，未生成最终文件。

## 已通过：真实配乐

用参考片现有完整 timeline.json 运行未修改的 audio_v2.py，设置 `PYTHONDONTWRITEBYTECODE=1`、`PYTHONHASHSEED=0`：

- 输出 `/tmp/video-ci-reference-audio/audio-full.wav`，时长 **357.5 秒**。
- `/usr/bin/time -v`：墙钟 **27.88 秒**；峰值 RSS **2,531,128 KiB（约 2.41 GiB）**；退出 0。
- 用与 prepare 相同的 FFmpeg 参数裁成 4 秒、48kHz 双声道 PCM：`/tmp/video-ci-reference-audio/audio.wav`。
- 将它混入上述测试画面的拼接结果，生成 `/tmp/video-ci-reference-audio/mixed.mp4`，120 帧 / 4 秒，全部校验通过。

## 尚待云端或沙箱外验证

- GitHub Actions 的真实 runner、Chrome 软件绘制及吞吐量没有实测；15–60 分钟整期估计是按 0.5–3 fps 假设计算，不能视为基准测试结果。
- 当前仓库未提供 `tools/check/sensitive.py`；按约定由另一项工作补齐后，且配置非空 SENSITIVE_WORDS，正式 workflow 才能越过 prepare 检查。
- CI 限定整数 fps、scale 为 1 或 2、并发最多 20；不支持 30000/1001 这类有理帧率。普通本地 renderer 的原有 fps/scale 用法仍保留。
- 非整帧的尾部向下取整；保留原时间线，实际成片长度写入 timeline.render；配乐始终完整合成后裁切。这些均为本次采用的保守行为。
- 独立静态审查覆盖了帧边界、音轨、失败传播、输入、密钥、artifact 和 workflow 依赖；提出的 concat 时长精度疑点已修复，并以非整毫秒样例通过实测。
