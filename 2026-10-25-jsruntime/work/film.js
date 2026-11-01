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
    text(g, '邮车', 0, -60, { s: 32, w: 900, c: C.tealD });
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
    if (lt > 9.0) plate(g, '要有人跑 uloop', OU[0], 712, { fs: 24, f: 'cjk', s: ap(lt, 9.4), rot: -.04, fill: C.amberL });
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
    const y0 = 740;
    ground(g, 850, fa(lt, .4));
    postOffice(g, 300, 850, .75 * ap(lt, .5), { role: 'js', ang: lt * SPIN });
    postOffice(g, 1620, 850, .75 * ap(lt, .7), { role: 'ubus', ang: lt * SPIN + 1 });
    const tp = [[442, y0], [1478, y0]];
    tube(g, tp, { p: eo(seg(lt, .8, 1.6)), w: 34 });
    if (lt > 1.6) ride(g, tp, lt, 1.7, 1.0, 'INVOKE', { s: .85 });
    if (lt > 2.9) ride(g, [[1478, y0], [442, y0]], lt, 3.6, 1.0, 'DATA', { s: .85 });
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
      formSheet(g, pp[0], pp[1], 1.0, f, { rot: (hash(i * 3) - .5) * .12 + (1 - k) * .6, f: /[a-z]/.test(f) ? 'mono' : 'cjk' });
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
    if ((o.tpUp ?? tp) > .9) plate(g, 'to_ubus', 960, 598, { al: o.labA ?? 1 });
    if ((o.tpDn ?? tp) > .9) plate(g, 'to_js', 960, 674, { al: o.labA ?? 1 });
  }
}

