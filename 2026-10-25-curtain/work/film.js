/* =====================================================================
 * 窗帘单双电机与 spec 隔离 —— 编排（字幕与章节在 script.js，图元在 kit.js）
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]。章节编号：0 开场、1 片名、2–7 六章、8 总结、9 片尾。
 * 画风样片阶段只注册了 s03（片名）、s09（整目录二选一）、s26（2×2 产品矩阵）；全片时按 script.js 补齐其余各幕。
 * ===================================================================== */
'use strict';
const CARD = { 2: ['01', '先分类，再动手', 'CLASSIFY FIRST'], 3: ['02', '同名符号，构建时二选一', 'SAME NAME, PICKED AT BUILD'],
  4: ['03', '一份循环，跑一次或两次', 'ONE LOOP, ONE OR TWO MOTORS'], 5: ['04', '云端那一刀：每款一张表', 'ONE TABLE PER PRODUCT'],
  6: ['05', '两刀正交，2×2', 'TWO AXES, 2×2'], 7: ['06', '一个不能删的空函数', 'THE LINK ANCHOR'], 8: ['✓', '三条设计经验', 'THREE TAKEAWAYS'] };
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.bg1, white: C.ink, cyan: C.cyan, red: C.red, amber: C.amber },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: C.cyan, danger: C.red, accent: C.amber },
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

/* 章节转场：一张更亮的新图幅斜切扫入（白色刃线 + 冷光）→ 停留大号图号与标题 → 扫出 */
function chapterWipe(g, { sc, lt }) {
  const cd = CARD[sc.card]; if (!cd || lt > 1.95) return;
  const [num, zh, en] = cd;
  const pin = eio(seg(lt, 0, .42)), pout = eio(seg(lt, 1.42, 1.92));
  const x0 = lerp(-W - 560, -260, pin) + lerp(0, W + 820, pout);
  const band = new Path2D(); band.moveTo(x0 + 260, 0); band.lineTo(x0 + W + 520, 0); band.lineTo(x0 + W + 260, H); band.lineTo(x0, H); band.closePath();
  g.save();
  const lg = g.createLinearGradient(x0, 0, x0 + W + 520, H); lg.addColorStop(0, '#174F90'); lg.addColorStop(1, C.band);
  g.fillStyle = lg; g.fill(band);
  g.save(); g.clip(band);
  gridOn(g, 0, 0, W, H, 24, 'rgba(200,228,255,.07)'); gridOn(g, 0, 0, W, H, 120, 'rgba(200,228,255,.16)', 1.4);
  const a = eo(seg(lt, .3, .62)) * (1 - eo(seg(lt, 1.36, 1.58))), dx = (1 - eo(seg(lt, .3, .72))) * 90;
  if (num === '✓') check(g, 470 - dx, 520, 230, seg(lt, .3, .8), { c: C.ink, w: 26, al: a });
  else text(g, num, 470 - dx, 528, { f: 'disp', w: 900, s: 320, noFill: false, c: rgba(C.ink, .1), stroke: rgba(C.ink, .95), lw: 4, al: a });
  text(g, zh, 780 + dx * .5, 470, { s: 100, w: 900, a: 'left', al: a });
  text(g, en, 786 + dx * .5, 566, { f: 'mono', s: 30, w: 700, ls: 8, c: C.ink2, a: 'left', al: a });
  const tw = textW(g, zh, { s: 100, w: 900 });
  g.save(); g.globalAlpha *= a; dimLine(g, 780 + dx * .5, 636, 780 + dx * .5 + tw, 636, `SHEET ${num === '✓' ? '07' : num} / 07`, seg(lt, .4, 1.1), { c: C.ink2, lo: -28, s: 24 }); g.restore();
  g.restore();
  // 刃线：前沿亮白 + 冷光，后沿细线
  path(g, [[x0 + W + 520, 0], [x0 + W + 260, H]], { c: C.ink, w: 4, glow: 1, gb: 26 });
  path(g, [[x0 + W + 540, 0], [x0 + W + 280, H]], { c: rgba(C.cyan, .6), w: 1.5 });
  path(g, [[x0 + 260, 0], [x0, H]], { c: rgba(C.ink, .6), w: 2 });
  g.restore();
}

