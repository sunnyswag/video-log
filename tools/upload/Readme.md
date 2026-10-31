# 统一投稿工具

从仓库根目录运行，默认将同一期发布至 **Bilibili 和微信视频号**，依次执行并分别报告结果：

```powershell
# 一条命令发布两个平台（-Yes 跳过交互确认；必须明确指定项目）
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Project 2026-10-16-32bit-ms-timer -Yes

# 只读预览实际参数，不启动上传工具或浏览器
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Project 2026-10-16-32bit-ms-timer -DryRun

# 只发一个平台；视频号使用 sph，channels 也是别名
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Project 2026-10-16-32bit-ms-timer -Platforms sph -Yes
```

省略 `-Yes` 时显示摘要并要求输入 `YES`；双击 `upload_video.bat` 后先选择平台：默认勾选 Bilibili 和微信视频号，↑/↓ 移动、空格取消或恢复勾选、Enter 确认，Esc/Q 退出；至少保留一个平台。随后用方向键选择项目。只会检查和上传已勾选的平台。显式指定 `-Platforms` 或使用 `-Yes` 的命令行调用不弹出平台菜单。BAT 支持透传全部参数。无人值守调用必须同时给 `-Project` 和 `-Yes`；不会自动上传最近修改的项目。`-Project` 接受相对仓库根目录的项目目录、投稿 JSON 路径或绝对路径。目录中有多个 JSON 时须指定具体 JSON。

确认上传后，入口先在线检查所有已选平台的登录状态。未登录或会话过期时，交互窗口会自动进入对应的登录流程：B 站在 biliup 菜单中选择“扫码登录”，视频号在专用浏览器中用微信扫码。登录成功后再次验证，全部通过才继续本次上传，无需重新选择项目。取消、登录失败或复查仍过期时，两个平台都不会开始上传。网络、浏览器或网页适配错误会直接报错，不当作登录过期处理。

`-Yes` 只跳过上传确认，有交互终端时仍可按需登录；输入被重定向或使用 PowerShell `-NonInteractive` 时不会启动登录，缺少有效会话会停止并提示手动登录。自动登录只发生在上传前，不会在上传失败后重新登录并重投。

## 目录拆分

```text
tools/upload/
├── upload.ps1             # 统一调度、参数、预览、结果汇总
├── upload_video.bat           # 双击 / 命令行入口
├── video_info_template.json
├── common/                # 项目解析、文件校验、控制台、进程调用
├── bilibili/
│   ├── adapter.ps1         # biliup 参数映射与在线登录检查
│   ├── biliup.exe          # 本地工具，不提交 Git
│   ├── cookies.json        # 本地登录凭据，不提交 Git
│   └── data/ 等            # biliup 的本地产物
├── sph/
│   ├── adapter.ps1         # 视频号参数、账号、封面适配
│   ├── login.bat           # 双击扫码登录，固定使用本目录的 state
│   ├── install.ps1         # 安装固定版本并校验 SHA256
│   ├── sph.exe             # 本地工具，不提交 Git
│   └── state/              # 浏览器登录态、轨迹、诊断，不提交 Git
└── tests/                 # 无网络、无真实发布的集成验证
```

每期目录外层继续放 `topic.mp4`、`topic.json`、可选的 `topic.srt` 和封面。源码、制作资料和中间文件仍放 `work/`。上传结果保存在该期 `work/upload/`，不污染外层，也不提交 Git。

## 首次准备与登录

原 `tools/biliup-upload/` 的程序、Cookie、数据库和日志迁入 `tools/upload/bilibili/`。B 站登录态可继续使用；失效时上传入口会引导重新登录。换电脑时复制本地程序及大文件，或从上游重新安装。通常直接运行 `upload_video.bat` 即可，以下命令用于单独登录。

