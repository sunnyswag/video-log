/* =====================================================================
 * 窗帘单双电机与 spec 隔离 —— 画面工具：工程蓝图风格包（主题、晒图纸面、镜头、线稿图元）
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * 画风约定：蓝底白线；先画淡淡的构造线再“上墨”；红笔只用于批注（圈、叉、划线），琥珀色用于印章和强调。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题 ---------------- */
const C = {
  bg0: '#071F3F', bg1: '#0D3466', bg2: '#16508F', band: '#1B5DA6', plate: '#051833',
  ink: '#EAF3FF', ink2: '#B8CCE8', faint: '#86A4CC', dim: '#5F80AE',
  cyan: '#7FD6FF', amber: '#FFC857', red: '#FF7A7A', green: '#7EE2A8',
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
const pop = p => p <= 0 ? 0 : p >= 1 ? 1 : eback(p);                      // 带回弹的弹出
const spring = (t, k = 6, f = 1.4) => t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(f * TAU * t); // 弹簧落定
const win = (lt, a, b, fi = .3, fo = .3) => Math.min(eo(seg(lt, a, a + fi)), 1 - eo(seg(lt, b - fo, b))); // 区间可见度
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
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = (o.gb || 16) * SH(); }
  if (o.stroke) { g.lineWidth = o.lw || 3; g.strokeStyle = o.stroke; g.lineJoin = 'round'; g.strokeText(s, x, y); }
  if (!o.noFill) { g.fillStyle = o.c || C.ink; g.fillText(s, x, y); }
  g.restore();
}
function textW(g, s, o = {}) { g.save(); g.font = font(o); if (o.ls) g.letterSpacing = o.ls + 'px'; const w = g.measureText(s).width; g.restore(); return w; }
/* 打字机：按字符比例截断 */
const typed = (s, p) => Array.from(s).slice(0, Math.round(Array.from(s).length * clamp(p))).join('');

/* ---------------- 基础形状 ---------------- */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
function glowOn(g, a = 1, blur = 16, c = C.cyan) { g.shadowColor = rgba(c, .6 * a); g.shadowBlur = blur * SH(); }
function dot(g, x, y, r, c, al = 1) { if (r <= 0) return; g.save(); g.globalAlpha *= al; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = c; g.fill(); g.restore(); }
function ring(g, x, y, r, c, lw = 3, al = 1, a0 = -TAU / 4, a1 = a0 + TAU) {
  if (r <= 0) return; g.save(); g.globalAlpha *= al; g.beginPath(); g.arc(x, y, r, a0, a1); g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round'; g.stroke(); g.restore();
}
function path(g, pts, o = {}) {
  if (pts.length < 2) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  if (o.glow) glowOn(g, o.glow, o.gb || 14, o.gc || C.cyan);
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.strokeStyle = o.c || C.ink; g.lineWidth = o.w || 3; g.lineCap = o.cap || 'round'; g.lineJoin = 'round';
  if (o.dash) { g.setLineDash(o.dash); g.lineDashOffset = o.off || 0; }
  g.stroke(); g.restore();
}
/* 画到一部分的折线（p∈[0,1]） */
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
/* 两端各外延 d（构造线的“出头”） */
function extend(pts, d) {
  if (pts.length < 2) return pts;
  const a = pts[0], b = pts[1], y = pts[pts.length - 2], z = pts[pts.length - 1];
  const la = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, lz = Math.hypot(z[0] - y[0], z[1] - y[1]) || 1;
  return [[a[0] - (b[0] - a[0]) / la * d, a[1] - (b[1] - a[1]) / la * d], ...pts.slice(1, -1), [z[0] + (z[0] - y[0]) / lz * d, z[1] + (z[1] - y[1]) / lz * d]];
}
/* 描线：先出淡构造线（两端出头），再沿线“上墨”。p∈[0,1] */
function draft(g, pts, p, o = {}) {
  if (p <= 0) return;
  const al = o.al ?? 1, cp = eo(seg(p, 0, .4)), ip = eio(seg(p, .22, 1));
  if (o.construct !== false && p < 1.0001) path(g, partial(extend(pts, o.ext ?? 14), cp), { c: rgba(o.c || C.ink, .2), w: 1.3, al: al * (1 - .6 * seg(p, .8, 1)) });
  if (ip > 0) path(g, partial(pts, ip), { ...o, al });
}
const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y - .01]];
function tip(g, x, y, ang, c = C.ink, s = 18, al = 1) { // 细长尺寸箭头
  g.save(); g.globalAlpha *= al; g.translate(x, y); g.rotate(ang); g.beginPath();
  g.moveTo(0, 0); g.lineTo(-s, -s * .32); g.lineTo(-s, s * .32); g.closePath(); g.fillStyle = c; g.fill(); g.restore();
}
/* 带箭头的引线，p 为画出进度 */
function arrow(g, pts, o = {}) {
  const q = partial(pts, o.p ?? 1); if (q.length < 2) return;
  path(g, q, o);
  const a = q[q.length - 2], b = q[q.length - 1];
  if ((o.p ?? 1) > .02) tip(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), o.c || C.ink, o.hs || 18, o.al ?? 1);
}
/* 以 (x,y) 为中心缩放/旋转后绘制 */
function at(g, x, y, s, fn, o = {}) {
  if (s <= .001 || (o.al != null && o.al <= .001)) return;
  g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); g.scale(s * (o.sx || 1), s * (o.sy || 1));
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  fn(); g.restore();
}