/* 外框：左上图签式章节标签，右上图号 + 章节进度，⚠ 机制演绎标记 */
const CH_SHORT = CHAPTERS.map((c, i) => i === 0 ? '开场' : (i === 1 || i === 9) ? '' : c[0].split('｜')[1]);
function drawChrome(g, { sc, lt }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card != null ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const num = CARD[sc.chapter]?.[0], w = textW(g, lab, { s: 26, w: 700 }) + 36; let x = 52;
    if (num) {
      g.fillStyle = C.ink; g.fillRect(x, 42, 56, 50);
      if (num === '✓') check(g, x + 28, 67, 30, 1, { c: C.bg0, w: 5 }); else text(g, num, x + 28, 68, { f: 'disp', w: 900, s: 28, c: C.bg0 });
      x += 56;
    }
    g.fillStyle = rgba(C.plate, .75); g.fillRect(x, 42, w, 50);
    g.strokeStyle = rgba(C.ink, .8); g.lineWidth = 2; g.strokeRect(52, 42, x - 52 + w, 50);
    text(g, lab, x + 18, 68, { s: 26, w: 700, a: 'left' });
  }
  let xr = 1868;
  if (sc.chapter >= 2 && sc.chapter <= 8) {
    const sheet = `SHEET ${String(sc.chapter - 1).padStart(2, '0')} / 07`;
    text(g, sheet, xr, 68, { f: 'mono', s: 24, w: 700, a: 'right', c: C.ink2 });
    xr -= textW(g, sheet, { f: 'mono', s: 24, w: 700 }) + 22;
    for (let k = 8; k >= 2; k--) {
      const on = sc.chapter >= k, cur = sc.chapter === k, s = cur ? 18 : 12;
      g.save(); g.translate(xr - 9, 67); g.rotate(Math.PI / 4);
      if (on) { g.fillStyle = cur ? C.amber : rgba(C.ink, .6); g.fillRect(-s / 2, -s / 2, s, s); } else { g.strokeStyle = rgba(C.ink, .4); g.lineWidth = 1.6; g.strokeRect(-s / 2, -s / 2, s, s); }
      g.restore(); xr -= 26;
    }
    xr -= 14;
  }
  if (sc.demo) xr -= demoTag(g, xr, 67) + 12;
  g.restore();
}
function demoTag(g, xr, y) {
  const s = '机制演绎', w = textW(g, s, { s: 24, w: 700 }) + 66;
  g.save(); g.fillStyle = rgba(C.plate, .8); g.fillRect(xr - w, y - 23, w, 46); g.strokeStyle = C.amber; g.lineWidth = 2; g.strokeRect(xr - w, y - 23, w, 46); g.restore();
  warnIcon(g, xr - w + 26, y, 26);
  text(g, s, xr - w + 46, y + 1, { s: 24, w: 700, c: C.amber, a: 'left' });
  return w;
}

