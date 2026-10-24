/* =====================================================================
 * 32 位 ms 计时器的故事（事故） —— 赛博朋克 HUD 风格
 * 纯代码渲染：render(canvas, t) 画出第 t 秒的画面（确定性，可任意跳帧）
 * 逻辑坐标 1920×1080，实际分辨率由 canvas 尺寸决定（4K = 3840×2160）
 * 同一份文件可在浏览器里预览（film.html），也可被导出脚本逐帧调用。
 * ===================================================================== */
(function (root) {
'use strict';
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 配色 / 字体 ---------------- */
const C = {
  bg: '#02070a', cyan: '#43f3e2', cyan2: '#22b9ad', white: '#eafffc', mute: '#7ea7a3',
  amber: '#ffb43c', red: '#ff3d5a', green: '#5dffa6', blue: '#6cb6ff', pink: '#ff7ad9',
  code: '#cfe9e6', comment: '#5f8783', punct: '#8fb3af',
};
const F = {
  cjk: '"FCJK","FSup","Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif',
  disp: '"FDisp","Inter Display","Inter","FCJK","Segoe UI",sans-serif',
  mono: '"FMono","FMonoCJK","DejaVu Sans Mono","Noto Sans Mono CJK SC",Consolas,monospace',
};
const CH_NAMES = ['开场', '事故经过', '两个根因', '第一次修复', '24.85 天后', '含泪总结', '别人怎么做', '结尾'];

/* ---------------- 数学工具 ---------------- */
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eo = t => 1 - Math.pow(1 - clamp(t), 3);
const eio = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const eback = t => { t = clamp(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const pulse = (t, f = 1) => 0.5 + 0.5 * Math.sin(t * TAU * f);
const blink = (t, f = 2) => (Math.floor(t * f * 2) % 2 === 0 ? 1 : 0.25);
function rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const hex8 = u => '0x' + (u >>> 0).toString(16).toUpperCase().padStart(8, '0');

let SC = 1; // 设备像素 / 逻辑像素

/* ---------------- 文字 ---------------- */
function fontStr(o) { return `${o.w || 500} ${o.s || 32}px ${F[o.f || 'cjk']}`; }
function txt(g, s, x, y, o = {}) {
  g.save();
  if (o.al != null) g.globalAlpha *= o.al;
  g.font = fontStr(o);
  g.textAlign = o.a || 'left';
  g.textBaseline = o.b || 'alphabetic';
  if (o.ls) g.letterSpacing = o.ls + 'px';
  if (o.sh) { g.shadowColor = o.sh; g.shadowBlur = (o.sb || 14) * SC; }
  if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.lw || 2; g.lineJoin = 'round'; g.strokeText(s, x, y); }
  if (!o.noFill) { g.fillStyle = o.c || C.white; g.fillText(s, x, y); }
  g.restore();
}
function tw(g, s, o = {}) {
  g.save(); g.font = fontStr(o); if (o.ls) g.letterSpacing = o.ls + 'px';
  const w = g.measureText(s).width; g.restore(); return w;
}
/* 打字机：按进度截取 */
const typed = (s, p) => s.slice(0, Math.round(s.length * clamp(p)));
/* RGB 分离的故障字 */
function glitchTxt(g, s, x, y, o, amt, seed) {
  if (amt > 0.01) {
    const dx = (hash(seed) - .5) * 26 * amt, dy = (hash(seed + 1) - .5) * 6 * amt;
    g.save(); g.globalCompositeOperation = 'lighter';
    txt(g, s, x - dx, y - dy, { ...o, c: rgba('#ff2050', .75 * amt), sh: null });
    txt(g, s, x + dx, y + dy, { ...o, c: rgba('#20e0ff', .75 * amt), sh: null });
    g.restore();
  }
  txt(g, s, x, y, o);
}

/* ---------------- 基础图元 ---------------- */
function line(g, x1, y1, x2, y2, c, w = 1, al = 1) {
  g.save(); g.globalAlpha *= al; g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.restore();
}
function corners(g, x, y, w, h, L, c, lw = 2.5) {
  g.save(); g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'square'; g.beginPath();
  g.moveTo(x, y + L); g.lineTo(x, y); g.lineTo(x + L, y);
  g.moveTo(x + w - L, y); g.lineTo(x + w, y); g.lineTo(x + w, y + L);
  g.moveTo(x + w, y + h - L); g.lineTo(x + w, y + h); g.lineTo(x + w - L, y + h);
  g.moveTo(x + L, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - L);
  g.stroke(); g.restore();
}
/* HUD 面板：p 为出现进度（从中心展开） */
function panel(g, x, y, w, h, o = {}) {
  const p = o.p == null ? 1 : o.p; if (p <= 0) return;
  const c = o.c || C.cyan;
  const ww = w * eo(clamp(p * 1.7)), hh = Math.max(2, h * eo(clamp(p * 1.7 - .35)));
  const x0 = x + (w - ww) / 2, y0 = y + (h - hh) / 2;
  g.save(); if (o.al != null) g.globalAlpha *= o.al;
  g.fillStyle = o.fill || 'rgba(4,18,22,0.78)'; g.fillRect(x0, y0, ww, hh);
  // 细网格纹理
  if (!o.noGrid && hh > 20) {
    g.save(); g.beginPath(); g.rect(x0, y0, ww, hh); g.clip();
    g.strokeStyle = rgba(c, .045); g.lineWidth = 1;
    for (let gx = x0 + 24; gx < x0 + ww; gx += 24) { g.beginPath(); g.moveTo(gx, y0); g.lineTo(gx, y0 + hh); g.stroke(); }
    for (let gy = y0 + 24; gy < y0 + hh; gy += 24) { g.beginPath(); g.moveTo(x0, gy); g.lineTo(x0 + ww, gy); g.stroke(); }
    g.restore();
  }
  g.strokeStyle = rgba(c, .32); g.lineWidth = 1; g.strokeRect(x0 + .5, y0 + .5, ww - 1, hh - 1);
  corners(g, x0, y0, ww, hh, Math.min(18, ww / 4, hh / 4), c, 2.5);
  if (o.title && p > .55) {
    const a = seg(p, .55, .85);
    g.globalAlpha *= a;
    const tws = tw(g, o.title, { f: 'mono', s: 14, w: 700, ls: 2 });
    g.fillStyle = rgba(c, .16); g.fillRect(x0 + 18, y0 - 12, tws + 22, 24);
    g.strokeStyle = rgba(c, .6); g.strokeRect(x0 + 18.5, y0 - 11.5, tws + 21, 23);
    txt(g, o.title, x0 + 29, y0 + 5, { f: 'mono', s: 14, w: 700, ls: 2, c });
  }
  g.restore();
}
function chip(g, s, x, y, o = {}) {
  const c = o.c || C.cyan, size = o.s || 16;
  const w = tw(g, s, { f: o.f || 'mono', s: size, w: 700, ls: o.ls == null ? 2 : o.ls }) + size * 1.3;
  const h = size * 1.75;
  const x0 = o.a === 'center' ? x - w / 2 : o.a === 'right' ? x - w : x;
  g.save(); if (o.al != null) g.globalAlpha *= o.al;
  g.fillStyle = rgba(c, o.fillA == null ? .14 : o.fillA); g.fillRect(x0, y - h / 2, w, h);
  g.strokeStyle = rgba(c, .75); g.lineWidth = 1.2; g.strokeRect(x0 + .5, y - h / 2 + .5, w - 1, h - 1);
  txt(g, s, x0 + w / 2, y + size * .36, { f: o.f || 'mono', s: size, w: 700, ls: o.ls == null ? 2 : o.ls, c: o.tc || c, a: 'center' });
  g.restore();
  return w;
}
function check(g, x, y, s, c, p = 1) {
  g.save(); g.strokeStyle = c; g.lineWidth = s * .16; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); const p1 = clamp(p * 2), p2 = clamp(p * 2 - 1);
  g.moveTo(x - s * .45, y); g.lineTo(x - s * .45 + s * .3 * p1, y + s * .32 * p1);
  if (p2 > 0) g.lineTo(x - s * .15 + s * .62 * p2, y + s * .32 - s * .7 * p2);
  g.stroke(); g.restore();
}
function cross(g, x, y, s, c, p = 1) {
  g.save(); g.strokeStyle = c; g.lineWidth = s * .16; g.lineCap = 'round';
  const p1 = clamp(p * 2), p2 = clamp(p * 2 - 1);
  g.beginPath(); g.moveTo(x - s * .4, y - s * .4); g.lineTo(x - s * .4 + s * .8 * p1, y - s * .4 + s * .8 * p1);
  if (p2 > 0) { g.moveTo(x + s * .4, y - s * .4); g.lineTo(x + s * .4 - s * .8 * p2, y - s * .4 + s * .8 * p2); }
  g.stroke(); g.restore();
}
function warnTri(g, x, y, s, c) {
  g.save(); g.strokeStyle = c; g.lineWidth = s * .09; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x, y - s * .5); g.lineTo(x + s * .55, y + s * .45); g.lineTo(x - s * .55, y + s * .45); g.closePath(); g.stroke();
  txt(g, '!', x, y + s * .36, { f: 'disp', w: 900, s: s * .62, c, a: 'center' });
  g.restore();
}
function clockIcon(g, x, y, r, c, t) {
  g.save(); g.strokeStyle = c; g.lineWidth = r * .1;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
  for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; line(g, x + Math.cos(a) * r * .78, y + Math.sin(a) * r * .78, x + Math.cos(a) * r * .9, y + Math.sin(a) * r * .9, c, r * .05); }
  const a1 = t * 1.2 - Math.PI / 2, a2 = t * .1 - Math.PI / 2;
  line(g, x, y, x + Math.cos(a1) * r * .7, y + Math.sin(a1) * r * .7, c, r * .07);
  line(g, x, y, x + Math.cos(a2) * r * .45, y + Math.sin(a2) * r * .45, c, r * .1);
  g.restore();
}
function powerIcon(g, x, y, r, c) {
  g.save(); g.strokeStyle = c; g.lineWidth = r * .16; g.lineCap = 'round';
  g.beginPath(); g.arc(x, y, r, -Math.PI / 2 + .55, -Math.PI / 2 - .55 + TAU); g.stroke();
  g.beginPath(); g.moveTo(x, y - r * 1.15); g.lineTo(x, y - r * .2); g.stroke(); g.restore();
}

/* ---------------- 数字（等宽槽位，防抖动） ---------------- */
function digits(g, s, cx, y, size, o = {}) {
  const slot = size * (o.slot || .64);
  const n = s.length, x0 = cx - n * slot / 2;
  for (let i = 0; i < n; i++) {
    const ch = s[i], w = (ch === ',' || ch === '.') ? slot * .5 : slot;
    txt(g, ch, x0 + i * slot + slot / 2, y, { f: o.f || 'disp', w: o.w || 800, s: size, c: o.c || C.white, a: 'center', sh: o.sh, sb: o.sb, al: o.al });
  }
}

/* ---------------- 代码块 ---------------- */
const KW = new Set(['if', 'else', 'return', 'static', 'void', 'const', 'while', 'for', 'typecheck', 'unsigned', 'long', 'signed']);
const TY = new Set(['uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'int', 'uint16_t', 'int16_t', 'sclock_t', '__u64', '__s64', 'TickType_t', 'ktime_t']);
function tokenize(line) {
  let ci = -1;
  const i1 = line.indexOf('//'), i2 = line.indexOf('/*');
  [i1, i2].forEach(v => { if (v >= 0 && (ci < 0 || v < ci)) ci = v; });
  const code = ci >= 0 ? line.slice(0, ci) : line, com = ci >= 0 ? line.slice(ci) : '';
  const out = [];
  if (/^\s*\$/.test(code)) { out.push({ s: code, c: C.white }); if (com) out.push({ s: com, c: C.comment }); return out; }
  const re = /("[^"]*"|'[^']*'|0x[0-9A-Fa-f]+|\d+[uUlL]*|#\s*\w+|[A-Za-z_][A-Za-z0-9_]*|\s+|.)/g;
  let m; const toks = [];
  while ((m = re.exec(code))) toks.push(m[0]);
  toks.forEach((s, i) => {
    let c = C.code;
    if (s[0] === '"' || s[0] === "'") c = C.amber;
    else if (/^(0x[0-9A-Fa-f]+|\d+[uUlL]*)$/.test(s)) c = C.amber;
    else if (s[0] === '#') c = C.pink;
    else if (TY.has(s)) c = C.blue;
    else if (KW.has(s)) c = C.pink;
    else if (/^[A-Za-z_]/.test(s)) {
      let j = i + 1; while (j < toks.length && /^\s+$/.test(toks[j])) j++;
      c = toks[j] === '(' ? C.cyan : (/^[A-Z_0-9]+$/.test(s) && s.length > 2 ? '#ffd27a' : C.code);
    } else if (/^\s+$/.test(s)) c = null;
    else c = C.punct;
    out.push({ s, c });
  });
  if (com) out.push({ s: com, c: C.comment });
  return out;
}
/* lines: string[]; o: {s, lh, p(打字进度 0..1), hl:{idx:color}, diff, al, cursor} */
function drawCode(g, x, y, lines, o = {}) {
  const s = o.s || 22, lh = o.lh || s * 1.55;
  const total = lines.reduce((a, l) => a + l.length + 1, 0);
  let budget = o.p == null ? 1e9 : Math.round(total * clamp(o.p));
  const typing = o.p != null && o.p < 1;
  g.save(); if (o.al != null) g.globalAlpha *= o.al;
  g.font = fontStr({ f: 'mono', s, w: o.w || 400 });
  let cx = x, cy = y;
  for (let li = 0; li < lines.length; li++) {
    if (budget <= 0) break;
    const ln = lines[li];
    const hl = o.hl && o.hl[li];
    const ly = y + li * lh;
    let bg = null;
    if (o.diff) { if (ln[0] === '+') bg = C.green; else if (ln[0] === '-') bg = C.red; }
    if (hl) bg = hl;
    if (bg) {
      g.fillStyle = rgba(bg, o.hlA || .14); g.fillRect(x - 14, ly - s * 1.02, (o.width || 820), lh * .92);
      g.fillStyle = rgba(bg, .9); g.fillRect(x - 14, ly - s * 1.02, 3, lh * .92);
    }
    cx = x;
    for (const tk of tokenize(ln)) {
      if (budget <= 0) break;
      const part = tk.s.slice(0, budget); budget -= part.length;
      if (tk.c) { g.fillStyle = tk.c; g.fillText(part, cx, ly); }
      cx += g.measureText(part).width;
    }
    cy = ly; budget -= 1;
  }
  if (typing || o.cursor) {
    g.fillStyle = rgba(C.cyan, blink(o.t || 0, 2) > .5 ? .9 : .2);
    g.fillRect(cx + 2, cy - s * .85, s * .55, s * 1.0);
  }
  g.restore();
}

/* ---------------- 环（32 位计数器的“表盘”） ---------------- */
const angU = u => -Math.PI / 2 + u * TAU;
function ringBase(g, cx, cy, R, t, o = {}) {
  const al = o.al == null ? 1 : o.al; if (al <= 0) return;
  g.save(); g.globalAlpha *= al; g.translate(cx, cy);
  // 外层旋转刻度
  g.strokeStyle = rgba(C.cyan, .1); g.lineWidth = 1; g.beginPath(); g.arc(0, 0, R + 46, 0, TAU); g.stroke();
  g.save(); g.rotate(t * .12);
  g.strokeStyle = rgba(C.cyan, .38); g.lineWidth = 2;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(0, 0, R + 46, k * TAU / 3, k * TAU / 3 + .55); g.stroke(); }
  g.restore();
  g.save(); g.rotate(-t * .07); g.setLineDash([2, 10]); g.strokeStyle = rgba(C.cyan, .25); g.lineWidth = 1;
  g.beginPath(); g.arc(0, 0, R - 34, 0, TAU); g.stroke(); g.restore();
  // 主轨道
  g.strokeStyle = rgba(C.cyan, .13); g.lineWidth = 16; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
  g.strokeStyle = rgba(C.cyan, .6); g.lineWidth = 1.4;
  g.beginPath(); g.arc(0, 0, R + 10, 0, TAU); g.stroke();
  g.beginPath(); g.arc(0, 0, R - 10, 0, TAU); g.stroke();
  for (let k = 0; k < 64; k++) {
    const a = angU(k / 64), major = k % 16 === 0, mid = k % 4 === 0;
    const r1 = R + 15, r2 = R + 15 + (major ? 18 : mid ? 9 : 5);
    g.strokeStyle = rgba(C.cyan, major ? .95 : mid ? .5 : .25); g.lineWidth = major ? 2.2 : 1;
    g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); g.stroke();
  }
  g.restore();
  if (o.labels) {
    const L = o.labels; // [[u, text], ...]
    for (const [u, s, c] of L) {
      const a = angU(u), rr = R + (o.labelR || 78);
      txt(g, s, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + 8, { f: 'mono', s: o.labelS || 20, w: 700, c: c || rgba(C.cyan, .85), a: 'center', al });
    }
  }
}
function ringArc(g, cx, cy, R, u0, u1, c, w = 8, al = 1) {
  if (al <= 0) return;
  g.save(); g.globalAlpha *= al; g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath();
  if (u1 >= u0) g.arc(cx, cy, R, angU(u0), angU(u1)); else g.arc(cx, cy, R, angU(u0), angU(u1), true);
  g.stroke(); g.restore();
}
function ringPoint(g, cx, cy, R, u, c, label, o = {}) {
  const a = angU(u), x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
  g.save(); if (o.al != null) g.globalAlpha *= o.al;
  g.fillStyle = c; g.beginPath(); g.arc(x, y, o.r || 10, 0, TAU); g.fill();
  g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.arc(x, y, (o.r || 10) + 8 + 4 * pulse(o.t || 0, 1.2), 0, TAU); g.stroke();
  if (label) {
    const lr = R + (o.lr || -70), lx = cx + Math.cos(a) * lr, ly = cy + Math.sin(a) * lr;
    txt(g, label, lx, ly + 7, { f: o.lf || 'cjk', s: o.ls || 22, w: 700, c, a: 'center' });
  }
  g.restore();
  return [x, y];
}

