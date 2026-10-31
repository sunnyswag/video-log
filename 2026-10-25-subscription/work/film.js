/* =====================================================================
 * 设备订阅模块重构 —— 22 幕编排（字幕数据在 script.js，图元在 kit.js）
 * 结构：0 开场、1 片名、2–7 六章、8 总结、9 系列片尾（audio.py / checks.cjs 按此读取）。
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]。所有绘制只依赖时间 t。
 * ===================================================================== */
'use strict';
const CARD = {
  2: ['1', '一类数据，一条线路', 'ONE KIND, ONE LINE', LC[2]], 3: ['2', '类型对上，才能换乘', 'TYPES MUST MATCH', LC[4]],
  4: ['3', '八条线路，一张图', 'EIGHT LINES, ONE MAP', LC[5]], 5: ['4', '总站：一份 JSON', 'THE TERMINAL', LC[1]],
  6: ['5', '发车调度', 'DISPATCH', LC[0]], 7: ['6', '开一条新线', 'OPENING A NEW LINE', LC[3]], 8: ['✓', '三条设计经验', 'THREE TAKEAWAYS', C.navy2],
};
const CH_SHORT = ['开场', '', '第一章 · 一类数据，一条线路', '第二章 · 类型对上，才能换乘', '第三章 · 八条线路，一张图', '第四章 · 总站：一份 JSON',
  '第五章 · 发车调度', '第六章 · 开一条新线', '总结 · 三条设计经验', ''];
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };
const chColor = k => (CARD[k] || [0, 0, 0, C.amber])[3];

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.bg, white: C.ink, cyan: C.sky, red: C.coral, amber: C.amber },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: C.sky, danger: '#FF8A7A', accent: C.amber },
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

/* 章节转场：章节色粗线路沿斜向扫入 → 大号换乘站 + 标题 → 扫出 */
function chapterWipe(g, { sc, lt }) {
  const cd = CARD[sc.card]; if (!cd || lt > 1.95) return;
  const [num, zh, en, col] = cd;
  const pin = eio(seg(lt, 0, .38)), pout = eio(seg(lt, 1.42, 1.92));
  const x0 = lerp(-W - 500, -250, pin) + lerp(0, W + 700, pout);
  const band = new Path2D(); band.moveTo(x0, 0); band.lineTo(x0 + W + 500, 0); band.lineTo(x0 + W - 80, H); band.lineTo(x0 - 580, H); band.closePath();
  g.save();
  g.save(); shadow(g, .25, 40, 0); g.fillStyle = col; g.fill(band); g.restore();
  // 两侧白色轨边
  for (const off of [0, 40]) {
    g.beginPath(); g.moveTo(x0 + W + 500 + off, 0); g.lineTo(x0 + W + 520 + off, 0); g.lineTo(x0 + W - 60 + off, H); g.lineTo(x0 + W - 80 + off, H); g.closePath();
    g.fillStyle = off ? col : '#fff'; g.fill();
  }
  g.clip(band);
  // 斜向轨枕纹理
  g.save(); g.globalAlpha = .1; for (let i = -30; i < 60; i++) { const x = x0 + i * 60; path(g, [[x, 0], [x - 580, H]], { c: '#fff', w: 6 }); } g.restore();
  const a = eo(seg(lt, .3, .62)) * (1 - eo(seg(lt, 1.38, 1.6)));
  const dx = (1 - eo(seg(lt, .3, .7))) * 80;
  at(g, 520 - dx, 520, 1, () => {
    dot(g, 0, 0, 150, '#fff'); ring(g, 0, 0, 150, C.ink, 20);
    text(g, num, 0, 10, { f: 'disp', w: 900, s: num === '✓' ? 170 : 200, c: C.ink });
  }, { al: a });
  text(g, zh, 740 + dx * .5, 488, { s: 100, w: 900, c: '#fff', a: 'left', al: a });
  text(g, en, 746 + dx * .5, 584, { f: 'mono', s: 30, w: 700, ls: 8, c: rgba('#ffffff', .85), a: 'left', al: a });
  g.restore();
}

/* 外框：左上章节站牌、右上迷你线路进度、⚠ 标记 */
function drawChrome(g, { sc, lt }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 84;
    card(g, 50, 40, w, 52, { r: 12, fill: C.navy, lw: 0, sb: 12, so: 4, sa: .18 });
    dot(g, 82, 66, 15, chColor(sc.chapter)); ring(g, 82, 66, 15, '#fff', 3);
    text(g, lab, 108, 67, { s: 26, w: 700, a: 'left', c: '#fff' });
  }
  // 迷你线路：第一章 → 总结
  const X = k => 1548 + (k - 2) * 50;
  for (let k = 2; k < 8; k++) path(g, [[X(k), 66], [X(k + 1), 66]], { c: sc.chapter > k ? chColor(k) : rgba(C.ink, .2), w: 7 });
  for (let k = 2; k <= 8; k++) {
    if (sc.chapter === k) { dot(g, X(k), 66, 13, '#fff'); ring(g, X(k), 66, 13, chColor(k), 5); }
    else if (sc.chapter > k) dot(g, X(k), 66, 7, chColor(k));
    else { dot(g, X(k), 66, 7, '#fff'); ring(g, X(k), 66, 7, rgba(C.ink, .3), 2.5); }
  }
  let xr = 1510;
  const demo = typeof sc.demo === 'function' ? sc.demo(lt) : sc.demo, scaled = typeof sc.scaled === 'function' ? sc.scaled(lt) : sc.scaled;
  if (demo) xr -= tagSmall(g, '⚠ 机制演绎', xr, 66, C.amber, demo) + 12;
  if (scaled) tagSmall(g, '时间已放慢', xr, 66, LC[4], scaled);
  g.restore();
}
function tagSmall(g, s, xr, y, c, al = 1) {
  const w = textW(g, s, { s: 24, w: 700 }) + 36;
  g.save(); g.globalAlpha *= clamp(+al);
  card(g, xr - w, y - 22, w, 44, { r: 22, fill: rgba('#ffffff', .94), lw: 2.5, stroke: c, sb: 10, so: 3, sa: .08 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c: c === C.amber ? '#9A6A0C' : c });
  g.restore();
  return w;
}

/* 字幕：深蓝站牌底板（顶部章节色条）+ 白字 */
function capState(g, frame) {
  const { sc, lt } = frame; if (sc.title || sc.noCaption || !sc.captions?.length) return null;
  const i = sc.cs.findIndex((s, k) => lt >= s && lt < sc.ce[k]); if (i < 0) return null;
  const c = { t0: sc.start + sc.cs[i], t1: sc.start + sc.ce[i], text: sc.captions[i].text }, layout = film.captionLayout(g, c, frame.t);
  if (!layout) return null;
  return { layout, alpha: Math.min(seg(lt, sc.cs[i], sc.cs[i] + .12), 1 - seg(lt, sc.ce[i] - .12, sc.ce[i])) };
}
function drawCaptionBackground(g, frame) {
  CAMZ = 1; const c = capState(g, frame); if (!c) return;
  const L = c.layout.lines, w = Math.max(...L.map(l => l.width)) + 84, top = L[0].y - 66, h = (L.length - 1) * 64 + 98;
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .25)), x = (W - w) / 2, y = top + (1 - k) * 10;
  g.save(); g.globalAlpha *= c.alpha;
  rr(g, x, y, w, h, 16); shadow(g, .28, 26, 10); g.fillStyle = rgba(C.navy, .96); g.fill(); noShadow(g);
  g.save(); rr(g, x, y, w, h, 16); g.clip(); g.fillStyle = chColor(frame.sc.chapter); g.fillRect(x, y, w, 7); g.restore();
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
      if (s.c === C.amber) { rr(g, x - 2, l.y + 8 + (1 - k) * 10, w + 4, 7, 3); g.fillStyle = C.amber; g.fill(); }
      text(g, s.s, x, l.y + (1 - k) * 10, { s: 54, w: 700, c: s.c || '#FFFFFF', a: 'left', b: 'alphabetic' });
      x += w;
    }
  }
}

/* ---------------- 场景注册 ---------------- */
let lastChapter = -1;
function S(id, o) {
  const d = SCRIPT[id], first = d.chapter !== lastChapter;
  if (first) { film.chapter(d.chapter, ...CHAPTERS[d.chapter]); lastChapter = d.chapter; }
  return film.addScene({
    ...o, id, chapter: d.chapter, dur: d.dur, pre: 0, post: 0, demo: o.demo ?? d.demo,
    card: first && CARD[d.chapter] ? d.chapter : undefined,
    captions: d.caps.map(([t, end, text]) => ({ t, end, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t, type, v: v ?? 1 })),
    draw: (g, lt, sc) => o.draw(g, lt, sc),
  });
}

/* =====================================================================
 * 本期通用图元
 * ===================================================================== */
const CATS = [['看板卡片', LC[2]], ['场景卡片', LC[0]], ['推送服务', LC[4]], ['对讲设备', LC[1]], ['摄像头门锁', LC[3]], ['远程开锁', LC[5]]];
function catPill(g, s, x, y, col, o = {}) {
  const w = textW(g, s, { s: 26, w: 700 }) + 58, h = 48;
  at(g, x, y, o.s ?? 1, () => {
    card(g, -w / 2, -h / 2, w, h, { r: 24, fill: '#fff', lw: 3.5, stroke: col, sb: 12, so: 4, dash: o.dash });
    dot(g, -w / 2 + 24, 0, 9, col);
    text(g, s, 12, 1, { s: 26, w: 700, c: o.tc || C.ink });
  }, { al: o.al, rot: o.rot });
  return w;
}
/* 乱线团：第 k 条线在 [x0,x1] 内缠绕 */
function tanglePts(k, lt, x0, x1, cy, amp, n = 36) {
  const pts = [];
  for (let j = 0; j <= n; j++) {
    const u = j / n, env = Math.sin(u * Math.PI);
    const x = lerp(x0, x1, u) + amp * .7 * env * Math.sin(u * (8 + k) + k * 2.3 + lt * .5);
    const y = cy + amp * env * (Math.sin(u * (6 + k * .7) + k * 1.3 + lt * .6) * .65 + Math.sin(u * 13 - k * 2.1 - lt * .8) * .35);
    pts.push([x, y]);
  }
  return pts;
}
/* 终点总站：大胶囊 + 站台条 + 站名牌 */
function terminal(g, x, y, w, h, o = {}) {
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  rr(g, x, y, w, h, 34); shadow(g, .2, 30, 12); g.fillStyle = '#fff'; g.fill(); noShadow(g);
  g.lineWidth = 6; g.strokeStyle = C.ink; g.stroke();
  for (let i = 0; i < 4; i++) { rr(g, x + 34 + i * (w - 68) / 4 + 6, y + 30, (w - 68) / 4 - 12, h - 60, 10); g.fillStyle = rgba([LC[0], LC[1], LC[2], C.sky][i], .14 + .1 * (o.lit || 0)); g.fill(); }
  if (o.glow) { g.save(); rr(g, x, y, w, h, 34); g.shadowColor = rgba(C.amber, .8 * o.glow); g.shadowBlur = 36 * SH(); g.lineWidth = 6; g.strokeStyle = C.amber; g.stroke(); g.restore(); }
  g.restore();
  if (o.label !== false) sign(g, o.label || '总站 · 合并器', x + w / 2, y - 38, { s: 28, c: C.amber, al: o.al });
}

