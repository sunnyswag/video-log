/* =====================================================================
 * 显示屏帧率评估（短片）—— 12 幕编排（字幕数据在 script.js，图元在 kit.js）
 * 结构：0 开场、1 片名、2–4 三章、5 总结、6 系列片尾（audio.py / checks.cjs 按此读取）。
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]。画面动作按本幕字幕起点 CT(id)[i] 对齐，改字幕后画面跟着走。
 * 所有绘制只依赖时间 t。图标是自绘的通用几何图形，不画任何产品界面。
 * ===================================================================== */
'use strict';
const CARD = { 2: ['01', '一部手机当帧率计', 'A PHONE AS A FRAME COUNTER', C.cyan], 3: ['02', '变量是解码张数', 'IT IS THE DECODE COUNT', C.amber],
  4: ['03', '先算，再写 UI', 'BUDGET BEFORE UI', C.green], 5: ['✓', '先测干净，再算预算', 'MEASURE CLEAN, THEN BUDGET', C.cyan] };
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };
const CT = id => SCRIPT[id].caps.map(c => c[0]);

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.bg, white: C.ink, cyan: C.cyan, red: C.red, amber: C.amber },
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

/* 章节转场：带胶片齿孔的斜切色带扫入 → 停留七段章节号与标题 → 扫出 */
function chapterWipe(g, { sc, lt }) {
  const cd = CARD[sc.card]; if (!cd || lt > 1.95) return;
  const [num, zh, en, col] = cd;
  const pin = eio(seg(lt, 0, .38)), pout = eio(seg(lt, 1.42, 1.92));
  const x0 = lerp(-W - 400, -200, pin) + lerp(0, W + 600, pout);
  const band = new Path2D(); band.moveTo(x0, 0); band.lineTo(x0 + W + 400, 0); band.lineTo(x0 + W + 200, H); band.lineTo(x0 - 200, H); band.closePath();
  g.save();
  g.save(); shadow(g, .6, 40, 0); g.fillStyle = '#0B1117'; g.fill(band); g.restore();
  // 前缘：一条琥珀光 + 一列胶片齿孔
  g.beginPath(); g.moveTo(x0 + W + 400, 0); g.lineTo(x0 + W + 450, 0); g.lineTo(x0 + W + 250, H); g.lineTo(x0 + W + 200, H); g.closePath();
  g.fillStyle = C.amber; g.fill();
  g.clip(band);
  for (const edge of [0, 1]) for (let i = 0; i < 18; i++) {
    const yy = i * 62 + 14, ex = edge ? x0 + W + 400 - 200 * yy / H - 70 : x0 - 200 * yy / H + 236;
    rr(g, ex, yy, 34, 30, 6); g.fillStyle = rgba(col, .28); g.fill();
  }
  g.fillStyle = rgba(col, .1); g.fillRect(x0 - 300, 0, W + 800, H);
  const a = eo(seg(lt, .3, .62)) * (1 - eo(seg(lt, 1.38, 1.6)));
  const dx = (1 - eo(seg(lt, .3, .7))) * 80;
  if (/^\d+$/.test(num)) seg7(g, num, 520 - dx, 530, 250, col, { al: a });
  else { g.save(); g.globalAlpha *= a; icCheck(g, 500 - dx, 540, 220, col, 1, 34); g.restore(); }
  text(g, zh, 760 + dx * .5, 488, { s: 100, w: 900, c: '#fff', a: 'left', al: a });
  text(g, en, 766 + dx * .5, 584, { f: 'mono', s: 30, w: 700, ls: 8, c: rgba(col, .9), a: 'left', al: a });
  g.restore();
}

/* 外框：四角取景器括线、左上章节、顶部时间码、右上进度灯 */
const CH_SHORT = ['开场', '', '第一章 · 一部手机当帧率计', '第二章 · 变量是解码张数', '第三章 · 先算，再写 UI', '总结', ''];
const chColor = k => (CARD[k] || [0, 0, 0, C.amber])[3];
function drawChrome(g, { sc, lt, t }) {
  CAMZ = 1;
  g.save(); g.globalAlpha *= .55;
  for (const [x, y, sx, sy] of [[40, 40, 1, 1], [W - 40, 40, -1, 1], [40, H - 40, 1, -1], [W - 40, H - 40, -1, -1]]) path(g, [[x, y + sy * 54], [x, y], [x + sx * 54, y]], { c: C.ink2, w: 3, cap: 'square' });
  g.restore();
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 64;
    card(g, 80, 44, w, 48, { r: 10, fill: rgba('#0B1117', .85), lw: 2, stroke: C.bezel, shadow: false });
    led(g, 104, 68, 6, chColor(sc.chapter), 1);
    text(g, lab, 124, 69, { s: 26, w: 700, a: 'left' });
  }
  // 时间码 OSD
  const fr = Math.floor(t * FPS), tc = [Math.floor(fr / 108000), Math.floor(fr / 1800) % 60, Math.floor(fr / 30) % 60, fr % 30].map(n => String(n).padStart(2, '0')).join(':');
  dot(g, 846, 68, 8, C.red, Math.floor(t * 1.6) % 2 ? .35 : 1);
  text(g, 'TC ' + tc, 866, 69, { f: 'mono', s: 26, w: 700, a: 'left', c: C.ink2 });
  for (let k = 2; k <= 5; k++) {
    const on = sc.chapter >= k, cur = sc.chapter === k, x = 1640 + (k - 2) * 52;
    rr(g, x, 60, cur ? 40 : 28, 14, 4); g.fillStyle = cur ? chColor(k) : on ? rgba(C.ink, .45) : rgba(C.ink, .14); g.fill();
  }
  const demo = typeof sc.demo === 'function' ? sc.demo(lt) : sc.demo;
  if (demo) tagSmall(g, '⚠ 机制演绎', 1610, 68, C.amber, demo);
  g.restore();
}
function tagSmall(g, s, xr, y, c, al = 1) {
  const w = textW(g, s, { s: 24, w: 700 }) + 36;
  g.save(); g.globalAlpha *= clamp(+al);
  card(g, xr - w, y - 22, w, 44, { r: 22, fill: rgba('#0B1117', .9), lw: 2, stroke: c, shadow: false });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c });
  g.restore();
  return w;
}

/* 字幕：深色玻璃底板 + 细亮边 + 四角刻线；琥珀色加荧光底 */
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
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .25)), x = (W - w) / 2, y = top + (1 - k) * 10;
  g.save(); g.globalAlpha *= c.alpha;
  card(g, x, y, w, h, { r: 14, fill: rgba('#070B0F', .88), lw: 2, stroke: rgba(C.cyan, .35), sb: 26, so: 8, sa: .5, hi: false });
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) path(g, [[cx + sx * 6, cy + sy * 22], [cx + sx * 6, cy + sy * 6], [cx + sx * 22, cy + sy * 6]], { c: C.cyan, w: 2.5, al: .8 });
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
      if (s.c === C.amber) { rr(g, x - 3, l.y + 6 + (1 - k) * 10, w + 6, 12, 4); g.fillStyle = rgba(C.amber, .35); g.fill(); }
      text(g, s.s, x, l.y + (1 - k) * 10, { s: 54, w: 700, c: s.c || C.ink, a: 'left', b: 'alphabetic', glow: s.c ? rgba(s.c, .45) : null, gb: 12 });
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
    cues: (typeof o.cues === 'function' ? o.cues() : o.cues || []).map(([t, type, v]) => ({ t, type, v: v ?? 1 })),
    draw: (g, lt, sc) => o.draw(g, lt, sc),
  });
}

/* =====================================================================
 * 通用小工具
 * ===================================================================== */
