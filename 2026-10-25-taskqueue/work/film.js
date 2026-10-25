/* =====================================================================
 * 把任务队列改成网络线程池 —— 编排（字幕数据在 script.js，风格图元在 kit.js）
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]；后墙按镜头做 0.25 视差（kit.js drawBackground）。
 * 章节：0 开场、1 片名、2–6 五章、7 总结、8 结尾、9 片尾（配乐脚本按此划段）。
 * 样片阶段：ONLY 列出已实现的幕；SAMPLE_OPT 给样片里的幕加章节卷帘和前置留白（lead 秒）。
 * 全片时把 ONLY 置为 null、SAMPLE_OPT 置为 {}，逐幕补齐 S(...) 即可。
 * ===================================================================== */
'use strict';
const ONLY = ['s02', 's15', 's20'];
const SAMPLE_OPT = { s15: { card: 4, lead: 1.6 } };

const CHAPTERS = [
  ['开场｜布局一变，要拉三到五趟', 'ONE LAYOUT, FIVE REQUESTS', '布局一变，屏端要连发 3 到 5 个请求；推送 4KB 带不下数据。'],
  ['把任务队列，改成网络线程池', 'FROM TASK QUEUE TO NETWORK POOL', '一个工位，同时等八个请求。'],
  ['第一章｜推送只当门铃', 'THE DOORBELL', '最坏布局 4.62KB 超过推送上限 4KB；通知与数据分离，屏端自己拉。'],
  ['第二章｜一个工位，多路并发', 'ONE WORKER, MANY TUBES', '单线程串行保证有序与线程安全；curl multi + poll 让一个线程同时等所有请求。'],
  ['第三章｜大单拆箱，坏件返修', 'SPLIT & RETRY', '公共参数 + 变长列表分包、最多 8 个子请求；只重试失败者，界面请求立刻回错。'],
  ['第四章｜插队与闸门', 'CUT-IN & GATE', '本地任务与高优先级插队；同步屏障挡住其后的网络任务 900ms，1 秒定时器收尾。'],
  ['第五章｜查重、拒收、工单号', 'DEDUP · REJECT · TRACE', '全队列查重、满了丢新任务、自增编号与两段耗时。'],
  ['总结｜带走三条', 'THREE TAKEAWAYS', '先算约束；单线程换安全、多路复用换并发；不同的活不同待遇。'],
  ['结尾｜跑一遍', 'RUN IT', 'demo 10 个场景、21 项断言全部通过。'],
  ['系列片尾', 'WORK ARCHIVE', '工作档案：把做过的设计，讲成故事。'],
];
const CARD = {
  2: ['01', '推送只当门铃', 'THE DOORBELL', C.cyan], 3: ['02', '一个工位，多路并发', 'ONE WORKER, MANY TUBES', C.green],
  4: ['03', '大单拆箱，坏件返修', 'SPLIT & RETRY', C.orange], 5: ['04', '插队与闸门', 'CUT-IN & GATE', C.yellow],
  6: ['05', '查重、拒收、工单号', 'DEDUP · REJECT · TRACE', C.red], 7: ['✓', '带走三条', 'THREE TAKEAWAYS', C.cream],
};
const CH_SHORT = ['开场', '', '第一章 · 推送只当门铃', '第二章 · 一个工位，多路并发', '第三章 · 大单拆箱，坏件返修', '第四章 · 插队与闸门', '第五章 · 查重、拒收、工单号', '总结 · 带走三条', '结尾 · 跑一遍', ''];
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };
const TITLE = { main: '把任务队列，改成网络线程池', hot: '网络线程池', sub: '一个工位，同时等八个请求' };

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.wall, white: C.cream, cyan: C.cyan, red: C.red, amber: C.yellow },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: C.cyan, danger: C.red, accent: C.yellow },
    maxWidth: 1500, lineHeight: 64, baseY: n => n > 1 ? 932 : 972, slide: 0, fadeIn: .12, fadeOut: .12, revealDuration: () => 0 },
  prepare: prepareStyle, drawBackground,
  beforeScene(g, frame) {
    const { sc, lt } = frame; SCX = frame.scaleX;
    const [cx, cy, z] = camAt(sc.cam, lt); CAMZ = z; CAM = [cx, cy, z];
    g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-cx, -cy);
    g.globalAlpha *= Math.min(sc.fi ? eo(seg(lt, 0, sc.fi)) : 1, sc.fo ? 1 - eo(seg(lt, sc.d - sc.fo, sc.d)) : 1);
  },
  drawTransition(g, frame) { CAMZ = 1; postFX(g, frame); shutterWipe(g, frame); },
  drawChrome, drawCaptionBackground, drawCaption,
});