/* ---------------- 蓝图图元 ---------------- */
/* 图框：p 描边进度；fill 底色；dash 虚线（“不存在/配置空间”）；lit 发光；ticks 四角裁切标 */
function frame(g, x, y, w, h, o = {}) {
  const p = o.p ?? 1; if (p <= 0 || w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  const fa = seg(p, .55, 1);
  if (fa > 0 && o.fill !== false) { g.save(); g.globalAlpha *= fa; g.fillStyle = o.fill || rgba(C.ink, .045 + .07 * (o.lit || 0)); g.fillRect(x, y, w, h); g.restore(); }
  draft(g, rectPts(x, y, w, h), p, { c: o.c || C.ink, w: o.lw || 2.5, dash: o.dash, glow: o.lit ? o.lit * .9 : 0, cap: 'butt', construct: o.construct });
  if (o.ticks && p > .6) {
    const k = 12, a = seg(p, .6, 1), c = o.tc || C.cyan;
    for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
      path(g, [[cx + sx * 6, cy + sy * (6 + k)], [cx + sx * 6, cy + sy * 6], [cx + sx * (6 + k), cy + sy * 6]], { c, w: 2, al: a, cap: 'butt' });
    }
  }
  g.restore();
}
/* 45° 剖面线（未参与编译 / 删除区域）；p 从左往右扫过 */
function hatch(g, x, y, w, h, p = 1, o = {}) {
  if (p <= 0) return;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); if (o.al != null) g.globalAlpha *= o.al;
  g.strokeStyle = o.c || rgba(C.ink, .28); g.lineWidth = o.lw || 2;
  const step = o.step || 16, lim = x - h + (w + h) * clamp(p);
  for (let i = x - h; i < lim; i += step) { g.beginPath(); g.moveTo(i, y + h); g.lineTo(i + h, y); g.stroke(); }
  g.restore();
}
/* 尺寸线：两端界线 + 由中间向两端伸展 + 箭头；label 写在线上方 */
function dimLine(g, x1, y1, x2, y2, label, p = 1, o = {}) {
  if (p <= 0) return;
  const c = o.c || C.ink2, ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang), ny = Math.cos(ang), ext = o.ext ?? 16;
  const e = eo(seg(p, 0, .3));
  for (const [x, y] of [[x1, y1], [x2, y2]]) path(g, [[x - nx * ext * e, y - ny * ext * e], [x + nx * ext * .6 * e, y + ny * ext * .6 * e]], { c, w: 1.6 });
  const k = eio(seg(p, .15, .85)), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  path(g, [[lerp(mx, x1, k), lerp(my, y1, k)], [lerp(mx, x2, k), lerp(my, y2, k)]], { c, w: 1.8 });
  const ha = seg(p, .8, 1);
  if (ha > 0) { tip(g, x1, y1, ang + Math.PI, c, 16, ha); tip(g, x2, y2, ang, c, 16, ha); }
  if (label) text(g, label, mx - nx * (o.lo ?? 24), my - ny * (o.lo ?? 24), { f: o.f || 'mono', s: o.s || 24, w: 700, c: o.lc || c, al: seg(p, .5, .9) });
}
/* 零件序号气泡 + 引出线：from 为被标注点 */
function balloon(g, x, y, r, s, p = 1, o = {}) {
  if (p <= 0) return;
  if (o.from) { const [fx, fy] = o.from, d = Math.hypot(x - fx, y - fy) || 1; dot(g, fx, fy, 5, o.c || C.ink, eo(seg(p, 0, .3))); path(g, partial([[fx, fy], [x - (x - fx) / d * r, y - (y - fy) / d * r]], eo(seg(p, 0, .6))), { c: o.c || C.ink, w: 2 }); }
  at(g, x, y, pop(seg(p, .4, 1)), () => {
    dot(g, 0, 0, r, o.fill || C.bg1); ring(g, 0, 0, r, o.c || C.ink, 2.5);
    text(g, s, 0, 1, { f: o.f || 'mono', s: o.fs || Math.max(24, r * .78), w: 700, c: o.tc || C.ink });
  }, { al: o.al });
}
/* 红笔批注：手绘椭圆圈（略超过一圈），p 画出进度 */
function redCircle(g, cx, cy, rx, ry, p = 1, o = {}) {
  if (p <= 0) return;
  const n = 48, seed = o.seed || 1, a0 = -2.2 + hash(seed) * .6, pts = [];
  for (let i = 0; i <= n * clamp(p); i++) { const a = a0 + i / n * TAU * 1.1, k = 1 + .05 * Math.sin(a * 3 + seed) + i / n * .06; pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
  path(g, pts, { c: o.c || C.red, w: o.w || 4, al: o.al });
}
function redCross(g, x, y, s, p = 1, o = {}) {
  const k = s * .5;
  path(g, partial([[x - k, y - k], [x + k, y + k * .9]], clamp(p * 2)), { c: o.c || C.red, w: o.w || 5, al: o.al });
  path(g, partial([[x + k * .9, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c: o.c || C.red, w: o.w || 5, al: o.al });
}
function check(g, x, y, s, p = 1, o = {}) {
  path(g, partial([[x - s * .45, y], [x - s * .12, y + s * .32], [x + s * .5, y - s * .38]], p), { c: o.c || C.green, w: o.w || s * .16, al: o.al });
}
/* 警示三角（⚠ 用路径画，不依赖字形） */
function warnIcon(g, x, y, s, c = C.amber) {
  g.save(); g.beginPath(); g.moveTo(x, y - s * .55); g.lineTo(x + s * .6, y + s * .48); g.lineTo(x - s * .6, y + s * .48); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = s * .12; g.strokeStyle = c; g.stroke();
  g.fillStyle = c; g.fillRect(x - s * .055, y - s * .2, s * .11, s * .38); g.beginPath(); g.arc(x, y + s * .3, s * .07, 0, TAU); g.fill(); g.restore();
}
/* 印章：p 为落章后经过的比例（0→1 约 .35 秒），落下有放大→回落 + 墨点 */
function stamp(g, s, x, y, p, o = {}) {
  if (p <= 0) return;
  const c = o.c || C.amber, fs = o.fs || 30, w = textW(g, s, { s: fs, w: 900 }) + 46 + (o.icon ? 38 : 0), h = fs + 30;
  const k = eo(clamp(p / .5)), sc = lerp(1.7, 1, k), al = clamp(p / .25);
  at(g, x, y, sc, () => {
    g.save(); g.strokeStyle = c; g.lineWidth = 3.5; g.strokeRect(-w / 2, -h / 2, w, h); g.lineWidth = 1.6; g.strokeRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12); g.restore();
    if (o.icon === 'check') check(g, -w / 2 + 36, 1, 28, 1, { c, w: 5 });
    text(g, s, o.icon ? 19 : 0, 2, { s: fs, w: 900, c });
    // 磨损：确定性的小缺口
    for (let i = 0; i < 18; i++) dot(g, (hash(i * 3.3 + (o.seed || 0)) - .5) * w, (hash(i * 7.1 + (o.seed || 0)) - .5) * h, 1.2 + hash(i) * 1.8, C.bg1, .55);
  }, { rot: o.rot ?? -.1, al: al * (o.al ?? 1) });
  const sp = seg(p, .35, 1);
  if (sp > 0 && sp < 1) for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + hash(i * 2.7), r = (w * .55) * (1 + eo(sp) * .25); dot(g, x + Math.cos(a) * r, y + Math.sin(a) * r * .5, 3 * (1 - sp), c, .7 * (1 - sp)); }
}
/* 标签框（图签式，直角） */
function tagBox(g, s, x, y, o = {}) {
  const fs = o.fs || 26, w = textW(g, s, { s: fs, w: 700, f: o.f }) + 32, h = fs + 22, c = o.c || C.ink;
  at(g, x, y, o.sc ?? 1, () => {
    g.save(); g.fillStyle = o.fill || rgba(C.plate, .7); g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = c; g.lineWidth = 2; if (o.dash) g.setLineDash(o.dash); g.strokeRect(-w / 2, -h / 2, w, h); g.restore();
    text(g, s, 0, 1, { s: fs, w: 700, c: o.tc || c, f: o.f });
  }, { al: o.al, rot: o.rot });
  return w;
}

/* ---------------- 电机 / 导轨 / 窗帘 线稿 ---------------- */
/* 电机：横置圆柱机身 + 散热筋 + 端盖剖面线 + 输出齿轮（转动）+ 指示灯。原点在机身中心，flip 朝左 */
function gearPts(r, n, a0) {
  const pts = [];
  for (let i = 0; i <= n * 4; i++) { const a = a0 + i / (n * 4) * TAU, q = i % 4, rr2 = q === 1 || q === 2 ? r : r * .78; pts.push([Math.cos(a) * rr2, Math.sin(a) * rr2]); }
  return pts;
}
function motor(g, x, y, s, lt, o = {}) {
  const p = o.p ?? 1; if (p <= 0) return;
  at(g, x, y, s, () => {
    if (o.flip) g.scale(-1, 1);
    const lit = o.lit || 0, c = o.c || C.ink;
    g.save(); g.globalAlpha *= seg(p, .5, 1); g.fillStyle = rgba(C.ink, .05 + .06 * lit); rr(g, -74, -30, 148, 60, 10); g.fill(); g.restore();
    draft(g, [[-64, -30], [64, -30], [74, -20], [74, 20], [64, 30], [-64, 30], [-74, 20], [-74, -20], [-64, -30.01]], p, { c, w: 2.6, glow: lit * .8 });
    const q = seg(p, .4, 1);
    if (q > 0) {
      for (let i = 0; i < 5; i++) path(g, [[-58 + i * 11, -22], [-58 + i * 11, 22]], { c: rgba(c, .5), w: 1.6, al: q });
      // 端盖（剖面线）
      g.save(); g.globalAlpha *= q; g.strokeStyle = c; g.lineWidth = 2.2; g.strokeRect(74, -20, 16, 40); g.restore();
      hatch(g, 74, -20, 16, 40, q, { step: 7, lw: 1.4, c: rgba(c, .5) });
      // 中心线（点划线）
      path(g, [[-92, 0], [128, 0]], { c: rgba(C.cyan, .45), w: 1.4, dash: [22, 6, 4, 6], al: q });
      // 齿轮
      g.save(); g.translate(112, 0); g.globalAlpha *= q;
      const gp = gearPts(19, 10, (o.spin ?? 1.2) * lt);
      g.beginPath(); gp.forEach((pt, i) => i ? g.lineTo(pt[0], pt[1]) : g.moveTo(pt[0], pt[1])); g.closePath();
      g.fillStyle = rgba(C.ink, .08); g.fill(); g.strokeStyle = c; g.lineWidth = 2; g.stroke();
      ring(g, 0, 0, 6, c, 2); g.restore();
      path(g, [[90, 0], [106, 0]], { c, w: 4, al: q });
      // 指示灯
      const on = o.led ?? (.55 + .45 * Math.sin(lt * 3.1 + (o.seed || 0)));
      dot(g, -50, -12, 4.5, o.ledC || C.green, q * on); ring(g, -50, -12, 7, rgba(c, .5), 1.4, q);
      // 安装支架
      path(g, [[-40, 30], [-40, 46]], { c, w: 2.4, al: q }); path(g, [[40, 30], [40, 46]], { c, w: 2.4, al: q });
    }
  }, { al: o.al });
}
/* 导轨 + 滑车 + 帘布褶。x0..x1 为导轨，y 为导轨上沿；panels: [[a,b]…] 以导轨比例给出帘布覆盖区间 */
function rail(g, x0, x1, y, lt, o = {}) {
  const p = o.p ?? 1; if (p <= 0) return;
  const c = o.c || C.ink, L = x1 - x0;
  draft(g, [[x0, y], [x1, y]], p, { c, w: 2.6 }); draft(g, [[x0, y + 14], [x1, y + 14]], seg(p, .1, 1), { c, w: 2.6 });
  const q = seg(p, .45, 1); if (q <= 0) return;
  path(g, [[x0, y - 4], [x0, y + 18]], { c, w: 3, al: q }); path(g, [[x1, y - 4], [x1, y + 18]], { c, w: 3, al: q });
  const fh = o.h ?? 150, panels = o.panels || [[0, 1]], step = o.step || 30;
  panels.forEach(([a, b], k) => {
    const pa = x0 + L * a, pb = x0 + L * b, n = Math.max(2, Math.round((pb - pa) / step));
    const fa = q * seg(p, .6, 1);
    // 布面淡填
    g.save(); g.globalAlpha *= fa * .9; g.fillStyle = rgba(C.ink, .05); g.fillRect(pa, y + 18, pb - pa, fh - 18); g.restore();
    for (let i = 0; i <= n; i++) {
      const gx = lerp(pa, pb, i / n);
      dot(g, gx, y + 7, 4, c, q);
      if (i < n) {
        const sw = wob(lt, .25, 3, i * .37 + k);
        const pts = []; for (let j = 0; j <= 8; j++) { const yy = lerp(y + 18, y + fh, j / 8); pts.push([gx + (pb - pa) / n * .5 + Math.sin(j * .9 + i) * 3 + sw * j / 8, yy]); }
        path(g, partial(pts, fa), { c: rgba(c, .55), w: 1.6 });
      }
    }
    path(g, partial([[pa, y + fh], [pb, y + fh]], fa), { c: rgba(c, .8), w: 2 });
  });
}
/* 整套窗帘：kind 'single' | 'dual'；w 为导轨长，原点在导轨左上；open 0 合拢 → 1 拉开（帘布向电机侧收） */
function curtain(g, x, y, w, kind, lt, o = {}) {
  const p = o.p ?? 1, open = o.open ?? 0, ms = o.ms ?? .9;
  if (kind === 'single' && o.motorLeft) {
    rail(g, x, x + w, y, lt, { p, h: o.h, panels: [[0, lerp(1, .28, open)]], step: o.step });
    motor(g, x + 92 * ms, y - 50 * ms, ms, lt, { p: seg(p, .2, 1), flip: true, lit: o.lit, ledC: o.ledC, al: o.mal?.[0] });
  } else if (kind === 'single') {
    rail(g, x, x + w, y, lt, { p, h: o.h, panels: [[lerp(0, .72, open), 1]], step: o.step });
    motor(g, x + w - 92 * ms, y - 50 * ms, ms, lt, { p: seg(p, .2, 1), lit: o.lit, ledC: o.ledC, al: o.mal?.[0] });
  } else {
    const gap = .012;
    rail(g, x, x + w, y, lt, { p, h: o.h, panels: [[0, lerp(.5 - gap, .14, open)], [lerp(.5 + gap, .86, open), 1]], step: o.step });
    motor(g, x + 92 * ms, y - 50 * ms, ms, lt, { p: seg(p, .2, 1), flip: true, lit: o.lit, ledC: o.ledC, seed: 1.3, al: o.mal?.[0] });
    motor(g, x + w - 92 * ms, y - 50 * ms, ms, lt, { p: seg(p, .3, 1), lit: o.lit, ledC: o.ledC, seed: 2.1, al: o.mal?.[1] });
  }
}

/* ---------------- 文件 / 目录 / 代码 / 开关 ---------------- */
function fileIcon(g, x, y, w, h, o = {}) {
  const c = o.c || C.ink, e = Math.min(12, w * .3);
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - e, y); g.lineTo(x + w, y + e); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath();
  g.fillStyle = o.fill || rgba(C.ink, .07); g.fill(); g.lineWidth = 2; g.strokeStyle = c; if (o.dash) g.setLineDash(o.dash); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.moveTo(x + w - e, y); g.lineTo(x + w - e, y + e); g.lineTo(x + w, y + e); g.stroke();
  g.lineWidth = 1.5; g.strokeStyle = rgba(c, .55);
  for (let i = 0; i < 3; i++) { const yy = y + h * .42 + i * h * .17; g.beginPath(); g.moveTo(x + w * .2, yy); g.lineTo(x + w * (i === 2 ? .55 : .8), yy); g.stroke(); }
  if (o.mark) { g.fillStyle = o.markC || C.amber; g.fillRect(x + 4, y + h - 10, w - 8, 5); }
  g.restore();
}
/* 目录：带页签的文件夹线稿；n 个文件图标；lit 发光；off 置灰 + 剖面线 */
function folder(g, x, y, w, h, name, n, o = {}) {
  const p = o.p ?? 1; if (p <= 0) return;
  const lit = o.lit || 0, off = o.off || 0, c = off > .5 ? C.faint : C.ink, tw = Math.min(w * .42, 150);
  g.save(); g.globalAlpha *= 1 - off * .45;
  const pts = [[x, y + 28], [x, y + 6], [x + 6, y], [x + tw - 14, y], [x + tw, y + 16], [x + w, y + 16], [x + w, y + h], [x, y + h], [x, y + 27.9]];
  const fa = seg(p, .55, 1);
  if (fa > 0) { g.save(); g.globalAlpha *= fa; g.fillStyle = rgba(C.ink, .04 + .08 * lit); g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.fill(); g.restore(); }
  draft(g, pts, p, { c, w: 2.6, glow: lit * .9, dash: off > .5 ? [10, 8] : null });
  path(g, partial([[x, y + 28], [x + w, y + 28]], fa), { c: rgba(c, .6), w: 1.6 });
  text(g, name, x + 22, y + 64, { f: 'mono', s: 26, w: 700, a: 'left', c: lit > .3 ? C.cyan : c, al: fa });
  const per = o.per || 6, iw = 34, ih = 44, gx = o.gx || 44;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / per), k = i % per, q = seg(p, .6 + i * .03, .8 + i * .03);
    if (q > 0) fileIcon(g, x + 24 + k * gx, y + 92 + r * 56 + (1 - eo(q)) * 10, iw, ih, { al: q, mark: o.marks?.includes(i), c });
  }
  if (o.sub) text(g, o.sub, x + 22, y + h - 26, { s: 24, w: 700, a: 'left', c: C.ink2, al: fa });
  g.restore();
  if (o.hatchP) hatch(g, x + 2, y + 30, w - 4, h - 32, o.hatchP, { c: rgba(C.ink, .22), step: 18 });
}
/* 代码卡片：重写的示意代码；p 为打字进度（按字符）；简单着色 */
function tokenize(line) {
  const out = [], re = /(\/\/.*$)|(#\w+)|\b(for|int|if|else|void|const|extern|return|struct|static|NULL)\b|(\b\d+\b)|(\b[A-Z][A-Z0-9_]{2,}\b)/g;
  let last = 0, m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push([line.slice(last, m.index), C.ink]);
    const col = m[1] ? C.faint : m[2] ? C.amber : m[3] ? C.cyan : m[4] ? C.amber : C.green;
    out.push([m[0], col]); last = m.index + m[0].length;
  }
  if (last < line.length) out.push([line.slice(last), C.ink]);
  return out;
}
function codeCard(g, x, y, w, lines, o = {}) {
  const fs = o.fs || 26, lh = o.lh || 42, h = 64 + lines.length * lh + 18, p = o.p ?? 1, a = o.al ?? 1;
  frame(g, x, y, w, h, { p: o.fp ?? 1, fill: rgba(C.plate, .72), lw: 2, al: a });
  g.save(); g.globalAlpha *= a;
  path(g, [[x, y + 44], [x + w, y + 44]], { c: rgba(C.ink, .35), w: 1.4 });
  for (let i = 0; i < 3; i++) ring(g, x + 22 + i * 20, y + 22, 5, rgba(C.ink, .6), 1.6);
  if (o.title) text(g, o.title, x + w - 20, y + 23, { f: 'mono', s: 24, w: 700, a: 'right', c: C.faint });
  const total = lines.reduce((s, l) => s + Array.from(l).length, 0);
  let left = Math.round(total * clamp(p)), cursor = null;
  lines.forEach((line, i) => {
    const yy = y + 64 + i * lh + lh / 2; let xx = x + 26;
    if (o.hl?.includes(i)) { g.save(); g.fillStyle = rgba(C.cyan, .12 * (o.hlA ?? 1)); g.fillRect(x + 8, yy - lh / 2 + 3, w - 16, lh - 6); g.restore(); }
    const n = Array.from(line).length, show = Math.min(n, left); left -= show;
    if (show <= 0) return;
    let rem = show;
    for (const [s, col] of tokenize(line)) {
      if (rem <= 0) break;
      const part = Array.from(s).slice(0, rem).join(''); rem -= Array.from(part).length;
      text(g, part, xx, yy, { f: 'mono', s: fs, w: 400, a: 'left', c: col }); xx += textW(g, part, { f: 'mono', s: fs, w: 400 });
    }
    if (show < n || (i === lines.length - 1 && p < 1)) cursor = [xx, yy];
  });
  if (cursor && Math.floor((o.lt ?? 0) * 3) % 2 === 0) { g.fillStyle = C.cyan; g.fillRect(cursor[0] + 2, cursor[1] - fs * .45, fs * .5, fs * .9); }
  g.restore();
  return h;
}
/* 旋钮选择开关（Kconfig）：pos 0→1 在 a0 与 a1 两档之间；带滚花外圈 */
function knob(g, x, y, r, pos, lt, o = {}) {
  const p = o.p ?? 1; if (p <= 0) return;
  const a0 = o.a0 ?? Math.PI * .75, a1 = o.a1 ?? Math.PI * .25, ang = lerp(a0, a1, pos);
  g.save(); g.globalAlpha *= o.al ?? 1;
  const q = seg(p, .4, 1);
  draft(g, partial(Array.from({ length: 41 }, (_, i) => [x + Math.cos(i / 40 * TAU) * r, y + Math.sin(i / 40 * TAU) * r]), 1), p, { c: C.ink, w: 3, glow: o.lit || 0 });
  for (let i = 0; i < 36; i++) { const a = i / 36 * TAU; path(g, [[x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a) * (r - 8), y + Math.sin(a) * (r - 8)]], { c: rgba(C.ink, .45), w: 1.4, al: q }); }
  ring(g, x, y, r * .62, C.ink, 2.2, q);
  for (const a of [a0, a1]) path(g, [[x + Math.cos(a) * (r + 10), y + Math.sin(a) * (r + 10)], [x + Math.cos(a) * (r + 26), y + Math.sin(a) * (r + 26)]], { c: C.cyan, w: 3, al: q });
  path(g, [[x, y], [x + Math.cos(ang) * r * .82, y + Math.sin(ang) * r * .82]], { c: C.amber, w: 6, al: q, glow: .6, gc: C.amber });
  dot(g, x, y, 8, C.amber, q);
  g.restore();
}
/* 管路：底线 + 流动脉冲；p 画出进度，flow 0..1 流动强度 */
function pipe(g, pts, lt, o = {}) {
  const p = o.p ?? 1; if (p <= 0) return;
  const q = partial(pts, p);
  path(g, q, { c: rgba(o.c || C.ink, o.base ?? .45), w: o.w || 2.4, cap: 'butt' });
  if (o.flow > 0) path(g, q, { c: o.fc || C.cyan, w: (o.w || 2.4) + 2, dash: [12, 22], off: -lt * (o.speed || 90), al: o.flow, glow: o.flow * .7 });
  if (o.head && p > .98) { const a = q[q.length - 2], b = q[q.length - 1]; tip(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), rgba(o.c || C.ink, .8), 14); }
}
/* 芯片线稿（固件） */
function chipIC(g, x, y, w, h, label, o = {}) {
  const p = o.p ?? 1; if (p <= 0) return;
  const q = seg(p, .4, 1);
  for (let i = 0; i < 6; i++) {
    const xx = x + 24 + i * (w - 48) / 5;
    path(g, [[xx, y - 12], [xx, y]], { c: C.ink2, w: 3, al: q }); path(g, [[xx, y + h], [xx, y + h + 12]], { c: C.ink2, w: 3, al: q });
  }
  frame(g, x, y, w, h, { p, lit: o.lit, fill: rgba(C.ink, .07 + .05 * (o.lit || 0)) });
  ring(g, x + 18, y + 18, 5, C.ink2, 2, q);
  text(g, label, x + w / 2, y + h / 2 + 1, { s: o.fs || 26, w: 700, c: o.lit > .3 ? C.ink : C.ink2, al: q });
}

