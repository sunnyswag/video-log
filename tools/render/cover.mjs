/* =====================================================================
 * 导出封面：打开 film.html，等字体加载完，用 FILM.drawCover 画到 1920×1080 画布，存成 JPEG
 *
 * 用法（在仓库根目录）：
 *   node tools/render/cover.mjs <work/film.html> <cover.jpg> [--chrome <路径>]
 * Chrome 路径也可用环境变量 CHROME_PATH；截图用 canvas.toDataURL（本机 headless 下 page.screenshot 会超时）。
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const [page, out] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!page || !out) { console.log('用法：node tools/render/cover.mjs work/film.html cover.jpg'); process.exit(1); }
const exe = opt('chrome', process.env.CHROME_PATH);
if (!exe) { console.error('没找到 Chrome：用 --chrome 或 CHROME_PATH 指定'); process.exit(1); }

const b = await puppeteer.launch({ executablePath: exe, headless: true, protocolTimeout: 0, args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
p.on('pageerror', e => console.error('[page]', e.message));
await p.goto(pathToFileURL(path.resolve(page)).href, { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready === true, { timeout: 60000 });
const b64 = await p.evaluate(() => {
  __pause();
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  FILM.drawCover(c);
  return c.toDataURL('image/jpeg', 0.92).slice(23);
});
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
await b.close();
console.log('封面 →', out);