S('s05', {
  cam: [[0, 960, 520, 1.02], [17.4, 960, 530, 1]],
  cues: [[.8, 'success', .7], [1.9, 'blip'], [6.4, 'latch'], [7.2, 'latch'], [9.4, 'tick'], [13.0, 'tick'], [14.2, 'success']],
  draw(g, lt) {
    const lit = eo(seg(lt, .8, 1.6));
    bridge(g, lt, { ubLit: lit, ubAng: lt < 1.6 ? 1.3 : (lt - 1.6) * SPIN + 1.3, tpUp: eo(seg(lt, 5.8, 6.6)), tpDn: eo(seg(lt, 6.6, 7.4)), tubes: lt > 5.8 ? 1 : 0 });
    // 两位柜员
    clerk(g, BR.js[0] + 130, 806, .62, { c: C.teal, pose: 'stand' });
    plate(g, 'JS 线程', BR.js[0] + 130, 836, { fs: 24, f: 'cjk', c: C.tealD });
    if (lt > 1.8) {
      const k = ap(lt, 1.8, .6);
      clerk(g, BR.ub[0] - 130, 806, .62 * k, { c: C.brick, pose: lt < 4 ? 'wave' : 'stand', ph: lt * .9 });
      plate(g, 'ubus 线程', BR.ub[0] - 130, 836, { fs: 24, f: 'cjk', c: C.brickD, s: k });
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

/* =====================================================================
 * 第二章：为什么不直接调用
 * ===================================================================== */
S('s06', {
  card: 3,
  cam: [[0, 960, 540, 1], [21.8, 960, 548, 1.02]],
  cues: [[0, 'whoosh'], [2.4, 'tick', .5], [4.4, 'error'], [6.0, 'blip', .6], [10.6, 'whoosh', .6], [14.2, 'latch'], [14.8, 'latch'], [16.9, 'blip'], [17.3, 'blip'], [18.4, 'latch', .7]],
  draw(g, lt) {
    const tp = lt > 13.6 ? 1 : 0;
    bridge(g, lt, { tubes: tp, tpUp: eo(seg(lt, 13.7, 14.5)), tpDn: eo(seg(lt, 14.2, 15.0)), labA: fa(lt, 15.0) });
    // 领地虚线框
    const zone = fa(lt, 10.4, .6);
    if (zone > 0) {
      g.save(); g.globalAlpha *= zone;
      rr(g, 200, 330, 470, 560, 26); g.setLineDash([12, 10]); g.lineWidth = 4; g.strokeStyle = rgba(C.teal, .8); g.stroke();
      rr(g, 1250, 330, 470, 560, 26); g.strokeStyle = rgba(C.brick, .8); g.stroke(); g.setLineDash([]);
      g.restore();
      tag(g, '只归 JS 线程', 435, 320, C.teal, seg(lt, 10.6, 11.0), { fs: 26 });
      tag(g, '只归 ubus 线程', 1485, 320, C.brick, seg(lt, 10.9, 11.3), { fs: 26 });
    }
    // 两根拉杆：QuickJS / libubus
    const back = eo(seg(lt, 10.4, 11.4));
    const qx = lerp(820, 560, back), ux = lerp(1100, 1360, back);
    lever(g, qx, 870, 1.05, -.3 + Math.sin(lt * 2) * .05, 'QuickJS', C.teal, { l: C.tealL });
    lever(g, ux, 870, 1.05, .3 - Math.sin(lt * 2) * .05, 'libubus', C.brick);
    // 两位柜员互相伸手去拉对方的拉杆
    const go = eo(seg(lt, 2.2, 3.4)), ret = back;
    const jx = lerp(lerp(600, 1010, go), 470, ret), bx = lerp(lerp(1320, 910, go), 1450, ret);
    const reach = lt > 3.2 && lt < 10.4;
    clerk(g, jx, 850, .9, { c: C.teal, pose: reach ? 'reach' : go > 0 && go < 1 || (ret > 0 && ret < 1) ? 'walk' : 'stand', arm: -2.0 + Math.sin(lt * 30) * .05 * (lt > 4.4 ? 1 : 0), ph: lt * 1.8, face: lt > 4.4 && lt < 10.4 ? 'wow' : 'open' });
    clerk(g, bx, 850, .9, { c: C.brick, pose: reach ? 'reach' : go > 0 && go < 1 || (ret > 0 && ret < 1) ? 'walk' : 'stand', arm: -2.0, dir: -1, ph: lt * 1.8 + .5, face: lt > 4.4 && lt < 10.4 ? 'wow' : 'open' });
    sparks(g, 960, 700, lt - 4.4, 14); sparks(g, 960, 700, lt - 5.0, 10);
    if (lt > 5.8 && lt < 10.6) warnSign(g, 960, 560, 1, '非线程安全', Math.sin(lt * 3) * .06 * fo(lt, 8, 1.5), { al: fa(lt, 5.9) * fo(lt, 10.2) });
    // 加锁的队列
    if (lt > 14.6) padlock(g, 690, 580, .8 * ap(lt, 14.6), clamp((lt - 15.0) / .2));
    if (lt > 15.1) padlock(g, 1230, 690, .8 * ap(lt, 15.1), clamp((lt - 15.5) / .2));
    if (lt > 15.4) { ride(g, TUBE_UP, lt, 15.5 + Math.floor((lt - 15.5) / 2.4) * 2.4, 1.3, 'INVOKE', { s: .7, ripple: false }); ride(g, TUBE_DN, lt, 16.6 + Math.floor((lt - 16.6) / 2.4) * 2.4, 1.3, 'DATA', { s: .7, ripple: false }); }
    // 发起 / 执行拆开
    if (lt > 16.7) {
      tag(g, '发起', 660, 470, C.teal, seg(lt, 16.8, 17.2), { fs: 28 });
      tag(g, '执行', 1250, 470, C.brick, seg(lt, 17.2, 17.6), { fs: 28 });
      const k = seg(lt, 18.2, 18.6);
      at(g, 1170, 400, 1, () => plate(g, k < .5 ? 'ubus_invoke' : 'ubus_invoke_async', 0, 0, { c: C.brickD, fill: k < .5 ? C.paper : C.amberL }), { sy: Math.abs(1 - 2 * k), al: fa(lt, 17.6) });
    }
  },
});

/* ubus 邮局内部（第 7、9 幕共用） */
const UR = { clock: [1000, 300], mouth: [620, 520], basket: [620, 640], pipe: [[120, 450], [1260, 450], [1260, 540]], bell: [1260, 640] };
function ubusRoom(g, lt, o = {}) {
  interior(g, 'ubus', 1, { title: o.title || 'ubus 邮局 · 内部' });
  // 气动管道进墙
  tube(g, [[120, 300], [560, 300], [620, 360], [620, 500]], { w: 34 });
  tubeMouth(g, UR.mouth[0], UR.mouth[1] - 10, TAU / 4);
  plate(g, 'to_ubus', 360, 352, {});
  // 墙上的钟 = 事件循环
  clockFace(g, UR.clock[0], UR.clock[1], 62, o.ang ?? 0, { rim: C.brick, arc: o.arc });
  plate(g, o.clockLab || 'epoll_wait', UR.clock[0], 398, { c: o.sleep ? C.navy : C.brickD, al: o.clockLabA ?? 1 });
  // pipe 细铜管
  pipeLine(g, UR.pipe);
  plate(g, 'pipe', 820, 412, { fs: 24, c: C.copper });
  if (o.cup) { rr(g, 1236, 536, 48, 30, 6); g.fillStyle = C.copper; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); }
}

S('s07', {
  cam: [[0, 960, 520, 1], [6.5, 990, 530, 1.06], [16, 960, 520, 1]],
  cues: [[1.7, 'thunk'], [4.6, 'drop'], [6.6, 'ding'], [6.8, 'blip', .5], [8.7, 'whoosh'], [11.8, 'blip']],
  draw(g, lt) {
    const awake = lt > 6.75, ang = awake ? (lt - 6.75) * SPIN * 1.4 + .9 : .9;
    ubusRoom(g, lt, { ang, sleep: !awake, arc: awake ? .6 : 0 });
    if (awake) tag(g, 'epoll_wait 返回', 1230, 250, C.green, seg(lt, 6.9, 7.3), { fs: 26, f: 'mono', al: fo(lt, 11.4) });
    // 收件篮与胶囊
    basket(g, UR.basket[0], UR.basket[1]);
    const take = eo(seg(lt, 8.6, 9.4));
    if (lt < 8.6) {}
    else if (take < 1) { const p = bez([620, 612], [760, 440], [880, 560], take); capsule(g, p[0], p[1], 'INVOKE', { s: .7, seq: '#7', al: 1 - take * .6 }); }
    // 柜员：睡 → 惊醒 → 取信
    const wake = lt - 6.75, sq = wake > 0 && wake < .5 ? -Math.sin(wake / .5 * Math.PI) * .12 : 0;
    clerk(g, 900, 770, 1.7, { c: C.brick, pose: awake ? (lt > 8.4 && lt < 9.6 ? 'reach' : 'stand') : 'sleep', arm: 1.9, face: awake ? (wake < 1.2 ? 'wow' : 'open') : 'closed', sq, dir: -1 });
    desk(g, 380, 1540, 640);
    basket(g, UR.basket[0], UR.basket[1]);
    if (lt < 8.6) ride(g, [[620, 480], [620, 612]], lt, 1.1, .6, 'INVOKE', { s: .7, hold: true, seq: '#7', ripple: false });
    if (!awake) zzz(g, 960, 520, lt, fo(lt, 5.6));
    // 铜珠：写 1 字节
    const bk = lt - 6.6;
    deskBell(g, UR.bell[0], UR.bell[1], 1.3, bk);
    if (lt > 4.5 && lt < 6.7) {
      const u = eio(seg(lt, 4.6, 6.6)), p = polyAt(UR.pipe, u);
      for (let i = 1; i <= 6; i++) { const q = polyAt(UR.pipe, eio(seg(lt - i * .03, 4.6, 6.6))); dot(g, q[0], q[1], 12 - i * 1.5, C.brass, .25); }
      bead(g, p[0], p[1], 13);
      text(g, '1 byte', p[0], p[1] + 38, { f: 'mono', s: 24, w: 700, c: C.copper });
    }
    if (lt > 4.3 && lt < 4.7) tag(g, '写 1 字节', 330, 520, C.copper, seg(lt, 4.3, 4.6), { fs: 26 });
    if (lt > 4.6 && lt < 7.8) tag(g, '写 1 字节', 330, 520, C.copper, 1, { fs: 26, al: fo(lt, 7.4) });
    // 思路来源
    if (lt > 11.6) at(g, 1560, 250, ap(lt, 11.7), () => {
      card(g, -190, -70, 380, 140, { r: 14, fill: C.paper, lw: 3, sb: 18 });
      text(g, '参考 libuv 的', 0, -30, { s: 26, w: 700, c: C.ink2 });
      text(g, 'uv_async_send', 0, 22, { f: 'mono', s: 32, w: 700, c: C.teal });
    });
  },
});

S('s08', {
  cam: [[0, 960, 540, 1], [7.0, 960, 540, 1], [8.4, 860, 500, 1.06], [12.1, 860, 500, 1.06]],
  cues: [[.9, 'type'], [2.8, 'whoosh'], [4.8, 'error'], [7.8, 'success', .6]],
  draw(g, lt) {
    interior(g, 'js', 1, { title: 'JS 邮局 · 内部' });
    // 墙板：Promise 票与回调挂钩（留在 JS 这边）
    const keep = fa(lt, 7.6, .5);
    card(g, 200, 250, 640, 220, { r: 14, fill: rgba(C.wood, .25), lw: 3, stroke: C.wood, shadow: false });
    ticket(g, 380, 360, 'pending', { s: .9, lt });
    at(g, 670, 360, 1, () => { ring(g, 0, -40, 14, C.teal, 5); path(g, [[0, -26], [0, 0]], { c: C.teal, w: 5 }); plate(g, 'status_change', 0, 34, { fs: 24, c: C.tealD }); });
    if (keep > 0) { g.save(); g.globalAlpha *= keep; rr(g, 190, 240, 660, 240, 18); g.lineWidth = 5; g.strokeStyle = C.green; g.stroke(); g.restore(); tag(g, '留在 JS 线程', 620, 240, C.green, seg(lt, 7.8, 8.2), { fs: 26 }); }
    // 管道口 + 闸门
    tube(g, [[1500, 560], [1800, 560]], { w: 40 });
    tubeMouth(g, 1500, 560, Math.PI);
    plate(g, 'to_ubus', 1650, 500, {});
    const gate = lt > 4.3 ? eo(seg(lt, 4.3, 4.6)) : 0;
    if (gate > 0) { rr(g, 1452, 560 - 70 + (1 - gate) * -60, 22, 140, 6); g.fillStyle = C.red; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); }
    desk(g, 260, 1660, 640);
    // 复印机：参数 → TLV 字节副本
    const cx = 900, cy = 560;
    card(g, cx - 130, cy - 70, 260, 150, { r: 14, fill: C.greyL, lw: 3.5, sb: 14 });
    rr(g, cx - 110, cy - 90, 220, 26, 8); g.fillStyle = C.grey; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    text(g, '复印机', cx, cy + 10, { s: 26, w: 900, c: C.ink2 });
    const scan = seg(lt, .9, 2.0);
    if (scan > 0 && scan < 1) { g.save(); g.globalAlpha *= .8; rr(g, cx - 110 + scan * 200, cy - 64, 20, 50, 6); g.fillStyle = '#C9F2FF'; g.fill(); g.restore(); }
    // 参数卡进复印机
    const inK = eo(seg(lt, .4, .9));
    if (lt < 2.0) at(g, lerp(560, cx - 40, inK), lerp(560, cy - 40, inK), 1 - inK * .4, () => { card(g, -130, -32, 260, 64, { r: 10, fill: C.paper, lw: 2.5 }); codeLine(g, 'hello(123, "test")', -116, 0, 24); }, { al: 1 - seg(lt, 1.6, 2.0) });
    // 字节纸带吐出 → 卷成胶囊 → 进管道
    const outK = eo(seg(lt, 1.8, 2.5)), roll = seg(lt, 2.7, 3.0);
    if (lt > 1.8 && roll < 1) {
      g.save(); g.globalAlpha *= 1 - roll;
      const x0 = cx + 140, w2 = 330 * outK;
      rr(g, x0, cy - 24, w2, 48, 6); g.fillStyle = '#FFFCF4'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
      g.save(); rr(g, x0, cy - 24, w2, 48, 6); g.clip();
      [['T', C.purple], ['L', C.amber], ['123', C.ink], ['T', C.purple], ['L', C.amber], ['test', C.brick]].forEach(([t2, c], i) => { text(g, t2, x0 + 26 + i * 54, cy + 1, { f: 'mono', s: 24, w: 700, c }); path(g, [[x0 + 52 + i * 54, cy - 24], [x0 + 52 + i * 54, cy + 24]], { c: rgba(C.ink, .3), w: 2 }); });
      g.restore(); g.restore();
    }
    if (lt > 2.0 && lt < 4.1) tag(g, 'blob 副本', 1200, 470, C.purple, seg(lt, 2.1, 2.5), { fs: 26, al: fo(lt, 3.8) });
    if (lt > 1.0 && lt < 4.1) tag(g, 'C 结构体', 760, 440, C.ink2, seg(lt, 1.1, 1.5), { fs: 26, al: fo(lt, 3.8) });
    if (lt > 2.8) ride(g, [[1200, 560], [1500, 560], [1800, 560]], lt, 2.8, .9, 'INVOKE', { s: .7, ripple: false });
    // JSValue 包裹想进管道，被闸门挡回
    if (lt > 3.9) {
      const go2 = eo(seg(lt, 4.0, 4.4)), bounce = lt > 4.5 ? spring(lt - 4.5, 5, 1.3) : 0;
      const x = lerp(1180, 1390, go2) - bounce * 210;
      at(g, x, 576, ap(lt, 3.9), () => {
        g.save(); g.shadowColor = rgba(C.teal, .8); g.shadowBlur = 30 * SH(); rr(g, -86, -52, 172, 104, 14); g.fillStyle = C.tealL; g.fill(); g.restore();
        card(g, -86, -52, 172, 104, { r: 14, fill: C.tealL, lw: 3.5, stroke: C.teal, shadow: false });
        path(g, [[-86, -6], [86, -6]], { c: C.teal, w: 3 }); path(g, [[0, -52], [0, 52]], { c: C.teal, w: 3 });
        plate(g, 'JSValue', 0, 26, { fs: 24, c: C.tealD });
        plate(g, 'ref 2', 60, -58, { fs: 24, c: C.ink2 });
      });
      if (lt > 4.5) icCross(g, 1440, 450, 50, C.red, eo(seg(lt, 4.6, 5.0)), 8);
    }
  },
});

S('s09', {
  cam: [[0, 960, 520, 1], [17.5, 960, 520, 1]],
  cues: [[1.2, 'tick'], [2.0, 'tick'], [3.0, 'blip'], [6.0, 'tick'], [7.2, 'error'], [10.2, 'thunk', .6], [10.8, 'thunk', .6], [11.4, 'thunk', .6], [13.4, 'latch'], [14.0, 'latch'], [14.6, 'blip'], [15.2, 'success']],
  draw(g, lt) {
    const stuck = lt > 7.2 && lt < 14.8, grey = eo(seg(lt, 9.9, 10.8)) * (1 - eo(seg(lt, 14.8, 15.6))), frz = eo(seg(lt, 10.4, 11.6)) * (1 - eo(seg(lt, 14.8, 15.6)));
    const run = lt < 7.2 ? lt * SPIN : lt < 15 ? 7.2 * SPIN : 7.2 * SPIN + (lt - 15) * SPIN;
    ubusRoom(g, lt, { ang: run, arc: stuck ? 0 : .6, title: 'ubus 邮局 · demo 复刻', cup: true, clockLab: stuck ? 'read() 阻塞' : 'uloop', clockLabA: 1 });
    // 读结果的小卡片序列（右上）
    const reads = lt < 5.5 ? [[1.2, 'read → 1 byte', C.green], [2.0, 'read → 1 byte', C.green], [3.0, 'read → EAGAIN', C.teal]]
      : lt < 13.1 ? [[6.0, 'read → 1 byte', C.green], [7.2, 'read → …… 卡住', C.red]]
        : [[6.0, 'read → 1 byte', C.green], [7.2, 'read → …… 卡住', C.red], [14.6, 'read → EAGAIN', C.teal]];
    const base = lt < 5.5 ? 0 : 5.5;
    reads.forEach(([t0, s, c], i) => {
      if (lt < t0) return;
      const y = 200 + i * 62, k = ap(lt, t0, .4), al = fo(lt, base === 0 ? 5.2 : 99);
      at(g, 1560, y, k, () => plate(g, s, 0, 0, { fs: 26, c, stroke: c, fill: i === 1 && base ? C.redL : C.paper }), { al });
    });
    if (lt > 14.6) icCross(g, 1700, 262, 30, C.red, 1, 6);
    // 收件篮：卡死期间胶囊越堆越多
    basket(g, UR.basket[0], UR.basket[1]);
    // 柜员：伸手掏铜珠
    const reachOn = (lt > .9 && lt < 3.4) || (lt > 5.8 && lt < 14.8);
    clerk(g, 1160, 770, 1.7, { c: C.brick, pose: reachOn ? 'reach' : 'stand', arm: -2.6 + (stuck ? Math.sin(lt * 26) * .04 : 0), face: stuck ? 'wow' : 'open', dir: 1 });
    desk(g, 380, 1540, 640);
    basket(g, UR.basket[0], UR.basket[1]);
    const caps2 = [[10.2, 0], [10.8, 1], [11.4, 2]];
    caps2.forEach(([t0, i]) => { if (lt > t0 && lt < 16.2) ride(g, [[620, 480], [620, 612 - i * 26]], lt, t0, .5, 'INVOKE', { s: .62, hold: true, ripple: i === 0, al: fo(lt, 15.8) }); });
    // 铜珠从出口落进小碟
    rr(g, 1210, 610, 100, 28, 10); g.fillStyle = C.copper; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    for (const t0 of [1.2, 2.0, 6.0]) { const k = seg(lt, t0 - .3, t0); if (lt > t0 - .3 && lt < (t0 < 5 ? 5.5 : 99)) bead(g, 1236 + (t0 % 1.3) * 40, lerp(566, 604, eo(k)), 11, t0 < 5 ? fo(lt, 5.2) : 1); }
    // 卡住：手伸在出口里
    if (stuck) { at(g, 1262, 560, 1, () => { ring(g, 0, 0, 34 + Math.sin(lt * 8) * 3, C.red, 4, .8); }); }
    // 冻结
    if (grey > 0) { g.save(); g.globalAlpha *= grey * .38; rr(g, 120, 150, 1680, 700, 30); g.fillStyle = '#7E8B98'; g.fill(); g.restore(); }
    if (frz > 0) { frost(g, 700, 400, 380, frz); frost(g, 1300, 500, 300, frz); }
    if (lt > 11.0 && lt < 15.0) stampMark(g, 760, 260, '永久卡死', C.red, seg(lt, 11.0, 11.35), { fs: 52, al: fo(lt, 14.6) });
    // 修法：两端拧上 O_NONBLOCK 阀门
    for (const [x, y, t0, lab, ly] of [[160, 450, 13.4, 'O_NONBLOCK', 404], [1260, 510, 14.0, 'O_NONBLOCK', 470]]) {
      if (lt < t0) continue;
      at(g, x, y, ap(lt, t0), () => { g.rotate(seg(lt, t0, t0 + .5) * TAU / 3); g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.lineTo(Math.cos(a) * 22, Math.sin(a) * 22); } g.closePath(); g.fillStyle = C.brass; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); dot(g, 0, 0, 7, C.ink); });
      plate(g, lab, x + (x < 600 ? 120 : -140), ly, { fs: 24, s: ap(lt, t0 + .1), c: C.teal, stroke: C.teal });
    }
  },
});

