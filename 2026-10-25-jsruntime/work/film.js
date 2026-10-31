/* =====================================================================
 * JSRuntime 用 Ubus 转发消息 —— 19 幕编排（字幕数据在 script.js，图元在 kit.js）
 * 结构：0 开场、1 片名、2–6 五章（五个“为什么不”）、7 总结、8 系列片尾（audio.py / checks.cjs 按此读取）。
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]。所有绘制只依赖时间 t。
 * ===================================================================== */
'use strict';
const CARD = {
  2: ['01', '为什么不只用一个循环', 'WHY NOT ONE LOOP', C.teal], 3: ['02', '为什么不直接调用', 'WHY NOT CALL DIRECTLY', C.brick],
  4: ['03', '为什么不等回信', 'WHY NOT JUST WAIT', C.green], 5: ['04', '为什么不共用订阅者', 'WHY NOT SHARE A SUBSCRIBER', C.purple],
  6: ['05', '为什么不手写胶水', 'WHY NOT HAND-WRITE THE GLUE', C.navy], 7: ['✓', '三条设计经验', 'THREE TAKEAWAYS', C.brassD],
};
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.bg, white: C.ink, cyan: C.teal, red: C.red, amber: C.amber },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: C.teal, danger: C.red, accent: C.brassD },
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
function screenSpace(g, fn) { g.save(); g.setTransform(SCX, 0, 0, SCX, 0, 0); const z = CAMZ; CAMZ = 1; try { fn(); } finally { CAMZ = z; g.restore(); } }

/* 章节转场：航空信封红蓝斜纹边的色带扫入 → 邮戳章节号 + 标题 → 扫出 */
function chapterWipe(g, { sc, lt }) {
  const cd = CARD[sc.card]; if (!cd || lt > 1.95) return;
  const [num, zh, en, col] = cd;
  const pin = eio(seg(lt, 0, .38)), pout = eio(seg(lt, 1.42, 1.92));
  const x0 = lerp(-W - 400, -200, pin) + lerp(0, W + 600, pout);
  const band = new Path2D(); band.moveTo(x0, 0); band.lineTo(x0 + W + 400, 0); band.lineTo(x0 + W + 200, H); band.lineTo(x0 - 200, H); band.closePath();
  g.save();
  g.save(); shadow(g, .25, 40, 0); g.fillStyle = col; g.fill(band); g.restore();
  // 航空信封斜纹边（前缘）
  const ex = x0 + W + 400, ew = 64, n = 14;
  for (let i = 0; i < n; i++) {
    const y0 = i * H / n, y1 = (i + 1) * H / n, xa = ex - 200 * y0 / H, xb = ex - 200 * y1 / H;
    g.beginPath(); g.moveTo(xa, y0); g.lineTo(xa + ew, y0 - 30); g.lineTo(xb + ew, y1 - 30); g.lineTo(xb, y1); g.closePath();
    g.fillStyle = i % 2 ? C.navy : C.red; g.fill();
  }
  g.clip(band);
  const a = eo(seg(lt, .3, .62)) * (1 - eo(seg(lt, 1.38, 1.6)));
  const dx = (1 - eo(seg(lt, .3, .7))) * 80;
  g.save(); g.globalAlpha *= a;
  postmark(g, 440 - dx, 520, 170, rgba('#ffffff', .95), [{ s: num, dy: 6, fs: num.length > 1 ? 150 : 170, f: 'disp' }], { rot: -.08 });
  g.restore();
  text(g, zh, 690 + dx * .5, 488, { s: 96, w: 900, c: '#fff', a: 'left', al: a });
  text(g, en, 696 + dx * .5, 584, { f: 'mono', s: 30, w: 700, ls: 6, c: rgba('#ffffff', .82), a: 'left', al: a });
  g.restore();
}

/* 外框：左上邮签式章节标签，右上 6 枚小邮票当进度 */
const CH_SHORT = ['开场', '', '第一章 · 为什么不只用一个循环', '第二章 · 为什么不直接调用', '第三章 · 为什么不等回信', '第四章 · 为什么不共用订阅者',
  '第五章 · 为什么不手写胶水', '总结 · 三条设计经验', ''];
