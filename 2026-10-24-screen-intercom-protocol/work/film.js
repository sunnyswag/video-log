/* =====================================================================
 * Kotlin 实现 SIP 通信协议 v3 —— 29 幕编排（字幕数据在 script.js，图元在 kit.js）
 * 结构：0 开场、1 片名、2–7 六章、8 总结、9 系列片尾（audio.py / checks.cjs 按此读取）。
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]；“内部处理”视图画在屏幕坐标里（screenSpace + board）。
 * 本文件新增的图元：码表卡、信封、时序图泳道、状态机节点与结束墙、状态盒、拦截器表、会话管理器、
 * 传送带重放（沿用 v2）、规则卡。所有绘制只依赖时间 t。
 * ===================================================================== */
'use strict';
const NAVY = '#2B3A67', NAVYL = '#E1E6F4';
Object.assign(MSG, {
  cont: ['202', 'CONTINUE', C.green], voice: ['300', 'VOICE_DATA', C.amber], busy: ['401', 'BUSY_END', C.coral],
  hangup: ['403', 'HANGUP_END', C.coral], interrupt: ['405', 'DATA_INTERRUPT_END', C.purple],
});
const CHAPTERS = [
  ['开场｜两块屏，中间只有网关', 'TWO SCREENS, ONE GATEWAY', '网关只负责送达，不管通话状态；通话协议要自己设计。'],
  ['Kotlin 实现 SIP 通信协议', 'A SIP-STYLE PROTOCOL IN KOTLIN', '11 种消息，两台状态机。'],
  ['第一章｜为什么自己设计', 'WHY BUILD OUR OWN', '四个候选；系统 SIP 接不上网关；网关站在代理服务器的位置。'],
  ['第二章｜11 种消息', 'ELEVEN MESSAGES', '码段分组、信封结构、四步握手与开口时刻。'],
  ['第三章｜每条消息为什么存在', 'WHY EACH MESSAGE', 'RING、PREPARE_CONFIRM、HANGUP_END 与 TIMEOUT_END 各自的职责。'],
  ['第四章｜两台状态机', 'TWO STATE MACHINES', '5 个活跃态 + 10 个结束态；状态图画的是失败路径。'],
  ['第五章｜代码架构', 'CODE ARCHITECTURE', '状态模式管跳转，拦截器管副作用，会话管理器按 sessionId 路由；语音不进状态机。'],
  ['第六章｜踩坑：50 毫秒竞态', 'THE 50 MS RACE', '取消先到、会话未建好；用 Flow 把处理排成一队。'],
  ['总结｜先画图，再写代码', 'DRAW FIRST, THEN CODE', '三条设计经验。'],
  ['系列片尾', 'WORK ARCHIVE', '工作档案：把做过的设计，讲成故事。'],
];
const CARD = { 2: ['01', '为什么自己设计', 'WHY BUILD OUR OWN', C.blue], 3: ['02', '11 种消息', 'ELEVEN MESSAGES', C.green],
  4: ['03', '每条消息为什么存在', 'WHY EACH MESSAGE', C.orange], 5: ['04', '两台状态机', 'TWO STATE MACHINES', C.purple],
  6: ['05', '代码架构', 'CODE ARCHITECTURE', NAVY], 7: ['06', '踩坑：50 毫秒竞态', 'THE 50 MS RACE', C.coral],
  8: ['✓', '先画图，再写代码', 'DRAW FIRST, THEN CODE', C.ink] };
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.bg, white: C.ink, cyan: C.blue, red: C.coral, amber: C.amber },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: C.blue, danger: C.coral, accent: C.amber },
    maxWidth: 1500, lineHeight: 64, baseY: n => n > 1 ? 932 : 972, slide: 0, fadeIn: .12, fadeOut: .12, revealDuration: () => 0 },
  prepare: prepareStyle, drawBackground,
  beforeScene(g, frame) {
    const { sc, lt } = frame; SCX = frame.scaleX;
    const [cx, cy, z] = camAt(sc.cam, lt); CAMZ = z;
    g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-cx, -cy);
    g.globalAlpha *= Math.min(sc.fi ? eo(seg(lt, 0, sc.fi)) : 1, sc.fo ? 1 - eo(seg(lt, sc.d - sc.fo, sc.d)) : 1);
  },
  drawTransition(g, frame) { CAMZ = 1; postFX(g, frame); chapterWipe(g, frame); },
  drawChrome, drawCaptionBackground, drawCaption, drawCover,
});
/* 在屏幕坐标里画（不受镜头影响） */
function screenSpace(g, fn) { g.save(); g.setTransform(SCX, 0, 0, SCX, 0, 0); const z = CAMZ; CAMZ = 1; try { fn(); } finally { CAMZ = z; g.restore(); } }

/* 章节转场：斜切色带扫入 → 停留标题 → 扫出 */
function chapterWipe(g, { sc, lt }) {
  const cd = CARD[sc.card]; if (!cd || lt > 1.95) return;
  const [num, zh, en, col] = cd;
  const pin = eio(seg(lt, 0, .38)), pout = eio(seg(lt, 1.42, 1.92));
  const x0 = lerp(-W - 400, -200, pin) + lerp(0, W + 600, pout);
  const band = new Path2D(); band.moveTo(x0, 0); band.lineTo(x0 + W + 400, 0); band.lineTo(x0 + W + 200, H); band.lineTo(x0 - 200, H); band.closePath();
  g.save();
  g.save(); shadow(g, .25, 40, 0); g.fillStyle = col; g.fill(band); g.restore();
  g.beginPath(); g.moveTo(x0 + W + 400, 0); g.lineTo(x0 + W + 470, 0); g.lineTo(x0 + W + 270, H); g.lineTo(x0 + W + 200, H); g.closePath();
  g.fillStyle = C.amber; g.fill();
  g.clip(band);
  const a = eo(seg(lt, .3, .62)) * (1 - eo(seg(lt, 1.38, 1.6)));
  const dx = (1 - eo(seg(lt, .3, .7))) * 80;
  text(g, num, 470 - dx, 520, { f: 'disp', w: 900, s: 300, c: rgba('#ffffff', .95), al: a });
  text(g, zh, 760 + dx * .5, 488, { s: 104, w: 900, c: '#fff', a: 'left', al: a });
  text(g, en, 766 + dx * .5, 584, { f: 'mono', s: 30, w: 700, ls: 8, c: rgba('#ffffff', .8), a: 'left', al: a });
  g.restore();
}

/* 外框：左上章节、右上进度、演绎/缩放标记 */
const CH_SHORT = ['开场', '', '第一章 · 为什么自己设计', '第二章 · 11 种消息', '第三章 · 每条消息为什么存在', '第四章 · 两台状态机',
  '第五章 · 代码架构', '第六章 · 踩坑：50 毫秒竞态', '总结 · 先画图，再写代码', ''];
const chColor = k => { const c = (CARD[k] || [0, 0, 0, C.ink])[3]; return c === C.ink ? C.amber : c; };
function drawChrome(g, { sc, lt }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 64;
    card(g, 52, 40, w, 52, { r: 26, fill: rgba('#ffffff', .9), lw: 2.5, sb: 12, so: 4, sa: .1 });
    dot(g, 80, 66, 8, chColor(sc.chapter));
    text(g, lab, 98, 67, { s: 26, w: 700, a: 'left' });
  }
  for (let k = 2; k <= 8; k++) { // 章节进度
    const on = sc.chapter >= k, cur = sc.chapter === k, x = 1556 + (k - 2) * 42;
    rr(g, x, 60, cur ? 34 : 22, 12, 6); g.fillStyle = cur ? chColor(k) : on ? rgba(C.ink, .45) : rgba(C.ink, .14); g.fill();
  }
  let xr = 1530;
  const demo = typeof sc.demo === 'function' ? sc.demo(lt) : sc.demo, scaled = typeof sc.scaled === 'function' ? sc.scaled(lt) : sc.scaled;
  if (demo) xr -= tagSmall(g, '⚠ 机制演绎', xr, 66, C.amber, demo) + 12;
  if (scaled) tagSmall(g, '时间已放慢', xr, 66, C.purple, scaled);
  g.restore();
}
function tagSmall(g, s, xr, y, c, al = 1) {
  const w = textW(g, s, { s: 24, w: 700 }) + 36;
  g.save(); g.globalAlpha *= clamp(+al);
  card(g, xr - w, y - 22, w, 44, { r: 22, fill: rgba('#ffffff', .92), lw: 2.5, stroke: c, sb: 10, so: 3, sa: .08 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c });
  g.restore();
  return w;
}

/* 字幕：白色圆角底板 + 墨色字，重点词着色；琥珀色加荧光笔底 */
function capState(g, frame) {
  const { sc, lt } = frame; if (sc.title || sc.noCaption || !sc.captions?.length) return null;
  const i = sc.cs.findIndex((s, k) => lt >= s && lt < sc.ce[k]); if (i < 0) return null;
  const c = { t0: sc.start + sc.cs[i], t1: sc.start + sc.ce[i], text: sc.captions[i].text }, layout = film.captionLayout(g, c, frame.t);
  if (!layout) return null;
  return { layout, alpha: Math.min(seg(lt, sc.cs[i], sc.cs[i] + .12), 1 - seg(lt, sc.ce[i] - .12, sc.ce[i])) };
}
function drawCaptionBackground(g, frame) {
  CAMZ = 1; const c = capState(g, frame); if (!c) return;
  const L = c.layout.lines, w = Math.max(...L.map(l => l.width)) + 80, top = L[0].y - 66, h = (L.length - 1) * 64 + 98;
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .25));
  g.save(); g.globalAlpha *= c.alpha;
  card(g, (W - w) / 2, top + (1 - k) * 10, w, h, { r: 28, fill: rgba('#ffffff', .96), lw: 3, sb: 26, so: 10, sa: .16 });
  g.restore();
}
function drawCaption(g, layout, frame) {
  if (frame.sc.title || frame.t >= layout.caption.t1) return;
  const k = eo(seg(frame.t, layout.caption.t0, layout.caption.t0 + .25));
  g.globalAlpha = Math.min(seg(frame.t, layout.caption.t0, layout.caption.t0 + .12), 1 - seg(frame.t, layout.caption.t1 - .12, layout.caption.t1));
  for (const l of layout.lines) {
    let x = l.x;
    for (const s of l.segments) {
      const w = textW(g, s.s, { s: 54, w: 700 });
      if (s.c === C.amber) { rr(g, x - 3, l.y + 6 + (1 - k) * 10, w + 6, 14, 5); g.fillStyle = rgba(C.amber, .42); g.fill(); }
      text(g, s.s, x, l.y + (1 - k) * 10, { s: 54, w: 700, c: s.c || C.ink, a: 'left', b: 'alphabetic' });
      x += w;
    }
  }
}

/* ---------------- 场景注册 ---------------- */
let lastChapter = -1;
function S(id, o) {
  const d = SCRIPT[id];
  if (d.chapter !== lastChapter) { film.chapter(d.chapter, ...CHAPTERS[d.chapter]); lastChapter = d.chapter; }
  return film.addScene({
    ...o, id, chapter: d.chapter, dur: d.dur, pre: 0, post: 0,
    captions: d.caps.map(([t, end, text]) => ({ t, end, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t, type, v: v ?? 1 })),
    draw: (g, lt, sc) => o.draw(g, lt, sc),
  });
}

/* =====================================================================
 * 通用图元
 * ===================================================================== */
const ap = (lt, t0, d = .5) => pop(seg(lt, t0, t0 + d));           // 弹出进度
const fa = (lt, t0, d = .4) => eo(seg(lt, t0, t0 + d));             // 淡入进度
const fo = (lt, t0, d = .4) => 1 - eo(seg(lt, t0, t0 + d));         // 淡出进度
const L2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
/* 舞台：A —— 网关 —— B */
function link(g, lt, al = 1, p = 1) {
  const a1 = [P.A[0] + 178, P.A[1] - 10], g1 = [P.G[0] - 124, P.G[1] + 5], g2 = [P.G[0] + 124, P.G[1] + 5], b1 = [P.B[0] - 178, P.B[1] - 10];
  path(g, partial([a1, g1], p), { c: rgba(C.ink, .35), w: 5, dash: [3, 15], off: -lt * 40, al });
  path(g, partial([g2, b1], p), { c: rgba(C.ink, .35), w: 5, dash: [3, 15], off: -lt * 40, al });
}
const CHIP_Y = 672;
function stage(g, lt, o = {}) {
  const e = o.enter, sA = e != null ? pop(seg(lt, e, e + .55)) : 1, sG = e != null ? pop(seg(lt, e + .15, e + .7)) : 1, sB = e != null ? pop(seg(lt, e + .3, e + .85)) : 1;
  if (o.link !== false) link(g, lt, o.linkAl ?? 1, o.linkP ?? 1);
  if (o.gw !== false) gateway(g, P.G[0], P.G[1], sG * (o.gs ?? 1), lt, { busy: o.busy || 0, al: o.gwAl });
  device(g, 'A', P.A[0], P.A[1], sA, o.a, lt, { al: o.aAl });
  device(g, 'B', P.B[0], P.B[1], sB, o.b, lt, { al: o.bAl });
  if (o.ca) chip(g, P.A[0], CHIP_Y, lt, ...o.ca);
  if (o.cb) chip(g, P.B[0], CHIP_Y, lt, ...o.cb);
}
function tap(g, x, y, lt, t0) { // 手指点按：圆点按下 + 涟漪
  const k = lt - t0; if (k < -.35 || k > .8) return;
  const press = k < 0 ? 1 - eo(-k / .35) : 1;
  dot(g, x, y, 22 * (k < .1 ? 1 - .25 * press : .75 + .25 * eo((k - .1) / .3)), rgba(C.ink, .28), k < .5 ? 1 : 1 - (k - .5) / .3);
  ripple(g, x, y, k, C.ink, 16, 60, .5);
}
/* 屏幕上不放文字的小屏：空白屏 + 头像（用于缩小的舞台，避免小字） */
function miniDevice(g, role, x, y, s, lt, o = {}) {
  const bob = o.still ? 0 : wob(lt, .22, 3, role === 'A' ? 0 : .5);
  device(g, role, x, y, s, { mode: 'none' }, lt, { label: false, still: o.still, al: o.al });
  at(g, x, y + bob - 6 * s, s, () => {
    if (o.ring) for (let k = 0; k < 3; k++) { const ph = ((lt * .9 + k / 3) % 1); ring(g, 0, -4, 46 + ph * 50, ROLE[role].c, 4, (1 - ph) * .55); }
    person(g, 0, -4, 46, o.c || ROLE[role].c);
    if (o.badge) { dot(g, 36, 30, 20, o.badge === 'cross' ? C.coral : C.green); (o.badge === 'cross' ? icCross : icCheck)(g, 36, 31, 22, '#fff', 1, 5); }
  }, { al: o.al });
}
/* 标准 SIP 报文小签（灰） */
function stdPill(g, x, y, s, o = {}) {
  const w = textW(g, s, { f: 'mono', s: 26, w: 700 }) + 36, h = 46;
  at(g, x, y, o.s ?? 1, () => {
    card(g, -w / 2, -h / 2, w, h, { r: 23, fill: o.fill || C.greyL, lw: 2.5, stroke: o.stroke || C.ink2, sb: 10, so: 4, sa: .1 });
    text(g, s, 0, 1, { f: 'mono', s: 26, w: 700, c: o.c || C.ink2 });
    if (o.strike) path(g, partial([[-w / 2 + 10, 3], [w / 2 - 10, -3]], o.strike), { c: C.coral, w: 5 });
  }, { al: o.al, rot: o.rot });
  return w;
}
/* 代码风格的状态签（不带翻转） */
function stateTag(g, s, x, y, o = {}) { at(g, x, y, o.s ?? 1, () => chipRaw(g, 0, 0, s, o), { al: o.al }); }
/* 假设标签：琥珀底 + 墨色字 */
function hypo(g, s, x, y, p) { tag(g, '假设：' + s, x, y, C.amber, p, { tc: C.ink, fs: 28 }); }
/* 碎裂：消息在 (x,y) 碎掉，k 为碎裂后经过的秒数 */
function shatter(g, x, y, k, c) {
  if (k < 0 || k > 1.2) return;
  for (let i = 0; i < 9; i++) {
    const ang = -Math.PI / 2 + (hash(i * 2.7) - .5) * 2.6, sp = 60 + hash(i * 5.3) * 120, e = eo(k / 1.2);
    g.save(); g.translate(x + Math.cos(ang) * sp * e, y + Math.sin(ang) * sp * e + 160 * k * k); g.rotate(k * (hash(i) - .5) * 8);
    g.globalAlpha *= 1 - e; rr(g, -14, -9, 28, 18, 5); g.fillStyle = i % 3 ? c : '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); g.restore();
  }
  if (k < .5) ring(g, x, y, 30 + 80 * eo(k / .5), c, 5, 1 - k / .5);
  badge(g, x, y - 10, 30, C.coral, 'cross', seg(k, 0, .3) * (1 - seg(k, .9, 1.2)));
}
/* 重发转盘：转动 + 每秒飞出 INVITE 虚影；stop>0 变绿打勾 */
function resendDial(g, x, y, lt, p, stop, o = {}) {
  at(g, x, y, pop(p), () => {
    dot(g, 0, 0, 44, stop > 0 ? C.green : '#fff'); ring(g, 0, 0, 44, C.ink, 3);
    if (stop < 1) { const a = -lt * 5; ring(g, 0, 0, 24, C.blue, 6, 1 - stop, a, a + 4.6); arrowHead(g, Math.cos(a + 4.6) * 24, Math.sin(a + 4.6) * 24, a + 4.6 + Math.PI / 2, C.blue, 14, 1 - stop); }
    if (stop > 0) icCheck(g, 0, 2, 44, '#fff', eo(stop), 7);
    text(g, stop > 0 ? (o.stopLabel || '停止重发') : (o.label || '每秒重发'), 0, 74, { s: 26, w: 900, c: stop > 0 ? C.green : C.blue });
  });
}
/* 秒表图标 */
function stopwatch(g, x, y, s, c = C.ink, o = {}) {
  at(g, x, y, s, () => {
    dot(g, 0, 4, 30, '#fff'); ring(g, 0, 4, 30, c, 6); rr(g, -8, -40, 16, 12, 4); g.fillStyle = c; g.fill();
    const a = -TAU / 4 + (o.a || 0); path(g, [[0, 4], [Math.cos(a) * 20, 4 + Math.sin(a) * 20]], { c, w: 5 });
  }, { al: o.al, rot: o.rot });
}
/* 信封图标 */
function envIcon(g, x, y, s, c = C.ink, o = {}) {
  at(g, x, y, s, () => {
    card(g, -34, -24, 68, 48, { r: 8, fill: '#fff', lw: 4, stroke: c, shadow: false });
    path(g, [[-30, -18], [0, 6], [30, -18]], { c, w: 4 });
  }, { al: o.al, rot: o.rot });
}
/* 喇叭 + 声波 */
function speaker(g, x, y, s, lt, on = 1) {
  at(g, x, y, s, () => {
    g.beginPath(); g.moveTo(-30, -16); g.lineTo(-10, -16); g.lineTo(14, -38); g.lineTo(14, 38); g.lineTo(-10, 16); g.lineTo(-30, 16); g.closePath();
    g.fillStyle = C.amber; g.fill(); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke();
    for (let k = 0; k < 3; k++) { const ph = (lt * 1.2 + k / 3) % 1; ring(g, 14, 0, 26 + ph * 46, C.amber, 5, on * (1 - ph) * .9, -.8, .8); }
  });
}
/* 单程票：HANGUP_END */
function ticket(g, x, y, s, o = {}) {
  at(g, x, y, s, () => {
    g.save(); shadow(g, .18, 18, 7);
    g.beginPath(); g.moveTo(-150, -50); g.lineTo(150, -50); g.lineTo(150, -14); g.arc(150, 0, 14, -Math.PI / 2, Math.PI / 2, true); g.lineTo(150, 50); g.lineTo(-150, 50); g.lineTo(-150, 14); g.arc(-150, 0, 14, Math.PI / 2, -Math.PI / 2, true); g.closePath();
    g.fillStyle = C.coralL; g.fill(); noShadow(g); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); g.restore();
    path(g, [[70, -40], [70, 40]], { c: C.ink, w: 3, dash: [6, 7] });
    text(g, '403', -96, -12, { f: 'mono', s: 28, w: 700, c: C.coral });
    text(g, 'HANGUP_END', -20, 20, { f: 'mono', s: 26, w: 700, c: C.ink });
    text(g, '单程', 110, 2, { s: 28, w: 900, c: C.coral });
  }, { al: o.al, rot: o.rot });
}
/* 状态机节点（沿用 v2）：on=1 实心填色；pulse 外扩光圈 */
function node(g, x, y, s, o = {}) {
  const c = o.c || stateTone(s), w = Math.max(220, textW(g, s, { f: 'mono', s: 28, w: 700 }) + 70), h = 76, on = o.on ?? 0;
  at(g, x, y, o.s ?? 1, () => {
    if (o.pulse) for (let k = 0; k < 2; k++) { const ph = (o.t * .9 + k / 2) % 1; g.save(); g.globalAlpha *= (1 - ph) * .5; rr(g, -w / 2 - ph * 30, -h / 2 - ph * 30, w + ph * 60, h + ph * 60, 38 + ph * 30); g.strokeStyle = c; g.lineWidth = 4; g.stroke(); g.restore(); }
    card(g, -w / 2, -h / 2, w, h, { r: 38, fill: on >= 1 ? c : '#fff', lw: 3.5, stroke: o.dim ? C.grey : C.ink, al: o.dim ? .45 : 1, sb: 20, so: 8 });
    if (on > 0 && on < 1) { g.save(); g.globalAlpha *= on; rr(g, -w / 2, -h / 2, w, h, 38); g.fillStyle = c; g.fill(); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke(); g.restore(); }
    text(g, s, 0, 2, { f: 'mono', s: 28, w: 700, c: on >= .5 ? '#fff' : o.dim ? C.grey : C.ink, al: o.dim ? .6 : 1 });
  }, { al: o.al });
}
/* 内部视图面板（kit.js 的 board 之外，可换主题色） */
function boardC(g, title, al = 1, o = {}) {
  const { x, y, w, h } = BOARD, col = o.c || C.orange;
  g.save(); g.globalAlpha *= al;
  card(g, x, y, w, h, { r: 36, fill: '#FBF8F2', lw: 3.5, sa: .16, sb: 40, so: 16 });
  g.save(); rr(g, x, y, w, h, 36); g.clip();
  g.fillStyle = rgba(col, .08); g.fillRect(x, y, w, 78);
  for (let yy = y + 110; yy < y + h; yy += 36) for (let xx = x + 30; xx < x + w; xx += 36) dot(g, xx, yy, 1.6, rgba(C.ink, .09));
  g.restore();
  path(g, [[x, y + 78], [x + w, y + 78]], { c: C.ink, w: 3 });
  dot(g, x + 46, y + 39, 13, col); ring(g, x + 46, y + 39, 13, C.ink, 3);
  text(g, title, x + 76, y + 40, { s: 32, w: 900, a: 'left' });
  if (o.right) text(g, o.right, x + w - 36, y + 40, { s: 26, w: 700, a: 'right', c: C.ink2 });
  g.restore();
}

