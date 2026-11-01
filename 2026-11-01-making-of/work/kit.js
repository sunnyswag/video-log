/* =====================================================================
 * Claude 是怎么做这 8 期视频的 —— 画面工具：导播间风格包
 * 冷灰蓝控制台 + 多画面监视墙 + 彩色 tally 灯 + 多轨时间线 + 导播台按键 + 场记牌。
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题：控制台 + tally ---------------- */
const C = {
  bg0: '#161C25', bg1: '#222B38', bg2: '#2E394A',
  panel: '#323D4E', panelL: '#4A586D', panelD: '#1F2631', bezel: '#12161D', screen: '#080B10', slot: '#0F141B',
  line: '#4B5A6F', ink: '#EEF2F7', ink2: '#A9B6C6', ink3: '#728096',
  red: '#FF3B44', redD: '#4A1418', green: '#2FDC7E', greenD: '#0D4029', amber: '#FFB12B', amberD: '#4A320B', grey: '#66717F',
  cyan: '#58C8FF', violet: '#B89DFF', coral: '#FF8A5C', pink: '#FF7EB4', teal: '#3FD6BF', steel: '#C4D0DD', blue: '#7090FF',
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
/* 角色：名字、颜色 */
const ROLE = {
  me: ['我', '#F3E3C3'], lead: ['总负责人', C.coral], sub: ['子 agent', '#FFB08A'],
  codex: ['Codex', C.cyan], zcode: ['ZCode', C.violet], ci: ['云端', C.blue],
};
/* 时间线片段：阶段 → 颜色 */
const PH = {
  稿: '#FFB86B', 核对: C.violet, 画面: C.cyan, 检查: C.teal, 配乐: C.pink, 审阅: C.steel,
  推送: '#8EA0B6', 云端: C.blue, 收尾: C.green, 中断: C.grey,
};
const TALLY = { red: C.red, amber: C.amber, grey: C.grey, green: C.green };

/* ---------------- 运动曲线 ---------------- */
const pop = p => p <= 0 ? 0 : p >= 1 ? 1 : eback(p);
const spring = (t, k = 6, f = 1.4) => t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(f * TAU * t);
const win = (lt, a, b, fi = .3, fo = .3) => Math.min(eo(seg(lt, a, a + fi)), 1 - eo(seg(lt, b - fo, b)));
const wob = (t, f = 1, a = 1, s = 0) => Math.sin((t + s) * TAU * f) * a;

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
/* SMPTE 时间码 HH:MM:SS:FF */
function tcStr(sec) {
  const f = Math.floor(sec * FPS + 1e-6), ff = f % FPS, s = Math.floor(f / FPS), p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
}
const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/* ---------------- 形状 ---------------- */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
function shadow(g, a = .3, blur = 26, oy = 10) { g.shadowColor = `rgba(4,7,12,${a})`; g.shadowBlur = blur * SH(); g.shadowOffsetY = oy * SH(); }
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; }
function card(g, x, y, w, h, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, o.r ?? 18);
  if (o.shadow !== false) shadow(g, o.sa ?? .38, o.sb ?? 24, o.so ?? 9);
  g.fillStyle = o.fill || C.panel; g.fill(); noShadow(g);
  if (o.lw !== 0) { g.lineWidth = o.lw ?? 2.5; g.strokeStyle = o.stroke || C.line; if (o.dash) g.setLineDash(o.dash); g.stroke(); }
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
function icCheck(g, x, y, s, c = C.green, p = 1, lw) { path(g, partial([[x - s * .45, y], [x - s * .12, y + s * .32], [x + s * .5, y - s * .38]], p), { c, w: lw || s * .2 }); }
function icCross(g, x, y, s, c = C.red, p = 1, lw) {
  const k = s * .42;
  path(g, partial([[x - k, y - k], [x + k, y + k]], clamp(p * 2)), { c, w: lw || s * .2 });
  path(g, partial([[x + k, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c, w: lw || s * .2 });
}
/* 斜线阴影块（中断、暂停） */
function hatchRect(g, x, y, w, h, c, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, o.r ?? 6); g.clip(); g.fillStyle = rgba(c, o.fa ?? .22); g.fillRect(x, y, w, h);
  g.strokeStyle = rgba(c, o.la ?? .8); g.lineWidth = o.lw || 4;
  const st = o.step || 16, off = (o.off || 0) % st;
  for (let i = -h - st; i < w + h; i += st) { g.beginPath(); g.moveTo(x + i + off, y + h); g.lineTo(x + i + off + h, y); g.stroke(); }
  g.restore();
  if (o.edge !== false) { g.save(); rr(g, x, y, w, h, o.r ?? 6); g.lineWidth = 2; g.strokeStyle = rgba(c, .9); g.stroke(); g.restore(); }
}
function burst(g, x, y, k, c, n = 12, r = 120) {
  if (k < 0 || k > .9) return;
  for (let i = 0; i < n; i++) {
    const ang = i / n * TAU + hash(i * 3.1) * .5, sp = r * (.6 + hash(i * 7.7) * .6), e = eo(k / .9);
    dot(g, x + Math.cos(ang) * sp * e, y + Math.sin(ang) * sp * e + 60 * k * k, (5 + hash(i) * 5) * (1 - e * .7), i % 3 ? c : C.ink, 1 - e);
  }
}
function ripple(g, x, y, k, c, r0 = 30, r1 = 120, d = .7) { if (k >= 0 && k < d) ring(g, x, y, r0 + (r1 - r0) * eo(k / d), c, 5, 1 - k / d); }
/* 弹出式标签 */
function tag(g, s, x, y, c, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    const fs = o.fs || 28, w = textW(g, s, { s: fs, w: 900, f: o.f }) + 40, h = fs + 24;
    card(g, -w / 2, -h / 2, w, h, { r: o.r ?? h / 2, fill: o.fill || c, lw: o.lw ?? 0, stroke: o.stroke, sa: .4, sb: 16, so: 6 });
    text(g, s, 0, 1, { s: fs, w: 900, c: o.tc || '#10151C', f: o.f });
  }, { rot: o.rot || 0, al: o.al });
}

