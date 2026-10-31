/* =====================================================================
 * JSRuntime 用 Ubus 转发消息 —— 风格包：邮局 + 气动管道
 * 两座邮局 = 两个事件循环（门楣圆钟一直在转），柜员 = 线程，黄铜管道 = 消息队列，
 * 细铜管 + 铜珠 + 桌铃 = pipe 唤醒，回执存根 = Promise 回调表。
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题 ---------------- */
const C = {
  bg: '#F3E9D6', bg2: '#E8DAC0', paper: '#FFF9EE', ink: '#2B2520', ink2: '#6E6357', line: '#CDBEA4',
  teal: '#2C7C7E', tealL: '#D5ECEA', tealD: '#1D5759',
  brick: '#B4523C', brickL: '#F5DDD3', brickD: '#7E3626',
  navy: '#34507A', navyL: '#DDE5F1',
  brass: '#C8963E', brassL: '#F2D99A', brassD: '#8A6424', copper: '#B8703E',
  red: '#C8372D', redL: '#F8D9D3', green: '#3F8F5B', greenL: '#D8EEDC',
  amber: '#E39B2D', amberL: '#FBE7C2', grey: '#9A9184', greyL: '#E9E3D8', purple: '#7A5BA6', purpleL: '#E9E1F3',
  skin: '#F2D3B3', wood: '#A8743F', woodL: '#D9AE78', glass: '#BFD8DA',
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
/* 两个角色：JS 邮局 / ubus 邮局 */
const ROLE = {
  js: { c: C.teal, l: C.tealL, d: C.tealD, sign: 'JS 邮局', loop: 'libuv', who: 'JS 线程' },
  ubus: { c: C.brick, l: C.brickL, d: C.brickD, sign: 'ubus 邮局', loop: 'uloop', who: 'ubus 线程' },
};
/* 胶囊种类：标签、色带 */
const CAP = {
  INVOKE: C.teal, DATA: C.green, STATUS: C.grey, NOTIFY: C.amber, SUBSCRIBE: C.purple, NOT_FOUND: C.red, LOOKUP: C.navy, MSG: C.teal,
};

/* ---------------- 运动曲线 ---------------- */
const pop = p => p <= 0 ? 0 : p >= 1 ? 1 : eback(p);
const spring = (t, k = 6, f = 1.4) => t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(f * TAU * t);
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
  g.stroke(); g.restore();
}
function plen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
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
const polyAt = (pts, u) => partial(pts, u).at(-1);
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
function arcPts(a, b, lift, n = 24) { const m = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift], o = []; for (let i = 0; i <= n; i++) o.push(bez(a, m, b, i / n)); return o; }

/* ---------------- 小图标 ---------------- */
function icCheck(g, x, y, s, c = C.green, p = 1, lw) { path(g, partial([[x - s * .45, y], [x - s * .12, y + s * .32], [x + s * .5, y - s * .38]], p), { c, w: lw || s * .2 }); }
function icCross(g, x, y, s, c = C.red, p = 1, lw) {
  const k = s * .42;
  path(g, partial([[x - k, y - k], [x + k, y + k]], clamp(p * 2)), { c, w: lw || s * .2 });
  path(g, partial([[x + k, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c, w: lw || s * .2 });
}
function badge(g, x, y, r, c, kind, p = 1) {
  at(g, x, y, pop(p), () => {
    dot(g, 0, 0, r, c); ring(g, 0, 0, r, C.ink, 3);
    if (kind === 'check') icCheck(g, 0, 2, r * 1.1, '#fff', 1, r * .22);
    else if (kind === 'cross') icCross(g, 0, 0, r * 1.1, '#fff', 1, r * .22);
    else text(g, kind, 0, 2, { f: 'disp', w: 900, s: r * 1.3, c: '#fff' });
  });
}
function tag(g, s, x, y, c, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    const fs = o.fs || 28, f = o.f || 'cjk', w = textW(g, s, { s: fs, w: 900, f }) + 40, h = fs + 24;
    card(g, -w / 2, -h / 2, w, h, { r: h / 2, fill: o.fill || c, lw: 3, sb: 14, so: 5 });
    text(g, s, 0, 1, { s: fs, w: 900, f, c: o.tc || '#fff' });
  }, { rot: o.rot || 0, al: o.al });
}
/* 标牌：米色小牌 + 墨线（用于 libuv / uloop / to_ubus 这类名字） */
function plate(g, s, x, y, o = {}) {
  const fs = o.fs || 26, f = o.f || 'mono', w = textW(g, s, { s: fs, w: 700, f }) + 30, h = fs + 18;
  at(g, x, y, o.s ?? 1, () => {
    card(g, -w / 2, -h / 2, w, h, { r: 8, fill: o.fill || C.paper, lw: 2.5, stroke: o.stroke || C.ink, sb: 8, so: 3, sa: .12 });
    text(g, s, 0, 1, { s: fs, w: 700, f, c: o.c || C.ink });
  }, { al: o.al, rot: o.rot });
  return w;
}
function zzz(g, x, y, lt, al = 1) {
  for (let i = 0; i < 3; i++) {
    const ph = (lt * .55 + i / 3) % 1;
    text(g, 'Z', x + ph * 50 + i * 4, y - ph * 90, { f: 'disp', w: 900, s: 26 + ph * 18, c: C.navy, al: al * Math.sin(ph * Math.PI) });
  }
}
function qmark(g, x, y, s, p, lt, ph = 0) {
  at(g, x, y + wob(lt, 1.3, 4, ph), pop(p) * s, () => { dot(g, 0, 0, 30, '#fff'); ring(g, 0, 0, 30, C.ink, 3); text(g, '?', 0, 3, { f: 'disp', w: 900, s: 40, c: C.red }); });
}

/* ---------------- 地面与街景 ---------------- */
function ground(g, y, al = 1, x0 = -200, x1 = W + 200) {
  g.save(); g.globalAlpha *= al;
  const gr = g.createLinearGradient(0, y, 0, y + 120); gr.addColorStop(0, rgba(C.wood, .26)); gr.addColorStop(1, rgba(C.wood, 0));
  g.fillStyle = gr; g.fillRect(x0, y, x1 - x0, 120);
  path(g, [[x0, y], [x1, y]], { c: rgba(C.ink, .55), w: 3 });
  for (let x = x0 + 20, i = 0; x < x1; x += 46 + hash(i) * 30, i++) path(g, [[x, y + 14 + hash(i * 3) * 10], [x + 18 + hash(i * 7) * 20, y + 14 + hash(i * 3) * 10]], { c: rgba(C.ink, .16), w: 3 });
  g.restore();
}
function shadowEll(g, x, y, w, al = .18) { g.save(); g.globalAlpha *= al; g.beginPath(); g.ellipse(x, y, w / 2, w * .06, 0, 0, TAU); g.fillStyle = C.ink; g.fill(); g.restore(); }

