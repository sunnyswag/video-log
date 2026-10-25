/* =====================================================================
 * 卡片架构与看板卡片重构 —— 场景编排（字幕数据在 script.js，图元在 kit.js）
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]；demo: true 或起始秒数 → 右上角“⚠ 机制演绎”。
 * 章节编号：0 开场、1 片名、2–6 五章、7 总结、8 结尾、9 片尾（配乐脚本按此划段）。
 * 样片阶段只登记了 s02 片名、s05 两份真相、s08 配置只写三件事；其余幕按 视频稿.md 补齐。
 * ===================================================================== */
'use strict';
const CHAPTERS = [
  ['开场｜加一张卡，要改两处', 'ADD ONE CARD', '加一张卡，要同时改 ViewModel 里的 if-else 和一份 JSON 配置。'],
  ['卡片架构与看板卡片重构', 'CARD ARCHITECTURE', '把 if-else，拆成积木。'],
  ['第一章｜一个类，管着所有卡', 'ONE CLASS, EVERY CARD', '造卡代码集中在一个 ViewModel，约 500 行 if-else，配置与代码共同决定实例化。'],
  ['第二章｜配置定形，工厂造卡', 'CONFIG SHAPES, FACTORY BUILDS', 'JSON 决定卡片类型、样式与尺寸；每个卡片 UiModel 一个工厂，经注册表按类名取实例。'],
  ['第三章｜能不能建，谁说了算', 'WHO DECIDES IT EXISTS', '泛型 Subject、可空的 provideSubject 与不可空的 produce、建后过滤器、工厂管理器串成一条链。'],
  ['第四章｜能力做积木，卡片来拼', 'FUNCTIONS AS BLOCKS', 'function / uimodel / uibinding 三层：能力归一、接口委托组合、按尺寸选 binder。'],
  ['第五章｜只刷新变了的那一格', 'REDRAW ONLY WHAT CHANGED', '上报经 func 产出 payload 局部刷新；点击经委托调到 func，按设备类型选通道，超时回滚。'],
  ['总结｜带走三条', 'THREE TAKEAWAYS', '长什么样写成配置；能不能建和怎么建分开；按能力组合。'],
  ['结尾｜还欠着的账', 'WHAT IS LEFT', '单卡实例化 0~300ms、过滤器提前合并、JSON 可读性。'],
  ['系列片尾', 'WORK ARCHIVE', '工作档案：把做过的设计，讲成故事。'],
];
/* 章节卡：编号、标题、英文、本章色 */
const CARD = {
  2: ['01', '一个类，管着所有卡', 'ONE CLASS, EVERY CARD', C.red],
  3: ['02', '配置定形，工厂造卡', 'CONFIG SHAPES, FACTORY BUILDS', C.blue],
  4: ['03', '能不能建，谁说了算', 'WHO DECIDES IT EXISTS', C.yellow],
  5: ['04', '能力做积木，卡片来拼', 'FUNCTIONS AS BLOCKS', C.red],
  6: ['05', '只刷新变了的那一格', 'REDRAW ONLY WHAT CHANGED', C.blue],
  7: ['✓', '带走三条', 'THREE TAKEAWAYS', C.ink],
};
const chCol = n => (CARD[n] || [0, 0, 0, C.yellow])[3];
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.paper, white: C.ink, cyan: C.blue, red: C.red, amber: C.yellow },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: C.blue, danger: C.red, accent: C.yellow },
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

