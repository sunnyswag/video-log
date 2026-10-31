/* =====================================================================
 * 帧动画主题开发 —— 画面工具：胶片 / 翻页书风格包 + 内存曲线
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * 内存曲线的数据：段末读数来自 Profiler 截图顶栏（视频稿附录 A），段内形状按截图示意重画。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题 ---------------- */
const C = {
  bg: '#1B1714', bg2: '#2A231D', film: '#14100D', paper: '#F2E8D5', paper2: '#E4D5BA', ink: '#2A2420', ink2: '#6E6153',
  cream: '#F2E8D5', dim: '#9C8C78', line: '#C9B89A',
  red: '#D9483B', redL: '#F6D3CB', amber: '#F0A63A', amberL: '#FBE3B8', teal: '#2E9C94', tealL: '#CDEBE6',
  blue: '#3D6FB6', blueL: '#D6E2F3', green: '#5E9E4B', print: '#1F3A5F',
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
const sstep = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const frac = x => x - Math.floor(x);

/* ---------------- 全局渲染状态 ---------------- */
let SCX = 1, CAMZ = 1;
const SH = () => SCX * CAMZ;

/* ---------------- 文字与形状 ---------------- */
const font = o => `${o.w || 700} ${o.s || 30}px ${F[o.f || 'cjk']}`;
function text(g, s, x, y, o = {}) {
  g.save();
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.font = font(o); g.textAlign = o.a || 'center'; g.textBaseline = o.b || 'middle';
  if (o.ls) g.letterSpacing = o.ls + 'px';
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = (o.gb || 18) * SH(); }
  g.fillStyle = o.c || C.cream; g.fillText(s, x, y);
  g.restore();
}
function textW(g, s, o = {}) { g.save(); g.font = font(o); if (o.ls) g.letterSpacing = o.ls + 'px'; const w = g.measureText(s).width; g.restore(); return w; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
function shadow(g, a = .35, blur = 26, oy = 10) { g.shadowColor = rgba('#000000', a); g.shadowBlur = blur * SH(); g.shadowOffsetY = oy * SH(); }
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; }
function card(g, x, y, w, h, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, o.r ?? 18);
  if (o.shadow !== false) shadow(g, o.sa ?? .35, o.sb ?? 24, o.so ?? 9);
  g.fillStyle = o.fill || C.paper; g.fill(); noShadow(g);
  if (o.lw) { g.lineWidth = o.lw; g.strokeStyle = o.stroke || C.ink; if (o.dash) g.setLineDash(o.dash); g.stroke(); }
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
  g.strokeStyle = o.c || C.cream; g.lineWidth = o.w || 3; g.lineCap = 'round'; g.lineJoin = 'round';
  if (o.dash) { g.setLineDash(o.dash); g.lineDashOffset = o.off || 0; }
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
  if ((o.p ?? 1) > .02) arrowHead(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), o.c || C.cream, o.hs || 18, o.al ?? 1);
}
function at(g, x, y, s, fn, o = {}) {
  if (s <= .001 || (o.al != null && o.al <= .001)) return;
  g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); g.scale(s * (o.sx || 1), s * (o.sy || 1));
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  fn(); g.restore();
}
function icCheck(g, x, y, s, c = C.teal, p = 1, lw) { path(g, partial([[x - s * .45, y], [x - s * .12, y + s * .32], [x + s * .5, y - s * .38]], p), { c, w: lw || s * .2 }); }
function icCross(g, x, y, s, c = C.red, p = 1, lw) {
  const k = s * .42;
  path(g, partial([[x - k, y - k], [x + k, y + k]], clamp(p * 2)), { c, w: lw || s * .2 });
  path(g, partial([[x + k, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c, w: lw || s * .2 });
}
function badge(g, x, y, r, c, kind, p = 1) {
  at(g, x, y, pop(p), () => {
    dot(g, 0, 0, r, c);
    if (kind === 'check') icCheck(g, 0, 2, r * 1.1, '#fff', 1, r * .24);
    else if (kind === 'cross') icCross(g, 0, 0, r * 1.1, '#fff', 1, r * .24);
    else text(g, kind, 0, 2, { f: 'disp', w: 900, s: r * 1.3, c: '#fff' });
  });
}
/* 弹出式标签：深色/彩色胶囊 */
function tag(g, s, x, y, c, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    const fs = o.fs || 28, w = textW(g, s, { s: fs, w: 900, f: o.f }) + 40, h = fs + 24;
    card(g, -w / 2, -h / 2, w, h, { r: h / 2, fill: o.fill || c, sb: 14, so: 5, sa: .3, lw: o.lw, stroke: o.stroke });
    text(g, s, 0, 1, { s: fs, w: 900, f: o.f, c: o.tc || '#fff' });
  }, { rot: o.rot || 0, al: o.al });
}
/* 橡皮章：从大到小砸下，带回弹与墨迹 */
function stamp(g, s, x, y, p, c = C.red, o = {}) {
  if (p <= 0) return;
  const k = eo(clamp(p / .5)), sc = lerp(1.9, 1, k) * (p > .5 ? 1 + .05 * Math.sin((p - .5) * 18) * (1 - p) : 1);
  at(g, x, y, sc, () => {
    const fs = o.fs || 56, w = textW(g, s, { s: fs, w: 900, f: o.f }) + 56, h = fs + 40;
    g.save(); rr(g, -w / 2, -h / 2, w, h, 10); g.lineWidth = 7; g.strokeStyle = c; g.stroke();
    rr(g, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 6); g.lineWidth = 2.5; g.stroke(); g.restore();
    text(g, s, 0, 2, { s: fs, w: 900, f: o.f, c });
    for (let i = 0; i < 26; i++) dot(g, (hash(i * 3.7 + (o.seed || 0)) - .5) * w, (hash(i * 5.9 + (o.seed || 0)) - .5) * h, 1.5 + hash(i) * 2.5, o.bg || C.bg, .55);
  }, { rot: o.rot ?? -.12, al: k });
}
function burst(g, x, y, k, c, n = 12, r = 120) {
  if (k < 0 || k > .9) return;
  for (let i = 0; i < n; i++) {
    const ang = i / n * TAU + hash(i * 3.1) * .5, sp = r * (.6 + hash(i * 7.7) * .6), e = eo(k / .9);
    dot(g, x + Math.cos(ang) * sp * e, y + Math.sin(ang) * sp * e + 60 * k * k, (5 + hash(i) * 5) * (1 - e * .7), i % 3 ? c : C.amber, 1 - e);
  }
}
function ripple(g, x, y, k, c, r0 = 24, r1 = 100, d = .6) { if (k >= 0 && k < d) ring(g, x, y, r0 + (r1 - r0) * eo(k / d), c, 4, 1 - k / d); }
function hatch(g, x, y, w, h, c, off = 0, r = 6, a = .3) {
  if (w <= 0 || h <= 0) return; g.save(); rr(g, x, y, w, h, r); g.clip(); g.fillStyle = rgba(c, a); g.fillRect(x, y, w, h);
  g.strokeStyle = rgba(c, .8); g.lineWidth = 4; for (let i = -h; i < w + h; i += 16) { g.beginPath(); g.moveTo(x + i + off % 16, y + h); g.lineTo(x + i + off % 16 + h, y); g.stroke(); } g.restore();
}

