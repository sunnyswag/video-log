/* =====================================================================
 * 显示屏帧率评估（短片）—— 画风工具：实验室仪表 / 高速摄影
 * 暗色实验台 + 示波器刻度网格 + 磷光扫描线；七段数码管、指针表、拨动开关、开发板、手机、胶片带、解码芯片、缓存架。
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题 ---------------- */
const C = {
  bg: '#0A0E13', bg2: '#101820', panel: '#141D26', panel2: '#1B2731', bezel: '#2A3A48', line: '#33495A',
  ink: '#E6EEF2', ink2: '#93A7B4', dim: '#4E6170',
  green: '#45E89A', greenD: '#10392A', cyan: '#3CCBF2', cyanD: '#0E3240', amber: '#FFB23E', amberD: '#3B280C',
  red: '#FF5262', redD: '#3E1218', violet: '#A994FF',
  pcb: '#0E3A2D', pcb2: '#15523F', gold: '#C8A65C',
};
const F = {
  cjk: '"FCJK","FSup","Noto Sans CJK SC","PingFang SC",sans-serif',
  disp: '"FDisp","Inter Display","Inter","FCJK",sans-serif',
  mono: '"FMono","FMonoCJK","DejaVu Sans Mono",monospace',
};
const fontsNeeded = [
  ...[500, 700, 900].map(w => `${w} 32px "FCJK"`),
  ...[800, 900].map(w => `${w} 32px "FDisp"`),
  ...[500, 700, 900].map(w => `${w} 32px "FSup"`),
  ...[400, 700].flatMap(w => [`${w} 32px "FMono"`, `${w} 32px "FMonoCJK"`]),
];

/* ---------------- 运动曲线 ---------------- */
const pop = p => p <= 0 ? 0 : p >= 1 ? 1 : eback(p);
const spring = (t, k = 6, f = 1.4) => t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(f * TAU * t);
const win = (lt, a, b, fi = .3, fo = .3) => Math.min(eo(seg(lt, a, a + fi)), 1 - eo(seg(lt, b - fo, b)));
const wob = (t, f = 1, a = 1, s = 0) => Math.sin((t + s) * TAU * f) * a;
/* 数值从 a 弹到 b（t0 起，弹簧过冲），用于指针和读数 */
const springTo = (lt, t0, a, b, k = 7, f = 1.2) => lerp(a, b, spring(lt - t0, k, f));

/* ---------------- 全局渲染状态 ---------------- */
let SCX = 1, CAMZ = 1;
const SH = () => SCX * CAMZ;

/* ---------------- 文字 ---------------- */
const font = o => `${o.w || 700} ${o.s || 30}px ${F[o.f || 'cjk']}`;
function text(g, s, x, y, o = {}) {
  g.save();
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.font = font(o); g.textAlign = o.a || 'center'; g.textBaseline = o.b || 'middle';
  if (o.ls) g.letterSpacing = o.ls + 'px';
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = (o.gb || 18) * SH(); }
  g.fillStyle = o.c || C.ink; g.fillText(s, x, y);
  g.restore();
}
function textW(g, s, o = {}) { g.save(); g.font = font(o); if (o.ls) g.letterSpacing = o.ls + 'px'; const w = g.measureText(s).width; g.restore(); return w; }

/* ---------------- 形状 ---------------- */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
function shadow(g, a = .5, blur = 30, oy = 12) { g.shadowColor = rgba('#000000', a); g.shadowBlur = blur * SH(); g.shadowOffsetY = oy * SH(); }
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; }
/* 仪器面板：深色金属 + 顶部高光 + 细描边 */
function card(g, x, y, w, h, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, o.r ?? 18);
  if (o.shadow !== false) shadow(g, o.sa ?? .5, o.sb ?? 30, o.so ?? 12);
  if (o.fill) g.fillStyle = o.fill;
  else { const lg = g.createLinearGradient(0, y, 0, y + h); lg.addColorStop(0, C.panel2); lg.addColorStop(1, C.panel); g.fillStyle = lg; }
  g.fill(); noShadow(g);
  if (o.lw !== 0) { g.lineWidth = o.lw ?? 2; g.strokeStyle = o.stroke || C.line; if (o.dash) g.setLineDash(o.dash); g.stroke(); }
  if (o.hi !== false) { g.save(); rr(g, x, y, w, h, o.r ?? 18); g.clip(); g.fillStyle = rgba('#ffffff', .035); g.fillRect(x, y, w, Math.min(h, 26)); g.restore(); }
  g.restore();
}
function dot(g, x, y, r, c, al = 1) { if (r <= 0) return; g.save(); g.globalAlpha *= al; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = c; g.fill(); g.restore(); }
function ring(g, x, y, r, c, lw = 3, al = 1, a0 = -TAU / 4, a1 = a0 + TAU) {
  if (r <= 0) return; g.save(); g.globalAlpha *= al; g.beginPath(); g.arc(x, y, r, a0, a1); g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round'; g.stroke(); g.restore();
}
function path(g, pts, o = {}) {
  if (pts.length < 2) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.strokeStyle = o.c || C.ink; g.lineWidth = o.w || 3; g.lineCap = o.cap || 'round'; g.lineJoin = 'round';
  if (o.dash) { g.setLineDash(o.dash); g.lineDashOffset = o.off || 0; }
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = (o.gb || 14) * SH(); }
  g.stroke(); g.restore();
}
function partial(pts, p) {
  const L = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(d); tot += d; }
  let need = tot * clamp(p); const out = [pts[0]];
  for (let i = 1; i < pts.length && need > 0; i++) {
    const d = L[i - 1];
    if (need >= d) { out.push(pts[i]); need -= d; }
    else { const k = need / d; out.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]); need = 0; }
  }
  return out;
}
function arrowHead(g, x, y, ang, c, s = 16, al = 1) {
  g.save(); g.globalAlpha *= al; g.translate(x, y); g.rotate(ang); g.beginPath();
  g.moveTo(0, 0); g.lineTo(-s, -s * .6); g.lineTo(-s * .72, 0); g.lineTo(-s, s * .6); g.closePath(); g.fillStyle = c; g.fill(); g.restore();
}
function arrow(g, pts, o = {}) {
  const q = partial(pts, o.p ?? 1); if (q.length < 2) return;
  path(g, q, o);
  const a = q[q.length - 2], b = q[q.length - 1];
  if ((o.p ?? 1) > .02) arrowHead(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), o.c || C.ink, o.hs || 18, o.al ?? 1);
}
function at(g, x, y, s, fn, o = {}) {
  if (s <= .001 || (o.al != null && o.al <= .001)) return;
  g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); g.scale(s * (o.sx || 1), s * (o.sy || 1));
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  fn(); g.restore();
}
const bez = (a, m, b, u) => { const v = 1 - u; return [v * v * a[0] + 2 * v * u * m[0] + u * u * b[0], v * v * a[1] + 2 * v * u * m[1] + u * u * b[1]]; };

