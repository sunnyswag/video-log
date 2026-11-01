/* =====================================================================
 * Claude 是怎么做这 8 期视频的 —— 场景编排（字幕数据在 script.js，图元在 kit.js）
 * 结构：0 开场、1 片名、2–6 五章、7 总结、8 系列片尾（audio.py / checks.cjs 按此读取）。
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]。画面动作按 CS(id) 给出的字幕起点对齐。
 * 本文件新增：监视墙、多轨时间线（真实时刻，断轴压缩中断）、导播台、联锁面板、云端分段进度、各幕编排。
 * 所有绘制只依赖时间 t。
 * ===================================================================== */
'use strict';
const CARD = { 2: '01', 3: '02', 4: '03', 5: '04', 6: '05', 7: '✓' };
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };
/* 8 期：slug、画风、成片时长（第 4 节表格）、批次 */
const EP = [
  { slug: 'sip-v3', style: '扁平 MG', dur: '7:17', sec: 437.0, b: 1 },
  { slug: 'curtain', style: '工程蓝图', dur: '7:31.7', sec: 451.7, b: 1 },
  { slug: 'taskqueue', style: '工厂流水线', dur: '6:00.5', sec: 360.5, b: 1 },
  { slug: 'cards', style: '包豪斯积木', dur: '7:22', sec: 442.0, b: 1 },
  { slug: 'subscription', style: '地铁线路图', dur: '4:44.8', sec: 284.8, b: 2 },
  { slug: 'jsruntime', style: '邮局 + 气动管道', dur: '4:53.4', sec: 293.4, b: 2 },
  { slug: 'frameanim', style: '胶片放映室', dur: '4:32', sec: 272.0, b: 2 },
  { slug: 'fps', style: '实验室仪表', dur: '2:05.6', sec: 125.6, b: 2 },
];
const EPI = Object.fromEntries(EP.map((e, i) => [e.slug, i]));

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
function screenSpace(g, fn) { g.save(); g.setTransform(SCX, 0, 0, SCX, 0, 0); const z = CAMZ; CAMZ = 1; try { fn(); } finally { CAMZ = z; g.restore(); } }

/* 章节转场：导播斜切划像（红色划像边）→ 场记牌落下、拍板 → 标题 → 划出 */
function chapterWipe(g, { sc, lt }) {
  const num = CARD[sc.card]; if (!num || lt > 1.95) return;
  const [full, en] = CHAPTERS[sc.card], zh = full.split('｜').pop();
  const pin = eio(seg(lt, 0, .36)), pout = eio(seg(lt, 1.42, 1.92));
  const x0 = lerp(-W - 420, -220, pin) + lerp(0, W + 640, pout);
  const band = new Path2D(); band.moveTo(x0, 0); band.lineTo(x0 + W + 420, 0); band.lineTo(x0 + W + 220, H); band.lineTo(x0 - 200, H); band.closePath();
  g.save();
  g.save(); shadow(g, .55, 40, 0); const lg = g.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#26303F'); lg.addColorStop(1, '#141A23'); g.fillStyle = lg; g.fill(band); g.restore();
  // 划像边框：红色亮边 + 光晕
  g.save(); g.beginPath(); g.moveTo(x0 + W + 420, 0); g.lineTo(x0 + W + 436, 0); g.lineTo(x0 + W + 236, H); g.lineTo(x0 + W + 220, H); g.closePath();
  g.shadowColor = rgba(C.red, .9); g.shadowBlur = 30 * SCX; g.fillStyle = C.red; g.fill(); g.restore();
  g.clip(band);
  for (let y = 30; y < H; y += 60) path(g, [[x0 - 200, y], [x0 + W + 440, y]], { c: 'rgba(255,255,255,.03)', w: 2 });
  for (let k = -2; k < 40; k++) { const xx = x0 - 200 + k * 64; path(g, [[xx, H], [xx + 200, 0]], { c: rgba(C.red, .07), w: 18 }); }
  const eg = g.createLinearGradient(x0 + W + 40, 0, x0 + W + 420, 0); eg.addColorStop(0, rgba(C.red, 0)); eg.addColorStop(1, rgba(C.red, .32)); g.fillStyle = eg; g.fillRect(x0 + W - 200, 0, 640, H);
  const a = eo(seg(lt, .28, .55)) * (1 - eo(seg(lt, 1.36, 1.58)));
  const drop = 1 - spring(seg(lt, .16, 1.1), 7, 1.1), open = 1 - eo(seg(lt, .62, .72));
  const tc = tcStr(sc.start + lt), scn = String(parseInt(sc.id.slice(1), 10)).padStart(2, '0');
  clapper(g, 560 - x0 * 0, 560 - drop * 700, 1.05, open, { ch: num, scene: scn, tc }, { al: a > 0 ? 1 : 0, rot: -.04 + .04 * (1 - open) });
  const dx = (1 - eo(seg(lt, .3, .7))) * 80;
  text(g, zh, 860 + dx, 500, { s: 92, w: 900, c: C.ink, a: 'left', al: a });
  text(g, en, 864 + dx * .6, 588, { f: 'mono', s: 30, w: 700, ls: 6, c: C.red, a: 'left', al: a });
  g.restore();
}

/* 外框：左上 PGM + 章节名；右上节目时间码 + 章节进度灯 + 演绎标记 */
const CH_SHORT = ['开场', '', '第一章 · 分工', '第二章 · 流水线', '第三章 · 四路并行', '第四章 · 卡住的地方', '第五章 · 第二批', '总结', ''];
function drawChrome(g, { sc, lt, t }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 150;
    card(g, 52, 40, w, 52, { r: 8, fill: 'rgba(14,19,26,.88)', lw: 2, stroke: 'rgba(255,255,255,.14)', sb: 12, so: 4 });
    rr(g, 52, 40, 92, 52, 8); g.fillStyle = C.red; g.fill();
    dot(g, 74, 66, 7, '#fff', .6 + .4 * Math.sin(t * 4));
    text(g, 'PGM', 88, 67, { f: 'mono', s: 24, w: 700, c: '#fff', a: 'left' });
    text(g, lab, 160, 67, { s: 26, w: 700, a: 'left' });
  }
  card(g, 1500, 40, 368, 52, { r: 8, fill: 'rgba(14,19,26,.88)', lw: 2, stroke: 'rgba(255,255,255,.14)', sb: 12, so: 4 });
  text(g, tcStr(t), 1524, 67, { f: 'mono', s: 26, w: 700, c: C.ink, a: 'left' });
  for (let k = 2; k <= 7; k++) { const x = 1712 + (k - 2) * 26; lamp(g, x, 66, 7, k === 7 ? C.green : C.red, sc.chapter === k ? 1 : sc.chapter > k ? .35 : 0, { halo: 2.6 }); }
  const demo = typeof sc.demo === 'function' ? sc.demo(lt) : sc.demo;
  if (demo) tagSmall(g, '⚠ 机制演绎', 1484, 66, C.amber, demo);
  g.restore();
}
function tagSmall(g, s, xr, y, c, al = 1) {
  const w = textW(g, s, { s: 24, w: 700 }) + 36;
  g.save(); g.globalAlpha *= clamp(+al);
  card(g, xr - w, y - 24, w, 48, { r: 8, fill: 'rgba(14,19,26,.9)', lw: 2.5, stroke: c, sb: 10, so: 3 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c });
  g.restore();
  return w;
}

