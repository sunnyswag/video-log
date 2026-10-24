/* =====================================================================
 * 本地导出：Chrome 多页面并行截帧 + FFmpeg（NVENC / x264）编码
 *
 * 用法（在 film.html 所在目录执行）：
 *   node ../../tools/render/render_local.mjs film.html out.mp4 [选项]     导出视频
 *   node ../../tools/render/render_local.mjs film.html timeline.json       只导出时间线（给 audio_v2.py 合成配乐用）
 *   node ../../tools/render/render_local.mjs film.html --frames captions --out-dir frames
 *
 * 选项：
 *   --from 0           起始秒（默认 0）
 *   --to   <秒>        结束秒（默认整片时长）
 *   --fps  30          帧率
 *   --scale 2          分辨率倍数：1 = 1080p，2 = 4K
 *   --workers N        并行截帧的页面数（默认 CPU 核数 - 2，最多 8）
 *   --audio audio.wav  同时混入音轨
 *   --encoder auto     auto | nvenc | x264（auto：有 NVIDIA 显卡就用 NVENC，否则 x264）
 *   --chrome <路径>    指定 Chrome / Edge 可执行文件（默认读取 CHROME_PATH）
 *   --frames <列表>    抽 JPEG：逗号分隔的秒数，或 captions（每句字幕中点）；不需要 ffmpeg
 *   --out-dir <目录>   抽帧输出目录，文件名如 f_0061.50.jpg
 *   --no-sandbox      禁用 Chrome 沙箱（仅用于受限环境中可信的本地页面）
 *
 * 依赖：Node 18+、Chrome 或 Edge、ffmpeg（要用 NVENC 需带 h264_nvenc 的版本，
 *       如 https://www.gyan.dev/ffmpeg/builds/ 的 full 版），以及从仓库根目录执行一次：
 *       npm --prefix tools/render install
 *
 * 页面约定：window.__ready / __seek(t) / __pause() / __duration，画面在 <canvas id="c">。
 * ===================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { captionTimes, frameName } from './ci/frames.mjs';

const argv = process.argv.slice(2);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--no-sandbox'));
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const [pageFile, outFile] = pos;
const frames = opt('frames', null), outDir = opt('out-dir', null);
if (!pageFile || (frames !== null ? !frames || !outDir : !outFile)) { console.log('用法：node render_local.mjs film.html out.mp4 [选项]，或 film.html --frames <秒列表|captions> --out-dir <目录>'); process.exit(1); }

const fps = +opt('fps', 30), scale = +opt('scale', 2);
const workers = Math.max(1, Math.min(8, +opt('workers', Math.max(1, os.cpus().length - 2))));
if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(scale) || scale <= 0 || !Number.isInteger(workers)) throw new Error('fps / scale 必须为正数，workers 必须为整数');
const audio = opt('audio', null);
const url = pathToFileURL(path.resolve(pageFile)).href;

/* ---------- 找浏览器 ---------- */
function findChrome() {
  const c = opt('chrome', process.env.CHROME_PATH); if (c) return c;
  const list = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium'];
  return list.find(p => p && fs.existsSync(p));
}

/* ---------- 选编码器 ---------- */
function pickEncoder() {
  const want = opt('encoder', 'auto');
  if (want === 'x264') return 'x264';
  const enc = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (enc.error) { console.error('找不到 ffmpeg，请先安装并加入 PATH'); process.exit(1); }
  if (!/h264_nvenc/.test(enc.stdout)) { if (want === 'nvenc') { console.error('这个 ffmpeg 不带 h264_nvenc'); process.exit(1); } return 'x264'; }
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { encoding: 'utf8' });
  if (probe.status === 0) return 'nvenc';
  if (want === 'nvenc') { console.error('NVENC 初始化失败：\n' + probe.stderr); process.exit(1); }
  console.log('NVENC 不可用，改用 x264（CPU）'); return 'x264';
}
const encoder = frames !== null || outFile?.endsWith('.json') ? null : pickEncoder();

/* ---------- 浏览器（优先 puppeteer-core，没有就用 playwright） ---------- */
const gpuArgs = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas', '--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars', '--font-render-hinting=none'];
if (process.platform === 'win32') gpuArgs.push('--use-angle=d3d11');
if (argv.includes('--no-sandbox') || (process.platform === 'linux' && process.getuid && process.getuid() === 0)) gpuArgs.push('--no-sandbox');
async function launch() {
  const exe = findChrome();
  try {
    const pp = (await import('puppeteer-core')).default;
    if (!exe) throw new Error('没找到 Chrome/Edge，用 --chrome 指定路径');
    const b = await pp.launch({ executablePath: exe, headless: true, args: gpuArgs, protocolTimeout: 0 });
    return { b, newPage: async () => { const p = await b.newPage(); await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: scale }); return p; } };
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ executablePath: exe || undefined, args: gpuArgs });
    return { b, newPage: () => b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale }) };
  }
}