const chColor = k => (CARD[k] || [0, 0, 0, C.brass])[3];
function drawChrome(g, { sc, lt }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 70;
    card(g, 52, 40, w, 52, { r: 8, fill: rgba(C.paper, .94), lw: 2.5, sb: 12, so: 4, sa: .1 });
    path(g, [[52 + w - 16, 44], [52 + w - 16, 88]], { c: rgba(C.ink, .3), w: 2, dash: [4, 5] });
    dot(g, 80, 66, 9, C.brass); ring(g, 80, 66, 9, C.ink, 2);
    text(g, lab, 100, 67, { s: 26, w: 700, a: 'left' });
  }
  for (let k = 2; k <= 7; k++) { // 小邮票进度
    const cur = sc.chapter === k, on = sc.chapter >= k, x = 1588 + (k - 2) * 52, y = 66, s = cur ? 1.12 : 1;
    at(g, x, y, s, () => {
      rr(g, -18, -22, 36, 44, 3); g.fillStyle = on ? (cur ? chColor(k) : rgba(C.ink, .38)) : rgba(C.paper, .8); g.fill();
      g.lineWidth = 2; g.strokeStyle = rgba(C.ink, on ? .7 : .35); g.stroke();
      for (let i = 0; i < 5; i++) { dot(g, -18 + i * 9, -22, 2.6, C.bg); dot(g, -18 + i * 9, 22, 2.6, C.bg); }
      text(g, k === 7 ? '✓' : String(k - 1), 0, 1, { f: 'disp', w: 900, s: 24, c: on ? '#fff' : C.ink2 });
      if (cur) ring(g, 14, -14, 16, rgba(C.ink, .55), 2);
    });
  }
  const demo = typeof sc.demo === 'function' ? sc.demo(lt) : sc.demo;
  if (demo) tagSmall(g, '⚠ 机制演绎', 1556, 66, C.amber, demo);
  g.restore();
}
function tagSmall(g, s, xr, y, c, al = 1) {
  const w = textW(g, s, { s: 24, w: 700 }) + 36;
  g.save(); g.globalAlpha *= clamp(+al);
  card(g, xr - w, y - 22, w, 44, { r: 22, fill: rgba(C.paper, .94), lw: 2.5, stroke: c, sb: 10, so: 3, sa: .08 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c: C.brassD });
  g.restore();
  return w;
}

/* 字幕：米白邮票条（上下齿孔 + 细双线框），深棕字；^黄铜^ 加荧光底 */
function capState(g, frame) {
  const { sc, lt } = frame; if (sc.title || sc.noCaption || !sc.captions?.length) return null;
  const i = sc.cs.findIndex((s, k) => lt >= s && lt < sc.ce[k]); if (i < 0) return null;
  const c = { t0: sc.start + sc.cs[i], t1: sc.start + sc.ce[i], text: sc.captions[i].text }, layout = film.captionLayout(g, c, frame.t);
  if (!layout) return null;
  return { layout, alpha: Math.min(seg(lt, sc.cs[i], sc.cs[i] + .12), 1 - seg(lt, sc.ce[i] - .12, sc.ce[i])) };
}
function drawCaptionBackground(g, frame) {
  CAMZ = 1; const c = capState(g, frame); if (!c) return;
  const L = c.layout.lines, w = Math.max(...L.map(l => l.width)) + 96, top = L[0].y - 66, h = (L.length - 1) * 64 + 98;
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .25)), x = (W - w) / 2, y = top + (1 - k) * 10;
  g.save(); g.globalAlpha *= c.alpha;
  card(g, x, y, w, h, { r: 6, fill: rgba(C.paper, .97), lw: 2.5, sb: 26, so: 10, sa: .18 });
  rr(g, x + 9, y + 9, w - 18, h - 18, 3); g.lineWidth = 1.6; g.strokeStyle = rgba(C.brassD, .5); g.stroke();
  for (let xx = x + 14; xx < x + w - 6; xx += 22) { dot(g, xx, y, 4.2, C.bg2); dot(g, xx, y + h, 4.2, C.bg2); }
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
      if (s.c === C.brassD) { rr(g, x - 3, l.y + 6 + (1 - k) * 10, w + 6, 14, 5); g.fillStyle = rgba(C.amber, .45); g.fill(); }
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
    ...o, id, chapter: d.chapter, dur: d.dur, pre: 0, post: 0, demo: o.demo ?? d.demo,
    captions: d.caps.map(([t, end, text]) => ({ t, end, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t, type, v: v ?? 1 })),
    draw: (g, lt, sc) => o.draw(g, lt, sc),
  });
}