/* 字幕：广播式下三分之一字幕条（深色条 + 左端节目红 + 右端小 tally），重点词着色；琥珀色加荧光底 */
function capState(g, frame) {
  const { sc, lt } = frame; if (sc.title || sc.noCaption || !sc.captions?.length) return null;
  const i = sc.cs.findIndex((s, k) => lt >= s && lt < sc.ce[k]); if (i < 0) return null;
  const c = { t0: sc.start + sc.cs[i], t1: sc.start + sc.ce[i], text: sc.captions[i].text }, layout = film.captionLayout(g, c, frame.t);
  if (!layout) return null;
  return { layout, alpha: Math.min(seg(lt, sc.cs[i], sc.cs[i] + .12), 1 - seg(lt, sc.ce[i] - .12, sc.ce[i])) };
}
function drawCaptionBackground(g, frame) {
  CAMZ = 1; const c = capState(g, frame); if (!c) return;
  const L = c.layout.lines, w = Math.max(...L.map(l => l.width)) + 120, top = L[0].y - 66, h = (L.length - 1) * 64 + 98, x = (W - w) / 2;
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .35));
  g.save(); g.globalAlpha *= c.alpha;
  shadow(g, .55, 26, 8); rr(g, x, top, w, h, 8); g.fillStyle = 'rgba(13,18,25,.95)'; g.fill(); noShadow(g);
  g.save(); rr(g, x, top, w, h, 8); g.clip();
  const lg = g.createLinearGradient(0, top, 0, top + h); lg.addColorStop(0, 'rgba(255,255,255,.07)'); lg.addColorStop(.5, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(x, top, w, h);
  g.fillStyle = C.red; g.fillRect(x, top, 14, h);
  if (k < 1) { const sx = x + w * k; const sg = g.createLinearGradient(sx - 160, 0, sx, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(255,255,255,.16)'); g.fillStyle = sg; g.fillRect(sx - 160, top, 160, h); }
  g.restore();
  rr(g, x, top, w, h, 8); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.16)'; g.stroke();
  lamp(g, x + w - 24, top + 22, 5.5, C.red, .9, { halo: 2.5 });
  g.restore();
}
function drawCaption(g, layout, frame) {
  if (frame.sc.title || frame.t >= layout.caption.t1) return;
  const k = eo(seg(frame.t, layout.caption.t0, layout.caption.t0 + .25));
  g.globalAlpha = Math.min(seg(frame.t, layout.caption.t0, layout.caption.t0 + .12), 1 - seg(frame.t, layout.caption.t1 - .12, layout.caption.t1));
  for (const l of layout.lines) {
    let x = l.x + 6;
    for (const s of l.segments) {
      const w = textW(g, s.s, { s: 54, w: 700 });
      if (s.c === C.amber) { rr(g, x - 3, l.y + 6 + (1 - k) * 8, w + 6, 12, 4); g.fillStyle = rgba(C.amber, .45); g.fill(); }
      text(g, s.s, x, l.y + (1 - k) * 8, { s: 54, w: 700, c: s.c || C.ink, a: 'left', b: 'alphabetic' });
      x += w;
    }
  }
}

/* ---------------- 场景注册 ---------------- */
let lastChapter = -1;
function S(id, o) {
  const d = SCRIPT[id];
  const first = d.chapter !== lastChapter;
  if (first) { film.chapter(d.chapter, ...CHAPTERS[d.chapter]); lastChapter = d.chapter; }
  return film.addScene({
    ...o, id, chapter: d.chapter, dur: d.dur, pre: 0, post: 0, card: first && CARD[d.chapter] ? d.chapter : undefined,
    demo: o.demo ?? d.demo,
    captions: d.caps.map(([t, end, text]) => ({ t, end, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t, type, v: v ?? 1 })),
    draw: (g, lt, sc) => o.draw(g, lt, sc),
  });
}
const CS = id => SCRIPT[id].caps.map(c => c[0]);
const CE = id => SCRIPT[id].caps.map(c => c[1]);

/* =====================================================================
 * 通用图元
 * ===================================================================== */
const ap = (lt, t0, d = .5) => pop(seg(lt, t0, t0 + d));
const fa = (lt, t0, d = .4) => eo(seg(lt, t0, t0 + d));
const fo = (lt, t0, d = .4) => 1 - eo(seg(lt, t0, t0 + d));
/* 监视墙：2×4，一期一格 */
const WALL = { x: 120, y: 150, w: 400, h: 225, gx: 40, gy: 76 };
function cellRect(i) { const c = i % 4, r = Math.floor(i / 4); return [WALL.x + c * (WALL.w + WALL.gx), WALL.y + r * (WALL.h + WALL.gy), WALL.w, WALL.h]; }
function cellMon(g, i, x, y, w, h, lt, o = {}) {
  const e = EP[i];
  monitor(g, x, y, w, h, { lt, tally: o.tally ?? null, label: o.label ?? e.slug, right: o.right ?? e.dur, seed: i, off: o.off, dim: o.dim,
    lfs: o.lfs, lf: o.lf, umd: o.umd, umdH: o.umdH, bw: o.bw }, (gg, ww, hh) => {
    if (o.freeze != null) thumb(gg, e.slug, ww, hh, o.freeze); else thumb(gg, e.slug, ww, hh, lt + i * 1.7);
    if (o.flash) { gg.fillStyle = `rgba(255,255,255,${clamp(o.flash)})`; gg.fillRect(0, 0, ww, hh); }
  });
}
function wall(g, lt, o = {}) {
  for (let i = 0; i < 8; i++) {
    const [x, y, w, h] = cellRect(i), s = o.scale ? o.scale(i) : 1, al = o.al ? o.al(i) : 1;
    if (al <= .001 || s <= .001) continue;
    const oo = o.cell ? o.cell(i) : {};
    at(g, x + w / 2, y + h / 2, s, () => cellMon(g, i, -w / 2, -h / 2, w, h, lt, { tally: o.tally ? o.tally(i) : 'grey', ...oo }), { al });
  }
}
/* 名牌标签（在监视器里用 CJK 字体） */
function speech(g, s, x, y, p, o = {}) { // 对话气泡（尾巴朝左下）
  at(g, x, y, pop(p), () => {
    const fs = o.fs || 32, w = textW(g, s, { s: fs, w: 900 }) + 56, h = fs + 40;
    g.save(); shadow(g, .45, 20, 8); rr(g, 0, -h / 2, w, h, 16); g.fillStyle = o.fill || '#F3E3C3'; g.fill();
    g.beginPath(); g.moveTo(16, h / 2 - 6); g.lineTo(-10, h / 2 + 18); g.lineTo(40, h / 2 - 6); g.closePath(); g.fill(); g.restore();
    text(g, s, w / 2, 1, { s: fs, w: 900, c: '#151A22' });
  }, { al: o.al });
}
/* 带执行者徽标的名字 */
function who(g, role, x, y, o = {}) {
  badge(g, role, x, y, o.r || 22, { al: o.al, s: o.s });
  text(g, o.name ?? ROLE[role][0], x + (o.r || 22) + 12, y + 1, { s: o.fs || 24, w: 700, c: ROLE[role][1], a: 'left', al: o.al });
}

/* =====================================================================
 * 开场
 * ===================================================================== */
const DAYS = [24, 25, 26, 27, 28, 29, 30, 31];
S('s01', {
  fi: .6,
  cam: [[0, 320, 262, 2.75], [1.0, 320, 262, 2.75], [4.6, 960, 540, 1], [22.3, 960, 540, 1.015]],
  cues: (() => { const c = CS('s01'); return [[.2, 'whoosh', .6], ...EP.map((_, i) => [c[0] + 1.2 + i * .32, 'blip', .7]), ...EP.map((_, i) => [c[2] + .3 + i * .3, 'tick', .6]), [c[2] + 2.8, 'latch'], ...DAYS.map((_, i) => [c[3] + .5 + i * .38, 'tick', .5]), [c[4] + .3, 'hit']]; })(),
  draw(g, lt) {
    const c = CS('s01');
    const greenAt = i => c[0] + 1.2 + i * .32, redAt = c[4] + .3;
    const addK = clamp((lt - c[2] - .3) / .3, 0, 8);
    wall(g, lt, {
      tally: i => lt >= redAt ? 'red' : lt >= greenAt(i) ? 'green' : 'grey',
      scale: i => 1 + .05 * Math.sin(clamp((lt - (c[2] + .3 + i * .3)) / .35) * Math.PI) + .04 * Math.sin(clamp((lt - redAt) / .4) * Math.PI),
      cell: i => ({ flash: Math.max(.5 * (1 - seg(lt, greenAt(i), greenAt(i) + .3)) * (lt >= greenAt(i) ? 1 : 0), .35 * (1 - seg(lt, redAt, redAt + .35)) * (lt >= redAt ? 1 : 0)) }),
    });
    // 控制台读数窗
    const pa = fa(lt, 3.6, .6);
    if (pa > 0) {
      g.save(); g.globalAlpha *= pa; g.translate(0, (1 - pa) * 30);
      steel(g, 120, 752, 1680, 120, { r: 12 });
      rr(g, 150, 770, 560, 84, 8); g.fillStyle = '#07090D'; g.fill();
      let tot = 0; for (let i = 0; i < 8; i++) tot += EP[i].sec * clamp(addK - i);
      text(g, '8 期成片合计', 176, 812, { s: 26, w: 700, c: C.ink2, a: 'left' });
      const lockK = seg(lt, c[2] + 2.8, c[2] + 3.1);
      text(g, tcStr(tot).slice(0, 8), 690, 813, { f: 'mono', s: 58, w: 700, c: lockK > 0 ? C.amber : C.ink, a: 'right', glow: rgba(C.amber, .5 * lockK), gb: 16 });
      // 日期条 10-24 → 10-31
      text(g, '10 月', 790, 812, { s: 26, w: 700, c: C.ink2, a: 'left' });
      DAYS.forEach((d, i) => {
        const x = 870 + i * 96, on = seg(lt, c[3] + .5 + i * .38, c[3] + .8 + i * .38);
        const col = i === 0 ? C.amber : i === 7 ? C.green : C.steel;
        rr(g, x, 780, 80, 64, 8); g.fillStyle = on > 0 ? rgba(col, .18 + .5 * on * (i === 0 || i === 7 ? 1 : .4)) : '#0B0F14'; g.fill();
        rr(g, x, 780, 80, 64, 8); g.lineWidth = 2; g.strokeStyle = on > 0 ? col : '#2A323E'; g.stroke();
        text(g, String(d), x + 40, 813, { f: 'mono', s: 30, w: 700, c: on > .5 ? C.ink : C.ink3 });
      });
      for (let k = 0; k < 6; k++) vu(g, 1660 + k * 20, 774, 12, 78, lt, k * 1.3, .9);
      g.restore();
    }
  },
});

/* =====================================================================
 * 片名
 * ===================================================================== */
S('s02', {
  title: true, fi: .3,
  cues: [[.3, 'clap'], [.55, 'whoosh'], [2.4, 'latch'], [4.0, 'type', .5]],
  draw(g, lt) {
    const on = lt >= .55, fl = 1 - seg(lt, .55, .9);
    monitor(g, 400, 120, 1120, 560, { lt, tally: on ? 'red' : 'grey', label: 'PGM · 节目', right: tcStr(lt + 22.3), umdH: 48, lfs: 26, rfs: 26, bw: 6 }, (gg, ww, hh) => {
      if (!on) { gg.fillStyle = '#05070A'; gg.fillRect(0, 0, ww, hh); return; }
      const lg = gg.createLinearGradient(0, 0, 0, hh); lg.addColorStop(0, '#1C2433'); lg.addColorStop(1, '#0C1018'); gg.fillStyle = lg; gg.fillRect(0, 0, ww, hh);
      for (const [cc, x, y] of [[C.red, 200, 120], [C.cyan, 900, 420]]) { const rg = gg.createRadialGradient(x + wob(lt, .1, 30), y, 0, x, y, 420); rg.addColorStop(0, rgba(cc, .18)); rg.addColorStop(1, rgba(cc, 0)); gg.fillStyle = rg; gg.fillRect(0, 0, ww, hh); }
      const L1 = 'Claude 是怎么做', L2 = '这 8 期视频的', o = { s: 104, w: 900 };
      [[L1, 214], [L2, 336]].forEach(([s, y], li) => {
        const chars = Array.from(s), tw = textW(gg, s, o); let x = ww / 2 - tw / 2;
        chars.forEach((ch, i) => {
          const w = textW(gg, ch, o), p = seg(lt, .7 + li * .45 + i * .04, 1.15 + li * .45 + i * .04);
          at(gg, x + w / 2, y + (1 - eo(p)) * 50, .6 + .4 * pop(p), () => text(gg, ch, 0, 0, { ...o, c: ch === '8' ? C.red : C.ink }), { al: eo(p) });
          x += w;
        });
      });
      const u = eio(seg(lt, 1.9, 2.5)); rr(gg, ww / 2 - 330, 402, 660 * u, 8, 4); gg.fillStyle = C.red; gg.fill();
      const sub = '分工 · 流水线 · 并行 · 卡住的地方', n = Array.from(sub).length, k = Math.round(n * seg(lt, 4.0, 5.4));
      text(gg, Array.from(sub).slice(0, k).join(''), ww / 2, 470, { s: 40, w: 700, c: C.cyan });
      if (fl > 0) { gg.fillStyle = `rgba(255,255,255,${fl * .85})`; gg.fillRect(0, 0, ww, hh); }
    });
    // 导播台：8 路预监键 + CUT
    steel(g, 290, 770, 1340, 112, { r: 12 });
    EP.forEach((e, i) => {
      const x = 316 + i * 134, lit = seg(lt, 2.6 + i * .12, 2.8 + i * .12);
      key(g, x, 798, 118, 56, String(i + 1), { on: lit * .9, col: C.green, fs: 28, f: 'disp' });
    });
    const pr = Math.sin(clamp((lt - .2) / .35) * Math.PI);
    key(g, 1428, 794, 180, 64, 'CUT', { on: lt > .3 ? 1 : .0, press: pr, col: C.red, fs: 30, f: 'disp', idle: true });
  },
});

/* =====================================================================
 * 第一章 分工
 * ===================================================================== */
const ROWY = { me: 200, lead: 360, sub: 552, ex: 770 }, SPX = 250;
S('s03', {
  cam: [[0, 960, 540, 1.015], [10, 960, 540, 1], [31, 960, 540, 1]],
  cues: (() => { const c = CS('s03'); return [[c[0], 'blip'], [c[0] + .8, 'latch', .6], [c[1], 'blip'], ...[0, 1, 2, 3].map(i => [c[2] + .2 + i * .35, 'latch', .6]), [c[3], 'blip'], ...[0, 1, 2, 3].map(i => [c[4] + .2 + i * .35, 'latch', .6]), [c[5], 'blip'], ...[0, 1, 2, 3].map(i => [c[6] + .2 + i * .35, 'latch', .6])]; })(),
  draw(g, lt) {
    const c = CS('s03');
    // 信号脊线：我 → 总负责人 → 子 agent → 执行者
    const segs = [[ROWY.me + 50, ROWY.lead - 50, c[1]], [ROWY.lead + 50, ROWY.sub - 50, c[3]], [ROWY.sub + 50, ROWY.ex - 46, c[5]]];
    segs.forEach(([y0, y1, t0]) => {
      const p = eo(seg(lt, t0 - .4, t0 + .2)); if (p <= 0) return;
      path(g, [[SPX, y0], [SPX, lerp(y0, y1, p)]], { c: rgba(C.steel, .5), w: 4 });
      if (p >= 1) for (let k = 0; k < 3; k++) { const u = ((lt * .6 + k / 3) % 1); dot(g, SPX, lerp(y0, y1, u), 5, C.coral, Math.sin(u * Math.PI)); }
    });
    const tagRow = (labels, x0, y, t0, col, gap = 24) => { let x = x0; labels.forEach((s, i) => { const w = textW(g, s, { s: 28, w: 900 }) + 40; tag(g, s, x + w / 2, y, col, seg(lt, t0 + i * .35, t0 + i * .35 + .45), { fs: 28 }); x += w + gap; }); };
    // 我
    if (lt > c[0]) {
      badge(g, 'me', SPX, ROWY.me, 48, { s: ap(lt, c[0]), glow: .8 });
      text(g, '我', 322, ROWY.me + 2, { s: 46, w: 900, a: 'left', c: ROLE.me[1], al: fa(lt, c[0] + .1) });
      tagRow(['拍板', '看片', '上传'], 640, ROWY.me, c[0] + .8, ROLE.me[1]);
    }
    // 总负责人
    if (lt > c[1]) {
      badge(g, 'lead', SPX, ROWY.lead, 48, { s: ap(lt, c[1]), glow: .8 });
      text(g, '总负责人', 322, ROWY.lead - 18, { s: 46, w: 900, a: 'left', c: ROLE.lead[1], al: fa(lt, c[1] + .1) });
      text(g, '主会话里的 Claude', 324, ROWY.lead + 30, { s: 26, w: 700, a: 'left', c: C.ink2, al: fa(lt, c[1] + .3) });
      tagRow(['规划', '派发', '验收', '机械收尾'], 640, ROWY.lead, c[2] + .2, ROLE.lead[1]);
    }
    // 子 agent：8 格小监视器
    if (lt > c[3]) {
      badge(g, 'sub', SPX, ROWY.sub, 48, { s: ap(lt, c[3]), glow: .8 });
      text(g, '子 agent', 322, ROWY.sub - 18, { s: 46, w: 900, a: 'left', c: ROLE.sub[1], al: fa(lt, c[3] + .1) });
      text(g, '每期一个 Claude', 324, ROWY.sub + 30, { s: 26, w: 700, a: 'left', c: C.ink2, al: fa(lt, c[3] + .3) });
      for (let i = 0; i < 8; i++) {
        const s = ap(lt, c[3] + .3 + i * .1);
        at(g, 702 + i * 142, ROWY.sub - 40, s, () => cellMon(g, i, -62, -35, 124, 70, lt, { tally: 'red', umd: false, bw: 3 }));
      }
      tagRow(['写稿', '画面', '动画代码', '配乐设计'], 640, ROWY.sub + 52, c[4] + .2, ROLE.sub[1]);
    }
    // 执行者
    if (lt > c[5]) {
      const p = eo(seg(lt, c[5] - .1, c[5] + .3));
      path(g, [[SPX, ROWY.ex - 46], [SPX, ROWY.ex - 52 + 0]], { c: rgba(C.steel, .5), w: 4, al: p });
      badge(g, 'codex', 206, ROWY.ex, 40, { s: ap(lt, c[5]), glow: .7 });
      badge(g, 'zcode', 296, ROWY.ex, 40, { s: ap(lt, c[5] + .15), glow: .7 });
      text(g, '执行者', 362, ROWY.ex - 18, { s: 46, w: 900, a: 'left', al: fa(lt, c[5] + .2) });
      text(g, 'Codex · ZCode', 364, ROWY.ex + 30, { s: 26, w: 700, a: 'left', c: C.ink2, al: fa(lt, c[5] + .3) });
      tagRow(['读材料', '核对', '检查脚本', '配乐代码'], 640, ROWY.ex, c[6] + .2, C.cyan);
      // 执行机柜指示灯
      for (let k = 0; k < 10; k++) lamp(g, 1500 + (k % 5) * 40, ROWY.ex - 18 + Math.floor(k / 5) * 36, 7, k % 2 ? C.violet : C.cyan, hash(Math.floor(lt * 5) + k * 3) > .45 ? 1 : .15, { al: fa(lt, c[6] + 1.6) });
    }
  },
});

S('s04', {
  cam: [[0, 960, 540, 1], [12, 960, 540, 1.015], [17, 960, 540, 1]],
  cues: (() => { const c = CS('s04'); return [[c[0] + .2, 'hit'], [c[1], 'blip'], [c[2] + .4, 'error'], [c[3], 'blip'], [c[3] + 1.2, 'success'], [c[4], 'whoosh'], [c[4] + .6, 'latch'], [c[5] + .2, 'latch']]; })(),
  draw(g, lt) {
    const c = CS('s04');
    // 规则铭牌：先在中央盖章，再缩到顶部
    const pk = eio(seg(lt, c[1] - .4, c[1] + .3)), ps = ap(lt, c[0] + .1, .5);
    if (ps > 0) at(g, 960, lerp(470, 168, pk), lerp(1, .52, pk) * ps, () => {
      steel(g, -420, -90, 840, 180, { r: 16, top: '#5A2A30', fill: '#3A1C22', bot: '#24121A' });
      rr(g, -400, -70, 800, 140, 10); g.lineWidth = 4; g.strokeStyle = C.red; g.stroke();
      text(g, '创意不外包', 0, 4, { s: 104, w: 900, c: C.ink, glow: rgba(C.red, .6), gb: 24 });
    });
    // 两台监视器 + 引语（第 5 句起上移淡出）
    const out = eio(seg(lt, c[4] - .2, c[4] + .5)), oy = -out * 60;
    g.save(); g.globalAlpha *= 1 - out; g.translate(0, oy);
    const ml = ap(lt, c[1], .5), mr = ap(lt, c[3], .5);
    if (ml > 0) at(g, 520, 420, ml, () => monitor(g, -320, -180, 640, 360, { lt, label: '试点 v1 · Codex 写', right: 'PVW', lfs: 26, rc: C.green }, (gg, ww, hh) => {
      gg.fillStyle = '#DCD8D0'; gg.fillRect(0, 0, ww, hh);
      const step = Math.floor(lt * 2) % 2;
      gg.fillStyle = '#9AA0AA'; gg.fillRect(70, 120, 140, 110); gg.fillRect(430, 120, 140, 110);
      gg.fillStyle = '#6B7280'; gg.fillRect(210, 172, 220, 6);
      gg.fillStyle = '#5B6CC0'; gg.fillRect(step ? 330 : 240, 150, 50, 30);
    }));
    if (mr > 0) at(g, 1400, 420, mr, () => monitor(g, -320, -180, 640, 360, { lt, label: '试点 v2 · Claude 写', right: 'PGM', lfs: 26, rc: C.red }, (gg, ww, hh) => thumb(gg, 'sip-v3', ww, hh, lt * 1.2)));
    const quote = (s, x, col, t0) => { const p = ap(lt, t0, .5); if (p <= 0) return; at(g, x, 700, p, () => {
      const w = textW(g, s, { s: 40, w: 900 }) + 80; card(g, -w / 2, -46, w, 92, { r: 12, fill: '#10151D', lw: 3, stroke: col }); text(g, s, 0, -2, { s: 40, w: 900, c: col });
      text(g, '—— 我', w / 2 - 20, 66, { s: 24, w: 700, c: C.ink2, a: 'right' }); }); };
    quote('“差距很大”', 520, C.red, c[2] + .3);
    quote('“动画效果没有任何问题”', 1400, C.green, c[3] + 1.1);
    g.restore();
    // 两栏：留给 Claude / 交给执行者
    if (lt > c[4] - .1) {
      const col = (x, t0, head, roles, items, cc) => {
        const p = eo(seg(lt, t0, t0 + .5)); if (p <= 0) return;
        g.save(); g.globalAlpha *= p; g.translate(0, (1 - p) * 40);
        steel(g, x, 270, 700, 560, { r: 16 });
        roles.forEach((r, i) => badge(g, r, x + 64 + i * 78, 336, 30));
        text(g, head, x + 64 + roles.length * 78 - 10, 338, { s: 40, w: 900, a: 'left', c: cc });
        path(g, [[x + 30, 392], [x + 670, 392]], { c: rgba(C.steel, .25), w: 2 });
        items.forEach((s, i) => { const q = ap(lt, t0 + .4 + i * .3, .4); if (q <= 0) return;
          at(g, x + 70, 450 + i * 74, q, () => { dot(g, 0, 0, 10, cc); }); text(g, s, x + 100, 452 + i * 74, { s: 36, w: 700, a: 'left', al: q }); });
        g.restore();
      };
      col(220, c[4] + .1, '留给 Claude', ['sub'], ['稿子、分镜', '画面设计', '动画代码', '配乐设计'], C.coral);
      col(1000, c[5], '交给执行者', ['codex', 'zcode'], ['读材料、提炼', '事实核对', '检查脚本', '照设计写配乐代码'], C.cyan);
    }
  },
});

/* =====================================================================
 * 第二章 流水线
 * ===================================================================== */
const PIPE = [
  ['01', '知识点总结', 'zcode', 'ZCode'], ['02', '视频稿', 'sub', 'Claude'], ['03', '事实核对', 'zcode', 'ZCode'], ['04', '风格包 + 动画代码', 'sub', 'Claude'],
  ['05', '自动检查', 'codex', 'Codex'], ['06', '配乐设计', 'sub', 'Claude'], ['07', 'audio.py', 'codex', 'Codex'], ['08', '三轮审阅', 'sub', 'Claude'],
  ['09', '云端 4K 渲染', 'ci', 'GitHub Actions'], ['10', '校验 · 上传', 'lead', '总负责人 · 我'],
];
const pipePos = i => i < 5 ? [270 + i * 345, 300] : [270 + (9 - i) * 345, 640];
const PIPE_PTS = [...[0, 1, 2, 3, 4].map(pipePos), [1850, 300], [1850, 640], ...[5, 6, 7, 8, 9].map(pipePos)];
const PIPE_U = (() => { const L = [0]; for (let i = 1; i < PIPE_PTS.length; i++) L.push(L[i - 1] + Math.hypot(PIPE_PTS[i][0] - PIPE_PTS[i - 1][0], PIPE_PTS[i][1] - PIPE_PTS[i - 1][1]));
  const tot = L[L.length - 1], idx = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11]; return idx.map(k => L[k] / tot); })();