/* ---------------- 窗帘 / 遥控器 线稿 ---------------- */
function curtain(g, x, y, w, h, open, o = {}) {
  const c = o.c || C.cyan;
  g.save();
  // 窗框 + 城市剪影
  g.strokeStyle = rgba(c, .5); g.lineWidth = 2; g.strokeRect(x, y, w, h);
  line(g, x + w / 2, y, x + w / 2, y + h, rgba(c, .25), 1.5);
  line(g, x, y + h * .55, x + w, y + h * .55, rgba(c, .2), 1);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = rgba(c, .05 + .2 * clamp(open)); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y + h);
  for (let i = 0; i <= 14; i++) { const bx = x + i * w / 14, bh = h * (.25 + .5 * hash(i + 7)); g.lineTo(bx, y + h - bh); g.lineTo(bx + w / 14 * .8, y + h - bh); }
  g.lineTo(x + w, y + h); g.stroke(); g.restore();
  // 轨道
  line(g, x - 30, y - 18, x + w + 30, y - 18, c, 4);
  // 接收器
  const rx = x + w + 8, ry = y - 40;
  g.fillStyle = 'rgba(4,18,22,.9)'; g.fillRect(rx, ry, 64, 34); g.strokeStyle = c; g.lineWidth = 1.5; g.strokeRect(rx, ry, 64, 34);
  txt(g, 'MCU', rx + 24, ry + 23, { f: 'mono', s: 13, w: 700, c, a: 'center' });
  g.fillStyle = o.led || C.green; g.beginPath(); g.arc(rx + 52, ry + 17, 5, 0, TAU); g.fill();
  // 两片帘子
  const half = w / 2 + 26;
  const pw = half * (1 - .78 * clamp(open));
  const drawPanel = (px, dir) => {
    const x0 = dir > 0 ? px : px - pw;
    g.fillStyle = rgba(c, .09); g.fillRect(x0, y - 14, pw, h + 30);
    g.strokeStyle = rgba(c, .8); g.lineWidth = 1.6; g.strokeRect(x0, y - 14, pw, h + 30);
    const n = Math.max(2, Math.floor(pw / 20));
    for (let k = 1; k < n; k++) {
      const fx = x0 + k * pw / n;
      g.strokeStyle = rgba(c, .35); g.lineWidth = 1.2; g.beginPath();
      g.moveTo(fx, y - 12);
      g.bezierCurveTo(fx + 4, y + h * .3, fx - 4, y + h * .7, fx, y + h + 14); g.stroke();
    }
    for (let k = 0; k < 8; k++) { const hx = x0 + (k + .5) * pw / 8; g.fillStyle = c; g.fillRect(hx - 2, y - 21, 4, 6); }
  };
  drawPanel(x - 26, 1); drawPanel(x + w + 26, -1);
  g.restore();
}
function remote(g, x, y, o = {}) {
  const c = o.c || C.cyan;
  g.save(); g.translate(x, y); g.rotate(o.rot || 0);
  g.fillStyle = 'rgba(4,18,22,.9)';
  g.beginPath(); g.roundRect(-38, -95, 76, 190, 22); g.fill();
  g.strokeStyle = c; g.lineWidth = 2; g.stroke();
  g.fillStyle = o.press ? C.white : rgba(c, .6); g.beginPath(); g.arc(0, -36, 16, 0, TAU); g.fill();
  for (let k = 0; k < 3; k++) { g.strokeStyle = rgba(c, .7); g.lineWidth = 1.4; g.strokeRect(-18, 2 + k * 24, 36, 14); }
  g.fillStyle = o.press ? C.amber : rgba(c, .5); g.beginPath(); g.arc(0, -80, 5, 0, TAU); g.fill();
  g.restore();
}

/* =====================================================================
 * 时间线
 * ===================================================================== */
const scenes = [], caps = [], cues = [], fxs = [], chapterStarts = [];
let TOTAL = 0;
const plain = s => (Array.isArray(s) ? s[0] : s).replace(/[{}\[\]\^]/g, '');
function capDur(s) {
  if (Array.isArray(s)) return s[1];
  const n = plain(s).length;
  return Math.max(2.0, 0.8 + n * 0.175);
}
function addScene(o) {
  const pre = o.pre == null ? 0.55 : o.pre, post = o.post == null ? 0.7 : o.post;
  const cs = []; let tt = pre;
  (o.caps || []).forEach(c => { cs.push(tt); tt += capDur(c); });
  const d = o.dur != null ? o.dur : tt + post;
  const sc = Object.assign({}, o, { start: TOTAL, d, cs });
  sc.ce = cs.map((s, i) => i + 1 < cs.length ? cs[i + 1] - 0.15 : d - 0.3);
  scenes.push(sc);
  (o.caps || []).forEach((c, i) => caps.push({ t0: TOTAL + cs[i], t1: TOTAL + sc.ce[i], text: Array.isArray(c) ? c[0] : c }));
  if (o.sfx) for (const [t, type, v] of o.sfx(sc)) cues.push({ t: TOTAL + t, type, v: v == null ? 1 : v });
  if (o.fx) for (const [t, type, a, dur] of o.fx(sc)) fxs.push({ t: TOTAL + t, type, a, dur });
  if (o.chapterCard) chapterStarts.push({ t: TOTAL, n: o.chap });
  TOTAL += d;
  return sc;
}

/* ---------------- 章节卡 ---------------- */
function chapterCard(n, zh, en, desc) {
  addScene({
    id: 'ch' + n, chap: n, chapterCard: true, dur: 3.0, pre: 0, caps: [],
    sfx: () => [[0, 'whoosh'], [0.42, 'blip'], [0.9, 'blip2']],
    fx: () => [[0, 'glitch', .55, .22]],
    draw(g, L) {
      const t = L.t, a = eo(seg(t, 0, .5));
      // 扫描线条
      const sx = lerp(-200, 2200, eio(seg(t, 0, .55)));
      line(g, sx - 600, 540, sx, 540, rgba(C.cyan, .5), 2);
      // 巨大编号
      const nx = 300;
      txt(g, '0' + n, nx + (1 - a) * -60, 640, { f: 'disp', w: 900, s: 300, noFill: true, stroke: rgba(C.cyan, .9 * a), lw: 3, a: 'center' });
      txt(g, '0' + n, nx + (1 - a) * -60, 640, { f: 'disp', w: 900, s: 300, c: rgba(C.cyan, .07 * a), a: 'center' });
      const tx = 560, ta = eo(seg(t, .25, .75));
      txt(g, `CHAPTER 0${n} / 06`, tx, 420, { f: 'mono', s: 18, w: 700, ls: 6, c: rgba(C.cyan, .85), al: ta });
      line(g, tx, 440, tx + 1100 * ta, 440, rgba(C.cyan, .35), 1);
      glitchTxt(g, zh, tx + (1 - ta) * 40, 560, { f: 'cjk', w: 900, s: 118, c: C.white, al: ta }, 1 - seg(t, .3, .9), n * 10 + Math.floor(t * 20));
      txt(g, en, tx + 4, 625, { f: 'mono', s: 22, w: 700, ls: 10, c: rgba(C.cyan, .9), al: eo(seg(t, .45, .9)) });
      txt(g, desc, tx + 4, 690, { f: 'cjk', s: 32, w: 500, c: C.mute, al: eo(seg(t, .7, 1.2)) });
      // 进度格
      for (let k = 1; k <= 6; k++) {
        const on = k <= n, cur = k === n;
        g.fillStyle = cur ? rgba(C.cyan, .9 * blink(t, 3)) : on ? rgba(C.cyan, .6) : rgba(C.cyan, .15);
        g.fillRect(tx + (k - 1) * 46, 740, 38, 6);
      }
    },
  });
}

/* =====================================================================
 * 场景
 * ===================================================================== */

/* ---------- 00 开场钩子 ---------- */
addScene({
  id: 'hook', chap: 0, pre: 1.0, post: 0.8,
  caps: ['这是 {int32_t} 能表示的最大值', ['再过 1 毫秒——', 2.3], '它变成了[负数]', '设备只要连续运行 {24.85 天}，这一刻就一定会到来'],
  sfx: sc => {
    const a = []; for (let i = 0; i < 17; i++) a.push([0.55 + i * 0.12, 'tick', .6]);
    const F_ = sc.cs[1] + 1.15; a.push([F_ - .9, 'riser']); a.push([F_, 'glitchHit']); a.push([sc.cs[3] + .3, 'blip']);
    return a;
  },
  fx: sc => { const F_ = sc.cs[1] + 1.15; return [[F_, 'glitch', 1, .55], [F_, 'shake', 14, .45], [F_, 'flash', '#ff3d5a', .3]]; },
  draw(g, L) {
    const t = L.t, F_ = L.cs[1] + 1.15, flipped = t >= F_;
    const boot = eo(seg(t, 0.05, 0.6));
    // 背景环
    ringBase(g, 960, 470, 360, t, { al: .25 * boot + .5 * eo(seg(t, L.cs[3], L.cs[3] + 1)) });
    if (t > L.cs[3]) {
      const u = 0.5 * eio(seg(t, L.cs[3], L.cs[3] + 2.2));
      ringArc(g, 960, 470, 360, 0, u, rgba(C.amber, .9), 6, eo(seg(t, L.cs[3], L.cs[3] + .4)));
    }
    txt(g, 'int32_t now = up_time();   /* 单位：ms */', 960, 255, { f: 'mono', s: 24, c: rgba(C.cyan, .75), a: 'center', al: boot });
    let v;
    if (!flipped) v = 2147483630 + Math.min(17, Math.max(0, Math.floor((t - .55) / .12) + 1));
    else v = -2147483648 + Math.floor(Math.max(0, t - F_ - 1.2) / .35);
    const gl = flipped ? 1 - seg(t, F_, F_ + .6) : 0;
    const col = flipped ? C.red : C.white;
    const str = String(v);
    // 故障 RGB 分离
    if (gl > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      digits(g, str, 960 - 22 * gl, 470, 150, { c: rgba('#ff2050', .7 * gl) });
      digits(g, str, 960 + 22 * gl, 470, 150, { c: rgba('#20e0ff', .7 * gl) });
      g.restore();
    }
    digits(g, str, 960, 470, 150, { c: col, al: boot });
    const hv = flipped ? 0x80000000 : (v >>> 0);
    txt(g, hex8(hv), 960, 548, { f: 'mono', s: 40, w: 700, c: flipped ? C.red : C.cyan, a: 'center', ls: 4, al: boot });
    // 32 个比特
    const bw = 30, gap = 6, gg = 12, bx0 = 960 - (32 * bw + 31 * gap + 7 * gg) / 2;
    for (let i = 0; i < 32; i++) {
      const bit = (hv >>> (31 - i)) & 1;
      const x = bx0 + i * (bw + gap) + Math.floor(i / 4) * gg, y = 590;
      const sign = i === 0;
      const c = sign ? (flipped ? C.red : C.amber) : C.cyan;
      g.fillStyle = bit ? rgba(c, .85) : rgba(c, .08); g.fillRect(x, y, bw, 40);
      g.strokeStyle = rgba(c, .6); g.lineWidth = 1; g.strokeRect(x + .5, y + .5, bw - 1, 39);
      txt(g, String(bit), x + bw / 2, y + 28, { f: 'mono', s: 20, w: 700, c: bit ? '#021014' : rgba(c, .7), a: 'center' });
    }
    txt(g, '符号位', bx0 + bw / 2, 660, { f: 'cjk', s: 18, w: 700, c: flipped ? C.red : C.amber, a: 'center', al: boot });
    txt(g, 'bit 31', bx0 + bw / 2, 684, { f: 'mono', s: 14, c: C.mute, a: 'center', al: boot });
    if (t > L.cs[3]) {
      const a = eo(seg(t, L.cs[3] + .2, L.cs[3] + .9));
      txt(g, '2³¹ ms = 2,147,483,648 ms ≈ 24.855 天', 960, 760, { f: 'cjk', s: 36, w: 700, c: C.amber, a: 'center', al: a });
    }
  },
});