/* =====================================================================
 * 第三章：为什么不等回信
 * ===================================================================== */
const JC = { board: [1360, 250, 400, 500], slot: [[1560, 330], [1560, 490], [1560, 650]], tubeX: 1100, basket: [1100, 640], cust: [430, 470] };
function jsCounter(g, lt, o = {}) {
  interior(g, 'js', 1, { title: 'JS 邮局 · 柜台' });
  const [bx, by, bw, bh] = JC.board;
  corkBoard(g, bx, by, bw, bh, 'invokeMsgCollection');
  stub(g, JC.slot[0][0], JC.slot[0][1], '#5', { al: .55, rot: -.02 });
  stub(g, JC.slot[1][0], JC.slot[1][1], '#6', { al: .55, rot: .02 });
  tube(g, [[JC.tubeX, 150], [JC.tubeX, 440]], { w: 34 });
  tubeMouth(g, JC.tubeX, 440, TAU / 4);
  plate(g, o.tubeLab || 'to_ubus', JC.tubeX - 120, 300, {});
}
S('s10', {
  card: 4,
  cam: [[0, 960, 540, 1], [13.4, 960, 540, 1], [14.6, 1450, 500, 1.3], [18.1, 1460, 500, 1.32]],
  cues: [[0, 'whoosh'], [3.3, 'whoosh', .6], [6.0, 'error', .7], [9.8, 'stamp'], [10.5, 'tear'], [11.7, 'blip', .6], [12.5, 'whoosh'], [14.0, 'blip'], [14.8, 'blip'], [15.6, 'blip']],
  draw(g, lt) {
    jsCounter(g, lt);
    codeCard(g, 170, 280, 520, ['simpleTest.hello(123, "test")'], { title: 'JS 代码', p: seg(lt, 2.0, 3.0) });
    clerk(g, 760, 790, 1.6, { c: C.teal, pose: lt > 9.5 && lt < 10.8 ? 'reach' : 'stand', arm: -1.0 });
    desk(g, 240, 1240, 640);
    basket(g, JC.basket[0], JC.basket[1]);
    // 信从顾客到柜台
    const env = eo(seg(lt, 3.2, 4.0)), toCap = seg(lt, 12.2, 12.4);
    if (lt > 3.1 && toCap < 1) { const p = bez([430, 380], [560, 360], [700, 600], env); envelope(g, p[0], p[1], .7 * (1 - toCap), { label: 'hello', c: C.teal }); }
    if (lt > 9.7) stampMark(g, 640, 556, '#7', C.red, seg(lt, 9.7, 10.0), { fs: 36, al: fo(lt, 12.2, .2) });
    // 存根撕下飞上墙板
    if (lt > 10.4) {
      const k = eo(seg(lt, 10.5, 11.4)), p = bez([760, 560], [1200, 360], JC.slot[2], k);
      stub(g, p[0], p[1], '#7', { s: lerp(.6, 1, k), rot: (1 - k) * -.4, glow: lt > 13.6 ? .4 + .4 * Math.sin(lt * 5) : 0 });
    }
    // Promise 票交给顾客
    if (lt > 11.5) { const k = eo(seg(lt, 11.6, 12.2)); ticket(g, lerp(760, JC.cust[0], k), lerp(600, JC.cust[1], k), 'pending', { s: .85, lt }); }
    // 胶囊上管道
    if (lt > 12.3) ride(g, [[720, 600], [1100, 600], [1100, 430], [1100, 140]], lt, 12.4, 1.0, 'INVOKE', { s: .7, seq: '#7', ripple: false });
    // 存根上的三样东西
    for (const [t0, x, y, r] of [[14.0, 1508, 298, 34], [14.8, 1530, 660, 60], [15.6, 1520, 694, 56]]) if (lt > t0) ring(g, x, y, r, C.amber, 5, fa(lt, t0, .3) * (.6 + .4 * Math.sin(lt * 6)));
    // 假设：干等（左下小窗）
    const ins = fa(lt, 5.9, .4) * fo(lt, 9.1, .4);
    if (ins > 0) {
      g.save(); g.globalAlpha *= ins;
      card(g, 170, 430, 560, 330, { r: 18, fill: C.paper, lw: 3.5, stroke: C.amber, sb: 30, so: 12 });
      clerk(g, 330, 700, .9, { c: C.teal, pose: 'stand', face: 'closed' });
      clockFace(g, 560, 540, 44, 1.2, { rim: C.teal });
      icCross(g, 560, 540, 50, C.red, eo(seg(lt, 6.4, 6.8)), 7);
      const n = Math.floor(clamp((lt - 6.2) / .45, 0, 6));
      for (let i = 0; i < n; i++) { rr(g, 450 + (i % 3) * 82, 610 + Math.floor(i / 3) * 56, 70, 44, 8); g.fillStyle = C.redL; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.red; g.stroke(); }
      text(g, '事件排队', 572, 740, { s: 24, w: 700, c: C.red });
      g.restore();
      tag(g, '假设：干等', 450, 430, C.amber, seg(lt, 6.0, 6.4), { fs: 26, tc: C.ink, al: ins });
    }
  },
});