/* ---------------- 镜头 ---------------- */
function camAt(keys, lt) {
  if (!keys || !keys.length) return [W / 2, H / 2, 1];
  if (lt <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (lt <= keys[i][0]) { const a = keys[i - 1], b = keys[i], k = eio((lt - a[0]) / (b[0] - a[0])); return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)]; }
  }
  return keys[keys.length - 1].slice(1);
}

/* ---------------- 场景卡片与它的 50 帧 ---------------- */
const SCENES = [['观影', 'film', C.blue], ['回家', 'home', C.teal], ['睡眠', 'moon', C.print], ['加班', 'clock', C.amber], ['起床', 'sun', C.red], ['阅读', 'book', C.green]];
function sceneIcon(g, kind, x, y, s, c) {
  at(g, x, y, s, () => {
    g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
    if (kind === 'film') { rr(g, -26, -18, 52, 36, 8); g.stroke(); g.beginPath(); g.moveTo(-6, -9); g.lineTo(10, 0); g.lineTo(-6, 9); g.closePath(); g.fill(); }
    else if (kind === 'home') { g.beginPath(); g.moveTo(-26, 0); g.lineTo(0, -24); g.lineTo(26, 0); g.stroke(); rr(g, -17, -4, 34, 26, 4); g.stroke(); }
    else if (kind === 'moon') { g.beginPath(); g.arc(0, 0, 22, .9, TAU - .9); g.arc(12, -2, 17, TAU - 1.2, 1.2, true); g.closePath(); g.fill(); }
    else if (kind === 'clock') { g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(0, -12); g.lineTo(0, 0); g.lineTo(10, 6); g.stroke(); }
    else if (kind === 'sun') { dot(g, 0, 0, 11, c); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; g.beginPath(); g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18); g.lineTo(Math.cos(a) * 26, Math.sin(a) * 26); g.stroke(); } }
    else if (kind === 'book') { g.beginPath(); g.moveTo(0, -14); g.lineTo(-24, -20); g.lineTo(-24, 16); g.lineTo(0, 22); g.lineTo(24, 16); g.lineTo(24, -20); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 22); g.stroke(); }
  });
}
/* 第 i 帧的卡片缩放：首末帧相同（=1），中段缩小（动态主题只保留缩放动效） */
const frameScale = i => 1 - .17 * Math.sin(Math.PI * clamp(i / 49));
/* 场景卡片（原点中心，w×h）；k 为整体缩放（动画），glow 为点击高光 */
function sceneCard(g, x, y, w, h, sc, o = {}) {
  const [name, kind, col] = SCENES[sc % SCENES.length], k = o.k ?? 1;
  at(g, x, y, k, () => {
    if (o.glow) { g.save(); rr(g, -w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 22); g.shadowColor = rgba(C.amber, .9 * o.glow); g.shadowBlur = 30 * SH(); g.fillStyle = rgba(C.amber, .5 * o.glow); g.fill(); g.restore(); }
    card(g, -w / 2, -h / 2, w, h, { r: Math.min(18, h * .18), fill: o.fill || C.paper, sa: .4, sb: 16, so: 6 });
    const s = Math.min(w, h) / 110;
    dot(g, -w / 2 + 44 * s, -h / 2 + 44 * s, 30 * s, rgba(col, .16));
    sceneIcon(g, kind, -w / 2 + 44 * s, -h / 2 + 44 * s, .62 * s, col);
    if (o.label !== false && h > 80) text(g, name, -w / 2 + 20 * s, h / 2 - 24 * s, { s: Math.max(24, 26 * s), w: 900, c: C.ink, a: 'left' });
  }, { al: o.al });
}
/* 一帧的画面：米色底 + 当帧缩放的卡片 + 帧号 */
function cardFrame(g, idx, fx, fy, fw, fh, o = {}) {
  const i = ((idx % 50) + 50) % 50;
  g.save(); rr(g, fx, fy, fw, fh, 4); g.clip();
  g.fillStyle = o.bg || C.paper; g.fillRect(fx, fy, fw, fh);
  const cw = fw * .62, ch = fh * .56;
  sceneCard(g, fx + fw / 2, fy + fh * .48, cw, ch, o.sc ?? 0, { k: frameScale(i), label: false, sa: .2 });
  if (o.num !== false) text(g, String(i).padStart(2, '0'), fx + fw - 10, fy + fh - 14, { f: 'mono', s: Math.max(24, fh * .14), w: 700, c: rgba(C.ink, .55), a: 'right' });
  g.restore();
}