/* ---------- 标题 ---------- */
addScene({
  id: 'title', chap: 0, dur: 5.6, pre: 0, caps: [],
  sfx: () => [[0.1, 'impact'], [1.0, 'stamp'], [1.6, 'blip']],
  fx: () => [[0.1, 'glitch', .8, .35], [1.0, 'shake', 8, .3]],
  draw(g, L) {
    const t = L.t;
    ringBase(g, 960, 520, 430, t, { al: .35 * eo(seg(t, 0, 1)) });
    const a = eo(seg(t, .05, .5));
    glitchTxt(g, '32 位 ms 计时器的故事', 850, 520, { f: 'cjk', w: 900, s: 124, c: C.white, a: 'center', al: a }, 1 - seg(t, .1, .9), Math.floor(t * 24));
    // 红色印章“（事故）”
    const sp = seg(t, .95, 1.15);
    if (sp > 0) {
      const sc = lerp(2.4, .82, eo(sp));
      g.save(); g.translate(1655, 430); g.rotate(-.16); g.scale(sc, sc); g.globalAlpha *= eo(sp);
      g.strokeStyle = C.red; g.lineWidth = 5; g.strokeRect(-130, -52, 260, 104);
      g.lineWidth = 1.5; g.strokeRect(-120, -42, 240, 84);
      txt(g, '事故', 0, 26, { f: 'cjk', w: 900, s: 74, c: C.red, a: 'center', ls: 12 });
      g.restore();
    }
    txt(g, 'THE  24.85-DAY  BUG', 960, 610, { f: 'mono', s: 26, w: 700, ls: 14, c: C.cyan, a: 'center', al: eo(seg(t, 1.4, 2)) });
    const sub = '一次嵌入式事故的完整复盘  ·  VelaOS / MCU';
    txt(g, typed(sub, seg(t, 1.8, 3.0)), 960, 675, { f: 'cjk', s: 30, w: 500, c: C.mute, a: 'center' });
    line(g, 960 - 520 * eo(seg(t, 1.2, 2)), 572, 960 + 520 * eo(seg(t, 1.2, 2)), 572, rgba(C.cyan, .4), 1);
  },
});

/* ---------- 01 事故经过 ---------- */
chapterCard(1, '事故经过', 'THE INCIDENT', '春节回来，内测用户的窗帘失灵了');

addScene({
  id: 'callup', chap: 1,
  caps: ['有段时间，我手上的屏项目刚好闲了下来', '老板突然找到我：{另一个项目出了紧急问题，你去看看}'],
  sfx: sc => [[0.2, 'blip'], [0.45, 'blip2'], [sc.cs[1] + .2, 'whoosh'], [sc.cs[1] + .95, 'lock'], [sc.cs[1] + 1.3, 'alert']],
  draw(g, L) {
    const t = L.t;
    const pA = seg(t, .1, .7), pB = seg(t, .3, .9);
    const urgent = t > L.cs[1] + 1.3;
    panel(g, 230, 260, 640, 420, { p: pA, title: 'PROJECT 01' });
    panel(g, 1050, 260, 640, 420, { p: pB, title: 'PROJECT 02', c: urgent ? C.amber : C.cyan });
    if (pA > .6) {
      const a = seg(pA, .6, 1);
      // 屏幕图标
      g.save(); g.globalAlpha *= a;
      g.strokeStyle = rgba(C.cyan, .8); g.lineWidth = 2; g.strokeRect(430, 330, 240, 150);
      line(g, 550, 480, 550, 510, rgba(C.cyan, .8), 2); line(g, 500, 512, 600, 512, rgba(C.cyan, .8), 2);
      for (let k = 0; k < 5; k++) line(g, 450, 355 + k * 22, 450 + 200 * hash(k + 3), 355 + k * 22, rgba(C.cyan, .35), 6);
      g.restore();
      txt(g, '屏项目', 550, 580, { f: 'cjk', s: 40, w: 700, a: 'center', al: a });
      chip(g, 'VelaOS', 470, 632, { s: 15, al: a });
      chip(g, t > L.cs[0] + .8 ? 'IDLE' : 'ACTIVE', 640, 632, { s: 15, c: t > L.cs[0] + .8 ? C.mute : C.green, al: a });
    }
    if (pB > .6) {
      const a = seg(pB, .6, 1);
      g.save(); g.globalAlpha *= a;
      curtain(g, 1290, 345, 160, 140, .15 + .1 * Math.sin(t * 1.3), { c: urgent ? C.amber : C.cyan, led: urgent ? C.red : C.green });
      g.restore();
      txt(g, '电动开合帘', 1370, 580, { f: 'cjk', s: 40, w: 700, a: 'center', al: a });
      chip(g, 'VelaOS', 1290, 632, { s: 15, al: a });
      if (urgent) chip(g, 'URGENT', 1460, 632, { s: 15, c: C.amber, al: blink(t, 2.5) });
      else chip(g, 'TESTING', 1460, 632, { s: 15, c: C.cyan, al: a });
    }
    // 锁定框：从 A 移到 B
    if (t > .9) {
      const m = eio(seg(t, L.cs[1] + .2, L.cs[1] + .95));
      const cx = lerp(550, 1370, m), cy = 470, s = 380 + 30 * pulse(t, 1.5);
      const col = m > .99 ? C.amber : C.cyan;
      corners(g, cx - s / 2 - 120, cy - s / 2 - 10, s + 240, s + 20, 30, rgba(col, .9), 3);
      if (m > .99) txt(g, 'LOCKED', cx + s / 2 + 110, cy - s / 2 - 22, { f: 'mono', s: 16, w: 700, ls: 4, c: C.amber, a: 'right', al: blink(t, 3) });
    }
  },
});

addScene({
  id: 'curtain', chap: 1,
  caps: ['产品刚进入内测', '用户过完春节回到家，发现窗帘{怎么按遥控器都没反应}', '最后只能靠[重启]才能恢复'],
  sfx: sc => {
    const a = [[0.2, 'blip']];
    [0.5, 1.8, 3.1].forEach(o => { a.push([sc.cs[1] + o, 'ir']); a.push([sc.cs[1] + o + .55, 'error']); });
    a.push([sc.cs[2] + .4, 'power']); a.push([sc.cs[2] + 1.5, 'confirm']); a.push([sc.cs[2] + 1.6, 'motor']);
    return a;
  },
  draw(g, L) {
    const t = L.t, c1 = L.cs[1], c2 = L.cs[2];
    const a = eo(seg(t, .05, .6));
    const rebootT = c2 + .4, okT = c2 + 1.5;
    const off = t > rebootT && t < rebootT + .9;
    const ok = t > okT;
    const open = ok ? eio(seg(t, okT, okT + 2.2)) : 0;
    g.save(); g.globalAlpha *= a;
    panel(g, 150, 170, 1060, 640, { p: seg(t, 0, .7), title: 'LIVING ROOM · 内测设备' });
    curtain(g, 470, 300, 480, 400, open, { led: off ? '#333' : ok ? C.green : C.amber });
    // 遥控器 + 信号
    const presses = [c1 + .5, c1 + 1.8, c1 + 3.1];
    let pressing = false;
    presses.forEach((p0, i) => {
      if (t > p0 && t < p0 + .25) pressing = true;
      const k = seg(t, p0, p0 + .55);
      if (k > 0 && k < 1) {
        const x1 = 300, y1 = 470, x2 = 1010, y2 = 278;
        for (let r = 0; r < 3; r++) {
          const kk = clamp(k * 1.3 - r * .15);
          if (kk <= 0 || kk >= 1) continue;
          const px = lerp(x1, x2, kk), py = lerp(y1, y2, kk);
          g.strokeStyle = rgba(C.cyan, (1 - kk) * .9); g.lineWidth = 3;
          g.beginPath(); g.arc(px, py, 18 + r * 6, -1, 1); g.stroke();
        }
      }
      const e = t - (p0 + .55);
      if (e > 0 && e < 1.1) {
        txt(g, 'NO RESPONSE', 1040, 330 + i * 0, { f: 'mono', s: 20, w: 700, ls: 3, c: C.red, a: 'center', al: blink(e, 4) * (1 - seg(e, .8, 1.1)) });
        cross(g, 1040, 250, 26, C.red, seg(e, 0, .2));
      }
    });
    remote(g, 290, 560, { press: pressing, rot: -.35 });
    if (t > rebootT && t < okT + .3) {
      const k = seg(t, rebootT, rebootT + .3);
      powerIcon(g, 1040, 455, 34, rgba(C.amber, k * blink(t, 3)));
      txt(g, 'REBOOT', 1040, 530, { f: 'mono', s: 18, w: 700, ls: 4, c: C.amber, a: 'center', al: k });
    }
    if (ok) { check(g, 1040, 455, 54, C.green, seg(t, okT, okT + .4)); txt(g, 'OK', 1040, 530, { f: 'mono', s: 20, w: 700, ls: 4, c: C.green, a: 'center' }); }
    g.restore();
    // 右侧日志
    panel(g, 1290, 170, 480, 640, { p: seg(t, .2, .9), title: 'EVENT LOG' });
    const logs = [
      [L.cs[0] + .2, '> 内测开始', C.cyan],
      [c1 + .2, '> 春节假期结束', C.mute],
      [c1 + .5, '> remote: OPEN', C.white], [c1 + 1.05, '  curtain: NO RESPONSE', C.red],
      [c1 + 1.8, '> remote: OPEN', C.white], [c1 + 2.35, '  curtain: NO RESPONSE', C.red],
      [c1 + 3.1, '> remote: OPEN', C.white], [c1 + 3.65, '  curtain: NO RESPONSE', C.red],
      [rebootT, '> power cycle', C.amber],
      [okT, '> remote: OPEN', C.white], [okT + .3, '  curtain: OK', C.green],
    ];
    logs.forEach(([t0, s, c], i) => {
      if (t < t0) return;
      txt(g, typed(s, seg(t, t0, t0 + .35)), 1330, 240 + i * 46, { f: 'mono', s: 21, w: 700, c });
    });
  },
});

const SCAN_CODE = [
  '/* curtain_ctrl.c —— 示意代码 */',
  'void curtain_open(void)',
  '{',
  '    motor_start(DIR_OPEN);',
  '    s_deadline = up_time() + OPEN_TIMEOUT_MS;',
  '}',
  '',
  'void curtain_poll(void)',
  '{',
  '    int32_t now = up_time();',
  '    if (now > s_deadline) {',
  '        motor_stop();',
  '        retry_later(now + RETRY_MS);',
  '    }',
  '    if (now - s_last_key > DEBOUNCE_MS)',
  '        handle_key();',
  '}',
  '',
  'void curtain_stop(void)',
  '{',
  '    motor_stop();',
  '    s_idle_since = up_time();',
  '}',
  '',
  'void retry_check(void)',
  '{',
  '    if (up_time() > s_retry_at)',
  '        curtain_open();',
  '}',
  '',
  'void report_state(void)',
  '{',
  '    s_report.ts = up_time();',
  '    send_state(&s_report);',
  '}',
];
addScene({
  id: 'scan', chap: 1,
  caps: ['我没处理过这类问题，只好把 MCU 的代码从头翻一遍', '越看越不对劲：启动、停止、超时、重试……', '几乎所有控制逻辑，都依赖{时间判断}'],
  sfx: sc => {
    const a = [[0.2, 'scan']];
    [0, .3, .6, .9].forEach(o => a.push([sc.cs[1] + .3 + o, 'blip']));
    a.push([sc.cs[2] + .3, 'lock']); a.push([sc.cs[2] + .5, 'hum']);
    return a;
  },
  draw(g, L) {
    const t = L.t;
    panel(g, 110, 150, 960, 700, { p: seg(t, 0, .6), title: 'SOURCE SCAN' });
    // 滚动代码
    const lh = 34, scroll = t * 26;
    g.save(); g.beginPath(); g.rect(112, 175, 956, 660); g.clip();
    const scanY = 175 + ((t * 230) % 700);
    const first = Math.floor(scroll / lh);
    for (let i = first; i < first + 22; i++) {
      const ln = SCAN_CODE[((i % SCAN_CODE.length) + SCAN_CODE.length) % SCAN_CODE.length];
      const y = 215 + i * lh - scroll;
      const hot = /up_time|now [<>]|now -/.test(ln);
      const lit = hot && (y < scanY + 10 || t > L.cs[1]);
      const hl = lit ? { 0: C.amber } : null;
      drawCode(g, 160, y, [ln], { s: 21, lh, hl, width: 880, hlA: .16 });
      if (lit) clockIcon(g, 1030, y - 7, 10, C.amber, t * 4);
    }
    g.fillStyle = rgba(C.cyan, .5); g.fillRect(112, scanY, 956, 2);
    const grd = g.createLinearGradient(0, scanY - 60, 0, scanY);
    grd.addColorStop(0, rgba(C.cyan, 0)); grd.addColorStop(1, rgba(C.cyan, .1));
    g.fillStyle = grd; g.fillRect(112, scanY - 60, 956, 60);
    g.restore();
    // 右侧：四类逻辑
    const items = [['启动', 'motor_start'], ['停止', 'motor_stop'], ['超时', 's_deadline'], ['重试', 'retry_later']];
    const hub = [1500, 690];
    items.forEach(([zh, fn], i) => {
      const t0 = L.cs[1] + .3 + i * .3;
      const a = eo(seg(t, t0, t0 + .35));
      if (a <= 0) return;
      const y = 210 + i * 92;
      panel(g, 1150, y, 640, 72, { p: a, c: C.amber, noGrid: true });
      txt(g, zh, 1185, y + 48, { f: 'cjk', s: 32, w: 900, c: C.white, al: a });
      txt(g, fn + '()', 1275, y + 46, { f: 'mono', s: 22, c: C.cyan, al: a });
      chip(g, 'TIME', 1760, y + 36, { s: 14, c: C.amber, a: 'right', al: a });
      // 连到时钟节点
      const k = eio(seg(t, L.cs[2] + .1 + i * .1, L.cs[2] + .7 + i * .1));
      if (k > 0) {
        const x1 = 1470, y1 = y + 72;
        g.save(); g.strokeStyle = rgba(C.amber, .8); g.lineWidth = 2; g.setLineDash([6, 6]); g.lineDashOffset = -t * 30;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(lerp(x1, hub[0], k), lerp(y1, hub[1] - 70, k)); g.stroke(); g.restore();
      }
    });
    const hk = eback(seg(t, L.cs[2] + .5, L.cs[2] + 1.1));
    if (hk > 0) {
      g.save(); g.translate(hub[0], hub[1] + 10); g.scale(hk, hk);
      g.fillStyle = 'rgba(30,18,4,.85)'; g.beginPath(); g.arc(0, 0, 70, 0, TAU); g.fill();
      clockIcon(g, 0, 0, 60, C.amber, t * 3);
      g.restore();
      txt(g, 'up_time()', hub[0], hub[1] + 120, { f: 'mono', s: 26, w: 700, c: C.amber, a: 'center', al: clamp(hk) });
    }
  },
});

/* ---------- 02 两个根因 ---------- */
chapterCard(2, '两个根因', 'ROOT CAUSES', '一个隐式声明，加一个没处理的回绕');

function bitsRow(g, val, x0, y, o = {}) {
  const bw = o.bw || 32, gap = 5, gg = 12;
  for (let i = 0; i < 32; i++) {
    const bit = (val >>> (31 - i)) & 1;
    const x = x0 + i * (bw + gap) + Math.floor(i / 4) * gg;
    const c = i === 0 ? (o.signC || C.amber) : C.cyan;
    g.fillStyle = bit ? rgba(c, .85) : rgba(c, .07); g.fillRect(x, y, bw, 42);
    g.strokeStyle = rgba(c, .55); g.lineWidth = 1; g.strokeRect(x + .5, y + .5, bw - 1, 41);
    txt(g, String(bit), x + bw / 2, y + 30, { f: 'mono', s: 20, w: 700, c: bit ? '#021014' : rgba(c, .65), a: 'center' });
  }
  return 32 * (bw + gap) + 7 * gg - gap;
}

