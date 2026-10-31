/* =====================================================================
 * 帧动画主题开发 —— 19 幕编排（字幕数据在 script.js，风格包与内存曲线在 kit.js）
 * 结构：0 开场、1 片名、2–5 四章、6 总结、7 系列片尾（audio.py / checks.cjs 按此读取）。
 * 章节转场：胶片片头倒数圈（光圈开 → 扇形扫过 → 光圈合），画在每章首幕的前 1.95 秒。
 * 所有绘制只依赖时间 t。曲线落点数字 = Profiler 截图顶栏读数（视频稿附录 A）。
 * ===================================================================== */
'use strict';
const CHAPTERS = [
  ['开场｜点完 200 张卡片', 'TWO HUNDRED TAPS', '200 张卡片点完，桌面内存 1.2GB；6～7 分钟后还在 1.1GB。'],
  ['帧动画主题开发', 'FRAME ANIMATION THEMES', '从 1.2GB 到一条平线。'],
  ['第一章｜为什么是帧动画', 'WHY FRAMES', '50 帧的翻页书；Lottie 的三个问题与帧动画的代价。'],
  ['第二章｜现成方案的内存账', 'THE 1.2 GB BILL', 'AnimationDrawable：Native 989.3MB，6～7 分钟后仍有 942MB。'],
  ['第三章｜自己写播放器', 'OUR OWN PLAYER', '点击才加载、命名约定与 LRU 帧表、协程帧循环、同一时刻只播一个。'],
  ['第四章｜缓存的粒度', 'CACHE GRANULARITY', 'bytes 缓存的锯齿；inBitmap 复用一块画布；三条曲线；释放与兜底。'],
  ['总结｜三条经验', 'THREE TAKEAWAYS', '自己管生命周期；缓存选粒度；用约束换资源。'],
  ['系列片尾', 'WORK ARCHIVE', '工作档案：把做过的设计，讲成故事。'],
];
const CARD = { 2: ['01', '为什么是帧动画', 'WHY FRAMES', C.amber], 3: ['02', '现成方案的内存账', 'THE 1.2 GB BILL', C.red],
  4: ['03', '自己写播放器', 'OUR OWN PLAYER', C.blue], 5: ['04', '缓存的粒度', 'CACHE GRANULARITY', C.teal], 6: ['✓', '三条经验', 'THREE TAKEAWAYS', C.amber] };
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };
const CAP = { em: '#1F7A73', danger: '#C23A2E', accent: C.amber };

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.bg, white: C.ink, cyan: CAP.em, red: CAP.danger, amber: C.amber },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: CAP.em, danger: CAP.danger, accent: CAP.accent },
    maxWidth: 1500, lineHeight: 64, baseY: n => n > 1 ? 932 : 972, slide: 0, fadeIn: .12, fadeOut: .12, revealDuration: () => 0 },
  prepare: prepareStyle, drawBackground,
  beforeScene(g, frame) {
    const { sc, lt, t } = frame; SCX = frame.scaleX;
    const [cx, cy, z] = camAt(sc.cam, lt); CAMZ = z;
    const fr = Math.floor(t * FPS), jx = (hash(fr * 1.9) - .5) * 1.1, jy = (hash(fr * 2.7) - .5) * 1.1; // 片门抖动
    g.translate(W / 2 + jx, H / 2 + jy); g.scale(z, z); g.translate(-cx, -cy);
    g.globalAlpha *= Math.min(sc.fi ? eo(seg(lt, 0, sc.fi)) : 1, sc.fo ? 1 - eo(seg(lt, sc.d - sc.fo, sc.d)) : 1);
  },
  drawTransition(g, frame) { CAMZ = 1; postFX(g, frame); leader(g, frame); },
  drawChrome, drawCaptionBackground, drawCaption, drawCover,
});
function screenSpace(g, fn) { g.save(); g.setTransform(SCX, 0, 0, SCX, 0, 0); const z = CAMZ; CAMZ = 1; try { fn(); } finally { CAMZ = z; g.restore(); } }

/* 章节转场：胶片片头倒数圈 */
function leader(g, { sc, lt, t }) {
  const cd = CARD[sc.card]; if (!cd || lt > 1.95) return;
  const [num, zh, en, col] = cd;
  const R = 1250 * Math.min(eio(seg(lt, 0, .32)), 1 - eio(seg(lt, 1.45, 1.92)));
  if (R <= 1) return;
  const fr = Math.floor(t * FPS), cx = 640, cy = 520;
  g.save(); g.beginPath(); g.arc(960, 540, R, 0, TAU); g.clip();
  g.fillStyle = '#3B332B'; g.fillRect(0, 0, W, H);
  g.fillStyle = rgba('#000000', .05 + .06 * hash(fr)); g.fillRect(0, 0, W, H);
  // 扇形扫过
  const sw = seg(lt, .2, 1.3);
  g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 420, -TAU / 4, -TAU / 4 + TAU * sw); g.closePath(); g.fillStyle = rgba(col, .38); g.fill();
  path(g, [[0, cy], [W, cy]], { c: rgba(C.paper, .5), w: 3 }); path(g, [[cx, 0], [cx, H]], { c: rgba(C.paper, .5), w: 3 });
  ring(g, cx, cy, 300, rgba(C.paper, .85), 5); ring(g, cx, cy, 360, rgba(C.paper, .6), 3);
  const a = eo(seg(lt, .28, .6));
  text(g, num, cx, cy + 8, { f: 'disp', w: 900, s: 250, c: C.paper, al: a });
  text(g, zh, 1060, cy - 40, { s: 96, w: 900, c: C.paper, a: 'left', al: a });
  text(g, en, 1066, cy + 56, { f: 'mono', s: 30, w: 700, ls: 8, c: rgba(C.paper, .7), a: 'left', al: a });
  rr(g, 1066, cy + 100, 380 * eio(seg(lt, .4, .9)), 10, 5); g.fillStyle = col; g.fill();
  g.restore();
  ring(g, 960, 540, R, rgba(C.paper, .5), 6);
}

/* 外框：左上章节、右上进度（小胶片格）、演绎/慢放标记 */
const CH_SHORT = ['开场', '', '第一章 · 为什么是帧动画', '第二章 · 现成方案的内存账', '第三章 · 自己写播放器', '第四章 · 缓存的粒度', '总结 · 三条经验', ''];
const chColor = k => (CARD[k] || [0, 0, 0, C.amber])[3];
function drawChrome(g, { sc, lt }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 64;
    card(g, 52, 42, w, 50, { r: 25, fill: rgba(C.film, .82), lw: 2, stroke: rgba(C.paper, .25), sb: 12, so: 4 });
    dot(g, 80, 67, 8, chColor(sc.chapter));
    text(g, lab, 98, 68, { s: 26, w: 700, a: 'left', c: C.paper });
  }
  for (let k = 2; k <= 6; k++) {
    const cur = sc.chapter === k, on = sc.chapter >= k, x = 1640 + (k - 2) * 46;
    rr(g, x, 52, 36, 28, 4); g.fillStyle = cur ? chColor(k) : on ? rgba(C.paper, .45) : rgba(C.paper, .12); g.fill();
    rr(g, x + 6, 58, 24, 16, 2); g.fillStyle = rgba(C.film, cur ? .35 : .55); g.fill();
  }
  let xr = 1612;
  const demo = typeof sc.demo === 'function' ? sc.demo(lt) : sc.demo, scaled = typeof sc.scaled === 'function' ? sc.scaled(lt) : sc.scaled;
  if (demo > 0) xr -= tagSmall(g, '⚠ 机制演绎', xr, 66, C.amber, demo) + 12;
  if (scaled > 0) tagSmall(g, '时间已放慢', xr, 66, C.blue, scaled);
  g.restore();
}
function tagSmall(g, s, xr, y, c, al = 1) {
  const w = textW(g, s, { s: 24, w: 700 }) + 36;
  g.save(); g.globalAlpha *= clamp(+al);
  card(g, xr - w, y - 22, w, 44, { r: 22, fill: rgba(C.film, .85), lw: 2.5, stroke: c, sb: 10, so: 3 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c });
  g.restore();
  return w;
}

/* 字幕：米色胶带底板 + 墨字 */
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
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .25)), y = top + (1 - k) * 10, x = (W - w) / 2;
  g.save(); g.globalAlpha *= c.alpha;
  card(g, x, y, w, h, { r: 8, fill: rgba(C.paper, .96), sb: 26, so: 10, sa: .45 });
  for (const [tx, rot] of [[x - 14, -.08], [x + w - 46, .07]]) { // 两端的半透明胶带
    g.save(); g.translate(tx + 30, y + 8); g.rotate(rot); g.fillStyle = rgba(C.amber, .45); g.fillRect(-30, -14, 60, 28); g.restore();
  }
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
      if (s.c === CAP.accent) { rr(g, x - 3, l.y + 6 + (1 - k) * 10, w + 6, 14, 5); g.fillStyle = rgba(C.amber, .5); g.fill(); }
      text(g, s.s, x, l.y + (1 - k) * 10, { s: 54, w: 700, c: s.c && s.c !== CAP.accent ? s.c : C.ink, a: 'left', b: 'alphabetic' });
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
const ap = (lt, t0, d = .5) => pop(seg(lt, t0, t0 + d));
const fa = (lt, t0, d = .4) => eo(seg(lt, t0, t0 + d));
const fo = (lt, t0, d = .4) => 1 - eo(seg(lt, t0, t0 + d));
const demoWin = (a, b) => lt => win(lt, a, b, .3, .3);

