/* =====================================================================
 * 窗帘单双电机与 spec 隔离 —— 编排（字幕与章节在 script.js，图元在 kit.js）
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]。章节编号：0 开场、1 片名、2–7 六章、8 总结、9 片尾。
 * 36 幕全部注册（样片阶段先写了 s03、s09、s26）。
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

const posOn = (pts, k) => { const q = partial(pts, k); return q[q.length - 1]; };
/* 事件胶囊：多格（类型 | 端点 | 值），lit 为逐格亮度 */
function evtCap(g, x, y, cells, o = {}) {
  const fs = o.fs || 24, ws = cells.map(c => textW(g, c, { f: 'mono', s: fs, w: 700 }) + 30), w = ws.reduce((a, b) => a + b, 0), h = fs + 26, c = o.c || C.cyan;
  at(g, x, y, o.s ?? 1, () => {
    g.save(); if (o.glow) glowOn(g, o.glow, 18, c); g.fillStyle = rgba(C.plate, .9); g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = c; g.lineWidth = 2.5; g.strokeRect(-w / 2, -h / 2, w, h); g.restore();
    let xx = -w / 2;
    cells.forEach((s, i) => {
      if (i) path(g, [[xx, -h / 2], [xx, h / 2]], { c: rgba(c, .6), w: 1.5 });
      const lit = o.lit ? o.lit[i] ?? 1 : 1;
      if (lit > 0 && o.lit) { g.save(); g.globalAlpha *= lit; g.fillStyle = rgba(c, .18); g.fillRect(xx + 2, -h / 2 + 2, ws[i] - 4, h - 4); g.restore(); }
      text(g, s, xx + ws[i] / 2, 1, { f: 'mono', s: fs, w: 700, c: o.tc?.[i] || C.ink, al: o.lit ? .35 + .65 * lit : 1 });
      xx += ws[i];
    });
  }, { al: o.al, rot: o.rot });
  return w;
}
/* 云朵线稿 */
function cloud(g, x, y, s, label, o = {}) {
  at(g, x, y, s, () => {
    g.save(); g.beginPath(); g.moveTo(-84, 34);
    g.arc(-62, 8, 27, Math.PI * .55, Math.PI * 1.5); g.arc(-16, -14, 38, Math.PI * 1.1, Math.PI * 1.9); g.arc(36, -8, 30, Math.PI * 1.3, Math.PI * 2.1); g.arc(70, 14, 21, Math.PI * 1.55, Math.PI * .5);
    g.closePath(); g.fillStyle = rgba(C.ink, .07); g.fill(); if (o.lit) glowOn(g, o.lit); g.strokeStyle = C.ink; g.lineWidth = 2.6; g.stroke(); g.restore();
    if (label) text(g, label, 0, 10, { s: 26, w: 700 });
  }, { al: o.al });
}
/* 便签（略倾斜） */
function note(g, s, x, y, k, o = {}) { if (k > 0) tagBox(g, s, x, y, { sc: pop(k), rot: o.rot ?? -.05, c: o.c || C.amber, tc: o.tc || C.amber, fs: o.fs || 26, fill: rgba(C.plate, .85) }); }
/* 天平：tilt>0 向左沉 */
function balance(g, x, y, tilt, l, r, al = 1) {
  if (al <= 0) return;
  g.save(); g.globalAlpha *= al;
  path(g, [[x, y + 120], [x, y]], { w: 3 }); path(g, [[x - 60, y + 120], [x + 60, y + 120]], { w: 3 });
  const a = -tilt * .22, dx = Math.cos(a) * 170, dy = Math.sin(a) * 170;
  path(g, [[x - dx, y - dy], [x + dx, y + dy]], { w: 3 }); dot(g, x, y, 7, C.amber);
  for (const [px, py, s] of [[x - dx, y - dy, l], [x + dx, y + dy, r]]) {
    path(g, [[px, py], [px - 50, py + 60]], { c: C.ink2, w: 1.6 }); path(g, [[px, py], [px + 50, py + 60]], { c: C.ink2, w: 1.6 });
    path(g, [[px - 70, py + 60], [px + 70, py + 60]], { w: 3 });
    text(g, s, px, py + 92, { s: 24, w: 700, c: C.ink2 });
  }
  g.restore();
}
function anchorIcon(g, x, y, s, o = {}) {
  at(g, x, y, s, () => {
    const c = o.c || C.ink; ring(g, 0, -62, 12, c, 4); path(g, [[0, -50], [0, 52]], { c, w: 5 }); path(g, [[-30, -28], [30, -28]], { c, w: 5 });
    g.save(); g.beginPath(); g.arc(0, 4, 50, Math.PI * .12, Math.PI * .88); g.strokeStyle = c; g.lineWidth = 5; g.lineCap = 'round'; g.stroke(); g.restore();
    tip(g, 45, 26, -Math.PI * .1, c, 16); tip(g, -45, 26, Math.PI * 1.1, c, 16);
  }, { rot: o.rot, al: o.al });
}
function scissors(g, x, y, s, open, o = {}) {
  at(g, x, y, s, () => {
    const c = o.c || C.red, a = .08 + open * .35;
    for (const sg of [1, -1]) {
      g.save(); g.rotate(sg * a);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(110, -6 * sg); g.lineTo(110, 4 * sg); g.closePath(); g.fillStyle = rgba(c, .25); g.fill(); g.strokeStyle = c; g.lineWidth = 3; g.stroke();
      ring(g, -40, 16 * sg, 18, c, 4); path(g, [[-24, 10 * sg], [0, 0]], { c, w: 4 });
      g.restore();
    }
    dot(g, 0, 0, 5, c);
  }, { rot: o.rot, al: o.al });
}
function eraser(g, x, y, s, o = {}) {
  at(g, x, y, s, () => {
    g.save(); g.rotate(-.5); g.fillStyle = rgba(C.ink, .12); g.fillRect(-60, -24, 120, 48); g.strokeStyle = C.ink; g.lineWidth = 2.5; g.strokeRect(-60, -24, 120, 48);
    g.fillStyle = rgba(C.red, .35); g.fillRect(-60, -24, 36, 48); path(g, [[-24, -24], [-24, 24]], { w: 2 }); g.restore();
  }, { al: o.al });
}
/* 终端窗口（复刻，非录屏） */
function terminal(g, x, y, w, h, title, p = 1, o = {}) {
  frame(g, x, y, w, h, { p, fill: rgba(C.plate, .8), lw: 2 });
  const q = seg(p, .5, 1); if (q <= 0) return;
  path(g, [[x, y + 44], [x + w, y + 44]], { c: rgba(C.ink, .35), w: 1.4, al: q });
  for (let i = 0; i < 3; i++) ring(g, x + 22 + i * 20, y + 22, 5, rgba(C.ink, .6), 1.6, q);
  text(g, title, x + w - 20, y + 23, { f: 'mono', s: 24, w: 700, a: 'right', c: C.faint, al: q });
}
/* 一排断言勾：n 个，k 已打勾的比例 */
function checkRow(g, x, y, n, k, per = 8) {
  for (let i = 0; i < n; i++) {
    const cx = x + (i % per) * 64, cy = y + Math.floor(i / per) * 60, on = seg(k * n, i, i + 1);
    frame(g, cx - 22, cy - 22, 44, 44, { lw: 1.6, construct: false, c: on > 0 ? C.green : C.faint, fill: on > 0 ? rgba(C.green, .12) : rgba(C.ink, .03) });
    if (on > 0) check(g, cx, cy + 2, 28, on, { w: 4 });
  }
}
/* 插座 / 插头（调用点与实现的接线比喻） */
function socket(g, x, y, o = {}) {
  frame(g, x - 60, y - 40, 120, 80, { lw: 2.5, construct: false, lit: o.lit, fill: rgba(C.plate, .7) });
  for (const dx of [-22, 22]) { g.save(); g.fillStyle = C.bg0; g.fillRect(x + dx - 6, y - 16, 12, 32); g.strokeStyle = C.ink; g.lineWidth = 1.6; g.strokeRect(x + dx - 6, y - 16, 12, 32); g.restore(); }
}
function plug(g, x, y, label, o = {}) {
  const c = o.c || C.cyan;
  at(g, x, y, 1, () => {
    for (const dx of [-22, 22]) { g.save(); g.fillStyle = C.ink2; g.fillRect(dx - 4, -46, 8, 34); g.restore(); }
    frame(g, -80, -14, 160, 56, { lw: 2.5, construct: false, c, fill: rgba(c, .12), lit: o.lit });
    text(g, label, 0, 14, { f: 'mono', s: 24, w: 700, c });
    path(g, [[0, 42], [0, 90]], { c, w: 3 });
  }, { al: o.al, rot: o.rot });
}

/* =====================================================================
 * 开场
 * ===================================================================== */
S('s01', {
  fi: .6,
  cam: [[0, 640, 400, 1.3], [3.6, 640, 400, 1.3], [5.4, 760, 540, 1.0], [6.8, 960, 540, 1.0], [12, 960, 540, 1.02]],
  cues: [[.2, 'draw'], [1.6, 'tick', .6], [4.4, 'draw'], [5.8, 'tick', .6], [7.4, 'whoosh'], [8.0, 'whoosh', .6]],
  draw(g, lt) {
    const o1 = .2 + .25 * (1 - Math.cos(lt * .7)) / 2;
    curtain(g, 300, 270, 640, 'single', lt, { p: seg(lt, .2, 2.0), open: o1, h: 130 });
    dimLine(g, 300, 440, 940, 440, '单电机版 · 电机 × 1', seg(lt, 1.6, 2.6), { f: 'cjk', s: 26, lo: -30, lc: C.ink });
    curtain(g, 300, 610, 640, 'dual', lt, { p: seg(lt, 4.4, 6.0), open: o1, h: 130 });
    dimLine(g, 300, 780, 940, 780, '双电机版 · 电机 × 2', seg(lt, 5.8, 6.8), { f: 'cjk', s: 26, lo: -30, lc: C.ink });
    const k = seg(lt, 7.4, 8.2), k2 = seg(lt, 8.0, 8.8);
    cloud(g, 1440, 230, 1.3 * pop(seg(lt, 7.3, 7.9)), '云端');
    at(g, 1290 + (1 - eo(k)) * 300, 470, 1, () => { specDoc(g, -75, -100, 150, 200, 1, k); text(g, 'A 款 spec', 0, 140, { s: 28, w: 900, al: k }); }, { al: k });
    at(g, 1590 + (1 - eo(k2)) * 300, 470, 1, () => { specDoc(g, -75, -100, 150, 200, 3, k2); text(g, 'B 款 spec', 0, 140, { s: 28, w: 900, al: k2 }); }, { al: k2 });
    pipe(g, [[1290, 360], [1380, 300]], lt, { p: seg(lt, 8.4, 9.0), flow: .5 }); pipe(g, [[1590, 360], [1500, 300]], lt, { p: seg(lt, 8.6, 9.2), flow: .5 });
    text(g, '属性规范，各不相同', 1440, 700, { s: 26, w: 700, c: C.amber, al: seg(lt, 9.2, 9.8) });
  },
});
const MAP = Array.from({ length: 32 }, (_, i) => [300 + (i % 8) * 166, 190 + Math.floor(i / 8) * 150]);
S('s02', {
  cam: [[0, 960, 540, 1.0], [4.2, 960, 540, 1.04], [12.6, 960, 540, 1.0]],
  cues: [[.5, 'draw', .6], [1.0, 'tick', .4], [1.8, 'tick', .5], [2.6, 'tick', .6], [3.3, 'tick', .7], [4.0, 'error'], [4.4, 'blip'], [7.9, 'blip']],
  draw(g, lt) {
    MAP.forEach(([x, y], i) => {
      const p = seg(lt, i * .012, .5 + i * .012);
      frame(g, x, y, 140, 112, { p, lw: 1.8, fill: rgba(C.ink, .03) });
      if (p > .8) for (let j = 0; j < 4; j++) path(g, [[x + 16, y + 26 + j * 20], [x + 16 + (60 + hash(i * 7 + j) * 60), y + 26 + j * 20]], { c: rgba(C.ink, .3), w: 2 });
    });
    const n = Math.floor(370 * Math.pow(seg(lt, .4, 4.0), 1.6)), fade = 1 - .7 * seg(lt, 4.2, 4.8);
    for (let i = 0; i < n; i++) { const b = MAP[Math.floor(hash(i * 1.7) * 32)]; ring(g, b[0] + 14 + hash(i * 3.1) * 112, b[1] + 14 + hash(i * 5.3) * 84, 6, C.red, 2, fade); }
    if (lt > .4) text(g, `约 ${n} 处`, 1640, 168, { f: 'cjk', s: 40, w: 900, a: 'right', c: C.amber, al: seg(lt, .4, .8) * fade });
    const q = seg(lt, 4.2, 4.8);
    if (q > 0) {
      frame(g, 600, 360, 720, 220, { p: q, fill: rgba(C.plate, .88), lw: 2.5 });
      redCircle(g, 960, 470, 410, 150, seg(lt, 4.4, 5.2), { seed: 3 });
      text(g, '只写一份？', 960, 430, { s: 60, w: 900, al: seg(lt, 4.5, 4.9) });
      text(g, '一行不改？', 960, 510, { s: 60, w: 900, c: C.cyan, al: seg(lt, 7.8, 8.2) });
    }
  },
});

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
    balloon(g, 1350, 150, 24, '1', seg(lt, 1.3, 1.9), { from: [1230, 190] });
    text(g, '电机', 1386, 150, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, 1.6, 2.0) });
    balloon(g, 560, 196, 24, '2', seg(lt, 1.5, 2.1), { from: [660, 257] });
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
 * 第一章：先分类，再动手
 * ===================================================================== */