/* ---------------- 七段数码管 ---------------- */
const SEG7 = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  '-': 'g', 'P': 'abefg', 'F': 'aefg', 'S': 'afgcd', 'E': 'adefg', 'r': 'eg', 'o': 'cdeg', 'H': 'bcefg', 'L': 'def', 'A': 'abcefg',
  'C': 'adef', 't': 'defg', 'n': 'ceg', 'u': 'cde', 'b': 'cdefg', 'd': 'bcdeg', ' ': '',
};
function seg7W(s, h) { let w = 0; for (const ch of s) w += ch === '.' ? h * .2 : ch === '+' ? h * .5 : h * .62; return w; }
/* 画一串七段字符：背后有暗的“8”残影，亮段带辉光。a: left/center/right；y 为字符竖直中心 */
function seg7(g, s, x, y, h, col, o = {}) {
  const tw = seg7W(s, h), t = h * .13, dw = h * .48, hh = h / 2;
  let cx = o.a === 'left' ? x : o.a === 'right' ? x - tw : x - tw / 2;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.translate(0, y); g.transform(1, 0, -.08, 1, 0, 0);
  const segPoly = (k, ox) => {
    const L = ox, R = ox + dw, T = -hh, M = 0, B = hh, s2 = t / 2, gap = t * .18;
    const horiz = (yy) => [[L + gap, yy], [L + s2 + gap, yy - s2], [R - s2 - gap, yy - s2], [R - gap, yy], [R - s2 - gap, yy + s2], [L + s2 + gap, yy + s2]];
    const vert = (xx, y0, y1) => [[xx, y0 + gap], [xx + s2, y0 + s2 + gap], [xx + s2, y1 - s2 - gap], [xx, y1 - gap], [xx - s2, y1 - s2 - gap], [xx - s2, y0 + s2 + gap]];
    return { a: horiz(T + s2), g: horiz(M), d: horiz(B - s2), f: vert(L + s2, T + s2, M), b: vert(R - s2, T + s2, M), e: vert(L + s2, M, B - s2), c: vert(R - s2, M, B - s2) }[k];
  };
  const fillPoly = (pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); };
  for (const ch of s) {
    if (ch === '.') { dot(g, cx + h * .06, hh - t * .55, t * .6, col); cx += h * .2; continue; }
    if (ch === '+') {
      g.fillStyle = col; g.fillRect(cx + h * .04, -t / 2, h * .38, t); g.fillRect(cx + h * .23 - t / 2, -h * .19, t, h * .38); cx += h * .5; continue;
    }
    if (o.ghost !== false) { g.fillStyle = rgba(col, .07); for (const k of 'abcdefg') fillPoly(segPoly(k, cx)); }
    g.fillStyle = col;
    if (o.glow !== false) { g.shadowColor = rgba(col, .8); g.shadowBlur = h * .18 * SH(); }
    for (const k of (SEG7[ch] ?? '')) fillPoly(segPoly(k, cx));
    noShadow(g);
    cx += h * .62;
  }
  g.restore();
  return tw;
}
/* 数字滚动：从 a 到 b，按 p 插值，保留 dp 位小数 */
const rollNum = (a, b, p, dp = 1) => lerp(a, b, clamp(p)).toFixed(dp);