/* =====================================================================
 * 开场与片名
 * ===================================================================== */
function talkBubble(g, x, y, p, lt, c, ph = 0) { // 说话气泡：三根跳动的声波条
  at(g, x, y, pop(p), () => {
    card(g, -66, -40, 132, 80, { r: 40, fill: '#fff', lw: 3, sb: 14, so: 5 });
    g.beginPath(); g.moveTo(-14, 38); g.lineTo(0, 58); g.lineTo(12, 38); g.closePath(); g.fillStyle = '#fff'; g.fill();
    for (let i = 0; i < 4; i++) { const h = 14 + 26 * Math.abs(Math.sin(lt * 5 + i * 1.3 + ph)); rr(g, -39 + i * 22, -h / 2, 12, h, 6); g.fillStyle = c; g.fill(); }
  });
}
function qCard(g, s, x, y, p, rot = 0) { // 问号卡
  at(g, x, y, pop(p), () => {
    const w = textW(g, s, { s: 30, w: 900 }) + 92;
    card(g, -w / 2, -34, w, 68, { r: 34, fill: '#fff', lw: 3, sb: 16, so: 6 });
    dot(g, -w / 2 + 34, 0, 18, C.grey); text(g, '?', -w / 2 + 34, 2, { f: 'disp', w: 900, s: 26, c: '#fff' });
    text(g, s, 22, 1, { s: 30, w: 900, c: C.ink });
  }, { rot });
}
S('s01', {
  fi: .5,
  cam: [[0, 960, 490, 1.08], [20, 960, 470, 1]],
  cues: [[.2, 'whoosh'], [4.6, 'error', .5], [5.0, 'latch'], [8.4, 'send'], [12.6, 'tick'], [13.4, 'tick'], [14.2, 'tick'], [16.6, 'whoosh', .6], [18.0, 'success']],
  draw(g, lt) {
    const lk = eo(seg(lt, 5.0, 5.8)), stream = fa(lt, 8.2, .6) * fo(lt, 12.4, .6);
    link(g, lt, 1, lk);
    // 直连虚线 → 打叉
    const dA = eo(seg(lt, 4.0, 4.6)) * fo(lt, 6.2, .6);
    if (dA > 0) {
      const pts = []; for (let i = 0; i <= 24; i++) pts.push(bez([P.A[0] + 60, P.A[1] - 140], [960, 60], [P.B[0] - 60, P.B[1] - 140], i / 24));
      path(g, partial(pts, eo(seg(lt, 4.0, 4.6))), { c: C.ink2, w: 5, dash: [14, 12], al: dA });
      g.save(); g.globalAlpha *= fo(lt, 6.2, .6); icCross(g, 960, 188, 56, C.coral, eo(seg(lt, 4.6, 5.0)), 10); g.restore();
      if (lt > 4.7) tag(g, '无直连', 1120, 176, C.coral, seg(lt, 4.7, 5.1), { fs: 26, al: fo(lt, 6.2, .6) });
    }
    // 网关：问题出现时摇头
    const shake = Math.sin(lt * 9) * .07 * fa(lt, 12.6) * fo(lt, 15.8);
    g.save(); g.translate(P.G[0], P.G[1] + 60); g.rotate(shake); g.translate(-P.G[0], -P.G[1] - 60);
    gateway(g, P.G[0], P.G[1], ap(lt, 4.2, .6), lt, { busy: stream * .6, al: fa(lt, 4.3) });
    g.restore();
    device(g, 'A', P.A[0], P.A[1], ap(lt, .2, .55), { mode: 'app' }, lt);
    device(g, 'B', P.B[0], P.B[1], ap(lt, .45, .55), { mode: 'app' }, lt);
    // 想说话
    const tb = fo(lt, 3.8, .4);
    if (tb > 0 && lt > .8) { g.save(); g.globalAlpha *= tb; talkBubble(g, P.A[0] + 120, 270, seg(lt, .9, 1.4), lt, C.blue); talkBubble(g, P.B[0] - 120, 270, seg(lt, 1.6, 2.1), lt, C.orange, 1.7); g.restore(); }
    // 字节流
    if (stream > 0) for (let i = 0; i < 10; i++) {
      const ph = ((lt - 8.2) * .55 + i / 10) % 1, ab = i % 2 === 0;
      const sp = ph < .5 ? [[P.A[0] + 178, P.A[1] - 10], [P.G[0] - 124, P.G[1] + 5]] : [[P.G[0] + 124, P.G[1] + 5], [P.B[0] - 178, P.B[1] - 10]];
      const u = ab ? (ph % .5) * 2 : 1 - (ph % .5) * 2, p = L2(sp[0], sp[1], u);
      g.save(); g.globalAlpha *= stream; rr(g, p[0] - 9, p[1] - 9 + (ab ? -15 : 15), 18, 18, 4); g.fillStyle = ab ? C.blue : C.orange; g.fill(); g.restore();
    }
    if (lt > 8.6 && lt < 12.8) tag(g, '送到 ✓', P.G[0], 236, C.purple, seg(lt, 8.6, 9.0), { fs: 28, al: fo(lt, 12.2) });
    // 通话状态：没人管
    if (lt > 9.8) { const k = fo(lt, 16.2); chip(g, P.A[0], CHIP_Y, lt, '通话状态 ?', null, 0, { c: C.grey, al: fa(lt, 9.8) * k }); chip(g, P.B[0], CHIP_Y, lt, '通话状态 ?', null, 0, { c: C.grey, al: fa(lt, 10.1) * k }); }
    if (lt > 12.5 && lt < 16.6) {
      g.save(); g.globalAlpha *= fo(lt, 16.0);
      qCard(g, '谁在呼叫', 640, 238, seg(lt, 12.6, 13.0), -.05);
      qCard(g, '接了没', 960, 196, seg(lt, 13.4, 13.8), .03);
      qCard(g, '挂了没', 1280, 238, seg(lt, 14.2, 14.6), .05);
      badge(g, P.G[0] + 140, P.G[1] - 60, 30, C.grey, '?', seg(lt, 13.0, 13.4));
      g.restore();
    }
    // 蓝图：通话协议，自己设计
    if (lt > 16.5) {
      const x0 = 660, y0 = 168, w = 600, h = 100, k = eo(seg(lt, 16.6, 17.8));
      const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]];
      g.save(); g.globalAlpha *= fa(lt, 17.4, .5); rr(g, x0, y0, w, h, 18); g.fillStyle = rgba(C.blueL, .92); g.fill(); g.restore();
      path(g, partial(pts, k), { c: C.blue, w: 4, dash: [12, 8] });
      const hd = partial(pts, k).at(-1);
      if (k < 1) at(g, hd[0], hd[1], 1, () => { g.rotate(.6); rr(g, -6, -34, 12, 34, 3); g.fillStyle = C.amber; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); });
      text(g, '通话协议', x0 + 190, y0 + h / 2 + 2, { s: 40, w: 900, c: C.blue, al: fa(lt, 17.2) });
      tag(g, '自己设计', x0 + 430, y0 + h / 2, C.blue, seg(lt, 17.8, 18.2), { fs: 28 });
    }
  },
});

S('s02', {
  title: true, fi: .3,
  cues: [[.15, 'whoosh'], [1.8, 'send'], [2.9, 'latch'], [3.6, 'latch']],
  draw(g, lt) {
    const title = 'Kotlin 实现 SIP 通信协议', o = { s: 112, w: 900 };
    const chars = Array.from(title), total = textW(g, title, o);
    let x = 960 - total / 2;
    chars.forEach((ch, i) => {
      const w = textW(g, ch, o), p = seg(lt, .15 + i * .035, .6 + i * .035);
      at(g, x + w / 2, 400 + (1 - eo(p)) * 70, .6 + .4 * pop(p), () => text(g, ch, 0, 0, { ...o, c: ch === 'S' || ch === 'I' || ch === 'P' ? C.blue : C.ink }), { al: eo(p) });
      x += w;
    });
    const u = eio(seg(lt, 1.0, 1.6));
    rr(g, 960 - total / 2, 478, total * u, 12, 6); g.fillStyle = C.amber; g.fill();
    const sp = seg(lt, 3.6, 4.1);
    at(g, 960, 575, pop(sp), () => text(g, '11 种消息 · 两台状态机', 0, 0, { s: 64, w: 900, c: C.blue }), { al: sp > 0 ? 1 : 0 });
    const mA = [600, 800], mG = [960, 790], mB = [1320, 800];
    path(g, partial([[mA[0] + 70, mA[1]], [mG[0] - 50, mG[1]]], eo(seg(lt, .9, 1.5))), { c: rgba(C.ink, .35), w: 4, dash: [3, 12] });
    path(g, partial([[mG[0] + 50, mG[1]], [mB[0] - 70, mB[1]]], eo(seg(lt, 1.2, 1.8))), { c: rgba(C.ink, .35), w: 4, dash: [3, 12] });
    miniDevice(g, 'A', mA[0], mA[1], .5 * ap(lt, .5), lt);
    gateway(g, mG[0], mG[1], .46 * ap(lt, .65), lt, { label: false, busy: gwBusy(lt, 1.8, .55) });
    miniDevice(g, 'B', mB[0], mB[1], .5 * ap(lt, .8), lt, { ring: lt > 2.9 });
    if (lt < 2.35) fly(g, lt, 1.8, .55, [mA[0], mA[1] - 60], [mG[0], mG[1] - 70], 'invite', { lift: 60, s: .5, ripple: false });
    else fly(g, lt, 2.35, .55, [mG[0], mG[1] - 70], [mB[0], mB[1] - 60], 'invite', { lift: 60, s: .5 });
  },
});

/* =====================================================================
 * 第一章：为什么自己设计
 * ===================================================================== */
const CANDS = [['VoIP', '网络语音', C.amber], ['SIP', '信令协议', C.blue], ['RTP', '媒体传输', C.green], ['WebRTC', '实时音视频', C.purple]];
function candCard(g, i, x, y, s, lt, o = {}) {
  const [name, sub, col] = CANDS[i];
  at(g, x, y, s, () => {
    if (o.glow) { g.save(); rr(g, -165, -150, 330, 300, 30); g.shadowColor = rgba(col, .6 * o.glow); g.shadowBlur = 40 * SH(); g.fillStyle = col; g.fill(); g.restore(); }
    card(g, -165, -150, 330, 300, { r: 30, fill: '#fff', lw: 3.5, sb: 26, so: 10 });
    g.save(); rr(g, -165, -150, 330, 300, 30); g.clip(); g.fillStyle = col; g.fillRect(-165, -150, 330, 96); g.restore();
    path(g, [[-165, -54], [165, -54]], { c: C.ink, w: 3 });
    text(g, name, 0, -100, { f: 'disp', w: 900, s: 54, c: '#fff' });
    // 图标
    if (i === 0) { g.save(); g.translate(0, 30); g.rotate(-.5); rr(g, -46, -14, 92, 28, 14); g.fillStyle = col; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); rr(g, -56, -26, 26, 40, 10); g.fill(); g.stroke(); rr(g, 30, -26, 26, 40, 10); g.fill(); g.stroke(); g.restore(); }
    if (i === 1) for (let k = 0; k < 3; k++) envIcon(g, -50 + k * 50, 30 + (k - 1) * 0, .75, [C.blue, C.green, C.coral][k], { rot: (k - 1) * .12 });
    if (i === 2) for (let k = 0; k < 5; k++) { const xx = -90 + ((k * 45 + lt * 50) % 225); rr(g, xx - 14, 16, 28, 28, 6); g.fillStyle = rgba(col, .4 + .6 * clamp(1 - Math.abs(xx) / 110)); g.fill(); }
    if (i === 3) { card(g, -70, -14, 140, 96, { r: 12, fill: C.purpleL, lw: 3, shadow: false }); path(g, [[-70, 6], [70, 6]], { c: C.ink, w: 3 }); for (let k = 0; k < 3; k++) dot(g, -54 + k * 14, -4, 4, C.ink); ring(g, 0, 44, 22, col, 4); path(g, [[-22, 44], [22, 44]], { c: col, w: 3 }); }
    text(g, sub, 0, 112, { s: 26, w: 700, c: C.ink2, al: o.subAl ?? 1 });
  }, { al: o.al });
  if (o.check) badge(g, x + 150 * s, y - 140 * s, 30, C.green, 'check', o.check);
}
S('s03', {
  card: 2,
  cues: [[0, 'whoosh'], [1.6, 'latch', .6], [1.85, 'latch', .6], [2.1, 'latch', .6], [2.35, 'latch', .6], [4.0, 'whoosh', .6], [5.4, 'error'], [6.0, 'tick'], [9.2, 'success'], [10.0, 'latch']],
  draw(g, lt) {
    const k1 = eio(seg(lt, 4.0, 4.6)) * (1 - eio(seg(lt, 8.4, 9.0))), pk = eo(seg(lt, 9.2, 9.8));
    const xs = [330, 750, 1170, 1590];
    CANDS.forEach((c, i) => {
      const p = ap(lt, 1.6 + i * .25); if (p <= 0) return;
      const sip = i === 1, y = lerp(480, 250, k1) - (sip ? 40 * pk : 0), s = p * lerp(1, .55, k1) * (sip ? 1 + .06 * pk : 1);
      const x = lerp(xs[i], 960 + (i - 1.5) * 220, k1);
      candCard(g, i, x, y, s, lt, { al: sip ? 1 : 1 - .55 * pk, subAl: 1 - clamp(k1 * 1.5), glow: sip ? pk * (.7 + .3 * Math.sin(lt * 3)) : 0, check: sip ? seg(lt, 9.6, 10.0) : 0 });
    });
    // WebRTC 细节：通信层接不上网关
    const det = fa(lt, 4.3, .4) * fo(lt, 8.3, .4);
    if (det > 0) {
      g.save(); g.globalAlpha *= det;
      const bx = 700, by = 640;
      card(g, bx - 230, by - 120, 460, 240, { r: 28, fill: '#fff', lw: 3.5 });
      text(g, 'WebRTC', bx, by - 82, { f: 'mono', s: 32, w: 700, c: C.purple });
      card(g, bx - 200, by - 46, 400, 56, { r: 14, fill: C.purpleL, lw: 3, shadow: false }); text(g, '音视频', bx, by - 17, { s: 28, w: 700 });
      const hot = seg(lt, 5.4, 5.8);
      card(g, bx - 200, by + 26, 400, 56, { r: 14, fill: hot > 0 ? C.coralL : C.greyL, lw: 3, stroke: hot > 0 ? C.coral : C.ink, shadow: false }); text(g, '通信层', bx, by + 55, { s: 28, w: 900, c: hot > 0 ? C.coral : C.ink });
      gateway(g, 1400, 630, .78, lt, { label: true });
      const sock = [1270, 650]; rr(g, sock[0] - 17, sock[1] - 17, 34, 34, 4); g.fillStyle = C.purple; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
      const ext = eo(seg(lt, 4.6, 5.4)), back = lt > 5.4 ? Math.sin(seg(lt, 5.4, 5.9) * Math.PI) * 30 : 0;
      const px = lerp(980, 1230, ext) - back, cab = [];
      for (let i = 0; i <= 20; i++) cab.push(bez([bx + 200, by + 54], [px - 120, by + 54], [px, sock[1]], i / 20));
      path(g, cab, { c: C.ink, w: 7 }); dot(g, px, sock[1], 20, C.coral); ring(g, px, sock[1], 20, C.ink, 3);
      burst(g, 1250, sock[1], lt - 5.4, C.amber, 12, 90);
      if (lt > 5.5) badge(g, 1250, sock[1] - 70, 30, C.coral, 'cross', seg(lt, 5.5, 5.8));
      if (lt > 6.0) tag(g, '要改造通信层', bx, by + 166, C.coral, seg(lt, 6.0, 6.4), { fs: 28 });
      g.restore();
    }
    if (lt > 10.0) tag(g, '最简单实用', 750, 700, C.green, seg(lt, 10.0, 10.4), { fs: 30 });
  },
});

S('s04', {
  cam: [[0, 960, 500, 1], [13, 960, 490, 1.03]],
  cues: [[.3, 'latch', .6], [.8, 'latch', .6], [1.3, 'latch', .5], [4.4, 'send', .5], [5.4, 'error'], [6.2, 'latch', .5], [9.0, 'latch'], [9.05, 'error', .4]],
  draw(g, lt) {
    const fx = 500;
    at(g, fx, 490, ap(lt, .2), () => {
      card(g, -350, -270, 700, 540, { r: 36, fill: rgba('#ffffff', .75), lw: 3.5, sb: 30, so: 12 });
      g.save(); rr(g, -350, -270, 700, 540, 36); g.clip(); g.fillStyle = rgba(C.green, .12); g.fillRect(-350, -270, 700, 74); g.restore();
      path(g, [[-350, -196], [350, -196]], { c: C.ink, w: 3 });
      text(g, 'Android 系统', 0, -232, { s: 32, w: 900, c: C.ink });
    });
    const dead = fa(lt, 9.1, .5);
    // 系统 SIP ↔ 系统 Service 的绑定线
    const bind = fa(lt, 6.0, .4) * (1 - .5 * fa(lt, 8.6));
    if (lt > .6) {
      path(g, [[fx, 450], [fx, 550]], { c: C.ink, w: 10 }); path(g, [[fx, 450], [fx, 550]], { c: bind > 0 ? C.amber : '#fff', w: 5, dash: [8, 8], off: -lt * 30 });
      if (bind > 0) { g.save(); g.globalAlpha *= bind; ring(g, fx, 500, 40 + 8 * Math.sin(lt * 6), C.amber, 5, .7); g.restore(); tag(g, '绑定', fx + 110, 500, C.amber, seg(lt, 6.2, 6.6), { tc: C.ink, fs: 28 }); }
    }
    at(g, fx, 390, ap(lt, .4), () => { card(g, -180, -60, 360, 120, { r: 24, fill: C.blueL, lw: 3.5, stroke: C.blue }); text(g, '系统 SIP', 0, 2, { s: 36, w: 900, c: C.blue, al: 1 - .92 * fa(lt, 8.9, .2) });
      if (dead > 0) { g.save(); g.globalAlpha *= dead * .55; rr(g, -180, -60, 360, 120, 24); g.fillStyle = C.grey; g.fill(); g.restore(); } }, {});
    at(g, fx, 610, ap(lt, .8), () => { card(g, -180, -60, 360, 120, { r: 24, fill: C.greyL, lw: 3.5 }); text(g, '系统 Service', 0, 2, { s: 34, w: 900, c: C.ink }); });
    // 网关与插口
    gateway(g, 1460, 470, .95 * ap(lt, 1.2), lt);
    const sock = [1318, 476];
    if (lt > 1.4) { rr(g, sock[0] - 18, sock[1] - 18, 36, 36, 4); g.fillStyle = C.purple; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); }
    // 插头：去够网关
    if (lt > 1.0) {
      const ext = eo(seg(lt, 4.2, 5.4)), back = lt > 5.4 ? Math.sin(seg(lt, 5.4, 6.0) * Math.PI) * 40 : 0;
      const px = lerp(780, 1272, ext) - back, cab = [];
      for (let i = 0; i <= 24; i++) cab.push(bez([fx + 180, 390], [Math.max(fx + 240, px - 200), 390], [px, sock[1]], i / 24));
      g.save(); g.globalAlpha *= fa(lt, 1.0); path(g, cab, { c: C.ink, w: 8 }); dot(g, px, sock[1], 22, C.blue); ring(g, px, sock[1], 22, C.ink, 3); g.restore();
      burst(g, 1295, sock[1], lt - 5.4, C.amber, 12, 100);
      if (lt > 5.5) badge(g, 1295, sock[1] - 76, 32, C.coral, 'cross', seg(lt, 5.5, 5.8));
      if (lt > 5.8) tag(g, '接不上', 1080, 590, C.coral, seg(lt, 5.8, 6.2), { fs: 28 });
    }
    // 废弃印章
    if (lt > 8.7) {
      const k = seg(lt, 8.7, 9.1), sc = lerp(1.9, 1, eo(k));
      at(g, fx + 20, 384, sc, () => {
        rr(g, -230, -46, 460, 92, 14); g.fillStyle = rgba('#ffffff', .94); g.fill(); g.lineWidth = 7; g.strokeStyle = C.coral; g.stroke();
        rr(g, -218, -34, 436, 68, 10); g.lineWidth = 2.5; g.stroke();
        text(g, 'Android 12 起废弃', 0, 3, { s: 38, w: 900, c: C.coral });
      }, { rot: -.1, al: eo(k) });
      burst(g, fx, 384, lt - 9.1, C.coral, 14, 160);
    }
  },
});