S('s04', {
  cam: [[0, 960, 540, 1.0], [6.4, 960, 540, 1.0], [8.0, 960, 520, 1.06], [13.8, 960, 520, 1.06], [15.0, 960, 540, 1.0]],
  cues: [[1.8, 'draw'], [2.2, 'whoosh'], [2.7, 'blip', .5], [3.1, 'blip', .5], [3.5, 'blip', .5], [6.8, 'blip'], [7.3, 'blip'], [10.4, 'draw'], [11.2, 'blip'], [14.6, 'whoosh', .5], [15.6, 'error']],
  draw(g, lt) {
    const sw = eo(seg(lt, 14.4, 15.0)), open = .12 + .12 * Math.sin(lt * .6);
    curtain(g, 560, 470, 800, 'dual', lt, { p: seg(lt, 1.6, 3.0) * (1 - sw), open, h: 150, ms: 1.05 });
    if (sw > 0) curtain(g, 560, 470, 800, 'single', lt, { p: sw, open, h: 150, ms: 1.05, motorLeft: true });
    const k = seg(lt, 2.2, 3.0);
    evtCap(g, lerp(-200, 960, eo(k)), 220, ['类型', '端点', '值'], { fs: 28, lit: [seg(lt, 2.7, 3.0), seg(lt, 3.1, 3.4), seg(lt, 3.5, 3.8)], glow: .5, al: k });
    frame(g, 480, 300, 960, 360, { p: seg(lt, 10.4, 11.4), dash: [14, 10], c: C.cyan, fill: rgba(C.cyan, .03), lw: 2 });
    balloon(g, 530, 300, 34, 'EP2', seg(lt, 6.8, 7.4), { from: [640, 405], fs: 24 });
    text(g, '左电机', 480, 300, { s: 24, w: 700, a: 'right', c: C.ink2, al: seg(lt, 7.2, 7.6) });
    const e3 = 1 - .55 * sw;
    balloon(g, 1390, 300, 34, 'EP3', seg(lt, 7.3, 7.9), { from: [1280, 405], fs: 24, al: e3, c: sw > .5 ? C.faint : C.ink });
    text(g, '右电机', 1440, 300, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, 7.6, 8.0) * e3 });
    redCross(g, 1390, 300, 60, seg(lt, 15.4, 15.9));
    balloon(g, 960, 300, 34, 'EP1', seg(lt, 11.2, 11.8), { c: C.cyan, tc: C.cyan, fs: 24 });
    text(g, '聚合视图（没有实体电机）', 960, 700, { s: 26, w: 700, c: C.cyan, al: seg(lt, 11.6, 12.0) * (1 - seg(lt, 14.4, 14.7)) });
    text(g, '单电机版：只有一台电机', 960, 700, { s: 26, w: 700, c: C.amber, al: seg(lt, 14.7, 15.0) });
  },
});
const OLD = ['// 旧代码（重写的示意）', 'pos = (ep == EP1) ? avg_pos() : cur[ep];', 'report(EP2, value);      // 写死 EP2', 'if (moving[0] && moving[1]) stop_all();', 'if (ep == EP3) return;'];
function codeMark(g, x, y, lines, li, sub, p, seed) { // 在 codeCard 的第 li 行给子串画红圈
  const line = lines[li], i = line.indexOf(sub), x0 = x + 26 + textW(g, line.slice(0, i), { f: 'mono', s: 26, w: 400 }), w = textW(g, sub, { f: 'mono', s: 26, w: 400 }), yy = y + 64 + li * 42 + 21;
  redCircle(g, x0 + w / 2, yy, w / 2 + 16, 24, p, { seed }); return [x0 + w + 16, yy];
}
S('s05', {
  cam: [[0, 700, 470, 1.15], [10.8, 700, 470, 1.15], [12.0, 960, 540, 1.0]],
  cues: [[.5, 'type'], [3.8, 'draw'], [5.4, 'draw'], [8.0, 'draw'], [11.4, 'whoosh'], [13.4, 'whoosh', .6]],
  draw(g, lt) {
    const X = 200, Y = 250;
    codeCard(g, X, Y, 860, OLD, { p: seg(lt, .4, 3.0), lt, title: 'old.c' });
    const marks = [[1, '(ep == EP1) ? avg_pos() : cur[ep]', 3.8, '1'], [2, 'EP2', 5.4, '2'], [3, '&&', 8.0, '3']];
    const labs = ['三元判断', '写死端点', '跨电机 && / ||'], la = 1 - seg(lt, 10.8, 11.2);
    marks.forEach(([li, sub, t0, n], i) => {
      const [, my] = codeMark(g, X, Y, OLD, li, sub, seg(lt, t0, t0 + .6), i + 2), bx = X + 900, ex = X + 40 + textW(g, OLD[li], { f: 'mono', s: 26, w: 400 });
      balloon(g, bx, my, 22, n, seg(lt, t0 + .3, t0 + .8), { c: C.red, tc: C.red, from: [ex, my], al: la });
      text(g, labs[i], bx + 36, my + 1, { s: 26, w: 700, a: 'left', c: C.red, al: seg(lt, t0 + .5, t0 + .9) * la });
    });
    // 两条分支：新功能要在两边各走一遍
    const q = seg(lt, 11.3, 12.0);
    frame(g, 1250, 250, 220, 64, { p: q, lit: .4 }); text(g, '新功能', 1360, 283, { s: 28, w: 900, al: q });
    for (const [yy, lab, t0] of [[470, '单电机分支', 11.7], [640, '双电机分支', 12.0]]) {
      pipe(g, [[1360, 314], [1360, yy - 40], [1250, yy - 40], [1250, yy]], lt, { p: seg(lt, t0, t0 + .5) });
      draft(g, [[1250, yy], [1720, yy]], seg(lt, t0 + .2, t0 + .8), { w: 2.6 });
      text(g, lab, 1270, yy - 24, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, t0 + .4, t0 + .8) });
    }
    for (const [yy, t0] of [[470, 12.2], [640, 13.6]]) { const k = seg(lt, t0, t0 + 1.3); if (k > 0) { const x = lerp(1290, 1640, eio(k)); frame(g, x - 40, yy - 22, 80, 44, { lit: .8, construct: false, lw: 2, c: C.cyan }); text(g, '功能', x, yy + 1, { s: 24, w: 700, c: C.cyan }); } }
  },
});
const CAB = Array.from({ length: 11 }, (_, i) => 316 + i * 118);
S('s06', {
  cues: [[.5, 'draw'], [3.8, 'whoosh'], [4.4, 'tick', .4], [5.0, 'tick', .5], [5.6, 'tick', .6], [6.2, 'tick', .7], ...Array.from({ length: 11 }, (_, i) => [7.5 + i * .24, 'stamp', .55])],
  draw(g, lt) {
    const lettersP = seg(lt, .4, 2.2);
    CAB.forEach((x, i) => {
      frame(g, x - 52, 470, 104, 170, { p: seg(lettersP, i * .04, .5 + i * .04), lw: 2.2, fill: rgba(C.plate, .5) });
      path(g, [[x - 20, 600], [x + 20, 600]], { w: 4, al: seg(lettersP, .5, 1) });
      text(g, String.fromCharCode(65 + i), x, 520, { f: 'disp', s: 44, w: 900, al: seg(lettersP, .3 + i * .03, .7 + i * .03) });
    });
    const N = 121;
    for (let i = 0; i < N; i++) {
      const sx = 160 + hash(i * 2.3) * 1600, sy = 170 + hash(i * 4.7) * 190, d = i % 11, ts = 3.7 + hash(i * 9.1) * 2.6, k = seg(lt, ts, ts + .9);
      if (k >= 1) continue;
      const tx = CAB[d], ty = 560, u = eio(k), x = lerp(sx, tx, u), y = lerp(sy, ty, u) - Math.sin(u * Math.PI) * 60;
      ring(g, x, y, 6, C.red, 2, (1 - .5 * k) * seg(lt, 0, .6));
    }
    CAB.forEach((x, i) => { // 抽屉里的填充（只表示“收进来”，不代表各类数量）
      const f = seg(lt, 4.2 + i * .05, 6.6 + i * .05);
      if (f > 0) { g.save(); g.fillStyle = rgba(C.red, .25); g.fillRect(x - 44, 634 - 26 * f, 88, 26 * f); g.restore(); }
      stamp(g, '拍板', x, 690, clamp((lt - 7.5 - i * .24) / .6), { fs: 24, seed: i, rot: -.12 + hash(i) * .08 });
    });
    text(g, '约 370 处', 960, 140, { s: 34, w: 900, c: C.amber, al: seg(lt, .6, 1.0) * (1 - seg(lt, 3.6, 4.0)) });
    text(g, '约 370 处  →  A~K 共 11 类', 960, 400, { s: 34, w: 900, c: C.amber, al: seg(lt, 4.0, 4.4) });
  },
});
const STEP6 = Array.from({ length: 6 }, (_, i) => 330 + i * 252);
S('s07', {
  cues: [[.4, 'draw'], ...STEP6.map((_, i) => [3.5 + i * .55, 'tick', .6]), [7.2, 'blip'], [10.9, 'draw'], [11.6, 'error']],
  draw(g, lt) {
    draft(g, [[260, 300], [1660, 300]], seg(lt, .3, 1.6), { w: 3 });
    text(g, '重构路线', 260, 240, { s: 30, w: 900, a: 'left', al: seg(lt, .5, .9) });
    const prog = seg(lt, 3.4, 6.8);
    STEP6.forEach((x, i) => {
      const t0 = .6 + i * .15, reach = 3.5 + i * .55, on = lt >= reach;
      at(g, x, 300, pop(seg(lt, t0, t0 + .4)), () => { dot(g, 0, 0, 34, on ? C.cyan : C.bg1); ring(g, 0, 0, 34, C.ink, 3); text(g, String(i + 1), 0, 2, { f: 'disp', s: 34, w: 900, c: on ? C.bg0 : C.ink }); });
      ripple(g, x, 300, lt - reach, C.cyan, 34, 90);
      stamp(g, '可编译', x, 400, clamp((lt - reach - .1) / .6), { fs: 24, icon: 'check', c: C.green, seed: i, rot: -.06 });
      stamp(g, '可回归', x, 470, clamp((lt - reach - .3) / .6), { fs: 24, icon: 'check', c: C.green, seed: i + 9, rot: -.06 });
    });
    if (prog > 0 && prog < 1) dot(g, lerp(260, 1660, prog), 300, 9, C.amber);
    note(g, '// ABSTRACT-ME：标出旧代码出处', 620, 640, seg(lt, 7.1, 7.6), { fs: 26, c: C.cyan, tc: C.cyan });
    const r = seg(lt, 10.8, 11.4);
    if (r > 0) { frame(g, 1180, 580, 440, 200, { p: r, fill: rgba(C.ink, .05) }); hatch(g, 1182, 582, 436, 196, r, { c: rgba(C.ink, .15) }); text(g, '推倒重写', 1400, 680, { s: 40, w: 900, al: r }); redCross(g, 1400, 680, 200, seg(lt, 11.6, 12.3), { w: 7 }); }
  },
});

/* =====================================================================
 * 第二章：同名符号，构建时二选一
 * ===================================================================== */