/* 字幕：深色图签底板（双线框 + 青色裁切角标），白字；^琥珀^ 加下划线，[红] 加红色细波浪线 */
function capState(g, frame) {
  const { sc, lt } = frame; if (sc.title || sc.noCaption || !sc.captions?.length) return null;
  const i = sc.cs.findIndex((s, k) => lt >= s && lt < sc.ce[k]); if (i < 0) return null;
  const c = { t0: sc.start + sc.cs[i], t1: sc.start + sc.ce[i], text: sc.captions[i].text }, layout = film.captionLayout(g, c, frame.t);
  if (!layout) return null;
  return { layout, alpha: Math.min(seg(lt, sc.cs[i], sc.cs[i] + .12), 1 - seg(lt, sc.ce[i] - .12, sc.ce[i])) };
}
function drawCaptionBackground(g, frame) {
  CAMZ = 1; const c = capState(g, frame); if (!c) return;
  const L = c.layout.lines, w0 = Math.max(...L.map(l => l.width)) + 88, top = L[0].y - 66, h = (L.length - 1) * 64 + 98;
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .25)), w = w0 * lerp(.94, 1, k), x = (W - w) / 2, y = top + (1 - k) * 10;
  g.save(); g.globalAlpha *= c.alpha;
  g.fillStyle = rgba(C.plate, .86); g.fillRect(x, y, w, h);
  g.strokeStyle = rgba(C.ink, .72); g.lineWidth = 2; g.strokeRect(x, y, w, h);
  g.strokeStyle = rgba(C.ink, .22); g.lineWidth = 1; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
  g.strokeStyle = C.cyan; g.lineWidth = 2.5;
  for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
    g.beginPath(); g.moveTo(cx + sx * 5, cy + sy * 19); g.lineTo(cx + sx * 5, cy + sy * 5); g.lineTo(cx + sx * 19, cy + sy * 5); g.stroke();
  }
  g.restore();
}
function drawCaption(g, layout, frame) {
  if (frame.sc.title || frame.t >= layout.caption.t1) return;
  const k = eo(seg(frame.t, layout.caption.t0, layout.caption.t0 + .25));
  g.globalAlpha = Math.min(seg(frame.t, layout.caption.t0, layout.caption.t0 + .12), 1 - seg(frame.t, layout.caption.t1 - .12, layout.caption.t1));
  for (const l of layout.lines) {
    let x = l.x; const y = l.y + (1 - k) * 10;
    for (const s of l.segments) {
      const w = textW(g, s.s, { s: 54, w: 700 });
      if (s.c === C.amber) { g.fillStyle = rgba(C.amber, .5); g.fillRect(x, y + 10, w, 5); }
      if (s.c === C.red) { const pts = []; for (let xx = 0; xx <= w; xx += 6) pts.push([x + xx, y + 13 + Math.sin(xx * .42) * 2.5]); path(g, pts, { c: rgba(C.red, .75), w: 2 }); }
      text(g, s.s, x, y, { s: 54, w: 700, c: s.c || C.ink, a: 'left', b: 'alphabetic' });
      x += w;
    }
  }
}

/* ---------------- 场景注册 ---------------- */
const FIRST = {}; for (const [id, d] of Object.entries(SCRIPT)) if (!(d.chapter in FIRST)) FIRST[d.chapter] = id;
let lastChapter = -1;
function S(id, o) {
  const d = SCRIPT[id];
  if (d.chapter !== lastChapter) { film.chapter(d.chapter, ...CHAPTERS[d.chapter]); lastChapter = d.chapter; }
  return film.addScene({
    ...o, id, chapter: d.chapter, dur: d.dur, pre: 0, post: 0,
    card: FIRST[d.chapter] === id && CARD[d.chapter] ? d.chapter : null, demo: !!(d.demo || o.demo),
    captions: d.caps.map(([t, end, text]) => ({ t, end, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t, type, v: v ?? 1 })),
    draw: (g, lt, sc) => o.draw(g, lt, sc),
  });
}

/* ---------------- 本片专用图元 ---------------- */
/* 云端属性规范小图纸：n 个服务块 */
function specDoc(g, x, y, w, h, n, p = 1, o = {}) {
  if (p <= 0) return;
  fileIcon(g, x, y, w, h, { al: seg(p, 0, .5) * (o.al ?? 1), fill: rgba(C.ink, .06) });
  const q = seg(p, .4, 1), bh = (h - 30) / 3 - 6;
  for (let i = 0; i < n; i++) { g.save(); g.globalAlpha *= q * (o.al ?? 1); g.fillStyle = rgba(o.c || C.cyan, .35); g.fillRect(x + 8, y + 22 + i * (bh + 6), w - 16, bh); g.strokeStyle = o.c || C.cyan; g.lineWidth = 1.5; g.strokeRect(x + 8, y + 22 + i * (bh + 6), w - 16, bh); g.restore(); }
}
/* 小文件沿二次曲线飞行（文件流），k∈[0,1] */
function flyFile(g, a, m, b, k) {
  if (k <= 0 || k >= 1) return;
  const u = eio(k), v = 1 - u, x = v * v * a[0] + 2 * v * u * m[0] + u * u * b[0], y = v * v * a[1] + 2 * v * u * m[1] + u * u * b[1];
  fileIcon(g, x - 15, y - 19, 30, 38, { al: Math.sin(k * Math.PI), c: C.cyan, fill: rgba(C.cyan, .15) });
}