/* =====================================================================
 * 通用图元（本片专用）
 * ===================================================================== */
const SPIN = 2.4; // 钟针角速度：事件循环在跑
function padlock(g, x, y, s, closed = 1, c = C.brass) {
  at(g, x, y, s, () => {
    g.save(); g.translate(0, -(1 - closed) * 12); g.beginPath(); g.arc(0, -16, 18, Math.PI, 0); g.lineWidth = 8; g.strokeStyle = C.ink; g.stroke(); g.restore();
    card(g, -27, -16, 54, 44, { r: 8, fill: c, lw: 3, shadow: false }); dot(g, 0, 2, 6, C.ink); g.fillStyle = C.ink; g.fillRect(-2.5, 2, 5, 12);
  });
}
function mailCart(g, x, y, s, lt, o = {}) {
  at(g, x, y, s, () => {
    shadowEll(g, 0, 2, 200);
    card(g, -90, -96, 180, 70, { r: 8, fill: C.tealL, lw: 3, sb: 10, so: 4 });
    text(g, '邮车', 0, -60, { s: 26, w: 900, c: C.tealD });
    for (const wx of [-56, 56]) { const a = (o.roll || 0) / 24; dot(g, wx, -16, 18, C.ink); dot(g, wx, -16, 10, C.grey); path(g, [[wx, -16], [wx + Math.cos(a) * 14, -16 + Math.sin(a) * 14]], { c: C.ink, w: 3 }); }
    path(g, [[90, -80], [128, -112]], { c: C.ink, w: 6 });
  }, { al: o.al });
}
function routeDash(g, pts, p, o = {}) { path(g, partial(pts, p), { c: o.c || rgba(C.ink, .45), w: o.w || 4, dash: [14, 12], off: o.off || 0, al: o.al }); }
function lever(g, x, y, s, ang, label, col, o = {}) {
  at(g, x, y, s, () => {
    shadowEll(g, 0, 2, 160);
    card(g, -70, -70, 140, 70, { r: 10, fill: o.l || C.brickL, lw: 3, sb: 10, so: 4 });
    text(g, label, 0, -35, { f: 'mono', s: 24, w: 700, c: col });
    g.save(); g.translate(0, -70); g.rotate(ang); path(g, [[0, 0], [0, -86]], { c: C.ink, w: 9 }); dot(g, 0, -90, 14, col); ring(g, 0, -90, 14, C.ink, 3); g.restore();
    dot(g, 0, -70, 10, C.brassD);
  }, { al: o.al });
}
/* 文件叠（IDL 生成物） */
function docStack(g, x, y, w, h, title, sub, col, o = {}) {
  const fill = o.fill ?? 1;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  if (fill < 1) { rr(g, x, y, w, h, 12); g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = rgba(C.ink, .45); g.stroke(); g.setLineDash([]); }
  if (fill > 0) {
    g.save(); g.globalAlpha *= fill;
    for (let i = 2; i >= 1; i--) card(g, x + i * 9, y - i * 9, w, h, { r: 12, fill: C.paper, lw: 2.5, sb: 10, so: 4 });
    card(g, x, y, w, h, { r: 12, fill: '#FFFCF4', lw: 3, stroke: col, sb: 16, so: 6 });
    for (let i = 0; i < 3; i++) path(g, [[x + 24, y + 104 + i * 26], [x + 24 + (w - 60) * (.55 + hash(i + w) * .4), y + 104 + i * 26]], { c: rgba(col, .35), w: 6 });
    g.restore();
  }
  rr(g, x, y, w, 56, 12); g.fillStyle = rgba(col, fill > 0 ? .95 : .25); g.fill();
  text(g, title, x + 20, y + 29, { s: 28, w: 900, c: fill > 0 ? '#fff' : C.ink, a: 'left' });
  if (sub) text(g, sub, x + w / 2, y + h - 26, { s: 24, w: 700, c: C.ink2, al: o.subA ?? 1 });
  g.restore();
}

