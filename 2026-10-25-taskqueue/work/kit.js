/* =====================================================================
 * 把任务队列改成网络线程池 —— 画面工具：工厂流水线风格包
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * 车间侧视图：后墙（屏幕空间，0.25 视差）+ 地面与机器（镜头空间）；工矿灯光锥、尘埃、暗角与颗粒。
 * 图元：传送带 belt、货箱 crate、机械臂 robot、气动管 tube/capsule、挂架 manifold、仪表 gauge、
 *       闸门 gate、吊车 crane、扫码门 scanner、拒收箱 rejectBin、橡皮章 stamp、时间签 timeTag、控制屏 screenPanel。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题：夜班车间（深灰绿钢墙 + 钠灯暖光 + 安全黄） ---------------- */
const C = {
  wall: '#263235', wallD: '#182023', wallL: '#34423F',
  floor: '#34373A', floorD: '#1D2022',
  ink: '#0F1214', ink2: '#2A3135',
  steel: '#7F8C92', steelD: '#4B555A', steelL: '#B7C1C5', steelX: '#E1E7E8',
  paint: '#3C7A71', paintD: '#27534E', paintL: '#64A398',
  kraft: '#C99459', kraftD: '#97683A', kraftL: '#E3B67E', tape: '#EADCB9',
  yellow: '#F7B900', yellowD: '#B88900', orange: '#F26B22',
  green: '#3BCB70', greenD: '#1F8D4A', red: '#EC4B50', redD: '#A42F35',
  cyan: '#5CC8FF', blue: '#3A8DD8',
  cream: '#F4EDDF', dim: '#A6B0B3', paper: '#F7F2E6',
  rubber: '#232628', rubberL: '#3A3F42', lamp: '#FFD79A',
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
const FLOOR = 850;          // 地面线（镜头空间）
const KIND = {              // 任务种类：箱子外观 + 贴签颜色
  http: { label: '网络', c: C.steelL }, hi: { label: '加急', c: C.orange }, local: { label: '本地', c: C.green },
  sync: { label: '周期', c: C.cyan }, barrier: { label: '屏障', c: C.yellow },
};

/* ---------------- 运动曲线 ---------------- */
const pop = p => p <= 0 ? 0 : p >= 1 ? 1 : eback(p);
const spring = (t, k = 6, f = 1.4) => t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(f * TAU * t);
const win = (lt, a, b, fi = .3, fo = .3) => Math.min(eo(seg(lt, a, a + fi)), 1 - eo(seg(lt, b - fo, b)));
const wob = (t, f = 1, a = 1, s = 0) => Math.sin((t + s) * TAU * f) * a;
/* 落地：k∈[0,1] 下落，返回 [位移比例, 挤压量]；落地后 .35 s 内回弹 */
function landing(lt, t0, dur = .45) {
  const k = seg(lt, t0, t0 + dur), after = lt - t0 - dur;
  const sq = after > 0 && after < .35 ? Math.sin(after / .35 * Math.PI) * .14 * (1 - after / .35) : 0;
  return [k * k, sq];
}

/* ---------------- 全局渲染状态 ---------------- */
let SCX = 1, CAMZ = 1, CAM = [W / 2, H / 2, 1];
const SH = () => SCX * CAMZ;

/* ---------------- 文字 ---------------- */
const font = o => `${o.w || 700} ${o.s || 30}px ${F[o.f || 'cjk']}`;
function text(g, s, x, y, o = {}) {
  g.save();
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.font = font(o); g.textAlign = o.a || 'center'; g.textBaseline = o.b || 'middle';
  if (o.ls) g.letterSpacing = o.ls + 'px';
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = (o.gb || 18) * SH(); }
  if (o.emboss) { g.fillStyle = rgba('#000000', .45); g.fillText(s, x + 2, y + 3); }
  g.fillStyle = o.c || C.cream; g.fillText(s, x, y);
  g.restore();
}
function textW(g, s, o = {}) { g.save(); g.font = font(o); if (o.ls) g.letterSpacing = o.ls + 'px'; const w = g.measureText(s).width; g.restore(); return w; }

/* ---------------- 基础形状 ---------------- */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
function shadow(g, a = .35, blur = 24, oy = 10) { g.shadowColor = rgba('#000000', a); g.shadowBlur = blur * SH(); g.shadowOffsetY = oy * SH(); }
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; }
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
  g.stroke(); g.restore();
}
function poly(g, pts, fill, o = {}) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (o.lw !== 0) { g.lineWidth = o.lw ?? 2.5; g.strokeStyle = o.stroke || C.ink; g.lineJoin = 'round'; g.stroke(); }
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

/* ---------------- 金属质感 ---------------- */
/* 钢板：竖向渐变 + 顶边高光 + 墨线 + 角铆钉 */
function plate(g, x, y, w, h, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  const base = o.fill || C.steelD;
  rr(g, x, y, w, h, o.r ?? 6);
  if (o.shadow !== false) shadow(g, o.sa ?? .4, o.sb ?? 22, o.so ?? 8);
  const lg = g.createLinearGradient(0, y, 0, y + h);
  lg.addColorStop(0, o.top || lighten(base, .18)); lg.addColorStop(.5, base); lg.addColorStop(1, o.bot || darken(base, .2));
  g.fillStyle = lg; g.fill(); noShadow(g);
  if (o.lw !== 0) { g.lineWidth = o.lw ?? 2.5; g.strokeStyle = o.stroke || C.ink; g.stroke(); }
  path(g, [[x + (o.r ?? 6), y + 2.5], [x + w - (o.r ?? 6), y + 2.5]], { c: rgba('#ffffff', .22), w: 2 });
  if (o.rivets !== false && w > 60 && h > 36) for (const [rx, ry] of [[x + 12, y + 12], [x + w - 12, y + 12], [x + 12, y + h - 12], [x + w - 12, y + h - 12]]) rivet(g, rx, ry, 4.5);
  g.restore();
}
function rivet(g, x, y, r = 5) { dot(g, x, y, r, C.steelD); dot(g, x - r * .3, y - r * .3, r * .45, rgba('#ffffff', .55)); ring(g, x, y, r, C.ink, 1.5); }
/* 黄黑警示斜纹（裁剪在矩形内），off 为滚动偏移 */
function hazard(g, x, y, w, h, o = {}) {
  g.save(); rr(g, x, y, w, h, o.r ?? 0); g.clip();
  g.fillStyle = o.c1 || C.yellow; g.fillRect(x, y, w, h);
  g.fillStyle = o.c2 || '#151515'; const s = o.s || 28, off = ((o.off || 0) % (s * 2) + s * 2) % (s * 2);
  for (let i = -h - s * 2; i < w + h; i += s * 2) { g.beginPath(); g.moveTo(x + i + off, y + h); g.lineTo(x + i + off + s, y + h); g.lineTo(x + i + off + s + h, y); g.lineTo(x + i + off + h, y); g.closePath(); g.fill(); }
  g.restore();
  if (o.lw !== 0) { rr(g, x, y, w, h, o.r ?? 0); g.lineWidth = o.lw ?? 2.5; g.strokeStyle = C.ink; g.stroke(); }
}
function hexToRgb(hex) { let h = hex.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
function mixHex(a, b, k) { const A = hexToRgb(a), B = hexToRgb(b); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], clamp(k))).toString(16).padStart(2, '0')).join(''); }
const lighten = (c, k) => mixHex(c, '#ffffff', k), darken = (c, k) => mixHex(c, '#000000', k);
/* 铭牌：带铆钉的钢牌 + 刻字 */
function sign(g, s, x, y, o = {}) {
  const fs = o.s || 26, w = textW(g, s, { s: fs, w: o.w || 900, f: o.f }) + (o.pad ?? 44), h = fs + (o.ph ?? 24);
  at(g, x, y, o.k ?? 1, () => {
    plate(g, -w / 2, -h / 2, w, h, { fill: o.fill || C.steelD, r: o.r ?? 6, rivets: o.rivets ?? (w > 120), sb: 14, so: 5 });
    if (o.bar) { g.save(); rr(g, -w / 2, -h / 2, 10, h, 4); g.fillStyle = o.bar; g.fill(); g.restore(); }
    text(g, s, (o.bar ? 5 : 0), 2, { s: fs, w: o.w || 900, f: o.f, c: o.c || C.cream, emboss: true });
  }, { al: o.al, rot: o.rot });
  return w;
}

/* ---------------- 指示灯与警示灯 ---------------- */
function lampDot(g, x, y, r, c, on = 1) {
  dot(g, x, y, r + 3, C.ink);
  dot(g, x, y, r, on > .1 ? c : darken(c, .65));
  if (on > .1) { g.save(); g.globalAlpha *= on; g.shadowColor = c; g.shadowBlur = r * 3 * SH(); dot(g, x, y, r * .8, lighten(c, .35)); g.restore(); dot(g, x - r * .3, y - r * .35, r * .3, rgba('#ffffff', .7 * on)); }
}
/* 旋转警示灯：灯罩 + 扫过的光束 */
function beacon(g, x, y, lt, on = 1, c = C.orange, s = 1) {
  at(g, x, y, s, () => {
    plate(g, -22, -6, 44, 14, { fill: C.steelD, r: 3, rivets: false, shadow: false });
    if (on > 0) {
      const a = lt * 6;
      g.save(); g.globalAlpha *= on * .5; g.globalCompositeOperation = 'lighter';
      const bx = Math.cos(a) * 160, gr = g.createRadialGradient(0, -22, 4, 0, -22, 170);
      gr.addColorStop(0, rgba(c, .55)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -22); g.lineTo(bx - 40 * Math.sin(a), -22 - 60); g.lineTo(bx + 40 * Math.sin(a), -22 + 60); g.closePath(); g.fill();
      g.restore();
    }
    g.beginPath(); g.moveTo(-16, -6); g.lineTo(-16, -26); g.quadraticCurveTo(0, -48, 16, -26); g.lineTo(16, -6); g.closePath();
    g.fillStyle = on > 0 ? lighten(c, .15 + .25 * Math.max(0, Math.sin(lt * 6))) : darken(c, .55); g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
    if (on > 0) { g.save(); g.shadowColor = c; g.shadowBlur = 24 * SH() * on; dot(g, 0, -22, 7, rgba('#ffffff', .8 * on)); g.restore(); }
  });
}

