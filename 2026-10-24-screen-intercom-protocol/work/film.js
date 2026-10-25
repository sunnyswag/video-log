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
    at(g, fx, 390, ap(lt, .4), () => { card(g, -180, -60, 360, 120, { r: 24, fill: C.blueL, lw: 3.5, stroke: C.blue }); text(g, '系统 SIP', 0, 2, { s: 36, w: 900, c: C.blue });
      if (dead > 0) { g.save(); g.globalAlpha *= dead * .55; rr(g, -180, -60, 360, 120, 24); g.fillStyle = C.grey; g.fill(); g.restore(); } });
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
  g.save(); g.globalAlpha *= al;
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
    dot(g, lx, y, 8, stateTone(s), p);
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
    if (lt > 8.2) fly(g, lt, 8.2, .8, [1780, 220], [1250, 330], 'ring', { lift: 60, s: .9, hold: lt < 12.0, holdAl: fo(lt, 11.6) });
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
    const top = [P.G[0], P.G[1] - 175];
    if (lt > 8.2 && lt < 9.0) fly(g, lt, 8.2, .8, [P.B[0], P.B[1] - 40], top, 'accept', { lift: 80, ripple: false });
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
      const fall = seg(lt, 4.2, 5.2), p = L2([P.A[0] + 60, 300], [P.G[0], 236], eio(seg(lt, 1.0, 2.0)));
      const y = p[1] - (lt < 2.0 ? Math.sin(seg(lt, 1.0, 2.0) * Math.PI) * 60 : wob(lt, .6, 6)) + 420 * fall * fall;
      if (fall < 1) ticket(g, p[0], y, .9, { rot: fall * .7, al: 1 - fall });
    }
    if (lt > 2.0 && lt < 4.4) tag(g, '不等回复', P.G[0], 140, C.coral, seg(lt, 2.0, 2.4), { fs: 28, al: fo(lt, 4.0) });
    hypo(g, 'B 没收到', P.G[0], 140, seg(lt, 4.3, 4.7) * fo(lt, 12.0));
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
      ticket(g, P.G[0], 236, .9 * ap(lt, 12.2));
      badge(g, P.G[0] + 150, 196, 28, C.green, 'check', seg(lt, 12.6, 13.0));
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
      if (lt > f && lt < f + .9) { const u = eio(seg(lt, f, f + .8)), q = bez([360, y], [700, y - 60], [BOX[0] - 160, BOX[1]], u); capsule(g, q[0], q[1], 'timeout', { s: .9, glow: .5, al: 1 - seg(lt, f + .7, f + .9) }); }
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