/* ---------------- 控制台零件 ---------------- */
/* 拉丝金属面板：渐变 + 横向拉丝 + 顶部高光 + 角螺丝 */
function steel(g, x, y, w, h, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  const r = o.r ?? 14;
  rr(g, x, y, w, h, r); if (o.shadow !== false) shadow(g, .5, 30, 12);
  const lg = g.createLinearGradient(0, y, 0, y + h); lg.addColorStop(0, o.top || C.panelL); lg.addColorStop(.08, o.fill || C.panel); lg.addColorStop(1, o.bot || C.panelD);
  g.fillStyle = lg; g.fill(); noShadow(g);
  g.save(); rr(g, x, y, w, h, r); g.clip();
  for (let i = 0; i < h / 3; i++) { const yy = y + i * 3 + hash(i * 1.7 + x) * 2; g.fillStyle = `rgba(255,255,255,${.012 + hash(i * 3.3 + y) * .022})`; g.fillRect(x, yy, w, 1); }
  g.restore();
  rr(g, x, y, w, h, r); g.lineWidth = 2; g.strokeStyle = '#0B0F15'; g.stroke();
  rr(g, x + 2, y + 2, w - 4, h - 4, r - 2); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.08)'; g.stroke();
  if (o.screws !== false && w > 120 && h > 80) for (const [sx, sy] of [[x + 14, y + 14], [x + w - 14, y + 14], [x + 14, y + h - 14], [x + w - 14, y + h - 14]]) {
    dot(g, sx, sy, 4.5, '#1A2029'); dot(g, sx - .8, sy - .8, 3.2, '#5A6779'); path(g, [[sx - 2.4, sy + 2.4], [sx + 2.4, sy - 2.4]], { c: '#1A2029', w: 1.4 });
  }
  g.restore();
}
/* 指示灯：on∈[0,1]；带光晕 */
function lamp(g, x, y, r, col, on = 1, o = {}) {
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  dot(g, x, y, r + 3, '#0A0D12');
  if (on > .02) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r * (o.halo || 4.2)); rg.addColorStop(0, rgba(col, .55 * on)); rg.addColorStop(1, rgba(col, 0));
    g.fillStyle = rg; g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
  }
  const lg = g.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r);
  lg.addColorStop(0, on > .02 ? '#FFFFFF' : '#3A4350'); lg.addColorStop(.35, on > .02 ? col : '#2A313B'); lg.addColorStop(1, on > .02 ? rgba(col, .75) : '#1C222A');
  g.globalAlpha *= on > .02 ? .35 + .65 * on : 1;
  dot(g, x, y, r, lg); g.restore();
}
/* tally 状态 → 颜色与亮度（琥珀慢闪，红常亮带呼吸） */
function tallyOn(state, lt) {
  if (state === 'amber') return .55 + .45 * Math.abs(Math.sin(lt * 2.4));
  if (state === 'red') return .88 + .12 * Math.sin(lt * 5);
  if (state === 'grey') return 0;
  return state ? 1 : 0;
}
/* 监视器（多画面格子）：边框、屏幕、内容、扫描线、玻璃反光、tally 边框、下方名牌（UMD） */
function monitor(g, x, y, w, h, o = {}, content) {
  const lt = o.lt || 0, st = o.tally, col = TALLY[st] || C.grey, on = tallyOn(st, lt);
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  const umd = o.umd === false ? 0 : (o.umdH || 40);
  card(g, x - 10, y - 10, w + 20, h + 20 + umd, { r: 10, fill: C.bezel, lw: 2, stroke: '#05070A', sa: .45, sb: 24, so: 8 });
  g.save(); rr(g, x, y, w, h, 4); g.clip();
  g.fillStyle = o.off ? '#06080B' : C.screen; g.fillRect(x, y, w, h);
  if (content && !o.off) { g.save(); g.translate(x, y); content(g, w, h); g.restore(); }
  if (o.dim) { g.fillStyle = `rgba(6,8,11,${clamp(o.dim)})`; g.fillRect(x, y, w, h); }
  g.fillStyle = 'rgba(0,0,0,.13)'; for (let yy = y + 1; yy < y + h; yy += 4) g.fillRect(x, yy, w, 1.6);
  const sx = x - w + ((lt * 70 + (o.seed || 0) * 137) % (w * 3));
  const gr = g.createLinearGradient(sx, y, sx + w * .45, y + h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.07)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.restore();
  if (st && st !== 'grey') { g.save(); rr(g, x - 3, y - 3, w + 6, h + 6, 6); g.lineWidth = o.bw || 5; g.strokeStyle = rgba(col, .35 + .65 * on); g.shadowColor = rgba(col, .7 * on); g.shadowBlur = 18 * SH(); g.stroke(); g.restore(); }
  else { rr(g, x, y, w, h, 4); g.lineWidth = 2; g.strokeStyle = '#2A323E'; g.stroke(); }
  if (umd) {
    const uy = y + h + 10;
    g.fillStyle = '#0B0E13'; g.fillRect(x, uy, w, umd - 6);
    if (st) lamp(g, x + 22, uy + (umd - 6) / 2, 9, col, on);
    if (o.label) text(g, o.label, x + (st ? 42 : 14), uy + (umd - 6) / 2 + 1, { f: o.lf || 'mono', s: o.lfs || 24, w: 700, a: 'left', c: o.lc || C.ink });
    if (o.right) text(g, o.right, x + w - 12, uy + (umd - 6) / 2 + 1, { f: 'mono', s: o.rfs || 24, w: 700, a: 'right', c: o.rc || C.ink2 });
  }
  g.restore();
}
/* 导播台按键：on 亮度、press 按下深度、col 背光色 */
function key(g, x, y, w, h, label, o = {}) {
  const on = o.on || 0, pr = o.press || 0, col = o.col || C.red;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x - 4, y - 4, w + 8, h + 8, 10); g.fillStyle = '#0B0F14'; g.fill();
  const dy = pr * 4;
  if (on > .02) { g.save(); rr(g, x, y + dy, w, h, 8); g.shadowColor = rgba(col, .85 * on); g.shadowBlur = 26 * SH(); g.fillStyle = rgba(col, .9); g.fill(); g.restore(); }
  const lg = g.createLinearGradient(0, y + dy, 0, y + h + dy);
  if (on > .02) { lg.addColorStop(0, rgba('#FFFFFF', .55 * on)); lg.addColorStop(.25, col); lg.addColorStop(1, rgba(col, .78)); }
  else { lg.addColorStop(0, '#5A6679'); lg.addColorStop(.2, '#3F4A5B'); lg.addColorStop(1, '#2B3340'); }
  g.save(); g.globalAlpha *= on > .02 ? .4 + .6 * on : 1; rr(g, x, y + dy, w, h, 8); g.fillStyle = lg; g.fill(); g.restore();
  if (on <= .02 && o.idle) { rr(g, x, y + dy, w, h, 8); g.lineWidth = 2; g.strokeStyle = rgba(col, .5); g.stroke(); }
  if (label) {
    const lines = String(label).split('\n'), fs = o.fs || 26;
    lines.forEach((ln, i) => text(g, ln, x + w / 2, y + dy + h / 2 + (i - (lines.length - 1) / 2) * (fs + 4) + 1,
      { s: fs, w: 900, f: o.f, c: on > .5 ? '#11151B' : (o.lc || C.ink) }));
  }
  g.restore();
}
/* T 型推子：p∈[0,1] */
function tbar(g, x, y, h, p, o = {}) {
  steel(g, x - 34, y - 20, 68, h + 40, { r: 12, screws: false });
  rr(g, x - 6, y, 12, h, 6); g.fillStyle = '#07090D'; g.fill();
  for (let i = 0; i <= 10; i++) path(g, [[x + 16, y + i * h / 10], [x + (i % 5 ? 24 : 30), y + i * h / 10]], { c: C.ink3, w: 2 });
  const hy = y + h * clamp(p);
  g.save(); shadow(g, .5, 12, 5); rr(g, x - 46, hy - 13, 92, 26, 8);
  const lg = g.createLinearGradient(0, hy - 13, 0, hy + 13); lg.addColorStop(0, '#DCE3EC'); lg.addColorStop(1, '#8592A3'); g.fillStyle = lg; g.fill(); g.restore();
  path(g, [[x - 34, hy], [x + 34, hy]], { c: o.col || C.red, w: 3 });
}
/* 电平表 */
function vu(g, x, y, w, h, lt, seed = 0, level = 1) {
  const n = Math.floor(h / 9), v = clamp((.35 + .45 * Math.abs(Math.sin(lt * 3.1 + seed)) * (.6 + .4 * hash(Math.floor(lt * 12) + seed * 17))) * level);
  for (let i = 0; i < n; i++) {
    const on = i / n < v, c = i / n > .85 ? C.red : i / n > .65 ? C.amber : C.green;
    g.fillStyle = on ? c : rgba(c, .12); g.fillRect(x, y + h - (i + 1) * 9 + 2, w, 6);
  }
}
/* 进度条 */
function bar(g, x, y, w, h, p, col, o = {}) {
  rr(g, x, y, w, h, h / 2); g.fillStyle = o.bg || '#0B0F14'; g.fill();
  if (p > 0) {
    rr(g, x, y, Math.max(h, w * clamp(p)), h, h / 2); g.fillStyle = col; g.fill();
    if (p < 1 && o.lt != null) { g.save(); rr(g, x, y, w * clamp(p), h, h / 2); g.clip(); for (let i = -2; i < w / 18; i++) { const xx = x + i * 18 + (o.lt * 40 % 18); g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.moveTo(xx, y + h); g.lineTo(xx + 8, y + h); g.lineTo(xx + 8 + h, y); g.lineTo(xx + h, y); g.fill(); } g.restore(); }
  }
  rr(g, x, y, w, h, h / 2); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.12)'; g.stroke();
}