/* ---------------- 时钟 = 事件循环 ---------------- */
function clockFace(g, x, y, r, ang, o = {}) {
  dot(g, x, y, r + 6, o.rim || C.brass); ring(g, x, y, r + 6, C.ink, 3);
  dot(g, x, y, r, o.face || C.paper);
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, k = i % 3 ? .86 : .76; path(g, [[x + Math.cos(a) * r * k, y + Math.sin(a) * r * k], [x + Math.cos(a) * r * .94, y + Math.sin(a) * r * .94]], { c: C.ink, w: i % 3 ? 2 : 3.5 }); }
  if (o.arc) { ring(g, x, y, r * .62, rgba(o.c || C.teal, .9), 5, o.arc, ang - 1.6, ang); }
  path(g, [[x, y], [x + Math.cos(ang - TAU / 4) * r * .78, y + Math.sin(ang - TAU / 4) * r * .78]], { c: o.hand || C.ink, w: 4.5 });
  path(g, [[x, y], [x + Math.cos(ang / 12 - TAU / 4) * r * .5, y + Math.sin(ang / 12 - TAU / 4) * r * .5]], { c: C.ink, w: 6 });
  dot(g, x, y, 5, C.ink);
}

/* ---------------- 建筑：邮局 ---------------- */
/* (x, y) 是建筑底边中点。o: role, lit(0..1), ang(钟针角度), al, sign, loop(钟下铭牌), frost(0..1), grey(0..1) */
function postOffice(g, x, y, s, o = {}) {
  const R = ROLE[o.role || 'js'], lit = o.lit ?? 1, grey = o.grey || 0;
  const col = o.c || R.c, colL = o.l || R.l, colD = o.d || R.d;
  at(g, x, y, s, () => {
    shadowEll(g, 0, 4, 470);
    // 墙体
    g.save(); shadow(g, .18, 30, 12); rr(g, -190, -270, 380, 270, 6); g.fillStyle = colL; g.fill(); noShadow(g); g.restore();
    g.save(); rr(g, -190, -270, 380, 270, 6); g.clip();
    for (let yy = -258, r = 0; yy < 0; yy += 24, r++) { path(g, [[-190, yy], [190, yy]], { c: rgba(colD, .12), w: 2 }); for (let xx = -190 + (r % 2) * 30; xx < 190; xx += 60) path(g, [[xx, yy], [xx, yy + 24]], { c: rgba(colD, .1), w: 2 }); }
    g.fillStyle = rgba(colD, .18); g.fillRect(-190, -40, 380, 40);
    g.restore();
    rr(g, -190, -270, 380, 270, 6); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke();
    // 屋顶 + 山墙
    g.beginPath(); g.moveTo(-222, -262); g.lineTo(0, -410); g.lineTo(222, -262); g.closePath();
    g.fillStyle = col; g.fill(); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.lineJoin = 'round'; g.stroke();
    g.beginPath(); g.moveTo(-160, -272); g.lineTo(0, -378); g.lineTo(160, -272); g.closePath(); g.fillStyle = rgba('#ffffff', .14); g.fill();
    // 门楣圆钟
    clockFace(g, 0, -318, 40, o.ang ?? 0, { c: col, arc: o.arc });
    // 招牌
    card(g, -128, -252, 256, 54, { r: 10, fill: C.paper, lw: 3, sb: 8, so: 3 });
    text(g, o.sign || R.sign, 0, -224, { s: 32, w: 900, c: colD });
    // 窗户
    for (const sx of [-1, 1]) {
      const wx = sx * 118 - 44, wy = -178;
      rr(g, wx, wy, 88, 92, 8); g.fillStyle = '#5B6670'; g.fill();
      if (lit > 0) { g.save(); g.globalAlpha *= lit; rr(g, wx, wy, 88, 92, 8); const lg = g.createLinearGradient(0, wy, 0, wy + 92); lg.addColorStop(0, '#FFE7A6'); lg.addColorStop(1, '#F2B95C'); g.fillStyle = lg; g.fill(); g.restore(); }
      path(g, [[wx + 44, wy], [wx + 44, wy + 92]], { c: C.ink, w: 3 }); path(g, [[wx, wy + 46], [wx + 88, wy + 46]], { c: C.ink, w: 3 });
      rr(g, wx, wy, 88, 92, 8); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
      card(g, wx - 8, wy + 92, 104, 12, { r: 4, fill: col, lw: 2.5, shadow: false });
    }
    // 门
    rr(g, -46, -148, 92, 148, 40); g.fillStyle = colD; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    if (lit > 0) { g.save(); g.globalAlpha *= lit * .5; rr(g, -34, -134, 68, 50, 30); g.fillStyle = '#FFE7A6'; g.fill(); g.restore(); }
    dot(g, 30, -70, 5, C.brassL);
    // 冻结与变灰
    if (grey > 0) { g.save(); g.globalAlpha *= grey * .55; g.beginPath(); g.moveTo(-222, -262); g.lineTo(0, -410); g.lineTo(222, -262); g.lineTo(190, -262); g.lineTo(190, 0); g.lineTo(-190, 0); g.lineTo(-190, -262); g.closePath(); g.fillStyle = '#8E98A3'; g.fill(); g.restore(); }
    if (o.frost > 0) frost(g, 0, -200, 230, o.frost);
  }, { al: o.al });
}
function frost(g, x, y, r, k) {
  g.save(); g.globalAlpha *= clamp(k);
  for (let i = 0; i < 9; i++) {
    const a = hash(i * 3.7) * TAU, d = r * (.3 + hash(i * 5.1) * .7), cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d * .8, l = 16 + hash(i) * 18;
    for (let k2 = 0; k2 < 6; k2++) { const b = k2 / 6 * TAU; path(g, [[cx, cy], [cx + Math.cos(b) * l, cy + Math.sin(b) * l]], { c: '#E8F4FA', w: 3 }); }
  }
  g.restore();
}
/* 分拣中心 ubusd：锯齿屋顶 + 转动的分拣轮 */
function hub(g, x, y, s, lt, o = {}) {
  at(g, x, y, s, () => {
    shadowEll(g, 0, 4, 420);
    g.save(); shadow(g, .18, 30, 12); rr(g, -180, -230, 360, 230, 6); g.fillStyle = C.navyL; g.fill(); noShadow(g); g.restore();
    rr(g, -180, -230, 360, 230, 6); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke();
    g.beginPath(); g.moveTo(-190, -226);
    for (let i = 0; i < 4; i++) { const x0 = -190 + i * 95; g.lineTo(x0, -300); g.lineTo(x0 + 95, -226); }
    g.closePath(); g.fillStyle = C.navy; g.fill(); g.lineWidth = 3.5; g.lineJoin = 'round'; g.strokeStyle = C.ink; g.stroke();
    card(g, -150, -212, 300, 54, { r: 10, fill: C.paper, lw: 3, sb: 8, so: 3 });
    text(g, o.sign || '分拣中心 ubusd', 0, -184, { s: 30, w: 900, c: C.navy });
    // 分拣轮
    const a = lt * 1.2 * (o.spin ?? 1);
    g.save(); g.translate(0, -84); dot(g, 0, 0, 58, '#fff'); ring(g, 0, 0, 58, C.ink, 3);
    for (let i = 0; i < 6; i++) { const b = a + i / 6 * TAU; path(g, [[0, 0], [Math.cos(b) * 50, Math.sin(b) * 50]], { c: C.navy, w: 5 }); dot(g, Math.cos(b) * 50, Math.sin(b) * 50, 9, [C.teal, C.brick, C.amber][i % 3]); }
    dot(g, 0, 0, 10, C.ink); g.restore();
    if (o.busy > 0) for (let k = 0; k < 2; k++) { const ph = (lt * 1.4 + k / 2) % 1; ring(g, 0, -84, 70 + ph * 50, C.navy, 4, (1 - ph) * .5 * o.busy); }
  }, { al: o.al });
}
/* 系统服务小屋 */
function hut(g, x, y, s, name, lt, o = {}) {
  at(g, x, y, s, () => {
    shadowEll(g, 0, 4, 240);
    card(g, -100, -140, 200, 140, { r: 6, fill: o.l || C.amberL, lw: 3.5, sb: 18 });
    g.beginPath(); g.moveTo(-122, -134); g.lineTo(0, -212); g.lineTo(122, -134); g.closePath(); g.fillStyle = o.c || C.amber; g.fill(); g.lineWidth = 3.5; g.lineJoin = 'round'; g.strokeStyle = C.ink; g.stroke();
    rr(g, -30, -84, 60, 84, 26); g.fillStyle = rgba(C.ink, .7); g.fill();
    const on = o.light ?? (.5 + .5 * Math.sin(lt * 3 + x));
    dot(g, 66, -100, 12, on > .5 ? '#FFE7A6' : '#8A8F95'); ring(g, 66, -100, 12, C.ink, 2.5);
    dot(g, -66, -100, 12, on > .5 ? '#8A8F95' : '#FFE7A6'); ring(g, -66, -100, 12, C.ink, 2.5);
  }, { al: o.al });
  if (name) plate(g, name, x, y + 34 * s + 10, { fs: 26, al: o.al });
}