/* =====================================================================
 * 开场：两座邮局，一个柜员
 * ===================================================================== */
const OJ = [420, 800], OU = [1060, 800], OH = [1560, 800], OS = [1810, 800];
S('s01', {
  fi: .5,
  cam: [[0, 520, 600, 1.3], [4.2, 960, 560, 1]],
  cues: [[.2, 'whoosh'], [1.3, 'blip', .6], [4.3, 'whoosh', .7], [5.0, 'latch', .6], [7.6, 'tick'], [9.3, 'tick'], [11.5, 'error', .8], [12.6, 'error', .5], [15.0, 'blip']],
  draw(g, lt) {
    const jsA = SPIN * lt, crack = eo(seg(lt, 11.4, 12.2));
    ground(g, OJ[1]);
    // 系统服务之间的总线路线
    const bus = fa(lt, 4.4, .6);
    if (bus > 0) {
      routeDash(g, [[OU[0] + 170, 788], [OH[0] - 160, 788]], eo(seg(lt, 5.0, 5.8)), { c: rgba(C.navy, .7), w: 5, off: -lt * 30 });
      routeDash(g, [[OH[0] + 160, 788], [OS[0] - 70, 788]], bus, { c: rgba(C.navy, .7), w: 5, off: -lt * 30 });
      for (let i = 0; i < 2; i++) { const ph = (lt * .35 + i * .5) % 1; if (lt > 5) envelope(g, lerp(OH[0] + 120, OS[0] - 60, i ? 1 - ph : ph), 740, .32, { al: bus * Math.sin(ph * Math.PI), stripe: false }); }
    }
    hub(g, OH[0], OH[1], .7 * ap(lt, 4.2, .6), lt, { busy: bus * .6 });
    hut(g, OS[0], OS[1], .55 * ap(lt, 4.5, .6), '系统服务', lt, { al: fa(lt, 4.6) });
    // ubus 邮局：暗着、钟停着
    postOffice(g, OU[0], OU[1], .9 * ap(lt, 5.0, .6), { role: 'ubus', lit: 0, ang: 1.1, al: fa(lt, 5.0) });
    if (lt > 9.0) plate(g, '要有人跑 uloop', OU[0], 600, { fs: 24, f: 'cjk', s: ap(lt, 9.4), rot: -.04, fill: C.amberL });
    // JS 邮局 + 绕圈的柜员
    postOffice(g, OJ[0], OJ[1], ap(lt, .2, .6), { role: 'js', lit: 1, ang: jsA, arc: .6 });
    const ph = lt * .22 % 1, cx = OJ[0] + Math.cos(ph * TAU) * 130, cy = 836 + Math.sin(ph * TAU) * 16;
    g.save(); g.globalAlpha *= fa(lt, .6); g.beginPath(); g.ellipse(OJ[0], 836, 130, 16, 0, 0, TAU); g.setLineDash([8, 8]); g.lineWidth = 3; g.strokeStyle = rgba(C.teal, .6); g.stroke(); g.restore();
    clerk(g, cx, cy, .62 * ap(lt, .7), { c: C.teal, pose: 'walk', ph: lt * 1.6, dir: Math.sin(ph * TAU) > 0 ? -1 : 1 });
    // 钟名
    if (lt > 7.5) plate(g, 'libuv', OJ[0] + 110, OJ[1] - 330, { s: ap(lt, 7.6), c: C.tealD });
    if (lt > 9.1) plate(g, 'uloop', OU[0] + 104, OU[1] - 300, { s: ap(lt, 9.2), c: C.brickD });
    for (const [x, y, t0, c] of [[OJ[0], OJ[1] - 318, 7.6, C.teal], [OU[0], OU[1] - 286, 9.2, C.brick]]) ripple(g, x, y, lt - t0, c, 40, 110, .8);
    // 想寄信给系统服务
    const want = fa(lt, 1.2) * fo(lt, 11.2);
    if (want > 0) {
      const pts = arcPts([OJ[0] + 120, 420], [OS[0] - 40, 600], 260);
      routeDash(g, pts, eo(seg(lt, 1.4, 2.6)), { c: rgba(C.teal, .7), w: 4, al: want, off: -lt * 20 });
      envelope(g, OJ[0] + 120, 420, .5 * ap(lt, 1.2), { label: '调用', c: C.teal, al: want });
    }
    // 裂缝：两个循环套不进一个线程
    if (crack > 0) {
      const pts = [[742, 380], [760, 450], [736, 520], [768, 600], [744, 680], [762, 790]];
      path(g, partial(pts, crack), { c: C.red, w: 6 });
      path(g, partial(pts.map(p => [p[0] + 8, p[1] + 4]), crack), { c: rgba(C.red, .35), w: 3 });
    }
    if (lt > 12.4) icCross(g, 752, 330, 44, C.red, eo(seg(lt, 12.6, 13.0)), 8);
    if (lt > 14.6) qmark(g, 752, 250, 1.3, seg(lt, 14.9, 15.3), lt);
  },
});