/* ---------------- 八条线路的线路图 ---------------- */
const LINES = [
  { src: '场景数据', segs: ['场景通道'] },
  { src: '对讲配置', segs: ['对讲配置'] },
  { src: '设备卡片', segs: ['型号过滤', '卡片转换', '资源转换'] },
  { src: '门锁数据', segs: ['卡片转换', '资源转换'] },
  { src: '推送负载', segs: ['设备订阅'] },
  { src: '远程开锁', segs: ['设备订阅'] },
  { src: '空间服务', segs: ['设备订阅'] },
  { src: '设备卡片', segs: ['其他设备过滤', '其他设备转换'] },
];
const MAP = { x0: 300, y0: 236, dy: 81, plus: [560, 820, 1080], st: { x: 1500, y: 350, w: 250, h: 330 } };
const GEO = LINES.map((L, i) => {
  const y = MAP.y0 + i * MAP.dy, ey = MAP.st.y + 46 + i * 34, d = ey - y, xb = MAP.st.x - 24 - Math.abs(d);
  const pts = [[MAP.x0, y], [xb, y], [xb + Math.abs(d), ey], [MAP.st.x + 30, ey]];
  const n = L.segs.length, pl = MAP.plus.slice(0, n);
  const bounds = [MAP.x0, ...pl, Math.min(xb, 1290)];
  const segs = L.segs.map((name, k) => ({ name, a: bounds[k + 1], b: bounds[k + 2], mid: (bounds[k + 1] + bounds[k + 2]) / 2 }));
  const tot = plen(pts), u = x => (x - MAP.x0) / tot; // 水平段上 x 对应的折线比例
  return { i, y, ey, pts, pl, segs, col: LC[i], tot, u, src: L.src };
});
/* o: p(i)→画出进度, al(i)→透明度, glowSeg(i,k)→段发光, glowSrc(i), labels, station, trains:[{i,u,cargo}] */
function drawMap(g, lt, o = {}) {
  const P = i => o.p ? o.p(i) : 1, A = i => o.al ? o.al(i) : 1;
  if (o.station !== false) {
    const sa = o.stAl ?? 1;
    // 先画进站的线，再画总站压住线尾
    GEO.forEach(L => { if (P(L.i) > 0) metroLine(g, L.pts, L.col, { p: P(L.i), al: A(L.i) }); });
    terminal(g, MAP.st.x, MAP.st.y, MAP.st.w, MAP.st.h, { al: sa, glow: o.stGlow, lit: o.stLit, label: o.labels === false ? false : undefined });
  } else GEO.forEach(L => { if (P(L.i) > 0) metroLine(g, L.pts, L.col, { p: P(L.i), al: A(L.i) }); });
  GEO.forEach(L => {
    const p = P(L.i), al = A(L.i); if (p <= 0 || al <= 0) return;
    const reach = x => p * L.tot >= x - MAP.x0 - 1;
    L.segs.forEach((s, k) => {
      const gl = o.glowSeg ? o.glowSeg(L.i, k) : 0;
      if (gl > 0) {
        metroLine(g, [[s.a + 20, L.y], [s.b - 4, L.y]], L.col, { glow: gl, casing: false, al });
        const ph = (lt * .6 + k * .3) % 1, fx = lerp(s.a + 20, s.b - 4, ph);
        dot(g, fx, L.y, 6, '#fff', gl * al * Math.sin(ph * Math.PI));
      }
      if (o.labels !== false && reach(s.mid)) text(g, s.name, s.mid, L.y - 30, { s: 24, w: 700, c: C.ink, al: al * fa(lt, 0, .01) });
    });
    L.pl.forEach(x => { if (reach(x)) plusSt(g, x, L.y, 1, { al }); });
    const sg = o.glowSrc ? o.glowSrc(L.i) : 0;
    srcSt(g, MAP.x0, L.y, L.col, 1 + .18 * sg, { al });
    if (sg > 0) ring(g, MAP.x0, L.y, 30 + 10 * sg, L.col, 4, sg * al);
    if (o.labels !== false) {
      text(g, L.src, MAP.x0 - 40, L.y + 1, { s: 26, w: 900, a: 'right', c: C.ink, al });
      lineBadge(g, L.i + 1, 112, L.y, L.col, 1, { al });
    }
  });
  (o.trains || []).forEach(tr => train(g, GEO[tr.i].pts, tr.u, GEO[tr.i].col, { s: .9, cargo: tr.cargo, al: tr.al }));
}

/* =====================================================================
 * 开场
 * ===================================================================== */
const SCR = [420, 480], GW = [1500, 470];
S('s01', {
  fi: .5,
  cam: [[0, 960, 500, 1.06], [12.6, 960, 480, 1]],
  cues: [[.3, 'draw'], [1.4, 'blip', .4], [4.4, 'blip'], [5.0, 'whoosh'], [7.2, 'confirm'], ...CATS.map((_, k) => [8.6 + k * .28, 'blip', .6]), [10.6, 'tick']],
  draw(g, lt) {
    const ln = [[SCR[0] + 140, 480], [GW[0] - 130, 480]];
    metroLine(g, ln, C.grey, { p: eo(seg(lt, .3, 1.3)), w: 12 });
    [760, 960, 1160].forEach((x, k) => { if (lt > .6 + k * .2) tickSt(g, x, 480, C.grey); });
    screenIcon(g, SCR[0], SCR[1], ap(lt, .1, .6), lt, { label: '智能屏' });
    gatewayIcon(g, GW[0], GW[1], ap(lt, .35, .6), lt, { label: '家庭网关', busy: win(lt, 5.8, 8.2) });
    // 变化推回屏：网关 → 屏的小脉冲
    const push = win(lt, 1.3, 4.3) + win(lt, 7.6, 12.6) * .7;
    if (push > 0) for (let i = 0; i < 5; i++) {
      const ph = ((lt * .5 + i / 5) % 1), x = lerp(ln[1][0], ln[0][0], ph);
      dot(g, x, 480, 7, C.sky, push * Math.sin(ph * Math.PI)); ring(g, x, 480, 7, C.navy, 2, push * Math.sin(ph * Math.PI));
    }
    // JSON 车票
    const jt = ap(lt, 4.3, .5);
    if (lt < 5.1) jsonTicket(g, SCR[0] + 10, 330, jt);
    if (lt >= 5.0 && lt < 7.6) {
      const u = eio(seg(lt, 5.0, 7.2));
      train(g, ln, u, C.navy2, { len: 74, cargo: gg => jsonTicket(gg, 0, -52, .55) });
    }
    if (lt >= 7.2) { ripple(g, GW[0], GW[1], lt - 7.2, C.navy2, 40, 160, .8); if (lt < 8.4) jsonTicket(g, GW[0], 330, fo(lt, 7.9, .5) * .8); }
    // 六类订阅
    CATS.forEach(([s, c], k) => { const p = ap(lt, 8.6 + k * .28, .5); if (p > 0) catPill(g, s, 380 + k * 232, 236, c, { s: p }); });
    if (lt > 10.6) catPill(g, '更多…', 960, 168, C.grey, { s: ap(lt, 10.6, .5), dash: [8, 6], tc: C.ink2 });
  },
});

const VM = { x: 640, y: 330, w: 640, h: 310 };
const TRIG = [['主界面刷新', 360], ['数据同步', 485], ['推送事件', 610]];
function vmBox(g, lt, shake, o = {}) {
  const { x, y, w, h } = VM;
  g.save(); g.translate(Math.sin(lt * 50) * 6 * shake, 0);
  card(g, x, y, w, h, { r: 26, fill: '#ECE8DE', lw: 4, sa: .18 });
  g.save(); rr(g, x, y, w, h, 26); g.clip();
  CATS.forEach(([, c], k) => metroLine(g, tanglePts(k, lt, x + 30, x + w - 30, y + h / 2 + 10, 120), c, { w: 10, casing: true, case: '#ECE8DE', al: o.tAl ?? 1 }));
  g.restore();
  sign(g, '主界面 ViewModel', x + w / 2, y, { s: 30, c: C.grey, f: 'cjk' });
  g.restore();
}
S('s02', {
  cam: [[0, 960, 490, 1], [12.1, 960, 490, 1.04]],
  cues: [[.4, 'whoosh', .5], [1.6, 'tick'], [2.3, 'tick'], [3.0, 'tick'], [5.0, 'error', .5], [6.4, 'error', .5], [9.3, 'error'], [9.7, 'blip']],
  draw(g, lt) {
    const hits = [1.6, 2.3, 3.0], shake = Math.max(...hits.map(h => clamp(1 - Math.abs(lt - h - .1) / .25))) + clamp(1 - Math.abs(lt - 9.4) / .3) * 1.4;
    // 六类订阅从顶部落到左侧，线路钻进 ViewModel
    CATS.forEach(([s, c], k) => {
      const yk = 360 + k * 52, m = eio(seg(lt, .1, 1.0));
      metroLine(g, [[300, yk], [VM.x + 40, yk]], c, { p: eo(seg(lt, .6, 1.4)), w: 10 });
      catPill(g, s, lerp(380 + k * 232, 180, m), lerp(236, yk, m), c);
    });
    vmBox(g, lt, shake);
    TRIG.forEach(([s, y], k) => {
      const a = fa(lt, .9 + k * .2);
      sign(g, s, 1580, y, { s: 26, c: LC[[2, 5, 1][k]], al: a });
      const p = eo(seg(lt, hits[k] - .5, hits[k]));
      arrow(g, [[1490, y], [VM.x + VM.w + 14, lerp(y, VM.y + VM.h / 2, .4)]], { c: C.ink, w: 4, p, al: a, dash: [10, 8], off: -lt * 30 });
    });
    if (lt > 5.0) tag(g, '没有区分', VM.x + 150, VM.y + VM.h + 50, C.coral, seg(lt, 5.0, 5.4), { fs: 28 });
    if (lt > 6.4) tag(g, '复用不合理', VM.x + VM.w - 150, VM.y + VM.h + 50, C.coral, seg(lt, 6.4, 6.8), { fs: 28 });
    // 第七类：虚线挤进来被弹开
    if (lt > 8.1) {
      const bk = lt > 9.4 ? -Math.sin(clamp((lt - 9.4) / .5) * Math.PI) * 30 : 0;
      const p = eo(seg(lt, 8.2, 9.4));
      const pts = [[300, 790], [520 + bk, 790], [VM.x - 6 + bk, VM.y + VM.h - 30]];
      metroLine(g, pts, C.grey, { p, w: 10, dash: [16, 12] });
      catPill(g, '第七类？', 180, 790, C.grey, { s: ap(lt, 8.1, .5), dash: [8, 6], tc: C.ink2 });
      if (lt > 9.7) at(g, VM.x - 30, VM.y + VM.h - 80, pop(seg(lt, 9.7, 10.1)), () => { dot(g, 0, 0, 32, C.coral); ring(g, 0, 0, 32, C.ink, 3); text(g, '?', 0, 3, { f: 'disp', w: 900, s: 42, c: '#fff' }); });
    }
  },
});

/* =====================================================================
 * 片名
 * ===================================================================== */
S('s03', {
  title: true, fi: .3,
  cues: [[.2, 'draw'], [1.3, 'latch'], [2.6, 'blip', .5]],
  draw(g, lt) {
    drawMap(g, lt, { p: i => eo(seg(lt, .1 + i * .12, 1.5 + i * .12)), al: () => .55, labels: false, stAl: .7 });
    const k = ap(lt, 1.2, .6);
    at(g, 960, 470, k, () => {
      rr(g, -520, -120, 1040, 240, 26); shadow(g, .3, 40, 16); g.fillStyle = C.navy; g.fill(); noShadow(g);
      g.save(); rr(g, -520, -120, 1040, 240, 26); g.clip(); LC.forEach((c, i) => { g.fillStyle = c; g.fillRect(-520 + i * 130, -120, 130, 12); }); g.restore();
      text(g, '设备订阅模块重构', 0, -18, { s: 96, w: 900, c: '#fff' });
      text(g, '八条管道，一个总站', 0, 72, { s: 40, w: 700, c: C.sky, al: fa(lt, 2.4, .5) });
    });
  },
});

/* =====================================================================
 * 第一章 一类数据，一条线路
 * ===================================================================== */
const ROW6 = k => 330 + k * 66;
function row6Pts(k) {
  const y = ROW6(k), ey = 400 + k * 50, d = Math.abs(ey - y), xb = 1440 - d;
  return [[300, y], [xb, y], [xb + d, ey], [1530, ey]];
}
const TYPES6 = ['List<设备卡片>', null, '三元组集合', null, null, '三元组集合'];
S('s04', {
  cam: [[0, 960, 500, 1], [16.7, 960, 500, 1.03]],
  cues: [[0, 'whoosh'], [2.2, 'draw', .4], [4.8, 'snap'], [5.2, 'tick', .5], [8.2, 'blip'], [8.6, 'blip'], [9.0, 'blip'], [12.6, 'draw'], [13.6, 'latch'], [14.3, 'confirm']],
  draw(g, lt) {
    const IDEAS = [['① 一类一条管道', 4.7], ['② 按类型划分', 8.0], ['③ 拼成一份', 12.4]];
    IDEAS.forEach(([s, t0], i) => flipSign(g, s, 420 + i * 540, 168, seg(lt, t0, t0 + .45), { s: 30, c: [LC[2], LC[4], C.amber][i] }));
    const un = eio(seg(lt, 4.8, 6.2)), ext = eo(seg(lt, 12.5, 13.6));
    CATS.forEach(([, c], k) => {
      const straight = row6Pts(k), y = ROW6(k);
      const tang = tanglePts(k, lt, 660, 1260, 500, 120, 36);
      // 主干：左侧引线 + 乱线 → 拉直
      const body = tang.map(([x, yy], j) => L2([x, yy], [lerp(660, 1260, j / 36), y], un));
      const lead = [[300, y], [660, lerp(500 + (k - 2.5) * 20, y, un)]];
      const p0 = eo(seg(lt, 2.0 + k * .08, 3.0 + k * .08));
      metroLine(g, lead.concat(body), c, { w: 12, p: p0 });
      if (ext > 0) metroLine(g, [[1260, y], ...straight.slice(1)], c, { w: 12, p: ext });
      srcSt(g, 300, y, c, ap(lt, 2.0 + k * .08, .4));
      if (lt > 8.1) {
        const x = k % 2 ? 1000 : 820, sp = ap(lt, 8.2 + k * .14, .4);
        plusSt(g, x, y, sp);
        if (TYPES6[k]) platform(g, TYPES6[k], x, y - 40, { s: 22, al: fa(lt, 8.5 + k * .14) });
      }
    });
    if (ext > 0) terminal(g, 1500, 360, 210, 340, { al: fa(lt, 12.9, .5), label: '一份订阅数据' });
    if (lt > 14.0) jsonTicket(g, lerp(1605, 1790, eo(seg(lt, 14.0, 14.8))), 530, ap(lt, 14.0, .5));
  },
});