S('s11', {
  cam: [[0, 960, 540, 1], [15.7, 960, 540, 1]],
  cues: [[1.3, 'thunk'], [2.7, 'thunk', .7], [4.3, 'blip'], [8.0, 'success'], [8.6, 'tick'], [11.8, 'shred'], [12.8, 'blip', .5]],
  draw(g, lt) {
    jsCounter(g, lt, { tubeLab: 'to_js' });
    const off = eo(seg(lt, 11.5, 12.3));
    if (off < 1) { const p = bez(JC.slot[2], [1700, 700], [1580, 790], off); stub(g, p[0], p[1], '#7', { s: 1 - off * .4, state: lt > 8.0 ? 'ok' : 'wait', glow: lt > 4.6 && lt < 9 ? .7 : 0, rot: off * .5 }); }
    codeCard(g, 170, 270, 560, ['const r = await', '  simpleTest.hello(123, "test");', 'show(r);'], { title: 'JS 代码', hl: lt < 9.2 ? [0, 1] : 2, hk: 1 });
    if (lt > 9.2) arrow(g, [[150, 340], [150, 430]], { p: eo(seg(lt, 9.2, 9.6)), c: C.green, w: 5, hs: 14 });
    const flip = seg(lt, 8.4, 8.8), st = flip < .5 ? 'pending' : 'ok';
    ticket(g, JC.cust[0], JC.cust[1] + 40, st, { s: .85, lt, sy: Math.abs(1 - 2 * flip) || .02 });
    clerk(g, 760, 790, 1.6, { c: C.teal, pose: lt > 3.9 && lt < 5.0 ? 'reach' : 'stand', arm: -1.6 });
    desk(g, 240, 1240, 640);
    basket(g, JC.basket[0], JC.basket[1]);
    ride(g, [[1100, 150], [1100, 440], [1100, 612]], lt, .5, .8, 'DATA', { s: .7, seq: '#7', hold: true, al: fo(lt, 9.6) });
    ride(g, [[1100, 150], [1100, 440], [1100, 560]], lt, 1.9, .8, 'STATUS', { s: .7, seq: '#7', hold: true, al: fo(lt, 13.4) });
    // 对号：DATA #7 ↔ 存根 #7
    const beam = fa(lt, 4.3, .5) * fo(lt, 8.6);
    if (beam > 0) { arrow(g, [[1150, 600], [1300, 520], JC.slot[2]], { p: eo(seg(lt, 4.3, 5.0)), c: C.green, w: 5, dash: [12, 8], al: beam, hs: 16 }); tag(g, '#7 = #7', 1260, 470, C.green, seg(lt, 5.0, 5.4), { fs: 26, f: 'mono', al: beam }); }
    if (lt > 8.0 && lt < 11.4) tag(g, 'resolve', 1480, 800, C.green, seg(lt, 8.0, 8.4), { fs: 26, f: 'mono', al: fo(lt, 11.2) });
    // 碎纸机
    const sx = 1580, sy = 800;
    card(g, sx - 90, sy - 14, 180, 64, { r: 10, fill: C.greyL, lw: 3, sb: 10 });
    rr(g, sx - 60, sy - 18, 120, 8, 3); g.fillStyle = C.ink; g.fill();
    if (lt > 12.2) for (let i = 0; i < 6; i++) { const k = clamp((lt - 12.3 - i * .05) / .8); rr(g, sx - 50 + i * 18, sy + 50, 8, 26 * k, 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke(); }
    if (lt > 12.6) plate(g, 'free(req)', 1380, 806, { s: ap(lt, 12.7), c: C.ink2 });
  },
});

const UO = [470, 780], UH = [1440, 780], US = [1780, 780], ROAD = [[640, 806], [1290, 806]];
function drawer(g, x, y, o = {}) {
  card(g, x - 200, y - 80, 400, 160, { r: 12, fill: C.woodL, lw: 3.5, sb: 18 });
  rr(g, x - 170, y - 50, 340, 100, 8); g.fillStyle = C.wood; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
  plate(g, 'id 缓存', x, y - 98, { fs: 26, f: 'cjk', c: C.brickD });
  if (o.card) {
    at(g, x, y - 6, 1, () => {
      card(g, -150, -30, 300, 60, { r: 8, fill: o.bad ? C.redL : C.paper, lw: 2.5 });
      text(g, 'simple_test → 42', 0, 1, { f: 'mono', s: 26, w: 700, c: o.bad ? C.red : C.ink });
    }, { sy: o.sy ?? 1, al: o.al });
  } else text(g, '（空）', x, y, { s: 26, w: 700, c: rgba('#fff', .85) });
  if (o.flash) { g.save(); g.globalAlpha *= o.flash; rr(g, x - 200, y - 80, 400, 160, 12); g.lineWidth = 6; g.strokeStyle = C.green; g.stroke(); g.restore(); }
}
S('s12', {
  cam: [[0, 960, 520, 1], [16.8, 960, 530, 1.02]],
  cues: [[1.0, 'blip', .6], [4.1, 'whoosh'], [5.4, 'tick', .6], [7.6, 'latch'], [9.6, 'tick'], [11.0, 'tick'], [12.2, 'error', .5], [13.4, 'error'], [13.8, 'stamp'], [14.8, 'whoosh', .7]],
  draw(g, lt) {
    ground(g, UO[1]);
    postOffice(g, UO[0], UO[1], .8, { role: 'ubus', ang: lt * SPIN });
    hub(g, UH[0], UH[1], .85, lt, { busy: Math.max(win(lt, 5.0, 5.9), win(lt, 9.4, 10.0), win(lt, 10.8, 11.4), win(lt, 15.0, 15.8)) });
    const restart = win(lt, 12.0, 13.0, .1, .3);
    hut(g, US[0], US[1], .55, 'simple_test', lt, { light: restart > 0 ? (Math.floor(lt * 10) % 2) : undefined });
    if (lt > 12.0) tag(g, '重启', US[0], 560, C.amber, seg(lt, 12.1, 12.5), { fs: 26, tc: C.ink, al: fo(lt, 13.6) });
    routeDash(g, ROAD, 1, { c: rgba(C.navy, .6), w: 5, off: -lt * 20 });
    // 抽屉
    const nf = lt > 13.8;
    const ins = eo(seg(lt, 7.4, 8.0)), flip = seg(lt, 13.4, 13.8);
    drawer(g, 470, 250, { card: lt > 7.4, al: ins, sy: lt > 13.4 ? Math.abs(1 - 2 * flip) || .02 : 1, bad: flip > .5, flash: Math.max(win(lt, 9.4, 10.0, .1, .3), win(lt, 10.8, 11.4, .1, .3)) });
    path(g, [[470, 330], [470, 372]], { c: rgba(C.ink, .4), w: 3, dash: [6, 6] });
    if (nf) stampMark(g, 680, 214, '失效', C.red, seg(lt, 13.8, 14.1), { fs: 40 });
    if (lt > .9 && lt < 7.6) tag(g, 'simple_test → ?', 820, 200, C.navy, seg(lt, 1.0, 1.4), { fs: 26, f: 'mono', al: fo(lt, 7.3) });
    // 小邮差：一次 lookup 往返
    const runs = [[4.1, 6.9], [14.8, 16.6]];
    let courier = null;
    for (const [a, b] of runs) if (lt >= a && lt <= b) { const m = (a + b) / 2, out = lt < m, u = out ? eio(seg(lt, a, m - .2)) : 1 - eio(seg(lt, m + .2, b)); courier = { p: polyAt(ROAD, u), dir: out ? 1 : -1, back: !out }; }
    if (courier) { clerk(g, courier.p[0], courier.p[1] + 4, .55, { c: C.brick, pose: 'walk', ph: lt * 2.2, dir: courier.dir }); if (courier.back) at(g, courier.p[0] + 30 * courier.dir * -1, courier.p[1] - 80, 1, () => { card(g, -40, -26, 80, 52, { r: 6, fill: C.paper, lw: 2.5 }); text(g, '42', 0, 1, { f: 'mono', s: 26, w: 700 }); }); }
    if (lt > 4.3 && lt < 7.6) tag(g, '总线往返 ×1', 960, 700, C.navy, seg(lt, 4.4, 4.8), { fs: 26, al: fo(lt, 7.3) });
    if (lt > 14.9) tag(g, '重新 lookup', 960, 700, C.navy, seg(lt, 15.0, 15.4), { fs: 26 });
    // 命中缓存：直接寄
    for (const t0 of [9.4, 10.8]) if (lt > t0 && lt < t0 + 1.6) ride(g, [[640, 740], [1290, 740]], lt, t0, .9, 'INVOKE', { s: .65, ripple: false, al: fo(lt, t0 + 1.2) });
    for (const t0 of [9.6, 11.0]) if (lt > t0 && lt < t0 + 1.0) tag(g, '命中', 720, 230, C.green, seg(lt, t0, t0 + .3), { fs: 26, al: fo(lt, t0 + .8) });
    // 规则卡
    if (lt > 7.6) at(g, 1150, 250, ap(lt, 7.7), () => {
      card(g, -200, -86, 400, 172, { r: 14, fill: C.paper, lw: 3, sb: 18 });
      [['第一次', '→ lookup', C.navy], ['NOT_FOUND', '→ lookup', C.red], ['其余', '→ 用缓存', C.green]].forEach(([a, b, c], i) => {
        text(g, a, -176, -48 + i * 48, { f: /[A-Z]/.test(a) ? 'mono' : 'cjk', s: 26, w: 700, c, a: 'left' });
        text(g, b, 176, -48 + i * 48, { f: /lookup/.test(b) ? 'mono' : 'cjk', s: 26, w: 700, c: C.ink, a: 'right' });
      });
    });
    // NOT_FOUND 回来
    if (lt > 12.5) ride(g, [[1290, 740], [640, 740]], lt, 12.6, 1.0, 'NOT_FOUND', { s: .65, hold: lt < 14.6, al: fo(lt, 14.4) });
  },
});

/* =====================================================================
 * 第四章：为什么不共用订阅者
 * ===================================================================== */
const PJ = [250, 780], PU = [720, 780], PM = [960, 792], PH = [1340, 780], PS = [1720, 780];
const T13_UP = [[386, 650], [584, 650]], T13_DN = [[584, 724], [386, 724]];
S('s13', {
  card: 5,
  cam: [[0, 960, 520, 1], [17.3, 960, 520, 1]],
  cues: [[0, 'whoosh'], [2.1, 'type'], [3.5, 'whoosh', .6], [5.3, 'blip'], [6.9, 'latch'], [9.0, 'ding'], [10.5, 'stamp'], [11.3, 'whoosh', .7], [13.3, 'whoosh'], [14.7, 'success']],
  draw(g, lt) {
    ground(g, PJ[1]);
    postOffice(g, PJ[0], PJ[1], .7, { role: 'js', ang: lt * SPIN });
    postOffice(g, PU[0], PU[1], .7, { role: 'ubus', ang: lt * SPIN + 1 });
    tube(g, T13_UP, { w: 26, step: 90 }); tube(g, T13_DN, { w: 26, step: 90 });
    hub(g, PH[0], PH[1], .8, lt, { busy: win(lt, 6.4, 7.4) + win(lt, 10.0, 11.2) });
    const bellK = lt - 9.0;
    hut(g, PS[0], PS[1], .6, 'simple_test', lt);
    if (bellK > 0) deskBell(g, PS[0] + 70, PS[1] - 150, .6, bellK);
    codeCard(g, 80, 150, 540, ['simpleTest.status_change = fn;'], { title: 'setter', p: seg(lt, 2.0, 3.2) });
    if (lt > 3.4) ride(g, T13_UP, lt, 3.5, .9, 'SUBSCRIBE', { s: .55, ripple: false, al: fo(lt, 4.8) });
    // 信箱 = 订阅者对象
    const mb = ap(lt, 5.2, .6);
    mailbox(g, PM[0], PM[1], .85 * mb, { label: mb > .5 ? 'subscriber' : null, glow: win(lt, 12.1, 13.6) });
    if (lt > 5.5) tag(g, '也是一个 ubus 对象', PM[0], 560, C.brick, seg(lt, 5.6, 6.0), { fs: 26, al: fo(lt, 8.6) });
    if (lt > 6.1) routeDash(g, [[PM[0] + 40, 700], [PH[0] - 150, 660]], eo(seg(lt, 6.2, 6.9)), { c: rgba(C.navy, .8), w: 4 });
    // NOTIFY → ubusd 盖章变 INVOKE → 信箱
    const e1 = eo(seg(lt, 9.2, 10.2)), e2 = eo(seg(lt, 11.2, 12.2)), flip = seg(lt, 10.5, 10.8);
    if (lt > 9.2 && lt < 12.4) {
      const p = lt < 11.2 ? bez([PS[0] - 40, 560], [1540, 380], [PH[0], 440], e1) : bez([PH[0], 440], [1150, 360], [PM[0], 640], e2);
      const lab = flip < .5 ? 'NOTIFY' : 'INVOKE';
      envelope(g, p[0], p[1], .6 * (lt > 11.9 ? 1 - seg(lt, 11.9, 12.2) : 1), { label: lab, c: lab === 'NOTIFY' ? C.amber : C.teal, sy: lt > 10.5 && lt < 10.8 ? Math.abs(1 - 2 * flip) || .02 : 1 });
    }
    if (lt > 10.3 && lt < 11.2) { const k = seg(lt, 10.3, 10.5) * (1 - seg(lt, 10.7, 10.9)); at(g, PH[0], 440 - 80 + k * 30, 1, () => { rr(g, -40, -60, 80, 26, 6); g.fillStyle = C.wood; g.fill(); path(g, [[0, -60], [0, -100]], { c: C.ink, w: 8 }); rr(g, -50, -36, 100, 30, 6); g.fillStyle = C.red; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); }); }
    if (lt > 10.6 && lt < 12.4) tag(g, 'NOTIFY → INVOKE', PH[0], 300, C.navy, seg(lt, 10.6, 11.0), { fs: 26, f: 'mono', al: fo(lt, 12.2) });
    // 回到 JS
    if (lt > 13.2) ride(g, T13_DN, lt, 13.3, 1.1, 'NOTIFY', { s: .55, ripple: false, al: fo(lt, 15.0) });
    if (lt > 14.5) tag(g, 'status_change(data) ✓', 360, 420, C.green, seg(lt, 14.6, 15.0), { fs: 26, f: 'mono' });
  },
});