/* ---------------- 效果 ---------------- */
function ripple(g, x, y, k, c = C.cyan, r0 = 20, r1 = 90, d = .6) { if (k >= 0 && k < d) ring(g, x, y, r0 + (r1 - r0) * eo(k / d), c, 3, 1 - k / d); }
function sparks(g, x, y, k, c = C.cyan, n = 10, r = 70) { // 刀口火花，k = 经过秒数
  if (k < 0 || k > .6) return;
  for (let i = 0; i < n; i++) {
    const a = hash(i * 4.1) * TAU, sp = r * (.4 + hash(i * 9.3) * .6), e = eo(k / .6);
    path(g, [[x + Math.cos(a) * sp * e * .6, y + Math.sin(a) * sp * e * .6], [x + Math.cos(a) * sp * e, y + Math.sin(a) * sp * e]], { c, w: 2, al: 1 - e });
  }
}

/* ---------------- 镜头 ---------------- */
/* 关键帧 [[t, cx, cy, z], ...]，相邻关键帧之间用 eio 插值 */
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

/* ---------------- 晒图纸面、后期 ---------------- */
function gridOn(p, x0, y0, x1, y1, step, c, lw = 1) {
  p.strokeStyle = c; p.lineWidth = lw; p.beginPath();
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { p.moveTo(x, y0); p.lineTo(x, y1); }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { p.moveTo(x0, y); p.lineTo(x1, y); }
  p.stroke();
}
function prepareStyle({ mk, cw, ch }) {
  const sheet = mk(cw, ch), p = sheet.getContext('2d'); p.scale(cw / W, ch / H);
  const rg = p.createRadialGradient(960, 470, 80, 960, 540, 1250); rg.addColorStop(0, C.bg2); rg.addColorStop(.5, C.bg1); rg.addColorStop(1, C.bg0);
  p.fillStyle = rg; p.fillRect(0, 0, W, H);
  // 晒图的斑驳：大块柔边明暗（确定性）
  for (let i = 0; i < 80; i++) {
    const x = hash(i * 3.7) * W, y = hash(i * 5.1 + 2) * H, r = 70 + hash(i * 7.3) * 280, light = hash(i * 1.9) > .45;
    const g2 = p.createRadialGradient(x, y, 0, x, y, r); g2.addColorStop(0, light ? 'rgba(120,185,255,.045)' : 'rgba(0,8,26,.07)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    p.fillStyle = g2; p.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // 网格：细 24、粗 120；粗格交点加小十字
  gridOn(p, 30, 30, W - 30, H - 30, 24, 'rgba(170,212,255,.055)');
  gridOn(p, 30, 30, W - 30, H - 30, 120, 'rgba(170,212,255,.12)', 1.2);
  p.strokeStyle = 'rgba(200,228,255,.22)'; p.lineWidth = 1.4; p.beginPath();
  for (let x = 120; x < W - 30; x += 120) for (let y = 120; y < H - 30; y += 120) { p.moveTo(x - 5, y); p.lineTo(x + 5, y); p.moveTo(x, y - 5); p.lineTo(x, y + 5); }
  p.stroke();
  // 纸纤维与针孔
  for (let i = 0; i < 7000; i++) { const x = hash(i * 1.17) * W, y = hash(i * 2.31 + 9) * H; p.fillStyle = `rgba(220,236,255,${.012 + hash(i * 5.3) * .03})`; p.fillRect(x, y, 1.3, 1.3); }
  // 图框：外粗内细 + 边缘刻度
  p.strokeStyle = 'rgba(234,243,255,.34)'; p.lineWidth = 2; p.strokeRect(22, 22, W - 44, H - 44);
  p.strokeStyle = 'rgba(234,243,255,.16)'; p.lineWidth = 1; p.strokeRect(30, 30, W - 60, H - 60);
  p.strokeStyle = 'rgba(234,243,255,.3)'; p.lineWidth = 1.4; p.beginPath();
  for (let x = 120; x < W - 30; x += 120) { p.moveTo(x, 22); p.lineTo(x, 30); p.moveTo(x, H - 22); p.lineTo(x, H - 30); }
  for (let y = 120; y < H - 30; y += 120) { p.moveTo(22, y); p.lineTo(30, y); p.moveTo(W - 22, y); p.lineTo(W - 30, y); }
  p.stroke();
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 380, 960, 540, 1180); vg.addColorStop(0, 'rgba(2,10,28,0)'); vg.addColorStop(1, 'rgba(2,10,28,.5)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  const grain = [];
  for (let k = 0; k < 4; k++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt);
  }
  return { sheet, vign, grain };
}
function drawBackground(g, { cache, t }) {
  g.drawImage(cache.sheet, 0, 0, W, H);
  // 缓慢漂移的冷光斑
  const blobs = [[360, 300, .07], [1580, 760, .06], [1150, 160, .05]];
  blobs.forEach(([x, y, a], i) => {
    const bx = x + wob(t, .019, 140, i * 3), by = y + wob(t, .015, 90, i * 5);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, 640); rg.addColorStop(0, rgba(C.cyan, a)); rg.addColorStop(1, rgba(C.cyan, 0));
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  // 晒图机的扫描光带：每 16 秒扫过一次
  const ph = t % 16;
  if (ph < 3.2) {
    const sx = lerp(-400, W + 400, ph / 3.2), lg = g.createLinearGradient(sx - 260, 0, sx + 260, 0);
    lg.addColorStop(0, 'rgba(160,215,255,0)'); lg.addColorStop(.5, 'rgba(160,215,255,.05)'); lg.addColorStop(1, 'rgba(160,215,255,0)');
    g.fillStyle = lg; g.fillRect(sx - 260, 0, 520, H);
  }
  // 浮尘
  for (let i = 0; i < 36; i++) {
    const x = (hash(i * 3.3) * W + t * (6 + hash(i) * 12)) % W, y = (hash(i * 9.1) * H - t * (5 + hash(i * 2) * 9) + H * 10) % H;
    dot(g, x, y, 1.2 + hash(i * 4.4) * 2, C.ink, .08 + .05 * Math.sin(t * .8 + i));
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