const ap = (lt, t0, d = .5) => pop(seg(lt, t0, t0 + d));
const fa = (lt, t0, d = .4) => eo(seg(lt, t0, t0 + d));
const fo = (lt, t0, d = .4) => 1 - eo(seg(lt, t0, t0 + d));
const L2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
/* 页偏移：moves = [[t0, dur, to], ...]，从 from 开始，每段 eio 过渡 */
function offAt(lt, moves, from = 0) {
  let v = from;
  for (const [t0, d, to] of moves) { if (lt <= t0) break; v = lerp(v, to, eio(seg(lt, t0, t0 + d))); }
  return v;
}
/* 读数链：steps = [[t, 值], ...]，返回当前数值（每步 .35 秒滚动）和最近一步的序号 */
function valAt(lt, steps, d = .35) {
  let v = null, idx = -1;
  for (let i = 0; i < steps.length; i++) { const [t0, x] = steps[i]; if (lt < t0) break; v = v == null ? x : lerp(v, x, eo(seg(lt, t0, t0 + d))); idx = i; }
  return [v, idx];
}
/* 指针值：每步弹簧 */
function needleAt(lt, steps) {
  let v = 0;
  for (const [t0, x] of steps) { if (lt < t0) break; v = springTo(lt, t0, v, x, 6, 1.1); }
  return v;
}
/* 手指触点：从 a 滑到 b（屏幕上），按下有涟漪 */
function touch(g, a, b, lt, t0, d) {
  const k = seg(lt, t0 - .15, t0 + d + .2); if (k <= 0 || k >= 1) return;
  const u = eio(seg(lt, t0, t0 + d)), p = L2(a, b, u), al = Math.min(seg(lt, t0 - .15, t0), 1 - seg(lt, t0 + d, t0 + d + .2));
  dot(g, p[0], p[1], 26, '#ffffff', .22 * al); ring(g, p[0], p[1], 26, '#ffffff', 3, .7 * al);
  ripple(g, a[0], a[1], lt - t0, '#ffffff', 20, 70, .5);
}
const fpsCol = v => v == null ? C.dim : v < 30 ? C.red : v < 60 ? C.amber : C.green;

/* =====================================================================
 * 开场
 * ===================================================================== */
const OP = { bx: 640, by: 450, rx: 1420, ry: 330, gx: 1420, gy: 660 };
S('s01', {
  fi: .5,
  cam: [[0, 680, 450, 1.18], [4.6, 760, 470, 1.04], [8.2, 960, 500, 1], [14.8, 960, 500, 1.02]],
  cues: () => { const k = CT('s01'); return [[.2, 'whoosh'], [1.0, 'blip', .5], [1.9, 'whoosh', .4], [3.3, 'whoosh', .4], [k[1] + .3, 'latch', .6], [k[2] + .1, 'tick'], [k[2] + 1.1, 'tick'], [k[2] + 2.1, 'error'], [k[3] + .1, 'whoosh', .5], [k[3] + 1.4, 'blip']]; },
  draw(g, lt) {
    const k = CT('s01'), { bx, by, rx, ry, gx, gy } = OP;
    const moves = [[1.9, .7, 1], [3.3, .7, 2], [k[1] + 1.2, .7, 3], [k[1] + 2.4, .7, 2], [k[2] + .2, .5, 3], [k[2] + 1.2, .5, 4], [k[2] + 2.2, .7, 5], [k[3] + 1.6, .6, 4]];
    const off = offAt(lt, moves);
    devBoard(g, bx, by, ap(lt, .2, .6), lt, { off, on: eo(seg(lt, .7, 1.3)) });
    for (const [t0, d, to] of moves) {
      const prev = offAt(t0 - .01, moves), dir = to > prev ? 1 : -1;
      touch(g, boardPt(bx, by, 1, dir > 0 ? .78 : .22, .5), boardPt(bx, by, 1, dir > 0 ? .22 : .78, .5), lt, t0, d);
    }
    // 第二句：同一块板子、同一个界面
    if (lt > k[1]) {
      tag(g, 'MCU 开发板 · 480×272', bx - 120, by + 270, C.cyan, seg(lt, k[1] + .2, k[1] + .6), { fs: 26 });
      tag(g, 'RT-Thread + LVGL', bx + 200, by + 270, C.green, seg(lt, k[1] + .7, k[1] + 1.1), { fs: 26, f: 'mono' });
    }
    // 帧率表
    const steps = [[k[2] + .1, 66.7], [k[2] + 1.1, 53.3], [k[2] + 2.1, 24]];
    const [v, idx] = valAt(lt, steps), shown = v == null ? '--.-' : v.toFixed(1);
    const blink = idx === 2 && lt > k[3] ? (Math.floor(lt * 3) % 2 ? .55 : 1) : 1;
    readout(g, rx, ry, 560, 230, shown, { s: ap(lt, k[1] + .3), label: '实测帧率', unit: 'fps', c: fpsCol(v), ledc: fpsCol(v), ledOn: v == null ? 0 : blink, dh: 108 });
    gauge(g, gx, gy, 132, needleAt(lt, steps), { s: ap(lt, k[1] + .5), title: 'FPS' });
    if (idx === 2) { const kk = lt - steps[2][0]; ripple(g, gx, gy, kk, C.red, 60, 220, .8); }
    // 第四句：准星搜索变量
    if (lt > k[3]) {
      const pts = [[rx - 200, ry], [gx - 60, gy - 30], [bx + 220, by - 160], [bx - 160, by + 60], boardPt(bx, by, 1, .5, .45)];
      const u = seg(lt, k[3], k[3] + 1.4), n = pts.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = eio(u * n - i);
      const p = u >= 1 ? pts[n] : L2(pts[i], pts[i + 1], f);
      reticle(g, p[0], p[1], 46, C.cyan, fa(lt, k[3], .3), lt * .8);
      if (lt > k[3] + 1.4) {
        const q = ap(lt, k[3] + 1.4);
        at(g, bx + 300, by - 236, q, () => { dot(g, 0, 0, 40, C.cyanD); ring(g, 0, 0, 40, C.cyan, 3); text(g, '?', 0, 3, { f: 'disp', w: 900, s: 56, c: C.cyan }); });
        path(g, [[bx + 270, by - 210], [p[0] + 30, p[1] - 30]], { c: C.cyan, w: 2.5, dash: [8, 8], al: q * .7 });
      }
    }
  },
});

/* =====================================================================
 * 片名
 * ===================================================================== */