/* ---------------- 车间：地面（镜头空间） ---------------- */
function hall(g, frame, o = {}) {
  const x0 = -1600, x1 = 3600;
  // 墙脚踢脚线
  g.save();
  const sk = g.createLinearGradient(0, FLOOR - 40, 0, FLOOR); sk.addColorStop(0, rgba('#000000', 0)); sk.addColorStop(1, rgba('#000000', .35));
  g.fillStyle = sk; g.fillRect(x0, FLOOR - 40, x1 - x0, 40);
  // 水泥地：渐变 + 纹理
  const fg = g.createLinearGradient(0, FLOOR, 0, FLOOR + 500); fg.addColorStop(0, C.floor); fg.addColorStop(1, C.floorD);
  g.fillStyle = fg; g.fillRect(x0, FLOOR, x1 - x0, 900);
  if (frame.cache.concrete) { g.globalAlpha = .55; g.fillStyle = g.createPattern(frame.cache.concrete, 'repeat'); g.fillRect(x0, FLOOR, x1 - x0, 900); g.globalAlpha = 1; }
  path(g, [[x0, FLOOR], [x1, FLOOR]], { c: rgba('#000000', .55), w: 3 });
  path(g, [[x0, FLOOR + 2.5], [x1, FLOOR + 2.5]], { c: rgba('#ffffff', .06), w: 2 });
  // 走道警示线
  g.fillStyle = rgba(C.yellow, .55);
  for (let x = x0; x < x1; x += 120) { g.beginPath(); g.moveTo(x, FLOOR + 62); g.lineTo(x + 70, FLOOR + 62); g.lineTo(x + 58, FLOOR + 74); g.lineTo(x - 12, FLOOR + 74); g.closePath(); g.fill(); }
  // 伸缩缝
  for (let x = x0 + 80; x < x1; x += 420) path(g, [[x, FLOOR + 6], [x - 60, FLOOR + 300]], { c: rgba('#000000', .18), w: 2 });
  g.restore();
}
/* 机器落在地面上的接触阴影 */
function floorShadow(g, x, w, a = .4) {
  const gr = g.createRadialGradient(x, FLOOR + 4, 0, x, FLOOR + 4, w / 2);
  gr.addColorStop(0, rgba('#000000', a)); gr.addColorStop(1, rgba('#000000', 0));
  g.save(); g.translate(x, FLOOR + 4); g.scale(1, .16); g.translate(-x, -(FLOOR + 4)); g.fillStyle = gr; g.fillRect(x - w / 2, FLOOR + 4 - w / 2, w, w); g.restore();
}

/* ---------------- 传送带 ---------------- */
/* y 为带面高度；v 为带面速度 px/s；o.legs=false 不画支腿 */
function belt(g, x0, x1, y, lt, o = {}) {
  const v = o.v ?? 110, len = x1 - x0, off = lt * v;
  if (o.legs !== false) {
    for (let x = x0 + 70; x <= x1 - 40; x += o.legGap || 260) {
      floorShadow(g, x, 120, .35);
      g.save(); g.fillStyle = C.steelD; g.fillRect(x - 9, y + 30, 18, FLOOR - y - 30); g.restore();
      path(g, [[x - 9, y + 30], [x - 9, FLOOR]], { c: C.ink, w: 2 }); path(g, [[x + 9, y + 30], [x + 9, FLOOR]], { c: C.ink, w: 2 });
      path(g, [[x - 3, y + 34], [x - 3, FLOOR - 4]], { c: rgba('#ffffff', .12), w: 3 });
      plate(g, x - 26, FLOOR - 10, 52, 12, { fill: C.steelD, r: 2, rivets: false, shadow: false, lw: 2 });
      if (x + (o.legGap || 260) <= x1 - 40) path(g, [[x + 9, y + 120], [x + (o.legGap || 260) - 9, FLOOR - 40]], { c: rgba(C.steelD, .9), w: 6 });
    }
  }
  // 回程带（带子下侧）
  path(g, [[x0, y + 28], [x1, y + 28]], { c: C.rubber, w: 7 });
  // 带面：橡胶 + 移动的横棱
  g.save();
  rr(g, x0 - 4, y - 10, len + 8, 16, 6); g.fillStyle = C.rubber; g.fill();
  g.clip();
  for (let x = x0 - 40 + (off % 36); x < x1 + 36; x += 36) { g.fillStyle = C.rubberL; g.fillRect(x, y - 10, 6, 16); }
  g.fillStyle = rgba('#ffffff', .08); g.fillRect(x0, y - 10, len, 3);
  g.restore();
  rr(g, x0 - 4, y - 10, len + 8, 16, 6); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
  // 侧梁
  plate(g, x0 - 10, y + 6, len + 20, 26, { fill: o.frame || C.paint, r: 4, rivets: false, sb: 16, so: 8 });
  for (let x = x0 + 30; x < x1 - 10; x += 90) rivet(g, x, y + 19, 4);
  // 两端滚筒
  for (const ex of [x0 - 6, x1 + 6]) {
    dot(g, ex, y + 4, 21, C.steelD); ring(g, ex, y + 4, 21, C.ink, 2.5);
    const a = off / 21;
    for (let k = 0; k < 3; k++) { const aa = a + k * TAU / 3; path(g, [[ex, y + 4], [ex + Math.cos(aa) * 15, y + 4 + Math.sin(aa) * 15]], { c: C.steelL, w: 3 }); }
    dot(g, ex, y + 4, 5, C.steelX); ring(g, ex, y + 4, 5, C.ink, 1.5);
  }
  if (o.label) sign(g, o.label, (x0 + x1) / 2 + (o.labelDx || 0), y + 70, { s: 24, fill: C.ink2 });
}

/* ---------------- 货箱（原点在底边中点，压在带面上） ---------------- */
function crate(g, x, y, o = {}) {
  const kind = o.kind || 'http', w = o.w || 130, h = o.h || 96, d = o.d ?? 18, dy = d * .7;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.translate(x, y); if (o.rot) g.rotate(o.rot);
  g.scale((o.s || 1) * (1 + (o.sq || 0)), (o.s || 1) * (1 - (o.sq || 0)));
  // 接触阴影
  g.save(); g.globalAlpha *= .5; g.fillStyle = '#000'; g.beginPath(); g.ellipse(d / 2, 0, w / 2 + 10, 6, 0, 0, TAU); g.fill(); g.restore();
  const front = [[-w / 2, -h], [w / 2, -h], [w / 2, 0], [-w / 2, 0]];
  const top = [[-w / 2, -h], [-w / 2 + d, -h - dy], [w / 2 + d, -h - dy], [w / 2, -h]];
  const side = [[w / 2, -h], [w / 2 + d, -h - dy], [w / 2 + d, -dy], [w / 2, 0]];
  let fc, tc, sc2;
  if (kind === 'local') { fc = C.green; tc = lighten(C.green, .3); sc2 = C.greenD; }
  else if (kind === 'barrier') { fc = C.yellow; tc = lighten(C.yellow, .35); sc2 = C.yellowD; }
  else { fc = C.kraft; tc = C.kraftL; sc2 = C.kraftD; }
  poly(g, side, sc2); poly(g, top, tc);
  // 正面
  g.save(); poly(g, front, null, { lw: 0 });
  const fg = g.createLinearGradient(0, -h, 0, 0); fg.addColorStop(0, lighten(fc, .08)); fg.addColorStop(1, darken(fc, .1));
  g.fillStyle = fg; g.fill(); g.clip();
  if (kind === 'barrier') hazard(g, -w / 2, -h, w, h, { s: 22, lw: 0 });
  else if (kind === 'local') {
    for (let i = 1; i < 4; i++) path(g, [[-w / 2, -h + i * h / 4], [w / 2, -h + i * h / 4]], { c: rgba('#000000', .16), w: 3 });
    rr(g, -w * .22, -h + 12, w * .44, 14, 7); g.fillStyle = rgba('#000000', .45); g.fill();
  } else {
    // 纸箱：封箱胶带 + 纸纹
    g.fillStyle = rgba(C.tape, .55); g.fillRect(-11, -h, 22, h * .34);
    for (let i = 0; i < 5; i++) path(g, [[-w / 2, -h + 12 + i * 19], [w / 2, -h + 14 + i * 19]], { c: rgba('#000000', .035), w: 2 });
    if (kind === 'sync') { g.fillStyle = rgba(C.cyan, .75); g.fillRect(-w / 2, -h * .62, w, 10); g.fillRect(-w / 2, -h * .62 + 16, w, 4); }
  }
  g.restore();
  poly(g, front, null, { lw: 2.5 });
  if (kind !== 'barrier' && kind !== 'local') { g.fillStyle = rgba(C.tape, .55); poly(g, [[-11, -h], [-11 + d, -h - dy], [11 + d, -h - dy], [11, -h]], rgba(C.tape, .6), { lw: 0 }); }
  // 贴签
  const K = KIND[kind] || KIND.http, lab = o.label ?? K.label;
  if (lab && w >= 90) {
    const lw2 = Math.max(70, textW(g, lab, { s: 24, w: 900 }) + 34), lx = -w / 2 + 12, ly = -h * .52;
    g.save(); g.translate(lx + lw2 / 2, ly); g.rotate(kind === 'hi' ? -.06 : 0);
    rr(g, -lw2 / 2, -18, lw2, 36, 4); g.fillStyle = kind === 'barrier' ? '#151515' : C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    rr(g, -lw2 / 2, -18, 9, 36, 3); g.fillStyle = kind === 'barrier' ? C.yellow : K.c; g.fill();
    text(g, lab, 5, 1, { s: 24, w: 900, c: kind === 'barrier' ? C.yellow : C.ink });
    g.restore();
  }
  if (o.no != null && h >= 88) text(g, '#' + String(o.no).padStart(4, '0'), w / 2 - 10, -16, { f: 'mono', s: 24, w: 700, a: 'right', c: kind === 'barrier' ? '#151515' : rgba('#1a1208', .62) });
  if (o.lamp) lampDot(g, d / 2, -h - dy / 2, 9, o.lamp === 'ok' ? C.green : o.lamp === 'fail' ? C.red : C.yellow, 1);
  if (o.glow) { g.save(); poly(g, front, null, { lw: 0 }); g.shadowColor = o.glowC || C.yellow; g.shadowBlur = 30 * SH() * o.glow; g.lineWidth = 4; g.strokeStyle = rgba(o.glowC || C.yellow, o.glow); g.stroke(); g.restore(); }
  g.restore();
}
/* 父任务大箱：翻盖 open∈[0,1]，内部可见 */
function bigCrate(g, x, y, o = {}) {
  const w = o.w || 250, h = o.h || 120, d = 22, dy = d * .7, open = o.open || 0;
  crate(g, x, y, { ...o, w, h, d, label: o.label ?? '父任务', lamp: null });
  if (open <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al); g.translate(x, y);
  // 箱口内侧
  poly(g, [[-w / 2 + 3, -h], [-w / 2 + d + 3, -h - dy], [w / 2 + d - 3, -h - dy], [w / 2 - 3, -h]], darken(C.kraftD, .45), { lw: 0 });
  const flap = (px, py, a0, a1, L) => {
    const a = lerp(a0, a1, eo(open)), ex = px + Math.cos(a) * L, ey = py + Math.sin(a) * L;
    poly(g, [[px, py], [ex, ey], [ex + d, ey - dy], [px + d, py - dy]], a > -Math.PI / 2 ? C.kraftL : C.kraft);
  };
  flap(-w / 2, -h, 0, -Math.PI * .82, w / 2 - 4);
  flap(w / 2, -h, Math.PI, -Math.PI * .18, w / 2 - 4);
  g.restore();
}