const { b: browser, newPage } = await launch();
let ff;
try {
  async function openPage() {
    const p = await newPage();
    p.on('pageerror', e => console.error('[page]', e.message));
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__ready === true, { timeout: 60000 });
    await p.evaluate(() => { window.__pause(); for (const id of ['ui', 'hint']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } });
    return p;
  }
  const first = await openPage();
  const info = await first.evaluate(() => {
    let gpu = 'unknown';
    try { const gl = document.createElement('canvas').getContext('webgl'); const d = gl.getExtension('WEBGL_debug_renderer_info'); gpu = gl.getParameter(d.UNMASKED_RENDERER_WEBGL); } catch (e) {}
    return { duration: window.__duration, gpu, w: document.getElementById('c').width, h: document.getElementById('c').height };
  });
  if (frames === null && outFile.endsWith('.json')) { // 只导出时间线（字幕 / 音效点 / 场景），给 audio_v2.py 用
    const tl = await first.evaluate(() => ({ duration: FILM.duration, scenes: FILM.scenes, captions: FILM.captions, cues: FILM.cues, chapters: FILM.chapters, ...(FILM.chapterInfo ? { chapterInfo: FILM.chapterInfo } : {}) }));
    fs.writeFileSync(outFile, JSON.stringify(tl, null, 1)); await browser.close();
    console.log('时间线已导出 →', outFile, '时长', tl.duration.toFixed(2), '秒'); process.exit(0);
  }
  async function grab(p, t) {
    const b64 = await p.evaluate(tt => { window.__seek(tt); return document.getElementById('c').toDataURL('image/jpeg', 0.93).slice(23); }, t);
    return Buffer.from(b64, 'base64');
  }
  if (frames !== null) {
    const times = frames === 'captions' ? captionTimes(await first.evaluate(() => FILM.captions), info.duration)
      : frames.split(',').map(s => s.trim() ? Number(s) : NaN);
    if (!times.length || times.some(t => !Number.isFinite(t) || t < 0 || t >= info.duration)) throw new Error('抽帧时间必须位于 [0, 视频时长) 内，且列表不能为空');
    // 两位小数可能重名；相同时间去重，不同时间保留额外小数位。
    const names = new Map();
    fs.mkdirSync(outDir, { recursive: true });
    for (const t of [...new Set(times)].sort((a, b) => a - b)) {
      const name = frameName(t, names);
      fs.writeFileSync(path.join(outDir, name), await grab(first, t));
    }
    await browser.close(); console.log(`已抽取 ${names.size} 帧 → ${outDir}`); process.exit(0);
  }
  const from = +opt('from', 0), to = +opt('to', info.duration);
  const N = Math.round((to - from) * fps);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || N < 1) throw new Error('渲染区间必须至少包含一帧');
  // 整帧起点采用全局帧号，保证分段与整段传给 __seek 的浮点值完全相同。
  const startFrame = Math.round(from * fps), aligned = Math.abs(from * fps - startFrame) < 1e-7;
  console.log(`画面 ${info.w}×${info.h} · ${N} 帧 · ${workers} 个截帧页面 · 编码 ${encoder} · 浏览器 GPU：${info.gpu}`);

  /* ---------- 编码进程 ---------- */
  const vEnc = encoder === 'nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-maxrate', '60M', '-bufsize', '120M', '-profile:v', 'high']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17'];
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  if (audio) ffArgs.push('-ss', String(from), '-i', audio);
  // JPEG 帧是全范围色彩；显式转成标准范围 yuv420p（新版 ffmpeg 否则会输出 yuvj420p）
  ffArgs.push('-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', ...vEnc, '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(fps));
  if (audio) ffArgs.push('-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-shortest');
  ffArgs.push('-movflags', '+faststart', outFile);
  ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  let ffError;
  ff.on('error', e => { ffError = e; });
  ff.stdin.on('error', e => { ffError = e; });
  // 提前订阅 close，避免短片在截帧完成前退出导致漏掉事件。
  const ffClosed = new Promise(resolve => ff.on('close', (code, signal) => {
    if (code !== 0) ffError ||= new Error(`ffmpeg 失败：${code ?? signal}`);
    resolve();
  }));

  /* ---------- 并行截帧，按顺序写入 ---------- */
  const pages = [first];
  for (let k = 1; k < workers; k++) pages.push(await openPage());
  const done = new Map(); let next = 0; const AHEAD = workers * 6;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let stopped = false;
  async function worker(k) {
    for (let i = k; i < N; i += workers) {
      while (!stopped && i - next > AHEAD) { if (ffError) throw ffError; await sleep(3); }
      if (stopped) return;
      done.set(i, await grab(pages[k], aligned ? (startFrame + i) / fps : from + i / fps));
    }
  }
  const t0 = Date.now();
  async function writer() {
    while (next < N) {
      if (stopped) return;
      if (ffError) throw ffError;
      const buf = done.get(next);
      if (!buf) { await sleep(2); continue; }
      done.delete(next);
      if (!ff.stdin.write(buf)) await new Promise((resolve, reject) => {
        const clean = () => { ff.stdin.off('drain', drain); ff.stdin.off('error', error); ff.stdin.off('close', close); };
        const drain = () => { clean(); resolve(); }, error = e => { clean(); reject(e); };
        const close = () => error(new Error('ffmpeg 输入管道提前关闭'));
        ff.stdin.once('drain', drain); ff.stdin.once('error', error); ff.stdin.once('close', close);
      });
      next++;
      if (next % 300 === 0 || next === N) {
        const el = (Date.now() - t0) / 1000, sp = next / el;
        console.log(`${(next / N * 100).toFixed(1)}%  ${next}/${N}  ${sp.toFixed(1)} 帧/秒  剩余约 ${((N - next) / sp / 60).toFixed(1)} 分钟`);
      }
    }
    ff.stdin.end();
  }
  try { await Promise.all([writer(), ...pages.map((_, k) => worker(k))]); }
  finally { stopped = true; }
  await ffClosed;
  if (ffError) throw ffError;
  console.log(`完成 → ${outFile}  用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
} finally {
  if (ff && ff.exitCode === null) ff.kill();
  await browser.close();
}