S('s02', {
  title: true, fi: .3,
  cues: [[.15, 'whoosh'], [.5, 'shutter', .6], [.9, 'shutter', .6], [1.3, 'shutter', .6], [1.6, 'draw', .6], [2.7, 'latch']],
  draw(g, lt) {
    // 频闪多重曝光：一个图标留下等间距残影
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t0 = .2 + i * .085; if (lt < t0) continue;
      const latest = Math.min(N - 1, Math.floor((lt - .2) / .085)), age = latest - i;
      const fl = lt - t0 < .06 ? 1.6 : 1;
      icon(g, 330 + i * 98, 250 + Math.sin(i * .45) * 8, .9, 0, { al: clamp(Math.pow(.8, age) * .9 * fl) * fo(lt, 5.6, .6) });
    }
    if (lt > .2 && lt < 1.6) { const f = ((lt - .2) / .085) % 1; if (f < .3) { g.save(); g.globalAlpha *= .05 * (1 - f / .3); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.restore(); } }
    // 标题逐字上电
    const title = '显示屏帧率评估', o = { s: 128, w: 900 };
    const chars = Array.from(title), total = textW(g, title, o);
    let x = 960 - total / 2;
    chars.forEach((ch, i) => {
      const w = textW(g, ch, o), t0 = .5 + i * .09, on = lt < t0 ? 0 : lt < t0 + .3 ? (hash(Math.floor(lt * 30) + i * 7) > .4 ? 1 : .25) : 1;
      text(g, ch, x + w / 2, 500, { ...o, c: C.ink, al: on, glow: rgba(C.cyan, .5), gb: 22 });
      x += w;
    });
    // 示波器扫描线：方波（vsync 节拍）
    const u = eio(seg(lt, 1.5, 2.5)), x0 = 960 - total / 2, x1 = 960 + total / 2, pts = [];
    for (let i = 0; i <= 48; i++) { const xx = lerp(x0, x1, i / 48); pts.push([xx, 612 - (Math.floor(i / 4) % 2 ? 22 : 0)]); if (i < 48 && (i + 1) % 4 === 0) pts.push([lerp(x0, x1, (i + 1) / 48), 612 - (Math.floor(i / 4) % 2 ? 22 : 0)]); }
    const q = partial(pts, u); path(g, q, { c: C.green, w: 4, glow: C.green, gb: 16 });
    if (u > 0 && u < 1) dot(g, q.at(-1)[0], q.at(-1)[1], 7, '#ffffff');
    const sp = seg(lt, 2.7, 3.1);
    at(g, 960, 712, pop(sp), () => text(g, '手机慢动作，数出一个公式', 0, 0, { s: 56, w: 700, c: C.cyan }), { al: sp > 0 ? 1 : 0 });
    // 取景器 OSD
    const ra = fa(lt, .2);
    dot(g, 1430, 176, 11, C.red, ra * (Math.floor(lt * 2) % 2 ? .35 : 1));
    text(g, 'REC', 1452, 178, { f: 'mono', s: 30, w: 700, a: 'left', c: C.red, al: ra });
    seg7(g, '240', 1640, 176, 44, C.amber, { a: 'left', al: ra });
    text(g, 'FPS', 1752, 178, { f: 'mono', s: 30, w: 700, a: 'left', c: C.amber, al: ra });
  },
});

/* =====================================================================
 * 第一章：一部手机当帧率计
 * ===================================================================== */
const PH = { x: 300, y: 300, s: .72 }, BD = { x: 1450, y: 320, s: .78 };
const STRIP = { x: 120, w: 1680, y: 742, fw: 120, fh: 104 };
/* 胶片第 i 帧：240fps 下屏幕每 3.6 帧刷新一次，同一组帧内容相同 */
const refreshOf = i => Math.floor(i / 3.6);
function thumbAt(g, i, w, h) { g.save(); g.scale(w / 480, h / 272); launcher(g, 480, 272, (refreshOf(i) * .07) % 9); g.restore(); }
S('s03', {
  card: 2,
  cam: [[0, 960, 520, 1], [12.9, 960, 520, 1.02]],
  cues: () => { const k = CT('s03'), c = [[0, 'whoosh'], [k[0], 'shutter'], [k[0] + .4, 'whoosh', .5], [k[1] + .2, 'latch', .6], [k[2] + .1, 'latch', .5]]; for (let j = 0; j < 9; j++) c.push([k[2] + .5 + j * .26, 'tick', .5]); c.push([k[2] + 2.9, 'success', .6]); return c; },
  draw(g, lt) {
    const k = CT('s03');
    const off = offAt(lt, [[2.2, 1.0, 1], [4.4, 1.0, 2], [6.6, 1.0, 3], [8.8, 1.0, 4], [11, 1.0, 5]]);
    // 视锥
    const vc = fa(lt, k[0] + .2, .5);
    if (vc > 0) {
      const cam = [PH.x + 70 * PH.s, PH.y - 150 * PH.s], c1 = boardPt(BD.x, BD.y, BD.s, 0, 0), c2 = boardPt(BD.x, BD.y, BD.s, 0, 1);
      g.save(); g.globalAlpha *= vc; g.beginPath(); g.moveTo(cam[0], cam[1]); g.lineTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]); g.closePath(); g.fillStyle = rgba(C.cyan, .05); g.fill(); g.restore();
      path(g, [cam, c1], { c: C.cyan, w: 2, dash: [10, 10], off: -lt * 30, al: vc * .6 });
      path(g, [cam, c2], { c: C.cyan, w: 2, dash: [10, 10], off: -lt * 30, al: vc * .6 });
      dot(g, cam[0], cam[1], 9, C.cyan, vc);
    }
    devBoard(g, BD.x, BD.y, BD.s * ap(lt, .2, .5), lt, { off });
    phone(g, PH.x, PH.y, PH.s * ap(lt, k[0], .5), lt, { off });
    // 胶片带：先匀速滚，第三句时一格一格步进
    const stepT = k[2] + .5, steps = clamp(Math.floor((lt - stepT) / .26) + 1, 0, 9), stepF = lt > stepT ? eio(clamp(((lt - stepT) % .26) / .16)) : 0;
    const base = (Math.min(lt, k[2] + .3) - k[0]) * 4.2;
    const scroll = base + (lt > stepT ? (steps - 1 + (steps < 9 ? stepF : 1)) : 0);
    const sa = fa(lt, k[0] + .3, .5);
    if (sa > 0) {
      g.save(); g.globalAlpha *= sa;
      filmStrip(g, STRIP.x, STRIP.y, STRIP.w, STRIP.fw, STRIP.fh, scroll, { thumb: thumbAt });
      // 每组（同一次刷新）上方的括号和帧数
      const i0 = Math.floor(scroll) - 2, x0 = STRIP.x - (scroll % 1) * STRIP.fw, ga = fa(lt, k[1] + .5, .5);
      g.save(); g.beginPath(); g.rect(STRIP.x, 560, STRIP.w, 120); g.clip();
      for (let i = Math.max(0, i0); i < i0 + 18; i++) {
        if (i > 0 && refreshOf(i) === refreshOf(i - 1)) continue;
        let n = 1; while (refreshOf(i + n) === refreshOf(i)) n++;
        const xa = x0 + (i - Math.floor(scroll)) * STRIP.fw + 8, xb = xa + n * STRIP.fw - 16;
        path(g, [[xa, 668], [xa, 652], [xb, 652], [xb, 668]], { c: C.amber, w: 3, al: ga });
        text(g, n + ' 帧', (xa + xb) / 2, 628, { f: 'mono', s: 26, w: 700, c: C.amber, al: ga });
      }
      g.restore();
      // 帧号（只标游标所在帧）
      g.restore();
    }
    // 算式铭牌
    const fa2 = fa(lt, k[1] + .2, .4);
    if (fa2 > 0) {
      const inv = fa(lt, k[2] + .1, .3);
      at(g, 800, 548, .9 + .1 * pop(seg(lt, k[1] + .2, k[1] + .6)), () => {
        card(g, -330, -46, 660, 92, { r: 14, lw: 2.5, stroke: rgba(C.amber, .6) });
        if (inv < 1) text(g, '240 ÷ 66.7 ≈ 3.6 帧', 0, 2, { f: 'mono', s: 46, w: 700, c: C.amber, al: 1 - inv, glow: rgba(C.amber, .5) });
        if (inv > 0) text(g, '240 ÷ 3.6 ≈ 66.7 fps', 0, 2, { f: 'mono', s: 46, w: 700, c: C.green, al: inv, glow: rgba(C.green, .5) });
      }, { al: fa2 });
    }
    // 第三句：固定游标逐格数
    if (lt > k[2]) {
      const ca = fa(lt, k[2], .3), cx = STRIP.x + STRIP.fw * 6.5;
      path(g, [[cx, 680], [cx, 806]], { c: C.cyan, w: 3, al: ca, glow: C.cyan });
      g.save(); g.globalAlpha *= ca; g.beginPath(); g.moveTo(cx - 12, 676); g.lineTo(cx + 12, 676); g.lineTo(cx, 690); g.closePath(); g.fillStyle = C.cyan; g.fill(); g.restore();
      const fi = Math.floor(scroll + 6.5);
      text(g, String(fi).padStart(4, '0'), cx, 840, { f: 'mono', s: 26, w: 700, c: C.cyan, al: ca });
    }
  },
});