const TRAP = { AL: [330, 690], P1: [690, 330], P2: [1230, 330], BO: [1590, 690] };
function proxyBox(g, x, y, al = 1) {
  g.save(); g.globalAlpha *= clamp(al);
  card(g, x - 115, y - 50, 230, 100, { r: 18, fill: C.greyL, lw: 3.5 });
  for (let i = 0; i < 3; i++) { path(g, [[x - 85, y - 26 + i * 26], [x + 40, y - 26 + i * 26]], { c: C.ink2, w: 4 }); dot(g, x + 74, y - 26 + i * 26, 6, i === 0 ? C.green : C.ink2); }
  text(g, '代理服务器', x, y - 82, { s: 28, w: 900, c: C.ink2 });
  g.restore();
}
function polyAt(pts, u) { const q = partial(pts, u); return q[q.length - 1]; }
S('s05', {
  cues: [[.3, 'latch', .5], [1.4, 'send', .6], [2.0, 'send', .6], [2.6, 'send', .6], [3.0, 'send', .4], [3.4, 'send', .4], [4.8, 'whoosh'], [6.4, 'latch'], [9.6, 'tick'], [9.8, 'tick'], [10.0, 'tick'], [10.6, 'send'], [12.2, 'success']],
  draw(g, lt) {
    const k = eio(seg(lt, 4.8, 6.2)), old = 1 - k;
    const al = L2(TRAP.AL, P.A, k), p1 = L2(TRAP.P1, P.G, k), p2 = L2(TRAP.P2, P.G, k), bo = L2(TRAP.BO, P.B, k);
    const tr = [TRAP.AL, TRAP.P1, TRAP.P2, TRAP.BO];
    if (old > 0) {
      path(g, partial([al, p1, p2, bo], eo(seg(lt, .3, 1.4))), { c: rgba(C.ink, .45), w: 5, dash: [6, 12], off: -lt * 30, al: old });
      proxyBox(g, p1[0], p1[1], old * ap(lt, .2)); proxyBox(g, p2[0], p2[1], old * ap(lt, .35));
      g.save(); g.globalAlpha *= old * old * old;
      at(g, al[0], al[1], ap(lt, .1), () => { person(g, 0, 0, 46, C.blue); text(g, 'Alice', 0, 80, { f: 'mono', s: 30, w: 700, c: C.blue }); });
      at(g, bo[0], bo[1], ap(lt, .5), () => { person(g, 0, 0, 46, C.orange); text(g, 'Bob', 0, 80, { f: 'mono', s: 30, w: 700, c: C.orange }); });
      g.restore();
      // 标准 SIP 报文沿梯形走
      if (lt > 1.4 && lt < 3.4) { const p = polyAt(tr, eio(seg(lt, 1.4, 3.0))); stdPill(g, p[0], p[1], 'INVITE', { fill: '#fff', stroke: C.ink, c: C.ink, al: fo(lt, 3.0, .3) }); }
      const back = [...tr].reverse();
      if (lt > 3.0 && lt < 4.8) { const p = polyAt(back, eio(seg(lt, 3.0, 4.2))); stdPill(g, p[0], p[1], '180 Ringing', { al: fo(lt, 4.3, .4) }); }
      if (lt > 3.4 && lt < 5.0) { const p = polyAt(back, eio(seg(lt, 3.4, 4.6))); stdPill(g, p[0], p[1], '200 OK', { al: fo(lt, 4.6, .4) }); }
    }
    // 收拢成网关 + 两块屏
    if (k > 0) {
      link(g, lt, k);
      gateway(g, P.G[0], P.G[1], ap(lt, 5.5, .7), lt, { busy: gwBusy(lt, 10.6), al: fa(lt, 5.7) });
      const aMode = lt < 10.6 ? { mode: 'app' } : { mode: 'calling', from: 'app', at: 10.6 };
      const bMode = lt < 12.2 ? { mode: 'app' } : { mode: 'ringing', from: 'app', at: 12.2 };
      device(g, 'A', al[0], al[1], k, aMode, lt, { al: k * k * k });
      device(g, 'B', bo[0], bo[1], k, bMode, lt, { al: k * k * k });
    }
    if (lt > 6.4 && lt < 9.4) tag(g, '网关 = 代理服务器的位置', 960, 196, C.purple, seg(lt, 6.4, 6.8), { fs: 30, al: fo(lt, 9.0) });
    // 只借思想：标准报文划掉，换成自己的消息
    const STD = ['INVITE', '180 Ringing', '200 OK', 'ACK', 'BYE'];
    if (lt > 9.2 && lt < 11.0) STD.forEach((s, i) => {
      const fly2 = eo(seg(lt, 10.2 + i * .06, 10.8 + i * .06));
      stdPill(g, 960 + (i - 2) * 250, 196 - 60 * fly2, s, { s: ap(lt, 9.2 + i * .06, .4), strike: eo(seg(lt, 9.6 + i * .1, 9.9 + i * .1)), al: 1 - fly2 });
    });
    if (lt > 10.6) relay(g, lt, 10.6, 'invite', 'AB', { hold: lt < 13.2 });
    if (lt > 11.0) tag(g, '自研 · 11 种消息', 960, 160, C.blue, seg(lt, 11.0, 11.4), { fs: 30 });
  },
});

/* =====================================================================
 * 第二章：11 种消息
 * ===================================================================== */
const CODE_COLS = [ // [组名, 颜色, 列中心 x, 卡宽, 消息]
  ['1xx · 呼叫', C.blue, 340, 300, ['invite', 'ring']],
  ['2xx · 接通', C.green, 730, 360, ['accept', 'confirm', 'cont']],
  ['300 · 语音', C.amber, 1120, 300, ['voice']],
  ['4xx · 结束', C.coral, 1530, 400, ['busy', 'cancel', 'hangup', 'timeout', 'interrupt']],
];
const CODE_LIST = CODE_COLS.flatMap(([, col, x, w, ks], ci) => ks.map((k, r) => ({ k, col, x, w, y: 310 + r * 76, ci })));
function msgCard(g, x, y, kind, w, o = {}) {
  const [code, name] = MSG[kind], col = o.col, h = 58;
  at(g, x, y, o.s ?? 1, () => {
    if (o.glow) { g.save(); rr(g, -w / 2, -h / 2, w, h, 16); g.shadowColor = rgba(col, .6 * o.glow); g.shadowBlur = 26 * SH(); g.fillStyle = col; g.fill(); g.restore(); }
    card(g, -w / 2, -h / 2, w, h, { r: 16, fill: '#fff', lw: 3, stroke: o.dash ? col : C.ink, dash: o.dash ? [10, 7] : null, sb: 14, so: 6, sa: .14 });
    rr(g, -w / 2 + 6, -h / 2 + 6, 78, h - 12, 11); g.fillStyle = col; g.fill();
    text(g, code, -w / 2 + 45, 1, { f: 'mono', s: 27, w: 700, c: '#fff' });
    text(g, name, -w / 2 + 98, 1, { f: 'mono', s: 26, w: 700, a: 'left' });
  }, { al: o.al, rot: o.rot });
}
S('s06', {
  card: 3,
  cues: [[0, 'whoosh'], ...CODE_LIST.map((_, i) => [1.7 + i * .17, 'tick', .45]), [4.0, 'whoosh'], [4.4, 'latch', .6], [6.2, 'latch', .6], [8.6, 'latch', .6], [10.2, 'latch', .6], [12.4, 'latch'], [12.9, 'success', .6]],
  draw(g, lt) {
    const local = eo(seg(lt, 12.4, 12.9));
    // 计数
    const n = CODE_LIST.filter((_, i) => lt >= 1.7 + i * .17).length, ca = fa(lt, 1.6) * fo(lt, 3.8);
    if (ca > 0) { text(g, String(n), 900, 196, { f: 'disp', w: 900, s: 96, c: C.green, a: 'right', al: ca }); text(g, '种消息', 920, 208, { s: 40, w: 900, a: 'left', al: ca }); }
    // 组头
    CODE_COLS.forEach(([name, col, x], ci) => {
      const p = ap(lt, [4.4, 6.2, 8.6, 10.2][ci]); if (p <= 0) return;
      at(g, x, 228, p, () => { const w = textW(g, name, { s: 30, w: 900 }) + 48; card(g, -w / 2, -26, w, 52, { r: 26, fill: col, lw: 3 }); text(g, name, 0, 1, { s: 30, w: 900, c: '#fff' }); });
    });
    // 本机产生的两张：虚线框
    if (local > 0) {
      g.save(); g.globalAlpha *= local; rr(g, 1318, 497, 424, 158, 20); g.setLineDash([12, 9]); g.lineWidth = 4; g.strokeStyle = C.purple; g.stroke(); g.restore();
      tag(g, '本机产生', 1530, 712, C.purple, seg(lt, 12.8, 13.2), { fs: 28 });
    }
    CODE_LIST.forEach((c, i) => {
      const t0 = 1.6 + i * .17, dp = seg(lt, t0, t0 + .45); if (dp <= 0) return;
      const sx = 260 + hash(i * 3.7 + 1) * 1400, sy = 340 + hash(i * 5.1 + 2) * 300, rot0 = (hash(i * 9.2) - .5) * .5;
      const yDrop = lerp(sy - 380, sy, eo(dp)) - Math.abs(Math.sin(dp * Math.PI * 2)) * 24 * (1 - dp);
      const sk = eio(seg(lt, 4.0 + i * .05, 4.8 + i * .05));
      const x = lerp(sx, c.x, sk), y = lerp(yDrop, c.y, sk);
      const isLocal = c.k === 'timeout' || c.k === 'interrupt';
      const col = isLocal && local > 0 ? C.purple : c.col;
      const hl = [4.4, 6.2, 8.6, 10.2][c.ci], glow = lt > hl && lt < hl + 1.6 ? 1 - seg(lt, hl + .8, hl + 1.6) : 0;
      msgCard(g, x, y, c.k, c.w, { col, rot: lerp(rot0, 0, sk), al: eo(dp) * (local > 0 && !isLocal ? 1 - .45 * local : 1), dash: isLocal && local > .5, glow });
    });
  },
});

/* 信封：外层 did，里层 stuff 五个字段 */
const ENV = { x: 960, top: 520, w: 760, h: 320 };
const STUFF = [['sessionId', C.purple], ['msgType', C.blue], ['otherProfile', C.ink2], ['selfProfile', C.ink2], ['voiceData', C.amber]];
S('s07', {
  cam: [[0, 960, 520, 1], [16, 960, 520, 1.03]],
  cues: [[.3, 'whoosh'], [1.0, 'latch', .5], [4.2, 'send'], [5.2, 'latch'], [6.2, 'tick', .5], [8.6, 'latch', .6], [12.4, 'whoosh', .5], [13.3, 'success']],
  draw(g, lt) {
    // 上方迷你舞台
    const mA = [480, 236], mG = [960, 226], mB = [1440, 236], st = ap(lt, .2);
    path(g, [[mA[0] + 80, mA[1]], [mG[0] - 60, mG[1]]], { c: rgba(C.ink, .3), w: 4, dash: [3, 12], al: st });
    path(g, [[mG[0] + 60, mG[1]], [mB[0] - 80, mB[1]]], { c: rgba(C.ink, .3), w: 4, dash: [3, 12], al: st });
    miniDevice(g, 'A', mA[0], mA[1], .4 * st, lt); gateway(g, mG[0], mG[1] + 6, .36 * st, lt, { label: false, busy: gwBusy(lt, 4.2, 1.0) });
    miniDevice(g, 'B', mB[0], mB[1], .4 * st, lt);
    text(g, '屏 A', mA[0], 314, { s: 26, w: 900, c: C.blue, al: st }); text(g, '屏 B', mB[0], 314, { s: 26, w: 900, c: C.orange, al: st });
    const flip = seg(lt, 5.2, 5.6), after = flip >= .5, did = after ? '屏 A' : '屏 B';
    if (lt > 4.2 && lt < 6.6) { // 迷你信封飞过网关，did 翻牌
      const p = lt < 5.2 ? L2([mA[0] + 90, 196], [mG[0] - 40, 186], eio(seg(lt, 4.2, 5.2))) : L2([mG[0] + 40, 186], [mB[0] - 90, 196], eio(seg(lt, 5.6, 6.4)));
      envIcon(g, p[0], p[1], .9, C.ink, { al: fo(lt, 6.3, .3) });
      at(g, p[0], p[1] - 46, 1, () => { const w = textW(g, did, { s: 26, w: 900 }) + 30; card(g, -w / 2, -20, w, 40, { r: 20, fill: after ? C.blue : C.orange, lw: 2.5, shadow: false }); text(g, did, 0, 1, { s: 26, w: 900, c: '#fff' }); },
        { sy: Math.abs(Math.cos(flip * Math.PI)) || .01, al: fo(lt, 6.3, .3) });
    }
    if (lt > 8.6 && lt < 12.4) tag(g, 'S1', mA[0] + 110, 170, C.purple, seg(lt, 8.6, 9.0), { fs: 26, al: fo(lt, 12.0) });
    // 大信封
    const { x, top, w, h } = ENV, ep = ap(lt, .3, .6);
    at(g, x, top + h / 2, ep, () => {
      const L = -w / 2, T = -h / 2;
      card(g, L, T, w, h, { r: 24, fill: '#F2E2C6', lw: 3.5, sb: 30, so: 12 });
      // 信纸
      const ly = lerp(T + 40, T - 190, eo(seg(lt, .8, 1.6))), lw2 = 600;
      card(g, -lw2 / 2, ly, lw2, 330, { r: 16, fill: '#fff', lw: 3, sb: 12, so: 4 });
      text(g, 'stuff', -lw2 / 2 + 26, ly + 30, { f: 'mono', s: 26, w: 700, c: C.ink2, a: 'left' });
      STUFF.forEach(([f, c], i) => {
        const yy = ly + 78 + i * 50, hot = i === 0 ? fa(lt, 8.4) : 0;
        if (hot > 0) { g.save(); g.globalAlpha *= hot * .9; rr(g, -lw2 / 2 + 14, yy - 22, lw2 - 28, 44, 10); g.fillStyle = rgba(C.purple, .16); g.fill(); g.restore(); }
        if (i === 0) keyIcon(g, -lw2 / 2 + 48, yy, .7, C.purple);
        text(g, f, -lw2 / 2 + 92, yy, { f: 'mono', s: 26, w: 700, c, a: 'left' });
        if (i === 0) tag(g, 'S1', 150, yy, C.purple, 1, { fs: 26 });
        else if (i === 1) text(g, '101', 150, yy, { f: 'mono', s: 26, w: 700, c: C.blue });
        else { rr(g, 90, yy - 8, 130, 16, 8); g.fillStyle = C.greyL; g.fill(); }
      });
      // 口袋
      g.save(); g.beginPath(); g.moveTo(L, T + 140); g.lineTo(0, T + 230); g.lineTo(-L, T + 140); g.lineTo(-L, -T); g.lineTo(L, -T); g.closePath();
      shadow(g, .12, 16, -4); g.fillStyle = '#F7EAD3'; g.fill(); noShadow(g); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke(); g.restore();
      path(g, [[L, -T], [0, T + 250], [-L, -T]], { c: rgba(C.ink, .18), w: 3 });
      // did 贴纸
      at(g, -170, h / 2 - 64, 1, () => { card(g, -150, -34, 300, 68, { r: 14, fill: '#fff', lw: 3 }); text(g, 'did：' + did, 0, 1, { f: 'mono', s: 30, w: 700, c: after ? C.blue : C.orange }); }, { sy: Math.abs(Math.cos(flip * Math.PI)) || .01 });
      if (lt > 4.0) text(g, after ? '收到时：变成来源' : '发出时：写对方', 10, h / 2 - 62, { s: 28, w: 700, c: C.ink2, a: 'left', al: fa(lt, 4.0) });
    });
    if (lt > 8.6) tag(g, '由发起方生成', 1440, 408, C.purple, seg(lt, 8.6, 9.0), { fs: 28 });
    // 钥匙开锁
    if (lt > 12.2) {
      const LK = [1630, 640], k = eio(seg(lt, 12.4, 13.2)), kp = L2([x - 252, 408], [LK[0] - 70, LK[1] + 8], k);
      at(g, LK[0], LK[1] - 120, ap(lt, 12.2), () => { card(g, -80, -26, 160, 52, { r: 26, fill: C.greenL, lw: 3, stroke: C.green }); text(g, '会话 S1', 0, 1, { s: 28, w: 900, c: C.green }); });
      lockIcon(g, LK[0], LK[1], 1.1 * ap(lt, 12.2), lt > 13.2 ? C.green : C.amber, eo(seg(lt, 13.2, 13.6)));
      if (lt < 13.4) keyIcon(g, kp[0], kp[1] - 40 * Math.sin(k * Math.PI), 1, C.purple);
      if (lt > 13.4) tag(g, '唯一钥匙', LK[0], LK[1] + 120, C.amber, seg(lt, 13.4, 13.8), { tc: C.ink, fs: 28 });
      burst(g, LK[0], LK[1], lt - 13.3, C.green, 12, 120);
    }
  },
});

/* 三泳道时序图：A｜网关｜B，时间向下 */
const SQ = { A: 420, G: 960, B: 1500, bot: 860 };
const HS = [{ k: 'invite', dir: 'AB', y: 300, t: 4.0 }, { k: 'ring', dir: 'BA', y: 400, t: 5.8 }, { k: 'accept', dir: 'BA', y: 540, t: 8.4 }, { k: 'confirm', dir: 'AB', y: 640, t: 11.4 }];
const HS_EV = { A: [[4.0, 'CALLING', 300], [7.2, 'RINGING', 450], [9.8, 'CHATTING', 590]], B: [[5.4, 'RINGING', 350], [8.1, 'PREPARE', 520], [12.8, 'CHATTING', 690]] };
const MSG_DUR = 1.4;
function hsPts(m) { const [x0, x1] = m.dir === 'AB' ? [SQ.A, SQ.B] : [SQ.B, SQ.A]; return [[x0, m.y], [SQ.G, m.y + 25], [x1, m.y + 50]]; }
function seqDiagram(g, T, o = {}) {
  const all = o.static ? 99 : T, bot = o.bot ?? SQ.bot;
  [['屏 A', SQ.A, C.blue, C.blueL], ['网关', SQ.G, C.purple, C.purpleL], ['屏 B', SQ.B, C.orange, C.orangeL]].forEach(([s, x, c, l], i) => {
    at(g, x, 190, ap(all, .3 + i * .15), () => { card(g, -80, -28, 160, 56, { r: 28, fill: l, lw: 3, stroke: c }); text(g, s, 0, 1, { s: 28, w: 900, c }); });
    path(g, partial([[x, 222], [x, bot]], eo(seg(all, .6 + i * .15, 1.8 + i * .15))), { c: rgba(C.ink, .3), w: 4, dash: [10, 10] });
  });
  HS.forEach((m, i) => { // 四步预告：虚线 + 序号
    const gp = eo(seg(all, 1.8 + i * .3, 2.6 + i * .3)); if (gp <= 0) return;
    path(g, partial(hsPts(m), gp), { c: C.ink, w: 3, dash: [8, 10], al: .2 });
    const nx = SQ.G - (textW(g, MSG[m.k][1], { f: 'mono', s: 27, w: 700 }) + 114) * .45 - 34;
    at(g, nx, m.y + 25, pop(gp), () => { dot(g, 0, 0, 19, C.ink); text(g, String(i + 1), 0, 2, { f: 'disp', w: 900, s: 26, c: '#fff' }); });
  });
  HS.forEach(m => {
    const p = eio(seg(all, m.t, m.t + MSG_DUR)), col = MSG[m.k][2]; if (p <= 0) return;
    const q = partial(hsPts(m), p), a = q[q.length - 2], b = q[q.length - 1];
    path(g, q, { c: col, w: 5 });
    if (p > .02) arrowHead(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), col, 20);
    if (p < 1) { dot(g, b[0], b[1], 10, col); ring(g, b[0], b[1], 18, col, 3, .5); }
    ripple(g, b[0], b[1], all - m.t - MSG_DUR, col, 14, 60, .6);
    const lab = ap(all, m.t + MSG_DUR * .4, .4);
    if (lab > 0) capsule(g, SQ.G, m.y + 25, m.k, { s: .9 * lab, glow: o.hl === m.k ? .6 : 0 });
  });
  for (const side of ['A', 'B']) HS_EV[side].forEach(([te, s, y]) => {
    const p = ap(all, te, .45); if (p <= 0) return;
    const x = side === 'A' ? 235 : 1685, lx = side === 'A' ? SQ.A : SQ.B, hw = (textW(g, s, { f: 'mono', s: 26, w: 700 }) + 56) / 2;
    path(g, [[side === 'A' ? x + hw : x - hw, y], [lx, y]], { c: stateTone(s), w: 3, al: p });
    dot(g, lx, y, 8, stateTone(s), clamp(p));
    stateTag(g, s, x, y, { s: p, glow: o.glow ? o.glow(side, s) : 0 });
  });
  tap(g, SQ.B, 520, all, 8.0);
  if (all > 7.8) text(g, '点接听', SQ.B - 34, 496, { s: 26, w: 900, a: 'right', c: C.orange, al: fa(all, 7.8) });
}
S('s08', {
  cam: [[0, 960, 530, 1], [15, 960, 535, 1.02]],
  cues: [[.3, 'latch', .5], [1.8, 'tick', .4], [2.1, 'tick', .4], [2.4, 'tick', .4], [2.7, 'tick', .4], [4.0, 'send'], [5.4, 'latch'], [5.8, 'send'], [7.2, 'latch'], [8.0, 'tick'], [8.4, 'send'], [9.8, 'latch'], [11.4, 'send'], [12.8, 'success']],
  draw(g, lt) { seqDiagram(g, lt); },
});
function talkBand(g, x, y0, y1, lt, c) { // 生命线上的“正在说话”波形
  for (let yy = y0; yy < y1; yy += 14) {
    const hw = 6 + 16 * Math.abs(Math.sin(lt * 6 + yy * .07) * Math.cos(lt * 2.3 + yy * .031));
    rr(g, x - hw, yy - 4, hw * 2, 8, 4); g.fillStyle = rgba(c, .85); g.fill();
  }
}
S('s09', {
  cam: [[0, 960, 535, 1.02], [14, 960, 540, 1.05]],
  cues: [[.4, 'success', .6], [4.6, 'success', .6], [8.8, 'latch'], [9.4, 'latch', .5]],
  draw(g, lt) {
    const aOn = lt > .4, bOn = lt > 4.6;
    const gl = fa(lt, 8.8, .6);
    if (gl > 0) {
      path(g, partial([[SQ.A, 590], [SQ.B, 590]], gl), { c: C.blue, w: 3, dash: [6, 10], al: .55 });
      path(g, partial([[SQ.A, 690], [SQ.B, 690]], gl), { c: C.orange, w: 3, dash: [6, 10], al: .55 });
    }
    if (aOn) talkBand(g, SQ.A, 598, lerp(598, 860, eo(seg(lt, .4, 1.8))), lt, C.blue);
    if (bOn) talkBand(g, SQ.B, 698, lerp(698, 860, eo(seg(lt, 4.6, 5.8))), lt, C.orange);
    seqDiagram(g, lt, { static: true, glow: (side, s) => s !== 'CHATTING' ? 0 : side === 'A' ? fa(lt, .4) * (.6 + .4 * Math.sin(lt * 4)) : fa(lt, 4.6) * (.6 + .4 * Math.sin(lt * 4)) });
    if (lt > 1.0) tag(g, 'A 开口', 235, 656, C.blue, seg(lt, 1.0, 1.4), { fs: 28 });
    if (lt > 5.2) tag(g, 'B 开口', 1685, 756, C.orange, seg(lt, 5.2, 5.6), { fs: 28 });
    if (lt > 9.2) tag(g, 'B 还在准备', 1685, 605, C.amber, seg(lt, 9.2, 9.6), { tc: C.ink, fs: 26 });
  },
});