const HUTS = [[1500, 300, '对象 A'], [1500, 520, '对象 B'], [1500, 740, '对象 C']];
S('s14', {
  cam: [[0, 960, 520, 1], [15.5, 960, 520, 1]],
  cues: [[1.6, 'tick'], [2.2, 'tick'], [2.8, 'tick'], [6.0, 'error'], [8.0, 'latch'], [8.7, 'latch'], [9.4, 'latch'], [11.4, 'thunk', .6], [12.6, 'thunk', .6], [13.4, 'success']],
  draw(g, lt) {
    const split = spring(lt - 7.6, 5, 1.1), sp = clamp(split, 0, 1.15);
    HUTS.forEach(([x, y, n], i) => hut(g, x, y, .5 * ap(lt, .5 + i * .3), n, lt));
    // 连线
    HUTS.forEach(([x, y], i) => {
      const mbY = lerp(560, y, clamp(sp)), mbX = 760;
      const from = [mbX + (lt < 7.6 ? 60 : 40), lt < 7.6 ? 470 : mbY - 70], to = [x - 110, y - 60];
      const p = lt < 7.6 ? eo(seg(lt, 1.2 + i * .6, 1.8 + i * .6)) : eo(seg(lt, 8.0 + i * .7, 8.5 + i * .7));
      if (lt < 7.6 || lt > 7.9) path(g, partial([from, to], p), { c: rgba(C.navy, .75), w: 4, dash: [12, 8] });
    });
    // 信箱：一个 → 三个
    if (lt < 7.6) mailbox(g, 760, 560, 1.0, { label: 'subscriber' });
    else HUTS.forEach(([, y, n], i) => mailbox(g, 760, lerp(560, y, sp), lerp(1.0, .6, clamp(sp)), { label: sp > .9 ? 'sub ' + 'ABC'[i] : null, glow: i === 2 ? win(lt, 11.6, 13.6) : 0 }));
    // 三封没有寄件人的信
    if (lt > 4.3 && lt < 7.6) HUTS.forEach(([x, y], i) => {
      const t0 = 4.4 + i * .5, k = eo(seg(lt, t0, t0 + .7)); if (lt < t0) return;
      const p = bez([x - 110, y - 60], [1100, Math.min(y, 470) - 120], [790, 470], k);
      envelope(g, p[0] + (k >= 1 ? (i - 1) * 40 : 0), p[1] + (k >= 1 ? -i * 10 : 0), .45, { from: '?', stripe: false, al: fo(lt, 7.3) });
    });
    // 柜员
    const conf = lt > 5.9 && lt < 7.8;
    clerk(g, 420, 790, .95, { c: C.brick, face: conf ? 'confused' : 'open', pose: 'stand' });
    if (conf) for (let i = 0; i < 3; i++) qmark(g, 360 + i * 60, 560 - (i % 2) * 30, .6, seg(lt, 6.0 + i * .15, 6.4 + i * .15), lt, i);
    // 同一对象的两种事件共用一个订阅
    for (const [t0, lab] of [[11.0, 'status_change'], [12.2, 'status_change1']]) if (lt > t0 && lt < 14.8) ride(g, [[1390, 680], [830, 680]], lt, t0, 1.0, 'NOTIFY', { label: lab, fs: 24, s: 1.0, ripple: false, al: fo(lt, t0 + 1.4) });
    if (lt > 13.3) tag(g, '同一对象，共用一个订阅', 1110, 600, C.green, seg(lt, 13.4, 13.8), { fs: 26 });
  },
});