/* ---------------- 柜员 ---------------- */
/* (x, y) 为脚底。o: c 帽色, pose: stand|walk|sleep|reach|wave|stuck, ph 走路相位, dir 朝向, face: open|closed|wow|confused, arm 伸手角度, sq 挤压 */
function clerk(g, x, y, s, o = {}) {
  const c = o.c || C.teal, pose = o.pose || 'stand', ph = o.ph || 0, dir = o.dir || 1;
  const walk = pose === 'walk' ? Math.sin(ph * TAU) : 0, bob = pose === 'walk' ? Math.abs(Math.cos(ph * TAU)) * 5 : 0;
  const sq = o.sq || 0;
  at(g, x, y, s, () => {
    shadowEll(g, 0, 2, 90, .2);
    g.save(); g.scale(dir * (1 + sq * .5), 1 - sq); g.translate(0, -bob);
    // 腿
    path(g, [[-12, -44], [-12 + walk * 12, -2]], { c: C.ink, w: 9 }); path(g, [[12, -44], [12 - walk * 12, -2]], { c: C.ink, w: 9 });
    // 身体
    g.beginPath(); g.moveTo(-34, -40); g.quadraticCurveTo(-40, -98, -20, -108); g.lineTo(20, -108); g.quadraticCurveTo(40, -98, 34, -40); g.closePath();
    g.fillStyle = c; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    g.beginPath(); g.moveTo(-14, -108); g.lineTo(0, -90); g.lineTo(14, -108); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.stroke();
    dot(g, 0, -70, 3.5, C.brassL); dot(g, 0, -56, 3.5, C.brassL);
    // 手臂
    const sw = pose === 'walk' ? walk * .5 : 0;
    const armL = pose === 'wave' ? -2.2 + Math.sin(ph * TAU * 2) * .35 : pose === 'sleep' ? -1.2 : .25 + sw;
    const armR = pose === 'reach' || pose === 'stuck' ? (o.arm ?? -1.3) : pose === 'sleep' ? -1.9 : -.25 - sw;
    const sh = [[-30, -96], [30, -96]];
    path(g, [sh[0], [sh[0][0] + Math.sin(armL) * -48, sh[0][1] + Math.cos(armL) * 48]], { c: C.ink, w: 10 });
    path(g, [sh[0], [sh[0][0] + Math.sin(armL) * -48, sh[0][1] + Math.cos(armL) * 48]], { c, w: 6 });
    const handR = [sh[1][0] - Math.sin(armR) * 54, sh[1][1] + Math.cos(armR) * 54];
    path(g, [sh[1], handR], { c: C.ink, w: 10 }); path(g, [sh[1], handR], { c, w: 6 });
    dot(g, handR[0], handR[1], 7, C.skin); ring(g, handR[0], handR[1], 7, C.ink, 2);
    // 头
    const hy = pose === 'sleep' ? -118 : -134, ht = pose === 'sleep' ? .35 : 0;
    g.save(); g.translate(0, hy); g.rotate(ht);
    dot(g, 0, 0, 28, C.skin); ring(g, 0, 0, 28, C.ink, 3);
    const face = o.face || (pose === 'sleep' ? 'closed' : 'open');
    if (face === 'closed') { path(g, [[-14, 2], [-6, 5]], { c: C.ink, w: 3 }); path(g, [[6, 5], [14, 2]], { c: C.ink, w: 3 }); }
    else if (face === 'wow') { dot(g, -10, 0, 4.5, C.ink); dot(g, 10, 0, 4.5, C.ink); ring(g, 0, 14, 5, C.ink, 2.5); }
    else if (face === 'confused') { dot(g, -10, 0, 3.5, C.ink); dot(g, 10, -2, 3.5, C.ink); path(g, [[-6, 14], [0, 11], [7, 15]], { c: C.ink, w: 2.5 }); }
    else { dot(g, -10, 0, 3.5, C.ink); dot(g, 10, 0, 3.5, C.ink); path(g, [[-7, 11], [0, 15], [7, 11]], { c: C.ink, w: 2.5 }); }
    // 邮差帽
    g.beginPath(); g.moveTo(-30, -14); g.lineTo(-26, -34); g.quadraticCurveTo(0, -44, 26, -34); g.lineTo(30, -14); g.closePath();
    g.fillStyle = c; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    rr(g, -34, -18, 68, 9, 4); g.fillStyle = C.ink; g.fill();
    dot(g, 0, -28, 5, C.brassL); ring(g, 0, -28, 5, C.ink, 1.5);
    g.restore();
    g.restore();
  }, { al: o.al });
}