/* =====================================================================
 * 第三章：每条消息为什么存在
 * ===================================================================== */
function panel(g, x, y, w, h, title, col, colL, al = 1) {
  if (al <= 0) return;
  g.save(); g.globalAlpha *= al;
  card(g, x - w / 2, y - h / 2, w, h, { r: 32, fill: rgba('#ffffff', .82), lw: 3.5, sb: 26, so: 10 });
  g.save(); rr(g, x - w / 2, y - h / 2, w, h, 32); g.clip(); g.fillStyle = colL; g.fillRect(x - w / 2, y - h / 2, w, 70); g.restore();
  path(g, [[x - w / 2, y - h / 2 + 70], [x + w / 2, y - h / 2 + 70]], { c: C.ink, w: 3 });
  text(g, title, x, y - h / 2 + 36, { s: 32, w: 900, c: col });
  g.restore();
}
function ghostPill(g, x, y, c, al) { if (al <= 0) return; g.save(); g.globalAlpha *= al; rr(g, x - 50, y - 18, 100, 36, 18); g.fillStyle = c; g.fill(); g.restore(); }
S('s10', {
  card: 4,
  cues: [[0, 'whoosh'], [1.8, 'latch', .6], [3.6, 'whoosh', .5], [4.0, 'error', .5], [4.6, 'error', .5], [6.0, 'latch', .5], [8.2, 'send'], [9.0, 'ring'], [9.4, 'latch', .5], [12.4, 'success'], [12.8, 'tick', .5]],
  draw(g, lt) {
    const intro = ap(lt, 1.7) * fo(lt, 3.2);
    if (intro > 0) { capsule(g, 960, 470, 'ring', { s: 1.5 * intro, glow: .6 }); badge(g, 960 + 150, 470 - 70, 36, C.grey, '?', seg(lt, 2.0, 2.4) * fo(lt, 3.2)); }
    const pa = fa(lt, 3.4, .5);
    if (pa <= 0) return;
    panel(g, 525, 490, 800, 640, '没有 RING', C.coral, C.coralL, pa);
    panel(g, 1395, 490, 800, 640, '有 RING', C.green, C.greenL, pa);
    g.save(); g.globalAlpha *= pa;
    // 左：假设没有 RING
    device(g, 'A', 330, 420, .85, { mode: 'calling', label: '呼叫中' }, lt);
    chip(g, 330, 625, lt, 'CALLING');
    badge(g, 460, 300, 30, C.grey, '?', seg(lt, 4.0, 4.4));
    if (lt > 3.8) text(g, '能等来的：', 720, 330, { s: 28, w: 900, c: C.ink2, al: fa(lt, 3.8) });
    for (const [k, t0, y] of [['busy', 4.0, 410], ['cancel', 4.6, 500]]) {
      if (lt < t0) continue; const d = seg(lt, t0, t0 + .5);
      capsule(g, 720, lerp(y - 90, y, eo(d)), k, { s: .9, al: eo(d) }); ripple(g, 720, y, lt - t0 - .5, C.coral, 30, 120);
    }
    if (lt > 6.0) tag(g, '只有坏消息', 720, 600, C.coral, seg(lt, 6.0, 6.4), { fs: 28 });
    hypo(g, '没有 RING', 525, 752, seg(lt, 4.2, 4.6));
    // 右：有 RING
    const got = lt >= 9.0;
    device(g, 'A', 1200, 420, .85, got ? { mode: 'calling', label: '对方响铃中', from: 'calling', at: 9.0 } : { mode: 'calling', label: '呼叫中' }, lt);
    chip(g, 1200, 625, lt, 'RINGING', 'CALLING', 9.0);
    const stop = seg(lt, 12.4, 12.8);
    for (let k = 0; k < 8; k++) { // 每秒重发的 INVITE 虚影
      const t0 = 4.0 + k, u = (lt - t0) / .9; if (u < 0 || u > 1 || t0 >= 12.4) continue;
      ghostPill(g, 1240 + 160 * u, 300 - 90 * eo(u), C.blue, .5 * (1 - u));
    }
    resendDial(g, 1620, 330, lt, seg(lt, 3.8, 4.3), stop);
    if (lt > 8.2) fly(g, lt, 8.2, .8, [1780, 200], [1250, 268], 'ring', { lift: 60, s: .9, hold: lt < 12.0, holdAl: fo(lt, 11.6) });
    if (lt > 9.4) tag(g, '还在推进', 1200, 740, C.green, seg(lt, 9.4, 9.8), { fs: 28 });
    if (lt > 12.8) { countdown(g, 1620, 600, 50, 1 - (lt - 12.8) / 60, '60 s', C.orange, { fs: 28 }); text(g, '改等接听', 1620, 700, { s: 26, w: 900, c: C.orange, al: fa(lt, 12.8) }); }
    g.restore();
  },
});

S('s11', {
  cues: [[.2, 'whoosh', .5], [2.0, 'latch', .5], [2.4, 'error', .4], [4.2, 'latch', .5], [4.4, 'tick'], [5.0, 'send', .4], [8.2, 'send'], [9.0, 'error'], [12.4, 'latch']],
  draw(g, lt) {
    // 四步握手里拿掉 PREPARE_CONFIRM
    const row = ap(lt, .3) * fo(lt, 3.5);
    if (row > 0) {
      const items = [['invite', 579], ['ring', 784], ['accept', 990], ['confirm', 1275]];
      items.forEach(([k, x], i) => {
        const isC = k === 'confirm', fall = isC ? seg(lt, 2.6, 3.4) : 0;
        capsule(g, x, 230 + 140 * fall * fall, k, { s: .9 * row, rot: fall * .5, glow: isC ? fa(lt, 1.8) * (1 - fall) * .7 : 0, al: 1 - fall });
        if (isC && lt > 2.2) path(g, partial([[x - 150, 236], [x + 150, 224]], eo(seg(lt, 2.2, 2.6))), { c: C.coral, w: 7, al: 1 - fall });
      });
    }
    hypo(g, '没有 PREPARE_CONFIRM', 960, 200, seg(lt, 4.0, 4.4));
    const sa = fa(lt, 3.4, .5); if (sa <= 0) return;
    g.save(); g.globalAlpha *= sa;
    const acc = lt >= 4.5;
    stage(g, lt, { busy: gwBusy(lt, 8.2), a: { mode: 'calling', label: '对方响铃中' },
      b: acc ? { mode: 'chat', label: '接听中', from: 'ringing', at: 4.5 } : { mode: 'ringing' },
      ca: ['RINGING'], cb: ['接听中', 'RINGING', 4.5, { c: C.amber }] });
    tap(g, P.B[0] + 6, P.B[1] + 20, lt, 4.4);
    // B 先发语音（A 不理会）
    if (lt > 5.0) for (let k = 0; k < 18; k++) {
      const te = 5.0 + k * .35, u = (lt - te) / 1.6; if (u < 0 || u > 1) continue;
      const x = lerp(P.B[0] - 178, P.A[0] + 220, u), y = P.B[1] + 12 - Math.sin(u * Math.PI) * 26;
      dot(g, x, y, 7, C.orange, (1 - u) * .9);
    }
    // ACCEPT 在网关处碎掉
    const top = [P.G[0], P.G[1] - 150];
    if (lt > 8.2 && lt < 9.0) fly(g, lt, 8.2, .8, [P.B[0], P.B[1] - 40], top, 'accept', { lift: 40, ripple: false });
    shatter(g, top[0], top[1], lt - 9.0, C.green);
    if (lt > 10.0) tag(g, '毫无反应', P.A[0], CHIP_Y + 70, C.grey, seg(lt, 10.0, 10.4), { fs: 28 });
    if (lt > 12.2) {
      at(g, P.B[0] + 165, P.B[1] - 150, ap(lt, 12.2), () => { dot(g, 0, 0, 46, '#fff'); ring(g, 0, 0, 46, C.ink, 3); const a = lt * 4; ring(g, 0, 0, 34, C.coral, 7, 1, a, a + 4.4); text(g, '∞', 0, 2, { f: 'disp', w: 900, s: 40, c: C.coral }); });
      tag(g, '一直停在接听中', P.B[0], CHIP_Y + 70, C.coral, seg(lt, 12.4, 12.8), { fs: 28 });
    }
    g.restore();
  },
});

function voiceStream(g, lt, dir, t0, t1, o = {}) { // 两屏之间流动的语音点
  const ab = dir === 'AB', c = ab ? C.blue : C.orange;
  for (let k = 0; k < 60; k++) {
    const te = t0 + k * .3; if (te > t1 || te > lt) break;
    const u = (lt - te) / 1.6; if (u < 0 || u > 1) continue;
    const uu = ab ? u : 1 - u, x = lerp(P.A[0] + 178, P.B[0] - 178, uu), y = P.A[1] - 10 - Math.sin(uu * Math.PI) * 30 + (ab ? -16 : 16);
    dot(g, x, y, 7, c, (o.al ?? 1) * (.5 + .5 * Math.sin(uu * Math.PI)));
  }
}
S('s12', {
  cues: [[.8, 'latch', .5], [1.2, 'send'], [2.8, 'success'], [4.6, 'whoosh', .5], [5.0, 'send', .5], [5.8, 'error'], [6.0, 'tick', .5], [6.8, 'tick', .5], [7.6, 'tick', .5], [8.4, 'latch'], [9.4, 'success'], [9.8, 'success', .6]],
  draw(g, lt) {
    const ph2 = lt >= 5.0;
    const a = lt < .8 ? { mode: 'calling', label: '对方响铃中' } : { mode: 'chat', from: 'calling', fromOpt: { label: '对方响铃中' }, at: .8 };
    let b, cb;
    if (!ph2) { b = lt < 2.8 ? { mode: 'prepare' } : { mode: 'chat', from: 'prepare', at: 2.8 }; cb = ['CHATTING', 'PREPARE', 2.8]; }
    else { b = lt < 8.4 ? { mode: 'prepare', from: 'chat', at: 5.0 } : { mode: 'timeout', label: '准备超时', from: 'prepare', at: 8.4 }; cb = ['ENDED.PREPARE_TIMEOUT', 'PREPARE', 8.4]; }
    stage(g, lt, { busy: Math.max(gwBusy(lt, 1.2), gwBusy(lt, 5.0)), a, b, ca: ['CHATTING', 'RINGING', .8], cb });
    relay(g, lt, -.8, 'accept', 'BA');
    voiceStream(g, lt, 'AB', .9, 99);
    if (!ph2) { if (lt > 1.2) relay(g, lt, 1.2, 'confirm', 'AB', { hold: lt < 4.4 }); voiceStream(g, lt, 'BA', 2.9, 4.6, { al: fo(lt, 4.6) }); }
    else {
      const top = [P.G[0], P.G[1] - 175];
      if (lt < 5.8) fly(g, lt, 5.0, .8, [P.A[0], P.A[1] - 40], top, 'confirm', { lift: 80, ripple: false });
      shatter(g, top[0], top[1], lt - 5.8, C.green);
      if (lt > 6.0) {
        const left = clamp(1 - (lt - 6.0) / 2.4);
        countdown(g, P.B[0], 222, 52, left, Math.ceil(3 * left) + ' s', C.amber, { fs: 30 });
        text(g, '准备计时', P.B[0] - 92, 222, { s: 26, w: 900, a: 'right', c: C.amber, al: fa(lt, 6.0) });
      }
    }
    // 回放提示
    const rw = win(lt, 4.6, 6.2, .2, .4);
    if (rw > 0) at(g, 960, 160, 1, () => { card(g, -190, -36, 380, 72, { r: 36, fill: C.ink, lw: 0 });
      for (const dx of [-150, -118]) { g.beginPath(); g.moveTo(dx + 16, -18); g.lineTo(dx - 12, 0); g.lineTo(dx + 16, 18); g.closePath(); g.fillStyle = '#fff'; g.fill(); }
      text(g, '如果确认没来', 34, 2, { s: 30, w: 900, c: '#fff' }); }, { al: rw });
    if (lt > 9.4) { tag(g, '时序 ✓', 800, 800, C.green, seg(lt, 9.4, 9.8), { fs: 30 }); tag(g, '状态同步 ✓', 1120, 800, C.green, seg(lt, 9.8, 10.2), { fs: 30 }); }
  },
});

S('s13', {
  cues: [[.6, 'tick'], [1.0, 'send'], [2.0, 'latch', .5], [4.2, 'error'], [4.6, 'tick', .4], [8.2, 'tick', .5], [9.2, 'tick', .5], [10.2, 'tick', .5], [11.4, 'latch'], [12.4, 'success']],
  draw(g, lt) {
    const bEnd = lt >= 11.4;
    stage(g, lt, { a: lt < .8 ? { mode: 'chat' } : { mode: 'ended', label: '已挂断', from: 'chat', at: .8 },
      b: !bEnd ? { mode: 'chat' } : { mode: 'ended', label: '自动挂断', from: 'chat', at: 11.4 },
      ca: ['ENDED.HANGUP', 'CHATTING', .8], cb: ['ENDED.DATA_INTERRUPT', 'CHATTING', 11.4] });
    tap(g, P.A[0] + 6, P.A[1] + 20, lt, .6);
    voiceStream(g, lt, 'AB', -6, .8); voiceStream(g, lt, 'BA', -6, 11.4);
    // 单程票：飞到网关上方，悬停，然后掉落
    if (lt > 1.0) {
      const fall = seg(lt, 4.2, 5.2), p = L2([P.A[0] + 60, 300], [P.G[0], 218], eio(seg(lt, 1.0, 2.0)));
      const y = p[1] - (lt < 2.0 ? Math.sin(seg(lt, 1.0, 2.0) * Math.PI) * 60 : wob(lt, .6, 6)) + 420 * fall * fall;
      if (fall < 1) ticket(g, p[0], y, .92, { rot: fall * .7, al: 1 - fall });
    }
    if (lt > 2.0 && lt < 4.4) tag(g, '不等回复', P.G[0], 136, C.coral, seg(lt, 2.0, 2.4), { fs: 28, al: fo(lt, 4.0) });
    hypo(g, 'B 没收到', P.G[0], 136, seg(lt, 4.3, 4.7) * fo(lt, 12.0));
    // B 的码率表
    if (lt > 4.6) {
      const ma = ap(lt, 4.6);
      at(g, P.B[0] - 40, 222, ma, () => {
        card(g, -170, -50, 340, 100, { r: 22, fill: '#fff', lw: 3 });
        text(g, '语音码率', -96, 1, { s: 28, w: 900, c: C.ink2 });
        for (let i = 0; i < 6; i++) { rr(g, 10 + i * 24, 26 - 6, 14, 6, 3); g.fillStyle = C.greyL; g.fill(); }
        text(g, '0', 148, 1, { f: 'disp', w: 900, s: 40, c: C.coral });
      });
    }
    if (lt > 8.2) { const left = clamp(1 - (lt - 8.2) / 3); countdown(g, P.B[0] + 210, 222, 42, left, Math.ceil(3 * left) + ' s', C.coral, { fs: 26 }); }
    if (lt > 12.2) {
      ticket(g, P.G[0], 218, .92 * ap(lt, 12.2));
      badge(g, P.G[0] + 135, 184, 28, C.green, 'check', seg(lt, 12.6, 13.0));
      tag(g, '单程票：省掉一次确认', 960, 800, C.green, seg(lt, 12.6, 13.0), { fs: 30 });
    }
  },
});

const DIALS = [['INVITE 重发', '1 s × 10', '10', C.blue, 'CALLING'], ['响铃', '60 s', '60', C.orange, 'RINGING'], ['准备', '3 s', '3', C.amber, 'PREPARE']];
S('s14', {
  cues: [[.5, 'tick', .5], [1.0, 'tick', .5], [1.5, 'tick', .5], [4.2, 'send'], [5.0, 'latch', .5], [5.4, 'send'], [6.2, 'latch', .5], [6.6, 'send'], [7.4, 'latch', .5], [8.2, 'tick', .5], [9.2, 'tick', .5], [10.2, 'tick', .5], [11.2, 'error', .4], [11.8, 'success', .6]],
  draw(g, lt) {
    const BOX = [1000, 500], fire = i => 4.2 + i * 1.2;
    // 状态机盒
    at(g, BOX[0], BOX[1], ap(lt, .8), () => {
      card(g, -170, -120, 340, 240, { r: 28, fill: '#fff', lw: 3.5 });
      g.save(); rr(g, -170, -120, 340, 240, 28); g.clip(); g.fillStyle = C.purpleL; g.fillRect(-170, -120, 340, 64); g.restore();
      path(g, [[-170, -56], [170, -56]], { c: C.ink, w: 3 });
      text(g, '状态机', 0, -87, { s: 30, w: 900, c: C.purple });
      text(g, 'transferStatus()', 0, 74, { f: 'mono', s: 24, w: 700, c: C.ink2 });
    });
    // 当前处理的是哪个状态
    let cur = -1;
    for (let i = 0; i < 3; i++) if (lt >= fire(i) + .8) cur = i;
    if (lt >= 8.0 && lt < 11) cur = Math.min(2, Math.floor((lt - 8.0) / 1.0));
    if (cur >= 0) stateTag(g, DIALS[cur][4], BOX[0], BOX[1] + 4, {});
    DIALS.forEach(([name, sub, num, col, st], i) => {
      const y = 300 + i * 200, p = ap(lt, .4 + i * .2), f = fire(i);
      if (p <= 0) return;
      at(g, 300, y, p, () => countdown(g, 0, 0, 50, lt < f ? 1 - seg(lt, .4, f) : 0, num, col, { fs: 30 }));
      ripple(g, 300, y, lt - f, col, 50, 130);
      text(g, name, 382, y - 18, { s: 30, w: 900, a: 'left', al: p });
      text(g, sub, 382, y + 22, { f: 'mono', s: 26, w: 700, a: 'left', c: col, al: p });
      // 吐出 TIMEOUT_END，飞进状态机
      if (lt > f && lt < f + .9) { const u = eio(seg(lt, f, f + .8)), q = bez([300, y - 72], [700, y - 120], [BOX[0] - 210, BOX[1]], u); capsule(g, q[0], q[1], 'timeout', { s: .9, glow: .5, al: 1 - seg(lt, f + .55, f + .8) }); }
      // 输出：当前状态 → 对应的超时结束态
      const ot = f + 1.1, op = ap(lt, ot), oy = 300 + i * 200, end = 'ENDED.' + st + '_TIMEOUT', hw = (textW(g, end, { f: 'mono', s: 26, w: 700 }) + 56) / 2;
      if (op > 0) {
        arrow(g, [[BOX[0] + 172, BOX[1] + (i - 1) * 60], [1560 - hw - 14, oy]], { p: eo(seg(lt, ot - .3, ot + .1)), c: C.purple, w: 4, hs: 14 });
        text(g, '当前 ' + st, 1560 - hw, oy - 46, { f: 'mono', s: 24, w: 700, a: 'left', c: C.ink2, al: op });
        stateTag(g, end, 1560, oy, { s: op, glow: cur === i && lt >= 8.0 && lt < 11 ? .8 : 0 });
      }
    });
    // 状态类不认识定时器
    if (lt > 11.0) {
      const k = seg(lt, 11.0, 11.8), y = 300 - Math.sin(clamp(k * 1.6) * Math.PI) * 50 + (k > .62 ? 0 : 0);
      stopwatch(g, BOX[0], k < .5 ? lerp(220, 330, eo(k * 2)) : lerp(330, 250, eo((k - .5) * 2)), .9, C.ink2, { a: lt * 3, al: fa(lt, 11.0) });
      badge(g, BOX[0] + 60, 250, 26, C.coral, 'cross', seg(lt, 11.3, 11.6));
      tag(g, '单一职责', BOX[0], 690, C.purple, seg(lt, 11.8, 12.2), { fs: 30 });
    }
  },
});