/* ---------------- 气动管与胶囊（子请求） ---------------- */
const CAP_W = 30, CAP_H = 58;
function tubeBack(g, x, y0, y1) {
  g.save(); g.fillStyle = rgba('#BFE6F0', .07); g.fillRect(x - 19, y0, 38, y1 - y0); g.restore();
  path(g, [[x - 19, y0], [x - 19, y1]], { c: rgba('#000000', .55), w: 3 }); path(g, [[x + 19, y0], [x + 19, y1]], { c: rgba('#000000', .55), w: 3 });
}
function tubeFront(g, x, y0, y1, lt = 0) {
  path(g, [[x - 19, y0], [x - 19, y1]], { c: rgba('#D8F3FA', .35), w: 2 }); path(g, [[x + 19, y0], [x + 19, y1]], { c: rgba('#D8F3FA', .2), w: 2 });
  g.save(); g.fillStyle = rgba('#ffffff', .1); g.fillRect(x - 13, y0, 6, y1 - y0); g.restore();
  // 一道光沿管子缓慢下扫
  const sy = y0 + ((lt * 90 + x * .7) % (y1 - y0 + 300)) - 150;
  g.save(); g.beginPath(); g.rect(x - 19, y0, 38, y1 - y0); g.clip();
  const gr = g.createLinearGradient(0, sy - 60, 0, sy + 60); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(x - 19, sy - 60, 38, 120); g.restore();
  for (let yy = y0 + 70; yy < y1 - 20; yy += 130) plate(g, x - 23, yy, 46, 10, { fill: C.steelD, r: 2, rivets: false, shadow: false, lw: 1.5 });
}
/* 胶囊：state 'go'（在途，牛皮色带）/'ok'/'fail' */
function capsule(g, x, y, o = {}) {
  const st = o.state || 'go', band = st === 'ok' ? C.green : st === 'fail' ? C.red : C.kraft;
  at(g, x, y, o.s ?? 1, () => {
    if (o.glow) { g.save(); g.shadowColor = band; g.shadowBlur = 26 * SH() * o.glow; rr(g, -CAP_W / 2, -CAP_H / 2, CAP_W, CAP_H, 13); g.fillStyle = band; g.fill(); g.restore(); }
    rr(g, -CAP_W / 2, -CAP_H / 2, CAP_W, CAP_H, 13);
    const lg = g.createLinearGradient(-CAP_W / 2, 0, CAP_W / 2, 0); lg.addColorStop(0, C.steelD); lg.addColorStop(.35, C.steelX); lg.addColorStop(1, C.steelD);
    g.fillStyle = lg; g.fill(); g.lineWidth = 2.2; g.strokeStyle = C.ink; g.stroke();
    g.fillStyle = band; g.fillRect(-CAP_W / 2 + 1, -9, CAP_W - 2, 18); path(g, [[-CAP_W / 2, -9], [CAP_W / 2, -9]], { c: C.ink, w: 1.6 }); path(g, [[-CAP_W / 2, 9], [CAP_W / 2, 9]], { c: C.ink, w: 1.6 });
    if (st === 'ok') icCheck(g, 0, 0, 13, '#fff', 1, 3); else if (st === 'fail') icCross(g, 0, 0, 13, '#fff', 1, 3);
    path(g, [[-CAP_W / 2 + 5, -CAP_H / 2 + 10], [-CAP_W / 2 + 5, CAP_H / 2 - 10]], { c: rgba('#ffffff', .5), w: 2.5 });
  }, { al: o.al, sx: o.sx, sy: o.sy, rot: o.rot });
}
/* 挂架（multi 句柄）：一根横梁 + n 个接口环 */
function manifold(g, xs, y, lt, o = {}) {
  const xa = xs[0] - 50, xb = xs[xs.length - 1] + 50;
  plate(g, xa, y - 16, xb - xa, 32, { fill: C.steelD, r: 6, sb: 14, so: 6 });
  for (const x of xs) { plate(g, x - 24, y - 26, 48, 18, { fill: C.steel, r: 4, rivets: false, shadow: false, lw: 2 }); }
  for (let x = xa + 20; x < xb - 10; x += 34) rivet(g, x, y + 4, 3.5);
  if (o.label) sign(g, o.label, o.lx ?? xa - 10, o.ly ?? y + 4, { s: 24, fill: C.ink2, bar: C.cyan, al: o.lal });
}
/* 云端接口：顶部的风管式库房 */
function cloudDuct(g, x0, x1, y, lt, o = {}) {
  plate(g, x0, y - 34, x1 - x0, 68, { fill: C.steelD, r: 10, sb: 26, so: 10 });
  for (let x = x0 + 40; x < x1 - 30; x += 46) path(g, [[x, y - 26], [x, y + 26]], { c: rgba('#000000', .25), w: 3 });
  text(g, o.label || '云端 HTTP 接口', (x0 + x1) / 2, y + 1, { s: 26, w: 900, emboss: true });
  for (let i = 0; i < 3; i++) lampDot(g, x1 - 30 - i * 24, y - 18, 5, C.cyan, hash(Math.floor(lt * 4) + i * 13) > .4 ? 1 : .2);
  // 天线
  path(g, [[x0 + 50, y - 34], [x0 + 50, y - 50]], { c: C.steel, w: 4 }); lampDot(g, x0 + 50, y - 54, 5, C.red, .5 + .5 * Math.sin(lt * 3));
}

/* ---------------- 仪表 ---------------- */
function gauge(g, x, y, r, v, o = {}) {
  at(g, x, y, o.k ?? 1, () => {
    dot(g, 0, 4, r + 10, rgba('#000000', .35));
    dot(g, 0, 0, r + 8, C.steelD); ring(g, 0, 0, r + 8, C.ink, 2.5); dot(g, 0, 0, r, C.paper); ring(g, 0, 0, r, C.ink, 2);
    const a0 = Math.PI * .75, a1 = Math.PI * 2.25;
    if (o.red != null) ring(g, 0, 0, r - 8, rgba(C.red, .85), 7, 1, lerp(a0, a1, o.red), a1);
    for (let i = 0; i <= 10; i++) { const a = lerp(a0, a1, i / 10), r0 = i % 5 ? r - 9 : r - 15; path(g, [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * (r - 3), Math.sin(a) * (r - 3)]], { c: C.ink, w: i % 5 ? 1.5 : 2.5 }); }
    const a = lerp(a0, a1, clamp(v));
    g.save(); shadow(g, .3, 4, 2); path(g, [[-Math.cos(a) * 8, -Math.sin(a) * 8], [Math.cos(a) * (r - 10), Math.sin(a) * (r - 10)]], { c: C.red, w: 3.5 }); g.restore();
    dot(g, 0, 0, 6, C.ink); dot(g, 0, 0, 3, C.steelL);
    if (o.read) text(g, o.read, 0, r * .6, { f: 'mono', s: Math.max(24, r * .3), w: 700, c: C.ink });
    // 玻璃反光
    g.save(); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip(); const gr = g.createLinearGradient(-r, -r, r, r); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(.4, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore();
  });
  if (o.label) text(g, o.label, x, y + r + 34, { s: 24, w: 900, c: C.cream, emboss: true });
}

