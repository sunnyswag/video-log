/* =====================================================================
 * 本地导出：Chrome（GPU 绘制）多页面并行截帧 + 一路 NVENC（显卡）编码
 *
 * 用法（在 film.html 所在目录执行）：
 *   node render_local.mjs film.html out.mp4 [选项]     导出视频
 *   node render_local.mjs film.html timeline.json       只导出时间线（给 audio_hud.py 合成配乐用）
 *
 * 选项：
 *   --from 0           起始秒（默认 0）
 *   --to   <秒>        结束秒（默认整片时长）
 *   --fps  30          帧率
 *   --scale 2          分辨率倍数：1 = 1080p，2 = 4K
 *   --workers N        并行截帧的页面数（默认 CPU 核数 - 2，最多 8）
 *   --audio audio.wav  同时混入音轨
 *   --encoder auto     auto | nvenc | x264（auto：有 NVIDIA 显卡就用 NVENC，否则 x264）
 *   --chrome <路径>    指定 Chrome / Edge 可执行文件
 *
 * 依赖：Node 18+、Chrome 或 Edge、ffmpeg（要用 NVENC 需带 h264_nvenc 的版本，
 *       如 https://www.gyan.dev/ffmpeg/builds/ 的 full 版），以及在本目录执行一次：
 *       npm i puppeteer-core
 *
 * 页面约定：window.__ready / __seek(t) / __pause() / __duration，画面在 <canvas id="c">。
 * ===================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const [pageFile, outFile] = pos;
if (!pageFile || !outFile) { console.log('用法：node render_local.mjs film.html out.mp4 [--scale 2] [--audio audio.wav]'); process.exit(1); }

const fps = +opt('fps', 30), scale = +opt('scale', 2);
const workers = Math.max(1, Math.min(8, +opt('workers', Math.max(1, os.cpus().length - 2))));
const audio = opt('audio', null);
const url = pathToFileURL(path.resolve(pageFile)).href;

/* ---------- 找浏览器 ---------- */
function findChrome() {
  const c = opt('chrome', null); if (c) return c;
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
const encoder = pickEncoder();

/* ---------- 浏览器（优先 puppeteer-core，没有就用 playwright） ---------- */
const gpuArgs = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas', '--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars', '--font-render-hinting=none'];
if (process.platform === 'win32') gpuArgs.push('--use-angle=d3d11');
if (process.platform === 'linux' && process.getuid && process.getuid() === 0) gpuArgs.push('--no-sandbox');
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
if (outFile.endsWith('.json')) { // 只导出时间线（字幕 / 音效点 / 场景），给 audio_hud.py 用
  const tl = await first.evaluate(() => ({ duration: FILM.duration, scenes: FILM.scenes, captions: FILM.captions, cues: FILM.cues, chapters: FILM.chapters }));
  fs.writeFileSync(outFile, JSON.stringify(tl, null, 1)); await browser.close();
  console.log('时间线已导出 →', outFile, '时长', tl.duration.toFixed(2), '秒'); process.exit(0);
}
const from = +opt('from', 0), to = +opt('to', info.duration);
const N = Math.round((to - from) * fps);
console.log(`画面 ${info.w}×${info.h} · ${N} 帧 · ${workers} 个截帧页面 · 编码 ${encoder} · 浏览器 GPU：${info.gpu}`);

/* ---------- 编码进程 ---------- */
const vEnc = encoder === 'nvenc'
  ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-maxrate', '60M', '-bufsize', '120M', '-profile:v', 'high']
  : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17'];
const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
if (audio) ffArgs.push('-ss', String(from), '-i', audio);
ffArgs.push(...vEnc, '-pix_fmt', 'yuv420p', '-r', String(fps));
if (audio) ffArgs.push('-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-shortest');
ffArgs.push('-movflags', '+faststart', outFile);
const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
let ffDead = false; ff.on('exit', c => { if (c) { ffDead = true; console.error('ffmpeg 退出码', c); } });

/* ---------- 并行截帧，按顺序写入 ---------- */
const pages = [first];
for (let k = 1; k < workers; k++) pages.push(await openPage());
const done = new Map(); let next = 0; const AHEAD = workers * 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function grab(p, t) {
  const b64 = await p.evaluate(tt => { window.__seek(tt); return document.getElementById('c').toDataURL('image/jpeg', 0.93).slice(23); }, t);
  return Buffer.from(b64, 'base64');
}
async function worker(k) {
  for (let i = k; i < N; i += workers) {
    while (i - next > AHEAD) await sleep(3);
    done.set(i, await grab(pages[k], from + i / fps));
  }
}
const t0 = Date.now();
async function writer() {
  while (next < N) {
    if (ffDead) process.exit(2);
    const buf = done.get(next);
    if (!buf) { await sleep(2); continue; }
    done.delete(next);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    next++;
    if (next % 300 === 0 || next === N) {
      const el = (Date.now() - t0) / 1000, sp = next / el;
      console.log(`${(next / N * 100).toFixed(1)}%  ${next}/${N}  ${sp.toFixed(1)} 帧/秒  剩余约 ${((N - next) / sp / 60).toFixed(1)} 分钟`);
    }
  }
  ff.stdin.end();
}
await Promise.all([writer(), ...pages.map((_, k) => worker(k))]);
await new Promise(r => ff.on('close', r));
await browser.close();
console.log(`完成 → ${outFile}  用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