addScene({
  id: 'cause1', chap: 2,
  caps: ['根因一：up_time() 返回的是 {uint32_t}', '可调用它的文件里{没有声明}，编译器只能按隐式声明，把返回值当成 [int]', '同样 32 个比特，换了一种读法'],
  sfx: sc => [[0.2, 'type'], [0.9, 'type'], [sc.cs[1] + .3, 'warn'], [sc.cs[2] + .2, 'blip'], [sc.cs[2] + .6, 'blip2']],
  draw(g, L) {
    const t = L.t;
    panel(g, 120, 160, 780, 270, { p: seg(t, 0, .6), title: 'clock.c' });
    drawCode(g, 160, 235, ['uint32_t up_time(void)', '{', '    return s_tick_ms;   /* 1 ms 一拍 */', '}'], { s: 24, lh: 40, p: seg(t, .3, 1.6), t, hl: t > L.cs[0] + .8 ? { 0: C.cyan } : null, width: 700 });
    const warnOn = t > L.cs[1] + .3;
    panel(g, 980, 160, 820, 270, { p: seg(t, .5, 1.1), title: 'motor.c', c: warnOn ? C.amber : C.cyan });
    drawCode(g, 1020, 235, ['/* 忘了 #include "clock.h" */', 'int32_t now = up_time();'], { s: 24, lh: 40, p: seg(t, .9, 2.0), t, hl: warnOn ? { 1: C.amber } : null, width: 740 });
    if (warnOn) {
      const a = eo(seg(t, L.cs[1] + .3, L.cs[1] + .7));
      // 波浪下划线
      g.save(); g.strokeStyle = C.amber; g.lineWidth = 2; g.globalAlpha *= a; g.beginPath();
      const ux = 1020 + tw(g, 'int32_t now = ', { f: 'mono', s: 24 }), uw = tw(g, 'up_time', { f: 'mono', s: 24 });
      for (let x = 0; x <= uw; x += 2) g.lineTo(ux + x, 290 + Math.sin(x * .5) * 3);
      g.stroke(); g.restore();
      warnTri(g, 1050, 360, 34, rgba(C.amber, a));
      txt(g, "warning: implicit declaration of function 'up_time'", 1085, 368, { f: 'mono', s: 18, w: 700, c: C.amber, al: a });
      txt(g, '→ 返回值被当成 int（有符号）接住', 1085, 400, { f: 'cjk', s: 20, w: 500, c: C.white, al: a });
    }
    if (t > L.cs[2]) {
      const a = eo(seg(t, L.cs[2], L.cs[2] + .5));
      const val = 123456;
      const w = 32 * 37 + 7 * 12 - 5, x0 = 960 - w / 2;
      g.save(); g.globalAlpha *= a;
      txt(g, '同一个寄存器，32 个比特', 960, 520, { f: 'cjk', s: 24, w: 700, c: C.mute, a: 'center' });
      bitsRow(g, val, x0, 545);
      const rA = eo(seg(t, L.cs[2] + .6, L.cs[2] + 1.1));
      panel(g, 330, 640, 560, 120, { p: rA, title: 'AS uint32_t' });
      panel(g, 1030, 640, 560, 120, { p: rA, title: 'AS int32_t' });
      digits(g, fmt(val), 610, 728, 56, { al: rA });
      digits(g, fmt(val), 1310, 728, 56, { al: rA });
      txt(g, '=', 960, 722, { f: 'disp', w: 900, s: 60, c: C.green, a: 'center', al: rA });
      g.restore();
    }
  },
});

addScene({
  id: 'bits', chap: 2,
  caps: ['平时，两种读法的结果一模一样', '直到计时器走到 2³¹ 毫秒，{最高位}变成了 1', '按有符号数读，它就成了[负数]', '而 2³¹ 毫秒，换算一下，是 {24.855 天}'],
  sfx: sc => {
    const a = []; for (let i = 0; i < 3; i++) a.push([.3 + i * .35, 'blip']);
    a.push([sc.cs[1] + .2, 'lock']); a.push([sc.cs[2] + .2, 'glitchHit', .6]); a.push([sc.cs[2] + 1.2, 'blip']); a.push([sc.cs[3] + .2, 'impact', .5]);
    return a;
  },
  fx: sc => [[sc.cs[2] + .2, 'glitch', .5, .3]],
  draw(g, L) {
    const t = L.t;
    const rows = [['0x00000000', '0', '0'], ['0x00000001', '1', '1'], ['0x7FFFFFFF', '2147483647', '2147483647'], ['0x80000000', '2147483648', '-2147483648'], ['0xFFFFFFFF', '4294967295', '-1']];
    const showT = [.3, .65, 1.0, L.cs[1] + .2, L.cs[2] + 1.2];
    const tabUp = eio(seg(t, L.cs[3], L.cs[3] + .8));
    const ty = 150 - tabUp * 0;
    panel(g, 260, ty, 1400, 450, { p: seg(t, 0, .6), title: 'SAME BITS · TWO READINGS', al: 1 - tabUp * .55 });
    const colX = [330, 900, 1350];
    g.save(); g.globalAlpha *= 1 - tabUp * .55;
    ['比特模式', 'uint32_t 读法', 'int32_t 读法'].forEach((h, i) => txt(g, h, colX[i], ty + 62, { f: 'cjk', s: 22, w: 700, c: C.mute, a: i ? 'right' : 'left' }));
    line(g, 300, ty + 80, 1620, ty + 80, rgba(C.cyan, .3), 1);
    rows.forEach((r, i) => {
      const a = eo(seg(t, showT[i], showT[i] + .35)); if (a <= 0) return;
      const y = ty + 135 + i * 64;
      const hot = i === 3;
      if (hot) { g.fillStyle = rgba(C.amber, .12 * a); g.fillRect(290, y - 42, 1340, 58); g.fillStyle = rgba(C.amber, a); g.fillRect(290, y - 42, 4, 58); }
      txt(g, r[0], colX[0], y, { f: 'mono', s: 30, w: 700, c: hot ? C.amber : C.cyan, al: a });
      txt(g, r[1], colX[1], y, { f: 'mono', s: 30, w: 700, c: C.white, a: 'right', al: a });
      const neg = r[2][0] === '-';
      const redOn = hot && t > L.cs[2] + .2;
      txt(g, r[2], colX[2] + (redOn ? (hash(Math.floor(t * 30)) - .5) * 8 * (1 - seg(t, L.cs[2] + .2, L.cs[2] + .6)) : 0), y, { f: 'mono', s: 30, w: 700, c: redOn ? C.red : neg && i === 4 ? '#ff8a9a' : C.white, a: 'right', al: a });
      if (redOn) txt(g, '← 负数！', colX[2] + 20, y, { f: 'cjk', s: 24, w: 700, c: C.red, al: blink(t, 2) });
    });
    g.restore();
    // 比特条：0x80000000
    if (t > L.cs[1] && tabUp < 1) {
      const a = eo(seg(t, L.cs[1] + .3, L.cs[1] + .8)) * (1 - tabUp);
      const w = 32 * 37 + 7 * 12 - 5, x0 = 960 - w / 2;
      g.save(); g.globalAlpha *= a;
      bitsRow(g, 0x80000000, x0, 650, { signC: t > L.cs[2] + .2 ? C.red : C.amber });
      txt(g, '↑ 符号位', x0 + 16, 730, { f: 'cjk', s: 22, w: 700, c: t > L.cs[2] + .2 ? C.red : C.amber, a: 'left' });
      g.restore();
    }
    if (tabUp > 0) {
      const a = tabUp;
      panel(g, 360, 640, 1200, 210, { p: a, c: C.amber, title: 'CONVERT' });
      txt(g, '2³¹ ms ÷ 86,400,000 ms/天', 960, 720, { f: 'cjk', s: 40, w: 700, c: C.white, a: 'center', al: a });
      txt(g, '≈ 24.855 天', 960, 805, { f: 'cjk', s: 64, w: 900, c: C.amber, a: 'center', al: eo(seg(t, L.cs[3] + .6, L.cs[3] + 1.1)) });
    }
  },
});

addScene({
  id: 'cause2', chap: 2,
  caps: ['根因二：整个项目{没有处理时间回绕}', '到处都是 now > deadline 这样，直接比大小', '时间一过 2³¹，now 的读数{跳到了最小的负数}', '它比之前算出的任何时刻都小，本该执行的逻辑，[再也不会执行]'],
  sfx: sc => [[0.2, 'type'], [sc.cs[1] + .2, 'blip'], [sc.cs[2] + .7, 'glitchHit'], [sc.cs[3] + .3, 'error'], [sc.cs[3] + 1.5, 'error'], [sc.cs[3] + 2.7, 'error']],
  fx: sc => [[sc.cs[2] + .7, 'glitch', .7, .35], [sc.cs[2] + .7, 'shake', 8, .3]],
  draw(g, L) {
    const t = L.t, W0 = L.cs[2] + .7;
    panel(g, 560, 150, 800, 190, { p: seg(t, 0, .6), title: 'motor.c（示意）', c: t > W0 ? C.red : C.cyan });
    drawCode(g, 610, 225, ['if (now > deadline) {', '    do_something();', '}'], { s: 28, lh: 42, p: seg(t, .3, 1.4), t, hl: t > L.cs[1] ? { 0: t > W0 ? C.red : C.amber } : null, width: 700 });
    // 时间轴：-2^31 .. 0 .. 2^31 .. 之后
    const ax0 = 180, ax1 = 1740, y = 560;
    const X = v => lerp(ax0, 1380, (v + 1) / 2); // v in [-1,1] 对应 [-2^31, 2^31]
    const a = eo(seg(t, .6, 1.3));
    g.save(); g.globalAlpha *= a;
    line(g, ax0, y, ax1, y, rgba(C.cyan, .7), 2);
    g.fillStyle = rgba(C.red, .07); g.fillRect(ax0, y - 70, X(0) - ax0, 140);
    g.fillStyle = rgba(C.cyan, .05); g.fillRect(X(0), y - 70, X(1) - X(0), 140);
    [[-1, '-2³¹'], [0, '0'], [1, '2³¹']].forEach(([v, s]) => { line(g, X(v), y - 14, X(v), y + 14, C.cyan, 2); txt(g, s, X(v), y + 50, { f: 'mono', s: 24, w: 700, c: C.cyan, a: 'center' }); });
    txt(g, '负数区', (ax0 + X(0)) / 2, y - 84, { f: 'cjk', s: 22, w: 700, c: rgba(C.red, .8), a: 'center' });
    txt(g, '正数区', (X(0) + X(1)) / 2, y - 84, { f: 'cjk', s: 22, w: 700, c: rgba(C.cyan, .8), a: 'center' });
    txt(g, '时间 →', ax1, y + 50, { f: 'cjk', s: 22, w: 700, c: C.mute, a: 'right' });
    g.restore();
    // deadline 标记（2^31 之后一点）
    const dX = X(1) + 130;
    if (t > L.cs[1]) {
      const k = eo(seg(t, L.cs[1] + .1, L.cs[1] + .5));
      g.save(); g.globalAlpha *= k;
      line(g, dX, y - 60, dX, y, C.amber, 3);
      g.fillStyle = C.amber; g.beginPath(); g.moveTo(dX, y - 60); g.lineTo(dX + 34, y - 50); g.lineTo(dX, y - 40); g.fill();
      txt(g, 'deadline', dX + 6, y - 74, { f: 'mono', s: 22, w: 700, c: C.amber, a: 'center' });
      g.restore();
    }
    // now 标记
    let nowX, wrapped = t > W0;
    if (!wrapped) nowX = lerp(X(.55), X(1), eio(seg(t, L.cs[1] + .3, W0)));
    else nowX = lerp(X(-1), X(-.82), seg(t, W0 + .3, L.d));
    if (t > .9) {
      const col = wrapped ? C.red : C.white;
      g.fillStyle = col; g.beginPath(); g.moveTo(nowX, y - 4); g.lineTo(nowX - 14, y - 30); g.lineTo(nowX + 14, y - 30); g.fill();
      txt(g, 'now', nowX, y - 40, { f: 'mono', s: 24, w: 700, c: col, a: 'center' });
      if (wrapped) {
        const k = seg(t, W0, W0 + .5);
        g.save(); g.strokeStyle = rgba(C.red, (1 - k) * .9); g.lineWidth = 3; g.setLineDash([10, 8]);
        g.beginPath(); g.moveTo(X(1), y - 10); g.quadraticCurveTo((X(1) + X(-1)) / 2, y - 260, X(-1), y - 10); g.stroke(); g.restore();
        txt(g, '-2147483648', nowX + 10, y + 96, { f: 'mono', s: 22, w: 700, c: C.red, a: 'left', al: eo(k) });
      }
    }
    // 判定读出
    if (t > L.cs[1] + .2) {
      const k = eo(seg(t, L.cs[1] + .2, L.cs[1] + .6));
      panel(g, 560, 700, 800, 130, { p: k, c: wrapped ? C.red : C.cyan, title: 'EVAL' });
      txt(g, 'now > deadline  →', 620, 785, { f: 'mono', s: 32, w: 700, c: C.white, al: k });
      const res = 'false', col = wrapped ? C.red : C.mute;
      txt(g, res, 1060, 785, { f: 'mono', s: 36, w: 700, c: col, al: k * (wrapped ? blink(t, 2) : 1) });
      if (t > L.cs[3] + .2) txt(g, '永远 false', 1180, 785, { f: 'cjk', s: 30, w: 900, c: C.red, al: eo(seg(t, L.cs[3] + .2, L.cs[3] + .6)) });
    }
  },
});

addScene({
  id: 'reboot', chap: 2,
  caps: ['这也解释了，为什么{重启就好}了', '重启后计时器从 0 开始数，又能撑 24.85 天'],
  sfx: sc => [[0.3, 'power'], [0.9, 'confirm'], [sc.cs[1] + .4, 'blip']],
  draw(g, L) {
    const t = L.t;
    const k = eo(seg(t, .2, 1));
    ringBase(g, 960, 470, 260, t, { al: k });
    const u = Math.max(0, (t - .9) * .018);
    ringArc(g, 960, 470, 260, 0, Math.min(.5, u), C.green, 10, k);
    ringPoint(g, 960, 470, 260, Math.min(.5, u), C.green, null, { t });
    const ms = Math.floor(Math.max(0, t - .9) * 1000);
    digits(g, String(ms), 960, 490, 92, { c: C.white, al: k });
    txt(g, 'uptime (ms)', 960, 545, { f: 'mono', s: 20, w: 700, ls: 4, c: C.cyan, a: 'center', al: k });
    if (t < 1.1) powerIcon(g, 960, 470, 40, rgba(C.amber, 1 - seg(t, .7, 1.1)));
    if (t > L.cs[1]) {
      const a = eo(seg(t, L.cs[1] + .3, L.cs[1] + .8));
      // 下一次：半圈处
      ringPoint(g, 960, 470, 260, .5, C.amber, null, { t, al: a });
      txt(g, '下一次：24.85 天后', 960, 470 + 260 + 80, { f: 'cjk', s: 30, w: 900, c: C.amber, a: 'center', al: a * blink(t, 1.2) });
    }
  },
});

/* ---------- 03 第一次修复 ---------- */
chapterCard(3, '第一次修复', 'THE FIX', '补上声明，照着 Linux 处理回绕');