/* ---------------- 仪器图元 ---------------- */
function screw(g, x, y, r = 7, rot = .6) {
  dot(g, x, y, r, '#3B4C5A'); ring(g, x, y, r, '#0B1117', 1.5);
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = '#0E151B'; g.fillRect(-r * .7, -1.2, r * 1.4, 2.4); g.restore();
}
function led(g, x, y, r, col, on = 1) {
  dot(g, x, y, r + 3, '#0B1117');
  dot(g, x, y, r, on > .05 ? col : rgba(col, .18));
  if (on > .05) { g.save(); g.globalAlpha *= on; g.shadowColor = col; g.shadowBlur = r * 3 * SH(); dot(g, x, y, r * .9, col); g.restore(); dot(g, x - r * .3, y - r * .3, r * .3, '#ffffff', .6 * on); }
}
/* 读数仪：标签 + 数码管 + 单位；val 为字符串 */
function readout(g, x, y, w, h, val, o = {}) {
  const col = o.c || C.amber;
  at(g, x, y, o.s ?? 1, () => {
    card(g, -w / 2, -h / 2, w, h, { r: 20, lw: 2.5, stroke: o.stroke || C.bezel });
    screw(g, -w / 2 + 18, -h / 2 + 18); screw(g, w / 2 - 18, -h / 2 + 18, 7, 1.7); screw(g, -w / 2 + 18, h / 2 - 18, 7, 2.4); screw(g, w / 2 - 18, h / 2 - 18, 7, .2);
    const top = o.label ? -h / 2 + 58 : -h / 2 + 26, gx = -w / 2 + 30, gw = w - 60, gh = h / 2 - 26 - top;
    if (o.label) text(g, o.label, -w / 2 + 42, -h / 2 + 34, { s: o.ls || 26, w: 700, a: 'left', c: C.ink2 });
    if (o.ledc) led(g, w / 2 - 44, -h / 2 + 34, 7, o.ledc, o.ledOn ?? 1);
    rr(g, gx, top, gw, gh, 10); g.fillStyle = '#05080B'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    g.save(); rr(g, gx, top, gw, gh, 10); g.clip();
    const dh = o.dh || gh * .62, unitW = o.unit ? textW(g, o.unit, { f: 'mono', s: 28, w: 700 }) + 20 : 0;
    seg7(g, val, gx + gw - 22 - unitW, top + gh / 2, dh, col, { a: 'right' });
    if (o.unit) text(g, o.unit, gx + gw - 16, top + gh / 2 + dh * .3, { f: 'mono', s: 28, w: 700, a: 'right', c: rgba(col, .8) });
    const lg = g.createLinearGradient(gx, top, gx, top + gh); lg.addColorStop(0, 'rgba(255,255,255,.07)'); lg.addColorStop(.5, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(gx, top, gw, gh);
    g.restore();
  }, { al: o.al });
}
/* 指针表：0..max，240° 刻度，红区 < red */
function gauge(g, x, y, r, v, o = {}) {
  const max = o.max ?? 100, red = o.red ?? 30, a0 = Math.PI * .75, sweep = Math.PI * 1.5, ang = u => a0 + sweep * clamp(u / max);
  at(g, x, y, o.s ?? 1, () => {
    dot(g, 0, 0, r + 26, '#0B1117'); ring(g, 0, 0, r + 26, C.bezel, 4);
    const rg = g.createRadialGradient(0, -r * .3, r * .1, 0, 0, r + 20); rg.addColorStop(0, '#1C2833'); rg.addColorStop(1, '#0D141A');
    g.beginPath(); g.arc(0, 0, r + 20, 0, TAU); g.fillStyle = rg; g.fill();
    ring(g, 0, 0, r, rgba(C.red, .55), 10, 1, ang(0), ang(red));
    ring(g, 0, 0, r, rgba(C.green, .35), 10, 1, ang(o.green ?? 50), ang(max));
    for (let k = 0; k <= max; k += 5) {
      const a = ang(k), major = k % 20 === 0, r0 = r - (major ? 26 : 14);
      path(g, [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * (r - 4), Math.sin(a) * (r - 4)]], { c: major ? C.ink : C.dim, w: major ? 3.5 : 2 });
      if (major && o.nums !== false) text(g, String(k), Math.cos(a) * (r - 52), Math.sin(a) * (r - 52) + 1, { f: 'mono', s: 24, w: 700, c: C.ink2 });
    }
    if (o.title) text(g, o.title, 0, r * .42, { f: 'mono', s: 26, w: 700, c: C.ink2 });
    const a = ang(v);
    g.save(); g.rotate(a); g.shadowColor = rgba(C.red, .7); g.shadowBlur = 10 * SH();
    g.beginPath(); g.moveTo(-r * .16, -4); g.lineTo(r * .92, 0); g.lineTo(-r * .16, 4); g.closePath(); g.fillStyle = o.nc || C.red; g.fill(); g.restore();
    dot(g, 0, 0, 16, '#2B3A47'); ring(g, 0, 0, 16, '#0B1117', 2); dot(g, -4, -4, 4, '#ffffff', .3);
  }, { al: o.al });
}
/* 拨动开关：on 0..1（拨杆角度插值），带 LED 和铭牌 */
function toggle(g, x, y, on, label, o = {}) {
  at(g, x, y, o.s ?? 1, () => {
    rr(g, -46, -62, 92, 124, 16); g.fillStyle = '#0D141A'; g.fill(); g.lineWidth = 2; g.strokeStyle = C.bezel; g.stroke();
    screw(g, 0, -48, 5); screw(g, 0, 48, 5, 1.9);
    dot(g, 0, 0, 22, '#2D3C49'); ring(g, 0, 0, 22, '#0B1117', 2);
    const a = lerp(-.55, .55, clamp(on)) + Math.PI;
    g.save(); g.rotate(a); rr(g, -8, -6, 16, 70, 8); const lg = g.createLinearGradient(-8, 0, 8, 0); lg.addColorStop(0, '#9FB0BC'); lg.addColorStop(.5, '#E8F0F4'); lg.addColorStop(1, '#6F808C');
    g.fillStyle = lg; g.fill(); dot(g, 0, 62, 11, '#C9D5DD'); g.restore();
    led(g, 74, -30, 8, o.ledc || C.green, on);
    if (!o.noText) text(g, on > .5 ? 'ON' : 'OFF', 74, 6, { f: 'mono', s: 24, w: 700, c: on > .5 ? C.green : C.red });
  }, { al: o.al });
  if (label) text(g, label, x + 14 * (o.s ?? 1), y + 98 * (o.s ?? 1), { s: o.fs || 28, w: 700, c: C.ink, al: o.al });
}
/* 铭牌：背光点亮 */
function plate(g, s, x, y, col, on = 1, o = {}) {
  const fs = o.fs || 28, w = textW(g, s, { s: fs, w: 700 }) + 70, h = fs + 30;
  at(g, x, y, o.s ?? 1, () => {
    rr(g, -w / 2, -h / 2, w, h, 10); g.fillStyle = '#0D141A'; g.fill();
    if (on > 0) { g.save(); g.globalAlpha *= on; rr(g, -w / 2, -h / 2, w, h, 10); g.fillStyle = rgba(col, .16); g.fill(); g.shadowColor = col; g.shadowBlur = 18 * SH(); g.lineWidth = 2.5; g.strokeStyle = col; g.stroke(); g.restore(); }
    else { g.lineWidth = 2; g.strokeStyle = C.bezel; g.stroke(); }
    led(g, -w / 2 + 22, 0, 6, col, on);
    text(g, s, 14, 1, { s: fs, w: 700, c: on > .5 ? C.ink : C.dim });
  }, { al: o.al });
  return w;
}
/* 胶囊标签 */
function tag(g, s, x, y, c, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    const fs = o.fs || 28, w = textW(g, s, { s: fs, w: 700, f: o.f }) + 40, h = fs + 24;
    rr(g, -w / 2, -h / 2, w, h, h / 2); g.fillStyle = o.fill || rgba(c, .18); g.fill(); g.lineWidth = 2.5; g.strokeStyle = c; g.stroke();
    text(g, s, 0, 1, { s: fs, w: 700, c: o.tc || c, f: o.f });
  }, { rot: o.rot || 0, al: o.al });
}
function icCheck(g, x, y, s, c = C.green, p = 1, lw) { path(g, partial([[x - s * .45, y], [x - s * .12, y + s * .32], [x + s * .5, y - s * .38]], p), { c, w: lw || s * .2 }); }
function icCross(g, x, y, s, c = C.red, p = 1, lw) {
  const k = s * .42;
  path(g, partial([[x - k, y - k], [x + k, y + k]], clamp(p * 2)), { c, w: lw || s * .2 });
  path(g, partial([[x + k, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c, w: lw || s * .2 });
}
function ripple(g, x, y, k, c, r0 = 30, r1 = 120, d = .7) { if (k >= 0 && k < d) ring(g, x, y, r0 + (r1 - r0) * eo(k / d), c, 4, 1 - k / d); }
function burst(g, x, y, k, c, n = 12, r = 110) {
  if (k < 0 || k > .9) return;
  for (let i = 0; i < n; i++) {
    const ang = i / n * TAU + hash(i * 3.1) * .5, sp = r * (.6 + hash(i * 7.7) * .6), e = eo(k / .9);
    dot(g, x + Math.cos(ang) * sp * e, y + Math.sin(ang) * sp * e, (4 + hash(i) * 5) * (1 - e * .7), i % 3 ? c : C.amber, 1 - e);
  }
}
/* 十字测量准星 */
function reticle(g, x, y, r, c = C.cyan, al = 1, rot = 0) {
  g.save(); g.globalAlpha *= al; g.translate(x, y); g.rotate(rot);
  ring(g, 0, 0, r, c, 3); ring(g, 0, 0, r * .35, c, 2, .6);
  for (let k = 0; k < 4; k++) { g.rotate(TAU / 4); path(g, [[r * .55, 0], [r * 1.35, 0]], { c, w: 3 }); }
  g.restore();
}

/* ---------------- 桌面 demo 的通用图标（自绘几何图形，与任何产品界面无关） ---------------- */
const ICON_COL = ['#3CCBF2', '#FFB23E', '#45E89A', '#FF7A85', '#A994FF', '#5FD7C6', '#F2D46B', '#7FA8FF'];
function icon(g, x, y, s, k, o = {}) {
  const c = ICON_COL[k % 8];
  at(g, x, y, s, () => {
    rr(g, -40, -47, 80, 94, 18);
    const lg = g.createLinearGradient(0, -47, 0, 47); lg.addColorStop(0, rgba(c, .95)); lg.addColorStop(1, rgba(c, .62)); g.fillStyle = lg; g.fill();
    if (o.pixel) { // 位图纹理：像素格
      g.save(); rr(g, -40, -47, 80, 94, 18); g.clip(); for (let i = 0; i < 8; i++) for (let j = 0; j < 10; j++) { g.fillStyle = rgba('#000000', hash(i * 13 + j * 7 + k) * .22); g.fillRect(-40 + i * 10, -47 + j * 9.4, 10, 9.4); } g.restore();
    }
    g.save(); g.strokeStyle = '#0A1016'; g.fillStyle = '#0A1016'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    switch (k % 8) {
      case 0: g.beginPath(); g.arc(0, 0, 20, 0, TAU); g.stroke(); break;
      case 1: g.beginPath(); g.moveTo(-20, 16); g.lineTo(0, -20); g.lineTo(20, 16); g.closePath(); g.stroke(); break;
      case 2: for (let i = -1; i <= 1; i++) { g.fillRect(i * 14 - 4, 18 - (i + 2) * 11, 8, (i + 2) * 11); } break;
      case 3: g.beginPath(); g.moveTo(-20, 0); g.lineTo(20, 0); g.moveTo(0, -20); g.lineTo(0, 20); g.stroke(); break;
      case 4: g.beginPath(); for (let i = 0; i <= 20; i++) { const xx = -22 + i * 2.2, yy = Math.sin(i / 20 * TAU) * 14; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } g.stroke(); break;
      case 5: rr(g, -20, -20, 40, 40, 6); g.stroke(); g.beginPath(); g.moveTo(-20, 0); g.lineTo(20, 0); g.stroke(); break;
      case 6: g.beginPath(); g.arc(0, 0, 8, 0, TAU); g.fill(); g.beginPath(); g.arc(0, 0, 21, 0, TAU); g.lineWidth = 4; g.stroke(); break;
      case 7: g.beginPath(); g.moveTo(-18, -14); g.lineTo(18, -14); g.moveTo(-18, 0); g.lineTo(10, 0); g.moveTo(-18, 14); g.lineTo(2, 14); g.stroke(); break;
    }
    g.restore();
    if (o.glow) { g.save(); g.globalAlpha *= o.glow; rr(g, -40, -47, 80, 94, 18); g.shadowColor = o.gc || C.green; g.shadowBlur = 24 * SH(); g.lineWidth = 4; g.strokeStyle = o.gc || C.green; g.stroke(); g.restore(); }
  }, { al: o.al, rot: o.rot });
}
/* 壁纸缩略图（缓存里的“背景”格） */
function wallpaper(g, x, y, w, h, al = 1) {
  g.save(); g.globalAlpha *= al;
  const lg = g.createLinearGradient(x, y, x + w, y + h); lg.addColorStop(0, '#173A55'); lg.addColorStop(1, '#2C1F4D'); rr(g, x, y, w, h, 8); g.fillStyle = lg; g.fill();
  g.beginPath(); g.arc(x + w * .75, y + h * .3, h * .22, 0, TAU); g.fillStyle = rgba('#ffffff', .18); g.fill();
  g.restore();
}
/* 桌面 demo：屏幕局部坐标，w×h；off 为页偏移（以页为单位，0 = 第 1 页） */
function launcher(g, w, h, off, o = {}) {
  wallpaper(g, 0, 0, w, h);
  const pages = o.pages || 10, cols = 4, iw = w / cols;
  for (let p = Math.floor(off) - 1; p <= Math.floor(off) + 1; p++) {
    if (p < 0 || p >= pages) continue;
    const px = (p - off) * w;
    if (px > w || px < -w) continue;
    for (let i = 0; i < 8; i++) {
      const cx = px + iw * (i % cols + .5), cy = h * (i < 4 ? .3 : .7), k = (p * 3 + i) % 8;
      const st = o.state ? o.state(p, i) : null;
      icon(g, cx, cy, h / 300, k, { glow: st?.glow, gc: st?.gc, al: st?.al });
    }
  }
  for (let p = 0; p < pages; p++) dot(g, w / 2 + (p - (pages - 1) / 2) * 16, h - 14, Math.round(off) === p ? 5 : 3.5, '#ffffff', Math.round(off) === p ? .9 : .35);
}
/* MCU 开发板（PCB 线稿 + 480×272 屏）：局部坐标板子 620×420，屏幕 480×272 居中偏上 */
const BOARD_SCR = { x: -240, y: -170, w: 480, h: 272 };
function devBoard(g, x, y, s, lt, o = {}) {
  at(g, x, y, s, () => {
    // PCB
    rr(g, -310, -210, 620, 420, 22); shadow(g, .6, 40, 18); g.fillStyle = C.pcb; g.fill(); noShadow(g);
    g.save(); rr(g, -310, -210, 620, 420, 22); g.clip();
    g.strokeStyle = rgba(C.green, .12); g.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const yy = -190 + i * 46; g.beginPath(); g.moveTo(-310, yy); g.lineTo(-270, yy); g.lineTo(-250, yy + 20); g.lineTo(-250, 210); g.stroke(); }
    for (let i = 0; i < 12; i++) { const xx = -230 + i * 40; g.beginPath(); g.moveTo(xx, 210); g.lineTo(xx, 150); g.lineTo(xx + 14, 136); g.stroke(); }
    g.restore();
    rr(g, -310, -210, 620, 420, 22); g.lineWidth = 3; g.strokeStyle = C.pcb2; g.stroke();
    for (const [hx, hy] of [[-284, -184], [284, -184], [-284, 184], [284, 184]]) { ring(g, hx, hy, 10, C.gold, 4); dot(g, hx, hy, 5, '#05080B'); }
    // 排针
    for (let i = 0; i < 14; i++) { g.fillStyle = '#0B1117'; g.fillRect(-200 + i * 26, 168, 18, 18); dot(g, -191 + i * 26, 177, 4, C.gold); }
    // 芯片
    const chipP = (cx, cy, cw, ch) => { g.fillStyle = '#9AA7B0'; for (let i = 0; i < cw / 12; i++) { g.fillRect(cx - cw / 2 + 4 + i * 12, cy - ch / 2 - 6, 5, 6); g.fillRect(cx - cw / 2 + 4 + i * 12, cy + ch / 2, 5, 6); } rr(g, cx - cw / 2, cy - ch / 2, cw, ch, 4); g.fillStyle = '#11161B'; g.fill(); dot(g, cx - cw / 2 + 9, cy - ch / 2 + 9, 3, '#2C3741'); };
    chipP(-160, 128, 96, 40); chipP(10, 128, 70, 40); chipP(160, 128, 110, 40);
    // 电源灯 + 活动灯
    led(g, 270, 120, 6, C.green, 1); led(g, 270, 146, 6, C.amber, o.act ?? (hash(Math.floor(lt * 8)) > .5 ? 1 : .1));
    // 屏幕框
    const S2 = BOARD_SCR;
    rr(g, S2.x - 14, S2.y - 14, S2.w + 28, S2.h + 28, 10); g.fillStyle = '#05080B'; g.fill();
    g.save(); rr(g, S2.x, S2.y, S2.w, S2.h, 4); g.clip(); g.translate(S2.x, S2.y);
    const on = o.on ?? 1;
    if (on > 0) {
      g.save(); if (on < 1) { g.beginPath(); g.rect(0, 0, S2.w, S2.h * on); g.clip(); }
      if (o.screen) o.screen(g, S2.w, S2.h); else launcher(g, S2.w, S2.h, o.off || 0, o);
      g.restore();
      if (on < 1) { g.fillStyle = rgba('#ffffff', .6); g.fillRect(0, S2.h * on - 2, S2.w, 4); }
    }
    // 玻璃反光
    const sx = -300 + ((lt * 70) % 1200);
    const gr = g.createLinearGradient(sx, 0, sx + 180, S2.h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S2.w, S2.h);
    g.restore();
  }, { al: o.al });
}
/* 开发板屏幕内某点的世界坐标（板子中心 x,y，缩放 s） */
const boardPt = (x, y, s, u, v) => [x + (BOARD_SCR.x + u * BOARD_SCR.w) * s, y + (BOARD_SCR.y + v * BOARD_SCR.h) * s];

/* 手机（背面朝向板子，屏幕朝观众）+ 三脚架；局部坐标机身 220×420 */
function phone(g, x, y, s, lt, o = {}) {
  at(g, x, y, s, () => {
    // 三脚架
    path(g, [[0, 200], [-90, 420]], { c: '#3A4956', w: 10 }); path(g, [[0, 200], [90, 420]], { c: '#3A4956', w: 10 }); path(g, [[0, 200], [0, 430]], { c: '#2C3944', w: 9 });
    rr(g, -60, 196, 120, 22, 8); g.fillStyle = '#2C3944'; g.fill();
    // 机身
    rr(g, -110, -210, 220, 420, 34); shadow(g, .6, 36, 14); g.fillStyle = '#1A222A'; g.fill(); noShadow(g); g.lineWidth = 3; g.strokeStyle = '#3B4A57'; g.stroke();
    rr(g, -98, -196, 196, 392, 26); g.fillStyle = '#05080B'; g.fill();
    g.save(); rr(g, -98, -196, 196, 392, 26); g.clip();
    if (o.screen) o.screen(g); else {
      // 取景：一块小的开发板缩影
      g.fillStyle = '#0B1218'; g.fillRect(-98, -196, 196, 392);
      rr(g, -78, -70, 156, 104, 6); g.fillStyle = C.pcb; g.fill();
      g.save(); rr(g, -62, -60, 124, 70, 3); g.clip(); g.translate(-62, -60); g.scale(124 / 480, 70 / 272); launcher(g, 480, 272, o.off || 0); g.restore();
      for (const [cx, cy, a] of [[-86, -150, 0], [86, -150, 1], [-86, 120, 3], [86, 120, 2]]) { g.save(); g.translate(cx, cy); g.rotate(a * TAU / 4); path(g, [[0, 18], [0, 0], [18, 0]], { c: '#ffffff', w: 3, al: .7 }); g.restore(); }
      const rec = Math.floor(lt * 2) % 2 === 0;
      dot(g, -56, -166, 9, C.red, rec ? 1 : .3);
      seg7(g, '240', 70, -166, 30, C.amber, { a: 'right', glow: false });
      text(g, '×8', 0, 152, { f: 'mono', s: 28, w: 700, c: C.amber });
      dot(g, 0, 166 + 0, 0, C.ink);
    }
    g.restore();
    dot(g, 0, -184, 5, '#2C3944');
  }, { al: o.al });
}

/* 胶片带：x0..x0+w，中心 y；fw 帧宽；scroll 为已滚过的帧数（可小数）；thumb(i) 画第 i 帧缩略图内容 */
function filmStrip(g, x0, y, w, fw, fh, scroll, o = {}) {
  const hh = fh + 56;
  g.save(); rr(g, x0, y - hh / 2, w, hh, 6); g.clip();
  g.fillStyle = '#141008'; g.fillRect(x0, y - hh / 2, w, hh);
  const off = (scroll % 1) * fw, i0 = Math.floor(scroll);
  for (let k = -1; k * fw < w + fw; k++) {
    const i = i0 + k, fx = x0 + k * fw - off;
    // 齿孔
    for (const sy of [y - hh / 2 + 14, y + hh / 2 - 14]) for (let j = 0; j < 3; j++) { rr(g, fx + 14 + j * (fw / 3), sy - 7, fw / 3 - 26, 14, 3); g.fillStyle = '#2B2418'; g.fill(); }
    if (i < 0) continue;
    g.save(); rr(g, fx + 6, y - fh / 2, fw - 12, fh, 4); g.clip(); g.translate(fx + 6, y - fh / 2);
    if (o.thumb) o.thumb(g, i, fw - 12, fh); g.restore();
    rr(g, fx + 6, y - fh / 2, fw - 12, fh, 4); g.lineWidth = 2; g.strokeStyle = rgba(C.amber, .25); g.stroke();
  }
  g.restore();
  rr(g, x0, y - hh / 2, w, hh, 6); g.lineWidth = 2; g.strokeStyle = rgba(C.amber, .35); g.stroke();
}

/* 硬件解码芯片：heat 0..1（发热发红），busy 0..1（指示灯闪） */
function chip(g, x, y, w, h, label, lt, o = {}) {
  const heat = o.heat || 0, busy = o.busy || 0;
  at(g, x, y, o.s ?? 1, () => {
    g.fillStyle = '#A7B3BB';
    for (let i = 0; i < Math.floor(w / 26); i++) { const px = -w / 2 + 18 + i * 26; g.fillRect(px, -h / 2 - 12, 10, 12); g.fillRect(px, h / 2, 10, 12); }
    for (let i = 0; i < Math.floor(h / 26); i++) { const py = -h / 2 + 18 + i * 26; g.fillRect(-w / 2 - 12, py, 12, 10); g.fillRect(w / 2, py, 12, 10); }
    rr(g, -w / 2, -h / 2, w, h, 10); shadow(g, .6, 30, 12);
    const lg = g.createLinearGradient(0, -h / 2, 0, h / 2); lg.addColorStop(0, '#1E262D'); lg.addColorStop(1, '#0F1418'); g.fillStyle = lg; g.fill(); noShadow(g);
    if (heat > 0) { g.save(); rr(g, -w / 2, -h / 2, w, h, 10); g.clip(); const rg = g.createRadialGradient(0, 0, 10, 0, 0, w * .7); rg.addColorStop(0, rgba(C.red, .55 * heat)); rg.addColorStop(1, rgba(C.red, 0)); g.fillStyle = rg; g.fillRect(-w / 2, -h / 2, w, h); g.restore(); }
    rr(g, -w / 2, -h / 2, w, h, 10); g.lineWidth = 2.5; g.strokeStyle = heat > .3 ? rgba(C.red, .5 + .5 * heat) : C.bezel; g.stroke();
    dot(g, -w / 2 + 18, -h / 2 + 18, 5, '#2C3741');
    text(g, label, 0, o.sub ? -14 : 2, { s: o.fs || 30, w: 900, c: C.ink });
    if (o.sub) text(g, o.sub, 0, 26, { f: 'mono', s: 24, w: 700, c: C.ink2 });
    const on = busy > 0 ? (hash(Math.floor(lt * 18)) > .4 ? 1 : .2) * busy : 0;
    led(g, w / 2 - 22, -h / 2 + 22, 6, heat > .5 ? C.red : C.amber, on);
  }, { al: o.al });
}

/* ---------------- 示波器屏 ---------------- */
function scope(g, x, y, w, h, o = {}) {
  card(g, x - 20, y - 20, w + 40, h + 40, { r: 24, lw: 2.5, stroke: C.bezel });
  rr(g, x, y, w, h, 12); g.fillStyle = '#04110C'; g.fill();
  g.save(); rr(g, x, y, w, h, 12); g.clip();
  const nx = o.nx || 10, ny = o.ny || 8;
  for (let i = 1; i < nx; i++) path(g, [[x + w * i / nx, y], [x + w * i / nx, y + h]], { c: rgba(C.green, .1), w: 1.5 });
  for (let j = 1; j < ny; j++) path(g, [[x, y + h * j / ny], [x + w, y + h * j / ny]], { c: rgba(C.green, .1), w: 1.5 });
  const rg = g.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, Math.max(w, h) * .7); rg.addColorStop(0, rgba(C.green, .06)); rg.addColorStop(1, 'rgba(0,0,0,.3)'); g.fillStyle = rg; g.fillRect(x, y, w, h);
  g.restore();
  rr(g, x, y, w, h, 12); g.lineWidth = 2; g.strokeStyle = rgba(C.green, .3); g.stroke();
}

