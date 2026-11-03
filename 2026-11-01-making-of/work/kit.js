/* =====================================================================
 * Claude 是怎么做这 8 期视频的（v2）—— 画面工具：暖调像素小剧场
 * 深棕黑底 + 中心柔光 + 极淡代码纹理；主角是 Claude Code 的橙色像素吉祥物（“我”），
 * 帮手 ZCode（冷蓝、眼镜、书本放大镜）与 Codex（青绿、方头机器人、扳手键盘）是同一套像素画风的原创角色。
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t。逻辑坐标 1920×1080。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;
const BPM = 110, BEAT = 60 / BPM;   // 配乐节拍网格（audio.py 同一 BPM，从 0 秒起）

/* ---------------- 主题 ---------------- */
const C = {
  bg0: '#1B140F', bg1: '#110C09', panel: '#211913', panel2: '#2B2119', line: '#3B2F26',
  ink: '#F3E9DA', ink2: '#BFAE9C', ink3: '#857465',
  orange: '#D97757', orangeL: '#EB9A7D', orangeD: '#A9553A', ochre: '#E39A4B', amber: '#F2C14E',
  red: '#E8695A', green: '#8CCB7E', cream: '#F3E9DA', dark: '#1A120D',
  zc: '#6F9BF2', zcL: '#AFC8FF', zcD: '#3C5DAE',
  cx: '#3CC9A7', cxL: '#94EBD5', cxD: '#1E8A71',
  night: '#0C0F1C',
};
/* 标题字体集中在这里：大标题和关键句用衬线体 FSerif（700/900），正文字幕、小标签用 FCJK */
const TITLE_FONT = '"FSerif","FCJK","Noto Serif CJK SC",serif';
const F = {
  cjk: '"FCJK","FSup","Noto Sans CJK SC","PingFang SC",sans-serif',
  title: TITLE_FONT,
  disp: '"FDisp","Inter Display","Inter","FCJK",sans-serif',
  mono: '"FMono","FMonoCJK","DejaVu Sans Mono",monospace',
};
const fontsNeeded = [
  ...[500, 700, 900].map(w => `${w} 32px "FCJK"`),
  ...[800, 900].map(w => `${w} 32px "FDisp"`),
  ...[500, 700, 900].map(w => `${w} 32px "FSup"`),
  ...[700, 900].map(w => `${w} 32px "FSerif"`),
  ...[400, 700].flatMap(w => [`${w} 32px "FMono"`, `${w} 32px "FMonoCJK"`]),
];
/* 8 期主色（只用在分身帽子、工作台、小窗格） */
const EPC = { 'sip-v3': '#4F7BEF', curtain: '#5BB8F0', taskqueue: '#F2B705', cards: '#E0483A', subscription: '#3CB371', jsruntime: '#C8963E', frameanim: '#E8835F', fps: '#A994FF' };

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

/* =====================================================================
 * 像素角色
 * ===================================================================== */
/* 按字符画像素图：map 每行一个字符串，'.' 透明；pal 字符→颜色；左上角 (ox, oy)，格宽 cell */
function pxMap(g, map, pal, cell, ox = 0, oy = 0) {
  for (let r = 0; r < map.length; r++) { const row = map[r]; for (let c = 0; c < row.length; c++) { const ch = row[c]; if (ch === '.' || !pal[ch]) continue; g.fillStyle = pal[ch]; g.fillRect(ox + c * cell, oy + r * cell, cell + .6, cell + .6); } }
}
const beatPh = t => (t / BEAT) % 1;                         // 节拍相位
const beatBob = (t, a = 1) => -Math.abs(Math.sin(Math.PI * t / BEAT)) * a; // 每拍轻弹一下
/* 主角“我”：Claude Code 的橙色像素吉祥物（宽身体、两只竖眼、两侧小短手、四条小短腿）。
 * (x, y) 是脚底中心；s 缩放；t 全局时间（节拍、眨眼）；o: pose idle|walk|wave|type|sleep|hop、face normal|happy|sleep|wow、hat 颜色、dir、sq 挤压、prop 道具 */