/* ---------------- 片名 ---------------- */
S('s02', {
  title: true, fi: .3,
  cues: [[.15, 'whoosh'], [1.7, 'whoosh', .8], [3.1, 'stamp']],
  draw(g, lt) {
    const title = 'JSRuntime 用 ubus 转发消息', o = { s: 100, w: 900 };
    const chars = Array.from(title), total = textW(g, title, o);
    let x = 960 - total / 2;
    chars.forEach((ch, i) => {
      const w = textW(g, ch, o), p = seg(lt, .15 + i * .04, .5 + i * .04);
      at(g, x + w / 2, 380 + (1 - eo(p)) * -60, 1.4 - .4 * pop(p), () => text(g, ch, 0, 0, { ...o, c: /[A-Za-z]/.test(ch) ? (i < 9 ? C.teal : C.brick) : C.ink }), { al: eo(p) });
      x += w;
    });
    const y0 = 600;
    ground(g, 690, fa(lt, .4));
    postOffice(g, 230, 690, .4 * ap(lt, .5), { role: 'js', ang: lt * SPIN });
    postOffice(g, 1690, 690, .4 * ap(lt, .7), { role: 'ubus', ang: lt * SPIN + 1 });
    const tp = [[306, y0], [1614, y0]];
    tube(g, tp, { p: eo(seg(lt, .8, 1.6)), w: 30 });
    if (lt > 1.6) ride(g, tp, lt, 1.7, 1.0, 'INVOKE', { s: .8 });
    if (lt > 2.9) ride(g, [[1614, y0], [306, y0]], lt, 3.6, 1.0, 'DATA', { s: .8 });
    stampMark(g, 960, 480, '两个事件循环，一套气动管道', C.brick, seg(lt, 3.0, 3.35), { fs: 44, rot: -.03 });
    ripple(g, 960, 480, lt - 3.35, C.brick, 200, 420, .8);
  },
});

/* =====================================================================
 * 第一章：为什么不只用一个循环
 * ===================================================================== */