/* =====================================================================
 * 第四章：两台状态机
 * ===================================================================== */
const SM_X = [330, 670, 1010, 1350, 1690], SM_Y = { A: 300, B: 470 };
const SM_ROWS = { A: ['IDLE', 'CALLING', 'RINGING', null, 'CHATTING'], B: ['IDLE', null, 'RINGING', 'PREPARE', 'CHATTING'] };
const BRICKS = ['SELF_BUSY', 'NETWORK_ERROR', 'OTHER_BUSY', 'OTHER_TERMINATED', 'SELF_TERMINATED', 'CALLING_TIMEOUT', 'RINGING_TIMEOUT', 'PREPARE_TIMEOUT', 'HANGUP', 'DATA_INTERRUPT'];
const brickPos = name => { const i = BRICKS.indexOf(name); return [SM_X[i % 5], 700 + Math.floor(i / 5) * 76]; };
const BRICK_TONE = { SELF_BUSY: C.amber, OTHER_BUSY: C.amber, OTHER_TERMINATED: C.coral, SELF_TERMINATED: C.coral, CALLING_TIMEOUT: C.purple,
  RINGING_TIMEOUT: C.purple, PREPARE_TIMEOUT: C.purple, HANGUP: C.green, DATA_INTERRUPT: C.orange, NETWORK_ERROR: C.ink2 };
const FAIL = [ // [行, 列, 结束态, s16 局部出现时刻]；均来自主叫/被叫状态转移表
  ['A', 1, 'OTHER_BUSY', 4.6], ['A', 1, 'OTHER_TERMINATED', 4.85], ['A', 1, 'CALLING_TIMEOUT', 5.1], ['A', 2, 'RINGING_TIMEOUT', 5.35], ['B', 3, 'PREPARE_TIMEOUT', 5.6],
  ['A', 0, 'SELF_BUSY', 5.85], ['A', 0, 'NETWORK_ERROR', 6.1], ['B', 2, 'SELF_TERMINATED', 6.35], ['A', 4, 'HANGUP', 6.6], ['A', 4, 'DATA_INTERRUPT', 6.85],
  ['B', 2, 'OTHER_TERMINATED', 7.1], ['B', 2, 'RINGING_TIMEOUT', 7.3], ['B', 4, 'HANGUP', 7.5], ['B', 4, 'DATA_INTERRUPT', 7.7], ['B', 0, 'SELF_BUSY', 7.9],
  ['B', 0, 'SELF_TERMINATED', 8.1], ['B', 3, 'HANGUP', 8.3], ['A', 2, 'OTHER_TERMINATED', 8.5], ['A', 1, 'SELF_TERMINATED', 8.7], ['A', 2, 'SELF_TERMINATED', 8.9],
];
const CATS = [[9.0, ['SELF_BUSY', 'OTHER_BUSY']], [9.9, ['OTHER_TERMINATED', 'SELF_TERMINATED']], [10.8, ['CALLING_TIMEOUT', 'RINGING_TIMEOUT', 'PREPARE_TIMEOUT']], [11.7, ['DATA_INTERRUPT']], [12.6, ['NETWORK_ERROR']]];
function catOn(name, lt) { for (const [t0, list] of CATS) if (lt >= t0 && lt < t0 + .9 && list.includes(name)) return 1 - seg(lt, t0 + .5, t0 + .9) * .4; return 0; }
function failPts(r, c, name) {
  const [x, y] = [SM_X[c], SM_Y[r] + 38], [bx, by] = brickPos(name), pts = [], dx = (hash(c * 7 + BRICKS.indexOf(name)) - .5) * 60;
  for (let i = 0; i <= 18; i++) { const u = i / 18, v = 1 - u; pts.push([v * v * v * x + 3 * v * v * u * (x + dx) + 3 * v * u * u * bx + u * u * u * bx, v * v * v * y + 3 * v * v * u * (y + 120) + 3 * v * u * u * (by - 140) + u * u * u * (by - 30)]); }
  return pts;
}
/* 两排状态机 + 结束墙；o: {nodes(lt), succ, fail, lit, ghost, prep} */
function smScene(g, lt, o = {}) {
  const nodeP = o.nodeP || (() => 1);
  // 成功路径高亮（时序图那一条）
  if (o.succ > 0) for (const r of ['A', 'B']) { const pts = SM_ROWS[r].map((s, c) => s ? [SM_X[c], SM_Y[r]] : null).filter(Boolean); path(g, partial(pts, o.succ), { c: rgba(C.green, .35), w: 34, al: 1 }); }
  // 失败边
  if (o.failT != null) FAIL.forEach(([r, c, name, t0]) => {
    const p = eo(seg(o.failT, t0, t0 + .5)); if (p <= 0) return;
    const hot = catOn(name, o.failT), col = BRICK_TONE[name];
    const q = partial(failPts(r, c, name), p);
    path(g, q, { c: col, w: hot ? 5 : 3, al: hot ? 1 : .55 });
    if (p > .95) { const a = q[q.length - 2], b = q[q.length - 1]; arrowHead(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), col, 14, hot ? 1 : .6); }
  });
  // 成功边
  for (const r of ['A', 'B']) {
    const cols = SM_ROWS[r].map((s, c) => s ? c : -1).filter(c => c >= 0), y = SM_Y[r];
    for (let k = 0; k < cols.length - 1; k++) {
      const c0 = cols[k], c1 = cols[k + 1], p = o.edgeP ? o.edgeP(r, k) : 1; if (p <= 0) continue;
      const x0 = SM_X[c0] + 112, x1 = SM_X[c1] - 112, skip = c1 - c0 > 1, col = r === 'A' ? C.blue : C.orange;
      if (!skip) arrow(g, [[x0, y], [x1, y]], { p, c: col, w: 4, hs: 16 });
      else { const pts = []; for (let i = 0; i <= 20; i++) pts.push(bez([x0 - 20, y - 30], [(x0 + x1) / 2, y - 130], [x1 + 20, y - 30], i / 20)); arrow(g, pts, { p, c: col, w: 4, hs: 16 }); }
    }
  }
  // 行标签与节点
  for (const r of ['A', 'B']) {
    const lp = nodeP(r, -1);
    if (lp > 0) at(g, 150, SM_Y[r], pop(lp), () => { const c = r === 'A' ? C.blue : C.orange; card(g, -56, -26, 112, 52, { r: 26, fill: c, lw: 3 }); text(g, r === 'A' ? '主叫' : '被叫', 0, 1, { s: 28, w: 900, c: '#fff' }); });
    SM_ROWS[r].forEach((s, c) => {
      if (!s) return; const p = nodeP(r, c); if (p <= 0) return;
      node(g, SM_X[c], SM_Y[r], s, { s: pop(p), on: o.on ? o.on(r, s) : 0, pulse: o.pulse ? o.pulse(r, s) : false, t: lt, c: stateTone(s) });
    });
  }
  if (o.ghost > 0) { // 主叫没有 PREPARE
    at(g, SM_X[3], SM_Y.A, pop(o.ghost), () => { card(g, -100, -36, 200, 72, { r: 36, fill: rgba('#ffffff', .5), lw: 3, dash: [10, 8], stroke: C.grey, shadow: false }); text(g, 'PREPARE', 0, 2, { f: 'mono', s: 28, w: 700, c: C.grey }); });
    icCross(g, SM_X[3], SM_Y.A, 60, C.coral, o.ghostX || 0, 9);
  }
  // 结束墙
  BRICKS.forEach((name, i) => {
    const p = o.brickP ? o.brickP(i) : 1; if (p <= 0) return;
    const [x, y] = brickPos(name), lit = o.lit ? o.lit(name) : 0, hot = o.failT != null ? catOn(name, o.failT) : 0, col = BRICK_TONE[name];
    const yy = y - (1 - eo(p)) * 160 - Math.abs(Math.sin(p * Math.PI * 2)) * 14 * (1 - p);
    if (hot) { g.save(); rr(g, x - 150, yy - 30, 300, 60, 14); g.shadowColor = rgba(col, .8); g.shadowBlur = 26 * SH(); g.fillStyle = col; g.fill(); g.restore(); }
    card(g, x - 150, yy - 30, 300, 60, { r: 14, fill: lit ? rgba(col, .2 + .8 * hot) : '#fff', lw: 3, stroke: lit ? col : C.ink, sb: 10, so: 4, al: eo(p) });
    text(g, name, x, yy + 1, { f: 'mono', s: 24, w: 700, c: hot ? '#fff' : lit ? C.ink : C.ink2, al: eo(p) });
  });
}
S('s15', {
  card: 5,
  cues: [[0, 'whoosh'], [1.7, 'latch', .5], [2.4, 'latch', .5], [3.0, 'latch', .5], [4.2, 'latch'], ...BRICKS.map((_, i) => [4.6 + i * .18, 'tick', .4]), [8.0, 'latch', .5], [8.4, 'error', .4], [12.4, 'success', .7]],
  draw(g, lt) {
    smScene(g, lt, {
      nodeP: (r, c) => seg(lt, (r === 'A' ? 1.6 : 2.3) + (c + 1) * .14, (r === 'A' ? 2.0 : 2.7) + (c + 1) * .14),
      edgeP: (r, k) => eo(seg(lt, (r === 'A' ? 2.4 : 3.0) + k * .25, (r === 'A' ? 2.9 : 3.5) + k * .25)),
      brickP: i => seg(lt, 4.6 + i * .18, 5.1 + i * .18),
      ghost: seg(lt, 8.0, 8.4), ghostX: eo(seg(lt, 8.4, 8.8)),
      pulse: (r, s) => r === 'B' && s === 'PREPARE' && lt > 12.2,
      on: (r, s) => r === 'B' && s === 'PREPARE' ? fa(lt, 12.2) : 0,
    });
    if (lt > 4.2) tag(g, '活跃态 × 5', 1010, 385, C.ink, seg(lt, 4.2, 4.6), { fs: 28 });
    if (lt > 4.8) tag(g, '结束态 × 10', 1010, 604, C.coral, seg(lt, 4.8, 5.2), { fs: 28 });
    if (lt > 12.6) tag(g, '等 PREPARE_CONFIRM', 1350, 548, C.amber, seg(lt, 12.6, 13.0), { tc: C.ink, fs: 26 });
  },
});
S('s16', {
  cues: [[.4, 'success', .6], [4.4, 'whoosh', .5], ...FAIL.map(f => [f[3], 'tick', .35]), [9.0, 'latch', .5], [9.9, 'latch', .5], [10.8, 'latch', .5], [11.7, 'latch', .5], [12.6, 'latch', .5], [13.8, 'latch']],
  draw(g, lt) {
    const succ = eo(seg(lt, .4, 2.6)) * (1 - .6 * fa(lt, 4.4, .6));
    const litT = name => { const f = FAIL.filter(x => x[2] === name).map(x => x[3]); return f.length && lt >= Math.min(...f) + .45 ? 1 : 0; };
    smScene(g, lt, { succ, failT: lt, lit: litT, ghost: 1, ghostX: 1 });
    if (lt < 4.6) tag(g, '时序图只画这条', 1010, 385, C.green, seg(lt, .8, 1.2), { fs: 28, al: fo(lt, 4.2) });
    if (lt > 13.8) { tag(g, '多数箭头 → 结束', 1010, 385, C.coral, seg(lt, 13.8, 14.2), { fs: 30 }); g.save(); g.globalAlpha *= win(lt, 13.8, 14.8, .15, .5) * .35; rr(g, 165, 650, 1690, 162, 20); g.fillStyle = C.coral; g.fill(); g.restore(); }
  },
});
S('s17', {
  cues: [[.4, 'latch'], [1.0, 'latch', .5], [4.8, 'send'], [6.4, 'latch', .5], [6.6, 'send'], [8.2, 'latch', .5], [9.4, 'tick'], [9.8, 'tick'], [10.2, 'tick'], [10.6, 'tick'], [11.0, 'success', .6]],
  draw(g, lt) {
    const mach = (x, role, states, cur, p) => at(g, x, 500, pop(p), () => {
      const c = ROLE[role].c, l = ROLE[role].l;
      card(g, -260, -200, 520, 400, { r: 32, fill: '#fff', lw: 3.5, sb: 28, so: 12 });
      g.save(); rr(g, -260, -200, 520, 400, 32); g.clip(); g.fillStyle = l; g.fillRect(-260, -200, 520, 70); g.restore();
      path(g, [[-260, -130], [260, -130]], { c: C.ink, w: 3 });
      text(g, (role === 'A' ? '主叫 A' : '被叫 B') + ' · 状态机', 0, -164, { s: 30, w: 900, c });
      states.forEach((s, i) => { const on = i === cur; node(g, 0, -80 + i * 74, s, { s: .86, on: on ? 1 : 0, c: stateTone(s) }); });
    });
    const aCur = lt < 4.8 ? 0 : lt < 8.2 ? 1 : 2, bCur = lt < 6.4 ? 0 : 1;
    mach(480, 'A', ['IDLE', 'CALLING', 'RINGING', 'CHATTING'], aCur, seg(lt, .2, .7));
    mach(1440, 'B', ['IDLE', 'RINGING', 'PREPARE', 'CHATTING'], bCur, seg(lt, .4, .9));
    // 玻璃墙
    const wp = eo(seg(lt, .4, 1.0));
    if (wp > 0) {
      g.save(); g.globalAlpha *= wp; rr(g, 935, 300, 50, 400 * wp, 12); g.fillStyle = rgba(C.blueL, .7); g.fill(); g.lineWidth = 3; g.strokeStyle = rgba(C.blue, .6); g.stroke();
      for (let i = 0; i < 3; i++) path(g, [[945, 320 + i * 120], [975, 290 + i * 120]], { c: rgba('#ffffff', .9), w: 5 }); g.restore();
      tag(g, '不共享内存', 960, 500, C.ink, seg(lt, 1.0, 1.4), { fs: 28 });
    }
    gateway(g, 960, 214, .46 * ap(lt, 3.8), lt, { label: false, busy: Math.max(gwBusy(lt, 4.8), gwBusy(lt, 6.6)) });
    if (lt > 4.8 && lt < 6.9) { if (lt < 5.6) fly(g, lt, 4.8, .8, [560, 300], [900, 196], 'invite', { lift: 40, ripple: false, s: .9 }); else fly(g, lt, 5.6, .8, [1020, 196], [1360, 300], 'invite', { lift: 40, s: .9 }); }
    if (lt > 6.6 && lt < 8.7) { if (lt < 7.4) fly(g, lt, 6.6, .8, [1360, 300], [1020, 196], 'ring', { lift: 40, ripple: false, s: .9 }); else fly(g, lt, 7.4, .8, [900, 196], [560, 300], 'ring', { lift: 40, s: .9 }); }
    const OUT = [['INVITE 重发', C.blue, 330], ['RING 补发', C.blue, 760], ['准备超时 3 s', C.amber, 1160], ['码率检测 3 s', C.orange, 1590]];
    OUT.forEach(([s, c, x], i) => { if (lt > 9.4 + i * .4) tag(g, s, x, 790, c, seg(lt, 9.4 + i * .4, 9.8 + i * .4), { fs: 28, tc: c === C.amber ? C.ink : '#fff' }); });
  },
});

/* =====================================================================
 * 第五章：代码架构
 * ===================================================================== */
const CODE = ['object RINGING : SessionStatus {', '  override fun transferStatus(msg: MessageType) =', '    when (msg) {', '      ACCEPT        -> CHATTING',
  '      TERMINATE_END -> ENDED.OTHER_TERMINATED', '      TIMEOUT_END   -> ENDED.RINGING_TIMEOUT', '      else          -> this', '    }', '}'];
const CODE_RE = /(\bobject\b|\boverride\b|\bfun\b|\bwhen\b|\belse\b|\bthis\b|ACCEPT|TERMINATE_END|TIMEOUT_END|ENDED\.\w+|CHATTING|RINGING|SessionStatus|MessageType|transferStatus)/;
function codeColor(p) {
  if (/^(object|override|fun|when|else|this)$/.test(p)) return '#FF8FA3';
  if (/^(ACCEPT|TERMINATE_END|TIMEOUT_END)$/.test(p)) return '#8FB4FF';
  if (/^(ENDED\.\w+|CHATTING|RINGING)$/.test(p)) return '#FFC27A';
  if (/^(SessionStatus|MessageType)$/.test(p)) return '#7FE0C0';
  if (p === 'transferStatus') return '#F2E08A';
  return '#E8EAF2';
}
function codeCard(g, x0, y0, w, h, lt, o = {}) {
  card(g, x0, y0, w, h, { r: 30, fill: '#1F2433', lw: 3.5, sb: 34, so: 14 });
  for (const [i, c] of [[0, C.coral], [1, C.amber], [2, C.green]]) dot(g, x0 + 36 + i * 30, y0 + 34, 9, c);
  text(g, '重新写过的示意代码', x0 + w - 30, y0 + 35, { s: 24, w: 700, c: rgba('#ffffff', .6), a: 'right' });
  if (o.hl) for (const [a, b, c, k] of o.hl) { if (k <= 0) continue; rr(g, x0 + 18, y0 + 76 + a * 50, (w - 36) * k, (b - a + 1) * 50, 10); g.fillStyle = rgba(c, .22); g.fill(); }
  const typed = o.typed ?? 1, total = CODE.reduce((s, l) => s + l.length, 0); let budget = Math.round(total * typed);
  CODE.forEach((ln, i) => {
    if (budget <= 0) return; const s = ln.slice(0, budget); budget -= ln.length;
    let x = x0 + 40; const y = y0 + 101 + i * 50;
    for (const p of s.split(CODE_RE)) { if (!p) continue; text(g, p, x, y, { f: 'mono', s: 27, w: 700, c: codeColor(p), a: 'left' }); x += textW(g, p, { f: 'mono', s: 27, w: 700 }); }
  });
}
S('s18', {
  card: 6,
  cam: [[0, 960, 500, 1], [16, 960, 500, 1.02]],
  cues: [[0, 'whoosh'], [2.0, 'tick', .4], [2.4, 'tick', .4], [2.8, 'tick', .4], [3.2, 'tick', .4], [4.4, 'send'], [5.2, 'latch'], [8.4, 'error', .4], [8.8, 'error', .4], [12.4, 'whoosh', .6], [13.4, 'latch']],
  draw(g, lt) {
    const cp = ap(lt, 1.6);
    if (cp > 0) at(g, 560, 500, cp, () => codeCard(g, -450, -280, 900, 560, lt, {
      typed: clamp((lt - 1.8) / 1.8),
      hl: [[3, 3, C.amber, eo(seg(lt, 4.2, 4.6)) * fo(lt, 7.8)], [2, 7, C.blue, eo(seg(lt, 8.0, 8.5)) * fo(lt, 12.0)]],
    }));
    // 状态盒：进一条消息，出一个状态
    const BX = [1450, 430], bp = ap(lt, 2.0);
    if (bp > 0) {
      at(g, BX[0], BX[1], bp, () => { card(g, -160, -75, 320, 150, { r: 28, fill: C.orangeL, lw: 3.5, stroke: C.orange }); text(g, 'RINGING', 0, 2, { f: 'mono', s: 38, w: 700, c: C.orange }); });
      tag(g, '单例', BX[0] + 160, BX[1] - 75, C.ink, seg(lt, 2.6, 3.0), { fs: 26 });
    }
    if (lt > 4.2 && lt < 5.3) { const k = eio(seg(lt, 4.3, 5.0)); capsule(g, BX[0], lerp(214, 330, k), 'accept', { s: .9 * (1 - .5 * seg(lt, 4.9, 5.2)), al: 1 - seg(lt, 5.0, 5.2) }); }
    if (lt > 5.0) {
      arrow(g, [[BX[0], BX[1] + 78], [BX[0], 576]], { p: eo(seg(lt, 5.0, 5.3)), c: C.green, w: 5, hs: 16 });
      node(g, BX[0], 620, 'CHATTING', { s: ap(lt, 5.2), c: C.green, on: 1 });
    }
    // 副作用：不在这里
    const ICX = 1712, sx = lt > 12.6 ? eio(seg(lt, 12.6, 13.4)) : 0;
    const swP = L2([ICX, 382], [1528, 772], sx), evP = L2([ICX, 512], [1610, 772], sx);
    if (lt > 8.0) {
      stopwatch(g, swP[0], swP[1], .8 * ap(lt, 8.0), C.ink, { a: lt * 2 });
      envIcon(g, evP[0], evP[1], .9 * ap(lt, 8.3), C.ink);
      const xs = fo(lt, 12.4);
      if (xs > 0) { badge(g, ICX + 36, 352, 22, C.coral, 'cross', seg(lt, 8.4, 8.7) * xs); badge(g, ICX + 36, 486, 22, C.coral, 'cross', seg(lt, 8.8, 9.1) * xs);
        text(g, '停表', ICX, 438, { s: 26, w: 900, c: C.ink2, al: fa(lt, 8.0) * xs }); text(g, '发消息', ICX, 562, { s: 26, w: 900, c: C.ink2, al: fa(lt, 8.3) * xs }); }
    }
    if (lt > 12.3) {
      const ip = ap(lt, 12.3);
      at(g, BX[0] + 20, 772, ip, () => { card(g, -200, -52, 400, 104, { r: 26, fill: NAVYL, lw: 3.5, stroke: NAVY }); text(g, '拦截器', -110, 1, { s: 34, w: 900, c: NAVY }); });
      if (lt > 12.6) { stopwatch(g, swP[0], swP[1], .8, C.ink, { a: lt * 2 }); envIcon(g, evP[0], evP[1], .9, C.ink); }
    }
  },
});