const SYS = [['触发入口', 'ViewModel 等', 230], ['订阅仓库', '唯一入口', 520], ['订阅工厂', '并发跑管道', 810], ['8 条管道', '收集 + 转换', 1100], ['合并器', '拼成一份 JSON', 1390], ['网关', '接收订阅', 1680]];
S('s05', {
  cam: [[0, 960, 520, 1], [9.3, 960, 520, 1.02]],
  cues: [...SYS.map((_, k) => [.5 + k * .42, 'tick', .7]), [3.0, 'blip'], [4.7, 'latch'], [5.0, 'type', .6]],
  draw(g, lt) {
    const Y = 610;
    metroLine(g, [[230, Y], [1680, Y]], C.navy2, { p: eo(seg(lt, .4, 2.9)), w: 16 });
    SYS.forEach(([nm, ds, x], k) => {
      const t0 = .5 + k * .42, p = ap(lt, t0, .45);
      if (k === 0 || k === 5) srcSt(g, x, Y, C.navy2, p); else plusSt(g, x, Y, p * 1.15);
      flipSign(g, nm, x, Y + 64, seg(lt, t0 + .1, t0 + .5), { s: 28, c: k >= 1 && k <= 4 ? C.sky : C.grey });
      text(g, ds, x, Y + 120, { s: 24, w: 700, c: C.ink2, al: fa(lt, t0 + .3) });
    });
    // 独立订阅模块括号
    const bp = eo(seg(lt, 3.0, 3.8));
    if (bp > 0) {
      path(g, partial([[440, Y + 170], [440, Y + 186], [1470, Y + 186], [1470, Y + 170]], bp), { c: C.sky, w: 5 });
      tag(g, '独立订阅模块', 955, Y + 186, C.navy2, seg(lt, 3.5, 3.9), { fs: 26 });
    }
    // 光点跑全程
    const run = (lt * .25) % 1;
    if (lt > 2.9) dot(g, lerp(230, 1680, run), Y, 7, '#fff', .9);
    // 三个触发入口都只调 subscribeAll()
    const ent = [['主界面 ViewModel', 300], ['数据同步器', 380], ['推送事件', 460]];
    ent.forEach(([s, y], k) => {
      const a = fa(lt, 4.5 + k * .15);
      catPill(g, s, 230, y, LC[[2, 5, 1][k]], { al: a, s: .95 });
      const p = eo(seg(lt, 4.7 + k * .15, 5.4 + k * .15));
      arrow(g, [[350 + (k === 0 ? 40 : 0), y], [440, y], [500, 500]], { c: C.ink, w: 4, p, al: a });
    });
    if (lt > 5.0) platform(g, 'subscribeAll()', 590, 466, { s: 26, al: fa(lt, 5.0), stroke: C.navy2 });
    if (lt > 5.4) ripple(g, 520, Y, (lt - 5.4) % 1.2, C.sky, 20, 60, .8);
  },
});

/* =====================================================================
 * 第二章 类型对上，才能换乘
 * ===================================================================== */
function cargoShape(g, x, y, kind, c, s = 1) {
  at(g, x, y, s, () => {
    if (kind === 0) { dot(g, 0, 0, 13, c); ring(g, 0, 0, 13, C.ink, 2.5); }
    else if (kind === 1) { rr(g, -12, -12, 24, 24, 4); g.fillStyle = c; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke(); }
    else { g.beginPath(); g.moveTo(0, -15); g.lineTo(15, 0); g.lineTo(0, 15); g.lineTo(-15, 0); g.closePath(); g.fillStyle = c; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke(); }
  });
}
S('s06', {
  cam: [[0, 960, 520, 1.05], [9.2, 960, 520, 1.05], [10.4, 880, 520, 1], [13.0, 880, 520, 1], [14.2, 1090, 520, 1], [17.1, 1090, 520, 1]],
  cues: [[0, 'whoosh'], [2.3, 'draw'], [6.2, 'latch'], [9.6, 'blip'], [10.0, 'draw', .6], [13.3, 'tick'], [13.9, 'tick'], [14.4, 'blip', .5]],
  draw(g, lt) {
    const Y = 540, A = 700, B = 1220, col = LC[4];
    // 生产者段与两段通道
    const pp = eo(seg(lt, 9.7, 10.5)), c1 = eo(seg(lt, 13.2, 13.8)), c2 = eo(seg(lt, 13.8, 14.4));
    if (pp > 0) metroLine(g, [[380, Y], [A, Y]], col, { w: 22, p: pp });
    metroLine(g, [[A, Y], [B, Y]], col, { w: 22, p: eo(seg(lt, 2.2, 3.0)) });
    if (c1 > 0) metroLine(g, [[B, Y], [1500, Y]], col, { w: 22, p: c1 });
    if (c2 > 0) metroLine(g, [[1500, Y], [1780, Y]], col, { w: 22, p: c2 });
    // 数据流：T 圆 → R 方
    const flow = fa(lt, 3.0, .5);
    for (let i = 0; i < 6; i++) {
      const ph = (lt * .32 + i / 6) % 1, x = lerp(A - 140, B + 140, ph), kind = x < (A + B) / 2 ? 0 : 1;
      const a = flow * Math.sin(ph * Math.PI) * (lt < 9.4 ? 1 : .35);
      g.save(); g.globalAlpha *= a; cargoShape(g, x, Y - 2, kind, kind ? C.amber : C.sky, .9); g.restore();
    }
    plusSt(g, A, Y, ap(lt, 2.6, .5) * 1.5); plusSt(g, B, Y, ap(lt, 2.9, .5) * 1.5);
    platform(g, 'T', A, Y - 86, { s: 34, al: fa(lt, 3.2) }); platform(g, 'R', B, Y - 86, { s: 34, al: fa(lt, 3.5) });
    text(g, '吃进', A, Y + 66, { s: 28, w: 900, c: C.ink2, al: fa(lt, 3.4) }); text(g, '吐出', B, Y + 66, { s: 28, w: 900, c: C.ink2, al: fa(lt, 3.7) });
    flipSign(g, 'Stage<T, R>', (A + B) / 2, 340, seg(lt, 6.1, 6.6), { s: 42, f: 'mono', c: col });
    // 生产者：始发站 + 数据源
    if (lt > 9.5) {
      srcSt(g, 380, Y, col, ap(lt, 9.6, .5) * 1.5);
      flipSign(g, '生产者', 380, Y + 84, seg(lt, 9.9, 10.3), { s: 28, c: LC[1] });
      const srcs = [['数据库', 250, 320], ['跨应用表', 510, 320]];
      srcs.forEach(([s, x, y], k) => {
        const a = fa(lt, 10.4 + k * .2);
        storageIcon(g, x, y - 10, .5, { al: a });
        text(g, s, x, y + 34, { s: 24, w: 700, c: C.ink2, al: a });
        if (a > 0) { const ph = (lt * .8 + k * .3) % 1; dot(g, lerp(x, 380, ph), lerp(y + 50, Y - 30, ph), 6, C.sky, a * Math.sin(ph * Math.PI)); }
      });
    }
    // 通道：过滤、转换
    if (lt > 13.1) {
      plusSt(g, 1500, Y, ap(lt, 13.6, .5) * 1.5);
      flipSign(g, '通道 · 过滤', 1360, Y + 84, seg(lt, 13.4, 13.8), { s: 26, c: C.sky });
      flipSign(g, '通道 · 转换', 1640, Y + 84, seg(lt, 14.0, 14.4), { s: 26, c: C.sky });
      for (let i = 0; i < 5; i++) {
        const ph = (lt * .3 + i / 5) % 1, x = lerp(B, 1780, ph);
        const drop = x > 1360 && i % 3 === 0;
        const kind = x < 1500 ? 1 : 2, a = fa(lt, 14.4) * Math.sin(ph * Math.PI);
        g.save(); g.globalAlpha *= a * (drop ? fo(x, 1360, 60) : 1); cargoShape(g, x, Y - 2 + (drop ? (x - 1360) * .5 : 0), kind, kind === 2 ? C.green : C.amber, .85); g.restore();
      }
    }
  },
});

const CORE = [
  'interface Source<R> { suspend fun produce(): R }',
  '',
  'abstract class Stage<T, R> : Source<R> {',
  '    lateinit var upstream: Source<T>   // 上一段',
  '}',
  '',
  'operator fun <T, R> Source<T>.plus(b: Stage<T, R>) =',
  '    b.also { it.upstream = this }      // 记住上游',
];
S('s07', {
  cam: [[0, 960, 520, 1]],
  cues: [[.5, 'type'], [1.7, 'latch'], [3.6, 'type'], [4.0, 'draw'], [9.0, 'success'], [11.4, 'whoosh', .5], [12.1, 'error']],
  draw(g, lt) {
    const typed = lt < 3.4 ? .62 * eo(seg(lt, .4, 3.0)) : .62 + .38 * seg(lt, 3.5, 5.2);
    codeCard(g, 60, 230, 880, CORE, { title: 'Pipeline.kt（示意）', fs: 24, lh: 42, p: typed, hl: lt > 7.1 ? [6] : lt > 3.4 ? [6, 7] : [], hlA: fa(lt, 3.5) });
    const Y = 470, J = 1400, sw = lt > 11.2 ? eio(seg(lt, 11.3, 12.0)) : 0;
    const ain = eio(seg(lt, .5, 1.6)), aX = lerp(-160, 0, ain), bX = lerp(160, 0, ain);
    metroLine(g, [[1040 + aX, Y], [J + aX, Y]], LC[2], { w: 20 });
    text(g, 'a · 设备卡片', 1220 + aX, Y - 50, { s: 26, w: 900, al: ain });
    // b 被换掉：原 b 下沉淡出，b' 从右侧滑入
    const bOut = 1 - sw;
    if (bOut > 0) { g.save(); g.globalAlpha *= bOut; g.translate(0, sw * 80); metroLine(g, [[J + bX, Y], [1780 + bX, Y]], LC[2], { w: 20 }); text(g, 'b · 型号过滤', 1590 + bX, Y - 50, { s: 26, w: 900, al: ain }); g.restore(); }
    if (sw > 0) { const dx = (1 - sw) * 240; metroLine(g, [[J + dx, Y], [1780 + dx, Y]], LC[4], { w: 20, al: sw }); text(g, 'b · 设备订阅', 1590 + dx, Y - 50, { s: 26, w: 900, al: sw }); }
    const bad = seg(lt, 12.0, 12.2);
    plusSt(g, J, Y, ap(lt, 1.6, .5) * 1.5, { c: bad > 0 ? C.coral : C.ink, glow: win(lt, 1.6, 2.6) });
    if (lt > 1.7) ripple(g, J, Y, lt - 1.7, C.amber, 30, 110, .8);
    // upstream 指针：b → a
    const up = eo(seg(lt, 3.9, 4.9));
    if (up > 0 && lt < 11.3) {
      const pts = []; for (let i = 0; i <= 20; i++) { const u = i / 20; pts.push([lerp(1600, 1220, u), Y - 90 - Math.sin(u * Math.PI) * 120]); }
      arrow(g, pts, { c: C.navy2, w: 4, p: up, dash: [12, 8], off: -lt * 20, al: fo(lt, 11.0, .3) });
      platform(g, 'upstream', 1410, Y - 236, { s: 26, al: fa(lt, 4.6) * fo(lt, 11.0, .3), stroke: C.navy2 });
    }
    // 站台牌：类型对上 / 对不上
    if (lt > 7.2) {
      const a = fa(lt, 7.3);
      platform(g, 'List<设备卡片>', J - 170, Y + 80, { s: 24, al: a });
      platform(g, sw > .5 ? '三元组集合' : 'List<设备卡片>', J + 170, Y + 80, { s: 24, al: a, stroke: bad > 0 ? C.coral : C.ink, tc: bad > 0 ? C.coral : C.ink });
      text(g, bad > 0 ? '≠' : '=', J, Y + 82, { f: 'disp', s: 44, w: 900, c: bad > 0 ? C.coral : C.green, al: a });
    }
    if (lt > 9.0 && lt < 11.4) tag(g, '编译通过 ✓', J, Y + 170, C.green, seg(lt, 9.0, 9.4), { fs: 28, al: fo(lt, 11.0, .3) });
    if (bad > 0) {
      // 红色闸门 + 编译错误框
      const gk = eo(seg(lt, 12.0, 12.4)), sq = lt < 12.6 ? Math.sin(seg(lt, 12.3, 12.6) * Math.PI) * .12 : 0;
      at(g, J, Y, 1, () => { rr(g, -8, -70 + (1 - gk) * -60, 16, 140 * (1 + sq), 6); g.fillStyle = C.coral; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); }, { al: gk });
      at(g, J, Y + 196, pop(seg(lt, 12.2, 12.6)), () => {
        card(g, -250, -40, 500, 80, { r: 14, fill: '#FFF1EF', lw: 3.5, stroke: C.coral });
        icCross(g, -206, 0, 30, C.coral, 1, 6);
        text(g, '类型不匹配，编译失败', 22, 1, { s: 30, w: 900, c: C.coral });
      });
    }
  },
});

