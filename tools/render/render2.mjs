/* 渲染工具（Playwright Chromium + ffmpeg）
 *   node render2.mjs info   film.html out.json            导出时间线（字幕/音效点/场景）
 *   node render2.mjs frames film.html outDir t1,t2,... [scale]   抽帧（scale=1 → 1080p，2 → 4K）
 *   node render2.mjs video  film.html out.mp4 from to [fps] [scale]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, page_, out, a3, a4, a5, a6] = process.argv.slice(2);
const url = pathToFileURL(path.resolve(page_)).href;
const scale = parseFloat((mode === 'frames' ? a4 : a6) || '1');

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars', '--font-render-hinting=none', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate(() => { window.__pause(); for (const id of ['ui', 'hint']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } });

async function grab(t, q = 0.93) {
  const b64 = await page.evaluate(([tt, qq]) => { window.__seek(tt); return document.getElementById('c').toDataURL('image/jpeg', qq).slice(23); }, [t, q]);
  return Buffer.from(b64, 'base64');
}

if (mode === 'info') {
  const info = await page.evaluate(() => ({ duration: FILM.duration, scenes: FILM.scenes, captions: FILM.captions, cues: FILM.cues, chapters: FILM.chapters }));
  fs.writeFileSync(out, JSON.stringify(info, null, 1));
  console.log('duration', info.duration.toFixed(2));
} else if (mode === 'frames') {
  fs.mkdirSync(out, { recursive: true });
  for (const ts of a3.split(',')) {
    const t = parseFloat(ts);
    fs.writeFileSync(path.join(out, `f_${t.toFixed(2).padStart(7, '0')}.jpg`), await grab(t, .9));
  }
} else if (mode === 'video') {
  const from = parseFloat(a3), to = parseFloat(a4), fps = parseFloat(a5 || '30');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', scale > 1.5 ? '16' : '18', '-preset', scale > 1.5 ? 'veryfast' : 'fast',
    '-x264-params', 'threads=2', '-r', String(fps), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.round((to - from) * fps);
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const t = from + i / fps;
    const buf = await grab(t);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`[${path.basename(out)}] ${i}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log('done', out, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await browser.close();