/* =====================================================================
 * 片名
 * ===================================================================== */
S('s03', {
  title: true, fi: .3,
  cam: [[0, 960, 500, 1.05], [7.1, 960, 500, 1.0]],
  cues: [[.15, 'draw'], [.55, 'whoosh'], [1.7, 'draw', .6], [2.6, 'tick', .5], [3.6, 'latch'], [4.6, 'latch', .5], [5.8, 'latch', .5]],
  draw(g, lt) {
    // 顶部：单轨窗帘线稿 + 零件气泡
    const open = .18 + .14 * (1 - Math.cos(lt * .9)) / 2;
    curtain(g, 640, 250, 640, 'single', lt, { p: seg(lt, .1, 1.7), open, h: 140 });
    balloon(g, 1350, 150, 22, '1', seg(lt, 1.3, 1.9), { from: [1230, 190] });
    text(g, '电机', 1386, 150, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, 1.6, 2.0) });
    balloon(g, 560, 196, 22, '2', seg(lt, 1.5, 2.1), { from: [660, 257] });
    text(g, '导轨', 524, 196, { s: 24, w: 700, a: 'right', c: C.ink2, al: seg(lt, 1.8, 2.2) });
    // 标题：逐字先描轮廓再填白
    const T = '窗帘单双电机与 spec 隔离', o = { s: 112, w: 900 }, chars = Array.from(T), total = textW(g, T, o);
    let x = 960 - total / 2;
    chars.forEach((ch, i) => {
      const w = textW(g, ch, o), p = seg(lt, .5 + i * .05, 1.15 + i * .05);
      if (p > 0 && ch !== ' ') {
        const yy = 520 + (1 - eo(p)) * 26, latin = /[a-z]/.test(ch);
        text(g, ch, x + w / 2, yy, { ...o, noFill: true, stroke: rgba(C.ink, .9), lw: 2.2, al: eo(seg(p, 0, .4)) * (1 - .7 * seg(p, .6, 1)) });
        text(g, ch, x + w / 2, yy, { ...o, c: latin ? C.cyan : C.ink, al: seg(p, .4, 1), glow: latin ? rgba(C.cyan, .5) : null });
      }
      x += w;
    });
    dimLine(g, 960 - total / 2, 604, 960 + total / 2, 604, null, seg(lt, 1.6, 2.6), { c: C.ink2 });
    const sp = seg(lt, 3.6, 4.1);
    at(g, 960, 672, pop(sp), () => text(g, '同名符号 · 构建时二选一', 0, 0, { s: 56, w: 700, c: C.cyan, ls: 4 }), { al: sp > 0 ? 1 : 0 });
    // 底部：一份 variant/，二选一的两个目录
    const fp = seg(lt, 2.2, 3.2), sw = lt < 4.4 ? -1 : Math.floor((lt - 4.4) / 1.2) % 2; // 0 选 dual，1 选 single
    pipe(g, [[870, 778], [760, 778]], lt, { p: fp, flow: sw === 1 ? 1 : 0, head: true });
    pipe(g, [[1050, 778], [1160, 778]], lt, { p: fp, flow: sw === 0 ? 1 : 0, head: true });
    frame(g, 870, 752, 180, 52, { p: seg(lt, 2.0, 2.8) });
    text(g, 'variant/', 960, 779, { f: 'mono', s: 26, w: 700, al: seg(lt, 2.4, 2.9) });
    const lit1 = sw === 1 ? eo(seg((lt - 4.4) % 1.2, 0, .3)) : 0, lit0 = sw === 0 ? eo(seg((lt - 4.4) % 1.2, 0, .3)) : 0;
    frame(g, 580, 752, 180, 52, { p: seg(lt, 2.5, 3.3), lit: lit1, dash: sw === 0 ? [8, 6] : null });
    text(g, 'single/', 670, 779, { f: 'mono', s: 26, w: 700, c: lit1 > .5 ? C.cyan : C.ink2, al: seg(lt, 2.9, 3.3) });
    frame(g, 1160, 752, 180, 52, { p: seg(lt, 2.6, 3.4), lit: lit0, dash: sw === 1 ? [8, 6] : null });
    text(g, 'dual/', 1250, 779, { f: 'mono', s: 26, w: 700, c: lit0 > .5 ? C.cyan : C.ink2, al: seg(lt, 3.0, 3.4) });
  },
});