/* ---------------- 胶片条 ---------------- */
/* 水平胶片：x,y 左上，w×h；foff 走带像素；frame(g, idx, fx, fy, fw, fh) 画每格内容 */
function filmStrip(g, x, y, w, h, o = {}) {
  const band = h * .17, fh = h - band * 2 - 6, fw = o.fw || fh * 1.32, gap = o.gap ?? 14, step = fw + gap, foff = o.foff || 0;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  if (o.shadow !== false) { g.save(); shadow(g, .45, 22, 8); g.fillStyle = C.film; g.fillRect(x, y, w, h); g.restore(); }
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = C.film; g.fillRect(x, y, w, h);
  const pitch = band * 1.5, hoff = ((foff % pitch) + pitch) % pitch;
  for (let hx = x - hoff; hx < x + w + pitch; hx += pitch)
    for (const hy of [y + band / 2, y + h - band / 2]) { rr(g, hx + pitch * .28, hy - band * .28, pitch * .44, band * .56, 3); g.fillStyle = rgba(C.paper, .8); g.fill(); }
  const i0 = Math.floor(foff / step), r0 = foff - i0 * step;
  for (let k = -1; k < w / step + 2; k++) {
    const idx = i0 + k, fx = x + k * step - r0 + gap / 2, fy = y + band + 3;
    if (fx > x + w || fx + fw < x) continue;
    if (o.frame) o.frame(g, idx, fx, fy, fw, fh); else { g.fillStyle = rgba(C.amber, .2); g.fillRect(fx, fy, fw, fh); }
  }
  g.restore(); g.restore();
  return { fw, fh, step, band };
}

/* ---------------- 翻页书 ---------------- */
/* 中心 (x,y)，页面 w×h；page 为连续页码（小数部分 = 当前翻页进度） */
function flipBook(g, x, y, w, h, page, o = {}) {
  const pi = Math.floor(page), f = frac(page), x0 = x - w / 2, y0 = y - h / 2;
  // 书脊与厚度
  for (let k = 7; k >= 1; k--) { rr(g, x0 + k * 3, y0 + k * 4, w, h, 6); g.fillStyle = k % 2 ? C.paper2 : '#D6C5A6'; g.fill(); }
  g.save(); shadow(g, .45, 30, 14); rr(g, x0, y0, w, h, 6); g.fillStyle = C.paper; g.fill(); g.restore();
  cardFrame(g, pi + 1, x0 + 10, y0 + 10, w - 20, h - 20, { sc: o.sc, num: false });
  // 正在翻起的一页：绕左侧书脊转
  const th = eio(f) * Math.PI, cs = Math.cos(th);
  if (f > 0 && f < 1) {
    g.save(); g.translate(x0, y0); g.transform(cs, Math.sin(th) * .18, 0, 1, 0, 0);
    if (cs > 0) { g.save(); shadow(g, .35, 24, 8); rr(g, 0, 0, w, h, 6); g.fillStyle = C.paper; g.fill(); g.restore(); cardFrame(g, pi, 10, 10, w - 20, h - 20, { sc: o.sc, num: false }); }
    else if (cs > -.45) { g.globalAlpha *= 1 + cs / .45; rr(g, 0, 0, w, h, 6); g.fillStyle = '#E9DCC3'; g.fill(); }
    const sh = g.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, rgba('#000000', .25 * Math.sin(th))); sh.addColorStop(1, rgba('#000000', 0));
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
    g.restore();
  }
  // 书脊夹子
  card(g, x0 - 16, y0 + 20, 22, h - 40, { r: 8, fill: C.ink2, shadow: false });
  // 页角帧号
  text(g, String(((pi + (f > .5 ? 1 : 0)) % 50 + 50) % 50).padStart(2, '0'), x0 + w - 18, y0 + h - 22, { f: 'mono', s: 30, w: 700, c: rgba(C.ink, .65), a: 'right' });
}