/* ---------------- 通用图元 ---------------- */
function finger(g, x, y, k, o = {}) { // 点按：按下圆点 + 涟漪；k = 按下后的秒数
  const press = k >= 0 && k < .18 ? 1 - k / .18 * .3 : 1;
  if (k > -0.4 && k < .9) {
    dot(g, x, y, 26 * press, rgba(C.paper, .9 * (1 - clamp(k / .9)))); ring(g, x, y, 26 * press, C.ink, 3, 1 - clamp(k / .9));
    ripple(g, x, y, k, C.amber, 26, 90, .55);
  }
}
/* 智能屏桌面：看板 5×4 场景卡片（排布示意）；flash(j) 返回第 j 张的点击高光 0..1 */
const DEV = { x: 600, y: 520, w: 860, h: 560 };
function deskDevice(g, lt, o = {}) {
  const { x, y, w, h } = DEV;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  card(g, x - w / 2, y - h / 2, w, h, { r: 34, fill: '#2B241E', lw: 3, stroke: '#4A3D33', sa: .55, sb: 40, so: 16 });
  rr(g, x - w / 2 + 22, y - h / 2 + 22, w - 44, h - 44, 18); g.fillStyle = '#3A3129'; g.fill();
  text(g, `看板 ${o.board ?? 1}/10`, x - w / 2 + 48, y - h / 2 + 56, { s: 26, w: 700, c: rgba(C.paper, .8), a: 'left' });
  for (let i = 0; i < 10; i++) dot(g, x + w / 2 - 260 + i * 22, y - h / 2 + 56, 6, i < (o.board ?? 1) ? C.amber : rgba(C.paper, .2));
  const cw = 140, ch = 92, gx = 18, gy = 16, x0 = x - (5 * cw + 4 * gx) / 2 + cw / 2, y0 = y - h / 2 + 116 + ch / 2;
  const dx = o.slide || 0;
  g.save(); rr(g, x - w / 2 + 22, y - h / 2 + 22, w - 44, h - 44, 18); g.clip();
  for (let j = 0; j < 20; j++) {
    const cx = x0 + (j % 5) * (cw + gx) + dx, cy = y0 + Math.floor(j / 5) * (ch + gy), f = o.flash ? o.flash(j) : 0;
    const k = o.scaleOf ? o.scaleOf(j) : 1 - .12 * Math.sin(Math.PI * clamp(f));
    sceneCard(g, cx, cy, cw, ch, (j + (o.board ?? 1) * 2) % 6, { k, glow: f > 0 && f < 1 ? Math.sin(Math.PI * f) : 0 });
  }
  g.restore();
  g.restore();
  return { x0, y0, cw, ch, gx, gy };
}
/* 竖直内存量柱 */
const METER = { x: 1560, y0: 800, h: 600, w: 84 };
function memMeter(g, v, o = {}) {
  const { x, y0, h, w } = METER, top = y0 - h, lvl = y0 - h * clamp(v / 1200);
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  card(g, x - w / 2 - 10, top - 10, w + 20, h + 20, { r: (w + 20) / 2, fill: '#2B241E', lw: 3, stroke: '#5A4B3E', sa: .5 });
  g.save(); rr(g, x - w / 2, top, w, h, w / 2); g.clip();
  g.fillStyle = rgba(C.paper, .06); g.fillRect(x - w / 2, top, w, h);
  const gr = g.createLinearGradient(0, lvl, 0, y0); gr.addColorStop(0, '#F06A4F'); gr.addColorStop(1, '#8E2A21');
  g.fillStyle = gr; g.fillRect(x - w / 2, lvl, w, y0 - lvl);
  g.fillStyle = rgba('#ffffff', .25); g.fillRect(x - w / 2, lvl, w, 5);
  g.fillStyle = rgba('#ffffff', .12); g.fillRect(x - w / 2 + 12, top, 14, h);
  g.restore();
  for (let i = 1; i < 12; i++) path(g, [[x + w / 2 + 14, y0 - h * i / 12], [x + w / 2 + (i % 3 ? 26 : 38), y0 - h * i / 12]], { c: rgba(C.paper, .45), w: 3 });
  text(g, '桌面内存', x, top - 44, { s: 28, w: 900, c: C.paper });
  g.restore();
  return lvl;
}
/* 胶片盒片架（LRU）：slots 为可见格数；items = [[label, col, x偏移格, al, dy]] */
function lruShelf(g, x, y, w, items, o = {}) {
  card(g, x, y + 54, w, 22, { r: 6, fill: '#6B5644', sa: .5 });
  path(g, [[x + 20, y + 76], [x + 20, y + 130]], { c: '#4A3D33', w: 10 }); path(g, [[x + w - 20, y + 76], [x + w - 20, y + 130]], { c: '#4A3D33', w: 10 });
  const step = o.step || 112;
  for (const [lab, col, k, al, dy] of items) canister(g, x + 64 + k * step, y + 4 + (dy || 0), 48, col, lab, { al });
  if (o.title) text(g, o.title, x + w / 2, y - 66, { s: 26, w: 700, c: rgba(C.paper, .85) });
  if (o.ends) { text(g, '最近使用', x + 20, y + 112, { s: 24, w: 700, c: C.dim, a: 'left' }); text(g, '先被挤出', x + w - 20, y + 112, { s: 24, w: 700, c: C.dim, a: 'right' }); }
}
const CHART = { x: 600, y: 140, w: 1240, h: 720 };
const LBL = ['操作最后一个看板时', '6～7 分钟后'];

/* =====================================================================
 * 0 开场
 * ===================================================================== */
const BOARD_T = b => 4.6 + b * .66;
function s01Count(lt) { let n = 0; for (let b = 0; b < 10; b++) for (let j = 0; j < 20; j++) if (lt >= BOARD_T(b) + j * .026) n++; return n; }
S('s01', {
  cues: [[1.0, 'click'], ...Array.from({ length: 10 }, (_, b) => [BOARD_T(b), 'click', .7]), [11.35, 'stamp'], [12.7, 'tick'], [13.4, 'tick'], [14.1, 'tick'], [14.95, 'stamp', .7], [16.4, 'draw'], [17.7, 'draw', .6], [18.7, 'pop']],
  draw(g, lt) {
    // —— 桌面与点击
    const b = clamp(Math.floor((lt - 4.6) / .66), 0, 9), inBoards = lt >= 4.6 && lt < 11.3;
    const tb = BOARD_T(b), slide = inBoards ? -40 * eo(seg(lt, tb + .58, tb + .66)) : 0;
    const devAl = lt < 16.2 ? 1 : lerp(1, .28, eo(seg(lt, 16.2, 16.8)));
    const flash = j => {
      if (lt < 4.4) return j === 7 ? seg(lt, 1.0, 3.0) : 0;
      if (!inBoards) return 0;
      return seg(lt, tb + j * .026, tb + j * .026 + .28);
    };
    const scaleOf = j => (lt < 4.4 && j === 7 && lt >= 1.0 && lt < 3.0) ? frameScale(Math.floor((lt - 1.0) * 25)) : 1 - .12 * Math.sin(Math.PI * clamp(flash(j)));
    const geo = deskDevice(g, lt, { board: lt < 4.6 ? 1 : b + 1, flash, scaleOf, slide, al: devAl });
    // 单次点击：2 秒计时环
    if (lt > .6 && lt < 4.4) {
      const cx = geo.x0 + 2 * (geo.cw + geo.gx), cy = geo.y0 + geo.ch + geo.gy;
      finger(g, cx + 30, cy + 20, lt - 1.0);
      const p = seg(lt, 1.0, 3.0), al = win(lt, 1.0, 4.2, .2, .3);
      g.save(); g.globalAlpha *= al;
      dot(g, cx + 96, cy - 50, 40, C.film); ring(g, cx + 96, cy - 50, 32, rgba(C.amber, .25), 8); ring(g, cx + 96, cy - 50, 32, C.amber, 8, 1, -TAU / 4, -TAU / 4 + TAU * p);
      text(g, '2 秒', cx + 96, cy - 49, { s: 24, w: 900, c: C.paper });
      g.restore();
    }
    // 连点：手指沿波前移动
    if (inBoards) {
      const j = clamp(Math.floor((lt - tb) / .026), 0, 19);
      finger(g, geo.x0 + (j % 5) * (geo.cw + geo.gx) + 30, geo.y0 + Math.floor(j / 5) * (geo.ch + geo.gy) + 20, (lt - tb - j * .026));
    }
    // —— 计数器
    const n = s01Count(lt), cAl = fa(lt, 4.3) * (lt < 16.2 ? 1 : lerp(1, .3, eo(seg(lt, 16.2, 16.8))));
    if (cAl > 0) {
      g.save(); g.globalAlpha *= cAl;
      text(g, '已点卡片', 1225, 262, { s: 26, w: 700, c: rgba(C.paper, .75) });
      card(g, 1105, 290, 240, 100, { r: 12, fill: C.film, lw: 2, stroke: rgba(C.paper, .2) });
      const s = String(n).padStart(3, '0');
      for (let i = 0; i < 3; i++) { rr(g, 1118 + i * 76, 302, 62, 76, 6); g.fillStyle = '#2E2620'; g.fill(); text(g, s[i], 1149 + i * 76, 342, { f: 'disp', s: 64, w: 900, c: n >= 200 ? C.red : C.paper }); }
      text(g, '/ 200', 1225, 420, { f: 'mono', s: 28, w: 700, c: rgba(C.paper, .7) });
      g.restore();
    }
    // —— 内存量柱（中途不标数字）
    let v = 300;
    if (lt >= 4.6) { const k = clamp((lt - 4.6) / 6.6); const steps = Math.floor(k * 10), f = frac(k * 10); v = lerp(300, 1190.1, (steps + sstep((f - .5) / .5)) / 10); }
    if (lt >= 11.2) v = 1190.1;
    if (lt >= 12.8) v = lerp(1190.1, 1088.4, eio(seg(lt, 12.8, 14.8)));
    const mAl = lt < 16.2 ? 1 : lerp(1, .3, eo(seg(lt, 16.2, 16.8)));
    const lvl = memMeter(g, v, { al: mAl });
    g.save(); g.globalAlpha *= mAl;
    if (lt >= 11.3 && lt < 14.95) stamp(g, '1.2 GB', 1752, lvl + 24, seg(lt, 11.3, 11.9), C.red, { fs: 46, seed: 1 });
    if (lt >= 14.95) stamp(g, '1.1 GB', 1752, lvl + 24, seg(lt, 14.95, 15.5), C.red, { fs: 46, seed: 2 });
    g.restore();
    // —— 6～7 分钟后：时钟快转
    const cl = win(lt, 12.5, 16.4, .3, .4);
    if (cl > 0) {
      g.save(); g.globalAlpha *= cl;
      clockFace(g, 1225, 590, 74, 6.5 * eio(seg(lt, 12.6, 14.8)));
      text(g, '6～7 分钟后', 1225, 712, { s: 30, w: 900, c: C.paper });
      g.restore();
    }
    // —— 怎么压平
    if (lt > 16.2) {
      const stair = [[230, 760]]; for (let i = 0; i < 6; i++) { const y = 760 - i * 70; stair.push([230 + (i + 1) * 120 - 30, y]); stair.push([230 + (i + 1) * 120, y - 70]); }
      path(g, partial(stair, eo(seg(lt, 16.3, 17.4))), { c: C.red, w: 9 });
      path(g, partial([[230, 680], [1000, 680]], eo(seg(lt, 17.7, 18.6))), { c: C.teal, w: 9, dash: [26, 18] });
      at(g, 1090, 600, ap(lt, 18.6, .5), () => text(g, '?', 0, 0, { f: 'disp', s: 180, w: 900, c: C.amber, glow: rgba(C.amber, .6) }));
    }
  },
});

/* =====================================================================
 * 1 片名
 * ===================================================================== */