S('s04', {
  cam: [[0, 960, 500, 1], [11.6, 960, 520, 1.03]],
  cues: () => { const k = CT('s04'), c = [[.2, 'whoosh', .5], [k[0] + 1.0, 'latch'], [k[1] + .8, 'latch'], [k[1] + 2.2, 'blip', .6], [k[1] + 2.6, 'blip', .6], [k[1] + 3.0, 'blip', .6]]; for (let j = 0; j < 10; j++) c.push([k[2] + .3 + j * .15, 'tick', .45]); c.push([k[2] + 2.0, 'success', .6]); return c; },
  draw(g, lt) {
    const k = CT('s04'), offLog = k[0] + 1.0, offOsd = k[1] + .8;
    const bx = 1440, by = 320, bs = .72;
    // 控制面板
    at(g, 500, 320, ap(lt, 0, .5), () => {
      card(g, -380, -170, 760, 340, { r: 22, lw: 2.5, stroke: C.bezel });
      for (const [sx, sy] of [[-356, -146], [356, -146], [-356, 146], [356, 146]]) screw(g, sx, sy);
      text(g, '测量环境', -340, -128, { s: 26, w: 700, a: 'left', c: C.ink2 });
    });
    const t1 = lt < offLog ? 1 : 1 - spring(lt - offLog, 9, 1.2), t2 = lt < offOsd ? 1 : 1 - spring(lt - offOsd, 9, 1.2);
    toggle(g, 330, 300, t1, '日志打印', { al: fa(lt, .2) });
    toggle(g, 680, 300, t2, '屏上 FPS 显示', { al: fa(lt, .4) });
    // 串口线 + 中断火花
    const wire = [[bx - 310 * bs, by + 120 * bs], [1000, by + 86], [880, by + 86]];
    path(g, wire, { c: '#33414D', w: 8 });
    const logOn = lt < offLog + .2;
    if (logOn) for (let i = 0; i < 6; i++) {
      const ph = ((lt * 1.3 + i / 6) % 1), p = polyAt(wire, ph);
      dot(g, p[0], p[1], 6, C.red, .9); dot(g, p[0], p[1], 14, C.red, .2);
    }
    // 开发板 + 屏上 FPS 叠加层（它自己也在不停重画：红色虚线脏区）
    devBoard(g, bx, by, bs * ap(lt, .1, .5), lt, {
      off: offAt(lt, [[1.0, .8, 1], [3.0, .8, 0], [5.0, .8, 1], [7.0, .8, 0], [9.0, .8, 1]]), act: logOn ? (hash(Math.floor(lt * 14)) > .4 ? 1 : .1) : .1,
      screen: (sg, w, h) => {
        launcher(sg, w, h, offAt(lt, [[1.0, .8, 1], [3.0, .8, 0], [5.0, .8, 1], [7.0, .8, 0], [9.0, .8, 1]]));
        const oa = lt < offOsd ? 1 : fo(lt, offOsd, .3);
        if (oa > 0) {
          sg.save(); sg.globalAlpha *= oa; rr(sg, 12, 12, 118, 52, 8); sg.fillStyle = 'rgba(0,0,0,.7)'; sg.fill();
          for (let j = 0; j < 5; j++) { const hh = 8 + 26 * hash(Math.floor(lt * 10) + j); sg.fillStyle = C.green; sg.fillRect(24 + j * 20, 56 - hh, 12, hh); }
          sg.setLineDash([8, 6]); sg.lineWidth = 3; sg.strokeStyle = C.red; sg.globalAlpha *= Math.floor(lt * 8) % 2 ? .9 : .3; sg.strokeRect(6, 6, 130, 64); sg.restore();
        }
      },
    });
    if (logOn) for (let i = 0; i < 3; i++) { const ph = (lt * 1.6 + i / 3) % 1; ring(g, bx - 160 * bs, by + 128 * bs, 20 + ph * 60, C.red, 3, (1 - ph) * .6); }
    // 配置铭牌（不配字幕）
    const pl = [['刷新周期 10ms', 400], ['双缓冲 + vsync', 960], ['只画脏区', 1500]];
    pl.forEach(([s, x], i) => plate(g, s, x, 566, C.cyan, fa(lt, k[1] + 2.2 + i * .4, .3), { al: fa(lt, k[1] + 1.8, .4) }));
    // 10 帧取平均：竖条落下 + 平均线
    if (lt > k[2]) {
      const sx = 560, sw = 800, sy = 668, sh = 170;
      g.save(); g.globalAlpha *= fa(lt, k[2], .3); scope(g, sx, sy, sw, sh, { nx: 10, ny: 4 }); g.restore();
      const mean = sy + sh * .42;
      for (let j = 0; j < 10; j++) {
        const t0 = k[2] + .3 + j * .15; if (lt < t0) continue;
        const hgt = sh * (.58 + (hash(j * 4.7) - .5) * .16), drop = eo(seg(lt, t0, t0 + .2)), sq = lt - t0 < .3 ? Math.sin(seg(lt, t0 + .2, t0 + .3) * Math.PI) * .08 : 0;
        const bw = 40 * (1 + sq), x = sx + 40 + j * 76 + (40 - bw) / 2, top = sy + sh - hgt * drop * (1 - sq);
        rr(g, x, top, bw, sy + sh - top, 4); g.fillStyle = rgba(C.green, .75); g.fill();
      }
      path(g, partial([[sx + 20, mean], [sx + sw - 20, mean]], eo(seg(lt, k[2] + 2.0, k[2] + 2.4))), { c: C.amber, w: 4, glow: C.amber });
      tag(g, '10 帧 → 平均', 1560, sy + sh / 2, C.amber, seg(lt, k[2] + 2.2, k[2] + 2.6), { fs: 30 });
    }
  },
});
function polyAt(pts, u) { const q = partial(pts, u); return q[q.length - 1]; }

/* =====================================================================
 * 第二章：变量是解码张数（解码实验台：板子 → 解码芯片 → 缓存架）
 * ===================================================================== */