/* ---------------- 放映机（播放器） ---------------- */
/* on: 0..1 光束强度；spin: 胶片轮转角 */
function projector(g, x, y, s, lt, o = {}) {
  const on = o.on ?? 1, spin = (o.spin ?? lt * 3) * on;
  at(g, x, y, s, () => {
    // 光束
    if (on > 0 && o.beam !== false) {
      const L = o.beamLen || 420, Hh = o.beamH || 220;
      const gr = g.createLinearGradient(110, 0, 110 + L, 0); gr.addColorStop(0, rgba(C.amber, .55 * on)); gr.addColorStop(1, rgba(C.amber, 0));
      g.beginPath(); g.moveTo(118, 18); g.lineTo(118 + L, 18 - Hh / 2); g.lineTo(118 + L, 18 + Hh / 2); g.closePath(); g.fillStyle = gr; g.fill();
      for (let i = 0; i < 6; i++) { const px = 140 + frac(lt * .4 + hash(i)) * L * .8, py = 18 + (hash(i * 3.3) - .5) * Hh * .5 * (px - 118) / L; dot(g, px, py, 2.4, C.paper, .5 * on); }
    }
    // 胶片轮
    for (const [rx, rr2] of [[-62, 58], [58, 50]]) {
      g.save(); g.translate(rx, -88); g.rotate(spin * (rx < 0 ? 1 : 1.2));
      dot(g, 0, 0, rr2, '#5E4F42'); ring(g, 0, 0, rr2, C.line, 4);
      for (let i = 0; i < 3; i++) { g.save(); g.rotate(i / 3 * TAU); g.beginPath(); g.arc(0, -rr2 * .52, rr2 * .26, 0, TAU); g.fillStyle = C.bg; g.fill(); g.restore(); }
      dot(g, 0, 0, 9, C.dim); g.restore();
    }
    path(g, [[-62, -88], [-20, -20], [58, -88]], { c: C.film, w: 7 });
    // 机身
    card(g, -110, -26, 220, 110, { r: 16, fill: o.body || '#7A6552', lw: 3, stroke: '#C9B89A', sa: .5 });
    rr(g, -96, -12, 120, 12, 6); g.fillStyle = rgba(C.paper, .12); g.fill();
    // 镜头
    card(g, 100, -4, 40, 44, { r: 8, fill: '#5A4A3D', lw: 2, stroke: C.line, shadow: false });
    dot(g, 140, 18, 16, on > 0 ? rgba(C.amber, .5 + .5 * on) : '#3A3029'); ring(g, 140, 18, 16, C.dim, 3);
    dot(g, -70, 50, 7, on > 0.3 ? C.red : '#3A3029'); dot(g, -46, 50, 7, rgba(C.paper, .3));
    // 支脚
    path(g, [[-70, 84], [-86, 120]], { c: '#2A221C', w: 8 }); path(g, [[70, 84], [86, 120]], { c: '#2A221C', w: 8 });
  }, { al: o.al });
}