/* ---------------- 章节转场：卷帘门落下 → 门上喷涂章号 → 卷起 ---------------- */
function shutterDoor(g, yb, cd) {
  const top = yb - H - 80, door = new Path2D(); door.rect(-10, top, W + 20, yb - top);
  const [num, zh, en, col] = cd;
  g.save();
  g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 50 * SCX; g.shadowOffsetY = 24 * SCX; g.fillStyle = C.steelD; g.fill(door); g.restore();
  g.clip(door);
  for (let y = yb - 58; y > top - 40; y -= 34) {
    const lg = g.createLinearGradient(0, y - 34, 0, y);
    lg.addColorStop(0, '#56626A'); lg.addColorStop(.42, '#7F8B91'); lg.addColorStop(.6, '#67737A'); lg.addColorStop(1, '#3A4449');
    g.fillStyle = lg; g.fillRect(-10, y - 34, W + 20, 34);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-10, y - 2, W + 20, 2);
  }
  const grime = g.createLinearGradient(0, yb - H, 0, yb); grime.addColorStop(0, 'rgba(10,14,16,.35)'); grime.addColorStop(.7, 'rgba(10,14,16,0)'); grime.addColorStop(1, 'rgba(30,22,10,.25)');
  g.fillStyle = grime; g.fillRect(-10, top, W + 20, yb - top);
  // 门上喷涂（随门移动）：大章号 + 中文标题 + 英文
  const o = yb - H;
  g.save(); g.globalAlpha *= .92;
  text(g, num, 470, o + 505, { f: 'disp', w: 900, s: 300, c: col, emboss: true });
  g.restore();
  path(g, [[700, o + 395], [700, o + 615]], { c: rgba(C.cream, .35), w: 4 });
  text(g, zh, 742, o + 482, { s: 104, w: 900, a: 'left', emboss: true });
  text(g, en, 748, o + 578, { f: 'mono', s: 30, w: 700, ls: 8, c: rgba(C.cream, .78), a: 'left' });
  // 底边：警示条 + 钢底梁 + 拉手
  hazard(g, -10, yb - 58, W + 20, 40, { s: 30, lw: 0 });
  plate(g, -10, yb - 20, W + 20, 20, { fill: C.steelD, r: 0, rivets: false, shadow: false, lw: 2 });
  for (const hx of [560, 1360]) plate(g, hx - 50, yb - 50, 100, 20, { fill: C.steel, r: 8, rivets: false, shadow: false });
  g.restore();
}
function nextCard(frame) { // 下一幕若有章节卷帘，本幕最后 .42 s 让卷帘先落下
  const { sc, lt } = frame, nx = frame.film.sceneAt(sc.start + sc.d + 1e-3);
  return nx && nx !== sc && CARD[nx.card] && lt > sc.d - .42 ? [CARD[nx.card], seg(lt, sc.d - .42, sc.d)] : null;
}
function shutterWipe(g, frame) {
  const { sc, lt } = frame, nc = nextCard(frame);
  if (nc) { shutterDoor(g, H * nc[1] * nc[1], nc[0]); return; }
  const cd = CARD[sc.card]; if (!cd || lt > 2.0) return;
  const b = Math.min(lt, .3) / .3;
  let yb = H - Math.abs(Math.sin(b * Math.PI)) * 22 * (1 - b);
  yb -= (H + 120) * eio(seg(lt, 1.42, 1.95));
  if (yb <= 0) return;
  shutterDoor(g, yb, cd);
}

/* ---------------- 外框：左上章节牌、右上章节灯、演绎/放慢标记 ---------------- */
function drawChrome(g, frame) {
  const { sc, lt, t } = frame, nc = nextCard(frame);
  CAMZ = 1;
  if (sc.title) return;
  const a = (sc.card ? eo(seg(lt, 1.7, 2.2)) : 1) * (nc ? 1 - nc[1] : 1);
  g.save(); g.globalAlpha *= a;
  const lab = CH_SHORT[sc.chapter];
  if (lab) {
    const w = textW(g, lab, { s: 26, w: 700 }) + 74;
    plate(g, 52, 40, w, 52, { fill: C.ink2, r: 6, rivets: false, sb: 12, so: 4, sa: .35 });
    hazard(g, 52, 40, 16, 52, { s: 9, lw: 0 });
    text(g, lab, 86, 67, { s: 26, w: 700, a: 'left', emboss: true });
  }
  for (let k = 2; k <= 7; k++) {
    const x = 1612 + (k - 2) * 46, cur = sc.chapter === k, done = sc.chapter > k;
    lampDot(g, x, 66, cur ? 11 : 8, cur ? CARD[k][3] : C.yellow, cur ? .75 + .25 * Math.sin(t * 5) : done ? .6 : 0);
  }
  let xr = 1580;
  if (sc.demo) xr -= warnTag(g, '⚠ 机制演绎', xr, 66, C.yellow, '#151515') + 12;
  if (sc.scaled) warnTag(g, '时间已放慢', xr, 66, C.cyan, '#0B1A22');
  g.restore();
}
function warnTag(g, s, xr, y, fill, tc) {
  const w = textW(g, s, { s: 24, w: 900 }) + 36;
  plate(g, xr - w, y - 23, w, 46, { fill, r: 6, rivets: false, sb: 10, so: 3, sa: .35 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 900, c: tc });
  return w;
}