/* ---------------- 黄铜气动管道 ---------------- */
function tube(g, pts, o = {}) {
  const q = partial(pts, o.p ?? 1); if (q.length < 2) return;
  const w = o.w || 34;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  const stroke = (c, lw, dy = 0) => { g.beginPath(); g.moveTo(q[0][0], q[0][1] + dy); for (const p of q.slice(1)) g.lineTo(p[0], p[1] + dy); g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'butt'; g.lineJoin = 'round'; g.stroke(); };
  g.save(); shadow(g, .16, 14, 6); stroke(C.ink, w + 7); g.restore();
  stroke(o.c || C.brass, w); stroke(rgba(o.cd || C.brassD, .5), w * .3, w * .3); stroke(rgba('#FFF6DA', .55), w * .22, -w * .24);
  // 铆钉环
  const L = plen(q), step = o.step || 140;
  for (let d = step / 2; d < L; d += step) {
    const p0 = polyAt(q, d / L), p1 = polyAt(q, Math.min(1, (d + 2) / L)), a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + TAU / 4;
    path(g, [[p0[0] + Math.cos(a) * (w / 2 + 3), p0[1] + Math.sin(a) * (w / 2 + 3)], [p0[0] - Math.cos(a) * (w / 2 + 3), p0[1] - Math.sin(a) * (w / 2 + 3)]], { c: C.brassD, w: 7, cap: 'butt' });
  }
  // 流向：淡淡的箭头在管里滑动
  if (o.flow) {
    const sp = o.flow, n = Math.floor(L / 90);
    for (let i = 0; i < n; i++) {
      const u = ((i / n) + (o.t || 0) * sp / L * 60) % 1, p0 = polyAt(q, u), p1 = polyAt(q, Math.min(1, u + .01));
      arrowHead(g, p0[0], p0[1], Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), rgba(C.brassD, .55), 12);
    }
  }
  g.restore();
}
/* 管口（墙上的喇叭口） */
function tubeMouth(g, x, y, ang, o = {}) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, -22); g.lineTo(26, -32); g.lineTo(26, 32); g.lineTo(0, 22); g.closePath();
  g.fillStyle = o.c || C.brass; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.lineJoin = 'round'; g.stroke();
  path(g, [[26, -32], [26, 32]], { c: C.brassD, w: 6 });
  g.restore();
}
/* 胶囊：黄铜圆筒 + 色带 + 标签 */
function capsule(g, x, y, kind, o = {}) {
  const col = o.c || CAP[kind] || C.teal, label = o.label || kind, fs = o.fs || 26;
  const tw = textW(g, label, { f: 'mono', s: fs, w: 700 }), seqW = o.seq ? textW(g, o.seq, { f: 'mono', s: 24, w: 700 }) + 20 : 0;
  const w = tw + seqW + 64, h = 50;
  at(g, x, y, o.s ?? 1, () => {
    if (o.glow) { g.save(); rr(g, -w / 2, -h / 2, w, h, 25); g.shadowColor = rgba(col, .7 * o.glow); g.shadowBlur = 30 * SH(); g.fillStyle = col; g.fill(); g.restore(); }
    g.save(); shadow(g, .2, 14, 5); rr(g, -w / 2, -h / 2, w, h, 25);
    const lg = g.createLinearGradient(0, -h / 2, 0, h / 2); lg.addColorStop(0, '#F7E3AE'); lg.addColorStop(.45, C.brass); lg.addColorStop(1, C.brassD);
    g.fillStyle = lg; g.fill(); noShadow(g); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); g.restore();
    rr(g, -w / 2 + 14, -h / 2 + 5, w - 28, h - 10, 8); g.fillStyle = C.paper; g.fill();
    rr(g, -w / 2 + 14, -h / 2 + 5, 14, h - 10, 4); g.fillStyle = col; g.fill();
    text(g, label, -w / 2 + 34 + tw / 2, 1, { f: 'mono', s: fs, w: 700, c: C.ink });
    if (o.seq) { rr(g, w / 2 - 18 - seqW, -15, seqW, 30, 15); g.fillStyle = col; g.fill(); text(g, o.seq, w / 2 - 18 - seqW / 2, 1, { f: 'mono', s: 24, w: 700, c: '#fff' }); }
  }, { rot: o.rot, sx: o.sx, sy: o.sy, al: o.al });
  return w * (o.s ?? 1);
}
/* 沿管道跑：拖尾 + 拉伸；到达后挤压落地 + 涟漪（hold 时停在终点）。返回位置或 null */
function ride(g, pts, lt, t0, dur, kind, o = {}) {
  const raw = (lt - t0) / dur; if (raw < 0) return null;
  const col = o.c || CAP[kind] || C.teal;
  if (raw <= 1) {
    const u = eio(raw);
    for (let i = 10; i >= 1; i--) {
      const u0 = eio(clamp(raw - i * .02)), u1 = eio(clamp(raw - (i - 1) * .02));
      if (u1 <= 0) continue; path(g, [polyAt(pts, u0), polyAt(pts, u1)], { c: col, w: 16 * (1 - i / 10) + 2, al: .3 * (1 - i / 10) });
    }
    const p = polyAt(pts, u), st = 1 + .14 * Math.sin(raw * Math.PI);
    capsule(g, p[0], p[1], kind, { ...o, sx: st, sy: 1 / st, glow: .5 });
    return p;
  }
  const k = lt - t0 - dur, b = pts.at(-1);
  if (o.ripple !== false && k < .7) ring(g, b[0], b[1], 26 + 70 * eo(k / .7), col, 4, 1 - k / .7);
  if (o.hold) { const sq2 = k < .3 ? Math.sin(k / .3 * Math.PI) * .16 : 0; capsule(g, b[0] + (o.hdx || 0), b[1] + (o.hdy || 0), kind, { ...o, sx: 1 + sq2, sy: 1 - sq2 }); }
  return b;
}
/* 细铜管（pipe）与铜珠 */
function pipeLine(g, pts, o = {}) {
  const q = partial(pts, o.p ?? 1); if (q.length < 2) return;
  path(g, q, { c: C.ink, w: 15, al: o.al }); path(g, q, { c: o.c || C.copper, w: 10, al: o.al }); path(g, q.map(p => [p[0], p[1] - 2]), { c: rgba('#FFE2C4', .6), w: 3, al: o.al });
}
function bead(g, x, y, r = 12, al = 1) {
  g.save(); g.globalAlpha *= al;
  const rg = g.createRadialGradient(x - r * .35, y - r * .35, 1, x, y, r); rg.addColorStop(0, '#FFF3C8'); rg.addColorStop(.5, C.brass); rg.addColorStop(1, C.brassD);
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = rg; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke(); g.restore();
}
/* 桌铃：k = 被敲后的秒数（<0 表示没敲） */
function deskBell(g, x, y, s, k = -1) {
  const sh = k >= 0 && k < 1 ? Math.sin(k * 40) * .12 * (1 - k) : 0;
  at(g, x, y, s, () => {
    rr(g, -54, -10, 108, 18, 6); g.fillStyle = C.wood; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    g.save(); g.rotate(sh);
    g.beginPath(); g.moveTo(-44, -10); g.quadraticCurveTo(-44, -64, 0, -66); g.quadraticCurveTo(44, -64, 44, -10); g.closePath();
    const lg = g.createLinearGradient(-44, 0, 44, 0); lg.addColorStop(0, C.brassD); lg.addColorStop(.35, '#FBE6A8'); lg.addColorStop(1, C.brass);
    g.fillStyle = lg; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    rr(g, -6, -80, 12, 16, 4); g.fillStyle = C.ink; g.fill();
    g.restore();
  });
  if (k >= 0 && k < .9) for (let i = 0; i < 3; i++) { const kk = k - i * .12; if (kk > 0) ring(g, x, y - 40 * s, (50 + 120 * eo(kk / .8)) * s, C.brass, 4, (1 - kk / .8) * .8, -TAU / 2 + .5, -.5); }
}