/* 章节转场：本章色大矩形从上落下、黑条从下升起、白板带三原色构成从右滑入 → 停留 → 反向退出 */
function chapterWipe(g, { sc, lt }) {
  const cd = CARD[sc.card]; if (!cd || lt > 1.95) return;
  const [num, zh, en, col] = cd, tc = onCol(col);
  const ay = lerp(-H - 60, 0, eio(seg(lt, 0, .42))) - (H + 80) * eio(seg(lt, 1.44, 1.92));
  const by = lerp(H + 60, 0, eio(seg(lt, .05, .45))) + (H + 80) * eio(seg(lt, 1.4, 1.88));
  const px = lerp(W + 60, 1250, eio(seg(lt, .1, .5))) + 760 * eio(seg(lt, 1.36, 1.86));
  g.save();
  // 右侧白板 + 构成
  box(g, px, -10, W - 1250 + 40, H + 20, C.white, { sh: 0, lw: 0 });
  const pc = new Path2D(); pc.rect(px, -10, W - 1250 + 40, H + 20);
  g.save(); g.clip(pc);
  const k = pop(seg(lt, .32, .78)), dx = px - 1250;
  const cc = col === C.yellow ? C.red : C.yellow, tcol = col === C.blue ? C.red : C.blue;
  disc(g, 1600 + dx, 400, 200 * k, cc, { sh: 10 });
  at(g, 1415 + dx, 725, k, () => box(g, -85, -85, 170, 170, C.ink, { sh: 0, lw: 0 }), { rot: (1 - k) * .6 });
  tri(g, 1712 + dx, 770, 230 * k, tcol, { sh: 10, rot: (1 - k) * -.5 });
  text(g, 'CHAPTER ' + (num === '✓' ? 'END' : num), 1296 + dx, 168, { f: 'mono', s: 30, w: 700, ls: 6, a: 'left' });
  g.restore();
  // 黑条
  g.fillStyle = C.ink; g.fillRect(1180, by - 10, 70, H + 20);
  // 主色块
  const band = new Path2D(); band.rect(-10, ay - 10, 1190, H + 20);
  g.save(); g.shadowColor = C.ink; g.shadowOffsetX = 14 * SH(); g.shadowOffsetY = 0; g.fillStyle = col; g.fill(band); g.restore();
  g.clip(band);
  const a = eo(seg(lt, .3, .62)) * (1 - eo(seg(lt, 1.36, 1.52))), tx = (1 - eo(seg(lt, .3, .72))) * 90;
  g.save(); g.globalAlpha *= a;
  if (num === '✓') icCheck(g, 300 - tx, 330 + ay, 300, tc, 1, 56);
  else text(g, num, 104 - tx, 352 + ay, { f: 'disp', w: 900, s: 340, c: tc, a: 'left' });
  text(g, zh, 110 + tx * .5, 650 + ay, { s: 100, w: 900, c: tc, a: 'left' });
  text(g, en, 116 + tx * .5, 748 + ay, { f: 'mono', s: 30, w: 700, ls: 6, c: tc === C.ink ? C.ink : rgba('#ffffff', .82), a: 'left' });
  box(g, 116 + tx * .5, 800 + ay, 120, 16, tc, { sh: 0, lw: 0 });
  g.restore();
  g.restore();
}

/* 外框：左上章节、右上进度、⚠ 标记 */
const CH_SHORT = ['开场', '', '第一章 · 一个类，管着所有卡', '第二章 · 配置定形，工厂造卡', '第三章 · 能不能建，谁说了算', '第四章 · 能力做积木，卡片来拼', '第五章 · 只刷新变了的那一格', '总结 · 带走三条', '结尾 · 还欠着的账', ''];
const demoOn = (sc, lt) => sc.demo === true ? 1 : typeof sc.demo === 'number' ? eo(seg(lt, sc.demo, sc.demo + .3)) : 0;
function drawChrome(g, { sc, lt }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 76;
    box(g, 52, 40, w, 52, C.white, { sh: 5, lw: 3 });
    box(g, 52, 40, 24, 52, chCol(sc.chapter), { sh: 0, lw: 3 });
    text(g, lab, 52 + 24 + 20, 67, { s: 26, w: 700, a: 'left' });
  }
  for (let k = 2; k <= 7; k++) { // 章节进度：当前 = 本章色长块，已过 = 墨色方块，未到 = 空框
    const on = sc.chapter > k, cur = sc.chapter === k, x = 1610 + (k - 2) * 46;
    if (cur) box(g, x, 56, 36, 20, chCol(k) === C.ink ? C.yellow : chCol(k), { sh: 3, lw: 3 });
    else box(g, x, 56, 20, 20, on ? C.ink : null, { sh: 0, lw: 3 });
  }
  const d = demoOn(sc, lt);
  if (d > 0) { g.save(); g.globalAlpha *= d; tagSmall(g, '⚠ 机制演绎', 1580, 66, C.yellow); g.restore(); }
  g.restore();
}