/* ---------------- 仪表与小物件 ---------------- */
function stopwatch(g, x, y, r, p, label, c = C.amber) {
  dot(g, x, y, r + 12, C.paper); ring(g, x, y, r + 12, C.ink, 4);
  card(g, x - 14, y - r - 34, 28, 22, { r: 5, fill: C.ink, shadow: false });
  ring(g, x, y, r - 6, rgba(c, .25), 14); ring(g, x, y, r - 6, c, 14, 1, -TAU / 4, -TAU / 4 + TAU * clamp(p));
  const a = -TAU / 4 + TAU * clamp(p); path(g, [[x, y], [x + Math.cos(a) * (r - 22), y + Math.sin(a) * (r - 22)]], { c: C.ink, w: 5 });
  dot(g, x, y, 7, C.ink);
  if (label) text(g, label, x, y + r + 50, { s: 32, w: 900, c: C.cream, f: 'disp' });
}
function clockFace(g, x, y, r, turns, o = {}) {
  dot(g, x, y, r, C.paper); ring(g, x, y, r, C.ink, 4);
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; path(g, [[x + Math.cos(a) * r * .78, y + Math.sin(a) * r * .78], [x + Math.cos(a) * r * .9, y + Math.sin(a) * r * .9]], { c: C.ink, w: 3 }); }
  const am = -TAU / 4 + turns * TAU, ah = -TAU / 4 + turns * TAU / 12;
  path(g, [[x, y], [x + Math.cos(ah) * r * .45, y + Math.sin(ah) * r * .45]], { c: C.ink, w: 6 });
  path(g, [[x, y], [x + Math.cos(am) * r * .72, y + Math.sin(am) * r * .72]], { c: o.c || C.red, w: 4 });
  dot(g, x, y, 5, C.ink);
}
/* CPU 半圆表：v 为百分比，max 200 */
function cpuGauge(g, x, y, r, v, o = {}) {
  const a0 = Math.PI, a1 = TAU, k = clamp(v / 200);
  g.save(); g.beginPath(); g.arc(x, y, r + 18, a0, a1); g.lineTo(x + r + 18, y + 24); g.lineTo(x - r - 18, y + 24); g.closePath(); g.fillStyle = C.paper; shadow(g, .4, 20, 8); g.fill(); g.restore();
  ring(g, x, y, r, rgba(C.ink, .12), 20, 1, a0, a1);
  ring(g, x, y, r, C.teal, 20, 1, a0, a0 + Math.PI * .5);
  ring(g, x, y, r, C.red, 20, 1, a0 + Math.PI * .5, a0 + Math.PI * Math.max(.5, k));
  for (const [pv, lab] of [[0, '0'], [100, '100%'], [200, '200%']]) {
    const a = a0 + Math.PI * pv / 200;
    text(g, lab, x + Math.cos(a) * (r - 46), y + Math.sin(a) * (r - 46) + 6, { f: 'mono', s: 24, w: 700, c: C.ink2 });
  }
  const a = a0 + Math.PI * k + (o.shake || 0);
  path(g, [[x, y], [x + Math.cos(a) * (r - 8), y + Math.sin(a) * (r - 8)]], { c: C.ink, w: 7 });
  dot(g, x, y, 12, C.ink);
  text(g, 'CPU', x, y - r * .38, { f: 'disp', s: 30, w: 900, c: C.ink });
}
/* GC 标记（垃圾桶） */
function gcMark(g, x, y, s = 1, c = C.dim, al = 1) {
  at(g, x, y, s, () => {
    g.strokeStyle = c; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(-10, -8); g.lineTo(-8, 12); g.lineTo(8, 12); g.lineTo(10, -8); g.stroke();
    path(g, [[-14, -10], [14, -10]], { c, w: 3 }); path(g, [[-4, -14], [4, -14]], { c, w: 3 });
    path(g, [[-3, -3], [-3, 7]], { c, w: 2.5 }); path(g, [[3, -3], [3, 7]], { c, w: 2.5 });
  }, { al });
}
/* 胶片盒（LRU 的一格）：圆铁盒 + 标签 */
function canister(g, x, y, r, col, label, o = {}) {
  at(g, x, y, o.s ?? 1, () => {
    g.save(); shadow(g, .45, 16, 6); dot(g, 0, 0, r, '#6B5B4C'); g.restore();
    ring(g, 0, 0, r - 5, rgba(C.paper, .25), 3); dot(g, 0, 0, r * .62, col);
    if (label) text(g, label, 0, 1, { f: 'mono', s: Math.max(24, r * .42), w: 700, c: '#fff' });
  }, { al: o.al, rot: o.rot });
}
/* 像素画布（Bitmap）：cols×rows 格子，显示帧 idx；scan∈[0,1] 时上方是新帧 idx、下方是旧帧 prev */
function pixelCanvas(g, x, y, w, h, idx, o = {}) {
  const cols = o.cols || 24, rows = o.rows || 16, cw = w / cols, chh = h / rows, scan = o.scan ?? 1, prev = o.prev ?? idx;
  g.save(); shadow(g, .45, 24, 10); g.fillStyle = C.paper; g.fillRect(x - 10, y - 10, w + 20, h + 20); g.restore();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const fi = (r + .5) / rows <= scan ? idx : prev, k = frameScale(((fi % 50) + 50) % 50);
    const u = ((c + .5) / cols - .5) / (.62 * k), v = ((r + .5) / rows - .48) / (.6 * k);
    const inCard = Math.abs(u) < .5 && Math.abs(v) < .5;
    const ic = Math.hypot(u + .28, v + .2) < .16;
    g.fillStyle = ic ? (o.icon || C.blue) : inCard ? (o.cardC || '#FFFBF2') : (o.bgC || C.paper2);
    g.fillRect(x + c * cw + 1, y + r * chh + 1, cw - 2, chh - 2);
  }
  if (scan > 0 && scan < 1) { g.save(); g.fillStyle = rgba(C.amber, .9); g.fillRect(x - 6, y + h * scan - 3, w + 12, 6); g.shadowColor = C.amber; g.restore(); }
  g.save(); g.strokeStyle = C.ink; g.lineWidth = 3; g.strokeRect(x - 10, y - 10, w + 20, h + 20); g.restore();
}