/* ---------------- 回执存根板 / 存根 / Promise 票 ---------------- */
function corkBoard(g, x, y, w, h, title, o = {}) {
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  card(g, x - 12, y - 12, w + 24, h + 24, { r: 10, fill: C.wood, lw: 3.5, sb: 24, so: 10 });
  rr(g, x, y, w, h, 6); g.fillStyle = '#D7B07E'; g.fill();
  g.save(); rr(g, x, y, w, h, 6); g.clip();
  for (let i = 0; i < w * h / 600; i++) dot(g, x + hash(i * 1.7) * w, y + hash(i * 2.9) * h, 1.6 + hash(i * 4.1) * 1.6, rgba(C.brassD, .35));
  g.restore();
  rr(g, x, y, w, h, 6); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  if (title) { const tw = textW(g, title, { f: 'mono', s: 24, w: 700 }) + 36; card(g, x + w / 2 - tw / 2, y - 34, tw, 44, { r: 8, fill: C.paper, lw: 3, sb: 6, so: 2 }); text(g, title, x + w / 2, y - 11, { f: 'mono', s: 24, w: 700 }); }
  g.restore();
}
/* 存根 220×132：齿孔左边、#seq、resolve/reject 两个挂钩。o.state: wait|ok|fail */
function stub(g, x, y, seq, o = {}) {
  const st = o.state || 'wait', col = st === 'ok' ? C.green : st === 'fail' ? C.red : C.ink;
  at(g, x, y, o.s ?? 1, () => {
    if (o.glow) { g.save(); rr(g, -110, -66, 220, 132, 10); g.shadowColor = rgba(col === C.ink ? C.brass : col, .8 * o.glow); g.shadowBlur = 30 * SH(); g.fillStyle = '#fff'; g.fill(); g.restore(); }
    card(g, -110, -66, 220, 132, { r: 10, fill: st === 'ok' ? C.greenL : st === 'fail' ? C.redL : C.paper, lw: 3, sb: 12, so: 5 });
    for (let i = 0; i < 7; i++) dot(g, -110, -54 + i * 18, 5, '#D7B07E');
    path(g, [[-92, -66], [-92, 66]], { c: rgba(C.ink, .4), w: 2, dash: [5, 6] });
    dot(g, 6, -78, 9, C.red); ring(g, 6, -78, 9, C.ink, 2.5);
    text(g, seq, -70, -32, { f: 'disp', w: 900, s: 40, c: col, a: 'left' });
    text(g, 'seq', 92, -32, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'right' });
    for (const [i, nm, cc] of [[0, 'resolve', C.green], [1, 'reject', C.red]]) {
      const yy = 10 + i * 34; ring(g, -64, yy, 9, cc, 4); path(g, [[-64, yy - 9], [-64, yy - 18]], { c: cc, w: 4 });
      text(g, nm, -44, yy + 1, { f: 'mono', s: 24, w: 700, c: cc, a: 'left' });
    }
  }, { rot: o.rot, al: o.al, sy: o.sy });
}
/* Promise 取件票：state pending|ok|fail；flip 0..1 翻面（中途换状态由调用方处理） */
function ticket(g, x, y, st, o = {}) {
  const c = st === 'ok' ? C.green : st === 'fail' ? C.red : C.amber, lab = st === 'ok' ? '已兑现' : st === 'fail' ? '已拒绝' : '待兑现';
  at(g, x, y, o.s ?? 1, () => {
    g.save(); shadow(g, .18, 16, 6);
    g.beginPath(); g.moveTo(-130, -52); g.lineTo(130, -52); g.arc(130, 0, 16, -TAU / 4, TAU / 4, true); g.lineTo(130, 52); g.lineTo(-130, 52); g.arc(-130, 0, 16, TAU / 4, -TAU / 4, true); g.closePath();
    g.fillStyle = st === 'ok' ? C.greenL : st === 'fail' ? C.redL : C.paper; g.fill(); noShadow(g); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); g.restore();
    path(g, [[-70, -44], [-70, 44]], { c: rgba(C.ink, .35), w: 2, dash: [5, 6] });
    if (st === 'pending') { // 沙漏
      const a = o.lt != null ? Math.floor(o.lt / 1.6) % 2 * Math.PI + clamp((o.lt % 1.6 - 1.3) / .3) * Math.PI : 0;
      g.save(); g.translate(-100, 0); g.rotate(a);
      g.beginPath(); g.moveTo(-14, -22); g.lineTo(14, -22); g.lineTo(-14, 22); g.lineTo(14, 22); g.closePath(); g.fillStyle = C.amberL; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
      g.restore();
    } else if (st === 'ok') icCheck(g, -100, 2, 34, C.green, 1, 7); else icCross(g, -100, 0, 34, C.red, 1, 7);
    text(g, 'Promise', 30, -16, { f: 'mono', s: 28, w: 700 });
    text(g, lab, 30, 22, { s: 26, w: 900, c });
  }, { rot: o.rot, al: o.al, sy: o.sy });
}

