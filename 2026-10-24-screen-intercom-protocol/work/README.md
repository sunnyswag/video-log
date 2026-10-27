# Kotlin 实现 SIP 通信协议 · v3

29 幕，437 秒，30 fps（13,110 个视频帧）；逻辑画布 1920×1080。视频稿 v3 按“协议 → 每条消息为什么存在 → 两台状态机 → 代码架构 → 50 ms 竞态”重写，画风沿用 v2。云端按时间段并行渲染，`FILM.render(canvas, t)` 的输出只依赖时间、画布尺寸和固定资源，允许任意跳帧与冷启动。

章节编号：0 开场、1 片名、2–7 六章、8 总结、9 系列片尾。`audio.py` 与 `checks.cjs` 都按这个编号工作。

## 文件组成

| 文件 | 职责 |
| --- | --- |
| `script.js` | 29 幕的时长、章节和 105 条字幕；字幕原文、幕数和总时长的唯一数据源 |
| `kit.js` | 主题、字体族、图元、镜头、纸面纹理和后期（v2 原样复用，仅胶囊会话标签字号加大） |
| `film.js` | v3 场景编排与新增图元（码表卡、信封、三泳道时序图、状态机两排与结束墙、状态盒、拦截器表、会话管理器、传送带、规则卡）；最后调用 `film.finish()` 导出 `window.FILM` |
| `film.html` | 预览页面、字体加载、播放与跳转控制 |
| `audio.py` | 按时间线章节生成 90 BPM 木质配乐与音效；第六章从 `RESOLVE_SCENE`（s25）起换明亮和声 |
| `fonts.css` | 内嵌 WOFF 字体子集，供预览与正式渲染共用 |
| `render.json` | 页面、音频脚本、输出名与帧率配置 |
| `checks.cjs` | 无浏览器的自动检查器，期望时长/幕数/字幕数从 `script.js` 读取 |
| `checks.report.txt` | 最近一次自动检查的完整输出 |

引擎位于 `../../tools/film-kit/engine.js`，API 见其文件头与 [FilmKit 说明](../../tools/film-kit/README.md)。页面依次加载 **engine.js → script.js → kit.js → film.js**，四个普通 `<script>` 共享全局词法作用域。

## 预览

```sh
python3 -m http.server 8000 --directory ../..
```

浏览器访问 `http://localhost:8000/2026-10-24-screen-intercom-protocol/work/film.html`。空格播放/暂停，左右方向键跳转 5 秒。预览页面不播放配乐。

## 生成字体

```sh
cat kit.js script.js film.js > /tmp/all.js
python3 ../../tools/fonts/build_fonts.py /tmp/all.js fonts.css
```

## 自动检查

```sh
node checks.cjs > checks.report.txt 2>&1
```

规则：加载与时间线（时长、幕数、字幕条数、场景顺序与章号都和 `SCRIPT` 比对）、cue 白名单、0–9 章节顺序、数值健康、乱序/冷启动确定性、文字重叠与越界、字幕保留区（y > 890）、正文字号（< 23.5 px 报告）、顶部保留区（y < 110）。假画布不计算真实遮挡，转场色带、交叉淡化、镜头推拉、弹出动画都会产生预期内的告警，完整说明见报告末尾。

## 抽关键帧（需要 Chromium）

```sh
node ../../tools/render/render_local.mjs film.html --frames captions --out-dir preview --scale 1
node ../../tools/render/render_local.mjs film.html timeline.json
```