const FNS = ['motor_*()', 'travel_*()', 'aggregate_report()'];
S('s08', {
  cues: [[1.8, 'draw'], [2.4, 'draw', .6], [3.2, 'draw', .6], [6.0, 'draw', .6], [7.0, 'blip'], [10.6, 'whoosh'], [11.4, 'latch']],
  draw(g, lt) {
    frame(g, 560, 150, 800, 100, { p: seg(lt, 1.6, 2.4), ticks: true, fill: rgba(C.plate, .5) });
    text(g, '公共业务层', 584, 200, { s: 28, w: 900, a: 'left', al: seg(lt, 2.0, 2.4) });
    ['curtain.c', 'travel.c', 'storage.c'].forEach((f, i) => { fileIcon(g, 840 + i * 170, 172, 34, 44, { al: seg(lt, 2.1 + i * .1, 2.5 + i * .1) }); text(g, f, 884 + i * 170, 196, { f: 'mono', s: 24, w: 700, a: 'left', al: seg(lt, 2.2 + i * .1, 2.6 + i * .1) }); });
    frame(g, 560, 330, 800, 150, { p: seg(lt, 2.2, 3.0), ticks: true, lit: seg(lt, 2.6, 3.2) * .5, fill: rgba(C.plate, .5) });
    text(g, 'variant 公共头', 584, 362, { s: 28, w: 900, a: 'left', al: seg(lt, 2.6, 3.0) });
    FNS.forEach((f, i) => text(g, f, 600 + i * 250, 430, { f: 'mono', s: 24, w: 700, a: 'left', c: C.cyan, al: seg(lt, 2.8 + i * .2, 3.2 + i * .2) }));
    const fold = [[260, 'variant/single/', 3.0], [1180, 'variant/dual/', 3.3]];
    fold.forEach(([x, name, t0]) => {
      folder(g, x, 560, 480, 250, name, 0, { p: seg(lt, t0, t0 + 1.0), lit: seg(lt, 7.0, 7.5) * .5 });
      FNS.forEach((f, i) => text(g, f, x + 30, 670 + i * 42, { f: 'mono', s: 24, w: 700, a: 'left', c: seg(lt, 6.4 + i * .3, 6.8 + i * .3) > 0 ? C.cyan : C.ink2, al: seg(lt, t0 + .6, t0 + 1.0) }));
    });
    FNS.forEach((f, i) => { // 同名对齐：头文件的名字 → 两个目录里的同名实现
      const sx = 600 + i * 250 + 60, k = seg(lt, 5.9 + i * .3, 6.6 + i * .3);
      arrow(g, [[sx, 450], [sx, 510], [380 + i * 110, 510], [380 + i * 110, 572]], { p: k, c: rgba(C.cyan, .75), w: 1.8, dash: [6, 6], hs: 14 });
      arrow(g, [[sx, 450], [sx, 510], [1300 + i * 110, 510], [1300 + i * 110, 572]], { p: k, c: rgba(C.cyan, .75), w: 1.8, dash: [6, 6], hs: 14 });
    });
    arrow(g, [[960, 250], [960, 328]], { p: seg(lt, 10.5, 11.0), c: C.ink, w: 3.5 });
    text(g, '直接调用', 990, 290, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, 10.7, 11.1) });
    note(g, '不问是哪款', 1500, 290, seg(lt, 11.3, 11.8), { c: C.cyan, tc: C.cyan });
  },
});
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

/* 带居中文字的框 */
function box(g, x, y, w, h, label, p = 1, o = {}) {
  frame(g, x, y, w, h, { p, lit: o.lit, dash: o.dash, c: o.c, fill: o.fill || rgba(C.plate, .6), lw: o.lw, ticks: o.ticks });
  if (label) text(g, label, x + w / 2, y + h / 2 + 1, { f: o.f || 'cjk', s: o.fs || 26, w: 700, c: o.tc || (o.lit > .5 ? C.cyan : C.ink), al: seg(p, .5, 1) * (o.tal ?? 1) });
}
function clockIcon(g, x, y, r, lt, al = 1) {
  ring(g, x, y, r, C.amber, 2.4, al); const a = lt * 4;
  path(g, [[x, y], [x + Math.cos(a) * r * .7, y + Math.sin(a) * r * .7]], { c: C.amber, w: 2.4, al }); path(g, [[x, y], [x, y - r * .5]], { c: C.amber, w: 2.4, al });
}
function strike(g, x0, x1, y, p, c = C.red) { if (p > 0) path(g, [[x0, y], [lerp(x0, x1, eo(p)), y + 2]], { c, w: 4 }); }
function gate(g, x, y, gone, o = {}) { // 闸门：两根立柱 + 横杆；gone 1 时变虚线并淡出
  const al = 1 - .65 * gone, c = gone > .5 ? C.faint : (o.c || C.amber);
  path(g, [[x - 34, y - 60], [x - 34, y + 60]], { c, w: 4, al, dash: gone > .5 ? [8, 8] : null }); path(g, [[x + 34, y - 60], [x + 34, y + 60]], { c, w: 4, al, dash: gone > .5 ? [8, 8] : null });
  path(g, [[x - 34, y - 60], [x + 34, y - 60]], { c, w: 4, al });
  if (o.label) text(g, o.label, x + (o.side || 0) * 44, y - 88, { f: 'mono', s: 24, w: 700, a: o.side < 0 ? 'right' : o.side > 0 ? 'left' : 'center', c: gone > .5 ? C.faint : C.ink2, al });
}
function lockIcon(g, x, y, s, closed, al = 1) {
  at(g, x, y, s, () => {
    g.save(); g.translate(0, -(1 - closed) * 16); g.beginPath(); g.arc(0, -22, 22, Math.PI, 0); g.lineWidth = 7; g.strokeStyle = C.amber; g.stroke(); g.restore();
    g.save(); g.fillStyle = rgba(C.plate, .95); g.fillRect(-32, -22, 64, 50); g.strokeStyle = C.amber; g.lineWidth = 3; g.strokeRect(-32, -22, 64, 50); g.restore(); dot(g, 0, 0, 6, C.amber);
  }, { al });
}

S('s10', {
  cues: [[.5, 'draw'], [1.6, 'latch'], [1.8, 'latch'], [4.6, 'whoosh', .6], [5.2, 'error'], [8.3, 'draw', .6], [8.9, 'draw', .6], [9.5, 'draw', .6], [10.2, 'success']],
  draw(g, lt) {
    [[140, '单电机固件', 'single/', 0], [1000, '双电机固件', 'dual/', .2]].forEach(([x, name, impl, d]) => {
      frame(g, x, 170, 780, 560, { p: seg(lt, .3 + d, 1.1 + d), ticks: true, fill: rgba(C.plate, .35) });
      text(g, name, x + 30, 212, { s: 30, w: 900, a: 'left', al: seg(lt, .7 + d, 1.1 + d) });
      text(g, 'aggregate_report();', x + 390, 290, { f: 'mono', s: 30, w: 700, c: C.cyan, al: seg(lt, .9 + d, 1.3 + d) });
      const sy = 440, k = eo(seg(lt, .9 + d, 1.7 + d));
      socket(g, x + 390, sy);
      plug(g, x + 390, lerp(sy + 230, sy + 30, k), impl, { al: seg(lt, .8 + d, 1.0 + d), lit: seg(lt, 1.6 + d, 2.0 + d) });
      ripple(g, x + 390, sy, lt - 1.7 - d);
    });
    text(g, '=', 960, 290, { f: 'disp', s: 56, w: 900, c: C.amber, al: seg(lt, 1.8, 2.2) });
    text(g, '调用点一模一样', 960, 350, { s: 24, w: 700, c: C.amber, al: seg(lt, 2.0, 2.4) });
    // 另一款的实现想插进来：插不进
    const g1 = seg(lt, 4.5, 5.2), g2 = seg(lt, 5.2, 5.7);
    if (g1 > 0) { const x = lerp(1720, 1460, eo(g1)) + 60 * Math.sin(g2 * Math.PI) * (g2 > 0 ? 1 : 0); plug(g, x, 640 - 40 * eo(g1), 'single/', { c: C.red, al: 1 - .5 * seg(lt, 6.4, 7.0), rot: -.3 }); }
    redCross(g, 1480, 440, 54, seg(lt, 5.3, 5.8));
    const words = [['运行时注册', 520, 8.3], ['查表', 820, 8.9], ['判空', 1040, 9.5]];
    words.forEach(([w, x, t0]) => { text(g, w, x, 800, { s: 30, w: 700, c: C.ink2, al: seg(lt, 7.9, 8.2) }); const tw = textW(g, w, { s: 30, w: 700 }); strike(g, x - tw / 2 - 6, x + tw / 2 + 6, 800, seg(lt, t0, t0 + .4)); });
    if (lt > 10.1) tagBox(g, '零运行时成本', 1420, 800, { sc: pop(seg(lt, 10.2, 10.6)), c: C.green, tc: C.green, fs: 28 });
  },
});
S('s11', {
  cues: [[.5, 'draw'], [1.0, 'tick', .5], [1.4, 'tick', .5], [1.8, 'tick', .5], [5.3, 'whoosh', .6], [6.2, 'error', .5], [9.2, 'whoosh'], [10.4, 'success']],
  draw(g, lt) {
    frame(g, 140, 160, 780, 660, { p: seg(lt, .3, 1.0), fill: rgba(C.plate, .35) });
    text(g, 'ops 函数指针表', 170, 200, { s: 30, w: 900, a: 'left', al: seg(lt, .6, 1.0) });
    const slots = ['.set_pos', '.report', '.stop'];
    slots.forEach((s, i) => {
      const y = 270 + i * 66, f = seg(lt, 1.0 + i * .4, 1.3 + i * .4);
      frame(g, 300, y, 360, 56, { p: seg(lt, .6 + i * .1, 1.2 + i * .1), lw: 2, fill: rgba(C.ink, .04) });
      text(g, s, 324, y + 29, { f: 'mono', s: 24, w: 700, a: 'left', al: seg(lt, .9, 1.2) });
      frame(g, 580, y + 10, 64, 36, { lw: 1.6, construct: false, fill: f > 0 ? rgba(C.cyan, .25 * f) : rgba(C.ink, .03), c: f > 0 ? C.cyan : C.faint });
      if (f > 0) dot(g, 612, y + 28, 7 * pop(f), C.cyan);
    });
    box(g, 190, 520, 200, 60, 'init()', seg(lt, .7, 1.1), { f: 'mono' });
    arrow(g, [[290, 520], [290, 470], [400, 470], [400, 470 - 4]], { p: seg(lt, 1.0, 1.4), c: C.ink2, w: 2 });
    text(g, '运行时注册', 430, 545, { s: 24, w: 700, a: 'left', c: C.amber, al: seg(lt, 1.2, 1.6) }); clockIcon(g, 600, 545, 16, lt, seg(lt, 1.2, 1.6));
    box(g, 190, 680, 200, 60, '调用', seg(lt, 5.1, 5.5));
    arrow(g, [[390, 710], [500, 710]], { p: seg(lt, 5.4, 5.8), c: C.ink2, w: 2 });
    const dm = seg(lt, 5.6, 6.0);
    if (dm > 0) { g.save(); g.globalAlpha *= dm; g.beginPath(); g.moveTo(580, 660); g.lineTo(650, 710); g.lineTo(580, 760); g.lineTo(510, 710); g.closePath(); g.fillStyle = rgba(C.amber, .12); g.fill(); g.strokeStyle = C.amber; g.lineWidth = 2.5; g.stroke(); g.restore(); text(g, '判空', 580, 711, { s: 24, w: 700, c: C.amber, al: dm }); }
    arrow(g, [[650, 710], [740, 710], [740, 420], [664, 420]], { p: seg(lt, 6.0, 6.8), c: C.ink2, w: 2 });
    clockIcon(g, 820, 710, 16, lt, seg(lt, 6.2, 6.6));
    // 右：同名符号，一笔直连
    frame(g, 1000, 160, 780, 660, { p: seg(lt, 8.8, 9.4), fill: rgba(C.plate, .35), lit: seg(lt, 9.6, 10.2) * .4 });
    text(g, '同名符号', 1030, 200, { s: 30, w: 900, a: 'left', al: seg(lt, 9.0, 9.4) });
    box(g, 1060, 420, 240, 64, '调用点', seg(lt, 9.0, 9.4));
    box(g, 1480, 420, 240, 64, '实现', seg(lt, 9.2, 9.6), { lit: seg(lt, 10.0, 10.4) });
    path(g, partial([[1300, 452], [1480, 452]], eo(seg(lt, 9.4, 9.9))), { c: C.cyan, w: 4, glow: .8 });
    text(g, '链接期绑定，没有中间表', 1390, 560, { s: 24, w: 700, c: C.ink2, al: seg(lt, 9.8, 10.2) });
    if (lt > 10.2) stamp(g, '链接器保证唯一', 1390, 650, clamp((lt - 10.3) / .7), { c: C.green, icon: 'check', fs: 28 });
  },
});
S('s12', {
  cues: [[.5, 'draw'], [1.2, 'blip'], [4.1, 'error'], [8.0, 'type'], [9.6, 'latch'], [11.7, 'tick'], [12.4, 'tick', .6]],
  draw(g, lt) {
    const rows = ['motor_*()', 'aggregate_report()'];
    [[240, 'variant/single/', 0], [1120, 'variant/dual/', .2]].forEach(([x, name, d]) => {
      folder(g, x, 160, 560, 300, name, 0, { p: seg(lt, .3 + d, 1.2 + d) });
      rows.forEach((r, i) => text(g, r, x + 30, 272 + i * 42, { f: 'mono', s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, .9 + d, 1.3 + d) }));
    });
    const own = seg(lt, 1.2, 1.6);
    frame(g, 1146, 350, 508, 64, { p: own, lit: .6, c: C.amber, fill: rgba(C.amber, .1), lw: 2 });
    text(g, '聚合状态缓存（双电机独有）', 1400, 383, { s: 26, w: 700, c: C.amber, al: own });
    const miss = seg(lt, 3.9, 4.3), bl = lt > 4.3 && lt < 7.8 ? .55 + .45 * Math.sin(lt * 8) : 1;
    frame(g, 266, 350, 508, 64, { p: miss, dash: [10, 8], c: C.red, fill: rgba(C.red, .05), lw: 2, al: bl });
    text(g, '没有对应物，给不了空实现', 520, 383, { s: 26, w: 700, c: C.red, al: miss * bl });
    codeCard(g, 240, 520, 780, ['#ifdef CURTAIN_DUAL_MOTOR', '    agg_cache_update(ep, st);', '#endif'], { p: seg(lt, 7.9, 9.4), lt, title: '调用方（示意）', hl: lt > 9.6 ? [0, 2] : [], hlA: seg(lt, 9.6, 10), al: seg(lt, 7.5, 7.9) });
    const tl = lt < 11.5 ? 0 : spring(lt - 11.6, 5, .9) * .7;
    balance(g, 1420, 560, tl, '零运行时成本', '调用方要 #ifdef', seg(lt, 11.4, 11.9));
    text(g, '让步', 1420, 500, { s: 28, w: 900, c: C.amber, al: seg(lt, 12.3, 12.7) });
  },
});