S('s02', {
  title: true, fi: .3,
  cues: [[.1, 'whoosh'], [.9, 'reel'], [2.3, 'pop'], [2.9, 'draw', .6]],
  draw(g, lt) {
    const off = 2600 * (1 - eo(seg(lt, 0, 1.5))) + lt * 40;
    filmStrip(g, -20, 680, W + 40, 190, { foff: -off, frame: (g2, idx, fx, fy, fw, fh) => cardFrame(g2, idx * 3, fx, fy, fw, fh, { sc: ((idx % 6) + 6) % 6 }) });
    const title = '帧动画主题开发', o = { s: 124, w: 900 };
    const chars = Array.from(title), total = textW(g, title, o);
    let x = 960 - total / 2;
    chars.forEach((ch, i) => {
      const w = textW(g, ch, o), p = seg(lt, .5 + i * .06, .95 + i * .06);
      at(g, x + w / 2, 360 + (1 - eo(p)) * 70, .6 + .4 * pop(p), () => text(g, ch, 0, 0, { ...o, c: i < 3 ? C.amber : C.paper }), { al: eo(p) });
      x += w;
    });
    rr(g, 960 - total / 2, 440, total * eio(seg(lt, 1.2, 1.8)), 10, 5); g.fillStyle = C.amber; g.fill();
    at(g, 960, 520, ap(lt, 2.3), () => text(g, '从 1.2GB 到一条平线', 0, 0, { s: 58, w: 900, c: C.paper }));
    const cur = [[700, 618]]; for (let i = 0; i < 4; i++) { cur.push([700 + i * 60 + 40, 618 - i * 18]); cur.push([700 + i * 60 + 60, 600 - i * 18]); }
    path(g, partial(cur, eo(seg(lt, 2.9, 3.6))), { c: C.red, w: 6 });
    path(g, partial([[960, 560 + 70], [1220, 630]], eo(seg(lt, 3.6, 4.3))), { c: C.teal, w: 6 });
    arrowHead(g, 1225, 630, 0, C.teal, 16, eo(seg(lt, 4.2, 4.4)));
  },
});

/* =====================================================================
 * 2 第一章：为什么是帧动画
 * ===================================================================== */
S('s03', {
  card: 2, scaled: lt => win(lt, 2.0, 13.8),
  cues: [[0, 'leader'], [2.2, 'flip', .5], [6.4, 'pop'], [7.3, 'pop'], [8.2, 'pop'], [10.4, 'whoosh', .6]],
  cam: [[0, 960, 540, 1], [9.8, 960, 540, 1], [11, 900, 540, 1]],
  draw(g, lt) {
    const page = Math.max(0, (lt - 1.8) * 6), bk = lt < 10.2 ? 1 : lerp(1, .82, eo(seg(lt, 10.2, 11)));
    at(g, lerp(640, 520, eo(seg(lt, 10.2, 11))), 470, bk, () => {
      flipBook(g, 0, 0, 560, 380, page, { sc: 0 });
      // 40ms 刻度尺
      const rx = -280, rw = 560, ry = 250;
      path(g, [[rx, ry], [rx + rw, ry]], { c: rgba(C.paper, .6), w: 3 });
      for (let i = 0; i <= 25; i++) path(g, [[rx + i * rw / 25, ry], [rx + i * rw / 25, ry + (i % 5 ? 12 : 22)]], { c: rgba(C.paper, .6), w: 2.5 });
      const mk = rx + (frac(page / 25)) * rw;
      arrowHead(g, mk, ry - 4, Math.PI / 2, C.amber, 18);
      text(g, '每帧 40ms', rx + rw / 2, ry + 56, { s: 30, w: 700, c: rgba(C.paper, .8) });
    }, { al: fa(lt, 1.6, .5) });
    // 三个参数
    const nums = [['2 秒', '时长', 6.4], ['25 帧/秒', '帧率', 7.3], ['50 帧', '2 × 25', 8.2]];
    nums.forEach(([big, small, t0], i) => {
      const al = lt < 10.2 ? 1 : fo(lt, 10.2, .5);
      at(g, 1400, 280 + i * 170, ap(lt, t0), () => {
        card(g, -230, -66, 460, 132, { r: 14, fill: C.paper });
        text(g, big, -200, 0, { f: 'disp', s: 64, w: 900, c: C.ink, a: 'left' });
        text(g, small, 200, 2, { s: 28, w: 700, c: C.ink2, a: 'right' });
      }, { al });
    });
    // 一帧一张图：胶片
    if (lt > 10.2) {
      const al = fa(lt, 10.2, .5);
      text(g, '一帧 = 一张图', 1360, 330, { s: 34, w: 900, c: C.paper, al });
      filmStrip(g, 920, 390, 1000, 200, { foff: (lt - 10.2) * 60 + 1200 * (1 - eo(seg(lt, 10.2, 11))), al, frame: (g2, idx, fx, fy, fw, fh) => cardFrame(g2, idx, fx, fy, fw, fh) });
      text(g, '00 → 49', 1420, 640, { f: 'mono', s: 30, w: 700, c: C.amber, al: fa(lt, 10.9) });
    }
  },
});

S('s04', {
  cues: [[.3, 'pop'], [4.5, 'stamp', .6], [6.5, 'stamp', .6], [8.8, 'stamp', .6], [12.6, 'success', .5], [13.0, 'success', .5], [13.9, 'pop', .6], [14.5, 'pop', .6], [15.1, 'pop', .6], [15.9, 'error', .5]],
  draw(g, lt) {
    const L = { x: 150, y: 160, w: 740, h: 680 }, R = { x: 1030, y: 160, w: 740, h: 680 };
    const lAl = lt < 12.2 ? 1 : lerp(1, .5, eo(seg(lt, 12.2, 12.7))), rAl = lt < 12.2 ? .5 : lerp(.5, 1, eo(seg(lt, 12.2, 12.7)));
    // Lottie 卡
    at(g, L.x + L.w / 2, L.y + L.h / 2, ap(lt, .1), () => {
      card(g, -L.w / 2, -L.h / 2, L.w, L.h, { r: 18, fill: C.paper });
      text(g, 'Lottie', -L.w / 2 + 40, -L.h / 2 + 70, { f: 'disp', s: 64, w: 900, c: C.ink, a: 'left' });
      text(g, '动画 = 一份 JSON', -L.w / 2 + 42, -L.h / 2 + 136, { s: 30, w: 700, c: C.ink2, a: 'left' });
      card(g, L.w / 2 - 170, -L.h / 2 + 40, 120, 140, { r: 10, fill: '#FFFDF7', lw: 3, stroke: C.ink2, shadow: false });
      text(g, '{ }', L.w / 2 - 110, -L.h / 2 + 110, { f: 'mono', s: 44, w: 700, c: C.blue });
      const items = [['新增一种 View', 4.4], ['切主题：两套加载逻辑', 6.4], ['纯 CPU 渲染', 8.6]];
      items.forEach(([s, t0], i) => {
        const y = -L.h / 2 + 260 + i * 110, p = seg(lt, t0, t0 + .4);
        if (p <= 0) return;
        at(g, 0, y, lerp(1.4, 1, eo(p)), () => {
          card(g, -L.w / 2 + 30, -42, L.w - 60, 84, { r: 10, fill: C.redL, shadow: false });
          badge(g, -L.w / 2 + 80, 0, 24, C.red, 'cross', 1);
          text(g, s, -L.w / 2 + 124, 2, { s: 34, w: 900, c: C.ink, a: 'left' });
        }, { al: eo(p), rot: (hash(i) - .5) * .03 });
      });
      // CPU 小表：指到高位（不到顶）
      if (lt > 8.8) {
        const k = .8 * eo(seg(lt, 8.9, 10)), gx = L.w / 2 - 130, gy = -L.h / 2 + 590;
        rr(g, gx - 90, gy - 16, 180, 32, 16); g.fillStyle = rgba(C.ink, .12); g.fill();
        rr(g, gx - 90, gy - 16, 180 * k, 32, 16); g.fillStyle = C.red; g.fill();
        text(g, 'CPU', gx - 106, gy + 1, { f: 'disp', s: 26, w: 900, c: C.ink, a: 'right' });
      }
    }, { al: lAl });
    // 帧动画卡
    at(g, R.x + R.w / 2, R.y + R.h / 2, ap(lt, .3), () => {
      card(g, -R.w / 2, -R.h / 2, R.w, R.h, { r: 18, fill: C.paper });
      text(g, '帧动画', -R.w / 2 + 40, -R.h / 2 + 70, { s: 60, w: 900, c: C.ink, a: 'left' });
      text(g, '动画 = 一组图片', -R.w / 2 + 42, -R.h / 2 + 136, { s: 30, w: 700, c: C.ink2, a: 'left' });
      filmStrip(g, R.w / 2 - 300, -R.h / 2 + 46, 250, 110, { foff: lt * 30, shadow: false, frame: (g2, idx, fx, fy, fw, fh) => cardFrame(g2, idx * 4, fx, fy, fw, fh, { num: false }) });
      const good = [['CPU 消耗少', 12.6], ['设计出图简单', 13.0]];
      good.forEach(([s, t0], i) => {
        const y = -R.h / 2 + 220 + i * 70, p = seg(lt, t0, t0 + .35);
        if (p <= 0) return;
        badge(g, -R.w / 2 + 70, y, 22, C.teal, 'check', p);
        text(g, s, -R.w / 2 + 110, y + 2, { s: 32, w: 900, c: C.ink, a: 'left', al: eo(p) });
      });
      if (lt > 13.6) text(g, '代价', -R.w / 2 + 40, -R.h / 2 + 370, { s: 28, w: 900, c: C.ink2, a: 'left', al: fa(lt, 13.6) });
      const cost = [['磁盘大', 13.9], ['内存大', 14.5], ['有 GC', 15.1]];
      cost.forEach(([s, t0], i) => {
        const y = -R.h / 2 + 430 + i * 74, p = seg(lt, t0, t0 + .35);
        if (p <= 0) return;
        const hot = i === 1 && lt > 15.8 ? .5 + .5 * Math.sin((lt - 15.8) * 8) : 0;
        if (hot) { rr(g, -R.w / 2 + 30, y - 32, 300, 64, 10); g.fillStyle = rgba(C.red, .25 + .25 * hot); g.fill(); }
        badge(g, -R.w / 2 + 70, y, 22, i === 1 && lt > 15.8 ? C.red : C.amber, '!', p);
        text(g, s, -R.w / 2 + 110, y + 2, { s: 32, w: 900, c: C.ink, a: 'left', al: eo(p) });
      });
      if (lt > 14.0) { // 磁盘预算算式
        const p = seg(lt, 14.0, 14.5);
        at(g, 150, -R.h / 2 + 430, pop(p), () => {
          card(g, -190, -46, 380, 92, { r: 10, fill: C.film, shadow: false });
          text(g, '22KB × 50 × 28', 0, -14, { f: 'mono', s: 28, w: 700, c: C.paper });
          text(g, '≈ 30.8MB（预计）', 0, 22, { s: 24, w: 700, c: C.amber });
        });
      }
    }, { al: rAl });
  },
});