function pipeModule(g, i, lit, lt, o = {}) {
  const [num, name, role, rn] = PIPE[i], [x, y] = pipePos(i), col = ROLE[role][1];
  at(g, x, y, o.s ?? 1, () => {
    if (lit > 0) { g.save(); rr(g, -150, -85, 300, 170, 14); g.shadowColor = rgba(col, .7 * lit); g.shadowBlur = 34 * SH(); g.fillStyle = rgba(col, .25); g.fill(); g.restore(); }
    steel(g, -150, -85, 300, 170, { r: 14, screws: false, shadow: false });
    if (lit > 0) { rr(g, -150, -85, 300, 170, 14); g.lineWidth = 3; g.strokeStyle = rgba(col, lit); g.stroke(); }
    text(g, num, -126, -54, { f: 'disp', s: 30, w: 900, a: 'left', c: lit > .5 ? col : C.ink3 });
    badge(g, role, 116, -52, 20, { al: .45 + .55 * lit });
    text(g, name, 0, 8, { s: name.length > 6 ? 28 : 32, w: 900, c: lit > .3 ? C.ink : C.ink2, f: name === 'audio.py' ? 'mono' : 'cjk' });
    text(g, rn, 0, 52, { s: 24, w: 700, c: rgba(col, .45 + .55 * lit) });
    if (o.rounds) for (let k = 0; k < 3; k++) { const q = seg(lt, o.rounds + k * .7, o.rounds + k * .7 + .3); lamp(g, -30 + k * 30, -54, 6, C.green, q, { halo: 2.5 }); }
  }, { al: o.al });
}
S('s05', {
  cam: [[0, 960, 540, 1], [34.8, 960, 540, 1.015]],
  cues: (() => { const c = CS('s05'); return [[c[0] + .2, 'whoosh', .6], [c[1] + .6, 'blip'], [c[2] + .6, 'blip'], [c[2] + 2.2, 'blip'], [c[3] + .6, 'blip'], [c[4] + .6, 'blip'], [c[5] + .6, 'blip'], [c[5] + 2.4, 'blip'], [c[6] + .6, 'blip'], ...[0, 1, 2].map(k => [c[6] + 1.4 + k * .7, 'tick', .6])]; })(),
  draw(g, lt) {
    const c = CS('s05');
    const litAt = [c[1] + .6, c[2] + .6, c[2] + 2.2, c[3] + .6, c[4] + .6, c[5] + .6, c[5] + 2.4, c[6] + .6, 1e9, 1e9];
    const draw = eo(seg(lt, c[0], c[0] + 2.4));
    path(g, partial(PIPE_PTS, draw), { c: '#0B0F14', w: 14 });
    path(g, partial(PIPE_PTS, draw), { c: rgba(C.steel, .35), w: 5, dash: [2, 12], off: -lt * 30 });
    // 光点：从上一个点亮的模块流到下一个
    for (let i = 1; i < 8; i++) {
      const k = seg(lt, litAt[i] - .6, litAt[i]); if (k <= 0 || k >= 1) continue;
      const u = lerp(PIPE_U[i - 1], PIPE_U[i], eio(k)), q = partial(PIPE_PTS, u), p = q[q.length - 1];
      dot(g, p[0], p[1], 12, ROLE[PIPE[i][2]][1]); ring(g, p[0], p[1], 20, ROLE[PIPE[i][2]][1], 3, .5);
    }
    for (let i = 0; i < 10; i++) {
      const s = ap(lt, c[0] + .1 + i * .12, .45), lit = fa(lt, litAt[i], .3), pulse = i === 8 ? .5 * fa(lt, c[6] + 3.4) * (.6 + .4 * Math.sin(lt * 5)) : 0;
      pipeModule(g, i, Math.max(lit, pulse), lt, { s: s * (1 + .06 * Math.sin(clamp((lt - litAt[i]) / .35) * Math.PI)), rounds: i === 7 ? c[6] + 1.4 : 0 });
    }
  },
});

const FILM_LEN = (() => { const s = Object.values(SCRIPT).reduce((a, d) => a + d.dur, 0); return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; })();
/* ---------------- render(t)：纯函数，切段并行 ---------------- */
const CODE6 = ['function render(canvas, t) {', '  const sc = sceneAt(t);', '  drawBackground(g, t);', '  sc.draw(g, t - sc.start);', '  drawCaptions(g, t);', '}', '// 只读 t，不读上一帧'];
const TOK6 = /(\bfunction\b|\bconst\b|\brender\b|\bsceneAt\b|\bdrawBackground\b|\bdrawCaptions\b|\bdraw\b|\bt\b)/;
function codeLine(g, s, x, y, n) {
  const vis = Array.from(s).slice(0, n).join('');
  if (s.startsWith('//')) { text(g, vis, x, y, { f: 'mono', s: 28, w: 400, c: C.ink3, a: 'left' }); return; }
  let xx = x;
  for (const p of vis.split(TOK6)) {
    if (!p) continue;
    const col = /^(function|const)$/.test(p) ? C.violet : /^(render|sceneAt|drawBackground|drawCaptions|draw)$/.test(p) ? C.cyan : p === 't' ? C.amber : C.ink;
    text(g, p, xx, y, { f: 'mono', s: 28, w: 700, c: col, a: 'left' }); xx += textW(g, p, { f: 'mono', s: 28, w: 700 });
  }
}
const FR6 = i => [980 + i * 142, 226];
function frame6(g, i, x, y, o = {}) { // 一格画面：小球位置只由 t = i/30 决定
  at(g, x + 65, y + 45, o.s ?? 1, () => {
    rr(g, -65, -45, 130, 90, 6); g.fillStyle = '#0B0F14'; g.fill(); rr(g, -65, -45, 130, 90, 6); g.lineWidth = 2.5; g.strokeStyle = o.hl ? C.cyan : '#3A4656'; g.stroke();
    for (let k = 0; k < 4; k++) dot(g, -50 + (i - k) * 16, -6 + Math.sin((i - k) * .9) * 16, 7 - k * 1.4, C.coral, k ? .25 : 1);
    path(g, [[-58, 30], [58, 30]], { c: rgba(C.steel, .2), w: 2 });
  }, { al: o.al });
}
S('s06', {
  cam: [[0, 960, 540, 1], [18.4, 960, 540, 1.015]],
  cues: (() => { const c = CS('s06'); return [...CODE6.map((_, i) => [c[0] + .2 + i * .42, 'type', .45]), [c[1] + .4, 'blip'], [c[1] + 1.6, 'error', .5], ...[0, 1, 2, 3, 4, 5].map(k => [c[2] + .5 + k * .45, 'tick', .55]), [c[2] + 3.4, 'success', .6], ...Array.from({ length: 9 }, (_, k) => [c[3] + .4 + k * .16, 'snip', .5]), [c[3] + 2.4, 'whoosh', .6]]; })(),
  draw(g, lt) {
    const c = CS('s06');
    // 代码卡
    const ca = fa(lt, .1, .5);
    g.save(); g.globalAlpha *= ca;
    steel(g, 110, 160, 790, 400, { r: 14 });
    rr(g, 130, 180, 750, 360, 8); g.fillStyle = '#0A0D12'; g.fill();
    for (let k = 0; k < 3; k++) dot(g, 156 + k * 22, 204, 6, [C.red, C.amber, C.green][k], .8);
    CODE6.forEach((ln, i) => { const t0 = c[0] + .2 + i * .42, n = Math.round(Array.from(ln).length * seg(lt, t0, t0 + .4)); if (n > 0) codeLine(g, ln, 160, 256 + i * 44, n); });
    const cur = Math.floor(lt * 2) % 2 && lt < c[0] + 3.4; if (cur) { const i = Math.min(6, Math.floor((lt - c[0] - .2) / .42)); if (i >= 0) { g.fillStyle = C.ink; g.fillRect(160 + textW(g, CODE6[i], { f: 'mono', s: 28, w: 700 }) + 4, 240 + i * 44, 14, 30); } }
    g.restore();
    // 胶片带：6 格，t = i/30
    for (let i = 0; i < 6; i++) {
      const [x, y] = FR6(i), s = ap(lt, c[0] + .3 + i * .12, .45), hl = i === 3 && lt > c[1] && lt < c[2];
      const lift = i === 3 ? -24 * eo(seg(lt, c[1] + .2, c[1] + .6)) * (1 - eo(seg(lt, c[2] - .3, c[2]))) : 0;
      frame6(g, i, x, y + lift, { s, hl });
      text(g, 't=' + (i / 30).toFixed(3), x + 65, y + 116, { f: 'mono', s: 24, w: 700, c: hl ? C.amber : C.ink2, al: s });
    }
    // 第二句：这一格只连回 t
    const k2 = fa(lt, c[1] + .4) * fo(lt, c[2] - .2);
    if (k2 > 0) {
      const [x3, y3] = FR6(3);
      tag(g, 't = 0.100', x3 + 65, 160, C.amber, seg(lt, c[1] + .3, c[1] + .7), { fs: 26, f: 'mono', al: k2 });
      arrow(g, [[x3 + 65, 182], [x3 + 65, y3 - 30]], { p: eo(seg(lt, c[1] + .6, c[1] + 1.0)), c: C.amber, w: 4, hs: 14, al: k2 });
      const [x2, y2] = FR6(2), pts = []; for (let k = 0; k <= 16; k++) { const u = k / 16; pts.push([lerp(x2 + 65, x3 + 65, u), y2 + 150 + Math.sin(u * Math.PI) * 22]); }
      path(g, partial(pts, eo(seg(lt, c[1] + 1.2, c[1] + 1.6))), { c: C.ink3, w: 3, dash: [8, 8], al: k2 });
      g.save(); g.globalAlpha *= k2; icCross(g, (x2 + x3) / 2 + 65, y2 + 172, 30, C.red, seg(lt, c[1] + 1.6, c[1] + 1.9), 6); g.restore();
      text(g, '不读上一帧', (x2 + x3) / 2 + 65, y2 + 214, { s: 26, w: 700, c: C.red, al: k2 * fa(lt, c[1] + 1.7) });
    }
    // 第三句：乱序再画一遍，结果一样
    const k3 = fa(lt, c[2]) * fo(lt, c[3] + .1);
    if (k3 > 0) {
      text(g, '乱序渲染', 960, 474, { s: 26, w: 700, c: C.ink2, a: 'right', al: k3 });
      [3, 0, 5, 1, 4, 2].forEach((i, ord) => {
        const t0 = c[2] + .5 + ord * .45, [x] = FR6(i), y = 440, p = seg(lt, t0, t0 + .35);
        if (p <= 0) return;
        frame6(g, i, x, y + (1 - eo(p)) * 40, { al: eo(p) * k3 });
        at(g, x + 16, y + 14, pop(p), () => { dot(g, 0, 0, 19, C.violet); text(g, String(ord + 1), 0, 1, { f: 'disp', s: 26, w: 900, c: '#10151C' }); }, { al: k3 });
        if (lt > t0 + .4) { g.save(); g.globalAlpha *= k3; dot(g, x + 118, y + 80, 15, C.green); icCheck(g, x + 118, y + 81, 18, '#10151C', seg(lt, t0 + .4, t0 + .6), 4); g.restore(); }
      });
    }
    // 第四句：切 10 段，交给 10 台机器
    if (lt > c[3] - .2) {
      const x0 = 160, x1 = 1760, y = 640, bw = (x1 - x0) / 10, gap = 14 * eo(seg(lt, c[3] + 2.0, c[3] + 2.4));
      const a = fa(lt, c[3] - .2);
      text(g, '全片', x0, y - 30, { s: 26, w: 700, c: C.ink2, a: 'left', al: a });
      text(g, '0:00', x0 + 70, y - 30, { f: 'mono', s: 24, w: 700, c: C.ink3, a: 'left', al: a });
      text(g, FILM_LEN, x1, y - 30, { f: 'mono', s: 24, w: 700, c: C.ink3, a: 'right', al: a });
      for (let k = 0; k < 10; k++) {
        const fl = eio(seg(lt, c[3] + 2.4 + k * .07, c[3] + 3.1 + k * .07)), rx = 160 + k * 164, ry = 790;
        const sx = lerp(x0 + k * bw + (k - 4.5) * gap * .2, rx, fl), sy = lerp(y, ry - 34, fl), sw = lerp(bw - 4, 132, fl), sh = lerp(44, 18, fl);
        g.save(); g.globalAlpha *= a; rr(g, sx, sy, sw, sh, 6); g.fillStyle = rgba(C.blue, .55 + .45 * fl); g.fill(); g.restore();
        if (k > 0) { const cx = x0 + k * bw, p = eo(seg(lt, c[3] + .4 + (k - 1) * .16, c[3] + .6 + (k - 1) * .16)) * (1 - fl); if (p > 0) path(g, [[cx, y - 14], [cx, lerp(y - 14, y + 58, p)]], { c: C.red, w: 3, dash: [6, 6] }); }
        const rp = ap(lt, c[3] + 2.2 + k * .05, .4);
        if (rp > 0) at(g, rx + 66, ry + 22, rp, () => {
          card(g, -66, -24, 132, 66, { r: 10, fill: C.slot, lw: 2, stroke: '#3A4656' });
          text(g, String(k + 1), -32, 9, { f: 'disp', s: 34, w: 900, c: C.ink });
          lamp(g, 30, 9, 7, C.blue, fl > .95 ? .6 + .4 * Math.sin(lt * 8 + k) : .15, { halo: 2.5 });
        });
      }
    }
  },
});