const LAB = { bx: 400, by: 330, bs: .64, dx: 960, dy: 240, rx: 1560, ry: 300, cx: 1560, cy: 560 };
const RACK = { x: 625, y: 384, w: 670, h: 430, sx: 649, sy: 446, sw: 92, sh: 104, gx: 106, gy: 118 };
const slotXY = i => [RACK.sx + (i % 6) * RACK.gx + RACK.sw / 2, RACK.sy + Math.floor(i / 6) * RACK.gy + RACK.sh / 2];
/* 缓存格内容：0 = 背景，1–8 第 1 页，9–16 第 2 页，17 = 选中态 */
function slotContent(g, i, x, y, al = 1, glow = 0) {
  if (i === 0) { wallpaper(g, x - 38, y - 44, 76, 88, al); return; }
  if (i === 17) { g.save(); g.globalAlpha *= al; rr(g, x - 36, y - 42, 72, 84, 16); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke(); rr(g, x - 36, y - 42, 72, 84, 16); g.fillStyle = rgba('#ffffff', .12); g.fill(); g.restore(); return; }
  const p = i <= 8 ? 0 : 1, j = (i - 1) % 8;
  icon(g, x, y, .82, (p * 3 + j) % 8, { al, glow, gc: C.green });
}
/* st: {cap: 缓存容量, fill(i) → 0..1, hit(i) → 0..1, heat, busy, fps, cnt, cntCol, header} */
function lab(g, lt, st) {
  devBoard(g, LAB.bx, LAB.by, LAB.bs * (st.bp ?? 1), lt, { off: st.off || 0, state: st.iconState });
  // 缓存架
  at(g, RACK.x + RACK.w / 2, RACK.y + RACK.h / 2, st.rp ?? 1, () => {
    const { x, y, w, h } = RACK, ox = -(x + w / 2), oy = -(y + h / 2);
    g.translate(ox, oy);
    card(g, x, y, w, h, { r: 18, lw: 2.5, stroke: C.bezel });
    text(g, '图片缓存', x + 24, y + 30, { s: 28, w: 700, a: 'left', c: C.ink2 });
    seg7(g, String(st.cap), x + 166, y + 30, 32, st.cap > 1 ? C.green : C.red, { a: 'left' });
    if (st.header) text(g, st.header, x + w - 24, y + 30, { f: 'mono', s: 24, w: 700, a: 'right', c: C.amber, al: st.headerA ?? 1 });
    for (let i = 0; i < 18; i++) {
      const [cx, cy] = slotXY(i), sx = cx - RACK.sw / 2, sy = cy - RACK.sh / 2, dead = st.dead ? st.dead(i) : 0;
      rr(g, sx, sy, RACK.sw, RACK.sh, 10); g.fillStyle = '#0A0F14'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#26333F'; g.stroke();
      const f = st.fill ? st.fill(i) : 0;
      if (f > 0) slotContent(g, i, cx, cy + (1 - f) * -20, f * (1 - dead * .85), st.hit ? st.hit(i) : 0);
      if (dead > 0) {
        g.save(); g.globalAlpha *= dead; rr(g, sx, sy, RACK.sw, RACK.sh, 10); g.clip(); g.fillStyle = 'rgba(5,8,11,.6)'; g.fillRect(sx, sy, RACK.sw, RACK.sh);
        g.strokeStyle = rgba(C.red, .35); g.lineWidth = 4; for (let d = -RACK.sh; d < RACK.sw; d += 18) { g.beginPath(); g.moveTo(sx + d, sy + RACK.sh); g.lineTo(sx + d + RACK.sh, sy); g.stroke(); } g.restore();
      }
    }
  }, { al: st.ra ?? 1 });
  // 解码芯片 → 缓存架 的通路
  arrow(g, [[LAB.dx, LAB.dy + 82], [LAB.dx, RACK.y - 12]], { c: rgba(C.ink2, .5), w: 3, hs: 14, dash: [6, 8], off: -lt * 24, al: st.ra ?? 1 });
  // 读数
  readout(g, LAB.rx, LAB.ry, 420, 200, st.fps == null ? '--.-' : st.fps.toFixed(1), { label: '实测帧率', unit: 'fps', c: fpsCol(st.fps), ledc: fpsCol(st.fps), ledOn: st.fps == null ? 0 : 1, dh: 88, s: st.op ?? 1 });
  readout(g, LAB.cx, LAB.cy, 420, 180, st.cnt == null ? '-' : String(st.cnt), { label: '每帧解码', unit: '张', c: st.cntCol || C.green, ledc: st.cntCol || C.green, ledOn: st.cnt == null ? 0 : 1, dh: 76, s: st.op ?? 1 });
}
function labChip(g, lt, st) { chip(g, LAB.dx, LAB.dy, 300, 130, '硬件解码', lt, { heat: st.heat, busy: st.busy, sub: st.busy > .2 ? 'DECODING' : 'IDLE', s: st.cp ?? 1 }); }
/* 飞行的图标：board → 解码芯片 →（缓存格 | 回到屏幕） */
function flyIcon(g, lt, t0, from, to, kind, o = {}) {
  const u = (lt - t0) / (o.d || .9); if (u <= 0 || u >= 1) return;
  const mid = [LAB.dx - 40 + (o.jit || 0), LAB.dy];
  let p, s = .62, glow = 0;
  if (u < .5) { const v = eio(u / .5); p = bez(from, [lerp(from[0], mid[0], .5), Math.min(from[1], mid[1]) - 90], mid, v); s = lerp(.5, .3, v); }
  else { const v = eio((u - .5) / .5); p = bez([LAB.dx + 40, LAB.dy], o.back ? [lerp(LAB.dx, to[0], .5), LAB.dy - 150] : [to[0], LAB.dy + 40], to, v); s = lerp(.3, o.endS || .8, v); glow = 1 - v; }
  if (kind === 'bg') wallpaper(g, p[0] - 38 * s, p[1] - 44 * s, 76 * s, 88 * s);
  else if (kind === 'sel') { g.save(); rr(g, p[0] - 36 * s, p[1] - 42 * s, 72 * s, 84 * s, 14 * s); g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke(); g.restore(); }
  else icon(g, p[0], p[1], s, kind, { pixel: u < .5, glow: u >= .5 ? glow : 0, gc: o.gc || C.amber });
}
const slotKind = i => i === 0 ? 'bg' : i === 17 ? 'sel' : ((i <= 8 ? 0 : 3) + (i - 1) % 8) % 8;
const iconSrc = (i, off = 0) => boardPt(LAB.bx, LAB.by, LAB.bs, ((i % 4) + .5) / 4, i < 4 ? .3 : .7);

S('s05', {
  card: 3,
  cam: [[0, 960, 520, 1], [10.8, 960, 525, 1.02]],
  cues: () => { const k = CT('s05'), c = [[0, 'whoosh']]; for (let j = 0; j < 18; j++) c.push([k[0] + .2 + j * .17 + .9, 'tick', .4]); c.push([k[0] + .2 + 17 * .17 + 1.1, 'latch']); c.push([k[1] + .3, 'whoosh', .4], [k[1] + .9, 'success'], [k[1] + 1.5, 'whoosh', .4], [k[1] + 2.7, 'whoosh', .4]); return c; },
  draw(g, lt) {
    const k = CT('s05'), T = j => k[0] + .2 + j * .17, warmEnd = T(17) + .9;
    const off = offAt(lt, [[k[1] + .3, .7, 1], [k[1] + 1.5, .7, 0], [k[1] + 2.7, .7, 1]]);
    const sliding = lt > k[1] + .3;
    const hit = i => { if (!sliding || i === 0 || i === 17) return 0; const ph = (lt - k[1] - .3) % 1.2; return ph < .7 ? Math.max(0, 1 - Math.abs(ph - (i % 8) * .07 - .1) * 4) : 0; };
    const st = {
      off, cap: 18, bp: ap(lt, .1), cp: ap(lt, .3), rp: ap(lt, .5), op: ap(lt, .7),
      fill: i => eo(seg(lt, T(i) + .85, T(i) + 1.05)), hit,
      header: '2 × 8 + 背景 + 选中', headerA: fa(lt, warmEnd - .4),
      heat: lt < warmEnd ? .25 * fa(lt, k[0] + .2) : 0, busy: lt < warmEnd && lt > k[0] + .2 ? 1 : 0,
      fps: lt > k[1] + .9 ? valAt(lt, [[k[1] + .9, 0], [k[1] + .9, 66.7]], .5)[0] : null,
      cnt: sliding ? 0 : null, cntCol: C.green,
      iconState: (p, i) => sliding ? { glow: .6, gc: C.green } : null,
    };
    lab(g, lt, st);
    for (let j = 0; j < 18; j++) flyIcon(g, lt, T(j), iconSrc(j % 8), slotXY(j), slotKind(j), { jit: (j % 3 - 1) * 14 });
    labChip(g, lt, st);
    if (sliding) tag(g, '命中缓存 · 0 解码', LAB.cx, 744, C.green, seg(lt, k[1] + .5, k[1] + .9), { fs: 28 });
  },
});