/* ---------------- 镜头 ---------------- */
function camAt(keys, lt) {
  if (!keys || !keys.length) return [W / 2, H / 2, 1];
  if (lt <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (lt <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], k = eio((lt - a[0]) / (b[0] - a[0]));
      return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
    }
  }
  return keys[keys.length - 1].slice(1);
}

/* ---------------- 实验台质感、后期 ---------------- */
function prepareStyle({ mk, cw, ch }) {
  const bench = mk(cw, ch), p = bench.getContext('2d'); p.scale(cw / W, ch / H);
  const rg = p.createRadialGradient(960, 470, 80, 960, 540, 1200); rg.addColorStop(0, '#16212B'); rg.addColorStop(.6, '#0C1218'); rg.addColorStop(1, '#06090C');
  p.fillStyle = rg; p.fillRect(0, 0, W, H);
  // 示波器式刻度网格：大格 120，细分 24
  p.strokeStyle = 'rgba(120,200,240,.035)'; p.lineWidth = 1;
  for (let x = 0; x <= W; x += 24) { p.beginPath(); p.moveTo(x, 0); p.lineTo(x, H); p.stroke(); }
  for (let y = 0; y <= H; y += 24) { p.beginPath(); p.moveTo(0, y); p.lineTo(W, y); p.stroke(); }
  p.strokeStyle = 'rgba(120,200,240,.07)'; p.lineWidth = 1.5;
  for (let x = 0; x <= W; x += 120) { p.beginPath(); p.moveTo(x, 0); p.lineTo(x, H); p.stroke(); }
  for (let y = 0; y <= H; y += 120) { p.beginPath(); p.moveTo(0, y); p.lineTo(W, y); p.stroke(); }
  for (let x = 0; x <= W; x += 120) for (let y = 0; y <= H; y += 120) { p.fillStyle = 'rgba(120,200,240,.12)'; p.fillRect(x - 3, y - .75, 6, 1.5); p.fillRect(x - .75, y - 3, 1.5, 6); }
  // 金属台面细噪点
  for (let i = 0; i < 7000; i++) { const x = hash(i * 1.17) * W, y = hash(i * 2.31 + 9) * H; p.fillStyle = rgba('#9FC4D8', .012 + hash(i * 5.3) * .02); p.fillRect(x, y, 1.4, 1.4); }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 380, 960, 540, 1150); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  // 极淡的横向扫描线
  v.fillStyle = 'rgba(0,0,0,.07)'; for (let y = 0; y < H; y += 4) v.fillRect(0, y, W, 1.2);
  const grain = [];
  for (let k = 0; k < 4; k++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt);
  }
  return { bench, vign, grain };
}
function drawBackground(g, { cache, t }) {
  g.drawImage(cache.bench, 0, 0, W, H);
  // 虚焦光斑（冷暖两色，缓慢漂移）
  const blobs = [[C.cyan, 300, 260, .07, 560], [C.amber, 1640, 820, .05, 600], [C.green, 1180, 120, .04, 480]];
  blobs.forEach(([c, x, y, a, r], i) => {
    const bx = x + wob(t, .019, 130, i * 3), by = y + wob(t, .015, 90, i * 5);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, r); rg.addColorStop(0, rgba(c, a)); rg.addColorStop(1, rgba(c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  // 磷光扫描线：每 7 秒从上往下扫一遍
  const sy = ((t / 7) % 1) * (H + 200) - 100;
  const sg = g.createLinearGradient(0, sy - 90, 0, sy + 6); sg.addColorStop(0, rgba(C.green, 0)); sg.addColorStop(1, rgba(C.green, .045));
  g.fillStyle = sg; g.fillRect(0, sy - 90, W, 96);
  // 光束里的浮尘
  for (let i = 0; i < 30; i++) {
    const x = (hash(i * 3.3) * W + t * (6 + hash(i) * 12)) % W, y = (hash(i * 9.1) * H - t * (4 + hash(i * 2) * 8) + H * 10) % H;
    dot(g, x, y, 1.2 + hash(i * 4.4) * 2.2, '#CFE8F5', Math.max(0, .05 + .05 * Math.sin(t * .8 + i)));
  }
}
function postFX(g, { cache, t, cw, ch }) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cache.vign, 0, 0, cw, ch);
  const fr = Math.floor(t * FPS), gp = g.createPattern(cache.grain[fr % 4], 'repeat');
  g.globalAlpha = .06; g.globalCompositeOperation = 'overlay';
  g.translate(Math.floor(hash(fr) * 256), Math.floor(hash(fr + 7) * 256)); g.scale(Math.max(1, SCX * .75), Math.max(1, SCX * .75));
  g.fillStyle = gp; g.fillRect(-512, -512, cw + 1024, ch + 1024);
  g.restore();
}