/* =====================================================================
 * 3 第二章：现成方案的内存账
 * ===================================================================== */
function feedFrames(g, lt, t0, t1, tx, ty) { // 帧一张张飞进放映机，不出来
  for (let k = 0; k < 24; k++) {
    const ts = t0 + k * .32; if (ts > t1) break;
    const p = seg(lt, ts, ts + .7); if (p <= 0 || p >= 1) continue;
    const x = lerp(70, tx, eio(p)), y = lerp(200, ty, eio(p)) - Math.sin(p * Math.PI) * 60;
    at(g, x, y, 1 - .5 * p, () => cardFrame(g, k * 2, -36, -26, 72, 52, { num: false }), { al: 1 - sstep((p - .8) / .2) });
  }
}
function s1Chart(g, pA, pB, o = {}) {
  return memChart(g, CHART, { scheme: 's1', max: 1200, ticks: [0, 300, 600, 900, 1200], pA, pB, title: SCHEME.s1.name, labels: LBL, clicks: true, ...o });
}
S('s05', {
  card: 3,
  cues: [[0, 'leader'], [2.4, 'reel', .6], [2.8, 'draw'], [8.9, 'pop'], [10.4, 'pop'], [11.0, 'pop', .6], [14.4, 'blip']],
  draw(g, lt) {
    const pAl = fa(lt, 1.7, .5);
    g.save(); g.globalAlpha *= pAl;
    projector(g, 300, 470, 1, lt, { on: 0, spin: lt * 2.4 });
    text(g, 'AnimationDrawable', 300, 650, { f: 'mono', s: 30, w: 700, c: C.paper });
    text(g, '系统现成', 300, 696, { s: 26, w: 700, c: C.dim });
    feedFrames(g, lt, 2.4, 10, 300, 430);
    g.restore();
    const G = s1Chart(g, seg(lt, 2.8, 9.4), 0, { hideB: true, al: fa(lt, 1.8, .5) });
    const ex = G.X(0, 1);
    readout(g, ex, G.Y(1190.1), G.X(1, .5), 330, ['1.2 GB', '总量'], seg(lt, 8.8, 9.6), C.red);
    readout(g, ex - 4, G.Y(989.3 / 2), G.X(1, .5), 520, ['Native 989.3 MB'], seg(lt, 10.3, 11.1), C.red);
    readout(g, ex - 4, G.Y(989.3 + 41.7 / 2), G.X(1, .5), 660, ['Java 41.7 MB'], seg(lt, 10.9, 11.7), C.blue);
    if (lt > 14.2) {
      const k = .5 + .5 * Math.sin((lt - 14.2) * 6);
      tag(g, '几乎全是 Native', G.X(0, .45), G.Y(480), C.red, seg(lt, 14.3, 14.8), { fs: 34, stroke: C.paper, lw: 3 });
      g.save(); g.globalAlpha *= .25 * k * fa(lt, 14.2); g.fillStyle = C.red; g.fillRect(G.X(0, 0), G.Y(900), G.X(0, 1) - G.X(0, 0), G.Y(0) - G.Y(900)); g.restore();
    }
  },
});

S('s06', {
  demo: demoWin(11.6, 16),
  cues: [[.2, 'tick'], [.7, 'tick'], [1.2, 'draw'], [2.6, 'blip', .5], [2.8, 'blip', .5], [3.0, 'blip', .5], [3.3, 'pop'], [4.4, 'pop'], [8.4, 'pop', .6], [11.8, 'whoosh'], [13.0, 'stamp', .4]],
  cam: [[0, 960, 540, 1], [11.6, 960, 540, 1], [13.2, 900, 650, 1.8], [16, 900, 650, 1.85]],
  draw(g, lt) {
    const G = s1Chart(g, 1, seg(lt, 1.2, 3.8), { breakAl: fa(lt, .4), labelBAl: fa(lt, .4) });
    // 上一幕的读数淡出
    const old = fo(lt, 0, .4);
    if (old > 0) { g.save(); g.globalAlpha *= old; readout(g, G.X(0, 1), G.Y(1190.1), G.X(1, .5), 330, ['1.2 GB', '总量'], 1, C.red); g.restore(); }
    // 时钟（左侧）
    const cl = win(lt, 0, 11.4, .3, .4);
    if (cl > 0) {
      g.save(); g.globalAlpha *= cl;
      clockFace(g, 300, 330, 82, 6.5 * eio(seg(lt, .1, 2.2)));
      text(g, '6～7 分钟后', 300, 460, { s: 32, w: 900, c: C.paper });
      g.restore();
    }
    const ex = G.X(1, 1);
    readout(g, ex - 4, G.Y(942 / 2), G.X(1, .45), 560, ['Native 942 MB'], seg(lt, 3.4, 4.2), C.red);
    readout(g, ex, G.Y(1088.4), G.X(1, .45), 400, ['1.1 GB', '总量'], seg(lt, 4.4, 5.2), C.red);
    // Activity 重建后才释放
    const ac = win(lt, 8.2, 11.6, .4, .4);
    if (ac > 0) at(g, 300, 650, pop(seg(lt, 8.2, 8.7)), () => {
      card(g, -150, -70, 300, 140, { r: 14, fill: C.paper });
      rr(g, -150, -70, 300, 34, 14); g.fillStyle = C.ink2; g.fill();
      text(g, 'Activity', 0, -52, { f: 'mono', s: 24, w: 700, c: C.paper });
      const a0 = lt * 4; ring(g, 0, 18, 30, C.teal, 7, 1, a0, a0 + 4.6); arrowHead(g, Math.cos(a0 + 4.6) * 30, 18 + Math.sin(a0 + 4.6) * 30, a0 + 4.6 + Math.PI / 2, C.teal, 16);
      text(g, '重建之后才释放', 0, 104, { s: 26, w: 900, c: C.paper });
    }, { al: ac });
    // 推进 Native：帧堆在里面不走（机制演绎）
    if (lt > 11.6) {
      const x0 = G.X(0, .5), x1 = G.X(0, .98), y1 = G.Y(40), y0 = G.Y(940), tw = 46, th = 34, cols = Math.floor((x1 - x0) / (tw + 8));
      const n = Math.floor(clamp((lt - 12) / 3.4) * 80);
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols), x = x0 + c * (tw + 8), y = y1 - (r + 1) * (th + 8);
        if (y < y0) break;
        const p = seg(lt, 12 + i * 3.4 / 80, 12 + i * 3.4 / 80 + .25);
        at(g, x + tw / 2, y + th / 2 - (1 - eo(p)) * 40, 1, () => cardFrame(g, i * 3, -tw / 2, -th / 2, tw, th, { num: false, bg: '#FBEFE6' }), { al: eo(p) });
      }
    }
  },
});

S('s07', {
  cues: [[.8, 'stamp'], [4.7, 'whoosh'], [5.8, 'draw'], [6.4, 'draw', .6], [7.0, 'draw', .6], [7.6, 'draw', .6]],
  draw(g, lt) {
    const out = eio(seg(lt, 4.6, 5.4));
    at(g, 760 - out * 1300, 500, 1.4, () => projector(g, 0, 0, 1, lt, { on: 0, spin: lt * 2 }));
    text(g, 'AnimationDrawable', 760 - out * 1300, 720, { f: 'mono', s: 32, w: 700, c: C.paper });
    stamp(g, '弃用', 800 - out * 1300, 470, seg(lt, .8, 1.4), C.red, { fs: 90, seed: 3 });
    // 蓝图：自研帧播放器
    const k = eio(seg(lt, 4.8, 5.8));
    if (k > 0) {
      const bx = lerp(2300, 960, k), by = 500, bw = 1500, bh = 620;
      g.save(); g.translate(bx, by); g.rotate(lerp(.06, -.012, k));
      card(g, -bw / 2, -bh / 2, bw, bh, { r: 8, fill: C.print, sa: .5 });
      g.save(); rr(g, -bw / 2, -bh / 2, bw, bh, 8); g.clip(); g.strokeStyle = rgba('#ffffff', .08); g.lineWidth = 1.5;
      for (let x = -bw / 2; x < bw / 2; x += 40) { g.beginPath(); g.moveTo(x, -bh / 2); g.lineTo(x, bh / 2); g.stroke(); }
      for (let y = -bh / 2; y < bh / 2; y += 40) { g.beginPath(); g.moveTo(-bw / 2, y); g.lineTo(bw / 2, y); g.stroke(); }
      g.restore();
      text(g, '自研帧播放器', -bw / 2 + 50, -bh / 2 + 64, { s: 48, w: 900, c: '#fff', a: 'left' });
      const steps = [['帧表', 'LruCache'], ['解码', 'Bitmap'], ['上屏', '主线程'], ['释放', '时机自己定']];
      steps.forEach(([a, b], i) => {
        const x = -540 + i * 360, p = seg(lt, 5.8 + i * .6, 6.3 + i * .6);
        if (p <= 0) return;
        g.save(); g.globalAlpha *= eo(p);
        rr(g, x - 120, -60, 240, 120, 12); g.setLineDash([]); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
        text(g, a, x, -6, { s: 44, w: 900, c: '#fff' });
        text(g, b, x, 100, { f: i === 0 ? 'mono' : 'cjk', s: 26, w: 700, c: rgba('#ffffff', .75) });
        g.restore();
        if (i < 3) arrow(g, [[x + 130, 0], [x + 230, 0]], { c: '#fff', w: 4, p: seg(lt, 6.2 + i * .6, 6.5 + i * .6), hs: 16 });
      });
      g.restore();
    }
  },
});

/* =====================================================================
 * 4 第三章：自己写播放器
 * ===================================================================== */