addScene({
  id: 'fix1', chap: 3,
  caps: ['第一步：补上声明，时间统一改回 {uint32_t}'],
  post: 1.4,
  sfx: sc => [[0.3, 'type'], [1.2, 'type'], [2.4, 'confirm']],
  draw(g, L) {
    const t = L.t;
    panel(g, 410, 230, 1100, 330, { p: seg(t, 0, .6), title: 'git diff motor.c' });
    drawCode(g, 470, 320, ['  /* motor.c */', '+ #include "clock.h"', '- int32_t  now = up_time();', '+ uint32_t now = up_time();'], { s: 30, lh: 52, p: seg(t, .4, 2.2), t, diff: true, width: 980, hlA: .13 });
    if (t > 2.4) {
      const a = eo(seg(t, 2.4, 2.8));
      chip(g, 'BUILD OK  ·  0 WARNINGS', 960, 640, { s: 22, c: C.green, a: 'center', al: a });
    }
  },
});

addScene({
  id: 'ring', chap: 3,
  caps: ['第二步，处理回绕。先换个角度看问题——', '32 位计数器，{不是一条直线}', '而是一个周长 {2³²} 的环：走满一圈，回到 0'],
  sfx: sc => [[sc.cs[1] + .2, 'blip'], [sc.cs[2] + .1, 'whoosh'], [sc.cs[2] + 1.4, 'confirm']],
  draw(g, L) {
    const t = L.t;
    const m = eio(seg(t, L.cs[2] + .1, L.cs[2] + 1.5)); // 0 直线 → 1 环
    const cx = 960, cy = 480, R = 290, x0 = 260, x1 = 1660, ly = 520;
    const P = u => {
      const lx = lerp(x0, x1, u), lyy = ly;
      const a = angU(u), rx = cx + Math.cos(a) * R, ry = cy + Math.sin(a) * R;
      return [lerp(lx, rx, m), lerp(lyy, ry, m)];
    };
    const a = eo(seg(t, .2, 1));
    if (m > .98) ringBase(g, cx, cy, R, t, { al: seg(m, .98, 1), labels: [[.25, '2³⁰'], [.5, '2³¹'], [.75, '3·2³⁰']] });
    // 曲线
    g.save(); g.globalAlpha *= a; g.strokeStyle = C.cyan; g.lineWidth = 4; g.beginPath();
    for (let i = 0; i <= 200; i++) { const [x, y] = P(i / 200); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    // 刻度
    for (let i = 0; i <= 16; i++) {
      const [x, y] = P(i / 16); g.fillStyle = C.cyan; g.fillRect(x - 2, y - 2, 4, 4);
    }
    g.restore();
    if (m < .6) {
      const b = (1 - m / .6) * a;
      txt(g, '0', x0, ly + 50, { f: 'mono', s: 26, w: 700, c: C.cyan, a: 'center', al: b });
      txt(g, '2³¹', (x0 + x1) / 2, ly + 50, { f: 'mono', s: 26, w: 700, c: C.cyan, a: 'center', al: b });
      txt(g, '2³² − 1', x1, ly + 50, { f: 'mono', s: 26, w: 700, c: C.cyan, a: 'center', al: b });
      txt(g, '???', x1 + 90, ly + 10, { f: 'mono', s: 30, w: 700, c: C.amber, a: 'center', al: b * seg(t, L.cs[1], L.cs[1] + .5) });
    }
    // 跑动的点
    const u = (t * .16) % 1;
    const [px, py] = P(u);
    g.fillStyle = C.white; g.beginPath(); g.arc(px, py, 11, 0, TAU); g.fill();
    g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.arc(px, py, 20 + 4 * pulse(t, 1.5), 0, TAU); g.stroke();
    if (m > .99) {
      const k = eo(seg(t, L.cs[2] + 1.5, L.cs[2] + 2));
      txt(g, '0 = 2³²', cx, cy - R - 62, { f: 'mono', s: 28, w: 700, c: C.amber, a: 'center', al: k });
      txt(g, '周长 2³² ms ≈ 49.7 天', cx, cy + 12, { f: 'cjk', s: 34, w: 900, c: C.white, a: 'center', al: k });
    }
  },
});

addScene({
  id: 'timeafter', chap: 3,
  caps: ['然后照着 Linux 的 {time_after}，写了一个 32 位版本', '先{无符号相减}，再把差值当成{有符号数}看正负', '比的是{方向}，不是大小', '哪怕刚好跨过回绕点，结论也是对的'],
  sfx: sc => [[0.3, 'type'], [1.6, 'type'], [sc.cs[1] + .4, 'blip'], [sc.cs[1] + 1.4, 'blip2'], [sc.cs[2] + .4, 'error', .6], [sc.cs[2] + 1.2, 'confirm']],
  draw(g, L) {
    const t = L.t;
    panel(g, 90, 150, 920, 330, { p: seg(t, 0, .6), title: 'include/linux/jiffies.h' });
    drawCode(g, 130, 222, ['#define time_after(a,b)        \\', '    (typecheck(unsigned long, a) && \\', '     typecheck(unsigned long, b) && \\', '     ((long)((b) - (a)) < 0))'], { s: 23, lh: 40, p: seg(t, .3, 1.5), t, width: 860 });
    panel(g, 90, 520, 920, 220, { p: seg(t, 1.3, 1.9), title: '32 位 ms 版本', c: C.green });
    drawCode(g, 130, 595, ['#define time_after32(a, b) \\', '    ((int32_t)((uint32_t)(b) - (uint32_t)(a)) < 0)'], { s: 23, lh: 40, p: seg(t, 1.6, 2.8), t, width: 860, hl: t > L.cs[1] ? { 1: C.green } : null });
    // 环
    const cx = 1440, cy = 370, R = 200;
    const rk = eo(seg(t, L.cs[1], L.cs[1] + .6));
    ringBase(g, cx, cy, R, t, { al: rk, labels: [[0, '0'], [.5, '2³¹']], labelR: 64, labelS: 18 });
    if (rk > 0) {
      const uD = 1 - .06, uN = .06; // 示意：deadline 在 0 之前，now 在 0 之后
      // 无符号差值：从 now 顺时针走到 deadline（很长的一圈）
      const k1 = eio(seg(t, L.cs[1] + .4, L.cs[1] + 1.3));
      ringArc(g, cx, cy, R, uN, lerp(uN, uD, k1), rgba(C.mute, .7), 5, rk * (1 - seg(t, L.cs[1] + 1.6, L.cs[1] + 2.1) * .7));
      // 有符号解读：-32，往回走很短
      const k2 = eio(seg(t, L.cs[1] + 1.4, L.cs[1] + 2));
      if (k2 > 0) ringArc(g, cx, cy, R - 26, uN, lerp(uN, uN - .12, k2), C.green, 7, rk);
      ringPoint(g, cx, cy, R, uD, C.amber, 'deadline', { t, al: rk, lr: 60, lf: 'mono', ls: 18 });
      ringPoint(g, cx, cy, R, uN, C.white, 'now', { t, al: rk, lr: 60, lf: 'mono', ls: 18 });
      txt(g, '(示意)', cx + R + 40, cy + R + 20, { f: 'cjk', s: 16, c: C.mute, a: 'center', al: rk });
      if (k1 > .9) txt(g, 'b − a = 0xFFFFFFE0', cx, cy + 10, { f: 'mono', s: 22, w: 700, c: C.mute, a: 'center', al: seg(k1, .9, 1) * (1 - k2 * .6) });
      if (k2 > .3) txt(g, '按 int32_t 读 = −32', cx, cy + 46, { f: 'mono', s: 22, w: 700, c: C.green, a: 'center', al: seg(k2, .3, 1) });
    }
    // 对比读出
    if (t > L.cs[2]) {
      const k = eo(seg(t, L.cs[2], L.cs[2] + .5));
      panel(g, 1060, 690, 780, 170, { p: k, title: 'now = 0x00000010   deadline = 0xFFFFFFF0' });
      txt(g, 'now > deadline', 1100, 765, { f: 'mono', s: 26, w: 700, c: C.white, al: k });
      txt(g, 'false', 1560, 765, { f: 'mono', s: 26, w: 700, c: C.red, al: k });
      cross(g, 1720, 755, 26, C.red, seg(t, L.cs[2] + .4, L.cs[2] + .7));
      const k2 = eo(seg(t, L.cs[2] + 1.0, L.cs[2] + 1.4));
      txt(g, 'time_after32(now, deadline)', 1100, 822, { f: 'mono', s: 26, w: 700, c: C.white, al: k2 });
      txt(g, 'true', 1560, 822, { f: 'mono', s: 26, w: 700, c: C.green, al: k2 });
      check(g, 1720, 815, 30, C.green, seg(t, L.cs[2] + 1.2, L.cs[2] + 1.6));
    }
  },
});

addScene({
  id: 'ship', chap: 3,
  caps: ['修完，发版，提测', '说实话，我当时{挺有信心}'],
  sfx: sc => [[.5, 'confirm'], [1.0, 'confirm'], [1.5, 'confirm'], [sc.cs[1] + .3, 'riserUp']],
  draw(g, L) {
    const t = L.t;
    const nodes = [['BUILD', '编译'], ['RELEASE', '发版'], ['QA', '提测']];
    nodes.forEach(([en, zh], i) => {
      const x = 560 + i * 400, y = 430;
      const a = eo(seg(t, .1 + i * .15, .5 + i * .15));
      panel(g, x - 140, y - 110, 280, 220, { p: a, c: t > .5 + i * .5 ? C.green : C.cyan });
      txt(g, en, x, y - 30, { f: 'mono', s: 26, w: 700, ls: 4, c: C.cyan, a: 'center', al: a });
      txt(g, zh, x, y + 20, { f: 'cjk', s: 34, w: 900, c: C.white, a: 'center', al: a });
      check(g, x, y + 66, 36, C.green, seg(t, .5 + i * .5, .8 + i * .5));
      if (i < 2) { const k = eo(seg(t, .6 + i * .5, 1 + i * .5)); line(g, x + 150, y, x + 150 + 100 * k, y, C.green, 3); }
    });
    if (t > L.cs[1]) {
      const k = eio(seg(t, L.cs[1] + .3, L.cs[1] + 1.6));
      panel(g, 560, 650, 800, 110, { p: eo(seg(t, L.cs[1], L.cs[1] + .4)), title: 'CONFIDENCE' });
      g.fillStyle = rgba(C.green, .15); g.fillRect(600, 690, 720, 34);
      g.fillStyle = C.green; g.fillRect(600, 690, 720 * k, 34);
      txt(g, Math.round(k * 100) + '%', 1320, 745, { f: 'mono', s: 22, w: 700, c: C.green, a: 'right' });
    }
  },
});

/* ---------- 04 24.85 天后 ---------- */
chapterCard(4, '24.85 天后', '24.85 DAYS LATER', '同一个坑，换了个姿势');

addScene({
  id: 'soak', chap: 4, post: 0.5,
  caps: ['测试开始连续挂测', '这种问题，每验证一次，都得{真的等上 24.85 天}'],
  sfx: sc => { const a = []; let tt = .3; while (tt < sc.d - .2) { a.push([tt, 'tick', .5]); tt += Math.max(.08, .5 - tt * .06); } return a; },
  draw(g, L) {
    const t = L.t;
    const k = eio(seg(t, .4, L.d - .15));
    const days = 24.855 * k;
    panel(g, 260, 170, 1400, 620, { p: seg(t, 0, .6), title: 'SOAK TEST' });
    txt(g, 'DAY', 520, 430, { f: 'mono', s: 40, w: 700, ls: 8, c: C.cyan, a: 'right' });
    digits(g, days.toFixed(2).padStart(5, '0'), 900, 455, 170, { c: C.white });
    // 昼夜条
    const dayFrac = days % 1;
    g.save(); g.translate(1390, 380);
    g.strokeStyle = rgba(C.cyan, .4); g.lineWidth = 2; g.beginPath(); g.arc(0, 40, 110, Math.PI, TAU); g.stroke();
    const sa = Math.PI + dayFrac * Math.PI * 2;
    const sun = dayFrac < .5;
    g.fillStyle = sun ? C.amber : C.blue;
    g.beginPath(); g.arc(Math.cos(sa) * 110, 40 + Math.sin(sa) * 110 * (sun ? 1 : -1), 16, 0, TAU); g.fill();
    g.restore();
    // 进度条
    const bx = 340, by = 600, bw = 1240;
    g.fillStyle = rgba(C.cyan, .1); g.fillRect(bx, by, bw, 26);
    g.fillStyle = C.cyan; g.fillRect(bx, by, bw * k, 26);
    for (let d = 0; d <= 25; d++) { const x = bx + bw * d / 24.855; if (x > bx + bw) break; line(g, x, by + 30, x, by + (d % 5 === 0 ? 48 : 38), rgba(C.cyan, .6), 1.5); if (d % 5 === 0) txt(g, String(d), x, by + 74, { f: 'mono', s: 18, c: C.mute, a: 'center' }); }
    txt(g, '2³¹ ms', bx + bw, by - 16, { f: 'mono', s: 20, w: 700, c: C.amber, a: 'right' });
    txt(g, '设备运行中 · 窗帘自动开合', 340, 260, { f: 'cjk', s: 24, w: 700, c: C.mute });
    chip(g, 'RUNNING', 1580, 252, { s: 15, c: C.green, a: 'right', al: blink(t, 1) });
  },
});

addScene({
  id: 'fail2', chap: 4, post: 0.9,
  caps: [['24.85 天，一到点——', 2.4], ['[另一个功能，又不能用了]', 3.2]],
  sfx: sc => [[.2, 'tick'], [.8, 'tick'], [1.4, 'tick'], [sc.cs[1], 'glitchHit'], [sc.cs[1] + .1, 'alarm']],
  fx: sc => [[sc.cs[1], 'glitch', 1, .6], [sc.cs[1], 'shake', 16, .6], [sc.cs[1], 'flash', '#ff3d5a', .35]],
  draw(g, L) {
    const t = L.t, F_ = L.cs[1], bad = t > F_;
    const col = bad ? C.red : C.cyan;
    panel(g, 260, 170, 1400, 620, { p: 1, title: bad ? 'FAULT' : 'SOAK TEST', c: col });
    if (!bad) {
      txt(g, 'DAY', 520, 430, { f: 'mono', s: 40, w: 700, ls: 8, c: C.cyan, a: 'right' });
      digits(g, '24.85', 900, 455, 170, { c: C.white, al: blink(t, 1.6) });
      g.fillStyle = C.cyan; g.fillRect(340, 600, 1240, 26);
    } else {
      g.fillStyle = rgba(C.red, .08 + .06 * blink(t, 3)); g.fillRect(262, 172, 1396, 616);
      warnTri(g, 960, 330, 120, C.red);
      glitchTxt(g, 'FUNCTION FAULT', 960, 520, { f: 'disp', w: 900, s: 96, c: C.red, a: 'center', ls: 6 }, 1 - seg(t, F_, F_ + .8), Math.floor(t * 30));
      txt(g, '另一个功能：无响应', 960, 600, { f: 'cjk', s: 40, w: 900, c: C.white, a: 'center' });
      txt(g, 'uptime ≥ 2³¹ ms', 960, 670, { f: 'mono', s: 26, w: 700, c: C.amber, a: 'center' });
    }
  },
});

addScene({
  id: 'trap', chap: 4, post: 1.2,
  caps: ['第二次的原因更扎心：{写法本身没有错}', '错的是，两个时间点隔得太远，超过了 {2³¹}', '看符号的办法，只在{半圈以内}有效', '一旦超过半圈，先后关系就[翻了过来]'],
  sfx: sc => [[sc.cs[1] + .2, 'hum'], [sc.cs[2] + .2, 'blip'], [sc.cs[3] + .9, 'glitchHit'], [sc.cs[3] + 1.0, 'error']],
  fx: sc => [[sc.cs[3] + .9, 'glitch', .6, .3]],
  draw(g, L) {
    const t = L.t;
    const cx = 760, cy = 470, R = 300;
    const rk = eo(seg(t, 0, .7));
    ringBase(g, cx, cy, R, t, { al: rk, labels: [[.5, '2³¹（半圈）', C.amber]], labelR: 84, labelS: 22 });
    // 有效 / 翻转 半区
    const zk = eo(seg(t, L.cs[2] + .1, L.cs[2] + .7));
    if (zk > 0) {
      ringArc(g, cx, cy, R + 34, 0.005, 0.495, rgba(C.green, .5), 6, zk);
      ringArc(g, cx, cy, R + 34, 0.505, 0.995, rgba(C.red, .5), 6, zk);
      txt(g, '有效区', cx + R + 120, cy - 40, { f: 'cjk', s: 26, w: 900, c: C.green, a: 'center', al: zk });
      txt(g, '翻转区', cx - R - 120, cy - 40, { f: 'cjk', s: 26, w: 900, c: C.red, a: 'center', al: zk });
    }
    // b 从 a 出发，顺时针越走越远
    const cross0 = L.cs[3] + .9;
    let u;
    if (t < cross0) u = lerp(.03, .497, eio(seg(t, .8, cross0)));
    else u = lerp(.497, .66, eo(seg(t, cross0, cross0 + 2.2)));
    const flipped = u > .5;
    const col = flipped ? C.red : C.green;
    ringArc(g, cx, cy, R, 0, u, col, 10, rk);
    ringPoint(g, cx, cy, R, 0, C.white, 'a', { t, al: rk, lr: -60, lf: 'mono', ls: 26 });
    ringPoint(g, cx, cy, R, u, col, 'b', { t, al: rk, lr: -60, lf: 'mono', ls: 26 });
    // 读出
    const d = Math.round(u * 4294967296) >>> 0;
    const sd = d | 0;
    const pk = eo(seg(t, .5, 1.1));
    panel(g, 1240, 220, 560, 470, { p: pk, title: 'time_after32(b, a)', c: flipped ? C.red : C.cyan });
    txt(g, 'd = (uint32_t)(a − b)', 1280, 300, { f: 'mono', s: 22, w: 700, c: C.mute, al: pk });
    const nd = (-d) >>> 0, snd = nd | 0;
    txt(g, hex8(nd), 1280, 350, { f: 'mono', s: 34, w: 700, c: C.white, al: pk });
    txt(g, '(int32_t)d =', 1280, 420, { f: 'mono', s: 22, w: 700, c: C.mute, al: pk });
    txt(g, String(snd), 1280, 470, { f: 'mono', s: 34, w: 700, c: snd < 0 ? C.green : C.red, al: pk });
    line(g, 1270, 505, 1770, 505, rgba(C.cyan, .3), 1, pk);
    txt(g, flipped ? '判定：b 在 a 之前' : '判定：b 在 a 之后', 1280, 565, { f: 'cjk', s: 32, w: 900, c: col, al: pk });
    if (flipped) cross(g, 1720, 555, 34, C.red, seg(t, cross0, cross0 + .3)); else check(g, 1720, 555, 38, C.green, 1);
    txt(g, '间隔 ≈ ' + (u * 49.71).toFixed(2) + ' 天', 1280, 640, { f: 'cjk', s: 26, w: 700, c: C.white, al: pk });
  },
});

addScene({
  id: 'luck', chap: 4,
  caps: ['这个限制，我其实知道', '只是心存侥幸：业务里，谁会去比较两个{相隔 24 天以上}的时间呢？', '事实证明，你永远不知道[屎山]里藏着什么惊喜'],
  sfx: sc => [[sc.cs[1] + .3, 'blip'], [sc.cs[2] + .3, 'scan'], [sc.cs[2] + 1.3, 'glitchHit', .7], [sc.cs[2] + 1.4, 'alarm', .5]],
  fx: sc => [[sc.cs[2] + 1.3, 'glitch', .5, .3]],
  draw(g, L) {
    const t = L.t;
    // 左：概率表
    const gk = eo(seg(t, .1, .7));
    panel(g, 140, 180, 640, 560, { p: gk, title: '侥幸指数' });
    const gx = 460, gy = 560, gr = 220;
    g.save(); g.globalAlpha *= gk;
    g.lineWidth = 22;
    g.strokeStyle = rgba(C.green, .5); g.beginPath(); g.arc(gx, gy, gr, Math.PI, Math.PI * 1.5); g.stroke();
    g.strokeStyle = rgba(C.amber, .5); g.beginPath(); g.arc(gx, gy, gr, Math.PI * 1.5, Math.PI * 1.8); g.stroke();
    g.strokeStyle = rgba(C.red, .6); g.beginPath(); g.arc(gx, gy, gr, Math.PI * 1.8, TAU); g.stroke();
    let needle = .06 + .02 * Math.sin(t * 3);
    const hit = L.cs[2] + 1.3;
    if (t > hit) needle = lerp(needle, .97, eback(seg(t, hit, hit + .6)));
    const na = Math.PI + needle * Math.PI;
    line(g, gx, gy, gx + Math.cos(na) * (gr - 30), gy + Math.sin(na) * (gr - 30), C.white, 5);
    g.fillStyle = C.white; g.beginPath(); g.arc(gx, gy, 12, 0, TAU); g.fill();
    txt(g, t > hit ? '它真的发生了' : '不可能吧', gx, gy + 80, { f: 'cjk', s: 34, w: 900, c: t > hit ? C.red : C.green, a: 'center' });
    g.restore();
    // 右：屎山
    const mk = eo(seg(t, L.cs[1] + .2, L.cs[1] + 1));
    panel(g, 860, 180, 920, 560, { p: mk, title: 'LEGACY CODE', c: t > hit ? C.red : C.cyan });
    if (mk > .3) {
      g.save(); g.beginPath(); g.rect(862, 182, 916, 556); g.clip();
      const base = 720, cols = 26;
      for (let i = 0; i < cols; i++) {
        const hgt = Math.round((1 - Math.pow(Math.abs(i - cols / 2) / (cols / 2), 1.6)) * 12) + 1;
        for (let j = 0; j < hgt; j++) {
          const x = 900 + i * 33, y = base - (j + 1) * 34;
          const isBug = i === 15 && j === 4;
          const appear = seg(mk, .3 + hash(i * 31 + j) * .4, .5 + hash(i * 31 + j) * .4);
          if (appear <= 0) continue;
          g.globalAlpha = appear;
          g.fillStyle = isBug && t > hit ? rgba(C.red, .85 * blink(t, 3)) : rgba(C.cyan, .06 + .1 * hash(i + j * 7));
          g.fillRect(x, y, 30, 30);
          g.strokeStyle = isBug && t > hit ? C.red : rgba(C.cyan, .35); g.lineWidth = 1; g.strokeRect(x + .5, y + .5, 29, 29);
        }
      }
      g.globalAlpha = 1;
      // 扫描
      if (t > L.cs[2] + .3 && t < hit + .3) {
        const sy = lerp(260, 720, seg(t, L.cs[2] + .3, hit));
        g.fillStyle = rgba(C.cyan, .6); g.fillRect(862, sy, 916, 2);
      }
      g.restore();
      if (t > hit) {
        const k = eo(seg(t, hit, hit + .4));
        const bx = 900 + 15 * 33 + 15, by = 720 - 5 * 34 + 15;
        line(g, bx, by, bx + 120, by - 160, C.red, 2, k);
        panel(g, bx + 40, by - 250, 340, 90, { p: k, c: C.red, noGrid: true });
        txt(g, '跨度 > 2³¹ 的比较', bx + 210, by - 193, { f: 'cjk', s: 28, w: 900, c: C.red, a: 'center', al: k });
      }
    }
  },
});

addScene({
  id: 'blame', chap: 4, post: 1.0,
  caps: ['于是又被项目、测试、老板、甲方，{按在地上摩擦}了一遍'],
  sfx: sc => [[.5, 'stamp'], [.95, 'stamp'], [1.4, 'stamp'], [1.85, 'stamp']],
  fx: sc => [[.5, 'shake', 7, .2], [.95, 'shake', 8, .2], [1.4, 'shake', 9, .2], [1.85, 'shake', 12, .3]],
  draw(g, L) {
    const t = L.t;
    const who = ['项目', '测试', '老板', '甲方'];
    who.forEach((s, i) => {
      const t0 = .5 + i * .45;
      const k = seg(t, t0 - .12, t0);
      if (k <= 0) return;
      const sc = lerp(2.6, 1, eo(k));
      const x = 360 + i * 400, y = 470 + (i % 2 ? 30 : -30);
      g.save(); g.translate(x, y); g.rotate((hash(i + 3) - .5) * .35); g.scale(sc, sc); g.globalAlpha *= eo(k);
      g.strokeStyle = C.red; g.lineWidth = 6; g.strokeRect(-150, -90, 300, 180);
      g.lineWidth = 2; g.strokeRect(-138, -78, 276, 156);
      txt(g, s, 0, 26, { f: 'cjk', w: 900, s: 86, c: C.red, a: 'center' });
      txt(g, 'ESCALATED', 0, 62, { f: 'mono', w: 700, s: 16, ls: 6, c: rgba(C.red, .85), a: 'center' });
      g.restore();
    });
  },
});

/* ---------- 05 含泪总结 ---------- */
chapterCard(5, '含泪总结', 'LESSONS LEARNED', '四条教训，帮你少等两个 24.85 天');

function lessonFrame(g, L, n, title, en) {
  const t = L.t, a = eo(seg(t, 0, .6));
  txt(g, '0' + n, 300, 455, { f: 'disp', w: 900, s: 210, noFill: true, stroke: rgba(C.cyan, .9 * a), lw: 3, a: 'center' });
  txt(g, '0' + n, 300, 455, { f: 'disp', w: 900, s: 210, c: rgba(C.cyan, .08 * a), a: 'center' });
  const lines = title.split('\n');
  lines.forEach((s, i) => txt(g, s, 130, 530 + i * 70, { f: 'cjk', w: 900, s: 54, c: C.white, al: eo(seg(t, .2 + i * .12, .7 + i * .12)) }));
  txt(g, en, 132, 530 + lines.length * 70 + 4, { f: 'mono', w: 700, s: 18, ls: 5, c: C.cyan, al: eo(seg(t, .5, 1)) });
  line(g, 130, 236, 130 + 520 * a, 236, rgba(C.cyan, .4), 1);
  txt(g, `LESSON ${n} / 4`, 130, 222, { f: 'mono', s: 16, w: 700, ls: 5, c: C.mute, al: a });
}

addScene({
  id: 'l1', chap: 5,
  caps: ['隐式函数声明，是 C 语言留下的老坑', '加上这个编译选项，让它{直接编译失败}——问题当场暴露'],
  sfx: sc => [[.4, 'type'], [sc.cs[1] + .2, 'type'], [sc.cs[1] + 1.4, 'error', .7]],
  draw(g, L) {
    const t = L.t;
    lessonFrame(g, L, 1, '别让编译器\n替你猜类型', 'NO IMPLICIT DECLARATION');
    panel(g, 760, 200, 1040, 560, { p: seg(t, .2, .8), title: 'TERMINAL' });
    const cmd = ['$ gcc -c motor.c \\', '      -Werror=implicit-function-declaration'];
    drawCode(g, 800, 280, cmd, { s: 24, lh: 40, p: seg(t, L.cs[1], L.cs[1] + 1.2), t, width: 960 });
    if (t > L.cs[1] + 1.4) {
      const k = eo(seg(t, L.cs[1] + 1.4, L.cs[1] + 1.8));
      g.save(); g.globalAlpha *= k;
      txt(g, 'motor.c: error: implicit declaration', 800, 410, { f: 'mono', s: 23, w: 700, c: C.red });
      txt(g, "         of function 'up_time'", 800, 446, { f: 'mono', s: 23, w: 700, c: C.red });
      drawCode(g, 800, 510, ['    int32_t now = up_time();', '                  ^~~~~~~'], { s: 23, lh: 38, width: 960 });
      chip(g, 'BUILD FAILED', 800, 640, { s: 20, c: C.red });
      txt(g, '← 这正是我们想要的', 1030, 648, { f: 'cjk', s: 26, w: 700, c: C.green });
      g.restore();
    }
  },
});

addScene({
  id: 'l2', chap: 5,
  caps: ['时间点比先后，用 {time_after}，别直接用 > 和 <', '但它只在半圈内有效：32 位毫秒，就是 {24.85 天}', '所有超时都要钳在这个范围内，Linux 的 {MAX_JIFFY_OFFSET} 就是干这个的'],
  sfx: sc => [[.4, 'type'], [sc.cs[1] + .3, 'blip'], [sc.cs[2] + .3, 'lock']],
  draw(g, L) {
    const t = L.t;
    lessonFrame(g, L, 2, '比先后：\n无符号相减，看符号', 'COMPARE DIRECTION, NOT SIZE');
    panel(g, 760, 180, 1040, 300, { p: seg(t, .2, .8), title: 'time.h' });
    drawCode(g, 800, 255, ['#define time_after32(a, b) \\', '    ((int32_t)((uint32_t)(b) - (uint32_t)(a)) < 0)', '', 'if (time_after32(now, deadline))', '    do_something();'], { s: 22, lh: 40, p: seg(t, .4, 2), t, width: 960 });
    const k = eo(seg(t, L.cs[1], L.cs[1] + .5));
    panel(g, 760, 520, 500, 300, { p: k, title: 'VALID RANGE', c: C.amber });
    if (k > 0) {
      ringBase(g, 1010, 690, 90, t, { al: k * .6 });
      ringArc(g, 1010, 690, 90, 0, .5 * eio(seg(t, L.cs[1] + .3, L.cs[1] + 1.2)), C.amber, 12, k);
      txt(g, '2³¹ ms', 1010, 685, { f: 'mono', s: 20, w: 700, c: C.amber, a: 'center', al: k });
      txt(g, '≈ 24.85 天', 1010, 712, { f: 'cjk', s: 18, w: 700, c: C.white, a: 'center', al: k });
    }
    const k2 = eo(seg(t, L.cs[2], L.cs[2] + .5));
    panel(g, 1300, 520, 500, 300, { p: k2, title: 'LINUX' });
    drawCode(g, 1330, 600, ['#define MAX_JIFFY_OFFSET \\', '    ((LONG_MAX >> 1) - 1)'], { s: 19, lh: 34, al: k2, width: 450 });
    txt(g, '所有超时钳在半周期以内', 1330, 720, { f: 'cjk', s: 24, w: 700, c: C.white, al: k2 });
    txt(g, 'time_after 才处处成立', 1330, 758, { f: 'cjk', s: 24, w: 700, c: C.green, al: k2 });
  },
});

addScene({
  id: 'l3', chap: 5,
  caps: ['只关心"过了多久"，就直接{无符号相减}', '模运算天然正确，能用满一整圈：{49.7 天}', '用 last_run += period，节拍不会越跑越漂'],
  sfx: sc => [[.4, 'type'], [sc.cs[1] + .3, 'blip'], [sc.cs[2] + .3, 'blip2']],
  draw(g, L) {
    const t = L.t;
    lessonFrame(g, L, 3, '算间隔：\n直接无符号相减', 'ELAPSED = NOW − START');
    panel(g, 760, 180, 1040, 300, { p: seg(t, .2, .8), title: 'periodic task' });
    drawCode(g, 800, 255, ['if ((uint32_t)(now - last_run) >= period) {', '    last_run += period;  /* 不写 = now，避免漂移 */', '    run_task();', '}'], { s: 22, lh: 44, p: seg(t, .4, 2), t, width: 960, hl: t > L.cs[2] ? { 1: C.green } : null });
    const k = eo(seg(t, L.cs[1], L.cs[1] + .5));
    panel(g, 760, 520, 500, 300, { p: k, title: 'VALID RANGE', c: C.green });
    if (k > 0) {
      ringBase(g, 1010, 690, 90, t, { al: k * .6 });
      ringArc(g, 1010, 690, 90, 0, .999 * eio(seg(t, L.cs[1] + .3, L.cs[1] + 1.4)), C.green, 12, k);
      txt(g, '2³² ms', 1010, 685, { f: 'mono', s: 20, w: 700, c: C.green, a: 'center', al: k });
      txt(g, '≈ 49.7 天', 1010, 712, { f: 'cjk', s: 18, w: 700, c: C.white, a: 'center', al: k });
    }
    const k2 = eo(seg(t, L.cs[2], L.cs[2] + .5));
    panel(g, 1300, 520, 500, 300, { p: k2, title: 'NO DRIFT' });
    if (k2 > 0) {
      // 两条节拍线对比
      const yy = [640, 740];
      ['+= period', '= now'].forEach((s, i) => {
        txt(g, s, 1330, yy[i] - 26, { f: 'mono', s: 18, w: 700, c: i ? C.amber : C.green, al: k2 });
        line(g, 1330, yy[i], 1770, yy[i], rgba(C.cyan, .3), 1, k2);
        for (let n = 0; n < 6; n++) {
          const x = 1340 + n * 80 + (i ? n * n * 2.2 : 0);
          g.fillStyle = i ? C.amber : C.green; g.globalAlpha = k2; g.fillRect(x - 3, yy[i] - 12, 6, 24); g.globalAlpha = 1;
        }
      });
    }
  },
});

addScene({
  id: 'l4', chap: 5,
  caps: ['64 位毫秒，要 {2.92 亿年} 才走完半圈', '对任何业务来说，都等于没有上限', '硬件只给 32 位？{发现回绕就进位}，自己拼出 64 位'],
  sfx: sc => [[.5, 'blip'], [.9, 'blip'], [1.3, 'impact', .5], [sc.cs[2] + .3, 'type']],
  draw(g, L) {
    const t = L.t;
    lessonFrame(g, L, 4, '最省心：\n换成 64 位', 'JUST GO 64-BIT');
    panel(g, 760, 170, 1040, 270, { p: seg(t, .2, .8), title: 'HALF PERIOD @ 1 ms TICK' });
    const bars = [['16 位', '32.77 秒', 15, C.red], ['32 位', '24.855 天', 31, C.amber], ['64 位', '2.92 亿年', 63, C.green]];
    bars.forEach(([n, v, e, c], i) => {
      const k = eo(seg(t, .5 + i * .4, 1.1 + i * .4));
      const y = 240 + i * 66;
      txt(g, n, 800, y + 20, { f: 'cjk', s: 24, w: 900, c: C.white, al: k });
      const bw = 820 * (e / 63) * k;
      g.fillStyle = rgba(c, .85); g.fillRect(890, y, bw * .72, 28);
      txt(g, v, 900 + bw * .72, y + 23, { f: 'cjk', s: 24, w: 900, c, al: k });
    });
    txt(g, '（长度按 2 的指数画）', 1780, 430, { f: 'cjk', s: 16, c: C.mute, a: 'right', al: seg(t, 1.5, 2) });
    const k2 = seg(t, L.cs[2], L.cs[2] + .4);
    panel(g, 760, 480, 1040, 360, { p: k2, title: 'up_time64()', c: C.green });
    drawCode(g, 800, 548, ['uint64_t up_time64(void)   /* 关中断或加锁下调用 */', '{', '    uint32_t now = up_time();', '    if (now < s_last) s_hi++;   /* 绕回来了：进位 */', '    s_last = now;', '    return ((uint64_t)s_hi << 32) | now;', '}'], { s: 20, lh: 40, p: seg(t, L.cs[2] + .2, L.cs[2] + 2.4), t, width: 960, hl: t > L.cs[2] + 2.4 ? { 3: C.green } : null });
  },
});

/* ---------- 06 别人怎么做 ---------- */
chapterCard(6, '别人怎么做', 'HOW OSes DO IT', '四个系统，四种思路');

addScene({
  id: 'os', chap: 6, post: 1.0,
  caps: ['顺便看了一圈：各家操作系统，怎么对付回绕？', 'FreeRTOS：两张延时链表，tick 回绕的那一拍，{整体互换}', 'μC/OS-II：不存时刻，只存{还剩几拍}，每拍减一', 'NuttX：clock_compare，和 time_after {同一个思路}', 'Linux：定时轮看{相对距离}，hrtimer 直接上 64 位纳秒'],
  sfx: sc => [[.3, 'blip'], [.5, 'blip'], [.7, 'blip'], [.9, 'blip'], [sc.cs[1] + .2, 'lock'], [sc.cs[2] + .2, 'lock'], [sc.cs[3] + .2, 'lock'], [sc.cs[4] + .2, 'lock']],
  draw(g, L) {
    const t = L.t;
    const boxes = [[120, 140], [990, 140], [120, 510], [990, 510]];
    const names = ['FreeRTOS', 'μC/OS-II', 'NuttX', 'Linux'];
    const lines1 = ['两张延时链表，回绕瞬间互换', '只存“还剩几拍”，每拍减一', '无符号相减，再看符号位', '定时轮 + 64 位 hrtimer'];
    let cur = -1; for (let i = 1; i <= 4; i++) if (t > L.cs[i]) cur = i - 1;
    boxes.forEach(([x, y], i) => {
      const p = seg(t, .3 + i * .2, .9 + i * .2);
      const on = cur === -1 || cur === i;
      const al = on ? 1 : .32;
      panel(g, x, y, 810, 330, { p, title: 'OS · 0' + (i + 1), al, c: cur === i ? C.amber : C.cyan });
      if (p < .5) return;
      const a = seg(p, .5, 1) * al;
      txt(g, names[i], x + 40, y + 80, { f: 'disp', w: 900, s: 46, c: cur === i ? C.amber : C.white, al: a });
      txt(g, lines1[i], x + 40, y + 128, { f: 'cjk', w: 700, s: 26, c: C.mute, al: a });
      g.save(); g.globalAlpha *= a;
      const lt = cur === i ? t - L.cs[i + 1] : t;
      if (i === 0) {
        // 两张链表交换
        const per = 3, ph = (lt % per) / per;
        const sw = eio(seg(ph, .55, .8));
        const yA = lerp(y + 190, y + 260, sw), yB = lerp(y + 260, y + 190, sw);
        const tick = ph < .55 ? Math.floor(lerp(0xFFFFFFFA, 0xFFFFFFFF, ph / .55)) >>> 0 : 0;
        txt(g, 'xTickCount = ' + hex8(tick), x + 450, y + 80, { f: 'mono', s: 20, w: 700, c: tick === 0 ? C.amber : C.cyan });
        [['pxDelayedList', yA, C.cyan], ['pxOverflowDelayedList', yB, C.amber]].forEach(([s, yy, c]) => {
          chip(g, s, x + 40, yy, { s: 18, c });
          for (let k = 0; k < 4; k++) { g.strokeStyle = rgba(c, .7); g.lineWidth = 1.5; g.strokeRect(x + 400 + k * 90, yy - 18, 70, 36); }
        });
      } else if (i === 1) {
        const n = 5 - Math.floor((lt * 2) % 6);
        txt(g, 'OSTCBDly', x + 40, y + 220, { f: 'mono', s: 24, w: 700, c: C.cyan });
        digits(g, String(Math.max(0, n)), x + 330, y + 250, 110, { c: n <= 0 ? C.green : C.white });
        txt(g, n <= 0 ? '→ 就绪' : '每个 tick：--OSTCBDly', x + 430, y + 230, { f: 'cjk', s: 26, w: 700, c: n <= 0 ? C.green : C.mute });
      } else if (i === 2) {
        drawCode(g, x + 40, y + 210, ['#define clock_compare(t1, t2) \\', '    ((sclock_t)((t2) - (t1)) >= 0)'], { s: 21, lh: 38, width: 720 });
        txt(g, 'sclock_t：默认 32 位，可配 64 位', x + 40, y + 300, { f: 'cjk', s: 22, w: 700, c: C.amber });
      } else {
        // 定时轮
        const wx = x + 160, wy = y + 245;
        for (let r = 0; r < 3; r++) {
          g.save(); g.translate(wx, wy); g.rotate(lt * (.6 - r * .2));
          for (let s = 0; s < 8; s++) { g.strokeStyle = rgba(C.cyan, .7 - r * .2); g.lineWidth = 10; g.beginPath(); g.arc(0, 0, 30 + r * 22, s * TAU / 8 + .06, (s + 1) * TAU / 8 - .06); g.stroke(); }
          g.restore();
        }
        txt(g, 'timer wheel：expires − clk', x + 320, y + 220, { f: 'mono', s: 20, w: 700, c: C.cyan });
        txt(g, 'hrtimer：ktime_t 64 位纳秒', x + 320, y + 262, { f: 'cjk', s: 22, w: 700, c: C.white });
        txt(g, '2⁶³ ns ≈ 292 年', x + 320, y + 302, { f: 'cjk', s: 22, w: 900, c: C.green });
      }
      g.restore();
    });
  },
});

/* ---------- 结尾 ---------- */
addScene({
  id: 'outro', chap: 7, post: 1.4,
  caps: ['两次事故，其实是同一个教训：', '计数器不是一条直线，{而是一个环}', '写下 now > deadline 之前，先问问自己——', '{这个环，有多大？}'],
  sfx: sc => [[sc.cs[1] + .2, 'hum'], [sc.cs[3] + .2, 'impact', .6], [sc.cs[3] + .6, 'blip'], [sc.cs[3] + 1.0, 'blip']],
  draw(g, L) {
    const t = L.t, cx = 960, cy = 470;
    const k = eo(seg(t, 0, 1));
    ringBase(g, cx, cy, 250, t, { al: k });
    const u = (t * .12) % 1;
    ringArc(g, cx, cy, 250, 0, u, rgba(C.cyan, .9), 8, k);
    ringPoint(g, cx, cy, 250, u, C.white, null, { t, al: k });
    const k3 = eo(seg(t, L.cs[3] + .2, L.cs[3] + 1.2));
    if (k3 > 0) {
      [[130, '16 位：2¹⁶ ms ≈ 65.5 秒', C.red], [250, '32 位：2³² ms ≈ 49.7 天', C.amber], [370, '64 位：2⁶⁴ ms ≈ 5.85 亿年', C.green]].forEach(([r, s, c], i) => {
        const kk = eo(seg(t, L.cs[3] + .2 + i * .35, L.cs[3] + .9 + i * .35));
        g.save(); g.globalAlpha *= kk; g.strokeStyle = c; g.lineWidth = 3; g.setLineDash([14, 8]); g.lineDashOffset = t * 20 * (i % 2 ? 1 : -1);
        g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); g.restore();
        const lx = cx + 460, ly = cy - 150 + i * 120;
        const ang = Math.atan2(ly - 8 - cy, lx - cx), px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
        g.save(); g.globalAlpha *= kk; g.fillStyle = c; g.beginPath(); g.arc(px, py, 6, 0, TAU); g.fill(); g.restore();
        line(g, px, py, lx - 14, ly - 8, rgba(c, .7), 1.5, kk);
        txt(g, s, lx, ly, { f: 'cjk', s: 28, w: 900, c, al: kk });
      });
    } else {
      txt(g, 'uint32_t', cx, cy + 12, { f: 'mono', s: 40, w: 700, c: C.cyan, a: 'center', al: k });
    }
  },
});