/* ---------------- 机械臂（worker 线程） ---------------- */
function ik(sx, sy, tx, ty, L1, L2) {
  const flip = tx < sx ? -1 : 1, dx = tx - sx, dy = ty - sy, d = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 2, L1 + L2 - 2);
  const a = Math.atan2(dy, dx), b = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const e = a - flip * b, ex = sx + Math.cos(e) * L1, ey = sy + Math.sin(e) * L1, a2 = Math.atan2(ty - ey, tx - ex);
  return { ex, ey, wx: ex + Math.cos(a2) * L2, wy: ey + Math.sin(a2) * L2, a2 };
}
function rod(g, a, b, wd, c) {
  path(g, [a, b], { c: C.ink, w: wd + 6 }); path(g, [a, b], { c, w: wd });
  const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ox = -(b[1] - a[1]) / n * wd * .25, oy = (b[0] - a[0]) / n * wd * .25;
  path(g, [[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy]], { c: rgba('#ffffff', .22), w: wd * .22 });
}
/* bx,by：底座落地点；tgt：[x,y] 手爪目标；o.state 'run'|'wait'|'sleep'；o.grip∈[0,1] 张开度 */
function robot(g, bx, by, tgt, lt, o = {}) {
  const L1 = o.L1 || 190, L2 = o.L2 || 165, sx = bx, sy = by - 150;
  floorShadow(g, bx, 220, .45);
  // 底座与立柱
  plate(g, bx - 80, by - 18, 160, 18, { fill: C.steelD, r: 3, rivets: false, sb: 10, so: 4 });
  hazard(g, bx - 62, by - 40, 124, 22, { s: 14 });
  g.save(); const cg = g.createLinearGradient(bx - 46, 0, bx + 46, 0); cg.addColorStop(0, C.paintD); cg.addColorStop(.4, C.paintL); cg.addColorStop(1, C.paintD);
  rr(g, bx - 46, by - 138, 92, 100, 8); g.fillStyle = cg; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke(); g.restore();
  plate(g, bx - 58, by - 158, 116, 24, { fill: C.steel, r: 8, rivets: false, sb: 8, so: 3 });
  plate(g, bx - 34, by - 74, 68, 22, { fill: C.ink2, r: 4, rivets: false, shadow: false, lw: 1.5 });
  const st = o.state || 'run', lc = st === 'run' ? C.green : st === 'wait' ? C.yellow : C.cyan;
  lampDot(g, bx, by - 96, 10, lc, st === 'sleep' ? .25 + .3 * (.5 + .5 * Math.sin(lt * 2.2)) : 1);
  const k = ik(sx, sy, tgt[0], tgt[1], L1, L2);
  // 管线
  g.save(); g.beginPath(); g.moveTo(bx + 30, by - 140); g.quadraticCurveTo(k.ex + 60, k.ey + 40, k.ex + 10, k.ey + 14); g.lineWidth = 6; g.strokeStyle = C.ink2; g.stroke(); g.restore();
  rod(g, [sx, sy], [k.ex, k.ey], 30, C.yellow);
  rod(g, [k.ex, k.ey], [k.wx, k.wy], 24, C.yellow);
  for (const [jx, jy, r] of [[sx, sy, 24], [k.ex, k.ey, 20]]) { dot(g, jx, jy, r, C.steelD); ring(g, jx, jy, r, C.ink, 2.5); dot(g, jx, jy, r * .4, C.steelL); ring(g, jx, jy, r * .4, C.ink, 1.5); }
  // 手爪
  const grip = o.grip ?? .4, a = k.a2;
  g.save(); g.translate(k.wx, k.wy); g.rotate(a);
  plate(g, -6, -18, 26, 36, { fill: C.steelD, r: 5, rivets: false, shadow: false });
  for (const sgn of [-1, 1]) { g.save(); g.translate(18, sgn * 12); g.rotate(sgn * (.15 + grip * .5)); rr(g, 0, -5, 34, 10, 4); g.fillStyle = C.steel; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); g.restore(); }
  g.restore();
  if (o.label) sign(g, o.label, bx - 150, by - 230, { f: o.label === 'worker' ? 'mono' : 'cjk', s: 24, w: 700, fill: C.ink2, bar: C.yellow, rivets: false });
  return k;
}

