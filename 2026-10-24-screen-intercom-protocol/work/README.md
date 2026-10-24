# Kotlin 实现 SIP 通信协议 · v2

29 幕，338 秒，30 fps（10,140 个视频帧）；逻辑画布为 1920×1080。云端按时间段并行渲染，`FILM.render(canvas, t)` 的输出必须只依赖时间、画布尺寸和固定资源，允许任意跳帧与冷启动。

## 文件组成

| 文件 | 职责 |
| --- | --- |
| `script.js` | 29 幕的时长、章节和 84 条字幕；字幕原文的唯一数据源 |
| `kit.js` | 主题、字体族、图元、镜头、纸面纹理和后期；`prepareStyle` 创建固定离屏资源 |
| `film.js` | 场景编排、事件和绘制钩子；最后调用 `film.finish()` 导出 `window.FILM` |
| `film.html` | 预览页面、字体加载、播放与跳转控制 |
| `audio.py` | 根据导出的时间线生成配乐与音效 |
| `fonts.css` | 内嵌 WOFF 字体子集，供预览与正式渲染共用 |
| `render.json` | 页面、音频脚本、输出名与帧率配置 |
| `checks.cjs` | 无浏览器的 v2 自动检查器，只读取画面源码 |
| `checks.report.txt` | 本次自动检查完整输出，包含结论、问题清单及检测局限 |

引擎位于 `../../tools/film-kit/engine.js`，API 见其文件头与 [FilmKit 说明](../../tools/film-kit/README.md)。页面依次加载 **engine.js → script.js → kit.js → film.js**，四个普通 `<script>` 共享全局词法作用域；不要改成独立 CommonJS 模块加载。

v1 的 `film.test.cjs`、`film.overlap.cjs`、`film.layout-check.cjs`、`film.timeline-check.cjs` 已删除。旧版 README 中的测试数字不适用于 v2，应以当前源码重新运行的报告为准。

## 预览

以下命令均从本期 `work` 目录运行。可直接用浏览器打开 `film.html`，或提供覆盖仓库根目录的静态服务，让页面能读取共享引擎：

```sh
python3 -m http.server 8000 --directory ../..
```

浏览器访问 `http://localhost:8000/2026-10-24-screen-intercom-protocol/work/film.html`。空格播放/暂停，左右方向键跳转 5 秒，底部滑条可定位时间。预览页面不播放成片配乐。

页面等待字体加载完成后设置 `window.__ready`；可在浏览器控制台使用 `__pause()`、`__seek(120)` 定位检查。

## 生成字体

在安装了 Python `fontTools`、Noto Sans CJK、Inter、DejaVu 字体的环境运行：

```sh
cat kit.js script.js film.js > /tmp/all.js
python3 ../../tools/fonts/build_fonts.py /tmp/all.js fonts.css
```

合并文件只用于收集字符，不是页面的加载顺序。可通过 `NOTO_DIR`、`INTER_DIR`、`DEJAVU_DIR` 环境变量指定字体目录。增改文字后应重新生成字体；已有 `fonts.css` 时可直接预览。

## 自动检查

需要 Node.js 18 或以上，不需要 npm 依赖或 Chromium：

```sh
node checks.cjs
```

保存完整报告并保留检查退出码：

```sh
node checks.cjs > checks.report.txt 2>&1
```

退出码为 `0` 表示全部规则通过，`1` 表示至少一项失败或检查器中止。重叠、越界与字幕区告警也会返回 `1`；不能把它们直接当作经浏览器确认的视觉缺陷。脚本自身不写文件，重定向会替换旧报告。

- **加载与时间线**：同一 VM 顺序执行四份脚本；检查 338 秒（误差小于 0.01）、29 幕、84 条字幕与 `SCRIPT` 原文逐条一致、cue 类型白名单、0–9 章节顺序。
- **数值健康**：1080p、4K 各扫描 0–338 秒，每 0.25 秒一次，包含终点，共 1,353 帧/尺寸。检查异常、坐标/尺寸/状态中的非有限数、每帧主画布与离屏画布的 save/restore 平衡。
- **确定性**：固定种子分层随机抽取 120 个时刻，在两个尺寸下分别顺序、倒序、每个时刻全新 VM 首帧渲染。比较数字保留 3 位小数的完整指令序列与属性写入，包含 Path2D、渐变、离屏内容和 ImageData 字节哈希；不使用随机资源编号。禁止读取未播种随机数及当前时钟。
- **文字重叠**：1080p 每 0.25 秒拦截 `fillText`。ASCII 约 0.6em、CJK/其他非 ASCII 约 1em，加字间距；高约 1.2em。按对齐、基线和当前变换生成屏幕轴对齐包围盒，忽略 globalAlpha 小于 0.15 的字，交集达到较小框的 15% 时命中。不同调用即使文字相同也检查。
- **聚合与边界**：相邻采样点同一文字对合并为连续区间，按跨度排序输出前 40 条重叠；全部越界文字单列。区间起止是实际命中的采样时间，不是精确的动画起止时间。
- **字幕保留区**：屏幕内 y > 890 的区域出现任何非字幕文字都报告。通过实际 `drawCaption` 钩子识别字幕，不按文字内容或位置猜测；没有字幕正在显示时也保留此规则。按文字与连续时间聚合，列出全部区间。

假画布会记录裁切与合成指令，但不计算真实像素遮挡。估算字体、旋转外接框、转场交叉淡化、裁切和后绘底板都可能造成误报；0.25 秒采样也可能漏掉短暂问题。自动检查不代替真实浏览器关键帧复核，完整限制见 `checks.report.txt` 末尾。

## 抽关键帧（沙箱外）

在可启动 Chrome/Chromium/Edge 的终端执行；本检查环境无法启动 Chromium。安装渲染工具依赖：

```sh
npm --prefix ../../tools/render install
```

工具会尝试查找系统浏览器；未找到时，将 `CHROME_PATH` 环境变量设为实际可执行文件，或传入 `--chrome`。输出目录应使用新的空目录。

抽取每句字幕中点（84 个时间点）：

```sh
node ../../tools/render/render_local.mjs film.html \
  --frames captions --out-dir preview-v2-captions --scale 1
```

按报告里的问题时间定点抽帧，例：

```sh
node ../../tools/render/render_local.mjs film.html \
  --frames 0,24.5,120,180,240,337.5 --out-dir preview-v2-picked --scale 1
```

`--scale 1` 为 1080p，`--scale 2` 为 4K；抽帧时间须在 `[0,338)` 内，不包含终点。输出为 JPEG，通过 canvas 导出，不依赖 ffmpeg。可安装 Python Pillow 后拼图审阅：

```sh
python3 ../../tools/preview/sheet.py preview-v2-captions preview-v2-sheet 6
```

如需为音频生成当前 v2 时间线，可在同一沙箱外环境执行：

```sh
node ../../tools/render/render_local.mjs film.html timeline.json
```

此检查任务不重建字体、音频、时间线或画面；以上命令供后续制作与验收使用。