/* ---------------- 字幕：深色钢板 + 左侧警示条 + 铆钉；琥珀色词带荧光底 ---------------- */
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
  plate(g, x, y, w, h, { fill: '#171C1F', top: '#232A2E', bot: '#101416', r: 8, lw: 2.5, stroke: '#05070826', rivets: false, sb: 30, so: 12, sa: .5 });
  hazard(g, x, y, 14, h, { s: 10, lw: 0, r: 0 });
  for (const ry of [y + 14, y + h - 14]) rivet(g, x + w - 16, ry, 4);
  g.restore();
}
function drawCaption(g, layout, frame) {
  if (frame.sc.title || frame.t >= layout.caption.t1) return;
  const k = eo(seg(frame.t, layout.caption.t0, layout.caption.t0 + .25));
  g.globalAlpha = Math.min(seg(frame.t, layout.caption.t0, layout.caption.t0 + .12), 1 - seg(frame.t, layout.caption.t1 - .12, layout.caption.t1));
  for (const l of layout.lines) {
    let x = l.x + 7;
    for (const s of l.segments) {
      const w = textW(g, s.s, { s: 54, w: 700 });
      if (s.c === C.yellow) { rr(g, x - 3, l.y + 6 + (1 - k) * 10, w + 6, 12, 4); g.fillStyle = rgba(C.yellow, .38); g.fill(); }
      text(g, s.s, x, l.y + (1 - k) * 10, { s: 54, w: 700, c: s.c || C.cream, a: 'left', b: 'alphabetic', emboss: true });
      x += w;
    }
  }
}

/* ---------------- 场景注册 ---------------- */
let lastChapter = -1;
function S(id, o) {
  if (ONLY && !ONLY.includes(id)) return;
  const d = SCRIPT[id], ov = SAMPLE_OPT[id] || {}, lead = ov.lead || 0;
  if (d.chapter !== lastChapter) { film.chapter(d.chapter, ...CHAPTERS[d.chapter]); lastChapter = d.chapter; }
  return film.addScene({
    ...o, ...ov, id, chapter: d.chapter, dur: d.dur + lead, pre: 0, post: 0,
    cam: o.cam && o.cam.map(([t, ...r]) => [t + lead, ...r]),
    captions: d.caps.map(([t, end, text]) => ({ t: t + lead, end: end + lead, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t: t + lead, type, v: v ?? 1 })),
    draw: (g, lt, sc, frame) => o.draw(g, lt - lead, sc, frame),
  });
}

/* =====================================================================
 * 片名
 * ===================================================================== */
S('s02', {
  title: true, fi: .3,
  cam: [[0, 960, 520, 1.0], [6, 960, 505, 1.045]],
  cues: [[.05, 'whoosh'], [.5, 'clank'], ...Array.from(TITLE.main).map((_, i) => [.62 + i * .055, 'stamp', .45]), [1.4, 'weld'], [3.3, 'whoosh', .7], [4.05, 'latch', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, -260, 2180, 772, lt, { v: 150, legGap: 300 });
    const kinds = ['http', 'local', 'http', 'hi', 'http', 'sync', 'http', 'local', 'http'];
    kinds.forEach((kind, i) => {
      const x = ((i * 290 + lt * 150) % 2610) - 300;
      crate(g, x, 762, { kind, no: 128 + i, w: 126, h: 92 });
    });
    // 吊梁 + 链条 + 招牌（弹簧落定）
    const yS = lerp(-260, 360, spring(lt, 6.5, 1.15)), pw = 1480, ph = 250, x0 = 960 - pw / 2;
    plate(g, 180, 112, 1560, 26, { fill: C.steelD, r: 3, rivets: false, sb: 14, so: 6 });
    for (const cx of [x0 + 150, x0 + pw - 150]) {
      for (let yy = 138; yy < yS - ph / 2; yy += 22) { g.save(); g.translate(cx, yy + 11); g.rotate(((yy / 22) % 2) * .0); rr(g, -7, -12, 14, 24, 7); g.lineWidth = 4; g.strokeStyle = C.steel; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke(); g.restore(); }
    }
    plate(g, x0, yS - ph / 2, pw, ph, { fill: '#3E4A4F', r: 10, lw: 3, sb: 40, so: 18 });
    hazard(g, x0 + 18, yS - ph / 2 + 16, pw - 36, 14, { s: 16, lw: 1.5 });
    hazard(g, x0 + 18, yS + ph / 2 - 30, pw - 36, 14, { s: 16, lw: 1.5, off: 16 });
    // 逐字冲压
    const o = { s: 100, w: 900 }, chars = Array.from(TITLE.main), total = textW(g, TITLE.main, o), hot0 = TITLE.main.indexOf(TITLE.hot);
    let x = 960 - total / 2;
    chars.forEach((ch, i) => {
      const cw = textW(g, ch, o), t0 = .62 + i * .055, p = seg(lt, t0, t0 + .14);
      if (p > 0) {
        at(g, x + cw / 2, yS - 4, lerp(1.7, 1, eo(p)), () => text(g, ch, 0, 0, { ...o, c: i >= hot0 ? C.yellow : C.cream, emboss: true }), { al: eo(p) });
        puff(g, x + cw / 2, yS + 52, lt - t0 - .14, 40);
      }
      x += cw;
    });
    // 焊缝：火花沿下划线走过，焊道由白热冷却成钢色
    const wx0 = 960 - total / 2, wx1 = 960 + total / 2, wy = yS + 74, wp = eio(seg(lt, 1.4, 2.3)), hx = lerp(wx0, wx1, wp);
    if (wp > 0) {
      const gr = g.createLinearGradient(wx0, 0, Math.max(wx0 + 1, hx), 0);
      gr.addColorStop(0, C.steel); gr.addColorStop(Math.max(0, 1 - 220 / Math.max(1, hx - wx0)), C.orange); gr.addColorStop(1, '#FFF4D6');
      rr(g, wx0, wy - 5, hx - wx0, 10, 5); g.fillStyle = gr; g.fill();
      for (let xx = wx0 + 6; xx < hx - 4; xx += 12) path(g, [[xx, wy - 4], [xx + 5, wy + 4]], { c: rgba('#000000', .18), w: 2 });
      if (wp < 1) { g.save(); g.shadowColor = '#FFD27A'; g.shadowBlur = 40 * SH(); dot(g, hx, wy, 9, '#FFF8E8'); g.restore(); sparks(g, hx, wy, (lt * 7) % .7, 10, Math.floor(lt * 7)); sparks(g, hx, wy, (lt * 7 + .35) % .7, 8, Math.floor(lt * 7 + .5) + 50); }
    }
    for (const bx of [x0 + 60, x0 + pw - 60]) beacon(g, bx, yS - ph / 2, lt, seg(lt, .7, .9), C.orange, .9);
    // LED 字幕牌：副标题从右滚入
    const lw = 980, lh = 100, ly = 630;
    plate(g, 960 - lw / 2 - 12, ly - lh / 2 - 12, lw + 24, lh + 24, { fill: C.steelD, r: 8, sb: 24, so: 10 });
    g.save(); rr(g, 960 - lw / 2, ly - lh / 2, lw, lh, 4); g.fillStyle = '#0B0E0F'; g.fill(); g.clip();
    for (let i = 0; i < 24; i++) { const ph = (lt * 1.6 + i / 24) % 1; dot(g, 960 - lw / 2 + 30 + i * (lw - 60) / 23, ly, 4, rgba('#FFC24A', (.08 + .25 * Math.max(0, 1 - Math.abs(ph - .5) * 6)) * (1 - seg(lt, 3.2, 3.4)))); }
    const sx = lerp(960 + lw, 960, eo(seg(lt, 3.3, 4.05)));
    text(g, TITLE.sub, sx, ly + 2, { s: 58, w: 900, c: '#FFC24A', glow: 'rgba(255,170,40,.75)', gb: 16, al: seg(lt, 3.3, 3.5) });
    g.fillStyle = 'rgba(0,0,0,.42)';
    for (let yy = ly - lh / 2; yy < ly + lh / 2; yy += 5) g.fillRect(960 - lw / 2, yy + 3.5, lw, 1.5);
    for (let xx = 960 - lw / 2; xx < 960 + lw / 2; xx += 5) g.fillRect(xx + 3.5, ly - lh / 2, 1.5, lh);
    g.restore();
  },
});