/* =====================================================================
 * 第二章：同名符号，构建时二选一
 * ===================================================================== */
const P9 = { k: [250, 470], mk: [430, 405, 410, 130], dual: [960, 170, 330, 250], single: [960, 530, 330, 250], link: [1390, 300, 430, 300] };
S('s09', {
  cam: [[0, 560, 520, 1.2], [2.6, 560, 520, 1.2], [4.4, 960, 540, 1.0], [8.0, 960, 540, 1.0], [9.4, 1330, 540, 1.12], [11.8, 1330, 540, 1.12], [12.6, 960, 540, 1.0]],
  cues: [[.3, 'draw'], [1.2, 'latch'], [1.6, 'type'], [2.8, 'whoosh'], [3.3, 'whoosh', .5], [5.1, 'draw', .6], [5.4, 'error', .5], [8.6, 'whoosh', .6], [9.7, 'stamp'], [10.3, 'draw', .5], [12.0, 'latch'], [12.4, 'whoosh', .5]],
  draw(g, lt) {
    const [kx, ky] = P9.k, back = lt >= 12;
    const pos = back ? 1 - spring(lt - 12, 8, 1.3) : spring(lt - 1.2, 8, 1.3);
    const sw = eo(seg(lt, 12.2, 12.6));                     // 幕尾：拨回单电机
    const dualLit = eo(seg(lt, 2.8, 3.3)) * (1 - sw), singleLit = sw;
    const singleOff = seg(lt, 5.1, 6.0) * (1 - sw), dualOff = sw;
    // 旋钮（Kconfig）
    text(g, 'Kconfig', kx, 328, { f: 'mono', s: 32, w: 700, al: seg(lt, .1, .5) });
    text(g, '选产品', kx, 368, { s: 24, w: 700, c: C.ink2, al: seg(lt, .2, .6) });
    knob(g, kx, ky, 78, pos, lt, { p: seg(lt, 0, .9), lit: .4 });
    const onDual = pos > .5;
    text(g, '单电机', kx - 92, 604, { s: 26, w: 700, c: onDual ? C.ink2 : C.amber, al: seg(lt, .5, .9) });
    text(g, '双电机', kx + 92, 604, { s: 26, w: 700, c: onDual ? C.amber : C.ink2, al: seg(lt, .5, .9) });
    pipe(g, [[kx + 88, ky], [P9.mk[0], ky]], lt, { p: seg(lt, .6, 1.2), flow: lt > 1.2 ? .8 : 0, head: true });
    // Makefile
    const [mx, my, mw, mh] = P9.mk;
    frame(g, mx, my, mw, mh, { p: seg(lt, .3, 1.2), ticks: true, fill: rgba(C.plate, .55) });
    text(g, 'Makefile', mx + 22, my + 36, { f: 'mono', s: 28, w: 700, a: 'left', al: seg(lt, .8, 1.2) });
    path(g, [[mx, my + 58], [mx + mw, my + 58]], { c: rgba(C.ink, .35), w: 1.4, al: seg(lt, .9, 1.2) });
    const pre = 'SRC_DIRS += variant/', dir = lt < 12.1 ? 'dual' : typed('single', seg(lt, 12.15, 12.5));
    const full = typed(pre + 'dual', seg(lt, 1.6, 2.6)), shownPre = lt < 12.1 ? full.slice(0, pre.length) : pre, shownDir = lt < 12.1 ? full.slice(pre.length) : dir;
    text(g, shownPre, mx + 22, my + 95, { f: 'mono', s: 24, w: 400, a: 'left' });
    const pw = textW(g, shownPre, { f: 'mono', s: 24, w: 400 });
    text(g, shownDir, mx + 22 + pw, my + 95, { f: 'mono', s: 24, w: 700, a: 'left', c: C.cyan });
    if (lt > 1.5 && lt < 2.8 || (lt > 12.1 && lt < 12.6)) { if (Math.floor(lt * 4) % 2 === 0) { g.fillStyle = C.cyan; g.fillRect(mx + 24 + pw + textW(g, shownDir, { f: 'mono', s: 24, w: 700 }), my + 84, 12, 22); } }
    // 两条分支管路
    const fork = mx + mw + 60;
    pipe(g, [[mx + mw, ky], [fork, ky], [fork, 295], [P9.dual[0], 295]], lt, { p: seg(lt, 1.0, 1.8), flow: dualLit, head: true });
    pipe(g, [[mx + mw, ky], [fork, ky], [fork, 655], [P9.single[0], 655]], lt, { p: seg(lt, 1.1, 1.9), flow: singleLit, head: true });
    redCross(g, fork + 30, 655, 30, seg(lt, 5.3, 5.7), { al: 1 - sw });
    redCross(g, fork + 30, 295, 30, seg(lt, 12.5, 12.9));
    // 两个变体目录
    folder(g, ...P9.dual, 'variant/dual/', 8, { p: seg(lt, .7, 1.9), lit: dualLit, off: dualOff, hatchP: dualOff, sub: '7 个 .c + 专属头', marks: [7] });
    folder(g, ...P9.single, 'variant/single/', 6, { p: seg(lt, .8, 2.0), lit: singleLit, off: singleOff, hatchP: singleOff, sub: '6 个 .c' });
    const t2 = seg(lt, 5.8, 6.2) * (1 - seg(lt, 7.9, 8.2));
    if (t2 > 0) tagBox(g, '不参与编译', 1125, 822, { sc: pop(t2), c: C.red, tc: C.red, fs: 26 });
    const t3 = seg(lt, 12.6, 12.9);
    if (t3 > 0) tagBox(g, '不参与编译', 1125, 136, { sc: pop(t3), c: C.red, tc: C.red, fs: 26 });
    // 文件流：被选中的目录 → 链接
    for (let i = 0; i < 4; i++) {
      flyFile(g, [1290, 300], [1360, 300], [1395, 430], seg(lt, 3.2 + i * .32, 4.0 + i * .32));
      flyFile(g, [1290, 650], [1360, 650], [1395, 470], seg(lt, 12.4 + i * .2, 13.0 + i * .2));
    }
    // 链接
    const [lx, ly, lw, lh] = P9.link, lk = seg(lt, 8.2, 8.8);
    frame(g, lx, ly, lw, lh, { p: seg(lt, 1.0, 2.0), lit: lk * .7, ticks: true, fill: rgba(C.plate, .5) });
    text(g, '链接', lx + 22, ly + 36, { s: 30, w: 900, a: 'left', al: seg(lt, 1.6, 2.0) });
    text(g, 'LINK', lx + lw - 22, ly + 36, { f: 'mono', s: 24, w: 700, a: 'right', c: C.faint, al: seg(lt, 1.6, 2.0) });
    text(g, '调用点', lx + 24, ly + 84, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, 2.0, 2.4) });
    text(g, 'aggregate_report();', lx + 24, ly + 124, { f: 'mono', s: 26, w: 700, a: 'left', al: seg(lt, 2.0, 2.4) });
    pipe(g, [[lx + 170, ly + 146], [lx + 170, ly + 200]], lt, { p: seg(lt, 8.6, 9.2), flow: seg(lt, 8.8, 9.2), head: true });
    const ip = seg(lt, 8.4, 9.0);
    frame(g, lx + 15, ly + 202, 400, 56, { p: ip, lit: lk * .8, fill: rgba(C.cyan, .08) });
    const impl = lt < 12.4 ? 'dual/aggregate_report.c' : 'single/aggregate_report.c';
    text(g, impl, lx + 215, ly + 231, { f: 'mono', s: 24, w: 700, c: C.cyan, al: seg(ip, .5, 1) * (lt > 12.3 && lt < 12.5 ? 0 : 1) });
    text(g, '定义 × 1', lx + lw - 22, ly + 280, { s: 24, w: 700, a: 'right', c: C.green, al: seg(lt, 9.6, 10.0) });
    stamp(g, '唯一定义', lx + lw / 2, 668, clamp((lt - 9.7) / .7), { c: C.green, icon: 'check', fs: 30 });
    chipIC(g, lx + 85, 725, 260, 76, lt < 12.4 ? '固件 · 双电机' : '固件 · 单电机', { p: seg(lt, 10.2, 10.9), lit: .6 });
    ripple(g, lx + 170, ly + 230, lt - 9.2);
  },
});

