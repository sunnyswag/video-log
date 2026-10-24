/* =====================================================================
 * Kotlin 实现 SIP 通信协议 v2 —— 画面工具：主题、纸面质感、镜头、角色与图元
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题 ---------------- */
const C = {
  bg: '#F3ECE0', bg2: '#E6DAC6', paper: '#FFFDF8', ink: '#1E2333', ink2: '#5A6072', line: '#C9BEAC',
  blue: '#3563E9', blueL: '#E2E9FF', orange: '#EE7D33', orangeL: '#FFE6D2', coral: '#EB4A57', coralL: '#FFE0E2',
  green: '#14A579', greenL: '#D6F4E8', amber: '#EF9F12', amberL: '#FFEFCB', purple: '#7356F0', purpleL: '#EAE4FF',
  grey: '#9AA0AD', greyL: '#ECEDEF',
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
const ROLE = { A: { c: C.blue, l: C.blueL, name: '主叫屏 A' }, B: { c: C.orange, l: C.orangeL, name: '被叫屏 B' } };
// 消息：码、名、色
const MSG = {
  invite: ['101', 'INVITE', C.blue], ring: ['102', 'RING', C.blue], accept: ['200', 'ACCEPT', C.green],
  confirm: ['201', 'PREPARE_CONFIRM', C.green], cancel: ['402', 'TERMINATE_END', C.coral], timeout: ['404', 'TIMEOUT_END', C.purple],
};
// 舞台：三个角色的位置（世界坐标）
const P = { A: [440, 455], G: [960, 420], B: [1480, 455] };

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
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = (o.gb || 18) * SH(); }
  g.fillStyle = o.c || C.ink; g.fillText(s, x, y);
  g.restore();
}
function textW(g, s, o = {}) { g.save(); g.font = font(o); if (o.ls) g.letterSpacing = o.ls + 'px'; const w = g.measureText(s).width; g.restore(); return w; }

/* ---------------- 形状 ---------------- */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
function shadow(g, a = .16, blur = 26, oy = 10) { g.shadowColor = rgba(C.ink, a); g.shadowBlur = blur * SH(); g.shadowOffsetY = oy * SH(); }
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; }
/* 圆角卡片：柔和投影 + 墨线描边 */
function card(g, x, y, w, h, o = {}) {
  if (w <= 0 || h <= 0) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, o.r ?? 24);
  if (o.shadow !== false) shadow(g, o.sa ?? .14, o.sb ?? 24, o.so ?? 9);
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
  g.strokeStyle = o.c || C.ink; g.lineWidth = o.w || 3; g.lineCap = 'round'; g.lineJoin = 'round';
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
function arrowHead(g, x, y, ang, c, s = 16, al = 1) {
  g.save(); g.globalAlpha *= al; g.translate(x, y); g.rotate(ang); g.beginPath();
  g.moveTo(0, 0); g.lineTo(-s, -s * .6); g.lineTo(-s * .72, 0); g.lineTo(-s, s * .6); g.closePath(); g.fillStyle = c; g.fill(); g.restore();
}
/* 带箭头的线，p 为画出进度 */
function arrow(g, pts, o = {}) {
  const q = partial(pts, o.p ?? 1); if (q.length < 2) return;
  path(g, q, o);
  const a = q[q.length - 2], b = q[q.length - 1];
  if ((o.p ?? 1) > .02) arrowHead(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), o.c || C.ink, o.hs || 18, o.al ?? 1);
}
/* 以 (x,y) 为中心缩放/旋转后绘制 */
function at(g, x, y, s, fn, o = {}) {
  if (s <= .001 || (o.al != null && o.al <= .001)) return;
  g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); g.scale(s * (o.sx || 1), s * (o.sy || 1));
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  fn(); g.restore();
}