/* =====================================================================
 * 第三章：一份循环，跑一次或两次
 * ===================================================================== */
const L13 = ['#define MOTOR_COUNT 2   // 单电机固件里是 1', '#define FOR_EACH_MOTOR(i) \\', '    for (int i = 0; i < MOTOR_COUNT; i++)', '', 'FOR_EACH_MOTOR(i) { set_speed(i, v); }'];
S('s13', {
  cues: [[2.2, 'type'], [6.9, 'blip'], [7.3, 'blip'], [8.1, 'blip'], [10.3, 'latch']],
  draw(g, lt) {
    codeCard(g, 160, 230, 880, L13, { p: seg(lt, 2.2, 5.0), lt, title: 'motor_topology.h（示意）', hl: lt > 10.1 ? [2] : [], hlA: seg(lt, 10.1, 10.5) });
    if (lt > 10.1) { note(g, '编译期常量', 640, 176, seg(lt, 10.2, 10.6)); path(g, partial([[640, 200], [500, 294]], seg(lt, 10.4, 10.8)), { c: C.amber, w: 2 }); }
    const ph = lt < 6.8 ? -1 : (lt - 6.8) % 2.4;
    [[180, '单电机固件 · MOTOR_COUNT = 1', 1, 1.6], [530, '双电机固件 · MOTOR_COUNT = 2', 2, 1.9]].forEach(([y, title, n, t0]) => {
      frame(g, 1120, y, 660, 300, { p: seg(lt, t0, t0 + .8), fill: rgba(C.plate, .4) });
      text(g, title, 1144, y + 34, { s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, t0 + .4, t0 + .8) });
      let cur = -1;
      for (let i = 0; i < n; i++) {
        const on = ph >= i * .8 && ph < i * .8 + .6; if (on) cur = i;
        motor(g, 1260 + i * 260, y + 170, .85, lt, { p: seg(lt, t0 + .3, t0 + 1.1), lit: on ? 1 : 0, led: on ? 1 : .3, spin: on ? 6 : .3, seed: i });
      }
      const label = ph < 0 ? '' : cur >= 0 ? `i = ${cur}` : '循环结束';
      if (label) text(g, label, 1740, y + 250, { f: label.startsWith('i') ? 'mono' : 'cjk', s: 28, w: 700, a: 'right', c: cur >= 0 ? C.cyan : C.green });
    });
  },
});
S('s14', {
  cues: [[.5, 'draw'], [1.5, 'tick'], [4.9, 'tick'], [5.5, 'tick'], [6.1, 'tick'], [7.7, 'blip']],
  draw(g, lt) {
    const bins = [[300, 'FOR_EACH 宏'], [1060, '#ifdef']];
    bins.forEach(([x, name], i) => {
      frame(g, x, 590, 560, 230, { p: seg(lt, .3 + i * .2, 1.1 + i * .2), ticks: true, fill: rgba(C.plate, .45) });
      text(g, name, x + 280, 560, { f: i ? 'mono' : 'cjk', s: 30, w: 900, c: i ? C.amber : C.cyan, al: seg(lt, .8, 1.2) });
    });
    const cards = [['对每台电机下发', 580, 700, .6], ['同步使能', 1340, 646, 4.1], ['两侧参数互换', 1340, 706, 4.7], ['两侧比较', 1340, 766, 5.3]];
    cards.forEach(([s, tx, ty, t0], i) => {
      const k = seg(lt, t0, t0 + .9); if (k <= 0) return;
      const u = eio(k), x = lerp(960, tx, u), y = lerp(170, ty, u) - Math.sin(u * Math.PI) * 80, sq = k >= 1 ? Math.max(0, .12 - (lt - t0 - .9)) : 0;
      at(g, x, y, 1, () => box(g, -150, -26, 300, 52, s, 1, { lit: i ? 0 : .6, c: i ? C.amber : C.cyan, tc: i ? C.amber : C.cyan }), { sx: 1 + sq, sy: 1 - sq });
    });
    const q = seg(lt, 7.5, 8.0);
    if (q > 0) { box(g, 520, 250, 880, 100, '', q, { lit: .4 }); text(g, '判断标准：单电机世界里，有没有对应物？', 960, 301, { s: 32, w: 900, al: q }); balloon(g, 520, 250, 26, '?', seg(lt, 7.8, 8.2), { c: C.amber, tc: C.amber }); }
  },
});
S('s15', {
  cues: [[.5, 'draw'], [1.6, 'whoosh', .6], [4.8, 'whoosh', .6], [6.0, 'error', .5], [8.8, 'whoosh', .6], [9.4, 'latch'], [12.7, 'draw'], [13.4, 'error']],
  draw(g, lt) {
    const ent = [250, 420, 590], tr = [720, 390, 260, 100], dimT = 1 - .6 * seg(lt, 12.5, 12.9);
    ent.forEach((y, i) => {
      box(g, 180, y, 180, 60, `入口 ${i + 1}`, seg(lt, .3 + i * .1, .8 + i * .1));
      draft(g, [[360, y + 30], [540, y + 30], [540, 440], [720, 440]], seg(lt, 1.0 + i * .1, 1.8 + i * .1), { c: C.ink2, w: 2, al: dimT });
    });
    box(g, ...tr, '', seg(lt, .8, 1.4), { lit: .5 * dimT });
    text(g, '端点翻译', 850, 428, { s: 30, w: 900, al: seg(lt, 1.2, 1.6) * dimT }); text(g, '驱动边界的一个函数', 850, 466, { s: 24, w: 700, c: C.ink2, al: seg(lt, 1.3, 1.7) * dimT });
    // 单电机：EP1、EP2 归一到唯一电机，EP3 截断
    const a1 = seg(lt, 4.6, 5.0) * (1 - seg(lt, 8.3, 8.7));
    if (a1 > 0) {
      g.save(); g.globalAlpha *= a1;
      motor(g, 1580, 440, 1.0, lt, { lit: .6 }); text(g, '唯一电机（EP2）', 1580, 520, { s: 24, w: 700, c: C.ink2 });
      const k = seg(lt, 4.8, 5.8);
      path(g, partial([[980, 420], [1080, 340], [1300, 340], [1420, 430], [1486, 430]], k), { c: C.cyan, w: 3 }); text(g, 'EP1', 1120, 316, { f: 'mono', s: 24, w: 700, c: C.cyan });
      path(g, partial([[980, 440], [1486, 440]], k), { c: C.cyan, w: 3 }); text(g, 'EP2', 1120, 416, { f: 'mono', s: 24, w: 700, c: C.cyan });
      path(g, partial([[980, 460], [1080, 540], [1250, 540]], k), { c: C.faint, w: 3, dash: [8, 6] }); text(g, 'EP3', 1120, 568, { f: 'mono', s: 24, w: 700, c: C.faint });
      redCross(g, 1272, 540, 34, seg(lt, 5.9, 6.3)); text(g, '忽略', 1310, 540, { s: 24, w: 700, a: 'left', c: C.red, al: seg(lt, 6.1, 6.5) });
      g.restore();
    }
    // 双电机：映射开关打开，左右对调
    const a2 = seg(lt, 8.6, 9.0) * dimT;
    if (a2 > 0) {
      g.save(); g.globalAlpha *= a2;
      const f = eio(seg(lt, 9.4, 10.0)), y2 = lerp(320, 580, f), y3 = lerp(580, 320, f);
      motor(g, 1580, 320, .9, lt, { lit: .5, seed: 1 }); text(g, '左电机', 1580, 392, { s: 24, w: 700, c: C.ink2 });
      motor(g, 1580, 580, .9, lt, { lit: .5, seed: 2 }); text(g, '右电机', 1580, 652, { s: 24, w: 700, c: C.ink2 });
      path(g, [[980, 430], [1200, 430], [1494, y2]], { c: C.cyan, w: 3 }); text(g, 'EP2', 1060, 410, { f: 'mono', s: 24, w: 700, c: C.cyan });
      path(g, [[980, 450], [1200, 450], [1494, y3]], { c: C.amber, w: 3 }); text(g, 'EP3', 1060, 476, { f: 'mono', s: 24, w: 700, c: C.amber });
      knob(g, 1200, 440, 26, f, lt, { a0: -Math.PI / 2 - .6, a1: -Math.PI / 2 + .6 }); text(g, '映射开关', 1200, 386, { s: 24, w: 700, c: C.ink2 });
      g.restore();
    }
    // 对照：每个入口各自翻译，漏了一个
    const a3 = seg(lt, 12.5, 13.0);
    if (a3 > 0) {
      [0, 2].forEach(i => box(g, 400, ent[i] + 4, 110, 52, '翻译', a3, { dash: [8, 6], fs: 24 }));
      redCircle(g, 300, ent[1] + 30, 150, 50, seg(lt, 13.2, 13.9), { seed: 5 }); text(g, '漏了', 470, ent[1] + 30, { s: 26, w: 900, c: C.red, al: seg(lt, 13.6, 14.0) });
    }
  },
});
S('s16', {
  cues: [[.5, 'draw'], [1.0, 'latch'], [1.4, 'latch'], [3.6, 'whoosh', .6], [4.5, 'latch', .6], [5.4, 'whoosh', .6], [6.3, 'error', .6], [7.8, 'whoosh'], [9.5, 'tick'], [10.9, 'error'], [11.6, 'error', .6]],
  draw(g, lt) {
    tagBox(g, '单电机固件', 300, 190, { sc: pop(seg(lt, .3, .7)), c: C.ink2, tc: C.ink2 });
    const gone = seg(lt, 7.6, 8.0);
    pipe(g, [[160, 470], [1080, 470]], lt, { p: seg(lt, .3, 1.0) });
    pipe(g, [[600, 470], [600, 310]], lt, { p: seg(lt, .9, 1.3) * (1 - .6 * gone) });
    pipe(g, [[900, 470], [900, 660]], lt, { p: seg(lt, 1.1, 1.5) * (1 - .6 * gone) });
    box(g, 490, 250, 220, 60, '聚合分支', seg(lt, 1.0, 1.4), { tal: 1 - .6 * gone });
    box(g, 790, 660, 220, 60, '拒绝', seg(lt, 1.2, 1.6), { c: C.red, tc: C.red, tal: 1 - .6 * gone, lit: lt > 6.4 && lt < 7.4 ? .6 : 0 });
    if (lt > .9) { gate(g, 600, 470, gone, { label: 'EP1？', side: -1 }); gate(g, 900, 470, gone, { label: 'is_motor_ep', side: 1 }); }
    redCross(g, 600, 470, 50, seg(lt, 8.0, 8.4)); redCross(g, 900, 470, 50, seg(lt, 8.1, 8.5));
    const idx = seg(lt, 1.3, 1.8), hit = lt > 9.4;
    box(g, 1080, 438, 300, 64, hit ? 'MOTOR_IDX(EP3) = 0' : 'MOTOR_IDX(ep)', idx, { f: 'mono', fs: 24, tc: hit ? C.amber : C.ink });
    pipe(g, [[1380, 470], [1480, 470]], lt, { p: seg(lt, 1.6, 2.0), flow: seg(lt, 9.6, 10.0) * (1 - seg(lt, 11, 11.4)), fc: C.red });
    const bad = lt > 10.9 ? .5 + .5 * Math.sin((lt - 10.9) * 12) : 0;
    motor(g, 1600, 470, 1.0, lt, { p: seg(lt, 1.6, 2.4), lit: bad, ledC: bad > 0 ? C.red : C.green, spin: bad > 0 ? 5 : .4 });
    text(g, '唯一电机 EP2', 1600, 556, { s: 24, w: 700, c: C.ink2, al: seg(lt, 2.0, 2.4) });
    if (bad > 0) { ring(g, 1600, 470, 110 + 20 * Math.sin(lt * 6), C.red, 3, .6); text(g, '被误操作', 1600, 360, { s: 30, w: 900, c: C.red, al: seg(lt, 11.0, 11.4) }); }
    const caps = [['EP1', 3.6, [[160, 470], [600, 470], [600, 350]], 5.2], ['EP3', 5.4, [[160, 470], [900, 470], [900, 616]], 7.0], ['EP3', 7.9, [[160, 470], [1036, 470]], 9.5]];
    caps.forEach(([s, t0, pts, t1]) => { const k = seg(lt, t0, t1); if (k > 0 && k < 1) { const [x, y] = posOn(pts, eio(k)); evtCap(g, x, y, [s], { glow: .6, c: s === 'EP1' ? C.cyan : C.amber, al: 1 - seg(k, .85, 1) }); } });
  },
});
S('s17', {
  cues: [[.5, 'draw'], [4.8, 'blip'], [5.4, 'tick', .5], [9.0, 'tick', .5], [9.6, 'tick', .5], [10.4, 'success']],
  draw(g, lt) {
    const T = [['接口组', '单电机侧', '双电机侧'], ['EP 拓扑映射', '别名归一，EP3 忽略', '映射开关可左右对调'], ['行程设置', '打第二点后自驱测轨', '由云端校准命令驱动'], ['聚合上报', '状态 / 百分比是空函数', '三态投票，以 EP1 上报'], ['唤醒模式', '恒推 EP2', '按样式选 EP2 / EP3'], ['十击限位', '空操作桩', '完整状态机'], ['手拉联动', '空操作桩', '镜像启动对侧']];
    const cx = [260, 600, 1130, 1660], y0 = 140, rh = 50;
    T.forEach((r, i) => {
      const y = y0 + i * rh, p = seg(lt, .3 + i * .15, .8 + i * .15), hl = i === 3 ? seg(lt, 4.6, 5.0) : 0;
      if (hl > 0) { g.save(); g.fillStyle = rgba(C.cyan, .14 * hl); g.fillRect(cx[0], y, cx[3] - cx[0], rh); g.restore(); }
      path(g, partial([[cx[0], y + rh], [cx[3], y + rh]], p), { c: rgba(C.ink, i ? .3 : .7), w: i ? 1.4 : 2.2 });
      r.forEach((s, j) => text(g, s, cx[j] + 20, y + rh / 2 + 1, { s: i ? 24 : 26, w: i ? 700 : 900, a: 'left', c: !i ? C.ink : hl > .5 ? C.cyan : j ? C.ink2 : C.ink, al: seg(p, .4, 1) }));
    });
    frame(g, cx[0], y0, cx[3] - cx[0], rh * 7, { p: seg(lt, .2, 1.0), fill: false });
    [cx[1], cx[2]].forEach(x => draft(g, [[x, y0], [x, y0 + rh * 7]], seg(lt, .4, 1.2), { c: rgba(C.ink, .4), w: 1.4 }));
    text(g, '单电机', 280, 560, { s: 28, w: 900, a: 'left', al: seg(lt, 4.8, 5.2) });
    ['status() { }', 'percent() { }'].forEach((s, i) => box(g, 280, 600 + i * 76, 300, 60, s, seg(lt, 5.2 + i * .2, 5.6 + i * .2), { f: 'mono', fs: 24, dash: [8, 6] }));
    text(g, 'limit → EP2 直通', 620, 638, { f: 'mono', s: 24, w: 700, a: 'left', c: C.ink2, al: seg(lt, 5.8, 6.2) });
    text(g, '双电机', 1000, 560, { s: 28, w: 900, a: 'left', al: seg(lt, 8.8, 9.2) });
    const st = ['停', '开', '关'], cyc = Math.floor(Math.max(0, lt - 9) / 1.4);
    [[1080, 640, 0], [1080, 760, 1]].forEach(([x, y, i]) => {
      motor(g, x, y, .55, lt, { p: seg(lt, 8.9 + i * .2, 9.5 + i * .2), seed: i });
      tagBox(g, st[(cyc + i * (cyc % 2)) % 3], x + 110, y, { sc: pop(seg(lt, 9.2 + i * .2, 9.6 + i * .2)), fs: 26, c: C.cyan, tc: C.cyan });
      arrow(g, [[x + 150, y], [1290, 700]], { p: seg(lt, 9.6, 10.0), c: C.ink2, w: 2 });
    });
    box(g, 1290, 670, 150, 60, '投票', seg(lt, 9.6, 10.0), { lit: .5 });
    arrow(g, [[1440, 700], [1520, 700]], { p: seg(lt, 10.0, 10.3), c: C.cyan, w: 3 });
    balloon(g, 1566, 700, 34, 'EP1', seg(lt, 10.2, 10.7), { c: C.cyan, tc: C.cyan });
    text(g, '全停→停 · 任一开→开 · 全关→关', 1330, 826, { s: 24, w: 700, c: C.ink2, al: seg(lt, 10.6, 11.0) });
  },
});
S('s18', {
  cues: [[.5, 'type'], [1.5, 'draw'], [2.5, 'whoosh', .5], [5.2, 'type'], [6.1, 'whoosh', .6], [6.7, 'whoosh', .6], [8.6, 'success']],
  draw(g, lt) {
    const m = seg(lt, 2.55, 2.8), A = 'set_speed(ep, v)', B = 'set_speed(v)', o = { f: 'mono', s: 48, w: 700 };
    text(g, A, 960, 250, { ...o, al: seg(lt, .3, .7) * (1 - seg(lt, 2.3, 2.55)) });
    if (lt > 1.4 && m < 1) { const x0 = 960 - textW(g, A, o) / 2 + textW(g, 'set_speed(', o); strike(g, x0, x0 + textW(g, 'ep,', o), 252, seg(lt, 1.4, 1.9)); }
    text(g, B, 960, 250, { ...o, c: C.cyan, al: m });
    codeCard(g, 480, 360, 960, ['void set_speed(int v) {', '    FOR_EACH_MOTOR(i) motor_speed(i, v);', '}'], { p: seg(lt, 5.1, 6.4), lt, title: '示意' });
    [[760, 0], [1160, 1]].forEach(([x, i]) => {
      motor(g, x, 740, .9, lt, { p: seg(lt, 5.4, 6.0), lit: seg(lt, 6.4 + i * .6, 6.8 + i * .6), seed: i });
      arrow(g, [[x, 570], [x, 684]], { p: seg(lt, 6.0 + i * .6, 6.4 + i * .6), c: C.cyan, w: 3 });
    });
    if (lt > 8.4) { tagBox(g, '调用方：set_speed(v)', 1580, 300, { sc: pop(seg(lt, 8.5, 8.9)), f: 'mono', fs: 24, c: C.green, tc: C.green }); check(g, 1580, 360, 40, seg(lt, 8.9, 9.3)); }
  },
});