/* ---------------- 10 段并行 → assemble → 校验 → D 盘 ---------------- */
const SEGS = [275, 381, 335, 244, 249, 337, 291, 349, 365, 252], ASM_END = 809;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
S('s07', {
  cam: [[0, 960, 540, 1.015], [16.3, 960, 540, 1]],
  cues: (() => { const c = CS('s07'); const r = []; SEGS.slice().sort((a, b) => a - b).forEach(d => r.push([c[0] + .2 + (d + 29 - 27) / 360 * 3.4, 'tick', .5])); return [...r, [c[1] + .2, 'whoosh', .6], [c[1] + 2.0, 'latch'], ...[0, 1, 2, 3].map(k => [c[2] + .3 + k * .55, 'latch', .6]), [c[3] + .9, 'success']]; })(),
  draw(g, lt) {
    const c = CS('s07');
    const real = lt < c[1] ? clamp(27 + (lt - c[0] - .2) / 3.4 * 360, 0, 400) : lerp(400, ASM_END, seg(lt, c[1] + .4, c[1] + 2.0));
    const out = fo(lt, c[2] - .2, .5);
    g.save(); g.globalAlpha *= out;
    steel(g, 120, 140, 1680, 600, { r: 14 });
    text(g, '试点 v2 · 4K 全片 · 10 段（示例运行）', 160, 186, { s: 30, w: 900, a: 'left' });
    text(g, 'GitHub Actions', 760, 188, { f: 'mono', s: 24, w: 700, c: C.blue, a: 'left' });
    rr(g, 1600, 160, 170, 52, 8); g.fillStyle = '#07090D'; g.fill();
    text(g, mmss(real), 1755, 188, { f: 'mono', s: 34, w: 700, c: real >= ASM_END ? C.green : C.amber, a: 'right' });
    const col = eio(seg(lt, c[1] - .1, c[1] + .5));
    SEGS.forEach((d, i) => {
      const y = lerp(240 + i * 48, 672, col), p = clamp((real - 29) / d), a = 1 - col * .85;
      g.save(); g.globalAlpha *= a;
      text(g, '段 ' + String(i + 1).padStart(2, '0'), 160, y + 12, { f: 'mono', s: 26, w: 700, c: C.ink2, a: 'left' });
      bar(g, 290, y, 1160, 24, p, p >= 1 ? C.blue : rgba(C.blue, .8), { lt });
      if (p >= 1) text(g, '✓ ' + mmss(d), 1480, y + 12, { f: 'mono', s: 26, w: 700, c: C.green, a: 'left' });
      else if (p > 0) text(g, Math.floor(p * 100) + '%', 1480, y + 12, { f: 'mono', s: 26, w: 700, c: C.ink3, a: 'left' });
      g.restore();
    });
    if (lt > c[1]) {
      const p = seg(lt, c[1] + .4, c[1] + 2.0);
      text(g, 'assemble', 160, 684, { f: 'mono', s: 26, w: 700, c: C.amber, a: 'left', al: fa(lt, c[1] + .3) });
      bar(g, 290, 672, 1160, 24, p, C.amber, { lt });
    }
    g.restore();
    // 成片带
    const chipP = ap(lt, c[1] + 2.0, .5), mv = eio(seg(lt, c[3] + .1, c[3] + .9));
    if (chipP > 0 && mv < 1) at(g, lerp(960, 1525, mv), lerp(800, 795, mv), chipP * lerp(1, .3, mv), () => {
      card(g, -330, -40, 660, 80, { r: 12, fill: '#10151D', lw: 3, stroke: C.amber });
      dot(g, -290, 0, 16, C.amber); dot(g, -290, 0, 6, '#10151D');
      text(g, '成片 mp4 · 3840×2160 · 30 fps', 16, 2, { s: 30, w: 900, c: C.ink });
    });
    // 校验清单
    const ck = fa(lt, c[2]) * 1;
    if (ck > 0 && lt > c[2] - .1) {
      const items = ['分辨率 3840 × 2160', '像素格式 yuv420p · 30 fps', '帧数 = 时长 × 30', '响度 ≈ −24.4 dB'];
      items.forEach((s, k) => { const t0 = c[2] + .3 + k * .55, p = ap(lt, t0, .4); if (p <= 0) return;
        at(g, 600, 250 + k * 92, p, () => { dot(g, 0, 0, 26, C.green); icCheck(g, 0, 2, 30, '#10151C', seg(lt, t0 + .1, t0 + .4), 6); });
        text(g, s, 650, 252 + k * 92, { s: 40, w: 900, a: 'left', al: p });
      });
    }
    // D 盘抽屉 + 我
    if (lt > c[3] - .2) {
      const a = fa(lt, c[3] - .2), on = lt > c[3] + .9;
      g.save(); g.globalAlpha *= a;
      steel(g, 1380, 740, 360, 110, { r: 12 });
      rr(g, 1410, 772, 230, 46, 8); g.fillStyle = '#07090D'; g.fill();
      text(g, 'D 盘', 1690, 796, { s: 32, w: 900, c: on ? C.green : C.ink });
      if (on) text(g, '成片 ✓', 1525, 796, { s: 26, w: 900, c: C.green, al: fa(lt, c[3] + .9) });
      lamp(g, 1398, 756, 6, C.green, on ? 1 : 0, { halo: 3 });
      g.restore();
      badge(g, 'me', 1560, 620, 40, { s: ap(lt, c[3] + 1.0), glow: .6 });
      tag(g, '看过再上传', 1560, 545, ROLE.me[1], seg(lt, c[3] + 1.3, c[3] + 1.7), { fs: 28 });
    }
  },
});

/* =====================================================================
 * 第三章 四路并行
 * ===================================================================== */
const EPC = ['#6F95FF', '#7FD6FF', '#F7B900', '#FF6A55', '#3CC46F', '#D9A64A', '#E8835F', '#A994FF'];
function handbook(g, x, y, s, o = {}) {
  at(g, x, y, s, () => {
    card(g, -120, -160, 240, 320, { r: 10, fill: '#2E3B52', lw: 3, stroke: '#0B0F15', sa: .55, sb: 30, so: 12 });
    rr(g, -120, -160, 34, 320, 8); g.fillStyle = '#1D2636'; g.fill();
    for (let k = 0; k < 4; k++) ring(g, -103, -112 + k * 74, 10, '#B8C4D4', 4, 1, 0, TAU);
    rr(g, -70, -120, 170, 6, 3); g.fillStyle = C.red; g.fill();
    if (!o.mini) text(g, 'WorkArchive', 15, -80, { f: 'mono', s: 24, w: 700, c: C.ink2 });
    text(g, '批量制作', 15, -18, { s: 40, w: 900, c: C.ink });
    text(g, '手册', 15, 36, { s: 40, w: 900, c: C.ink });
    for (let k = 0; k < 3; k++) rr(g, -60, 84 + k * 22, 150 - k * 30, 8, 4), g.fillStyle = rgba(C.steel, .25), g.fill();
  }, { al: o.al, rot: o.rot });
}
S('s08', {
  cam: [[0, 960, 540, 1], [19.1, 960, 540, 1.015]],
  cues: (() => { const c = CS('s08'); return [[c[0] - .4, 'draw', .5], ...EP.map((_, i) => [c[0] + .2 + i * .18, 'blip', .5]), ...Array.from({ length: 10 }, (_, k) => [c[1] + .3 + k * .3, 'tick', .45]), [c[2] + .5, 'hit', .7], ...[0, 1, 2, 3].map(k => [c[3] + .3 + k * .45, 'latch', .6])]; })(),
  draw(g, lt) {
    const c = CS('s08');
    const tp = eo(seg(lt, 1.4, 2.2));
    text(g, 'main', 180, 140, { f: 'mono', s: 28, w: 700, al: tp });
    path(g, [[180, 166], [180, lerp(166, 830, tp)]], { c: C.ink, w: 6 });
    EP.forEach((e, i) => {
      const y = 200 + i * 84, t0 = c[0] + .2 + i * .18, p = eo(seg(lt, t0, t0 + .7)), col = EPC[i];
      if (p <= 0) return;
      const pts = [[180, y - 40]]; for (let k = 1; k <= 8; k++) { const u = k / 8; pts.push([lerp(180, 262, u), lerp(y - 40, y, 1 - (1 - u) * (1 - u))]); } pts.push([1040, y]);
      path(g, partial(pts, p), { c: col, w: 5 });
      text(g, 'ep/' + e.slug, 290, y - 22, { f: 'mono', s: 24, w: 700, c: col, a: 'left', al: fa(lt, t0 + .3) });
      // 提交点
      for (let k = 0; k < 5; k++) { const tc = c[1] + .2 + hash(i * 5 + k * 1.7) * 3.0 + k * .1; if (lt < tc) continue; const q = lt - tc; dot(g, 640 + k * 90, y, 9 * pop(seg(q, 0, .3)), col); ripple(g, 640 + k * 90, y, q, col, 10, 34, .5); }
      const fp = ap(lt, t0 + .4, .45);
      if (fp > 0) at(g, 1270, y, fp, () => { card(g, -210, -28, 420, 56, { r: 8, fill: C.slot, lw: 2, stroke: rgba(col, .6), sb: 10, so: 4 }); text(g, '~/video-log-wt/' + e.slug, -190, 1, { f: 'mono', s: 24, w: 700, a: 'left', c: C.ink2 }); });
    });
    // 同一本手册
    if (lt > c[2]) {
      const d = 1 - spring(seg(lt, c[2] + .1, c[2] + 1.2), 7, 1.1);
      EP.forEach((_, i) => { const y = 200 + i * 84, p = eo(seg(lt, c[2] + .6 + i * .05, c[2] + 1.1 + i * .05)); if (p > 0) path(g, partial([[1560, 420], [1480, y]], p), { c: rgba(C.steel, .45), w: 2.5, dash: [4, 8], off: -lt * 20 }); });
      handbook(g, 1680, 420 - d * 700, 1, { rot: .03 * Math.sin(lt * .8) });
      ['写稿标准', '画面标准', '派发方法', '已知的坑'].forEach((s, k) => tag(g, s, 1680, 652 + k * 58, [C.amber, C.cyan, C.violet, C.red][k], seg(lt, c[3] + .3 + k * .45, c[3] + .7 + k * .45), { fs: 28 }));
    }
  },
});

/* 8 种画风：镜头扫过监视墙 */
S('s09', {
  cam: (() => { const c = CS('s09'); return [[0, 960, 540, 1], [c[1] - .3, 960, 540, 1], [c[1] + .3, 520, 300, 1.55], [c[1] + 4.6, 1400, 300, 1.55], [c[2] + .2, 520, 600, 1.55], [c[2] + 4.4, 1400, 600, 1.55], [SCRIPT.s09.dur, 960, 540, 1]]; })(),
  cues: (() => { const c = CS('s09'); return [...[0, 1, 2, 3].map(i => [c[1] + .3 + i * 1.25, 'blip']), ...[0, 1, 2, 3].map(i => [c[2] + .3 + i * 1.2, 'blip'])]; })(),
  draw(g, lt) {
    const c = CS('s09');
    const nAt = i => i < 4 ? c[1] + .3 + i * 1.25 : c[2] + .3 + (i - 4) * 1.2;
    wall(g, lt, {
      tally: i => lt >= nAt(i) ? 'red' : 'green',
      scale: i => 1 + .07 * Math.sin(clamp((lt - nAt(i)) / .45) * Math.PI),
      cell: i => ({ label: lt >= nAt(i) + .15 ? EP[i].style : EP[i].slug, lf: lt >= nAt(i) + .15 ? 'cjk' : 'mono', lfs: lt >= nAt(i) + .15 ? 26 : 24, right: '', flash: .4 * (1 - seg(lt, nAt(i), nAt(i) + .3)) * (lt >= nAt(i) ? 1 : 0) }),
    });
  },
});

/* 停止点：第一批的节目单 */
const RUN_STEPS = ['稿', '核对', '样片', '全部画面', '配乐', '成片'];
S('s10', {
  cam: [[0, 960, 540, 1.015], [13.1, 960, 540, 1]],
  cues: (() => { const c = CS('s10'); return [...RUN_STEPS.map((_, j) => [c[1] + .2 + j * .32, 'tick', .55]), [c[1] + 2.2, 'success', .6], [c[2] + 1.1, 'latch'], [c[2] + 1.3, 'latch'], [c[2] + 1.5, 'latch'], [c[2] + 2.2, 'blip']]; })(),
  draw(g, lt) {
    const c = CS('s10');
    RUN_STEPS.forEach((s, j) => text(g, s, 490 + j * 196, 196, { s: 26, w: 700, c: C.ink2, al: fa(lt, .3 + j * .08) }));
    ['sip-v3', 'curtain', 'taskqueue', 'cards'].forEach((slug, r) => {
      const y = 280 + r * 140, a = fa(lt, .2 + r * .12), col = EPC[EPI[slug]];
      g.save(); g.globalAlpha *= a;
      steel(g, 120, y - 52, 1520, 104, { r: 12, screws: false });
      lamp(g, 160, y, 9, C.red, lt > c[1] ? .9 : 0);
      text(g, slug, 186, y + 1, { f: 'mono', s: 30, w: 700, a: 'left', c: col });
      g.restore();
      RUN_STEPS.forEach((_, j) => {
        const x = 400 + j * 196, t0 = r === 0 ? c[1] + .2 + j * .32 : c[2] + .2 + j * .3, stop = r > 0 && j >= 3, on = !stop && lt > t0;
        g.save(); g.globalAlpha *= a;
        if (stop && lt > c[2] + 1.1) hatchRect(g, x, y - 30, 180, 60, C.grey, { off: lt * 10, la: .45, fa: .1 });
        else { rr(g, x, y - 30, 180, 60, 8); g.fillStyle = on ? rgba(col, .85) : '#0B0F14'; g.fill(); if (on) { rr(g, x, y - 30, 180, 60, 8); g.save(); g.shadowColor = rgba(col, .6); g.shadowBlur = 16 * SH(); g.lineWidth = 2; g.strokeStyle = col; g.stroke(); g.restore(); } }
        g.restore();
      });
      if (r === 0 && lt > c[1] + 2.2) { dot(g, 1600, y, 22 * pop(seg(lt, c[1] + 2.2, c[1] + 2.6)), C.green); icCheck(g, 1600, y + 1, 26, '#10151C', seg(lt, c[1] + 2.3, c[1] + 2.6), 5); }
      if (r > 0) {
        const sp = ap(lt, c[2] + .9 + r * .2, .45);
        if (sp > 0) at(g, 1078, y, sp, () => {
          g.beginPath(); for (let k = 0; k < 8; k++) { const an = Math.PI / 8 + k * TAU / 8; g.lineTo(Math.cos(an) * 40, Math.sin(an) * 40); } g.closePath();
          g.fillStyle = C.red; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
          text(g, 'STOP', 0, 2, { f: 'disp', s: 24, w: 900, c: '#fff' });
        });
      }
    });
    if (lt > c[2] + 1.9) {
      const p = ap(lt, c[2] + 2.0, .5);
      ['curtain', 'taskqueue', 'cards'].forEach((_, r) => path(g, partial([[1120, 420 + r * 140], [1684, 560]], eo(seg(lt, c[2] + 1.9, c[2] + 2.4))), { c: rgba(ROLE.me[1], .5), w: 3, dash: [6, 8], off: -lt * 20 }));
      badge(g, 'me', 1730, 560, 46, { s: p, glow: .8 });
      tag(g, '待确认', 1730, 650, ROLE.me[1], seg(lt, c[2] + 2.3, c[2] + 2.7), { fs: 28, al: .75 + .25 * Math.sin(lt * 5) });
    }
  },
});