const HERO_CELL = 9;
function hero(g, x, y, s, t, o = {}) {
  const P = HERO_CELL, pose = o.pose || 'idle', face = o.face || 'normal', dir = o.dir || 1;
  const walk = pose === 'walk', step = walk ? Math.floor((t / BEAT) * 2) % 2 : 0;
  const bob = pose === 'sleep' ? 0 : walk ? -(step ? 1 : 0) * P * .6 : pose === 'idle' || pose === 'wave' || pose === 'type' ? beatBob(t, P * .5) : 0;
  const sq = o.sq || 0;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.translate(x, y); g.scale(s * dir * (1 + sq), s * (1 - sq));
  // 地面阴影
  g.save(); g.scale(1, .25); dot(g, 0, 0, 7.5 * P, 'rgba(0,0,0,.35)'); g.restore();
  g.translate(-8 * P, -7 * P + bob);   // 像素坐标：列 0–15（0 和 15 是手），行 0–6
  const O = C.orange, K = C.dark;
  const fill = (c, r, w, h, col = O) => { g.fillStyle = col; g.fillRect(c * P, r * P, w * P + .6, h * P + .6); };
  // 腿（行 5–6）：四条，走路时两两交替抬起
  const legs = [3, 5, 10, 12];
  legs.forEach((c, i) => { const up = walk && ((i === 0 || i === 2) ? step : !step) ? 1 : 0; fill(c, 5, 1, 2 - up); });
  // 身体（行 0–4，列 2–13）
  fill(2, 0, 12, 5);
  // 手（行 3）：两侧伸出；挥手/打字时抬起或摆动
  const armL = pose === 'type' ? (Math.floor(t / BEAT * 2) % 2 ? 2 : 3) : 3;
  let armR = 3, armRx = 14;
  if (pose === 'wave') { const k = Math.floor(t / BEAT * 2) % 2; armR = k ? 1 : 2; armRx = k ? 14 : 14; }
  if (pose === 'type') armR = Math.floor(t / BEAT * 2) % 2 ? 3 : 2;
  if (pose === 'hop' || o.armsUp) { fill(0, 1, 2, 1); fill(14, 1, 2, 1); }
  else { fill(0, armL, 2, 1); fill(armRx, armR, 2, 1); if (pose === 'wave') fill(15, armR - 1, 1, 1); }
  // 脸
  const blink = (t + (o.seed || 0) * .7) % 3.3 < .12;
  if (face === 'sleep') { fill(4, 2, 2, 1, K); fill(10, 2, 2, 1, K); }
  else if (face === 'happy') { fill(4, 1, 1, 1, K); fill(3, 2, 1, 1, K); fill(5, 2, 1, 1, K); fill(11, 1, 1, 1, K); fill(10, 2, 1, 1, K); fill(12, 2, 1, 1, K); }
  else if (face === 'wow') { fill(4, 1, 2, 2, K); fill(10, 1, 2, 2, K); }
  else if (blink) { fill(4, 2, 1, 1, K); fill(11, 2, 1, 1, K); }
  else { fill(4, 1, 1, 2, K); fill(11, 1, 1, 2, K); }
  if (face === 'happy') { fill(3, 3, 1, 1, '#F2A48E'); fill(12, 3, 1, 1, '#F2A48E'); }
  // 帽子（行 -3..-1）
  if (o.hat) { const hc = o.hat; fill(4, -1, 8, 1, hc); fill(5, -3, 6, 2, hc); fill(5, -2, 6, 1, rgba('#000000', .25)); fill(6, -3, 1, 1, rgba('#FFFFFF', .35)); }
  // 道具（画在右手上）
  if (o.prop === 'pencil') { g.save(); g.translate(16 * P, 3 * P); g.rotate(-.6 + Math.sin(t * 9) * .15); fill(0, -4, 1, 4, C.amber); fill(0, -5, 1, 1, '#F3E9DA'); fill(0, 0, 1, 1, K); g.restore(); }
  if (o.prop === 'baton') { g.save(); g.translate(16 * P, 2 * P); g.rotate(-1.1 + Math.sin(t / BEAT * Math.PI) * .6); fill(0, -6, 1, 6, C.cream); g.restore(); }
  if (o.prop === 'lens') { g.save(); g.translate(16.5 * P, 1 * P); ring(g, 0, -2 * P, 2.2 * P, C.cream, P * .8, 1, 0, TAU); dot(g, 0, -2 * P, 1.6 * P, 'rgba(175,200,255,.25)'); fill(-.5, 0, 1, 3, C.ink2); g.restore(); }
  g.restore();
}
/* ZCode：读材料、提炼、核对。冷蓝色高个圆身体，一副大圆眼镜，头顶一撮毛，常抱着书或举着放大镜 */
const ZC_MAP = ['.....hh....', '....hh.....', '...bbbbb...', '..bbbbbbb..', 'bggggbggggb', 'bgwpgggwpgb', 'bggggbggggb', 'bbbbbbbbbbb', 'bbbbbmbbbbb', '.bbbbbbbbb.', '..bbbbbbb..', '..f.....f..'];
function zcode(g, x, y, s, t, o = {}) {
  const P = 7, bob = o.fly ? Math.sin(t * TAU / (BEAT * 2)) * 6 : beatBob(t + .1, 4);
  const blink = (t + 1.3) % 2.9 < .12;
  const pal = { h: C.zcD, b: C.zc, g: '#1F2D55', w: C.cream, p: blink ? C.cream : C.dark, m: C.zcD, f: C.zcD };
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.translate(x, y); g.scale(s * (o.dir || 1), s);
  g.save(); g.scale(1, .25); dot(g, 0, o.fly ? 60 : 0, 5 * P, 'rgba(0,0,0,.3)'); g.restore();
  g.translate(-5.5 * P, -12 * P + bob - (o.fly ? 30 : 0));
  pxMap(g, ZC_MAP, pal, P);
  if (blink) { g.fillStyle = C.dark; g.fillRect(2 * P, 5.4 * P, 2 * P, P * .3); g.fillRect(7 * P, 5.4 * P, 2 * P, P * .3); }
  if (o.prop === 'book') { pxMap(g, ['aaaaa', 'accca', 'aaaaa'], { a: C.amber, c: C.cream }, P, 6 * P, 8 * P); }
  if (o.wave) { const k = Math.floor(t / BEAT * 2) % 2; g.fillStyle = C.zc; g.fillRect(10 * P, (k ? 3 : 4.5) * P, 1.4 * P, 1.4 * P); g.fillRect(-1.4 * P, (k ? 4.5 : 3) * P, 1.4 * P, 1.4 * P); }
  if (o.prop === 'stack') { for (let k = 0; k < (o.n || 6); k++) pxMap(g, ['aaaaaaaa'], { a: [C.amber, C.cream, C.red, C.zcL][k % 4] }, P, -7 * P + (k % 2) * P, 9 * P - k * P * 1.3); }
  if (o.prop === 'lens') { g.save(); g.translate(11 * P, 6 * P); ring(g, 0, -2 * P, 2.4 * P, C.cream, P * .8, 1, 0, TAU); dot(g, 0, -2 * P, 1.8 * P, 'rgba(175,200,255,.22)'); g.fillStyle = C.ink2; g.fillRect(-.5 * P, .4 * P, P, 3 * P); g.restore(); }
  g.restore();
}
/* Codex：照规格写代码、写检查脚本。青绿色方头小机器人，头顶天线，屏幕脸，胸口一排小键盘，常拿扳手或清单 */
const CX_MAP = ['.....a....', '.....s....', '.tttttttt.', '.tkkkkkkt.', '.tkekkekt.', '.tkkkkkkt.', '.tttttttt.', '..wwwwww..', '..wyyyyw..', '..wwwwww..', '..q....q..'];
function codex(g, x, y, s, t, o = {}) {
  const P = 7, bob = beatBob(t + .27, 4), blink = (t + .4) % 3.1 < .12;
  const pal = { a: (Math.floor(t / BEAT) % 2) ? C.amber : '#B98E2E', s: C.ink3, t: C.cx, k: '#0F2E28', e: blink ? '#0F2E28' : C.cxL, w: C.cxD, y: C.cream, q: '#155C4C' };
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.translate(x, y); g.scale(s * (o.dir || 1), s);
  g.save(); g.scale(1, .25); dot(g, 0, 0, 5 * P, 'rgba(0,0,0,.3)'); g.restore();
  g.translate(-5 * P, -11 * P + bob);
  pxMap(g, CX_MAP, pal, P);
  if (o.prop === 'wrench') { g.save(); g.translate(9.5 * P, 8 * P); g.rotate(-.5 + Math.sin(t * 8) * .25); g.fillStyle = C.ink2; g.fillRect(-.5 * P, -4 * P, P, 4 * P); g.fillRect(-1.5 * P, -5 * P, P, 1.5 * P); g.fillRect(.5 * P, -5 * P, P, 1.5 * P); g.restore(); }
  if (o.wave) { const k = Math.floor(t / BEAT * 2) % 2; g.fillStyle = C.cxD; g.fillRect(9 * P, (k ? 5 : 7) * P, 1.4 * P, 1.4 * P); g.fillRect(-.4 * P, (k ? 7 : 5) * P, 1.4 * P, 1.4 * P); }
  if (o.prop === 'list') { g.fillStyle = C.cream; g.fillRect(-3 * P, 6 * P, 3 * P, 4 * P); g.fillStyle = C.cxD; for (let k = 0; k < 3; k++) g.fillRect(-2.5 * P, 6.6 * P + k * 1.2 * P, 2 * P, .5 * P); }
  g.restore();
}
/* 角色名牌（第一次出场时） */
function nameTag(g, s, x, y, col, p = 1) { tag(g, s, x, y, col, p, { fs: 26, r: 10, tc: C.dark }); }