S('s03', {
  card: 2,
  cam: [[0, 960, 540, 1], [16.7, 960, 556, 1.04]],
  cues: [[0, 'whoosh'], [2.3, 'latch', .6], [5.5, 'latch'], [9.2, 'error', .6], [9.8, 'error', .6], [10.4, 'error', .6], [11.0, 'error', .6], [13.0, 'stamp']],
  draw(g, lt) {
    const bx = 700, by = 860, s = 1.45, cx = bx, cy = by - 318 * s;
    const lift = eo(seg(lt, 5.4, 6.6)) * (1 - eo(seg(lt, 12.6, 13.2))) * 60, taut = clamp(lift / 60);
    ground(g, by);
    postOffice(g, bx, by, s, { role: 'ubus', ang: lt * SPIN, lit: 1 });
    // libubus 齿轮组
    const gx = 1330, gy = 560;
    card(g, gx - 150, gy - 130, 300, 260, { r: 16, fill: C.brickL, lw: 3.5, sb: 22 });
    text(g, 'libubus', gx, gy - 92, { f: 'mono', s: 30, w: 700, c: C.brickD });
    const shake = taut * Math.sin(lt * 40) * 4;
    for (const [ox, oy, r, d] of [[-50, 20, 52, 1], [50, 50, 40, -1.3], [10, 96, 26, 2]]) {
      g.save(); g.translate(gx + ox + shake, gy + oy); g.rotate(lt * d * (1 - taut * .9));
      for (let i = 0; i < 10; i++) { g.rotate(TAU / 10); rr(g, -7, -r - 10, 14, 14, 3); g.fillStyle = C.brass; g.fill(); }
      dot(g, 0, 0, r, C.brass); ring(g, 0, 0, r, C.ink, 3); dot(g, 0, 0, r * .3, C.brassD); g.restore();
    }
    // 钟和齿轮组之间的线束
    for (let i = 0; i < 6; i++) {
      const a = [cx + 30, cy - 10 + i * 8 - lift], b = [gx - 150, gy - 70 + i * 26], m = [lerp(a[0], b[0], .5), lerp(a[1], b[1], .5) + 70 * (1 - taut)];
      const pts = []; for (let k = 0; k <= 16; k++) pts.push(bez(a, m, b, k / 16));
      path(g, pts, { c: taut > .8 ? C.red : [C.brickD, C.ink2, C.brass][i % 3], w: 4 });
    }
    plate(g, 'uloop', cx - 120, cy, { c: C.brickD });
    // 吊钩：抓住 uloop 钟往上提
    if (lt > 5.2) { const hy = cy - 60 - lift; path(g, [[cx, -40], [cx, hy]], { c: C.ink, w: 4 }); ring(g, cx, hy + 10, 12, C.ink, 5, 1, 0, Math.PI * 1.4); }
    // 吊钩：送来 libuv 钟
    const dIn = eo(seg(lt, 2.2, 3.4)), dOut = eo(seg(lt, 12.8, 14.0)), ly = lerp(-120, 300, dIn) - dOut * 460, lx = cx - 300;
    if (lt > 2.0) {
      path(g, [[lx, -40], [lx, ly - 52]], { c: C.ink, w: 4 }); ring(g, lx, ly - 42, 12, C.ink, 5, 1, 0, Math.PI * 1.4);
      clockFace(g, lx, ly + wob(lt, .7, 4), 52, lt * SPIN, { rim: C.teal });
      plate(g, 'libuv', lx, ly + 90, { c: C.tealD });
      if (lt > 5.4 && lt < 12.8) arrow(g, [[lx + 70, ly], [cx - 80, cy - lift]], { p: eo(seg(lt, 5.6, 6.4)), c: C.teal, w: 4, dash: [10, 8], hs: 16 });
    }
    // 裂纹标签：改 libubus
    const cracks = [[1180, 330, 9.2], [1480, 400, 9.8], [1220, 760, 10.4], [1500, 720, 11.0]];
    cracks.forEach(([x, y, t0], i) => {
      if (lt < t0) return;
      path(g, partial([[x - 30, y - 20], [x - 8, y + 4], [x - 22, y + 18], [x + 6, y + 40]], eo(seg(lt, t0, t0 + .3))), { c: C.red, w: 4 });
      tag(g, '改 libubus', x + 70, y, C.red, seg(lt, t0 + .1, t0 + .5), { fs: 24, rot: (i % 2 ? .05 : -.05) });
    });
    stampMark(g, 1020, 300, '不划算', C.red, seg(lt, 13.0, 13.35), { fs: 64 });
    ripple(g, 1020, 300, lt - 13.35, C.red, 90, 220, .7);
    burst(g, 1020, 300, lt - 13.35, C.red, 14, 160);
  },
});