/* ---------------- 场记牌 ---------------- */
/* open：拍板张开角度比例（1 张开，0 合上）；fields:{ch, title, scene, tc} */
function clapper(g, x, y, s, open, fl, o = {}) {
  at(g, x, y, s, () => {
    const w = 420, h = 260;
    card(g, -w / 2, -h / 2 + 20, w, h, { r: 12, fill: '#14181F', lw: 3, stroke: '#E9EEF4', sa: .55, sb: 30, so: 12 });
    // 表格线
    const L = (a, b) => path(g, [a, b], { c: rgba('#E9EEF4', .7), w: 2 });
    L([-w / 2 + 12, -h / 2 + 84], [w / 2 - 12, -h / 2 + 84]); L([-w / 2 + 12, h / 2 - 30], [w / 2 - 12, h / 2 - 30]);
    L([-w / 2 + 150, -h / 2 + 84], [-w / 2 + 150, h / 2 - 30]); L([w / 2 - 120, -h / 2 + 84], [w / 2 - 120, h / 2 - 30]);
    text(g, 'WORK ARCHIVE · MAKING-OF', 0, -h / 2 + 56, { f: 'mono', s: 22, w: 700, c: C.ink2, ls: 2 });
    text(g, 'CH', -w / 2 + 81, -h / 2 + 106, { f: 'mono', s: 20, w: 700, c: C.ink3 });
    text(g, fl.ch, -w / 2 + 81, -h / 2 + 160, { f: 'disp', s: 76, w: 900, c: C.ink });
    text(g, 'SCENE', 25, -h / 2 + 106, { f: 'mono', s: 20, w: 700, c: C.ink3 });
    text(g, fl.scene, 25, -h / 2 + 160, { f: 'disp', s: 60, w: 900, c: C.ink });
    text(g, 'TAKE', w / 2 - 60, -h / 2 + 106, { f: 'mono', s: 20, w: 700, c: C.ink3 });
    text(g, '1', w / 2 - 60, -h / 2 + 160, { f: 'disp', s: 60, w: 900, c: C.ink });
    text(g, fl.tc, 0, h / 2 - 2, { f: 'mono', s: 26, w: 700, c: C.red, glow: rgba(C.red, .7), gb: 10 });
    // 拍板（铰链在左上）
    const stick = (yy, ang) => {
      g.save(); g.translate(-w / 2, yy); g.rotate(ang);
      rr(g, 0, -20, w, 40, 6); g.fillStyle = '#E9EEF4'; g.fill();
      g.save(); rr(g, 0, -20, w, 40, 6); g.clip();
      for (let i = -1; i < 9; i++) { g.beginPath(); g.moveTo(i * 54 + 6, 20); g.lineTo(i * 54 + 30, -20); g.lineTo(i * 54 + 56, -20); g.lineTo(i * 54 + 32, 20); g.closePath(); g.fillStyle = i % 2 ? '#14181F' : C.red; g.fill(); }
      g.restore(); rr(g, 0, -20, w, 40, 6); g.lineWidth = 2.5; g.strokeStyle = '#0B0F15'; g.stroke();
      g.restore();
    };
    stick(-h / 2 + 2, 0);
    stick(-h / 2 - 38 + 38 * (1 - open) * 0, -open * .55);
    dot(g, -w / 2 + 14, -h / 2 - 16, 8, '#8E9AAA'); ring(g, -w / 2 + 14, -h / 2 - 16, 8, '#0B0F15', 2);
  }, { rot: o.rot || 0, al: o.al });
}