/* ---------------- 工作台、控制柜、闸门、吊车、扫码门、拒收箱 ---------------- */
function bench(g, x0, x1, y, o = {}) { // 台面高 y
  floorShadow(g, (x0 + x1) / 2, x1 - x0 + 40, .45);
  for (const lx of [x0 + 26, x1 - 26]) { g.fillStyle = C.steelD; g.fillRect(lx - 10, y + 20, 20, FLOOR - y - 20); path(g, [[lx - 10, y + 20], [lx - 10, FLOOR]], { c: C.ink, w: 2 }); path(g, [[lx + 10, y + 20], [lx + 10, FLOOR]], { c: C.ink, w: 2 }); }
  path(g, [[x0 + 36, FLOOR - 60], [x1 - 36, FLOOR - 60]], { c: C.steelD, w: 8 });
  plate(g, x0, y, x1 - x0, 24, { fill: o.fill || C.paint, r: 4, rivets: false, sb: 18, so: 8 });
  hazard(g, x0 + 10, y + 24, x1 - x0 - 20, 10, { s: 10, lw: 1.5 });
}
/* 控制柜：带屏幕的钢柜，fn(g, sx, sy, sw, sh) 在屏幕内作画 */
function cabinet(g, x, y, w, h, lt, fn, o = {}) {
  floorShadow(g, x + w / 2, w + 60, .5);
  plate(g, x, y, w, h, { fill: o.fill || C.paintD, r: 10, sb: 30, so: 12 });
  const m = 22, sw = w - m * 2, sh = o.sh || h * .55;
  rr(g, x + m - 4, y + m - 4, sw + 8, sh + 8, 10); g.fillStyle = C.ink; g.fill();
  g.save(); rr(g, x + m, y + m, sw, sh, 8); g.clip();
  const sg = g.createLinearGradient(0, y + m, 0, y + m + sh); sg.addColorStop(0, '#0F2A2C'); sg.addColorStop(1, '#0A1B1D'); g.fillStyle = sg; g.fillRect(x + m, y + m, sw, sh);
  for (let yy = y + m; yy < y + m + sh; yy += 4) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + m, yy, sw, 1.5); }
  fn(g, x + m, y + m, sw, sh);
  const gr = g.createLinearGradient(x + m, y + m, x + m + sw, y + m + sh); gr.addColorStop(0, 'rgba(255,255,255,.08)'); gr.addColorStop(.3, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + m, y + m, sw, sh);
  g.restore();
  // 按钮与指示灯
  const by = y + m + sh + 40;
  for (let i = 0; i < 3; i++) lampDot(g, x + m + 20 + i * 36, by, 9, [C.green, C.yellow, C.red][i], i === 0 ? 1 : hash(Math.floor(lt * 2) + i) > .7 ? 1 : .2);
  for (let yy = by + 40; yy < y + h - 20; yy += 14) path(g, [[x + m, yy], [x + w - m, yy]], { c: rgba('#000000', .3), w: 4 });
  if (o.legs !== false) { g.fillStyle = C.ink2; g.fillRect(x + 12, y + h, 18, FLOOR - y - h); g.fillRect(x + w - 30, y + h, 18, FLOOR - y - h); }
}
/* 屏幕上的发光文字 */
function scrText(g, s, x, y, o = {}) { text(g, s, x, y, { f: o.f || 'cjk', s: o.s || 26, w: o.w || 700, a: o.a || 'left', c: o.c || '#9FF5D0', glow: rgba(o.c || '#9FF5D0', .6), gb: 10, al: o.al }); }
/* 闸门：门架 + 落下的警示闸板；down∈[0,1]；beltY 为带面 */
function gate(g, x, beltY, down, lt, o = {}) {
  const top = beltY - (o.h || 250), pw = 26, span = o.span || 170;
  // 后柱
  plate(g, x - span / 2 - pw, top, pw, (o.base ?? FLOOR) - top, { fill: C.steelD, r: 4, rivets: false, sb: 16, so: 6 });
  // 闸板
  const bh = Math.min(150, beltY - top - 40), by = lerp(top + 26 - bh, beltY - bh - 12, down) + (o.bounce || 0);
  g.save(); rr(g, x - span / 2, top + 26, span, beltY - top - 30, 0); g.clip();
  hazard(g, x - span / 2 + 6, by, span - 12, bh, { s: 24, off: 0 });
  plate(g, x - span / 2 + 6, by + bh - 16, span - 12, 16, { fill: C.steelD, r: 2, rivets: false, shadow: false });
  g.restore();
  // 前柱与横梁
  plate(g, x + span / 2, top, pw, (o.base ?? FLOOR) - top, { fill: C.steelD, r: 4, rivets: false, sb: 16, so: 6 });
  hazard(g, x + span / 2, (o.base ?? FLOOR) - 120, pw, 100, { s: 12, lw: 2 });
  plate(g, x - span / 2 - pw - 10, top - 36, span + pw * 2 + 20, 40, { fill: C.steel, r: 6, sb: 18, so: 6 });
  beacon(g, x + span / 2 + pw / 2, top - 36, lt, o.alarm ?? (down > .5 ? 1 : 0), C.orange, 1);
  if (o.label) sign(g, o.label, x - 10, top - 16, { s: 24, fill: C.ink2, bar: C.yellow, rivets: false, pad: 36, ph: 14, k: .95 });
}
/* 吊车：顶部工字梁 + 小车 + 钢缆 + 吊钩；返回吊钩下端坐标 */
const RAIL_Y = 150;
function crane(g, x0, x1, tx, hookY, lt, o = {}) {
  plate(g, x0, RAIL_Y - 16, x1 - x0, 22, { fill: C.steelD, r: 3, rivets: false, sb: 14, so: 6 });
  for (let x = x0 + 30; x < x1; x += 60) path(g, [[x, RAIL_Y - 12], [x + 30, RAIL_Y + 2]], { c: rgba('#000000', .25), w: 3 });
  plate(g, tx - 46, RAIL_Y + 4, 92, 34, { fill: C.yellow, r: 5, sb: 12, so: 5 });
  for (const wx of [tx - 26, tx + 26]) { dot(g, wx, RAIL_Y + 2, 10, C.steelD); ring(g, wx, RAIL_Y + 2, 10, C.ink, 2); }
  const swing = o.swing || 0, hx = tx + swing;
  path(g, [[tx - 6, RAIL_Y + 38], [hx - 6, hookY - 30]], { c: C.ink, w: 3 }); path(g, [[tx + 6, RAIL_Y + 38], [hx + 6, hookY - 30]], { c: C.ink, w: 3 });
  plate(g, hx - 20, hookY - 34, 40, 22, { fill: C.steel, r: 4, rivets: false, shadow: false });
  g.save(); g.lineWidth = 7; g.strokeStyle = C.steelL; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx, hookY - 12); g.lineTo(hx, hookY); g.arc(hx + 12, hookY, 12, Math.PI, Math.PI * .1, true); g.stroke();
  g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); g.restore();
  return [hx, hookY + 12];
}
/* 扫码门 */
function scanner(g, x, beltY, lt, o = {}) {
  const top = beltY - 210;
  plate(g, x - 70, top, 22, FLOOR - top, { fill: C.paintD, r: 4, rivets: false });
  plate(g, x + 48, top, 22, FLOOR - top, { fill: C.paintD, r: 4, rivets: false });
  plate(g, x - 80, top - 30, 160, 38, { fill: C.paint, r: 6 });
  const on = o.flash || 0, sc = on > 0 ? (o.flashC || C.red) : C.cyan;
  g.save(); g.globalAlpha *= .22 + .5 * on; g.fillStyle = sc; g.fillRect(x - 48, top + 8, 96, beltY - top - 18); g.restore();
  const ly = top + 20 + ((lt * 120) % (beltY - top - 40));
  path(g, [[x - 48, ly], [x + 48, ly]], { c: rgba(sc, .9), w: 3 });
  lampDot(g, x, top - 11, 8, sc, 1);
  if (o.label) text(g, o.label, x, top - 58, { s: 24, w: 900, emboss: true });
}
/* 拒收箱：铁丝网笼 + 红牌 */
function rejectBin(g, x, y, lt, o = {}) { // y 为箱底（通常 FLOOR）
  const w = o.w || 170, h = o.h || 130;
  floorShadow(g, x, w + 40, .5);
  g.save(); rr(g, x - w / 2, y - h, w, h, 6); g.fillStyle = rgba('#000000', .35); g.fill(); g.clip();
  g.strokeStyle = rgba(C.steelL, .55); g.lineWidth = 2;
  for (let i = -h; i < w + h; i += 22) { g.beginPath(); g.moveTo(x - w / 2 + i, y - h); g.lineTo(x - w / 2 + i + h, y); g.stroke(); g.beginPath(); g.moveTo(x - w / 2 + i + h, y - h); g.lineTo(x - w / 2 + i, y); g.stroke(); }
  g.restore();
  rr(g, x - w / 2, y - h, w, h, 6); g.lineWidth = 5; g.strokeStyle = C.steelD; g.stroke(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
  sign(g, o.label || '拒收', x, y - h + 34, { s: 26, fill: C.redD, c: '#fff', rivets: false, pad: 34, ph: 14 });
}

/* ---------------- 标记：橡皮章、时间签、碎屑、尘团、火花 ---------------- */
function stamp(g, s, x, y, p, o = {}) {
  if (p <= 0) return;
  const k = eo(clamp(p / .35)), c = o.c || C.red, fs = o.s || 34;
  const w = textW(g, s, { s: fs, w: 900 }) + 34, h = fs + 22;
  at(g, x, y, lerp(1.9, 1, k), () => {
    g.globalAlpha *= clamp(k * 1.4) * (o.al ?? .92);
    rr(g, -w / 2, -h / 2, w, h, 8); g.lineWidth = 4.5; g.strokeStyle = c; g.stroke();
    rr(g, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 5); g.lineWidth = 1.8; g.stroke();
    text(g, s, 0, 2, { s: fs, w: 900, c });
  }, { rot: o.rot ?? -.12 });
}
function timeTag(g, s, x, y, lt, p = 1, o = {}) { // 挂签：绳 + 纸签，轻轻摆动
  if (p <= 0) return;
  const sw = wob(lt, .6, .07) * (1 - (o.still || 0));
  at(g, x, y, pop(p), () => {
    path(g, [[0, 0], [0, 26]], { c: C.ink, w: 2 });
    const w = textW(g, s, { f: 'mono', s: 26, w: 700 }) + 30;
    g.save(); g.translate(0, 26);
    poly(g, [[-w / 2 + 10, 0], [w / 2 - 10, 0], [w / 2, 12], [w / 2, 48], [-w / 2, 48], [-w / 2, 12]], o.fill || C.yellow);
    dot(g, 0, 10, 4, C.ink);
    text(g, s, 0, 31, { f: 'mono', s: 26, w: 700, c: C.ink });
    g.restore();
  }, { rot: sw });
}
/* 碎屑：k = 开始后的秒数；颜色 c（释放时化成碎纸片） */
function crumble(g, x, y, k, c, n = 16, r = 90, seed = 0) {
  if (k < 0 || k > 1) return;
  for (let i = 0; i < n; i++) {
    const h1 = hash(i * 3.1 + seed), h2 = hash(i * 7.7 + seed), ang = -Math.PI / 2 + (h1 - .5) * 2.6, sp = r * (.5 + h2 * .8), e = eo(k);
    const px = x + Math.cos(ang) * sp * e, py = y + Math.sin(ang) * sp * e + 160 * k * k;
    g.save(); g.translate(px, py); g.rotate(k * 8 * (h1 - .5)); g.globalAlpha *= 1 - k;
    g.fillStyle = i % 3 ? c : C.cream; g.fillRect(-4, -3, 8 + h2 * 6, 6); g.restore();
  }
}
function puff(g, x, y, k, w = 60) { // 落地尘团
  if (k < 0 || k > .8) return;
  for (let i = 0; i < 7; i++) { const s = i / 6 - .5, e = eo(k / .8); dot(g, x + s * w * (1 + e * 1.4), y - 6 - e * 14 * (1 - Math.abs(s)), (10 + 10 * e) * (1 - Math.abs(s) * .6), rgba('#C9C0AE', .35 * (1 - k / .8))); }
}
function sparks(g, x, y, k, n = 14, seed = 0, c = '#FFB547') { // 火花
  if (k < 0 || k > .7) return;
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const h1 = hash(i * 5.3 + seed), h2 = hash(i * 2.9 + seed * 3), ang = -Math.PI * (h1), sp = 120 + h2 * 200, kk = k / .7;
    const px = x + Math.cos(ang) * sp * kk, py = y + Math.sin(ang) * sp * kk + 300 * kk * kk;
    const qx = x + Math.cos(ang) * sp * Math.max(0, kk - .06), qy = y + Math.sin(ang) * sp * Math.max(0, kk - .06) + 300 * Math.max(0, kk - .06) ** 2;
    path(g, [[qx, qy], [px, py]], { c: rgba(c, 1 - kk), w: 2.5 });
  }
  g.restore();
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

/* ---------------- 后墙、灯光、后期 ---------------- */
const LAMPS = [[620, 150], [1300, 150]];
function prepareStyle({ mk, cw, ch }) {
  const WW = W + 600, WH = H + 300, k = cw / W;
  // 后墙：渐变 + 波纹钢板竖棱 + 横向接缝铆钉 + 污渍
  const wall = mk(Math.round(WW * k), Math.round(WH * k)), p = wall.getContext('2d'); p.scale(k, k);
  const lg = p.createLinearGradient(0, 0, 0, WH); lg.addColorStop(0, C.wallD); lg.addColorStop(.45, C.wall); lg.addColorStop(1, C.wallD);
  p.fillStyle = lg; p.fillRect(0, 0, WW, WH);
  for (let x = 0; x < WW; x += 30) { p.fillStyle = 'rgba(255,255,255,.035)'; p.fillRect(x, 0, 6, WH); p.fillStyle = 'rgba(0,0,0,.12)'; p.fillRect(x + 18, 0, 5, WH); }
  for (const y of [300, 620]) { p.fillStyle = 'rgba(0,0,0,.3)'; p.fillRect(0, y, WW, 5); p.fillStyle = 'rgba(255,255,255,.05)'; p.fillRect(0, y + 5, WW, 2); for (let x = 15; x < WW; x += 60) { p.fillStyle = 'rgba(0,0,0,.35)'; p.beginPath(); p.arc(x, y - 8, 3, 0, TAU); p.fill(); } }
  // 高窗（冷光）
  for (let x = 180; x < WW - 200; x += 330) { p.fillStyle = 'rgba(120,170,190,.10)'; p.fillRect(x, 140, 230, 90); p.strokeStyle = 'rgba(0,0,0,.4)'; p.lineWidth = 6; p.strokeRect(x, 140, 230, 90); p.fillStyle = 'rgba(0,0,0,.35)'; p.fillRect(x + 113, 140, 5, 90); p.fillRect(x, 183, 230, 4); }
  for (let i = 0; i < 160; i++) { const x = hash(i * 3.7) * WW, y = hash(i * 9.2) * WH, r = 20 + hash(i * 1.3) * 120; const sg = p.createRadialGradient(x, y, 0, x, y, r); sg.addColorStop(0, `rgba(0,0,0,${.04 + hash(i) * .06})`); sg.addColorStop(1, 'rgba(0,0,0,0)'); p.fillStyle = sg; p.fillRect(x - r, y - r, 2 * r, 2 * r); }
  for (let i = 0; i < 12000; i++) { p.fillStyle = `rgba(255,255,255,${.012 + hash(i * 5.3) * .02})`; p.fillRect(hash(i * 1.17) * WW, hash(i * 2.31 + 9) * WH, 1.5, 1.5); }
  // 墙上的喷涂编号与安全标语（褪色）
  p.save(); p.globalAlpha = .055; p.fillStyle = C.yellow; p.font = `900 260px ${F.disp}`; p.textAlign = 'center'; p.textBaseline = 'middle'; p.fillText('A7', WW - 520, 470); p.restore();
  p.save(); p.globalAlpha = .1; for (let i = 0; i < 9; i++) { p.fillStyle = i % 2 ? '#111' : C.yellow; p.beginPath(); p.moveTo(380 + i * 60, 520); p.lineTo(410 + i * 60, 520); p.lineTo(440 + i * 60, 548); p.lineTo(410 + i * 60, 548); p.closePath(); p.fill(); } p.restore();
  // 水泥地纹理（平铺）
  const concrete = mk(256, 256), q = concrete.getContext('2d');
  for (let i = 0; i < 2600; i++) { const v = hash(i * 4.1) > .5 ? 255 : 0; q.fillStyle = `rgba(${v},${v},${v},${.03 + hash(i * 7.3) * .05})`; q.fillRect(hash(i * 1.9) * 256, hash(i * 3.3) * 256, 1 + hash(i) * 2.5, 1 + hash(i * 2) * 2.5); }
  // 暗角
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(k, k);
  const vg = v.createRadialGradient(960, 500, 380, 960, 540, 1250); vg.addColorStop(0, 'rgba(5,8,10,0)'); vg.addColorStop(1, 'rgba(5,8,10,.55)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  const grain = [];
  for (let n = 0; n < 4; n++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const c = Math.floor(hash(i * 1.37 + n * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = c; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt);
  }
  return { wall, concrete, vign, grain, WW, WH };
}
/* 后墙按镜头 0.25 视差平移；工矿灯 + 光锥 + 光里的尘埃 */
function drawBackground(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  const { cache, t, sc, lt } = frame, cam = sc && sc.cam ? camAt(sc.cam, lt) : [W / 2, H / 2, 1];
  const px = (cam[0] - W / 2) * .25, py = (cam[1] - H / 2) * .25, z = 1 + (cam[2] - 1) * .25;
  g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2 - px - 300, -H / 2 - py - 150);
  g.drawImage(cache.wall, 0, 0, cache.WW, cache.WH);
  g.restore();
  g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2 - px, -H / 2 - py);
  LAMPS.forEach(([x, y], i) => {
    const fl = .9 + .1 * Math.sin(t * 13 + i * 5) * (hash(Math.floor(t * 6) + i) > .93 ? 1 : 0), sw = wob(t, .11, 6, i * 2);
    // 光锥
    g.save(); g.globalCompositeOperation = 'lighter';
    const cg = g.createLinearGradient(0, y, 0, FLOOR + 60); cg.addColorStop(0, rgba(C.lamp, .16 * fl)); cg.addColorStop(1, rgba(C.lamp, 0));
    g.fillStyle = cg; g.beginPath(); g.moveTo(x + sw - 40, y + 30); g.lineTo(x + sw + 40, y + 30); g.lineTo(x + sw * 3 + 430, FLOOR + 60); g.lineTo(x + sw * 3 - 430, FLOOR + 60); g.closePath(); g.fill();
    const pg = g.createRadialGradient(x + sw * 3, FLOOR + 20, 0, x + sw * 3, FLOOR + 20, 480); pg.addColorStop(0, rgba(C.lamp, .10 * fl)); pg.addColorStop(1, rgba(C.lamp, 0));
    g.fillStyle = pg; g.fillRect(x - 600, FLOOR - 300, 1200, 700);
    // 光里的尘埃
    for (let j = 0; j < 26; j++) {
      const h1 = hash(j * 3.3 + i * 50), h2 = hash(j * 7.1 + i * 50), yy = y + 60 + ((h2 * 700 + t * (10 + h1 * 14)) % 700);
      const spread = (yy - y) / (FLOOR - y) * 400, xx = x + sw * 2 + (h1 - .5) * 2 * spread + Math.sin(t * .7 + j) * 12;
      dot(g, xx, yy, 1.4 + h2 * 1.8, rgba(C.lamp, .25 + .25 * Math.sin(t * 1.3 + j)));
    }
    g.restore();
    // 灯具
    path(g, [[x, -40], [x + sw, y - 14]], { c: C.ink, w: 3 });
    g.save(); g.translate(x + sw, y); g.rotate(sw * .004);
    g.beginPath(); g.moveTo(-14, -16); g.lineTo(14, -16); g.lineTo(54, 26); g.lineTo(-54, 26); g.closePath(); g.fillStyle = C.paintD; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
    g.save(); g.shadowColor = C.lamp; g.shadowBlur = 40 * SCX; g.beginPath(); g.ellipse(0, 27, 44, 8, 0, 0, TAU); g.fillStyle = rgba('#FFF1D0', fl); g.fill(); g.restore();
    g.restore();
  });
  g.restore();
}
function postFX(g, { cache, t, cw, ch }) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cache.vign, 0, 0);
  const fr = Math.floor(t * FPS), gp = g.createPattern(cache.grain[fr % 4], 'repeat');
  g.globalAlpha = .07; g.globalCompositeOperation = 'overlay';
  g.translate(Math.floor(hash(fr) * 256), Math.floor(hash(fr + 7) * 256)); g.scale(Math.max(1, SCX * .75), Math.max(1, SCX * .75));
  g.fillStyle = gp; g.fillRect(-512, -512, cw + 1024, ch + 1024);
  g.restore();
}