/* 收消息三步走：① transferStatus → ② 拦截器表 → ③ 变了才广播 */
const ITB = { x: 520, y: 300, w: 760, row: 56 };
const IROWS = [['(RING, RINGING)', '停止重发 · 启动 60 s'], ['(ACCEPT, CHATTING)', '发确认 · 停 60 s'], ['(TIMEOUT_END, CALLING_TIMEOUT)', '补发 TERMINATE_END'], ['(INVITE, RINGING)', '补发 RING']];
function itable(g, lt, o = {}) {
  const { x, y, w, row } = ITB, n = IROWS.length + (o.extra || 0 ? 1 : 0), h = 52 + n * row;
  card(g, x, y, w, 52 + IROWS.length * row + (o.extra || 0) * row, { r: 20, fill: '#fff', lw: 3.5, sb: 24, so: 9 });
  g.save(); rr(g, x, y, w, 52, 20); g.clip(); g.fillStyle = NAVYL; g.fillRect(x, y, w, 52); g.restore();
  path(g, [[x, y + 52], [x + w, y + 52]], { c: C.ink, w: 3 }); path(g, [[x + 456, y], [x + 456, y + h - (o.extra ? (1 - o.extra) * row : 0)]], { c: rgba(C.ink, .25), w: 2 });
  text(g, '（消息, 新状态）', x + 24, y + 27, { s: 26, w: 900, c: NAVY, a: 'left' }); text(g, '副作用', x + 474, y + 27, { s: 26, w: 900, c: NAVY, a: 'left' });
  IROWS.forEach(([k, v], i) => {
    const yy = y + 52 + i * row + row / 2, hot = o.hot === i ? o.hotK || 0 : 0;
    if (hot > 0) { g.save(); g.globalAlpha *= hot; rr(g, x + 8, yy - row / 2 + 5, w - 16, row - 10, 10); g.fillStyle = rgba(C.amber, .35); g.fill(); g.restore(); }
    if (i) path(g, [[x + 16, yy - row / 2], [x + w - 16, yy - row / 2]], { c: rgba(C.ink, .12), w: 2 });
    text(g, k, x + 24, yy, { f: 'mono', s: 24, w: 700, a: 'left' }); text(g, v, x + 474, yy, { s: 26, w: 700, a: 'left', c: C.ink });
  });
  if (o.extra) { const yy = y + 52 + IROWS.length * row + row / 2;
    g.save(); g.globalAlpha *= o.extra; rr(g, x + 8, yy - row / 2 + 5, w - 16, row - 10, 10); g.setLineDash([10, 7]); g.lineWidth = 3; g.strokeStyle = C.green; g.stroke(); g.fillStyle = rgba(C.greenL, .8); g.fill(); g.restore();
    text(g, '(新消息, 新状态)', x + 24, yy, { f: 'mono', s: 24, w: 700, a: 'left', c: C.green, al: o.extra }); text(g, '新的副作用', x + 474, yy, { s: 26, w: 700, a: 'left', c: C.green, al: o.extra }); }
  text(g, '共 7 个，此处列 4', x + w, y + h + 30 - (o.extra ? (1 - o.extra) * row : 0), { s: 24, w: 700, c: C.ink2, a: 'right' });
}
function diamond(g, x, y, r, fill, stroke) { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 1.25, y); g.lineTo(x, y + r); g.lineTo(x - r * 1.25, y); g.closePath(); g.fillStyle = fill; g.fill(); g.lineWidth = 3.5; g.strokeStyle = stroke; g.stroke(); }
function stepBox(g, x, y, title, sub, p, o = {}) {
  at(g, x, y, pop(p), () => {
    if (o.glow) { g.save(); rr(g, -150, -70, 300, 140, 26); g.shadowColor = rgba(C.amber, .8 * o.glow); g.shadowBlur = 34 * SH(); g.fillStyle = C.amber; g.fill(); g.restore(); }
    card(g, -150, -70, 300, 140, { r: 26, fill: '#fff', lw: 3.5, stroke: o.stroke || C.ink });
    text(g, title, 0, sub ? -18 : 2, { s: 32, w: 900, c: o.c || C.ink });
    if (sub) text(g, sub, 0, 30, { f: 'mono', s: 24, w: 700, c: C.ink2 });
  });
}
S('s19', {
  cues: [[.4, 'latch', .5], [.8, 'latch', .5], [1.2, 'latch', .5], [1.6, 'latch', .5], [4.2, 'send'], [5.2, 'latch'], [8.0, 'whoosh', .5], [9.0, 'latch'], [9.2, 'success', .6], [12.2, 'whoosh', .5], [12.8, 'latch', .6], [13.4, 'success'], [16.4, 'whoosh'], [17.2, 'latch']],
  draw(g, lt) {
    const D = [1430, 430], UI = [1720, 430];
    // 连线
    if (lt > 1.0) { arrow(g, [[452, 430], [ITB.x - 6, 430]], { p: eo(seg(lt, 1.0, 1.3)), c: C.ink, w: 4, hs: 14 }); arrow(g, [[ITB.x + ITB.w + 6, 430], [D[0] - 118, 430]], { p: eo(seg(lt, 1.4, 1.7)), c: C.ink, w: 4, hs: 14 }); arrow(g, [[D[0] + 118, 430], [UI[0] - 96, 430]], { p: eo(seg(lt, 1.8, 2.1)), c: C.ink, w: 4, hs: 14 }); }
    stepBox(g, 300, 430, '① 问状态', 'transferStatus', seg(lt, .4, .9), { glow: win(lt, 4.0, 8.0, .3, .4) });
    const tp = ap(lt, .8);
    if (tp > 0) { at(g, ITB.x + ITB.w / 2, 430, tp, () => { g.translate(-(ITB.x + ITB.w / 2), -430); itable(g, lt, { hot: 0, hotK: win(lt, 9.0, 12.4, .3, .4), extra: eo(seg(lt, 16.4, 17.2)) }); });
      text(g, '② 拦截器表', ITB.x + ITB.w / 2, 262, { s: 32, w: 900, c: NAVY, al: tp }); }
    // ③ 变了吗
    const dp = ap(lt, 1.2), yes = seg(lt, 12.8, 13.1);
    if (dp > 0) at(g, D[0], D[1], dp, () => { diamond(g, 0, 0, 84, yes > 0 ? C.greenL : '#fff', yes > 0 ? C.green : C.ink); text(g, '③ 变了吗？', 0, 2, { s: 28, w: 900, c: yes > 0 ? C.green : C.ink }); });
    if (lt > 12.4) text(g, 'CHATTING 自环也广播', D[0], 560, { s: 24, w: 700, c: C.ink2, al: fa(lt, 12.4) });
    if (lt > 12.8) text(g, 'CALLING → RINGING', D[0], 308, { f: 'mono', s: 24, w: 700, c: C.green, al: fa(lt, 12.8) });
    // 界面
    const up = ap(lt, 1.6);
    if (up > 0) at(g, UI[0], UI[1], up, () => { card(g, -90, -70, 180, 140, { r: 24, fill: '#fff', lw: 3.5 }); rr(g, -60, -44, 120, 60, 10); g.fillStyle = C.blueL; g.fill(); text(g, '界面', 0, 44, { s: 30, w: 900 }); });
    if (lt > 13.2) { for (let k = 0; k < 3; k++) { const ph = ((lt - 13.2) * 1.2 + k / 3) % 1; ring(g, D[0] + 118, 430, 20 + ph * 120, C.green, 4, (1 - ph) * .7 * fo(lt, 15.6), -.7, .7); } stateTag(g, 'RINGING', UI[0], UI[1] - 14, { s: ap(lt, 13.4) }); }
    // 消息与二元组
    if (lt > 4.2 && lt < 5.3) { const k = eio(seg(lt, 4.2, 4.9)); capsule(g, 300, lerp(220, 340, k), 'ring', { s: .9, al: 1 - seg(lt, 4.9, 5.2) }); }
    if (lt > 5.2 && lt < 12.9) {
      const mv = eio(seg(lt, 8.0, 8.8)), mv2 = eio(seg(lt, 12.2, 12.8));
      let p = L2([300, 580], [ITB.x + 200, 680], mv); p = L2(p, [D[0], D[1]], mv2);
      at(g, p[0], p[1], ap(lt, 5.2) * (1 - mv2 * .6), () => { const s = '(RING, RINGING)', w = textW(g, s, { f: 'mono', s: 26, w: 700 }) + 40; card(g, -w / 2, -27, w, 54, { r: 27, fill: C.amberL, lw: 3, stroke: C.amber }); text(g, s, 0, 1, { f: 'mono', s: 26, w: 700 }); }, { al: 1 - seg(lt, 12.6, 12.9) });
    }
    if (lt > 9.0) burst(g, ITB.x + ITB.w - 60, ITB.y + 52 + 28, lt - 9.0, C.amber, 12, 90);
    // 新路径：一个分支 + 一个拦截器
    if (lt > 16.6) { path(g, partial([[300, 500], [300, 560], [380, 560]], eo(seg(lt, 16.6, 17.1))), { c: C.green, w: 5 }); tag(g, '+ 分支', 450, 560, C.green, seg(lt, 16.9, 17.3), { fs: 26 }); }
    if (lt > 17.4) tag(g, '其余代码不动', 900, 790, C.ink, seg(lt, 17.4, 17.8), { fs: 30 });
  },
});

S('s20', {
  demo: true,
  cues: [[.4, 'latch', .5], [.8, 'latch', .5], [1.2, 'latch', .5], [1.8, 'success', .6], [3.6, 'whoosh', .5], [4.2, 'send'], [5.0, 'error'], [8.0, 'send'], [9.6, 'latch', .5], [10.4, 'latch'], [12.4, 'ring'], [14.0, 'success']],
  draw(g, lt) {
    const ia = fo(lt, 3.4, .4);
    if (ia > 0) {
      g.save(); g.globalAlpha *= ia;
      if (lt > .9) { arrow(g, [[632, 470], [808, 470]], { p: eo(seg(lt, .9, 1.2)), c: C.ink, w: 4, hs: 14 }); arrow(g, [[1112, 470], [1288, 470]], { p: eo(seg(lt, 1.3, 1.6)), c: C.ink, w: 4, hs: 14 }); }
      stepBox(g, 480, 470, '① 问状态', 'transferStatus', seg(lt, .3, .8));
      stepBox(g, 960, 470, '② 拦截器', '查表执行', seg(lt, .7, 1.2), { glow: fa(lt, 1.8) * (.7 + .3 * Math.sin(lt * 5)), c: NAVY });
      stepBox(g, 1440, 470, '③ 变了吗？', '决定广播', seg(lt, 1.1, 1.6));
      tag(g, '先执行', 960, 600, C.amber, seg(lt, 1.8, 2.2), { tc: C.ink, fs: 28 }); tag(g, '后判断', 1440, 600, C.ink2, seg(lt, 2.2, 2.6), { fs: 28 });
      g.restore();
    }
    const sa = fa(lt, 3.6, .5); if (sa <= 0) return;
    g.save(); g.globalAlpha *= sa;
    const okA = lt >= 14.0;
    stage(g, lt, { busy: Math.max(gwBusy(lt, 8.0), gwBusy(lt, 12.4)), a: okA ? { mode: 'calling', label: '对方响铃中', from: 'calling', at: 14.0 } : { mode: 'calling', label: '呼叫中' },
      b: { mode: 'ringing' }, ca: ['RINGING', 'CALLING', 14.0], cb: ['RINGING'] });
    resendDial(g, P.A[0] - 230, P.A[1] - 170, lt, seg(lt, 3.8, 4.2), seg(lt, 14.0, 14.4));
    const top = [P.G[0], P.G[1] - 175];
    if (lt > 4.2 && lt < 5.0) fly(g, lt, 4.2, .8, [P.B[0], P.B[1] - 40], top, 'ring', { lift: 80, ripple: false });
    shatter(g, top[0], top[1], lt - 5.0, C.blue);
    if (lt > 8.0) relay(g, lt, 8.0, 'invite', 'AB', { hold: lt < 10.4, holdAl: fo(lt, 10.0) });
    if (lt > 9.8) tag(g, '状态没变', P.B[0], CHIP_Y + 70, C.ink, seg(lt, 9.8, 10.2), { fs: 28 });
    if (lt > 10.2) at(g, P.B[0] - 20, 178, ap(lt, 10.2), () => {
      card(g, -240, -32, 480, 64, { r: 18, fill: '#fff', lw: 3, stroke: NAVY });
      g.save(); g.globalAlpha *= win(lt, 10.4, 13.0, .2, .5); rr(g, -232, -24, 464, 48, 12); g.fillStyle = rgba(C.amber, .35); g.fill(); g.restore();
      text(g, '(INVITE, RINGING)', -216, 1, { f: 'mono', s: 24, w: 700, a: 'left' }); text(g, '→ 补发 RING', 216, 1, { s: 26, w: 900, c: NAVY, a: 'right' });
    });
    if (lt > 12.4) relay(g, lt, 12.4, 'ring', 'BA', { hold: lt < 15.2 });
    g.restore();
  },
});

/* 会话管理器：按 sessionId 路由 */
const MGR = [760, 470], OUTS = { top: [1340, 250], mid: [1340, 470], bot: [1340, 700] };
const CHECKS = [['协议允许', 1235, 452], ['媒体可用', 1445, 452], ['对方可达', 1235, 512], ['未在升级', 1445, 512]];
function routeCap(g, lt, t0, kind, tagS, iy, out) {
  // 入口排队 → 进管理器（缩小消失）→ 从右侧出来 → 去出口
  if (lt < t0) { capsule(g, 260, iy, kind, { s: .9, tag: tagS }); return; }
  const a = seg(lt, t0, t0 + .8), b = seg(lt, t0 + 1.4, t0 + 2.4);
  if (a < 1) { const p = L2([260, iy], [MGR[0] - 30, MGR[1]], eio(a)); capsule(g, p[0], p[1], kind, { s: .9 * (1 - .8 * seg(a, .6, 1)), tag: tagS }); return; }
  if (b <= 0 || b >= 1) return;
  const pts = []; for (let i = 0; i <= 16; i++) pts.push(bez([MGR[0] + 175, MGR[1]], [1050, out[1]], [out[0] - 210, out[1]], i / 16));
  const p = partial(pts, eio(b)).at(-1); codePill(g, p[0], p[1], kind, tagS, { s: Math.min(1, .3 + b * 5), al: 1 - seg(b, .85, 1) });
}
function codePill(g, x, y, kind, tagS, o = {}) { // 只有码和会话标签的小签（运动中的消息）
  const [code, , col] = MSG[kind];
  at(g, x, y, o.s ?? 1, () => { rr(g, -40, -22, 80, 44, 22); g.fillStyle = col; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke(); text(g, code, 0, 1, { f: 'mono', s: 26, w: 700, c: '#fff' });
    if (tagS) { card(g, 26, -44, 54, 34, { r: 17, fill: C.purple, lw: 2.5, shadow: false }); text(g, tagS, 53, -26, { f: 'mono', s: 24, w: 700, c: '#fff' }); } }, { al: o.al });
}
S('s21', {
  cues: [[.4, 'latch', .5], [1.0, 'latch', .5], [4.2, 'send'], [5.2, 'success', .6], [6.6, 'latch'], [8.6, 'send'], [9.6, 'tick'], [10.8, 'latch'], [12.6, 'tick'], [13.2, 'tick'], [13.8, 'tick'], [14.4, 'tick'], [15.0, 'success'], [16.6, 'send'], [17.4, 'error', .5], [18.4, 'latch']],
  draw(g, lt) {
    // 通道
    for (const [k, o] of Object.entries(OUTS)) {
      const used = k === 'top' ? win(lt, 5.6, 8.4, .3, .6) : k === 'mid' ? win(lt, 10.0, 16.4, .3, .6) : win(lt, 17.8, 20, .3, .6), pts = [];
      for (let i = 0; i <= 16; i++) pts.push(bez([MGR[0] + 172, MGR[1]], [1050, o[1]], [o[0] - 202, o[1]], i / 16));
      path(g, partial(pts, eo(seg(lt, .8, 1.4))), { c: used > 0 ? (k === 'top' ? C.green : k === 'mid' ? C.orange : C.ink2) : rgba(C.ink, .3), w: used > 0 ? 5 : 4, dash: [8, 10], off: -lt * 30 });
    }
    // 管理器
    at(g, MGR[0], MGR[1], ap(lt, .3), () => {
      card(g, -170, -130, 340, 260, { r: 28, fill: '#fff', lw: 3.5, sb: 28, so: 10 });
      g.save(); rr(g, -170, -130, 340, 260, 28); g.clip(); g.fillStyle = C.purpleL; g.fillRect(-170, -130, 340, 64); g.restore();
      path(g, [[-170, -66], [170, -66]], { c: C.ink, w: 3 }); text(g, '会话管理器', 0, -97, { s: 30, w: 900, c: C.purple });
      text(g, '已有会话：S1', 0, -26, { s: 26, w: 700, c: C.ink2 });
      card(g, -140, 18, 280, 60, { r: 14, fill: C.greyL, lw: 2.5, shadow: false });
      const r = lt < 5.0 ? ['等待消息…', C.ink2] : lt < 8.6 ? ['S1 ✓ 找到会话', C.green] : lt < 9.4 ? ['查找 S2 …', C.ink] : lt < 16.6 ? ['S2 ✗ · 是 INVITE', C.orange] : lt < 17.2 ? ['查找 S9 …', C.ink] : ['S9 ✗ · 不是 INVITE', C.coral];
      text(g, r[0], 0, 49, { s: 26, w: 900, c: r[1] });
      keyIcon(g, -120, -98, .55, C.purple);
    });
    // 出口
    at(g, OUTS.top[0], OUTS.top[1], ap(lt, .5), () => { card(g, -200, -40, 400, 80, { r: 22, fill: C.greenL, lw: 3, stroke: C.green }); text(g, '会话 S1 → 状态机', 0, 1, { s: 28, w: 900, c: C.green }); });
    at(g, OUTS.mid[0], OUTS.mid[1], ap(lt, .7), () => { card(g, -200, -95, 400, 190, { r: 22, fill: '#fff', lw: 3, stroke: C.orange }); text(g, '新建被叫会话', 0, -62, { s: 28, w: 900, c: C.orange }); });
    CHECKS.forEach(([s, x, y], i) => { if (lt < .9) return; const ck = seg(lt, 12.6 + i * .6, 12.9 + i * .6);
      card(g, x - 92, y - 15, 30, 30, { r: 7, fill: ck > 0 ? C.green : '#fff', lw: 2.5, shadow: false, al: fa(lt, .9) }); if (ck > 0) icCheck(g, x - 77, y + 1, 22, '#fff', eo(ck), 4);
      text(g, s, x - 52, y + 1, { s: 26, w: 700, a: 'left', al: fa(lt, .9) }); });
    at(g, OUTS.bot[0], OUTS.bot[1], ap(lt, .9), () => { card(g, -200, -40, 400, 80, { r: 22, fill: C.greyL, lw: 3 }); text(g, '日志', -150, 1, { s: 28, w: 900, c: C.ink2 }); });
    if (lt > 18.4) { const k = eo(seg(lt, 18.4, 19.0)); g.save(); rr(g, OUTS.bot[0] - 100, OUTS.bot[1] - 32, 290, 64, 10); g.clip();
      card(g, OUTS.bot[0] - 90, lerp(OUTS.bot[1] - 90, OUTS.bot[1] - 24, k), 270, 48, { r: 6, fill: '#fff', lw: 2.5, sb: 8, so: 3 }); text(g, '未匹配 · 已忽略', OUTS.bot[0] + 45, lerp(OUTS.bot[1] - 66, OUTS.bot[1], k), { s: 26, w: 900, c: C.coral }); g.restore(); }
    if (lt > 15.0) { at(g, 1690, 470, ap(lt, 15.0), () => { card(g, -80, -50, 160, 100, { r: 22, fill: C.greenL, lw: 3.5, stroke: C.green }); text(g, '会话 S2', 0, 1, { s: 28, w: 900, c: C.green }); }); burst(g, 1690, 470, lt - 15.0, C.green, 12, 110); }
    if (lt > 6.6) badge(g, OUTS.top[0] + 196, OUTS.top[1] - 36, 22, C.green, 'check', seg(lt, 6.6, 6.9));
    routeCap(g, lt, 4.2, 'cancel', 'S1', 360, OUTS.top);
    routeCap(g, lt, 8.6, 'invite', 'S2', 470, OUTS.mid);
    routeCap(g, lt, 16.6, 'hangup', 'S9', 580, OUTS.bot);
  },
});