/* =====================================================================
 * 第五章：为什么不手写胶水
 * ===================================================================== */
const IDL = ['object simple_test {', '  // 状态变化', '  subscriber status_change: response', '  method hello(id: int32,', '               msg: string): response', '}'];
const OUT = [[1070, 170, 'ubus 模型', 'C · 给 server 用', C.brick], [1450, 170, '描述符', 'blobMsgDesc_t', C.purple], [1070, 500, 'JS 类胶水', '注册进 QuickJS', C.teal], [1450, 500, 'TS 接口', '给前端 import', C.navy]];
const IDL_Y = 230, IDL_LY = i => IDL_Y + 22 + 18 + 37.2 * (i + .5);
S('s15', {
  card: 6,
  cam: [[0, 960, 520, 1], [20.2, 960, 524, 1.02]],
  cues: [[0, 'whoosh'], [5.3, 'latch'], [6.1, 'latch'], [6.9, 'latch'], [7.7, 'latch'], [9.1, 'type'], [11.0, 'type', .7], [11.7, 'blip', .5], [12.0, 'blip', .5], [12.3, 'blip', .5], [12.6, 'blip', .5], [13.2, 'tick'], [16.0, 'whoosh'], [17.3, 'success', .6]],
  draw(g, lt) {
    // 四叠生成物
    OUT.forEach(([x, y, t1, sub, col], i) => {
      if (lt < 2.0 + i * .3) return;
      const fill = lt < 11.7 + i * .3 ? 0 : eo(seg(lt, 11.7 + i * .3, 12.0 + i * .3));
      at(g, x + 170, y + 130, ap(lt, 2.0 + i * .3), () => {
        docStack(g, -170, -130, 340, 260, `${'①②③④'[i]} ${t1}`, sub, col, { fill, subA: fa(lt, 5.3 + i * .8) });
        if (lt > 5.3 + i * .8 && lt < 6.1 + i * .8) { rr(g, -176, -136, 352, 272, 15); g.lineWidth = 5; g.strokeStyle = rgba(C.amber, .9); g.stroke(); }
        if (lt > 13.0 + i * .3) at(g, 80, -22, ap(lt, 13.0 + i * .3), () => plate(g, 'id: int32', 0, 0, { fs: 24, fill: C.amberL }));
        if (i === 3 && lt > 17.3) at(g, -10, 60, ap(lt, 17.3), () => plate(g, '/** 状态变化 */', 0, 0, { fs: 24, c: C.grey, fill: '#fff' }));
      });
    });
    // IDL 底稿
    const hl = lt > 15.7 ? 1 : lt > 12.8 ? 3 : -1;
    codeCard(g, 80, IDL_Y, 640, IDL, { title: 'simple_test.uidl', tc: C.brassD, fs: 24, p: seg(lt, 9.0, 10.4), hl, hk: hl >= 0 ? .9 + .1 * Math.sin(lt * 5) : 0, al: fa(lt, 8.9, .3) });
    if (lt < 8.9) { rr(g, 80, IDL_Y, 640, 290, 14); g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = rgba(C.ink, .3); g.stroke(); g.setLineDash([]); text(g, '一份 IDL ?', 400, IDL_Y + 145, { s: 30, w: 900, c: rgba(C.ink, .35) }); }
    // 印刷机
    const px = 880, py = 640, roll = lt > 11.0 && lt < 12.8 ? (lt - 11) * 8 : 0;
    card(g, px - 120, py - 90, 240, 200, { r: 14, fill: C.greyL, lw: 3.5, sb: 20 });
    rr(g, px - 90, py - 130, 180, 44, 8); g.fillStyle = C.grey; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    for (const [rx, d] of [[-45, 1], [45, -1]]) { g.save(); g.translate(px + rx, py + 10); g.rotate(roll * d); dot(g, 0, 0, 34, C.brass); ring(g, 0, 0, 34, C.ink, 3); for (let i = 0; i < 4; i++) { g.rotate(TAU / 4); path(g, [[0, 0], [0, 28]], { c: C.brassD, w: 4 }); } g.restore(); }
    text(g, '代码生成', px, py + 80, { s: 26, w: 900, c: C.ink2 });
    // 底稿副本送进印刷机
    const feed = eo(seg(lt, 10.6, 11.3));
    if (lt > 10.6 && lt < 11.4) at(g, lerp(400, px, feed), lerp(IDL_Y + 140, py - 120, feed), lerp(.5, .2, feed), () => card(g, -320, -140, 640, 280, { r: 14, fill: '#FFFCF4', lw: 3 }), { al: 1 - seg(lt, 11.1, 11.4) });
    // 纸张飞向四叠
    OUT.forEach(([x, y], i) => { const t0 = 11.7 + i * .3 - .5, k = eo(seg(lt, t0, t0 + .5)); if (lt > t0 && k < 1) { const p = bez([px + 60, py - 60], [px + 200, 160], [x + 170, y + 130], k); at(g, p[0], p[1], .5, () => card(g, -60, -40, 120, 80, { r: 6, fill: C.paper, lw: 2.5 }), { rot: k * 2 }); } });
    // 同一个字段，四层同源
    if (lt > 12.9 && lt < 15.6) OUT.forEach(([x, y], i) => path(g, partial([[720, IDL_LY(3)], [x + 250, y + 108]], eo(seg(lt, 13.0 + i * .3, 13.4 + i * .3))), { c: rgba(C.amber, .9), w: 3, dash: [8, 6], al: fo(lt, 15.3) }));
    // 注释纸条飘进 TS
    const slip = eo(seg(lt, 16.0, 17.2));
    if (lt > 16.0 && lt < 17.4) { const p = bez([300, IDL_LY(1)], [900, 120], [1610, 690], slip); at(g, p[0], p[1], 1, () => plate(g, '// 状态变化', 0, 0, { fs: 24, c: C.grey, fill: '#fff' }), { rot: Math.sin(slip * 9) * .15 }); }
  },
});

