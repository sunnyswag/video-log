/* =====================================================================
 * 设备订阅模块重构 —— 画面工具（风格包：地铁线路图）
 * 管道 = 线路，`+` = 换乘站，生产者 = 始发站，合并器 = 总站。
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH()（设备像素/逻辑像素 × 镜头缩放）。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题 ---------------- */
const C = {
  bg: '#F4F1E8', paper: '#FFFDF7', ink: '#1F2633', ink2: '#5B6272', faint: '#CFC8B8', grid: '#1F2633',
  navy: '#1B2A4A', navy2: '#2B3D66', sky: '#7CCBFF', amber: '#F2B33D', coral: '#E2483D', green: '#2E9E5B',
  grey: '#9AA0AA', greyL: '#E4E1D8', river: '#CFE2EC', park: '#DCEAD2', white: '#FFFFFF',
};
/* 八条线路的颜色（1 红 2 橙 3 蓝 4 青 5 紫 6 绿 7 粉 8 棕） */
const LC = ['#E2483D', '#F09A2B', '#2F6FD8', '#17A5A0', '#8A5AD6', '#2E9E5B', '#DE5E9B', '#A06E3E'];
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
const win = (lt, a, b, fi = .3, fo = .3) => Math.min(eo(seg(lt, a, a + fi)), 1 - eo(seg(lt, b - fo, b)));
const wob = (t, f = 1, a = 1, s = 0) => Math.sin((t + s) * TAU * f) * a;
const ap = (lt, t0, d = .5) => pop(seg(lt, t0, t0 + d));
const fa = (lt, t0, d = .4) => eo(seg(lt, t0, t0 + d));
const fo = (lt, t0, d = .4) => 1 - eo(seg(lt, t0, t0 + d));
const L2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];

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
function shadow(g, a = .16, blur = 26, oy = 10) { g.shadowColor = rgba(C.ink, a); g.shadowBlur = blur * SH(); g.shadowOffsetY = oy * SH(); }
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; }
function card(g, x, y, w, h, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, o.r ?? 18);
  if (o.shadow !== false) shadow(g, o.sa ?? .14, o.sb ?? 22, o.so ?? 8);
  g.fillStyle = o.fill || C.paper; g.fill(); noShadow(g);
  if (o.lw !== 0) { g.lineWidth = o.lw ?? 3; g.strokeStyle = o.stroke || C.ink; if (o.dash) g.setLineDash(o.dash); g.stroke(); }
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
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = (o.gb || 22) * SH(); }
  g.stroke(); g.restore();
}
/* 折线长度、按比例截取、按比例取点（带方向角） */
function plen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
function partial(pts, p, p0 = 0) {
  const tot = plen(pts); let a = tot * clamp(p0), b = tot * clamp(p);
  if (b <= a) return [];
  const out = []; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const P = pts[i - 1], Q = pts[i], d = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (d <= 0) continue;
    const s0 = acc, s1 = acc + d; acc = s1;
    if (s1 < a || s0 > b) continue;
    const u0 = clamp((a - s0) / d), u1 = clamp((b - s0) / d);
    if (!out.length) out.push(L2(P, Q, u0));
    out.push(L2(P, Q, u1));
  }
  return out;
}
function ptAt(pts, u) {
  const tot = plen(pts); let need = tot * clamp(u);
  for (let i = 1; i < pts.length; i++) {
    const P = pts[i - 1], Q = pts[i], d = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (need <= d || i === pts.length - 1) { const k = d ? clamp(need / d) : 0; return [lerp(P[0], Q[0], k), lerp(P[1], Q[1], k), Math.atan2(Q[1] - P[1], Q[0] - P[0])]; }
    need -= d;
  }
  return [pts[0][0], pts[0][1], 0];
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
function icCross(g, x, y, s, c = C.coral, p = 1, lw) {
  const k = s * .42;
  path(g, partial([[x - k, y - k], [x + k, y + k]], clamp(p * 2)), { c, w: lw || s * .2 });
  path(g, partial([[x + k, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c, w: lw || s * .2 });
}
function ripple(g, x, y, k, c, r0 = 20, r1 = 80, d = .7, lw = 4) { if (k >= 0 && k < d) ring(g, x, y, r0 + (r1 - r0) * eo(k / d), c, lw, 1 - k / d); }
function burst(g, x, y, k, c, n = 12, r = 110) {
  if (k < 0 || k > .9) return;
  for (let i = 0; i < n; i++) {
    const ang = i / n * TAU + hash(i * 3.1) * .5, sp = r * (.6 + hash(i * 7.7) * .6), e = eo(k / .9);
    dot(g, x + Math.cos(ang) * sp * e, y + Math.sin(ang) * sp * e + 50 * k * k, (5 + hash(i) * 6) * (1 - e * .7), i % 3 ? c : C.amber, 1 - e);
  }
}

/* =====================================================================
 * 地铁图元
 * ===================================================================== */
/* 线路：白色描边衬底 + 线路色；p0..p 为画出区间；o.w 线宽、o.dash 虚线、o.glow 发光 */
function metroLine(g, pts, col, o = {}) {
  const q = partial(pts, o.p ?? 1, o.p0 ?? 0); if (q.length < 2) return;
  const w = o.w ?? 14;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  if (o.casing !== false) path(g, q, { c: o.case || C.paper, w: w + 8 });
  if (o.glow) path(g, q, { c: rgba(col, .55 * o.glow), w: w + 18 * o.glow, glow: col, gb: 30 });
  path(g, q, { c: col, w, dash: o.dash, off: o.off });
  g.restore();
}
/* 换乘站（+）：白底墨圈 + 加号；o.c 圈色、o.glow 发光、o.ok 绿/红 */
function plusSt(g, x, y, s = 1, o = {}) {
  at(g, x, y, s, () => {
    if (o.glow) { g.save(); g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.shadowColor = rgba(o.gc || C.amber, .9 * o.glow); g.shadowBlur = 30 * SH(); g.fillStyle = '#fff'; g.fill(); g.restore(); }
    dot(g, 0, 0, 19, '#fff'); ring(g, 0, 0, 19, o.c || C.ink, 5.5);
    path(g, [[-9, 0], [9, 0]], { c: o.pc || C.ink, w: 4.5 }); path(g, [[0, -9], [0, 9]], { c: o.pc || C.ink, w: 4.5 });
  }, { al: o.al });
}
/* 始发站（生产者）：线路色圆角方块 + 白边 */
function srcSt(g, x, y, col, s = 1, o = {}) {
  at(g, x, y, s, () => {
    rr(g, -21, -21, 42, 42, 10); g.fillStyle = col; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    rr(g, -24, -24, 48, 48, 12); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    if (o.icon !== false) { rr(g, -9, -9, 18, 18, 4); g.fillStyle = '#fff'; g.fill(); }
  }, { al: o.al });
}
/* 普通站刻度 */
function tickSt(g, x, y, col, ang = 0, al = 1) {
  g.save(); g.globalAlpha *= al; g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.fillRect(-4, -20, 8, 14); g.restore();
}
/* 线路徽章：彩色圆 + 编号 */
function lineBadge(g, n, x, y, col, s = 1, o = {}) {
  at(g, x, y, s, () => {
    dot(g, 0, 0, 22, col); ring(g, 0, 0, 22, '#fff', 3.5);
    text(g, String(n), 0, 2, { f: 'disp', w: 900, s: 26, c: '#fff' });
  }, { al: o.al });
}
/* 站牌：深蓝底白字，顶部色条；返回宽度。o.s 字号、o.c 色条、o.f 字体、o.a 对齐（'center'/'left'） */
function sign(g, s, x, y, o = {}) {
  const fs = o.s || 28, tw = textW(g, s, { s: fs, w: o.w || 700, f: o.f }), w = tw + (o.px ?? 34), h = fs + (o.py ?? 26);
  const x0 = o.a === 'left' ? x : x - w / 2;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x0, y - h / 2, w, h, o.r ?? 10); if (o.shadow !== false) shadow(g, .2, 16, 6);
  g.fillStyle = o.fill || C.navy; g.fill(); noShadow(g);
  if (o.c) { g.save(); rr(g, x0, y - h / 2, w, h, o.r ?? 10); g.clip(); g.fillStyle = o.c; g.fillRect(x0, y - h / 2, w, 6); g.restore(); }
  text(g, s, x0 + w / 2, y + (o.c ? 3 : 1), { s: fs, w: o.w || 700, f: o.f, c: o.tc || '#fff' });
  g.restore();
  return w;
}
/* 翻牌站牌：k 0→1 期间纵向翻开 */
function flipSign(g, s, x, y, k, o = {}) {
  if (k <= 0) return;
  at(g, x, y, 1, () => sign(g, s, 0, 0, { ...o, a: 'center' }), { sy: k >= 1 ? 1 : eo(k), al: (o.al ?? 1) * clamp(k * 3) });
}
/* 站台牌（类型）：白底墨框，等宽字 */
function platform(g, s, x, y, o = {}) {
  const fs = o.s || 26, w = textW(g, s, { f: 'mono', s: fs, w: 700 }) + 28, h = fs + 20;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x - w / 2, y - h / 2, w, h, 8); shadow(g, .12, 10, 4); g.fillStyle = o.fill || '#fff'; g.fill(); noShadow(g);
  g.lineWidth = 3; g.strokeStyle = o.stroke || C.ink; g.stroke();
  text(g, s, x, y + 1, { f: 'mono', s: fs, w: 700, c: o.tc || C.ink });
  g.restore();
  return w;
}
/* 胶囊标签（弹出） */
function tag(g, s, x, y, c, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    const fs = o.fs || 26, w = textW(g, s, { s: fs, w: 900 }) + 36, h = fs + 22;
    card(g, -w / 2, -h / 2, w, h, { r: h / 2, fill: o.fill || c, lw: o.lw ?? 0, stroke: o.stroke, sb: 14, so: 5 });
    text(g, s, 0, 1, { s: fs, w: 900, c: o.tc || '#fff' });
  }, { rot: o.rot || 0, al: o.al });
}
/* 列车：沿折线 pts 在 u 处；o.cargo(g) 画车厢里的货物 */
function train(g, pts, u, col, o = {}) {
  const [x, y, ang] = ptAt(pts, u), s = o.s ?? 1;
  at(g, x, y, s, () => {
    if (o.trail !== false) {
      const back = o.trailLen ?? .08;
      for (let i = 6; i >= 1; i--) {
        const [tx, ty] = ptAt(pts, clamp(u - back * i / 6));
        dot(g, (tx - x) / s, (ty - y) / s, 9 * (1 - i / 7), col, .18 * (1 - i / 7));
      }
    }
    g.rotate(ang);
    const L = o.len || 62;
    rr(g, -L / 2, -15, L, 30, 13); shadow(g, .22, 12, 4); g.fillStyle = col; g.fill(); noShadow(g);
    g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    for (let i = 0; i < 3; i++) { rr(g, -L / 2 + 8 + i * 15, -7, 10, 10, 3); g.fillStyle = 'rgba(255,255,255,.9)'; g.fill(); }
    dot(g, L / 2 - 6, 0, 4, C.amber);
    if (o.cargo) { g.save(); g.rotate(-ang); o.cargo(g); g.restore(); }
  }, { al: o.al });
}