/* 字幕：白色直角板 + 墨框 + 硬投影，左端本章色竖条；重点词着色，琥珀压黄色色块 */
function capState(g, frame) {
  const { sc, lt } = frame; if (sc.title || sc.noCaption || !sc.captions?.length) return null;
  const i = sc.cs.findIndex((s, k) => lt >= s && lt < sc.ce[k]); if (i < 0) return null;
  const c = { t0: sc.start + sc.cs[i], t1: sc.start + sc.ce[i], text: sc.captions[i].text }, layout = film.captionLayout(g, c, frame.t);
  if (!layout) return null;
  return { layout, alpha: Math.min(seg(lt, sc.cs[i], sc.cs[i] + .12), 1 - seg(lt, sc.ce[i] - .12, sc.ce[i])) };
}
function drawCaptionBackground(g, frame) {
  CAMZ = 1; const c = capState(g, frame); if (!c) return;
  const L = c.layout.lines, w = Math.max(...L.map(l => l.width)) + 100, top = L[0].y - 66, h = (L.length - 1) * 64 + 98;
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .25)), x = (W - w) / 2, y = top + (1 - k) * 10;
  g.save(); g.globalAlpha *= c.alpha;
  box(g, x, y, w, h, C.white, { sh: 6, lw: 4 });
  box(g, x, y, 18, h, chCol(frame.sc.chapter), { sh: 0, lw: 4 });
  g.restore();
}
function drawCaption(g, layout, frame) {
  if (frame.sc.title || frame.t >= layout.caption.t1) return;
  const k = eo(seg(frame.t, layout.caption.t0, layout.caption.t0 + .25));
  g.globalAlpha = Math.min(seg(frame.t, layout.caption.t0, layout.caption.t0 + .12), 1 - seg(frame.t, layout.caption.t1 - .12, layout.caption.t1));
  for (const l of layout.lines) {
    let x = l.x + 6; const y = l.y + (1 - k) * 10;
    for (const s of l.segments) {
      const w = textW(g, s.s, { s: 54, w: 700 });
      if (s.c === C.yellow) { g.fillStyle = C.yellow; g.fillRect(x - 4, y - 36, w + 8, 46); }
      text(g, s.s, x, y, { s: 54, w: 700, c: s.c && s.c !== C.yellow ? s.c : C.ink, a: 'left', b: 'alphabetic' });
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
 * 片名
 * ===================================================================== */
/* 片名上方的迷你看板：[列, 行, 宽, 高, 图标, 顶条色]，格子 60 px */
const MINI = [[0, 0, 3, 2, 'lamp', C.yellow], [3, 0, 3, 2, 'switch', C.red], [6, 0, 6, 2, 'ac', C.blue],
  [0, 2, 2, 2, 'scene', C.red], [2, 2, 4, 2, 'music', C.yellow], [6, 2, 3, 2, 'curtain', C.blue], [9, 2, 3, 2, 'album', C.yellow]];
function miniBoard(g, ox, oy, lt, t0, o = {}) {
  const cell = o.cell || 60, gap = 8;
  MINI.forEach(([cx, cy, cw, chh, kind, acc], i) => {
    const t1 = t0 + i * .08, [dy, sx] = landing(lt, t1, .45, -170 - hash(i * 4.1) * 90);
    const al = seg(lt, t1, t1 + .12); if (al <= 0) return;
    const x = ox + cx * cell + gap / 2, y = oy + cy * cell + gap / 2, w = cw * cell - gap, h = chh * cell - gap;
    at(g, x + w / 2, y + h + dy, 1, () => bcard(g, -w / 2, -h, w, h, { kind, acc, lt: lt + i, on: 1, sh: 6 }), { sx, sy: 1 / sx, al });
    if (o.ripple !== false) ripple(g, x + w / 2, y + h / 2, lt - t1 - .45, w, h, 18, .5);
  });
}
S('s02', {
  title: true, fi: .3,
  cues: [[.1, 'whoosh'], [.6, 'block'], [.8, 'block'], [1.0, 'block'], [1.2, 'block'], [2.0, 'stamp'], [3.7, 'block'], [4.8, 'snap']],
  draw(g, lt) {
    miniBoard(g, 492, 118, lt, .08, { cell: 78 });
    // 标题：逐字落下，墨字 + 黄色硬投影
    const title = '卡片架构与看板卡片重构', o = { s: 112, w: 900 };
    const total = textW(g, title, o); let x = 960 - total / 2;
    Array.from(title).forEach((ch, i) => {
      const w = textW(g, ch, o), p = seg(lt, 1.0 + i * .045, 1.45 + i * .045);
      if (p > 0) at(g, x + w / 2, 572 - (1 - eo(p)) * 90, .7 + .3 * pop(p), () => text(g, ch, 0, 0, { ...o, shc: C.yellow, shd: 7 }), { al: eo(p) });
      x += w;
    });
    // 标题下的黑条：左红方、右蓝圆
    const u = eio(seg(lt, 1.6, 2.2)), bx = 960 - total / 2;
    box(g, bx, 652, total * u, 14, C.ink, { sh: 0, lw: 0 });
    at(g, bx - 4, 659, pop(seg(lt, 1.55, 1.9)), () => box(g, -16, -16, 32, 32, C.red, { sh: 4, lw: 3 }));
    at(g, bx + total + 6, 659, pop(seg(lt, 2.1, 2.45)), () => disc(g, 0, 0, 17, C.blue, { sh: 4, lw: 3 }));
    // 副标题：“if-else” 色块在 4.8 秒碎成三块积木
    const sp = seg(lt, 3.6, 4.0); if (sp <= 0) return;
    const fs = 64, mono = { f: 'mono', s: 54, w: 700 }, parts = ['if', '-', 'else'], pc = [C.red, C.yellow, C.blue];
    const split = spring(lt - 4.8, 5, 1.1) * (lt > 4.8 ? 1 : 0), gapW = 18 * split;
    const pw = parts.map((s, i) => textW(g, s, mono) + (i === 1 ? 0 : 14) + 26 * split), blockW = pw.reduce((a, b) => a + b, 0) + gapW * 2;
    const left = '把 ', right = '，拆成积木', lw = textW(g, left, { s: fs, w: 900 }), rw = textW(g, right, { s: fs, w: 900 });
    let sx = 960 - (lw + blockW + rw + 20) / 2; const sy = 790;
    at(g, 960, sy, .85 + .15 * pop(sp), () => {
      g.translate(-960, -sy);
      text(g, left, sx, sy + 4, { s: fs, w: 900, a: 'left' }); sx += lw + 6;
      parts.forEach((s, i) => {
        const c = lt < 4.8 ? C.red : pc[i], rot = [-.07, .05, .08][i] * split * (1 - seg(lt, 5.6, 6.4) * .6), dy = [-6, 8, -4][i] * split;
        at(g, sx + pw[i] / 2, sy + dy, 1, () => {
          box(g, -pw[i] / 2 - (lt < 4.8 && i > 0 ? 1 : 0), -42, pw[i] + (lt < 4.8 ? 2 : 0), 84, c, { sh: lt < 4.8 && i < 2 ? 0 : 6, lw: lt < 4.8 ? 0 : 4 });
          text(g, s, 0, 2, { ...mono, c: onCol(c) });
        }, { rot });
        sx += pw[i] + gapW;
      });
      if (lt < 4.8) { const bw = pw.reduce((a, b) => a + b, 0); box(g, sx - bw, sy - 42, bw, 84, null, { lw: 4 }); }
      text(g, right, sx + 14 - 10 * split, sy + 4, { s: fs, w: 900, a: 'left' });
    }, { al: eo(sp) });
    if (lt > 4.8) burst(g, 960, sy, lt - 4.8, 10, 120);
  },
});

/* =====================================================================
 * 第一章：一个类，管着所有卡
 * ===================================================================== */
/* s05 两份真相：左右两个 diff 小窗（示意代码），下方一张靠两边共同拼出来的空调卡 */
const VM_X = 70, CFG_X = 1070, WIN_Y = 160, WIN_W = 780, WIN_H = 350;
const VM_L1 = '} else if (type == DEVICE && model == AC) {', VM_L1B = '} else if (type == DEVICE && model == AC_V2) {';
const SLOT = { x: 700, y: 610, w: 520, h: 190 };
/* 积木件：从 from 飞到卡片上的落点；loose 为“松动”偏移 [dx, dy, rot] */
function piece(g, lt, t0, from, to, drawFn, loose, kLoose) {
  const raw = (lt - t0) / .7; if (raw < 0) return;
  let p;
  if (raw < 1) { const u = eio(raw); p = arcPos(from, to, u, 140); }
  else p = to;
  const [dy, sxx] = raw >= 1 ? landing(lt, t0 + .7 - .001, .001, 0) : [0, 1];
  const L = loose ? [loose[0] * kLoose, loose[1] * kLoose, loose[2] * kLoose] : [0, 0, 0];
  at(g, p[0] + L[0], p[1] + dy + L[1], raw < 1 ? .8 + .2 * eo(raw) : 1, drawFn, { rot: L[2] + (raw < 1 ? (1 - raw) * .5 : 0), sx: sxx, sy: 1 / sxx });
}
S('s05', {
  demo: 7.2,
  cam: [[0, 960, 540, 1], [3.4, 960, 556, 1.03], [7.2, 960, 556, 1.03], [8.6, 960, 566, 1.045], [11, 960, 566, 1.045]],
  cues: [[.2, 'block'], [.5, 'block'], [.9, 'type'], [3.6, 'whoosh'], [4.1, 'block'], [4.5, 'block'], [4.9, 'block'], [5.6, 'stamp'], [7.6, 'type'], [8.3, 'error'], [8.6, 'block', .6]],
  draw(g, lt) {
    const bad = seg(lt, 8.2, 8.5), loose = spring(lt - 8.4, 4.5, 1.2) * (lt > 8.4 ? 1 : 0);
    // 左窗：PanelViewModel.kt
    const ins = (a) => eo(seg(lt, a, a + .3));
    const editP = seg(lt, 7.75, 8.15), acIdx = VM_L1.indexOf('AC)');
    const l1 = lt < 7.75 ? VM_L1 : VM_L1.slice(0, acIdx + 2) + '_V2'.slice(0, Math.round(3 * editP)) + VM_L1.slice(acIdx + 2);
    const vmLines = [
      { t: '@@ 造卡的 if-else 链（示意） @@', k: '@' },
      { t: '} else if (type == SCENE) {' },
      { t: '    cards += SceneCardUiModel(card)' },
      { t: l1, k: '+', hk: ins(.7), p: seg(lt, 1.0, 1.9) },
      { t: '    cards += AcCardUiModel(card, parse(card))', k: '+', hk: ins(.8), p: seg(lt, 1.9, 2.8) },
      { t: '} else if (type == MUSIC) {' },
    ];
    const cfgLines = [
      { t: '@@ 卡片配置 cardmapper.json（示意） @@', k: '@' },
      { t: '  { "cardType": "scene", ... },' },
      { t: '  { "cardType": "device",', k: '+', hk: ins(.75), p: seg(lt, 1.1, 1.7) },
      { t: '    "deviceTypes": ["AC"],', k: '+', hk: ins(.85), p: seg(lt, 1.7, 2.3) },
      { t: '    "style": "middle" },', k: '+', hk: ins(.95), p: seg(lt, 2.3, 2.85) },
      { t: '  { "cardType": "music", ... }' },
    ];
    // “AC” 被改：先选中高亮再改写
    if (lt > 7.4) vmLines[3].hl = C.red, vmLines[3].hlA = seg(lt, 7.4, 7.6);
    if (lt > 8.2) cfgLines[3].hl = C.grey, cfgLines[3].hlA = bad;
    const pa = pop(seg(lt, .05, .45)), pb = pop(seg(lt, .2, .6));
    at(g, VM_X + WIN_W / 2, WIN_Y + WIN_H / 2, .9 + .1 * pa, () => ide(g, -WIN_W / 2, -WIN_H / 2, WIN_W, WIN_H, vmLines, { title: 'PanelViewModel.kt', tag: '示意', s: 24, lh: 44, lt }), { al: seg(lt, .05, .25) });
    at(g, CFG_X + WIN_W / 2, WIN_Y + WIN_H / 2, .9 + .1 * pb, () => ide(g, -WIN_W / 2, -WIN_H / 2, WIN_W, WIN_H, cfgLines, { title: 'cardmapper.json', tag: '示意', s: 24, lh: 44, lt }), { al: seg(lt, .2, .4) });
    // “AC” 选中框
    if (lt > 7.4 && lt < 7.8) {
      const x0 = codeX(g, VM_L1, acIdx, VM_X, { s: 24 }), y0 = WIN_Y + 54 + 18 + 3 * 44;
      g.save(); g.globalAlpha *= seg(lt, 7.4, 7.5); g.fillStyle = rgba(C.red, .35); g.fillRect(x0 - 2, y0 + 6, charW(24) * 2 + 4, 32); g.restore();
    }
    // 两根导线：窗口 → 卡片
    const wireP = eo(seg(lt, 1.5, 2.4)), wy = SLOT.y + SLOT.h / 2;
    const wl = [[460, WIN_Y + WIN_H + 8], [460, wy], [SLOT.x - 10, wy]], wr = [[1460, WIN_Y + WIN_H + 8], [1460, wy], [SLOT.x + SLOT.w + 10, wy]];
    path(g, partial(wl, wireP), { c: C.red, w: 8 });
    if (bad < 1) path(g, partial(wr, wireP), { c: C.red, w: 8, al: 1 - bad });
    if (bad > 0) { // 右边导线断开
      path(g, [wr[0], [1460, wy - 60]], { c: C.red, w: 8, dash: [14, 12], al: bad });
      path(g, [[1460, wy - 20], wr[1], wr[2]], { c: C.red, w: 8, dash: [14, 12], al: bad, off: lt * 30 });
      at(g, 1460, wy - 40, pop(seg(lt, 8.25, 8.6)), () => icCross(g, 0, 0, 40, C.red, 1, 9));
    }
    for (const p of [wl[0], wr[0]]) box(g, p[0] - 12, p[1] - 6, 24, 16, C.red, { sh: 0, lw: 3, al: wireP > 0 ? 1 : 0 });
    // 卡片空位 → 卡身
    const bodyK = seg(lt, 3.9, 4.2), { x, y, w, h } = SLOT;
    box(g, x, y, w, h, null, { lw: 4, dash: [16, 12], off: -lt * 20, al: 1 - bodyK * (1 - bad) });
    if (bodyK > 0) at(g, x + w / 2, y + h / 2, pop(bodyK), () => box(g, -w / 2, -h / 2, w, h, C.white, { sh: 8, al: 1 - .55 * bad, dash: bad > .5 ? [16, 12] : null }));
    // 积木件：配置给“长什么样”（黄顶条 + 名字），代码给“怎么造”（空调图标 + 开关）
    const fromL = [560, 400], fromR = [1300, 360];
    piece(g, lt, 3.5, fromR, [x + w / 2, y + 14], () => box(g, -w / 2, -14, w, 28, C.yellow, { sh: 0 }), [46, -10, -.07], loose);
    piece(g, lt, 3.7, fromR, [x + 250, y + 92], () => text(g, '空调', 0, 0, { s: 40, w: 900 }), [-16, -12, .07], loose);
    piece(g, lt, 3.9, fromL, [x + 92, y + 108], () => icon(g, 'ac', 0, 0, 1, lt), [-60, 40, -.25], loose);
    piece(g, lt, 4.2, fromL, [x + 420, y + 108], () => icon(g, 'switch', 0, 0, .95, lt, { on: 1 - bad }), [70, 50, .3], loose);
    if (lt > 5.1) text(g, '26°', x + 250, y + 146, { f: 'disp', s: 44, w: 900, c: C.blue, al: seg(lt, 5.1, 5.4) * (1 - bad * .9) });
    if (lt > 4.9 && lt < 6) burst(g, x + w / 2, y + h / 2, lt - 4.95, 12, 220);
    if (lt > 4.9) ripple(g, x + w / 2, y + h / 2, lt - 4.95, w, h, 30, .55);
    if (lt < 8.3) tagB(g, '造得出来', x + w + 30, y - 6, C.blue, seg(lt, 5.5, 5.9), { fs: 26, icon: 'check', rot: .06 });
    if (lt > 8.4) badge(g, x + w + 26, y - 4, 34, C.red, 'cross', seg(lt, 8.5, 8.85), { rot: wob(lt, .6, .08) });
    // 中间标签：两处共同决定 → 对不上（画在积木之后，不被松动的积木盖住）
    if (lt < 8.3) tagB(g, '两处共同决定', 960, 556, C.ink, seg(lt, 2.1, 2.5), { fs: 26, rot: -.02 });
    else tagB(g, '对不上', 960, 556, C.red, seg(lt, 8.3, 8.7), { fs: 28, icon: 'cross', rot: .03 });
  },
});

/* =====================================================================
 * 第二章：配置定形，工厂造卡
 * ===================================================================== */
const CFG8 = [
  '{ "cardType": "device",',
  '  "deviceTypes": ["AC"],',
  '  "styles": [',
  '    { "name": "ac_middle", "span": "MIDDLE_6x2",',
  '      "factory": "AcCardFactory" },',
  '    { "name": "ac_big", "span": "LARGE_5x4",',
  '      "factory": "AcCardFactory" }',
  '  ] }',
];
/* 逐行打字的时间表：每秒 50 字，换行停 0.12 秒 */
const CFG8_T = (() => { let t = 2.2; return CFG8.map(s => { const a = t; t += s.length / 50 + .12; return [a, t - .12]; }); })();
const W8 = { x: 80, y: 170, w: 800, h: 450, s: 24, lh: 46 };
const lineY8 = i => W8.y + 54 + 18 + i * W8.lh + W8.lh / 2;
const tokX8 = (i, s) => codeX(g8, CFG8[i], CFG8[i].indexOf(s), W8.x, { s: W8.s }) + charW(W8.s) * s.length / 2;
let g8 = null;
S('s08', {
  card: 3,
  cam: [[0, 960, 540, 1], [2, 960, 540, 1], [12, 975, 548, 1.02]],
  cues: [[0, 'whoosh'], [2.2, 'type'], [2.8, 'block'], [3.4, 'block'], [5.0, 'snap'], [5.6, 'block'], [6.6, 'block'], [8.6, 'tick'], [9.2, 'stamp'], [10.0, 'success']],
  draw(g, lt) {
    g8 = g;
    const hlSpan = win(lt, 8.5, 10.2, .25, .4), hlFac = win(lt, 9.0, 12, .25, .3);
    const lines = CFG8.map((t, i) => ({ t, p: seg(lt, CFG8_T[i][0], CFG8_T[i][1]) }));
    [3, 5].forEach(i => { if (hlSpan > 0) { lines[i].hl = C.blue; lines[i].hlA = hlSpan; } });
    [4, 6].forEach(i => { if (hlFac > 0) { lines[i].hl = C.yellow; lines[i].hlA = hlFac * 1.6; } });
    const pw = pop(seg(lt, 1.3, 1.75));
    at(g, W8.x + W8.w / 2, W8.y + W8.h / 2, .88 + .12 * pw, () => ide(g, -W8.w / 2, -W8.h / 2, W8.w, W8.h, lines, { title: 'cardmapper.json', tag: '重写的示意', s: W8.s, lh: W8.lh, lt }), { al: seg(lt, 1.3, 1.5) });
    // 字段脱出成积木：device（红）、AC（蓝）
    const blk = (i, tok, to, col, label, t0) => {
      const raw = seg(lt, t0, t0 + .6); if (raw <= 0) return;
      const from = [tokX8(i, tok), lineY8(i)], p = raw < 1 ? arcPos(from, to, eio(raw), 110) : to;
      const [dy, sxx] = landing(lt, t0 + .6, .001, 0);
      const ww = textW(g, label, { f: 'mono', s: 30, w: 700 }) + 44;
      at(g, p[0], p[1] + dy, .7 + .3 * eo(raw), () => { box(g, -ww / 2, -32, ww, 64, col, { sh: 7 }); text(g, label, 0, 2, { f: 'mono', s: 30, w: 700, c: onCol(col) }); }, { sx: sxx, sy: 1 / sxx, rot: (1 - eo(raw)) * -.4 });
      if (raw >= 1) ripple(g, to[0], to[1], lt - t0 - .6, ww, 64, 20, .5);
    };
    blk(0, '"device"', [1130, 240], C.red, 'device', CFG8_T[0][1] - .1);
    blk(1, '["AC"]', [1450, 240], C.blue, 'AC', CFG8_T[1][1] - .1);
    text(g, '卡片类型', 1130, 180, { s: 24, w: 700, c: C.ink2, al: seg(lt, CFG8_T[0][1] + .4, CFG8_T[0][1] + .7) });
    text(g, '设备类型', 1450, 180, { s: 24, w: 700, c: C.ink2, al: seg(lt, CFG8_T[1][1] + .4, CFG8_T[1][1] + .7) });
    at(g, 1290, 240, pop(seg(lt, 4.9, 5.2)), () => { box(g, -6, -22, 12, 44, C.ink, { sh: 0, lw: 0 }); box(g, -22, -6, 44, 12, C.ink, { sh: 0, lw: 0 }); });
    // 箭头：→ 一组样式
    arrow(g, [[1290, 292], [1290, 360]], { p: eo(seg(lt, 5.0, 5.4)), w: 8, hs: 24 });
    text(g, '一组样式', 1318, 326, { s: 26, w: 900, a: 'left', al: seg(lt, 5.2, 5.5) });
    // 两个样式：网格占位按真实比例（格子 52 px）
    const cell = 52, A = { x: 990, y: 400, c: 6, r: 2, name: 'ac_middle', sz: '6×2', i: 3 }, B = { x: 1450, y: 400, c: 5, r: 4, name: 'ac_big', sz: '5×4', i: 5 };
    for (const S8 of [A, B]) {
      const t0 = CFG8_T[S8.i][1] - .2, p = seg(lt, t0, t0 + .8); if (p <= 0) continue;
      const pulse = 1 + .05 * hlSpan * Math.sin(lt * 9);
      at(g, S8.x + S8.c * cell / 2, S8.y + S8.r * cell / 2, pulse, () => {
        g.translate(-(S8.x + S8.c * cell / 2), -(S8.y + S8.r * cell / 2));
        cells(g, S8.x, S8.y, S8.c, S8.r, cell, p, C.yellow, { order: true });
        if (p > .7) at(g, S8.x + S8.c * cell / 2, S8.y + S8.r * cell / 2, pop(seg(p, .7, 1)), () => { const tw = textW(g, S8.sz, { f: 'disp', s: 40, w: 900 }) + 28; box(g, -tw / 2, -28, tw, 56, C.ink, { sh: 0, lw: 0 }); text(g, S8.sz, 0, 2, { f: 'disp', s: 40, w: 900, c: '#fff' }); });
      });
      text(g, S8.name, S8.x + S8.c * cell / 2, S8.y + S8.r * cell + 36, { f: 'mono', s: 26, w: 700, al: seg(p, .5, 1) });
    }
    // 同一个工厂，连到两个样式
    const fk = pop(seg(lt, 9.1, 9.5)), FX = 1290, FY = 826;
    const wp = eo(seg(lt, 9.5, 10.2));
    path(g, partial([[FX - 40, FY - 50], [A.x + A.c * cell / 2, FY - 50], [A.x + A.c * cell / 2, A.y + A.r * cell + 62]], wp), { w: 6 });
    path(g, partial([[FX + 40, FY - 50], [B.x + B.c * cell / 2, FY - 50], [B.x + B.c * cell / 2, B.y + B.r * cell + 62]], wp), { w: 6 });
    factory(g, FX, FY, .85 * fk, C.blue, lt, { label: fk > .5 ? 'AcCardFactory' : null, busy: lt > 9.5 });
    if (wp > .98) { box(g, A.x + A.c * cell / 2 - 9, A.y + A.r * cell + 56, 18, 18, C.ink, { sh: 0, lw: 0 }); box(g, B.x + B.c * cell / 2 - 9, B.y + B.r * cell + 56, 18, 18, C.ink, { sh: 0, lw: 0 }); }
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  miniBoard(g, 1010, 330, 10, 0, { cell: 66, ripple: false });
  const lines = [
    { t: '} else if (type == SCENE) {', k: '-' },
    { t: '} else if (type == DEVICE && model == AC) {', k: '-' },
    { t: '    cards += AcCardUiModel(card, parse(card))', k: '-' },
    { t: 'val card = factoryManager.produceCard(panelCard)', k: '+' },
  ];
  ide(g, 90, 360, 860, 300, lines, { title: 'PanelViewModel.kt', tag: '示意', s: 22, lh: 50, lt: 1 });
  text(g, '约 500 行 if-else，拆成积木', 960, 160, { s: 118, w: 900, shc: C.yellow, shd: 8 });
  text(g, '看板卡片的工厂、配置与三层架构', 960, 270, { s: 50, w: 900, c: C.blue });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