/* =====================================================================
 * 道具与界面
 * ===================================================================== */
/* 对话窗 */
function chatWin(g, x, y, w, h, o = {}) {
  card(g, x, y, w, h, { r: 22, fill: '#1E1611', lw: 2, stroke: C.line, sa: .55, sb: 40, so: 14 });
  for (let k = 0; k < 3; k++) dot(g, x + 30 + k * 22, y + 28, 6, [C.red, C.amber, C.green][k], .7);
  text(g, o.title || 'Claude', x + w / 2, y + 30, { s: 24, w: 700, c: C.ink3 });
  path(g, [[x + 2, y + 56], [x + w - 2, y + 56]], { c: C.line, w: 2 });
  if (o.input !== false) {
    rr(g, x + 24, y + h - 82, w - 48, 58, 16); g.fillStyle = '#15100C'; g.fill(); rr(g, x + 24, y + h - 82, w - 48, 58, 16); g.lineWidth = 2; g.strokeStyle = C.line; g.stroke();
    if (o.placeholder !== false) text(g, '输入一句话……', x + 50, y + h - 52, { s: 26, w: 500, c: C.ink3, a: 'left' });
    if (Math.floor((o.t || 0) * 2.2) % 2) { g.fillStyle = C.orange; g.fillRect(x + 44, y + h - 70, o.placeholder === false ? 5 : 3, 36); }
  }
}
/* 气泡：who 'you'（右侧，奶白底）| 'me'（左侧，橙底）；n 显示到第几个字；返回高度 */
function bubble(g, x, y, s, who, n = 1e9, o = {}) {
  const fs = o.fs || 30, lines = String(s).split('\n'), mw = Math.max(...lines.map(l => textW(g, l, { s: fs, w: 700 })));
  const w = mw + 52, h = lines.length * (fs + 12) + 30, al = o.al ?? 1;
  const bx = who === 'you' ? x - w : x;
  g.save(); g.globalAlpha *= al;
  g.translate(0, (1 - (o.p ?? 1)) * 16);
  shadow(g, .4, 18, 6); rr(g, bx, y, w, h, 18); g.fillStyle = who === 'you' ? C.cream : C.orange; g.fill(); noShadow(g);
  let left = n;
  lines.forEach((l, i) => { const arr = Array.from(l), k = Math.max(0, Math.min(arr.length, left)); left -= arr.length; if (k > 0) text(g, arr.slice(0, k).join(''), bx + 26, y + 15 + fs / 2 + i * (fs + 12) + 2, { s: fs, w: 700, c: C.dark, a: 'left' }); });
  g.restore();
  return h;
}
/* 正在输入的三个点 */
function typingDots(g, x, y, t, al = 1) { g.save(); g.globalAlpha *= al; rr(g, x, y, 96, 50, 18); g.fillStyle = C.orange; g.fill(); for (let k = 0; k < 3; k++) dot(g, x + 28 + k * 20, y + 25 - Math.max(0, Math.sin(t * 8 - k)) * 6, 5, C.dark); g.restore(); }
/* 你的气泡（右上角浮出的原话） */
function youSay(g, s, p, o = {}) {
  if (p <= 0) return;
  const x = o.x ?? 1840, y = o.y ?? 152;
  at(g, x, y, pop(Math.min(1, p)), () => { bubble(g, 0, 0, s, 'you', 1e9, { fs: o.fs || 28 }); text(g, '你', -12, -14, { s: 24, w: 700, c: C.ink3, a: 'right' }); }, { al: o.al });
}
/* 窗格：顶部标题栏（期名 + 主色点），内容裁切 */
function pane(g, x, y, w, h, title, col, content, o = {}) {
  card(g, x, y, w, h, { r: 14, fill: '#17110D', lw: 2, stroke: o.stroke || C.line, sa: .5, sb: 26, so: 10 });
  rr(g, x, y, w, 40, 14); g.fillStyle = '#251C16'; g.fill();
  dot(g, x + 22, y + 20, 7, col);
  text(g, title, x + 38, y + 21, { f: 'mono', s: 24, w: 700, a: 'left', c: C.ink2 });
  if (o.done) { dot(g, x + w - 24, y + 20, 12 * pop(o.done), C.green); icCheck(g, x + w - 24, y + 21, 14, C.dark, o.done, 3); }
  g.save(); rr(g, x + 6, y + 44, w - 12, h - 50, 10); g.clip(); g.translate(x + 6, y + 44); content(g, w - 12, h - 50); g.restore();
}
/* 期画面逐行“长出来”：reveal∈[0,1]，按 8 行扫描 */
function growThumb(g, slug, w, h, lt, reveal) {
  if (reveal <= 0) { g.fillStyle = '#100B08'; g.fillRect(0, 0, w, h); return; }
  const rows = 9, full = reveal * rows;
  g.save(); g.beginPath();
  for (let r = 0; r < rows; r++) { const k = clamp(full - r); if (k <= 0) break; g.rect(0, r * h / rows, w * k, h / rows + .5); }
  g.clip(); thumb(g, slug, w, h, lt); g.restore();
  if (reveal < 1) { const r = Math.floor(full), k = full - r, yy = r * h / rows; g.fillStyle = rgba(C.orange, .8); g.fillRect(w * k - 3, yy, 6, h / rows); }
}
/* 一卷片子 */
function reel(g, x, y, r, col, t = 0, o = {}) {
  at(g, x, y, 1, () => {
    g.rotate(o.spin ? t * o.spin : 0);
    dot(g, 0, 0, r, col); ring(g, 0, 0, r, rgba('#000000', .35), r * .12, 1, 0, TAU);
    dot(g, 0, 0, r * .62, '#2A1F18');
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; dot(g, Math.cos(a) * r * .38, Math.sin(a) * r * .38, r * .14, col); }
    dot(g, 0, 0, r * .14, C.cream);
  }, { al: o.al });
}
/* 手册（open∈[0,1]） */
function handbook(g, x, y, s, open, o = {}) {
  at(g, x, y, s, () => {
    const W2 = 260, H2 = 340;
    if (open < .02) {
      card(g, -W2 / 2, -H2 / 2, W2, H2, { r: 10, fill: C.orange, lw: 0, sa: .5, sb: 30, so: 12 });
      g.fillStyle = C.orangeD; g.fillRect(-W2 / 2, -H2 / 2, 26, H2);
      text(g, '手册', 12, -40, { f: 'title', s: 64, w: 900, c: C.dark });
      g.fillStyle = C.dark; g.fillRect(-60, 10, 144, 6); g.fillRect(-40, 34, 104, 6);
      return;
    }
    const k = eio(open);
    card(g, -W2 * k, -H2 / 2, W2 * k, H2, { r: 8, fill: '#F1E5D2', lw: 0, sa: .5, sb: 30, so: 12 });
    card(g, 0, -H2 / 2, W2, H2, { r: 8, fill: '#F6ECDD', lw: 0, shadow: false });
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(-6, -H2 / 2, 12, H2);
    if (o.left) o.left(g, W2, H2, k); if (o.right) o.right(g, W2, H2, k);
  }, { al: o.al, rot: o.rot });
}
/* 便签 */
function note(g, x, y, s, col = C.amber, o = {}) {
  at(g, x, y, s, () => {
    g.save(); shadow(g, .4, 12, 5); g.fillStyle = col; g.fillRect(-60, -60, 120, 120); g.restore();
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(-60, -60, 120, 18);
    if (s >= .8) text(g, o.title || '经验', 0, -18, { s: 30, w: 900, c: C.dark }); else { g.fillStyle = 'rgba(26,18,13,.7)'; g.fillRect(-30, -26, 60, 12); }
    g.fillStyle = 'rgba(26,18,13,.55)'; for (let k = 0; k < 3; k++) g.fillRect(-42, 12 + k * 16, 84 - k * 20, 6);
  }, { rot: o.rot || 0, al: o.al });
}
/* 电量格 */
function battery(g, x, y, lvl, o = {}) {
  rr(g, x, y, 110, 52, 10); g.fillStyle = '#15100C'; g.fill(); rr(g, x, y, 110, 52, 10); g.lineWidth = 4; g.strokeStyle = C.ink2; g.stroke();
  g.fillStyle = C.ink2; g.fillRect(x + 110, y + 16, 8, 20);
  const n = Math.round(clamp(lvl) * 4);
  for (let k = 0; k < 4; k++) { g.fillStyle = k < n ? (n <= 1 ? C.red : C.green) : 'rgba(255,255,255,.06)'; g.fillRect(x + 9 + k * 24, y + 9, 20, 34); }
}
/* 护栏 */
function barrier(g, x, y, lift = 0) {
  g.fillStyle = C.ink3; g.fillRect(x - 70, y - 120, 14, 120); g.fillRect(x + 56, y - 120, 14, 120);
  g.save(); g.translate(x - 63, y - 96); g.rotate(-lift * 1.3);
  for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? C.cream : C.red; g.fillRect(k * 18, -12, 18, 24); }
  g.restore();
}
/* 步骤轨道 */
const STEPS = ['写稿', '核对', '画面', '配乐', '检查', '渲染'];
const stepX = i => 460 + i * 200, STEP_Y = 186;
function stepTrack(g, cur, lt, o = {}) {
  path(g, [[stepX(0), STEP_Y], [stepX(5), STEP_Y]], { c: C.line, w: 4, dash: [2, 12] });
  STEPS.forEach((s, i) => {
    const on = i === cur, done = i < cur, w = 150, h = 50, x = stepX(i);
    g.save(); g.globalAlpha *= o.al ?? 1;
    rr(g, x - w / 2, STEP_Y - h / 2, w, h, 25); g.fillStyle = on ? C.orange : done ? '#3A2B20' : '#221A14'; g.fill();
    rr(g, x - w / 2, STEP_Y - h / 2, w, h, 25); g.lineWidth = 2; g.strokeStyle = on ? C.orangeL : C.line; g.stroke();
    text(g, `${i + 1} ${s}`, x, STEP_Y + 1, { s: 26, w: 900, c: on ? C.dark : done ? C.ink2 : C.ink3 });
    g.restore();
  });
}
/* 代码窗 */
function codeWin(g, x, y, w, h, lines, n, o = {}) {
  card(g, x, y, w, h, { r: 14, fill: '#120D0A', lw: 2, stroke: C.line });
  for (let k = 0; k < 3; k++) dot(g, x + 24 + k * 20, y + 22, 5, C.ink3, .6);
  let left = n;
  lines.forEach((ln, i) => {
    const arr = Array.from(ln), k = Math.max(0, Math.min(arr.length, left)); left -= arr.length; if (k <= 0) return;
    const s = arr.slice(0, k).join('');
    text(g, s, x + 30, y + 72 + i * 44, { f: 'mono', s: 28, w: 700, a: 'left', c: ln.trim().startsWith('//') ? C.ink3 : i === 0 ? C.orangeL : C.ink });
  });
}
/* 手形光标 */
function cursorHand(g, x, y, s, press = 0) {
  at(g, x, y, s * (1 - press * .1), () => {
    pxMap(g, ['..cc....', '..cc....', '..cccc..', '..cccccc', 'cccccccc', '.ccccccc', '..cccccc', '...cccc.'], { c: C.cream }, 8, -16, -8);
  });
}
/* 夜空（天色 k∈[0,1]） */
function nightSky(g, k, t) {
  if (k <= 0) return;
  g.save(); g.globalAlpha *= k; g.fillStyle = 'rgba(8,10,22,.6)'; g.fillRect(-200, -200, W + 400, H + 400);
  for (let i = 0; i < 40; i++) { const x = hash(i * 3.7) * W, y = hash(i * 5.1) * 520 + 120; dot(g, x, y, 1.5 + hash(i) * 1.8, C.cream, .3 + .4 * Math.abs(Math.sin(t * 1.3 + i))); }
  g.restore();
}
function moon(g, x, y, r, al = 1) { g.save(); g.globalAlpha *= al; const rg = g.createRadialGradient(x, y, r * .5, x, y, r * 3); rg.addColorStop(0, 'rgba(243,233,218,.18)'); rg.addColorStop(1, 'rgba(243,233,218,0)'); g.fillStyle = rg; g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6); dot(g, x, y, r, C.cream); dot(g, x + r * .45, y - r * .2, r * .85, '#141020'); g.restore(); }
function sun(g, x, y, r, t, al = 1) { g.save(); g.globalAlpha *= al; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + t * .5; path(g, [[x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3], [x + Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7]], { c: C.amber, w: 6 }); } dot(g, x, y, r, C.amber); g.restore(); }
function poof(g, x, y, k, r = 90) { if (k < 0 || k > .8) return; for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + hash(i) * .6, e = eo(k / .8); dot(g, x + Math.cos(a) * r * e, y + Math.sin(a) * r * e * .7, (26 + hash(i * 3) * 18) * (1 - e * .6), C.cream, .55 * (1 - e)); } }
function zzz(g, x, y, t, al = 1) { for (let k = 0; k < 3; k++) { const ph = (t * .6 + k / 3) % 1; text(g, 'Z', x + ph * 50 + k * 4, y - ph * 90, { f: 'title', s: 30 + k * 6, w: 900, c: C.zcL, al: al * Math.sin(ph * Math.PI) }); } }
function scissors(g, x, y, s, open) { at(g, x, y, s, () => { for (const sg of [-1, 1]) { g.save(); g.rotate(sg * open * .5); g.fillStyle = C.ink2; g.fillRect(0, -3, 60, 6); ring(g, -14, sg * 10, 10, C.red, 5, 1, 0, TAU); g.restore(); } }); }
function cloud(g, x, y, s, col = C.zcL) { at(g, x, y, s, () => { g.fillStyle = col; g.beginPath(); g.arc(-40, 10, 34, 0, TAU); g.arc(0, -10, 46, 0, TAU); g.arc(44, 12, 32, 0, TAU); g.fill(); g.fillRect(-40, 10, 84, 34); }); }

