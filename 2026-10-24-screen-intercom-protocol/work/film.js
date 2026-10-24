/* =====================================================================
 * Kotlin 实现 SIP 通信协议 v2 —— 29 幕编排（字幕数据在 script.js，图元在 kit.js）
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]；B 的“内部处理”视图画在屏幕坐标里（board）。
 * 章节编号沿用 v1：0 开场、1 片名、2–6 五章、7 总结、8 结尾、9 片尾（配乐脚本按此划段）。
 * ===================================================================== */
'use strict';
const CHAPTERS = [
  ['开场｜取消去哪了', 'WHERE DID CANCEL GO', '按机制构造的两端不一致：取消消息悬在创建窗口外。'],
  ['Kotlin 实现 SIP 通信协议', 'A SIP-STYLE PROTOCOL IN KOTLIN', '先排队，再开口。'],
  ['第一章｜接通，原来这么麻烦', 'THE CALL BEGINS', '邀请、响铃、接听和确认；两块屏靠消息对齐各自的状态。'],
  ['第二章｜取消，掉进了缝里', 'THE CREATION GAP', '约 50 ms 创建窗口里，构造的取消先到，因会话未匹配而忽略。'],
  ['第三章｜状态机，背不了这锅', 'BEFORE THE STATE MACHINE', '会话匹配在状态转移之前；响铃超时只能兜底。'],
  ['第四章｜先排队，别抢跑', 'ONE AT A TIME', '同一条本地处理链逐项完成，会话创建必须包含在本次处理内。'],
  ['第五章｜这回，终于接住了', 'CANCEL FINALLY ARRIVES', '重放同一构造案例：创建完成后再处理取消；两端仍各管各的状态。'],
  ['总结｜这次记住四件事', 'KEEP THE FOUR RULES', '先认会话、排完整过程、状态机管规则、超时留退路。'],
  ['结尾｜把那条取消接住', 'LET IT FINISH', '无需虚构创建变快，让完整处理先做完。'],
  ['系列片尾', 'WORK ARCHIVE', '工作档案：把做过的设计，讲成故事。'],
];
const CARD = { 2: ['01', '接通，原来这么麻烦', 'THE CALL BEGINS', C.blue], 3: ['02', '取消，掉进了缝里', 'THE CREATION GAP', C.coral],
  4: ['03', '状态机，背不了这锅', 'BEFORE THE STATE MACHINE', C.purple], 5: ['04', '先排队，别抢跑', 'ONE AT A TIME', C.green],
  6: ['05', '这回，终于接住了', 'CANCEL FINALLY ARRIVES', C.orange], 7: ['✓', '这次记住四件事', 'FOUR RULES', C.ink] };
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };
const CODE = [
  'controls.collect { packet ->',
  '    if (isNewInvite(packet)) {',
  '        createCalleeAndWait(packet)',
  '    } else {',
  '        routeBySession(packet)',
  '    }',
  '}',
];

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
const CH_SHORT = ['开场', '', '第一章 · 接通，原来这么麻烦', '第二章 · 取消，掉进了缝里', '第三章 · 状态机，背不了这锅', '第四章 · 先排队，别抢跑', '第五章 · 这回，终于接住了', '总结 · 这次记住四件事', '结尾 · 把那条取消接住', ''];
function drawChrome(g, { sc, lt }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 64;
    card(g, 52, 40, w, 52, { r: 26, fill: rgba('#ffffff', .9), lw: 2.5, sb: 12, so: 4, sa: .1 });
    const cc = (CARD[sc.chapter] || [0, 0, 0, C.ink])[3]; dot(g, 80, 66, 8, cc === C.ink ? C.amber : cc);
    text(g, lab, 98, 67, { s: 26, w: 700, a: 'left' });
  }
  for (let k = 2; k <= 7; k++) { // 章节进度
    const on = sc.chapter >= k, cur = sc.chapter === k, x = 1590 + (k - 2) * 46;
    rr(g, x, 60, cur ? 36 : 22, 12, 6); g.fillStyle = cur ? (CARD[k][3] === C.ink ? C.amber : CARD[k][3]) : on ? rgba(C.ink, .45) : rgba(C.ink, .14); g.fill();
  }
  let xr = 1560;
  if (sc.demo) xr -= tagSmall(g, '⚠ 机制演绎', xr, 66, C.amber) + 12;
  if (sc.scaled) tagSmall(g, '时间已放慢', xr, 66, C.purple);
  g.restore();
}
function tagSmall(g, s, xr, y, c) {
  const w = textW(g, s, { s: 24, w: 700 }) + 36;
  card(g, xr - w, y - 22, w, 44, { r: 22, fill: rgba('#ffffff', .92), lw: 2.5, stroke: c, sb: 10, so: 3, sa: .08 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c });
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

/* ---------------- 舞台：A —— 网关 —— B ---------------- */
function link(g, lt, al = 1, p = 1) {
  const a1 = [P.A[0] + 178, P.A[1] - 10], g1 = [P.G[0] - 124, P.G[1] + 5], g2 = [P.G[0] + 124, P.G[1] + 5], b1 = [P.B[0] - 178, P.B[1] - 10];
  path(g, partial([a1, g1], p), { c: rgba(C.ink, .35), w: 5, dash: [3, 15], off: -lt * 40, al });
  path(g, partial([g2, b1], p), { c: rgba(C.ink, .35), w: 5, dash: [3, 15], off: -lt * 40, al });
}
const CHIP_Y = 672;
function stage(g, lt, o = {}) {
  const e = o.enter, sA = e ? pop(seg(lt, e, e + .55)) : 1, sG = e ? pop(seg(lt, e + .15, e + .7)) : 1, sB = e ? pop(seg(lt, e + .3, e + .85)) : 1;
  if (o.link !== false) link(g, lt, o.linkAl ?? 1, o.linkP ?? 1);
  gateway(g, P.G[0], P.G[1], sG, lt, { busy: o.busy || 0 });
  device(g, 'A', P.A[0], P.A[1], sA, o.a, lt);
  device(g, 'B', P.B[0], P.B[1], sB, o.b, lt);
  if (o.ca) chip(g, P.A[0], CHIP_Y, lt, ...o.ca);
  if (o.cb) chip(g, P.B[0], CHIP_Y, lt, ...o.cb);
}
function tap(g, x, y, lt, t0) { // 手指点按：圆点按下 + 涟漪
  const k = lt - t0; if (k < -.35 || k > .8) return;
  const press = k < 0 ? 1 - eo(-k / .35) : 1;
  dot(g, x, y, 22 * (k < .1 ? 1 - .25 * press : .75 + .25 * eo((k - .1) / .3)), rgba(C.ink, .28), k < .5 ? 1 : 1 - (k - .5) / .3);
  ripple(g, x, y, k, C.ink, 16, 60, .5);
}
/* 创建会话 ≈ 50 ms 的进度条：loop 时进度循环播放，done 时变绿打勾 */
function ribbon50(g, x, y, lt, p, o = {}) {
  if (p <= 0) return;
  at(g, x, y, pop(p), () => {
    card(g, -275, -38, 550, 76, { r: 22, fill: '#fff', lw: 3 });
    text(g, '建会话', -218, 1, { s: 26, w: 900 });
    const bw = 290, k = o.loop ? (lt * .35) % 1 : 1;
    hatch(g, -165, -15, bw * k, 30, o.done ? C.green : C.orange, lt * 40, 10);
    card(g, -165, -15, bw, 30, { r: 10, fill: 'transparent', lw: 2.5, shadow: false });
    text(g, '≈ 50 ms', 200, 1, { f: 'mono', s: 26, w: 700, c: C.purple });
    if (o.done) badge(g, 275, -38, 26, C.green, 'check', o.doneP ?? 1);
  });
}
/* 中途悬停的取消胶囊（开场/结尾的构图） */
const HANG = [1240, 212];

/* ---------------- B 的内部：时间轴 / 会话槽 ---------------- */
const RX0 = 340, RX1 = 1500, RY = 290;
const rx = ms => lerp(RX0, RX1, clamp(ms / 50));
function ruler(g, ms, o = {}) {
  path(g, [[RX0, RY], [RX1, RY]], { c: C.ink, w: 3 });
  for (let m = 0; m <= 50; m += 5) { const x = rx(m), big = m % 10 === 0; path(g, [[x, RY - (big ? 14 : 8)], [x, RY]], { c: C.ink, w: big ? 3 : 2 }); if (big) text(g, m + (m === 50 ? ' ms' : ''), x, RY - 34, { f: 'mono', s: 22, w: 700, c: C.ink2 }); }
  if (o.mark != null) { // 取消到达的红色标记
    const k = o.markK ?? 1, x = rx(o.mark);
    path(g, [[x, RY + 10], [x, RY + 10 + 300 * eo(k)]], { c: C.coral, w: 4, dash: [10, 8] });
    at(g, x + 130, RY + 150, pop(k), () => { card(g, -90, -22, 180, 44, { r: 22, fill: C.coral, lw: 2.5, sb: 10, so: 4 }); text(g, '取消到达', 0, 1, { s: 24, w: 900, c: '#fff' }); });
  }
  if (ms != null) { const x = rx(ms); path(g, [[x, RY - 4], [x, RY + 210]], { c: C.purple, w: 4 }); dot(g, x, RY, 9, C.purple); }
}
function createLane(g, ms, y = 360, label = '创建会话 S1', lt = 0) {
  text(g, label, RX0 - 24, y + 25, { s: 26, w: 900, a: 'right' });
  card(g, RX0, y, RX1 - RX0, 50, { r: 14, fill: '#fff', lw: 3, shadow: false });
  hatch(g, RX0 + 3, y + 3, (RX1 - RX0 - 6) * clamp(ms / 50), 44, C.orange, lt * 40, 12);
}
function bigMs(g, ms, x = 1665, y = 330) {
  text(g, '已过', x, y - 62, { s: 24, w: 700, c: C.ink2 });
  text(g, Math.min(50, Math.floor(ms)).toString(), x - 18, y, { f: 'disp', w: 900, s: 96, c: ms >= 50 ? C.green : C.purple, a: 'right' });
  text(g, 'ms', x - 10, y + 16, { f: 'disp', w: 800, s: 40, c: C.ink2, a: 'left' });
}
/* 会话槽：按进度一块块搭起来，完成后合成一张绿色卡 */
function sessionSlot(g, x, y, prog, lt, o = {}) {
  const done = o.doneAt != null ? seg(lt, o.doneAt, o.doneAt + .35) : (prog >= 1 ? 1 : 0), w = 300, h = 170;
  if (done < 1) {
    g.save(); g.globalAlpha *= 1 - done;
    card(g, x - w / 2, y - h / 2, w, h, { r: 22, fill: rgba('#ffffff', .7), lw: 3, dash: [12, 9], stroke: C.purple, shadow: false });
    for (let i = 0; i < 6; i++) {
      const kk = clamp(prog * 6 - i), bx = x - 105 + (i % 3) * 70, by = y - 10 + Math.floor(i / 3) * 52 - (1 - eo(kk)) * 60;
      if (kk > 0) card(g, bx - 30, by - 20, 60, 42, { r: 8, fill: C.purpleL, lw: 2.5, al: eo(kk), sb: 8, so: 3 });
    }
    text(g, o.label || '会话 S1 · 建造中', x, y - h / 2 + 26, { s: 24, w: 900, c: C.purple });
    g.restore();
  }
  if (done > 0) {
    at(g, x, y, pop(done), () => {
      card(g, -w / 2, -h / 2, w, h, { r: 22, fill: C.greenL, lw: 3.5, stroke: C.green, sb: 22, so: 8 });
      text(g, '会话 S1', 0, -24, { s: 40, w: 900, c: C.green });
      text(g, o.doneLabel || '已就绪', 0, 30, { s: 28, w: 700, c: C.ink });
    });
    burst(g, x, y, lt - (o.doneAt ?? -9), C.green, 14, 170);
  }
}
const SLOT = [1450, 650];
/* s08–s10 共用的 50ms 时间：会话创建从 s08 的 0.4 秒开始，到 s10 约 1 秒完成 */
const MS_RATE = 1.75, msS08 = lt => Math.max(0, (lt - .4) * MS_RATE), msS09 = lt => (14 - .4) * MS_RATE + lt * MS_RATE, msS10 = lt => (28 - .4) * MS_RATE + lt * MS_RATE;
const ARRIVE = .4 + 10 / MS_RATE; // 取消到达（t+10 ms）的局部时间

/* ---------------- 传送带与工位（第四、五章） ---------------- */
const BELT = { x0: 250, x1: 1010, y: 610 }, STATION = [1225, 560];
function belt(g, lt, o = {}) {
  const { x0, x1, y } = BELT, run = o.run ?? 1;
  card(g, x0 - 30, y, x1 - x0 + 60, 54, { r: 27, fill: '#3A3F52', lw: 3, sb: 18, so: 8 });
  g.save(); rr(g, x0 - 26, y + 4, x1 - x0 + 52, 46, 23); g.clip();
  for (let x = x0 - 60 + (lt * 70 * run) % 40; x < x1 + 40; x += 40) path(g, [[x, y + 4], [x - 14, y + 50]], { c: rgba('#ffffff', .18), w: 6 });
  g.restore();
  for (let i = 0; i < 6; i++) { const rx2 = x0 + i * (x1 - x0) / 5; dot(g, rx2, y + 27, 14, '#5B6176'); ring(g, rx2, y + 27, 14, C.ink, 2.5);
    const a = -lt * 4 * run; path(g, [[rx2 - Math.cos(a) * 10, y + 27 - Math.sin(a) * 10], [rx2 + Math.cos(a) * 10, y + 27 + Math.sin(a) * 10]], { c: '#fff', w: 3 }); }
  text(g, o.label || '入站消息队列', (x0 + x1) / 2, y + 96, { s: 26, w: 900, c: C.ink2 });
}
function barrier(g, x, y, down, lt, o = {}) { // 拦截杆：down=1 落下
  card(g, x - 14, y - 150, 28, 160, { r: 8, fill: C.ink2, lw: 2.5, sb: 8, so: 4 });
  g.save(); g.translate(x, y - 132); g.rotate(Math.PI * (1 - down));
  rr(g, -8, 0, 16, 150, 8); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  for (let i = 0; i < 4; i++) { rr(g, -8, 10 + i * 36, 16, 18, 4); g.fillStyle = C.coral; g.fill(); }
  g.restore();
  if (o.stop && down > .5) at(g, x, y - 200, pop(o.stop) * (1 + .06 * Math.sin(lt * 8)), () => { dot(g, 0, 0, 36, C.coral); ring(g, 0, 0, 36, C.ink, 3); text(g, '停', 0, 2, { s: 36, w: 900, c: '#fff' }); });
}
function station(g, lt, o = {}) {
  const [x, y] = STATION, w = 300, h = 250;
  card(g, x - w / 2, y - h / 2, w, h, { r: 28, fill: '#fff', lw: 3.5, sb: 26, so: 10 });
  card(g, x - w / 2, y - h / 2, w, 62, { r: 28, fill: C.blueL, lw: 0, shadow: false });
  path(g, [[x - w / 2, y - h / 2 + 62], [x + w / 2, y - h / 2 + 62]], { c: C.ink, w: 3 });
  text(g, '唯一工位 · collect', x, y - h / 2 + 32, { s: 26, w: 900, c: C.blue });
  if (o.item) capsule(g, x, y - 18, o.item, { s: .68, tag: o.tag });
  if (o.prog != null) {
    text(g, o.progLabel || '创建会话', x, y + 52, { s: 24, w: 700, c: C.ink2 });
    card(g, x - 110, y + 74, 220, 26, { r: 13, fill: '#fff', lw: 2.5, shadow: false });
    hatch(g, x - 108, y + 76, 216 * clamp(o.prog), 22, o.prog >= 1 ? C.green : C.orange, lt * 40, 11);
  }
  if (o.check) badge(g, x + w / 2 - 6, y - h / 2 + 6, 26, C.green, 'check', o.check);
}
/* 胶囊沿传送带移动：到 xEnd 停下；enterAt 后滑进工位 */
function onBelt(g, lt, kind, x, o = {}) { capsule(g, x, BELT.y - 34 + (o.dy || 0), kind, { s: .72, tag: o.tag, rot: o.rot, al: o.al }); }
function drop(lt, t0, x, y) { const k = seg(lt, t0, t0 + .55); return [x, lerp(y - 260, y, k < 1 ? eo(k) : 1) - (k >= 1 ? 0 : Math.abs(Math.sin(k * Math.PI * 2)) * 30 * (1 - k))]; }

/* ---------------- 状态机节点 ---------------- */
function node(g, x, y, s, o = {}) {
  const c = o.c || stateTone(s), w = Math.max(220, textW(g, s, { f: 'mono', s: 28, w: 700 }) + 70), h = 76, on = o.on ?? 0;
  at(g, x, y, o.s ?? 1, () => {
    if (o.pulse) for (let k = 0; k < 2; k++) { const ph = (o.t * .9 + k / 2) % 1; g.save(); g.globalAlpha *= (1 - ph) * .5; rr(g, -w / 2 - ph * 30, -h / 2 - ph * 30, w + ph * 60, h + ph * 60, 38 + ph * 30); g.strokeStyle = c; g.lineWidth = 4; g.stroke(); g.restore(); }
    card(g, -w / 2, -h / 2, w, h, { r: 38, fill: on ? c : '#fff', lw: 3.5, stroke: o.dim ? C.grey : C.ink, al: o.dim ? .45 : 1, sb: 20, so: 8 });
    text(g, s, 0, 2, { f: 'mono', s: 28, w: 700, c: on ? '#fff' : o.dim ? C.grey : C.ink, al: o.dim ? .6 : 1 });
  }, { al: o.al });
}

/* =====================================================================
 * 开场与片名
 * ===================================================================== */
S('s01', {
  demo: true, fi: .5,
  cam: [[0, 1480, 525, 1.6], [3.2, 1480, 525, 1.6], [5.2, 960, 470, 1], [7.0, 960, 470, 1], [8.4, 1060, 470, 1.05], [10.8, 1060, 470, 1.05], [12.2, 1360, 420, 1.3], [14.1, 1360, 420, 1.3], [15, 960, 500, .96]],
  cues: [[.3, 'ring'], [1.9, 'ring'], [3.3, 'whoosh'], [4.0, 'error'], [7.5, 'tick'], [11.2, 'latch']],
  draw(g, lt) {
    link(g, lt, 1);
    gateway(g, P.G[0], P.G[1], 1, lt);
    device(g, 'A', P.A[0], P.A[1], 1, { mode: 'cancelled' }, lt);
    device(g, 'B', P.B[0], P.B[1], 1, { mode: 'ringing' }, lt);
    chip(g, P.A[0], CHIP_Y, lt, 'ENDED.SELF_TERMINATED');
    chip(g, P.B[0], CHIP_Y, lt, 'RINGING');
    // 悬在半路的取消消息
    const k = seg(lt, 3.8, 4.4);
    if (k > 0) {
      path(g, [[P.G[0] + 70, P.G[1] - 140], [HANG[0] - 150, HANG[1] + 4]], { c: C.coral, w: 5, dash: [14, 10], al: eo(k) });
      path(g, [[HANG[0] + 150, HANG[1] + 10], [P.B[0] - 130, P.B[1] - 110]], { c: C.coral, w: 5, dash: [4, 14], al: .35 * eo(k) });
      capsule(g, HANG[0], HANG[1] + wob(lt, .5, 7), 'cancel', { s: pop(k), glow: .5 + .3 * Math.sin(lt * 4) });
    }
    if (lt > 11) at(g, HANG[0] + 190, HANG[1] - 92, pop(seg(lt, 11.1, 11.6)), () => badge(g, 0, 0, 40, C.coral, '?'), { rot: wob(lt, .7, .12) });
    // 创建会话 ≈ 50 ms 的进度条
    ribbon50(g, P.B[0], 775, lt, seg(lt, 7.3, 7.8) * (1 - seg(lt, 10.8, 11.2)), { loop: true });
  },
});

S('s02', {
  title: true, fi: .3,
  cues: [[.15, 'whoosh'], [2.0, 'send'], [3.3, 'latch'], [4.8, 'latch']],
  draw(g, lt) {
    const title = 'Kotlin 实现 SIP 通信协议', o = { s: 112, w: 900 };
    const chars = Array.from(title), total = textW(g, title, o);
    let x = 960 - total / 2;
    chars.forEach((ch, i) => {
      const w = textW(g, ch, o), p = seg(lt, .15 + i * .04, .65 + i * .04);
      at(g, x + w / 2, 400 + (1 - eo(p)) * 70, .6 + .4 * pop(p), () => text(g, ch, 0, 0, { ...o, c: ch === 'S' || ch === 'I' || ch === 'P' ? C.blue : C.ink }), { al: eo(p) });
      x += w;
    });
    const u = eio(seg(lt, 1.1, 1.8));
    rr(g, 960 - total / 2, 478, total * u, 12, 6); g.fillStyle = C.amber; g.fill();
    const sp = seg(lt, 4.8, 5.3);
    at(g, 960, 575, pop(sp), () => text(g, '先排队，再开口', 0, 0, { s: 72, w: 900, c: C.blue }), { al: sp > 0 ? 1 : 0 });
    // 迷你舞台
    const mA = [600, 790], mG = [960, 780], mB = [1320, 790];
    path(g, partial([[mA[0] + 70, mA[1]], [mG[0] - 50, mG[1]]], eo(seg(lt, 1.0, 1.6))), { c: rgba(C.ink, .35), w: 4, dash: [3, 12] });
    path(g, partial([[mG[0] + 50, mG[1]], [mB[0] - 70, mB[1]]], eo(seg(lt, 1.3, 1.9))), { c: rgba(C.ink, .35), w: 4, dash: [3, 12] });
    device(g, 'A', mA[0], mA[1], .5 * pop(seg(lt, .5, 1.0)), { mode: 'calling' }, lt, { label: false });
    gateway(g, mG[0], mG[1], .46 * pop(seg(lt, .65, 1.15)), lt, { label: false, busy: gwBusy(lt, 2.0, .6) });
    device(g, 'B', mB[0], mB[1], .5 * pop(seg(lt, .8, 1.3)), { mode: 'ringing', from: 'idle', at: 3.3 }, lt, { label: false });
    if (lt < 2.6) fly(g, lt, 2.0, .6, [mA[0], mA[1] - 60], [mG[0], mG[1] - 70], 'invite', { lift: 60, s: .45, ripple: false });
    else fly(g, lt, 2.6, .7, [mG[0], mG[1] - 70], [mB[0], mB[1] - 60], 'invite', { lift: 60, s: .45 });
  },
});

/* =====================================================================
 * 第一章：接通，原来这么麻烦
 * ===================================================================== */
S('s03', {
  card: 2,
  cam: [[0, 960, 470, 1.05], [12, 960, 480, 1]],
  cues: [[0, 'whoosh'], [1.75, 'latch', .6], [1.9, 'latch', .6], [2.05, 'latch', .6], [4.4, 'send', .6], [6.6, 'whoosh', .7], [8.8, 'latch']],
  draw(g, lt) {
    const lk = eo(seg(lt, 4.2, 5.0)), busy = lt > 5 ? .45 : 0;
    stage(g, lt, { enter: 1.6, linkP: lk, busy, a: { mode: 'app' }, b: { mode: 'app' },
      ca: lt > 9 ? ['状态 ?', null, 0, { c: C.grey, al: eo(seg(lt, 9.0, 9.4)) }] : null,
      cb: lt > 9.2 ? ['状态 ?', null, 0, { c: C.grey, al: eo(seg(lt, 9.2, 9.6)) }] : null });
    // 数据包在线上来回流动
    if (lt > 5) for (let i = 0; i < 10; i++) {
      const ph = ((lt - 5) * .55 + i / 10) % 1, ab = i % 2 === 0;
      const segPts = ph < .5 ? [[P.A[0] + 178, P.A[1] - 10], [P.G[0] - 124, P.G[1] + 5]] : [[P.G[0] + 124, P.G[1] + 5], [P.B[0] - 178, P.B[1] - 10]];
      const u = ab ? (ph % .5) * 2 : 1 - (ph % .5) * 2, pts = ab ? segPts : segPts;
      const p = [lerp(pts[0][0], pts[1][0], u), lerp(pts[0][1], pts[1][1], u)];
      rr(g, p[0] - 8, p[1] - 8 + (ab ? -14 : 14), 16, 16, 4); g.fillStyle = ab ? C.blue : C.orange; g.globalAlpha = eo(seg(lt, 5, 5.6)); g.fill(); g.globalAlpha = 1;
    }
    // “SIP 代理服务器” → 网关来当
    const t1 = seg(lt, 5.1, 5.6), strike = eo(seg(lt, 6.3, 6.7)), t2 = seg(lt, 6.6, 7.1), outA = 1 - eo(seg(lt, 8.0, 8.4));
    if (t1 > 0 && outA > 0) {
      at(g, P.G[0], 215, pop(t1), () => {
        card(g, -170, -32, 340, 64, { r: 32, fill: C.greyL, lw: 3 }); text(g, 'SIP 代理服务器', 0, 1, { s: 30, w: 900, c: C.ink2 });
        path(g, partial([[-150, 4], [150, -2]], strike), { c: C.coral, w: 6 });
      }, { al: outA * (1 - .4 * strike) });
      if (t2 > 0) tag(g, '网关来当', P.G[0] + 250, 195, C.purple, t2, { rot: -.06, al: outA });
    }
    // 自研的通话协议
    const bp = seg(lt, 8.6, 9.1);
    if (bp > 0) at(g, P.G[0], 205, pop(bp), () => {
      card(g, -300, -46, 600, 92, { r: 24, fill: C.blueL, lw: 3, stroke: C.blue, dash: [12, 8] });
      text(g, '通话怎么建立？', -60, 1, { s: 34, w: 900, c: C.blue });
      tag(g, '自己实现', 190, 0, C.blue, seg(lt, 9.6, 10.0), { fs: 26 });
    });
  },
});

S('s04', {
  cues: [[.6, 'send'], [1.4, 'send', .3], [2.2, 'ring'], [2.4, 'send', .3], [3.4, 'send', .3], [4.4, 'send'], [6.0, 'success']],
  draw(g, lt) {
    stage(g, lt, { busy: Math.max(gwBusy(lt, .6), gwBusy(lt, 4.4)),
      a: lt < 6 ? { mode: 'calling', from: 'app', at: .3 } : { mode: 'calling', label: '对方响铃中', from: 'calling', at: 6.0 },
      b: { mode: 'ringing', from: 'app', at: 2.2 },
      ca: lt < 6 ? ['CALLING', 'IDLE', .3] : ['RINGING', 'CALLING', 6.0], cb: ['RINGING', 'IDLE', 2.2] });
    // 每秒重发的影子
    for (const t0 of [1.4, 2.4, 3.4, 4.4, 5.4]) {
      const k = (lt - t0) / .9; if (k < 0 || k > 1 || t0 >= 6) continue;
      capsule(g, P.A[0] + 40 * k, P.A[1] - 175 - 70 * eo(k), 'invite', { s: .6, al: .45 * (1 - k) });
    }
    // 重发开关
    const rp = seg(lt, 1.0, 1.4), stop = seg(lt, 6.0, 6.3);
    if (rp > 0) at(g, P.A[0] - 230, P.A[1] - 170, pop(rp), () => {
      dot(g, 0, 0, 40, stop > 0 ? C.green : '#fff'); ring(g, 0, 0, 40, C.ink, 3);
      if (stop < 1) { const a = -lt * 5; ring(g, 0, 0, 22, C.blue, 6, 1 - stop, a, a + 4.6); arrowHead(g, Math.cos(a + 4.6) * 22, Math.sin(a + 4.6) * 22, a + 4.6 + Math.PI / 2, C.blue, 14, 1 - stop); }
      if (stop > 0) icCheck(g, 0, 2, 40, '#fff', eo(stop), 7);
      text(g, stop > 0 ? '停止重发' : '每秒重发', 0, 66, { s: 24, w: 900, c: stop > 0 ? C.green : C.blue });
    });
    relay(g, lt, .6, 'invite', 'AB');
    relay(g, lt, 4.4, 'ring', 'BA');
  },
});

S('s05', {
  cam: [[0, 960, 470, 1], [9.0, 960, 470, 1], [10.6, 1150, 490, 1.08], [14, 1150, 490, 1.08]],
  cues: [[.6, 'tick'], [1.0, 'send'], [2.6, 'latch'], [4.6, 'success'], [9.6, 'latch', .5]],
  draw(g, lt) {
    stage(g, lt, { busy: gwBusy(lt, 1.0),
      a: lt < 4.4 ? { mode: 'calling', label: '对方响铃中' } : { mode: 'chat', from: 'calling', fromOpt: { label: '对方响铃中' }, at: 4.4 },
      b: lt < 1.0 ? { mode: 'ringing' } : { mode: 'prepare', from: 'ringing', at: 1.0 },
      ca: ['CHATTING', 'RINGING', 4.4], cb: ['PREPARE', 'RINGING', 1.0] });
    tap(g, P.B[0] + 6, P.B[1] + 20, lt, .6);
    relay(g, lt, 1.0, 'accept', 'BA');
    if (lt > 9.4) tag(g, '还在准备…', P.B[0] + 210, CHIP_Y - 60, C.amber, seg(lt, 9.5, 9.9), { rot: .05, tc: C.ink });
  },
});

S('s06', {
  cam: [[0, 1150, 490, 1.08], [1.4, 960, 470, 1], [13, 960, 480, 1]],
  cues: [[.5, 'send'], [2.1, 'latch'], [4.2, 'success'], [8.8, 'latch']],
  draw(g, lt) {
    stage(g, lt, { busy: gwBusy(lt, .5),
      a: { mode: 'chat' }, b: lt < 4.0 ? { mode: 'prepare' } : { mode: 'chat', from: 'prepare', at: 4.0 },
      ca: ['CHATTING', null, 0, { glow: lt > 8.6 ? eo(seg(lt, 8.6, 9.2)) : 0 }], cb: ['CHATTING', 'PREPARE', 4.0, { glow: lt > 8.6 ? eo(seg(lt, 8.6, 9.2)) : 0 }] });
    relay(g, lt, .5, 'confirm', 'AB');
    // 语音数据双向流动
    if (lt > 4.4) for (let i = 0; i < 14; i++) {
      const ph = ((lt - 4.4) * .45 + i / 14) % 1, ab = i % 2 === 0, u = ab ? ph : 1 - ph;
      const x = lerp(P.A[0] + 178, P.B[0] - 178, u), y = P.A[1] - 10 - Math.sin(u * Math.PI) * 30 + (ab ? -16 : 16);
      dot(g, x, y, 7, ab ? C.blue : C.orange, eo(seg(lt, 4.4, 5)) * (.5 + .5 * Math.sin(u * Math.PI)));
    }
    // 状态对齐的括号
    const bk = eo(seg(lt, 8.4, 9.2));
    if (bk > 0) {
      path(g, partial([[P.A[0], CHIP_Y + 30], [P.A[0], 790], [P.B[0], 790], [P.B[0], CHIP_Y + 30]], bk), { c: C.green, w: 6 });
      tag(g, '状态对齐', 960, 790, C.green, seg(lt, 9.0, 9.4));
    }
  },
});

/* =====================================================================
 * 第二章：取消，掉进了缝里
 * ===================================================================== */
S('s07', {
  card: 3, demo: true,
  cam: [[0, 960, 470, 1], [8.6, 960, 470, 1], [11.3, P.B[0], P.B[1] - 6, 6.2], [12, P.B[0], P.B[1] - 6, 6.2]],
  cues: [[0, 'whoosh'], [2.2, 'whoosh', .8], [4.4, 'send'], [6.0, 'tick'], [6.4, 'send'], [8.8, 'whoosh']],
  draw(g, lt) {
    const back = lt >= 2.7;
    stage(g, lt, { busy: Math.max(gwBusy(lt, 4.4), gwBusy(lt, 6.4)),
      a: !back ? { mode: 'chat' } : lt < 6.0 ? { mode: 'calling', from: lt < 3.2 ? 'chat' : null, at: 2.7 } : { mode: 'cancelled', from: 'calling', at: 6.0 },
      b: !back ? { mode: 'chat' } : lt < 6.0 ? { mode: 'idle', from: lt < 3.2 ? 'chat' : null, at: 2.7 } : { mode: 'creating', from: 'idle', at: 6.0 },
      ca: !back ? ['CHATTING'] : lt < 6.0 ? ['CALLING', 'CHATTING', 2.7] : ['ENDED.SELF_TERMINATED', 'CALLING', 6.0],
      cb: !back ? ['CHATTING'] : ['IDLE', 'CHATTING', 2.7] });
    // 倒带
    const rw = win(lt, 2.0, 3.7, .2, .35);
    if (rw > 0) {
      g.save(); g.globalAlpha *= rw;
      for (let i = 0; i < 9; i++) { const y = 150 + i * 90 + hash(i) * 30, x = ((-lt * 2600 + hash(i * 5) * 3000) % 2600 + 2600) % 2600 - 300; path(g, [[x, y], [x + 260 + hash(i * 2) * 200, y]], { c: rgba(C.ink, .12), w: 6 }); }
      at(g, 960, 215, 1 + .08 * Math.sin(lt * 10), () => { card(g, -96, -62, 192, 124, { r: 30, fill: C.ink, lw: 0 });
        for (const dx of [-30, 18]) { g.beginPath(); g.moveTo(dx + 26, -30); g.lineTo(dx - 22, 0); g.lineTo(dx + 26, 30); g.closePath(); g.fillStyle = '#fff'; g.fill(); } });
      g.restore();
    }
    if (lt > 4.0 && lt < 9.0) relay(g, lt, 4.4, 'invite', 'AB');
    tap(g, P.A[0] + 6, P.A[1] + 20, lt, 6.0);
    // 取消消息：A → 网关 → 停在 B 门口
    if (lt >= 6.4) {
      if (lt < 7.2) fly(g, lt, 6.4, .8, [P.A[0], P.A[1] - 40], [P.G[0], P.G[1] - 60], 'cancel', { lift: 80, ripple: false });
      else fly(g, lt, 7.2, .8, [P.G[0], P.G[1] - 60], [P.B[0] - 120, P.B[1] - 200], 'cancel', { lift: 60, hold: true, holdDy: wob(lt, .5, 6) });
    }
    if (lt > 8.4) tag(g, '建会话中', P.B[0] + 200, P.B[1] - 120, C.orange, seg(lt, 8.4, 8.8), { fs: 24, rot: .05 });
    // 推进到 B 的屏幕里
    const bi = eo(seg(lt, 10.6, 12));
    if (bi > 0) screenSpace(g, () => { g.save(); g.globalAlpha *= bi; g.fillStyle = C.bg; g.fillRect(0, 0, W, H); g.restore(); board(g, '被叫屏 B · 内部处理', bi, { right: '会话还没建好' }); });
  },
});

S('s08', {
  demo: true, scaled: true,
  cues: [[.4, 'tick'], [ARRIVE - .7, 'send'], [ARRIVE, 'latch'], [9.6, 'error', .5]],
  draw(g, lt) {
    const ms = msS08(lt);
    board(g, '被叫屏 B · 内部处理', 1, { right: '' });
    ruler(g, ms, { mark: lt > ARRIVE - .05 ? 10 : null, markK: seg(lt, ARRIVE - .05, ARRIVE + .4) });
    createLane(g, ms, 360, '创建会话 S1', lt); bigMs(g, ms);
    sessionSlot(g, SLOT[0], SLOT[1], ms / 50, lt);
    // 入口
    text(g, '入站消息', 230, 560, { s: 26, w: 900, c: C.ink2 });
    path(g, [[160, 650], [300, 650]], { c: rgba(C.ink, .3), w: 5, dash: [3, 13], off: -lt * 30 });
    if (lt > ARRIVE - .8) {
      const k = clamp((lt - (ARRIVE - .8)) / .8), x = lerp(60, 640, eo(k));
      capsule(g, x, 650, 'cancel', { s: .9, tag: 'S1', sx: 1 + .12 * Math.sin(k * Math.PI), glow: k < 1 ? .5 : 0 });
      ripple(g, 640, 650, lt - ARRIVE, C.coral, 40, 150);
    }
    // 消息到了，会话还没建好
    const q = eo(seg(lt, 9.4, 10.2));
    if (q > 0) {
      path(g, partial([[820, 650], [SLOT[0] - 160, SLOT[1]]], q), { c: C.coral, w: 5, dash: [12, 10] });
      badge(g, (820 + SLOT[0] - 160) / 2, 650, 34, C.coral, '?', seg(lt, 9.9, 10.3));
      tag(g, '未就绪', SLOT[0], SLOT[1] + 130, C.coral, seg(lt, 10.0, 10.4), { fs: 26 });
    }
  },
});

S('s09', {
  demo: true, scaled: true,
  cues: [[.4, 'send'], [1.6, 'tick', .5], [4.8, 'error'], [6.4, 'error', .6], [9.6, 'tick', .6], [10.0, 'tick', .6], [10.9, 'latch']],
  draw(g, lt) {
    const ms = msS09(lt);
    board(g, '被叫屏 B · 内部处理', 1);
    ruler(g, ms, { mark: 10 }); createLane(g, ms, 360, '创建会话 S1', lt); bigMs(g, ms);
    sessionSlot(g, SLOT[0], SLOT[1], ms / 50, lt);
    // 会话匹配器
    const MX = 900, MY = 650, shake = lt > 4.8 && lt < 5.3 ? Math.sin(lt * 70) * 10 * (1 - (lt - 4.8) / .5) : 0;
    at(g, MX + shake, MY, 1, () => {
      card(g, -150, -95, 300, 190, { r: 26, fill: '#fff', lw: 3.5 });
      card(g, -150, -95, 300, 56, { r: 26, fill: C.purpleL, lw: 0, shadow: false }); path(g, [[-150, -39], [150, -39]], { c: C.ink, w: 3 });
      text(g, '会话匹配器', 0, -66, { s: 26, w: 900, c: C.purple });
      card(g, -120, -20, 240, 46, { r: 12, fill: C.greyL, lw: 2.5, shadow: false });
      text(g, lt < 1.6 ? '当前会话：—' : lt < 4.8 ? '查找 S1 …' : '没有 S1', 0, 4, { f: 'mono', s: 24, w: 700, c: lt < 4.8 ? C.ink : C.coral });
      if (lt > 1.4 && lt < 4.8) { const sx = -110 + ((lt - 1.4) * 260) % 220; path(g, [[sx, -20], [sx, 26]], { c: C.purple, w: 4, al: .8 }); }
      text(g, lt > 5.6 ? '是邀请吗？' : '', 0, 60, { s: 24, w: 900, c: C.ink2 });
    });
    if (lt > 4.8) badge(g, MX + 150, MY - 95, 30, C.coral, 'cross', seg(lt, 4.8, 5.1));
    if (lt > 6.4) badge(g, MX + 110, MY + 60, 24, C.coral, 'cross', seg(lt, 6.4, 6.7));
    // 胶囊走进匹配器
    const ink = eo(seg(lt, .4, 1.4)), out = seg(lt, 9.2, 9.6);
    if (out < 1) capsule(g, lerp(640, MX - 270, ink), 650 - 60 * ink, 'cancel', { s: lerp(.9, .62, ink), tag: 'S1', al: 1 - out });
    // 打印日志
    const pr = seg(lt, 9.6, 10.8), fall = seg(lt, 10.8, 11.1);
    card(g, MX - 140, 790, 280, 52, { r: 14, fill: C.greyL, lw: 3 }); text(g, '日志', MX - 160, 816, { s: 26, w: 900, c: C.ink2, a: 'right' });
    if (pr > 0) {
      const y = lerp(MY + 95, 760 + 30 * eo(fall), eo(pr));
      g.save(); g.beginPath(); g.rect(MX - 160, MY + 95, 320, 400); g.clip();
      card(g, MX - 120, y - 24, 240, 48, { r: 6, fill: '#fff', lw: 2.5, sb: 10, so: 3 });
      text(g, '未匹配 · 已忽略', MX, y + 1, { f: 'mono', s: 22, w: 700, c: C.coral });
      g.restore();
    }
  },
});

S('s10', {
  demo: true,
  cam: [[0, P.B[0], P.B[1] - 6, 6.2], [4.6, P.B[0], P.B[1] - 6, 6.2], [6.5, 960, 470, 1], [14, 960, 480, 1]],
  cues: [[.97, 'success'], [4.7, 'whoosh'], [6.5, 'ring'], [8.0, 'ring', .7], [9.7, 'error', .6]],
  draw(g, lt) {
    const fadeB = 1 - eo(seg(lt, 4.4, 5.1));
    if (lt > 4.3) {
      stage(g, lt, { a: { mode: 'cancelled' }, b: { mode: 'ringing', from: 'creating', at: 4.8 },
        ca: ['ENDED.SELF_TERMINATED'], cb: ['RINGING', 'IDLE', 4.8] });
      const dk = seg(lt, 9.6, 10.2);
      if (dk > 0) {
        path(g, partial([[P.A[0] + 170, CHIP_Y], [P.B[0] - 120, CHIP_Y]], eo(dk)), { c: C.coral, w: 5, dash: [14, 10] });
        tag(g, '两端不一致', 960, CHIP_Y, C.coral, seg(lt, 10.0, 10.4));
        countdown(g, P.B[0] + 250, CHIP_Y - 70, 40, 1 - (lt - 9.6) / 60 * 6, Math.ceil(60 - (lt - 9.6) * 1.2) + 's', C.orange, { fs: 26 });
      }
    }
    if (fadeB > 0) screenSpace(g, () => {
      const ms = Math.min(50, msS10(lt));
      g.save(); g.globalAlpha *= fadeB;
      if (lt < 4.4) { g.fillStyle = C.bg; g.fillRect(0, 0, W, H); }
      board(g, '被叫屏 B · 内部处理', 1); ruler(g, ms, { mark: 10 }); createLane(g, ms, 360, '创建会话 S1', lt); bigMs(g, ms);
      sessionSlot(g, SLOT[0], SLOT[1], ms / 50, lt, { doneAt: .97 });
      card(g, 900 - 140, 790, 280, 52, { r: 14, fill: C.greyL, lw: 3 }); text(g, '日志', 740, 816, { s: 26, w: 900, c: C.ink2, a: 'right' });
      card(g, 900 - 120, 762, 240, 48, { r: 6, fill: '#fff', lw: 2.5, sb: 10, so: 3 }); text(g, '未匹配 · 已忽略', 900, 787, { f: 'mono', s: 22, w: 700, c: C.coral });
      g.restore();
    });
  },
});

/* =====================================================================
 * 第三章：状态机，背不了这锅
 * ===================================================================== */
function gateArch(g, x, y, open, lt, o = {}) { // 会话关卡：门框 + 锁
  const c = open > .5 ? C.green : C.purple;
  card(g, x - 130, y - 170, 40, 300, { r: 12, fill: rgba(c, .25), lw: 3 }); card(g, x + 90, y - 170, 40, 300, { r: 12, fill: rgba(c, .25), lw: 3 });
  card(g, x - 150, y - 200, 300, 54, { r: 16, fill: c === C.green ? C.greenL : C.purpleL, lw: 3 });
  text(g, '会话关卡', x, y - 172, { s: 28, w: 900, c });
  lockIcon(g, x, y - 20 - open * 70, .95, open > .5 ? C.green : C.amber, open);
  if (o.glow) { g.save(); g.globalAlpha *= o.glow; ring(g, x, y, 170, C.green, 6, .5); g.restore(); }
}
function machine(g, x, y, lit, lt, o = {}) { // 状态机小卡
  card(g, x - 170, y - 130, 340, 260, { r: 30, fill: '#fff', lw: 3.5, al: o.al });
  text(g, '状态机', x, y - 92, { s: 30, w: 900, al: o.al });
  const pts = [[x - 95, y + 10], [x + 95, y + 10], [x, y + 85]];
  path(g, [pts[0], pts[1]], { c: C.ink, w: 3, al: .4 }); path(g, [pts[1], pts[2]], { c: C.ink, w: 3, al: .4 }); path(g, [pts[2], pts[0]], { c: C.ink, w: 3, al: .4 });
  pts.forEach((p, i) => { const on = lit > i; dot(g, p[0], p[1], 26, on ? [C.orange, C.green, C.purple][i] : '#fff'); ring(g, p[0], p[1], 26, C.ink, 3); });
}
S('s11', {
  card: 4,
  cues: [[0, 'whoosh'], [2.0, 'send', .5], [3.0, 'error', .5], [4.3, 'send'], [5.5, 'latch'], [8.3, 'send'], [9.4, 'success']],
  draw(g, lt) {
    const e = t0 => pop(seg(lt, t0, t0 + .5));
    const CX = 420, GX = 960, MX = 1520, Y = 520;
    at(g, GX, Y, e(1.8), () => gateArch(g, 0, 0, eo(seg(lt, 5.4, 5.9)), lt, { glow: seg(lt, 5.6, 6) * (1 - seg(lt, 7.5, 8)) }));
    at(g, MX, Y, e(2.0), () => machine(g, 0, 0, lt > 9.4 ? 1 + Math.floor((lt - 9.4) / .3) : 0, lt));
    // 直接丢给状态机：画出来再划掉
    const d = eo(seg(lt, 2.0, 2.8)), dOut = 1 - eo(seg(lt, 3.5, 3.9));
    if (d > 0 && dOut > 0) { arrow(g, [[CX + 140, Y - 110], [GX, Y - 260], [MX - 180, Y - 110]], { p: d, c: C.coral, w: 5, dash: [14, 10], al: dOut }); icCross(g, GX, Y - 240, 60, C.coral, eo(seg(lt, 3.0, 3.4)), 10); }
    // 胶囊：走到关卡 → 插钥匙 → 穿过 → 进状态机
    let x = CX, s = 1;
    if (lt > 4.2) x = lerp(CX, GX - 240, eo(seg(lt, 4.2, 5.0)));
    if (lt > 8.2) x = lerp(GX - 240, MX - 40, eio(seg(lt, 8.2, 9.3)));
    if (lt > 9.0) s = 1 - eo(seg(lt, 9.0, 9.4));
    at(g, x, Y, e(1.6) * s, () => capsule(g, 0, 0, 'cancel', { s: .8, tag: 'S1' }));
    if (lt > 5.0 && lt < 8.2) keyIcon(g, GX - 90 + 50 * eo(seg(lt, 5.0, 5.4)), Y - 20, .9, C.purple);
    if (lt > 5.7) tag(g, 'sessionId 匹配', GX, Y + 220, C.green, seg(lt, 5.7, 6.1), { fs: 26 });
  },
});

S('s12', {
  cues: [[.5, 'latch', .6], [4.4, 'send'], [5.8, 'success'], [8.4, 'error'], [9.0, 'latch', .6]],
  draw(g, lt) {
    const e = t0 => seg(lt, t0, t0 + .5), R = [520, 470], O = [1430, 470], Pp = [975, 250], T = [975, 720];
    const reset = lt > 8.0;
    // 次要边
    arrow(g, [[R[0] + 60, R[1] - 50], [Pp[0] - 160, Pp[1] + 20]], { p: eo(e(.9)), c: C.grey, w: 4, al: .6 });
    arrow(g, [[R[0] + 60, R[1] + 50], [T[0] - 160, T[1] - 20]], { p: eo(e(1.1)), c: C.grey, w: 4, al: .6 });
    if (e(1.0) > 0) { text(g, '点接听', 650, 320, { s: 24, w: 700, c: C.grey }); text(g, '60 s 超时', 660, 640, { s: 24, w: 700, c: C.grey }); }
    // 主边：收到 402
    const main = eo(e(1.4)), lit = lt > 5.8 && !reset;
    arrow(g, [[R[0] + 150, R[1]], [O[0] - 230, O[1]]], { p: main, c: reset ? C.grey : C.coral, w: 7 });
    if (main > .5) tag(g, '收到 402 取消', 975, R[1] - 52, reset ? C.grey : C.coral, e(1.9), { fs: 26 });
    node(g, ...Pp, 'PREPARE', { dim: true, s: pop(e(.6)) });
    node(g, ...T, 'ENDED.RINGING_TIMEOUT', { dim: true, s: pop(e(.7)) });
    node(g, ...R, 'RINGING', { s: pop(e(.3)), pulse: !lit, t: lt, on: 0 });
    node(g, ...O, 'ENDED.OTHER_TERMINATED', { s: pop(e(.5)), on: lit ? 1 : 0, c: C.green });
    if (lit) burst(g, O[0], O[1], lt - 5.8, C.green);
    if (lt > 4.4 && lt < 5.9) capsule(g, lerp(R[0] + 160, O[0] - 240, eio(seg(lt, 4.4, 5.8))), R[1] - 4, 'cancel', { s: .6 });
    // 可刚才：消息被挡在门外
    if (reset) {
      const gx = 260; card(g, gx - 16, R[1] - 90, 32, 180, { r: 10, fill: C.purpleL, lw: 3 });
      const b = seg(lt, 8.2, 9.0), x = b < .5 ? lerp(110, gx - 70, eo(b * 2)) : lerp(gx - 70, 140, eo((b - .5) * 2)), y = R[1] + (b > .5 ? 120 * eo((b - .5) * 2) : 0);
      capsule(g, x, y, 'cancel', { s: .55, rot: b > .5 ? -.5 * (b - .5) : 0, al: 1 - seg(lt, 9.4, 9.9) });
      tag(g, '没进来', R[0], R[1] + 150, C.coral, seg(lt, 8.6, 9.0), { rot: -.08, fs: 34 });
    }
  },
});

S('s13', {
  scaled: true,
  cues: [[.4, 'tick', .5], [4.75, 'latch'], [5.0, 'error', .5], [8.4, 'error']],
  draw(g, lt) {
    const ms = Math.max(0, (lt - .4) * 2.3);
    board(g, '被叫屏 B · 内部（两件事同时在跑）', 1);
    ruler(g, ms);
    createLane(g, ms, 360, '① 创建会话', lt);
    // ② 处理取消
    text(g, '② 处理取消', RX0 - 24, 520 + 25, { s: 26, w: 900, a: 'right' });
    card(g, RX0, 520, RX1 - RX0, 50, { r: 14, fill: '#fff', lw: 3, shadow: false });
    const k = seg(lt, 4.55, 4.85);
    if (k > 0) {
      at(g, rx(10) + 60, 545 - (1 - eo(k)) * 160, 1, () => card(g, -62, -22, 124, 44, { r: 12, fill: C.coral, lw: 2.5 }));
      text(g, '402', rx(10) + 60, 545, { f: 'mono', s: 22, w: 700, c: '#fff', al: eo(k) });
      // 重叠区：闪红
      const fl = .25 + .2 * Math.sin(lt * 9);
      g.save(); g.globalAlpha *= fl * eo(seg(lt, 4.8, 5.2)); rr(g, rx(10) - 10, 340, 150, 250, 18); g.fillStyle = C.coral; g.fill(); g.restore();
      tag(g, '还没建完', rx(10) + 60, 470, C.coral, seg(lt, 5.0, 5.4), { fs: 24 });
    }
    // 期望 vs 实际
    const ex = seg(lt, 8.2, 8.6), ac = seg(lt, 8.6, 9.0);
    if (ex > 0) at(g, 960, 690, pop(ex), () => { card(g, -560, -34, 1120, 68, { r: 22, fill: C.greenL, lw: 3 }); text(g, '应该：① 建完会话  →  ② 再处理取消', 0, 1, { s: 30, w: 900, c: C.green }); });
    if (ac > 0) at(g, 960, 780, pop(ac), () => { card(g, -560, -34, 1120, 68, { r: 22, fill: C.coralL, lw: 3 }); text(g, '实际：② 插进了 ① 的半路', 0, 1, { s: 30, w: 900, c: C.coral }); });
  },
});

S('s14', {
  cues: [[1.0, 'tick', .5], [1.6, 'tick', .5], [2.2, 'tick', .5], [2.8, 'tick', .5], [3.4, 'tick', .5], [4.0, 'tick', .6], [4.4, 'send'], [5.4, 'latch'], [8.6, 'error', .6]],
  draw(g, lt) {
    const BX = 600, BY = 450;
    device(g, 'B', BX, BY, 1.05, lt < 5.4 ? { mode: 'ringing' } : { mode: 'timeout', from: 'ringing', at: 5.4 }, lt);
    chip(g, BX, BY + 230, lt, 'ENDED.RINGING_TIMEOUT', 'RINGING', 5.4);
    const left = clamp(1 - (lt - .6) / 3.4), cAl = 1 - eo(seg(lt, 7.6, 8.0));
    if (cAl > 0) at(g, 1320, 450, pop(seg(lt, .2, .7)), () => {
      countdown(g, 0, 0, 160, left, Math.ceil(60 * left) + ' s', C.orange, { fs: 92 });
      tag(g, '快进 ▶▶', 0, 220, C.ink, seg(lt, .6, 1.0), { fs: 26 });
    }, { al: cAl });
    // 本地产生超时消息（不上网线）
    if (lt > 4.3) {
      const k = seg(lt, 4.4, 5.4);
      if (k < 1) { const p = bez([BX + 120, BY - 140], [BX + 330, BY - 340], [BX - 60, BY - 150], eio(k)); capsule(g, p[0], p[1], 'timeout', { s: .7, glow: .5 }); }
      if (lt > 5.2) tag(g, '本地产生 · 不发网络', BX, BY - 220, C.purple, seg(lt, 5.4, 5.8), { fs: 26 });
    }
    // 但救不了丢掉的取消
    const lg = seg(lt, 8.0, 8.6);
    if (lg > 0) at(g, 1320, 470, pop(lg), () => {
      card(g, -260, -150, 520, 300, { r: 30, fill: '#fff', lw: 3.5 });
      text(g, '日志', 0, -108, { s: 30, w: 900, c: C.ink2 });
      g.save(); g.rotate(-.05); card(g, -170, -40, 340, 70, { r: 8, fill: C.coralL, lw: 3, stroke: C.coral }); text(g, '402 · 未匹配 · 已忽略', 0, -4, { f: 'mono', s: 24, w: 700, c: C.coral }); g.restore();
      text(g, '取消，依然丢了', 0, 92, { s: 32, w: 900, c: C.coral });
    });
  },
});

/* =====================================================================
 * 第四章：先排队，别抢跑
 * ===================================================================== */
function optCard(g, x, y, title, kind, lt, o = {}) {
  at(g, x, y, o.s ?? 1, () => {
    card(g, -190, -170, 380, 340, { r: 32, fill: o.pick ? C.greenL : '#fff', lw: 3.5, stroke: o.pick ? C.green : C.ink, sb: 30, so: 12 });
    text(g, title, 0, -120, { s: 34, w: 900 });
    if (kind === 'lock') { lockIcon(g, 40, 30, 1.3, C.amber); capsule(g, -110, 90, 'invite', { s: .42 }); capsule(g, -110, 30, 'cancel', { s: .42 }); text(g, '等待解锁', 0, 140, { s: 24, w: 700, c: C.ink2 }); }
    if (kind === 'barrier') { at(g, 40, 120, .72, () => barrier(g, 0, 0, .5 + .5 * Math.sin(lt * 2), lt)); capsule(g, -100, 80, 'cancel', { s: .42 }); text(g, '暂停 / 恢复', 0, 140, { s: 24, w: 700, c: C.ink2 }); }
    if (kind === 'flow') {
      for (let i = 0; i < 3; i++) card(g, -150 + i * 62, 0, 50, 50, { r: 12, fill: i === 2 ? C.blueL : '#fff', lw: 3, sb: 8, so: 3 });
      arrow(g, [[46, 25], [92, 25]], { c: C.blue, w: 5, hs: 14 });
      card(g, 100, -15, 90, 80, { r: 16, fill: C.blueL, lw: 3 }); text(g, '工位', 145, 25, { s: 24, w: 900, c: C.blue });
      text(g, '一次只做一件', 0, 140, { s: 24, w: 700, c: C.ink2 });
    }
  }, { al: o.al, rot: o.rot });
  if (o.pick) badge(g, x + 170 * (o.s ?? 1), y - 160 * (o.s ?? 1), 32, C.green, 'check', o.pickP);
}
S('s15', {
  card: 5,
  cues: [[0, 'whoosh'], [2.1, 'error', .4], [3.0, 'latch'], [3.7, 'latch'], [4.0, 'latch'], [4.3, 'latch'], [7.4, 'success'], [10.6, 'latch'], [11.0, 'latch']],
  draw(g, lt) {
    // 先：两条消息挤在门口 → 排成一列
    const jA = win(lt, 1.6, 3.7, .3, .3);
    if (jA > 0) {
      const lined = eio(seg(lt, 2.8, 3.2)), jit = (1 - lined) * Math.sin(lt * 26) * 16;
      g.save(); g.globalAlpha *= jA;
      card(g, 1180, 360, 60, 320, { r: 20, fill: C.orangeL, lw: 3 }); text(g, '被叫屏 B', 1210, 330, { s: 26, w: 900, c: C.orange });
      capsule(g, lerp(1020, 920, lined) + jit, lerp(490, 520, lined), 'invite', { s: .8, rot: (1 - lined) * .2 });
      capsule(g, lerp(1040, 520, lined) - jit, lerp(560, 520, lined), 'cancel', { s: .8, rot: -(1 - lined) * .25 });
      g.restore();
    }
    const pick = lt > 7.0, mv = eio(seg(lt, 7.0, 7.8));
    const xs = [480, 960, 1440], kinds = ['lock', 'barrier', 'flow'], names = ['加锁', 'Handler 同步屏障', 'Flow 串行消费'];
    kinds.forEach((k, i) => {
      const p = seg(lt, 3.7 + i * .3, 4.2 + i * .3); if (p <= 0) return;
      if (k === 'flow') optCard(g, lerp(xs[i], 960, mv), lerp(480, 470, mv), names[i], k, lt, { s: pop(p) * lerp(1, 1.18, mv), pick, pickP: seg(lt, 7.4, 7.8) });
      else optCard(g, lerp(xs[i], i === 0 ? 300 : 1620, mv), lerp(480, 520, mv), names[i], k, lt, { s: pop(p) * lerp(1, .78, mv), al: 1 - .6 * mv, rot: mv * (i === 0 ? -.08 : .08) });
    });
    if (lt > 10.4) { tag(g, '好懂', 860, 740, C.blue, seg(lt, 10.6, 11.0)); tag(g, '好维护', 1060, 740, C.green, seg(lt, 11.0, 11.4)); }
  },
});

/* 第四、五章的传送带布置；cfg 给出各时刻 */
function conveyor(g, lt, cfg) {
  board(g, cfg.title || '被叫屏 B · 内部处理', 1, { right: cfg.right || '' });
  g.save(); g.translate(980, 560); g.scale(1.1, 1.1); g.translate(-980, -548);
  belt(g, lt, { run: cfg.run ?? 1 });
  const done = cfg.doneAt != null && lt >= cfg.doneAt;
  station(g, lt, { item: cfg.item?.(lt), tag: 'S1', prog: cfg.prog?.(lt), progLabel: cfg.progLabel, check: cfg.check?.(lt) });
  sessionSlot(g, 1575, 560, cfg.slot ? cfg.slot(lt) : 0, lt, { doneAt: cfg.doneAt, label: '会话 S1 · 建造中' });
  if (cfg.bar != null) barrier(g, 1040, BELT.y, cfg.bar(lt), lt, { stop: cfg.stop?.(lt) });
  cfg.extra?.(g, lt, done);
  g.restore();
}
S('s16', {
  cues: [[.9, 'latch'], [1.5, 'latch'], [3.8, 'send'], [4.2, 'latch'], [10.8, 'success'], [11.0, 'whoosh'], [11.6, 'send']],
  draw(g, lt) {
    conveyor(g, lt, {
      run: lt < 4.2 || (lt > 11.0 && lt < 12.2) ? 1 : .15,
      item: t => t > 3.9 && t < 11.6 ? 'invite' : t >= 12.2 ? 'cancel' : null,
      prog: t => t > 3.9 ? (t < 7 ? .05 : t < 11.6 ? clamp((t - 7) / 3.8) : 0) : null,
      slot: t => clamp((t - 7) / 3.8), doneAt: 10.8,
      bar: t => t < 11.0 ? 1 : 1 - eo(seg(t, 11.0, 11.4)),
      check: t => t > 10.8 && t < 11.6 ? seg(t, 10.8, 11.1) : 0,
      extra(g, t) {
        // 101 掉上传送带 → 进工位；402 掉上来 → 停在拦截杆前
        if (t < 3.9) { const [x0, y0] = drop(t, .5, 580, BELT.y - 34); const x = t < 1.1 ? x0 : lerp(580, 1000, eio(seg(t, 1.1, 3.8))); capsule(g, x, y0, 'invite', { s: .72, tag: 'S1' }); }
        if (t < 12.2) { const [x0, y0] = drop(t, 1.1, 300, BELT.y - 34); const x = t < 1.7 ? x0 : t < 11.0 ? lerp(300, 820, eio(seg(t, 1.7, 4.2))) : lerp(820, 1100, eio(seg(t, 11.0, 12.2))); capsule(g, x, y0, 'cancel', { s: .72, tag: 'S1' });
          if (t > 4.2 && t < 11.0) tag(g, '等待', 820, BELT.y - 110, C.amber, seg(t, 4.2, 4.6), { tc: C.ink, fs: 24 }); }
      },
    });
  },
});

S('s17', {
  cues: [[.4, 'tick', .5], [1.2, 'latch'], [5.0, 'success'], [9.4, 'latch']],
  draw(g, lt) {
    // 代码卡
    const x0 = 140, y0 = 230, cw2 = 900, chh = 520;
    card(g, x0, y0, cw2, chh, { r: 30, fill: '#1F2433', lw: 3.5, sb: 34, so: 14 });
    for (const [i, c] of [[0, C.coral], [1, C.amber], [2, C.green]]) dot(g, x0 + 36 + i * 30, y0 + 34, 9, c);
    text(g, '重新写过的示意代码', x0 + cw2 - 30, y0 + 35, { s: 22, w: 700, c: rgba('#ffffff', .55), a: 'right' });
    const hl = lt < 9.2 ? 2 : 4, hk = eo(seg(lt, lt < 9.2 ? .9 : 9.2, lt < 9.2 ? 1.3 : 9.6));
    rr(g, x0 + 20, y0 + 92 + hl * 56 - 26, (cw2 - 40) * hk, 50, 10); g.fillStyle = rgba(hl === 2 ? C.amber : C.blue, .22); g.fill();
    const typed = clamp((lt - .3) / 2.6);
    CODE.forEach((ln, i) => {
      const n = Math.round(ln.length * clamp(typed * CODE.length - i)); if (n <= 0) return;
      const s = ln.slice(0, n);
      // 简单着色：关键字、函数名
      let x = x0 + 44; const y = y0 + 94 + i * 56;
      const parts = s.split(/(\bif\b|\belse\b|createCalleeAndWait|routeBySession|isNewInvite|collect)/);
      for (const p of parts) {
        if (!p) continue;
        const c = p === 'if' || p === 'else' ? '#FF8FA3' : p === 'createCalleeAndWait' ? C.amber : p === 'routeBySession' ? '#8FB4FF' : p === 'isNewInvite' || p === 'collect' ? '#7FE0C0' : '#E8EAF2';
        text(g, p, x, y, { f: 'mono', s: 30, w: 700, c, a: 'left' }); x += textW(g, p, { f: 'mono', s: 30, w: 700 });
      }
    });
    if (lt > 1.0 && lt < 9.2) { const ux = x0 + 44 + textW(g, '        createCallee', { f: 'mono', s: 30, w: 700 }), uw = textW(g, 'AndWait', { f: 'mono', s: 30, w: 700 });
      rr(g, ux, y0 + 94 + 2 * 56 + 18, uw * eo(seg(lt, 1.2, 1.7)), 6, 3); g.fillStyle = C.amber; g.fill(); }
    // 循环示意
    const CX = 1490, CY = 490, R = 200, nodes = [['取消息', -Math.PI / 2], ['完成处理', Math.PI / 6], ['取下一条', Math.PI * 5 / 6]];
    const cur = lt < 4.6 ? 0 : lt < 9.2 ? 1 : 2;
    ring(g, CX, CY, R, rgba(C.ink, .25), 6);
    const a = -Math.PI / 2 + ((lt * .9) % 1) * TAU; dot(g, CX + Math.cos(a) * R, CY + Math.sin(a) * R, 12, C.blue);
    nodes.forEach(([s, ang], i) => {
      const x = CX + Math.cos(ang) * R, y = CY + Math.sin(ang) * R, on = i === cur;
      at(g, x, y, (on ? 1.12 : 1) * pop(seg(lt, .6 + i * .2, 1.1 + i * .2)), () => {
        card(g, -100, -36, 200, 72, { r: 36, fill: on ? C.blue : '#fff', lw: 3 }); text(g, s, 0, 2, { s: 30, w: 900, c: on ? '#fff' : C.ink });
      });
    });
    if (lt > 4.8) tag(g, '会话建好 ✓', CX + Math.cos(Math.PI / 6) * R, CY + Math.sin(Math.PI / 6) * R + 80, C.green, seg(lt, 4.9, 5.3), { fs: 24 });
  },
});

function miniLane(g, y, lt, mode, al = 1) { // s18 的两条对照车道
  const good = mode === 'good';
  g.save(); g.globalAlpha *= al;
  card(g, 150, y - 125, 1620, 250, { r: 30, fill: good ? rgba(C.greenL, .7) : rgba(C.coralL, .7), lw: 3 });
  text(g, good ? '等整个处理结束，再取下一条' : '只把“启动创建”放进队列', 190, y - 88, { s: 28, w: 900, a: 'left', c: good ? C.green : C.coral });
  badge(g, 1720, y - 85, 26, good ? C.green : C.coral, good ? 'check' : 'cross', 1);
  const doneAt = 9.8, done = lt >= doneAt;
  // 402
  if (good) {
    const x = lt < doneAt + .6 ? 600 : lerp(600, 1180, eio(seg(lt, doneAt + .6, doneAt + 1.4)));
    capsule(g, x, y + 20, 'cancel', { s: .74, tag: 'S1' });
    if (lt < doneAt + .6) barrier(g, 770, y + 70, 1, lt);
    if (lt > doneAt + 1.4) badge(g, 1180, y - 30, 22, C.green, 'check', seg(lt, doneAt + 1.4, doneAt + 1.7));
  } else {
    if (lt > 3.8 && lt < 5.0) tag(g, '创建任务 →', 1180, y - 60 - 30 * eo(seg(lt, 3.8, 4.6)), C.orange, seg(lt, 3.8, 4.1), { fs: 22 });
    const k = seg(lt, 4.6, 5.6), x = lerp(600, 1330, eio(k));
    if (k < 1) capsule(g, x, y + 20, 'cancel', { s: .74, tag: 'S1' });
    else { const c = lt - 5.6; burst(g, 1340, y + 10, c, C.coral, 14, 140); capsule(g, 1300, y + 40 + 20 * eo(clamp(c * 2)), 'cancel', { s: .62, rot: .4, al: 1 - seg(lt, 6.4, 7) }); if (c < .4) { g.save(); g.globalAlpha *= 1 - c / .4; dot(g, 1340, y + 10, 70, C.coral, .35); g.restore(); } }
  }
  // 工位与会话槽
  card(g, 820, y - 50, 220, 130, { r: 22, fill: '#fff', lw: 3 }); text(g, '工位', 930, y - 18, { s: 26, w: 900, c: C.blue });
  const prog = good ? clamp((lt - 3.8) / 6) : clamp((lt - 3.8) / 6);
  card(g, 850, y + 22, 160, 22, { r: 11, fill: '#fff', lw: 2.5, shadow: false }); hatch(g, 852, y + 24, 156 * prog, 18, prog >= 1 ? C.green : C.orange, lt * 40, 9);
  if (good) { if (done) at(g, 1450, y + 10, pop(seg(lt, doneAt, doneAt + .35)), () => { card(g, -120, -55, 240, 110, { r: 20, fill: C.greenL, lw: 3, stroke: C.green }); text(g, '会话 S1 ✓', 0, 2, { s: 30, w: 900, c: C.green }); });
    else { card(g, 1330, y - 45, 240, 110, { r: 20, fill: rgba('#fff', .7), lw: 3, dash: [10, 8], stroke: C.purple, shadow: false }); text(g, '建造中…', 1450, y + 10, { s: 26, w: 900, c: C.purple }); } }
  else { card(g, 1330, y - 45, 240, 110, { r: 20, fill: rgba('#fff', .7), lw: 3, dash: [10, 8], stroke: C.purple, shadow: false }); text(g, '建造中…', 1450, y + 10, { s: 26, w: 900, c: C.purple }); }
  g.restore();
}
S('s18', {
  cues: [[3.8, 'send', .5], [4.6, 'send'], [5.6, 'error'], [9.8, 'success'], [11.2, 'latch']],
  draw(g, lt) {
    miniLane(g, 330, lt, 'bad', 1 - .55 * eo(seg(lt, 10.4, 11)));
    miniLane(g, 640, lt, 'good', eo(seg(lt, .2, .6)));
    if (lt < 3.6) tag(g, '注意：是“处理完”', 960, 815, C.ink, seg(lt, .6, 1.0), { fs: 30 });
  },
});

/* =====================================================================
 * 第五章：这回，终于接住了
 * ===================================================================== */
const REPLAY_DONE = 12 + .6; // 会话在 s21 的 0.6 秒建好（以 s19 开头为 0 的连续时间）
function replay(g, T, o = {}) { // T：从 s19 开头算起的连续时间
  conveyor(g, T, {
    run: T < 4.4 ? 1 : .15,
    item: t => t > 4.5 && t < 28.6 ? 'invite' : t >= 28.6 ? 'cancel' : null,
    prog: t => t > 4.5 && t < 28.6 ? clamp((t - 4.6) / (REPLAY_DONE + 12 - 4.6)) : t >= 28.6 ? 1 : null,
    progLabel: T >= 28.6 ? '处理取消' : '创建会话',
    slot: t => clamp((t - 4.6) / (REPLAY_DONE + 12 - 4.6)), doneAt: REPLAY_DONE + 12,
    bar: t => t < 28.2 ? (t < 8.0 ? eo(seg(t, 4.6, 5.0)) : 1) : 1 - eo(seg(t, 28.2, 28.6)),
    stop: t => t > 8.2 && t < 28.2 ? seg(t, 8.2, 8.6) : 0,
    check: t => t > 30.0 ? seg(t, 30.0, 30.3) : 0,
    extra(g, t) {
      if (t < 4.6) { const [x0, y0] = drop(t, 1.9, 580, BELT.y - 34); capsule(g, t < 2.5 ? x0 : lerp(580, 1000, eio(seg(t, 2.5, 4.5))), y0, 'invite', { s: .72, tag: 'S1', al: seg(t, 1.9, 2.1) }); }
      if (t < 28.6) {
        const [x0, y0] = drop(t, 2.3, 300, BELT.y - 34);
        const jig = t > 12 && t < 28 ? Math.sin(t * 12) * 4 : 0;
        capsule(g, (t < 2.9 ? x0 : lerp(300, 880, eio(seg(t, 2.9, 5.2)))) + jig, y0 - Math.abs(jig), 'cancel', { s: .72, tag: 'S1', al: seg(t, 2.3, 2.5), rot: jig * .01 });
        if (t > 12.2 && t < 28.2) { // 等待气泡
          at(g, 880, BELT.y - 130, pop(seg(t, 12.2, 12.6)), () => { card(g, -70, -30, 140, 60, { r: 30, fill: '#fff', lw: 3 }); for (let i = 0; i < 3; i++) dot(g, -26 + i * 26, 0, 7, C.amber, .3 + .7 * ((Math.floor(t * 3) % 3) === i ? 1 : 0)); });
        }
      } else capsule(g, lerp(1100, STATION[0], eio(seg(t, 28.2, 28.6))), BELT.y - 34, 'cancel', { s: .72, tag: 'S1', al: 1 - seg(t, 28.5, 28.6) });
      o.extra?.(g, t);
    },
  });
}
S('s19', {
  card: 6, scaled: true,
  cues: [[0, 'whoosh'], [1.7, 'whoosh', .6], [2.2, 'latch'], [2.6, 'latch'], [4.6, 'send'], [8.3, 'latch']],
  draw(g, lt) {
    replay(g, lt);
    const rw = win(lt, 1.6, 3.4, .2, .4);
    if (rw > 0) at(g, 960, 320, pop(seg(lt, 1.6, 2.0)), () => { card(g, -150, -50, 300, 100, { r: 50, fill: C.ink, lw: 0 });
      for (const dx of [-90, -52]) { g.beginPath(); g.moveTo(dx + 20, -24); g.lineTo(dx - 16, 0); g.lineTo(dx + 20, 24); g.closePath(); g.fillStyle = '#fff'; g.fill(); }
      text(g, '再放一遍', 46, 2, { s: 30, w: 900, c: '#fff' }); }, { al: rw });
  },
});
S('s20', {
  scaled: true,
  cues: [[1.0, 'tick', .4], [8.4, 'error', .4], [9.6, 'success', .7]],
  draw(g, lt) {
    replay(g, 12 + lt, { extra(g, t) {
      const k = win(lt, 8.0, 11.4, .3, .4);
      if (k > 0) { g.save(); g.globalAlpha *= k * .55; capsule(g, 1545, 610, 'cancel', { s: .62, rot: .35 }); burst(g, 1575, 610, ((lt - 8.0) % 1.2), C.coral, 10, 100); g.restore();
        badge(g, 1700, 600, 26, C.coral, 'cross', seg(lt, 8.3, 8.6) * k); }
      if (lt > 9.6) tag(g, '没撞上半成品 ✓', 1600, 760, C.green, seg(lt, 9.6, 10.0), { fs: 26 });
    } });
  },
});
S('s21', {
  cues: [[.6, 'success'], [1.4, 'ring', .7], [4.3, 'whoosh'], [4.8, 'send'], [6.0, 'latch'], [8.9, 'success']],
  draw(g, lt) {
    replay(g, 24 + lt, { extra(g, t) {
      // 匹配成功与状态切换
      if (lt > 5.9) tag(g, '找到 S1 ✓', STATION[0], STATION[1] - 175, C.green, seg(lt, 5.9, 6.3), { fs: 26 });
      if (lt > 8.6) chip(g, 1530, 700, lt, 'ENDED.OTHER_TERMINATED', 'RINGING', 8.8, { glow: eo(seg(lt, 8.9, 9.4)) });
      else if (lt > .6) chip(g, 1530, 700, lt, 'RINGING', null, 0, { al: eo(seg(lt, .8, 1.2)) });
      if (lt > 8.8) burst(g, 1530, 700, lt - 8.9, C.green);
    } });
  },
});
S('s22', {
  cam: [[0, P.B[0], P.B[1] - 6, 6.2], [1.8, 960, 470, 1], [13, 960, 480, 1]],
  cues: [[.2, 'whoosh'], [4.6, 'success'], [8.8, 'latch']],
  draw(g, lt) {
    stage(g, lt, { a: { mode: 'cancelled' }, b: { mode: 'ended', from: 'ringing', at: .6 },
      ca: ['ENDED.SELF_TERMINATED', null, 0, { glow: eo(seg(lt, 4.4, 4.9)) }], cb: ['ENDED.OTHER_TERMINATED', 'RINGING', .6, { glow: eo(seg(lt, 4.4, 4.9)) }] });
    const bk = eo(seg(lt, 4.3, 5.0));
    if (bk > 0) { path(g, partial([[P.A[0], CHIP_Y + 30], [P.A[0], 780], [P.B[0], 780], [P.B[0], CHIP_Y + 30]], bk), { c: C.green, w: 6 }); tag(g, '结果对上了', 960, 780, C.green, seg(lt, 4.8, 5.2)); }
    if (lt > 8.6) at(g, P.B[0], 215, pop(seg(lt, 8.7, 9.1)), () => { card(g, -250, -42, 500, 84, { r: 26, fill: C.blueL, lw: 3, stroke: C.blue });
      for (let i = 0; i < 3; i++) card(g, -220 + i * 44, -18, 34, 34, { r: 8, fill: '#fff', lw: 2.5, shadow: false });
      text(g, '补上：本地处理顺序', 50, 1, { s: 30, w: 900, c: C.blue }); });
    const bo = 1 - eo(seg(lt, 0, .7));
    if (bo > 0) screenSpace(g, () => { g.save(); g.globalAlpha *= bo; g.fillStyle = C.bg; g.fillRect(0, 0, W, H); board(g, '被叫屏 B · 内部处理', 1); g.restore(); });
  },
});
S('s23', {
  cues: [[.5, 'latch', .6], [4.4, 'latch', .6], [8.4, 'success', .7]],
  draw(g, lt) {
    // 上：缩小的舞台
    const yy = 290, s = .62;
    path(g, [[640, yy], [880, yy]], { c: rgba(C.ink, .35), w: 4, dash: [3, 12], off: -lt * 30 }); path(g, [[1040, yy], [1280, yy]], { c: rgba(C.ink, .35), w: 4, dash: [3, 12], off: -lt * 30 });
    device(g, 'A', 500, yy, s, { mode: 'cancelled' }, lt, { label: false });
    gateway(g, 960, yy - 10, .55, lt, { label: false });
    device(g, 'B', 1420, yy, s, { mode: 'ended' }, lt, { label: false });
    tag(g, '网关只转发', 960, yy + 95, C.purple, seg(lt, .3, .7), { fs: 24 });
    // 下：两边各自的本地串行队列
    const panel = (x, title, c, cl, on, items) => {
      at(g, x, 640, 1, () => {
        card(g, -380, -150, 760, 300, { r: 32, fill: on ? cl : '#fff', lw: on ? 4 : 3, stroke: on ? c : C.ink });
        text(g, title, 0, -105, { s: 30, w: 900, c });
        for (let i = 0; i < 3; i++) card(g, -300 + i * 92, -20, 76, 76, { r: 16, fill: i === 2 ? '#fff' : rgba('#fff', .8), lw: 3, sb: 10, so: 4 });
        items.forEach((k, i) => { const [code, , cc] = MSG[k]; rr(g, -296 + i * 92, -16, 68, 68, 14); g.fillStyle = cc; g.fill(); text(g, code, -262 + i * 92, 19, { f: 'mono', s: 26, w: 700, c: '#fff' }); });
        arrow(g, [[-20, 18], [70, 18]], { c, w: 6, hs: 16 });
        card(g, 90, -40, 220, 116, { r: 22, fill: '#fff', lw: 3 }); text(g, '唯一工位', 200, -5, { s: 26, w: 900, c });
        const a = lt * 4; ring(g, 200, 38, 18, c, 5, 1, a, a + 4.4);
        text(g, '自己的队列 · 自己的状态', 0, 118, { s: 24, w: 700, c: C.ink2 });
      }, { s: 1 });
    };
    const onB = lt < 4 || lt > 8, onA = lt >= 4;
    panel(500, '主叫本地：建会话（串行）', C.blue, C.blueL, onA, ['invite', 'invite']);
    panel(1420, '被叫本地：入站消息（串行）', C.orange, C.orangeL, onB, ['invite', 'cancel']);
    path(g, [[500, 390], [500, 488]], { c: C.blue, w: 4, dash: [6, 8] }); path(g, [[1420, 390], [1420, 488]], { c: C.orange, w: 4, dash: [6, 8] });
    if (lt > 8.2) tag(g, '各管各的状态', 960, 846, C.ink, seg(lt, 8.3, 8.7), { fs: 30 });
  },
});

/* =====================================================================
 * 总结：这次记住四件事
 * ===================================================================== */
const RULES = [['01', '先认会话', C.purple], ['02', '排完整过程', C.blue], ['03', '状态机管规则', C.orange], ['04', '超时留退路', C.green]];
function ruleCard(g, i, lt) {
  const [num, title, c] = RULES[i], p = seg(lt, 0, .55);
  // 已讲过的规则缩到顶部一排
  for (let j = 0; j < i; j++) at(g, 330 + j * 420, 190, 1, () => { card(g, -190, -44, 380, 88, { r: 26, fill: '#fff', lw: 3 }); text(g, RULES[j][0], -140, 2, { f: 'disp', w: 900, s: 40, c: RULES[j][2] }); text(g, RULES[j][1], 30, 2, { s: 30, w: 900 }); });
  at(g, 960 + (1 - eo(p)) * 700, 540, 1, () => {
    card(g, -520, -250, 1040, 500, { r: 40, fill: '#fff', lw: 4, sb: 40, so: 16 });
    card(g, -520, -250, 200, 500, { r: 40, fill: c, lw: 0, shadow: false }); rr(g, -360, -250, 40, 500, 0); g.fillStyle = c; g.fill();
    path(g, [[-320, -250], [-320, 250]], { c: C.ink, w: 4 }); rr(g, -520, -250, 1040, 500, 40); g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
    text(g, num, -420, 0, { f: 'disp', w: 900, s: 120, c: '#fff' });
    text(g, title, -260, -170, { s: 56, w: 900, a: 'left' });
  }, { al: eo(p) });
  return [960 + (1 - eo(p)) * 700 + 110, 580];
}
S('s24', {
  card: 7,
  cues: [[0, 'whoosh'], [2.2, 'latch'], [4.6, 'error', .5]],
  draw(g, lt) {
    const [x, y] = ruleCard(g, 0, lt - 1.6 < 0 ? 0 : lt - 1.6);
    if (lt < 1.6) return;
    keyIcon(g, x - 250 + 80 * eo(seg(lt, 1.8, 2.2)), y, 1.4, C.purple); lockIcon(g, x - 20, y, 1.4, lt > 2.2 ? C.green : C.amber, eo(seg(lt, 2.2, 2.6)));
    sessionSlot(g, x + 250, y, 1, lt, { doneAt: 2.4 });
    if (lt > 4.4) { const k = seg(lt, 4.4, 5.4); capsule(g, x - 200, y + 120 + 120 * eo(k), 'cancel', { s: .5, rot: k * .6, al: 1 - seg(lt, 5.6, 6.2) }); tag(g, '会话没好 → 可能丢', x + 150, y + 160, C.coral, seg(lt, 4.6, 5.0), { fs: 26 }); }
  },
});
S('s25', {
  cues: [[.6, 'whoosh', .6], [3.4, 'success', .6], [5.0, 'latch']],
  draw(g, lt) {
    const [x, y] = ruleCard(g, 1, lt);
    const p = clamp((lt - .8) / 2.6);
    card(g, x - 300, y - 20, 600, 40, { r: 20, fill: '#fff', lw: 3, shadow: false }); hatch(g, x - 297, y - 17, 594 * p, 34, p >= 1 ? C.green : C.blue, lt * 40, 17);
    text(g, p >= 1 ? '这一条处理完了' : '处理中…', x, y - 60, { s: 28, w: 900, c: p >= 1 ? C.green : C.blue });
    const nx = lt < 4.8 ? x - 300 : lerp(x - 300, x - 80, eio(seg(lt, 4.8, 5.4)));
    capsule(g, nx, y + 100, 'cancel', { s: .55 }); if (lt < 4.8) tag(g, '下一条 · 等', x + 100, y + 100, C.amber, seg(lt, 1.0, 1.4), { fs: 24, tc: C.ink });
  },
});
S('s26', {
  cues: [[.6, 'whoosh', .6], [1.2, 'latch'], [4.6, 'success']],
  draw(g, lt) {
    const [x, y] = ruleCard(g, 2, lt);
    const n1 = [x - 260, y], n2 = [x + 40, y], n3 = [x + 300, y];
    arrow(g, [[x - 410, y], [n1[0] - 70, y]], { p: eo(seg(lt, 1.0, 1.5)), c: C.blue, w: 6 }); text(g, '按顺序', x - 370, y - 40, { s: 24, w: 900, c: C.blue, al: seg(lt, 1.2, 1.6) });
    arrow(g, [[n1[0] + 70, y], [n2[0] - 70, y]], { p: eo(seg(lt, 4.4, 4.8)), c: C.orange, w: 6 }); arrow(g, [[n2[0] + 70, y], [n3[0] - 70, y]], { p: eo(seg(lt, 4.8, 5.2)), c: C.orange, w: 6 });
    [n1, n2, n3].forEach((n, i) => { const on = lt > 4.4 + i * .4; dot(g, n[0], n[1], 52, on ? [C.blue, C.orange, C.green][i] : '#fff'); ring(g, n[0], n[1], 52, C.ink, 3.5); if (on && i === 2) icCheck(g, n[0], n[1] + 4, 52, '#fff', 1, 9); });
  },
});
S('s27', {
  cues: [[.6, 'whoosh', .6], [2.4, 'latch'], [4.6, 'error', .4]],
  draw(g, lt) {
    const [x, y] = ruleCard(g, 3, lt);
    const left = clamp(1 - (lt - .8) / 1.6);
    countdown(g, x - 230, y, 90, left, Math.ceil(60 * left) + 's', C.green, { fs: 48 });
    // 出口
    at(g, x + 40, y, pop(seg(lt, 2.2, 2.6)), () => { card(g, -60, -95, 120, 190, { r: 14, fill: C.greenL, lw: 3.5 }); dot(g, 30, 0, 9, C.ink); text(g, '退出', 0, 130, { s: 26, w: 900, c: C.green }); });
    if (lt > 4.4) at(g, x + 250, y, pop(seg(lt, 4.5, 4.9)), () => { card(g, -135, -60, 270, 120, { r: 24, fill: C.coralL, lw: 3, stroke: C.coral }); text(g, '≠ 修复顺序', 0, 2, { s: 32, w: 900, c: C.coral }); });
  },
});

/* =====================================================================
 * 结尾与片尾
 * ===================================================================== */
S('s28', {
  demo: true,
  cam: [[0, 960, 470, 1], [10, 960, 480, .93]],
  cues: [[.4, 'send'], [2.0, 'latch'], [2.4, 'success'], [7.4, 'success']],
  draw(g, lt) {
    stage(g, lt, { busy: gwBusy(lt, .4), a: { mode: 'cancelled' }, b: lt < 2.0 ? { mode: 'ringing' } : { mode: 'ended', from: 'ringing', at: 2.0 },
      ca: ['ENDED.SELF_TERMINATED'], cb: ['ENDED.OTHER_TERMINATED', 'RINGING', 2.0] });
    relay(g, lt, .4, 'cancel', 'AB', { hold: lt < 2.6 });
    if (lt > 2.0 && lt < 3.4) burst(g, P.B[0], P.B[1] - 40, lt - 2.0, C.green, 16, 180);
    ribbon50(g, P.B[0], 790, lt, seg(lt, 3.8, 4.3), { done: lt > 7.2, doneP: seg(lt, 7.3, 7.6) });
    if (lt > 4.4 && lt < 7.2) tag(g, '不用变快', P.B[0] - 380, 790, C.amber, seg(lt, 4.5, 4.9), { tc: C.ink, fs: 26 });
    if (lt > 7.4) tag(g, '只要让它做完', P.B[0] - 410, 790, C.green, seg(lt, 7.5, 7.9), { fs: 26 });
  },
});
S('s29', {
  title: true, fi: .2, fo: .4,
  draw(g, lt) {
    const a = eo(seg(lt, 0, .3));
    device(g, 'A', 560, 520, .55, { mode: 'ended' }, lt, { label: false, al: a });
    device(g, 'B', 1360, 520, .55, { mode: 'ended' }, lt, { label: false, al: a });
    text(g, SERIES.title, 960, 490, { s: 110, w: 900, al: a });
    text(g, SERIES.sub, 960, 590, { s: 40, w: 700, c: C.blue, al: eo(seg(lt, .2, .5)) });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  g.save(); g.translate(960, 700); g.scale(1.12, 1.12); g.translate(-960, -470);
  link(g, 0, 1);
  gateway(g, P.G[0], P.G[1], 1, 0, { label: false });
  device(g, 'A', P.A[0], P.A[1], 1.05, { mode: 'cancelled' }, 0, { label: false, still: true });
  device(g, 'B', P.B[0], P.B[1], 1.05, { mode: 'ringing' }, .2, { label: false, still: true });
  capsule(g, HANG[0], HANG[1] + 20, 'cancel', { s: 1.05, glow: .7 });
  badge(g, HANG[0] + 245, HANG[1] + 20, 44, C.coral, '?', 1);
  g.restore();
  text(g, '取消去哪了', 960, 165, { s: 150, w: 900 });
  text(g, '约 50 毫秒的会话竞态 · Kotlin 实现 SIP 通信协议', 960, 280, { s: 44, w: 900, c: C.coral });
  tagSmall(g, '⚠ 机制演绎', 1800, 92, C.amber);
  postFX(g, { ...frame, t: 0 });
}

film.finish();