S('s04', {
  cam: [[0, 900, 560, 1], [9, 1000, 560, 1.04], [18.1, 1040, 556, 1.06]],
  cues: [[.6, 'whoosh'], [5.2, 'success', .5], [9.2, 'tick'], [9.8, 'tick'], [10.4, 'tick'], [11.0, 'tick'], [11.6, 'tick'], [12.2, 'tick'], [13.6, 'stamp']],
  draw(g, lt) {
    ground(g, 800);
    postOffice(g, 300, 800, .85, { role: 'js', ang: lt * SPIN });
    postOffice(g, 860, 800, .72, { role: 'ubus', lit: 0, ang: 1.1, al: .45 });
    hub(g, 1560, 800, .9, lt, { busy: fa(lt, 9) * fo(lt, 14) });
    const route = [[420, 836], [700, 862], [1040, 862], [1360, 836]];
    routeDash(g, route, eo(seg(lt, .4, 1.4)), { c: rgba(C.teal, .8), w: 5, off: -lt * 30 });
    if (lt > 1.2) tag(g, '绕开 libubus', 860, 560, C.teal, seg(lt, 1.4, 1.8), { fs: 26, al: fo(lt, 8.6) });
    const u = eio(seg(lt, .8, 4.2)), p = polyAt(route, u);
    clerk(g, p[0] - 140, p[1] - 4, .62, { c: C.teal, pose: u < 1 ? 'walk' : 'stand', ph: lt * 1.8, face: lt > 13.2 ? 'confused' : 'open' });
    mailCart(g, p[0] - 30, p[1], .8, lt, { roll: u * 900 });
    if (lt > 4.9) tag(g, '省一个线程', 300, 250, C.green, seg(lt, 5.1, 5.5), { fs: 30 });
    if (lt > 5.3) { icCross(g, 860, 640, 60, C.grey, eo(seg(lt, 5.4, 5.8)), 8); }
    // 一张张要自己写的表
    const FORMS = ['header 序列化', 'header 反序列化', '请求记录', '请求匹配', '消息处理', 'corner case'];
    const wobble = Math.sin(lt * 3.2) * .03 * fa(lt, 12.6);
    g.save(); g.translate(1240, 790); g.rotate(wobble); g.translate(-1240, -790);
    FORMS.forEach((f, i) => {
      const t0 = 9.2 + i * .6; if (lt < t0) return;
      const k = eo(seg(lt, t0, t0 + .45)), sq = lt - t0 - .45, a = [1500, 640], b = [1240 + (hash(i) - .5) * 30, 740 - i * 62];
      const pp = bez(a, [lerp(a[0], b[0], .5), Math.min(a[1], b[1]) - 160], b, k);
      const ss = sq > 0 && sq < .25 ? 1 + Math.sin(sq / .25 * Math.PI) * .08 : 1;
      formSheet(g, pp[0], pp[1], .92, f, { rot: (hash(i * 3) - .5) * .12 + (1 - k) * .6, f: /[a-z]/.test(f) ? 'mono' : 'cjk' });
      if (ss !== 1) ripple(g, b[0], b[1] + 30, sq, C.brass, 30, 110, .4);
    });
    g.restore();
    if (lt > 13.2) for (let i = 0; i < 3; i++) qmark(g, 1010 + i * 50, 640 - i * 40, .55, seg(lt, 13.3 + i * .15, 13.7 + i * .15), lt, i);
    stampMark(g, 760, 320, '工作量太大', C.red, seg(lt, 13.6, 13.95), { fs: 60 });
    ripple(g, 760, 320, lt - 13.95, C.red, 120, 260, .7);
  },
});

/* 两座邮局 + 两根管道（第一、二章共用的“桥”） */
const BR = { js: [430, 760], ub: [1490, 760], s: .95 };
const TUBE_UP = [[610, 580], [690, 580], [740, 540], [1180, 540], [1230, 580], [1310, 580]];
const TUBE_DN = [[1310, 690], [1230, 690], [1180, 730], [740, 730], [690, 690], [610, 690]];
function bridge(g, lt, o = {}) {
  ground(g, BR.js[1]);
  postOffice(g, BR.js[0], BR.js[1], BR.s, { role: 'js', ang: lt * SPIN, arc: .5 });
  postOffice(g, BR.ub[0], BR.ub[1], BR.s, { role: 'ubus', lit: o.ubLit ?? 1, ang: o.ubAng ?? lt * SPIN + 1.3, arc: o.ubLit ?? 1 ? .5 : 0 });
  const tp = o.tubes ?? 1;
  if (tp > 0) {
    tube(g, TUBE_UP, { p: o.tpUp ?? tp, flow: 1, t: lt });
    tube(g, TUBE_DN, { p: o.tpDn ?? tp, flow: 1, t: lt });
    if ((o.tpUp ?? tp) > .9) plate(g, 'to_ubus', 960, 486, { al: o.labA ?? 1 });
    if ((o.tpDn ?? tp) > .9) plate(g, 'to_js', 960, 786, { al: o.labA ?? 1 });
  }
}