```powershell
# 仅在 sph.exe 缺失时安装；固定 v2.1.3，支持 Windows x64 / ARM64
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\sph\install.ps1

# 视频号首次必须本人扫码；会话统一写入 sph/state/
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Login -Platforms sph

# B 站重新扫码（已有效登录可跳过）
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Login -Platforms bilibili
```

视频号依赖 Chrome / Edge，sph 在找不到系统浏览器时可能下载 Chromium。适配层为子进程设置指向 `tools/upload/sph/state` 的绝对 `SPH_CONFIG_DIR`；手动运行原生 sph 时也应设置同一变量，以共用登录会话。多账号用 `-Account creator` 登录，并在投稿时传同名参数，或设置 JSON 的 `sph.account`。

也可直接双击 `tools/upload/sph/login.bat` 登录；它会设置 `SPH_CONFIG_DIR` 为该目录下 `state` 的绝对路径，和统一上传入口共用会话。在 `sph` 目录的 CMD 中运行 `login.bat --account creator` 可指定账号。

若直接运行 `sph.exe login` 报 `LOGIN_BROWSER_FAILED`，并提示在取得 websocket 地址前退出，请先改用上述登录入口。Windows CMD 没有 `HOME` 环境变量时，上游会使用相对目录 `.sph`，而本机 Chrome 对相对配置目录的启动测试失败。手动调用时应明确设置绝对路径，例如在 `tools/upload/sph` 目录执行 `set "SPH_CONFIG_DIR=%CD%\state"` 后再执行 `sph.exe login`。