addScene({
  id: 'end', chap: 7, dur: 6.5, pre: 0, caps: [],
  sfx: () => [[0.2, 'impact', .6]],
  draw(g, L) {
    const t = L.t;
    const a = eo(seg(t, .1, .8));
    txt(g, '32 位 ms 计时器的故事', 960, 470, { f: 'cjk', w: 900, s: 92, c: C.white, a: 'center', al: a });
    txt(g, '（事故）', 1440, 470, { f: 'cjk', w: 900, s: 46, c: C.red, al: a });
    line(g, 960 - 420 * a, 520, 960 + 420 * a, 520, rgba(C.cyan, .4), 1);
    txt(g, '你踩过最久才复现的 bug 是什么？评论区聊聊', 960, 595, { f: 'cjk', s: 36, w: 700, c: C.cyan, a: 'center', al: eo(seg(t, .8, 1.5)) });
    txt(g, 'END OF REPORT', 960, 700, { f: 'mono', s: 20, w: 700, ls: 10, c: C.mute, a: 'center', al: eo(seg(t, 1.5, 2.2)) * blink(t, .8) });
  },
});

/* =====================================================================
 * 渲染器
 * ===================================================================== */
let bgCanvas = null, bl1 = null, bl2 = null, tmp = null, grainTiles = [], vign = null, scanPat = null, lastSize = '';
function mk(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function prepare(cw, ch) {
  const key = cw + 'x' + ch; if (key === lastSize) return; lastSize = key;
  // 静态背景
  bgCanvas = mk(cw, ch); const b = bgCanvas.getContext('2d'); b.setTransform(cw / W, 0, 0, ch / H, 0, 0);
  const rg = b.createRadialGradient(960, 520, 50, 960, 540, 1200);
  rg.addColorStop(0, '#071b20'); rg.addColorStop(.55, '#030c10'); rg.addColorStop(1, '#010305');
  b.fillStyle = rg; b.fillRect(0, 0, W, H);
  b.fillStyle = 'rgba(67,243,226,0.10)';
  for (let x = 24; x < W; x += 48) for (let y = 24; y < H; y += 48) b.fillRect(x - 1, y - 1, 2, 2);
  b.strokeStyle = 'rgba(67,243,226,0.035)'; b.lineWidth = 1;
  for (let x = 0; x < W; x += 192) { b.beginPath(); b.moveTo(x, 0); b.lineTo(x, H); b.stroke(); }
  for (let y = 0; y < H; y += 192) { b.beginPath(); b.moveTo(0, y); b.lineTo(W, y); b.stroke(); }
  bl1 = mk(Math.round(cw / 4), Math.round(ch / 4));
  bl2 = mk(Math.round(cw / 10), Math.round(ch / 10));
  tmp = mk(cw, ch);
  // 暗角
  vign = mk(cw, ch); const v = vign.getContext('2d'); v.setTransform(cw / W, 0, 0, ch / H, 0, 0);
  const vg = v.createRadialGradient(960, 540, 420, 960, 540, 1150);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.62)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  // 扫描线
  const sl = mk(8, Math.max(3, Math.round(3 * cw / W)));
  const s = sl.getContext('2d'); s.fillStyle = 'rgba(0,0,0,0.11)'; s.fillRect(0, 0, 8, Math.max(1, Math.round(cw / W)));
  scanPat = sl;
  // 颗粒
  grainTiles = [];
  for (let k = 0; k < 4; k++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grainTiles.push(gt);
  }
}