/* 第 8 幕：Any 与带类型的对照（⚠ 演绎） */
function miniPipe(g, x0, y, cols, o = {}) {
  const xs = [x0, x0 + 230, x0 + 460, x0 + 690];
  for (let k = 0; k < 3; k++) metroLine(g, [[xs[k], y], [xs[k + 1], y]], cols[k], { w: 14, p: o.p ?? 1 });
  srcSt(g, xs[0], y, cols[0], .9);
  [1, 2].forEach(k => plusSt(g, xs[k], y, 1, { c: o.bad === k ? C.coral : C.ink }));
  return xs;
}
function miniTimeline(g, x0, y, mark, col, a) {
  const L = ['写代码', '编译', '运行'];
  metroLine(g, [[x0, y], [x0 + 560, y]], C.grey, { w: 8, al: a });
  L.forEach((s, k) => { const x = x0 + k * 280; dot(g, x, y, 11, '#fff', a); ring(g, x, y, 11, C.ink, 3, a); text(g, s, x, y + 40, { s: 26, w: 700, c: C.ink2, al: a }); });
  if (mark != null) { const x = x0 + mark * 280; at(g, x, y, pop(a), () => { dot(g, 0, 0, 20, col); icCross(g, 0, 0, 22, '#fff', 1, 5); }); }
}
S('s08', {
  cam: [[0, 960, 520, 1]],
  cues: [[.6, 'latch'], [3.0, 'tick'], [4.6, 'whoosh'], [6.4, 'error'], [8.2, 'draw'], [9.0, 'error', .6], [10.6, 'success']],
  draw(g, lt) {
    const R = fa(lt, 7.8, .5) * .65 + .35;
    // 左：全是 Any
    card(g, 70, 170, 860, 650, { r: 26, fill: rgba('#ffffff', .75), lw: 3, stroke: C.grey });
    sign(g, '全是 Any', 500, 170, { s: 30, c: C.grey });
    const xsL = miniPipe(g, 150, 400, [C.grey, C.grey, C.grey], { p: eo(seg(lt, .5, 1.6)) });
    ['Any', 'Any'].forEach((s, k) => platform(g, s, xsL[k + 1], 340, { s: 24, al: fa(lt, 1.4 + k * .2) }));
    if (lt > 3.0 && lt < 7.8) tag(g, '能编译 ✓', 500, 520, C.green, seg(lt, 3.0, 3.4), { fs: 26 });
    if (lt > 4.6) {
      const u = eio(seg(lt, 4.6, 6.4)), shakeK = seg(lt, 6.0, 6.4);
      const pts = [[xsL[0], 400], [xsL[3], 400]];
      if (lt < 6.5) { g.save(); g.translate(Math.sin(lt * 70) * 5 * shakeK, 0); train(g, pts, u * .8, C.grey, { cargo: gg => { if (shakeK > 0) dot(gg, 0, -30, 12 * shakeK, C.coral, shakeK); } }); g.restore(); }
      burst(g, xsL[2] + 50, 400, lt - 6.4, C.coral, 16, 130);
      if (lt > 6.4) tag(g, '运行时才发现', xsL[2] + 50, 300, C.coral, seg(lt, 6.4, 6.8), { fs: 28 });
    }
    miniTimeline(g, 220, 660, lt > 6.4 ? 2 : null, C.coral, fa(lt, 1.0));
    // 右：带类型
    g.save(); g.globalAlpha *= R;
    card(g, 990, 170, 860, 650, { r: 26, fill: rgba('#ffffff', .85), lw: 3, stroke: C.navy2 });
    sign(g, '带类型', 1420, 170, { s: 30, c: LC[4] });
    const xsR = miniPipe(g, 1070, 400, [LC[2], LC[2], LC[4]], { bad: lt > 8.2 ? 2 : null });
    platform(g, 'List<设备卡片>', xsR[1], 340, { s: 22 });
    platform(g, '三元组集合', xsR[2], 340, { s: 22, stroke: lt > 8.2 ? C.coral : C.ink });
    const wv = eo(seg(lt, 8.2, 8.9));
    if (wv > 0) { const pts = []; for (let i = 0; i <= 40; i++) pts.push([xsR[2] - 80 + i * 4, 372 + Math.sin(i * 1.4) * 5]); path(g, partial(pts, wv), { c: C.coral, w: 4 }); }
    if (lt > 9.0) tag(g, '写下时就报错', xsR[2], 520, C.coral, seg(lt, 9.0, 9.4), { fs: 26 });
    if (lt > 10.6) tag(g, '编译器核对上下游', 1420, 590, LC[4], seg(lt, 10.6, 11.0), { fs: 26 });
    miniTimeline(g, 1140, 700, lt > 9.0 ? 1 : null, C.coral, 1);
    g.restore();
  },
});

/* 第 9 幕：从尾部拉取 */
const PULL = { y: 500, xs: [260, 640, 1020, 1400, 1720], names: ['设备卡片', '型号过滤', '卡片转换', '资源转换'] };
function pullCargo(g, k) {
  if (k === 0) for (let i = 0; i < 3; i++) { rr(g, -26 + i * 14, -64 + i * 3, 22, 28, 4); g.fillStyle = [LC[2], C.amber, LC[5]][i]; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); }
  else if (k === 1) for (let i = 0; i < 2; i++) { rr(g, -18 + i * 16, -62, 22, 28, 4); g.fillStyle = [LC[2], LC[5]][i]; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); }
  else if (k === 2) { dot(g, 0, -50, 11, LC[2]); ring(g, 0, -50, 11, C.ink, 2); for (let i = 0; i < 3; i++) dot(g, -20 + i * 20, -72, 5, C.ink2); }
  else { text(g, '{ }', 0, -52, { f: 'mono', s: 28, w: 700, c: C.navy }); dot(g, -7, -52, 3, C.amber); dot(g, 7, -52, 3, C.amber); }
}
S('s09', {
  cam: [[0, 990, 500, 1]],
  cues: [[.6, 'blip'], [4.4, 'blip', .6], [5.2, 'blip', .6], [6.0, 'blip', .6], [6.8, 'blip'], [8.3, 'whoosh'], [9.0, 'tick'], [9.8, 'tick'], [10.6, 'tick'], [11.3, 'confirm']],
  draw(g, lt) {
    const { y, xs, names } = PULL, col = LC[2];
    metroLine(g, [[xs[0], y], [xs[4], y]], col, { w: 18 });
    names.forEach((s, k) => {
      const mid = (xs[k] + xs[k + 1]) / 2;
      text(g, s, mid, y - 46, { s: 28, w: 900 });
    });
    srcSt(g, xs[0], y, col, 1.3);
    [1, 2, 3].forEach(k => plusSt(g, xs[k], y, 1.3));
    at(g, xs[4], y, 1, () => { rr(g, -14, -34, 28, 68, 8); g.fillStyle = C.navy; g.fill(); });
    // produce() 请求：从尾部逐站往回跳
    const hops = [[xs[4], .6], [xs[3], 4.4], [xs[2], 5.2], [xs[1], 6.0], [xs[0], 6.8]];
    let bx = xs[4], by = y - 130, ba = fa(lt, .6) * fo(lt, 8.0, .4);
    for (let i = 1; i < hops.length; i++) {
      const [xa] = hops[i - 1], [xb2, t0] = hops[i], k = eio(seg(lt, t0 - .6, t0));
      if (lt >= t0 - .6) { bx = lerp(xa, xb2, k); by = y - 130 - Math.sin(k * Math.PI) * 60; }
      if (lt >= t0) { ripple(g, xb2, y, lt - t0, C.amber, 24, 80, .7); text(g, 'produce()', xb2, y - 104, { f: 'mono', s: 22, w: 700, c: C.ink2, al: .5 * fo(lt, 8.0, .4) }); }
    }
    if (ba > 0) at(g, bx, by, ap(lt, .6, .5), () => { const w = 190; card(g, -w / 2, -26, w, 52, { r: 26, fill: C.navy, lw: 0 }); text(g, 'produce()', 0, 1, { f: 'mono', s: 26, w: 700, c: '#fff' }); }, { al: ba });
    if (lt > 6.8) { ripple(g, xs[0], y, lt - 6.8, LC[1], 30, 120, .9); storageIcon(g, xs[0], y - 200, .55, { al: fa(lt, 6.9) }); }
    // 数据列车：正向开回，货物逐站变形
    if (lt > 8.2) {
      const u = eio(seg(lt, 8.3, 11.2)), x = lerp(xs[0], xs[4], u);
      const k = x < xs[1] ? 0 : x < xs[2] ? 1 : x < xs[3] ? 2 : 3;
      train(g, [[xs[0], y], [xs[4], y]], u, LC[1], { len: 70, cargo: gg => pullCargo(gg, k) });
    }
    if (lt > 11.2) { resultBox(g, xs[4] + 70, y - 70, pop(seg(lt, 11.2, 11.6)) * 1.2, col); text(g, '订阅结果', xs[4] + 70, y - 130, { s: 26, w: 900, al: fa(lt, 11.4) }); }
  },
});

/* =====================================================================
 * 第三章 八条线路，一张图
 * ===================================================================== */
const REG = [
  'val lines = listOf(',
  '    scene    + sceneCh,',
  '    intercom + intercomCh,',
  '    cards    + modelFilter + cardConv + resConv,',
  '    doorLock + cardConv2 + resConv2,',
  '    push     + deviceSub1,',
  '    unlock   + deviceSub2,',
  '    space    + deviceSub3,',
  '    cards    + otherFilter + otherConv,',
  ')',
];
const REG_BOX = { x: 520, y: 190, w: 880 };
S('s10', {
  cam: [[0, 960, 520, 1]],
  cues: [[0, 'whoosh'], [2.2, 'type'], ...GEO.map((_, i) => [5.6 + i * .3, 'draw', .5]), [9.2, 'blip'], [9.5, 'blip']],
  draw(g, lt) {
    const ca = fa(lt, 1.6, .4) * fo(lt, 5.6, .7), cur = Math.floor(seg(lt, 5.3, 5.3 + .3 * 8) * 8);
    if (ca > 0) codeCard(g, REG_BOX.x, REG_BOX.y, REG_BOX.w, REG, { title: 'SubscribeLines.kt（示意）', fs: 26, lh: 48, p: eo(seg(lt, 2.1, 4.6)), al: ca, hl: lt > 5.3 ? [cur + 1] : [], cursor: false });
    // 每一行抽出一根色条，飞到线路图上对应位置
    GEO.forEach((L, i) => {
      const t0 = 5.4 + i * .3, k = eio(seg(lt, t0, t0 + .55));
      if (lt < t0 || k >= 1) return;
      const fy = REG_BOX.y + 70 + (i + 1) * 48 + 24, a = [lerp(REG_BOX.x + 120, MAP.x0, k), lerp(fy, L.y, k)];
      path(g, [a, [a[0] + lerp(500, 120, k), a[1]]], { c: L.col, w: lerp(30, 14, k), al: 1 - k * .3 });
    });
    drawMap(g, lt, {
      p: i => eo(seg(lt, 5.8 + i * .3, 7.4 + i * .3)), al: i => fa(lt, 5.6 + i * .3, .3),
      stAl: fa(lt, 6.2), glowSrc: i => i >= 6 ? win(lt, 9.1 + (i - 6) * .3, 11.8) : 0,
    });
    [6, 7].forEach(i => { if (lt > 9.1) tag(g, '新增', MAP.x0 + 130, GEO[i].y - 34, C.amber, seg(lt, 9.1 + (i - 6) * .3, 9.5 + (i - 6) * .3), { fs: 24, tc: C.ink }); });
  },
});