S('s06', {
  cam: [[0, 960, 525, 1.02], [11.8, 960, 530, 1.04]],
  cues: () => { const k = CT('s06'), c = [[k[0] + .5, 'error', .6]]; for (let j = 0; j < 4; j++) c.push([k[1] + .4 + j * .6, 'tick', .5]); c.push([k[1] + 1.0, 'latch', .5]); for (let j = 0; j < 12; j++) c.push([k[2] + .2 + j * .18, 'tick', .4]); c.push([k[2] + .8, 'error']); return c; },
  draw(g, lt) {
    const k = CT('s06');
    const off = offAt(lt, [[k[1] + .3, 3.2, .22], [k[2] + .2, 2.6, 1]]);
    const P2 = lt > k[1] + .3 && lt < k[2] + .2, P8 = lt > k[2] + .2;
    const steps = [[0, 66.7], [k[0] + .6, null], [k[1] + 1.0, 53.3], [k[2] + .8, 24]];
    let fps = 66.7; if (lt > k[0] + .6) fps = null; if (lt > k[1] + 1.0) fps = valAt(lt, [[k[1] + 1.0, 66.7], [k[1] + 1.0, 53.3]], .5)[0]; if (lt > k[2] + .8) fps = valAt(lt, [[k[2] + .8, 53.3], [k[2] + .8, 24]], .5)[0];
    const heat = P8 ? lerp(.35, 1, fa(lt, k[2] + .2, .8)) : P2 ? .35 * fa(lt, k[1] + .3) : 0;
    const st = {
      off, cap: lt > k[0] + .5 ? 1 : 18,
      fill: i => i === 0 ? 1 : 1 - eo(seg(lt, k[0] + .5 + i * .05, k[0] + .7 + i * .05)), dead: i => i === 0 ? 0 : eo(seg(lt, k[0] + .5 + i * .05, k[0] + .7 + i * .05)),
      header: '只留背景', headerA: fa(lt, k[0] + 1.4),
      heat, busy: P2 || P8 ? 1 : 0, fps, cnt: P8 ? 8 : P2 ? 2 : null, cntCol: P8 ? C.red : C.amber,
      iconState: (p, i) => (P2 || P8) ? { glow: .5, gc: C.amber } : null,
    };
    lab(g, lt, st);
    // 解码流：每帧 2 张 → 每帧 8 张
    if (P2) for (let j = 0; j < 12; j++) { const t0 = k[1] + .3 + j * .3; const i = (j * 3) % 8; flyIcon(g, lt, t0, iconSrc(i), iconSrc(i), (i + 1) % 8, { back: true, endS: .5, jit: (j % 2) * 20 }); }
    if (P8) for (let j = 0; j < 36; j++) { const t0 = k[2] + .2 + j * .085; const i = j % 8; flyIcon(g, lt, t0, iconSrc(i), iconSrc((i + 4) % 8), (i + 3) % 8, { back: true, endS: .5, jit: ((j * 7) % 5 - 2) * 12, gc: C.red }); }
    labChip(g, lt, st);
    if (P8 && lt > k[2] + .8) ripple(g, LAB.rx, LAB.ry, lt - k[2] - .8, C.red, 80, 260, .8);
    if (P2 || P8) tag(g, P8 ? '整页 8 张现解' : '每帧现解 2 张', LAB.cx, 744, P8 ? C.red : C.amber, seg(lt, (P8 ? k[2] : k[1]) + .4, (P8 ? k[2] : k[1]) + .8), { fs: 28 });
  },
});

S('s07', {
  cam: [[0, 960, 520, 1], [4.9, 960, 520, 1.03]],
  cues: [[.2, 'blip', .6], [.5, 'blip', .6], [.8, 'blip', .6], [1.4, 'draw', .6], [2.4, 'whoosh', .5]],
  draw(g, lt) {
    const D = [[0, 66.7, 420], [2, 53.3, 960], [8, 24, 1500]];
    const yOf = v => 520 - v * 4.4;
    // 三个点 + 下降折线
    g.save(); g.globalAlpha *= fa(lt, .1);
    path(g, [[240, 520], [1680, 520]], { c: C.dim, w: 2 });
    for (const v of [20, 40, 60]) { path(g, [[240, yOf(v)], [1680, yOf(v)]], { c: rgba(C.dim, .4), w: 1.5, dash: [6, 10] }); text(g, String(v), 210, yOf(v), { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'right' }); }
    g.restore();
    const pts = D.map(([, v, x]) => [x, yOf(v)]);
    path(g, partial(pts, eo(seg(lt, 1.4, 2.2))), { c: C.amber, w: 4, glow: C.amber });
    D.forEach(([p, v, x], i) => {
      const t0 = .2 + i * .3;
      reticle(g, x, yOf(v), 22 * ap(lt, t0), fpsCol(v), 1, 0);
      readout(g, x, 700, 440, 200, v.toFixed(1), { s: ap(lt, t0), label: `每帧解码 ${p} 张`, unit: 'fps', c: fpsCol(v), ledc: fpsCol(v), dh: 84 });
    });
  },
});

/* =====================================================================
 * 第三章：先算，再写 UI
 * ===================================================================== */
const TB = { x0: 380, px: 28.4, rows: [[0, 66.7, 320], [2, 53.3, 480], [8, 24, 640]] };
const msX = ms => TB.x0 + ms * TB.px;
S('s08', {
  card: 4,
  cam: [[0, 960, 500, 1], [14.2, 960, 505, 1.02]],
  cues: () => { const k = CT('s08'), c = [[0, 'whoosh']]; TB.rows.forEach((r, i) => c.push([k[0] + .3 + i * .8, 'draw', .6])); c.push([k[1] + .2, 'latch', .6], [k[2] + .2, 'tick', .6], [k[2] + 1.0, 'tick', .6], [k[2] + 2.2, 'success']); return c; },
  draw(g, lt) {
    const k = CT('s08');
    g.save(); g.globalAlpha *= fa(lt, .1, .4); scope(g, 200, 170, 1520, 620, { nx: 9, ny: 6 }); g.restore();
    // 时间轴
    for (let ms = 0; ms <= 45; ms += 5) { path(g, [[msX(ms), 724], [msX(ms), 736]], { c: C.green, w: 2, al: .7 }); text(g, String(ms), msX(ms), 756, { f: 'mono', s: 24, w: 700, c: rgba(C.green, .8) }); }
    text(g, 'ms', msX(45) + 40, 756, { f: 'mono', s: 24, w: 700, c: rgba(C.green, .8) });
    TB.rows.forEach(([p, fpsV, y], ri) => {
      const t0 = k[0] + .3 + ri * .8, total = 1000 / fpsV, u = eo(seg(lt, t0, t0 + .7)), cur = 15 + (total - 15) * clamp((u * total - 15) / Math.max(.01, total - 15));
      if (lt < t0) return;
      text(g, `${p} 张`, 300, y, { f: 'mono', s: 28, w: 700, c: C.ink2, a: 'right' });
      const baseW = Math.min(u * total, 15) * TB.px;
      rr(g, TB.x0, y - 34, baseW, 68, 6); g.fillStyle = rgba(C.cyan, .75); g.fill();
      if (baseW > 120) text(g, '底座', TB.x0 + 70, y, { s: 28, w: 900, c: '#04110C' });
      if (p > 0) {
        const per = (total - 15) / p;
        for (let b = 0; b < p; b++) {
          const bs = 15 + b * per, done = u * total;
          if (done <= bs) break;
          const bw = (Math.min(done, bs + per) - bs) * TB.px;
          rr(g, msX(bs) + 2, y - 34, Math.max(0, bw - 4), 68, 5); g.fillStyle = rgba(C.amber, .85); g.fill();
        }
        if (p === 2 && u > .9) text(g, '解码', msX(15 + per) , y - 54, { s: 24, w: 700, c: C.amber, al: fa(lt, t0 + .7) });
      }
      if (u >= 1) text(g, total.toFixed(1) + 'ms', msX(total) + 16, y, { f: 'mono', s: 28, w: 700, c: C.ink, a: 'left', al: fa(lt, t0 + .7) });
    });
    // 第二句：底座 = 1000 ÷ 66.7
    if (lt > k[1]) {
      const a = fa(lt, k[1] + .1);
      path(g, partial([[msX(15), 250], [msX(15), 700]], eo(seg(lt, k[1], k[1] + .5))), { c: C.cyan, w: 2.5, dash: [8, 8], al: a });
      tag(g, '1000 ÷ 66.7 = 15ms', msX(7.5), 238, C.cyan, seg(lt, k[1] + .2, k[1] + .6), { fs: 28, f: 'mono' });
    }
    // 第三句：每张图的解码时间
    if (lt > k[2]) {
      tag(g, '(18.8 − 15) ÷ 2 ≈ 1.9ms/张', 1290, 480, C.amber, seg(lt, k[2] + .2, k[2] + .6), { fs: 28, f: 'mono' });
      tag(g, '(41.7 − 15) ÷ 8 ≈ 3.3ms/张', 1110, 562, C.amber, seg(lt, k[2] + 1.0, k[2] + 1.4), { fs: 28, f: 'mono' });
      const m = seg(lt, k[2] + 1.8, k[2] + 2.4);
      if (m > 0 && m < 1) { const e = eio(m); dot(g, lerp(1290, 1420, e), lerp(480, 320, e), 10, C.amber); dot(g, lerp(1110, 1420, e), lerp(562, 320, e), 10, C.amber); }
      if (m >= 1) {
        readout(g, 1420, 316, 440, 156, '2.6', { s: ap(lt, k[2] + 2.4), label: '平均每张', unit: 'ms/张', c: C.green, dh: 60 });
        ripple(g, 1420, 320, lt - k[2] - 2.4, C.green, 60, 220, .8);
      }
    }
  },
});