/* =====================================================================
 * 全片补充图元：代码屏、智能屏、手机、云端库房、推送管、工单、秤、时间条、门铃、秒表、锁、推车、数据柜、
 *              工牌、纸带、料斗、齿轮、挂钟、出票机、业务窗口
 * ===================================================================== */
const KW = new Set(['struct', 'bool', 'for', 'if', 'return', 'continue', 'NULL', 'false', 'true', 'void', 'while', 'int']);
const TY = new Set(['task', 'json_t', 'list_t', 'param_factory', 'pool']);
function codeTokens(line) { // 简单高亮：注释 / 关键字 / 类型 / 数字 / 其他
  const out = []; let i = 0;
  const ci = line.indexOf('/*');
  const body = ci >= 0 ? line.slice(0, ci) : line, cm = ci >= 0 ? line.slice(ci) : '';
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z_0-9]*|\d+|\s+|.)/g)) {
    const s = m[0]; out.push({ s, c: KW.has(s) ? '#FFC94A' : TY.has(s) ? '#6FD6FF' : /^\d+$/.test(s) ? '#FF9B5E' : '#E9F3EC' });
  }
  if (cm) out.push({ s: cm, c: '#7FA894' });
  return out;
}
/* 代码屏：p 为打字进度（0–1，按字符），hl 为高亮行（可为数组），title 为标题栏 */
function codePanel(g, x, y, w, lines, p, lt, o = {}) {
  const lh = o.lh || 40, fs = o.fs || 26, h = lines.length * lh + 92;
  plate(g, x - 16, y - 16, w + 32, h + 32, { fill: C.paintD, r: 12, sb: 34, so: 14 });
  rr(g, x - 4, y - 4, w + 8, h + 8, 10); g.fillStyle = C.ink; g.fill();
  g.save(); rr(g, x, y, w, h, 8); g.clip();
  const sg = g.createLinearGradient(0, y, 0, y + h); sg.addColorStop(0, '#0E2426'); sg.addColorStop(1, '#091718'); g.fillStyle = sg; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, y, w, 46);
  text(g, o.title || '示意代码 · 非源码', x + 20, y + 24, { s: 24, w: 700, a: 'left', c: '#9FC7B4' });
  for (const [i, c] of [C.red, C.yellow, C.green].entries()) dot(g, x + w - 26 - i * 24, y + 23, 7, c, .8);
  const total = lines.reduce((a, l) => a + l.length, 0); let left = Math.round(total * clamp(p)), cy = 0, cx = 0;
  const hls = [].concat(o.hl ?? []);
  lines.forEach((ln, li) => {
    const yy = y + 76 + li * lh;
    if (hls.includes(li)) { g.save(); g.fillStyle = rgba(o.hlC || C.yellow, .16 + .06 * Math.sin(lt * 5)); g.fillRect(x + 6, yy - lh / 2 + 2, w - 12, lh - 4); g.fillStyle = o.hlC || C.yellow; g.fillRect(x + 6, yy - lh / 2 + 2, 5, lh - 4); g.restore(); }
    let xx = x + 26;
    for (const tk of codeTokens(ln)) {
      if (left <= 0) break;
      const s = Array.from(tk.s).slice(0, left).join(''); left -= Array.from(tk.s).length;
      text(g, s, xx, yy, { f: 'mono', s: fs, w: 400, a: 'left', c: tk.c });
      xx += textW(g, s, { f: 'mono', s: fs, w: 400 });
      cx = xx; cy = yy;
    }
  });
  if (p < 1 || o.cursor) { if (Math.floor(lt * 2.4) % 2 === 0) { g.fillStyle = '#9FF5D0'; g.fillRect(cx + 2, cy - fs * .55, fs * .55, fs * 1.05); } }
  for (let yy = y; yy < y + h; yy += 4) { g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(x, yy, w, 1.5); }
  g.restore();
  return h;
}
/* 智能屏：壁挂面板，2×3 卡片；o.hi 高亮卡片下标，o.err 显示错误牌，o.glow 屏幕光 */
function smartScreen(g, x, y, s, lt, o = {}) {
  at(g, x, y, s, () => {
    plate(g, -200, -130, 400, 260, { fill: '#1B2023', r: 26, sb: 40, so: 16 });
    rr(g, -176, -108, 352, 216, 14); g.fillStyle = '#10171A'; g.fill();
    g.save(); rr(g, -176, -108, 352, 216, 14); g.clip();
    const bg = g.createLinearGradient(0, -108, 0, 108); bg.addColorStop(0, '#22343A'); bg.addColorStop(1, '#162328'); g.fillStyle = bg; g.fillRect(-176, -108, 352, 216);
    const cols = [C.cyan, C.yellow, C.green, C.orange, C.blue, C.red];
    for (let i = 0; i < 6; i++) {
      const cx = -112 + (i % 3) * 112, cy = -46 + Math.floor(i / 3) * 92, hi = o.hi === i;
      rr(g, cx - 48, cy - 38, 96, 76, 12); g.fillStyle = hi ? rgba(cols[i], .55) : 'rgba(255,255,255,.1)'; g.fill();
      dot(g, cx - 22, cy - 12, 10, cols[i], .9); rr(g, cx - 34, cy + 10, 60, 8, 4); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
    }
    if (o.err) { const k = pop(o.err); at(g, 0, 0, k, () => { plate(g, -150, -46, 300, 92, { fill: C.redD, r: 12, rivets: false }); text(g, o.errText || '超时', 0, 2, { s: 40, w: 900 }); }); }
    const sx = -400 + ((lt * 70) % 1000);
    const gr = g.createLinearGradient(sx, -108, sx + 160, 108); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-176, -108, 352, 216);
    g.restore();
    lampDot(g, 0, 116, 4, C.green, .6 + .4 * Math.sin(lt * 2));
  }, { al: o.al });
  if (o.label) sign(g, o.label, x, y + 160 * s, { s: 24, fill: C.ink2, bar: C.cyan });
}
/* 手机：2×3 卡片；drag = {from, to, p} 把一张卡片拖到另一格 */
function phone(g, x, y, s, lt, o = {}) {
  const pos = i => [-56 + (i % 2) * 112, -110 + Math.floor(i / 2) * 104];
  at(g, x, y, s, () => {
    plate(g, -110, -220, 220, 440, { fill: '#1C2124', r: 34, sb: 40, so: 16, rivets: false });
    rr(g, -96, -200, 192, 400, 22); g.fillStyle = '#1F2F34'; g.fill();
    rr(g, -30, -192, 60, 10, 5); g.fillStyle = '#0B0F11'; g.fill();
    const cols = [C.cyan, C.yellow, C.green, C.orange, C.blue, C.red];
    const d = o.drag, k = d ? eio(d.p) : 0;
    for (let i = 0; i < 6; i++) {
      if (d && i === d.from) continue;
      let [cx, cy] = pos(i);
      if (d && i === d.to) cx += 0 * k;
      rr(g, cx - 48, cy - 44, 96, 88, 14); g.fillStyle = 'rgba(255,255,255,.12)'; g.fill(); dot(g, cx - 20, cy - 14, 11, cols[i], .9);
    }
    if (d) {
      const a = pos(d.from), b = pos(d.to), cx = lerp(a[0], b[0], k), cy = lerp(a[1], b[1], k) - Math.sin(k * Math.PI) * 30, lift = Math.sin(clamp(d.p * 1.2) * Math.PI) * .12;
      at(g, cx, cy, 1 + lift, () => { g.save(); shadow(g, .5, 20, 8); rr(g, -48, -44, 96, 88, 14); g.fillStyle = rgba(cols[d.from], .7); g.fill(); g.restore(); dot(g, -20, -14, 11, '#fff', .9); });
      if (d.p > 0 && d.p < 1.05) { dot(g, cx + 20, cy + 26, 22, rgba('#ffffff', .35)); ring(g, cx + 20, cy + 26, 22, rgba('#ffffff', .7), 3); }
    }
  }, { al: o.al });
  if (o.label) sign(g, o.label, x, y + 250 * s, { s: 24, fill: C.ink2, bar: C.cyan });
}
/* 云端库房：屋顶 + 卷帘口 + 天线 */
function cloudHouse(g, x, y, s, lt, o = {}) {
  at(g, x, y, s, () => {
    floorShadow(g, 0, 0, 0);
    poly(g, [[-190, -90], [0, -190], [190, -90]], C.steelD, { lw: 3 });
    plate(g, -170, -92, 340, 200, { fill: '#3A4A50', r: 6, sb: 34, so: 14 });
    for (let yy = -40; yy < 100; yy += 18) path(g, [[-90, yy], [90, yy]], { c: rgba('#000000', .3), w: 3 });
    plate(g, -96, -52, 192, 160, { fill: C.steel, r: 4, rivets: false, shadow: false });
    for (let yy = -40; yy < 100; yy += 16) path(g, [[-90, yy], [90, yy]], { c: rgba('#000000', .22), w: 3 });
    sign(g, o.label || '云端', 0, -128, { s: 26, fill: C.ink2, bar: C.cyan, rivets: false });
    path(g, [[120, -120], [120, -200]], { c: C.steel, w: 5 });
    for (let k = 0; k < 3; k++) { const ph = (lt * .8 + k / 3) % 1; ring(g, 120, -204, 10 + ph * 50, C.cyan, 3, (1 - ph) * .5, -Math.PI * .9, -Math.PI * .1); }
    lampDot(g, 120, -204, 6, C.red, .5 + .5 * Math.sin(lt * 3));
  }, { al: o.al });
}
/* 推送管：沿折线的粗管，collar∈[0,1] 处有“≤ 4KB”卡口 */
function pushPipe(g, pts, lt, o = {}) {
  const wd = o.w || 34;
  path(g, pts, { c: C.ink, w: wd + 6 }); path(g, pts, { c: C.steelD, w: wd }); path(g, pts, { c: rgba('#ffffff', .14), w: wd * .25 });
  const L = partial(pts, 1); let tot = 0; for (let i = 1; i < L.length; i++) tot += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]);
  for (let d = 60; d < tot; d += 160) { const q = partial(pts, d / tot), p2 = q[q.length - 1], p1 = q[Math.max(0, q.length - 2)], an = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]); g.save(); g.translate(p2[0], p2[1]); g.rotate(an); plate(g, -7, -wd * .64, 14, wd * 1.28, { fill: C.steel, r: 3, rivets: false, shadow: false, lw: 2 }); g.restore(); }
  if (o.collar != null) {
    const q = partial(pts, o.collar), c = q[q.length - 1], hot = o.hot || 0;
    dot(g, c[0], c[1], wd * .95, hot > 0 ? mixHex(C.yellow, C.red, hot) : C.yellow); ring(g, c[0], c[1], wd * .95, C.ink, 3);
    if (hot > 0) { g.save(); g.shadowColor = C.red; g.shadowBlur = 30 * SH() * hot; ring(g, c[0], c[1], wd * .95, C.red, 4, hot); g.restore(); }
    sign(g, '≤ 4KB', c[0] + (o.lx ?? 0), c[1] + (o.ly ?? -62), { f: 'mono', s: 26, fill: C.ink2, bar: C.yellow, rivets: false });
  }
}
/* 工单：带折角的纸条 */
function slip(g, x, y, s, o = {}) {
  const w = textW(g, s, { s: 24, w: 900 }) + 40, h = 46;
  at(g, x, y, o.k ?? 1, () => {
    g.save(); shadow(g, .35, 12, 5); poly(g, [[-w / 2, -h / 2], [w / 2 - 12, -h / 2], [w / 2, -h / 2 + 12], [w / 2, h / 2], [-w / 2, h / 2]], C.paper, { lw: 2 }); g.restore();
    poly(g, [[w / 2 - 12, -h / 2], [w / 2 - 12, -h / 2 + 12], [w / 2, -h / 2 + 12]], '#D8CFBD', { lw: 1.5 });
    g.fillStyle = o.c || C.cyan; g.fillRect(-w / 2 + 2, -h / 2 + 2, 7, h - 4);
    text(g, s, 4, 1, { s: 24, w: 900, c: C.ink });
  }, { al: o.al, rot: o.rot });
}
/* 地秤：平台 + 数显 */
function scaleMeter(g, x, y, read, o = {}) { // y 为台面
  plate(g, x - 150, y, 300, 22, { fill: C.steelD, r: 4, rivets: false, sb: 14, so: 6 });
  hazard(g, x - 150, y + 22, 300, 10, { s: 10, lw: 1.5 });
  plate(g, x + 160, y - 70, 190, 84, { fill: C.ink2, r: 8 });
  rr(g, x + 172, y - 58, 166, 60, 6); g.fillStyle = '#0B1310'; g.fill();
  text(g, read, x + 330, y - 27, { f: 'mono', s: 34, w: 700, a: 'right', c: o.c || '#7CFFB2', glow: rgba(o.c || '#7CFFB2', .6), gb: 10 });
  if (o.label) text(g, o.label, x + 255, y + 40, { s: 24, w: 700, c: C.dim });
}
/* 时间条：segs [{w, c, label}]；p 为生长进度（按总长） */
function timeBar(g, x, y, segs, p = 1, o = {}) {
  const tot = segs.reduce((a, b) => a + b.w, 0); let left = tot * clamp(p), xx = x;
  rr(g, x - 6, y - 22, (o.maxW || tot) + 12, 44, 10); g.fillStyle = 'rgba(0,0,0,.35)'; g.fill();
  for (const sg of segs) {
    if (left <= 0) break; const w = Math.min(sg.w, left); left -= w;
    rr(g, xx, y - 16, Math.max(0, w - 4), 32, 6); g.fillStyle = sg.c || C.kraft; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    if (sg.label && w > 40) text(g, sg.label, xx + w / 2 - 2, y + 1, { s: 24, w: 900, c: C.ink });
    xx += w;
  }
  return xx;
}
/* 门铃：钟罩 + 小锤；ring = 敲响后的秒数（<0 不响） */
function doorBell(g, x, y, s, ring2) {
  const k = ring2 >= 0 && ring2 < 1.4 ? Math.sin(ring2 * 38) * .25 * (1 - ring2 / 1.4) : 0;
  at(g, x, y, s, () => {
    plate(g, -16, -70, 32, 40, { fill: C.steelD, r: 4, rivets: false });
    g.save(); g.rotate(k);
    g.beginPath(); g.moveTo(-46, 30); g.quadraticCurveTo(-46, -34, 0, -38); g.quadraticCurveTo(46, -34, 46, 30); g.lineTo(54, 40); g.lineTo(-54, 40); g.closePath();
    const bg = g.createLinearGradient(-50, 0, 50, 0); bg.addColorStop(0, C.yellowD); bg.addColorStop(.4, '#FFE08A'); bg.addColorStop(1, C.yellowD); g.fillStyle = bg; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    g.restore();
    dot(g, Math.sin(k * 2) * 14, 48, 9, C.ink);
    if (ring2 >= 0 && ring2 < 1.4) for (let j = 0; j < 3; j++) { const ph = (ring2 * 1.6 + j / 3) % 1; ring(g, 0, 0, 60 + ph * 70, C.yellow, 4, (1 - ph) * .6 * (1 - ring2 / 1.4), -Math.PI * .85, -Math.PI * .15); }
  });
}
function stopwatch(g, x, y, r, a, o = {}) {
  at(g, x, y, o.k ?? 1, () => {
    plate(g, -10, -r - 22, 20, 16, { fill: C.steel, r: 3, rivets: false, shadow: false });
    dot(g, 0, 0, r + 8, C.steelD); ring(g, 0, 0, r + 8, C.ink, 2.5); dot(g, 0, 0, r, C.paper);
    for (let i = 0; i < 12; i++) { const aa = i / 12 * TAU; path(g, [[Math.cos(aa) * (r - 10), Math.sin(aa) * (r - 10)], [Math.cos(aa) * (r - 3), Math.sin(aa) * (r - 3)]], { c: C.ink, w: 2 }); }
    if (o.sweep) { g.save(); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r - 4, -TAU / 4, -TAU / 4 + a); g.closePath(); g.fillStyle = rgba(o.c || C.yellow, .45); g.fill(); g.restore(); }
    path(g, [[0, 0], [Math.cos(a - TAU / 4) * (r - 8), Math.sin(a - TAU / 4) * (r - 8)]], { c: C.red, w: 3.5 });
    dot(g, 0, 0, 5, C.ink);
  }, { al: o.al });
}
function padlock(g, x, y, s, c = C.yellow, open = 0) {
  at(g, x, y, s, () => {
    g.save(); g.translate(0, -open * 12); g.beginPath(); g.arc(0, -14, 18, Math.PI, 0); g.lineWidth = 8; g.strokeStyle = C.steelL; g.stroke(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); g.restore();
    plate(g, -26, -14, 52, 44, { fill: c, r: 7, rivets: false, sb: 8, so: 3 });
    dot(g, 0, 4, 6, C.ink); g.fillStyle = C.ink; g.fillRect(-2.5, 4, 5, 12);
  });
}
/* 推车（另一个线程） */
function cart(g, x, y, lt, o = {}) { // y 为地面
  const roll = (o.v || 0) * lt;
  plate(g, x - 90, y - 92, 180, 52, { fill: o.fill || C.blue, r: 6, sb: 16, so: 6 });
  path(g, [[x + 90, y - 92], [x + 120, y - 160]], { c: C.steel, w: 7 }); path(g, [[x + 108, y - 160], [x + 132, y - 160]], { c: C.steel, w: 9 });
  for (const wx of [x - 60, x + 60]) { dot(g, wx, y - 22, 20, C.ink2); ring(g, wx, y - 22, 20, C.ink, 2.5); path(g, [[wx, y - 22], [wx + Math.cos(roll / 20) * 14, y - 22 + Math.sin(roll / 20) * 14]], { c: C.steelL, w: 3 }); }
  plate(g, x - 76, y - 40, 152, 10, { fill: C.steelD, r: 2, rivets: false, shadow: false });
  if (o.label) text(g, o.label, x, y - 66, { s: 24, w: 900, emboss: true });
}
/* 共享数据柜：三层抽屉，open[i]∈[0,1] */
function dataCabinet(g, x, y, lt, o = {}) { // y 为地面
  const w = 260, h = 360, top = y - h;
  floorShadow(g, x, w + 60, .5);
  plate(g, x - w / 2, top, w, h, { fill: '#45555B', r: 10, sb: 34, so: 14 });
  sign(g, o.title || '共享数据', x, top - 34, { s: 24, fill: C.ink2, bar: C.cyan, rivets: false });
  (o.labels || ['布局', '设备', '场景']).forEach((lb, i) => {
    const dy = top + 26 + i * 108, op = (o.open && o.open[i]) || 0;
    plate(g, x - w / 2 + 18 + op * 70, dy, w - 36, 92, { fill: o.hot === i ? C.steel : C.steelD, r: 6, rivets: false, sb: 10, so: 4 });
    plate(g, x - 40 + op * 70, dy + 34, 80, 18, { fill: C.steelL, r: 9, rivets: false, shadow: false });
    text(g, lb, x - 70 + op * 70, dy + 46, { s: 26, w: 900, emboss: true });
    if (o.locks && o.locks[i]) padlock(g, x + 72 + op * 70, dy + 60, .7 * pop(o.locks[i]), C.yellow);
  });
}
/* 工牌（总结用）：钢框 + 链条，fn 在框内作画 */
function plaque(g, x, y, w, h, title, k, lt, fn, o = {}) {
  if (k <= 0) return;
  const sw = (1 - eo(clamp(k))) * .35 * Math.sin(lt * 9) + wob(lt, .3, .012);
  at(g, x, y - h / 2 - 90, 1, () => {
    g.rotate(sw);
    path(g, [[-w / 3, 0], [-w / 2 + 30, 90]], { c: C.steel, w: 4 }); path(g, [[w / 3, 0], [w / 2 - 30, 90]], { c: C.steel, w: 4 });
    g.translate(0, 90 + h / 2);
    plate(g, -w / 2, -h / 2, w, h, { fill: '#33403F', r: 12, sb: 40, so: 16 });
    hazard(g, -w / 2 + 14, -h / 2 + 14, w - 28, 12, { s: 14, lw: 1.5 });
    fn(g, -w / 2, -h / 2, w, h);
    text(g, title, 0, h / 2 - 50, { s: 34, w: 900, emboss: true, c: o.c || C.cream });
  }, { al: clamp(k * 3) });
}
/* id 纸带：n 个刻度格，cuts 为切口位置（0–1） */
function idTape(g, x0, x1, y, n, o = {}) {
  g.save(); shadow(g, .3, 10, 4); rr(g, x0, y - 26, x1 - x0, 52, 4); g.fillStyle = C.paper; g.fill(); g.restore();
  rr(g, x0, y - 26, x1 - x0, 52, 4); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) { const xx = x0 + (i + .5) * step; path(g, [[xx, y - 12], [xx, y + 12]], { c: rgba(C.ink, .5), w: Math.max(1.5, step * .4) }); }
  if (o.label) text(g, o.label, (x0 + x1) / 2, y - 50, { s: 24, w: 900, emboss: true });
}
function gear(g, x, y, r, a, c = C.steel, n = 10) {
  g.save(); g.translate(x, y); g.rotate(a); g.beginPath();
  for (let i = 0; i < n * 2; i++) { const rr2 = i % 2 ? r * .78 : r, a0 = i / (n * 2) * TAU; g.lineTo(Math.cos(a0) * rr2, Math.sin(a0) * rr2); g.lineTo(Math.cos(a0 + TAU / (n * 2) * .8) * rr2, Math.sin(a0 + TAU / (n * 2) * .8) * rr2); }
  g.closePath(); g.fillStyle = c; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
  dot(g, 0, 0, r * .3, C.steelD); ring(g, 0, 0, r * .3, C.ink, 2); g.restore();
}
function wallClock(g, x, y, r, a, o = {}) {
  dot(g, x, y + 4, r + 10, rgba('#000000', .35)); dot(g, x, y, r + 8, C.steelD); ring(g, x, y, r + 8, C.ink, 2.5); dot(g, x, y, r, C.paper);
  for (let i = 0; i < 12; i++) { const aa = i / 12 * TAU; path(g, [[x + Math.cos(aa) * (r - 10), y + Math.sin(aa) * (r - 10)], [x + Math.cos(aa) * (r - 3), y + Math.sin(aa) * (r - 3)]], { c: C.ink, w: i % 3 ? 2 : 3.5 }); }
  path(g, [[x, y], [x + Math.cos(a - TAU / 4) * (r - 10), y + Math.sin(a - TAU / 4) * (r - 10)]], { c: C.red, w: 4 });
  path(g, [[x, y], [x + Math.cos(a / 12 - TAU / 4) * (r * .55), y + Math.sin(a / 12 - TAU / 4) * (r * .55)]], { c: C.ink, w: 5 });
  dot(g, x, y, 6, C.ink);
  if (o.label) text(g, o.label, x, y + r + 36, { s: 24, w: 900, emboss: true });
}
/* 业务窗口：墙上的出件口 + 显示屏 */
function serviceWindow(g, x, y, lt, msg, o = {}) {
  plate(g, x - 150, y - 150, 300, 300, { fill: C.paintD, r: 12, sb: 30, so: 12 });
  rr(g, x - 110, y - 20, 220, 130, 8); g.fillStyle = '#0B0F11'; g.fill();
  hazard(g, x - 110, y + 110, 220, 12, { s: 12, lw: 1.5 });
  rr(g, x - 120, y - 130, 240, 84, 8); g.fillStyle = '#0B1310'; g.fill();
  if (msg) text(g, msg, x, y - 88, { f: 'mono', s: 28, w: 700, c: o.c || '#7CFFB2', glow: rgba(o.c || '#7CFFB2', .6), gb: 10 });
  sign(g, o.label || '业务回调', x, y - 186, { s: 24, fill: C.ink2, bar: C.green, rivets: false });
}