/* =====================================================================
 * 第四章：云端那一刀，每款一张表
 * ===================================================================== */
S('s19', {
  cues: [[1.8, 'draw'], [2.3, 'whoosh'], [6.0, 'whoosh'], [6.7, 'blip', .6], [6.9, 'blip', .6], [7.1, 'blip', .6], [10.5, 'draw', .6], [11.3, 'draw', .6], [12.1, 'draw', .6]],
  draw(g, lt) {
    evtCap(g, 960, 210, ['电机反转', 'EP2 / EP3', 'true'], { fs: 26, glow: .5, s: pop(seg(lt, 2.2, 2.7)) });
    const sh = [[200, 'A 款 spec（单电机）', [['服务 2 · 属性 5', '电机反转']], ['遥控管理：服务 3', '行程点：0..2', '独有：行程设置模式等']], [1020, 'B 款 spec（双电机）', [['服务 2 · 属性 6', '反转（左）'], ['服务 3 · 属性 5', '反转（右）']], ['遥控管理：服务 7', '行程点：多一个 3 = 开始校准', '独有：双电机开关等']]];
    sh.forEach(([x, title, rows, diffs], si) => {
      frame(g, x, 320, 700, 520, { p: seg(lt, 1.6 + si * .2, 2.4 + si * .2), ticks: true, fill: rgba(C.plate, .4) });
      text(g, title, x + 26, 360, { s: 28, w: 900, a: 'left', al: seg(lt, 2.0, 2.4) });
      rows.forEach(([a, b], i) => {
        const y = 430 + i * 60, arrive = 6.7 + si * .2 + i * .2, on = seg(lt, arrive, arrive + .3);
        if (on > 0) { g.save(); g.fillStyle = rgba(C.cyan, .16 * on); g.fillRect(x + 16, y - 24, 668, 48); g.restore(); }
        text(g, a, x + 30, y, { f: 'mono', s: 26, w: 700, a: 'left', c: on > .5 ? C.cyan : C.ink, al: seg(lt, 2.4, 2.8) });
        text(g, b, x + 670, y, { s: 24, w: 700, a: 'right', c: C.ink2, al: seg(lt, 2.4, 2.8) });
        const k = seg(lt, 5.9 + si * .2 + i * .2, arrive);
        if (k > 0 && k < 1) { const [px, py] = posOn([[960, 236], [x + 350, 300], [x + 350, y]], eio(k)); evtCap(g, px, py, ['电机反转'], { fs: 24, glow: .5 }); }
      });
      diffs.forEach((d, i) => {
        const y = 600 + i * 70, t0 = 10.5 + i * .8;
        text(g, d, x + 30, y, { s: 26, w: 700, a: 'left', al: seg(lt, 10.3, 10.7) });
        const w = textW(g, d, { s: 26, w: 700 }), pts = []; for (let xx = 0; xx <= w; xx += 8) pts.push([x + 30 + xx, y + 22 + Math.sin(xx * .35 + si) * 3]);
        path(g, partial(pts, seg(lt, t0, t0 + .5)), { c: C.red, w: 2.5 });
      });
    });
    ['服务布局', '值域', '独有属性'].forEach((s, i) => text(g, s, 960, 600 + i * 70, { s: 24, w: 900, c: C.red, al: seg(lt, 10.6 + i * .8, 11.0 + i * .8) }));
  },
});
S('s20', {
  cues: [[.6, 'tick', .6], [1.2, 'tick', .6], [1.8, 'tick', .6], [4.4, 'latch'], [4.8, 'error', .5], [6.9, 'whoosh'], [7.6, 'latch', .6]],
  draw(g, lt) {
    box(g, 660, 380, 600, 160, '', seg(lt, .2, .8), { ticks: true });
    text(g, '公共代码', 960, 440, { s: 36, w: 900, al: seg(lt, .5, .9) }); text(g, 'spec_report/ · 373 行', 960, 492, { f: 'mono', s: 24, w: 700, c: C.ink2, al: seg(lt, .6, 1.0) });
    const ns = [['改编号', 420, 250, .6, [520, 280, 660, 400]], ['加属性', 960, 200, 1.2, [960, 226, 960, 330]], ['改值域', 1500, 250, 1.8, [1400, 280, 1260, 400]]];
    ns.forEach(([s, x, y, t0, [ax, ay, bx, by]], i) => {
      note(g, s, x, y, seg(lt, t0, t0 + .4), { rot: (i - 1) * .06 });
      const k = seg(lt, t0 + .3, t0 + .9), bounce = seg(lt, 4.5, 5.0);
      arrow(g, [[ax, ay], [lerp(ax, bx, 1 - .35 * bounce), lerp(ay, by, 1 - .35 * bounce)]], { p: k, c: C.amber, w: 2.5 });
      redCross(g, (ax + bx) / 2, (ay + by) / 2, 30, seg(lt, 4.7 + i * .1, 5.1 + i * .1));
    });
    lockIcon(g, 960, 368, .9, seg(lt, 4.3, 4.7), seg(lt, 4.1, 4.4));
    const c = seg(lt, 6.7, 7.4);
    if (c > 0) {
      g.save(); g.globalAlpha *= c; g.translate((1 - eo(c)) * 200, 0);
      box(g, 300, 690, 260, 60, 'Kconfig choice', 1, { f: 'mono', fs: 24 }); pipe(g, [[560, 720], [660, 720]], lt, { flow: .6, head: true });
      box(g, 660, 690, 240, 60, 'Makefile', 1, { f: 'mono', fs: 24 }); pipe(g, [[900, 720], [1000, 720]], lt, { flow: .6, head: true });
      const sel = Math.floor(lt / 1.2) % 2;
      folder(g, 1000, 640, 300, 180, 'spec/product_a/', 0, { lit: sel ? 0 : .8, off: sel ? .6 : 0 });
      folder(g, 1340, 640, 300, 180, 'spec/product_b/', 0, { lit: sel ? .8 : 0, off: sel ? 0 : .6 });
      g.restore();
      note(g, '同一套手法', 960, 600, seg(lt, 7.4, 7.8), { rot: 0 });
    }
  },
});
S('s21', {
  cues: [[.5, 'draw'], [.8, 'tick', .5], [2.3, 'blip'], [4.6, 'draw'], [8.0, 'draw', .6], [9.8, 'latch'], [11.2, 'latch']],
  draw(g, lt) {
    box(g, 300, 330, 520, 220, '', seg(lt, .3, 1.0), { ticks: true, lit: .3 });
    text(g, '公共转换器', 560, 390, { s: 34, w: 900, al: seg(lt, .6, 1.0) });
    const n = Math.round(118 * eo(seg(lt, .6, 2.0)));
    dimLine(g, 300, 296, 820, 296, `${n} 行`, seg(lt, .5, 1.6), { lc: C.amber, s: 26 });
    text(g, '产品宏：0', 560, 456, { s: 30, w: 900, c: C.amber, al: seg(lt, 2.2, 2.6) });
    text(g, '6 个通用 invoker', 560, 506, { s: 24, w: 700, c: C.ink2, al: seg(lt, 2.6, 3.0) });
    pipe(g, [[820, 440], [960, 440]], lt, { p: seg(lt, 4.4, 4.8), flow: .6, head: true });
    box(g, 960, 370, 360, 140, 'extern const 表', seg(lt, 4.6, 5.2), { f: 'mono', dash: [10, 8], c: C.cyan, tc: C.cyan });
    const tb = [[1480, 220, 230, 'A 款表 · 18 项', 18], [1480, 520, 280, 'B 款表 · 约 20 项', 20]], sel = lt < 9.8 ? 0 : lt < 11.2 ? 1 : 0;
    tb.forEach(([x, y, h, t, rows], i) => {
      const p = seg(lt, 7.9 + i * .2, 8.6 + i * .2), on = sel === i ? 1 : .35;
      frame(g, x, y, 300, h, { p, lit: sel === i ? .6 : 0, fill: rgba(C.plate, .5), al: lerp(1, on, seg(lt, 8.6, 9.0)) });
      text(g, t, x + 150, y + 30, { s: 24, w: 900, c: sel === i ? C.cyan : C.ink2, al: seg(p, .5, 1) });
      for (let r = 0; r < rows; r++) path(g, [[x + 20, y + 60 + r * (h - 76) / rows], [x + 280 - hash(r + i * 9) * 60, y + 60 + r * (h - 76) / rows]], { c: rgba(C.ink, .35), w: 1.6, al: seg(p, .6, 1) * on });
    });
    if (lt > 8.4) { const ty = sel ? 650 : 335; path(g, [[1320, 440], [1400, 440], [1400, ty], [1478, ty]], { c: C.cyan, w: 3, glow: .6 }); ripple(g, 1478, ty, lt - (sel ? 9.8 : lt < 11.2 ? 8.4 : 11.2)); }
    text(g, '构建时二选一', 1630, 834, { s: 24, w: 700, c: C.cyan, al: seg(lt, 8.6, 9.0) });
  },
});
const L22 = ['// A 款（单电机）：聚合槽位留空', '{ EVT_REPORT_POSITION, invoke_by_ep,', '  .fn = { NULL, a_report_position } },', '// B 款（双电机）：三个端点，三个属性', '{ EVT_REPORT_POSITION, invoke_by_ep,', '  .fn = { b_report_agg, b_report_left, b_report_right } },'];
S('s22', {
  cues: [[.5, 'type'], [3.0, 'blip', .5], [3.4, 'blip', .5], [3.8, 'blip', .5], [4.2, 'blip', .5], [4.6, 'blip', .5], [6.9, 'error']],
  draw(g, lt) {
    codeCard(g, 220, 150, 1480, L22, { p: seg(lt, .4, 2.6), lt, title: '映射表（示意）' });
    ['EP1', 'EP2', 'EP3'].forEach((s, i) => text(g, s, 640 + i * 340, 560, { f: 'mono', s: 26, w: 700, c: C.ink2, al: seg(lt, 2.8, 3.2) }));
    const rowsT = [[640, 'A 款', ['NULL', 'a_report_position']], [760, 'B 款', ['b_report_agg', 'b_report_left', 'b_report_right']]];
    let k = 0;
    rowsT.forEach(([y, lab, cells]) => {
      text(g, lab, 400, y, { s: 30, w: 900, al: seg(lt, 2.8, 3.2) });
      cells.forEach((c, i) => {
        const t0 = 3.0 + (k++) * .4, on = seg(lt, t0, t0 + .3), nul = c === 'NULL', fl = nul && lt > 6.7 ? .5 + .5 * Math.sin((lt - 6.7) * 9) : 0;
        frame(g, 490 + i * 340, y - 32, 300, 64, { p: on, lw: 2, dash: nul ? [8, 6] : null, c: nul ? C.red : C.cyan, fill: nul ? rgba(C.red, .06 + .12 * fl) : rgba(C.cyan, .1), lit: nul ? 0 : .4 });
        text(g, c, 640 + i * 340, y + 1, { f: 'mono', s: 24, w: 700, c: nul ? C.red : C.ink, al: on });
      });
    });
    if (lt > 6.7) text(g, '聚合槽位留空', 640, 708, { s: 24, w: 700, c: C.red, al: seg(lt, 6.8, 7.2) });
  },
});
S('s23', {
  cues: [[.6, 'whoosh'], [1.5, 'success', .6], [2.0, 'whoosh', .6], [4.6, 'error'], [5.2, 'error', .4], [7.6, 'blip'], [10.6, 'draw'], [11.2, 'draw', .6]],
  draw(g, lt) {
    cloud(g, 1650, 220, 1.1 * pop(seg(lt, .2, .7)), '云端', { lit: seg(lt, 3.0, 3.4) * (1 - seg(lt, 3.8, 4.4)) });
    const T = [[200, 'A 款表', ['NULL', 'a_status']], [1060, 'B 款表', ['b_status_agg', 'b_status_l', 'b_status_r']]];
    T.forEach(([x, name, cells], ti) => {
      text(g, name, x + (ti ? 660 : 435), 386, { s: 28, w: 900, a: 'right', al: seg(lt, .3, .7) });
      cells.forEach((c, i) => {
        const nul = c === 'NULL', hit = ti ? seg(lt, 1.4, 1.7) : seg(lt, 4.3, 4.6);
        frame(g, x + i * 225, 420, 215, 70, { p: seg(lt, .3 + i * .1, .8 + i * .1), lw: 2, dash: nul ? [8, 6] : null, c: nul ? C.red : C.ink, fill: i === 0 ? rgba(nul ? C.red : C.cyan, .05 + .15 * hit) : rgba(C.ink, .04), lit: !nul && i === 0 ? hit * .7 : 0 });
        text(g, c, x + i * 225 + 107, 456, { f: 'mono', s: 24, w: 700, c: nul ? C.red : C.ink2, al: seg(lt, .6, 1.0) });
        text(g, `EP${i + 1}`, x + i * 225 + 107, 520, { f: 'mono', s: 24, w: 700, c: C.faint, al: seg(lt, .6, 1.0) });
      });
    });
    const kb = seg(lt, .6, 1.4), ka = seg(lt, 3.6, 4.4);
    if (kb > 0 && kb < 1) { const [x, y] = posOn([[960, 180], [1167, 300], [1167, 420]], eio(kb)); evtCap(g, x, y, ['状态', 'EP1'], { glow: .5 }); }
    const kc = seg(lt, 1.8, 3.2);
    if (kc > 0 && kc < 1) { const [x, y] = posOn([[1167, 380], [1400, 320], [1540, 290]], eio(kc)); evtCap(g, x, y, ['(服务, 属性, 值)'], { glow: .6, c: C.green }); }
    if (ka > 0 && ka < 1) { const [x, y] = posOn([[960, 180], [307, 300], [307, 420]], eio(ka)); evtCap(g, x, y, ['状态', 'EP1'], { glow: .5 }); }
    const kd = seg(lt, 4.4, 5.0);
    if (kd > 0 && kd < 1) { const [x, y] = posOn([[307, 455], [307, 590]], eo(kd)); evtCap(g, x, y, ['状态', 'EP1'], { al: 1 - kd * .6 }); }
    if (lt > 4.6) {
      box(g, 200, 640, 360, 80, '', seg(lt, 4.6, 5.0), { c: C.red });
      const bl = .55 + .45 * Math.sin(lt * 7); warnIcon(g, 250, 680, 34 * bl + 6, C.amber);
      text(g, '丢弃 + 告警', 400, 681, { s: 28, w: 900, c: C.red, al: seg(lt, 4.8, 5.2) });
    }
    if (lt > 7.4) tagBox(g, '表 = 映射 + 白名单', 1100, 680, { sc: pop(seg(lt, 7.5, 7.9)), c: C.amber, tc: C.amber, fs: 30 });
    if (lt > 10.4) { box(g, 760, 250, 400, 60, '上游：先过滤 EP1', seg(lt, 10.4, 10.9), { dash: [8, 6], c: C.faint, tc: C.ink2 }); strike(g, 770, 1150, 282, seg(lt, 11.1, 11.6)); }
  },
});
S('s24', {
  cues: [[.5, 'draw'], [1.0, 'blip'], [4.6, 'type'], [5.0, 'draw', .6], [8.5, 'whoosh'], [8.9, 'error', .5], [9.5, 'error', .5], [10.0, 'success']],
  draw(g, lt) {
    const cx = [260, 640, 1220, 1660], rows = [['事件类型', 'invoker（值怎么转）', '槽位'], ['位置上报', '整数直传 ƒ', 'EP1 · EP2 · EP3'], ['电机反转', 'int → bool 包装 ƒ', 'EP2 · EP3'], ['遥控配对状态', '拆成两个属性 ƒ', 'EP2']];
    const add = seg(lt, 8.3, 8.8), all = add > 0 ? [...rows, ['……', '字符串列表 ƒ', '…']] : rows;
    all.forEach((r, i) => {
      const y = 150 + i * 56, p = i === 4 ? add : seg(lt, .3 + i * .15, .8 + i * .15);
      if (i === 4 && add > 0) { g.save(); g.fillStyle = rgba(C.green, .14 * add); g.fillRect(cx[0], y, cx[3] - cx[0], 56); g.restore(); }
      path(g, partial([[cx[0], y + 56], [cx[3], y + 56]], p), { c: rgba(C.ink, i ? .3 : .7), w: i ? 1.4 : 2.2 });
      r.forEach((s, j) => text(g, s, cx[j] + 20 + (i === 4 ? (1 - eo(add)) * 60 : 0), y + 29, { s: i ? 24 : 26, w: i ? 700 : 900, a: 'left', c: j === 1 && i ? (i === 4 ? C.green : C.cyan) : i ? C.ink2 : C.ink, al: seg(p, .4, 1) }));
    });
    const inv = seg(lt, .9, 1.3); if (inv > 0) { g.save(); g.globalAlpha *= inv; g.strokeStyle = C.cyan; g.lineWidth = 2.5; g.strokeRect(cx[1], 150, cx[2] - cx[1], 56 * all.length); g.restore(); }
    box(g, 260, 520, 660, 150, '', seg(lt, 4.4, 5.0), { lit: .3 });
    text(g, '转换器', 290, 556, { s: 28, w: 900, a: 'left', al: seg(lt, 4.6, 5.0) });
    text(g, typed('entry->invoke(entry, event);', seg(lt, 4.7, 5.6)), 290, 620, { f: 'mono', s: 26, w: 700, a: 'left', c: C.cyan });
    text(g, '不 switch 类型 · 加一种形态，这里一行不动', 590, 712, { s: 24, w: 700, c: C.ink2, al: seg(lt, 5.4, 5.8) });
    if (lt > 10.0) stamp(g, '不动', 820, 556, clamp((lt - 10.0) / .6), { c: C.green, icon: 'check', fs: 26 });
    const cases = ['switch (type) {', '  case INT:  …', '  case BOOL: …', '  case RC:   …'], extra = ['  case STR:  …', '  case EVT:  …'];
    const ne = (lt > 8.7) + (lt > 9.3), L = [...cases, ...extra.slice(0, ne), '}'];
    if (lt > 4.8) {
      codeCard(g, 1040, 500, 620, L, { fs: 24, lh: 36, al: seg(lt, 4.8, 5.3) * .9, title: 'switch 版（对照）', hl: ne ? [4, ne > 1 ? 5 : 4] : [], hlA: 1 });
      text(g, '每加一种形态，就要改公共层', 1350, 466, { s: 24, w: 700, c: C.red, al: seg(lt, 8.8, 9.2) });
    }
  },
});
S('s25', {
  cues: [[.5, 'draw'], [1.1, 'latch', .6], [1.9, 'latch', .6], [2.6, 'tick'], [3.3, 'blip'], [4.3, 'whoosh', .6], [7.6, 'error'], [8.2, 'success']],
  draw(g, lt) {
    cloud(g, 230, 300, .95, '云端');
    text(g, 'set_properties', 230, 380, { f: 'mono', s: 24, w: 700, c: C.ink2 });
    const B = [[420, 'switch(服务号)', 'mono'], [760, 'switch(属性号)', 'mono'], [1100, '值域校验', 'cjk'], [1400, '端点 + 事件', 'cjk']];
    const k = seg(lt, .6, 3.4), px = lerp(330, 1640, k);
    B.forEach(([x, s, f], i) => {
      const w = i < 2 ? 280 : 240, on = px > x && px < x + w + 60 ? 1 : 0;
      box(g, x, 270, w, 60, s, seg(lt, .2 + i * .15, .7 + i * .15), { f, fs: 24, lit: on * .8 });
      if (i < 3) arrow(g, [[x + w, 300], [B[i + 1][0] - 4, 300]], { p: seg(lt, .5 + i * .15, .9 + i * .15), c: C.ink2, w: 2 });
    });
    arrow(g, [[330, 300], [416, 300]], { p: seg(lt, .3, .6), c: C.ink2, w: 2 });
    text(g, '一级：产品服务布局', 560, 360, { s: 24, w: 700, c: C.ink2, al: seg(lt, 1.2, 1.6) });
    text(g, '二级：产品属性布局', 900, 360, { s: 24, w: 700, c: C.ink2, al: seg(lt, 1.9, 2.3) });
    if (k > 0 && k < 1) dot(g, px, 300, 10, C.amber);
    const gs = [[300, 'A 款：行程点 0..2', false, 4.2], [1060, 'B 款：多一个 3 = 开始校准', true, 4.6]];
    gs.forEach(([x, t, ok, t0]) => {
      frame(g, x, 500, 560, 300, { p: seg(lt, 3.9, 4.5), ticks: true, fill: rgba(C.plate, .4) });
      text(g, t, x + 280, 540, { s: 26, w: 900, al: seg(lt, 4.1, 4.5) });
      const d = seg(lt, t0, t0 + .7);
      if (d > 0) evtCap(g, x + 280, lerp(470, 640, eo(d)), ['值 = 3'], { fs: 26, glow: .5, c: C.amber, al: ok ? 1 - seg(lt, 7.8, 8.05) : 1 - seg(lt, 7.5, 7.9) * .6 });
      if (!ok) { redCross(g, x + 280, 640, 70, seg(lt, 7.5, 7.9)); text(g, '值域错误，拒绝', x + 280, 740, { s: 28, w: 900, c: C.red, al: seg(lt, 7.7, 8.1) }); }
      else { if (lt > 8.1) evtCap(g, x + 280, 650, ['电机校准事件'], { fs: 26, glow: .6, c: C.green, s: pop(seg(lt, 8.1, 8.5)) }); text(g, '转成“开始校准”', x + 280, 740, { s: 28, w: 900, c: C.green, al: seg(lt, 8.4, 8.8) }); }
    });
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

/* 两层同构用的小结构图：开关 → Makefile → 两个目录 */
function miniStruct(g, x, y, labels, p, lt, o = {}) {
  const [k, m, d1, d2] = labels;
  box(g, x, y + 60, 200, 56, k, seg(p, 0, .4), { f: 'mono', fs: 24 });
  pipe(g, [[x + 200, y + 88], [x + 250, y + 88]], lt, { p: seg(p, .2, .5), flow: .5, head: true });
  box(g, x + 250, y + 60, 170, 56, m, seg(p, .2, .6), { f: 'mono', fs: 24 });
  pipe(g, [[x + 420, y + 88], [x + 450, y + 88], [x + 450, y + 30], [x + 470, y + 30]], lt, { p: seg(p, .4, .8), flow: .5 });
  pipe(g, [[x + 450, y + 88], [x + 450, y + 150], [x + 470, y + 150]], lt, { p: seg(p, .4, .8) });
  box(g, x + 470, y, 170, 56, d1, seg(p, .5, 1), { f: 'mono', fs: 24, lit: .6 });
  box(g, x + 470, y + 122, 170, 56, d2, seg(p, .55, 1), { f: 'mono', fs: 24, dash: [8, 6] });
}
S('s27', {
  cues: [[.5, 'draw'], [1.4, 'whoosh', .6], [2.2, 'latch'], [3.4, 'draw', .6], [4.4, 'latch'], [7.6, 'blip'], [8.2, 'success', .6]],
  draw(g, lt) {
    const ov = Math.sin(Math.PI * seg(lt, 1.2, 3.0)), dx = 410 * eio(clamp(ov * 1.4));
    text(g, '电机维度', 560 + dx, 170, { s: 30, w: 900, c: C.amber, al: seg(lt, .3, .7) * (1 - clamp(ov * 2)) });
    text(g, 'spec 维度', 1380 - dx, 170, { s: 30, w: 900, c: C.amber, al: seg(lt, .3, .7) * (1 - clamp(ov * 2)) });
    miniStruct(g, 240 + dx, 230, ['Kconfig', 'Makefile', 'single/', 'dual/'], seg(lt, .3, 1.2), lt);
    g.save(); g.globalAlpha *= 1 - .9 * ov; miniStruct(g, 1040 - dx, 230, ['Kconfig', 'Makefile', 'product_a/', 'product_b/'], seg(lt, .4, 1.3), lt); g.restore();
    text(g, '完全同构', 960, 470, { s: 34, w: 900, c: C.amber, al: seg(lt, 1.8, 2.2) * (1 - seg(lt, 3.0, 3.4)) });
    const t = seg(lt, 3.2, 3.9);
    frame(g, 760, 560, 400, 270, { p: t, fill: rgba(C.plate, .5) });
    text(g, 'B 款表 · 20 项', 960, 586, { s: 24, w: 900, al: t });
    for (let r = 0; r < 20; r++) {
      const y = 612 + r * 10.5, hot = r === 11;
      path(g, [[790, y], [1130 - hash(r) * 80, y]], { c: hot ? C.amber : rgba(C.ink, .35), w: hot ? 3 : 1.4, al: seg(t, .4 + r * .02, .6 + r * .02) });
    }
    const hb = seg(lt, 4.3, 4.8);
    if (hb > 0) { path(g, [[1150, 718], [1170, 718], [1170, 750], [1150, 750]], { c: C.amber, w: 2.5, al: hb }); text(g, '#ifdef CURTAIN_DUAL_MOTOR', 1190, 734, { f: 'mono', s: 24, w: 700, a: 'left', c: C.amber, al: hb }); }
    const lk = seg(lt, 7.4, 8.2);
    if (lk > 0) { path(g, partial([[790, 727], [600, 727], [600, 420], [560, 420]], lk), { c: C.cyan, w: 2.5, dash: [8, 6] }); ripple(g, 560, 420, lt - 8.2); ripple(g, 790, 727, lt - 7.4); }
    text(g, '两个维度在这里交叉', 600, 790, { s: 26, w: 900, c: C.cyan, al: seg(lt, 8.0, 8.4) });
  },
});
S('s28', {
  cues: [[.5, 'draw'], [1.2, 'whoosh', .6], [5.3, 'type'], [6.0, 'tick', .4], [7.0, 'tick', .5], [8.6, 'success'], [9.5, 'whoosh', .6], [11.2, 'success']],
  draw(g, lt) {
    const sw = lt > 9.3, f = seg(lt, 9.3, 9.6);
    fileIcon(g, 925, 150, 70, 88, { al: seg(lt, .3, .7), c: C.cyan, fill: rgba(C.cyan, .12) });
    text(g, 'main.c', 1030, 196, { f: 'mono', s: 28, w: 700, a: 'left', al: seg(lt, .5, .9) });
    text(g, '同一份', 890, 196, { s: 24, w: 700, a: 'right', c: C.amber, al: seg(lt, .8, 1.2) });
    [[520, 0], [1100, 1]].forEach(([x, i]) => {
      arrow(g, [[960, 240], [960, 280], [x + 150, 280], [x + 150, 318]], { p: seg(lt, 1.0 + i * .2, 1.6 + i * .2), c: C.ink2, w: 2 });
      chipIC(g, x, 330, 300, 70, sw ? (i ? 'B 款二进制' : 'A 款二进制') : (i ? '双电机二进制' : '单电机二进制'), { p: seg(lt, 1.4 + i * .2, 2.0 + i * .2), lit: .5 });
      const tx = i ? 1000 : 240, n = sw ? 9 : (i ? 16 : 10), k = sw ? seg(lt, 9.8 + i * .2, 11.0 + i * .2) : seg(lt, 5.3 + i * .2, 7.3 + i * 1.0);
      terminal(g, tx, 470, 680, 360, sw ? (i ? 'demo · B 款' : 'demo · A 款') : (i ? 'demo · dual' : 'demo · single'), seg(lt, 4.9, 5.4));
      g.save(); g.globalAlpha *= sw ? f : 1 - seg(lt, 9.0, 9.3);
      text(g, '$ ./demo', tx + 30, 548, { f: 'mono', s: 24, w: 700, a: 'left', c: C.ink2 });
      checkRow(g, tx + 60, 610, n, k, 8);
      text(g, `断言 ${n} / ${n} 通过`, tx + 340, 776, { s: 28, w: 900, c: C.green, al: seg(k, .95, 1) });
      g.restore();
    });
  },
});
S('s29', {
  cues: [[.6, 'whoosh'], [1.2, 'draw', .6], [4.6, 'tick'], [5.2, 'type'], [8.4, 'stamp']],
  draw(g, lt) {
    const nw = seg(lt, .6, 1.3), items = [['device/', 290], ['product_a/', 380], ['product_b/', 470]];
    text(g, 'spec/', 300, 210, { f: 'mono', s: 30, w: 700, a: 'left', al: seg(lt, .2, .5) });
    draft(g, [[320, 232], [320, lerp(470, 560, nw)]], seg(lt, .2, .8), { c: C.ink2, w: 2 });
    items.forEach(([s, y], i) => { path(g, [[320, y], [360, y]], { c: C.ink2, w: 2, al: seg(lt, .3, .6) }); fileIcon(g, 368, y - 18, 28, 36, { al: seg(lt, .3, .6) }); text(g, s, 410, y, { f: 'mono', s: 28, w: 700, a: 'left', c: C.ink2, al: seg(lt, .4, .7) }); });
    if (nw > 0) {
      const dx = (1 - eo(nw)) * 300;
      path(g, [[320, 560], [360, 560]], { c: C.cyan, w: 2, al: nw }); frame(g, 366 + dx, 540, 32, 40, { construct: false, dash: [6, 4], c: C.cyan, lw: 2, al: nw });
      text(g, 'product_c/', 410 + dx, 560, { f: 'mono', s: 28, w: 700, a: 'left', c: C.cyan, al: nw });
      ['映射表', '处理函数'].forEach((s, i) => { const k = seg(lt, 1.4 + i * .3, 1.8 + i * .3); path(g, [[440, 590], [440, 630 + i * 50], [470, 630 + i * 50]], { c: C.cyan, w: 1.6, al: k }); text(g, s, 484, 630 + i * 50, { s: 26, w: 700, a: 'left', c: C.cyan, al: k }); });
    }
    const add = lt > 4.6, mk = lt > 5.0;
    codeCard(g, 1060, 170, 620, ['choice 产品', '  PRODUCT_A', '  PRODUCT_B', ...(add ? ['+ PRODUCT_C'] : [])], { fs: 24, lh: 38, title: 'Kconfig', hl: add ? [3] : [], hlA: seg(lt, 4.6, 5.0), al: seg(lt, 4.3, 4.6) });
    codeCard(g, 1060, 400, 620, ['SRC_DIRS += spec/$(PRODUCT)', ...(mk ? ['+ PRODUCT_C → spec/product_c'] : [])], { fs: 24, lh: 38, title: 'Makefile', hl: mk ? [1] : [], hlA: seg(lt, 5.0, 5.4), al: seg(lt, 4.4, 4.7) });
    box(g, 1060, 640, 620, 140, '公共层 spec_report/', seg(lt, 7.9, 8.4), { fs: 28 });
    stamp(g, '零改动', 1596, 694, clamp((lt - 8.4) / .7), { fs: 30 });
  },
});

/* =====================================================================
 * 第六章：一个不能删的空函数（⚠ 第 31 幕为机制演绎）
 * ===================================================================== */
const L30 = ['void curtain_init(void) {', '    ...', '    spec_init();        // 什么都不做', '}', '', 'void spec_init(void) { }'];
S('s30', {
  cues: [[2.2, 'type'], [5.0, 'blip'], [6.6, 'whoosh', .5], [7.4, 'error'], [9.6, 'draw'], [10.8, 'latch']],
  draw(g, lt) {
    codeCard(g, 180, 200, 900, L30, { p: seg(lt, 2.2, 4.6), lt, title: '初始化（示意）', hl: lt > 4.8 ? [2, 5] : [], hlA: seg(lt, 4.8, 5.2) });
    const e = seg(lt, 6.4, 7.2), shake = lt > 7.2 && lt < 8.0 ? Math.sin(lt * 40) * 6 : 0;
    if (e > 0) eraser(g, lerp(1060, 820, eo(e)) + shake, lerp(760, 470, eo(e)), 1, { al: 1 - seg(lt, 9.0, 9.4) });
    if (lt > 7.3) { warnIcon(g, 820, 610, 40 * pop(seg(lt, 7.3, 7.7))); text(g, '不能删', 860, 612, { s: 32, w: 900, a: 'left', c: C.amber, al: seg(lt, 7.5, 7.9) }); }
    const r = seg(lt, 9.4, 10.0);
    fileIcon(g, 1260, 190, 110, 140, { al: r, c: C.cyan, fill: rgba(C.cyan, .1) });
    text(g, 'rpc_entry.c', 1315, 360, { f: 'mono', s: 26, w: 700, c: C.cyan, al: r });
    text(g, '云端 RPC 入口', 1500, 260, { s: 26, w: 700, a: 'left', c: C.ink2, al: r });
    frame(g, 1200, 450, 500, 250, { p: seg(lt, 9.6, 10.2), fill: rgba(C.plate, .5) });
    text(g, '特殊段（section）', 1450, 480, { s: 24, w: 900, al: seg(lt, 9.9, 10.2) });
    for (let i = 0; i < 3; i++) frame(g, 1230, 510 + i * 60, 440, 50, { p: seg(lt, 9.9 + i * .1, 10.3 + i * .1), lw: 1.6, fill: rgba(C.ink, .03) });
    const d = seg(lt, 10.2, 10.8);
    if (d > 0) evtCap(g, 1450, lerp(380, 595, eo(d)), ['入口地址'], { glow: .5 });
    ripple(g, 1450, 595, lt - 10.8);
    text(g, '编译期就放进特殊段', 1450, 760, { s: 24, w: 700, c: C.ink2, al: seg(lt, 11.0, 11.4) });
  },
});
S('s31', {
  cues: [[.5, 'draw'], [1.0, 'whoosh', .5], [2.1, 'error', .5], [4.6, 'snip'], [5.3, 'whoosh', .6], [8.0, 'error'], [11.4, 'whoosh'], [12.2, 'latch'], [12.7, 'success']],
  draw(g, lt) {
    const rew = seg(lt, 11.3, 11.9), gone = seg(lt, .8, 1.6) * (1 - rew), fall = seg(lt, 5.2, 6.4) * (1 - rew);
    frame(g, 200, 190, 640, 430, { p: seg(lt, .2, .8), ticks: true, fill: rgba(C.plate, .4) });
    text(g, '静态库', 226, 228, { s: 28, w: 900, a: 'left', al: seg(lt, .4, .8) });
    box(g, 240, 270, 260, 90, '转换器', seg(lt, .3, .8)); box(g, 540, 270, 260, 90, '映射表', seg(lt, .4, .9));
    at(g, 520, 475 + fall * 240, 1, () => box(g, -130, -55, 260, 110, 'RPC 入口', seg(lt, .5, 1.0), { lit: rew * .7, c: fall > 0 ? C.red : C.ink, tc: fall > 0 ? C.red : C.ink }), { rot: fall * .5, al: 1 - fall });
    if (lt > 4.4 && lt < 5.6) { const o = Math.abs(Math.sin((lt - 4.4) * 9)); scissors(g, 330 + seg(lt, 4.5, 5.3) * 380, 418, 1.0, o); path(g, [[390, 418], [650, 418]], { c: C.red, w: 2, dash: [8, 6] }); }
    text(g, '没人引用 → 被链接器裁掉', 816, 228, { s: 26, w: 900, a: 'right', c: C.red, al: seg(lt, 2.0, 2.4) * (1 - rew) });
    // spec_init()：被擦掉 → 倒回后变成锚
    const ia = 1 - gone;
    box(g, 400, 720, 240, 60, 'spec_init()', seg(lt, .3, .7) * ia, { f: 'mono', fs: 24 });
    path(g, [[520, 720], [520, 534]], { c: C.cyan, w: 2, dash: [6, 6], al: ia * seg(lt, .4, .8) });
    if (lt > .8 && lt < 2.0) eraser(g, lerp(700, 520, seg(lt, .8, 1.4)), 750, .9);
    if (rew > 0) { anchorIcon(g, 700, 740, .7, { c: C.amber, al: seg(lt, 11.6, 12.0) }); text(g, '链接锚', 760, 740, { s: 28, w: 900, a: 'left', c: C.amber, al: seg(lt, 12.0, 12.4) }); }
    // 右：设备与云端；上行照常，下行断开
    curtain(g, 1120, 660, 360, 'single', lt, { ms: .6, h: 100, step: 24, p: seg(lt, .4, 1.2), open: .2 });
    text(g, '设备', 1300, 800, { s: 26, w: 700, c: C.ink2, al: seg(lt, .8, 1.2) });
    cloud(g, 1560, 230, 1.2, '云端');
    pipe(g, [[1240, 590], [1470, 290]], lt, { p: seg(lt, .8, 1.4), flow: .9, head: true });
    text(g, '上报照常', 1280, 420, { s: 26, w: 700, a: 'right', c: C.cyan, al: seg(lt, 8.0, 8.4) });
    const brk = seg(lt, 7.8, 8.2) * (1 - seg(lt, 12.3, 12.6)), dn = [[1620, 310], [1420, 600]];
    if (brk > 0) {
      pipe(g, [dn[0], posOn(dn, .42)], lt, { flow: .6, fc: C.red, c: C.red });
      sparks(g, ...posOn(dn, .5), (lt * 5) % .6, C.red, 10, 50);
      redCross(g, ...posOn(dn, .5), 40, brk);
      text(g, '控制收不到', 1600, 470, { s: 28, w: 900, a: 'left', c: C.red, al: brk });
    } else pipe(g, dn, lt, { p: seg(lt, 1.0, 1.6), flow: lt > 12.4 ? .9 : .6, fc: lt > 12.4 ? C.green : C.cyan, head: true });
    if (rew > 0) path(g, partial([[700, 700], [700, 560], [650, 500]], seg(lt, 12.0, 12.5)), { c: C.amber, w: 3 });
  },
});
S('s32', {
  cues: [[.5, 'draw'], [4.3, 'latch']],
  draw(g, lt) {
    anchorIcon(g, 720, 400, 1.5 * pop(seg(lt, .3, .9)), { c: C.amber, rot: wob(lt, .3, .06) });
    scissors(g, 1180, 400, 1.3 * pop(seg(lt, .5, 1.1)), .15 + .1 * Math.sin(lt * 1.3), { rot: -.2 });
    text(g, '空函数 = 链接锚', 720, 560, { s: 28, w: 900, c: C.amber, al: seg(lt, .8, 1.2) });
    text(g, '链接器的裁剪', 1220, 560, { s: 28, w: 900, c: C.red, al: seg(lt, 1.0, 1.4) });
    dimLine(g, 560, 660, 1360, 660, null, seg(lt, 3.9, 4.6), { c: C.ink2 });
    text(g, '链接期绑定的代价面', 960, 720, { s: 36, w: 900, al: seg(lt, 4.2, 4.6) });
  },
});

/* =====================================================================
 * 总结与片尾
 * ===================================================================== */
const TAKE = [['01', ['差异交给', '构建系统去选'], '公共代码不认产品'], ['02', ['先分类，', '再动手'], '每一步都能编译、能回归'], ['03', ['零运行时成本，', '也有代价'], '独有接口要屏蔽，链接锚要留']];
function takeCard(g, i, lt, mode) { // mode: 'reveal' 正在展开 / 'done' 已展开（略暗）
  const x = 180 + i * 540, cx = x + 240, rv = mode === 'reveal', p = rv ? seg(lt, .2, .9) : 1, a = rv || mode === 'lit' ? 1 : .6, [num, title, sub] = TAKE[i];
  g.save(); g.globalAlpha *= a;
  frame(g, x, 190, 480, 600, { p, ticks: true, lit: rv ? seg(lt, .6, 1.2) * .4 : 0, fill: rgba(C.plate, .55) });
  const q = rv ? seg(lt, .5, 1.3) : 1;
  text(g, num, cx, 280, { f: 'disp', s: 96, w: 900, noFill: false, c: rgba(C.ink, .08), stroke: C.cyan, lw: 3, al: q });
  title.forEach((t, k) => text(g, t, cx, 380 + k * 50, { s: 38, w: 900, al: q }));
  g.save(); g.globalAlpha *= seg(q, .3, 1);
  if (i === 0) { box(g, cx - 70, 520, 140, 46, 'variant/', 1, { f: 'mono', fs: 24 }); pipe(g, [[cx - 70, 543], [cx - 130, 543], [cx - 130, 620]], lt, { flow: .6 }); pipe(g, [[cx + 70, 543], [cx + 130, 543], [cx + 130, 620]], lt, { flow: .6 }); box(g, cx - 200, 620, 140, 46, 'single/', 1, { f: 'mono', fs: 24, lit: .5 }); box(g, cx + 60, 620, 140, 46, 'dual/', 1, { f: 'mono', fs: 24, dash: [6, 5] }); }
  if (i === 1) { for (let d = 0; d < 11; d++) frame(g, cx - 198 + d * 36, 520, 30, 50, { lw: 1.6, construct: false, fill: rgba(C.red, .12) }); draft(g, [[cx - 190, 640], [cx + 190, 640]], 1, { w: 2.4 }); for (let s = 0; s < 6; s++) dot(g, cx - 190 + s * 76, 640, 9, C.cyan); }
  if (i === 2) { balance(g, cx - 40, 540, .5, '', '', 1); anchorIcon(g, cx + 150, 600, .55, { c: C.amber }); }
  g.restore();
  text(g, sub, cx, 740, { s: 24, w: 700, c: C.ink2, al: seg(q, .5, 1) });
  g.restore();
}
S('s33', { cues: [[.2, 'whoosh'], [.9, 'latch']], draw(g, lt) { takeCard(g, 0, lt, 'reveal'); } });
S('s34', { cues: [[.2, 'whoosh'], [.9, 'latch']], draw(g, lt) { takeCard(g, 0, lt, 'done'); takeCard(g, 1, lt, 'reveal'); } });
S('s35', {
  cues: [[.2, 'whoosh'], [.9, 'latch'], [6.6, 'success']],
  draw(g, lt) {
    const all = seg(lt, 6.4, 7.0);
    at(g, 960, 490, 1 + .02 * Math.sin(all * Math.PI), () => { g.translate(-960, -490); takeCard(g, 0, lt, all > .5 ? 'lit' : 'done'); takeCard(g, 1, lt, all > .5 ? 'lit' : 'done'); takeCard(g, 2, lt, 'reveal'); });
  },
});
S('s36', {
  title: true, fi: .2, fo: .4,
  draw(g, lt) {
    frame(g, 560, 380, 800, 280, { p: seg(lt, 0, .35), ticks: true, fill: rgba(C.plate, .55) });
    text(g, SERIES.title, 960, 490, { s: 110, w: 900, al: seg(lt, .1, .4) });
    text(g, SERIES.sub, 960, 590, { s: 40, w: 700, c: C.cyan, al: seg(lt, .2, .5) });
  },
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