S('s16', {
  cam: [[0, 960, 520, 1], [14.6, 960, 520, 1]],
  cues: [[.5, 'whoosh', .6], [4.2, 'blip'], [4.8, 'blip'], [5.5, 'tick'], [7.1, 'type'], [10.5, 'tick'], [11.1, 'tick'], [11.7, 'tick'], [12.2, 'blip'], [12.6, 'tick'], [13.2, 'success']],
  draw(g, lt) {
    path(g, partial([[960, 150], [960, 860]], eo(seg(lt, .3, 1.0))), { c: rgba(C.ink, .4), w: 3, dash: [12, 10] });
    plate(g, 'JS 参数 → blobmsg', 480, 190, { fs: 28, s: ap(lt, .5), c: C.teal });
    plate(g, 'blobmsg → JSValue', 1440, 190, { fs: 28, s: ap(lt, .8), c: C.purple });
    if (lt > 1.2) tag(g, '不对称', 960, 140, C.red, seg(lt, 1.3, 1.7), { fs: 26 });
    // 左：按下标直取
    const ARGS = [['[0]', '123', 'INT32', 'id', 4.1], ['[1]', '"test"', 'STRING', 'msg', 4.7]];
    plate(g, 'blob', 690, 270, { fs: 24, c: C.purple, al: fa(lt, 3.9) });
    ARGS.forEach(([ix, v, ty, nm, t0], i) => {
      const y = 350 + i * 130;
      at(g, 230, y, ap(lt, 1.6 + i * .3), () => { card(g, -110, -40, 220, 80, { r: 12, fill: C.tealL, lw: 3, stroke: C.teal }); text(g, ix, -66, 1, { f: 'mono', s: 26, w: 700, c: C.teal }); text(g, v, 28, 1, { f: 'mono', s: 28, w: 700, c: i ? C.brick : C.amber }); });
      at(g, 690, y, ap(lt, 3.9 + i * .2), () => { card(g, -150, -40, 300, 80, { r: 8, fill: '#FFFCF4', lw: 3 }); text(g, ty, -126, -12, { f: 'mono', s: 24, w: 700, c: C.purple, a: 'left' }); text(g, nm, 126, -12, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'right' }); if (lt > t0 + .5) text(g, v, 0, 18, { f: 'mono', s: 26, w: 700, c: i ? C.brick : C.amber }); });
      if (lt > t0) { arrow(g, [[345, y], [535, y]], { p: eo(seg(lt, t0, t0 + .3)), c: C.teal, w: 5, hs: 16 }); const k = eo(seg(lt, t0, t0 + .5)); if (k < 1) text(g, v, lerp(258, 690, k), y + 18 * k, { f: 'mono', s: 26, w: 700, c: i ? C.brick : C.amber }); }
    });
    if (lt > 5.4) tag(g, 'O(1)', 440, 290, C.green, seg(lt, 5.5, 5.9), { fs: 28, f: 'mono' });
    codeCard(g, 110, 640, 690, ['blobmsg_add_u32(b, "id", a[0]);', 'blobmsg_add_string(b, "msg", a[1]);'], { title: '生成器写好的转换', fs: 24, p: seg(lt, 7.0, 8.6), al: fa(lt, 6.9, .3) });
    // 右：描述符按字段名递归
    const ROWS = [['res1', 'INT32', '1', 10.5], ['res2', 'STRING', '"ok"', 11.1], ['info', 'TABLE', '{…}', 11.7]];
    const tx = 1030, ty0 = 300;
    at(g, 0, 0, 1, () => {
      card(g, tx, ty0, 420, 60 + ROWS.length * 56, { r: 12, fill: '#FFFCF4', lw: 3, stroke: C.purple });
      rr(g, tx, ty0, 420, 52, 12); g.fillStyle = rgba(C.purple, .9); g.fill();
      text(g, '描述符 · name', tx + 24, ty0 + 27, { s: 24, w: 900, c: '#fff', a: 'left' }); text(g, 'type', tx + 396, ty0 + 27, { f: 'mono', s: 24, w: 700, c: '#fff', a: 'right' });
      ROWS.forEach(([n, t2, , t0], i) => {
        const y = ty0 + 84 + i * 56, on = lt > t0 && lt < t0 + .7;
        if (on) { rr(g, tx + 8, y - 24, 404, 48, 8); g.fillStyle = rgba(C.amber, .35); g.fill(); }
        text(g, n, tx + 30, y, { f: 'mono', s: 26, w: 700, a: 'left' }); text(g, t2, tx + 396, y, { f: 'mono', s: 26, w: 700, c: C.purple, a: 'right' });
      });
    }, { al: fa(lt, 9.8, .4) });
    // 嵌套：TABLE 再递归一层
    if (lt > 12.0) at(g, tx + 260, 620, ap(lt, 12.0), () => {
      card(g, -150, -50, 300, 100, { r: 10, fill: '#FFFCF4', lw: 3, stroke: C.purple, dash: [8, 6] });
      if (lt > 12.6 && lt < 13.3) { rr(g, -140, -30, 280, 60, 8); g.fillStyle = rgba(C.amber, .35); g.fill(); }
      text(g, 'code', -120, 1, { f: 'mono', s: 26, w: 700, a: 'left' }); text(g, 'INT32', 126, 1, { f: 'mono', s: 26, w: 700, c: C.purple, a: 'right' });
    });
    if (lt > 11.9) arrow(g, [[tx + 360, 494], [tx + 360, 566]], { p: eo(seg(lt, 11.9, 12.2)), c: C.purple, w: 4, hs: 14 });
    // JS 对象逐行长出来
    const obj = ['{', '  res1: 1,', '  res2: "ok",', lt > 12.8 ? '  info: { code: 0 }' : '  info: {…}'].slice(0, 1 + (lt > 10.9) + (lt > 11.5) + (lt > 12.1)).concat(['}']);
    if (lt > 9.9) codeCard(g, 1500, 300, 360, obj, { title: 'JSValue', fs: 26, tc: C.teal, al: fa(lt, 9.9, .3) });
    for (const [n, , , t0] of ROWS) if (lt > t0 && lt < t0 + .6) { const k = eo(seg(lt, t0, t0 + .5)); text(g, n, lerp(tx + 200, 1560, k), lerp(384 + ROWS.findIndex(r => r[0] === n) * 56, 400, k), { f: 'mono', s: 26, w: 700, c: C.amber, al: 1 - k * .5 }); }
  },
});