/* =====================================================================
 * 多轨时间线（真实时刻，单位分钟，从当日 0:00 起；lane 0 = Claude 子 agent / 总负责人，1 = Codex · ZCode · 脚本 · 云端）
 * 数据出处：分期日志 sip-v3/curtain/taskqueue/cards（10-25）与 subscription/jsruntime/frameanim/fps（10-31）各条。
 * ===================================================================== */
const TL1 = {
  start: 908, pauses: [[955, 1202, '额度用尽 15:55–20:02'], [1232, 1400, '→ 10-26 01:00']],
  tracks: [
    { slug: 'sip-v3', clips: [[908, 914, '稿', 0], [914, 916, '推送', 0], [916, 920, '稿', 0], [920, 922, '推送', 0], [920, 928, '核对', 1], [928, 929, '稿', 0], [930, 955, '画面', 0], [1202, 1203, '推送', 0], [1203, 1209, '画面', 0], [1209, 1215, '检查', 1], [1212, 1216, '审阅', 0], [1215, 1217, '推送', 1], [1217, 1219, '推送', 0]] },
    { slug: 'curtain', clips: [[908, 919, '稿', 0], [919, 927, '核对', 1], [919, 927, '画面', 0], [927, 928, '稿', 0], [928, 931, '画面', 0], [931, 935, '审阅', 0], [933, 946, '检查', 1], [935, 936, '画面', 1], [1202, 1204, '推送', 0], [1204, 1213, '画面', 0], [1213, 1216, '检查', 0], [1216, 1221, '审阅', 0], [1222, 1224, '审阅', 0], [1222, 1231, '配乐', 1]], wait: [[946, 955]] },
    { slug: 'taskqueue', clips: [[908, 919, '稿', 0], [919, 934, '核对', 1], [922, 934, '画面', 0], [934, 936, '稿', 0], [936, 941, '审阅', 0], [938, 954, '检查', 1], [941, 943, '画面', 1], [1202, 1204, '推送', 0], [1204, 1230, '画面', 0], [1208, 1223, '配乐', 1]] },
    { slug: 'cards', clips: [[908, 920, '稿', 0], [920, 929, '核对', 1], [920, 929, '画面', 0], [929, 930, '稿', 0], [930, 933, '审阅', 0], [933, 935, '推送', 0], [1204, 1206, '推送', 0], [1206, 1220, '画面', 0], [1216, 1221, '配乐', 1], [1221, 1227, '审阅', 0]], stop: [935, 955] },
  ],
};
const TL2 = {
  start: 955, pauses: [[979, 1255, '用户暂停 16:19–20:55']],
  tracks: [
    { slug: 'subscription', trig: 1285, done: 1311, clips: [[955, 965, '稿', 0], [965, 973, '核对', 1], [965, 974, '画面', 0], [974, 976, '稿', 0], [976, 979, '检查', 1], [976, 979, '审阅', 0], [1255, 1258, '审阅', 0], [1258, 1259, '推送', 0], [1255, 1271, '检查', 1], [1271, 1274, '画面', 0], [1271, 1281, '配乐', 1], [1281, 1282, '推送', 0], [1282, 1285, '云端', 1], [1285, 1295, '云端', 1], [1295, 1311, '收尾', 1]] },
    { slug: 'jsruntime', trig: 1280, done: 1317, clips: [[955, 962, '稿', 0], [962, 968, '核对', 1], [962, 974, '画面', 0], [974, 976, '稿', 0], [976, 979, '检查', 1], [1255, 1260, '画面', 0], [1260, 1262, '审阅', 0], [1262, 1265, '画面', 0], [1265, 1276, '审阅', 0], [1265, 1275, '配乐', 1], [1276, 1279, '云端', 1], [1280, 1294, '云端', 1], [1294, 1317, '收尾', 1]] },
    { slug: 'frameanim', trig: 1269, done: 1298, clips: [[955, 960, '稿', 0], [960, 969, '核对', 1], [960, 969, '画面', 0], [969, 970, '稿', 0], [970, 976, '画面', 0], [976, 979, '审阅', 0], [977, 979, '检查', 1], [1255, 1259, '审阅', 0], [1255, 1263, '配乐', 1], [1263, 1265, '推送', 0], [1265, 1268, '云端', 1], [1269, 1282, '云端', 1], [1282, 1298, '收尾', 1]] },
    { slug: 'fps', trig: 1268, done: 1276, clips: [[955, 960, '稿', 0], [960, 965, '核对', 1], [960, 966, '画面', 0], [966, 967, '稿', 0], [967, 969, '画面', 0], [969, 971, '审阅', 0], [972, 979, '检查', 1], [973, 979, '配乐', 1], [973, 974, '审阅', 0], [974, 975, '推送', 0], [975, 976, '审阅', 0], [1255, 1261, '检查', 1], [1255, 1259, '配乐', 1], [1261, 1265, '推送', 0], [1265, 1267, '云端', 1], [1268, 1273, '云端', 1], [1273, 1276, '收尾', 1]] },
  ],
};
const AX1 = { segs: [[900, 960, 370, 1110], [960, 1195, 1110, 1160, 1], [1195, 1240, 1160, 1715], [1240, 1300, 1715, 1790, 2]], ticks: [900, 910, 920, 930, 940, 950, 960, 1200, 1210, 1220, 1230, 1240] };
const AX2 = { segs: [[950, 985, 370, 826], [985, 1250, 826, 876, 1], [1250, 1320, 876, 1790]], ticks: [950, 960, 970, 980, 1250, 1260, 1270, 1280, 1290, 1300, 1310, 1320] };
function xOf(ax, m) { const S0 = ax.segs[0]; if (m <= S0[0]) return S0[2]; for (const [a, b, x0, x1] of ax.segs) if (m <= b) return lerp(x0, x1, (m - a) / (b - a)); return ax.segs[ax.segs.length - 1][3]; }
const pk = (lt, keys) => { if (lt <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (lt <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], eio((lt - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]))); return keys[keys.length - 1][1]; };
const pkInv = (m, keys) => { for (let i = 1; i < keys.length; i++) { const [t0, m0] = keys[i - 1], [t1, m1] = keys[i]; if (m1 > m0 && m >= m0 && m <= m1) { let lo = t0, hi = t1; for (let k = 0; k < 24; k++) { const md = (lo + hi) / 2; if (pk(md, keys) < m) lo = md; else hi = md; } return lo; } } return keys[0][0]; };
function tallyAt(D, i, M) {
  const tr = D.tracks[i];
  if (M < D.start) return null;
  for (const [s, e] of D.pauses) if (M >= s && M < e) return 'grey';
  if (tr.done != null && M >= tr.done) return 'green';
  if (tr.trig != null && M >= tr.trig) return 'amber';
  if (tr.stop && M >= tr.stop[0] && M < tr.stop[1]) return 'grey';
  let a0 = false, a1 = false;
  for (const [s, e, , l] of tr.clips) if (M >= s && M < e) { if (l === 0) a0 = true; else a1 = true; }
  for (const [s, e] of tr.wait || []) if (M >= s && M < e) a1 = true;
  return a0 ? 'red' : a1 ? 'amber' : 'red';
}
const TWORD = { red: '制作中', amber: '等结果', grey: '停住', green: '到盘 ✓' };
const TRK_Y = i => 540 + i * 80;
const LEG = ['稿', '核对', '画面', '检查', '配乐', '审阅', '推送', '云端', '收尾'];
/* 时间线面板：ax 轴、D 数据、M 播放头（分钟） */
function nle(g, ax, D, M, lt, o = {}) {
  steel(g, 120, 440, 1680, 430, { r: 14 });
  // 图例
  let lx = 150; g.save(); g.globalAlpha *= o.legendAl ?? 1;
  LEG.forEach(k => { const lab = k === '推送' ? '提交' : k; rr(g, lx, 452, 26, 20, 4); g.fillStyle = PH[k]; g.fill(); text(g, lab, lx + 34, 463, { s: 24, w: 700, c: C.ink2, a: 'left' }); lx += 34 + textW(g, lab, { s: 24, w: 700 }) + 24; });
  hatchRect(g, lx, 452, 26, 20, C.grey, { step: 8, lw: 2.5, r: 4 }); text(g, '中断', lx + 34, 463, { s: 24, w: 700, c: C.ink2, a: 'left' });
  text(g, '每轨上半 Claude · 下半执行者与云端', 1780, 463, { s: 24, w: 700, c: C.ink3, a: 'right' });
  g.restore();
  // 标尺
  path(g, [[370, 526], [1790, 526]], { c: rgba(C.steel, .35), w: 2 });
  ax.ticks.forEach(m => { const x = xOf(ax, m); path(g, [[x, 518], [x, 526]], { c: rgba(C.steel, .5), w: 2 }); text(g, hm(m), x, 504, { f: 'mono', s: 24, w: 700, c: C.ink3 }); });
  // 轨道
  D.tracks.forEach((tr, i) => {
    const y = TRK_Y(i), st = o.state ? o.state(i) : null;
    lamp(g, 146, y + 32, 8, TALLY[st] || C.grey, tallyOn(st, lt), { halo: 3 });
    text(g, tr.slug, 166, y + 33, { f: 'mono', s: 24, w: 700, a: 'left', c: EPC[EPI[tr.slug]] });
    rr(g, 370, y, 1420, 30, 4); g.fillStyle = 'rgba(5,8,12,.55)'; g.fill();
    rr(g, 370, y + 34, 1420, 30, 4); g.fillStyle = 'rgba(5,8,12,.38)'; g.fill();
    for (const [s, e, ph, l] of tr.clips) {
      if (M <= s) continue;
      const x0 = xOf(ax, s), x1 = Math.max(x0 + 3, xOf(ax, Math.min(e, M))), yy = y + (l ? 34 : 0), act = M < e;
      rr(g, x0, yy + 2, x1 - x0, 26, 4); g.fillStyle = PH[ph]; g.globalAlpha = act ? 1 : .86; g.fill(); g.globalAlpha = 1;
      if (act) { g.save(); rr(g, x0, yy + 2, x1 - x0, 26, 4); g.shadowColor = rgba(PH[ph], .9); g.shadowBlur = 14 * SH(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke(); g.restore(); }
    }
    if (tr.stop && M > tr.stop[0]) { const x0 = xOf(ax, tr.stop[0]), x1 = xOf(ax, Math.min(tr.stop[1], M)); hatchRect(g, x0, y + 2, x1 - x0, 60, C.amber, { la: .5, fa: .1, step: 12, lw: 2.5, off: lt * 8 }); }
    if (tr.trig != null && M >= tr.trig) { const x = xOf(ax, tr.trig); g.beginPath(); g.moveTo(x, y + 30); g.lineTo(x - 9, y + 16); g.lineTo(x + 9, y + 16); g.closePath(); g.fillStyle = C.amber; g.fill(); }
    if (tr.done != null && M >= tr.done) { const x = xOf(ax, tr.done); dot(g, x, y + 49, 11 * pop(seg(M - tr.done, 0, 1.5)), C.green); icCheck(g, x, y + 50, 13, '#10151C', 1, 3); }
  });
  // 断轴
  ax.segs.filter(sg => sg[4] === 1).forEach(([, , x0, x1]) => {
    g.save(); rr(g, x0, 530, x1 - x0, 320, 0); g.clip(); g.fillStyle = 'rgba(5,8,12,.35)'; g.fillRect(x0, 530, x1 - x0, 320); g.restore();
    for (const x of [x0 + 6, x1 - 6]) { const pts = []; for (let k = 0; k <= 32; k++) pts.push([x + (k % 2 ? 5 : -5), 494 + k * 11]); path(g, pts, { c: rgba(C.steel, .55), w: 2 }); }
  });
  // 中断：横跨各轨的斜线阴影块
  D.pauses.forEach(([s, e, lab]) => {
    if (M <= s) return;
    const x0 = xOf(ax, s), x1 = xOf(ax, Math.min(e, M));
    hatchRect(g, x0, 536, x1 - x0, 312, C.grey, { off: lt * 12, fa: .3, la: .75, r: 6 });
    if (x1 - x0 > 60 && o.pauseLabel !== false) { const w = textW(g, lab, { s: 24, w: 700 }) + 28, cx = Math.min((x0 + x1) / 2, 1790 - w / 2); card(g, cx - w / 2, 532, w, 40, { r: 8, fill: 'rgba(14,19,26,.94)', lw: 2, stroke: C.grey }); text(g, lab, cx, 553, { s: 24, w: 700, c: C.ink }); }
  });
  // 未到的部分压暗
  if (o.future) { const xm = xOf(ax, M); g.fillStyle = 'rgba(10,13,18,.45)'; g.fillRect(xm, 490, 1790 - xm, 362); }
  // 播放头
  if (M >= ax.segs[0][0]) {
    const x = xOf(ax, M);
    g.save(); g.shadowColor = rgba(C.red, .8); g.shadowBlur = 12 * SH(); path(g, [[x, 494], [x, 852]], { c: C.red, w: 3 }); g.restore();
    const w = 92; rr(g, x - w / 2, 478, w, 34, 6); g.fillStyle = C.red; g.fill(); text(g, hm(M), x, 496, { f: 'mono', s: 24, w: 700, c: '#fff' });
  }
}
/* 时间线幕的上半：左侧导播台模块 + 4 格监视器 */
const MONX = k => 440 + k * 345;
function monRow(g, D, M, lt, keys, o = {}) {
  D.tracks.forEach((tr, k) => {
    const i = EPI[tr.slug], st = o.state ? o.state(k) : tallyAt(D, k, M);
    let freeze = null, dim = 0;
    if (st === 'grey') { const p = D.pauses.find(([s, e]) => M >= s && M < e), s0 = p ? p[0] : (tr.stop ? tr.stop[0] : M); freeze = pkInv(s0, keys) + i * 1.7; dim = .5; }
    cellMon(g, i, MONX(k), 150, 320, 180, lt, { tally: st || 'grey', off: st == null, freeze, dim, right: st ? (st === 'amber' && tr.trig != null && M >= tr.trig ? '云端中' : TWORD[st]) : '待派发', bw: 4, ...(o.cell ? o.cell(k) : {}) });
  });
}
function clockModule(g, M, o = {}) {
  steel(g, 120, 150, 290, 230, { r: 14 });
  rr(g, 140, 170, 250, 72, 8); g.fillStyle = '#07090D'; g.fill();
  text(g, o.date || '', 156, 206, { f: 'mono', s: 24, w: 700, c: C.ink3, a: 'left' });
  text(g, hm(M), 376, 208, { f: 'mono', s: 46, w: 700, c: C.amber, a: 'right', glow: rgba(C.amber, .45), gb: 12 });
}

/* 10-25 15:08 派出 4 路 */
S('s11', {
  cam: [[0, 960, 540, 1], [15.7, 960, 540, 1.015]],
  cues: (() => { const c = CS('s11'); return [...[0, 1, 2, 3].map(k => [c[0] + .9 + k * .25, 'clap', .7]), [c[0] + 2.0, 'whoosh', .5], [c[2] + .7, 'success']]; })(),
  draw(g, lt) {
    const c = CS('s11'), keys = [[0, 902], [c[0] + .8, 908], [c[0] + 1.9, 908], [c[2] + .7, 935], [SCRIPT.s11.dur, 941]];
    const M = pk(lt, keys), disp = k => c[0] + .9 + k * .25;
    const stF = k => lt < disp(k) ? null : tallyAt(TL1, k, M);
    clockModule(g, M, { date: '10-25' });
    const kp = [0, 1, 2, 3].reduce((a, k) => Math.max(a, Math.sin(clamp((lt - disp(k) + .1) / .22) * Math.PI)), 0);
    key(g, 140, 268, 250, 92, '派发', { on: lt > disp(0) - .1 ? 1 : 0, press: kp, col: C.red, fs: 34, idle: true });
    monRow(g, TL1, M, lt, keys, { state: stF, cell: k => ({ flash: .5 * (1 - seg(lt, disp(k), disp(k) + .3)) * (lt >= disp(k) ? 1 : 0) }) });
    nle(g, AX1, TL1, M, lt, { state: stF, future: true });
    if (M >= 935) { const x = xOf(AX1, 935) + 18, p = seg(lt, pkInv(935, keys), pkInv(935, keys) + .4); at(g, x, TRK_Y(3) + 32, pop(p), () => { const s = '稿子 + 30 秒样片 ✓', w = textW(g, s, { s: 26, w: 900 }) + 32; card(g, 0, -24, w, 48, { r: 8, fill: C.green, lw: 0 }); text(g, s, w / 2, 1, { s: 26, w: 900, c: '#10151C' }); }); }
  },
});

/* =====================================================================
 * 第四章 卡住的地方
 * ===================================================================== */
const S12K = id => { const c = CS(id), d = SCRIPT[id].dur; return [[0, 941], [c[0] + .3, 955], [c[2] - .1, 955], [c[2] + .9, 1202], [c[3], 1206], [c[5] - .2, 1229], [c[5] + .6, 1232], [d - .4, 1262], [d, 1262]]; };
S('s12', {
  cam: [[0, 960, 540, 1.015], [29.4, 960, 540, 1]],
  cues: (() => { const c = CS('s12'); return [[c[0] + .3, 'error'], [c[1] + .4, 'draw', .5], [c[2] + .9, 'success', .6], [c[3] + .3, 'blip'], [c[4] + .4, 'whoosh', .5], [c[5] + .6, 'error']]; })(),
  draw(g, lt) {
    const c = CS('s12'), keys = S12K('s12'), M = pk(lt, keys);
    clockModule(g, M, { date: '10-25' });
    const out = M >= 955 && M < 1202 || M >= 1232;
    steel(g, 140, 268, 250, 92, { r: 10, screws: false, shadow: false, top: '#3A2228', fill: '#2C1A20', bot: '#1E1216' });
    lamp(g, 172, 314, 12, C.red, out ? .7 + .3 * Math.sin(lt * 6) : 0);
    text(g, '会话额度', 196, 300, { s: 26, w: 900, a: 'left', c: out ? C.red : C.ink2 });
    text(g, out ? '用尽' : '可用', 196, 334, { s: 24, w: 700, a: 'left', c: out ? C.red : C.green });
    monRow(g, TL1, M, lt, keys);
    const mk = fa(lt, c[1] + .2) * fo(lt, c[2] + .4);
    nle(g, AX1, TL1, M, lt, { future: true, legendAl: 1 - mk });
    // 47 分钟量尺
    if (mk > 0) { const x0 = xOf(AX1, 908), x1 = xOf(AX1, 955); g.save(); g.globalAlpha *= mk; card(g, x0 - 8, 444, x1 - x0 + 16, 40, { r: 8, fill: 'rgba(14,19,26,.96)', lw: 0, shadow: false });
      path(g, partial([[x0, 456], [x0, 472], [x1, 472], [x1, 456]], eo(seg(lt, c[1] + .3, c[1] + .9))), { c: C.amber, w: 3 });
      text(g, '47 分钟', (x0 + x1) / 2, 462, { s: 24, w: 900, c: C.amber, al: fa(lt, c[1] + .8) }); g.restore(); }
    // 我：不用再做样片
    if (lt > c[3] - .2 && lt < c[5]) { const a = fo(lt, c[5] - .4); badge(g, 'me', 1010, 262, 40, { s: ap(lt, c[3]), glow: .7, al: a }); speech(g, '“不用考虑制作样片了……可以直接出成片”', 1060, 222, seg(lt, c[3] + .2, c[3] + .6), { fs: 28, al: a }); }
    // 样片代码接着用：从样片段跨过中断连到全片段
    const ak = fa(lt, c[4] + .3, .6) * fo(lt, c[5] + .2);
    if (ak > 0) {
      [[1, 936, 1204], [2, 943, 1204], [3, 933, 1206]].forEach(([k, a, b], j) => {
        const x0 = xOf(AX1, a), x1 = xOf(AX1, b), y = TRK_Y(k) + 4, pts = [];
        for (let q = 0; q <= 20; q++) { const u = q / 20; pts.push([lerp(x0, x1, u), y - Math.sin(u * Math.PI) * 30]); }
        const p = eo(seg(lt, c[4] + .3 + j * .15, c[4] + 1.1 + j * .15));
        path(g, partial(pts, p), { c: C.cyan, w: 4, al: ak }); if (p >= 1) arrowHead(g, x1, y, Math.PI * .5, C.cyan, 14, ak);
      });
      tag(g, '样片代码接着用', 1136, 618, C.cyan, seg(lt, c[4] + .9, c[4] + 1.3), { fs: 26, al: ak });
    }
  },
});

/* pre-push 钩子误报（⚠ 机制演绎：文件卡与扫描为重画示意） */
S('s13', {
  cam: (() => { const c = CS('s13'); return [[0, 960, 540, 1], [c[1] - .2, 960, 540, 1], [c[1] + .6, 430, 420, 1.75], [c[4] - .2, 430, 420, 1.75], [c[4] + .7, 960, 540, 1], [SCRIPT.s13.dur, 960, 540, 1]]; })(),
  cues: (() => { const c = CS('s13'); return [[c[0] + .3, 'whoosh', .5], [c[0] + 1.0, 'error'], [c[1] + .9, 'blip'], [c[2] + .3, 'scan'], [c[2] + 1.4, 'error', .6], [c[3] + .6, 'success', .6], [c[4] + .9, 'latch'], [c[4] + 1.6, 'whoosh', .5], [c[4] + 2.4, 'success']]; })(),
  draw(g, lt) {
    const c = CS('s13'), fixed = lt > c[4] + 1.1;
    // 目录卡
    steel(g, 120, 250, 600, 320, { r: 14 });
    text(g, '~/video-log-wt/cards', 150, 290, { f: 'mono', s: 26, w: 700, a: 'left', c: EPC[3] });
    path(g, [[140, 318], [700, 318]], { c: rgba(C.steel, .25), w: 2 });
    icDoc(g, 168, 356, 32, C.ink2); text(g, '.git', 196, 358, { f: 'mono', s: 30, w: 700, a: 'left' });
    text(g, '文本指针，不是目录', 700, 358, { s: 24, w: 700, a: 'right', c: C.ink3, al: fa(lt, c[1] + .6) });
    const pe = eo(seg(lt, c[1] + .7, c[1] + 1.2));
    if (pe > 0) {
      g.save(); g.globalAlpha *= pe; rr(g, 150, 386, 540, 56 * pe, 8); g.fillStyle = '#07090D'; g.fill(); rr(g, 150, 386, 540, 56 * pe, 8); g.lineWidth = 2; g.strokeStyle = '#3A4656'; g.stroke();
      const pre = 'gitdir: /home/', post = '/…/cards', o = { f: 'mono', s: 24, w: 700 }, w1 = textW(g, pre, o);
      text(g, pre, 166, 415, { ...o, a: 'left', c: C.ink2 });
      const hit = seg(lt, c[2] + 1.3, c[2] + 1.6), bx = 166 + w1;
      rr(g, bx + 2, 402, 92, 26, 4); g.fillStyle = hit > 0 ? rgba(C.red, .55 + .45 * Math.abs(Math.sin(lt * 6))) : '#3A4656'; g.fill();
      text(g, post, bx + 100, 415, { ...o, a: 'left', c: C.ink2 });
      // 扫描光
      const sk = seg(lt, c[2] + .2, c[2] + 1.3);
      if (sk > 0 && sk < 1) { const sy = lerp(330, 540, sk); g.fillStyle = rgba(C.cyan, .22); g.fillRect(140, sy - 6, 560, 12); path(g, [[140, sy], [700, sy]], { c: C.cyan, w: 2 }); }
      g.restore();
      if (hit > 0) tag(g, '命中：用户名', bx + 46, 466, C.red, hit, { fs: 26, tc: '#fff' });
    }
    icDoc(g, 168, 526, 32, C.ink2); text(g, '2026-10-25-cards/', 196, 528, { f: 'mono', s: 28, w: 700, a: 'left' });
    if (lt > c[3]) tag(g, '0 命中', 610, 528, C.green, seg(lt, c[3] + .5, c[3] + .9), { fs: 26 });
    // 闸门
    const gl = fixed ? C.green : lt > c[0] + .9 ? C.red : C.grey;
    for (const px of [975, 1045]) steel(g, px - 18, 290, 36, 250, { r: 8, screws: false });
    path(g, [[960, 300], [1060, 300]], { c: '#0B0F14', w: 10 });
    lamp(g, 1010, 266, 14, gl, gl === C.grey ? 0 : .85 + .15 * Math.sin(lt * 6), { halo: 4 });
    text(g, 'pre-push 钩子', 1010, 584, { s: 28, w: 900, c: gl === C.grey ? C.ink2 : gl });
    if (lt > c[4] + .7) tag(g, '跳过名为 .git 的文件 · 10-27', 1010, 196, C.green, seg(lt, c[4] + .8, c[4] + 1.2), { fs: 26 });
    // 远端
    g.save(); const rx = 1560, ry = 420; rr(g, rx - 110, ry - 90, 220, 180, 20); g.fillStyle = '#1C2430'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#3A4656'; g.stroke();
    for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(rx, ry - 60 + k * 60, 100, 22, 0, 0, TAU); g.strokeStyle = rgba(C.steel, .35); g.lineWidth = 2; g.stroke(); }
    g.restore();
    text(g, '远端 · ep/cards', rx, 544, { s: 26, w: 700, c: C.ink2 });
    // 推送包
    let px = null;
    const t1 = c[0] + .3;
    if (lt > t1 && lt < c[1] + .4) { const u = seg(lt, t1, t1 + .7), b = seg(lt, t1 + .7, t1 + 1.3); px = lt < t1 + .7 ? lerp(760, 945, eio(u)) : lerp(945, 790, eo(b)); }
    if (lt > c[4] + 1.4) { const u = seg(lt, c[4] + 1.4, c[4] + 2.4); px = lerp(790, 1560, eio(u)); if (u >= 1) px = null; }
    if (px != null) at(g, px, 420, 1, () => { card(g, -60, -26, 120, 52, { r: 10, fill: C.coral, lw: 0 }); text(g, '推送', 0, 1, { s: 26, w: 900, c: '#10151C' }); });
    if (lt > c[0] + .9 && lt < c[0] + 1.6) { const k = lt - c[0] - 1.0; ripple(g, 960, 420, k, C.red, 20, 90, .6); }
    if (lt > c[0] + .95 && lt < c[1] + .3) tag(g, '拦下', 1010, 196, C.red, seg(lt, c[0] + .95, c[0] + 1.3), { fs: 28, tc: '#fff', al: fo(lt, c[1]) });
    if (lt > c[4] + 2.4) { dot(g, 1640, 360, 24 * pop(seg(lt, c[4] + 2.4, c[4] + 2.8)), C.green); icCheck(g, 1640, 361, 28, '#10151C', seg(lt, c[4] + 2.5, c[4] + 2.8), 5); }
  },
});