function sceneAt(t) {
  for (let i = 0; i < scenes.length; i++) if (t < scenes[i].start + scenes[i].d) return scenes[i];
  return scenes[scenes.length - 1];
}
function fxAmount(t, type) {
  let a = 0, val = null;
  for (const f of fxs) {
    if (f.type !== type) continue;
    const e = t - f.t; if (e < 0 || e > f.dur) continue;
    const k = 1 - e / f.dur;
    if (type === 'flash') { if (k > a) { a = k; val = f.a; } }
    else a = Math.max(a, (f.a || 1) * k);
  }
  return type === 'flash' ? [a, val] : a;
}

function drawChrome(g, t, sc) {
  const a = eo(seg(t, .15, .9));
  g.save(); g.globalAlpha *= a;
  const m = 34, Ls = 46;
  corners(g, m, m, W - 2 * m, H - 2 * m, Ls, rgba(C.cyan, .5), 2);
  txt(g, 'INCIDENT REPORT  //  32-BIT MS TIMER', 74, 72, { f: 'mono', s: 14, w: 700, ls: 3, c: rgba(C.cyan, .7) });
  const chn = sc.chap || 0;
  txt(g, (chn >= 1 && chn <= 6 ? `CH.0${chn}  ` : '') + CH_NAMES[chn], 74, 100, { f: 'cjk', s: 19, w: 700, c: rgba(C.white, .85) });
  // 右上 REC + 时间码
  const fr = Math.floor(t * FPS);
  const tc = [Math.floor(t / 3600), Math.floor(t / 60) % 60, Math.floor(t) % 60, fr % FPS].map(v => String(v).padStart(2, '0')).join(':');
  g.fillStyle = rgba(C.red, blink(t, .8)); g.beginPath(); g.arc(1622, 66, 7, 0, TAU); g.fill();
  txt(g, 'REC', 1636, 72, { f: 'mono', s: 15, w: 700, ls: 2, c: C.red });
  txt(g, tc, 1846, 72, { f: 'mono', s: 17, w: 700, c: rgba(C.cyan, .85), a: 'right' });
  // 章节进度
  for (let k = 1; k <= 6; k++) {
    const on = chn >= k, cur = chn === k;
    g.fillStyle = cur ? rgba(C.cyan, .95) : on ? rgba(C.cyan, .5) : rgba(C.cyan, .14);
    g.fillRect(1846 - (7 - k) * 34, 92, 28, 4);
  }
  // 底部角标
  txt(g, 'VelaOS · MCU · TICK = 1 ms', 74, 1052, { f: 'mono', s: 13, w: 700, ls: 2, c: rgba(C.cyan, .45) });
  txt(g, 'FRAME ' + String(fr).padStart(6, '0'), 1846, 1052, { f: 'mono', s: 13, w: 700, ls: 2, c: rgba(C.cyan, .45), a: 'right' });
  g.restore();
}

