/* =====================================================================
 * 卡片架构与看板卡片重构 —— 场景编排（字幕数据在 script.js，图元在 kit.js）
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]；demo: true 或起始秒数 → 右上角“⚠ 机制演绎”。
 * 章节编号：0 开场、1 片名、2–6 五章、7 总结、8 结尾、9 片尾（配乐脚本按此划段）。
 * 34 幕按 视频稿.md 分镜编排；s02 / s05 / s08 为样片阶段写成，原样保留。
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
/* ---------------- 通用小工具 ---------------- */
/* 关键帧标量：[[t, v], ...]，相邻关键帧之间 eio 插值 */
function kf(keys, lt) {
  if (lt <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (lt <= keys[i][0]) { const a = keys[i - 1], b = keys[i]; return lerp(a[1], b[1], eio((lt - a[0]) / (b[0] - a[0]))); }
  return keys[keys.length - 1][1];
}
/* 等宽字小牌：白底墨框（或指定底色），p 给出时带弹出 */
function chipM(g, s, x, y, o = {}) {
  const fs = o.fs || 26, w = textW(g, s, { f: o.f || 'mono', s: fs, w: 700 }) + 30, h = fs + 22, col = o.col || C.white;
  at(g, x, y, o.p == null ? 1 : pop(o.p), () => { box(g, -w / 2, -h / 2, w, h, col, { sh: o.sh ?? 5, lw: 3, dash: o.dash }); text(g, s, 0, 1, { f: o.f || 'mono', s: fs, w: 700, c: o.tc || onCol(col) }); }, { rot: o.rot, al: o.al });
  return w;
}
const roll = (lt, t0, t1, a, b) => Math.round(lerp(a, b, eo(seg(lt, t0, t1))));
/* 抛物线飞行：未出发返回 null，到达后停在 b */
function flyPos(lt, t0, dur, a, b, lift = 120) { const k = (lt - t0) / dur; if (k < 0) return null; return k >= 1 ? b : arcPos(a, b, eio(k), lift); }
/* 小号说明文字（26px，墨灰） */
const note = (g, s, x, y, o = {}) => text(g, s, x, y, { s: o.s || 26, w: o.w || 700, c: o.c || C.ink2, a: o.a, al: o.al });

/* ---------------- 看板（s01 / s03）：20×12 格，格子 40 px ---------------- */
const BL = [
  [0, 0, 8, 3, 'header', C.yellow, '头部'], [8, 0, 4, 3, 'lamp', C.yellow, '灯'], [12, 0, 4, 3, 'switch', C.red, '开关'], [16, 0, 4, 3, 'scene', C.red, '场景'],
  [0, 3, 6, 4, 'ac', C.blue, '空调'], [6, 3, 4, 4, 'curtain', C.blue, '窗帘'], [10, 3, 6, 4, 'music', C.yellow, '音乐'], [16, 3, 4, 4, 'album', C.yellow, '相册'],
  [0, 7, 4, 5, 'energy', C.yellow, '能耗'], [4, 7, 3, 5, 'camera', C.ink, '摄像头'], [13, 7, 3, 5, 'lock', C.yellow, '门锁'], [16, 7, 4, 5, 'socket', C.red, '插座'],
];
const BSLOT = [7, 7, 6, 5, 'thermo', C.yellow, '温控'];
const bRect = ([c, r, w, h]) => [c * 40 + 3, r * 40 + 3, w * 40 - 6, h * 40 - 6];
/* 在 (ox, oy) 处按 s 缩放画看板；o: t0 开始落卡时间、st 间隔、names、slot（温控卡也算普通卡）、hl(i, b) 高亮系数、al */
function drawBoard(g, ox, oy, s, lt, o = {}) {
  g.save(); g.translate(ox, oy); g.scale(s, s); if (o.al != null) g.globalAlpha *= o.al;
  screenFrame(g, 0, 0, 800, 480, lt, { cell: 40 });
  const list = o.slot ? [...BL, BSLOT] : BL;
  list.forEach((b, i) => {
    const t1 = (o.t0 ?? 0) + i * (o.st ?? .08), [dy, sx] = landing(lt, t1, .4, -140);
    const al = seg(lt, t1, t1 + .1); if (al <= 0) return;
    const [x, y, w, h] = bRect(b), hk = o.hl ? o.hl(i, b) : 0;
    at(g, x + w / 2, y + h + dy - hk * 8, 1 + hk * .05, () => bcard(g, -w / 2, -h, w, h, { kind: b[4], acc: b[5], name: o.names ? b[6] : null, lt: lt + i * .7, sh: 6 + hk * 4 }), { sx, sy: 1 / sx, al });
  });
  g.restore();
}

/* =====================================================================
 * 开场
 * ===================================================================== */
const S01_VM = [
  { t: '} else if (type == LAMP) {' },
  { t: '    cards += LampCardUiModel(card)' },
  { t: '} else if (type == THERMO) {', k: '+' },
  { t: '    cards += ThermoCardUiModel(card)', k: '+' },
];
const S01_CFG = [
  { t: '  { "cardType": "lamp", ... },' },
  { t: '  { "cardType": "device",', k: '+' },
  { t: '    "deviceTypes": ["THERMO"] },', k: '+' },
];
S('s01', {
  fi: .4,
  cam: [[0, 960, 560, 1.18], [3.2, 960, 560, 1.18], [4.3, 960, 540, 1], [18, 960, 540, 1]],
  cues: [[.3, 'block'], [.6, 'block'], [.9, 'block'], [3.8, 'type'], [7.6, 'type'], [11.2, 'snap'], [13.55, 'block'], [15, 'whoosh']],
  draw(g, lt) {
    const k = eio(seg(lt, 3.4, 4.3)), s = lerp(1, .72, k), bcy = lerp(520, 650, k), ox = 960 - 400 * s, oy = bcy - 240 * s;
    drawBoard(g, ox, oy, s, lt, { t0: .15, st: .07 });
    const [rx, ry, rw, rh] = bRect(BSLOT), scy = oy + (ry + rh / 2) * s, cw = rw * s, chh = rh * s;
    const drop = seg(lt, 13.2, 13.55), dim = 1 - .6 * eo(seg(lt, 14.6, 15.1));
    if (drop < 1) box(g, 960 - cw / 2, scy - chh / 2, cw, chh, null, { lw: 4, dash: [12, 10], off: -lt * 20, al: seg(lt, 1.1, 1.4) });
    // 两个 diff 小窗
    const vm = S01_VM.map(l => ({ ...l })), cfg = S01_CFG.map(l => ({ ...l }));
    vm[2].hk = eo(seg(lt, 3.7, 4.0)); vm[2].p = seg(lt, 4.0, 5.4); vm[3].hk = eo(seg(lt, 3.8, 4.1)); vm[3].p = seg(lt, 5.4, 6.8);
    cfg[1].hk = eo(seg(lt, 7.4, 7.7)); cfg[1].p = seg(lt, 7.7, 8.9); cfg[2].hk = eo(seg(lt, 7.5, 7.8)); cfg[2].p = seg(lt, 8.9, 10.4);
    const wa = seg(lt, 3.5, 3.9), wb = seg(lt, 7.2, 7.6);
    if (wa > 0) at(g, 450, 265, .9 + .1 * pop(wa), () => ide(g, -380, -125, 760, 250, vm, { title: 'PanelViewModel.kt', tag: '示意', s: 24, lh: 42, lt }), { al: Math.min(wa * 4, 1) * dim });
    if (wb > 0) at(g, 1470, 265, .9 + .1 * pop(wb), () => ide(g, -380, -125, 760, 250, cfg, { title: 'cardmapper.json', tag: '示意', s: 24, lh: 42, lt }), { al: Math.min(wb * 4, 1) * dim });
    // 导线：两处都写完才连上新卡
    const wp = eo(seg(lt, 11.0, 11.8)), wal = 1 - seg(lt, 13.3, 13.7);
    if (wp > 0 && wal > 0) {
      path(g, partial([[450, 398], [450, 430], [870, 430]], wp), { c: C.red, w: 8, al: wal });
      path(g, partial([[1470, 398], [1470, 430], [1050, 430]], wp), { c: C.red, w: 8, al: wal });
    }
    if (lt < 15.1) tagB(g, '两处共同决定', 960, 322, C.ink, seg(lt, 11.3, 11.7), { fs: 26, rot: -.02, al: 1 - seg(lt, 14.6, 15.0) });
    // 悬空的新卡（温控）：两边都改完才落进空格
    const hover = lt < 13.2, hyA = scy - chh - 30 * s;
    let hy = lerp(hyA, 430, k) + (hover ? wob(lt, .7, 6) : 0);
    if (!hover) hy = lerp(430, scy, eio(drop));
    const [, sxx] = landing(lt, 13.55, .001, 0);
    at(g, 960, hy, 1, () => bcard(g, -cw / 2, -chh / 2, cw, chh, { kind: 'thermo', acc: C.yellow, lt, sh: hover ? 14 : 6 }), { rot: hover ? wob(lt, .5, .04) : 0, sx: sxx, sy: 1 / sxx, al: seg(lt, 1.0, 1.3) });
    if (lt > 13.55) { ripple(g, 960, scy, lt - 13.55, cw, chh, 26, .55); burst(g, 960, scy, lt - 13.55, 12, 200); }
    // 问号：能不能不碰旧代码
    if (lt > 14.7) badge(g, 960, 255, 66, C.yellow, '?', seg(lt, 14.8, 15.2), { rot: wob(lt, .6, .1) });
  },
});

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
/* s03 看板与卡片记录：看板放大填满 → 翻出一条记录 → 记录经过五道工位变回活卡片 */
const REC = [['type', '卡片类型', C.red], ['subjects', '数据主体', C.blue], ['uiStyle', '样式', C.yellow], ['traitList', '状态值', C.white]];
const STATIONS3 = [['解析', 'circle'], ['建对象', 'sq'], ['渲染', 'tri'], ['点击下发', 'half'], ['上报刷新', 'quarter']];
/* 一块记录积木（traitList 画成黑白格） */
function recBlock(g, x, y, w, h, r, o = {}) {
  const [name, , col] = r;
  if (col === C.white) {
    box(g, x, y, w, h, C.white, { sh: o.sh ?? 7 });
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    const q = h / 4; for (let i = 0; i * q < w; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) { g.fillStyle = C.ink; g.fillRect(x + i * q, y + j * q, q, q); }
    g.restore(); box(g, x, y, w, h, null, { lw: 4 });
    const tw = textW(g, name, { f: 'mono', s: o.fs || 30, w: 700 }) + 24; box(g, x + w / 2 - tw / 2, y + h / 2 - 22, tw, 44, C.white, { sh: 0, lw: 3 });
    text(g, name, x + w / 2, y + h / 2 + 1, { f: 'mono', s: o.fs || 30, w: 700 });
  } else { box(g, x, y, w, h, col, { sh: o.sh ?? 7 }); text(g, name, x + w / 2, y + h / 2 + 1, { f: 'mono', s: o.fs || 30, w: 700, c: onCol(col) }); }
}
function stationIcon(g, kind, x, y, s, col) {
  if (kind === 'circle') disc(g, x, y, 30 * s, col, { sh: 0, lw: 3 });
  else if (kind === 'sq') box(g, x - 28 * s, y - 28 * s, 56 * s, 56 * s, col, { sh: 0, lw: 3 });
  else if (kind === 'tri') tri(g, x, y + 4 * s, 64 * s, col, { sh: 0, lw: 3 });
  else if (kind === 'half') half(g, x, y + 14 * s, 34 * s, col, Math.PI, { sh: 0, lw: 3 });
  else quarter(g, x - 22 * s, y + 22 * s, 50 * s, col, -Math.PI / 2, { sh: 0, lw: 3 });
}
const GROUPS3 = [[5.6, [1, 2, 4, 5, 9, 10, 11, 12]], [6.4, [3]], [7.0, [8]], [7.6, [7]], [8.2, [6]]];
S('s03', {
  card: 2,
  cam: [[0, 960, 540, 1], [16, 960, 540, 1]],
  cues: [[0, 'whoosh'], [2.2, 'block'], [2.5, 'block'], [2.8, 'block'], [3.1, 'block'], [3.4, 'block'], [9.4, 'whoosh'], [12.8, 'tick'], [13.3, 'tick'], [13.8, 'tick'], [14.3, 'tick'], [14.8, 'tick'], [15.4, 'success']],
  draw(g, lt) {
    const bal = 1 - eo(seg(lt, 9.2, 9.8));
    const hl = (i) => { let v = 0; for (const [t0, ids] of GROUPS3) if (ids.includes(i)) v = Math.max(v, win(lt, t0, t0 + .9, .2, .35)); return v; };
    if (bal > 0) drawBoard(g, 460, 170, 1.25, lt, { t0: 2.1, st: .13, names: true, slot: true, hl, al: bal });
    // 记录：从灯卡里翻出来的四块积木
    const rp = seg(lt, 9.3, 10.1); if (rp <= 0) return;
    const rdim = 1 - .45 * eo(seg(lt, 12.6, 13.0));
    note(g, '一条卡片记录', 960, 262, { s: 34, w: 900, c: C.ink, al: seg(lt, 9.8, 10.2) * rdim });
    REC.forEach((r, i) => {
      const x = 330 + i * 320, from = [960, 245], to = [x + 150, 385];
      const p = flyPos(lt, 9.3 + i * .12, .6, from, to, 80); if (!p) return;
      at(g, p[0], p[1], .5 + .5 * eo(seg(lt, 9.3 + i * .12, 9.9 + i * .12)), () => recBlock(g, -150, -55, 300, 110, r), { al: rdim });
      note(g, r[1], x + 150, 476, { al: seg(lt, 10.0 + i * .12, 10.3 + i * .12) * rdim });
    });
    // 五道工位：记录（缩成一小摞）挨个经过
    const sp = seg(lt, 12.5, 12.9); if (sp <= 0) return;
    STATIONS3.forEach(([name, kind], i) => {
      const x = 385 + i * 250, on = lt > 12.8 + i * .5;
      at(g, x, 640, pop(seg(lt, 12.5 + i * .06, 12.9 + i * .06)), () => { box(g, -55, -55, 110, 110, on ? C.white : C.paper2, { sh: on ? 7 : 3 }); stationIcon(g, kind, 0, 0, 1, on ? [C.red, C.blue, C.yellow, C.red, C.blue][i] : C.greyL); });
      note(g, name, x, 730, { c: on ? C.ink : C.ink2, al: sp });
      if (i < 4) arrow(g, [[x + 66, 640], [x + 184, 640]], { w: 6, hs: 18, p: eo(seg(lt, 12.7 + i * .1, 13.0 + i * .1)) });
    });
    const tx = kf([[12.8, 385], [13.3, 635], [13.8, 885], [14.3, 1135], [14.8, 1385], [15.3, 1640]], lt);
    if (lt > 12.7 && lt < 15.4) at(g, tx, 560 - Math.abs(Math.sin((lt - 12.8) * Math.PI * 2)) * 24, 1, () => REC.forEach((r, i) => box(g, -36 + i * 18, -20, 18, 40, r[2], { sh: 0, lw: 2.5 })));
    if (lt > 15.2) {
      at(g, 1660, 640, pop(seg(lt, 15.2, 15.6)), () => bcard(g, -95, -75, 190, 150, { kind: 'lamp', acc: C.yellow, name: '灯', lt, on: 1, sh: 8 }));
      burst(g, 1660, 640, lt - 15.3, 12, 170);
    }
  },
});

/* s04 代码墙：if-else 一路滚，每滚过一个分支右边多一张卡；计数到约 500 行 */
const WALL_KINDS = ['LAMP', 'SWITCH', 'AC', 'CURTAIN', 'LOCK', 'CAMERA', 'SCENE', 'MUSIC', 'ALBUM', 'ENERGY', 'SOCKET', 'VALVE', 'HEADER', 'SPEAKER', 'FAN', 'HEATER', 'SENSOR', 'GATEWAY'];
const camel = s => s[0] + s.slice(1).toLowerCase();
const WALL = (() => {
  const out = []; let i = 0;
  while (out.length < 40) {
    const k = WALL_KINDS[i % WALL_KINDS.length], v = i % 3;
    out.push({ t: v === 1 ? `} else if (type == DEVICE && model == ${k}) {` : `} else if (type == ${k}) {` });
    if (v === 2) out.push({ t: `    if (card.subjects.isEmpty()) return null` });
    out.push({ t: `    cards += ${camel(k)}CardUiModel(card, parse(card))` });
    i++;
  }
  return out;
})();
const WALL_INS = 29;
const STACK_KINDS = ['lamp', 'switch', 'ac', 'curtain', 'lock', 'camera', 'scene', 'music', 'album', 'energy', 'socket', 'thermo', 'header', 'lamp', 'ac'];
S('s04', {
  cam: [[0, 960, 540, 1], [14, 960, 540, 1.02]],
  cues: [[.4, 'tick', .5], [1.5, 'tick', .5], [2.6, 'tick', .5], [3.7, 'tick', .5], [4.8, 'tick'], [6.8, 'stamp'], [9.6, 'type'], [11.4, 'error']],
  draw(g, lt) {
    const scroll = -80 * clamp(lt - .4, 0, 8.8), shake = lt > 11.4 ? Math.sin(lt * 70) * 10 * Math.exp(-(lt - 11.4) * 5) : 0;
    const lines = WALL.map(l => ({ ...l }));
    lines.splice(WALL_INS, 0,
      { t: '} else if (type == NEW_CARD) {', k: '+', hk: eo(seg(lt, 9.4, 9.7)), p: seg(lt, 9.7, 10.5) },
      { t: '    cards += NewCardUiModel(card, parse(card))', k: '+', hk: eo(seg(lt, 9.5, 9.8)), p: seg(lt, 10.5, 11.3) });
    at(g, 620 + shake, 495, .92 + .08 * pop(seg(lt, 0, .35)), () => ide(g, -540, -345, 1080, 690, lines, { title: 'PanelViewModel.kt', tag: '示意 · 节选', s: 24, lh: 40, lt, scroll, nums: false }), { al: seg(lt, 0, .2) });
    // 右边：卡片越堆越高
    const n = Math.min(15, Math.floor((lt - .6) / .55) + 1);
    const wobS = lt > 11.4 ? Math.sin((lt - 11.4) * 18) * .05 * Math.exp(-(lt - 11.4) * 3) : 0;
    for (let i = 0; i < 15; i++) {
      const t1 = i < 14 ? .6 + i * .55 : 11.4; if (lt < t1) continue;
      const c = i % 4, r = Math.floor(i / 4), x = 1265 + c * 178, y = 730 - r * 112, [dy, sx] = landing(lt, t1, .35, -120);
      at(g, x, y + dy, 1, () => bcard(g, -80, -48, 160, 96, { kind: STACK_KINDS[i], acc: [C.red, C.yellow, C.blue][(i + r) % 3], lt: lt + i, sh: 5 }), { sx, sy: 1 / sx, rot: wobS * (r + 1) });
    }
    // 计数：约 500 行
    if (lt > 4.6) {
      const v = roll(lt, 4.8, 6.8, 0, 500), sA = pop(seg(lt, 4.6, 4.9)), st = lt > 6.8 ? pop(seg(lt, 6.8, 7.1)) : 0;
      at(g, 1490, 212, sA, () => {
        const s1 = '约 ', s2 = String(v), s3 = ' 行', o = { s: 60, w: 900 }, od = { f: 'disp', s: 72, w: 900 };
        const w1 = textW(g, s1, o), w2 = textW(g, s2, od), w3 = textW(g, s3, o), x0 = -(w1 + w2 + w3) / 2;
        if (st > 0) box(g, x0 + w1 - 8, -38, (w2 + 16) * st, 70, C.yellow, { sh: 0, lw: 0 });
        text(g, s1, x0, 4, { ...o, a: 'left' }); text(g, s2, x0 + w1, 2, { ...od, a: 'left' }); text(g, s3, x0 + w1 + w2, 4, { ...o, a: 'left' });
      });
    }
  },
});

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

/* s06 别处想用，用不了：联动页伸出轨道，撞上看板 ViewModel 的黑框弹回，黑框落锁 */
S('s06', {
  cam: [[0, 960, 520, 1], [12, 960, 520, 1.02]],
  cues: [[.4, 'block'], [4.6, 'whoosh'], [6.7, 'error'], [8.4, 'stamp']],
  draw(g, lt) {
    const pa = pop(seg(lt, .1, .5));
    at(g, 470, 470, .9 + .1 * pa, () => {
      g.translate(-470, -470);
      box(g, 120, 220, 700, 500, C.white, { sh: 10, lw: 10 });
      g.fillStyle = C.ink; g.fillRect(120, 220, 700, 58);
      text(g, '看板 ViewModel', 150, 250, { s: 28, w: 900, c: '#fff', a: 'left' });
      for (let r = 0; r < 11; r++) { // 色块化的代码行（不可读的示意）
        const y = 312 + r * 34, ind = r % 3 === 0 ? 0 : 40, w = 160 + hash(r * 3.3) * 300;
        if (r % 3 === 0) box(g, 160, y - 9, 34, 18, C.red, { sh: 0, lw: 0 });
        box(g, 206 + ind, y - 8, w, 16, C.greyL, { sh: 0, lw: 0 });
        if (r % 2) box(g, 206 + ind + w + 14, y - 8, 60 + hash(r) * 80, 16, rgba(C.blue, .35), { sh: 0, lw: 0 });
      }
    }, { al: seg(lt, .1, .3) });
    // 右边：设备联动页
    const pb = pop(seg(lt, .4, .8));
    at(g, 1500, 440, pb, () => {
      g.translate(-1500, -440);
      screenFrame(g, 1240, 290, 520, 300, lt, { cell: 40 });
      box(g, 1283, 333, 194, 114, null, { lw: 4, dash: [12, 10], off: -lt * 20 });
      box(g, 1523, 333, 194, 234, null, { lw: 4, dash: [12, 10], off: -lt * 20 });
    });
    note(g, '设备联动页', 1500, 232, { s: 30, w: 900, c: C.ink, al: seg(lt, .6, .9) });
    // 轨道：伸过去 → 撞框 → 弹回
    if (lt > 4.4) {
      const re = lt < 6.6 ? kf([[4.4, 1214], [6.6, 840]], lt) : 840 + 70 * spring(lt - 6.6, 5, 1.2);
      path(g, [[1214, 440], [re, 440]], { w: 12 });
      box(g, re - 20, 420, 40, 40, C.yellow, { sh: 5 });
    }
    if (lt > 6.6) at(g, 838, 372, pop(seg(lt, 6.6, 6.9)), () => icCross(g, 0, 0, 56, C.red, 1, 12), { rot: .1 });
    // 落锁 + 标签
    if (lt > 8.1) { const [dy, sx] = landing(lt, 8.1, .35, -260); at(g, 470, 200 + dy, 1.3, () => icon(g, 'lock', 0, 0, 1, lt), { sx, sy: 1 / sx }); }
    tagB(g, '不便复用', 1030, 540, C.red, seg(lt, 8.6, 9.0), { fs: 30, rot: -.04 });
  },
});

/* s07 两件事缠在一起：抖开成黄（长什么样）蓝（怎么造）两堆，中间的线剪断 */
const S07A = ['卡片类型', '设备类型', '尺寸'], S07B = ['解析数据', 'new UiModel', '加进列表'];
const S07L = [[0, 1], [1, 0], [2, 2], [0, 2], [1, 1], [2, 0]];
function s07Pos(lt, side, i) {
  const h = side ? 11 : 3, p0 = [960 + (hash(i * 3.1 + h) - .5) * 300, 470 + (hash(i * 5.7 + h) - .5) * 220], p1 = [side ? 1360 : 560, 432 + i * 90];
  const k = eio(seg(lt, 1.2 + i * .08 + side * .05, 2.2 + i * .08 + side * .05)), sh = lt > .4 && lt < 1.3 ? wob(lt, 7, 7, i + side) : 0;
  return [lerp(p0[0], p1[0], k) + sh, lerp(p0[1], p1[1], k), (1 - k) * (hash(i * 2.3 + h) - .5) * .7];
}
function s07Block(g, s, x, y, rot, col, lift, mono) {
  at(g, x, y - lift * 8, 1, () => { box(g, -130, -33, 260, 66, col, { sh: 7 + lift * 5 }); text(g, s, 0, 2, { f: mono ? 'mono' : 'cjk', s: 28, w: mono ? 700 : 900, c: onCol(col) }); }, { rot });
}
S('s07', {
  cam: [[0, 960, 500, 1], [12, 960, 500, 1]],
  cues: [[.6, 'whoosh'], [1.3, 'block'], [1.6, 'block'], [1.9, 'block'], [2.2, 'block'], [4.2, 'snap'], [8.2, 'snap'], [10.6, 'stamp']],
  draw(g, lt) {
    const app = seg(lt, 0, .3), cut = seg(lt, 10.6, 11.2);
    // 缠在一起的线：贝塞尔采样成折线，剪断后两半各自缩回
    S07L.forEach(([a, b], n) => {
      const A = s07Pos(lt, 0, a), B = s07Pos(lt, 1, b), m = [(A[0] + B[0]) / 2 + (hash(n * 4.4) - .5) * 160, (A[1] + B[1]) / 2 + (hash(n * 7.1) - .5) * 320];
      const pts = []; for (let i = 0; i <= 16; i++) pts.push(bez([A[0], A[1]], m, [B[0], B[1]], i / 16));
      if (cut <= 0) path(g, pts, { w: 4, al: app });
      else {
        const half1 = pts.slice(0, 9), half2 = pts.slice(8).reverse(), q = 1 - eo(cut);
        if (q > 0) { path(g, partial(half1, q), { w: 4 }); path(g, partial(half2, q), { w: 4 }); }
        burst(g, pts[8][0], pts[8][1], lt - 10.6, 8, 90);
      }
    });
    const la = win(lt, 4.2, 12.5, .3, .1), lb = win(lt, 8.2, 12.5, .3, .1);
    S07A.forEach((s, i) => { const p = s07Pos(lt, 0, i); s07Block(g, s, p[0], p[1], p[2], C.yellow, la, false); });
    S07B.forEach((s, i) => { const p = s07Pos(lt, 1, i); s07Block(g, s, p[0], p[1], p[2], C.blue, lb, i === 1); });
    tagB(g, '有哪些卡、长什么样', 560, 312, C.ink, seg(lt, 4.2, 4.6), { fs: 30, rot: -.03 });
    tagB(g, '怎么把卡造出来', 1360, 312, C.ink, seg(lt, 8.2, 8.6), { fs: 30, rot: .03 });
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

/* s09 工厂只管实例化：一座厂房冲压出卡 → 缩进注册表抽屉墙 → 配置里的类名点亮一个抽屉 */
const DRAWER = { x: 1120, y: 230, c: 6, r: 5, w: 110, h: 100 }, DR_EMPTY = [9, 17, 22, 28], DR_LAMP = 7, DR_AC = 16;
const drawerXY = i => [DRAWER.x + (i % DRAWER.c) * DRAWER.w + DRAWER.w / 2, DRAWER.y + Math.floor(i / DRAWER.c) * DRAWER.h + DRAWER.h / 2];
S('s09', {
  cam: [[0, 960, 540, 1], [14, 960, 540, 1.02]],
  cues: [[1.0, 'stamp'], [2.2, 'stamp'], [3.4, 'stamp'], [4.9, 'block'], [5.3, 'block'], [5.7, 'block'], [5.9, 'snap'], [9.6, 'whoosh'], [10.8, 'snap'], [11.6, 'success']],
  draw(g, lt) {
    // 抽屉墙（4.6 起）
    const wallP = seg(lt, 4.7, 6.0);
    if (wallP > 0) {
      note(g, '工厂注册表', 1450, 192, { s: 30, w: 900, c: C.ink, al: wallP });
      for (let i = 0; i < 30; i++) {
        const k = clamp(wallP * 34 - i * .9 - hash(i * 3.7) * 2); if (k <= 0) continue;
        const [cx, cy] = drawerXY(i), empty = DR_EMPTY.includes(i), lit = i === DR_AC ? win(lt, 10.7, 12.2, .15, .5) : 0;
        at(g, cx, cy, pop(k), () => {
          box(g, -50, -44, 100, 88, empty ? null : lit ? C.yellow : C.white, { sh: empty ? 0 : 4, lw: 3, dash: empty ? [8, 8] : null });
          if (!empty && i !== DR_LAMP && !(i === DR_AC && lt > 11.0)) factory(g, 0, 26, .32, [C.red, C.blue, C.yellow, C.ink][i % 4], lt, { seed: hash(i) });
          if (!empty) box(g, -14, 34, 28, 6, C.ink, { sh: 0, lw: 0 });
        });
      }
      chipM(g, '二十多个工厂', 1450, 782, { f: 'cjk', col: C.yellow, p: seg(lt, 6.0, 6.4) });
    }
    // 大厂房：冲压出灯卡；5.0 起缩进灯卡的抽屉
    const mv = eio(seg(lt, 5.0, 6.0)), [dx, dy] = drawerXY(DR_LAMP);
    const fx = lerp(560, dx, mv), fy = lerp(660, dy + 26, mv), fs = lerp(1.7, .32, mv);
    let squash = 1; for (const t0 of [1.0, 2.2, 3.4]) if (lt > t0 && lt < t0 + .3) squash = 1 - Math.sin((lt - t0) / .3 * Math.PI) * .08;
    at(g, fx, fy, 1, () => factory(g, 0, 0, fs, C.yellow, lt, { roof: C.red, busy: lt < 4.6 }), { sy: squash, sx: 2 - squash });
    if (mv < .3) note(g, 'LampCardFactory', 560, 714, { s: 26, c: C.ink, al: 1 - mv * 3 });
    for (let j = 0; j < 3; j++) { // 进料与出卡
      const t = .4 + j * 1.2, rp = seg(lt, t, t + .6), al = 1 - seg(lt, 4.4, 4.8);
      if (rp > 0 && rp < 1) at(g, lerp(150, 430, rp), 600, 1, () => REC.forEach((r, i) => box(g, -36 + i * 18, -20, 18, 40, r[2], { sh: 0, lw: 2.5 })));
      const p = flyPos(lt, t + .6, .55, [700, 600], [880 + j * 160, 470], 90);
      if (p && al > 0) at(g, p[0], p[1], 1, () => bcard(g, -70, -52, 140, 104, { kind: 'lamp', acc: C.yellow, lt: lt + j, sh: 6 }), { al });
    }
    if (lt < 4.8) path(g, [[110, 640], [440, 640]], { w: 6, dash: [16, 12], off: -lt * 40, al: 1 - seg(lt, 4.4, 4.8) });
    // 配置里的类名 → 抽屉
    const jp = seg(lt, 8.9, 9.3);
    if (jp > 0) {
      const lines = [{ t: '  "span": "MIDDLE_6x2",' }, { t: '  "factory": "AcCardFactory" }', hl: C.yellow, hlA: win(lt, 9.3, 14, .2, .1) * 1.5 }];
      at(g, 450, 380, .9 + .1 * pop(jp), () => ide(g, -360, -85, 720, 170, lines, { title: 'cardmapper.json', tag: '示意', s: 24, lh: 44, lt, n0: 5 }), { al: Math.min(1, jp * 3) });
      const from = [codeX(g, lines[1].t, 13, 90, { s: 24 }) + 110, 437], to = drawerXY(DR_AC), p = flyPos(lt, 9.6, 1.0, from, to, 180);
      if (p && lt < 10.9) chipM(g, '"AcCardFactory"', p[0], p[1], { fs: 24, tc: C.ochre, rot: (1 - seg(lt, 9.6, 10.6)) * -.3 });
      note(g, '依赖注入，构造时收齐 · 不用反射', 450, 520, { al: seg(lt, 10.0, 10.4) });
    }
    if (lt > 11.0) { // 抽屉推出空调厂房
      const k = eio(seg(lt, 11.0, 11.8)), [ax, ay] = drawerXY(DR_AC);
      factory(g, lerp(ax, 820, k), lerp(ay + 26, 760, k), lerp(.32, 1.0, k), C.blue, lt, { label: k > .9 ? 'AcCardFactory' : null, busy: true });
      if (lt > 11.8) burst(g, 820, 690, lt - 11.8, 10, 150);
    }
  },
});

/* s10 同一个工厂，两种尺寸：空调卡 6×2 ↔ 5×4 变形，厂房不动，只换样式字符串 */
const bigK10 = lt => eo(seg(lt, 4.2, 4.7)) - eo(seg(lt, 6.4, 6.9)) + eo(seg(lt, 10.4, 10.9));
/* 空调卡：bk=0 中卡（6×2），1 大卡（5×4）；cell 为格子边长 */
function acCard(g, cx, cy, cell, bk, lt, o = {}) {
  const w = lerp(6, 5, bk) * cell, h = lerp(2, 4, bk) * cell, x = cx - w / 2, y = cy - h / 2, s = cell / 70;
  box(g, x, y, w, h, C.white, { sh: o.sh ?? 8 });
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); box(g, x, y, w, 16 * s, C.blue, { sh: 0, lw: 0 }); g.restore();
  path(g, [[x, y + 16 * s], [x + w, y + 16 * s]], { w: 3 });
  icon(g, 'ac', x + lerp(64, 70, bk) * s, y + lerp(h / 2 + 8 * s, 84 * s, bk), lerp(.8, .9, bk) * s, lt);
  if (s >= .9) text(g, '空调', x + lerp(150, 140, bk) * s, y + lerp(h / 2 - 14 * s, 70 * s, bk), { s: 30 * s, w: 900, a: 'left' });
  if (s >= .9) text(g, '26°', x + lerp(150, 140, bk) * s, y + lerp(h / 2 + 28 * s, 112 * s, bk), { f: 'disp', s: 40 * s, w: 900, c: C.blue, a: 'left' });
  icon(g, 'switch', x + w - 66 * s, y + lerp(h / 2 + 8 * s, 84 * s, bk), .8 * s, lt, { on: 1 });
  if (bk > .05) { // 大卡多出来的：风速三角、模式方块
    g.save(); g.globalAlpha *= bk;
    for (let i = 0; i < 3; i++) tri(g, x + (60 + i * 50) * s, y + h - 70 * s, 34 * s, i <= Math.floor(lt * 1.5) % 3 ? C.yellow : C.greyL, { dir: 1, sh: 0, lw: 3 });
    for (let i = 0; i < 3; i++) box(g, x + w - (150 - i * 44) * s, y + h - 88 * s, 34 * s, 34 * s, [C.red, C.blue, C.yellow][i], { sh: 0, lw: 3 });
    g.restore();
  }
  if (o.tag !== false && s >= .9) text(g, bk > .5 ? '5×4' : '6×2', x + w - 14, y + h - 22, { f: 'disp', s: 26, w: 900, a: 'right', c: C.ink2 });
}
S('s10', {
  cam: [[0, 960, 520, 1], [12, 980, 520, 1.03]],
  cues: [[4.2, 'whoosh'], [4.5, 'block'], [6.4, 'whoosh'], [8.4, 'tick'], [10.4, 'whoosh'], [10.7, 'block']],
  draw(g, lt) {
    const bk = bigK10(lt), changing = Math.abs(bk - Math.round(bk)) > .01;
    // 网格底
    g.save(); g.globalAlpha *= .5 * seg(lt, 0, .4);
    for (let i = 0; i <= 8; i++) path(g, [[780 + i * 70, 330], [780 + i * 70, 610]], { w: 1.5, c: C.line });
    for (let j = 0; j <= 4; j++) path(g, [[780, 330 + j * 70], [1340, 330 + j * 70]], { w: 1.5, c: C.line });
    g.restore();
    factory(g, 330, 560, 1.3 * pop(seg(lt, 0, .4)), C.blue, lt, { label: 'AcCardFactory', busy: changing });
    path(g, [[450, 470], [1060 - lerp(210, 175, bk) - 12, 470]], { w: 6, dash: [14, 10], off: -lt * 30 });
    at(g, 1060, 470, pop(seg(lt, .2, .6)), () => acCard(g, 0, 0, 70, bk, lt));
    // 样式字符串翻牌
    const big = bk > .5, fl = Math.min(1, Math.abs(bk - .5) * 2), hlS = win(lt, 8.2, 10.4, .2, .3);
    at(g, 1060, 720, 1, () => {
      const s = big ? 'ac_big' : 'ac_middle', w = textW(g, s, { f: 'mono', s: 32, w: 700 }) + 40;
      if (hlS > 0) box(g, -w / 2 - 10, -36, (w + 20) * hlS, 72, C.yellow, { sh: 0, lw: 0 });
      box(g, -w / 2, -28, w, 56, C.white, { sh: 5, lw: 3 }); text(g, s, 0, 2, { f: 'mono', s: 32, w: 700, c: C.ochre });
    }, { sy: Math.max(.05, fl), al: seg(lt, .4, .7) });
    note(g, 'uiStyle', 1060, 790, { al: seg(lt, .5, .8) });
  },
});

/* s11 新卡片没有样式：灯的能力积木流进推断漏斗 → 吐出大卡；不认识的走默认工厂 */
function capBlock(g, kind, x, y, s = 1) {
  if (kind === 0) tri(g, x, y, 70 * s, C.yellow, { sh: 5 });
  else if (kind === 1) { half(g, x, y + 6 * s, 36 * s, C.yellow, Math.PI, { sh: 5 }); half(g, x, y + 6 * s, 36 * s, C.blue, 0, { sh: 0 }); }
  else [C.red, C.blue, C.yellow].forEach((c, i) => box(g, x - 36 * s + i * 24 * s, y - 12 * s, 22 * s, 22 * s, c, { sh: 0, lw: 3 }));
}
const CAP11 = [['亮度', 260], ['色温', 420], ['RGB', 580]];
S('s11', {
  cam: [[0, 960, 520, 1], [14, 960, 520, 1]],
  cues: [[1.0, 'error'], [4.8, 'block'], [5.4, 'block'], [6.0, 'block'], [7.2, 'stamp'], [9.6, 'success'], [11.8, 'tick'], [12.6, 'block']],
  draw(g, lt) {
    // 新灯卡：灰色虚线轮廓 + 空的样式栏
    const na = pop(seg(lt, .1, .5)), done = seg(lt, 9.4, 9.8);
    at(g, 420, 380, na, () => { box(g, -130, -90, 260, 180, C.white, { sh: 5, dash: [14, 10], al: 1 - done * .6 }); icon(g, 'lamp', -50, 0, .9, lt, { on: 0 }); });
    chipM(g, 'uiStyle: ?', 420, 520, { p: seg(lt, .3, .7), tc: C.ink2, al: 1 - done * .6 });
    if (lt < 9.6) badge(g, 560, 290, 34, C.yellow, '?', seg(lt, .8, 1.1), { rot: wob(lt, .8, .12) });
    // 漏斗：按能力推断
    const fu = pop(seg(lt, 4.4, 4.8)), sq = lt > 7.2 && lt < 7.5 ? 1 - Math.sin((lt - 7.2) / .3 * Math.PI) * .1 : 1;
    at(g, 960, 470, fu, () => {
      solid(g, () => { g.beginPath(); g.moveTo(-170, -140); g.lineTo(170, -140); g.lineTo(50, 90); g.lineTo(-50, 90); g.closePath(); }, C.white, { sh: 8 });
      box(g, -36, 90, 72, 60, C.ink, { sh: 0, lw: 0 });
      text(g, '按能力推断', 0, -60, { s: 30, w: 900 });
      const lamp = lt > 12.4 && lt < 13.4 ? C.grey : lt > 7.2 && lt < 9.6 ? C.yellow : C.white;
      disc(g, 0, 20, 18, lamp, { sh: 0, lw: 3 });
    }, { sy: sq, sx: 2 - sq });
    // 灯的三块能力积木
    CAP11.forEach(([name, x], i) => {
      const t0 = 4.8 + i * .6, p = flyPos(lt, t0, .6, [x, 700], [960, 330], 160);
      const gone = lt > t0 + .6, al = seg(lt, 2.4 + i * .2, 2.8 + i * .2);
      if (!gone) { const q = p || [x, 700]; at(g, q[0], q[1], p ? 1 - .4 * seg(lt, t0, t0 + .6) : 1, () => capBlock(g, i, 0, 0), { al }); }
      note(g, name, x, 770, { al: al * (1 - seg(lt, 4.8 + i * .6, 5.4 + i * .6)) });
    });
    // 吐出大卡
    if (lt > 9.4) {
      const p = flyPos(lt, 9.4, .5, [960, 620], [1450, 420], 120);
      at(g, p[0], p[1], .5 + .5 * eo(seg(lt, 9.4, 9.9)), () => bcard(g, -180, -130, 360, 260, { kind: 'lamp', acc: C.yellow, name: '灯', lt, on: 1, sh: 9 }));
      tagB(g, '大卡', 1650, 270, C.yellow, seg(lt, 9.9, 10.3), { fs: 30, rot: .05 });
      burst(g, 1450, 420, lt - 9.9, 12, 200);
    }
    // 旁路：不认识的卡 → 默认工厂
    if (lt > 11.6) {
      const p1 = flyPos(lt, 11.8, .6, [700, 250], [960, 330], 100), p2 = flyPos(lt, 12.6, .7, [960, 620], [1450, 700], 80);
      if (p1 && !p2) at(g, p1[0], p1[1], .8, () => bcard(g, -60, -42, 120, 84, { kind: 'none', sh: 4, fill: C.greyL }), { al: 1 - seg(lt, 12.3, 12.4) });
      if (p2) at(g, p2[0], p2[1], .7, () => bcard(g, -60, -42, 120, 84, { kind: 'none', sh: 4, fill: C.greyL }), { al: 1 - seg(lt, 13.2, 13.4) });
      factory(g, 1450, 790, .7 * pop(seg(lt, 11.6, 12.0)), C.greyL, lt, { roof: C.grey, busy: lt > 13.2 });
      note(g, '推断不中 → 默认工厂兜底', 1450, 842, { al: seg(lt, 12.0, 12.4) });
    }
  },
});

/* s12 如果不这样：左“以前”样式缠在创建分支里；右“现在”只改一个字符串；设想中的下发配置 */
S('s12', {
  cam: [[0, 960, 520, 1], [12, 960, 520, 1]],
  cues: [[.6, 'type'], [4.4, 'tick'], [6.0, 'success'], [8.6, 'whoosh'], [9.6, 'block']],
  draw(g, lt) {
    tagB(g, '以前', 480, 205, C.ink, seg(lt, .1, .4), { fs: 30 });
    tagB(g, '现在', 1260, 205, C.blue, seg(lt, .2, .5), { fs: 30 });
    const L = [
      { t: '} else if (type == AC) {' },
      { t: '    val span = if (isBig) LARGE else MIDDLE', hl: C.red, hlA: win(lt, 1.0, 12, .3, .1) * 1.4 },
      { t: '    cards += AcCardUiModel(card, span)', hl: C.red, hlA: win(lt, 1.4, 12, .3, .1) * 1.4 },
      { t: '}' },
    ];
    at(g, 480, 445, .9 + .1 * pop(seg(lt, .2, .6)), () => ide(g, -400, -135, 800, 270, L, { title: 'PanelViewModel.kt', tag: '示意', s: 24, lh: 46, lt }), { al: seg(lt, .2, .4) });
    tagB(g, '样式和创建缠在一起', 480, 650, C.red, seg(lt, 1.6, 2.0), { fs: 26, rot: -.03 });
    // 右：只改一个字符串（4.4 改成 ac_big；9.6 下发的配置再改回 ac_middle）
    const e1 = seg(lt, 4.4, 5.0), e2 = seg(lt, 9.6, 10.2);
    let val = 'ac_middle';
    if (lt >= 4.4 && lt < 9.6) val = e1 < .5 ? 'ac_middle'.slice(0, Math.round(9 * (1 - e1 * 2))) : 'ac_big'.slice(0, Math.round(6 * (e1 * 2 - 1)));
    if (lt >= 9.6) val = e2 < .5 ? 'ac_big'.slice(0, Math.round(6 * (1 - e2 * 2))) : 'ac_middle'.slice(0, Math.round(9 * (e2 * 2 - 1)));
    const R = [{ t: '{ "deviceTypes": ["AC"],' }, { t: `  "uiStyle": "${val}" }`, hl: C.yellow, hlA: win(lt, 4.2, 12, .2, .1) * 1.5 }];
    at(g, 1440, 400, .9 + .1 * pop(seg(lt, .3, .7)), () => ide(g, -400, -100, 800, 200, R, { title: 'cardmapper.json', tag: '示意', s: 26, lh: 48, lt }), { al: seg(lt, .3, .5) });
    chipM(g, 'PanelViewModel.kt：不动', 1440, 552, { f: 'cjk', fs: 24, col: C.greyL, p: seg(lt, 5.4, 5.8) });
    const bk = eo(seg(lt, 5.0, 5.5)) - eo(seg(lt, 10.2, 10.7));
    at(g, 1440, 706, pop(seg(lt, .5, .9)), () => acCard(g, 0, 0, 46, bk, lt, { sh: 6 }));
    // 设想：云里下发配置
    if (lt > 8.4) {
      const cp = pop(seg(lt, 8.4, 8.8));
      at(g, 1720, 185, cp, () => { disc(g, -40, 10, 34, C.white, { sh: 5 }); disc(g, 10, -8, 46, C.white, { sh: 5 }); disc(g, 56, 12, 30, C.white, { sh: 5 }); box(g, -74, 10, 160, 34, C.white, { sh: 0, lw: 0 }); path(g, [[-74, 44], [86, 44]], { w: 4 }); });
      chipM(g, '设想 · 未落地', 1490, 250, { f: 'cjk', fs: 24, col: C.white, dash: [8, 6], p: seg(lt, 8.7, 9.1) });
      const p = flyPos(lt, 8.9, .7, [1720, 230], [1700, 448], 20);
      if (p && lt < 9.7) at(g, p[0], p[1], .8, () => box(g, -30, -22, 60, 44, C.yellow, { sh: 4 }));
    }
  },
});

/* =====================================================================
 * 第三章：能不能建，谁说了算
 * ===================================================================== */
/* s13 每张卡吃的数据不一样：三座厂房、三种进料；接口尖括号里换形状 */
const FEED13 = [['摄像头组卡', 420, 4], ['单设备卡', 960, 1], ['场景卡', 1500, 0]];
function subjShape(g, n, x, y, s = 1) {
  if (n === 0) box(g, x - 24 * s, y - 24 * s, 48 * s, 48 * s, null, { lw: 4, dash: [8, 6] });
  else for (let i = 0; i < n; i++) box(g, x - (n * 30 * s) / 2 + i * 30 * s + 2, y - 13 * s, 26 * s, 26 * s, C.blue, { sh: 0, lw: 3 });
}
S('s13', {
  card: 4,
  cam: [[0, 960, 520, 1], [14, 960, 520, 1]],
  cues: [[0, 'whoosh'], [2.4, 'block'], [3.2, 'block'], [4.0, 'block'], [9.8, 'snap'], [10.6, 'tick'], [11.6, 'tick'], [12.6, 'tick']],
  draw(g, lt) {
    const cyc = lt < 10.6 ? -1 : Math.min(2, Math.floor((lt - 10.6) / 1.0));
    FEED13.forEach(([name, x, n], i) => {
      const on = cyc === i ? 1 : 0;
      factory(g, x, 740, 1.05 * pop(seg(lt, 1.4 + i * .1, 1.8 + i * .1)), [C.red, C.blue, C.yellow][i], lt, { busy: on });
      note(g, name, x, 792, { s: 28, w: 900, c: C.ink, al: seg(lt, 1.8, 2.1) });
      // 进料托盘
      at(g, x, 520, pop(seg(lt, 1.6 + i * .1, 2.0 + i * .1)) * (1 + on * .08), () => {
        path(g, [[-120, -40], [-120, 30], [120, 30], [120, -40]], { w: 8 });
        const t0 = 2.4 + i * .8, [dy] = landing(lt, t0, .35, -200);
        if (lt > t0) g.save(), g.translate(0, dy), (n === 0 ? note(g, '不吃通用数据', 0, -4, { s: 24 }) : subjShape(g, n, 0, 0, 1.4)), g.restore();
      });
      const hl = i === 0 ? win(lt, 5.7, 14, .3, .1) : i === 1 ? win(lt, 7.4, 14, .3, .1) : 0;
      if (hl > 0) tagB(g, i === 0 ? '一组' : '一个', x + 150, 440, C.blue, hl, { fs: 28, rot: .05 });
    });
    // ICardFactory<?>：尖括号里的形状跟着轮换
    const ip = seg(lt, 9.6, 10.0);
    if (ip > 0) at(g, 960, 250, pop(ip), () => {
      const L = 'ICardFactory<', R = '>', o = { f: 'mono', s: 52, w: 700 }, wl = textW(g, L, o), wr = textW(g, R, o), mid = 150, x0 = -(wl + mid + wr) / 2;
      box(g, x0 - 30, -50, wl + mid + wr + 60, 100, C.white, { sh: 7 });
      text(g, L, x0, 2, { ...o, a: 'left', c: C.blue }); text(g, R, x0 + wl + mid, 2, { ...o, a: 'left', c: C.blue });
      const n = cyc < 0 ? null : FEED13[cyc][2];
      if (n == null) text(g, 'S', x0 + wl + mid / 2, 2, { ...o, c: C.ochre });
      else at(g, x0 + wl + mid / 2, 0, pop(seg((lt - 10.6) % 1, 0, .3)), () => subjShape(g, n, 0, 0, 1.2));
    });
  },
});

/* s14 两个方法：provideSubject 可空（拿不到就不建）/ produce 不可空（只管造） */
const S14 = [
  'interface ICardFactory<S> {',
  '    fun provideSubject(card: PanelCard): S?',
  '    fun produce(card: PanelCard, subject: S): BaseCardUiModel',
  '}',
  'fun <S> ICardFactory<S>.doProduce(card: PanelCard) =',
  '    provideSubject(card)?.let { produce(card, it) }',
];
const W14 = { x: 60, y: 190, w: 1120, h: 380, s: 26, lh: 48 };
const ly14 = i => W14.y + 54 + 18 + i * W14.lh + W14.lh / 2;
function hlBox(g, line, from, len, li, col, k) { // 代码里某一段的描框高亮
  if (k <= 0) return; const x0 = codeX(g, line, from, W14.x, { s: W14.s }), w = charW(W14.s) * len;
  g.save(); g.globalAlpha *= clamp(k); g.lineWidth = 4; g.strokeStyle = col; g.strokeRect(x0 - 6, ly14(li) - 22, w + 12, 44); g.restore();
}
S('s14', {
  cam: [[0, 960, 520, 1], [16, 960, 520, 1]],
  cues: [[.3, 'block'], [.5, 'type'], [4.2, 'tick'], [5.6, 'whoosh', .6], [8.6, 'stamp'], [12.4, 'snap']],
  draw(g, lt) {
    const lines = S14.map((t, i) => ({ t, p: seg(lt, .4 + i * .32, .7 + i * .32) }));
    if (lt > 3.6) { lines[1].hl = C.red; lines[1].hlA = win(lt, 3.8, 16, .2, .1); }
    if (lt > 8) { lines[2].hl = C.blue; lines[2].hlA = win(lt, 8.2, 16, .2, .1); }
    at(g, W14.x + W14.w / 2, W14.y + W14.h / 2, .9 + .1 * pop(seg(lt, 0, .4)), () => ide(g, -W14.w / 2, -W14.h / 2, W14.w, W14.h, lines, { title: 'ICardFactory.kt', tag: '重写的示意', s: W14.s, lh: W14.lh, lt }), { al: seg(lt, 0, .2) });
    hlBox(g, S14[1], S14[1].indexOf('S?'), 2, 1, C.red, seg(lt, 4.0, 4.3));
    hlBox(g, S14[2], S14[2].indexOf('BaseCardUiModel'), 15, 2, C.blue, seg(lt, 8.2, 8.5));
    // 右：厂房 + 卡片
    factory(g, 1530, 760, 1.15 * pop(seg(lt, .6, 1.0)), C.yellow, lt, { roof: C.red, busy: lt > 8.4 && lt < 9.4 });
    if (lt > 4.2 && lt < 7.4) { // 拿不到数据：虚线卡散成碎块
      const k = seg(lt, 5.6, 6.4);
      at(g, 1530, 420, 1, () => box(g, -110, -70, 220, 140, null, { lw: 4, dash: [12, 10], al: (1 - k) * seg(lt, 4.2, 4.5) }));
      burst(g, 1530, 420, lt - 5.6, 12, 160);
      note(g, 'Subject 为空 → 不建', 1530, 300, { al: win(lt, 4.6, 7.4, .3, .3) });
    }
    if (lt > 8.4) { // 一定给出实例
      const p = flyPos(lt, 8.5, .5, [1530, 690], [1530, 420], 60);
      at(g, p[0], p[1], .6 + .4 * eo(seg(lt, 8.5, 9.0)), () => bcard(g, -110, -70, 220, 140, { kind: 'lamp', acc: C.yellow, name: '灯', lt, sh: 8 }));
      note(g, '只管给出实例', 1530, 300, { al: seg(lt, 8.9, 9.2) });
    }
    // 能不能建 ↔ 怎么建
    if (lt > 12) {
      const a = seg(lt, 12.0, 12.4), x1 = codeX(g, S14[1], S14[1].indexOf('S?'), W14.x, { s: W14.s }) + 15, x2 = codeX(g, S14[2], S14[2].indexOf('BaseCardUiModel'), W14.x, { s: W14.s }) + 117;
      arrow(g, [[x1, 632], [x1, W14.y + W14.h + 10]], { w: 6, hs: 20, p: eo(a) }); arrow(g, [[x2, 632], [x2, W14.y + W14.h + 10]], { w: 6, hs: 20, p: eo(a) });
      path(g, [[x1, 632], [x2, 632]], { w: 6, al: a });
      tagB(g, '能不能建 ↔ 怎么建', (x1 + x2) / 2, 676, C.yellow, seg(lt, 12.4, 12.8), { fs: 30 });
    }
  },
});

/* s15 建完，再过三道闸（拦截例子是演示数据） */
const GATES = [[620, 'Descriptor', C.red], [1000, 'DeviceCommonHide', C.yellow], [1380, 'Visibility', C.blue]];
const RUN15 = [ // [出发时间, 图标, 顶条色, 被哪道闸拦下(-1 = 全通过), 小牌]
  [.6, 'lamp', C.yellow, -1], [2.2, 'ac', C.blue, 0, 'endpoint 5'], [3.5, 'switch', C.red, -1], [5.0, 'scene', C.red, 2, '加载失败'], [6.6, 'curtain', C.blue, -1], [8.0, 'lock', C.yellow, -1],
];
const V15 = 300, X15 = 120, TRACK15 = 560;
function run15(lt, r) { // 返回 {x, stopAt(拦下时刻), fall}
  const [t0, , , gi] = r; let x = X15 + (lt - t0) * V15;
  if (gi >= 0) { const xs = GATES[gi][0] - 110, ts = t0 + (xs - X15) / V15; if (x >= xs) return { x: xs, ts, fall: lt - ts - .45 }; }
  return { x, ts: null, fall: -1 };
}
S('s15', {
  demo: true,
  cam: [[0, 960, 520, 1], [14, 960, 520, 1]],
  cues: [[.6, 'block'], [5.0, 'gate'], [6.4, 'error'], [9.2, 'gate'], [9.6, 'error'], [11.0, 'snap'], [12.0, 'snap'], [13.4, 'success']],
  draw(g, lt) {
    path(g, [[80, TRACK15 + 4], [1840, TRACK15 + 4]], { w: 8 });
    path(g, [[80, TRACK15 + 22], [1840, TRACK15 + 22]], { w: 4, dash: [18, 14], off: -lt * 60, c: C.ink2 });
    // 拒收槽
    box(g, 420, 760, 1100, 60, C.paper2, { sh: 0, lw: 4, dash: [12, 10] });
    note(g, '拒收', 470, 790, { s: 24, a: 'left' });
    const states = RUN15.map(r => run15(lt, r));
    GATES.forEach(([gx, name, col], gi) => {
      const pa = pop(seg(lt, .2 + gi * .1, .6 + gi * .1));
      let open = 0; RUN15.forEach((r, i) => { if (r[3] === gi || (r[3] >= 0 && r[3] < gi)) return; const d = states[i].x - (gx - 150); if (d > -40 && d < 240) open = Math.max(open, clamp(Math.min((d + 40) / 60, (240 - d) / 60))); });
      const blocked = RUN15.some((r, i) => r[3] === gi && states[i].ts != null && lt > states[i].ts);
      at(g, gx, TRACK15, pa, () => {
        box(g, -14, -200, 28, 200, C.ink, { sh: 5, lw: 0 });
        disc(g, 0, -214, 20, blocked ? C.red : open > .5 ? C.blue : col, { sh: 0, lw: 3 });
        g.save(); g.translate(14, -120); g.rotate(-open * 1.3); box(g, 0, -10, 150, 20, blocked ? C.red : C.white, { sh: 0, lw: 3 }); g.restore();
      });
      note(g, name, gx, TRACK15 + 60, { s: 24, c: C.ink, al: pa });
    });
    chipM(g, '支持：0 · 1 · 2', 620, 288, { fs: 24, p: seg(lt, 2.4, 2.8) });
    RUN15.forEach((r, i) => {
      const st = states[i]; if (lt < r[0]) return;
      let x = st.x, y = TRACK15 - 60, rot = 0, al = 1;
      if (st.fall > 0) { x += st.fall * 120; y += st.fall * st.fall * 900; rot = st.fall * 2; al = 1 - seg(y, 700, 790); }
      if (x > 1900 || al <= 0) return;
      at(g, x, y, 1, () => { bcard(g, -70, -50, 140, 100, { kind: r[1], acc: r[2], lt: lt + i, sh: 5 }); if (r[4]) chipM(g, r[4], 0, -82, { f: r[4].length > 6 ? 'mono' : 'cjk', fs: 24, col: C.yellow }); }, { rot, al });
      if (st.ts != null && lt > st.ts && lt < st.ts + .6) icCross(g, x, y - 140, 40, C.red, seg(lt, st.ts, st.ts + .2), 9);
      if (r[3] < 0 && x > 1420 && x < 1700) badge(g, x + 80, y - 60, 22, C.blue, 'check', seg(x, 1420, 1460));
    });
    chipM(g, '演示数据', 1760, 200, { f: 'cjk', fs: 24, col: C.greyL, p: seg(lt, .6, 1.0) });
  },
});

/* s16 为什么不塞一个大对象：大箱子挤坏厂房门 → 数据接口下沉，卡片自己去取 */
const F16 = [[1000, '能耗卡', '能耗数据', C.yellow], [1340, '场景卡', '场景库', C.red], [1680, '设备卡', '设备数据', C.blue]];
S('s16', {
  cam: [[0, 960, 520, 1], [8.6, 960, 520, 1], [9.6, 960, 560, 1], [13, 960, 560, 1]],
  cues: [[.8, 'whoosh'], [2.6, 'error'], [4.6, 'stamp'], [9.6, 'snap'], [10.2, 'snap'], [10.8, 'snap']],
  draw(g, lt) {
    const push = eio(seg(lt, .8, 2.4)), away = eio(seg(lt, 7.2, 8.2)), squeeze = push * (1 - away);
    F16.forEach(([x, name, , col], i) => {
      const sx = i === 0 ? 1 - .18 * squeeze : 1;
      at(g, x, 600, 1, () => factory(g, 0, 0, 1.0 * pop(seg(lt, .1 + i * .1, .5 + i * .1)), col, lt, { busy: lt > 9.6 }), { sx, sy: 2 - sx });
      note(g, name, x, 650, { s: 26, c: C.ink, al: seg(lt, .4, .7) });
    });
    // 大箱子
    const bx = lerp(-80, 640, push) - away * 900, by = 520;
    if (away < 1) at(g, bx, by, 1, () => {
      box(g, -230, -160, 460, 320, C.greyL, { sh: 10 });
      text(g, '大 Entity', 0, -70, { s: 44, w: 900 });
      note(g, '能耗 · 场景 · 设备 · …', 0, 10, { s: 28 });
      if (lt > 4.5) icCross(g, 0, 40, 200, C.red, seg(lt, 4.5, 4.9), 26);
    }, { rot: away * -.3 + (lt > 2.4 && lt < 2.8 ? Math.sin(lt * 60) * .02 : 0) });
    // 底层：数据接口下沉
    const bp = seg(lt, 8.7, 9.2);
    if (bp > 0) {
      box(g, 760, 790, 1100 * eo(bp), 64, C.ink, { sh: 6, lw: 0 });
      text(g, '底层模块 · 数据接口', 800, 823, { s: 26, w: 900, c: '#fff', a: 'left', al: seg(lt, 9.0, 9.3) });
      F16.forEach(([x, , src], i) => {
        const p = eo(seg(lt, 9.4 + i * .6, 9.8 + i * .6)); if (p <= 0) return;
        path(g, [[x + 70, 600], [x + 70, lerp(600, 786, p)]], { w: 6 });
        box(g, x + 56, 770, 28, 20, [C.yellow, C.red, C.blue][i], { sh: 0, lw: 3, al: p });
        note(g, src, x + 84, 708, { s: 24, a: 'left', al: p });
      });
    }
    tagB(g, '工厂入参只剩：卡片记录 + 离线刷新逻辑', 960, 220, C.white, seg(lt, 11.2, 11.6), { fs: 26 });
  },
});

/* s17 一条链，六道工序：三条记录并行走过工厂管理器 */
const ST17 = [['根节点拦截', 'sq', C.ink], ['找样式', 'circle', C.yellow], ['解析尺寸', 'quarter', C.blue], ['取工厂', 'tri', C.red], ['造卡', 'sq', C.yellow], ['过滤', 'half', C.blue]];
const SX17 = i => 330 + i * 250, TR17 = [470, 570, 670];
function rec17(g, x, y, s = 1) { REC.forEach((r, i) => box(g, x - 36 * s + i * 18 * s, y - 22 * s, 18 * s, 44 * s, r[2], { sh: 0, lw: 2.5 })); }
S('s17', {
  cam: [[0, 960, 520, 1], [15, 960, 520, 1]],
  cues: [[.4, 'block'], [.7, 'block'], [1.0, 'block'], [1.3, 'block'], [1.6, 'block'], [1.9, 'block'], [4.0, 'tick'], [8.4, 'error'], [11.6, 'whoosh'], [14.2, 'success']],
  draw(g, lt) {
    chipM(g, 'ICardFactoryManager.produceCard(卡片记录)', 960, 186, { fs: 28, p: seg(lt, 0, .4) });
    TR17.forEach(y => path(g, [[180, y], [1840, y]], { w: 4, dash: [14, 12], off: -lt * 40, c: C.ink2, al: seg(lt, .2, .5) }));
    const lit = (i, x) => x != null && Math.abs(x - SX17(i)) < 70;
    // 记录的位置
    const solo = lt > 3.9 && lt < 7.8 ? kf([[3.9, 180], [7.6, 1800]], lt) : null;
    const fail = lt > 7.6 && lt < 11.2 ? Math.min(kf([[7.6, 180], [8.6, SX17(3) - 20]], lt), SX17(3) - 20) : null;
    const par = lt > 11.4 ? kf([[11.4, 180], [14.2, 1800]], lt) : null;
    ST17.forEach(([name, kind, col], i) => {
      const x = SX17(i), [dy, sx] = landing(lt, .4 + i * .3, .4, -220), on = lit(i, solo) || lit(i, par) || (i === 3 && fail != null && lt > 8.4);
      if (lt < .4 + i * .3) return;
      at(g, x, 420 + dy, 1, () => {
        box(g, -55, 0, 110, 300, null, { lw: 5 });
        box(g, -55, -10, 110, 20, col, { sh: 0, lw: 4 });
        at(g, 0, -64, 1, () => { box(g, -38, -38, 76, 76, on ? C.white : C.paper2, { sh: on ? 6 : 2, lw: 4 }); stationIcon(g, kind, 0, 0, .8, on ? (col === C.ink ? C.ink : col) : C.greyL); });
      }, { sx, sy: 1 / sx });
      note(g, name, x, 274, { s: 26, c: on ? C.ink : C.ink2, al: seg(lt, .7 + i * .3, 1.0 + i * .3) });
    });
    note(g, '示例工程补充', SX17(0), 238, { s: 24, c: C.grey, al: seg(lt, 2.4, 2.8) });
    if (solo != null) rec17(g, solo, TR17[1]);
    if (fail != null) {
      const k = seg(lt, 8.6, 9.4);
      rec17(g, fail, TR17[0] + k * k * 330); if (lt > 8.4) badge(g, SX17(3), 420 - 64, 26, C.red, 'cross', seg(lt, 8.4, 8.7));
    }
    if (lt > 8.8) { chipM(g, 'null', SX17(3), 806, { fs: 26, col: C.paper2, dash: [8, 6], p: seg(lt, 8.8, 9.1) }); }
    if (par != null) TR17.forEach((y, j) => rec17(g, par - j * 26, y));
    if (lt > 14.0) TR17.forEach((y, j) => at(g, 1800, y, pop(seg(lt, 14.0 + j * .1, 14.4 + j * .1)), () => bcard(g, -46, -34, 92, 68, { kind: ['lamp', 'ac', 'scene'][j], acc: [C.yellow, C.blue, C.red][j], lt, sh: 4 })));
  },
});

/* s18 回到 155 行：删除块折叠、代码塌缩；三步待办；联动页接上同一条链 */
S('s18', {
  cam: [[0, 960, 520, 1], [16, 960, 520, 1]],
  cues: [[.6, 'whoosh'], [2.0, 'stamp'], [4.4, 'tick'], [6.6, 'success'], [8.4, 'snap'], [9.6, 'snap'], [10.8, 'snap'], [12.6, 'block'], [13.0, 'block']],
  draw(g, lt) {
    const fold = eio(seg(lt, .6, 1.8)), shrink = eio(seg(lt, 2.0, 2.6));
    const dels = ['} else if (type == LAMP) {', '    cards += LampCardUiModel(card, parse(card))', '} else if (type == AC) {', '    cards += AcCardUiModel(card, parse(card))', '} else if (type == SCENE) {', '    cards += SceneCardUiModel(card)'];
    const lines = [
      ...dels.map(t => ({ t, k: '-', hk: 1 - fold, dim: false })),
      { t: '@@ − 约 500 行 if-else（已删除） @@', k: '-', hk: fold },
      { t: 'val card = cardFactoryManager.produceCard(panelCard)', k: '+', hk: eo(seg(lt, 1.4, 1.8)), p: seg(lt, 1.8, 2.6) },
    ];
    const h = lerp(400, 190, shrink);
    at(g, 600, 200 + h / 2, .9 + .1 * pop(seg(lt, 0, .4)), () => ide(g, -480, -h / 2, 960, h, lines, { title: 'PanelViewModel.kt', tag: '示意', s: 24, lh: 44, lt, nums: false }), { al: seg(lt, 0, .2) });
    if (lt > 2.0 && lt < 3.2) burst(g, 600, 300, lt - 2.0, 14, 260);
    // 整个类：155 行
    if (lt > 3.8) at(g, 1500, 300, pop(seg(lt, 3.8, 4.2)), () => {
      note(g, '整个类', 0, -86, { s: 30, w: 900, c: C.ink });
      const v = String(roll(lt, 4.4, 6.6, 0, 155)), wv = textW(g, v, { f: 'disp', s: 120, w: 900 });
      if (lt > 6.6) box(g, -wv / 2 - 14, -50, (wv + 28) * eo(seg(lt, 6.6, 6.9)), 96, C.yellow, { sh: 0, lw: 0 });
      text(g, v, -24, 2, { f: 'disp', s: 120, w: 900 }); note(g, '行', wv / 2 - 4, 22, { s: 40, w: 900, c: C.ink, a: 'left' });
    });
    // 加新卡：三步
    ['新建工厂', '注册', '写配置'].forEach((s, i) => {
      const t0 = 8.2 + i * 1.2, p = seg(lt, t0, t0 + .3); if (p <= 0) return;
      at(g, 1500, 470 + i * 84, pop(p), () => { box(g, -150, -32, 300, 64, C.white, { sh: 5 }); box(g, -150, -32, 64, 64, C.blue, { sh: 0, lw: 4 }); icCheck(g, -118, 2, 34, '#fff', seg(lt, t0 + .2, t0 + .5), 7); text(g, s, 20, 2, { s: 30, w: 900 }); });
    });
    // 联动页也接上同一条链
    if (lt > 12.0) {
      const p = seg(lt, 12.0, 12.4);
      chipM(g, '工厂管理器', 600, 560, { f: 'cjk', fs: 28, col: C.ink, p });
      [[330, '看板'], [870, '设备联动页']].forEach(([x, name], i) => {
        path(g, partial([[600, 590], [600, 640], [x, 640], [x, 680]], eo(seg(lt, 12.2, 12.7))), { w: 6 });
        at(g, x, 760, pop(seg(lt, 12.3 + i * .1, 12.7 + i * .1)), () => { screenFrame(g, -130, -70, 260, 140, lt, { cell: 35 }); for (let k = 0; k < 3; k++) if (lt > 12.6 + k * .3 + i * .15) { const [dy] = landing(lt, 12.6 + k * .3 + i * .15, .3, -60); bcard(g, -116 + k * 80, -56 + dy, 72, 112, { kind: ['lamp', 'lock', 'ac'][k], acc: [C.yellow, C.yellow, C.blue][k], lt, sh: 3 }); } });
        note(g, name, x + 150, 712, { s: 26, c: C.ink, a: 'left', al: seg(lt, 12.5, 12.8) });
      });
    }
  },
});

/* =====================================================================
 * 第四章：能力做积木，卡片来拼
 * ===================================================================== */
/* 手画感的开关（各写一套）：amp 越大越歪 */
function wobblySwitch(g, x, y, s, amp, seed, col = C.red, p = 1) {
  const P = [[-50, -26], [50, -26], [50, 26], [-50, 26]].map(([px, py], i) => [x + (px + (hash(seed + i * 1.7) - .5) * amp) * s, y + (py + (hash(seed + i * 3.1) - .5) * amp) * s]);
  solid(g, () => { g.beginPath(); g.moveTo(...P[0]); for (let i = 1; i < 4; i++) g.lineTo(...P[i]); g.closePath(); }, col, { sh: 4, al: p });
  disc(g, x + (22 + (hash(seed) - .5) * amp) * s, y + (hash(seed + 9) - .5) * amp * .5 * s, (18 + (hash(seed + 5) - .5) * amp * .4) * s, C.white, { sh: 0, al: p });
}
const C19 = [[420, '灯卡', 'lamp', 2], [960, '插座卡', 'socket', 10], [1500, '联动页的卡', 'lock', 18]];
S('s19', {
  card: 5,
  cam: [[0, 960, 520, 1], [2, 960, 500, 1.08], [5.4, 960, 500, 1.08], [6.2, 960, 520, 1], [17, 960, 520, 1]],
  cues: [[0, 'whoosh'], [2.4, 'block'], [5.8, 'block'], [6.6, 'block'], [7.4, 'block'], [9.8, 'error'], [13.6, 'tick'], [14.0, 'error']],
  draw(g, lt) {
    C19.forEach(([x, name, kind, amp], i) => {
      const t0 = i === 1 ? 2.2 : 5.8 + (i ? .4 : 0), p = seg(lt, t0, t0 + .4); if (p <= 0) return;
      let w = 380, h = 260;
      if (i === 1) { const r = eio(seg(lt, 9.6, 10.2)); w = lerp(380, 280, r); h = lerp(260, 330, r); }
      at(g, x, 470, pop(p), () => {
        bcard(g, -w / 2, -h / 2, w, h, { kind: null, acc: [C.yellow, C.red, C.yellow][i], sh: 8 });
        icon(g, kind, -w / 2 + 70, -h / 2 + 90, .7, lt);
        text(g, '开关', -w / 2 + 132, -h / 2 + 92, { s: 26, w: 900, a: 'left', c: C.ink2 });
        const brk = i === 1 ? seg(lt, 9.8, 10.2) : 0;
        wobblySwitch(g, 0 + brk * 20, h / 2 - 70 + brk * 10, 1.1, amp, i * 7 + 1);
        if (brk > 0) { path(g, partial([[-60, h / 2 - 110], [-20, h / 2 - 80], [-40, h / 2 - 60], [10, h / 2 - 30]], brk), { c: C.red, w: 6 }); }
        if (i === 2 && lt > 13.8) { g.save(); g.globalAlpha *= .75 * Math.abs(Math.sin((lt - 13.8) * 7)) * (1 - seg(lt, 15.6, 16.2)); g.fillStyle = '#fff'; g.fillRect(-w / 2, -h / 2, w, h); g.restore(); }
      });
      note(g, name, x, 470 + h / 2 + 40, { s: 28, w: 900, c: C.ink, al: p });
    });
    if (lt > 9.9) tagB(g, '样式和能力缠在一起', 960, 236, C.red, seg(lt, 9.9, 10.3), { fs: 26, al: 1 - seg(lt, 13, 13.4) });
    if (lt > 13.2) { // 上报落下 → 整张卡闪白重画
      const p = flyPos(lt, 13.3, .5, [1500, 140], [1500, 330], 0);
      if (p && lt < 13.9) box(g, p[0] - 20, p[1] - 20, 40, 40, C.yellow, { sh: 4 });
      tagB(g, '整张重画', 1500, 250, C.red, seg(lt, 14.0, 14.4), { fs: 28, rot: .04 });
    }
  },
});

/* s20 第一层 function：一块能力积木的四个槽 + 三个接口；能力家族接口一致 */
const SLOT20 = [['设备 id', C.ink], ['能力码', C.red], ['endpoint', C.blue], ['状态快照', C.yellow]];
const FAM20 = [['开关', 'switch'], ['亮度', 0], ['色温', 1], ['窗帘', 'curtain'], ['门锁', 'lock']];
S('s20', {
  cam: [[0, 960, 520, 1], [14, 960, 520, 1]],
  cues: [[.4, 'block'], [1.2, 'whoosh'], [4.8, 'snap'], [5.4, 'snap'], [6.0, 'snap'], [6.6, 'snap'], [9.4, 'block'], [9.8, 'block'], [10.2, 'block'], [10.6, 'block'], [11.0, 'block']],
  draw(g, lt) {
    const fp = pop(seg(lt, .3, .7)), op = eo(seg(lt, 1.2, 1.8));
    at(g, 960, 460, fp, () => {
      const h = lerp(120, 300, op);
      box(g, -410, -h / 2, 820, h, C.white, { sh: 10 });
      g.fillStyle = C.ink; g.fillRect(-410, -h / 2, 820, 54);
      text(g, 'function · 一个能力一个对象', -386, -h / 2 + 28, { s: 28, w: 900, c: '#fff', a: 'left' });
      SLOT20.forEach(([s, col], i) => {
        const x = -300 + i * 200, k = seg(lt, 4.8 + i * .6, 5.2 + i * .6);
        box(g, x - 86, -10, 172, 110, null, { lw: 3, dash: [8, 6], al: op });
        if (k > 0) at(g, x, 45, pop(k), () => {
          if (i === 2) { disc(g, 0, -8, 30, col, { sh: 4 }); text(g, s, 0, 38, { f: 'mono', s: 24, w: 700 }); }
          else { box(g, -76, -40, 152, 80, col, { sh: 4 }); text(g, s, 0, 2, { s: 26, w: 900, c: onCol(col) }); }
        });
      });
    });
    // 三个接口
    const pp = i => seg(lt, 9.4 + i * .3, 9.8 + i * .3);
    if (lt > 9.3) {
      arrow(g, [[548, 460], [430, 460]], { w: 8, hs: 24, p: eo(pp(0)) }); note(g, '取值', 360, 460, { s: 28, w: 900, c: C.ink, al: pp(0) });
      arrow(g, [[960, 190], [960, 300]], { w: 8, hs: 24, p: eo(pp(1)) }); note(g, '消费上报', 996, 210, { s: 28, w: 900, c: C.ink, a: 'left', al: pp(1) });
      arrow(g, [[1372, 460], [1490, 460]], { w: 8, hs: 24, p: eo(pp(2)) }); note(g, '下发控制', 1510, 460, { s: 28, w: 900, c: C.ink, a: 'left', al: pp(2) });
    }
    // 能力家族：接口一样（顶上同一条黑色卡口）
    FAM20.forEach(([name, kind], i) => {
      const x = 560 + i * 200, k = seg(lt, 10.2 + i * .3, 10.6 + i * .3); if (k <= 0) return;
      const [dy, sx] = landing(lt, 10.2 + i * .3, .35, -120);
      at(g, x, 720 + dy, 1, () => { box(g, -60, -46, 120, 92, C.white, { sh: 5 }); box(g, -60, -46, 120, 14, C.ink, { sh: 0, lw: 0 }); if (typeof kind === 'number') capBlock(g, kind, 0, 6, .7); else icon(g, kind, 0, 8, .6, lt); }, { sx, sy: 1 / sx });
      note(g, name, x, 800, { s: 24, al: k });
    });
  },
});

/* s21 每张设备卡自动挂 4 块基础 func，再按设备拼开关/亮度/窗帘… */
const BASE21 = [['基础信息', C.ink], ['设备级名称位置', C.greyL], ['卡片级名称位置', C.white], ['endpoint 发现', C.blue]];
const EXTRA21 = [[['开关', 'switch'], ['亮度', 0], ['色温', 1]], [['窗帘', 'curtain']], [['门锁', 'lock']]];
const X21 = [420, 960, 1500], N21 = ['灯卡', '窗帘卡', '门锁卡'];
S('s21', {
  cam: [[0, 960, 520, 1], [14, 960, 520, 1]],
  cues: [[.4, 'block'], [1.2, 'snap'], [1.7, 'snap'], [2.2, 'snap'], [2.7, 'snap'], [4.8, 'whoosh'], [5.6, 'snap'], [6.2, 'snap'], [6.8, 'snap'], [7.6, 'snap'], [8.4, 'snap'], [9.6, 'success']],
  draw(g, lt) {
    const sp = eio(seg(lt, 4.6, 5.4)), dimBase = .45 * eo(seg(lt, 9.2, 9.6));
    for (let c = 0; c < 3; c++) {
      if (sp <= 0 && c !== 1) continue;
      const x = lerp(960, X21[c], sp), w = lerp(600, 420, sp), h = lerp(360, 320, sp);
      at(g, x, 450, pop(seg(lt, .2, .6)), () => {
        box(g, -w / 2, -h / 2, w, h, C.white, { sh: 9 });
        text(g, sp < .5 ? '设备卡' : N21[c], -w / 2 + 24, -h / 2 + 34, { s: 30, w: 900, a: 'left' });
        BASE21.forEach(([s, col], i) => {
          const k = seg(lt, 1.0 + i * .5, 1.3 + i * .5); if (k <= 0) return;
          // 大：2×2 带字；小：顶上一排小方块
          const bx = lerp(-150 + (i % 2) * 300, -w / 2 + 40 + i * 52, sp), by = lerp(-40 + Math.floor(i / 2) * 110, -h / 2 + 84, sp), bw = lerp(270, 44, sp), bh = lerp(90, 30, sp);
          at(g, bx + (sp < .5 ? 0 : bw / 2), by, pop(k), () => {
            box(g, -bw / 2, -bh / 2, bw, bh, col, { sh: lerp(5, 2, sp), lw: 3, dash: col === C.white ? [8, 6] : null, al: 1 - dimBase });
            if (sp < .4) text(g, s, 0, 2, { s: 26, w: 900, c: onCol(col), al: 1 - sp * 2.5 });
          });
        });
        if (sp > .5) note(g, '基础 4 块', -w / 2 + 40 + 4 * 52 + 10, -h / 2 + 84, { s: 24, a: 'left', al: seg(sp, .5, 1) * (1 - dimBase) });
        EXTRA21[c].forEach(([s, kind], i) => {
          const t0 = 5.4 + c * 1.1 + i * .5, k = seg(lt, t0, t0 + .3); if (k <= 0) return;
          const n = EXTRA21[c].length, ex = (i - (n - 1) / 2) * 120, [dy, sx] = landing(lt, t0, .3, -140);
          const pulse = lt > 9.4 ? 1 + .05 * Math.sin((lt - 9.4) * 6 + i) : 1;
          at(g, ex, 50 + dy, pulse, () => { box(g, -52, -52, 104, 104, C.white, { sh: 6 }); if (typeof kind === 'number') capBlock(g, kind, 0, 0, .8); else icon(g, kind, 0, 0, .75, lt); }, { sx, sy: 1 / sx });
          note(g, s, ex, 128, { s: 24, c: C.ink, al: k });
        });
      });
    }
  },
});

/* s22 第二层 uimodel：接口委托，一个 by 卡片就有了 isOn / toggle */
const S22 = [
  'class LampCardUiModel(',
  '    switchFunc: SwitchFunc, card: PanelCard, span: CardSpanSize',
  ') : DeviceCardUiModel(card, span),',
  '    ISwitchFunc by switchFunc {',
  '    init { funcList.add(switchFunc) }',
  '}',
];
S('s22', {
  cam: [[0, 960, 520, 1], [14, 960, 520, 1]],
  cues: [[.3, 'block'], [.5, 'type'], [4.8, 'tick'], [5.6, 'whoosh'], [6.4, 'snap'], [7.0, 'block'], [7.6, 'block'], [9.6, 'stamp']],
  draw(g, lt) {
    const W = { x: 50, y: 230, w: 1100, h: 360 };
    const lines = S22.map((t, i) => ({ t, p: seg(lt, .4 + i * .35, .75 + i * .35) }));
    if (lt > 4.6) { lines[3].hl = C.red; lines[3].hlA = win(lt, 4.8, 14, .2, .1); }
    at(g, W.x + W.w / 2, W.y + W.h / 2, .9 + .1 * pop(seg(lt, 0, .4)), () => ide(g, -W.w / 2, -W.h / 2, W.w, W.h, lines, { title: 'LampCardUiModel.kt', tag: '重写的示意', s: 26, lh: 46, lt }), { al: seg(lt, 0, .2) });
    const byX = codeX(g, S22[3], 16, W.x, { s: 26 }), byY = W.y + 54 + 18 + 3 * 46 + 23;
    if (lt > 4.8) { g.save(); g.globalAlpha *= seg(lt, 4.8, 5.0); g.lineWidth = 4; g.strokeStyle = C.red; g.strokeRect(byX - 6, byY - 22, charW(26) * 13 + 12, 44); g.restore(); }
    // 右：灯卡
    const dim = lt > 9.4 ? .35 * eo(seg(lt, 9.4, 9.8)) : 0;
    at(g, 1530, 430, pop(seg(lt, .8, 1.2)), () => {
      bcard(g, -190, -125, 380, 250, { kind: 'lamp', acc: C.yellow, sh: 8, lt });
      text(g, '灯', -40, -40, { s: 34, w: 900, a: 'left' });
      box(g, 40, 30, 120, 70, null, { lw: 4, dash: [10, 8], al: 1 - seg(lt, 6.3, 6.4) });
      if (lt > 6.4) { const [, sx] = landing(lt, 6.4, .001, 0); at(g, 100, 65, 1, () => icon(g, 'switch', 0, 0, 1.1, lt, { on: 1 }), { sx, sy: 1 / sx, al: 1 - dim }); }
    });
    const p = flyPos(lt, 5.6, .8, [byX + 90, byY], [1630, 495], 160);
    if (p && lt < 6.4) at(g, p[0], p[1], 1, () => icon(g, 'switch', 0, 0, 1.1, lt, { on: 1 }), { rot: (1 - seg(lt, 5.6, 6.4)) * .8 });
    chipM(g, 'isOn()', 1440, 610, { p: seg(lt, 6.9, 7.3), col: C.white, rot: -.04 });
    chipM(g, 'toggle()', 1630, 610, { p: seg(lt, 7.5, 7.9), col: C.white, rot: .04 });
    if (lt > 9.5) {
      const k = eo(seg(lt, 9.5, 9.9));
      box(g, 1530 - 210 - 20 * (1 - k), 285 - 20 * (1 - k), 420 + 40 * (1 - k), 290 + 40 * (1 - k), null, { lw: 8, al: k });
      note(g, '渲染层只看 uimodel', 1530, 256, { s: 28, w: 900, c: C.ink, al: k });
    }
  },
});

/* s23 第三层：一个 uimodel 注册多个 binder，运行时按尺寸挑 */
const S23 = [
  'register(LampCardUiModel::class).to(SmallBinder(), MiddleBinder())',
  '    .withKotlinClassLinker { _, item ->',
  '        if (item.span == MIDDLE) MiddleBinder::class',
  '        else SmallBinder::class }',
];
function basket(g, x, y, name, lt, a) {
  at(g, x, y, pop(a), () => { path(g, [[-210, -90], [-210, 70], [210, 70], [210, -90]], { w: 10 }); });
  note(g, name, x, y + 104, { s: 26, c: C.ink, al: a });
}
S('s23', {
  cam: [[0, 960, 520, 1], [13, 960, 520, 1]],
  cues: [[.4, 'block'], [1.0, 'type'], [5.0, 'block'], [6.0, 'block'], [9.0, 'snap'], [11.0, 'tick'], [11.6, 'snap']],
  draw(g, lt) {
    const lines = S23.map((t, i) => ({ t, p: seg(lt, .8 + i * .5, 1.3 + i * .5) }));
    at(g, 960, 706, .9 + .1 * pop(seg(lt, .5, .9)), () => ide(g, -530, -116, 1060, 232, lines, { title: 'CardAdapter.kt', tag: '重写的示意', s: 24, lh: 40, lt }), { al: seg(lt, .5, .7) });
    // 上：uimodel + 尺寸牌
    const small = lt > 11.0, fl = lt > 10.8 && lt < 11.2 ? Math.abs(lt - 11.0) / .2 : 1;
    at(g, 860, 196, pop(seg(lt, .1, .5)), () => { box(g, -190, -36, 380, 72, C.white, { sh: 6 }); icon(g, 'lamp', -150, 4, .5, lt); text(g, 'LampCardUiModel', 20, 2, { f: 'mono', s: 26, w: 700 }); });
    at(g, 1210, 196, 1, () => chipM(g, small ? 'span = SMALL' : 'span = MIDDLE', 0, 0, { col: C.yellow, fs: 26 }), { sy: Math.max(.05, fl), al: seg(lt, .4, .7) });
    basket(g, 640, 400, 'SmallBinder', lt, seg(lt, 4.9, 5.3));
    basket(g, 1280, 400, 'MiddleBinder', lt, seg(lt, 5.9, 6.3));
    // 落入：先中篮（中卡），后小篮（小卡）；外层虚线是共用的编辑/删除外壳
    const drop = (t0, to, w, h, kind) => {
      const p = flyPos(lt, t0, .5, [860, 240], to, 60); if (!p) return;
      at(g, p[0], p[1], 1, () => { bcard(g, -w / 2, -h / 2, w, h, { kind, acc: C.yellow, sh: 5, lt }); if (lt > t0 + .5) box(g, -w / 2 - 12, -h / 2 - 12, w + 24, h + 24, null, { lw: 3, dash: [8, 6], al: seg(lt, t0 + .5, t0 + .8) }); });
    };
    drop(8.6, [1280, 410], 300, 100, 'lamp');
    drop(11.2, [640, 410], 150, 100, 'lamp');
    note(g, '外层虚线：编辑 / 删除外壳，所有卡共用', 960, 548, { s: 24, al: seg(lt, 9.4, 9.8) });
  },
});

/* s24 三层各管一层；新设备复用已有样式，只在配置里补一条声明 */
const S24 = [
  { t: '{ "cardType": "device",' },
  { t: '  "deviceTypes": ["AC",' },
  { t: '    "FLOOR_HEAT", "FRESH_AIR"],', k: '+' },
  { t: '  "styles": [ ... ] }' },
];
S('s24', {
  cam: [[0, 960, 520, 1], [13, 960, 520, 1]],
  cues: [[.4, 'block'], [.9, 'block'], [1.4, 'block'], [5.0, 'type'], [8.8, 'snap'], [9.1, 'snap'], [9.4, 'snap'], [10.0, 'success']],
  draw(g, lt) {
    const reuse = seg(lt, 8.8, 9.6);
    const L = [['视图 uibinding', 300], ['卡片 uimodel', 420], ['能力 function', 540]];
    L.forEach(([name, y], li) => {
      const t0 = .4 + (2 - li) * .5, [dy, sx] = landing(lt, t0, .4, -200); if (lt < t0) return;
      at(g, 640, y + 50 + dy, 1, () => {
        box(g, -280, -50, 560, 100, li === 2 ? C.paper2 : C.white, { sh: 7 });
        for (let k = 0; k < 4; k++) {
          const x = -210 + k * 140;
          if (li === 0) box(g, x - [40, 55, 30, 50][k], -32, [80, 110, 60, 100][k], 64, null, { lw: 4 });
          else if (li === 1) icon(g, ['lamp', 'ac', 'curtain', 'lock'][k], x, 0, .55, lt);
          else { if (k === 1) capBlock(g, 0, x, 4, .6); else if (k === 2) capBlock(g, 1, x, 0, .6); else icon(g, k === 0 ? 'switch' : 'curtain', x, 0, .5, lt); }
        }
      }, { sx, sy: 1 / sx });
      note(g, name, 340, y + 50, { s: 26, c: C.ink, a: 'right', al: seg(lt, t0 + .2, t0 + .5) });
      if (reuse > 0) chipM(g, '复用', 960, y + 50, { f: 'cjk', fs: 24, col: C.blue, p: seg(lt, 8.8 + li * .3, 9.2 + li * .3) });
    });
    note(g, '工厂、卡片、Binder 全部复用', 640, 700, { s: 26, c: C.ink, al: seg(lt, 9.8, 10.2) });
    const lines = S24.map(l => ({ ...l })); lines[2].hk = eo(seg(lt, 4.6, 4.9)); lines[2].p = seg(lt, 4.9, 7.0);
    at(g, 1440, 430, .9 + .1 * pop(seg(lt, 3.8, 4.2)), () => ide(g, -400, -130, 800, 260, lines, { title: 'cardmapper.json', tag: '示意', s: 26, lh: 46, lt }), { al: seg(lt, 3.8, 4.0) });
    note(g, '地暖、新风：复用空调卡这一套', 1440, 610, { s: 26, al: seg(lt, 7.2, 7.6) });
  },
});

/* =====================================================================
 * 第五章：只刷新变了的那一格
 * ===================================================================== */
function cylinder(g, x, y, w, h, col) { // 数据库：圆柱积木
  solid(g, () => { g.beginPath(); g.moveTo(x - w / 2, y - h / 2); g.lineTo(x - w / 2, y + h / 2); g.ellipse(x, y + h / 2, w / 2, 18, 0, Math.PI, 0, true); g.lineTo(x + w / 2, y - h / 2); }, col, { sh: 6 });
  solid(g, () => { g.beginPath(); g.ellipse(x, y - h / 2, w / 2, 18, 0, 0, TAU); }, C.blueL, { sh: 0 });
}
const LIST25 = [['灯', 'lamp', C.yellow], ['插座', 'socket', C.red], ['窗帘', 'curtain', C.blue], ['空调', 'ac', C.blue], ['门锁', 'lock', C.yellow], ['开关', 'switch', C.red]];
const ly25 = i => 190 + i * 110;
S('s25', {
  card: 6,
  cam: [[0, 960, 500, 1], [14, 960, 500, 1]],
  cues: [[0, 'whoosh'], [2.4, 'whoosh'], [3.2, 'block'], [5.6, 'whoosh', .6], [9.8, 'tick'], [10.1, 'tick'], [10.4, 'tick'], [10.7, 'tick'], [11.0, 'tick'], [11.3, 'tick']],
  draw(g, lt) {
    at(g, 230, 330, pop(seg(lt, 1.2, 1.6)), () => { tri(g, 0, 0, 150, C.red, { sh: 7 }); disc(g, 0, 22, 14, C.white, { sh: 0, lw: 3 }); });
    note(g, '网关', 230, 436, { s: 28, w: 900, c: C.ink, al: seg(lt, 1.4, 1.7) });
    at(g, 560, 330, pop(seg(lt, 1.4, 1.8)), () => cylinder(g, 0, 0, 150, 120, C.blue));
    note(g, '数据库', 560, 436, { s: 28, w: 900, c: C.ink, al: seg(lt, 1.6, 1.9) });
    LIST25.forEach(([name, kind, acc], i) => {
      const t0 = 1.6 + i * .1, [dy, sx] = landing(lt, t0, .35, -100); if (lt < t0) return;
      const hit = lt > 10.1 + i * .3 ? win(lt, 10.1 + i * .3, 10.9 + i * .3, .1, .4) : 0;
      at(g, 1480, ly25(i) + dy, 1, () => { bcard(g, -300, -46, 600, 92, { kind, acc, name, lt: lt + i, sh: 5 + hit * 5 }); if (hit > 0) box(g, -306, -52, 612, 104, null, { lw: 6, stroke: C.yellow, al: hit }); }, { sx, sy: 1 / sx });
    });
    // 事件总线
    const bp = eo(seg(lt, 5.4, 6.6));
    path(g, partial([[640, 330], [960, 330]], clamp(bp * 2)), { w: 10 });
    path(g, partial([[960, ly25(0)], [960, ly25(5)]], clamp(bp * 2 - .6)), { w: 10 });
    LIST25.forEach((_, i) => path(g, partial([[960, ly25(i)], [1176, ly25(i)]], clamp(bp * 3 - 2)), { w: 6 }));
    if (bp > .9) path(g, [[960, ly25(0)], [960, ly25(5)]], { w: 4, c: C.yellow, dash: [10, 24], off: -lt * 80 });
    note(g, '事件总线', 940, 640, { s: 28, w: 900, c: C.ink, a: 'right', al: seg(lt, 6.2, 6.6) });
    // 状态值：网关 → 数据库 → 总线 → 每张卡
    const v1 = flyPos(lt, 2.4, .8, [260, 300], [560, 280], 120); if (v1 && lt < 5.6) box(g, v1[0] - 20, v1[1] - 20, 40, 40, C.yellow, { sh: 4 });
    const v2 = lt > 5.6 && lt < 9.8 ? [kf([[5.6, 640], [6.6, 960]], lt), 330] : null; if (v2) box(g, v2[0] - 20, v2[1] - 20, 40, 40, C.yellow, { sh: 4 });
    LIST25.forEach((_, i) => { const t0 = 9.8 + i * .3, p = seg(lt, t0, t0 + .3); if (p > 0 && p < 1) box(g, lerp(960, 1176, p) - 16, ly25(i) - 16, 32, 32, C.yellow, { sh: 3 }); });
  },
});

/* s26 对上号的 func：事件钥匙挨个试配 funcList 的缺口，三角缺口的开关对上 */
const FL26 = [['基础信息', 'sq'], ['设备名称', 'circle'], ['卡片名称', 'quarter'], ['endpoint', 'half'], ['开关', 'tri'], ['亮度', 'sq']];
const fx26 = i => 470 + i * 196;
function notchBlock(g, x, y, kind, col, on) {
  box(g, x - 75, y - 60, 150, 140, C.white, { sh: 6 });
  g.save(); g.translate(x, y - 60); // 顶部缺口：画成纸色形状
  if (kind === 'tri') tri(g, 0, 18, 44, C.paper2, { sh: 0, lw: 3, dir: 2 }); else if (kind === 'circle') half(g, 0, 0, 22, C.paper2, 0, { sh: 0, lw: 3 });
  else if (kind === 'half') box(g, -26, 0, 52, 18, C.paper2, { sh: 0, lw: 3 }); else if (kind === 'quarter') quarter(g, -20, 0, 34, C.paper2, 0, { sh: 0, lw: 3 }); else box(g, -18, 0, 36, 32, C.paper2, { sh: 0, lw: 3 });
  g.restore();
  if (col) icon(g, col, x, y + 22, .55, 0, { on });
}
S('s26', {
  cam: [[0, 960, 500, 1], [14, 960, 500, 1]],
  cues: [[.4, 'block'], [1.4, 'tick'], [2.0, 'tick'], [2.6, 'tick'], [3.2, 'tick'], [5.0, 'snap'], [6.2, 'tick'], [9.6, 'whoosh']],
  draw(g, lt) {
    at(g, 960, 470, pop(seg(lt, 0, .4)), () => {
      bcard(g, -620, -250, 1240, 500, { kind: null, acc: C.yellow, sh: 10 });
      icon(g, 'lamp', -540, -160, .7, lt); text(g, '灯', -480, -160, { s: 40, w: 900, a: 'left' });
      text(g, 'funcList', -540, -80, { f: 'mono', s: 28, w: 700, a: 'left', c: C.ink2 });
    });
    const on = lt > 6.2 ? 1 : 0;
    FL26.forEach(([name, kind], i) => {
      const k = seg(lt, .5 + i * .08, .8 + i * .08); if (k <= 0) return;
      at(g, fx26(i), 540, pop(k), () => notchBlock(g, 0, 0, kind, i === 4 ? 'switch' : i === 5 ? 'lamp' : null, on));
      if (i < 4) at(g, fx26(i), 562, pop(k), () => stationIcon(g, ['sq', 'circle', 'quarter', 'half'][i], 0, 0, .6, C.greyL));
      note(g, name, fx26(i), 648, { s: 24, c: C.ink, al: k });
    });
    if (lt > 6.2 && lt < 7.0) ripple(g, fx26(4), 562, lt - 6.2, 120, 80, 30, .6);
    // 事件钥匙：底部是三角
    let kx = 300, ky = 230;
    if (lt > .8) {
      const tries = [1.2, 1.8, 2.4, 3.0];
      kx = kf([[.8, 300], [1.2, fx26(0)], [1.8, fx26(1)], [2.4, fx26(2)], [3.0, fx26(3)], [4.6, fx26(3)], [5.0, fx26(4)]], lt);
      ky = 380; tries.forEach(t => { if (lt > t && lt < t + .4) ky = 380 + Math.sin((lt - t) / .4 * Math.PI) * 30; });
      if (lt > 4.6) ky = kf([[4.6, 380], [5.0, 432]], lt);
      tries.forEach((t, i) => { if (lt > t + .15 && lt < t + .55) icCross(g, fx26(i) + 60, 400, 28, C.red, 1, 6); });
    }
    if (lt < 9.4) at(g, kx, ky, pop(seg(lt, .3, .7)), () => { box(g, -50, -50, 100, 60, C.yellow, { sh: 5 }); tri(g, 0, 22, 40, C.yellow, { sh: 0, lw: 3, dir: 2 }); });
    if (lt < 9.4) chipM(g, '设备id + path', kx, ky - 92, { fs: 24, p: seg(lt, .5, .9) });
    if (lt > 5.0 && lt < 5.6) burst(g, fx26(4), 480, lt - 5.0, 10, 120);
    // payload 纸条
    if (lt > 9.4) { const p = flyPos(lt, 9.6, .9, [fx26(4), 470], [1500, 180], 100); chipM(g, 'payload：traitCode · 新值', p[0], p[1], { f: 'cjk', fs: 26, col: C.yellow, rot: (1 - seg(lt, 9.6, 10.5)) * -.2 }); }
  },
});

/* s27 只重绑一个控件：payload 回到列表，只有开关积木变色，名称/位置/在线不动 */
const G27 = [['ac', '空调', C.blue], [null, '', C.yellow], ['curtain', '窗帘', C.blue], ['lock', '门锁', C.yellow], ['socket', '插座', C.red], ['scene', '场景', C.red]];
const gx27 = i => 560 + (i % 3) * 400, gy27 = i => 330 + Math.floor(i / 3) * 270;
S('s27', {
  cam: [[0, 960, 480, 1], [9.2, 960, 480, 1], [10.2, 960, 360, 1.6], [14, 960, 360, 1.6]],
  cues: [[.6, 'whoosh'], [2.0, 'tick'], [5.2, 'snap'], [9.6, 'block', .5], [10.2, 'block', .5], [10.8, 'block', .5]],
  draw(g, lt) {
    const on = lt > 5.2 ? 1 : 0, ins = lt > 9.2 ? 0 : 1;
    G27.forEach(([kind, name, acc], i) => {
      const x = gx27(i), y = gy27(i);
      if (kind) { at(g, x, y, pop(seg(lt, .1 + i * .05, .4 + i * .05)), () => bcard(g, -175, -105, 350, 210, { kind, acc, name, lt: 0, sh: 6 }), { al: ins ? 1 : 1 - seg(lt, 9.2, 9.8) * .6 }); return; }
      at(g, x, y, pop(seg(lt, .1, .4)), () => { // 目标灯卡：名称、位置、在线、开关各自一块
        bcard(g, -175, -105, 350, 210, { kind: null, acc, sh: 6 });
        text(g, '灯', -140, -42, { s: 40, w: 900, a: 'left' });
        text(g, '客厅', -140, 8, { s: 26, w: 700, a: 'left', c: C.ink2 });
        disc(g, -130, 58, 9, C.blue, { sh: 0, lw: 0 }); text(g, '在线', -112, 59, { s: 24, w: 700, a: 'left', c: C.ink2 });
        icon(g, 'switch', 95, 20, .95, lt, { on: on ? eo(seg(lt, 5.2, 5.5)) : 0 });
      });
    });
    const p = flyPos(lt, .6, .8, [1900, 160], [gx27(1) + 95, gy27(1) + 20], 60);
    if (p && lt < 5.2) chipM(g, 'payload', p[0], p[1] - 60, { col: C.yellow, fs: 24 });
    chipM(g, 'notifyItemChanged(下标, payloads)', 960, 160, { fs: 26, p: seg(lt, 2.0, 2.4), al: 1 - seg(lt, 9.2, 9.6) });
    if (lt > 5.2 && lt < 6.0) ripple(g, gx27(1) + 95, gy27(1) + 20, lt - 5.2, 100, 60, 26, .6);
    // 推近后：其余控件挂“不动”
    [[-40, -42], [-28, 8], [-14, 59]].forEach(([dx, dy], i) => {
      if (lt > 9.6 + i * .6) chipM(g, '不动', gx27(1) + dx, gy27(1) + dy, { f: 'cjk', fs: 24, col: C.greyL, p: seg(lt, 9.6 + i * .6, 10.0 + i * .6), sh: 2 });
    });
  },
});

/* s28 反方向：点一下 → toggle 委托到 func → 写请求按通道发出 */
const RAIL28 = [['Matter 设备', 300], ['云', 430], ['局域网', 560]];
S('s28', {
  cam: [[0, 960, 480, 1], [14, 960, 480, 1]],
  cues: [[.6, 'tick'], [4.8, 'whoosh'], [6.6, 'snap'], [7.2, 'block'], [9.6, 'block'], [11.4, 'whoosh'], [13.0, 'success']],
  draw(g, lt) {
    const on = lt > .7 ? 1 : 0;
    at(g, 380, 430, pop(seg(lt, 0, .4)), () => { bcard(g, -180, -120, 360, 240, { kind: 'lamp', acc: C.yellow, name: '灯', lt, sh: 7 }); icon(g, 'switch', 110, 70, .9, lt, { on: eo(seg(lt, .7, 1.0)) }); });
    if (lt > .4 && lt < 1.6) { disc(g, 490, 500, 18 * (1 - seg(lt, .9, 1.4)), C.ink, { sh: 0, lw: 0 }); ripple(g, 490, 500, lt - .6, 40, 40, 40, .7); }
    arrow(g, [[570, 430], [748, 430]], { w: 8, hs: 24, p: eo(seg(lt, 4.6, 5.0)) });
    const tp = seg(lt, 4.8, 5.8); if (tp > 0 && tp < 1) chipM(g, 'toggle()', lerp(570, 760, eio(tp)), 380, { fs: 24 });
    at(g, 860, 430, pop(seg(lt, 4.6, 5.0)), () => { box(g, -90, -70, 180, 140, C.white, { sh: 6 }); icon(g, 'switch', 0, 0, 1.0, lt, { on: lt > 6.6 ? eo(seg(lt, 6.6, 6.9)) : 0 }); });
    note(g, 'SwitchFunc', 860, 530, { s: 24, c: C.ink, al: seg(lt, 4.8, 5.2) });
    // 写请求 + 三条通道
    const lit = 1, rp = eo(seg(lt, 9.4, 10.2));
    RAIL28.forEach(([name, y], i) => {
      const pts = [[1150, 430], [1250, y], [1560, y], [1650, 430]], hot = i === lit && lt > 11.2;
      path(g, partial(pts, rp), { w: hot ? 12 : 6, c: hot ? C.blue : C.ink, al: hot ? 1 : lt > 11.2 ? .35 : 1 });
      note(g, name, 1400, y - 34, { s: 26, c: hot ? C.blue : C.ink, al: rp * (lt > 11.2 && !hot ? .5 : 1) });
    });
    const req = lt < 11.4 ? (lt > 7.2 ? [1060, 430] : null) : (() => { const k = eio(seg(lt, 11.4, 12.6)); const pts = [[1150, 430], [1250, 430], [1560, 430], [1650, 430]]; const q = partial(pts, k); return q[q.length - 1]; })();
    if (req && lt < 12.7) at(g, req[0], req[1], pop(seg(lt, 7.2, 7.5)), () => { box(g, -60, -26, 120, 52, C.ink, { sh: 4, lw: 0 }); text(g, '写请求', 0, 2, { s: 24, w: 900, c: '#fff' }); });
    at(g, 1740, 430, pop(seg(lt, 9.4, 9.8)), () => icon(g, 'lamp', 0, 0, 1.3, lt, { on: lt > 12.9 ? 1 : 0 }));
    if (lt > 12.9) burst(g, 1740, 420, lt - 12.9, 10, 150);
    note(g, 'Matter 设备走 Matter；其余看请求自己的标记', 1400, 680, { s: 24, al: seg(lt, 10.4, 10.8) });
  },
});

/* s29 超时就回滚；上行下行都收在 func 里 */
S('s29', {
  cam: [[0, 960, 500, 1], [12, 960, 500, 1]],
  cues: [[.4, 'tick'], [1.2, 'tick'], [2.0, 'tick'], [2.8, 'tick'], [3.4, 'error'], [3.5, 'block'], [4.6, 'whoosh'], [8.4, 'snap']],
  draw(g, lt) {
    const a1 = 1 - eo(seg(lt, 4.2, 4.8));
    if (a1 > 0) {
      g.save(); g.globalAlpha *= a1;
      const sw = lt < 3.4 ? eo(seg(lt, .4, .7)) : 1 - spring(lt - 3.4, 6, 1.4);
      at(g, 380, 360, pop(seg(lt, 0, .3)), () => { bcard(g, -160, -100, 320, 200, { kind: 'lamp', acc: C.yellow, name: '灯', lt, sh: 6 }); icon(g, 'switch', 90, 52, .85, lt, { on: clamp(sw) }); });
      path(g, [[560, 360], [1500, 360]], { w: 6, dash: [16, 12], off: -lt * 40 });
      const rx = Math.min(kf([[.6, 560], [3.2, 1000]], lt), 1000);
      if (lt > .6) at(g, rx, 360, 1, () => { box(g, -60, -26, 120, 52, C.ink, { sh: 4, lw: 0 }); text(g, '写请求', 0, 2, { s: 24, w: 900, c: '#fff' }); });
      const hk = seg(lt, 1.0, 3.0); // 沙漏
      at(g, 1000, 230, pop(seg(lt, .8, 1.1)), () => { tri(g, 0, -34, 64, C.white, { dir: 2, sh: 0, lw: 4 }); tri(g, 0, 34, 64, C.white, { sh: 0, lw: 4 }); tri(g, 0, -34 - 10 * hk, 64 * (1 - hk) * .8, C.yellow, { dir: 2, sh: 0, lw: 0 }); tri(g, 0, 46 - 10 * (1 - hk), 64 * hk * .8, C.yellow, { sh: 0, lw: 0 }); }, { rot: lt > 3.0 ? (lt - 3.0) * .5 : 0 });
      if (lt > 3.2) icCross(g, 1000, 360, 60, C.red, seg(lt, 3.2, 3.4), 12);
      tagB(g, '回滚', 380, 210, C.red, seg(lt, 3.5, 3.8), { fs: 28, rot: -.05 });
      g.restore();
    }
    // 视图 ⊃ 卡片 ⊃ func：上行、下行都在 func 里
    const p2 = seg(lt, 4.4, 5.0); if (p2 <= 0) return;
    box(g, 360, 300, 1200, 500, null, { lw: 4, al: p2 }); note(g, '视图', 392, 334, { s: 26, c: C.ink, a: 'left', al: p2 });
    box(g, 520, 370, 880, 370, null, { lw: 4, dash: [12, 10], al: seg(lt, 4.6, 5.2) }); note(g, '卡片', 552, 404, { s: 26, c: C.ink, a: 'left', al: seg(lt, 4.6, 5.2) });
    at(g, 960, 560, pop(seg(lt, 4.8, 5.2)), () => { box(g, -150, -70, 300, 140, C.white, { sh: 8 }); box(g, -150, -70, 300, 18, C.red, { sh: 0, lw: 4 }); text(g, 'SwitchFunc', 0, 10, { f: 'mono', s: 30, w: 700 }); });
    arrow(g, [[730, 700], [730, 460]], { w: 8, hs: 24, c: C.blue, p: eo(seg(lt, 5.4, 6.0)) }); note(g, '上行：上报', 710, 580, { s: 26, c: C.blue, a: 'right', al: seg(lt, 5.6, 6.0) });
    arrow(g, [[1190, 460], [1190, 700]], { w: 8, hs: 24, c: C.red, p: eo(seg(lt, 5.8, 6.4)) }); note(g, '下行：下发', 1210, 580, { s: 26, c: C.red, a: 'left', al: seg(lt, 6.0, 6.4) });
    tagB(g, '不关心能力细节', 960, 240, C.ink, seg(lt, 8.4, 8.8), { fs: 28 });
  },
});

/* =====================================================================
 * 总结：带走三条（s30–s32 共用三张经验卡，依次翻开）
 * ===================================================================== */
const TK = [
  { col: C.red, t1: '长什么样 → 配置', t2: '怎么造 → 代码' },
  { col: C.yellow, t1: '能不能建', t2: '和怎么建分开' },
  { col: C.blue, t1: '按能力组合', t2: '刷新到一个控件' },
];
const TKX = [400, 960, 1520];
/* f：翻面进度（0 背面，1 正面）；dim：已讲过的卡变淡 */
function takeaway(g, i, f, lt, o = {}) {
  const { col, t1, t2 } = TK[i], x = TKX[i], sx = Math.max(.02, Math.abs(Math.cos(f * Math.PI))), front = f >= .5;
  at(g, x, 480 + (o.dy || 0), 1, () => {
    if (!front) {
      box(g, -230, -260, 460, 520, col, { sh: 10 });
      disc(g, 120, -150, 70, col === C.yellow ? C.red : C.yellow, { sh: 0, lw: 4 });
      tri(g, -120, 160, 120, col === C.blue ? C.red : C.blue, { sh: 0, lw: 4 });
      text(g, String(i + 1), 0, 10, { f: 'disp', s: 220, w: 900, c: onCol(col) });
      return;
    }
    box(g, -230, -260, 460, 520, C.white, { sh: 10 });
    box(g, -230, -260, 460, 24, col, { sh: 0, lw: 4 });
    text(g, String(i + 1), -196, -186, { f: 'disp', s: 72, w: 900, a: 'left', c: col === C.yellow ? C.ink : col });
    text(g, t1, 0, -96, { s: 34, w: 900 }); text(g, t2, 0, -46, { s: 34, w: 900 });
    if (i === 0) {
      box(g, -170, 50, 140, 110, C.yellow, { sh: 5 }); text(g, 'JSON', -100, 106, { f: 'mono', s: 30, w: 700 });
      arrow(g, [[-18, 105], [40, 105]], { w: 6, hs: 18 });
      factory(g, 130, 170, .62, C.blue, lt);
      note(g, '配置', -100, 205, { s: 26, c: C.ink }); note(g, '工厂', 130, 205, { s: 26, c: C.ink });
    } else if (i === 1) {
      chipM(g, 'S?', -120, 80, { col: C.red, fs: 30 }); chipM(g, 'produce', 70, 80, { col: C.blue, fs: 30 });
      for (let k = 0; k < 3; k++) { const gx = -110 + k * 110; box(g, gx - 8, 140, 16, 70, C.ink, { sh: 0, lw: 0 }); box(g, gx + 8, 150, 70, 12, [C.red, C.yellow, C.blue][k], { sh: 0, lw: 3 }); }
      note(g, '失败各有归属', 0, 236, { s: 26, c: C.ink });
    } else {
      for (let c = 0; c < 3; c++) {
        const cx = -140 + c * 140; box(g, cx - 56, 40, 112, 150, C.white, { sh: 4 });
        for (let k = 0; k <= c; k++) { const lit = o.lit && c === 1 && k === 1; box(g, cx - 40, 56 + k * 40, 80, 30, lit ? C.yellow : [C.red, C.greyL, C.blue][k], { sh: 0, lw: 3 }); }
      }
      if (o.lit) box(g, -20, 70, 40, 40, C.yellow, { sh: 0, lw: 0, al: 0 });
      note(g, 'func 积木拼卡', 0, 230, { s: 26, c: C.ink });
    }
  }, { sx, al: o.al });
}
function takeawayAll(g, lt, cur, t0) {
  for (let i = 0; i < 3; i++) {
    const f = i < cur ? 1 : i === cur ? eio(seg(lt, t0, t0 + .6)) : 0, dim = i < cur ? .45 : 0;
    takeaway(g, i, f, lt, { al: 1 - dim, lit: i === 2 && lt > 5.4 && cur === 2 });
  }
}
S('s30', {
  card: 7,
  cam: [[0, 960, 520, 1], [11, 960, 520, 1]],
  cues: [[0, 'whoosh'], [2.0, 'block'], [2.15, 'block'], [2.3, 'block'], [2.6, 'snap']],
  draw(g, lt) {
    for (let i = 0; i < 3; i++) {
      const t1 = 1.6 + i * .15, [dy, sx] = landing(lt, t1, .4, -300); if (lt < t1) continue;
      const f = i === 0 ? eio(seg(lt, 2.6, 3.2)) : 0;
      at(g, 0, dy, 1, () => takeaway(g, i, f, lt), { sx: 1, sy: 1 });
    }
  },
});
S('s31', { cam: [[0, 960, 520, 1], [9, 960, 520, 1]], cues: [[.4, 'snap'], [4.8, 'gate', .5]], draw(g, lt) { takeawayAll(g, lt, 1, .4); } });
S('s32', { cam: [[0, 960, 520, 1], [9, 960, 520, 1]], cues: [[.4, 'snap'], [5.4, 'success']], draw(g, lt) { takeawayAll(g, lt, 2, .4); } });

/* =====================================================================
 * 结尾：还欠着的账
 * ===================================================================== */
S('s33', {
  cam: [[0, 960, 520, 1], [16, 960, 520, 1]],
  cues: [[.4, 'block'], [4.4, 'tick'], [8.8, 'whoosh'], [9.6, 'block'], [12.8, 'type']],
  draw(g, lt) {
    // 0~300 ms 表盘
    const gp = pop(seg(lt, .3, .8));
    at(g, 500, 600, gp, () => {
      half(g, 0, 0, 240, C.white, Math.PI, { sh: 9 });
      g.save(); g.beginPath(); g.arc(0, 0, 222, Math.PI, TAU); g.arc(0, 0, 176, TAU, Math.PI, true); g.closePath(); g.fillStyle = C.yellowL; g.fill(); g.restore();
      [0, 100, 200, 300].forEach((v, k) => { const a = Math.PI + Math.PI * v / 300; path(g, [[Math.cos(a) * 176, Math.sin(a) * 176], [Math.cos(a) * 222, Math.sin(a) * 222]], { w: 5 }); text(g, String(v), Math.cos(a) * 140, Math.sin(a) * 140 + (k === 0 || k === 3 ? -16 : 0), { f: 'disp', s: 26, w: 900 }); });
      const v = lt > 4.2 ? 150 - 150 * Math.cos((lt - 4.2) * 2.4) : 0, a = Math.PI + Math.PI * v / 300;
      path(g, [[0, 0], [Math.cos(a) * 200, Math.sin(a) * 200]], { w: 9, c: C.red });
      disc(g, 0, 0, 18, C.ink, { sh: 0, lw: 0 });
    });
    note(g, '单张卡片实例化', 500, 650, { s: 28, w: 900, c: C.ink, al: seg(lt, 4.2, 4.6) });
    text(g, '0 ~ 300 ms', 500, 720, { f: 'disp', s: 56, w: 900, al: seg(lt, 4.4, 4.8) });
    // 造卡链：“过滤”被挪到前面（待办）
    note(g, '造卡这条链', 1400, 220, { s: 28, w: 900, c: C.ink, al: seg(lt, .6, 1.0) });
    const mv = eio(seg(lt, 8.8, 10.0)), lift = Math.sin(mv * Math.PI) * 100;
    ST17.forEach(([, kind, col], i) => {
      let x = 1075 + i * 130, y = 330;
      if (i === 5) { x = lerp(1075 + 5 * 130, 1075 + 1.5 * 130, mv); y = 330 - lift; }
      else if (i >= 2) x += 130 * mv;
      at(g, x, y, pop(seg(lt, .6 + i * .08, 1.0 + i * .08)), () => { box(g, -48, -48, 96, 96, i === 5 ? C.white : C.paper2, { sh: i === 5 ? 6 : 3 }); stationIcon(g, kind, 0, 0, .7, i === 5 ? col : C.greyL); });
    });
    if (lt > 9.6) chipM(g, '待办：过滤器提前、合并', 1400, 450, { f: 'cjk', fs: 26, col: C.yellow, dash: [8, 6], p: seg(lt, 9.6, 10.0) });
    // JSON 难读
    if (lt > 12.2) {
      const jl = ['{ "cardType": "device",', '  "deviceTypes": ["AC"],', '  "styles": [ ... ] }'].map(t => ({ t, dim: true }));
      at(g, 1400, 640, .9 + .1 * pop(seg(lt, 12.2, 12.6)), () => ide(g, -340, -90, 680, 180, jl, { title: 'cardmapper.json', s: 24, lh: 40, lt, nums: false }), { al: seg(lt, 12.2, 12.4) });
      chipM(g, '难读 · 引用不了变量', 1230, 790, { f: 'cjk', fs: 24, col: C.red, p: seg(lt, 12.8, 13.2) });
      chipM(g, '设想：注解生成配置', 1590, 790, { f: 'cjk', fs: 24, col: C.white, dash: [8, 6], p: seg(lt, 13.6, 14.0) });
    }
  },
});

/* 片尾 */
S('s34', {
  title: true, fi: .2, fo: .4,
  draw(g, lt) {
    const a = pop(seg(lt, 0, .35));
    at(g, 560, 540, a, () => box(g, -70, -150, 140, 300, C.red, { sh: 8 }));
    at(g, 1380, 450, a, () => disc(g, 0, 0, 80, C.yellow, { sh: 8 }));
    at(g, 1420, 640, a, () => tri(g, 0, 0, 120, C.blue, { sh: 8 }));
    text(g, SERIES.title, 980, 500, { s: 110, w: 900, shc: C.yellow, shd: 6, al: eo(seg(lt, .1, .4)) });
    box(g, 760, 560, 440 * eio(seg(lt, .2, .6)), 12, C.ink, { sh: 0, lw: 0 });
    text(g, SERIES.sub, 980, 620, { s: 40, w: 700, c: C.blue, al: eo(seg(lt, .3, .6)) });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  miniBoard(g, 1010, 450, 10, 0, { cell: 70, ripple: false });
  const lines = [
    { t: '} else if (type == SCENE) {', k: '-' },
    { t: '} else if (type == DEVICE && model == AC) {', k: '-' },
    { t: '    cards += AcCardUiModel(card, parse(card))', k: '-' },
    { t: 'val card = cardFactoryManager.produceCard(panelCard)', k: '+' },
  ];
  ide(g, 70, 440, 880, 340, lines, { title: 'PanelViewModel.kt', tag: '示意', s: 24, lh: 62, lt: 1 });
  text(g, '约 500 行 if-else，拆成积木', 960, 190, { s: 128, w: 900, shc: C.yellow, shd: 9 });
  text(g, '看板卡片的工厂、配置与三层架构', 960, 318, { s: 54, w: 900, c: C.blue });
  box(g, 0, 880, W, 200, C.ink, { sh: 0, lw: 0 });
  [[C.red, 120], [C.yellow, 200], [C.blue, 280]].forEach(([c, x]) => box(g, x, 950, 56, 56, c, { sh: 0, lw: 0 }));
  text(g, '工作档案', 1800, 980, { s: 48, w: 900, c: '#fff', a: 'right' });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