/* 护栏拦了 3 次 */
const GUARD = [
  { cx: 360, date: '10-25', title: '改钩子', mono: false, why: ['Security Weaken'] },
  { cx: 960, date: '10-26 09:30', title: '改钩子', mono: false, why: ['Security Weaken'] },
  { cx: 1560, date: '10-28', title: 'git reset --hard', mono: true, why: ['Irreversible Local', 'Destruction'] },
];
function chip(g, s, x, y, col, p, o = {}) { tag(g, s, x, y, col, p, { fs: o.fs || 28, r: 10, al: o.al, tc: o.tc }); }
S('s14', {
  cam: (() => { const c = CS('s14'); return [[0, 960, 540, 1], [c[1] - .3, 960, 540, 1], [c[1] + .4, 640, 520, 1.12], [c[3] - .3, 640, 520, 1.12], [c[3] + .4, 960, 520, 1.12], [c[5] - .3, 960, 520, 1.12], [c[5] + .4, 1280, 520, 1.12], [SCRIPT.s14.dur - 1.2, 1280, 520, 1.12], [SCRIPT.s14.dur, 960, 540, 1]]; })(),
  cues: (() => { const c = CS('s14'); return [[c[0] + .4, 'error', .5], [c[0] + .7, 'error', .5], [c[0] + 1.0, 'error', .5], [c[1] + .3, 'error'], [c[2] + .5, 'blip'], [c[2] + 1.6, 'success', .6], [c[3] + .3, 'error'], [c[4] + .5, 'whoosh', .5], [c[4] + 1.6, 'success', .6], [c[5] + .4, 'error', .6], [c[6] + .3, 'error'], [c[7] + .6, 'whoosh', .5], [c[7] + 1.6, 'success']]; })(),
  draw(g, lt) {
    const c = CS('s14');
    const lampAt = [c[1] + .3, c[3] + .3, c[6] + .3];
    GUARD.forEach((G, k) => {
      const { cx } = G, s = ap(lt, c[0] + .1 + k * .15, .45);
      if (s <= 0) return;
      const flash = lt < c[0] + 1.6 && lt > c[0] + .4 + k * .3 ? .8 : 0, on = lt > lampAt[k] ? 1 : flash;
      at(g, cx, 310, s, () => {
        steel(g, -270, -160, 540, 320, { r: 14, top: on ? '#4A2C32' : C.panelL, fill: on ? '#33222A' : C.panel, bot: on ? '#21161C' : C.panelD });
        lamp(g, -210, -110, 22, C.red, on ? .85 + .15 * Math.sin(lt * 7) : 0);
        text(g, String(k + 1).padStart(2, '0'), -170, -108, { f: 'disp', s: 40, w: 900, a: 'left', c: on ? C.red : C.ink3 });
        text(g, G.date, 246, -108, { f: 'mono', s: 24, w: 700, a: 'right', c: C.ink2 });
        text(g, G.title, 0, -30, G.mono ? { f: 'mono', s: 38, w: 700 } : { s: 46, w: 900 });
        rr(g, -240, 20, 480, 110, 10); g.fillStyle = '#07090D'; g.fill();
        G.why.forEach((w, j) => text(g, w, 0, 75 + (j - (G.why.length - 1) / 2) * 36, { f: 'mono', s: 26, w: 700, c: on ? C.red : C.ink3 }));
      });
    });
    // ① 问我 → 我同意 → 改钩子
    { const cx = 360; if (lt > c[2]) {
      path(g, partial([[cx, 474], [cx, 530]], eo(seg(lt, c[2], c[2] + .3))), { c: C.steel, w: 3 });
      badge(g, 'me', cx - 140, 600, 40, { s: ap(lt, c[2] + .3), glow: .6 });
      chip(g, '问我', cx - 140, 680, ROLE.me[1], seg(lt, c[2] + .5, c[2] + .9), { fs: 26 });
      if (lt > c[2] + 1.0) arrow(g, [[cx - 90, 600], [cx + 10, 600]], { p: eo(seg(lt, c[2] + 1.0, c[2] + 1.3)), c: C.steel, w: 3, hs: 12 });
      chip(g, '我同意 ✓', cx + 110, 600, C.green, seg(lt, c[2] + 1.4, c[2] + 1.8), { fs: 26 });
      chip(g, '然后才改钩子', cx, 770, C.steel, seg(lt, c[2] + 2.0, c[2] + 2.4), { fs: 26 });
    } }
    // ② 恢复原样 → 推送成功
    { const cx = 960; if (lt > c[4]) {
      path(g, partial([[cx, 474], [cx, 530]], eo(seg(lt, c[4], c[4] + .3))), { c: C.steel, w: 3 });
      const rot = -TAU * .5 * eio(seg(lt, c[4] + .4, c[4] + 1.2));
      at(g, cx, 610, ap(lt, c[4] + .2), () => { g.rotate(rot); g.beginPath(); g.moveTo(0, -40); g.lineTo(0, 16); g.arc(-18, 16, 18, 0, Math.PI); g.strokeStyle = C.cyan; g.lineWidth = 9; g.lineCap = 'round'; g.stroke(); dot(g, 0, -44, 9, C.cyan); });
      chip(g, '钩子恢复原样', cx, 690, C.cyan, seg(lt, c[4] + .9, c[4] + 1.3), { fs: 26 });
      chip(g, '推送成功 ✓', cx, 770, C.green, seg(lt, c[4] + 1.6, c[4] + 2.0), { fs: 26 });
    } }
    // ③ 推送被拒 → 不可逆被拦 → 远端合进本地
    { const cx = 1560;
      if (lt > c[5]) chip(g, '推送被拒：远端有新提交', cx, 540, C.red, seg(lt, c[5] + .3, c[5] + .7), { fs: 26, tc: '#fff', al: fo(lt, c[7] + .2) });
      if (lt > c[7]) {
        const p = eo(seg(lt, c[7] + .3, c[7] + 1.3));
        path(g, partial([[cx - 220, 600], [cx - 40, 600], [cx + 40, 650]], p), { c: C.blue, w: 6 });
        path(g, partial([[cx - 220, 700], [cx - 40, 700], [cx + 40, 650]], p), { c: C.coral, w: 6 });
        if (p >= 1) { path(g, partial([[cx + 40, 650], [cx + 220, 650]], eo(seg(lt, c[7] + 1.3, c[7] + 1.7))), { c: C.green, w: 6 }); dot(g, cx + 40, 650, 12, C.green); }
        text(g, '远端', cx - 236, 600, { s: 24, w: 700, a: 'right', c: C.blue, al: p });
        text(g, '本地', cx - 236, 700, { s: 24, w: 700, a: 'right', c: C.coral, al: p });
        chip(g, '远端合进本地，什么都没丢 ✓', cx, 780, C.green, seg(lt, c[7] + 1.6, c[7] + 2.0), { fs: 26 });
      }
    }
  },
});