/* ---------------- 内存曲线 ---------------- */
/* 每个方案两段：A = 操作最后一个看板时，B = 6～7 分钟后。v(u) → [总量, Native, Java]（MB）。
 * 段末值 = 截图顶栏读数（实测）；段内形状 = 截图形状的示意（不标数）。 */
const END = {
  s1A: [1190.1, 989.3, 41.7], s1B: [1088.4, 942, 46.1],
  s2A: [310.2, 72.9, 69.8], s2B: [229.1, 53.2, 65.8],
  s3A: [298.8, 65.1, 62], s3B: [253.5, 64.6, 63.7],
};
const toEnd = (key, u, tot) => lerp(tot, END[key][0], sstep((u - .965) / .035));
const MEMF = {
  s1A: u => { const n = 9, k = u * n, i = Math.min(n, Math.floor(k)), f = k - i, L = j => 1030 + 160 * Math.pow(j / n, .95); return L(i) + (L(Math.min(n, i + 1)) - L(i)) * sstep((f - .62) / .38); },
  s1B: u => lerp(1104, 1088.4, u) + 22 * Math.exp(-(((u - .5) / .014) ** 2)) + 12 * Math.exp(-(((u - .56) / .012) ** 2)) + 9 * Math.exp(-(((u - .63) / .012) ** 2)) + 8 * Math.exp(-(((u - .77) / .012) ** 2)),
  s2A: u => u < .78 ? 282 + 75 * (u / .78) + 7 * frac(u * 15) : u < .8 ? lerp(357 + 7 * frac(.78 * 15), 280, sstep((u - .78) / .02)) : 280 + 30.2 * ((u - .8) / .2) + 6 * frac(u * 15) * (1 - sstep((u - .95) / .05)),
  s2B: u => 270 - 22 * sstep((u - .22) / .03) - (248 - 229.1) * sstep((u - .78) / .03) + 1.5 * Math.sin(u * 40),
  s3A: u => 292 + 6.8 * Math.pow(u, .8) + .9 * Math.sin(u * 31),
  s3B: u => 300 - 46.5 * sstep((u - .16) / .03) + 1.2 * Math.sin(u * 23) * (u < .2 ? 1 : .4),
};
function memAt(key, u) {
  const tot = toEnd(key, u, MEMF[key](u)), [et, en, ej] = END[key];
  const kN = key.startsWith('s1') ? .92 : key.startsWith('s2') ? .5 : .1;
  const nat = en + (tot - et) * kN, jav = ej + (tot - et) * (key.startsWith('s2') ? .12 : .03);
  return [tot, Math.max(0, nat), Math.max(0, jav)];
}
const GCS = { s1A: [.03, .34], s1B: [.53, .57, .6, .63, .66, .77], s2A: [.79], s2B: [.79], s3A: [], s3B: [] };
const CLICKS = { s1A: 30, s2A: 22, s3A: 15 };
const SCHEME = { s1: { col: C.red, name: '方案一 · AnimationDrawable' }, s2: { col: C.amber, name: '方案二 · 自研 + bytes 缓存' }, s3: { col: C.teal, name: '方案三 · 自研 + 复用 Bitmap' } };
/* 坐标纸几何：b = {x,y,w,h}；split 时段 A 占 0–.6，段 B 占 .68–1 */
function chartGeo(b, o) {
  const px = b.x + (o.padL ?? 118), py = b.y + (o.padT ?? 92), pw = b.w - (o.padL ?? 118) - (o.padR ?? 40), ph = b.h - (o.padT ?? 92) - (o.padB ?? 108);
  const segX = o.segX || (o.single ? [[0, 1]] : [[0, .6], [.68, 1]]);
  return { px, py, pw, ph, segX, X: (s, u) => px + pw * lerp(segX[s][0], segX[s][1], u), Y: v => py + ph * (1 - v / o.max) };
}
/* 画一张内存图。o: {scheme:'s1', max, ticks, pA, pB, title, legend, single, al, labels:[A标签,B标签], gc:true, clicks:true, hideB} */
function memChart(g, b, o) {
  const G = chartGeo(b, o), sch = SCHEME[o.scheme], pA = o.pA ?? 1, pB = o.pB ?? 1;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  // 纸
  card(g, b.x, b.y, b.w, b.h, { r: 14, fill: C.paper, sa: .5, sb: 34, so: 14 });
  g.save(); rr(g, b.x, b.y, b.w, b.h, 14); g.clip();
  g.strokeStyle = rgba(C.teal, .12); g.lineWidth = 1;
  for (let x = G.px; x <= G.px + G.pw + 1; x += G.pw / 24) { g.beginPath(); g.moveTo(x, G.py); g.lineTo(x, G.py + G.ph); g.stroke(); }
  for (let y = G.py; y <= G.py + G.ph + 1; y += G.ph / 16) { g.beginPath(); g.moveTo(G.px, y); g.lineTo(G.px + G.pw, y); g.stroke(); }
  g.restore();
  // 纵轴刻度
  for (const v of o.ticks) {
    const y = G.Y(v); path(g, [[G.px, y], [G.px + G.pw, y]], { c: rgba(C.ink, v ? .16 : .55), w: v ? 1.5 : 3 });
    text(g, String(v), G.px - 14, y, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'right' });
  }
  text(g, 'MB', G.px - 14, G.py + G.ph + 36, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'right' });
  if (o.title) text(g, o.title, b.x + 30, b.y + 42, { s: 30, w: 900, c: C.ink, a: 'left' });
  if (o.legend !== false) {
    let lx = b.x + b.w - 30;
    for (const [lab, c] of [['其他', rgba(C.ink2, .35)], ['Java', C.blue], ['Native', C.red]]) {
      const w = textW(g, lab, { s: 24, w: 700 }); text(g, lab, lx, b.y + 42, { s: 24, w: 700, c: C.ink, a: 'right' });
      rr(g, lx - w - 30, b.y + 32, 20, 20, 4); g.fillStyle = c; g.fill(); lx -= w + 52;
    }
  }
  // 段
  const segs = o.single ? [['A', pA]] : [['A', pA], ['B', o.hideB ? 0 : pB]];
  segs.forEach(([sid, p], s) => {
    const key = o.scheme + sid, x0 = G.X(s, 0), x1 = G.X(s, 1);
    // 横轴标签
    if (o.labels && o.labels[s] && (s === 0 || !o.hideB)) text(g, o.labels[s], (x0 + x1) / 2, G.py + G.ph + 74, { s: 24, w: 700, c: C.ink2, al: s ? o.labelBAl ?? 1 : 1 });
    if (s === 1 && !o.hideB) { // 断轴记号
      const bx = (G.X(0, 1) + G.X(1, 0)) / 2, al = o.breakAl ?? 1;
      for (const dx of [-8, 8]) path(g, [[bx + dx - 8, G.py + G.ph + 16], [bx + dx + 8, G.py + G.ph - 16]], { c: C.ink, w: 3, al });
    }
    if (p <= 0) return;
    const N = 110, us = []; for (let i = 0; i <= N; i++) { const u = i / N * p; us.push(u); }
    const pts = us.map(u => [lerp(x0, x1, u), memAt(key, u)]);
    const layer = (lo, hi, fill) => {
      g.beginPath(); pts.forEach(([x, v], i) => { const y = G.Y(hi(v)); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], G.Y(lo(pts[i][1])));
      g.closePath(); g.fillStyle = fill; g.fill();
    };
    layer(() => 0, v => v[1], rgba(C.red, .62));
    layer(v => v[1], v => v[1] + v[2], rgba(C.blue, .55));
    layer(v => v[1] + v[2], v => v[0], rgba(C.ink2, .2));
    path(g, pts.map(([x, v]) => [x, G.Y(v[0])]), { c: sch.col === C.amber ? '#C77F14' : sch.col, w: 5 });
    if (p < 1) { const [x, v] = pts[pts.length - 1]; dot(g, x, G.Y(v[0]), 14, rgba(sch.col, .35)); dot(g, x, G.Y(v[0]), 7, sch.col); }
    // GC 标记
    if (o.gc !== false) for (const u of GCS[key]) if (u <= p) gcMark(g, lerp(x0, x1, u), G.py + G.ph + 30, 1, C.ink2, eo(seg(p, u, u + .04)));
    // 点击事件
    if (o.clicks && CLICKS[key]) for (let i = 0; i < CLICKS[key]; i++) { const u = (i + .3 + hash(i * 7.1) * .4) / CLICKS[key]; if (u <= p) dot(g, lerp(x0, x1, u), G.py - 22, 6, C.red, .75); }
  });
  g.restore();
  return G;
}
/* 读数标注：从 (ax,ay) 引线到标签框 (x,y)（框中心） */
function readout(g, ax, ay, x, y, lines, p, col, o = {}) {
  if (p <= 0) return;
  const k = eo(p);
  path(g, partial([[ax, ay], [x, y]], k), { c: C.ink, w: 2.5 });
  dot(g, ax, ay, 7, col); ring(g, ax, ay, 7, C.ink, 2.5);
  at(g, x, y, pop(seg(p, .3, 1)), () => {
    const fs = o.fs || 30, w = Math.max(...lines.map((l, i) => textW(g, l, { f: i ? 'cjk' : 'mono', s: i ? 24 : fs, w: 700 }))) + 44, h = fs + 26 + (lines.length - 1) * 34;
    card(g, -w / 2, -h / 2, w, h, { r: 12, fill: o.fill || C.ink, sa: .3, sb: 12, so: 4 });
    rr(g, -w / 2, -h / 2, 10, h, 5); g.fillStyle = col; g.fill();
    lines.forEach((l, i) => text(g, l, 6, -h / 2 + fs / 2 + 13 + i * 34 + (i ? 4 : 0), { f: i ? 'cjk' : 'mono', s: i ? 24 : fs, w: 700, c: i ? rgba(C.paper, .8) : (o.tc || C.paper) }));
  });
}