const S08X = [300, 680, 1060, 1440];
S('s08', {
  card: 4,
  cues: [[0, 'leader'], [2.2, 'pop', .6], [6.1, 'pop'], [7.0, 'success', .6], [9.7, 'click'], [10.0, 'whoosh'], [10.2, 'tick', .5], [10.8, 'tick', .5], [11.4, 'success', .5]],
  draw(g, lt) {
    S08X.forEach((x, i) => {
      const p = seg(lt, 1.7 + i * .12, 2.2 + i * .12);
      const tapped = i === 2 && lt > 9.7;
      at(g, x, 300, pop(p), () => {
        sceneCard(g, 0, 0, 300, 196, i + 1, { glow: tapped ? Math.max(0, 1 - (lt - 9.7) * 1.5) : 0 });
        // 只贴一格封面（帧 00）
        if (!tapped || lt < 9.9) {
          filmStrip(g, 40, 64, 130, 96, { shadow: false, frame: (g2, idx, fx, fy, fw, fh) => cardFrame(g2, 0, fx, fy, fw, fh, { sc: i + 1, num: false }), fw: 52 });
          text(g, '封面 00', 105, 186, { s: 24, w: 700, c: C.dim, al: fa(lt, 2.4) });
        }
      });
    });
    // 第一帧 = 封面；首末帧相同
    const pc = win(lt, 5.8, 9.5, .4, .4);
    if (pc > 0) {
      g.save(); g.globalAlpha *= pc;
      const y = 600;
      for (const [x, idx, lab] of [[560, 0, '第一帧 00'], [820, 49, '最后一帧 49']]) {
        at(g, x, y, ap(lt, idx ? 6.3 : 6.0), () => { g.save(); shadow(g, .45, 18, 6); g.fillStyle = C.paper; g.fillRect(-100, -74, 200, 148); g.restore(); cardFrame(g, idx, -92, -66, 184, 132, { sc: 2 }); });
        text(g, lab, x, y + 110, { s: 26, w: 700, c: C.paper });
      }
      text(g, '=', 690, y, { f: 'disp', s: 70, w: 900, c: C.amber });
      badge(g, 690, y - 110, 26, C.teal, 'check', seg(lt, 7.0, 7.4));
      g.restore();
    }
    // 点击才加载：整条 50 帧抽出来
    if (lt > 9.7) {
      finger(g, 1100, 330, lt - 9.7);
      const k = eo(seg(lt, 9.9, 10.9));
      filmStrip(g, 900, 520, 940 * k, 200, { foff: (lt - 9.9) * 40, frame: (g2, idx, fx, fy, fw, fh) => cardFrame(g2, idx, fx, fy, fw, fh, { sc: 3 }) });
      tag(g, '50 帧', 1060, 450, C.amber, seg(lt, 10.6, 11.0), { tc: C.ink, fs: 28 });
      stopwatch(g, 1745, 300, 70, clamp((lt - 9.9) / 1.4), lt > 11.2 ? '约 100ms' : '', C.amber);
    }
    if (lt > 12.9) tag(g, '按需占用', 690, 600, C.teal, seg(lt, 13.0, 13.4), { fs: 34 });
  },
});

S('s09', {
  cues: [[.3, 'type'], [1.5, 'type'], [2.7, 'whoosh', .5], [4.2, 'snip'], [4.9, 'pop'], [8.3, 'latch'], [8.9, 'latch', .5]],
  draw(g, lt) {
    const mono = { f: 'mono', s: 36, w: 700 };
    // 第一行：图标名
    const r1a = 'ic_scene_', r1b = 'overtime', r1 = r1a + r1b, w1 = textW(g, r1, mono), x1 = 960 - w1 / 2;
    const t1 = FilmKit.typed(r1, seg(lt, .3, 1.3));
    card(g, x1 - 24, 186, w1 + 48, 68, { r: 10, fill: C.film, lw: 2, stroke: rgba(C.paper, .25), al: fa(lt, .1) });
    text(g, t1.slice(0, r1a.length), x1, 221, { ...mono, a: 'left', c: C.paper });
    if (t1.length > r1a.length) { const xb = x1 + textW(g, r1a, mono); rr(g, xb - 4, 194, textW(g, r1b, mono) + 8, 52, 6); g.fillStyle = rgba(C.amber, lt > 1.3 ? .35 : 0); g.fill(); text(g, t1.slice(r1a.length), xb, 221, { ...mono, a: 'left', c: C.amber }); }
    text(g, '图标名', x1 - 50, 221, { s: 26, w: 700, c: C.dim, a: 'right', al: fa(lt, .3) });
    // 第二行：动画名
    const r2a = 'anim_scene_card_small_', r2 = r2a + r1b, w2 = textW(g, r2, mono), x2 = 960 - w2 / 2;
    if (lt > 1.4) {
      const t2 = FilmKit.typed(r2, seg(lt, 1.5, 2.6));
      card(g, x2 - 24, 306, w2 + 48, 68, { r: 10, fill: C.film, lw: 2, stroke: rgba(C.paper, .25) });
      text(g, t2.slice(0, r2a.length), x2, 341, { ...mono, a: 'left', c: C.paper });
      if (t2.length > r2a.length) text(g, t2.slice(r2a.length), x2 + textW(g, r2a, mono), 341, { ...mono, a: 'left', c: C.amber });
      text(g, '动画名', x2 - 50, 341, { s: 26, w: 700, c: C.dim, a: 'right' });
      const xa = x1 + textW(g, r1a, mono) + textW(g, r1b, mono) / 2, xb2 = x2 + textW(g, r2a, mono) + textW(g, r1b, mono) / 2;
      arrow(g, [[xa, 258], [xb2, 302]], { c: C.amber, w: 4, p: seg(lt, 1.3, 1.7), hs: 14 });
    }
    // 第三行：帧序列
    if (lt > 2.6) {
      const k = eo(seg(lt, 2.6, 3.4));
      filmStrip(g, 960 - 420 * k, 410, 840 * k, 120, { shadow: false, frame: (g2, idx, fx, fy, fw, fh) => cardFrame(g2, idx === 5 ? 49 : idx, fx, fy, fw, fh, { num: false }) });
      text(g, '_00   _01   _02   _03   _04   …   _49', 960, 556, { f: 'mono', s: 26, w: 700, c: C.paper, al: fa(lt, 3.2) });
    }
    // 写死的映射表（划掉）→ getIdentifier
    if (lt > 3.8) {
      at(g, 340, 720, ap(lt, 3.8), () => {
        card(g, -200, -110, 400, 220, { r: 12, fill: C.paper });
        text(g, '写死的映射表', -170, -74, { s: 28, w: 900, c: C.ink, a: 'left' });
        for (let i = 0; i < 4; i++) { rr(g, -170, -36 + i * 34, 150, 14, 7); g.fillStyle = rgba(C.ink, .2); g.fill(); text(g, '→', 0, -29 + i * 34, { s: 24, w: 700, c: C.ink2 }); rr(g, 30, -36 + i * 34, 140, 14, 7); g.fillStyle = rgba(C.ink, .2); g.fill(); }
        text(g, '28 条', 140, -74, { f: 'mono', s: 28, w: 700, c: C.ink2 });
        path(g, partial([[-190, -100], [190, 100]], eo(seg(lt, 4.2, 4.6))), { c: C.red, w: 8 });
      }, { al: lt < 8 ? 1 : lerp(1, .45, fa(lt, 8)) });
      at(g, 780, 720, ap(lt, 4.9), () => {
        ring(g, -86, -4, 40, C.paper, 8); path(g, [[-58, 24], [-30, 52]], { c: C.paper, w: 12 });
        text(g, 'getIdentifier', 0, -20, { f: 'mono', s: 32, w: 700, c: C.paper, a: 'left' });
        text(g, '按名字查  1～3ms', 0, 26, { s: 28, w: 900, c: C.amber, a: 'left' });
      }, { al: lt < 8 ? 1 : lerp(1, .45, fa(lt, 8)) });
    }
    // 帧表进 LRU 片架
    if (lt > 7.6) {
      const k = eio(seg(lt, 8.0, 8.8)), al = fa(lt, 7.6);
      g.save(); g.globalAlpha *= al;
      const items = [['观影', C.blue], ['回家', C.teal], ['睡眠', C.print], ['起床', C.red], ['阅读', C.green], ['晚餐', C.ink2]].map(([l, c], i) => [l, c, i + k, i === 5 ? 1 - k : 1, i === 5 ? k * 60 : 0]);
      items.push(['加班', C.amber, -1.2 + 1.2 * k, eo(seg(lt, 7.8, 8.2)), -80 * (1 - k)]);
      lruShelf(g, 1100, 700, 740, items, { title: 'LruCache · 帧表', ends: true, step: 112 });
      g.restore();
    }
  },
});

/* 协程循环：每格 40ms = 解码（长短不一）+ 等待 */
const DEC = [9, 12, 8, 27, 10, 11, 9, 14, 8, 12], SLOT = 1.2, SL0 = 1.0, SLW = 170;
const CODE = ['for (frame in frames) {          // 50 帧', '    val t0 = now()', '    val bmp = decode(frame)       // 解码',
  '    onMain { image.set(bmp) }     // 上屏', '    val wait = frame.ms - (now() - t0)', '    delay(maxOf(0, wait))         // 补偿', '}'];