/* 字幕：{} 青色强调，[] 红色，^^ 琥珀色 */
function parseRich(s) {
  const out = []; let cur = '', col = null;
  for (const ch of s) {
    if (ch === '{') { if (cur) out.push({ s: cur, c: col }); cur = ''; col = C.cyan; }
    else if (ch === '[') { if (cur) out.push({ s: cur, c: col }); cur = ''; col = C.red; }
    else if (ch === '^') { if (cur) out.push({ s: cur, c: col }); cur = ''; col = col === C.amber ? null : C.amber; }
    else if (ch === '}' || ch === ']') { if (cur) out.push({ s: cur, c: col }); cur = ''; col = null; }
    else cur += ch;
  }
  if (cur) out.push({ s: cur, c: col });
  return out;
}
function splitRich(segs, at) { // 在纯文本位置 at 处切开
  const A = [], B = []; let n = 0;
  for (const sg of segs) {
    if (n + sg.s.length <= at) A.push(sg);
    else if (n >= at) B.push(sg);
    else { A.push({ s: sg.s.slice(0, at - n), c: sg.c }); B.push({ s: sg.s.slice(at - n), c: sg.c }); }
    n += sg.s.length;
  }
  return [A, B];
}
const CAP_FONT = { f: 'cjk', s: 46, w: 700 };
function capLines(g, text) {
  const segs = parseRich(text);
  const pl = segs.map(x => x.s).join('');
  const full = tw(g, pl, CAP_FONT);
  if (full <= 1560) return [segs];
  // 找最靠近中间的断点
  let best = -1, bd = 1e9;
  for (let i = 1; i < pl.length - 1; i++) {
    if ('，：；、——？！'.includes(pl[i - 1]) || pl[i - 1] === ' ') { const d = Math.abs(i - pl.length / 2); if (d < bd) { bd = d; best = i; } }
  }
  if (best < 0) best = Math.ceil(pl.length / 2);
  return splitRich(segs, best);
}
function drawCaptions(g, t) {
  // 底部压暗带
  const grd = g.createLinearGradient(0, 860, 0, 1080);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,4,6,0.78)');
  g.fillStyle = grd; g.fillRect(0, 860, W, 220);
  for (const c of caps) {
    if (t < c.t0 - .01 || t > c.t1 + .25) continue;
    const ain = seg(t, c.t0, c.t0 + .22), aout = 1 - seg(t, c.t1, c.t1 + .22);
    const a = Math.min(ain, aout); if (a <= 0) continue;
    const lines = capLines(g, c.text);
    const nChars = parseRich(c.text).map(x => x.s).join('').length;
    const wipe = eo(seg(t, c.t0, c.t0 + Math.min(.55, .15 + nChars * .013)));
    const dy = (1 - eo(ain)) * 14;
    const baseY = lines.length > 1 ? 952 : 990;
    g.save(); g.globalAlpha *= a;
    lines.forEach((segs, li) => {
      const y = baseY + li * 62 + dy;
      const wsum = segs.reduce((s, x) => s + tw(g, x.s, CAP_FONT), 0);
      let x = 960 - wsum / 2;
      const lw = lines.length > 1 ? (li === 0 ? clamp(wipe * 2) : clamp(wipe * 2 - 1)) : wipe;
      g.save(); g.beginPath(); g.rect(x - 20, y - 60, (wsum + 40) * lw, 90); g.clip();
      for (const sgm of segs) {
        txt(g, sgm.s, x, y, { ...CAP_FONT, c: sgm.c || C.white, sh: 'rgba(0,0,0,0.95)', sb: 10 });
        if (sgm.c) txt(g, sgm.s, x, y, { ...CAP_FONT, c: sgm.c, sh: sgm.c, sb: 18, al: .55 });
        x += tw(g, sgm.s, CAP_FONT);
      }
      g.restore();
      if (lw > 0 && lw < 1) { g.fillStyle = C.cyan; g.fillRect(960 - wsum / 2 - 20 + (wsum + 40) * lw, y - 42, 4, 52); }
      // 两侧小括号
      if (li === 0) {
        const bx = 960 - wsum / 2 - 34, ex = 960 + wsum / 2 + 30;
        g.fillStyle = rgba(C.cyan, .8);
        g.fillRect(bx, y - 38, 3, 46); g.fillRect(bx, y - 38, 10, 3); g.fillRect(bx, y + 5, 10, 3);
        if (lines.length === 1) { g.fillRect(ex, y - 38, 3, 46); g.fillRect(ex - 7, y - 38, 10, 3); g.fillRect(ex - 7, y + 5, 10, 3); }
      }
    });
    g.restore();
  }
}

function render(canvas, t) {
  const cw = canvas.width, ch = canvas.height;
  prepare(cw, ch);
  SC = cw / W;
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.drawImage(bgCanvas, 0, 0);
  g.setTransform(SC, 0, 0, SC, 0, 0);
  // 缓慢移动的扫描光带
  const sy = (t * 90) % (H + 400) - 200;
  const sg = g.createLinearGradient(0, sy - 120, 0, sy);
  sg.addColorStop(0, 'rgba(67,243,226,0)'); sg.addColorStop(1, 'rgba(67,243,226,0.035)');
  g.fillStyle = sg; g.fillRect(0, sy - 120, W, 120);

  const sc = sceneAt(t);
  const lt = t - sc.start;
  const env = Math.min(eo(seg(lt, 0, .3)), 1 - seg(lt, sc.d - .28, sc.d));
  const shake = fxAmount(t, 'shake');
  g.save();
  if (shake > 0) { const fr = Math.floor(t * FPS); g.translate((hash(fr) - .5) * 2 * shake, (hash(fr + 99) - .5) * 2 * shake); }
  g.globalAlpha = clamp(env);
  sc.draw(g, { t: lt, d: sc.d, cs: sc.cs, ce: sc.ce, T: t });
  g.restore();
  g.globalAlpha = 1;
  drawChrome(g, t, sc);

  // Bloom
  g.setTransform(1, 0, 0, 1, 0, 0);
  const b1 = bl1.getContext('2d'), b2 = bl2.getContext('2d');
  b1.setTransform(1, 0, 0, 1, 0, 0); b1.globalCompositeOperation = 'source-over'; b1.clearRect(0, 0, bl1.width, bl1.height);
  b1.filter = `blur(${(bl1.width / 480).toFixed(2)}px)`; b1.drawImage(canvas, 0, 0, bl1.width, bl1.height); b1.filter = 'none';
  b2.setTransform(1, 0, 0, 1, 0, 0); b2.clearRect(0, 0, bl2.width, bl2.height);
  b2.filter = `blur(${(bl2.width / 160).toFixed(2)}px)`; b2.drawImage(canvas, 0, 0, bl2.width, bl2.height); b2.filter = 'none';
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = .55; g.drawImage(bl1, 0, 0, cw, ch);
  g.globalAlpha = .45; g.drawImage(bl2, 0, 0, cw, ch);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

  // 字幕（不参与泛光）
  g.setTransform(SC, 0, 0, SC, 0, 0);
  drawCaptions(g, t);

  // 扫描线 / 暗角 / 颗粒
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = g.createPattern(scanPat, 'repeat'); g.fillRect(0, 0, cw, ch);
  g.drawImage(vign, 0, 0);
  const fr = Math.floor(t * FPS);
  const gp = g.createPattern(grainTiles[fr % 4], 'repeat');
  g.save(); g.globalAlpha = .045; g.globalCompositeOperation = 'overlay';
  g.translate(Math.floor(hash(fr) * 256), Math.floor(hash(fr + 7) * 256)); g.scale(Math.max(1, SC * .75), Math.max(1, SC * .75));
  g.fillStyle = gp; g.fillRect(-512, -512, cw + 1024, ch + 1024); g.restore();

  // 故障切片
  const gl = fxAmount(t, 'glitch');
  if (gl > 0.02) {
    const tg = tmp.getContext('2d'); tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, cw, ch); tg.drawImage(canvas, 0, 0);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const r1 = hash(fr * 13 + i), r2 = hash(fr * 7 + i * 3), r3 = hash(fr * 3 + i * 11);
      const y = Math.floor(r1 * ch), h = Math.floor((8 + r2 * 70) * SC), dx = Math.floor((r3 - .5) * 90 * SC * gl);
      g.drawImage(tmp, 0, y, cw, h, dx, y, cw, h);
      if (i % 2 === 0) { g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = .35 * gl; g.fillStyle = i % 4 ? '#ff2050' : '#20e0ff'; g.fillRect(0, y, cw, h); g.restore(); }
    }
  }
  const [fa, fc] = fxAmount(t, 'flash');
  if (fa > 0) { g.save(); g.globalAlpha = .28 * fa; g.fillStyle = fc || '#fff'; g.fillRect(0, 0, cw, ch); g.restore(); }
}


/* ---------------- 封面 ---------------- */
function drawCover(canvas) {
  const cw = canvas.width, ch = canvas.height;
  prepare(cw, ch); SC = cw / W;
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(bgCanvas, 0, 0);
  g.setTransform(SC, 0, 0, SC, 0, 0);
  const t = 3.3;
  // 右侧大环：一半青色、一半红色
  const cx = 1390, cy = 560, R = 330;
  ringBase(g, cx, cy, R, t, { al: 1 });
  ringArc(g, cx, cy, R, 0, .5, C.cyan, 14, 1);
  ringArc(g, cx, cy, R, .5, .995, C.red, 14, 1);
  ringPoint(g, cx, cy, R, .5, C.red, null, { t: .3, r: 14 });
  txt(g, '2³¹', cx, cy + R + 84, { f: 'cjk', s: 44, w: 900, c: C.red, a: 'center' });
  // 环中间：翻成负数
  g.save(); g.globalCompositeOperation = 'lighter';
  digits(g, '-2147483648', cx - 6, cy + 30, 78, { c: rgba('#ff2050', .75), w: 900 });
  digits(g, '-2147483648', cx + 6, cy + 30, 78, { c: rgba('#20e0ff', .75), w: 900 });
  g.restore();
  digits(g, '-2147483648', cx, cy + 30, 78, { c: C.white, w: 900 });
  txt(g, '0x7FFFFFFF + 1 =', cx, cy - 60, { f: 'mono', s: 34, w: 700, c: C.cyan, a: 'center' });
  txt(g, 'int32_t', cx, cy + 110, { f: 'mono', s: 28, w: 700, c: C.mute, a: 'center' });
  // 左侧标题
  txt(g, 'INCIDENT REPORT // 32-BIT MS TIMER', 110, 210, { f: 'mono', s: 22, w: 700, ls: 4, c: C.cyan });
  txt(g, '准时在第', 105, 330, { f: 'cjk', w: 900, s: 76, c: C.white });
  txt(g, '24.85', 100, 520, { f: 'disp', w: 900, s: 230, c: C.amber, sh: rgba(C.amber, .6), sb: 30 });
  txt(g, '天', 760, 520, { f: 'cjk', w: 900, s: 120, c: C.amber });
  txt(g, '发作的 bug', 105, 640, { f: 'cjk', w: 900, s: 76, c: C.white });
  g.fillStyle = C.red; g.fillRect(110, 700, 500, 6);
  txt(g, '32 位 ms 计时器的故事（事故）', 110, 790, { f: 'cjk', w: 700, s: 44, c: C.white });
  chip(g, 'VelaOS · MCU · 嵌入式', 110, 860, { s: 22, f: 'cjk', ls: 2 });
  // 角标
  corners(g, 34, 34, W - 68, H - 68, 46, rgba(C.cyan, .6), 3);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const b1 = bl1.getContext('2d'); b1.setTransform(1, 0, 0, 1, 0, 0); b1.clearRect(0, 0, bl1.width, bl1.height);
  b1.filter = `blur(${(bl1.width / 480).toFixed(2)}px)`; b1.drawImage(canvas, 0, 0, bl1.width, bl1.height); b1.filter = 'none';
  g.globalCompositeOperation = 'screen'; g.globalAlpha = .6; g.drawImage(bl1, 0, 0, cw, ch);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.drawImage(vign, 0, 0);
}

const API = {
  drawCover,
  W, H, FPS, render,
  get duration() { return TOTAL; },
  scenes: scenes.map(s => ({ id: s.id, chap: s.chap, start: +s.start.toFixed(3), d: +s.d.toFixed(3) })),
  captions: caps.map(c => ({ t0: +c.t0.toFixed(3), t1: +c.t1.toFixed(3), text: c.text, plain: plain(c.text) })),
  cues: cues.map(c => ({ t: +c.t.toFixed(3), type: c.type, v: c.v })).sort((a, b) => a.t - b.t),
  chapters: chapterStarts,
  fontsNeeded: [fontStr({ f: 'cjk', w: 500 }), fontStr({ f: 'cjk', w: 700 }), fontStr({ f: 'cjk', w: 900 }), fontStr({ f: 'disp', w: 800 }), fontStr({ f: 'disp', w: 900 }), fontStr({ f: 'mono', w: 400 }), fontStr({ f: 'mono', w: 700 })],
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.FILM = API;
})(typeof window !== 'undefined' ? window : globalThis);