/* =====================================================================
 * 第五章：两刀正交，2×2
 * ===================================================================== */
const MX = [275, 605, 1125, 1645], MY = [136, 300, 556, 812];
function matrix26(g, lt, o = {}) {
  const x0 = MX[0], x1 = MX[3], y0 = MY[0], y1 = MY[3];
  frame(g, x0, y0, x1 - x0, y1 - y0, { p: seg(lt, 1.6, 2.6), ticks: true, fill: rgba(C.plate, .35) });
  draft(g, [[MX[1], y0], [MX[1], y1]], seg(lt, 1.9, 2.7), { w: 2.4 });
  draft(g, [[x0, MY[1]], [x1, MY[1]]], seg(lt, 2.0, 2.8), { w: 2.4 });
  // 表头角：对角线 + 两个维度
  draft(g, [[x0, y0], [MX[1], MY[1]]], seg(lt, 2.2, 2.8), { w: 1.6, c: C.ink2 });
  const c1 = seg(lt, 2.8, 3.6), c2 = seg(lt, 4.2, 5.0);
  text(g, '电机维度 ↓', x0 + 22, MY[1] - 32, { s: 26, w: 700, a: 'left', c: C.amber, al: seg(c1, .3, 1) });
  text(g, '开关 1', x0 + 22, MY[1] - 72, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(c1, .5, 1) });
  text(g, 'spec 维度 →', MX[1] - 20, y0 + 38, { s: 26, w: 700, a: 'right', c: C.amber, al: seg(c2, .3, 1) });
  text(g, '开关 2', MX[1] - 20, y0 + 78, { s: 24, w: 700, a: 'right', c: C.ink2, al: seg(c2, .5, 1) });
  // 行头：单 / 双电机固件
  const rp = seg(lt, 2.4, 3.4);
  curtain(g, x0 + 30, MY[1] + 70, 270, 'single', lt, { p: rp, ms: .52, h: 84, step: 24, open: .15 });
  text(g, '单电机固件', x0 + 165, MY[1] + 196, { s: 28, w: 900, al: seg(rp, .5, 1) });
  text(g, 'MOTOR_COUNT = 1', x0 + 165, MY[1] + 232, { f: 'mono', s: 24, w: 700, c: C.ink2, al: seg(rp, .6, 1) });
  curtain(g, x0 + 30, MY[2] + 70, 270, 'dual', lt, { p: seg(lt, 2.6, 3.6), ms: .52, h: 84, step: 24, open: .15 });
  text(g, '双电机固件', x0 + 165, MY[2] + 196, { s: 28, w: 900, al: seg(rp, .6, 1) });
  text(g, 'MOTOR_COUNT = 2', x0 + 165, MY[2] + 232, { f: 'mono', s: 24, w: 700, c: C.ink2, al: seg(rp, .7, 1) });
  // 列头：A / B 款 spec
  const hp = seg(lt, 3.8, 4.8);
  [['A 款 spec', '1 个窗帘服务', 1], ['B 款 spec', '3 个窗帘服务', 3]].forEach(([t1, t2, n], i) => {
    const cx = MX[1 + i];
    specDoc(g, cx + 70, y0 + 28, 82, 112, n, seg(hp, i * .15, .8 + i * .15));
    text(g, t1, cx + 320, y0 + 64, { s: 34, w: 900, al: seg(hp, .4, 1) });
    text(g, t2, cx + 320, y0 + 112, { s: 24, w: 700, c: C.ink2, al: seg(hp, .5, 1) });
  });
  // 两刀：刀口带冷光与火花，切过之后留下实线
  const cutA = eio(c1), yA = MY[2], xa = lerp(x0, x1, cutA);
  if (c1 > 0) {
    path(g, [[x0, yA], [xa, yA]], { c: C.ink, w: 3, glow: (1 - seg(lt, 3.6, 4.2)) });
    if (c1 < 1) { path(g, [[Math.max(x0, xa - 140), yA], [xa, yA]], { c: C.cyan, w: 5, glow: 1, gb: 22 }); sparks(g, xa, yA, (lt * 7) % .6, C.cyan, 8, 46); }
  }
  const cutB = eio(c2), xB = MX[2], yb = lerp(y0, y1, cutB);
  if (c2 > 0) {
    path(g, [[xB, y0], [xB, yb]], { c: C.ink, w: 3, glow: (1 - seg(lt, 5.0, 5.6)) });
    if (c2 < 1) { path(g, [[xB, Math.max(y0, yb - 140)], [xB, yb]], { c: C.cyan, w: 5, glow: 1, gb: 22 }); sparks(g, xB, yb, (lt * 7) % .6, C.cyan, 8, 46); }
  }
  // 正交标记
  const om = seg(lt, 6.3, 6.7);
  if (om > 0) { path(g, [[xB + 22 * om, yA], [xB + 22 * om, yA - 22 * om], [xB, yA - 22 * om]], { c: C.amber, w: 3 }); ripple(g, xB, yA, lt - 6.3, C.amber, 10, 70); }
  // 四格
  const cells = [[0, 0, '单电机 + A 款', true, '出货产品 1'], [1, 0, '单电机 + B 款'], [0, 1, '双电机 + A 款'], [1, 1, '双电机 + B 款', true, '出货产品 2']];
  cells.forEach(([ci, ri, name, real, stampTxt], k) => {
    const cx = MX[1 + ci], cy = MY[1 + ri], cw = MX[2 + ci] - cx, ch = MY[2 + ri] - cy, t0 = 6.6 + k * .4;
    const lp = real ? seg(lt, ri ? 10.8 : 10.2, (ri ? 10.8 : 10.2) + .5) : 0, off = real ? 0 : seg(lt, 11.8, 12.3);
    frame(g, cx + 16, cy + 16, cw - 32, ch - 32, { p: seg(lt, t0, t0 + .5), lit: lp, dash: off > .5 ? [10, 8] : null, c: off > .5 ? C.faint : C.ink, lw: 2, fill: real ? rgba(C.ink, .03 + .09 * lp) : rgba(C.ink, .02) });
    at(g, cx + cw / 2, cy + 52, pop(seg(lt, t0 + .1, t0 + .5)), () => text(g, name, 0, 0, { s: 28, w: 700, c: real && lp > .5 ? C.ink : off > .5 ? C.faint : C.ink2 }));
    if (real && lp > 0) {
      curtain(g, cx + 48, cy + 128, 230, ri ? 'dual' : 'single', lt, { p: lp, ms: .45, h: 70, step: 22, open: .1 + .1 * Math.sin(lt * .8 + k), lit: lp });
      text(g, '+', cx + 322, cy + 150, { f: 'disp', s: 44, w: 900, c: C.ink2, al: lp });
      specDoc(g, cx + 352, cy + 86, 66, 88, ri ? 3 : 1, lp);
      stamp(g, stampTxt, cx + 385, cy + 204, clamp((lt - (ri ? 11.3 : 10.7)) / .7), { fs: 26, seed: k });
    }
    if (off > 0) text(g, '配置空间', cx + cw / 2, cy + 150, { s: 26, w: 700, c: C.faint, al: off });
  });
}
S('s26', {
  cam: [[0, 960, 540, 1.0], [10.0, 960, 540, 1.0], [14.8, 960, 500, 1.03]],
  cues: [[1.7, 'draw'], [2.4, 'draw', .6], [2.8, 'latch'], [3.0, 'whoosh', .6], [4.2, 'latch'], [4.4, 'whoosh', .6], [6.3, 'blip'], [6.6, 'tick', .5], [7.0, 'tick', .5], [7.4, 'tick', .5], [7.8, 'tick', .5], [10.2, 'success', .6], [10.7, 'stamp'], [10.8, 'success', .6], [11.3, 'stamp']],
  draw(g, lt) { matrix26(g, lt); },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  g.save(); g.translate(960, 660); g.scale(.74, .74); g.translate(-960, -474); matrix26(g, 14); g.restore();
  text(g, '370 处差异，收进两个目录', 960, 128, { s: 104, w: 900 });
  text(g, '窗帘单双电机与 spec 隔离', 960, 226, { s: 46, w: 700, c: C.cyan });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