/* ---------------- 小图标 ---------------- */
function icCheck(g, x, y, s, c = C.green, p = 1, lw) {
  const pts = [[x - s * .45, y], [x - s * .12, y + s * .32], [x + s * .5, y - s * .38]];
  path(g, partial(pts, p), { c, w: lw || s * .2 });
}
function icCross(g, x, y, s, c = C.coral, p = 1, lw) {
  const k = s * .42;
  path(g, partial([[x - k, y - k], [x + k, y + k]], clamp(p * 2)), { c, w: lw || s * .2 });
  path(g, partial([[x + k, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c, w: lw || s * .2 });
}
function badge(g, x, y, r, c, kind, p = 1) { // 圆形徽标：勾/叉/问号
  at(g, x, y, pop(p), () => {
    dot(g, 0, 0, r, c); ring(g, 0, 0, r, C.ink, 3);
    if (kind === 'check') icCheck(g, 0, 2, r * 1.1, '#fff', 1, r * .22);
    else if (kind === 'cross') icCross(g, 0, 0, r * 1.1, '#fff', 1, r * .22);
    else text(g, kind, 0, 2, { f: 'disp', w: 900, s: r * 1.3, c: '#fff' });
  });
}
function person(g, x, y, r, c) { // 头像
  dot(g, x, y, r, c); dot(g, x, y - r * .22, r * .34, '#fff');
  g.save(); g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip(); dot(g, x, y + r * .72, r * .62, '#fff'); g.restore();
}
function bellIcon(g, x, y, s, c, rot = 0) {
  at(g, x, y, s, () => {
    g.beginPath(); g.moveTo(-20, 14); g.quadraticCurveTo(-20, -22, 0, -24); g.quadraticCurveTo(20, -22, 20, 14); g.lineTo(26, 20); g.lineTo(-26, 20); g.closePath();
    g.fillStyle = c; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); dot(g, 0, 26, 6, C.ink);
  }, { rot });
}
function lockIcon(g, x, y, s, c, open = 0) {
  at(g, x, y, s, () => {
    g.save(); g.translate(0, -open * 14); g.beginPath(); g.arc(0, -16, 22, Math.PI, 0); g.lineWidth = 9; g.strokeStyle = C.ink; g.stroke(); g.restore();
    card(g, -32, -16, 64, 52, { r: 10, fill: c, lw: 3, shadow: false }); dot(g, 0, 6, 7, C.ink); g.fillStyle = C.ink; g.fillRect(-3, 6, 6, 14);
  });
}
function keyIcon(g, x, y, s, c) {
  at(g, x, y, s, () => {
    ring(g, -24, 0, 14, c, 8); path(g, [[-10, 0], [34, 0]], { c, w: 8 }); path(g, [[22, 0], [22, 12]], { c, w: 7 }); path(g, [[32, 0], [32, 10]], { c, w: 7 });
  });
}

/* ---------------- 屏幕界面 ---------------- */
/* 屏幕内容区：300×180，原点在中心。mode: idle/calling/ringing/prepare/chat/cancelled/ended/creating/timeout/app */
function screenUI(g, mode, col, t, o = {}) {
  const L = o.label;
  if (mode === 'idle') {
    text(g, '10:24', 0, -14, { f: 'disp', w: 800, s: 64, c: C.ink });
    text(g, '周六 · 晴', 0, 40, { s: 22, w: 500, c: C.ink2 });
  } else if (mode === 'app') {
    card(g, -34, -58, 68, 68, { r: 18, fill: C.green, lw: 0, shadow: false });
    g.save(); g.translate(0, -24); g.rotate(-.6); rr(g, -20, -8, 40, 16, 8); g.fillStyle = '#fff'; g.fill(); g.restore();
    text(g, L || '语音通话', 0, 44, { s: 26, w: 700 });
  } else if (mode === 'calling' || mode === 'ringing') {
    const ringing = mode === 'ringing';
    for (let k = 0; k < 3; k++) { const ph = ((t * .9 + k / 3) % 1); ring(g, 0, -22, 34 + ph * 46, col, 3, (1 - ph) * .55); }
    person(g, 0, -22, 34, col);
    if (ringing) bellIcon(g, 52, -52, .62, C.amber, Math.sin(t * 34) * .32 * (Math.sin(t * 3.2) > 0 ? 1 : .15));
    const dots = '.'.repeat(1 + Math.floor(t * 2.5) % 3);
    text(g, (L || (ringing ? '来电' : '呼叫中')) + (ringing ? '' : dots), ringing ? 0 : -4, 52, { s: 28, w: 700, a: 'center' });
  } else if (mode === 'prepare') {
    const a0 = t * 5.2; ring(g, 0, -20, 30, col, 7, .18); ring(g, 0, -20, 30, col, 7, 1, a0, a0 + 1.9);
    text(g, L || '准备中', 0, 46, { s: 28, w: 700 });
  } else if (mode === 'chat') {
    for (let i = 0; i < 11; i++) {
      const hh = 10 + 40 * Math.abs(Math.sin(t * 6.3 + i * .9) * Math.cos(t * 2.1 + i * 1.7));
      rr(g, -100 + i * 19, -22 - hh / 2, 11, hh, 6); g.fillStyle = col; g.fill();
    }
    text(g, (L || '通话中') + ' 00:0' + (Math.floor(t) % 10), 0, 50, { s: 26, w: 700 });
  } else if (mode === 'cancelled' || mode === 'ended' || mode === 'timeout') {
    const c = mode === 'cancelled' ? C.grey : mode === 'ended' ? C.green : C.purple;
    person(g, 0, -24, 32, c);
    if (mode === 'cancelled') { dot(g, 26, 2, 15, C.coral); icCross(g, 26, 2, 16, '#fff', 1, 4); }
    else { dot(g, 26, 2, 15, c); icCheck(g, 26, 3, 16, '#fff', 1, 4); }
    text(g, L || (mode === 'cancelled' ? '已取消' : mode === 'ended' ? '已结束' : '超时结束'), 0, 46, { s: 28, w: 700, c: mode === 'cancelled' ? C.ink2 : C.ink });
  } else if (mode === 'creating') {
    text(g, L || '建会话…', 0, -18, { s: 28, w: 700 });
    rr(g, -100, 16, 200, 16, 8); g.fillStyle = C.greyL; g.fill();
    rr(g, -100, 16, 200 * clamp(o.p ?? (t * .4 % 1)), 16, 8); g.fillStyle = col; g.fill();
  }
}

/* ---------------- 角色：智能屏 ---------------- */
/* ui: {mode, label, from, at}：from 不为空时在 at 秒处从旧界面切到新界面（局部时间 lt 由调用方给） */
function device(g, role, x, y, s, ui, lt, o = {}) {
  const R = ROLE[role], bob = o.still ? 0 : wob(lt, .22, 3, role === 'A' ? 0 : .5);
  at(g, x, y + bob, s, () => {
    // 机身
    card(g, -175, -125, 350, 250, { r: 38, fill: R.l, lw: 3.5, sa: .2, sb: 36, so: 16 });
    rr(g, -175, -125, 350, 250, 38); g.save(); g.clip();
    const sh = g.createLinearGradient(0, -125, 0, 125); sh.addColorStop(0, 'rgba(255,255,255,.55)'); sh.addColorStop(.35, 'rgba(255,255,255,0)'); sh.addColorStop(1, rgba(C.ink, .06));
    g.fillStyle = sh; g.fillRect(-175, -125, 350, 250); g.restore();
    // 屏幕
    rr(g, -152, -100, 304, 184, 22); g.fillStyle = '#FFFFFF'; g.fill();
    g.save(); rr(g, -152, -100, 304, 184, 22); g.clip(); g.translate(0, -6);
    const k = ui.from && ui.at != null ? eo(seg(lt, ui.at, ui.at + .35)) : 1;
    if (k < 1) { g.save(); g.globalAlpha *= 1 - k; g.translate(0, -18 * k); screenUI(g, ui.from, R.c, lt, ui.fromOpt || {}); g.restore(); }
    if (k > 0) { g.save(); g.globalAlpha *= k; g.translate(0, 18 * (1 - k)); screenUI(g, ui.mode, R.c, lt, ui); g.restore(); }
    g.restore();
    // 玻璃反光（斜向高光缓慢扫过）
    g.save(); rr(g, -152, -100, 304, 184, 22); g.clip();
    const sx = -420 + ((lt * 60 + (role === 'A' ? 0 : 260)) % 1100);
    const gr = g.createLinearGradient(sx, -100, sx + 160, 84); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-152, -100, 304, 184); g.restore();
    rr(g, -152, -100, 304, 184, 22); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    dot(g, 0, -112, 4, C.ink, .7);
    for (let i = -2; i <= 2; i++) dot(g, i * 12, 106, 3, C.ink, .45);
  }, { al: o.al });
  if (o.label !== false) text(g, R.name, x, y + bob + 158 * s, { s: 30, w: 900, c: R.c, al: o.al });
}
/* 网关：路由器 + 天线 + 指示灯；busy 时指示灯快闪、外圈发光 */
function gateway(g, x, y, s, lt, o = {}) {
  const busy = o.busy || 0;
  at(g, x, y, s, () => {
    if (busy > 0) { for (let k = 0; k < 2; k++) { const ph = (lt * 1.4 + k / 2) % 1; ring(g, 0, 0, 110 + ph * 70, C.purple, 4, (1 - ph) * .4 * busy); } }
    for (const sx of [-1, 1]) {
      g.save(); g.translate(sx * 62, -40); g.rotate(sx * .2 + wob(lt, .5, .03, sx));
      rr(g, -8, -86, 16, 88, 8); g.fillStyle = C.purpleL; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
      dot(g, 0, -90, 11, C.purple); ring(g, 0, -90, 11, C.ink, 3); g.restore();
    }
    card(g, -120, -50, 240, 110, { r: 28, fill: C.purpleL, lw: 3.5, sa: .2, sb: 34, so: 14 });
    for (let i = 0; i < 4; i++) {
      const on = busy > .2 ? hash(Math.floor(lt * 14) + i * 5) > .35 : hash(Math.floor(lt * 3) + i * 7) > .5;
      dot(g, -60 + i * 40, 6, 10, on ? [C.green, C.amber, C.blue, C.purple][i] : C.greyL); ring(g, -60 + i * 40, 6, 10, C.ink, 2.5);
    }
  }, { al: o.al });
  if (o.label !== false) text(g, '网关', x, y + 112 * s, { s: 30, w: 900, c: C.purple, al: o.al });
}