/* ---------------- 印章 ---------------- */
/* p: 0..1 落下进度（>=1 已盖上） */
function stampMark(g, x, y, s, col, p, o = {}) {
  if (p <= 0) return;
  const k = eo(clamp(p)), sc = lerp(1.7, 1, k), al = clamp(p * 1.6) * (o.al ?? 1);
  const fs = o.fs || 44, w = textW(g, s, { s: fs, w: 900 }) + 56, h = fs + 34;
  at(g, x, y, sc, () => {
    g.globalAlpha *= .9;
    rr(g, -w / 2, -h / 2, w, h, 12); g.lineWidth = 6; g.strokeStyle = col; g.stroke();
    rr(g, -w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 7); g.lineWidth = 2.5; g.stroke();
    text(g, s, 0, 2, { s: fs, w: 900, c: col });
    // 墨迹斑驳
    for (let i = 0; i < 26; i++) dot(g, (hash(i * 3.3 + x) - .5) * w, (hash(i * 7.1 + y) - .5) * h, 2 + hash(i) * 3, rgba(C.paper, .55));
  }, { rot: o.rot ?? -.12, al });
}
/* 邮戳圆章 */
function postmark(g, x, y, r, col, lines = [], o = {}) {
  at(g, x, y, o.s ?? 1, () => {
    ring(g, 0, 0, r, col, 5); ring(g, 0, 0, r - 12, col, 2.5);
    lines.forEach((l, i) => text(g, l.s, 0, l.dy, { s: l.fs || 28, w: 900, f: l.f || 'cjk', c: col }));
    if (o.waves) for (let k = 0; k < 4; k++) { const yy = -36 + k * 24, pts = []; for (let i = 0; i <= 30; i++) pts.push([r + 10 + i * 8, yy + Math.sin(i * .8) * 6]); path(g, pts, { c: col, w: 3.5 }); }
  }, { rot: o.rot ?? -.1, al: o.al });
}

/* ---------------- 信封 / 信箱 ---------------- */
function envelope(g, x, y, s, o = {}) {
  at(g, x, y, s, () => {
    card(g, -84, -54, 168, 108, { r: 8, fill: o.fill || C.paper, lw: 3, sb: 12, so: 5 });
    path(g, [[-84, -54], [0, 4], [84, -54]], { c: C.ink, w: 3 });
    if (o.stripe !== false) for (let i = 0; i < 9; i++) { rr(g, -84 + i * 19, 44, 10, 10, 2); g.fillStyle = i % 2 ? C.red : C.navy; g.fill(); }
    if (o.label) { const tw = textW(g, o.label, { f: 'mono', s: 24, w: 700 }) + 20; rr(g, -tw / 2, 6, tw, 32, 6); g.fillStyle = o.c || C.amber; g.fill(); text(g, o.label, 0, 23, { f: 'mono', s: 24, w: 700, c: '#fff' }); }
    if (o.from) text(g, o.from, -74, -32, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'left' });
  }, { rot: o.rot, al: o.al, sx: o.sx, sy: o.sy });
}
function mailbox(g, x, y, s, o = {}) {
  const c = o.c || C.brick;
  at(g, x, y, s, () => {
    shadowEll(g, 0, 2, 130);
    g.save(); shadow(g, .18, 18, 6);
    g.beginPath(); g.moveTo(-46, 0); g.lineTo(-46, -120); g.arc(0, -120, 46, Math.PI, 0); g.lineTo(46, 0); g.closePath(); g.fillStyle = c; g.fill(); noShadow(g);
    g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke(); g.restore();
    rr(g, -54, -10, 108, 14, 4); g.fillStyle = C.ink; g.fill();
    rr(g, -30, -128, 60, 12, 6); g.fillStyle = C.ink; g.fill();
    rr(g, -26, -90, 52, 34, 6); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    if (o.glow) { g.save(); g.globalAlpha *= o.glow; ring(g, 0, -100, 76, C.amber, 5); g.restore(); }
  }, { al: o.al, rot: o.rot });
  if (o.label) plate(g, o.label, x, y + 30 * s + 10, { fs: 24, al: o.al });
}