/* ---------------- 角色徽标 ---------------- */
function icPerson(g, x, y, s, c) { dot(g, x, y - s * .28, s * .26, c); g.save(); g.beginPath(); g.arc(x, y + s * .5, s * .5, Math.PI, 0); g.closePath(); g.fillStyle = c; g.fill(); g.restore(); }
function icHeadset(g, x, y, s, c) { icPerson(g, x, y + s * .05, s * .9, c); ring(g, x, y - s * .2, s * .4, c, s * .09, 1, Math.PI * 1.05, Math.PI * 1.95); dot(g, x - s * .4, y - s * .12, s * .1, c); dot(g, x + s * .4, y - s * .12, s * .1, c); path(g, [[x + s * .4, y - s * .05], [x + s * .2, y + s * .18]], { c, w: s * .07 }); }
function icCamera(g, x, y, s, c) { rr(g, x - s * .5, y - s * .3, s * .72, s * .6, s * .08); g.fillStyle = c; g.fill(); g.beginPath(); g.moveTo(x + s * .22, y - s * .12); g.lineTo(x + s * .52, y - s * .3); g.lineTo(x + s * .52, y + s * .3); g.lineTo(x + s * .22, y + s * .12); g.closePath(); g.fill(); dot(g, x - s * .14, y, s * .14, C.bg0); }
function icCode(g, x, y, s, c) { path(g, [[x - s * .18, y - s * .3], [x - s * .48, y], [x - s * .18, y + s * .3]], { c, w: s * .12 }); path(g, [[x + s * .18, y - s * .3], [x + s * .48, y], [x + s * .18, y + s * .3]], { c, w: s * .12 }); path(g, [[x + s * .08, y - s * .36], [x - s * .08, y + s * .36]], { c, w: s * .1 }); }
function icLens(g, x, y, s, c) { ring(g, x - s * .1, y - s * .1, s * .3, c, s * .11, 1, 0, TAU); path(g, [[x + s * .12, y + s * .12], [x + s * .42, y + s * .42]], { c, w: s * .15 }); }
function icCloud(g, x, y, s, c) { g.save(); g.fillStyle = c; g.beginPath(); g.arc(x - s * .22, y + s * .06, s * .22, 0, TAU); g.arc(x + s * .05, y - s * .1, s * .3, 0, TAU); g.arc(x + s * .3, y + s * .08, s * .2, 0, TAU); g.fill(); g.fillRect(x - s * .22, y + s * .06, s * .52, s * .22); g.restore(); }
function icDoc(g, x, y, s, c) { rr(g, x - s * .32, y - s * .42, s * .64, s * .84, s * .06); g.fillStyle = c; g.fill(); for (let i = 0; i < 4; i++) path(g, [[x - s * .2, y - s * .22 + i * s * .16], [x + s * .2 - (i === 3 ? s * .16 : 0), y - s * .22 + i * s * .16]], { c: C.bg0, w: s * .06 }); }
const ROLE_IC = { me: icPerson, lead: icHeadset, sub: icCamera, codex: icCode, zcode: icLens, ci: icCloud };
function badge(g, role, x, y, r, o = {}) {
  const [, c] = ROLE[role];
  at(g, x, y, o.s ?? 1, () => {
    if (o.glow) { const rg = g.createRadialGradient(0, 0, r * .6, 0, 0, r * 2); rg.addColorStop(0, rgba(c, .35 * o.glow)); rg.addColorStop(1, rgba(c, 0)); g.fillStyle = rg; g.fillRect(-r * 2, -r * 2, r * 4, r * 4); }
    dot(g, 0, 0, r, '#141922'); ring(g, 0, 0, r, c, 4, 1, 0, TAU);
    ROLE_IC[role](g, 0, 0, r * 1.05, c);
  }, { al: o.al });
}