上游：[biliup](https://github.com/biliup/biliup)、[sph v2.1.3](https://github.com/LcpMarvel/sph/releases/tag/v2.1.3)。sph 发布成功依赖当前视频号网页、账号状态和平台校验。

## 投稿 JSON

从 [video_info_template.json](video_info_template.json) 复制模板，保存为该期成片同名的 JSON，再填写内容。模板中的 `title-short` 按下面的规则填写。

`title` 为完整标题；可选的顶层 `title-short` 为通用短标题，与平台无关；`desc` 为简介；`tag` 为英文逗号分隔的话题；`cover` 为外层封面文件名。`tid`、`copyright`（默认 1）、`source` 是 B 站字段，只有选择 B 站时校验。转载必须填写来源。`videos: []` 默认采用同名 MP4；B 站多 P 可列出多个外层文件名。

### 短标题规则

原 `sph.title` 已迁移为顶层 `title-short`。该字段若存在，必须是非空字符串。B 站继续使用完整 `title`；视频号使用 `title-short`，并按视频号要求限制为 16 个字符。未填写时，视频号沿用完整标题，超过 16 字则截取前 16 字并提示；短标题与完整标题不同时，完整标题会保留在视频号简介开头。

视频号短标题不接受中英文逗号（页面提示可用空格代替）。适配层在本地预检时把传给视频号的 `，` / `,` 转为空格并显示提示，再检查是否为空及长度限制；只含逗号的标题会被拒绝。JSON 中通用的 `title-short`、B 站标题和简介原文保持不变。例如 `接手任务队列，改成网络线程池` 在视频号使用 `接手任务队列 改成网络线程池`。这可避免上传文件后才因标题校验导致“发表按钮一直不可用”。

| JSON 中的 `title-short` | 传给视频号的短标题 |
| --- | --- |
| `接手任务队列，改成网络线程池` | `接手任务队列 改成网络线程池` |
| `任务队列,网络线程池` | `任务队列 网络线程池` |

`upload_video.bat` 和 `upload.ps1` 都经过这层转换；直接调用原生 `sph.exe publish --title ...` 时，须自行使用平台接受的标题。当前仅自动处理逗号，其他特殊符号仍以平台校验为准。上传前可用 `-Check` 查看转换提示，或用 `-DryRun` 查看实际上传参数。

### 配置示例与视频号字段

视频号设置放在可选的 `sph` 对象里：

```json
{
  "title": "完整的视频标题可以继续供 B 站使用",
  "title-short": "通用短标题",
  "tid": 231,
  "tag": "计算机技术,科普",
  "desc": "两个平台共用的简介",
  "cover": "cover.jpg",
  "copyright": 1,
  "videos": [],
  "sph": {
    "account": "default"
  }
}
```

| sph 字段 | 默认与用途 |
| --- | --- |
| `desc` / `tag` | 覆盖视频号简介 / 话题。简介加话题超过 1000 字时预检失败，不截断内容 |
| `video` | 指定视频号的单个 MP4。B 站多 P 必须明确指定此字段或先生成合并成片，不会只取第一 P 或自动批量发表 |
| `cover` / `cover_landscape` | 分别指定个人主页竖版 / 分享卡片横版封面。均未设置时，公共封面始终用于竖版；横图或方图还会用于横版。显式填写任一字段后，仅设置所指定的封面；设 `cover: ""` 可停用视频号封面继承 |
| `account` | 默认 `default`；命令行 `-Account` 优先 |
| `collection` | 已有合集的完整名称 |
| `at` | 仅视频号定时，格式 `yyyy-MM-dd HH:mm`，使用本机时区；B 站仍立即投稿 |
| `ai_mark` | `true` 时传递含 AI 生成内容标记；默认不设置 |

文件路径只允许项目外层的文件名，不接受 `../`、绝对路径或 `work/` 内的素材。公共封面未填写时沿用 `<JSON同名>.jpg`、`<JSON同名>.png`、`封面.jpg` 的查找顺序。SRT 仍需在 B 站创作中心手动上传。

视频号两处封面独立保存。公共 `cover` 为横图时，会同时传入 `--cover` 与 `--cover-landscape`，避免个人主页仍使用自动截帧。竖版由平台按比例裁剪，若横图文字被裁掉，可用 `sph.cover` 单独指定适合竖版的图片，同时用 `sph.cover_landscape` 保留横版原图。此规则只影响后续投稿；已发布稿件需在平台编辑封面，不应为更换封面重新投稿。

## 检查、失败和重试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -List
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\upload.ps1 -Project 2026-10-16-32bit-ms-timer -Check -Platforms bilibili
```

`-Root` 可覆盖扫描根目录。`-List`、`-Check`、`-DryRun` 均不要求程序和登录资料；`-Check` 失败返回非零。兼容层的 `-DryRun` 是纯本地预览，与原生 `sph --dry-run`（会真正上传文件和填写网页，只是不提交）不同。

实际上传前先校验所有选中平台的本地输入、程序和在线登录状态。B 站通过 `biliup list --max-pages 1` 验证并按需刷新凭据；视频号通过 `sph list --limit 1 --json` 验证指定账号的会话。这些查询不上传视频，返回的账号与稿件列表不写入终端或结果文件。登录预检失败会停止整个任务，此时尚未创建投稿结果记录。

进入上传阶段后，某个平台失败仍尝试另一个；任一失败总退出码为 1，全部工具成功为 0。记录中的 `submitted` 只表示工具返回成功，不代表已审核通过；中断留下的 `running` 表示结果未知。

**不会自动重试发布，也不会自动回滚。** 一个平台成功后，应先到失败平台确认是否已收到稿件，再用 `-Platforms sph` 或 `-Platforms bilibili` 单独补传；重复执行双平台命令会产生重复投稿。记录包含平台、状态、退出码和错误详情，不写 Cookie 或浏览器凭据。

### 发表按钮一直不可用

`[TIMEOUT/submit] 发表按钮一直不可用` 表示 sph 在等待按钮启用时超时，这条错误本身不指出具体校验失败原因。查看 `sph/state/history.jsonl` 中对应时间记录的 `scene_dir`，打开该目录的 `screenshot.png`，先找短标题等输入框旁的红色提示。

2026-10-31 的任务队列这期，页面在短标题下提示“标题包含特殊字符”，并说明逗号可用空格代替。当前上传入口会按 [短标题规则](#短标题规则) 自动处理逗号；若仍失败，按本次现场提示排查，不能把所有按钮禁用都当成同一个原因。

修正后先运行 `-DryRun` 核对实际标题，再补传失败平台。使用 BAT 时取消勾选已成功的平台；例如 B 站已成功、视频号失败，就只勾选视频号。`work/upload/` 中的结果记录分别列出各平台状态。

## 本地验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\tests\smoke.ps1
```

测试使用临时项目和假的上传程序，验证参数、路径、双平台调度、首次/过期登录、登录复查、取消/失败阻止投稿、非交互模式和只读模式，不访问网络、不上传真实视频。

## 视频号封面兼容修复与故障诊断

2026-10-29 的真实失败记录显示：部分账号点击横版封面“编辑”后会直接打开“编辑分享卡片”，而上游 sph 2.1.3 仍继续找“直接编辑”按钮，返回 `SCHEMA_CHANGED/cover`（退出码 11）。本地补丁同时兼容直接打开和旧版中间菜单两条路径；封面仍必须上传并确认成功，未移除封面、声明或发表前检查。

当前兼容层通过 `--json` 读取 sph 的返回值。结果文件保存 `error_code`、`stage` 和具体 `message`，终端摘要也显示这些信息。只有 sph 明确返回 `submitted: true` 且不是 dry-run 才记为成功；退出码为 0 但没有有效发表结果仍按失败处理，不自动重传。

封面补丁在 `sph/patches/v2.1.3-direct-cover.patch`，含新旧封面页面的本地浏览器回归测试；源码来自 [LcpMarvel/sph v2.1.3](https://github.com/LcpMarvel/sph/tree/v2.1.3)（MIT）。本地修正版版本号为 `2.1.3+video-log.3`，程序依旧不提交 Git。封面上游修复见 [PR #3](https://github.com/LcpMarvel/sph/pull/3)。

登录补丁在 `sph/patches/v2.1.3-login-detection.patch`，在封面补丁之后应用。旧版依赖新增 Cookie 名称识别扫码成功，已有会话重登或快速登录可能一直等待；浏览器关闭后的 CDP 请求也可能挂起。修正版连续两次确认可见后台导航和页面标识、且没有可见扫码界面后才判定成功，同时限制单次检测、总等待和浏览器关闭的时间。浏览器关闭或连续无响应会返回失败，不会继续投稿。测试覆盖既有登录态、扫码后页面变化、短暂页面切换、挂起请求、关闭超时及本地浏览器页面。

上传等待补丁在 `sph/patches/v2.1.3-upload-wait.patch`，在登录补丁之后应用。旧版把封面预览容器出现当作上传完成，大视频尚在传输时就进入封面阶段，继而触发固定 120 秒超时。2026-10-31 的 SIP 这期现场显示，超时时实际只上传到 62%。修正版在“步骤 1/5”等待预览可见、上传遮罩与封面生成提示消失，并连续确认两次后才填写信息、设置封面。等待受原生 `sph publish --timeout` 限制（默认整个命令 10 分钟），不以放行未完成的上传来规避超时，也不自动重传。离线测试覆盖预览先出现、上传延迟完成及持续停滞，后者必须在上传阶段失败且不能填写或发表。

若需重建，先准备 Rust/Cargo 与 Git（Windows GNU 目标还可能需要完整的 MinGW C 编译器以构建依赖），然后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\upload\sph\build-patched.ps1 -Force -Test -Chrome 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

脚本校验固定源码压缩包、依次应用封面、登录和上传等待补丁、按锁定依赖构建，并将旧程序备份到 `sph/state/bin/`。本地浏览器测试只打开仿真页面，不使用视频号账号。`install.ps1 -Force` 会恢复上游未打补丁的程序；保留这些修复请使用 `build-patched.ps1`。