S('s22', {
  cues: [[.4, 'send', .4], [1.2, 'error', .4], [5.0, 'success'], [9.4, 'latch'], [9.8, 'latch', .6]],
  draw(g, lt) {
    const IN = [70, 490], FK = [400, 490], CT = [[FK[0], FK[1]], [560, 330], [740, 330]], DT = [[FK[0], FK[1]], [560, 650], [800, 650]];
    // 线路
    const lp = eo(seg(lt, .2, .9));
    path(g, partial([IN, FK], lp), { c: rgba(C.ink, .35), w: 5, dash: [6, 10], off: -lt * 40 });
    path(g, partial([...CT, [1220, 330]], lp), { c: rgba(C.blue, .5), w: 5, dash: [6, 10], off: -lt * 40 });
    path(g, partial([...DT, [1290, 650]], lp), { c: rgba(C.amber, .7), w: 5, dash: [6, 10], off: -lt * 40 });
    at(g, FK[0], FK[1], ap(lt, .2), () => { diamond(g, 0, 0, 52, '#fff', C.ink); text(g, '类型？', 0, 2, { s: 26, w: 900 }); });
    at(g, 880, 330, ap(lt, .4), () => { card(g, -130, -50, 260, 100, { r: 22, fill: C.purpleL, lw: 3.5, stroke: C.purple }); text(g, '会话管理器', 0, 1, { s: 28, w: 900, c: C.purple }); });
    at(g, 1340, 330, ap(lt, .6), () => { card(g, -120, -50, 240, 100, { r: 22, fill: '#fff', lw: 3.5 }); text(g, '状态机', 0, 1, { s: 30, w: 900 }); });
    at(g, 960, 650, ap(lt, .8), () => { card(g, -140, -50, 280, 100, { r: 22, fill: C.amberL, lw: 3.5, stroke: C.amber }); text(g, 'Base64 解码', 0, 1, { s: 28, w: 900, c: C.ink }); });
    if (lt > 1.0) speaker(g, 1380, 650, ap(lt, 1.0), lt, fa(lt, 4.8));
    // 消息流：控制消息往上走，语音包往下走
    for (let k = 0; k < 60; k++) {
      const te = -4 + k * .42, u = (lt - te) / 3.2; if (u < 0 || u > 1) continue;
      const ctl = k % 4 === 1, pts = ctl ? [IN, ...CT, [1200, 330]] : [IN, ...DT, [1290, 650]], p = partial(pts, u).at(-1);
      const hide = Math.abs(p[0] - FK[0]) < 110 && Math.abs(p[1] - FK[1]) < 60 || (ctl ? p[0] > 700 && p[0] < 1060 : p[0] > 770 && p[0] < 1150);
      const al = Math.min(1, u * 8, (1 - u) * 6) * lp * (hide ? 0 : 1); if (al <= 0) continue;
      if (ctl) { const kind = ['invite', 'ring', 'accept', 'cancel'][Math.floor(k / 4) % 4], [code, , col] = MSG[kind]; g.save(); g.globalAlpha *= al; rr(g, p[0] - 38, p[1] - 20, 76, 40, 20); g.fillStyle = col; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke(); text(g, code, p[0], p[1] + 1, { f: 'mono', s: 24, w: 700, c: '#fff' }); g.restore(); }
      else { g.save(); g.globalAlpha *= al; rr(g, p[0] - 34, p[1] - 18, 68, 36, 8); g.fillStyle = C.amber; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke(); text(g, '300', p[0], p[1] + 1, { f: 'mono', s: 24, w: 700, c: '#fff' }); g.restore(); }
    }
    if (lt > 1.2 && lt < 9.0) { tag(g, '300 不进来', 1340, 430, C.coral, seg(lt, 1.2, 1.6), { fs: 26, al: fo(lt, 8.6) }); }
    if (lt > 5.0) tag(g, '直接播放', 1380, 760, C.amber, seg(lt, 5.0, 5.4), { tc: C.ink, fs: 26 });
    if (lt > 9.4) {
      path(g, partial([[560, 490], [1820, 490]], eo(seg(lt, 9.4, 10.0))), { c: C.ink, w: 3, dash: [14, 10] });
      tag(g, '控制面', 1700, 330, C.blue, seg(lt, 9.6, 10.0), { fs: 30 }); tag(g, '数据面', 1700, 650, C.amber, seg(lt, 9.9, 10.3), { fs: 30, tc: C.ink });
    }
  },
});

/* =====================================================================
 * 第六章：踩坑：50 毫秒竞态（B 的内部视图沿用 v2 的时间尺 / 会话槽 / 传送带）
 * ===================================================================== */
const RX0 = 340, RX1 = 1500, RY = 290;
const rx = ms => lerp(RX0, RX1, clamp(ms / 50));
function ruler(g, ms, o = {}) {
  path(g, [[RX0, RY], [RX1, RY]], { c: C.ink, w: 3 });
  for (let m = 0; m <= 50; m += 5) { const x = rx(m), big = m % 10 === 0; path(g, [[x, RY - (big ? 14 : 8)], [x, RY]], { c: C.ink, w: big ? 3 : 2 }); if (big) text(g, m + (m === 50 ? ' ms' : ''), x, RY - 36, { f: 'mono', s: 24, w: 700, c: C.ink2 }); }
  if (o.mark != null) {
    const k = o.markK ?? 1, x = rx(o.mark);
    path(g, [[x, RY + 10], [x, RY + 10 + 300 * eo(k)]], { c: C.coral, w: 4, dash: [10, 8] });
    at(g, x + 130, RY + 150, pop(k), () => { card(g, -96, -24, 192, 48, { r: 24, fill: C.coral, lw: 2.5, sb: 10, so: 4 }); text(g, '取消到达', 0, 1, { s: 26, w: 900, c: '#fff' }); });
  }
  if (ms != null) { const x = rx(ms); path(g, [[x, RY - 4], [x, RY + 210]], { c: C.purple, w: 4 }); dot(g, x, RY, 9, C.purple); }
}
function createLane(g, ms, y, label, lt) {
  text(g, label, RX0 - 24, y + 25, { s: 26, w: 900, a: 'right' });
  card(g, RX0, y, RX1 - RX0, 50, { r: 14, fill: '#fff', lw: 3, shadow: false });
  hatch(g, RX0 + 3, y + 3, (RX1 - RX0 - 6) * clamp(ms / 50), 44, C.orange, lt * 40, 12);
}
function bigMs(g, ms, x = 1665, y = 330) {
  text(g, '已过', x, y - 64, { s: 26, w: 700, c: C.ink2 });
  text(g, Math.min(50, Math.floor(ms)).toString(), x - 18, y, { f: 'disp', w: 900, s: 96, c: ms >= 50 ? C.green : C.purple, a: 'right' });
  text(g, 'ms', x - 10, y + 16, { f: 'disp', w: 800, s: 40, c: C.ink2, a: 'left' });
}
function sessionSlot(g, x, y, prog, lt, o = {}) {
  const done = o.doneAt != null ? seg(lt, o.doneAt, o.doneAt + .35) : (prog >= 1 ? 1 : 0), w = 300, h = 170;
  if (done < 1) {
    g.save(); g.globalAlpha *= 1 - done;
    card(g, x - w / 2, y - h / 2, w, h, { r: 22, fill: rgba('#ffffff', .7), lw: 3, dash: [12, 9], stroke: C.purple, shadow: false });
    for (let i = 0; i < 6; i++) {
      const kk = clamp(prog * 6 - i), bx = x - 105 + (i % 3) * 70, by = y - 4 + Math.floor(i / 3) * 50 - (1 - eo(kk)) * 60;
      if (kk > 0) card(g, bx - 30, by - 19, 60, 40, { r: 8, fill: C.purpleL, lw: 2.5, al: eo(kk), sb: 8, so: 3 });
    }
    text(g, o.label || '会话 S1 · 建造中', x, y - h / 2 + 28, { s: 26, w: 900, c: C.purple });
    g.restore();
  }
  if (done > 0) {
    at(g, x, y, pop(done), () => {
      card(g, -w / 2, -h / 2, w, h, { r: 22, fill: C.greenL, lw: 3.5, stroke: C.green, sb: 22, so: 8 });
      text(g, '会话 S1', 0, -24, { s: 40, w: 900, c: C.green }); text(g, o.doneLabel || '已就绪', 0, 30, { s: 28, w: 700, c: C.ink });
    });
    burst(g, x, y, lt - (o.doneAt ?? -9), C.green, 14, 170);
  }
}
const SLOT = [1450, 650];
const ms23 = lt => Math.max(0, (lt - 5.0) * 2.6), ARR23 = 5.0 + 10 / 2.6;   // 取消在第 10 ms（构造值）到达
const ms24 = lt => Math.min(50, ms23(16) + lt * 5);
function innerB(g, ms, lt, o = {}) {
  boardC(g, '被叫屏 B · 内部处理', 1, { right: o.right || '' });
  ruler(g, ms, { mark: o.mark, markK: o.markK }); createLane(g, ms, 360, '创建会话 S1', lt); bigMs(g, ms);
  sessionSlot(g, SLOT[0], SLOT[1], ms / 50, lt, { doneAt: o.doneAt });
}
S('s23', {
  card: 7, demo: true, scaled: lt => fa(lt, 4.4),
  cam: [[0, 960, 470, 1], [3.8, 960, 470, 1], [5.0, P.B[0], P.B[1] - 6, 6.2], [16, P.B[0], P.B[1] - 6, 6.2]],
  cues: [[0, 'whoosh'], [1.8, 'send'], [3.4, 'latch'], [3.9, 'whoosh'], [5.0, 'tick', .5], [ARR23 - .8, 'send'], [ARR23, 'latch'], [12.4, 'error', .6]],
  draw(g, lt) {
    if (lt < 5.0) stage(g, lt, { busy: gwBusy(lt, 1.8), a: { mode: 'calling' }, b: lt < 3.4 ? { mode: 'app' } : { mode: 'creating', from: 'app', at: 3.4 }, ca: ['CALLING'], cb: ['IDLE'] });
    if (lt > 1.8 && lt < 4.2) relay(g, lt, 1.8, 'invite', 'AB');
    const bi = eo(seg(lt, 4.3, 5.0)); if (bi <= 0) return;
    screenSpace(g, () => {
      g.save(); g.globalAlpha *= bi; g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      const ms = ms23(lt);
      innerB(g, ms, lt, { mark: lt > ARR23 - .05 ? 10 : null, markK: seg(lt, ARR23 - .05, ARR23 + .4) });
      text(g, '入站消息', 230, 560, { s: 26, w: 900, c: C.ink2 });
      path(g, [[160, 650], [300, 650]], { c: rgba(C.ink, .3), w: 5, dash: [3, 13], off: -lt * 30 });
      if (lt > ARR23 - .8) { const k = clamp((lt - (ARR23 - .8)) / .8), x = lerp(60, 640, eo(k)); capsule(g, x, 650, 'cancel', { s: .9, tag: 'S1', sx: 1 + .12 * Math.sin(k * Math.PI), glow: k < 1 ? .5 : 0 }); ripple(g, 640, 650, lt - ARR23, C.coral, 40, 150); }
      const q = eo(seg(lt, 12.2, 12.9));
      if (q > 0) { path(g, partial([[800, 650], [SLOT[0] - 160, SLOT[1]]], q), { c: C.coral, w: 5, dash: [12, 10] }); badge(g, (800 + SLOT[0] - 160) / 2, 650, 34, C.coral, '?', seg(lt, 12.6, 13.0)); tag(g, '未就绪', SLOT[0], SLOT[1] + 128, C.coral, seg(lt, 12.8, 13.2), { fs: 28 }); }
      g.restore();
    });
  },
});
S('s24', {
  demo: true, scaled: lt => fo(lt, 4.2),
  cam: [[0, P.B[0], P.B[1] - 6, 6.2], [4.4, P.B[0], P.B[1] - 6, 6.2], [5.8, 960, 470, 1], [14, 960, 470, 1]],
  cues: [[.3, 'send', .6], [1.4, 'error'], [2.4, 'error', .6], [2.9, 'latch'], [4.2, 'success', .5], [4.6, 'whoosh'], [5.6, 'ring', .7], [6.6, 'ring', .7], [7.0, 'error', .5], [8.4, 'latch'], [9.2, 'tick', .5], [9.4, 'tick', .5], [9.6, 'tick', .5], [10.6, 'latch', .5], [11.4, 'latch', .5], [12.2, 'latch', .5], [12.6, 'error']],
  draw(g, lt) {
    const fb = fo(lt, 4.4, .6), fs = fa(lt, 4.4, .6) * fo(lt, 8.6, .5), ft = fa(lt, 8.8, .5);
    if (fs > 0 && lt > 4.4) {
      g.save(); g.globalAlpha *= fs;
      const bEnd = lt >= 8.4;
      stage(g, lt, { a: { mode: 'cancelled' }, b: bEnd ? { mode: 'timeout', label: '响铃超时', from: 'ringing', at: 8.4 } : { mode: 'ringing' }, ca: ['ENDED.SELF_TERMINATED'], cb: ['ENDED.RINGING_TIMEOUT', 'RINGING', 8.4] });
      if (lt > 5.2) { const left = clamp(1 - (lt - 5.4) / 3); countdown(g, P.B[0], 222, 52, left, Math.ceil(60 * left) + ' s', C.orange, { fs: 30 }); tag(g, '快进 ▶▶', P.B[0] - 170, 222, C.ink, seg(lt, 5.2, 5.6), { fs: 26 }); }
      const dk = seg(lt, 6.8, 7.4);
      if (dk > 0) { path(g, partial([[P.A[0] + 200, CHIP_Y], [P.B[0] - 200, CHIP_Y]], eo(dk)), { c: C.coral, w: 5, dash: [14, 10] }); tag(g, '两端不一致', 960, CHIP_Y, C.coral, seg(lt, 7.0, 7.4), { fs: 28 }); }
      g.restore();
    }
    if (fb > 0) screenSpace(g, () => {
      g.save(); g.globalAlpha *= fb; g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      const ms = ms24(lt); innerB(g, ms, lt, { mark: 10 });
      const MX = 900, MY = 650, shake = lt > 1.4 && lt < 1.9 ? Math.sin(lt * 70) * 10 * (1 - (lt - 1.4) / .5) : 0;
      at(g, MX + shake, MY, 1, () => {
        card(g, -160, -95, 320, 190, { r: 26, fill: '#fff', lw: 3.5 });
        card(g, -160, -95, 320, 58, { r: 26, fill: C.purpleL, lw: 0, shadow: false }); path(g, [[-160, -37], [160, -37]], { c: C.ink, w: 3 });
        text(g, '会话匹配', 0, -65, { s: 28, w: 900, c: C.purple });
        text(g, lt < 1.4 ? '查找 S1 …' : '没有 S1', 0, 4, { s: 28, w: 900, c: lt < 1.4 ? C.ink : C.coral });
        if (lt > 1.9) text(g, '是 INVITE 吗？', 0, 56, { s: 26, w: 900, c: C.ink2 });
      });
      if (lt > 1.4) badge(g, MX + 160, MY - 95, 30, C.coral, 'cross', seg(lt, 1.4, 1.7));
      if (lt > 2.4) badge(g, MX + 140, MY + 56, 24, C.coral, 'cross', seg(lt, 2.4, 2.7));
      const ink = eo(seg(lt, .2, 1.0));
      capsule(g, lerp(640, MX - 300, ink), 650 - 50 * ink, 'cancel', { s: .9, tag: 'S1', al: 1 - seg(lt, 2.6, 3.0) });
      card(g, MX - 160, 790, 320, 52, { r: 14, fill: C.greyL, lw: 3 }); text(g, '日志', MX - 180, 816, { s: 26, w: 900, c: C.ink2, a: 'right' });
      if (lt > 2.8) { const pr = eo(seg(lt, 2.8, 3.6)); card(g, MX - 150, lerp(740, 792, pr), 300, 48, { r: 6, fill: '#fff', lw: 2.5, sb: 10, so: 3 }); text(g, '402 · 未匹配 · 已忽略', MX, lerp(764, 816, pr), { s: 26, w: 900, c: C.coral }); }
      g.restore();
    });
    // 孪生症状：同时拨三台，乱序完成
    if (ft > 0) screenSpace(g, () => {
      g.save(); g.globalAlpha *= ft; g.fillStyle = C.bg; g.globalAlpha *= 1; g.fillRect(0, 0, W, H);
      boardC(g, '主叫屏 A · 同时拨三台', 1, { c: C.blue, right: '' });
      const L = [['先拨 B1', 9.2, 11.4], ['再拨 B2', 9.4, 12.2], ['最后拨 B3', 9.6, 10.6]];
      let cur = null;
      L.forEach(([s, t0, t1], i) => {
        const y = 330 + i * 120, p = clamp((lt - t0) / (t1 - t0));
        text(g, s, 420, y + 25, { s: 28, w: 900, a: 'right' });
        card(g, 450, y, 640, 50, { r: 14, fill: '#fff', lw: 3, shadow: false });
        if (lt > t0) hatch(g, 453, y + 3, 634 * p, 44, p >= 1 ? C.green : C.blue, lt * 40, 12);
        if (lt >= t1) { badge(g, 1120, y + 25, 22, C.green, 'check', seg(lt, t1, t1 + .3)); }
      });
      const order = L.filter(l => lt >= l[2]).sort((a, b) => a[2] - b[2]); if (order.length) cur = order[order.length - 1];
      const SX = 1480, SY = 450, wrong = lt >= 12.2;
      card(g, SX - 170, SY - 110, 340, 220, { r: 24, fill: wrong ? C.coralL : '#fff', lw: 3.5, stroke: wrong ? C.coral : C.ink });
      text(g, '当前会话', SX, SY - 70, { s: 28, w: 900, c: C.ink2 });
      if (cur) { const f = seg(lt, cur[2], cur[2] + .3); at(g, SX, SY + 20, 1, () => text(g, cur[0].slice(-2), 0, 0, { f: 'disp', w: 900, s: 84, c: wrong ? C.coral : C.blue }), { sy: Math.abs(Math.cos(f * Math.PI)) || .01 }); }
      if (lt > 12.6) tag(g, '最后拨的是 B3', SX, SY + 170, C.amber, seg(lt, 12.6, 13.0), { tc: C.ink, fs: 28 });
      g.restore();
    });
  },
});

/* 三个方案 */
function barrier(g, x, y, down, lt, o = {}) {
  card(g, x - 14, y - 150, 28, 160, { r: 8, fill: C.ink2, lw: 2.5, sb: 8, so: 4 });
  g.save(); g.translate(x, y - 132); g.rotate(Math.PI * (1 - down));
  rr(g, -8, 0, 16, 150, 8); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  for (let i = 0; i < 4; i++) { rr(g, -8, 10 + i * 36, 16, 18, 4); g.fillStyle = C.coral; g.fill(); }
  g.restore();
  if (o.stop && down > .5) at(g, x, y - 200, pop(o.stop) * (1 + .06 * Math.sin(lt * 8)), () => { dot(g, 0, 0, 36, C.coral); ring(g, 0, 0, 36, C.ink, 3); text(g, '停', 0, 2, { s: 36, w: 900, c: '#fff' }); });
}
function optCard(g, x, y, title, kind, lt, o = {}) {
  at(g, x, y, o.s ?? 1, () => {
    card(g, -190, -170, 380, 340, { r: 32, fill: o.pick ? C.greenL : '#fff', lw: 3.5, stroke: o.pick ? C.green : C.ink, sb: 30, so: 12 });
    text(g, title, 0, -120, { s: 34, w: 900 });
    if (o.blank) return;
    if (kind === 'lock') { lockIcon(g, 0, 30, 1.4, C.amber); text(g, '每处都要锁', 0, 130, { s: 26, w: 700, c: C.ink2 }); }
    if (kind === 'barrier') { at(g, 0, 90, .8, () => barrier(g, 0, 0, .5 + .5 * Math.sin(lt * 2), lt)); text(g, '暂停 / 恢复', 0, 130, { s: 26, w: 700, c: C.ink2 }); }
    if (kind === 'flow') {
      for (let i = 0; i < 3; i++) card(g, -160 + i * 62, -2, 50, 50, { r: 12, fill: [C.blueL, C.coralL, C.greenL][i], lw: 3, sb: 8, so: 3 });
      arrow(g, [[34, 23], [84, 23]], { c: C.blue, w: 5, hs: 14 });
      card(g, 92, -17, 96, 80, { r: 16, fill: C.blueL, lw: 3 }); text(g, '工位', 140, 23, { s: 26, w: 900, c: C.blue });
      text(g, '一次只做一件', 0, 130, { s: 26, w: 700, c: C.ink2 });
    }
  }, { al: o.al, rot: o.rot });
  if (o.pick) badge(g, x + 170 * (o.s ?? 1), y - 160 * (o.s ?? 1), 32, C.green, 'check', o.pickP);
}
S('s25', {
  cues: [[.4, 'latch', .5], [.8, 'latch', .5], [2.4, 'whoosh', .5], [2.8, 'error', .5], [4.2, 'latch'], [4.5, 'latch'], [4.8, 'latch'], [8.0, 'whoosh', .5], [8.6, 'tick'], [8.9, 'tick'], [9.2, 'tick'], [9.8, 'error', .5], [12.4, 'success'], [13.4, 'latch'], [13.8, 'latch']],
  draw(g, lt) {
    // 两个症状 → 同一个根子
    const sa = fo(lt, 3.6, .4);
    if (sa > 0) {
      const mg = eio(seg(lt, 2.4, 3.0));
      const sym = (x, title, fn, p) => at(g, lerp(x, 960, mg), 470, pop(p) * (1 - .6 * mg), () => { card(g, -210, -130, 420, 260, { r: 30, fill: '#fff', lw: 3.5 }); text(g, title, 0, -84, { s: 32, w: 900, c: C.coral }); fn(); }, { al: sa * (1 - mg) });
      sym(620, '取消丢了', () => { capsule(g, -40, 20, 'cancel', { s: .9 }); badge(g, 150, -10, 26, C.coral, '?', 1); }, seg(lt, .3, .8));
      sym(1300, '会话错位', () => { text(g, 'B1 B2 B3 → B2', 0, 30, { f: 'mono', s: 34, w: 700, c: C.ink }); }, seg(lt, .7, 1.2));
      if (lt > 2.8) tag(g, '多线程 · 执行不同步', 960, 470, C.coral, seg(lt, 2.8, 3.2), { fs: 34, al: sa });
    }
    const zoomL = eio(seg(lt, 8.0, 8.6)) * (1 - eio(seg(lt, 11.6, 12.2))), mv = eio(seg(lt, 12.0, 12.8)), pick = lt > 12.2;
    const xs = [480, 960, 1440], kinds = ['lock', 'barrier', 'flow'], names = ['加锁', 'Handler 同步屏障', 'Flow 串行消费'];
    const order = zoomL > 0 ? [1, 2, 0] : [0, 1, 2];
    order.forEach(i => {
      const p = seg(lt, 4.2 + i * .3, 4.7 + i * .3); if (p <= 0) return; const k = kinds[i];
      if (k === 'lock') optCard(g, lerp(lerp(xs[0], 960, zoomL), 300, mv), lerp(lerp(480, 470, zoomL), 520, mv), names[0], k, lt, { s: pop(p) * lerp(1, 1.3, zoomL) * lerp(1, .78, mv), blank: zoomL > .5, al: 1 - .6 * mv, rot: mv * -.08 });
      else if (k === 'flow') optCard(g, lerp(xs[2], 960, mv), lerp(480, 470, mv), names[2], k, lt, { s: pop(p) * lerp(1, 1.18, mv), pick, pickP: seg(lt, 12.4, 12.8), al: 1 - .7 * zoomL });
      else optCard(g, lerp(xs[1], 1620, mv), lerp(480, 520, mv), names[1], k, lt, { s: pop(p) * lerp(1, .78, mv), al: (1 - .7 * zoomL) * (1 - .6 * mv), rot: mv * .08 });
    });
    if (zoomL > .5) { // 锁散在多个类里
      ['类 A', '类 B', '类 C'].forEach((s, i) => { const x = 790 + i * 170, p = ap(lt, 8.6 + i * .3); if (p <= 0) return;
        at(g, x, 540, p, () => { card(g, -70, -40, 140, 80, { r: 16, fill: '#fff', lw: 3 }); text(g, s, 0, 1, { s: 28, w: 900 }); lockIcon(g, 0, -88, .7, C.amber); }); });
      if (lt > 9.8) tag(g, '难维护', 960, 650, C.coral, seg(lt, 9.8, 10.2), { fs: 30 });
    }
    if (lt > 13.4) { tag(g, '好懂', 860, 750, C.blue, seg(lt, 13.4, 13.8), { fs: 30 }); tag(g, '好维护', 1060, 750, C.green, seg(lt, 13.8, 14.2), { fs: 30 }); }
  },
});