S('s11', {
  cam: [[0, 960, 520, 1]],
  cues: [...[0, 1, 2, 3, 4, 5, 6].map(k => [.6 + k * .35, 'tick', .6]), [4.6, 'stamp', .6], [5.0, 'stamp', .6], [5.4, 'stamp', .6], [8.7, 'blip'], [12.2, 'latch'], [12.6, 'blip']],
  draw(g, lt) {
    const PROD = [0, 1, 2, 3, 4, 5, 6]; // 7 种生产者：第 8 条复用第 3 条的“设备卡片”
    const dev = win(lt, 4.1, 12.0, .4, .5), reuse2 = fa(lt, 12.0);
    const focus = i => dev > 0 ? lerp(1, [4, 5, 6].includes(i) ? 1 : .28, dev) : reuse2 > 0 ? lerp(1, [2, 3, 7].includes(i) ? 1 : .28, reuse2) : 1;
    drawMap(g, lt, {
      al: focus,
      glowSrc: i => {
        const k = PROD.indexOf(i === 7 ? 2 : i); const f = k >= 0 ? clamp(1 - Math.abs(lt - (.6 + k * .35) - .15) / .3) : 0;
        return Math.max(f, (i === 2 || i === 7) ? win(lt, 12.4, 15.1) : 0);
      },
      glowSeg: (i, k) => {
        if ([4, 5, 6].includes(i)) return win(lt, 4.6 + (i - 4) * .4, 12.2);
        if ((i === 2 && k >= 1) || i === 3) return win(lt, 12.0, 15.1);
        return clamp(1 - Math.abs(lt - 3.2) / .5) * .6;
      },
    });
    // 计数牌
    const n1 = Math.min(7, Math.floor(seg(lt, .6, 3.0) * 7.99)), n2 = Math.min(8, Math.floor(seg(lt, 2.6, 3.8) * 8.99));
    if (lt > .5) { const a = fa(lt, .5) * fo(lt, 4.2, .4); sign(g, `生产者 ${n1} 种 · 通道 ${n2} 种`, 960, 150, { s: 28, c: C.amber, al: a }); }
    // 同一种通道，盖出三个实例
    if (dev > 0) {
      sign(g, '设备订阅通道', 900, 150, { s: 28, c: LC[4], al: dev });
      [4, 5, 6].forEach((i, k) => {
        const t0 = 4.6 + k * .4, s = GEO[i].segs[0], kf = eio(seg(lt, t0 - .45, t0));
        if (lt > t0 - .45 && lt < t0 + .1) { const p = [lerp(900, s.mid, kf), lerp(170, GEO[i].y, kf)]; at(g, p[0], p[1], 1 - kf * .4, () => { rr(g, -60, -18, 120, 36, 8); g.fillStyle = rgba(LC[4], .5); g.fill(); }); }
        if (lt > t0) tag(g, `实例 ${k + 1}`, s.mid + 150, GEO[i].y, LC[4], seg(lt, t0, t0 + .4), { fs: 24, al: dev });
      });
      if (lt > 8.6) tag(g, '同一种通道 × 3 条管道', 1240, 150, C.navy2, seg(lt, 8.6, 9.0), { fs: 26, al: dev });
    }
    if (reuse2 > 0) {
      sign(g, '卡片转换 × 2 · 资源转换 × 2', 960, 150, { s: 28, c: LC[2], al: reuse2 });
      if (lt > 12.5) tag(g, '生产者也复用', MAP.x0 + 150, GEO[7].y + 40, LC[7], seg(lt, 12.5, 12.9), { fs: 24 });
    }
  },
});

/* 第 12 幕：拆到最小单位 */
const SPLIT = { y3: 380, y4: 650, xs: [240, 600, 980, 1310, 1640] };
S('s12', {
  demo: lt => win(lt, 3.9, 9.6, .3, .4),
  cam: [[0, 980, 520, 1], [13.7, 980, 520, 1.03]],
  cues: [[.5, 'draw'], [2.6, 'blip', .5], [4.3, 'error', .6], [6.9, 'snap'], [7.3, 'latch'], [9.6, 'whoosh', .5], [10.4, 'draw'], [11.6, 'latch']],
  draw(g, lt) {
    const { y3, y4, xs } = SPLIT, c3 = LC[2], c4 = LC[3];
    terminal(g, 1700, 300, 130, 450, { label: '总站' });
    // 第 3 号线
    const p3 = eo(seg(lt, .4, 1.8)), sp = eo(seg(lt, 6.9, 7.3)), bounce = lt > 6.9 ? Math.sin(seg(lt, 6.9, 7.6) * Math.PI) * 24 * (1 - seg(lt, 6.9, 7.6)) : 0;
    metroLine(g, [[xs[0], y3], [1730, y3]], c3, { w: 16, p: p3 });
    srcSt(g, xs[0], y3, c3, 1.2); lineBadge(g, 3, 120, y3, c3);
    text(g, '设备卡片', (xs[0] + xs[1]) / 2, y3 - 44, { s: 26, w: 900, al: fa(lt, .8) });
    plusSt(g, xs[1], y3, 1.2, { al: fa(lt, .9) }); text(g, '型号过滤', (xs[1] + xs[2]) / 2, y3 - 44, { s: 26, w: 900, al: fa(lt, 1.1) });
    plusSt(g, xs[2], y3, 1.2, { al: fa(lt, 1.2) });
    if (sp < .5) {
      const gl = win(lt, 2.4, 6.9);
      if (gl > 0) metroLine(g, [[xs[2] + 22, y3], [xs[4] - 6, y3]], c3, { w: 16, glow: gl * .8, casing: false });
      text(g, '卡片转换（一整段）', (xs[2] + xs[4]) / 2, y3 - 44, { s: 26, w: 900, al: fa(lt, 1.4) * (1 - sp * 2) });
    } else {
      text(g, '卡片转换', (xs[2] + xs[3]) / 2 - bounce, y3 - 44, { s: 26, w: 900 });
      text(g, '资源转换', (xs[3] + xs[4]) / 2 + bounce, y3 - 44, { s: 26, w: 900 });
    }
    if (lt > 6.9) { plusSt(g, xs[3], y3, pop(seg(lt, 6.9, 7.3)) * 1.3, { glow: win(lt, 6.9, 8.4) }); burst(g, xs[3], y3, lt - 6.9, C.amber, 10, 80); }
    // 第 4 号线（门锁数据）
    const p4a = eo(seg(lt, 3.9, 4.6));
    metroLine(g, [[xs[0], y4], [xs[2] - 60, y4]], c4, { w: 16, p: p4a });
    if (p4a > 0) { srcSt(g, xs[0], y4, c4, 1.2 * pop(seg(lt, 3.9, 4.3))); lineBadge(g, 4, 120, y4, c4, 1, { al: fa(lt, 3.9) }); text(g, '门锁数据', (xs[0] + xs[1]) / 2, y4 - 44, { s: 26, w: 900, al: fa(lt, 4.1) }); }
    const ghost = fa(lt, 4.3) * fo(lt, 9.6, .4);
    if (ghost > 0) {
      path(g, [[xs[2] - 60, y4], [xs[2] + 120, y4], [xs[2] + 230, y3 + 40]], { c: C.grey, w: 8, dash: [12, 10], al: ghost });
      at(g, xs[2] + 70, y4 - 70, pop(seg(lt, 4.3, 4.7)), () => { dot(g, 0, 0, 30, C.coral); ring(g, 0, 0, 30, C.ink, 3); text(g, '?', 0, 3, { f: 'disp', w: 900, s: 40, c: '#fff' }); }, { al: ghost });
    }
    // 拆完后：两段的副本落到第 4 号线
    if (lt > 9.6) {
      const k = eio(seg(lt, 9.6, 10.4)), yy = lerp(y3, y4, k);
      if (k < 1) { g.save(); g.globalAlpha *= .6; metroLine(g, [[xs[2], yy], [xs[4], yy]], c3, { w: 16, casing: false }); g.restore(); }
      const p = eo(seg(lt, 10.3, 11.4));
      metroLine(g, [[xs[2] - 60, y4], [1730, y4]], c4, { w: 16, p });
      if (p > 0) { plusSt(g, xs[2], y4, 1.2); plusSt(g, xs[3], y4, 1.2 * pop(seg(lt, 10.6, 11.0))); }
      if (lt > 10.6) { text(g, '卡片转换', (xs[2] + xs[3]) / 2, y4 - 44, { s: 26, w: 900, al: fa(lt, 10.6) }); text(g, '资源转换', (xs[3] + xs[4]) / 2, y4 - 44, { s: 26, w: 900, al: fa(lt, 10.9) }); }
      if (lt > 11.5) { tag(g, '实例 2', (xs[2] + xs[3]) / 2, y4 + 52, c4, seg(lt, 11.5, 11.9), { fs: 24 }); tag(g, '实例 2', (xs[3] + xs[4]) / 2, y4 + 52, c4, seg(lt, 11.7, 12.1), { fs: 24 }); }
    }
  },
});

/* =====================================================================
 * 第四章 总站：一份 JSON
 * ===================================================================== */
const RUN = (() => {
  const d = [2.2, 1.6, 3.0, 2.4, 1.8, 2.0, 1.5, 2.6].map(x => x * 1.3), T0 = 4.6, slots = [T0, T0, T0, T0, T0], out = [];
  for (let i = 0; i < 8; i++) { slots.sort((a, b) => a - b); const s = slots.shift(), e = s + d[i]; out.push({ i, s, e }); slots.push(e); }
  [...out].sort((a, b) => a.e - b.e).forEach((r, k) => { r.slot = k; });
  return out;
})();
const TRK = i => 250 + i * 70;
S('s13', {
  cam: [[0, 960, 500, 1]],
  cues: [[0, 'whoosh'], [4.6, 'whoosh'], ...RUN.map(r => [r.e, 'tick', .7]), [Math.max(...RUN.map(r => r.e)) + .5, 'confirm']],
  draw(g, lt) {
    const running = RUN.filter(r => lt >= r.s && lt < r.e).length;
    sign(g, 'flattenMerge(5)', 560, 160, { s: 30, f: 'mono', c: C.amber, al: fa(lt, 5.1) });
    for (let k = 0; k < 5; k++) {
      const x = 820 + k * 62, on = k < running;
      card(g, x - 22, 136, 44, 48, { r: 10, fill: C.navy, lw: 0, sb: 8, so: 3, al: fa(lt, 2.2 + k * .1) });
      dot(g, x, 160, 13, on ? C.green : rgba('#ffffff', .2), fa(lt, 2.2 + k * .1));
    }
    text(g, '并发 5', 1180, 161, { s: 28, w: 900, c: C.ink, al: fa(lt, 2.8) });
    card(g, 1540, 215, 220, 560, { r: 20, fill: '#fff', lw: 3, al: fa(lt, 2.4) });
    sign(g, '结果列表', 1650, 162, { s: 26, c: LC[1], al: fa(lt, 2.4) });
    for (let i = 0; i < 8; i++) {
      const y = TRK(i), r = RUN.find(q => q.i === i);
      metroLine(g, [[340, y], [1420, y]], LC[i], { w: 10, al: .45, p: eo(seg(lt, 2.0 + i * .08, 3.0 + i * .08)) });
      lineBadge(g, i + 1, 150, y, LC[i], ap(lt, 2.0 + i * .08, .4));
      platform(g, 'Flow', 250, y, { s: 22, al: fa(lt, 2.3 + i * .08) });
      // 结果格
      const sy = 250 + r.slot * 70;
      rr(g, 1560, sy - 26, 180, 52, 10); g.fillStyle = rgba(C.ink, .05 * fa(lt, 2.4)); g.fill();
      if (lt < r.e) {
        const u = lt < r.s ? 0 : eio((lt - r.s) / (r.e - r.s));
        train(g, [[380, y], [1380, y]], u, LC[i], { s: .9, al: (lt < r.s ? .5 : 1) * fa(lt, 2.6 + i * .08), trail: lt >= r.s });
      } else {
        const k = eio(seg(lt, r.e, r.e + .5));
        resultBox(g, lerp(1380, 1650, k), lerp(y, sy, k), .8, LC[i]);
        if (k >= 1) text(g, String(r.slot + 1), 1590, sy + 1, { f: 'disp', s: 26, w: 900, c: C.ink2 });
      }
    }
    const done = Math.max(...RUN.map(r => r.e));
    if (lt > done + .5) tag(g, '收齐 8 / 8', 1650, 820, C.green, seg(lt, done + .5, done + .9), { fs: 26 });
  },
});