/* =====================================================================
 * 第三章 · 第15幕：八个子请求，坏了两个（⚠ 示例：8 个坏 2 个）
 * ===================================================================== */
const ST15 = { beltY: 600, retY: 770, bx0: 860, bx1: 1240, cx: 1050, lift: 60, stop: 328 };
const TUBES = Array.from({ length: 8 }, (_, i) => ST15.cx + (i - 3.5) * 44);
const TUBE = { y0: 204, y1: 412, man: 430, duct: 170 }, DOCK = TUBE.man - 46;
const BACK15 = [2.05, 1.78, 2.95, 2.4, 1.95, 3.3, 2.62, 2.2];   // 各子请求落回的时刻
const FAIL15 = [2, 5];
const QUEUE15 = [[760, 'http', 151], [620, 'hi', 152], [480, 'http', 153]];
/* 胶囊位置与状态：从箱口扇形升到挂架 → 射上云端 → 落回挂架；失败的最后落回箱里 */
function cap15(i, lt) {
  const r0 = .4 + i * .04, up0 = .9 + i * .03, up1 = up0 + .42, b = BACK15[i], fail = FAIL15.includes(i), X = TUBES[i];
  if (lt < r0) return null;
  if (lt < up0) { const p = eo(seg(lt, r0, r0 + .38)); return { x: lerp(ST15.cx + (i - 3.5) * 26, X, p), y: lerp(486, DOCK, p), st: 'go', al: clamp(p * 3) }; }
  if (lt < up1) return { x: X, y: lerp(DOCK, TUBE.y0 - 40, eio(seg(lt, up0, up1))), st: 'go' };
  if (lt < b - .36) return null;
  if (lt < b) return { x: X, y: lerp(TUBE.y0 - 40, DOCK, eio(seg(lt, b - .36, b))), st: fail ? 'fail' : 'ok' };
  if (fail && lt > 6.9) { const j = FAIL15.indexOf(i), k = eio(seg(lt, 6.9, 7.3)); return { x: lerp(X, ST15.cx + (j - .5) * 34, k), y: lerp(DOCK, 505, k), st: 'fail', al: 1 - seg(lt, 7.1, 7.3), landed: lt - b }; }
  return { x: X, y: DOCK, st: fail ? 'fail' : 'ok', landed: lt - b };
}
function stationBench(g, lt, trap) {
  const { bx0, bx1, beltY: y } = ST15, mid = (bx0 + bx1) / 2, hw = 136;
  floorShadow(g, mid, bx1 - bx0 + 40, .45);
  for (const lx of [bx0 + 22, bx1 - 22]) { g.fillStyle = C.steelD; g.fillRect(lx - 10, y + 20, 20, FLOOR - y - 20); path(g, [[lx - 10, y + 20], [lx - 10, FLOOR]], { c: C.ink, w: 2 }); path(g, [[lx + 10, y + 20], [lx + 10, FLOOR]], { c: C.ink, w: 2 }); }
  plate(g, bx0, y, mid - hw - bx0, 24, { fill: C.paint, r: 4, rivets: false, sb: 18, so: 8 });
  plate(g, mid + hw, y, bx1 - mid - hw, 24, { fill: C.paint, r: 4, rivets: false, sb: 18, so: 8 });
  const a = trap * 1.35;
  for (const [px, sgn] of [[mid - hw, 1], [mid + hw, -1]]) {
    g.save(); g.translate(px, y + 4); g.rotate(sgn * a);
    plate(g, sgn > 0 ? 0 : -hw, -4, hw, 22, { fill: C.paintD, r: 3, rivets: false, shadow: false });
    hazard(g, sgn > 0 ? 4 : -hw + 4, 18, hw - 8, 8, { s: 8, lw: 1 });
    g.restore();
  }
  hazard(g, bx0 + 8, y + 24, mid - hw - bx0 - 8, 10, { s: 10, lw: 1.5 });
  hazard(g, mid + hw, y + 24, bx1 - mid - hw - 8, 10, { s: 10, lw: 1.5 });
  // 翻板按钮立柱
  plate(g, 1278, y - 6, 22, FLOOR - y + 6, { fill: C.steelD, r: 3, rivets: false, shadow: false });
  const pressed = seg(lt, 8.42, 8.5) * (1 - seg(lt, 8.8, 8.9));
  plate(g, 1270, y - 18, 38, 14, { fill: C.steel, r: 3, rivets: false, shadow: false });
  g.save(); g.beginPath(); g.ellipse(1289, y - 20 + pressed * 5, 15, 9, 0, Math.PI, 0); g.fillStyle = C.red; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); g.restore();
}
function elevator(g, x, y0, py) { // 回流提升机：两根立轨 + 平台
  for (const dx of [-84, 84]) plate(g, x + dx - 9, y0 - 70, 18, FLOOR - y0 + 70, { fill: C.steelD, r: 3, rivets: false, shadow: false });
  for (let yy = y0 - 50; yy < FLOOR - 40; yy += 46) path(g, [[x - 75, yy], [x + 75, yy + 30]], { c: rgba(C.steelD, .55), w: 4 });
  plate(g, x - 92, py, 184, 14, { fill: C.yellow, r: 3, rivets: false, sb: 10, so: 4 });
  hazard(g, x - 92, py + 14, 184, 8, { s: 8, lw: 1 });
}
function subArrayScreen(g, sx, sy, sw, sh, lt) {
  scrText(g, '子请求数组', sx + 16, sy + 30, { s: 26 });
  const n = Math.round(lerp(8, 2, eo(seg(lt, 5.75, 6.5))));
  scrText(g, `${n} 个`, sx + sw - 16, sy + 30, { s: 26, a: 'right', c: n === 2 ? '#FFB4A8' : '#9FF5D0' });
  const cx = i => sx + 10 + i * 38, cy = sy + 72, cs = 32, comp = eio(seg(lt, 5.75, 6.5));
  for (let i = 0; i < 8; i++) { rr(g, cx(i), cy, cs, cs + 14, 5); g.setLineDash([5, 5]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(159,245,208,.35)'; g.stroke(); g.setLineDash([]); }
  for (let i = 0; i < 8; i++) {
    const b = BACK15[i], fail = FAIL15.includes(i), back = lt >= b, gone = !fail ? eo(seg(lt, 4.45 + i * .1, 4.85 + i * .1)) : 0;
    if (gone >= 1) continue;
    const j = fail ? FAIL15.indexOf(i) : i, x = lerp(cx(i), cx(j), fail ? comp : 0);
    const c = !back ? (Math.floor(lt * 4 + i) % 2 ? '#C99459' : '#7A5A36') : fail ? C.red : C.green;
    at(g, x + cs / 2, cy + (cs + 14) / 2, 1 - gone * .6, () => {
      rr(g, -cs / 2, -(cs + 14) / 2, cs, cs + 14, 5); g.fillStyle = c; g.fill();
      if (back) { if (fail) icCross(g, 0, 0, 16, '#fff', 1, 3.5); else icCheck(g, 0, 1, 16, '#fff', 1, 3.5); }
      if (back && lt - b < .4) { g.save(); g.shadowColor = c; g.shadowBlur = 20 * SH(); rr(g, -cs / 2, -(cs + 14) / 2, cs, cs + 14, 5); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); g.restore(); }
    }, { al: 1 - gone });
  }
  const l1 = lt < 3.4 ? '等待中 · poll' : lt < 7.6 ? '成功 6 · 失败 2' : '重试 +500ms';
  scrText(g, l1, sx + 16, sy + 168, { s: 26, c: lt < 3.4 ? '#9FF5D0' : lt < 7.6 ? '#FFE08A' : '#FFB4A8' });
  scrText(g, lt < 3.4 ? '一轮最多等 1000ms' : '只重发失败的 2 个', sx + 16, sy + 208, { s: 24, c: 'rgba(159,245,208,.75)' });
}
S('s15', {
  demo: true,
  cam: [[0, 1150, 460, 1.2], [3.6, 1150, 420, 1.25], [5.4, 1200, 465, 1.15], [8.2, 1100, 540, 1.1], [10.6, 620, 580, 1.05], [12.5, 540, 570, 1.05]],
  cues: [[.2, 'latch'], [.95, 'whoosh'], ...BACK15.map((b, i) => [b, FAIL15.includes(i) ? 'error' : 'blip', FAIL15.includes(i) ? .8 : .5]), [4.45, 'pop'], [5.8, 'slide'], [7.45, 'latch'], [8.0, 'stamp'], [8.45, 'click'], [8.55, 'clank'], [9.02, 'thud'], [11.05, 'whoosh', .6], [12.2, 'thud', .6]],
  draw(g, lt, sc, frame) {
    const { beltY, retY, cx } = ST15;
    hall(g, frame);
    belt(g, 230, 820, beltY, lt, { v: 90, label: '任务队列', labelDx: 0 });
    const trap = eo(seg(lt, 8.5, 8.7)) * (1 - eo(seg(lt, 9.4, 9.8)));
    stationBench(g, lt, trap);
    belt(g, 150, 1185, retY, lt, { v: -170, legs: false, frame: C.paintD, label: '回流带 · 重试', labelDx: 160 });
    const liftK = eio(seg(lt, 11.05, 11.6));
    elevator(g, ST15.lift, beltY, lerp(retY + 6, beltY + 6, liftK));
    QUEUE15.forEach(([x, kind, no]) => crate(g, x, beltY - 4, { kind, no, w: 124, h: 90, lamp: 'wait' }));
    // poll 仪表
    const pv = lt < 1 ? .1 : lt < 3.5 ? .35 + .3 * Math.sin(lt * 5.3) * Math.sin(lt * 1.7) + .15 * seg(lt, 1, 1.6) : .12;
    gauge(g, 735, 262, 46, pv, { label: 'poll', red: .82 });
    // 父任务箱：在工位 → 压缩变小 → 掉进回流带 → 左行 → 提升 → 排到队尾
    const open = eo(seg(lt, .15, .55)) * (1 - eo(seg(lt, 7.35, 7.75))), shrink = eio(seg(lt, 7.3, 7.8));
    const cw = lerp(250, 160, shrink), chh = lerp(120, 96, shrink);
    let px = cx, py = beltY, sq = shrink > 0 && shrink < 1 ? Math.sin(shrink * Math.PI) * .06 : 0;
    if (lt >= 8.6) { const [k, s] = landing(lt, 8.6, .42); py = lerp(beltY, retY, k); sq = s; }
    if (lt >= 9.05) px = lerp(cx, ST15.lift, eio(seg(lt, 9.05, 11.0)));
    if (lt >= 11.05) py = lerp(retY, beltY, liftK);
    if (lt >= 11.6) { px = lerp(ST15.lift, ST15.stop, eio(seg(lt, 11.6, 12.15))); const a2 = lt - 12.15; sq = a2 > 0 && a2 < .35 ? Math.sin(a2 / .35 * Math.PI) * .1 : 0; }
    bigCrate(g, px, py, { w: cw, h: chh, open, sq, label: shrink < .5 ? '父任务' : '' });
    if (lt > 7.9) timeTag(g, '+500ms', px, py - chh + 4, lt, seg(lt, 7.9, 8.25));
    // 气动管 + 胶囊
    for (const x of TUBES) tubeBack(g, x, TUBE.y0, TUBE.y1);
    g.save(); g.beginPath(); g.rect(TUBES[0] - 200, TUBE.duct + 30, TUBES[7] - TUBES[0] + 400, 600); g.clip();
    TUBES.forEach((_, i) => {
      const c = cap15(i, lt); if (!c) return;
      const fail = FAIL15.includes(i), gone = !fail ? seg(lt, 4.45 + i * .1, 4.8 + i * .1) : 0;
      const land = c.landed != null && c.landed < .3 ? Math.sin(c.landed / .3 * Math.PI) * .15 : 0;
      capsule(g, c.x, c.y, { state: c.st, al: (c.al ?? 1) * (1 - gone), s: 1 - gone * .5, sx: 1 + land, sy: 1 - land, glow: c.st === 'fail' ? .6 + .3 * Math.sin(lt * 9) : c.st === 'ok' && c.landed < .5 ? .7 : 0 });
    });
    g.restore();
    TUBES.forEach((x, i) => { if (!FAIL15.includes(i)) crumble(g, x, DOCK - 6, lt - 4.45 - i * .1, C.green, 14, 80, i * 9); });
    for (const x of TUBES) tubeFront(g, x, TUBE.y0, TUBE.y1, lt);
    manifold(g, TUBES, TUBE.man, lt, { label: 'multi 句柄', lx: TUBES[0] - 150, ly: TUBE.man + 2 });
    cloudDuct(g, TUBES[0] - 60, TUBES[7] + 60, TUBE.duct, lt);
    TUBES.forEach((x, i) => { const k = lt - BACK15[i]; if (k > 0 && k < .5) ring(g, x, DOCK, 20 + 40 * eo(k / .5), FAIL15.includes(i) ? C.red : C.green, 4, 1 - k / .5); });
    if (lt > 4.5 && lt < 6.7) sign(g, '成功的：立刻释放', cx, 320, { s: 26, fill: C.greenD, k: pop(seg(lt, 4.5, 4.85)), al: 1 - seg(lt, 6.4, 6.7) });
    // 机械臂：开盖 → 等待 → 合盖 → 按翻板按钮
    let tgt, grip = .5, state = 'run';
    if (lt < .6) tgt = [lerp(1270, cx + 110, eo(seg(lt, 0, .3))), lerp(430, 468, eo(seg(lt, 0, .3)))];
    else if (lt < 7.2) { const k = eo(seg(lt, .6, 1)); tgt = [lerp(cx + 110, 1300 + wob(lt, .3, 8), k), lerp(468, 372 + wob(lt, .23, 10), k)]; state = lt < 3.4 ? 'wait' : 'run'; }
    else if (lt < 8.2) tgt = [lerp(1300, cx + 70, eo(seg(lt, 7.2, 7.5))), lerp(372, 478, eo(seg(lt, 7.2, 7.5)))];
    else if (lt < 9.2) { const k = eo(seg(lt, 8.2, 8.45)); tgt = [lerp(cx + 70, 1289, k), lerp(478, 556 + 6 * seg(lt, 8.42, 8.5), k)]; grip = .15; }
    else { const k = eo(seg(lt, 9.2, 9.7)); tgt = [lerp(1289, 1270 + wob(lt, .3, 6), k), lerp(556, 430 + wob(lt, .25, 8), k)]; }
    robot(g, 1395, FLOOR, tgt, lt, { state, grip });
    cabinet(g, 1500, 300, 360, 440, lt, (gg, sx, sy, sw, sh) => subArrayScreen(gg, sx, sy, sw, sh, lt), { sh: 250 });
  },
});

/* =====================================================================
 * 第四章 · 第20幕：闸门落下（⚠ 900ms 已放慢）
 * ===================================================================== */
const ST20 = { beltY: 620, gateX: 900, head: 1440, bx: 1730 };
const BEHIND20 = [[1.8, 726, 140], [2.55, 584, 141], [3.3, 442, 142]]; // 闸门后：出发时刻、停靠位置、编号
const TOTE20 = { t0: 4.95, stop: 300, no: 143 };
const arrive20 = (t0, stop) => t0 + (stop + 250) / 420;
function pick20(lt, t0, x0) { // 机械臂取件：抬起 → 送进工位（出画）
  const k1 = eo(seg(lt, t0, t0 + .35)), k2 = eio(seg(lt, t0 + .45, t0 + 1.05));
  return { x: lerp(x0, 1980, k2), y: lerp(ST20.beltY - 4, ST20.beltY - 114, k1) - 40 * Math.sin(k2 * Math.PI), al: 1 - seg(lt, t0 + .8, t0 + 1.05) };
}
S('s20', {
  demo: true, scaled: true,
  cam: [[0, 1000, 470, 1.12], [1.0, 980, 470, 1.12], [3.0, 860, 480, 1.22], [5.4, 760, 480, 1.18], [7.6, 720, 430, 1.1], [9.6, 1000, 440, 1.1], [12.5, 1150, 460, 1.15]],
  cues: [[1.2, 'latch'], [1.82, 'clank'], ...BEHIND20.map(([t0, stop]) => [arrive20(t0, stop), 'thud', .7]), [arrive20(TOTE20.t0, TOTE20.stop), 'thud', .5], [7.15, 'latch'], [7.95, 'whoosh'], [9.75, 'thud', .6], [11.15, 'confirm', .6]],
  draw(g, lt, sc, frame) {
    const { beltY, gateX, head } = ST20, down = seg(lt, 1.5, 1.82) ** 2;
    hall(g, frame);
    rejectBin(g, -170, FLOOR, lt, { w: 150, h: 120 });
    belt(g, -420, 1560, beltY, lt, { v: 120, label: '任务队列', labelDx: 580 });
    // 扫码门：箱子经过时闪一下
    const xs = BEHIND20.map(([t0]) => -250 + (lt - t0) * 420).concat([-250 + (lt - TOTE20.t0) * 420]);
    const flash = Math.max(0, ...xs.map(x => 1 - Math.abs(x - 60) / 90));
    scanner(g, 60, beltY, lt, { label: '扫码门', flash, flashC: C.cyan });
    // 闸门（门架、闸板）
    const bounce = lt > 1.82 && lt < 2.2 ? -Math.sin((lt - 1.82) / .38 * Math.PI) * 10 * (1 - (lt - 1.82) / .38) : 0;
    gate(g, gateX, beltY, down, lt, { label: '同步屏障', span: 170, h: 190, bounce, alarm: down > .5 ? 1 : 0 });
    // 屏障块：随队尾进场，到位后升进门架，变成闸板
    if (lt < 1.75) {
      const x = lerp(500, gateX, eo(seg(lt, 0, 1.2))), up = eio(seg(lt, 1.25, 1.6));
      crate(g, x, beltY - 4 - up * 130, { kind: 'barrier', w: 120, h: 80, no: 139, al: 1 - seg(lt, 1.45, 1.7) });
    }
    if (lt > 1.82) puff(g, gateX, beltY - 8, lt - 1.82, 90);
    // 闸门前的箱子：继续前进，被工位取走
    let armT = [head + 150, 470], armG = .5, state = 'run';
    if (lt < .55) crate(g, head, beltY - 4, { kind: 'http', no: 137, w: 124, h: 90 });
    else { const p = pick20(lt, .55, head); if (p.al > 0) { crate(g, p.x, p.y, { kind: 'http', no: 137, w: 124, h: 90, al: p.al, lamp: 'ok' }); if (lt < 1.6) { armT = [p.x, p.y - 104]; armG = .15; } } }
    if (lt < 2.6) crate(g, Math.min(head, 1215 + Math.max(0, lt - .7) * 140), beltY - 4, { kind: 'hi', no: 138, w: 124, h: 90 });
    else { const p = pick20(lt, 2.6, head); if (p.al > 0) { crate(g, p.x, p.y, { kind: 'hi', no: 138, w: 124, h: 90, al: p.al, lamp: 'ok' }); if (lt < 3.65) { armT = [p.x, p.y - 104]; armG = .15; } } }
    if (lt > 1.6 && lt < 2.45) armT = [lerp(head + 60, head, eo(seg(lt, 1.6, 2.4))), lerp(440, 512, eo(seg(lt, 1.6, 2.4)))];
    // 闸门后的网络任务：一只只挤上来（挤压回弹），亮红灯
    BEHIND20.forEach(([t0, stop, no]) => {
      if (lt < t0) return;
      const a = lt - arrive20(t0, stop), x = Math.min(stop, -250 + (lt - t0) * 420);
      const sq = a > 0 && a < .4 ? -Math.sin(a / .4 * Math.PI) * .12 * (1 - a / .4) : 0;
      crate(g, x, beltY - 4, { kind: 'http', no, w: 124, h: 90, sq, lamp: a > 0 ? 'fail' : null });
    });
    if (lt > 4.6 && lt < 7.7) sign(g, '闸门后的网络任务：都在等', 600, 340, { s: 24, fill: C.ink2, bar: C.red, k: pop(seg(lt, 4.6, 4.95)), al: 1 - seg(lt, 7.4, 7.7) });
    // 本地任务：被吊车从闸门上方吊到前面
    const T = TOTE20, ta = arrive20(T.t0, T.stop);
    let tx = Math.min(T.stop, -250 + Math.max(0, lt - T.t0) * 420), ty = beltY - 4;
    const trolleyX = lt < 5.4 ? 1360 : lt < 6.6 ? lerp(1360, T.stop, eio(seg(lt, 5.4, 6.6))) : lt < 7.95 ? T.stop : lt < 9.3 ? lerp(T.stop, 1250, eio(seg(lt, 7.95, 9.3))) : 1250;
    const hookTop = 230, hookLow = beltY - 4 - 76 - 12 - 26;
    let hookY = hookTop;
    if (lt > 6.6 && lt < 7.15) hookY = lerp(hookTop, hookLow, eio(seg(lt, 6.6, 7.1)));
    else if (lt >= 7.15 && lt < 7.95) hookY = lerp(hookLow, hookTop, eio(seg(lt, 7.4, 7.9)));
    else if (lt >= 9.3 && lt < 9.8) hookY = lerp(hookTop, hookLow, eio(seg(lt, 9.3, 9.75)));
    else if (lt >= 9.8 && lt < 10.6) hookY = lerp(hookLow, hookTop, eio(seg(lt, 10.0, 10.5)));
    const moving = lt > 7.95 && lt < 9.3, swing = moving ? -Math.sin(seg(lt, 7.95, 9.3) * Math.PI) * 22 : lt >= 9.3 && lt < 9.9 ? Math.sin((lt - 9.3) * 9) * 8 * (1 - (lt - 9.3) / .6) : 0;
    const hook = crane(g, -300, 1700, trolleyX, hookY, lt, { swing });
    const carried = lt >= 7.15 && lt < 9.8;
    if (carried) { tx = hook[0]; ty = hook[1] + 76 + 14; }
    if (lt >= 9.8) { tx = Math.min(head, 1250 + Math.max(0, lt - 10.0) * 240); ty = beltY - 4; }
    let toteAl = 1;
    if (lt >= 11.05) { const p = pick20(lt, 11.05, head); tx = p.x; ty = p.y; toteAl = p.al; if (lt < 12.1) { armT = [p.x, p.y - 90]; armG = .15; } }
    else if (lt > 10.2) armT = [lerp(head + 150, head, eo(seg(lt, 10.2, 11.0))), lerp(470, 528, eo(seg(lt, 10.2, 11.0)))];
    if (lt >= T.t0 && toteAl > 0) crate(g, tx, ty, { kind: 'local', no: T.no, w: 120, h: 76, al: toteAl, rot: carried ? swing * .004 : 0, lamp: lt > ta && lt < 7.15 ? 'ok' : null, glow: lt > 7.1 && lt < 9.9 ? .55 : 0, glowC: C.green });
    if (lt > ta && lt < 7.5) sign(g, '本地任务：不受屏障影响', T.stop + 60, 702, { s: 24, fill: C.greenD, k: pop(seg(lt, ta, ta + .35)), al: 1 - seg(lt, 7.2, 7.5) });
    // 倒计时表（放慢显示）
    const ms = Math.max(0, Math.round(900 - clamp((lt - 1.82) / 10.68) * 820));
    gauge(g, gateX + 160, 452, 44, lt < 1.82 ? 0 : 1 - ms / 900, { read: String(lt < 1.82 ? 900 : ms), label: '剩余 ms', k: pop(seg(lt, 1.85, 2.2)) });
    // 工位：闸门前的活干完后，等待（黄灯）
    if (lt > 3.65 && lt < 10.2) { armT = [head + 150 + wob(lt, .2, 6), 470 + wob(lt, .27, 8)]; state = 'wait'; }
    robot(g, ST20.bx, FLOOR, armT, lt, { state, grip: armG });
  },
});

film.finish();