const PL = { x0: 440, y0: 740, px: 106, py: 5 };
const plX = p => PL.x0 + p * PL.px, plY = v => PL.y0 - v * PL.py, model = p => 1000 / (15 + 2.6 * p);
S('s09', {
  cam: [[0, 960, 500, 1], [9.5, 960, 505, 1.02]],
  cues: () => { const k = CT('s09'); return [[k[0], 'latch', .6], [k[0] + .8, 'draw'], [k[0] + 1.8, 'blip', .5], [k[0] + 2.1, 'blip', .5], [k[0] + 2.4, 'blip', .5], [k[1] + .3, 'tick'], [k[1] + .9, 'tick']]; },
  draw(g, lt) {
    const k = CT('s09');
    at(g, 960, 186, ap(lt, k[0], .5), () => {
      card(g, -560, -54, 1120, 108, { r: 16, lw: 2.5, stroke: rgba(C.green, .6) });
      text(g, 'fps = 1000 ÷ (15 + 2.6 × 张数)', 0, 3, { f: 'mono', s: 50, w: 700, c: C.green, glow: rgba(C.green, .55) });
    });
    g.save(); g.globalAlpha *= fa(lt, k[0] + .3); scope(g, 340, 296, 1260, 500, { nx: 10, ny: 8 }); g.restore();
    const ax = fa(lt, k[0] + .4);
    for (let p = 0; p <= 10; p += 2) text(g, String(p), plX(p), 768, { f: 'mono', s: 24, w: 700, c: C.ink2, al: ax });
    for (let v = 0; v <= 80; v += 20) text(g, String(v), 410, plY(v), { f: 'mono', s: 24, w: 700, c: C.ink2, a: 'right', al: ax });
    text(g, '每帧解码张数', 1394, 768, { s: 24, w: 700, c: C.ink2, al: ax });
    text(g, 'fps', 470, 326, { f: 'mono', s: 26, w: 700, c: C.ink2, al: ax });
    const pts = []; for (let i = 0; i <= 60; i++) { const p = i / 6; pts.push([plX(p), plY(model(p))]); }
    const cu = eo(seg(lt, k[0] + .8, k[0] + 1.8)), q = partial(pts, cu);
    path(g, q, { c: C.green, w: 5, glow: C.green, gb: 18 });
    if (cu > 0 && cu < 1) dot(g, q.at(-1)[0], q.at(-1)[1], 8, '#fff');
    [[0, 66.7], [2, 53.3], [8, 24]].forEach(([p, v], i) => {
      const t0 = k[0] + 1.8 + i * .3; if (lt < t0) return;
      reticle(g, plX(p), plY(v), 18 * ap(lt, t0), C.amber, 1, 0); ripple(g, plX(p), plY(v), lt - t0, C.amber, 20, 70, .6);
    });
    // 第二句：偏差
    if (lt > k[1]) {
      [[2, 53.3, '实测 53.3 / 公式 49.5', 830, 420, k[1] + .3], [8, 24, '实测 24 / 公式 27.9', 1250, 690, k[1] + .9]].forEach(([p, v, s, tx, ty, t0]) => {
        if (lt < t0) return;
        const bl = Math.floor((lt - t0) * 5) < 4 ? (Math.floor((lt - t0) * 5) % 2 ? .4 : 1) : 1;
        path(g, [[plX(p), plY(v)], [plX(p), plY(model(p))]], { c: C.red, w: 4, dash: [6, 6], al: bl });
        ring(g, plX(p), plY(model(p)), 9, C.green, 3);
        tag(g, s, tx, ty, C.red, seg(lt, t0, t0 + .4), { fs: 26, f: 'mono' });
      });
    }
  },
});

S('s10', {
  cam: [[0, 960, 500, 1], [13.3, 960, 505, 1.02]],
  cues: () => { const k = CT('s10'); return [[k[0] + .2, 'whoosh', .5], [k[0] + .9, 'success'], [k[1] + .2, 'whoosh', .5], [k[1] + 1.0, 'latch', .5], [k[1] + 2.0, 'draw'], [k[2] + .2, 'latch', .5], [k[2] + .5, 'latch', .5], [k[2] + .8, 'latch', .5], [k[2] + 1.8, 'error']]; },
  draw(g, lt) {
    const k = CT('s10');
    const colA = (i) => fa(lt, k[i], .4) * (i < 2 && lt > k[i + 1] ? .55 + .45 * fo(lt, k[i + 1], .4) : 1);
    // ① 预估
    at(g, 340, 480, ap(lt, k[0], .5), () => {
      card(g, -270, -310, 540, 640, { r: 20, lw: 2.5, stroke: C.bezel });
      text(g, '设备控制界面 · 首次滑动', 0, -270, { s: 28, w: 700, c: C.ink2 });
      gauge(g, 0, -40, 150, needleAt(lt, [[k[0] + .4, 55]]), { title: 'FPS' });
      readout(g, 0, 210, 420, 130, '55+', { unit: 'fps', c: C.green, dh: 66 });
    }, { al: colA(0) });
    // ② 规则图标：贴图 vs 直接画
    at(g, 960, 480, ap(lt, k[1], .5), () => {
      card(g, -270, -310, 540, 640, { r: 20, lw: 2.5, stroke: C.bezel });
      text(g, '规则图标', 0, -270, { s: 28, w: 700, c: C.ink2 });
      // 贴图：位图 → 解码 → 占缓存格
      const l = lt - k[1];
      tag(g, '贴图', -170, -196, C.red, seg(l, .2, .5), { fs: 26 });
      const mv = eio(seg(l, .4, 1.4));
      icon(g, lerp(-170, 170, mv), -100, .8, 0, { pixel: mv < .5 });
      chip(g, 0, -100, 140, 90, '解码', lt, { fs: 26, heat: mv > .2 && mv < .8 ? .5 : 0, busy: mv > .2 && mv < .8 ? 1 : 0 });
      rr(g, 120, -150, 100, 110, 10); g.lineWidth = 3; g.strokeStyle = rgba(C.amber, .7); g.setLineDash([6, 6]); g.stroke(); g.setLineDash([]);
      if (l > 1.4) tag(g, '+ 解码 + 占缓存', 30, -2, C.amber, seg(l, 1.4, 1.8), { fs: 24 });
      path(g, [[-240, 60], [240, 60]], { c: C.bezel, w: 2 });
      // 直接画：矢量描线
      tag(g, '直接画', -150, 116, C.green, seg(l, 1.6, 1.9), { fs: 26 });
      const dp = eo(seg(l, 1.8, 2.9)), cx = -150, cy = 210;
      ring(g, cx, cy, 42, C.cyan, 7, 1, -TAU / 4, -TAU / 4 + TAU * clamp(dp * 1.6));
      path(g, partial([[cx - 22, cy + 6], [cx - 4, cy + 24], [cx + 26, cy - 16]], clamp(dp * 2.4 - 1.4)), { c: C.cyan, w: 7 });
      if (dp > 0 && dp < 1) { const a = -TAU / 4 + TAU * clamp(dp * 1.6); dot(g, cx + Math.cos(a) * 42, cy + Math.sin(a) * 42, 6, '#fff'); }
      text(g, '0 解码 · 0 缓存', 90, 210, { s: 28, w: 700, c: C.green, al: fa(l, 2.8) });
    }, { al: colA(1) });
    // ③ 静态屏保：层级叠加，底座变长
    at(g, 1580, 480, ap(lt, k[2], .5), () => {
      card(g, -270, -310, 540, 640, { r: 20, lw: 2.5, stroke: C.bezel });
      text(g, '静态屏保', 0, -270, { s: 28, w: 700, c: C.ink2 });
      const l = lt - k[2];
      for (let j = 0; j < 3; j++) {
        const t0 = .2 + j * .3, a = fa(l, t0, .3); if (a <= 0) continue;
        const ox = -150 + j * 50, oy = -200 + j * 60 + (1 - eo(seg(l, t0, t0 + .4))) * -30;
        g.save(); g.globalAlpha *= a; rr(g, ox, oy, 250, 170, 14); g.fillStyle = rgba([C.cyan, C.violet, C.amber][j], .14); g.fill(); g.lineWidth = 2.5; g.strokeStyle = rgba([C.cyan, C.violet, C.amber][j], .7); g.stroke();
        for (let n = 0; n < 14; n++) dot(g, ox + 24 + hash(n * 3.1 + j) * 200, oy + 22 + hash(n * 5.7 + j * 2) * 126, 6, [C.cyan, C.violet, C.amber][j], .8);
        g.restore();
      }
      // 底座条
      const grow = eo(seg(l, 1.2, 2.2)), bw = lerp(150, 430, grow), red = grow;
      text(g, '底座', -210, 200, { s: 26, w: 700, c: C.ink2, a: 'left', al: fa(l, 1.0) });
      rr(g, -210, 226, bw, 46, 6); g.fillStyle = rgba(red > .5 ? C.red : C.cyan, .8); g.globalAlpha *= fa(l, 1.0); g.fill(); g.globalAlpha = 1;
      if (grow > .1) text(g, '↑', -210 + bw + 0, 200, { f: 'disp', s: 36, w: 900, c: C.red, a: 'right', al: grow });
    }, { al: colA(2) });
  },
});