S('s10', {
  scaled: lt => win(lt, .8, 15.8),
  cues: [[.3, 'pop'], ...DEC.map((_, k) => [SL0 + k * SLOT, 'tick', .5]), [SL0 + 3 * SLOT + .1, 'blip'], [12.6, 'success', .6]],
  draw(g, lt) {
    const k = clamp(Math.floor((lt - SL0) / SLOT), 0, 9), f = clamp((lt - SL0 - k * SLOT) / SLOT), dfrac = DEC[k] / 40;
    const phase = lt < SL0 ? -1 : lt > SL0 + 10 * SLOT ? 3 : f < dfrac ? 1 : f < dfrac + .05 ? 2 : 3;
    const hl = phase === 1 ? 2 : phase === 2 ? 3 : phase === 3 ? (f < dfrac + .1 ? 4 : 5) : -1;
    // 代码卡
    at(g, 560, 380, ap(lt, .1), () => {
      card(g, -450, -210, 900, 420, { r: 14, fill: '#241E19', lw: 2, stroke: rgba(C.paper, .2) });
      CODE.forEach((l, i) => {
        const y = -160 + i * 52;
        if (i === hl) { rr(g, -430, y - 24, 860, 48, 8); g.fillStyle = rgba(C.amber, .2); g.fill(); rr(g, -430, y - 24, 8, 48, 4); g.fillStyle = C.amber; g.fill(); }
        const ci = l.indexOf('//');
        text(g, ci > 0 ? l.slice(0, ci) : l, -400, y, { f: 'mono', s: 28, w: 700, c: C.paper, a: 'left' });
        if (ci > 0) text(g, l.slice(ci), -400 + textW(g, l.slice(0, ci), { f: 'mono', s: 28, w: 700 }), y, { f: 'mono', s: 28, w: 400, c: C.dim, a: 'left' });
      });
    });
    // 放映小窗
    const fi = lt < SL0 ? 0 : k + (phase >= 2 ? 1 : 0);
    at(g, 1490, 330, ap(lt, .3), () => {
      card(g, -220, -160, 440, 320, { r: 10, fill: C.film, lw: 2, stroke: rgba(C.paper, .25) });
      cardFrame(g, fi * 5, -200, -140, 400, 280, { sc: 3 });
      text(g, '帧 ' + String(Math.min(49, fi * 5)).padStart(2, '0'), 0, 196, { f: 'mono', s: 28, w: 700, c: C.paper });
    });
    if (lt > 12) tag(g, '25 帧/秒', 1490, 600, C.teal, seg(lt, 12.2, 12.6), { fs: 34 });
    // 时间轴
    const ty = 700, tx = 110;
    text(g, '40ms', tx + SLW / 2, ty - 80, { f: 'mono', s: 26, w: 700, c: C.paper, al: fa(lt, .6) });
    path(g, [[tx + 4, ty - 56], [tx + 4, ty - 46], [tx + SLW - 4, ty - 46], [tx + SLW - 4, ty - 56]], { c: C.paper, w: 2.5, al: fa(lt, .6) });
    for (let i = 0; i < 10; i++) {
      const x = tx + i * SLW, started = lt >= SL0 + i * SLOT, p = clamp((lt - SL0 - i * SLOT) / SLOT);
      rr(g, x + 4, ty - 36, SLW - 8, 72, 8); g.fillStyle = rgba(C.paper, started ? .08 : .04); g.fill();
      if (!started) continue;
      const dw = (SLW - 8) * DEC[i] / 40, dp = Math.min(p, DEC[i] / 40) / (DEC[i] / 40);
      rr(g, x + 4, ty - 36, dw * dp, 72, 8); g.fillStyle = C.amber; g.fill();
      if (p > DEC[i] / 40) hatch(g, x + 4 + dw, ty - 36, (SLW - 8 - dw) * clamp((p - DEC[i] / 40) / (1 - DEC[i] / 40)), 72, C.teal, lt * 40, 8, .25);
      if (i === 3 && p > .1) { const fl = win(lt, SL0 + 3 * SLOT, 12, .2, .4); rr(g, x, ty - 40, SLW, 80, 10); g.lineWidth = 4; g.strokeStyle = rgba(C.red, fl); g.stroke(); }
    }
    if (lt > SL0) { const px = tx + 4 + (lt - SL0) / SLOT * SLW; if (px < tx + 10 * SLW) { path(g, [[px, ty - 50], [px, ty + 50]], { c: C.paper, w: 3 }); dot(g, px, ty - 50, 7, C.paper); } }
    const lab = win(lt, SL0 + 3 * SLOT + .2, 12.2, .3, .3);
    if (lab > 0) tag(g, '解码慢 → 少等', tx + 3.5 * SLW, ty - 72, C.red, seg(lt, SL0 + 3 * SLOT + .2, SL0 + 3 * SLOT + .6), { fs: 26, al: lab });
    // 图例
    g.save(); g.globalAlpha *= fa(lt, 1.2);
    rr(g, 700, 790, 30, 30, 6); g.fillStyle = C.amber; g.fill(); text(g, '解码', 742, 806, { s: 26, w: 700, c: C.paper, a: 'left' });
    hatch(g, 880, 790, 30, 30, C.teal, 0, 6, .25); text(g, '等待', 922, 806, { s: 26, w: 700, c: C.paper, a: 'left' });
    text(g, '每格加起来 = 40ms', 1060, 806, { s: 26, w: 700, c: C.dim, a: 'left' });
    g.restore();
  },
});

S('s11', {
  demo: demoWin(6.6, 14),
  cues: [[.3, 'reel', .6], [1.2, 'error'], [4.6, 'click'], [5.0, 'send'], [5.2, 'send', .6], [6.4, 'snip'], [6.6, 'snip', .6], [9.0, 'pop', .6]],
  draw(g, lt) {
    const rows = [250, 470, 690], off = (i) => lt > 6.3 + i * .2 && i < 2;
    const shake = lt > 1 && lt < 6.4 ? (hash(Math.floor(lt * 30)) - .5) * 6 : 0;
    g.save(); g.translate(shake, 0);
    rows.forEach((y, i) => {
      const on = off(i) ? 1 - eo(seg(lt, 6.3 + i * .2, 6.7 + i * .2)) : (i === 2 && lt > 4.6 ? 1 : fa(lt, .2 + i * .15));
      const st = i === 2 && lt > 4.6;
      projector(g, 250, y, .62, lt, { on, beamLen: 420, beamH: 170, spin: on > 0 ? lt * 3 : 6.3 * 3 });
      const playing = on > .5, ph = st ? (lt - 4.6) * 25 : lt * 25 + i * 17;
      sceneCard(g, 820, y + 12, 250, 150, i + 1, { k: playing ? frameScale(Math.floor(ph) % 50) : 1, glow: st ? Math.max(0, 1 - (lt - 4.6) * 2) : 0 });
      if (off(i)) tag(g, 'cancel', 250, y - 120, C.red, seg(lt, 9.0 + i * .15, 9.4 + i * .15), { f: 'mono', fs: 26 });
    });
    if (lt > 4.6) finger(g, 870, 720, lt - 4.6);
    // 局部刷新：信号飞向旧卡片
    for (const i of [0, 1]) {
      const p = seg(lt, 5.0 + i * .35, 6.2 + i * .2);
      if (p > 0 && p < 1) {
        const a = [960, 690], b = [960, rows[i] + 12], u = eio(p), x = lerp(a[0], b[0], u) + Math.sin(u * Math.PI) * (i ? -150 : 150), y = lerp(a[1], b[1], u);
        at(g, x, y, 1, () => { card(g, -80, -24, 160, 48, { r: 24, fill: C.blue, sa: .4 }); text(g, '局部刷新', 0, 1, { s: 24, w: 900, c: '#fff' }); });
      }
    }
    g.restore();
    // CPU 表
    const v = lt < 6.4 ? Math.min(200, 200 * eo(seg(lt, .4, 1.4))) : lerp(200, 70, eo(seg(lt, 6.4, 7.6)));
    cpuGauge(g, 1520, 560, 190, v, { shake: lt > 1.3 && lt < 6.4 ? (hash(Math.floor(lt * 30) + 3) - .5) * .06 : 0 });
    if (lt > 1.2 && lt < 6.6) tag(g, '200%', 1520, 680, C.red, seg(lt, 1.2, 1.6), { f: 'disp', fs: 40, al: fo(lt, 6.2) });
    if (lt > 7.6) tag(g, '只剩一个在播', 1520, 680, C.teal, seg(lt, 7.6, 8.0), { fs: 30 });
  },
});

/* =====================================================================
 * 5 第四章：缓存的粒度
 * ===================================================================== */
function bin(g, x, y, o = {}) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.moveTo(-90, -60); g.lineTo(-70, 80); g.lineTo(70, 80); g.lineTo(90, -60); g.closePath(); g.fillStyle = '#4A3D33'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#2A221C'; g.stroke();
  card(g, -104, -82, 208, 26, { r: 8, fill: '#5E4E40', shadow: false });
  for (const dx of [-36, 0, 36]) path(g, [[dx, -30], [dx * .85, 54]], { c: rgba(C.paper, .25), w: 5 });
  g.restore();
}
function s2Chart(g, pA, pB, o = {}) { return memChart(g, CHART, { scheme: 's2', max: 400, ticks: [0, 100, 200, 300, 400], pA, pB, title: SCHEME.s2.name, labels: LBL, clicks: true, ...o }); }
S('s12', {
  card: 5,
  cues: [[0, 'leader'], [2.4, 'draw'], [3.0, 'pop', .4], [6.2, 'pop'], [7.6, 'blip'], [10.2, 'pop'], [13.6, 'draw', .7], [15.8, 'pop']],
  draw(g, lt) {
    const al = fa(lt, 1.7, .5);
    g.save(); g.globalAlpha *= al;
    // bytes 小盒
    at(g, 300, 300, ap(lt, 5.8), () => {
      card(g, -170, -80, 340, 160, { r: 12, fill: C.paper });
      text(g, 'bytes', -140, -34, { f: 'mono', s: 34, w: 700, c: C.ink, a: 'left' });
      text(g, '50 帧 1.3MB', -140, 22, { s: 30, w: 900, c: C.ink2, a: 'left' });
      for (let i = 0; i < 6; i++) text(g, hash(i + Math.floor(lt * 4)) > .5 ? '1' : '0', 70 + (i % 3) * 30, -30 + Math.floor(i / 3) * 44, { f: 'mono', s: 30, w: 700, c: C.amber });
    });
    // 播完就回收
    bin(g, 300, 700);
    text(g, '播完就回收 Bitmap', 300, 830, { s: 28, w: 900, c: C.paper, al: fa(lt, 2.2) });
    for (let k = 0; k < 20; k++) {
      const ts = 2.4 + k * .4, p = seg(lt, ts, ts + .7); if (p <= 0 || p >= 1) continue;
      const y = lerp(470, 690, eio(p)), x = 300 + (hash(k) - .5) * 60;
      at(g, x, y, 1, () => cardFrame(g, k * 5, -40, -30, 80, 60, { num: false }), { al: 1 - sstep((p - .75) / .25), rot: (hash(k * 3) - .5) * .6 * p });
    }
    g.restore();
    const G = s2Chart(g, seg(lt, 2.4, 9.4), seg(lt, 13.6, 16.2), { al: fa(lt, 1.8, .5), hideB: lt < 13.4 });
    readout(g, G.X(0, 1), G.Y(310.2), G.X(1, .48), 300, ['310.2 MB', '其中 Native 72.9 MB'], seg(lt, 10.1, 10.9), C.amber);
    readout(g, G.X(1, 1), G.Y(229.1), G.X(1, .5), 600, ['229.1 MB'], seg(lt, 15.8, 16.6), C.amber);
  },
});