/* 下载变慢 */
function gauge(g, cx, cy, r, v, max, o = {}) {
  const a0 = Math.PI, a1 = TAU, ang = lerp(a0, a1, clamp(v / max));
  ring(g, cx, cy, r, '#0B0F14', 26, 1, a0, a1);
  ring(g, cx, cy, r, rgba(C.red, .8), 22, 1, a0, lerp(a0, a1, 3 / max));
  ring(g, cx, cy, r, rgba(C.green, .35), 22, 1, lerp(a0, a1, 3 / max), a1);
  for (let k = 0; k <= 5; k++) { const an = lerp(a0, a1, k / 5); path(g, [[cx + Math.cos(an) * (r - 30), cy + Math.sin(an) * (r - 30)], [cx + Math.cos(an) * (r - 46), cy + Math.sin(an) * (r - 46)]], { c: C.ink3, w: 3 }); text(g, String(k * max / 5), cx + Math.cos(an) * (r - 72), cy + Math.sin(an) * (r - 72), { f: 'mono', s: 24, w: 700, c: C.ink3 }); }
  path(g, [[cx, cy], [cx + Math.cos(ang) * (r - 20), cy + Math.sin(ang) * (r - 20)]], { c: o.col || C.amber, w: 6 });
  dot(g, cx, cy, 14, o.col || C.amber); dot(g, cx, cy, 6, '#0B0F14');
}
S('s15', {
  cam: [[0, 960, 540, 1.015], [14.3, 960, 540, 1]],
  cues: (() => { const c = CS('s15'); return [[c[0] + .6, 'tick'], [c[0] + 1.4, 'tick'], [c[1] + .6, 'error'], ...Array.from({ length: 8 }, (_, k) => [c[2] + .3 + k * .42, 'tick', .4])]; })(),
  draw(g, lt) {
    const c = CS('s15');
    const G3 = [['sip-v3', '10-26', 20, c[0] + .6], ['curtain', '10-28', 6, c[0] + 1.4], ['taskqueue', '10-28 · 经代理', 1.5, c[1] + .6]];
    G3.forEach(([slug, d, v, t0], k) => {
      const cx = 480 + k * 480, cy = 470, s = ap(lt, .2 + k * .15, .5); if (s <= 0) return;
      const vv = v * spring(seg(lt, t0, t0 + 1.4), 6, 1.2);
      at(g, cx, cy, s, () => {
        steel(g, -210, -220, 420, 330, { r: 16 });
        gauge(g, 0, 20, 170, lt > t0 ? vv : 0, 25, { col: v < 3 ? C.red : C.amber });
        text(g, lt > t0 ? `≈ ${v} MB/s` : '— MB/s', 0, 76, { f: 'disp', s: 40, w: 900, c: v < 3 && lt > t0 ? C.red : C.ink });
      });
      text(g, slug, cx, cy + 150, { f: 'mono', s: 28, w: 700, c: EPC[EPI[slug]], al: s });
      text(g, d, cx, cy + 188, { s: 24, w: 700, c: C.ink3, al: s });
    });
    if (lt > c[2] - .2) {
      const a = fa(lt, c[2] - .2), p = seg(lt, c[2] + .3, c[2] + 3.7);
      g.save(); g.globalAlpha *= a;
      text(g, 'taskqueue.mp4 · 1.81 GB', 360, 718, { f: 'mono', s: 26, w: 700, a: 'left', c: C.ink2 });
      bar(g, 360, 740, 1160, 32, p, C.red, { lt });
      rr(g, 1540, 732, 150, 48, 8); g.fillStyle = '#07090D'; g.fill();
      text(g, hm(lerp(1368, 1390, p)), 1615, 757, { f: 'mono', s: 30, w: 700, c: p >= 1 ? C.green : C.amber });
      g.restore();
    }
  },
});

/* =====================================================================
 * 第五章 第二批
 * ===================================================================== */
const RULES = ['钩子误报已修好，pre-push 正常放行', '投稿 json 加视频号短标题', 'zsh 不分词，多参数循环用 bash 跑', '本地渲染一次只开一个进程', '额度约 45 分钟，每做完一阶段就提交', '停止点：触发全片就停'];
S('s16', {
  cam: [[0, 960, 540, 1], [25.3, 960, 540, 1.015]],
  demo: lt => { const c = CS('s16'); return lt > c[4] - .1 ? 1 : 0; },
  cues: (() => { const c = CS('s16'); return [...[0, 1, 2, 3].map(k => [c[0] + .5 + k * .2, 'blip', .6]), ...[0, 1, 2, 3, 4].map(k => [c[1] + .3 + k * .75, 'type', .5]), [c[2] + .3, 'type', .5], [c[2] + 1.6, 'latch'], [c[3] + .4, 'whoosh', .6], [c[4] + .2, 'clap', .5]]; })(),
  draw(g, lt) {
    const c = CS('s16');
    const swap = lt > c[4];
    monitor(g, 140, 150, 1000, 500, { lt, label: swap ? '上下文成本' : 'batch2-common.md', right: swap ? '' : '共用约定', umdH: 44, lfs: 26, lf: swap ? 'cjk' : 'mono', tally: 'red' }, (gg, ww, hh) => {
      gg.fillStyle = '#0B0F14'; gg.fillRect(0, 0, ww, hh);
      if (!swap) {
        if (lt < c[1] + .3 && Math.floor(lt * 2.4) % 2) { gg.fillStyle = C.ink2; gg.fillRect(48, 44, 16, 34); }
        RULES.forEach((s, k) => {
          const t0 = k < 5 ? c[1] + .3 + k * .75 : c[2] + .3, n = Math.round(Array.from(s).length * seg(lt, t0, t0 + .6)); if (n <= 0) return;
          const y = 62 + k * 74;
          dot(gg, 60, y, 15, k === 5 ? C.red : C.green); icCheck(gg, 60, y + 1, 18, '#0B0F14', seg(lt, t0 + .5, t0 + .8), 4);
          text(gg, Array.from(s).slice(0, n).join(''), 96, y + 1, { s: 32, w: k === 5 ? 900 : 700, a: 'left', c: k === 5 ? C.ink : C.ink2 });
        });
        const fr = eo(seg(lt, c[2] + 1.5, c[2] + 2.1)); if (fr > 0) { const pts = [[30, 400], [880, 400], [880, 460], [30, 460], [30, 400]]; path(gg, partial(pts, fr), { c: C.red, w: 4, glow: rgba(C.red, .7) }); }
      } else {
        const k = seg(lt, c[4] + .1, c[4] + 1.6);
        text(gg, '重新唤起一个大上下文的子 agent', 60, 110, { s: 30, w: 700, a: 'left', c: C.ink2 });
        rr(gg, 60, 140, 860 * eo(k), 48, 8); gg.fillStyle = C.coral; gg.fill();
        text(gg, '总负责人自己跑几条命令', 60, 270, { s: 30, w: 700, a: 'left', c: C.ink2 });
        rr(gg, 60, 300, 150 * eo(seg(lt, c[4] + .5, c[4] + 1.2)), 48, 8); gg.fillStyle = C.cyan; gg.fill();
        text(gg, '每一轮都要重读整个上下文', 60, 420, { s: 26, w: 700, a: 'left', c: C.ink3, al: fa(lt, c[4] + 1.4) });
      }
      if (lt > c[4] && lt < c[4] + .2) { gg.fillStyle = `rgba(255,255,255,${.6 * (1 - (lt - c[4]) / .2)})`; gg.fillRect(0, 0, ww, hh); }
    });
    text(g, '第二批 · 10-31 15:55', 1515, 186, { s: 30, w: 900, al: fa(lt, c[0]) });
    [4, 5, 6, 7].forEach((i, k) => { const x = 1230 + (k % 2) * 290, y = 226 + Math.floor(k / 2) * 200, s = ap(lt, c[0] + .2 + k * .1, .45); const on = lt > c[0] + .5 + k * .2;
      if (s > 0) at(g, x + 130, y + 73, s, () => cellMon(g, i, -130, -73, 260, 146, lt, { tally: on ? 'red' : 'grey', off: !on, umdH: 36, right: '', bw: 4 })); });
    // 收尾交接：取回、校验、拷盘从子 agent 滑到总负责人
    if (lt > c[3] - .2) {
      const a = fa(lt, c[3] - .2);
      g.save(); g.globalAlpha *= a; steel(g, 140, 712, 1640, 150, { r: 14 }); g.restore();
      badge(g, 'sub', 230, 772, 40, { al: a }); text(g, '子 agent', 230, 836, { s: 24, w: 700, c: ROLE.sub[1], al: a });
      badge(g, 'lead', 1690, 772, 40, { al: a }); text(g, '总负责人', 1690, 836, { s: 24, w: 700, c: ROLE.lead[1], al: a });
      ['取回', '校验', '拷 D 盘'].forEach((s, k) => { const m = eio(seg(lt, c[3] + .4, c[3] + 1.5)); chip(g, s, lerp(420 + k * 170, 1180 + k * 170, m), 786, C.steel, a, { fs: 28 }); });
      text(g, '触发全片就停 →', 960, 742, { s: 24, w: 700, c: C.ink3, al: a });
    }
  },
});