/* ---------------- 代码卡（示意代码，单色系高亮） ---------------- */
const KW = new Set(['const', 'await', 'object', 'method', 'subscriber', 'return', 'let', 'function']);
function codeLine(g, s, x, y, fs, o = {}) {
  const re = /(\/\/.*$)|("[^"]*")|(\b\d+\b)|([A-Za-z_]+)|([^A-Za-z_\d"\/]+|\/)/g; let m, xx = x;
  while ((m = re.exec(s))) {
    const tk = m[0], c = m[1] ? C.grey : m[2] ? C.brick : m[3] ? C.amber : m[4] && KW.has(tk) ? C.teal : m[4] && /^(int32|string|response)$/.test(tk) ? C.purple : C.ink;
    text(g, tk, xx, y, { f: 'mono', s: fs, w: m[4] && KW.has(tk) ? 700 : 500, c, a: 'left' }); xx += textW(g, tk, { f: 'mono', s: fs, w: m[4] && KW.has(tk) ? 700 : 500 });
  }
  return xx - x;
}
/* lines: 字符串数组；o.p 打字进度（按字符总数），o.hl 高亮行，o.title 标签 */
function codeCard(g, x, y, w, lines, o = {}) {
  const fs = o.fs || 26, lh = fs * 1.55, h = lines.length * lh + 44 + (o.title ? 18 : 0);
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  card(g, x, y, w, h, { r: 14, fill: '#FFFCF4', lw: 3, sb: 22, so: 8 });
  g.save(); rr(g, x, y, w, h, 14); g.clip(); for (let yy = y + 30; yy < y + h; yy += 14) path(g, [[x, yy], [x + w, yy]], { c: rgba(C.teal, .05), w: 1 }); g.restore();
  if (o.title) { const tw = textW(g, o.title, { f: 'mono', s: 24, w: 700 }) + 28; card(g, x + 20, y - 20, tw, 40, { r: 8, fill: o.tc || C.teal, lw: 2.5, sb: 6, so: 2 }); text(g, o.title, x + 20 + tw / 2, y, { f: 'mono', s: 24, w: 700, c: '#fff' }); }
  const total = lines.reduce((a, l) => a + l.length, 0); let budget = Math.round(total * clamp(o.p ?? 1));
  lines.forEach((l, i) => {
    const yy = y + 22 + (o.title ? 18 : 0) + lh * (i + .5);
    if (o.hl === i || (Array.isArray(o.hl) && o.hl.includes(i))) { rr(g, x + 10, yy - lh / 2 + 2, w - 20, lh - 4, 8); g.fillStyle = rgba(o.hc || C.amber, .26 * (o.hk ?? 1)); g.fill(); }
    if (budget <= 0) return; const s = l.slice(0, budget); budget -= l.length;
    codeLine(g, s, x + 26, yy, fs);
  });
  g.restore();
  return h;
}

/* ---------------- 其他小道具 ---------------- */
function warnSign(g, x, y, s, label, swing = 0, o = {}) {
  at(g, x, y, s, () => {
    path(g, [[-60, -70], [0, -120], [60, -70]], { c: C.ink, w: 3 });
    g.save(); g.translate(0, -120); g.rotate(swing); g.translate(0, 120);
    const w = textW(g, label, { s: 28, w: 900 }) + 60;
    card(g, -w / 2, -72, w, 74, { r: 8, fill: C.amber, lw: 3.5 });
    g.save(); rr(g, -w / 2, -72, w, 74, 8); g.clip(); for (let i = -w; i < w; i += 36) { g.beginPath(); g.moveTo(i, -72); g.lineTo(i + 14, -72); g.lineTo(i - 10, 2); g.lineTo(i - 24, 2); g.closePath(); g.fillStyle = rgba(C.ink, .12); g.fill(); } g.restore();
    text(g, label, 0, -34, { s: 28, w: 900, c: C.ink });
    g.restore();
  }, { al: o.al });
}
function formSheet(g, x, y, s, title, o = {}) {
  at(g, x, y, s, () => {
    card(g, -120, -40, 240, 80, { r: 6, fill: o.fill || C.paper, lw: 2.5, sb: 10, so: 4 });
    text(g, title, -104, -12, { f: o.f || 'mono', s: 24, w: 700, a: 'left', c: o.c || C.ink });
    for (let i = 0; i < 3; i++) path(g, [[-104, 14 + i * 9], [lerp(40, 100, hash(i + x)), 14 + i * 9]], { c: rgba(C.ink, .25), w: 2.5 });
    rr(g, 76, -28, 30, 30, 4); g.lineWidth = 2.5; g.strokeStyle = C.ink2; g.stroke();
  }, { rot: o.rot, al: o.al });
}
function balance(g, x, y, tilt, L, R, o = {}) {
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  path(g, [[x, y], [x, y - 170]], { c: C.ink, w: 7 }); rr(g, x - 70, y - 6, 140, 16, 6); g.fillStyle = C.wood; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  const a = tilt, bx = Math.cos(a) * 260, by = Math.sin(a) * 260;
  path(g, [[x - bx, y - 170 - by], [x + bx, y - 170 + by]], { c: C.brassD, w: 9 }); dot(g, x, y - 170, 12, C.brass); ring(g, x, y - 170, 12, C.ink, 3);
  for (const [sx, lab, col] of [[-1, L, C.red], [1, R, C.green]]) {
    const px = x + sx * bx, py = y - 170 + sx * by;
    path(g, [[px, py], [px - 70, py + 70]], { c: C.ink, w: 2.5 }); path(g, [[px, py], [px + 70, py + 70]], { c: C.ink, w: 2.5 });
    g.beginPath(); g.ellipse(px, py + 74, 90, 16, 0, 0, Math.PI); g.fillStyle = C.brass; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    const tw = Math.max(...lab.map(l => textW(g, l, { s: 26, w: 900 }))) + 34, th = lab.length * 36 + 18;
    card(g, px - tw / 2, py + 66 - th, tw, th, { r: 10, fill: col === C.red ? C.redL : C.greenL, lw: 3, stroke: col, sb: 10, so: 4 });
    lab.forEach((l, i) => text(g, l, px, py + 66 - th + 27 + i * 36, { s: 26, w: 900, c: col === C.red ? C.brickD : C.green }));
  }
  g.restore();
}
function burst(g, x, y, k, c, n = 12, r = 120) {
  if (k < 0 || k > .9) return;
  for (let i = 0; i < n; i++) {
    const ang = i / n * TAU + hash(i * 3.1) * .5, sp = r * (.6 + hash(i * 7.7) * .6), e = eo(k / .9);
    dot(g, x + Math.cos(ang) * sp * e, y + Math.sin(ang) * sp * e + 60 * k * k, (6 + hash(i) * 6) * (1 - e * .7), i % 3 ? c : C.brass, 1 - e);
  }
}
function ripple(g, x, y, k, c, r0 = 30, r1 = 120, d = .7) { if (k >= 0 && k < d) ring(g, x, y, r0 + (r1 - r0) * eo(k / d), c, 5, 1 - k / d); }
function sparks(g, x, y, k, n = 10) { if (k < 0 || k > .6) return; for (let i = 0; i < n; i++) { const a = hash(i * 2.3) * TAU, l = 30 + hash(i * 5.7) * 60, e = eo(k / .6); path(g, [[x + Math.cos(a) * l * e * .4, y + Math.sin(a) * l * e * .4], [x + Math.cos(a) * l * e, y + Math.sin(a) * l * e]], { c: i % 2 ? C.amber : C.red, w: 4, al: 1 - k / .6 }); } }