S('s05', {
  cam: [[0, 960, 520, 1.02], [17.4, 960, 530, 1]],
  cues: [[.8, 'success', .7], [1.9, 'blip'], [6.4, 'latch'], [7.2, 'latch'], [9.4, 'tick'], [13.0, 'tick'], [14.2, 'success']],
  draw(g, lt) {
    const lit = eo(seg(lt, .8, 1.6));
    bridge(g, lt, { ubLit: lit, ubAng: lt < 1.6 ? 1.3 : (lt - 1.6) * SPIN + 1.3, tpUp: eo(seg(lt, 5.8, 6.6)), tpDn: eo(seg(lt, 6.6, 7.4)), tubes: lt > 5.8 ? 1 : 0 });
    // 两位柜员
    clerk(g, BR.js[0] + 130, 818, .62, { c: C.teal, pose: 'stand' });
    plate(g, 'JS 线程', BR.js[0] + 130, 852, { fs: 24, f: 'cjk', c: C.tealD });
    if (lt > 1.8) {
      const k = ap(lt, 1.8, .6);
      clerk(g, BR.ub[0] - 130, 818, .62 * k, { c: C.brick, pose: lt < 4 ? 'wave' : 'stand', ph: lt * .9 });
      plate(g, 'ubus 线程', BR.ub[0] - 130, 852, { fs: 24, f: 'cjk', c: C.brickD, s: k });
      tag(g, '+1 线程', BR.ub[0] - 130, 640, C.brick, seg(lt, 2.2, 2.6), { fs: 26, al: fo(lt, 8.6) });
    }
    if (lt > 4.7) plate(g, 'libuv', BR.js[0] + 112, BR.js[1] - 312, { s: ap(lt, 4.8), c: C.tealD });
    if (lt > 5.3) plate(g, 'uloop', BR.ub[0] + 112, BR.ub[1] - 312, { s: ap(lt, 5.4), c: C.brickD });
    // 管道接通的铆钉闪光
    for (const [x, y, t0] of [[610, 580, 6.4], [1310, 690, 7.2]]) ripple(g, x, y, lt - t0, C.brass, 20, 80, .6);
    if (lt > 7.4) { ride(g, TUBE_UP, lt, 7.6 + Math.floor((lt - 7.6) / 2.6) * 2.6, 1.4, 'INVOKE', { s: .7, ripple: false }); ride(g, TUBE_DN, lt, 8.9 + Math.floor((lt - 8.9) / 2.6) * 2.6, 1.4, 'DATA', { s: .7, ripple: false }); }
    // 天平：代价 vs 收益
    if (lt > 9.1) {
      const sp = lt < 12.9 ? -.12 * spring(lt - 9.2, 4, 1.2) : lerp(-.12, .14, spring(lt - 12.9, 4, 1.2));
      const R = lt > 12.8 ? ['两个库', '只改一点'] : ['', ''];
      g.save(); g.globalAlpha *= fa(lt, 9.1);
      balance(g, 960, 450, sp, ['多 1 个线程', '+ 2 条队列'], R);
      g.restore();
      if (lt > 14.0) badge(g, 1260, 200, 30, C.green, 'check', seg(lt, 14.2, 14.6));
    }
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  g.save(); g.translate(0, 150);
  bridge(g, 2.2, {});
  clerk(g, BR.js[0] + 130, 818, .62, { c: C.teal, pose: 'wave', ph: .2 });
  clerk(g, BR.ub[0] - 130, 818, .62, { c: C.brick, pose: 'wave', ph: .6 });
  capsule(g, 900, 540, 'INVOKE', { seq: '#7', s: .8, glow: .5 }); capsule(g, 1040, 730, 'DATA', { seq: '#7', s: .8, glow: .5 });
  deskBell(g, 1320, 470, .8, .15);
  g.restore();
  text(g, '改不起库，就加一个线程', 960, 170, { s: 128, w: 900 });
  text(g, 'JSRuntime 用 ubus 转发消息 · 五个“为什么不”', 960, 300, { s: 46, w: 900, c: C.teal });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