/* =====================================================================
 * 总结
 * ===================================================================== */
function module(g, i, y, lt, t0) {
  const sl = eo(seg(lt, t0, t0 + .5)), x = lerp(2200, 960, sl), sq = lt - t0 > .5 && lt - t0 < .7 ? Math.sin(seg(lt, t0 + .5, t0 + .7) * Math.PI) * .03 : 0;
  if (sl <= 0) return;
  at(g, x, y, 1, () => {
    card(g, -680, -76, 1360, 152, { r: 14, lw: 2.5, stroke: C.bezel });
    for (const [sx, sy] of [[-656, -52], [656, -52], [-656, 52], [656, 52]]) screw(g, sx, sy, 6);
    seg7(g, String(i + 1), -590, 0, 80, C.cyan, {});
    text(g, ['测量环境', '控制变量', '帧率预算'][i], -500, 2, { s: 40, w: 900, a: 'left' });
    if (i === 0) { toggle(g, 90, 0, 0, null, { s: .55, noText: true }); toggle(g, 210, 0, 0, null, { s: .55, noText: true }); text(g, '日志 · 屏上 FPS', 300, 2, { s: 28, w: 700, a: 'left', c: C.ink2 }); }
    if (i === 1) {
      dot(g, 140, 0, 46, '#1E2A34'); ring(g, 140, 0, 46, C.bezel, 4);
      for (let a = 0; a < 7; a++) { const an = Math.PI * .75 + a * Math.PI * 1.5 / 6; dot(g, 140 + Math.cos(an) * 60, Math.sin(an) * 60, 4, a === 5 ? C.amber : C.dim); }
      const an = Math.PI * .75 + 5 * Math.PI * 1.5 / 6 * clamp(spring(lt - t0 - .5, 6, 1));
      path(g, [[140, 0], [140 + Math.cos(an) * 36, Math.sin(an) * 36]], { c: C.amber, w: 7 });
      text(g, '每帧解码张数', 240, 2, { s: 30, w: 700, a: 'left', c: C.amber });
    }
    if (i === 2) { text(g, '1000 ÷ (15 + 2.6 × P)', 20, 2, { f: 'mono', s: 30, w: 700, a: 'left', c: C.green }); seg7(g, '55+', 590, 0, 60, C.green, { a: 'right' }); }
    led(g, 630, 0, 9, C.green, fa(lt, t0 + .6, .2));
  }, { sy: 1 - sq, sx: 1 + sq });
}
S('s11', {
  card: 5,
  cam: [[0, 960, 520, 1], [13.5, 960, 520, 1.03]],
  cues: () => { const k = CT('s11'); return [[0, 'whoosh'], [k[0] + .5, 'latch'], [k[1] + .5, 'latch'], [k[2] + .5, 'latch'], [k[2] + 2.4, 'success']]; },
  draw(g, lt) {
    const k = CT('s11');
    g.save(); g.globalAlpha *= fa(lt, 1.6, .4);
    card(g, 240, 160, 1440, 700, { r: 22, fill: '#0C1217', lw: 3, stroke: C.bezel });
    for (let y = 190; y < 840; y += 30) { dot(g, 262, y, 4, '#25313B'); dot(g, 1658, y, 4, '#25313B'); }
    for (let j = 0; j < 3; j++) led(g, 900 + j * 60, 196, 8, C.green, fa(lt, k[2] + 2.4 + j * .1, .2));
    g.restore();
    module(g, 0, 320, lt, k[0]); module(g, 1, 520, lt, k[1]); module(g, 2, 720, lt, k[2]);
  },
});

S('s12', {
  title: true, fi: .2, fo: .4,
  draw(g, lt) {
    const u = eio(seg(lt, 0, .5)), sx = lerp(260, 1660, u);
    g.save(); g.beginPath(); g.rect(0, 0, sx, H); g.clip();
    text(g, SERIES.title, 960, 490, { s: 110, w: 900, glow: rgba(C.cyan, .4), gb: 24 });
    text(g, SERIES.sub, 960, 600, { s: 40, w: 700, c: C.cyan });
    g.restore();
    if (u < 1) path(g, [[sx, 380], [sx, 680]], { c: C.green, w: 4, glow: C.green, gb: 20 });
    path(g, [[260, 660], [sx, 660]], { c: rgba(C.green, .5), w: 2 });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 3 });
  filmStrip(g, 80, 880, 1760, 130, 112, 6.3, { thumb: thumbAt });
  gauge(g, 1540, 540, 150, 24, { title: 'FPS' });
  seg7(g, '66.7', 140, 520, 220, C.green, { a: 'left' });
  arrow(g, [[700, 520], [840, 520]], { c: C.ink2, w: 10, hs: 34 });
  seg7(g, '24', 880, 520, 220, C.red, { a: 'left' });
  text(g, 'fps', 1200, 600, { f: 'mono', s: 56, w: 700, c: C.ink2, a: 'left' });
  text(g, '变量藏在哪？', 100, 200, { s: 120, w: 900, a: 'left' });
  text(g, '手机慢动作，数出帧率公式', 104, 740, { s: 56, w: 700, a: 'left', c: C.cyan });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