S('s17', {
  cam: [[0, 960, 540, 1.04], [10.2, 960, 540, 1]],
  cues: [[.6, 'type'], [3.5, 'blip'], [6.6, 'blip'], [8.2, 'success', .6]],
  draw(g, lt) {
    g.save(); g.globalAlpha *= .32; bridge(g, lt, {});
    ride(g, TUBE_UP, lt, (lt % 2.4) < 1.3 ? lt - (lt % 2.4) : 99, 1.3, 'INVOKE', { s: .7, ripple: false });
    ride(g, TUBE_DN, lt, ((lt + 1.2) % 2.4) < 1.3 ? lt - ((lt + 1.2) % 2.4) : 99, 1.3, 'DATA', { s: .7, ripple: false });
    g.restore();
    const hl = lt > 6.4 ? 1 : lt > 3.3 ? 0 : -1;
    codeCard(g, 420, 360, 1060, ['const r = await simpleTest.hello(123, "test");', 'simpleTest.status_change = (data) => show(data);'], { title: '前端看到的全部', fs: 32, p: seg(lt, .5, 2.6), hl, hk: hl >= 0 ? 1 : 0, sb: 30 });
    if (lt > 3.3) tag(g, 'Promise', 1600, 444, C.teal, seg(lt, 3.5, 3.9), { fs: 28, f: 'mono' });
    if (lt > 6.4) tag(g, 'setter', 1600, 494 + 6, C.amber, seg(lt, 6.6, 7.0), { fs: 28, f: 'mono', tc: C.ink });
    if (lt > 7.8) text(g, '管道、存根、信箱，都藏在后面', 960, 640, { s: 30, w: 700, c: C.ink2, al: fa(lt, 8.0) });
  },
});

/* =====================================================================
 * 总结 + 片尾
 * ===================================================================== */
const PC = [[340, 500], [960, 500], [1580, 500]];
function postcard(g, i, x, y, p, lt) {
  const titles = ['改不起库，就加一层', '只传副本，pipe 唤醒', '序号对上存根'];
  const k = eo(p);
  at(g, x + (1 - k) * 600, y + wob(lt, .3, 4, i), 1, () => {
    card(g, -250, -160, 500, 320, { r: 12, fill: '#FFFCF4', lw: 3.5, sb: 26, so: 10 });
    for (let j = 0; j < 12; j++) { rr(g, -250 + j * 42, 150, 22, 10, 2); g.fillStyle = j % 2 ? C.red : C.navy; g.fill(); }
    rr(g, 150, -140, 80, 92, 4); g.fillStyle = [C.teal, C.brick, C.green][i]; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
    text(g, ['一', '二', '三'][i], 190, -94, { s: 40, w: 900, c: '#fff' });
    if (i === 0) { postOffice(g, -130, 40, .26, { role: 'js', ang: lt * SPIN }); postOffice(g, 110, 40, .26, { role: 'ubus', ang: lt * SPIN + 1 }); clerk(g, -10, 50, .55, { c: C.brick, pose: 'wave', ph: lt }); tag(g, '+1 线程', -10, -70, C.brick, 1, { fs: 24 }); }
    if (i === 1) { capsule(g, -90, -10, 'MSG', { label: 'blob 副本', s: .62, fs: 26 }); deskBell(g, 110, 40, .75, (lt % 1.6) - .2); bead(g, 110, -60, 11); }
    if (i === 2) { stub(g, -110, -10, '#7', { s: .6, state: 'ok' }); capsule(g, 120, -10, 'DATA', { seq: '#7', s: .6 }); path(g, [[-40, -10], [40, -10]], { c: C.green, w: 4, dash: [8, 6] }); }
    text(g, titles[i], 0, 112, { s: 34, w: 900 });
  }, { al: clamp(p * 3), rot: (1 - k) * .25 });
}
S('s18', {
  card: 7,
  cam: [[0, 960, 520, 1], [18.7, 960, 520, 1.03]],
  cues: [[0, 'whoosh'], [1.9, 'whoosh', .6], [2.6, 'stamp'], [7.0, 'whoosh', .6], [7.7, 'stamp'], [12.7, 'whoosh', .6], [13.4, 'stamp'], [16.6, 'success']],
  draw(g, lt) {
    PC.forEach(([x, y], i) => {
      const t0 = [1.9, 7.0, 12.7][i];
      if (lt < t0) { g.save(); g.globalAlpha *= fa(lt, 1.6); rr(g, x - 250, y - 160, 500, 320, 12); g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = rgba(C.ink, .3); g.stroke(); g.setLineDash([]); g.restore(); return; }
      postcard(g, i, x, y, seg(lt, t0, t0 + .7), lt);
      if (lt > t0 + .7) postmark(g, x + 150, y - 100, 50, rgba(C.red, .7), [], { rot: -.2, s: lerp(1.6, 1, eo(seg(lt, t0 + .7, t0 + 1.0))), al: fa(lt, t0 + .7, .2) });
    });
  },
});

S('s19', {
  title: true, fi: .2, fo: .4,
  draw(g, lt) {
    const a = eo(seg(lt, 0, .3));
    ground(g, 760, a);
    postOffice(g, 330, 760, .55, { role: 'js', ang: lt * SPIN, al: a });
    postOffice(g, 1590, 760, .55, { role: 'ubus', ang: lt * SPIN + 1, al: a });
    postmark(g, 960, 520, 230, rgba(C.brick, .9), [{ s: SERIES.title, dy: -34, fs: 100 }, { s: SERIES.sub, dy: 80, fs: 34 }], { rot: -.05, s: lerp(1.4, 1, eo(seg(lt, 0, .3))), al: a });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  g.save(); g.translate(0, 150);
  bridge(g, 2.2, {});
  clerk(g, BR.js[0] + 150, 822, .85, { c: C.teal, pose: 'wave', ph: .2 });
  clerk(g, BR.ub[0] - 150, 822, .85, { c: C.brick, pose: 'wave', ph: .6 });
  capsule(g, 900, 540, 'INVOKE', { seq: '#7', s: .8, glow: .5 }); capsule(g, 1040, 730, 'DATA', { seq: '#7', s: .8, glow: .5 });
  g.restore();
  text(g, '改不起库，就加一个线程', 960, 170, { s: 128, w: 900 });
  text(g, 'JSRuntime 用 ubus 转发消息 · 五个“为什么不”', 960, 300, { s: 46, w: 900, c: C.teal });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