/* ---------------- 背景、后期 ---------------- */
function prepareStyle({ mk, cw, ch }) {
  const base = mk(cw, ch), p = base.getContext('2d'); p.scale(cw / W, ch / H);
  const lg = p.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#231D18'); lg.addColorStop(.55, '#1B1714'); lg.addColorStop(1, '#14110E');
  p.fillStyle = lg; p.fillRect(0, 0, W, H);
  for (let i = 0; i < 7000; i++) { const x = hash(i * 1.17) * W, y = hash(i * 2.31 + 9) * H; p.fillStyle = rgba(C.paper, .012 + hash(i * 5.3) * .02); p.fillRect(x, y, 1.5, 1.5); }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 380, 960, 540, 1200); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  const grain = [];
  for (let k = 0; k < 4; k++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt);
  }
  return { base, vign, grain };
}
/* 上下两排齿孔，缓慢走带 */
function sprockets(g, t, al = 1) {
  const pitch = 64, off = (t * 26) % pitch;
  g.save(); g.globalAlpha *= al;
  g.fillStyle = C.film; g.fillRect(0, 0, W, 30); g.fillRect(0, H - 30, W, 30);
  for (let x = -off; x < W + pitch; x += pitch) for (const y of [7, H - 23]) { rr(g, x + 18, y, 28, 16, 4); g.fillStyle = rgba(C.paper, .14); g.fill(); }
  g.restore();
}
function drawBackground(g, { cache, t }) {
  g.drawImage(cache.base, 0, 0, W, H);
  // 漏光：两团暖光缓慢漂移
  const leaks = [[C.amber, 300, 260, .12, 700], ['#E8643A', 1640, 820, .1, 760], [C.amber, 1250, 120, .06, 520]];
  leaks.forEach(([c, x, y, a, r], i) => {
    const bx = x + wob(t, .019, 140, i * 3), by = y + wob(t, .015, 90, i * 5), aa = a * (.8 + .2 * Math.sin(t * .7 + i));
    const rg = g.createRadialGradient(bx, by, 0, bx, by, r); rg.addColorStop(0, rgba(c, aa)); rg.addColorStop(1, rgba(c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  // 飞尘
  for (let i = 0; i < 30; i++) {
    const x = (hash(i * 3.3) * W + t * (6 + hash(i) * 12)) % W, y = (hash(i * 9.1) * H - t * (5 + hash(i * 2) * 8) + H * 10) % H;
    dot(g, x, y, 1.4 + hash(i * 4.4) * 2.2, C.paper, .05 + .05 * Math.sin(t * .8 + i));
  }
  sprockets(g, t);
}
function postFX(g, { cache, t, cw, ch }) {
  const fr = Math.floor(t * FPS);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cache.vign, 0, 0);
  // 划痕：偶发的细竖线（持续几帧）
  const s = Math.floor(t * 3);
  if (hash(s * 1.7) > .55) { const x = hash(s * 4.1) * cw + Math.sin(fr) * 2; g.fillStyle = rgba(C.paper, .07 + .05 * hash(fr)); g.fillRect(x, 0, Math.max(1, cw / 1920 * 1.6), ch); }
  // 尘点：每帧换位置
  for (let i = 0; i < 3; i++) if (hash(fr * 3.1 + i) > .6) dot(g, hash(fr * 7.7 + i) * cw, hash(fr * 9.3 + i) * ch, (1 + hash(fr + i) * 2.5) * cw / 1920, i % 2 ? '#000' : C.paper, .25);
  // 颗粒
  const gp = g.createPattern(cache.grain[fr % 4], 'repeat');
  g.globalAlpha = .075; g.globalCompositeOperation = 'overlay';
  g.translate(Math.floor(hash(fr) * 256), Math.floor(hash(fr + 7) * 256)); g.scale(Math.max(1, SCX * .75), Math.max(1, SCX * .75));
  g.fillStyle = gp; g.fillRect(-512, -512, cw + 1024, ch + 1024);
  g.restore();
  // 亮度闪烁
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = rgba('#000000', .025 * hash(fr * 1.3)); g.fillRect(0, 0, cw, ch); g.restore();
}