/* 第 14 幕：总站内部，合并器 */
const MERGE = { hub: [700, 390], pan: [1000, 390], card1: { x: 1260, y: 250, w: 480 }, };
function gwCard(g, x, y, w, title, rows, o = {}) {
  const h = 62 + rows.length * 46 + 10;
  card(g, x, y, w, h, { r: 16, fill: '#fff', lw: 3, stroke: o.stroke || C.ink, al: o.al });
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.save(); rr(g, x, y, w, 50, 16); g.clip(); g.fillStyle = rgba(C.navy, .9); g.fillRect(x, y, w, 50); g.restore();
  text(g, title, x + 22, y + 26, { s: 26, w: 900, c: '#fff', a: 'left' });
  rows.forEach((r, i) => {
    const ry = y + 62 + i * 46 + 18;
    g.save(); g.globalAlpha *= r.al ?? 1; g.translate((1 - (r.al ?? 1)) * -40, 0);
    if (r.hl) { rr(g, x + 12, ry - 20, w - 24, 40, 8); g.fillStyle = rgba(C.amber, .25 * r.hl); g.fill(); }
    text(g, r.k, x + 28, ry, { f: 'mono', s: 24, w: 700, c: C.ink, a: 'left' });
    text(g, '→', x + 150, ry, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'left' });
    let cx = x + 190;
    text(g, '[', cx, ry, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'left' }); cx += 16;
    r.v.forEach((v, j) => {
      const nv = typeof v === 'object', s = (nv ? v.s : v) + (j < r.v.length - 1 ? ', ' : '');
      g.save(); if (nv) g.globalAlpha *= v.al ?? 1;
      text(g, s, cx, ry, { f: 'mono', s: 24, w: 700, c: nv ? '#B07A10' : C.ink, a: 'left' }); g.restore();
      cx += textW(g, s, { f: 'mono', s: 24, w: 700 });
    });
    text(g, ']', cx, ry, { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'left' });
    g.restore();
  });
  g.restore();
  return h;
}
function chipFly(g, s, a, b, k, col) {
  if (k <= 0 || k >= 1) return;
  const p = [lerp(a[0], b[0], eio(k)), lerp(a[1], b[1], eio(k)) - Math.sin(k * Math.PI) * 80];
  platform(g, s, p[0], p[1], { s: 22, stroke: col });
}
S('s14', {
  cam: [[0, 960, 500, 1], [11.0, 960, 500, 1], [12.0, 1430, 470, 1.22], [15.6, 1430, 470, 1.22]],
  cues: [[.5, 'whoosh', .5], ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => [.6 + i * .3, 'tick', .5]), [4.8, 'tick'], [5.4, 'tick'], [6.0, 'snap'], [6.4, 'tick'], [8.0, 'tick'], [8.5, 'tick'], [9.0, 'tick'], [11.8, 'whoosh', .5], [12.6, 'snap'], [13.3, 'blip'], [13.9, 'latch']],
  draw(g, lt) {
    card(g, 110, 150, 1720, 690, { r: 34, fill: rgba('#ffffff', .55), lw: 4, stroke: C.ink, sa: .1 });
    sign(g, '总站 · 合并器', 960, 150, { s: 30, c: C.amber });
    // 八只结果箱进站
    for (let i = 0; i < 8; i++) {
      const k = eo(seg(lt, .5 + i * .3, 1.0 + i * .3));
      resultBox(g, lerp(-60, 260, k), 236 + i * 74, .9, LC[i], { al: k });
    }
    // hublist / panellist：并集桶
    const ba = fa(lt, 4.4);
    [[MERGE.hub, 'hublist', LC[0]], [MERGE.pan, 'panellist', LC[1]]].forEach(([p, s, c]) => {
      dot(g, p[0], p[1], 122, rgba(c, .1), ba); ring(g, p[0], p[1], 122, c, 5, ba);
      text(g, s, p[0], p[1] + 160, { f: 'mono', s: 28, w: 700, c, al: ba });
    });
    const hubIn = [['hub-1', 4.6], ['hub-2', 5.2], ['hub-1', 5.8]], panIn = [['panel-1', 6.2], ['panel-2', 6.6]];
    hubIn.forEach(([s, t0], j) => {
      const k = seg(lt, t0, t0 + .6);
      chipFly(g, s, [300, 236], [MERGE.hub[0], MERGE.hub[1] - 40 + (j === 1 ? 70 : 0)], k, LC[0]);
      if (k >= 1 && j < 2) platform(g, s, MERGE.hub[0], MERGE.hub[1] - 40 + j * 70, { s: 24, stroke: LC[0] });
      if (j === 2 && lt > t0 + .6) burst(g, MERGE.hub[0], MERGE.hub[1] - 40, lt - t0 - .6, LC[0], 10, 70);
    });
    panIn.forEach(([s, t0], j) => {
      const k = seg(lt, t0, t0 + .6);
      chipFly(g, s, [300, 310], [MERGE.pan[0], MERGE.pan[1] - 40 + j * 70], k, LC[1]);
      if (k >= 1) platform(g, s, MERGE.pan[0], MERGE.pan[1] - 40 + j * 70, { s: 24, stroke: LC[1] });
    });
    if (lt > 6.9) tag(g, '取并集', 850, 230, C.navy2, seg(lt, 6.9, 7.3), { fs: 26 });
    // resset：按网关 id 归组
    const ra = fa(lt, 7.7);
    if (ra > 0) {
      sign(g, 'resset', 1500, 226, { s: 26, f: 'mono', c: LC[2], al: ra });
      const r1 = [{ k: 'dev-3', v: ['0.1.9', ...(lt > 12.6 ? [{ s: '0.4.2', al: fa(lt, 12.6) }] : [])], al: fa(lt, 8.4), hl: win(lt, 12.5, 15.6) },
        { k: 'dev-5', v: ['0.2.1'], al: fa(lt, 9.2) }];
      if (lt > 13.2) r1.push({ k: 'dev-8', v: ['0.1.9'], al: fa(lt, 13.2, .5), hl: win(lt, 13.2, 15.6) });
      const h1 = gwCard(g, 1260, 262, 480, '网关 hub-1', r1, { al: ra, stroke: lt > 12.4 ? C.amber : C.ink });
      const y2 = 262 + h1 + 24;
      const h2 = gwCard(g, 1260, y2, 480, '网关 hub-2', [{ k: 'dev-2', v: ['0.3.3'], al: fa(lt, 8.8) }], { al: ra });
      if (lt > 13.8) { gwCard(g, 1260, y2 + h2 + 24, 480, '网关 hub-3', [{ k: 'dev-6', v: ['0.5.1'] }], { al: fa(lt, 13.8, .5) }); tag(g, '整条加入', 1660, y2 + h2 + 40, C.green, seg(lt, 14.0, 14.4), { fs: 24 }); }
      [[8.0, 'hub-1', 2], [8.5, 'hub-2', 4], [9.0, 'hub-1', 5]].forEach(([t0, s, i]) => chipFly(g, s, [300, 236 + i * 74], [1300, 300], seg(lt, t0, t0 + .6), LC[i]));
    }
    // 新来的同网关条目，逐个 key 并入
    if (lt > 11.5) {
      const k = eio(seg(lt, 11.6, 12.4)), a = fo(lt, 12.5, .3);
      at(g, lerp(900, 1500, k), lerp(520, 300, k), 1, () => {
        card(g, -210, -30, 420, 60, { r: 14, fill: '#FFF7E6', lw: 3, stroke: C.amber });
        text(g, 'hub-1 · dev-3, dev-8', 0, 1, { f: 'mono', s: 24, w: 700 });
      }, { al: a });
    }
  },
});

/* 第 15 幕：一份 JSON，四个桶 */
const BUCKETS = [['hublist', '网关 id 集合', LC[0]], ['panellist', '对讲面板列表', LC[1]], ['resset', '局域网订阅', LC[2]], ['rescloud', '云端订阅', C.sky]];
S('s15', {
  cam: [[0, 960, 500, 1]],
  cues: [[.5, 'latch'], ...BUCKETS.map((_, k) => [1.0 + k * .4, 'blip', .6]), [3.8, 'tick'], [8.2, 'tick'], [12.2, 'draw'], [12.8, 'tick', .6], [13.4, 'tick', .6], [14.2, 'confirm']],
  draw(g, lt) {
    const k0 = ap(lt, .4, .6);
    at(g, 960, 500, k0, () => {
      card(g, -720, -340, 1440, 660, { r: 30, fill: '#fff', lw: 4, sb: 34, so: 14 });
      text(g, '{', -680, -250, { f: 'mono', s: 90, w: 700, c: rgba(C.navy, .25) });
      text(g, '}', 680, 250, { f: 'mono', s: 90, w: 700, c: rgba(C.navy, .25) });
    });
    if (k0 > .5) sign(g, '订阅 JSON · 一份', 960, 160, { s: 30, c: C.amber, al: fa(lt, .7) });
    const lit = k => k < 2 ? win(lt, 3.6, 8.0, .3, .4) : win(lt, 8.0, 16.7, .3, .4);
    BUCKETS.forEach(([key, desc, col], k) => {
      const x = 330 + k * 420, rise = eo(seg(lt, 1.0 + k * .4, 1.6 + k * .4)), y = 300 + (1 - rise) * 40;
      const on = lit(k), dim = lt > 3.6 ? .45 + .55 * on : 1;
      g.save(); g.globalAlpha *= rise * dim;
      card(g, x - 180, y - 70, 360, 240, { r: 18, fill: rgba(col, .08 + .1 * on), lw: 3.5, stroke: on > .5 ? col : C.ink });
      g.save(); rr(g, x - 180, y - 70, 360, 240, 18); g.clip(); g.fillStyle = col; g.fillRect(x - 180, y - 70, 360, 12); g.restore();
      text(g, key, x, y - 20, { f: 'mono', s: 32, w: 700, c: C.ink });
      if (k === 0) gatewayIcon(g, x, y + 60, .42, lt, { led: col });
      if (k === 1) screenIcon(g, x, y + 58, .42, lt);
      if (k === 2) { gatewayIcon(g, x - 40, y + 60, .36, lt); path(g, [[x + 10, y + 60], [x + 90, y + 60]], { c: col, w: 6, dash: [10, 8], off: -lt * 30 }); }
      if (k === 3) cloudIcon(g, x, y + 58, .62);
      text(g, desc, x, y + 140, { s: 26, w: 700, c: C.ink2 });
      g.restore();
    });
    // 样例值
    if (lt > 3.9 && lt < 8.2) {
      const a = fa(lt, 3.9) * fo(lt, 7.8, .4);
      platform(g, '["hub-1", "hub-2"]', 330, 600, { s: 24, al: a, stroke: LC[0] });
      platform(g, '["panel-1"]', 750, 600, { s: 24, al: a, stroke: LC[1] });
    }
    // 两桶同一种结构：网关 → 设备 → 资源
    if (lt > 12.0) {
      const tx = 990, ty = 590, a = fa(lt, 12.0);
      path(g, partial([[1170, 520], [1170, 556], [1590, 556], [1590, 520]], eo(seg(lt, 12.0, 12.6))), { c: C.navy2, w: 4 });
      const L3 = [['hub-1', 0, 12.8, LC[2]], ['dev-7', 1, 13.4, LC[5]], ['["0.1.9", "0.2.4"]', 2, 14.0, C.amber]];
      L3.forEach(([s, d, t0, c]) => {
        const x = tx + d * 190, y = ty + 6 + d * 58, k = fa(lt, t0, .5);
        if (d > 0) path(g, partial([[x - 150, y - 58 + 22], [x - 150, y], [x - 100, y]], k), { c: C.ink2, w: 3 });
        platform(g, s, x + textW(g, s, { f: 'mono', s: 24, w: 700 }) / 2 - 80, y, { s: 24, al: k * a, stroke: c });
      });
      text(g, '网关 → 设备 → 资源', 600, 650, { s: 28, w: 900, c: C.navy2, al: fa(lt, 12.4) });
    }
  },
});