/* ---------------- 设备与资源图标 ---------------- */
function screenIcon(g, x, y, s, lt, o = {}) { // 智能屏
  at(g, x, y + wob(lt, .2, 2), s, () => {
    card(g, -120, -80, 240, 160, { r: 24, fill: '#E9EEF8', lw: 3.5, sa: .18, sb: 28, so: 12 });
    rr(g, -102, -62, 204, 124, 14); g.fillStyle = '#fff'; g.fill();
    const tc = o.tiles || [LC[2], LC[0], LC[5], LC[1]];
    for (let i = 0; i < 4; i++) {
      const tx = -90 + (i % 2) * 96, ty = -52 + Math.floor(i / 2) * 56;
      rr(g, tx, ty, 84, 46, 9); g.fillStyle = rgba(tc[i], .16); g.fill();
      dot(g, tx + 18, ty + 23, 9, tc[i], .9);
      rr(g, tx + 34, ty + 17, 38, 6, 3); g.fillStyle = rgba(C.ink, .25); g.fill();
      rr(g, tx + 34, ty + 28, 24, 5, 3); g.fillStyle = rgba(C.ink, .15); g.fill();
    }
    g.save(); rr(g, -102, -62, 204, 124, 14); g.clip();
    const sx = -300 + ((lt * 70) % 700);
    const gr = g.createLinearGradient(sx, -62, sx + 120, 62); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-102, -62, 204, 124); g.restore();
    rr(g, -102, -62, 204, 124, 14); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
  }, { al: o.al });
  if (o.label) text(g, o.label, x, y + 112 * s, { s: 28, w: 900, c: C.ink, al: o.al });
}
function gatewayIcon(g, x, y, s, lt, o = {}) { // 家庭网关
  const busy = o.busy || 0;
  at(g, x, y, s, () => {
    if (busy > 0) for (let k = 0; k < 2; k++) { const ph = (lt * 1.3 + k / 2) % 1; ring(g, 0, 0, 100 + ph * 60, o.rc || C.navy2, 4, (1 - ph) * .35 * busy); }
    for (const sx of [-1, 1]) {
      g.save(); g.translate(sx * 56, -36); g.rotate(sx * .18 + wob(lt, .5, .03, sx));
      rr(g, -7, -72, 14, 74, 7); g.fillStyle = '#E9EEF8'; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
      dot(g, 0, -76, 9, C.navy2); g.restore();
    }
    card(g, -110, -46, 220, 100, { r: 24, fill: '#E9EEF8', lw: 3.5, sa: .18, sb: 28, so: 12 });
    const led = o.led;
    for (let i = 0; i < 4; i++) {
      const on = led ? 1 : hash(Math.floor(lt * (busy > .2 ? 12 : 3)) + i * 7) > .45;
      dot(g, -54 + i * 36, 4, 9, led ? led : on ? [LC[5], LC[1], LC[2], LC[4]][i] : C.greyL); ring(g, -54 + i * 36, 4, 9, C.ink, 2.5);
    }
  }, { al: o.al });
  if (o.label) text(g, o.label, x, y + 100 * s, { s: 28, w: 900, c: C.ink, al: o.al });
}
function cloudIcon(g, x, y, s, o = {}) {
  at(g, x, y, s, () => {
    g.beginPath(); g.moveTo(-70, 30); g.arc(-44, 6, 30, Math.PI * .6, Math.PI * 1.45); g.arc(0, -16, 42, Math.PI * 1.1, Math.PI * 1.9);
    g.arc(46, 4, 30, Math.PI * 1.45, Math.PI * .4); g.closePath();
    shadow(g, .15, 20, 8); g.fillStyle = o.fill || '#EAF5FC'; g.fill(); noShadow(g); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke();
  }, { al: o.al });
}
function storageIcon(g, x, y, s, o = {}) { // 本地存储：圆柱
  at(g, x, y, s, () => {
    g.beginPath(); g.ellipse(0, -30, 44, 14, 0, 0, TAU); g.fillStyle = '#F2EEE3'; g.fill();
    rr(g, -44, -30, 88, 64, 0); g.fillStyle = '#F2EEE3'; g.fill();
    g.beginPath(); g.ellipse(0, 34, 44, 14, 0, 0, Math.PI); g.fill();
    g.lineWidth = 3; g.strokeStyle = C.ink;
    g.beginPath(); g.ellipse(0, -30, 44, 14, 0, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(-44, -30); g.lineTo(-44, 34); g.ellipse(0, 34, 44, 14, 0, Math.PI, 0, true); g.lineTo(44, -30); g.stroke();
    g.beginPath(); g.ellipse(0, 2, 44, 14, 0, 0, Math.PI); g.stroke();
    if (o.fill) { dot(g, 0, -30, 8, o.fill); }
  }, { al: o.al });
}
/* JSON 车票：白卡 + `{ }` + 四道彩条 */
function jsonTicket(g, x, y, s, o = {}) {
  at(g, x, y, s, () => {
    card(g, -62, -42, 124, 84, { r: 12, fill: '#fff', lw: 3, sb: 16, so: 6 });
    text(g, '{ }', -30, 0, { f: 'mono', s: 30, w: 700, c: C.navy });
    [LC[0], LC[1], LC[2], C.sky].forEach((c, i) => { rr(g, 6, -26 + i * 14, 40, 7, 3.5); g.fillStyle = c; g.fill(); });
  }, { rot: o.rot, al: o.al });
}
/* 订阅结果箱：四格小箱子 */
function resultBox(g, x, y, s, col, o = {}) {
  at(g, x, y, s, () => {
    card(g, -34, -26, 68, 52, { r: 8, fill: '#fff', lw: 3, sb: 10, so: 4 });
    for (let i = 0; i < 4; i++) { rr(g, -26 + (i % 2) * 28, -18 + Math.floor(i / 2) * 20, 24, 16, 3); g.fillStyle = i === 0 && col ? col : rgba(C.navy, .18); g.fill(); }
  }, { rot: o.rot, al: o.al, sx: o.sx, sy: o.sy });
}

/* ---------------- 代码卡（深蓝站牌风格，带简易高亮） ---------------- */
const KW = new Set('interface abstract class fun val var operator lateinit suspend override listOf object return'.split(' '));
function codeLine(g, s, x, y, fs, al = 1) {
  const cm = s.indexOf('//');
  const body = cm >= 0 ? s.slice(0, cm) : s, comment = cm >= 0 ? s.slice(cm) : '';
  const toks = body.match(/[A-Za-z_][A-Za-z0-9_]*|\s+|[^A-Za-z0-9_\s]+|\d+/g) || [];
  let cx = x;
  g.save(); g.globalAlpha *= al; g.font = font({ f: 'mono', s: fs, w: 700 }); g.textAlign = 'left'; g.textBaseline = 'middle';
  for (const t of toks) {
    let c = '#E8EDF7';
    if (KW.has(t)) c = C.sky; else if (/^[A-Z]/.test(t)) c = C.amber; else if (/^[+]+$/.test(t.trim())) c = '#FF8A7A'; else if (/^[^\w\s]+$/.test(t)) c = '#9FB0CF';
    g.fillStyle = c; g.fillText(t, cx, y); cx += g.measureText(t).width;
  }
  if (comment) { g.font = font({ f: 'mono', s: fs, w: 400 }); g.fillStyle = '#8FD3A8'; g.fillText(comment, cx, y); }
  g.restore();
}
/* lines: 字符串数组；p: 打字进度 0..1（按字符）；o.hl: 高亮行号（可为数组）；o.title 卡片标题 */
function codeCard(g, x, y, w, lines, o = {}) {
  const fs = o.fs || 26, lh = o.lh || 42, h = (o.title ? 64 : 24) + lines.length * lh + 22;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, 18); shadow(g, .25, 30, 12); g.fillStyle = C.navy; g.fill(); noShadow(g);
  g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  let ty = y + 24;
  if (o.title) {
    [C.coral, C.amber, C.green].forEach((c, i) => dot(g, x + 28 + i * 22, y + 30, 6.5, c));
    text(g, o.title, x + 104, y + 31, { f: 'mono', s: 24, w: 700, c: '#9FB0CF', a: 'left' });
    path(g, [[x, y + 58], [x + w, y + 58]], { c: rgba('#ffffff', .12), w: 2 });
    ty = y + 70;
  }
  const total = lines.reduce((s, l) => s + l.length, 0); let budget = (o.p ?? 1) * total;
  const hls = [].concat(o.hl ?? []);
  lines.forEach((l, i) => {
    const yy = ty + i * lh + lh / 2;
    const hk = hls.includes(i) ? (o.hlA ?? 1) : 0;
    if (hk > 0) { rr(g, x + 10, yy - lh / 2 + 3, w - 20, lh - 6, 8); g.fillStyle = rgba(o.hlc || C.amber, .22 * hk); g.fill(); rr(g, x + 10, yy - lh / 2 + 3, 6, lh - 6, 3); g.fillStyle = rgba(o.hlc || C.amber, hk); g.fill(); }
    if (budget <= 0) return;
    const shown = l.slice(0, Math.floor(budget)); budget -= l.length;
    codeLine(g, shown, x + 28, yy, fs, o.dim && !hls.includes(i) ? o.dim : 1);
    if (budget < 0 && o.cursor !== false && (o.p ?? 1) < 1) { const cw = textW(g, shown, { f: 'mono', s: fs, w: 700 }); g.fillStyle = C.sky; g.fillRect(x + 30 + cw, yy - fs / 2, 3, fs); }
  });
  g.restore();
  return { h, rowY: i => ty + i * lh + lh / 2 };
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

/* ---------------- 纸面：线路图底纹、后期 ---------------- */
const RIVER = [[-120, 1010], [380, 930], [820, 975], [1260, 900], [1640, 940], [2060, 860]];
function riverPath(g, off, wd) {
  g.beginPath();
  const pts = RIVER.map(([x, y], i) => [x, y + Math.sin(off + i * 1.7) * 6]);
  g.moveTo(pts[0][0], pts[0][1] - wd);
  for (let i = 1; i < pts.length; i++) { const m = L2(pts[i - 1], pts[i], .5); g.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1] - wd, m[0], m[1] - wd); }
  g.lineTo(pts.at(-1)[0], pts.at(-1)[1] - wd); g.lineTo(pts.at(-1)[0], pts.at(-1)[1] + wd);
  for (let i = pts.length - 1; i > 0; i--) { const m = L2(pts[i - 1], pts[i], .5); g.quadraticCurveTo(pts[i][0], pts[i][1] + wd, m[0], m[1] + wd); }
  g.lineTo(pts[0][0], pts[0][1] + wd); g.closePath();
}
function prepareStyle({ mk, cw, ch }) {
  const paper = mk(cw, ch), p = paper.getContext('2d'); p.scale(cw / W, ch / H);
  const lg = p.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#F7F4EC'); lg.addColorStop(1, '#EFEAE0');
  p.fillStyle = lg; p.fillRect(0, 0, W, H);
  // 公园色块（圆角多边形）
  [[150, 120, 260, 150], [1580, 150, 240, 120], [700, 640, 200, 110], [1700, 700, 170, 140]].forEach(([x, y, w, h], i) => {
    p.save(); p.globalAlpha = .55; rr(p, x, y, w, h, 40); p.fillStyle = C.park; p.fill(); p.restore();
    for (let k = 0; k < 6; k++) dot(p, x + 30 + hash(i * 9 + k) * (w - 60), y + 30 + hash(i * 5 + k * 3) * (h - 60), 6 + hash(k + i) * 6, '#C6DCB8', .7);
  });
  // 方格：40 px 细格 + 200 px 粗格
  p.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { p.strokeStyle = rgba(C.grid, x % 200 === 0 ? .07 : .035); p.beginPath(); p.moveTo(x + .5, 0); p.lineTo(x + .5, H); p.stroke(); }
  for (let y = 0; y <= H; y += 40) { p.strokeStyle = rgba(C.grid, y % 200 === 0 ? .07 : .035); p.beginPath(); p.moveTo(0, y + .5); p.lineTo(W, y + .5); p.stroke(); }
  // 纸纤维
  for (let i = 0; i < 9000; i++) { const x = hash(i * 1.17) * W, y = hash(i * 2.31 + 9) * H; p.fillStyle = rgba(C.ink, .015 + hash(i * 5.3) * .022); p.fillRect(x, y, 1.4, 1.4); }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 430, 960, 540, 1250); vg.addColorStop(0, 'rgba(40,40,60,0)'); vg.addColorStop(1, 'rgba(40,40,60,.2)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  const grain = [];
  for (let k = 0; k < 4; k++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt);
  }
  return { paper, vign, grain };
}
function drawBackground(g, { cache, t }) {
  g.drawImage(cache.paper, 0, 0, W, H);
  // 河流：浅蓝带 + 缓慢流动的波纹线
  g.save(); riverPath(g, t * .4, 46); g.fillStyle = rgba(C.river, .8); g.fill();
  g.clip();
  for (let i = 0; i < 18; i++) {
    const x = ((hash(i * 4.1) * 2300 + t * 26) % 2300) - 200, y = 880 + hash(i * 7.3) * 120;
    path(g, [[x, y], [x + 40, y - 3], [x + 80, y]], { c: rgba('#ffffff', .7), w: 3 });
  }
  g.restore();
  // 缓慢漂移的光斑
  [[LC[2], 420, 300, .07], [LC[1], 1500, 720, .06], [LC[4], 1150, 160, .05]].forEach(([c, x, y, a], i) => {
    const bx = x + wob(t, .021, 110, i * 3), by = y + wob(t, .017, 70, i * 5);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, 600); rg.addColorStop(0, rgba(c, a)); rg.addColorStop(1, rgba(c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  for (let i = 0; i < 30; i++) {
    const x = (hash(i * 3.3) * W + t * (8 + hash(i) * 14)) % W, y = (hash(i * 9.1) * H - t * (6 + hash(i * 2) * 10) + H * 10) % H;
    dot(g, x, y, 1.5 + hash(i * 4.4) * 2.5, C.ink, .05 + .04 * (1 + Math.sin(t * .8 + i)) / 2);
  }
}
function postFX(g, { cache, t, cw, ch }) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cache.vign, 0, 0);
  const fr = Math.floor(t * FPS), gp = g.createPattern(cache.grain[fr % 4], 'repeat');
  g.globalAlpha = .05; g.globalCompositeOperation = 'overlay';
  g.translate(Math.floor(hash(fr) * 256), Math.floor(hash(fr + 7) * 256)); g.scale(Math.max(1, SCX * .75), Math.max(1, SCX * .75));
  g.fillStyle = gp; g.fillRect(-512, -512, cw + 1024, ch + 1024);
  g.restore();
}