/* 传送带：入站消息排成一队（emit → collect） */
const BELT = { x0: 250, x1: 1010, y: 610 }, STATION = [1225, 560];
function belt(g, lt, o = {}) {
  const { x0, x1, y } = BELT, run = o.run ?? 1;
  card(g, x0 - 30, y, x1 - x0 + 60, 54, { r: 27, fill: '#3A3F52', lw: 3, sb: 18, so: 8 });
  g.save(); rr(g, x0 - 26, y + 4, x1 - x0 + 52, 46, 23); g.clip();
  for (let x = x0 - 60 + (lt * 70 * run) % 40; x < x1 + 40; x += 40) path(g, [[x, y + 4], [x - 14, y + 50]], { c: rgba('#ffffff', .18), w: 6 });
  g.restore();
  for (let i = 0; i < 6; i++) { const r2 = x0 + i * (x1 - x0) / 5; dot(g, r2, y + 27, 14, '#5B6176'); ring(g, r2, y + 27, 14, C.ink, 2.5);
    const a = -lt * 4 * run; path(g, [[r2 - Math.cos(a) * 10, y + 27 - Math.sin(a) * 10], [r2 + Math.cos(a) * 10, y + 27 + Math.sin(a) * 10]], { c: '#fff', w: 3 }); }
  text(g, '同一条流 · 入站控制消息', (x0 + x1) / 2, y + 96, { s: 26, w: 900, c: C.ink2 });
  tag(g, 'emit', x0 - 10, y - 70, C.blue, 1, { fs: 26 });
}
function station(g, lt, o = {}) {
  const [x, y] = STATION, w = 340, h = 260;
  card(g, x - w / 2, y - h / 2, w, h, { r: 28, fill: '#fff', lw: 3.5, sb: 26, so: 10 });
  card(g, x - w / 2, y - h / 2, w, 62, { r: 28, fill: C.blueL, lw: 0, shadow: false });
  path(g, [[x - w / 2, y - h / 2 + 62], [x + w / 2, y - h / 2 + 62]], { c: C.ink, w: 3 });
  text(g, '唯一工位 · collect', x, y - h / 2 + 32, { s: 26, w: 900, c: C.blue });
  if (o.item) capsule(g, x, y - 14, o.item, { s: .9, tag: 'S1' });
  if (o.prog != null) {
    text(g, o.progLabel || '创建会话', x, y + 52, { s: 26, w: 700, c: C.ink2 });
    card(g, x - 120, y + 76, 240, 26, { r: 13, fill: '#fff', lw: 2.5, shadow: false });
    hatch(g, x - 118, y + 78, 236 * clamp(o.prog), 22, o.prog >= 1 ? C.green : C.orange, lt * 40, 11);
  }
  if (o.check) badge(g, x + w / 2 - 6, y - h / 2 + 6, 26, C.green, 'check', o.check);
}
function drop(lt, t0, x, y) { const k = seg(lt, t0, t0 + .55); return [x, lerp(y - 260, y, k < 1 ? eo(k) : 1) - (k >= 1 ? 0 : Math.abs(Math.sin(k * Math.PI * 2)) * 30 * (1 - k))]; }
const DONE26 = 11.2;
S('s26', {
  demo: true, scaled: lt => fo(lt, 15.6),
  cues: [[.6, 'latch'], [1.2, 'latch'], [3.6, 'send'], [4.0, 'latch', .6], [DONE26, 'success'], [11.4, 'whoosh'], [12.4, 'send'], [12.8, 'latch'], [13.8, 'success'], [16.2, 'whoosh', .6], [17.0, 'latch', .6]],
  draw(g, lt) {
    const ba = fo(lt, 15.6, .6);
    if (ba > 0) screenSpace(g, () => {
      g.save(); g.globalAlpha *= ba;
      boardC(g, '被叫屏 B · 内部处理', 1, { right: '' });
      g.save(); g.translate(0, 12);
      belt(g, lt, { run: lt < 4.0 || (lt > 11.4 && lt < 12.4) ? 1 : .15 });
      const item = lt > 3.6 && lt < 11.6 ? 'invite' : lt >= 12.4 ? 'cancel' : null;
      const prog = lt > 3.8 && lt < 12.4 ? clamp((lt - 3.8) / (DONE26 - 3.8)) : lt >= 12.4 ? clamp((lt - 12.4) / .8) : null;
      station(g, lt, { item, prog, progLabel: lt >= 12.4 ? '处理取消' : '创建会话', check: lt > DONE26 && lt < 12.4 ? seg(lt, DONE26, DONE26 + .3) : 0 });
      sessionSlot(g, 1590, 560, clamp((lt - 3.8) / (DONE26 - 3.8)), lt, { doneAt: DONE26 });
      barrier(g, 1040, BELT.y, lt < 11.4 ? (lt < 3.4 ? 0 : eo(seg(lt, 3.4, 3.8))) : 1 - eo(seg(lt, 11.4, 11.8)), lt, { stop: lt > 4.0 && lt < 11.4 ? seg(lt, 4.0, 4.4) : 0 });
      if (lt < 3.6) { const [x0, y0] = drop(lt, .6, 600, BELT.y - 34); capsule(g, lt < 1.6 ? x0 : lerp(600, 1000, eio(seg(lt, 2.0, 3.6))), y0, 'invite', { s: .9, tag: 'S1', al: seg(lt, .6, .8) }); }
      if (lt < 12.4) {
        const [x0, y0] = drop(lt, 1.2, 330, BELT.y - 34), jig = lt > 5 && lt < 11.2 ? Math.sin(lt * 12) * 4 : 0;
        const x = lt < 1.8 ? x0 : lt < 11.6 ? lerp(330, 830, eio(seg(lt, 1.8, 4.0))) : lerp(830, STATION[0], eio(seg(lt, 11.6, 12.4)));
        capsule(g, x + jig, y0 - Math.abs(jig), 'cancel', { s: .9, tag: 'S1', al: seg(lt, 1.2, 1.4) * (1 - seg(lt, 12.2, 12.4)), rot: jig * .01 });
        if (lt > 5.0 && lt < 11.4) at(g, 830, BELT.y - 150, ap(lt, 5.0), () => { card(g, -70, -30, 140, 60, { r: 30, fill: '#fff', lw: 3 }); for (let i = 0; i < 3; i++) dot(g, -26 + i * 26, 0, 7, C.amber, .3 + .7 * ((Math.floor(lt * 3) % 3) === i ? 1 : 0)); });
      }
      if (lt > 12.8) tag(g, '找到 S1 ✓', STATION[0], STATION[1] - 180, C.green, seg(lt, 12.8, 13.2), { fs: 28 });
      if (lt > .8) chip(g, 1590, 740, lt, 'ENDED.OTHER_TERMINATED', 'RINGING', 13.8, { glow: eo(seg(lt, 13.9, 14.4)), al: fa(lt, DONE26) });
      if (lt > 13.8) burst(g, 1590, 740, lt - 13.9, C.green);
      g.restore(); g.restore();
    });
    // 两块屏各排各的队
    const pa = fa(lt, 16.0, .5);
    if (pa > 0) {
      const panelQ = (x, title, c, cl, items) => at(g, x, 500, pop(seg(lt, 16.0, 16.5)), () => {
        card(g, -380, -150, 760, 300, { r: 32, fill: cl, lw: 4, stroke: c });
        text(g, title, 0, -105, { s: 30, w: 900, c });
        for (let i = 0; i < 3; i++) card(g, -300 + i * 92, -20, 76, 76, { r: 16, fill: rgba('#fff', .8), lw: 3, sb: 10, so: 4 });
        items.forEach((k, i) => { const [code, , cc] = MSG[k]; rr(g, -296 + i * 92, -16, 68, 68, 14); g.fillStyle = cc; g.fill(); text(g, code, -262 + i * 92, 19, { f: 'mono', s: 26, w: 700, c: '#fff' }); });
        arrow(g, [[-20, 18], [70, 18]], { c, w: 6, hs: 16 });
        card(g, 90, -40, 220, 116, { r: 22, fill: '#fff', lw: 3 }); text(g, '唯一工位', 200, -5, { s: 26, w: 900, c });
        const a = lt * 4; ring(g, 200, 38, 18, c, 5, 1, a, a + 4.4);
        text(g, '自己的队列 · 自己的状态', 0, 118, { s: 26, w: 700, c: C.ink2 });
      }, { al: pa });
      panelQ(500, '主叫本地：建会话也排队', C.blue, C.blueL, ['invite', 'invite']);
      panelQ(1420, '被叫本地：入站消息排队', C.orange, C.orangeL, ['invite', 'cancel']);
      if (lt > 17.0) tag(g, '各管各的状态', 960, 760, C.ink, seg(lt, 17.0, 17.4), { fs: 30 });
    }
  },
});

/* =====================================================================
 * 总结
 * ===================================================================== */
function thumb(g, x, y, kind, p, lt) {
  at(g, x, y, ap(lt, p - .2), () => {
    card(g, -180, -140, 360, 280, { r: 26, fill: '#fff', lw: 3.5, sb: 24, so: 9 });
    const k = eo(seg(lt, p, p + 1.2));
    if (kind === 'seq') {
      for (const lx of [-110, 0, 110]) path(g, partial([[lx, -110], [lx, 110]], k), { c: rgba(C.ink, .35), w: 3, dash: [6, 6] });
      [[-110, -80, 110, -60, C.blue], [110, -40, -110, -20, C.blue], [110, 10, -110, 30, C.green], [-110, 50, 110, 70, C.green]].forEach(([a, b, c, d, col], i) => arrow(g, [[a, b], [c, d]], { p: clamp(k * 4 - i), c: col, w: 4, hs: 12 }));
    }
    if (kind === 'state') {
      for (let i = 0; i < 4; i++) { const p2 = clamp(k * 5 - i); dot(g, -120 + i * 80, -60, 20 * pop(p2), [C.grey, C.blue, C.orange, C.green][i]); ring(g, -120 + i * 80, -60, 20 * pop(p2), C.ink, 3); }
      for (let i = 0; i < 5; i++) { const bx = -128 + i * 64; path(g, partial([[bx + 8, -36], [bx + 8, 52]], clamp(k * 2 - 1)), { c: C.coral, w: 3, al: .7 }); rr(g, bx - 22, 60, 56, 30, 8); g.fillStyle = rgba(C.coral, .3 * clamp(k * 2 - 1)); g.fill(); }
    }
    if (kind === 'class') {
      [['状态', -78, -60], ['会话', 78, -60], ['拦截器', -78, 50], ['管理器', 78, 50]].forEach(([s, bx, by], i) => { const p2 = clamp(k * 5 - i); if (p2 <= 0) return;
        at(g, bx, by, pop(p2), () => { card(g, -70, -30, 140, 60, { r: 12, fill: [C.orangeL, C.blueL, NAVYL, C.purpleL][i], lw: 3, shadow: false }); text(g, s, 0, 1, { s: 26, w: 900 }); }); });
      path(g, partial([[-8, -60], [8, -60]], k), { c: C.ink, w: 3 }); path(g, partial([[78, -30], [78, 20]], k), { c: C.ink, w: 3 }); path(g, partial([[0, -40], [-20, 30]], k), { c: C.ink, w: 3, al: .5 });
    }
  });
}
S('s27', {
  card: 8,
  cues: [[0, 'whoosh'], [2.0, 'latch'], [4.8, 'tick', .5], [5.4, 'tick', .5], [6.0, 'tick', .5], [6.6, 'tick', .5], [7.2, 'tick', .5], [7.8, 'tick', .5], [9.8, 'whoosh', .5], [10.2, 'success']],
  draw(g, lt) {
    const aa = ap(lt, 1.8) * fo(lt, 4.4);
    if (aa > 0) at(g, 960, 470, aa, () => {
      card(g, -460, -150, 920, 300, { r: 30, fill: '#fff', lw: 3.5, sb: 30, so: 12 });
      text(g, '“', -390, -60, { f: 'disp', w: 900, s: 140, c: C.amber }); text(g, '”', 390, 90, { f: 'disp', w: 900, s: 140, c: C.amber });
      text(g, '【通信协议】Kotlin 实现 SIP 通信协议', 0, -40, { s: 38, w: 900 });
      text(g, '2023 · 文末总结', 0, 30, { s: 28, w: 700, c: C.ink2 });
    });
    const TH = [[330, 'seq', 4.8, '时序图', '第二章 · 握手'], [760, 'state', 6.0, '状态图', '第四章 · 状态机'], [1190, 'class', 7.2, '类图', '第五章 · 架构']];
    TH.forEach(([x, kind, p, name, sub]) => {
      if (lt < p - .3) return;
      thumb(g, x, 440, kind, p, lt);
      text(g, name, x, 625, { s: 34, w: 900, al: fa(lt, p) }); text(g, sub, x, 670, { s: 26, w: 700, c: C.ink2, al: fa(lt, p + .2) });
    });
    if (lt > 9.8) {
      arrow(g, [[1385, 440], [1480, 440]], { p: eo(seg(lt, 9.8, 10.1)), c: C.ink, w: 6, hs: 18 });
      at(g, 1640, 440, ap(lt, 10.0), () => {
        card(g, -140, -140, 280, 280, { r: 26, fill: '#1F2433', lw: 3.5, sb: 30, so: 12 });
        [[-90, -80, 120, '#FF8FA3'], [-70, -40, 150, '#8FB4FF'], [-70, 0, 110, '#FFC27A'], [-70, 40, 160, '#8FB4FF'], [-90, 80, 60, '#FF8FA3']].forEach(([x0, y0, w, c], i) => { rr(g, x0, y0 - 8, w * clamp((lt - 10.2) * 3 - i * .3), 16, 8); g.fillStyle = c; g.fill(); });
      });
      text(g, '代码', 1640, 625, { s: 34, w: 900, al: fa(lt, 10.2) });
      burst(g, 1640, 440, lt - 10.2, C.green, 12, 150);
    }
  },
});

const RULES = [['01', '每条消息都有职责', C.orange], ['02', '跳转和副作用分开', NAVY], ['03', '并发消息排成一队', C.coral]];
function ruleCard(g, i, lt) {
  const [num, title, c] = RULES[i], p = seg(lt, 0, .55);
  for (let j = 0; j < i; j++) at(g, 330 + j * 440, 190, 1, () => { card(g, -200, -44, 400, 88, { r: 26, fill: '#fff', lw: 3 }); text(g, RULES[j][0], -150, 2, { f: 'disp', w: 900, s: 40, c: RULES[j][2] }); text(g, RULES[j][1], 30, 2, { s: 30, w: 900 }); });
  at(g, 960 + (1 - eo(p)) * 700, 545, 1, () => {
    card(g, -520, -240, 1040, 480, { r: 40, fill: '#fff', lw: 4, sb: 40, so: 16 });
    card(g, -520, -240, 200, 480, { r: 40, fill: c, lw: 0, shadow: false }); rr(g, -360, -240, 40, 480, 0); g.fillStyle = c; g.fill();
    path(g, [[-320, -240], [-320, 240]], { c: C.ink, w: 4 }); rr(g, -520, -240, 1040, 480, 40); g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
    text(g, num, -420, 0, { f: 'disp', w: 900, s: 120, c: '#fff' });
    text(g, title, -260, -160, { s: 56, w: 900, a: 'left' });
  }, { al: eo(p) });
  return [960 + (1 - eo(p)) * 700 + 110, 590];
}
S('s28', {
  cues: [[0, 'whoosh', .6], [1.6, 'send', .5], [3.2, 'success', .6], [6.0, 'whoosh', .6], [7.4, 'latch'], [8.2, 'latch'], [12.0, 'whoosh', .6], [13.4, 'latch'], [14.6, 'success', .6]],
  draw(g, lt) {
    const i = lt < 6 ? 0 : lt < 12 ? 1 : 2, l = lt - i * 6, [x, y] = ruleCard(g, i, l);
    if (i === 0) {
      ticket(g, lerp(x - 300, x - 200, eo(seg(l, .8, 1.6))), y, ap(l, .6));
      if (l > 1.6) arrow(g, [[x - 36, y], [x + 50, y]], { p: eo(seg(l, 1.6, 1.9)), c: C.ink, w: 5, hs: 14 });
      if (l > 1.9) at(g, x + 190, y, ap(l, 1.9), () => { card(g, -120, -45, 240, 90, { r: 20, fill: '#fff', lw: 3 }); text(g, '码率兜底', -10, 1, { s: 30, w: 900, c: C.ink }); });
      if (l > 3.2) { badge(g, x + 300, y - 46, 26, C.green, 'check', seg(l, 3.2, 3.5)); tag(g, '能兜底就省', x, y + 120, C.green, seg(l, 3.3, 3.7), { fs: 30 }); }
    }
    if (i === 1) {
      at(g, x - 170, y, ap(l, 1.2), () => { card(g, -140, -55, 280, 110, { r: 24, fill: C.orangeL, lw: 3.5, stroke: C.orange }); text(g, '状态 · 去哪', 0, 1, { s: 30, w: 900, c: C.orange }); });
      at(g, x + 170, y, ap(l, 2.0), () => { card(g, -140, -55, 280, 110, { r: 24, fill: NAVYL, lw: 3.5, stroke: NAVY }); text(g, '拦截器 · 做什么', 0, 1, { s: 30, w: 900, c: NAVY }); });
      if (l > 2.4) path(g, partial([[x, y - 80], [x, y + 80]], eo(seg(l, 2.4, 2.8))), { c: C.ink, w: 4, dash: [10, 8] });
    }
    if (i === 2) {
      card(g, x - 330, y + 10, 480, 44, { r: 22, fill: '#3A3F52', lw: 3, shadow: false });
      const sq = (k, xx, t0) => { const [code, , cc] = MSG[k], p2 = ap(l, t0); if (p2 <= 0) return; at(g, xx, y - 22, p2, () => { rr(g, -38, -34, 76, 68, 14); g.fillStyle = cc; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); text(g, code, 0, 1, { f: 'mono', s: 28, w: 700, c: '#fff' }); }); };
      const adv = eio(seg(l, 2.4, 3.2));
      sq('cancel', x - 260 + 90 * adv, .8); sq('invite', x - 150 + 160 * adv, 1.0);
      at(g, x + 250, y, ap(l, 1.2), () => { card(g, -90, -60, 180, 120, { r: 22, fill: C.blueL, lw: 3.5, stroke: C.blue }); text(g, '工位', 0, -12, { s: 30, w: 900, c: C.blue }); text(g, '建会话', 0, 28, { s: 26, w: 700, c: C.ink2 }); });
      if (l > 2.6) tag(g, '一先一后', x - 100, y + 120, C.coral, seg(l, 2.6, 3.0), { fs: 30 });
    }
  },
});

S('s29', {
  title: true, fi: .2, fo: .4,
  draw(g, lt) {
    const a = eo(seg(lt, 0, .3));
    miniDevice(g, 'A', 560, 520, .55, lt, { al: a, badge: 'check', c: C.green });
    miniDevice(g, 'B', 1360, 520, .55, lt, { al: a, badge: 'check', c: C.green });
    text(g, SERIES.title, 960, 490, { s: 110, w: 900, al: a });
    text(g, SERIES.sub, 960, 590, { s: 40, w: 700, c: C.blue, al: eo(seg(lt, .2, .5)) });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  g.save(); g.translate(960, 740); g.scale(1.08, 1.08); g.translate(-960, -470);
  link(g, 0, 1);
  gateway(g, P.G[0], P.G[1], 1, 0, { label: false, busy: .6 });
  device(g, 'A', P.A[0], P.A[1], 1.02, { mode: 'calling' }, 0, { label: false, still: true });
  device(g, 'B', P.B[0], P.B[1], 1.02, { mode: 'ringing' }, .2, { label: false, still: true });
  chipRaw(g, P.A[0], CHIP_Y - 10, 'CALLING'); chipRaw(g, P.B[0], CHIP_Y - 10, 'RINGING');
  g.restore();
  [['invite', 470], ['ring', 760], ['accept', 1040], ['confirm', 1390]].forEach(([k, x], i) => capsule(g, x, 430 + (i % 2) * 22, k, { s: .9, rot: (i - 1.5) * .04, glow: .4 }));
  text(g, '通话协议，自己设计', 960, 168, { s: 140, w: 900 });
  text(g, '11 种消息 · 两台状态机 · Kotlin 实现 SIP 通信协议', 960, 300, { s: 44, w: 900, c: C.blue });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