/* =====================================================================
 * 第五章 发车调度
 * ===================================================================== */
const DEB = { y: 650, x0: 420, x1: 1780, trig: [[600, 3.6, 0], [760, 5.6, 1], [880, 7.0, 2]], win: 260 };
const DSRC = [['主界面刷新', 300, LC[2]], ['数据同步', 400, LC[5]], ['推送事件', 500, LC[1]]];
S('s16', {
  scaled: lt => fa(lt, 2.2) ,
  cam: [[0, 960, 520, 1]],
  cues: [[0, 'whoosh'], [2.3, 'tick', .4], [2.7, 'tick', .4], [3.1, 'tick', .4], [3.6, 'tick'], [5.6, 'tick'], [5.7, 'snip'], [7.0, 'tick'], [7.1, 'snip'], [8.9, 'tick', .5], [10.8, 'whoosh'], [12.3, 'confirm']],
  draw(g, lt) {
    const { y, x0, x1, trig, win: WN } = DEB;
    // 时间轴
    metroLine(g, [[x0, y], [x1, y]], C.navy2, { w: 10, p: eo(seg(lt, 2.0, 3.0)) });
    for (let x = x0; x <= x1; x += 80) if (lt > 2.0 + (x - x0) / 1400) tickSt(g, x, y + 26, rgba(C.ink, .3));
    text(g, '时间 →', x1 - 40, y + 60, { s: 24, w: 700, c: C.ink2, al: fa(lt, 2.8) });
    DSRC.forEach(([s, sy, c], k) => {
      const fire = trig[k][1], hit = clamp(1 - Math.abs(lt - fire) / .3);
      catPill(g, s, 220, sy, c, { s: ap(lt, 2.2 + k * .4, .5) * (1 + .1 * hit) });
      if (lt > fire) {
        const tx = trig[k][0], k2 = eio(seg(lt, fire, fire + .45));
        const p = [lerp(320, tx, k2), lerp(sy, y - 90, k2)];
        if (k2 < 1) dot(g, p[0], p[1], 12, c);
      }
    });
    // 每次触发：生成待发车 + 200 ms 窗口；后一次触发取消前一次
    trig.forEach(([tx, t0, k], i) => {
      if (lt < t0 + .45) return;
      const next = trig[i + 1], cancelAt = next ? next[1] + .45 : Infinity, cancelled = lt > cancelAt;
      const fillEnd = i === 2 ? 10.6 : cancelAt, fill = clamp((Math.min(lt, fillEnd) - (t0 + .45)) / (i === 2 ? 10.6 - (t0 + .45) : 3.0));
      const a = cancelled ? fo(lt, cancelAt + .6, .6) * .7 : 1;
      if (a <= 0) return;
      g.save(); g.globalAlpha *= a;
      dot(g, tx, y, 12, DSRC[k][2]); ring(g, tx, y, 12, C.ink, 3);
      rr(g, tx, y - 140, WN, 22, 11); g.fillStyle = rgba(C.ink, .08); g.fill();
      rr(g, tx, y - 140, WN * (cancelled ? Math.min(fill, .45) : fill), 22, 11); g.fillStyle = cancelled ? C.grey : C.amber; g.fill();
      if (!cancelled) text(g, '200 ms', tx + WN / 2, y - 172, { f: 'mono', s: 24, w: 700, c: C.ink2 });
      train(g, [[tx, y - 76], [tx + 100, y - 76]], .4, cancelled ? C.grey : LC[0], { trail: false, s: .9 });
      if (cancelled) icCross(g, tx + 40, y - 76, 40, C.coral, eo(seg(lt, cancelAt, cancelAt + .3)), 7);
      g.restore();
    });
    // 窗口走完：真正发车
    if (lt > 10.6) {
      const tx = trig[2][0] + WN, u = eio(seg(lt, 10.8, 12.0));
      path(g, [[tx, y - 150], [tx, y + 20]], { c: C.amber, w: 4, dash: [8, 6] });
      train(g, [[trig[2][0] + 40, y - 76], [1620, y - 76]], u, LC[0], { len: 80 });
      if (lt > 12.2) tag(g, '全量订阅 × 1', 1620, y - 150, C.green, seg(lt, 12.2, 12.6), { fs: 28 });
    }
    if (lt > 5.1) flipSign(g, '取消上一次 → 等 200 ms → 发车', 1120, 220, seg(lt, 5.2, 5.6), { s: 28, c: LC[0] });
  },
});

const REPO = [330, 480], GW2 = [1560, 470];
S('s17', {
  cam: [[0, 960, 500, 1]],
  cues: [[.4, 'draw'], [1.4, 'whoosh'], [2.3, 'tick'], [3.6, 'blip'], [5.0, 'error'], [5.6, 'draw'], [8.3, 'whoosh'], [10.3, 'success']],
  draw(g, lt) {
    const ln = [[REPO[0], REPO[1]], [GW2[0] - 130, REPO[1]]];
    metroLine(g, ln, C.navy2, { p: eo(seg(lt, .3, 1.2)), w: 14 });
    plusSt(g, REPO[0], REPO[1], 1.5); sign(g, '订阅仓库', REPO[0], REPO[1] - 76, { s: 28, c: C.sky });
    tickSt(g, 950, REPO[1], C.navy2); sign(g, '网关服务接口', 950, REPO[1] + 70, { s: 26, c: C.grey, al: fa(lt, .9) });
    const fail = lt > 5.0 && lt < 10.3, ok = lt >= 10.3;
    gatewayIcon(g, GW2[0], GW2[1], 1, lt, { label: '网关', led: fail ? C.coral : ok ? C.green : null });
    // 本地存一份
    storageIcon(g, REPO[0], 740, .7, { al: fa(lt, 1.3) }); text(g, '本地存储', REPO[0] + 90, 740, { s: 24, w: 700, c: C.ink2, a: 'left', al: fa(lt, 1.4) });
    path(g, [[REPO[0], REPO[1] + 30], [REPO[0], 690]], { c: C.ink2, w: 3, dash: [8, 6], al: fa(lt, 1.3) });
    if (lt > 1.5 && lt < 2.6) jsonTicket(g, REPO[0], lerp(REPO[1] + 20, 720, eio(seg(lt, 1.5, 2.3))), .5 * fo(lt, 2.3, .3));
    // 第一班
    if (lt > 1.4 && lt < 4.6) train(g, ln, eio(seg(lt, 1.4, 3.6)), C.navy2, { len: 74, cargo: gg => jsonTicket(gg, 0, -50, .5), al: fo(lt, 4.0, .5) });
    if (lt > 5.0) {
      tag(g, '写入失败', GW2[0], 300, C.coral, seg(lt, 5.0, 5.4), { fs: 28, al: fo(lt, 10.0, .3) });
      const pts = []; for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push([lerp(GW2[0] - 40, REPO[0] + 30, u), REPO[1] - 120 - Math.sin(u * Math.PI) * 140]); }
      arrow(g, pts, { c: C.coral, w: 5, p: eo(seg(lt, 5.6, 7.0)), dash: [14, 10], off: -lt * 30, al: fo(lt, 10.4, .4) });
      if (lt > 6.4) platform(g, '失败回调', 950, REPO[1] - 290, { s: 26, stroke: C.coral, tc: C.coral, al: fa(lt, 6.4) * fo(lt, 10.4, .4) });
    }
    if (lt > 8.0) { ripple(g, REPO[0], REPO[1], lt - 8.0, C.sky, 30, 110, .8); tag(g, '重新订阅', REPO[0], REPO[1] + 80, LC[0], seg(lt, 8.1, 8.5), { fs: 26 }); }
    if (lt > 8.3) train(g, ln, eio(seg(lt, 8.3, 10.3)), C.navy2, { len: 74, cargo: gg => jsonTicket(gg, 0, -50, .5) });
    if (ok) { ripple(g, GW2[0], GW2[1], lt - 10.3, C.green, 40, 160, .8); tag(g, '写入成功 ✓', GW2[0], 300, C.green, seg(lt, 10.3, 10.7), { fs: 28 }); }
  },
});

const REPO3 = [330, 620], CLOUD = [1000, 250], SCR3 = [1520, 560];
S('s18', {
  cam: [[0, 960, 500, 1]],
  cues: [[.6, 'draw'], [1.6, 'blip'], [3.7, 'whoosh', .6], [4.9, 'blip'], [6.6, 'tick'], [7.4, 'blip'], [8.2, 'confirm']],
  draw(g, lt) {
    metroLine(g, [[REPO3[0], REPO3[1]], [1200, REPO3[1]]], C.navy2, { w: 14, al: .35 });
    text(g, '主线：下发到网关', 900, REPO3[1] + 44, { s: 24, w: 700, c: C.ink2, al: .6 });
    const br = [[REPO3[0], REPO3[1]], [REPO3[0] + 300, REPO3[1] - 300], [CLOUD[0] - 110, REPO3[1] - 300], [CLOUD[0] - 110, CLOUD[1] + 40]];
    metroLine(g, br, C.sky, { p: eo(seg(lt, .6, 1.8)), w: 12, dash: [18, 10] });
    plusSt(g, REPO3[0], REPO3[1], 1.5); sign(g, '订阅仓库', REPO3[0], REPO3[1] + 76, { s: 28, c: C.sky });
    cloudIcon(g, CLOUD[0], CLOUD[1], ap(lt, 1.6, .5) * 1.1); text(g, '云端', CLOUD[0] + 110, CLOUD[1], { s: 26, w: 900, a: 'left', al: fa(lt, 1.8) });
    // 支线小列车：去程查询，回程带安全等级
    if (lt > 3.6 && lt < 6.3) {
      const go = lt < 4.9, u = go ? eio(seg(lt, 3.7, 4.9)) : 1 - eio(seg(lt, 5.0, 6.2));
      train(g, br, u, C.sky, { s: .85, cargo: go ? null : gg => platform(gg, '安全等级', 0, -44, { s: 22, stroke: LC[5] }) });
    }
    if (lt > 4.9 && lt < 5.4) ripple(g, CLOUD[0], CLOUD[1], lt - 4.9, C.sky, 40, 120, .5);
    storageIcon(g, 640, 790, .6, { al: fa(lt, 3.6) }); text(g, '本地', 720, 790, { s: 24, w: 700, c: C.ink2, a: 'left', al: fa(lt, 3.6) });
    if (lt > 6.2) { const k = eio(seg(lt, 6.2, 6.7)); if (k < 1) platform(g, '安全等级', lerp(REPO3[0], 640, k), lerp(REPO3[1] - 40, 760, k), { s: 22, stroke: LC[5] }); else dot(g, 640, 768, 9, LC[5]); }
    // 事件广播 → 界面刷新
    if (lt > 7.3) {
      for (let k = 0; k < 3; k++) { const ph = ((lt - 7.3) * .8 + k / 3) % 1; ring(g, REPO3[0], REPO3[1], 40 + ph * 520, LC[5], 4, (1 - ph) * .55 * fa(lt, 7.3)); }
      platform(g, '事件广播', REPO3[0] + 200, REPO3[1] - 70, { s: 24, stroke: LC[5], al: fa(lt, 7.4) });
    }
    screenIcon(g, SCR3[0], SCR3[1], 1.1, lt, { label: '屏上界面', al: fa(lt, 1.0), tiles: [LC[5], LC[2], LC[0], LC[1]] });
    const fl = seg(lt, 8.2, 8.6);
    at(g, SCR3[0], SCR3[1] - 6, 1, () => {
      card(g, -90, -40, 180, 80, { r: 14, fill: '#fff', lw: 3, stroke: fl > 0 ? LC[5] : C.grey });
      text(g, fl > .5 ? '等级 已更新' : '等级 …', 0, 1, { s: 26, w: 900, c: fl > .5 ? LC[5] : C.ink2 });
    }, { sy: fl > 0 && fl < 1 ? Math.abs(1 - fl * 2) : 1, al: fa(lt, 1.2) });
    if (lt > 8.2) ripple(g, SCR3[0], SCR3[1], lt - 8.2, LC[5], 60, 200, .8);
  },
});