/* ---------------- 七段数码管（fps 缩略图用） ---------------- */
const SEG7 = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
function seg7(g, x, y, hh, str, col, ghost = .1) {
  const ww = hh * .52, th = hh * .12;
  let cx = x;
  for (const ch of str) {
    if (ch === '.') { dot(g, cx - ww * .12, y + hh / 2 - th / 2, th * .6, col); continue; }
    const on = SEG7[ch] || '';
    const segs = { a: [0, -1, 1], b: [1, -.5, 0], c: [1, .5, 0], d: [0, 1, 1], e: [-1, .5, 0], f: [-1, -.5, 0], g: [0, 0, 1] };
    for (const k in segs) {
      const [sx, sy, horiz] = segs[k], px = cx + ww / 2 + sx * ww / 2, py = y + sy * hh / 2;
      g.fillStyle = on.includes(k) ? col : rgba(col, ghost);
      if (horiz) g.fillRect(px - ww / 2 + th / 2, py - th / 2, ww - th, th); else g.fillRect(px - th / 2, py - hh / 4 + th / 2, th, hh / 2 - th);
    }
    cx += ww + hh * .2;
  }
}

/* ---------------- 8 期缩略画面（神似，局部 320×180） ---------------- */
function tbg(g, c0, c1) { const lg = g.createLinearGradient(0, 0, 0, 180); lg.addColorStop(0, c0); lg.addColorStop(1, c1); g.fillStyle = lg; g.fillRect(0, 0, 320, 180); }
const THUMB = {
  'sip-v3'(g, t) { // 扁平 MG：两块屏 + 网关 + 消息胶囊
    tbg(g, '#F6F0E6', '#EDE3D2');
    const rg = g.createRadialGradient(80 + wob(t, .05, 20), 50, 0, 80, 50, 140); rg.addColorStop(0, 'rgba(53,99,233,.12)'); rg.addColorStop(1, 'rgba(53,99,233,0)'); g.fillStyle = rg; g.fillRect(0, 0, 320, 180);
    path(g, [[98, 104], [140, 88]], { c: '#B9AE9B', w: 4, dash: [2, 8] }); path(g, [[180, 88], [222, 104]], { c: '#B9AE9B', w: 4, dash: [2, 8] });
    const dev = (x, c, l, ph) => { const y = 108 + wob(t, .3, 2, ph); card(g, x - 40, y - 30, 80, 60, { r: 12, fill: l, lw: 2.5, stroke: '#1E2333', sa: .15, sb: 8, so: 3 }); rr(g, x - 32, y - 23, 64, 40, 7); g.fillStyle = '#fff'; g.fill(); rr(g, x - 32, y - 23, 64, 40, 7); g.lineWidth = 2; g.strokeStyle = '#1E2333'; g.stroke(); dot(g, x, y - 4, 9, c); };
    dev(60, '#3563E9', '#E2E9FF', 0); dev(260, '#EE7D33', '#FFE6D2', .5);
    for (const sx of [-1, 1]) { g.save(); g.translate(160 + sx * 20, 70); g.rotate(sx * .2); rr(g, -3, -26, 6, 28, 3); g.fillStyle = '#EAE4FF'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#1E2333'; g.stroke(); dot(g, 0, -28, 4.5, '#7356F0'); g.restore(); }
    card(g, 124, 70, 72, 34, { r: 10, fill: '#EAE4FF', lw: 2.5, stroke: '#1E2333', sa: .15, sb: 8, so: 3 });
    for (let i = 0; i < 3; i++) dot(g, 146 + i * 14, 87, 3.5, hash(Math.floor(t * 6) + i) > .4 ? ['#14A579', '#EF9F12', '#3563E9'][i] : '#ECEDEF');
    const k = (t * .6) % 1, a = [80, 70], m = [160, 40], b = [240, 70], u = k < .5 ? eio(k * 2) : eio(k * 2 - 1);
    const pa = k < .5 ? a : m, pb = k < .5 ? m : b, p = [lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u) - Math.sin(u * Math.PI) * 18];
    rr(g, p[0] - 22, p[1] - 9, 44, 18, 9); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#1E2333'; g.stroke(); rr(g, p[0] - 20, p[1] - 7, 14, 14, 7); g.fillStyle = k < .5 ? '#3563E9' : '#14A579'; g.fill();
    if (k > .9) ring(g, 240, 70, 10 + (k - .9) * 300, '#14A579', 2.5, 1 - (k - .9) * 10);
  },
  curtain(g, t) { // 工程蓝图：网格 + 导轨 + 双电机 + 褶皱窗帘 + 尺寸线
    tbg(g, '#0F3A72', '#071F3F');
    for (let x = 0; x <= 320; x += 16) path(g, [[x, 0], [x, 180]], { c: rgba('#7FD6FF', x % 64 ? .1 : .24), w: 1 });
    for (let y = 0; y <= 180; y += 16) path(g, [[0, y], [320, y]], { c: rgba('#7FD6FF', y % 64 ? .1 : .24), w: 1 });
    path(g, [[30, 38], [290, 38]], { c: '#EAF3FF', w: 3 });
    for (const mx of [30, 290]) { rr(g, mx - 16, 26, 32, 24, 4); g.fillStyle = '#0D3466'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#7FD6FF'; g.stroke(); ring(g, mx, 38, 6, '#FFC857', 2, 1, t * 4, t * 4 + 4.5); }
    const op = .5 + .5 * Math.sin(t * 1.1), xl = lerp(70, 150, op), xr = lerp(250, 170, op);
    const pleat = (x0, x1) => { const n = 7; g.beginPath(); for (let i = 0; i <= 40; i++) { const u = i / 40, x = lerp(x0, x1, u); g.lineTo(x + Math.sin(u * n * TAU) * 3, 46); } for (let i = 40; i >= 0; i--) { const u = i / 40, x = lerp(x0, x1, u); g.lineTo(x + Math.sin(u * n * TAU) * 4, 146); } g.closePath(); g.fillStyle = rgba('#7FD6FF', .14); g.fill(); g.lineWidth = 2; g.strokeStyle = '#EAF3FF'; g.stroke(); for (let k = 1; k < n; k++) { const x = lerp(x0, x1, k / n); path(g, [[x, 48], [x, 144]], { c: rgba('#EAF3FF', .45), w: 1.2 }); } };
    pleat(46, xl); pleat(xr, 274);
    path(g, [[46, 162], [274, 162]], { c: '#FFC857', w: 2 }); arrowHead(g, 46, 162, Math.PI, '#FFC857', 9); arrowHead(g, 274, 162, 0, '#FFC857', 9);
    path(g, [[46, 154], [46, 170]], { c: '#FFC857', w: 2 }); path(g, [[274, 154], [274, 170]], { c: '#FFC857', w: 2 });
  },
  taskqueue(g, t) { // 工厂流水线：传送带 + 纸箱 + 齿轮 + 警示灯
    g.fillStyle = '#263235'; g.fillRect(0, 0, 320, 120); g.fillStyle = '#34373A'; g.fillRect(0, 120, 320, 60);
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#1D2022' : '#F7B900'; g.beginPath(); g.moveTo(i * 30 - 10, 22); g.lineTo(i * 30 + 10, 22); g.lineTo(i * 30, 10); g.lineTo(i * 30 - 20, 10); g.fill(); }
    g.save(); g.translate(48, 66); g.rotate(t * 1.4); g.fillStyle = '#3C7A71'; for (let i = 0; i < 8; i++) { g.rotate(TAU / 8); g.fillRect(-5, -28, 10, 10); } dot(g, 0, 0, 20, '#3C7A71'); dot(g, 0, 0, 7, '#182023'); g.restore();
    const bl = Math.sin(t * 6) > 0; lamp(g, 286, 44, 9, '#F26B22', bl ? 1 : .2);
    rr(g, 14, 124, 292, 18, 9); g.fillStyle = '#1D2022'; g.fill();
    for (let i = 0; i < 11; i++) { const rx = 26 + i * 27; dot(g, rx, 133, 7, '#7F8C92'); path(g, [[rx + Math.cos(t * 5) * 6, 133 + Math.sin(t * 5) * 6], [rx - Math.cos(t * 5) * 6, 133 - Math.sin(t * 5) * 6]], { c: '#4B555A', w: 2 }); }
    for (let i = 0; i < 5; i++) { const x = ((i * 74 + t * 40) % 370) - 40, s = i % 2 ? 34 : 42; rr(g, x, 124 - s, s * 1.2, s, 3); g.fillStyle = '#C99459'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#97683A'; g.stroke(); g.fillStyle = '#EADCB9'; g.fillRect(x + s * .5, 124 - s, s * .2, s); }
    g.fillStyle = '#1D2022'; g.fillRect(0, 150, 320, 30);
  },
  cards(g, t) { // 包豪斯积木：卡片格 + 原色几何
    tbg(g, '#F2EDE3', '#E8E1D3');
    const R = '#D93A2B', Y = '#F2B705', B = '#1F4FA8', K = '#161616';
    const cell = (i, x, y, s) => {
      card(g, x, y, 84, 64, { r: 4, fill: '#FBF9F4', lw: 3, stroke: K, shadow: false });
      const cx = x + 42, cy = y + 32;
      at(g, cx, cy, s, () => {
        if (i === 0) dot(g, 0, 0, 20, R);
        if (i === 1) { g.fillStyle = Y; g.fillRect(-20, -20, 40, 40); }
        if (i === 2) { g.beginPath(); g.moveTo(0, -22); g.lineTo(22, 18); g.lineTo(-22, 18); g.closePath(); g.fillStyle = B; g.fill(); }
        if (i === 3) { g.beginPath(); g.moveTo(-20, 20); g.arc(-20, 20, 40, -Math.PI / 2, 0); g.closePath(); g.fillStyle = B; g.fill(); }
        if (i === 4) { g.fillStyle = R; g.fillRect(-28, -8, 56, 16); dot(g, 0, 0, 7, Y); }
        if (i === 5) { g.beginPath(); g.arc(0, 8, 22, Math.PI, 0); g.closePath(); g.fillStyle = Y; g.fill(); g.fillStyle = K; g.fillRect(-22, 10, 44, 5); }
      }, { rot: i === 2 ? wob(t, .2, .08) : 0 });
    };
    const k = (t * .35) % 1, drop = 1 - spring(clamp((k - .15) * 3), 7, 1.2);
    for (let i = 0; i < 5; i++) cell(i, 24 + (i % 3) * 94, 18 + Math.floor(i / 3) * 76, 1);
    if (k > .15) cell(5, 24 + 2 * 94, 94 - drop * 110, 1); else { g.save(); rr(g, 212, 94, 84, 64, 4); g.setLineDash([6, 6]); g.lineWidth = 2.5; g.strokeStyle = K; g.stroke(); g.restore(); }
    g.fillStyle = K; g.fillRect(0, 170, 320, 10);
  },
  subscription(g, t) { // 地铁线路图：彩色线路 + 站点 + 列车
    tbg(g, '#F6F3EA', '#EFEBDF');
    g.beginPath(); g.moveTo(0, 150); for (let x = 0; x <= 320; x += 10) g.lineTo(x, 150 + Math.sin(x * .03) * 6); g.lineTo(320, 180); g.lineTo(0, 180); g.fillStyle = '#CFE2EC'; g.fill();
    const red = [[20, 60], [120, 60], [170, 110], [300, 110]], blue = [[150, 10], [150, 170]], green = [[40, 160], [100, 100], [260, 100], [300, 60]];
    path(g, green, { c: '#2E9E5B', w: 9 }); path(g, blue, { c: '#2F6FD8', w: 9 }); path(g, red, { c: '#E2483D', w: 9 });
    for (const [x, y] of [[20, 60], [70, 60], [120, 60], [230, 110], [300, 110], [150, 30], [150, 150], [40, 160], [300, 60]]) { dot(g, x, y, 7, '#fff'); ring(g, x, y, 7, '#1F2633', 3, 1, 0, TAU); }
    for (const [x, y] of [[150, 60], [150, 100]]) { dot(g, x, y, 11, '#fff'); ring(g, x, y, 11, '#1F2633', 4, 1, 0, TAU); }
    const u = (t * .16) % 1, q = partial(red, u), p = q[q.length - 1], pp = q[Math.max(0, q.length - 2)];
    at(g, p[0], p[1], 1, () => { rr(g, -13, -8, 26, 16, 6); g.fillStyle = '#1F2633'; g.fill(); rr(g, -9, -4, 6, 6, 1); g.fillStyle = '#7CCBFF'; g.fill(); rr(g, 3, -4, 6, 6, 1); g.fill(); }, { rot: Math.atan2(p[1] - pp[1], p[0] - pp[0]) || 0 });
  },
  jsruntime(g, t) { // 邮局 + 气动管道：黄铜管 + 胶囊 + 信封
    tbg(g, '#F3E9D6', '#E8DAC0');
    for (let x = 0; x < 320; x += 20) path(g, [[x, 0], [x, 180]], { c: 'rgba(110,99,87,.08)', w: 8 });
    const pipe = [[0, 46], [110, 46], [140, 76], [140, 120], [170, 150], [320, 150]];
    path(g, pipe, { c: '#8A6424', w: 22 }); path(g, pipe, { c: '#C8963E', w: 16 }); path(g, pipe, { c: 'rgba(242,217,154,.7)', w: 4 });
    for (const [x, y] of [[60, 46], [140, 98], [240, 150]]) { rr(g, x - 7, y - 14, 14, 28, 3); g.fillStyle = '#8A6424'; g.fill(); }
    const u = (t * .45) % 1, q = partial(pipe, u), p = q[q.length - 1];
    dot(g, p[0], p[1], 9, '#2C7C7E'); ring(g, p[0], p[1], 9, '#1D5759', 2.5, 1, 0, TAU);
    card(g, 212, 22, 92, 70, { r: 6, fill: '#B4523C', lw: 2.5, stroke: '#7E3626', shadow: false });
    const eu = (t * .45 + .3) % 1, ey = 66 - eo(clamp(eu * 3)) * 22;
    g.save(); rr(g, 220, 30, 76, 54, 4); g.clip(); card(g, 232, ey - 18, 52, 36, { r: 3, fill: '#FFF9EE', lw: 2, stroke: '#6E6357', shadow: false }); path(g, [[232, ey - 18], [258, ey + 2], [284, ey - 18]], { c: '#6E6357', w: 2 }); g.restore();
    dot(g, 40, 120, 18, '#2C7C7E'); ring(g, 40, 120, 18, '#1D5759', 3, 1, 0, TAU); path(g, [[40, 120], [40 + Math.cos(t) * 12, 120 + Math.sin(t) * 12]], { c: '#F2D99A', w: 3 });
  },
  frameanim(g, t) { // 胶片放映室：滚动胶片 + 逐帧小球 + 放映光锥
    tbg(g, '#2A231D', '#1B1714');
    g.save(); g.beginPath(); g.moveTo(320, 30); g.lineTo(0, 0); g.lineTo(0, 180); g.lineTo(320, 70); g.closePath();
    const lg = g.createLinearGradient(320, 50, 0, 90); lg.addColorStop(0, 'rgba(240,166,58,.32)'); lg.addColorStop(1, 'rgba(240,166,58,.02)'); g.fillStyle = lg; g.fill(); g.restore();
    for (let i = 0; i < 18; i++) { const x = (hash(i) * 320 + t * 9) % 320, y = 30 + hash(i * 3) * 120 + wob(t, .2, 6, i); dot(g, x, y, 1.6, '#F2E8D5', .3 + .3 * Math.sin(t * 2 + i)); }
    const off = (t * 60) % 76;
    g.fillStyle = '#14100D'; g.fillRect(0, 70, 320, 84);
    for (let i = -1; i < 6; i++) {
      const x = i * 76 - off + 6, ph = ((i + Math.floor((t * 60) / 76)) % 8 + 8) % 8;
      rr(g, x, 82, 64, 60, 3); g.fillStyle = '#F2E8D5'; g.fill();
      const by = 130 - Math.abs(Math.sin(ph / 8 * Math.PI)) * 34, sq = ph === 0 ? 1.3 : 1;
      g.save(); g.translate(x + 32, by); g.scale(sq, 1 / sq); dot(g, 0, 0, 9, '#D9483B'); g.restore();
      for (let k = 0; k < 4; k++) { rr(g, x + 4 + k * 16, 73, 8, 6, 1.5); g.fillStyle = '#F2E8D5'; g.fill(); rr(g, x + 4 + k * 16, 146, 8, 6, 1.5); g.fill(); }
    }
    dot(g, 300, 40, 14, '#3A2E25'); dot(g, 300, 40, 7, '#F0A63A', .9);
  },
  fps(g, t) { // 实验室仪表：示波器网格 + 七段数码管 + 指针表
    tbg(g, '#101820', '#0A0E13');
    for (let x = 0; x <= 320; x += 20) path(g, [[x, 0], [x, 180]], { c: rgba('#45E89A', x % 80 ? .07 : .16), w: 1 });
    for (let y = 0; y <= 180; y += 20) path(g, [[0, y], [320, y]], { c: rgba('#45E89A', y % 80 ? .07 : .16), w: 1 });
    const vals = ['66.7', '53.3', '24.0'], i = Math.floor(t / 1.6) % 3, col = i === 2 ? '#FF5262' : '#45E89A';
    rr(g, 18, 40, 170, 86, 8); g.fillStyle = '#05080B'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#2A3A48'; g.stroke();
    seg7(g, 30, 83, 56, vals[i], col, .08);
    const cx = 252, cy = 116, v = [66.7, 53.3, 24][i], ang = lerp(Math.PI * 1.1, Math.PI * 1.9, v / 70) + Math.sin(t * 9) * .02 * (1 - seg(t % 1.6, 0, .5));
    ring(g, cx, cy, 52, '#33495A', 6, 1, Math.PI * 1.1, Math.PI * 1.9); ring(g, cx, cy, 52, '#FF5262', 6, 1, Math.PI * 1.1, Math.PI * 1.43);
    path(g, [[cx, cy], [cx + Math.cos(ang) * 46, cy + Math.sin(ang) * 46]], { c: '#FFB23E', w: 3 }); dot(g, cx, cy, 5, '#FFB23E');
    const sy = (t * 50) % 180; g.fillStyle = 'rgba(69,232,154,.06)'; g.fillRect(0, sy, 320, 6);
  },
};
/* 在 w×h 的屏幕里画某期缩略图（按 16:9 铺满） */
function thumb(g, slug, w, h, lt) { g.save(); g.scale(w / 320, h / 180); THUMB[slug](g, lt); g.restore(); }

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

/* ---------------- 背景、后期 ---------------- */
function prepareStyle({ mk, cw, ch }) {
  const base = mk(cw, ch), p = base.getContext('2d'); p.scale(cw / W, ch / H);
  const lg = p.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#2C3748'); lg.addColorStop(.55, '#222B38'); lg.addColorStop(1, '#171D27');
  p.fillStyle = lg; p.fillRect(0, 0, W, H);
  // 拉丝金属：确定性细横纹
  for (let i = 0; i < 1400; i++) { const y = hash(i * 1.31) * H, x = hash(i * 2.17 + 5) * W, l = 80 + hash(i * 4.1) * 420; p.fillStyle = `rgba(255,255,255,${.008 + hash(i * 7.3) * .016})`; p.fillRect(x - l / 2, y, l, 1); }
  // 吸音板穿孔点阵
  for (let y = 18; y < H; y += 26) for (let x = 18 + (Math.floor(y / 26) % 2) * 13; x < W; x += 26) { p.fillStyle = 'rgba(5,8,12,.28)'; p.beginPath(); p.arc(x, y, 2.1, 0, TAU); p.fill(); p.fillStyle = 'rgba(255,255,255,.035)'; p.beginPath(); p.arc(x + .8, y + 1, 1.2, 0, TAU); p.fill(); }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 380, 960, 540, 1200); vg.addColorStop(0, 'rgba(4,6,10,0)'); vg.addColorStop(1, 'rgba(4,6,10,.55)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  const grain = [];
  for (let k = 0; k < 4; k++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt);
  }
  return { base, vign, grain };
}
function drawBackground(g, { cache, t }) {
  g.drawImage(cache.base, 0, 0, W, H);
  // 远处虚焦的监视器光斑（缓慢漂移、偶尔闪动）
  const blobs = [[C.cyan, 300, 260, .10], [C.red, 1640, 300, .08], [C.green, 1180, 860, .06], [C.violet, 620, 820, .05]];
  blobs.forEach(([c, x, y, a], i) => {
    const bx = x + wob(t, .019, 120, i * 3), by = y + wob(t, .015, 70, i * 5), fl = .85 + .15 * Math.sin(t * .7 + i * 2);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, 560); rg.addColorStop(0, rgba(c, a * fl)); rg.addColorStop(1, rgba(c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  // 设备光里的浮尘
  for (let i = 0; i < 30; i++) {
    const x = (hash(i * 3.3) * W + t * (6 + hash(i) * 12)) % W, y = (hash(i * 9.1) * H - t * (5 + hash(i * 2) * 8) + H * 10) % H;
    dot(g, x, y, 1.4 + hash(i * 4.4) * 2.2, '#DDE6F2', .05 + .05 * Math.sin(t * .8 + i));
  }
}
function postFX(g, { cache, t, cw, ch }) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cache.vign, 0, 0);
  const fr = Math.floor(t * FPS), gp = g.createPattern(cache.grain[fr % 4], 'repeat');
  g.globalAlpha = .06; g.globalCompositeOperation = 'overlay';
  g.translate(Math.floor(hash(fr) * 256), Math.floor(hash(fr + 7) * 256)); g.scale(Math.max(1, SCX * .75), Math.max(1, SCX * .75));
  g.fillStyle = gp; g.fillRect(-512, -512, cw + 1024, ch + 1024);
  g.restore();
}