/* =====================================================================
 * 背景、后期
 * ===================================================================== */
function prepareStyle({ mk, cw, ch }) {
  const base = mk(cw, ch), p = base.getContext('2d'); p.scale(cw / W, ch / H);
  const lg = p.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#1C1510'); lg.addColorStop(1, '#0F0B08'); p.fillStyle = lg; p.fillRect(0, 0, W, H);
  // 极淡的代码纹理（两屏高，滚动用）
  const code = mk(cw, ch * 2), q = code.getContext('2d'); q.scale(cw / W, ch / H);
  for (let r = 0; r < 64; r++) { let x = 70 + hash(r * 2.3) * 60 * (r % 3); const y = 20 + r * 33; const n = 2 + Math.floor(hash(r * 5.1) * 5);
    for (let k = 0; k < n; k++) { const w = 30 + hash(r * 7 + k) * 150; q.fillStyle = `rgba(243,233,218,${.022 + hash(r + k * 3) * .02})`; q.beginPath(); q.roundRect(x, y, w, 10, 5); q.fill(); x += w + 16; }
    let x2 = 1150 + hash(r * 9.7) * 80; const n2 = 1 + Math.floor(hash(r * 4.3) * 4);
    for (let k = 0; k < n2; k++) { const w = 30 + hash(r * 11 + k) * 140; q.fillStyle = `rgba(243,233,218,${.02 + hash(r * 2 + k) * .018})`; q.beginPath(); q.roundRect(x2, y, w, 10, 5); q.fill(); x2 += w + 16; } }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 360, 960, 540, 1150); vg.addColorStop(0, 'rgba(6,4,2,0)'); vg.addColorStop(1, 'rgba(6,4,2,.6)'); v.fillStyle = vg; v.fillRect(0, 0, W, H);
  const grain = [];
  for (let k = 0; k < 4; k++) { const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt); }
  return { base, code, vign, grain };
}
function drawBackground(g, { cache, t }) {
  g.drawImage(cache.base, 0, 0, W, H);
  const off = (t * 9) % H;
  g.drawImage(cache.code, 0, -off, W, H * 2);
  const br = .85 + .15 * Math.sin(t * TAU / (BEAT * 8));
  const rg = g.createRadialGradient(960, 500, 0, 960, 500, 760); rg.addColorStop(0, `rgba(227,154,75,${.13 * br})`); rg.addColorStop(.5, `rgba(217,119,87,${.05 * br})`); rg.addColorStop(1, 'rgba(217,119,87,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) { const x = (hash(i * 3.3) * W + t * (5 + hash(i) * 10)) % W, y = (hash(i * 9.1) * H - t * (4 + hash(i * 2) * 8) + H * 10) % H; dot(g, x, y, 1.4 + hash(i * 4.4) * 2, '#F3D9B8', .05 + .05 * Math.sin(t * .8 + i)); }
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

/* ---------------- 8 期缩略画面（沿用 v1，只用在小窗格里） ---------------- */
/* ---------------- 七段数码管（fps 缩略图用） ---------------- */
const SEG7 = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
function seg7(g, x, y, hh, str, col, ghost = .1) {
  const ww = hh * .52, th = hh * .12;
  let cx = x;
  for (const ch of str) {
    if (ch === '.') { dot(g, cx - hh * .08, y + hh / 2 - th * .55, th * .85, col); cx += hh * .12; continue; }
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