/* 锯齿从哪来：每帧一块新画布 → 攒满 → GC 扫走（机制演绎） */
const POOL = { x: 150, y: 190, w: 860, h: 620 }, TILE_DT = .2, TILE_T0 = .5, SWEEP = 6.4;
function tilesAt(lt) { // 返回池中块数（扫走前）
  if (lt < SWEEP) return clamp(Math.floor((lt - TILE_T0) / TILE_DT) + 1, 0, 30);
  if (lt < SWEEP + .8) return 30;
  return clamp(Math.floor((lt - SWEEP - .9) / TILE_DT) + 1, 0, 8);
}
S('s13', {
  demo: demoWin(0, 9.2),
  cues: [[.5, 'pop', .4], [1.5, 'pop', .4], [2.5, 'pop', .4], [3.5, 'pop', .4], [4.8, 'pop'], [SWEEP, 'whoosh'], [9.4, 'whoosh', .5], [11.4, 'latch'], [12.2, 'pop']],
  draw(g, lt) {
    const al1 = lt < 9 ? fa(lt, 0, .4) : fo(lt, 9, .5);
    if (al1 > 0) {
      g.save(); g.globalAlpha *= al1;
      const { x, y, w, h } = POOL;
      card(g, x, y, w, h, { r: 14, fill: rgba(C.film, .7), lw: 3, stroke: rgba(C.paper, .3) });
      text(g, '每解码一帧，分配一块新画布', x + 30, y + 44, { s: 28, w: 900, c: C.paper, a: 'left' });
      const tw = 92, th = 68, cols = 8, gap = 10;
      const sweepX = x + w * eio(seg(lt, SWEEP, SWEEP + .8));
      const second = lt >= SWEEP + .8;
      const n = second ? tilesAt(lt) : Math.min(30, clamp(Math.floor((lt - TILE_T0) / TILE_DT) + 1, 0, 30));
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols), tx = x + 30 + c * (tw + gap), ty = y + h - 30 - (r + 1) * (th + gap);
        const born = (second ? SWEEP + .9 : TILE_T0) + i * TILE_DT, p = seg(lt, born, born + .25), used = lt > born + .5;
        if (!second && lt >= SWEEP && tx < sweepX) continue;
        at(g, tx + tw / 2, ty + th / 2 - (1 - eo(p)) * 160, 1, () => {
          cardFrame(g, i * 3, -tw / 2, -th / 2, tw, th, { num: false, bg: used ? '#B9AD9A' : C.paper });
        }, { al: eo(p) * (used ? .7 : 1) });
      }
      if (lt > 4.6 && lt < SWEEP) tag(g, '0.25MB', x + 30 + tw / 2 + 40, y + h - 30 - th - 50, C.amber, seg(lt, 4.7, 5.1), { tc: C.ink, fs: 26 });
      if (lt >= SWEEP && lt < SWEEP + 1.2) { // GC 扫帚
        const bx = sweepX;
        g.save(); g.globalAlpha *= 1 - seg(lt, SWEEP + .8, SWEEP + 1.2);
        rr(g, bx - 16, y + 70, 32, h - 90, 12); g.fillStyle = C.amber; g.fill();
        for (let i = 0; i < 8; i++) path(g, [[bx + 16, y + 100 + i * 64], [bx + 60, y + 120 + i * 64]], { c: C.amber, w: 5 });
        tag(g, 'GC', bx, y + h + 34, C.red, 1, { f: 'disp', fs: 32 });
        g.restore();
      }
      // 右侧小锯齿：块数 → 内存
      const gx = 1110, gy = 250, gw = 690, gh = 440;
      card(g, gx, gy, gw, gh, { r: 12, fill: C.paper });
      text(g, '内存（示意）', gx + 24, gy + 36, { s: 26, w: 900, c: C.ink, a: 'left' });
      const pts = [], T = Math.min(lt, 9);
      for (let s = 0; s <= 120; s++) { const tt = s / 120 * T; pts.push([gx + 40 + (tt / 9) * (gw - 80), gy + gh - 40 - tilesAt(tt) / 30 * (gh - 120)]); }
      path(g, pts, { c: '#C77F14', w: 5 });
      if (lt > SWEEP + .4) gcMark(g, gx + 40 + ((SWEEP + .4) / 9) * (gw - 80), gy + gh - 18, 1, C.ink2, fa(lt, SWEEP + .4));
      g.restore();
    }
    // 50 帧尺寸一样
    if (lt > 9.2) {
      const k = eio(seg(lt, 9.6, 11.4));
      [0, 12, 25, 37, 49].forEach((idx, i) => {
        const x = lerp(260 + i * 350, 960, k), y = lerp(500 + (i % 2) * 60, 480, k);
        at(g, x, y, 1, () => {
          g.save(); g.globalAlpha *= lerp(1, .35, k); g.fillStyle = C.paper; g.fillRect(-150, -105, 300, 210); g.restore();
          cardFrame(g, idx, -140, -95, 280, 190, { num: k < .5 }); g.save(); g.strokeStyle = C.amber; g.lineWidth = 4; g.strokeRect(-150, -105, 300, 210); g.restore();
        }, { al: fa(lt, 9.2 + i * .08) });
      });
      if (lt > 11.4) {
        tag(g, '尺寸完全一样', 960, 690, C.amber, seg(lt, 11.4, 11.8), { tc: C.ink, fs: 32 });
        at(g, 1250, 400, ap(lt, 12.2), () => text(g, '?', 0, 0, { f: 'disp', s: 160, w: 900, c: C.amber, glow: rgba(C.amber, .5) }));
      }
    }
  },
});

S('s14', {
  cues: [[.5, 'pop'], ...Array.from({ length: 11 }, (_, k) => [1.2 + k * 1.1, 'draw', .4]), [4.6, 'success', .6], [5.4, 'success', .6], [9.0, 'pop']],
  draw(g, lt) {
    const k = clamp(Math.floor((lt - 1.2) / 1.1), -1, 10), f = (lt - 1.2 - k * 1.1);
    const idx = Math.max(0, k) * 5, prev = Math.max(0, k - 1) * 5, scan = k < 0 ? 1 : clamp(f / .6);
    text(g, 'Bitmap · 0.25MB', 960, 200, { f: 'mono', s: 32, w: 700, c: C.paper, al: fa(lt, .2) });
    at(g, 960, 425, ap(lt, .2), () => pixelCanvas(g, -260, -175, 520, 350, Math.min(49, idx), { scan, prev: Math.min(49, prev), cols: 26, rows: 17 }));
    // 胶片从下方送帧
    filmStrip(g, 0, 700, W, 150, { foff: (lt * 1.1 / 1.1) * 150 * .95, frame: (g2, i, fx, fy, fw, fh) => cardFrame(g2, ((i % 10) + 10) % 10 * 5, fx, fy, fw, fh) });
    if (k >= 0 && f < .5) { // 当前帧升入画布
      const u = eo(clamp(f / .45));
      at(g, 960, lerp(775, 600, u), lerp(1, .6, u), () => cardFrame(g, Math.min(49, idx), -80, -55, 160, 110, { num: false }), { al: 1 - u });
    }
    // 代码片
    at(g, 330, 420, ap(lt, .5), () => {
      card(g, -250, -70, 500, 140, { r: 12, fill: '#241E19', lw: 2, stroke: rgba(C.paper, .25) });
      text(g, 'decode(帧,', -220, -22, { f: 'mono', s: 30, w: 700, c: C.paper, a: 'left' });
      text(g, '  inBitmap = 画布)', -220, 24, { f: 'mono', s: 30, w: 700, c: C.amber, a: 'left' });
    });
    arrow(g, [[590, 420], [680, 420]], { c: C.amber, w: 4, p: seg(lt, .8, 1.1), hs: 16 });
    // 复用条件
    [['宽高一致', 4.6], ['像素格式一致', 5.4]].forEach(([s, t0], i) => {
      const y = 340 + i * 100;
      badge(g, 1350, y, 26, C.teal, 'check', seg(lt, t0, t0 + .4));
      text(g, s, 1394, y + 2, { s: 34, w: 900, c: C.paper, a: 'left', al: fa(lt, t0) });
    });
    if (lt > 8.8) tag(g, '同一个动画的 50 帧', 1560, 560, C.amber, seg(lt, 9.0, 9.4), { tc: C.ink, fs: 30 });
  },
});

function s3Chart(g, b, pA, pB, o = {}) { return memChart(g, b, { scheme: 's3', max: 400, ticks: [0, 100, 200, 300, 400], pA, pB, title: SCHEME.s3.name, labels: LBL, clicks: true, legend: false, ...o }); }
S('s15', {
  cues: [[.4, 'pop'], [4.6, 'blip', .5], [5.3, 'blip', .5], [6.0, 'blip', .5], [6.7, 'blip', .5], [8.6, 'draw'], [11.6, 'pop'], [12.2, 'success'], [13.2, 'pop', .6]],
  draw(g, lt) {
    const cv = [720, 520];
    const lit = lt < 4.4 ? -1 : Math.floor((lt - 4.4) / .7) % 5;
    for (let i = 0; i < 5; i++) {
      const y = 230 + i * 130, on = i === lit;
      path(g, [[350, y], [cv[0] - 150, cv[1]]], { c: on ? C.amber : rgba(C.paper, .2), w: on ? 6 : 3, dash: on ? null : [8, 10], al: fa(lt, .6 + i * .1) });
      sceneCard(g, 240, y, 210, 100, i, { glow: on ? .8 : 0, al: fa(lt, .2 + i * .1) });
    }
    at(g, cv[0], cv[1], ap(lt, .8), () => pixelCanvas(g, -140, -95, 280, 190, lit < 0 ? 0 : (Math.floor((lt - 4.4) * 25) % 50), { cols: 18, rows: 12, icon: SCENES[Math.max(0, lit)][2] }));
    text(g, '全局一个 Bitmap', cv[0], cv[1] - 150, { s: 30, w: 900, c: C.paper, al: fa(lt, 1.0) });
    text(g, '同一时刻只亮一根', cv[0], cv[1] + 150, { s: 26, w: 700, c: C.amber, al: fa(lt, 4.6) });
    const b = { x: 1000, y: 140, w: 840, h: 720 };
    const G = s3Chart(g, b, seg(lt, 8.6, 11.4), seg(lt, 11.8, 13.2), { al: fa(lt, 8.2, .5), hideB: lt < 11.6 });
    if (lt > 8.2) {
      readout(g, G.X(0, 1), G.Y(298.8), G.X(1, .4), 300, ['298.8 MB', '其中 Native 65.1 MB'], seg(lt, 11.6, 12.4), C.teal);
      if (lt > 12.2) tag(g, '全程无 GC', G.X(0, .5), G.py + G.ph + 30, C.teal, seg(lt, 12.2, 12.6), { fs: 26 });
      readout(g, G.X(1, 1), G.Y(253.5), G.X(1, .45), 610, ['253.5 MB'], seg(lt, 13.2, 13.9), C.teal);
    }
  },
});