/* “停一下” */
function rack(g, x, y, title, lt, alive, o = {}) {
  steel(g, x, y, 280, 170, { r: 12 });
  text(g, title, x + 20, y + 32, { f: 'mono', s: 24, w: 700, a: 'left', c: C.cyan });
  for (let k = 0; k < 10; k++) lamp(g, x + 34 + (k % 5) * 40, y + 76 + Math.floor(k / 5) * 32, 7, C.cyan, alive * (hash(Math.floor(lt * 6) + k * 3 + x) > .4 ? 1 : .2), { halo: 2.5 });
  rr(g, x + 20, y + 124, 120, 34, 6); g.fillStyle = '#07090D'; g.fill(); g.save(); g.setLineDash([5, 5]); rr(g, x + 20, y + 124, 120, 34, 6); g.lineWidth = 2; g.strokeStyle = rgba(C.steel, .4); g.stroke(); g.restore();
  text(g, 'EXIT', x + 80, y + 142, { f: 'mono', s: 24, w: 700, c: o.cross ? C.red : C.ink3 });
  if (o.cross) icCross(g, x + 200, y + 141, 30, C.red, o.cross, 6);
}
S('s17', {
  cam: [[0, 960, 540, 1], [18.2, 960, 540, 1.015]],
  cues: (() => { const c = CS('s17'); return [[c[0] + .3, 'blip'], [c[1] + .3, 'clap'], ...[0, 1, 2, 3].map(k => [c[1] + .6 + k * .2, 'cut', .6]), [c[2] + .6, 'error'], [c[3] + .3, 'clap'], [c[3] + .8, 'whoosh', .6]]; })(),
  draw(g, lt) {
    const c = CS('s17'), offAt = k => c[1] + .6 + k * .2, onAt = c[3] + .6;
    [4, 5, 6, 7].forEach((i, k) => {
      const [x, y, w, h] = cellRect(k);
      const off = seg(lt, offAt(k), offAt(k) + .25) * (1 - seg(lt, onAt + k * .1, onAt + k * .1 + .3)), dead = lt > offAt(k) + .25 && lt < onAt + k * .1;
      const st = dead ? 'grey' : 'red';
      monitor(g, x, y, w, h, { lt, tally: st, label: EP[i].slug, right: dead ? '停住' : lt > onAt ? '续做' : '制作中', seed: i }, (gg, ww, hh) => {
        if (dead) { gg.fillStyle = '#030406'; gg.fillRect(0, 0, ww, hh); return; }
        gg.save(); gg.translate(0, hh / 2); gg.scale(1 + off * .1, Math.max(.02, 1 - off)); gg.translate(0, -hh / 2); thumb(gg, EP[i].slug, ww, hh, lt + i * 1.7); gg.restore();
        if (off > 0) { gg.fillStyle = `rgba(255,255,255,${off * .8})`; gg.fillRect(0, hh / 2 - 3, ww, 6); }
      });
      if (lt > onAt + .6) chip(g, '续做', x + w / 2, y + h - 30, C.green, seg(lt, onAt + .6 + k * .1, onAt + 1.0 + k * .1), { fs: 26 });
    });
    steel(g, 320, 448, 1140, 150, { r: 14 });
    const pr = t0 => Math.sin(clamp((lt - t0) / .3) * Math.PI);
    key(g, 350, 480, 220, 88, '派发', { on: 0, fs: 30 });
    key(g, 610, 480, 320, 88, 'TaskStop\n暂停', { on: lt > c[1] + .3 && lt < c[3] + .3 ? 1 : 0, press: pr(c[1] + .2), col: C.red, fs: 26, idle: true });
    key(g, 970, 480, 460, 88, 'SendMessage\n恢复', { on: lt > c[3] + .3 ? 1 : 0, press: pr(c[3] + .2), col: C.green, fs: 26, idle: true });
    const alive = lt < c[2] + .4 ? 1 : lt > onAt ? 1 : 0, cross = lt > c[2] + .5 && lt < onAt ? seg(lt, c[2] + .5, c[2] + .9) : 0;
    rack(g, 1520, 452, 'Codex · 检查', lt, alive, { cross });
    rack(g, 1520, 666, 'Codex · 配乐', lt, alive, { cross });
    if (lt > c[2]) text(g, '没留下完成标记', 1660, 645, { s: 24, w: 700, c: C.red, al: fa(lt, c[2] + .6) * fo(lt, onAt) });
    badge(g, 'me', 230, 760, 46, { s: ap(lt, c[0]), glow: .7 });
    speech(g, '停一下', 290, 700, seg(lt, c[0] + .2, c[0] + .6), { fs: 36, al: fo(lt, c[2]) });
    text(g, '16:19', 230, 832, { f: 'mono', s: 26, w: 700, c: C.ink2, al: fa(lt, c[0] + .3) * fo(lt, c[3]) });
    text(g, '20:55', 230, 832, { f: 'mono', s: 26, w: 700, c: C.green, al: fa(lt, c[3] + .1) });
  },
});

/* 当晚到盘：第二批时间线 */
S('s18', {
  cam: [[0, 960, 540, 1], [SCRIPT.s18.dur, 960, 540, 1.015]],
  cues: (() => { const c = CS('s18'); const keys = S18K(); return [...TL2.tracks.map(tr => [pkInv(tr.trig, keys), 'latch', .7]), ...TL2.tracks.map(tr => [pkInv(tr.done, keys), 'success', .6])]; })(),
  draw(g, lt) {
    const c = CS('s18'), keys = S18K(), M = pk(lt, keys);
    clockModule(g, M, { date: '10-31' });
    steel(g, 140, 268, 250, 92, { r: 10, screws: false, shadow: false });
    text(g, '全片', 160, 314, { s: 26, w: 900, a: 'left', c: C.ink2 });
    TL2.tracks.forEach((tr, k) => lamp(g, 264 + k * 34, 314, 10, M >= tr.done ? C.green : M >= tr.trig ? C.amber : C.grey, M >= tr.trig ? 1 : 0, { halo: 3 }));
    monRow(g, TL2, M, lt, keys, { cell: k => ({ flash: (M >= TL2.tracks[k].done ? .5 * (1 - seg(lt, pkInv(TL2.tracks[k].done, keys), pkInv(TL2.tracks[k].done, keys) + .35)) : 0) }) });
    nle(g, AX2, TL2, M, lt, { future: true });
    if (M >= 1317) { const x = xOf(AX2, 1317), p = seg(lt, pkInv(1317, keys), pkInv(1317, keys) + .4); path(g, [[x, 494], [x, 852]], { c: C.green, w: 3, al: p }); at(g, x - 100, 618, pop(p), () => { const s = '21:57 全部到盘', w = textW(g, s, { s: 26, w: 900 }) + 32; card(g, -w / 2, -24, w, 48, { r: 8, fill: C.green, lw: 0 }); text(g, s, 0, 1, { s: 26, w: 900, c: '#10151C' }); }); }
  },
});
function S18K() { const c = CS('s18'), d = SCRIPT.s18.dur; return [[0, 952], [1.0, 979], [1.8, 1255], [c[0] - .2, 1266], [c[0] + 3.8, 1286], [c[1] + 3.4, 1300], [c[2] + 2.6, 1318], [d, 1320]]; }

/* 这几期的账 */
const B2 = [['subscription', 54], ['jsruntime', 49], ['frameanim', 38], ['fps', 37]];
function flap(g, x, y, ch, flip, col) { // 翻牌：flip∈[0,1] 翻动进度
  rr(g, x - 46, y - 64, 92, 128, 10); g.fillStyle = '#0B0F14'; g.fill();
  const sq = flip < 1 ? Math.abs(Math.cos(flip * Math.PI)) : 1;
  g.save(); g.translate(x, y); g.scale(1, sq); text(g, ch, 0, 4, { f: 'disp', s: 96, w: 900, c: col }); g.restore();
  path(g, [[x - 46, y], [x + 46, y]], { c: '#05070A', w: 3 });
}
S('s19', {
  cam: [[0, 960, 540, 1], [SCRIPT.s19.dur, 960, 540, 1.015]],
  cues: (() => { const c = CS('s19'); return [...[0, 1, 2, 3].map(k => [c[0] + .3 + k * .25, 'flap', .6]), [c[1] + .3, 'whoosh', .5], [c[1] + 1.6, 'latch'], [c[2] + .3, 'whoosh', .6], [c[2] + 1.6, 'success']]; })(),
  draw(g, lt) {
    const c = CS('s19');
    const top = (role, name, num, x, t0) => {
      const s = ap(lt, t0 - .2, .45); if (s <= 0) return;
      at(g, x, 300, s, () => {
        steel(g, -260, -150, 520, 300, { r: 16 });
        badge(g, role, -170, -96, 30); text(g, name, -126, -94, { s: 34, w: 900, a: 'left', c: ROLE[role][1] });
        num.split('').forEach((d, k) => { const fl = seg(lt, t0 + k * .25, t0 + .5 + k * .25); flap(g, -60 + k * 104, 20, fl >= .5 ? d : String(Math.floor(hash(Math.floor(lt * 20) + k) * 10)), fl, ROLE[role][1]); });
        text(g, '次', 140, 48, { s: 40, w: 900, a: 'left' });
        text(g, '派发记录', 0, 114, { s: 24, w: 700, c: C.ink3 });
      });
    };
    top('codex', 'Codex', '25', 600, c[0] + .3);
    top('zcode', 'ZCode', '18', 1320, c[0] + .55);
    if (lt > c[1] - .1) {
      const k = 8, par = eio(seg(lt, c[2] + .2, c[2] + 1.4)), x0 = 960 - 178 * k / 2, bx = 960 - 54 * k / 2;
      if (par > 0) { g.save(); g.globalAlpha *= par; rr(g, bx - 10, 505, 54 * k + 20, 332, 10); g.fillStyle = 'rgba(5,8,12,.6)'; g.fill(); rr(g, bx - 10, 505, 54 * k + 20, 332, 10); g.lineWidth = 2; g.strokeStyle = C.green; g.stroke(); g.restore();
        text(g, '墙上时钟 54 分钟', 960, 482, { s: 24, w: 700, c: C.green, al: par }); }
      let acc = 0;
      B2.forEach(([slug, m], j) => {
        const p = eo(seg(lt, c[1] + .1 + j * .2, c[1] + .6 + j * .2)); if (p <= 0) { acc += m; return; }
        const xs = x0 + acc * k, ys = 600, xp = bx, yp = 530 + j * 76, x = lerp(xs, xp, par), y = lerp(ys, yp, par), w = m * k;
        g.save(); g.globalAlpha *= p; rr(g, x, y, w - 4, 56, 8); g.fillStyle = EPC[EPI[slug]]; g.fill();
        text(g, `${slug} ${m}`, x + 14, y + 29, { f: 'mono', s: 24, w: 700, a: 'left', c: '#10151C' }); g.restore();
        acc += m;
      });
      const ta = fa(lt, c[1] + 1.4) * (1 - par);
      if (ta > 0) { path(g, [[x0, 690], [x0, 706], [x0 + 178 * k, 706], [x0 + 178 * k, 690]], { c: C.amber, w: 3, al: ta }); text(g, '合计 178 分钟', 960, 742, { s: 30, w: 900, c: C.amber, al: ta }); }
    }
  },
});

/* =====================================================================
 * 总结
 * ===================================================================== */
const LESSON = ['创意留在\n主模型手里', '流程写成手册\n坑写进约定', '在哪停、怎么交接\n谁拍板，先设计好'];
S('s20', {
  cam: [[0, 960, 540, 1.015], [SCRIPT.s20.dur, 960, 540, 1]],
  cues: (() => { const c = CS('s20'); return [[c[0] + .3, 'clap'], [c[1] + .3, 'clap'], [c[2] + .3, 'clap'], ...EP.map((_, i) => [c[2] + 3.0 + i * .12, 'blip', .5]), [c[2] + 4.2, 'success']]; })(),
  draw(g, lt) {
    const c = CS('s20');
    LESSON.forEach((lab, k) => {
      const cx = 360 + k * 600, t0 = c[k] + .3, on = lt > t0, s = ap(lt, .2 + k * .12, .45);
      if (s <= 0) return;
      at(g, cx, 330, s, () => monitor(g, -240, -135, 480, 270, { lt, tally: on ? 'red' : 'grey', label: ['一', '二', '三'][k], right: '', lf: 'cjk', lfs: 26 }, (gg, ww, hh) => {
        gg.fillStyle = '#10151D'; gg.fillRect(0, 0, ww, hh);
        if (!on) return;
        const p = seg(lt, t0, t0 + 1.2);
        if (k === 0) {
          card(gg, 40, 50, 170, 170, { r: 8, fill: '#F3EEE4', lw: 0, shadow: false });
          const pts = []; for (let q = 0; q <= 40; q++) pts.push([60 + q * 3.2, 110 + Math.sin(q * .7) * 10 + (q > 20 ? 40 : 0) - (q > 20 ? 0 : 0)]);
          path(gg, partial(pts.slice(0, 21), p * 2), { c: C.coral, w: 4 }); path(gg, partial(pts.slice(21).map(([x, y]) => [x - 67, y]), p * 2 - 1), { c: C.coral, w: 4 });
          text(gg, 'Claude', 125, 244, { f: 'mono', s: 24, w: 700, c: C.coral });
          path(gg, [[240, 40], [240, 230]], { c: rgba(C.steel, .3), w: 2, dash: [6, 6] });
          at(gg, 360, 130, 1, () => { gg.rotate(-.6 + Math.sin(lt * 3) * .25); rr(gg, -10, -10, 20, 90, 6); gg.fillStyle = C.cyan; gg.fill(); ring(gg, 0, -26, 26, C.cyan, 12, 1, .9, TAU - .9); }, {});
          text(gg, '执行者', 360, 244, { s: 24, w: 700, c: C.cyan });
        } else if (k === 1) {
          handbook(gg, 140, 135, .62, { mini: true });
          card(gg, 260, 40, 180, 190, { r: 8, fill: '#F3EEE4', lw: 0, shadow: false });
          for (let q = 0; q < 4; q++) { const qp = seg(lt, t0 + .3 + q * .3, t0 + .6 + q * .3); icCheck(gg, 290, 80 + q * 42, 22, C.green, qp, 5); rr(gg, 316, 74 + q * 42, 100 * qp, 10, 4); gg.fillStyle = '#9AA3B0'; gg.fill(); }
        } else {
          at(gg, 110, 130, pop(p), () => { gg.beginPath(); for (let q = 0; q < 8; q++) { const an = Math.PI / 8 + q * TAU / 8; gg.lineTo(Math.cos(an) * 54, Math.sin(an) * 54); } gg.closePath(); gg.fillStyle = C.red; gg.fill(); text(gg, 'STOP', 0, 2, { f: 'disp', s: 26, w: 900, c: '#fff' }); });
          arrow(gg, [[190, 130], [300, 130]], { p: eo(seg(lt, t0 + .4, t0 + .9)), c: C.steel, w: 5, hs: 16 });
          badge(gg, 'me', 370, 130, 46, { s: ap(lt, t0 + .8) });
        }
      }));
      key(g, cx - 210, 680, 420, 120, lab, { on: on ? 1 : 0, press: Math.sin(clamp((lt - t0 + .1) / .3) * Math.PI), col: [C.coral, C.cyan, C.red][k], fs: 30, idle: true });
    });
    EP.forEach((_, i) => { const t0 = c[2] + 3.0 + i * .12; lamp(g, 960 - 3.5 * 64 + i * 64, 590, 11, C.green, lt > t0 ? 1 : 0, { halo: 3.5 }); });
    if (lt > c[2] + 3.0) text(g, '8 期全部到盘', 960, 640, { s: 26, w: 700, c: C.green, al: fa(lt, c[2] + 4.0) });
  },
});

S('s21', {
  title: true, fi: .3, fo: .4,
  draw(g, lt) {
    const a = eo(seg(lt, 0, .3));
    for (let i = 0; i < 8; i++) { const x = 360 + i * 172; g.save(); g.globalAlpha *= a * .5; rr(g, x - 70, 760, 140, 80, 6); g.fillStyle = '#06080B'; g.fill(); rr(g, x - 70, 760, 140, 80, 6); g.lineWidth = 2; g.strokeStyle = rgba(C.green, .6); g.stroke(); g.restore(); }
    lamp(g, 960, 360, 14, C.green, a);
    text(g, SERIES.title, 960, 490, { s: 110, w: 900, al: a });
    text(g, SERIES.sub, 960, 600, { s: 40, w: 700, c: C.cyan, al: eo(seg(lt, .2, .5)) });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  const st = ['green', 'green', 'green', 'green', 'red', 'amber', 'red', 'amber'];
  g.save(); g.translate(960, 712); g.scale(.82, .82); g.translate(-960, -440);
  for (let i = 0; i < 8; i++) { const [x, y, w, h] = cellRect(i); cellMon(g, i, x, y, w, h, 2.2 + i * .37, { tally: st[i] }); }
  g.restore();
  text(g, '8 期视频，怎么同时做', 960, 168, { s: 124, w: 900, glow: rgba(C.red, .35), gb: 30 });
  rr(g, 600, 262, 720, 10, 5); g.fillStyle = C.red; g.fill();
  text(g, 'Claude 制作全记录 · 工作档案', 960, 342, { s: 52, w: 900, c: C.cyan });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