/* ---------------- 状态标签（可翻转切换） ---------------- */
const STATE_TONE = { IDLE: C.grey, CALLING: C.blue, RINGING: C.orange, PREPARE: C.amber, CHATTING: C.green };
function stateTone(s) { return s.startsWith('ENDED') ? (s.includes('SELF') ? C.coral : s.includes('TIMEOUT') ? C.purple : C.green) : STATE_TONE[s] || C.ink; }
function chipRaw(g, x, y, s, o = {}) {
  const c = o.c || stateTone(s), w = textW(g, s, { f: 'mono', s: 26, w: 700 }) + 56, h = 50;
  card(g, x - w / 2, y - h / 2, w, h, { r: 25, fill: '#fff', lw: 3, stroke: o.glow ? c : C.ink, sb: 14, so: 5, sa: .12 });
  dot(g, x - w / 2 + 22, y, 7, c);
  text(g, s, x + 10, y + 1, { f: 'mono', s: 26, w: 700, c: C.ink });
  if (o.glow) { g.save(); rr(g, x - w / 2, y - h / 2, w, h, 25); g.shadowColor = rgba(c, .7 * o.glow); g.shadowBlur = 26 * SH(); g.lineWidth = 3; g.strokeStyle = c; g.stroke(); g.restore(); }
  return w;
}
/* 切换：from → to，在 t0 处纵向翻转 */
function chip(g, x, y, lt, to, from, t0 = 0, o = {}) {
  if (!from || lt >= t0 + .36) return at(g, x, y, 1, () => chipRaw(g, 0, 0, to, o), { al: o.al });
  if (lt < t0) return at(g, x, y, 1, () => chipRaw(g, 0, 0, from, o), { al: o.al });
  const k = (lt - t0) / .36;
  if (k < .5) at(g, x, y, 1, () => chipRaw(g, 0, 0, from, o), { sy: 1 - k * 2, al: o.al });
  else at(g, x, y, 1, () => chipRaw(g, 0, 0, to, o), { sy: (k - .5) * 2, al: o.al });
}