/* ---------------- 镜头 ---------------- */
function camAt(keys, lt) {
  if (!keys || !keys.length) return [W / 2, H / 2, 1];
  if (lt <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (lt <= keys[i][0]) { const a = keys[i - 1], b = keys[i], k = eio((lt - a[0]) / (b[0] - a[0])); return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)]; }
  }
  return keys[keys.length - 1].slice(1);
}

/* ---------------- 室内：墙纸 + 护墙板 + 柜台 ---------------- */
function interior(g, role, al = 1, o = {}) {
  const R = ROLE[role];
  g.save(); g.globalAlpha *= al;
  const x = o.x ?? 120, y = o.y ?? 150, w = o.w ?? 1680, h = o.h ?? 700;
  g.save(); shadow(g, .16, 40, 16); rr(g, x, y, w, h, 30); g.fillStyle = R.l; g.fill(); noShadow(g); g.restore();
  g.save(); rr(g, x, y, w, h, 30); g.clip();
  for (let xx = x + 30; xx < x + w; xx += 60) { g.fillStyle = rgba(R.d, .07); g.fillRect(xx, y, 24, h); }
  for (let yy = y + 40; yy < y + h * .62; yy += 80) for (let xx = x + 60 + ((yy / 80) % 2) * 30; xx < x + w; xx += 60) dot(g, xx, yy, 3, rgba(R.d, .14));
  const wy = y + h * .66; g.fillStyle = rgba(R.d, .22); g.fillRect(x, wy, w, h); path(g, [[x, wy], [x + w, wy]], { c: rgba(C.ink, .5), w: 3 });
  for (let xx = x + 40; xx < x + w; xx += 160) { rr(g, xx, wy + 26, 120, h * .34 - 50, 8); g.lineWidth = 2.5; g.strokeStyle = rgba(C.ink, .22); g.stroke(); }
  g.restore();
  rr(g, x, y, w, h, 30); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke();
  // 室名
  const lab = o.title || (R.sign + ' · 内部');
  const tw = textW(g, lab, { s: 28, w: 900 }) + 56;
  card(g, x + 30, y + 24, tw, 52, { r: 10, fill: C.paper, lw: 3, sb: 8, so: 3 }); dot(g, x + 54, y + 50, 9, R.c); text(g, lab, x + 70, y + 51, { s: 28, w: 900, a: 'left', c: R.d });
  g.restore();
}
/* 柜台/书桌：top 为台面 y */
function desk(g, x0, x1, top, al = 1) {
  g.save(); g.globalAlpha *= al;
  rr(g, x0, top, x1 - x0, 26, 6); g.fillStyle = C.woodL; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  rr(g, x0 + 20, top + 26, x1 - x0 - 40, 150, 4); g.fillStyle = C.wood; g.fill(); g.stroke();
  for (let xx = x0 + 60; xx < x1 - 60; xx += 140) { rr(g, xx, top + 50, 100, 100, 6); g.lineWidth = 2.5; g.strokeStyle = rgba(C.ink, .4); g.stroke(); }
  g.restore();
}
/* 收件篮 */
function basket(g, x, y, al = 1) {
  g.save(); g.globalAlpha *= al;
  g.beginPath(); g.moveTo(x - 80, y - 40); g.lineTo(x + 80, y - 40); g.lineTo(x + 66, y); g.lineTo(x - 66, y); g.closePath();
  g.fillStyle = C.woodL; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  for (let i = -3; i <= 3; i++) path(g, [[x + i * 20, y - 40], [x + i * 17, y]], { c: rgba(C.ink, .35), w: 2 });
  g.restore();
}

/* ---------------- 纸面质感、背景、后期 ---------------- */
function prepareStyle({ mk, cw, ch }) {
  const paper = mk(cw, ch), p = paper.getContext('2d'); p.scale(cw / W, ch / H);
  const lg = p.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#F6EEDD'); lg.addColorStop(1, '#ECDFC6');
  p.fillStyle = lg; p.fillRect(0, 0, W, H);
  for (let y = 24; y < H; y += 36) { p.fillStyle = rgba(C.brassD, .045); p.fillRect(0, y, W, 1.5); }
  for (let i = 0; i < 9000; i++) { const x = hash(i * 1.17) * W, y = hash(i * 2.31 + 9) * H; p.fillStyle = rgba(C.ink, .016 + hash(i * 5.3) * .024); p.fillRect(x, y, 1.4, 1.4); }
  for (let i = 0; i < 70; i++) { const x = hash(i * 8.1) * W, y = hash(i * 4.6) * H, r = 20 + hash(i * 2.2) * 60; const rg = p.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, rgba(C.brassD, .035)); rg.addColorStop(1, rgba(C.brassD, 0)); p.fillStyle = rg; p.fillRect(x - r, y - r, r * 2, r * 2); }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 420, 960, 540, 1250); vg.addColorStop(0, 'rgba(80,50,20,0)'); vg.addColorStop(1, 'rgba(80,50,20,.26)');
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
  const blobs = [[C.teal, 360, 300, .07], [C.brick, 1560, 760, .07], [C.brass, 1100, 140, .08]];
  blobs.forEach(([c, x, y, a], i) => {
    const bx = x + wob(t, .021, 120, i * 3), by = y + wob(t, .017, 80, i * 5);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, 620); rg.addColorStop(0, rgba(c, a)); rg.addColorStop(1, rgba(c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  // 漂移的淡邮戳水印
  for (let i = 0; i < 3; i++) {
    const x = (hash(i * 5.5) * W + t * 6 * (i + 1)) % (W + 400) - 200, y = 180 + hash(i * 2.7) * 640;
    g.save(); g.globalAlpha = .05; ring(g, x, y, 90, C.ink, 4); ring(g, x, y, 76, C.ink, 2);
    for (let k = 0; k < 4; k++) { const pts = []; for (let j = 0; j <= 24; j++) pts.push([x + 100 + j * 9, y - 30 + k * 20 + Math.sin(j * .8 + i) * 5]); path(g, pts, { c: C.ink, w: 3 }); }
    g.restore();
  }
  for (let i = 0; i < 34; i++) {
    const x = (hash(i * 3.3) * W + t * (8 + hash(i) * 14)) % W, y = (hash(i * 9.1) * H - t * (6 + hash(i * 2) * 10) + H * 10) % H;
    dot(g, x, y, 1.5 + hash(i * 4.4) * 2.5, C.brassD, .07 + .06 * Math.sin(t * .8 + i));
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