/* 三条曲线并排 */
const TRIO = [['s1', 90], ['s2', 690], ['s3', 1290]];
const TRIO_END = { s1: '1.2 GB → 1.1 GB', s2: '310.2 → 229.1 MB', s3: '298.8 → 253.5 MB' }, TRIO_CPU = { s1: 'App 7%', s2: 'App 6%', s3: 'App 6%' };
S('s16', {
  cues: [[.3, 'draw'], [1.1, 'draw'], [1.9, 'draw'], [4.6, 'blip'], [5.2, 'success', .6], [8.8, 'pop', .6], [9.1, 'pop', .6], [9.4, 'pop', .6], [12.6, 'success']],
  draw(g, lt) {
    TRIO.forEach(([key, x], i) => {
      const b = { x, y: 150, w: 560, h: 560 }, t0 = .3 + i * .8;
      const G = memChart(g, b, { scheme: key, max: 1200, ticks: [0, 400, 800, 1200], pA: seg(lt, t0, t0 + .9), pB: seg(lt, t0 + .9, t0 + 1.3), title: ['方案一', '方案二', '方案三'][i], legend: false, labels: ['操作中', '6～7 分钟后'], segX: [[0, .52], [.6, 1]], padL: 96, padR: 30, al: ap(lt, t0 - .3, .4) });
      dot(g, x + 160, 192, 9, SCHEME[key].col);
      text(g, TRIO_END[key], x + 280, 755, { f: 'mono', s: 28, w: 700, c: SCHEME[key].col === C.amber ? C.amber : SCHEME[key].col === C.red ? '#F07A6C' : '#5CC8BE', al: fa(lt, t0 + 1.4) });
      if (lt > 4.4) { // GC 一行高亮
        const hl = win(lt, 4.4, 8.4, .3, .4);
        g.save(); g.globalAlpha *= hl; rr(g, G.px - 10, G.py + G.ph + 10, G.pw + 20, 40, 10); g.lineWidth = 3; g.strokeStyle = i === 2 ? C.teal : C.amber; g.stroke(); g.restore();
        if (i === 2) tag(g, '无 GC', G.px + G.pw / 2, G.py + G.ph + 30, C.teal, seg(lt, 5.2, 5.6), { fs: 26 });
      }
      if (lt > 8.6) tag(g, 'CPU · ' + TRIO_CPU[key], x + 280, 820, C.film, seg(lt, 8.8 + i * .3, 9.2 + i * .3), { fs: 28, lw: 2, stroke: rgba(C.paper, .4) });
      if (i === 2 && lt > 12.4) { const k = win(lt, 12.4, 16, .4, .3); g.save(); g.globalAlpha *= k; rr(g, x - 8, 142, 576, 576, 18); g.lineWidth = 5; g.strokeStyle = C.teal; g.stroke(); g.restore(); }
    });
  },
});

/* 释放与兜底 */
function toggle(g, x, y, on) {
  rr(g, x - 46, y - 24, 92, 48, 24); g.fillStyle = on > .5 ? C.teal : '#4A3D33'; g.fill();
  dot(g, x - 22 + 44 * eio(on), y, 18, C.paper);
}
S('s17', {
  cues: [[.6, 'latch'], [1.0, 'whoosh', .5], [4.4, 'latch'], [6.2, 'latch'], [8.6, 'snip'], [9.0, 'error', .5], [12.4, 'pop'], [13.0, 'success', .5]],
  draw(g, lt) {
    const rows = [['切主题', '回收 Bitmap、清空 LRU', .6], ['卡片被回收', '结束它的动画', 4.4], ['播新动画', '取消上一个', 6.2]];
    rows.forEach(([a, b, t0], i) => {
      const y = 230 + i * 100, al = fa(lt, .1 + i * .15);
      g.save(); g.globalAlpha *= al;
      toggle(g, 200, y, seg(lt, t0, t0 + .3));
      text(g, a, 270, y + 2, { s: 34, w: 900, c: C.paper, a: 'left' });
      text(g, '→ ' + b, 270 + textW(g, a, { s: 34, w: 900 }) + 20, y + 2, { s: 32, w: 700, c: lt > t0 ? C.amber : C.dim, a: 'left' });
      g.restore();
    });
    // 片架清空 + 画布回收
    const k = eio(seg(lt, .9, 2.0));
    const items = [['观影', C.blue], ['回家', C.teal], ['睡眠', C.print], ['加班', C.amber]].map(([l, c], i) => [l, c, i + k * 4, 1 - k, -k * 40]);
    lruShelf(g, 1180, 230, 520, items, { title: 'LruCache', step: 112 });
    at(g, 1790, 260, 1 - .6 * k, () => pixelCanvas(g, -60, -40, 120, 80, 0, { cols: 9, rows: 6 }), { al: 1 - k });
    if (lt > 2.0 && lt < 8) text(g, '清空', 1440, 260, { s: 30, w: 900, c: C.teal, al: win(lt, 2.0, 8, .3, .4) });
    // 兜底：胶片断了 → 文字动画接住
    if (lt > 7.8) {
      const al = fa(lt, 7.8, .4), cx = 1180, cy = 680;
      g.save(); g.globalAlpha *= al;
      const brk = seg(lt, 8.6, 9.4);
      filmStrip(g, 300, 610, 560 - brk * 40, 140, { foff: lt < 8.6 ? lt * 60 : 8.6 * 60, frame: (g2, i, fx, fy, fw, fh) => cardFrame(g2, i * 5, fx, fy, fw, fh, { num: false }) });
      if (brk > 0) {
        at(g, 860 + brk * 30, 680 + brk * brk * 120, 1, () => filmStrip(g, 0, -70, 100, 140, { shadow: false, frame: (g2, i, fx, fy, fw, fh) => cardFrame(g2, 25, fx, fy, fw, fh, { num: false }) }), { rot: brk * .5, al: 1 - brk });
        burst(g, 870, 680, lt - 8.6, C.red, 10, 90);
        tag(g, '资源缺失', 580, 560, C.red, seg(lt, 9.0, 9.4), { fs: 28 });
      }
      // 卡片
      card(g, cx - 220, cy - 130, 440, 260, { r: 20, fill: C.paper });
      sceneIcon(g, 'clock', cx - 150, cy - 60, .9, C.amber);
      text(g, '加班模式', cx - 190, cy + 50 - 20 * sstep((lt - 12.3) / .4), { s: 40, w: 900, c: C.ink, a: 'left', al: 1 - sstep((lt - 12.3) / .4) });
      if (lt > 12.6) {
        const dots = '.'.repeat(1 + Math.floor((lt - 12.6) * 3) % 3);
        text(g, '执行中' + dots, cx - 190, cy + 50, { s: 40, w: 900, c: C.teal, a: 'left', al: sstep((lt - 12.6) / .4) });
      }
      if (lt > 12.6) tag(g, '降级：文字动画', cx, cy - 180, C.teal, seg(lt, 12.6, 13.0), { fs: 30 });
      g.restore();
    }
  },
});

/* =====================================================================
 * 6 总结
 * ===================================================================== */
const LESSONS = [['1', '自己管生命周期', 'proj', 2.0], ['2', '缓存选粒度：复用像素', 'pix', 7.2], ['3', '只播一个，一块画布', 'one', 12.6]];
S('s18', {
  card: 6,
  cues: [[0, 'leader'], [1.8, 'whoosh', .6], [2.2, 'latch'], [7.4, 'latch'], [12.8, 'latch'], [16.5, 'success', .7]],
  draw(g, lt) {
    const slide = 1600 * (1 - eo(seg(lt, 1.6, 2.5)));
    const sy = 270, sh = 470, fw = 500, fh = 330, xs = [430, 960, 1490];
    filmStrip(g, 80 + slide, sy, 1760, sh, { shadow: true, fw: 1, gap: 2000, frame: () => {} });
    LESSONS.forEach(([n, s, kind, t0], i) => {
      const x = xs[i] + slide, y = sy + sh / 2, on = seg(lt, t0, t0 + .5);
      g.save(); g.fillStyle = on > 0 ? C.paper : '#3A3129'; g.globalAlpha *= on > 0 ? .4 + .6 * eo(on) : 1; g.fillRect(x - fw / 2, y - fh / 2, fw, fh); g.restore();
      if (on <= 0) return;
      g.save(); g.globalAlpha *= eo(on);
      if (on < 1) { g.fillStyle = rgba(C.amber, .5 * (1 - on)); g.fillRect(x - fw / 2, y - fh / 2, fw, fh); }
      text(g, n, x - fw / 2 + 30, y - fh / 2 + 48, { f: 'disp', s: 56, w: 900, c: C.amber, a: 'left' });
      if (kind === 'proj') projector(g, x - 40, y - 10, .62, lt, { beamLen: 160, beamH: 90, body: '#5A4A3D' });
      if (kind === 'pix') pixelCanvas(g, x - 110, y - 100, 220, 150, Math.floor(lt * 25) % 50, { cols: 16, rows: 11 });
      if (kind === 'one') { for (let j = 0; j < 3; j++) { const yy = y - 90 + j * 60, lit = j === Math.floor(lt * 1.5) % 3; path(g, [[x - 150, yy], [x + 40, y - 30]], { c: lit ? C.amber : rgba(C.ink, .25), w: lit ? 6 : 3 }); dot(g, x - 160, yy, 14, lit ? C.amber : C.ink2); } rr(g, x + 40, y - 70, 110, 80, 6); g.fillStyle = C.ink; g.fill(); }
      text(g, s, x, y + fh / 2 - 40, { s: 34, w: 900, c: C.ink });
      g.restore();
    });
  },
});

/* =====================================================================
 * 7 系列片尾
 * ===================================================================== */
S('s19', {
  title: true, fi: .2, fo: .4,
  cues: [[.1, 'reel', .5]],
  draw(g, lt) {
    const a = eo(seg(lt, 0, .3));
    filmStrip(g, -20, 720, W + 40, 150, { foff: lt * 60, al: a * .8, frame: (g2, i, fx, fy, fw, fh) => cardFrame(g2, i * 4, fx, fy, fw, fh, { sc: ((i % 6) + 6) % 6, num: false }) });
    text(g, SERIES.title, 960, 450, { s: 110, w: 900, al: a });
    text(g, SERIES.sub, 960, 570, { s: 42, w: 700, c: C.amber, al: eo(seg(lt, .2, .5)) });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  filmStrip(g, -20, 820, W + 40, 200, { foff: 140, frame: (g2, i, fx, fy, fw, fh) => cardFrame(g2, i * 4, fx, fy, fw, fh, { sc: ((i % 6) + 6) % 6 }) });
  const b = { x: 1060, y: 330, w: 780, h: 440 };
  card(g, b.x, b.y, b.w, b.h, { r: 14, fill: C.paper, sa: .5, sb: 34, so: 14 });
  const st = [[b.x + 50, b.y + 380]]; for (let i = 0; i < 5; i++) { const y = b.y + 380 - i * 66; st.push([b.x + 50 + (i + 1) * 70 - 18, y]); st.push([b.x + 50 + (i + 1) * 70, y - 66]); }
  path(g, st, { c: C.red, w: 10 });
  path(g, [[b.x + 440, b.y + 300], [b.x + 740, b.y + 300]], { c: C.teal, w: 10 });
  arrow(g, [[b.x + 410, b.y + 110], [b.x + 520, b.y + 250]], { c: C.ink2, w: 5, hs: 22 });
  text(g, '1.2 GB', b.x + 240, b.y + 56, { f: 'mono', s: 44, w: 700, c: C.red });
  text(g, '一条平线', b.x + 590, b.y + 360, { s: 44, w: 900, c: C.teal });
  text(g, '1.2GB →', 90, 300, { f: 'disp', s: 150, w: 900, c: C.paper, a: 'left' });
  text(g, '一条平线', 90, 480, { s: 150, w: 900, c: C.amber, a: 'left' });
  text(g, '帧动画主题开发 · 50 帧共用一块画布', 96, 640, { s: 46, w: 900, c: C.paper, a: 'left' });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