/* ---------------- 消息胶囊与飞行 ---------------- */
function capsule(g, x, y, kind, o = {}) {
  const [code, name, col] = MSG[kind], fs = 27;
  const nw = textW(g, name, { f: 'mono', s: fs, w: 700 }), w = 84 + nw + 30, h = 58;
  at(g, x, y, o.s ?? 1, () => {
    if (o.glow) { g.save(); rr(g, -w / 2, -h / 2, w, h, 29); g.shadowColor = rgba(col, .6 * o.glow); g.shadowBlur = 34 * SH(); g.fillStyle = col; g.fill(); g.restore(); }
    card(g, -w / 2, -h / 2, w, h, { r: 29, fill: '#fff', lw: 3, sb: 18, so: 7, sa: .18 });
    rr(g, -w / 2 + 6, -h / 2 + 6, 72, h - 12, 23); g.fillStyle = col; g.fill();
    text(g, code, -w / 2 + 42, 1, { f: 'mono', s: fs, w: 700, c: '#fff' });
    text(g, name, -w / 2 + 84 + nw / 2, 1, { f: 'mono', s: fs, w: 700 });
    if (o.tag) { // 右上角会话标签（如 S1）
      const tw2 = textW(g, o.tag, { f: 'mono', s: 22, w: 700 }) + 22;
      card(g, w / 2 - tw2 + 6, -h / 2 - 22, tw2, 34, { r: 17, fill: C.purple, lw: 2.5, shadow: false });
      text(g, o.tag, w / 2 - tw2 / 2 + 6, -h / 2 - 5, { f: 'mono', s: 22, w: 700, c: '#fff' });
    }
  }, { rot: o.rot, sx: o.sx, sy: o.sy, al: o.al });
  return w * (o.s ?? 1);
}
const bez = (a, m, b, u) => { const v = 1 - u; return [v * v * a[0] + 2 * v * u * m[0] + u * u * b[0], v * v * a[1] + 2 * v * u * m[1] + u * u * b[1]]; };
function arcPos(a, b, u, lift) { return bez(a, [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift], b, u); }
/* 沿弧线飞：彗星拖尾 + 倾角；到达后挤压落地 + 涟漪。返回当前位置（未出发返回 null）。 */
function fly(g, lt, t0, dur, a, b, kind, o = {}) {
  const raw = (lt - t0) / dur, lift = o.lift ?? 120, col = MSG[kind][2], s = o.s ?? .92;
  if (raw < 0) return null;
  if (raw <= 1) {
    const u = eio(raw);
    // 拖尾：沿已走过的弧线画渐隐粗线
    const N = 14;
    for (let i = N; i >= 1; i--) {
      const u0 = eio(clamp(raw - i * .018)), u1 = eio(clamp(raw - (i - 1) * .018));
      if (u1 <= 0) continue;
      const p0 = arcPos(a, b, u0, lift), p1 = arcPos(a, b, u1, lift);
      path(g, [p0, p1], { c: col, w: 22 * (1 - i / N) + 2, al: .28 * (1 - i / N) });
    }
    const p = arcPos(a, b, u, lift), q = arcPos(a, b, clamp(u + .03), lift);
    const ang = clamp(Math.atan2(q[1] - p[1], q[0] - p[0]) * .35, -.35, .35);
    const st = 1 + .12 * Math.sin(raw * Math.PI); // 飞行中略拉长
    capsule(g, p[0], p[1], kind, { s, rot: ang, sx: st, sy: 1 / st, glow: .55, tag: o.tag });
    return p;
  }
  const k = lt - t0 - dur;
  if (o.ripple !== false && k < .7) { ring(g, b[0], b[1], 30 + 90 * eo(k / .7), col, 5, 1 - k / .7); }
  if (o.hold) {
    const sq = k < .3 ? Math.sin(k / .3 * Math.PI) * .16 : 0;
    capsule(g, b[0], b[1] + (o.holdDy || 0), kind, { s, sx: 1 + sq, sy: 1 - sq, tag: o.tag, al: o.holdAl });
  }
  return b;
}
/* 经网关中转：A→G→B（或反向），返回 {p, at:'G'|'B'} */
function relay(g, lt, t0, kind, dir, o = {}) {
  const leg = o.leg ?? .8, from = dir === 'AB' ? P.A : P.B, to = dir === 'AB' ? P.B : P.A;
  const off = [0, -40], a = [from[0], from[1] + off[1]], m = [P.G[0], P.G[1] - 175], b = [to[0], to[1] + off[1]];
  if (lt < t0 + leg) return fly(g, lt, t0, leg, a, m, kind, { lift: 80, ripple: false, s: o.s });
  return fly(g, lt, t0 + leg, leg, m, b, kind, { lift: 80, hold: o.hold, holdDy: o.holdDy, s: o.s, tag: o.tag });
}
const gwBusy = (lt, t0, leg = .8) => clamp(1 - Math.abs(lt - (t0 + leg)) / .5);