/* =====================================================================
 * 第六章 开一条新线
 * ===================================================================== */
const NEW = { yRef: 330, y: 580, xs: [380, 700, 1010, 1320], term: { x: 1480, y: 250, w: 220, h: 420 }, col: '#3BA7C9' };
const NEW_CODE = ['    space    + deviceSub3,', '    cards    + otherFilter + otherConv,', '    newSrc   + newConv + deviceSub4,  // 新的一行'];
function newLineState(g, T) {
  const { yRef, y, xs, term, col } = NEW;
  terminal(g, term.x, term.y, term.w, term.h, { label: '总站', glow: win(T, 17.2, 26.3), lit: fa(T, 17.2) });
  // 参照线：5 号线（推送负载 + 设备订阅）
  metroLine(g, [[xs[0], yRef], [term.x + 30, yRef]], LC[4], { w: 14 });
  srcSt(g, xs[0], yRef, LC[4]); plusSt(g, xs[1], yRef, 1);
  text(g, '推送负载', xs[0] - 40, yRef, { s: 26, w: 900, a: 'right' }); lineBadge(g, 5, 190, yRef, LC[4]);
  text(g, '设备订阅', (xs[1] + term.x) / 2, yRef - 30, { s: 24, w: 700 });
  // 新线路（示意）：先是虚线，接上后变实线
  const solid = eo(seg(T, 17.2, 17.9));
  metroLine(g, [[xs[0], y], [term.x + 30, y]], C.grey, { w: 12, dash: [16, 12], off: -T * 20, al: fa(T, 2.2) * (1 - solid) });
  if (solid > 0) metroLine(g, [[xs[0], y], [term.x + 30, y]], col, { w: 14, p: solid });
  text(g, '新线路（示意）', 600, y + 70, { s: 24, w: 700, c: C.ink2, al: fa(T, 2.4) });
  // ① 生产者
  if (T > 5.4) {
    const drop = eo(seg(T, 5.4, 6.0)), sq = T > 6.0 ? Math.sin(seg(T, 6.0, 6.3) * Math.PI) * .2 : 0;
    srcSt(g, xs[0], lerp(y - 160, y, drop), col, 1.1, { al: drop });
    if (T > 6.0) { ripple(g, xs[0], y, T - 6.0, col, 24, 80, .6); g.save(); g.translate(xs[0], y); g.scale(1 + sq, 1 - sq); g.translate(-xs[0], -y); g.restore(); }
    metroLine(g, [[xs[0], y], [xs[1], y]], col, { w: 14, p: eo(seg(T, 6.2, 6.9)) });
    text(g, '新数据源', xs[0] - 40, y, { s: 26, w: 900, a: 'right', al: fa(T, 6.0) });
  }
  // ② 复用通道：从 5 号线拓印一段“设备订阅”
  if (T > 8.9) {
    const k = eio(seg(T, 9.2, 10.2)), yy = lerp(yRef, y, k);
    if (k < 1) { g.save(); g.globalAlpha *= .7; metroLine(g, [[xs[2], yy], [xs[3], yy]], LC[4], { w: 14, glow: .6 }); g.restore(); }
    else metroLine(g, [[xs[2], y], [xs[3], y]], LC[4], { w: 14 });
    if (T > 10.2) { plusSt(g, xs[2], y, pop(seg(T, 10.2, 10.6))); text(g, '设备订阅（复用）', (xs[2] + xs[3]) / 2, y - 30, { s: 24, w: 700, al: fa(T, 10.3) }); }
  }
  // ③ 按需新通道
  if (T > 12.2) {
    const k = fa(T, 12.3, .5);
    card(g, xs[1] + 24, y - 22, xs[2] - xs[1] - 48, 44, { r: 22, fill: rgba(col, .15 + .5 * fa(T, 12.9)), lw: 3, stroke: col, dash: [10, 7], al: k, shadow: false });
    plusSt(g, xs[1], y, pop(seg(T, 12.8, 13.2)));
    text(g, '新转换（按需）', (xs[1] + xs[2]) / 2, y - 46, { s: 24, w: 700, al: k });
  }
  // ④ 注册表加一行
  const ca = fa(T, 15.6, .4);
  if (ca > 0) {
    const nl = clamp(seg(T, 15.9, 17.1));
    codeCard(g, 280, 680, 960, NEW_CODE.slice(0, 2).concat(nl > 0 ? [NEW_CODE[2].slice(0, Math.floor(NEW_CODE[2].length * nl))] : []), { fs: 24, lh: 40, al: ca * (T > 18.9 ? fo(T, 19.3, .5) : 1), hl: nl > 0 ? [2] : [], hlc: C.green, cursor: false });
  }
  if (T > 17.3) ripple(g, term.x + 20, y, T - 17.3, col, 30, 120, .8);
}
const STEPS = [['① 生产者', 5.4], ['② 复用通道', 8.8], ['③ 新通道（按需）', 12.2], ['④ 注册一行', 15.8]];
S('s19', {
  cam: [[0, 960, 500, 1]],
  cues: [[0, 'whoosh'], [2.2, 'draw', .5], [5.5, 'latch'], [6.0, 'tick'], [8.9, 'blip'], [9.3, 'whoosh', .5], [12.3, 'blip'], [12.8, 'latch'], [15.9, 'type'], [17.3, 'success']],
  draw(g, lt) {
    STEPS.forEach(([s, t0], k) => {
      const cur = lt > t0 && (k === 3 || lt < STEPS[k + 1][1]);
      flipSign(g, s, 360 + k * 340, 160, seg(lt, t0, t0 + .45), { s: 26, c: cur ? C.amber : C.grey, fill: cur ? C.navy : C.navy2 });
    });
    newLineState(g, lt);
  },
});
const FAC = [['聚合', 0.6], ['下发', 1.2], ['重试', 1.8], ['回读', 2.4]];
S('s20', {
  cam: [[0, 960, 500, 1], [1.0, 1180, 470, 1.08], [7.4, 1180, 470, 1.08]],
  cues: FAC.map(([, t]) => [t, 'tick']).concat([[4.6, 'stamp']]),
  draw(g, lt) {
    newLineState(g, 18.9 + lt);
    FAC.forEach(([s, t0], k) => {
      const x = 1810, y = 300 + k * 92, on = fa(lt, t0, .3);
      path(g, [[NEW.term.x + NEW.term.w, y], [x - 60, y]], { c: on > .5 ? C.amber : rgba(C.ink, .2), w: 4, dash: [8, 6] });
      at(g, x, y, 1 + .15 * clamp(1 - Math.abs(lt - t0 - .15) / .25), () => {
        card(g, -56, -28, 112, 56, { r: 28, fill: on > .5 ? C.navy : '#fff', lw: 3, stroke: on > .5 ? C.amber : C.ink });
        text(g, s, 0, 1, { s: 28, w: 900, c: on > .5 ? '#fff' : C.ink2 });
      });
    });
    if (lt > 4.5) at(g, 860, 800, 1 + 1.2 * (1 - eo(seg(lt, 4.5, 4.8))), () => {
      g.rotate(-.06); rr(g, -230, -46, 460, 92, 14); g.lineWidth = 6; g.strokeStyle = C.coral; g.stroke();
      rr(g, -218, -34, 436, 68, 8); g.lineWidth = 2.5; g.stroke();
      text(g, '其余代码 0 改动', 0, 2, { s: 40, w: 900, c: C.coral });
    }, { al: fa(lt, 4.5, .15) });
  },
});

/* =====================================================================
 * 总结
 * ===================================================================== */
const LESS = [['1', '按类型切管道', '接得上，就能复用', 960], ['2', '拆到最小单位', '复用靠重新组合', 2560], ['3', '同一个出口', '聚合、下发只写一次', 4160]];
function lessonArt(g, k, x, y, lt) {
  if (k === 0) {
    metroLine(g, [[x - 220, y], [x + 220, y]], LC[0], { w: 14 }); plusSt(g, x, y, 1.1);
    platform(g, 'T', x - 60, y - 54, { s: 24 }); platform(g, 'T', x + 60, y - 54, { s: 24 }); text(g, '=', x, y - 52, { f: 'disp', s: 34, w: 900, c: C.green });
  } else if (k === 1) {
    const gap = 16 + 10 * Math.sin(lt * 2);
    metroLine(g, [[x - 230, y], [x - gap, y]], LC[2], { w: 14 }); metroLine(g, [[x + gap, y], [x + 230, y]], LC[2], { w: 14 });
    plusSt(g, x, y, 1.1);
    metroLine(g, [[x - 230, y + 70], [x + 230, y + 70]], LC[3], { w: 14, al: .9 }); plusSt(g, x, y + 70, 1);
  } else {
    for (let i = 0; i < 5; i++) { const yy = y - 60 + i * 30; metroLine(g, [[x - 260, yy], [x - 40, yy], [x + 40, y + 10]], LC[i + 2], { w: 9 }); }
    terminal(g, x + 30, y - 50, 150, 120, { label: false });
  }
}
S('s21', {
  cam: [[0, 960, 500, 1], [6.8, 960, 500, 1], [7.6, 2560, 500, 1], [11.8, 2560, 500, 1], [12.6, 4160, 500, 1], [17.9, 4160, 500, 1]],
  cues: [[0, 'whoosh'], [2.2, 'latch'], [7.0, 'whoosh', .6], [7.7, 'latch'], [11.9, 'whoosh', .6], [12.7, 'latch'], [16.0, 'success']],
  draw(g, lt, sc) {
    const Y = 560;
    metroLine(g, [[-200, Y], [5400, Y]], C.navy2, { w: 16 });
    for (let x = 0; x < 5400; x += 400) tickSt(g, x + 200, Y, C.navy2);
    LESS.forEach(([n, a, b, x], k) => {
      const t0 = [2.0, 7.4, 12.4][k];
      at(g, x, Y, 1, () => { dot(g, 0, 0, 44, '#fff'); ring(g, 0, 0, 44, C.ink, 9); text(g, n, 0, 4, { f: 'disp', s: 50, w: 900 }); });
      const kk = seg(lt, t0 + .1, t0 + .6);
      at(g, x, 330, 1, () => {
        rr(g, -470, -110, 940, 220, 22); shadow(g, .3, 34, 14); g.fillStyle = C.navy; g.fill(); noShadow(g);
        g.save(); rr(g, -470, -110, 940, 220, 22); g.clip(); g.fillStyle = [LC[0], LC[2], C.amber][k]; g.fillRect(-470, -110, 940, 12); g.restore();
        text(g, a, 0, -22, { s: 72, w: 900, c: '#fff' });
        text(g, b, 0, 58, { s: 36, w: 700, c: C.sky });
      }, { sy: eo(kk), al: clamp(kk * 3) });
      g.save(); g.globalAlpha *= fa(lt, t0 + .7); lessonArt(g, k, x, Y + 170, lt); g.restore();
    });
    // 列车跟着镜头跑
    const [cx] = camAt(sc.cam, lt);
    train(g, [[cx - 300, Y], [cx + 300, Y]], .5 + .03 * Math.sin(lt * 3), C.amber, { len: 90, trail: false });
  },
});

S('s22', {
  title: true, fi: .2, fo: .4,
  draw(g, lt) {
    const a = eo(seg(lt, 0, .3));
    metroLine(g, [[200, 540], [560, 540]], LC[2], { w: 14, al: a }); metroLine(g, [[1360, 540], [1720, 540]], LC[0], { w: 14, al: a });
    plusSt(g, 560, 540, 1.3, { al: a }); plusSt(g, 1360, 540, 1.3, { al: a });
    rr(g, -10 + 600, 400, 720, 260, 24); g.save(); g.globalAlpha *= a; shadow(g, .3, 30, 12); g.fillStyle = C.navy; g.fill(); g.restore();
    text(g, SERIES.title, 960, 500, { s: 104, w: 900, c: '#fff', al: a });
    text(g, SERIES.sub, 960, 596, { s: 40, w: 700, c: C.sky, al: eo(seg(lt, .2, .5)) });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  g.save(); g.translate(120, 290); g.scale(.86, .86);
  drawMap(g, 3, { labels: false, glowSeg: (i) => [4, 5, 6].includes(i) ? .7 : 0 });
  g.restore();
  at(g, 400, 640, 4.2, () => plusSt(g, 0, 0, 1, { glow: 1 }));
  text(g, '一个 + 号，串起八条管道', 960, 140, { s: 116, w: 900 });
  sign(g, '设备订阅模块重构 · Kotlin', 960, 262, { s: 46, c: C.amber });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