/* ---------------- 效果 ---------------- */
function burst(g, x, y, k, c, n = 12, r = 120) { // 粒子爆发，k = 爆发后经过的秒数
  if (k < 0 || k > .9) return;
  for (let i = 0; i < n; i++) {
    const ang = i / n * TAU + hash(i * 3.1) * .5, sp = r * (.6 + hash(i * 7.7) * .6), e = eo(k / .9);
    dot(g, x + Math.cos(ang) * sp * e, y + Math.sin(ang) * sp * e + 60 * k * k, (6 + hash(i) * 6) * (1 - e * .7), i % 3 ? c : C.amber, 1 - e);
  }
}
function ripple(g, x, y, k, c, r0 = 30, r1 = 120, d = .7) { if (k >= 0 && k < d) ring(g, x, y, r0 + (r1 - r0) * eo(k / d), c, 5, 1 - k / d); }
function hatch(g, x, y, w, h, c, off = 0, r = 10) { // 斜线进度填充
  if (w <= 0) return; g.save(); rr(g, x, y, w, h, r); g.clip(); g.fillStyle = rgba(c, .28); g.fillRect(x, y, w, h);
  g.strokeStyle = rgba(c, .75); g.lineWidth = 7; for (let i = -h; i < w + h; i += 22) { g.beginPath(); g.moveTo(x + i + off % 22, y + h); g.lineTo(x + i + off % 22 + h, y); g.stroke(); } g.restore();
}
/* 倒计时圆环：p 为剩余比例 */
function countdown(g, x, y, r, p, label, c = C.amber, o = {}) {
  dot(g, x, y, r + 14, '#fff'); ring(g, x, y, r + 14, C.ink, 3.5);
  ring(g, x, y, r, rgba(c, .18), 16); ring(g, x, y, r, c, 16, 1, -TAU / 4, -TAU / 4 + TAU * clamp(p));
  text(g, label, x, y + 2, { f: 'disp', w: 900, s: o.fs || r * .62, c: C.ink });
}
/* 弹出式标签 */
function tag(g, s, x, y, c, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    const w = textW(g, s, { s: o.fs || 28, w: 900 }) + 40, h = (o.fs || 28) + 26;
    card(g, -w / 2, -h / 2, w, h, { r: h / 2, fill: o.fill || c, lw: 3, sb: 16, so: 6 });
    text(g, s, 0, 1, { s: o.fs || 28, w: 900, c: o.tc || '#fff' });
  }, { rot: o.rot || 0, al: o.al });
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

/* ---------------- 内部视图（B 的“内部处理”面板） ---------------- */
const BOARD = { x: 110, y: 150, w: 1700, h: 700 };
function board(g, title, al = 1, o = {}) {
  const { x, y, w, h } = BOARD;
  g.save(); g.globalAlpha *= al;
  card(g, x, y, w, h, { r: 36, fill: '#FBF8F2', lw: 3.5, sa: .16, sb: 40, so: 16 });
  g.save(); rr(g, x, y, w, h, 36); g.clip();
  g.fillStyle = rgba(C.orange, .08); g.fillRect(x, y, w, 78);
  for (let yy = y + 110; yy < y + h; yy += 36) for (let xx = x + 30; xx < x + w; xx += 36) dot(g, xx, yy, 1.6, rgba(C.ink, .09));
  g.restore();
  path(g, [[x, y + 78], [x + w, y + 78]], { c: C.ink, w: 3 });
  dot(g, x + 46, y + 39, 13, C.orange); ring(g, x + 46, y + 39, 13, C.ink, 3);
  text(g, title, x + 76, y + 40, { s: 32, w: 900, a: 'left' });
  if (o.right) text(g, o.right, x + w - 36, y + 40, { s: 26, w: 700, a: 'right', c: C.ink2 });
  g.restore();
}

/* ---------------- 纸面质感、镜头外层、后期 ---------------- */
function prepareStyle({ mk, cw, ch }) {
  const paper = mk(cw, ch), p = paper.getContext('2d'); p.scale(cw / W, ch / H);
  const lg = p.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#F6F0E6'); lg.addColorStop(1, '#EFE6D7');
  p.fillStyle = lg; p.fillRect(0, 0, W, H);
  // 纸纤维：确定性细噪点
  for (let i = 0; i < 9000; i++) { const x = hash(i * 1.17) * W, y = hash(i * 2.31 + 9) * H; p.fillStyle = rgba(C.ink, .018 + hash(i * 5.3) * .025); p.fillRect(x, y, 1.4, 1.4); }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 420, 960, 540, 1250); vg.addColorStop(0, 'rgba(70,45,20,0)'); vg.addColorStop(1, 'rgba(70,45,20,.22)');
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
  // 缓慢漂移的色块
  const blobs = [[C.blue, 380, 300, .09], [C.orange, 1560, 760, .09], [C.purple, 1100, 120, .06]];
  blobs.forEach(([c, x, y, a], i) => {
    const bx = x + wob(t, .021, 120, i * 3), by = y + wob(t, .017, 80, i * 5);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, 620); rg.addColorStop(0, rgba(c, a)); rg.addColorStop(1, rgba(c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  // 漂浮尘埃
  for (let i = 0; i < 34; i++) {
    const x = (hash(i * 3.3) * W + t * (8 + hash(i) * 14)) % W, y = (hash(i * 9.1) * H - t * (6 + hash(i * 2) * 10) + H * 10) % H;
    dot(g, x, y, 1.5 + hash(i * 4.4) * 2.5, C.ink, .06 + .06 * Math.sin(t * .8 + i));
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
