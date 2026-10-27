/* =====================================================================
 * 把任务队列改成网络线程池 —— 编排（字幕数据在 script.js，风格图元在 kit.js）
 * 镜头：每幕 cam 关键帧 [[t, cx, cy, z]]；后墙按镜头做 0.25 视差（kit.js drawBackground）。
 * 章节：0 开场、1 片名、2–6 五章、7 总结、8 结尾、9 片尾（配乐脚本按此划段）。
 * 样片阶段：ONLY 列出已实现的幕；SAMPLE_OPT 给样片里的幕加章节卷帘和前置留白（lead 秒）。
 * 全片时把 ONLY 置为 null、SAMPLE_OPT 置为 {}，逐幕补齐 S(...) 即可。
 * ===================================================================== */
'use strict';
const ONLY = null;
const SAMPLE_OPT = {};

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
CARD[9] = ['END', SERIES.title, SERIES.sub, C.yellow];
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
  drawChrome, drawCaptionBackground, drawCaption, drawCover: (g, f) => drawCover(g, f),
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
  if (num === 'END') {
    text(g, zh, 960, o + 480, { s: 120, w: 900, emboss: true });
    text(g, en, 960, o + 600, { s: 44, w: 900, c: col, emboss: true });
  } else {
  g.save(); g.globalAlpha *= .92;
  text(g, num, 470, o + 505, { f: 'disp', w: 900, s: 300, c: col, emboss: true });
  g.restore();
  path(g, [[700, o + 395], [700, o + 615]], { c: rgba(C.cream, .35), w: 4 });
  text(g, zh, 742, o + 482, { s: 104, w: 900, a: 'left', emboss: true });
  text(g, en, 748, o + 578, { f: 'mono', s: 30, w: 700, ls: 8, c: rgba(C.cream, .78), a: 'left' });
  }
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
  const cd = CARD[sc.card]; if (!cd || (lt > 2.0 && sc.card !== 9)) return;
  const b = Math.min(lt, .3) / .3;
  let yb = H - Math.abs(Math.sin(b * Math.PI)) * 22 * (1 - b);
  if (sc.card !== 9) yb -= (H + 120) * eio(seg(lt, 1.42, 1.95));
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

/* ---------------- 场景注册：S() 只登记定义，文件末尾按 SCRIPT 顺序统一注册 ---------------- */
const DEFS = {};
const CARD_AT = { s03: 2, s07: 3, s12: 4, s19: 5, s23: 6, s26: 7, s30: 9 };
function S(id, o) { DEFS[id] = o; }
let lastChapter = -1;
function register(id, o) {
  const d = SCRIPT[id], ov = { card: CARD_AT[id], ...(SAMPLE_OPT[id] || {}) }, lead = ov.lead || 0;
  if (d.chapter !== lastChapter) { film.chapter(d.chapter, ...CHAPTERS[d.chapter]); lastChapter = d.chapter; }
  return film.addScene({
    ...o, ...ov, id, chapter: d.chapter, dur: d.dur + lead, pre: 0, post: 0,
    cam: o.cam && o.cam.map(([t, ...r]) => [t + lead, ...r]),
    captions: d.caps.map(([t, end, text]) => ({ t: t + lead, end: end + lead, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t: t + lead, type, v: v ?? 1 })).concat(ov.card ? [{ t: 0, type: 'shutter', v: 1 }].concat(ov.card !== 9 ? [{ t: 1.42, type: 'whoosh', v: .5 }] : []) : []),
    draw: (g, lt, sc, frame) => o.draw(g, lt - lead, sc, frame),
  });
}

/* =====================================================================
 * 开场 · 第1幕：布局一变，要拉三到五趟（手机 → 智能屏 → 云端；最后推进屏幕内部，看见那条旧流水线）
 * ===================================================================== */
const A01 = { phone: [330, 500], scr: [930, 470], cloud: [1560, 430], door: [1560, 470] };
const PIPE01 = [[1392, 330], [1220, 330], [1170, 380], [1132, 380]];
const SLIPS01 = [['布局设置', 4.5, 120, C.cyan], ['设备详情', 5.5, 40, C.yellow], ['场景列表', 5.68, 150, C.green], ['设备规格', 5.86, 260, C.orange], ['订阅', 6.04, 370, C.blue]];
const ZIN = 4.5;
function arcAt(a, b, u, lift) { const m = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift], v = 1 - u; return [v * v * a[0] + 2 * v * u * m[0] + u * u * b[0], v * v * a[1] + 2 * v * u * m[1] + u * u * b[1]]; }
/* 旧流水线（屏端系统服务内部）：一根管子，一次一个 */
function oldLine(g, lt, frame, o = {}) {
  hall(g, frame);
  belt(g, 120, 1150, 620, lt, { v: 80, label: '任务队列', labelDx: -120 });
  bench(g, 1180, 1460, 620);
  const labs = ['订阅', '规格', '场景', '详情'];
  const shift = eio(seg(lt, 13.9, 14.6)) * 140;
  labs.forEach((lb, i) => crate(g, 440 + i * 160 + shift, 616, { kind: 'http', label: lb, w: 124, h: 90, no: 104 - i, lamp: 'wait' }));
  // 当前在工位上的箱子：布局；13.8 后离开，下一只（详情）上工位
  const outK = eio(seg(lt, 13.8, 14.4));
  crate(g, 1320 + outK * 520, 616 - Math.sin(outK * Math.PI) * 60, { kind: 'http', label: '布局', w: 124, h: 90, no: 100, lamp: lt > 13.6 ? 'ok' : 'wait', al: 1 - seg(lt, 14.2, 14.4) });
  if (lt > 14.4) crate(g, lerp(1080, 1320, eio(seg(lt, 14.4, 15.0))), 616, { kind: 'http', label: '详情', w: 124, h: 90, no: 101 });
  // 单根管子 + 云端风管
  tubeBack(g, 1320, 214, 500);
  const cyc = t0 => { const up = seg(lt, t0, t0 + .4), dn = seg(lt, t0 + 1.8, t0 + 2.2); return lt < t0 ? null : up < 1 ? lerp(470, 170, eio(up)) : dn <= 0 ? null : dn < 1 ? lerp(170, 470, eio(dn)) : lt < t0 + 2.6 ? 470 : null; };
  for (const t0 of [11.3, 15.2]) { const y = cyc(t0); if (y != null) capsule(g, 1320, y, { state: y >= 470 && lt > t0 + 2.2 ? 'ok' : 'go' }); }
  tubeFront(g, 1320, 214, 500, lt);
  plate(g, 1280, 500, 80, 26, { fill: C.steel, r: 5, rivets: false });
  cloudDuct(g, 1150, 1490, 180, lt, { label: '云端 HTTP 接口' });
  const waiting = (lt > 11.7 && lt < 13.1) || (lt > 15.6 && lt < 17);
  robot(g, 1640, FLOOR, [1420 + wob(lt, .3, 6), 470 + wob(lt, .25, 6)], lt, { state: waiting ? 'wait' : 'run' });
  stopwatch(g, 1640, 330, 46, ((lt - 11.7) % 3.9) / 1.4 * TAU, { sweep: true, al: waiting ? 1 : .35 });
  if (lt > 12.0) sign(g, '一次只发一个', 1320, 560, { s: 24, fill: C.redD, k: pop(seg(lt, 12.0, 12.35)), rivets: false });
  sign(g, '屏端系统服务', 300, 230, { s: 30, fill: C.ink2, bar: C.cyan });
  if (lt > 14.1) at(g, 780, 400, pop(seg(lt, 14.1, 14.5)) * (1 + .04 * Math.sin(lt * 5)), () => { dot(g, 0, 0, 62, C.yellow); ring(g, 0, 0, 62, C.ink, 4); text(g, '?', 0, 6, { f: 'disp', s: 92, w: 900, c: C.ink }); }, { rot: wob(lt, .5, .08) });
}
S('s01', {
  fi: .6,
  cam: [[0, 640, 470, 1.18], [3.4, 760, 460, 1.08], [4.4, 1020, 420, 1.06], [6.8, 1040, 410, 1.06], [7.6, 1260, 380, 1.55], [10.3, 1230, 390, 1.5], [11.2, 930, 470, ZIN], [17, 932, 468, ZIN * 1.03]],
  cues: [[.5, 'tick', .5], [2.6, 'tick', .6], [2.8, 'send', .5], [3.6, 'whoosh', .6], [4.3, 'bell', .6], ...SLIPS01.map(([, t]) => [t, 'send', .5]), [8.55, 'thud'], [8.65, 'error'], [9.4, 'alarm', .5], [10.4, 'swell'], [11.3, 'send', .5], [12.0, 'tick', .4], [14.1, 'pop']],
  draw(g, lt, sc, frame) {
    const inner = seg(lt, 10.55, 11.0);
    if (inner < 1) {
      g.save(); g.globalAlpha *= 1 - inner;
      hall(g, frame);
      // 手机：拖动卡片 → 同步到云端
      phone(g, ...A01.phone, 1, lt, { drag: { from: 0, to: 3, p: seg(lt, .4, 2.5) }, label: '手机 App' });
      if (lt > 2.7 && lt < 3.8) { const a = [A01.phone[0] + 60, A01.phone[1] - 240], b = [A01.cloud[0] - 60, A01.cloud[1] - 230], u = eio(seg(lt, 2.7, 3.5));
        const pts = Array.from({ length: 30 }, (_, i) => arcAt(a, b, i / 29, 180)); path(g, partial(pts, u), { c: rgba(C.cyan, .7), w: 4, dash: [10, 12], off: -lt * 40, al: 1 - seg(lt, 3.5, 3.8) });
        const p = arcAt(a, b, u, 180); dot(g, p[0], p[1], 9, C.cyan, 1 - seg(lt, 3.5, 3.8)); }
      cloudHouse(g, ...A01.cloud, 1, lt);
      pushPipe(g, PIPE01, lt, { collar: .3, hot: seg(lt, 8.5, 8.7) * (1 - seg(lt, 9.8, 10.3)), ly: -62 });
      // 推送：小胶囊“布局变化”顺管而下
      if (lt > 3.6 && lt < 4.4) { const q = partial(PIPE01, eio(seg(lt, 3.6, 4.3))), p = q[q.length - 1]; capsule(g, p[0], p[1], { s: .7, rot: Math.PI / 2, glow: .6 }); }
      smartScreen(g, ...A01.scr, 1, lt, { label: '某智能屏', hi: lt > 4.3 && lt < 5 ? 3 : null });
      if (lt > 4.3 && lt < 5.2) ring(g, A01.scr[0], A01.scr[1], 210 + 80 * eo(seg(lt, 4.3, 5.2)), C.cyan, 4, 1 - seg(lt, 4.3, 5.2));
      // 一串工单飞向云端
      SLIPS01.forEach(([s, t0, lift, c]) => {
        if (lt < t0 || lt > t0 + 1.6) return;
        const u = eio(seg(lt, t0, t0 + 1.1)), p = arcAt([A01.scr[0] + 120, A01.scr[1] - 90], [A01.door[0] - 40, A01.door[1] - 10], u, lift);
        slip(g, p[0], p[1], s, { c, k: 1.15 + .15 * Math.sin(u * Math.PI), al: 1 - seg(lt, t0 + 1.1, t0 + 1.6), rot: (u - .5) * .2 });
      });
      // 布局数据箱挤不进推送管
      if (lt > 7.2) {
        const inK = eio(seg(lt, 7.3, 8.5)), back = eio(seg(lt, 8.75, 9.4)), x = lerp(1440, 1302, inK) + back * 70, [, sq] = landing(lt, 8.1, .4);
        crate(g, x, 300, { kind: 'http', label: '布局数据', w: 150, h: 104, sq: lt > 8.5 && lt < 8.9 ? .1 * Math.sin((lt - 8.5) / .4 * Math.PI) : 0, al: seg(lt, 7.2, 7.5), lamp: lt > 8.6 ? 'fail' : null });
        if (lt > 8.6) stamp(g, '装不下', x + 10, 214, lt - 8.6, { c: C.red, s: 30 });
        if (lt > 8.55) sparks(g, 1236, 330, lt - 8.55, 12, 3);
      }
      g.restore();
    }
    if (inner > 0) {
      // 推进到屏幕内部：内部世界缩小 ZIN 倍画在屏幕位置，镜头推到 ZIN 时正好铺满
      g.save();
      const [sx, sy] = A01.scr;
      if (inner < 1) { const ex = lerp(1, 1.25, inner); g.beginPath(); g.rect(sx - 176 * ex, sy - 108 * ex, 352 * ex, 216 * ex); g.clip(); g.globalAlpha *= inner; }
      g.translate(sx, sy); g.scale(1.2 / ZIN, 1.2 / ZIN); g.translate(-900, -500);
      const z0 = CAMZ; CAMZ = z0 * 1.2 / ZIN;
      oldLine(g, lt, frame);
      CAMZ = z0; g.restore();
    }
  },
});

/* =====================================================================
 * 片尾 · 第30幕：卷帘门落下，门上喷涂系列名
 * ===================================================================== */
S('s30', { title: true, fo: .5, draw(g, lt, sc, frame) { hall(g, frame); } });

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  const fr = { ...frame, t: 3, lt: 3, sc: { cam: [[0, 960, 540, 1]] } };
  drawBackground(g, fr);
  g.save(); g.translate(960, 640); g.scale(1.05, 1.05); g.translate(-1050, -520);
  hall(g, fr);
  belt(g, 120, 820, 600, 0, { v: 0 });
  [[300, 'http', 151], [440, 'local', 152], [580, 'hi', 153], [720, 'http', 154]].forEach(([x, kind, no]) => crate(g, x, 596, { kind, no, w: 124, h: kind === 'local' ? 76 : 90 }));
  gate(g, 510, 600, 1, 0, { span: 150, h: 190, alarm: 1 });
  bench(g, 860, 1240, 600);
  bigCrate(g, 1050, 600, { w: 250, h: 120, open: 1, label: '父任务' });
  for (const x of TUBES) tubeBack(g, x, TUBE.y0, TUBE.y1);
  TUBES.forEach((x, i) => capsule(g, x, DOCK - (i % 3) * 60, { state: i === 2 || i === 5 ? 'fail' : 'ok', glow: .5 }));
  for (const x of TUBES) tubeFront(g, x, TUBE.y0, TUBE.y1, 1);
  manifold(g, TUBES, TUBE.man, 0, {});
  cloudDuct(g, TUBES[0] - 60, TUBES[7] + 60, TUBE.duct, 0);
  robot(g, 1395, FLOOR, [1300, 380], 0, { state: 'run' });
  g.restore();
  g.save(); const vg = g.createLinearGradient(0, 0, 0, 420); vg.addColorStop(0, 'rgba(10,14,16,.85)'); vg.addColorStop(1, 'rgba(10,14,16,0)'); g.fillStyle = vg; g.fillRect(0, 0, W, 420); g.restore();
  text(g, '一个工位，同时等八个请求', 960, 150, { s: 120, w: 900, emboss: true });
  text(g, '接手一条任务队列，改成网络线程池', 960, 268, { s: 50, w: 900, c: C.yellow, emboss: true });
  postFX(g, { ...frame, t: 0 });
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
 * 第一章 · 推送只当门铃
 * ===================================================================== */
/* 第3幕：4KB 的管口——12×6 卡片网格的数据箱，两次测算都超，挤不进推送管 */
function gridCrate(g, x, y, lit, o = {}) { // 大数据箱：正面 12×6 网格，lit = 已点亮格数
  const w = 270, h = 176;
  crate(g, x, y, { kind: 'http', w, h, label: '', sq: o.sq, lamp: o.lamp });
  const gx = x - w / 2 + 22, gy = y - h + 26, cw = (w - 44) / 12, ch = (h - 60) / 6;
  for (let c = 0; c < 12; c++) for (let r = 0; r < 6; r++) {
    const i = c * 6 + r, on = i < lit;
    rr(g, gx + c * cw + 2, gy + r * ch + 2, cw - 4, ch - 4, 3); g.fillStyle = on ? (r % 2 ? C.cyan : C.yellow) : 'rgba(0,0,0,.18)'; g.fill();
  }
  text(g, '布局数据', x, y - 18, { s: 24, w: 900, c: '#3A2410' });
}
S('s03', {
  cam: [[0, 900, 470, 1.15], [9.4, 900, 470, 1.15], [10.6, 1060, 470, 1.25], [13.5, 1030, 470, 1.2]],
  cues: [[1.8, 'tick', .4], [3.2, 'tick', .4], [5.8, 'scan', .6], [7.8, 'tick', .7], [9.7, 'belt', .6], [10.6, 'thud'], [10.65, 'error'], [11.0, 'alarm', .5], [11.8, 'stamp']],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 120, 1200, 620, lt, { v: 60 });
    scaleMeter(g, 560, 606, lt < 5.8 ? '0.00 KB' : lt < 7.8 ? (4.62 * eo(seg(lt, 5.8, 7.0))).toFixed(2) + ' KB' : '6.17 KB', { label: '序列化后大小', c: lt > 7.8 ? '#FFB4A8' : '#7CFFB2' });
    if (lt > 7.8) sign(g, '另一次测算', 815, 450, { s: 24, fill: C.ink2, bar: C.yellow, k: pop(seg(lt, 7.8, 8.15)), rivets: false, al: 1 - seg(lt, 9.3, 9.6) });
    if (lt > 6.9 && lt < 7.8) sign(g, '第一次测算', 815, 450, { s: 24, fill: C.ink2, bar: C.cyan, k: pop(seg(lt, 6.9, 7.2)), al: 1 - seg(lt, 7.6, 7.8), rivets: false });
    // 推送管：从右侧伸进来，管口卡环
    const hot = seg(lt, 10.55, 10.7) * (1 - seg(lt, 12.6, 13.3));
    pushPipe(g, [[2300, 548], [1262, 548]], lt, { w: 64, collar: 1, hot, ly: -96 });
    sign(g, '云端推送通道', 1590, 450, { s: 26, fill: C.ink2, bar: C.cyan });
    gauge(g, 1420, 380, 44, .2 + .75 * seg(lt, 10.55, 10.9) * (1 - .6 * seg(lt, 12.4, 13.4)), { label: '压力', red: .75 });
    if (lt > 11.0) sign(g, '发送失败', 1262, 700, { s: 28, fill: C.redD, c: '#fff', k: pop(seg(lt, 11.0, 11.35)), rivets: false });
    // 数据箱：网格逐格点亮 → 推向管口 → 弹回
    const lit = Math.floor(72 * seg(lt, 1.7, 4.6));
    const go = eio(seg(lt, 9.7, 10.6)), back = eo(seg(lt, 10.75, 11.5));
    const x = lerp(560, 1100, go) - back * 140, sq = lt > 10.6 && lt < 11.0 ? Math.sin((lt - 10.6) / .4 * Math.PI) * .1 : 0;
    gridCrate(g, x, 602, lit, { sq, lamp: lt > 10.6 ? 'fail' : null });
    if (lt > 2.0) sign(g, '12 页 →', x - 40, 380, { s: 24, fill: C.ink2, bar: C.yellow, k: pop(seg(lt, 2.0, 2.3)), rivets: false, al: 1 - seg(lt, 9.3, 9.6) });
    if (lt > 2.5) sign(g, '每页 6 张', x - 250, 510, { s: 24, fill: C.ink2, bar: C.cyan, k: pop(seg(lt, 2.5, 2.8)), rivets: false, al: 1 - seg(lt, 9.3, 9.6) });
    if (lt > 10.6) sparks(g, 1240, 548, lt - 10.6, 16, 5);
    if (lt > 11.8) stamp(g, '超过 4KB', x + 20, 520, lt - 11.8, { c: C.red, s: 32 });
  },
});

/* 第4幕：推送只当门铃——小胶囊敲响门铃，屏端自己去云端拉 */
const SCR04 = [620, 450], BELL04 = [900, 330], DOOR04 = [1500, 470];
const PIPE04 = [[1332, 260], [960, 260], [912, 232]];
function fetch04(g, lt, t0, s, c, lift, kind, slot) { // 工单飞去 → 箱子飞回
  if (lt < t0) return;
  if (lt < t0 + 1.2) { const u = eio(seg(lt, t0, t0 + 1.0)), p = arcAt([SCR04[0] + 150, SCR04[1] - 100], [DOOR04[0] - 40, DOOR04[1] - 20], u, lift); slip(g, p[0], p[1], s, { c, al: 1 - seg(lt, t0 + .95, t0 + 1.2) }); }
  if (lt > t0 + 1.2) { const u = eio(seg(lt, t0 + 1.2, t0 + 2.1)), tx = 470 + slot * 150, p = arcAt([DOOR04[0] - 60, DOOR04[1] + 40], [tx, 716], u, 60); const [, sq] = landing(lt, t0 + 2.1, .01); crate(g, p[0], p[1], { kind: 'http', label: kind, w: 120, h: 84, sq }); }
}
S('s04', {
  cam: [[0, 960, 450, 1.1], [12.5, 980, 450, 1.06]],
  cues: [[.4, 'whoosh', .6], [1.7, 'bell'], [4.4, 'send', .5], [6.5, 'thud', .5], [8.6, 'scan', .5], [10.0, 'send', .5], [10.15, 'send', .5], [12.2, 'thud', .5]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    cloudHouse(g, 1500, 430, 1, lt);
    pushPipe(g, PIPE04, lt, { collar: .3, ly: -60 });
    if (lt > .4 && lt < 1.75) { const q = partial(PIPE04, eio(seg(lt, .4, 1.6))), p = q[q.length - 1]; capsule(g, p[0], p[1], { s: .7, rot: Math.PI / 2, glow: .6 }); }
    doorBell(g, ...BELL04, 1, lt - 1.7);
    if (lt > 2.0) sign(g, '推送 = 门铃：只说“变了”', BELL04[0] + 10, 170, { s: 24, fill: C.ink2, bar: C.yellow, k: pop(seg(lt, 2.0, 2.35)) });
    smartScreen(g, ...SCR04, 1, lt, { label: '屏端', hi: lt > 1.7 && lt < 3 ? 1 : null });
    belt(g, 400, 940, 720, lt, { v: 50, legs: true, legGap: 220 });
    if (lt > 4.6) sign(g, '数据：自己去云端拉', 1180, 640, { s: 24, fill: C.ink2, bar: C.cyan, k: pop(seg(lt, 4.6, 4.95)) });
    fetch04(g, lt, 4.4, '布局设置', C.cyan, 200, '布局', 0);
    // 比对：本地 vs 新布局，新增的 id 高亮
    if (lt > 8.5) {
      const k = eo(seg(lt, 8.5, 8.9));
      cabinet(g, 90, 160, 300, 380, lt, (gg, sx, sy, sw, sh) => {
        scrText(gg, '本地', sx + 20, sy + 28, { s: 24 }); scrText(gg, '新布局', sx + 150, sy + 28, { s: 24 });
        ['d1', 'd2', 's1'].forEach((s, i) => scrText(gg, s, sx + 30, sy + 74 + i * 40, { f: 'mono', s: 26, c: '#C8E8D8' }));
        ['d1', 'd2', 'd3', 's1', 's2'].forEach((s, i) => { const nw = s === 'd3' || s === 's2'; scrText(gg, (nw ? '+' : ' ') + s, sx + 150, sy + 74 + i * 40, { f: 'mono', s: 26, c: nw ? '#FFE08A' : '#C8E8D8', al: nw ? seg(lt, 9.2 + (s === 's2') * .3, 9.5 + (s === 's2') * .3) : 1 }); });
      }, { sh: 280, legs: false, fill: C.paintD });
      void k;
    }
    fetch04(g, lt, 10.0, '设备详情', C.yellow, 150, '详情', 1);
    fetch04(g, lt, 10.15, '场景列表', C.green, 250, '场景', 2);
  },
});

/* 第5幕：逐台串行 vs 拉布局后并行分叉（⚠ 时间长短为示意） */
S('s05', {
  demo: true,
  cam: [[0, 900, 520, 1.08], [12.5, 900, 520, 1.1]],
  cues: [[.5, 'tick', .5], [1.2, 'tick', .5], [1.9, 'tick', .5], [2.6, 'tick', .5], [3.3, 'tick', .5], [4.4, 'tick', .6], [5.4, 'whoosh', .7], [6.8, 'confirm', .5], [8.8, 'down', .6], [10.0, 'down', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    // 上：逐台串行
    sign(g, '上一代接口：按设备逐台串行', 420, 200, { s: 26, fill: C.ink2, bar: C.red });
    belt(g, 160, 1240, 380, lt, { v: 70, legs: false });
    gate(g, 760, 380, 0, lt, { span: 120, h: 150, alarm: 0, base: 440 });
    const serial = [.3, 1.0, 1.7, 2.4, 3.1];
    const started = serial.filter(s => lt >= s).length;
    serial.forEach((t0, i) => {
      if (lt < t0) crate(g, 640 - (i - started) * 104, 376, { kind: 'http', label: '设备', w: 92, h: 66 });
      else crate(g, lerp(640, 1120, eio(seg(lt, t0, t0 + .7))), 376, { kind: 'http', label: '设备', w: 92, h: 66, al: 1 - seg(lt, t0 + .6, t0 + .8) });
    });
    const segs = serial.map((_, i) => ({ w: 150, c: i % 2 ? C.kraftL : C.kraft, label: '设备' + (i + 1) }));
    timeBar(g, 300, 470, segs, seg(lt, .3, 3.8), { maxW: 750 });
    if (lt > 8.6) sign(g, '耗时一节节叠加', 1180, 470, { s: 24, fill: C.redD, c: '#fff', k: pop(seg(lt, 8.6, 8.95)), rivets: false });
    gauge(g, 1450, 300, 54, lerp(.85, .42, eio(seg(lt, 8.8, 10.8))), { label: '整体成功率', red: .5 });
    // 下：先拉布局，再并行分叉
    sign(g, '这一代：先拉布局，再并行分叉', 900, 590, { s: 26, fill: C.ink2, bar: C.green });
    belt(g, 160, 600, 720, lt, { v: 70, legs: false });
    gate(g, 470, 720, 0, lt, { span: 120, h: 150, alarm: 0, base: 780 });
    crate(g, lt < 4.4 ? 330 : lerp(330, 620, eio(seg(lt, 4.4, 5.2))), 716, { kind: 'http', label: '布局', w: 100, h: 70, al: 1 - seg(lt, 5.2, 5.4) });
    ['详情', '场景', '规格'].forEach((lb, i) => {
      const y = 660 + i * 62, k = eio(seg(lt, 5.4, 6.5));
      if (lt > 5.3) { path(g, [[640, 716], [740, y], [1180, y]], { c: rgba(C.green, .35), w: 4, dash: [8, 10], off: -lt * 30 }); slip(g, lerp(700, 1100, k), y, lb, { c: [C.yellow, C.green, C.orange][i], al: 1 - seg(lt, 6.5, 6.8) * .5 }); }
    });
    timeBar(g, 300, 842, [{ w: 150, c: C.kraft, label: '布局' }, { w: 180, c: C.green, label: '并行' }], seg(lt, 4.4, 6.6), { maxW: 750 });
    if (lt > 6.8) sign(g, '界面可以刷新了', 820, 842, { s: 24, fill: C.greenD, k: pop(seg(lt, 6.8, 7.1)), rivets: false });
  },
});

/* 第6幕：我接手的那条队列——亮灯、三件套铭牌、空着的安装位 */
const TAGS06 = [['多路请求', 1], ['同步屏障', 1], ['分包重试', 0], ['查重拒收', 0]];
S('s06', {
  cam: [[0, 960, 460, 1.0], [4, 820, 450, 1.08], [8, 1120, 430, 1.12], [16, 1080, 440, 1.08]],
  cues: [[.4, 'clank', .6], [.9, 'clank', .6], [1.4, 'clank', .6], [4.3, 'blip'], [5.4, 'blip'], [6.5, 'blip'], [8.3, 'tick'], [8.9, 'tick'], [9.5, 'tick'], [10.1, 'tick'], [12.6, 'stamp', .7], [13.3, 'stamp', .7], [14.0, 'stamp', .7], [14.7, 'stamp', .7]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 150, 1000, 620, lt, { v: 70 });
    [[360, 121], [500, 122], [640, 123], [780, 124]].forEach(([x, no]) => crate(g, x, 616, { kind: 'http', no, w: 124, h: 90, lamp: 'wait' }));
    bench(g, 1040, 1320, 620);
    crate(g, 1180, 616, { kind: 'http', no: 120, w: 124, h: 90 });
    // 旧发射架：一根管子 + 空安装位（灰签 = 后来才装上的）
    tubeBack(g, 1180, 214, 470); tubeFront(g, 1180, 214, 470, lt);
    plate(g, 860, 470, 640, 26, { fill: C.steelD, r: 5, sb: 12, so: 5 });
    plate(g, 1150, 460, 60, 20, { fill: C.steel, r: 4, rivets: false, shadow: false });
    TAGS06.forEach(([s, hot], i) => {
      const x = [930, 1060, 1300, 1430][i];
      ring(g, x, 470, 18, rgba(C.dim, .6), 3); g.save(); g.setLineDash([6, 6]); ring(g, x, 470, 24, hot && lt > 8.3 ? rgba(C.red, .8) : rgba(C.dim, .4), 2); g.restore();
      const t0 = 8.3 + i * .6, ta = 12.6 + i * .7;
      if (lt > t0) {
        timeTag(g, s, x, 486, lt, seg(lt, t0, t0 + .3), { fill: lt > ta ? C.yellow : '#9AA3A6' });
        if (lt > ta) stamp(g, '我加的', x, 590, lt - ta, { c: C.yellow, s: 24, rot: -.08 + i * .05 });
      }
    });
    cloudDuct(g, 880, 1480, 180, lt);
    robot(g, 1600, FLOOR, [1450 + wob(lt, .3, 6), 400 + wob(lt, .25, 8)], lt, { state: 'run' });
    // 地基铭牌：接手时就有的三件套
    if (lt > 4.1) {
      const k = pop(seg(lt, 4.1, 4.45));
      at(g, 420, 330, k, () => {
        plate(g, -230, -120, 460, 250, { fill: '#33403F', r: 10, sb: 30, so: 12 });
        text(g, '接手时就有', 0, -84, { s: 26, w: 900, c: C.yellow, emboss: true });
        [['任务队列', C.cyan, 4.3], ['互斥锁', C.yellow, 5.4], ['条件变量：没活就睡，来活叫醒', C.green, 6.5]].forEach(([s, c, t0], i) => {
          const a = seg(lt, t0, t0 + .3); if (a <= 0) return;
          lampDot(g, -196, -28 + i * 58, 9, c, a); text(g, s, -176, -27 + i * 58, { s: 24, w: 900, a: 'left', al: a, emboss: true });
        });
      });
    }
    if (lt < 1.8) { // 开灯：整幅从暗到亮，带一点闪烁
      const d = (1 - seg(lt, 0, 1.6)) * (hash(Math.floor(lt * 12)) > .3 ? 1 : .6);
      screenSpaceDark(g, d * .78);
    }
  },
});
function screenSpaceDark(g, a) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = a; g.fillStyle = '#05080A'; g.fillRect(0, 0, 99999, 99999); g.restore(); }


/* =====================================================================
 * 第二章 · 一个工位，多路并发
 * ===================================================================== */
function ceilRobot(g, x, ceilY, tgt, lt, o = {}) { // 倒挂机械臂：以地面线与天花板的中线做镜像
  const c = (FLOOR + ceilY) / 2;
  g.save(); g.translate(0, 2 * c); g.scale(1, -1);
  robot(g, x, FLOOR, [tgt[0], 2 * c - tgt[1]], lt, { ...o, label: false });
  g.restore();
}
/* 第7幕：为什么只要一个工位（⚠ 多线程对照为演绎） */
S('s07', {
  demo: true,
  cam: [[0, 960, 470, 1.1], [5.6, 960, 470, 1.1], [6.7, 960, 520, 1.22], [9.6, 960, 480, 1.1], [13.5, 980, 470, 1.12]],
  cues: [[2.0, 'click', .5], [3.4, 'click', .5], [4.8, 'click', .5], [6.0, 'whoosh', .6], [6.6, 'error'], [7.0, 'latch'], [7.4, 'latch'], [7.8, 'latch'], [8.2, 'latch'], [10.0, 'pop'], [10.6, 'confirm']],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 120, 640, 620, lt, { v: 60 });
    [[260, 211], [400, 212], [540, 213]].forEach(([x, no]) => crate(g, x, 616, { kind: 'http', no, w: 124, h: 90 }));
    const multi = seg(lt, 5.7, 6.1) * (1 - seg(lt, 9.7, 10.3));
    const clash = lt > 6.3 && lt < 9.8;
    const opens = [0, 1, 2].map(i => { const t0 = 2.0 + i * 1.4; return lt < 5.6 ? eo(seg(lt, t0, t0 + .5)) * (1 - eo(seg(lt, t0 + .9, t0 + 1.2))) : 0; });
    if (clash) opens[1] = .25 + .05 * Math.sin(lt * 30);
    const locks = [0, 1, 2].map(i => seg(lt, 7.0 + i * .4, 7.35 + i * .4) * (1 - seg(lt, 9.8, 10.3)));
    dataCabinet(g, 960, FLOOR, lt, { open: opens, locks, hot: clash ? 1 : null });
    if (locks[2] > 0) [[860, 560], [1060, 640], [900, 760], [1050, 780]].forEach(([x, y], i) => padlock(g, x, y, .6 * pop(seg(lt, 8.2 + i * .15, 8.5 + i * .15)) * (1 - seg(lt, 9.8, 10.3)), i % 2 ? C.orange : C.yellow));
    // 唯一的 worker：依次开抽屉；对照段里大家一起伸手
    const drawer = i => [960 + 30 + opens[i] * 70, FLOOR - 360 + 26 + i * 108 + 46];
    let tgt = [1150, 470];
    if (lt < 5.6) { const i = Math.min(2, Math.max(0, Math.floor((lt - 2.0) / 1.4))); tgt = lt > 1.8 ? drawer(i) : [1180, 440]; }
    else if (clash) tgt = [1010 + 10 * Math.sin(lt * 23), 586];
    robot(g, 1330, FLOOR, tgt, lt, { state: 'run' });
    if (multi > 0) {
      g.save(); g.globalAlpha *= multi;
      robot(g, 640, FLOOR, clash ? [915 + 10 * Math.sin(lt * 19), 590] : [760, 470], lt, { label: '线程 B', state: 'run' });
      ceilRobot(g, 960, 120, clash ? [965 + 8 * Math.sin(lt * 17), 560] : [960, 420], lt, { state: 'run' });
      g.restore();
      if (lt > 6.6 && lt < 9.8) { sparks(g, 975, 590, (lt - 6.6) % .7, 14, Math.floor((lt - 6.6) / .7)); }
      if (lt > 6.0) sign(g, '对照：几个线程一起改', 520, 300, { s: 26, fill: C.redD, c: '#fff', k: pop(seg(lt, 6.0, 6.35)), al: multi });
      if (lt > 8.4) sign(g, '锁散在各处，越加越多', 1400, 330, { s: 24, fill: C.ink2, bar: C.red, k: pop(seg(lt, 8.4, 8.75)), al: multi });
    }
    if (lt > 10.4) sign(g, '排队执行：有序 → 线程安全', 960, 330, { s: 28, fill: C.greenD, k: pop(seg(lt, 10.4, 10.8)) });
    if (lt > 1.9 && lt < 5.7) sign(g, '所有云端数据的读写：只在这里', 1420, 330, { s: 24, fill: C.ink2, bar: C.cyan, k: pop(seg(lt, 1.9, 2.25)), al: 1 - seg(lt, 5.4, 5.7) });
  },
});

/* 第8幕：别的线程，也得排队——被栏杆挡下，改成投一只本地任务 */
S('s08', {
  cam: [[0, 820, 470, 1.06], [4.2, 920, 470, 1.06], [8.4, 1240, 470, 1.1], [12.5, 1290, 470, 1.12]],
  cues: [[.3, 'belt', .5], [1.7, 'latch'], [2.1, 'thud'], [2.2, 'error', .6], [4.5, 'pop'], [5.8, 'thud', .6], [8.7, 'click', .6], [9.6, 'click', .6], [10.4, 'confirm', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    // 侧门
    plate(g, 120, FLOOR - 330, 260, 330, { fill: '#1A2225', r: 6, sb: 20, so: 8 });
    rr(g, 140, FLOOR - 310, 220, 310, 4); g.fillStyle = '#0B1012'; g.fill();
    hazard(g, 120, FLOOR - 350, 260, 20, { s: 14, lw: 1.5 });
    belt(g, 660, 1220, 620, lt, { v: 90 });
    bench(g, 1250, 1480, 620);
    dataCabinet(g, 1790, FLOOR, lt, { open: [0, eo(seg(lt, 9.6, 10.1)) * (1 - eo(seg(lt, 11.0, 11.4))), 0], hot: lt > 9.6 && lt < 11.4 ? 1 : null });
    // 推车：开到栏杆前被挡住
    const cx = lerp(250, 520, eio(seg(lt, .3, 1.8))) - eo(seg(lt, 2.1, 2.6)) * 40;
    cart(g, cx, FLOOR, lt, { label: '其他线程', v: lt < 1.8 ? 180 : 0 });
    // 栏杆（摆臂）
    const arm = eo(seg(lt, 1.5, 1.9));
    plate(g, 600, FLOOR - 170, 26, 170, { fill: C.steelD, r: 4, rivets: false });
    g.save(); g.translate(613, FLOOR - 160); g.rotate(-Math.PI / 2 * (1 - arm)); hazard(g, 0, -10, 260, 20, { s: 14, r: 6, c1: C.red, c2: '#F4EDDF' }); g.restore();
    if (lt > 1.9) sign(g, '不能直接改共享数据', 760, 560, { s: 24, fill: C.redD, c: '#fff', k: pop(seg(lt, 1.9, 2.25)), al: 1 - seg(lt, 7.8, 8.2), rivets: false });
    // 本地任务：从推车里装箱 → 上传送带 → 到工位
    let tx = cx, ty = FLOOR - 92, al = 1;
    if (lt > 4.4) {
      const up = eio(seg(lt, 4.5, 5.0)), mv = eio(seg(lt, 5.0, 5.8)), ride = eio(seg(lt, 5.9, 7.6));
      tx = lerp(cx, 720, mv) + ride * 640; ty = lerp(FLOOR - 92 - up * 120, 616, mv);
      if (lt > 8.6) al = 1 - seg(lt, 9.0, 9.4);
      crate(g, tx, ty, { kind: 'local', w: 120, h: 76, al, glow: lt > 4.5 && lt < 5.2 ? .6 : 0, glowC: C.green });
      if (lt > 4.6) sign(g, '打包成本地任务，投进队列', 900, 470, { s: 24, fill: C.greenD, k: pop(seg(lt, 4.6, 4.95)), al: 1 - seg(lt, 8.2, 8.5) });
    }
    // worker：取出本地任务，替它改数据
    let tgt = [1500, 440];
    if (lt > 8.4 && lt < 9.4) tgt = [lerp(1500, 1360, eo(seg(lt, 8.4, 8.8))), lerp(440, 530, eo(seg(lt, 8.4, 8.8)))];
    else if (lt >= 9.4 && lt < 11.4) tgt = [lerp(1360, 1840, eo(seg(lt, 9.4, 9.8))), lerp(530, FLOOR - 360 + 26 + 108 + 46, eo(seg(lt, 9.4, 9.8)))];
    robot(g, 1590, FLOOR, tgt, lt, { state: 'run' });
    if (lt > 10.4) sign(g, '数据只在一个地方被改', 1790, 400, { s: 26, fill: C.greenD, k: pop(seg(lt, 10.4, 10.75)) });
  },
});

/* 第9幕：一个工位，只能干等？（⚠ 时间为示意） */
const REQ09 = [[.6, 3.4], [4.4, 5.0], [5.2, 5.8], [6.0, 6.6], [6.8, 7.4]];
S('s09', {
  demo: true,
  cam: [[0, 900, 470, 1.1], [12.5, 930, 460, 1.12]],
  cues: [...REQ09.map(([a]) => [a, 'send', .5]), ...REQ09.map(([, b]) => [b, 'blip', .5]), [8.7, 'whoosh'], [9.8, 'clank'], [10.2, 'stamp', .7]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 160, 860, 620, lt, { v: 60 });
    const done = REQ09.filter(([, b]) => lt > b + .3).length;
    for (let i = 0; i < 5 - done; i++) crate(g, 760 - i * 140, 616, { kind: 'http', no: 301 + done + i, w: 124, h: 90, lamp: 'wait' });
    bench(g, 900, 1180, 620);
    const swap = seg(lt, 8.6, 9.0);
    if (swap < 1) {
      g.save(); g.globalAlpha *= 1 - swap;
      tubeBack(g, 1040, 214, 500);
      REQ09.forEach(([a, b]) => { if (lt < a || lt > b + .3) return; const up = seg(lt, a, a + .35), dn = seg(lt, b - .35, b); const y = up < 1 ? lerp(480, 170, eio(up)) : dn <= 0 ? null : lerp(170, 480, eio(dn)); if (y != null) capsule(g, 1040, y, { state: dn >= 1 ? 'ok' : 'go' }); });
      tubeFront(g, 1040, 214, 500, lt);
      g.restore();
    }
    if (lt > 8.6) { // 新发射架从上方吊下来
      const k = eio(seg(lt, 8.7, 9.8)), dy = (1 - k) * -420;
      g.save(); g.translate(0, dy);
      const xs = Array.from({ length: 8 }, (_, i) => 1040 + (i - 3.5) * 44);
      for (const x of xs) tubeBack(g, x, 214, 412);
      for (const x of xs) tubeFront(g, x, 214, 412, lt);
      manifold(g, xs, 430, lt, {});
      path(g, [[xs[0] - 40, 430], [xs[0] - 40, -300]], { c: C.ink, w: 3, al: 1 - seg(lt, 9.8, 10.2) }); path(g, [[xs[7] + 40, 430], [xs[7] + 40, -300]], { c: C.ink, w: 3, al: 1 - seg(lt, 9.8, 10.2) });
      g.restore();
      if (lt > 9.8) { sparks(g, 900, 440, lt - 9.8, 14, 2); sparks(g, 1180, 440, lt - 9.8, 14, 7); puff(g, 1040, 446, lt - 9.8, 160); }
      if (lt > 10.2) sign(g, 'curl multi', 1040, 540, { f: 'mono', s: 30, fill: C.ink2, bar: C.cyan, k: pop(seg(lt, 10.2, 10.55)) });
    }
    cloudDuct(g, 840, 1240, 180, lt);
    const waiting = REQ09.some(([a, b]) => lt > a + .35 && lt < b - .35);
    robot(g, 1330, FLOOR, [1210 + wob(lt, .3, 6), 450 + wob(lt, .25, 6)], lt, { state: waiting ? 'wait' : 'run' });
    const w0 = lt < 1 ? 0 : lt < 3.4 ? (lt - 1) / 2.4 : 1;
    stopwatch(g, 1400, 300, 46, (lt > 4.4 ? (lt - 4.4) % .8 / .8 : w0) * TAU, { sweep: true, al: waiting ? 1 : .4 });
    // 等待时间条：一段段相加
    const segs = REQ09.map(([a, b], i) => ({ w: 190, c: i % 2 ? C.kraftL : C.kraft, label: '等' + (i + 1) }));
    const grown = REQ09.reduce((acc, [a, b]) => acc + clamp((lt - a - .35) / (b - a - .7)), 0);
    timeBar(g, 300, 780, segs, grown / 5, { maxW: 950 });
    if (lt > 7.5) sign(g, '等待叠加', 1350, 780, { s: 24, fill: C.redD, c: '#fff', k: pop(seg(lt, 7.5, 7.85)), rivets: false, al: 1 - seg(lt, 8.6, 9.0) });
  },
});

/* 第10幕：一个 poll，同时等所有请求（⚠ 时间条为示意） */
const BACK10 = [5.6, 6.1, 6.6, 7.0, 7.6];
S('s10', {
  demo: true,
  cam: [[0, 1100, 450, 1.15], [4.2, 1080, 420, 1.2], [8.4, 900, 450, 1.08], [12.5, 880, 450, 1.1]],
  cues: [...[0, 1, 2, 3, 4].map(i => [.5 + i * .3, 'latch', .6]), [4.4, 'clank', .7], [4.5, 'whoosh'], ...BACK10.map(b => [b, 'blip', .6]), [8.6, 'tick', .5], [9.6, 'swoosh', .7]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    stationBench(g, -1, 0);
    bigCrate(g, ST15.cx, ST15.beltY, { w: 250, h: 120, open: eo(seg(lt, .2, .5)), label: '父任务' });
    for (const x of TUBES) tubeBack(g, x, TUBE.y0, TUBE.y1);
    g.save(); g.beginPath(); g.rect(TUBES[0] - 200, TUBE.duct + 30, TUBES[7] - TUBES[0] + 400, 600); g.clip();
    for (let i = 0; i < 5; i++) {
      const x = TUBES[i + 1], t0 = .5 + i * .3, b = BACK10[i];
      let y = null, st = 'go';
      if (lt > t0 && lt < 4.5) y = lerp(486, DOCK, eo(seg(lt, t0, t0 + .3)));
      else if (lt >= 4.5 && lt < 4.95) y = lerp(DOCK, TUBE.y0 - 40, eio(seg(lt, 4.5, 4.92)));
      else if (lt >= b - .36) { y = lerp(TUBE.y0 - 40, DOCK, eio(seg(lt, b - .36, b))); st = lt >= b ? 'ok' : 'go'; }
      if (y != null) capsule(g, lt < 4.5 ? lerp(ST15.cx + (i - 2) * 30, x, eo(seg(lt, t0, t0 + .3))) : x, y, { state: st, glow: st === 'ok' && lt - b < .5 ? .7 : 0 });
    }
    g.restore();
    for (const x of TUBES) tubeFront(g, x, TUBE.y0, TUBE.y1, lt);
    manifold(g, TUBES, TUBE.man, lt, { label: 'multi 句柄', lx: TUBES[0] - 150, ly: TUBE.man + 2 });
    if (lt > .4 && lt < 4.4) { g.save(); g.shadowColor = C.cyan; g.shadowBlur = 30 * SH(); rr(g, TUBES[0] - 50, TUBE.man - 16, TUBES[7] - TUBES[0] + 100, 32, 6); g.lineWidth = 3; g.strokeStyle = rgba(C.cyan, .5 + .3 * Math.sin(lt * 6)); g.stroke(); g.restore(); }
    cloudDuct(g, TUBES[0] - 60, TUBES[7] + 60, TUBE.duct, lt);
    const pv = lt < 4.5 ? .1 : lt < 7.8 ? .4 + .3 * Math.sin(lt * 5.1) * Math.sin(lt * 1.9) : .12;
    gauge(g, 735, 262, 46, pv, { label: 'poll：一起等', red: .82 });
    let tgt = lt < .4 ? [1290, 420] : lt < 2.0 ? [ST15.cx + 60 + 20 * Math.sin(lt * 6), 470] : lt < 4.3 ? [1290, 400] : lt < 4.8 ? [1238, 440] : [1300 + wob(lt, .3, 6), 380];
    robot(g, 1395, FLOOR, tgt, lt, { state: lt > 4.9 && lt < 7.6 ? 'wait' : 'run' });
    // 左侧屏：相加 vs 取最长
    cabinet(g, 90, 440, 620, 330, lt, (gg, sx, sy, sw, sh) => {
      scrText(gg, '挨个发：等待相加', sx + 16, sy + 30, { s: 24 });
      const W5 = [90, 110, 80, 120, 100]; let xx = sx + 16, p = seg(lt, 8.6, 9.4) * 500;
      W5.forEach((w, i) => { const ww = clamp(p / w) * w; p -= w; if (ww > 0) { rr(gg, xx, sy + 54, ww - 3, 30, 5); gg.fillStyle = i % 2 ? '#C99459' : '#E3B67E'; gg.fill(); } xx += w; });
      scrText(gg, '一起等：取最长那一个', sx + 16, sy + 120, { s: 24, c: '#9FF5D0', al: seg(lt, 9.5, 9.8) });
      const q = eio(seg(lt, 9.6, 10.3));
      W5.forEach((w, i) => { if (q <= 0) return; rr(gg, sx + 16, sy + 144 + i * 4, w * q, 30, 5); gg.fillStyle = rgba(C.green, .35 + (w === 120) * .5); gg.fill(); });
    }, { sh: 210, legs: false });
  },
});

/* 第11幕：共用的挂架，每轮都要摘干净；成功 = curl 成功且 HTTP 200 */
const HOOK11 = [640, 800, 960, 1120, 1280];
S('s11', {
  cam: [[0, 960, 450, 1.08], [8.4, 960, 460, 1.08], [12.5, 960, 470, 1.12]],
  cues: [[.6, 'blip'], ...HOOK11.map((_, i) => [4.4 + i * .55, 'tick', .7]), [7.1, 'error', .7], [8.9, 'stamp'], [9.7, 'stamp'], [10.3, 'confirm'], [11.2, 'stamp'], [11.7, 'error', .7]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    const rackA = 1 - seg(lt, 8.3, 8.7);
    if (rackA > 0) {
      g.save(); g.globalAlpha *= rackA;
      plate(g, 500, 300, 920, 40, { fill: C.steelD, r: 8, sb: 20, so: 8 });
      if (lt > .5 && lt < 4.4) { g.save(); g.shadowColor = C.cyan; g.shadowBlur = 30 * SH(); rr(g, 500, 300, 920, 40, 8); g.lineWidth = 3; g.strokeStyle = rgba(C.cyan, .6 + .3 * Math.sin(lt * 6)); g.stroke(); g.restore(); }
      sign(g, 'multi 句柄 · 全局只有一个', 960, 250, { s: 28, fill: C.ink2, bar: C.cyan });
      HOOK11.forEach((x, i) => {
        g.save(); g.lineWidth = 6; g.strokeStyle = C.steelL; g.beginPath(); g.moveTo(x, 340); g.lineTo(x, 372); g.arc(x + 10, 372, 10, Math.PI, Math.PI * .1, true); g.stroke(); g.restore();
        const t0 = 4.4 + i * .55, k = eio(seg(lt, t0, t0 + .5));
        if (k < 1) capsule(g, lerp(x + 6, 1560, k), 420 - Math.sin(k * Math.PI) * 80, { state: 'ok', s: 1.3, al: 1 - seg(lt, t0 + .35, t0 + .5) });
        if (lt > t0 && lt < t0 + .4) ring(g, x + 6, 420, 20 + 40 * eo((lt - t0) / .4), C.green, 4, 1 - (lt - t0) / .4);
      });
      if (lt > 4.5) sign(g, '每轮结束：逐个摘下', 960, 540, { s: 26, fill: C.greenD, k: pop(seg(lt, 4.5, 4.85)) });
      // 对照小窗：忘摘的旧句柄缠住下一轮
      if (lt > 6.8) {
        const k = pop(seg(lt, 6.8, 7.1));
        at(g, 1560, 640, k, () => {
          plate(g, -190, -110, 380, 220, { fill: '#2A3133', r: 10, sb: 24, so: 10 });
          text(g, '忘摘的话', 0, -78, { s: 24, w: 900, c: C.red, emboss: true });
          plate(g, -150, -40, 300, 18, { fill: C.steelD, r: 4, rivets: false, shadow: false });
          capsule(g, -80, 10, { state: 'fail', s: .9, glow: .6 });
          capsule(g, 0, 10, { state: 'go', s: .9 }); capsule(g, 70, 10, { state: 'go', s: .9 });
          path(g, [[-80, 40], [-20, 60], [40, 30], [90, 60]], { c: C.red, w: 4 });
          text(g, '污染下一轮', 0, 84, { s: 24, w: 900, c: C.red });
        });
      }
      robot(g, 1600, FLOOR, lt > 4.3 && lt < 7.3 ? [HOOK11[Math.min(4, Math.floor((lt - 4.3) / .55))] + 20, 410] : [1450, 420], lt, { state: 'run' });
      g.restore();
    }
    // 检验台：两枚章都盖上才算成功
    if (lt > 8.4) {
      const a = seg(lt, 8.4, 8.8);
      g.save(); g.globalAlpha *= a;
      bench(g, 560, 1360, 620);
      capsule(g, 760, 500, { state: lt > 10.3 ? 'ok' : 'go', s: 2.4, glow: lt > 10.3 ? .6 : 0 });
      stamp(g, 'curl 成功', 640, 330, lt - 8.9, { c: C.green, s: 28, rot: -.1 });
      stamp(g, 'HTTP 200', 880, 330, lt - 9.7, { c: C.green, s: 28, rot: .08 });
      if (lt > 10.3) sign(g, '成功', 760, 680, { s: 28, fill: C.greenD, k: pop(seg(lt, 10.3, 10.6)), rivets: false });
      if (lt > 10.8) {
        const b = seg(lt, 10.8, 11.1);
        capsule(g, 1160, 500, { state: lt > 11.7 ? 'fail' : 'go', s: 2.4, al: b, glow: lt > 11.7 ? .6 : 0 });
        stamp(g, 'curl 成功', 1040, 330, lt - 11.2, { c: C.green, s: 28, rot: -.1 });
        stamp(g, 'HTTP 500', 1280, 330, lt - 11.7, { c: C.red, s: 28, rot: .08 });
        if (lt > 11.7) sign(g, '不算成功', 1160, 680, { s: 28, fill: C.redD, c: '#fff', k: pop(seg(lt, 11.7, 12.0)), rivets: false });
      }
      g.restore();
    }
  },
});


/* =====================================================================
 * 第三章 · 大单拆箱，坏件返修（第12–14、16–18幕；第15幕见后）
 * ===================================================================== */
/* 第12幕：72 张卡片，一单装不下 */
function inlet(g, x, y0, y1, label, c, lt) { // 墙上的收货口
  rr(g, x - 8, y0 - 8, 30, y1 - y0 + 16, 4); g.fillStyle = '#0A0E10'; g.fill();
  hazard(g, x - 22, y0 - 22, 44, 16, { s: 10, lw: 1.5 }); hazard(g, x - 22, y1 + 6, 44, 16, { s: 10, lw: 1.5 });
  sign(g, label, x + 200, y0 - 40, { s: 24, fill: C.ink2, bar: c, rivets: false });
}
S('s12', {
  cam: [[0, 880, 480, 1.04], [9.6, 920, 480, 1.06], [13.5, 900, 480, 1.08]],
  cues: [[1.8, 'belt', .6], [4.6, 'tick', .5], [7.8, 'thud'], [7.85, 'error'], [8.8, 'confirm', .6], [10.0, 'chop', .5], [10.4, 'chop', .5], [11.0, 'pop']],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    // 云端外墙
    plate(g, 1350, 200, 600, FLOOR - 200, { fill: '#38484E', r: 6, sb: 30, so: 0 });
    for (let yy = 230; yy < FLOOR; yy += 36) path(g, [[1360, yy], [1950, yy]], { c: rgba('#000000', .22), w: 3 });
    sign(g, '云端接口', 1640, 240, { s: 28, fill: C.ink2, bar: C.cyan });
    belt(g, -200, 1350, 470, lt, { v: 80, legs: false });
    belt(g, -200, 1350, 760, lt, { v: 80, legs: false });
    for (const x of [100, 500, 900, 1250]) { plate(g, x - 8, 500, 16, 230, { fill: C.steelD, r: 3, rivets: false, shadow: false }); }
    inlet(g, 1350, 330, 462, '场景接口：建议 ≤ 50', C.yellow, lt);
    inlet(g, 1350, 640, 752, '设备接口：限 50', C.cyan, lt);
    // 72 张场景卡的长箱
    const go = eio(seg(lt, 1.7, 4.4)), push = eio(seg(lt, 6.4, 7.8)), bk = eo(seg(lt, 7.9, 8.5));
    const x = lerp(-500, 820, go) + push * 260 - bk * 60, n = Math.round(72 * seg(lt, 2.4, 4.6));
    crate(g, x, 466, { kind: 'http', w: 540, h: 172, label: '场景列表', sq: lt > 7.8 && lt < 8.2 ? Math.sin((lt - 7.8) / .4 * Math.PI) * .06 : 0, lamp: lt > 7.8 ? 'fail' : null });
    for (let i = 0; i < 72; i++) { const cx = x - 120 + (i % 24) * 15, cy = 466 - 140 + Math.floor(i / 24) * 26; rr(g, cx, cy, 11, 20, 2); g.fillStyle = i < n ? C.yellow : 'rgba(0,0,0,.15)'; g.fill(); }
    text(g, String(n), x + 200, 466 - 60, { f: 'disp', s: 72, w: 900, c: '#3A2410' });
    if (lt > 7.8) sparks(g, 1340, 400, lt - 7.8, 14, 4);
    // 设备箱：48 < 50，顺利通过
    const dx = lerp(-300, 1500, eio(seg(lt, 5.8, 9.0)));
    crate(g, dx, 756, { kind: 'http', w: 300, h: 100, label: '设备 × 48', lamp: lt > 8.6 ? 'ok' : null, al: 1 - seg(lt, 9.0, 9.3) });
    if (lt > 8.8) sign(g, '48 < 50：一次拉完', 1100, 600, { s: 24, fill: C.greenD, k: pop(seg(lt, 8.8, 9.1)), rivets: false });
    // 切口预告
    if (lt > 9.9) {
      for (const [k, t0] of [[1 / 3, 10.0], [2 / 3, 10.4]]) { const cx = x - 270 + 540 * k; path(g, partial([[cx, 466 - 190], [cx, 476]], eo(seg(lt, t0, t0 + .35))), { c: C.red, w: 4, dash: [12, 8] }); }
      sign(g, '拆成几个子请求', x, 230, { s: 26, fill: C.redD, c: '#fff', k: pop(seg(lt, 11.0, 11.35)) });
    }
  },
});

/* 第13幕：公共参数 + 变长列表，切块拼头 */
const CUT13 = [1000, 1250];
S('s13', {
  cam: [[0, 900, 460, 1.1], [4.2, 1000, 460, 1.1], [8.4, 1120, 430, 1.06], [12.5, 1150, 430, 1.08]],
  cues: [[.3, 'latch', .6], [.9, 'whoosh', .6], [1.2, 'slide', .6], [4.6, 'chop'], [5.6, 'chop'], [6.4, 'stamp', .7], [6.7, 'stamp', .7], [7.0, 'stamp', .7], [8.8, 'latch', .6], [9.0, 'latch', .6], [9.2, 'latch', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    bench(g, 420, 1560, 640);
    const fade = 1 - seg(lt, 2.6, 3.0);
    if (fade > 0) bigCrate(g, 620, 640, { w: 280, h: 130, open: eo(seg(lt, .3, .7)), label: '请求', al: fade });
    // 公共参数铭牌（铜色）
    const hk = eio(seg(lt, .8, 1.6)), hx = lerp(620, 560, hk), hy = lerp(560, 330, hk);
    const header = (x, y, s = 1, al = 1) => at(g, x, y, s, () => { plate(g, -110, -26, 220, 52, { fill: '#B87333', r: 6, rivets: true, sb: 14, so: 5 }); text(g, '公共参数', 0, 2, { s: 24, w: 900, c: '#2A1608' }); }, { al });
    if (lt > .8) { header(hx, hy); if (lt > 1.6) sign(g, '鉴权等，每个子请求都带', hx, hy - 70, { s: 24, fill: C.ink2, bar: '#B87333', k: pop(seg(lt, 1.6, 1.9)), al: 1 - seg(lt, 8.0, 8.4) }); }
    // id 纸带：展开 → 切两刀 → 分成三块
    const un = eio(seg(lt, .9, 2.6)), x0 = 760, x1 = lerp(780, 1500, un), spread = eo(seg(lt, 5.8, 6.3)) * 30;
    if (lt > .9 && lt < 8.2) {
      const al = 1 - seg(lt, 7.6, 8.2);
      g.save(); g.globalAlpha *= al;
      if (lt < 4.6) idTape(g, x0, x1, 520, Math.max(1, Math.round(72 * un)), { label: lt > 2.0 ? '变长列表：72 个 id' : '' });
      else {
        const parts = [[x0, CUT13[0]], [CUT13[0], CUT13[1]], [CUT13[1], 1500]].filter((_, i) => i < (lt < 5.6 ? 2 : 3));
        if (lt < 5.6) parts[1] = [CUT13[0], 1500];
        parts.forEach(([a, b], i) => idTape(g, a + i * spread - spread, b + i * spread - spread - 6, 520, Math.round((b - a) / 10)));
      }
      g.restore();
    }
    // 切刀
    const chop = t0 => Math.max(0, 1 - Math.abs(lt - t0) / .18);
    for (const [i, cx] of CUT13.entries()) { const t0 = 4.6 + i; if (lt < t0 - .6 || lt > t0 + .6) continue; const d = chop(t0); plate(g, cx - 6, 380 + d * 110, 12, 90, { fill: C.steelL, r: 2, rivets: false }); plate(g, cx - 30, 360 + d * 110, 60, 26, { fill: C.steelD, r: 4, rivets: false }); if (lt > t0) sparks(g, cx, 520, lt - t0, 8, i * 3, '#FFFFFF'); }
    // 每块压上同一块铭牌的复制品 → 变成子请求胶囊 → 进发射架
    const mids = [(x0 + CUT13[0]) / 2 - spread, (CUT13[0] + CUT13[1]) / 2, (CUT13[1] + 1500) / 2 + spread];
    mids.forEach((mx, i) => {
      const t0 = 6.4 + i * .3;
      if (lt > t0 - .4 && lt < 8.2) { const k = eio(seg(lt, t0 - .4, t0)); header(lerp(hx, mx, k), lerp(hy, 470, k), .6, 1 - seg(lt, 7.6, 8.2)); }
      if (lt > 7.6) {
        const k = eio(seg(lt, 7.8 + i * .2, 8.6 + i * .2)), dock = [1380 + i * 44, 330];
        capsule(g, lerp(mx, dock[0], k), lerp(500, dock[1], k) - Math.sin(k * Math.PI) * 80, { state: 'go', s: 1 + (1 - k) * .4, al: seg(lt, 7.6, 7.9) });
      }
    });
    // 发射架：8 个位，上限 8
    const xs = Array.from({ length: 8 }, (_, i) => 1380 + i * 44);
    if (lt > 7.6) {
      const a = seg(lt, 7.6, 8.0);
      g.save(); g.globalAlpha *= a;
      manifold(g, xs, 380, lt, {});
      xs.forEach((x, i) => { if (i >= 3 || lt < 8.6 + i * .2) { g.save(); g.setLineDash([5, 5]); rr(g, x - 15, 301, 30, 58, 12); g.lineWidth = 2; g.strokeStyle = rgba(C.cream, .35); g.stroke(); g.restore(); } });
      sign(g, '一个父任务：最多 8 个子请求', 1534, 230, { s: 26, fill: C.ink2, bar: C.yellow, k: pop(seg(lt, 9.0, 9.35)) });
      g.restore();
    }
  },
});

/* 第14幕：抽象工厂——业务只交两样东西 */
const CODE14 = [
  'struct param_factory {',
  '    json_t *(*common)(void);  /* 每个子请求都带 */',
  '    list_t *(*items)(void);   /* 可以切开的列表 */',
  '};',
  '/* 管理层：items 切块 → 拼上 common → 子请求 */',
];
function hopper(g, x, y, label, fill, lt) {
  poly(g, [[x - 110, y - 80], [x + 110, y - 80], [x + 34, y + 30], [x - 34, y + 30]], C.steelD, { lw: 3 });
  poly(g, [[x - 110, y - 80], [x + 110, y - 80], [x + 98, y - 62], [x - 98, y - 62]], C.steel, { lw: 2 });
  if (fill > 0) { g.save(); g.beginPath(); g.moveTo(x - 90, y - 62); g.lineTo(x + 90, y - 62); g.lineTo(x + 34, y + 28); g.lineTo(x - 34, y + 28); g.closePath(); g.clip(); g.fillStyle = rgba(C.yellow, .25 * fill); g.fillRect(x - 110, y + 28 - 90 * fill, 220, 90 * fill); g.restore(); }
  sign(g, label, x, y - 118, { f: 'mono', s: 26, fill: C.ink2, bar: C.cyan, rivets: false });
}
S('s14', {
  cam: [[0, 900, 470, 1.04], [12.5, 920, 470, 1.06]],
  cues: [[.3, 'type', .4], [1.5, 'type', .4], [2.7, 'type', .4], [4.8, 'thud', .6], [5.6, 'thud', .6], [8.6, 'hum'], [9.6, 'pop', .6], [10.1, 'pop', .6], [10.6, 'pop', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    const tot = CODE14.reduce((a, l) => a + l.length, 0), first = CODE14.slice(0, 4).reduce((a, l) => a + l.length, 0);
    const typedN = lerp(0, first, seg(lt, .2, 3.6)) + lerp(0, tot - first, seg(lt, 8.6, 10.4));
    const hl = lt > 4.4 && lt < 5.4 ? 1 : lt > 5.4 && lt < 8.4 ? 2 : lt > 8.6 ? 4 : null;
    codePanel(g, 110, 250, 920, CODE14, typedN / tot, lt, { hl });
    // 两个料斗：common()、items()
    hopper(g, 1260, 400, 'common()', seg(lt, 5.0, 5.6), lt);
    hopper(g, 1560, 400, 'items()', seg(lt, 5.8, 6.4), lt);
    if (lt > 4.4 && lt < 5.4) { const k = eio(seg(lt, 4.4, 5.0)); at(g, 1260, lerp(150, 330, k), 1, () => { plate(g, -70, -18, 140, 36, { fill: '#B87333', r: 5, rivets: false }); }, { al: 1 - seg(lt, 5.0, 5.3) }); }
    if (lt > 5.2 && lt < 6.2) { const k = eio(seg(lt, 5.2, 5.8)); idTape(g, 1480, 1640, lerp(150, 330, k), 12); }
    // 管理层机器：切块、拼头、吐出子请求
    plate(g, 1140, 520, 540, 220, { fill: C.paint, r: 12, sb: 30, so: 12 });
    path(g, [[1260, 430], [1260, 520]], { c: C.steelD, w: 26 }); path(g, [[1560, 430], [1560, 520]], { c: C.steelD, w: 26 });
    text(g, '管理层：怎么切、怎么拼', 1410, 560, { s: 26, w: 900, emboss: true });
    const run = seg(lt, 8.6, 9.0);
    gear(g, 1300, 650, 46, lt * 2 * run, C.steel); gear(g, 1384, 650, 34, -lt * 2.7 * run, C.steelL, 8); gear(g, 1520, 650, 46, lt * 2 * run, C.steel);
    belt(g, 1690, 2050, 700, lt, { v: 90 * run, legs: false });
    [9.6, 10.1, 10.6].forEach((t0, i) => { if (lt > t0) capsule(g, 1700 + (lt - t0) * 140, 650, { state: 'go', rot: Math.PI / 2, al: seg(lt, t0, t0 + .2) }); });
  },
});

/* 第16幕：全齐了，才交给业务 */
S('s16', {
  cam: [[0, 1130, 460, 1.15], [4.2, 1250, 470, 1.08], [8.4, 1280, 470, 1.08], [12.5, 1280, 470, 1.1]],
  cues: [[.4, 'whoosh', .6], [2.0, 'blip'], [2.4, 'blip'], [2.8, 'confirm'], [3.4, 'stamp'], [4.6, 'latch', .6], [5.9, 'thud', .6], [6.2, 'confirm', .6], [8.6, 'thud', .6], [8.9, 'stamp'], [10.8, 'error', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    stationBench(g, -1, 0);
    for (const x of TUBES) tubeBack(g, x, TUBE.y0, TUBE.y1);
    g.save(); g.beginPath(); g.rect(TUBES[0] - 200, TUBE.duct + 30, TUBES[7] - TUBES[0] + 400, 600); g.clip();
    [3, 4].forEach((ti, j) => {
      const b = 2.0 + j * .4; let y = null, st = 'go';
      if (lt > .2 && lt < .5) y = lerp(486, DOCK, eo(seg(lt, .2, .45)));
      else if (lt >= .5 && lt < .95) y = lerp(DOCK, TUBE.y0 - 40, eio(seg(lt, .5, .92)));
      else if (lt >= b - .36 && lt < 3.4) { y = lerp(TUBE.y0 - 40, DOCK, eio(seg(lt, b - .36, b))); st = lt >= b ? 'ok' : 'go'; }
      else if (lt >= 3.4 && lt < 3.8) { y = lerp(DOCK, 500, eio(seg(lt, 3.4, 3.7))); st = 'ok'; }
      if (y != null) capsule(g, lt < .5 ? lerp(ST15.cx + (j - .5) * 34, TUBES[ti], eo(seg(lt, .2, .45))) : lt >= 3.4 ? lerp(TUBES[ti], ST15.cx + (j - .5) * 34, eio(seg(lt, 3.4, 3.7))) : TUBES[ti], y, { state: st, glow: st === 'ok' ? .5 : 0, al: 1 - seg(lt, 3.55, 3.75) });
    });
    g.restore();
    for (const x of TUBES) tubeFront(g, x, TUBE.y0, TUBE.y1, lt);
    manifold(g, TUBES, TUBE.man, lt, {});
    cloudDuct(g, TUBES[0] - 60, TUBES[7] + 60, TUBE.duct, lt);
    // 父任务：全绿 → 封箱 → 机械臂送进业务窗口；之后演示最终失败也只回调一次
    const okBox = lt < 6.2, failBox = lt > 8.5;
    const carry = (t0) => { const k1 = eo(seg(lt, t0, t0 + .4)), k2 = eio(seg(lt, t0 + .4, t0 + 1.3)); return [lerp(ST15.cx, 1720, k2), lerp(ST15.beltY, 610, k2) - k1 * 120 * (1 - k2) - Math.sin(k2 * Math.PI) * 60]; };
    let tgt = [1290, 400];
    if (okBox) {
      const [x, y] = lt > 4.6 ? carry(4.6) : [ST15.cx, ST15.beltY];
      bigCrate(g, x, y, { w: 160, h: 96, open: eo(seg(lt, .1, .3)) * (1 - eo(seg(lt, 3.6, 3.9))), label: '', lamp: null, al: 1 - seg(lt, 5.9, 6.2) });
      if (lt > 3.0) stamp(g, '全部成功', x, y - 54, lt - 3.0, { c: C.green, s: 26 });
      if (lt > 4.6 && lt < 6.0) tgt = [x, y - 110];
    }
    if (failBox) {
      const [x, y] = lt > 9.6 ? carry(9.6) : [ST15.cx, ST15.beltY];
      crate(g, x, y, { kind: 'http', w: 160, h: 96, label: '', al: seg(lt, 8.5, 8.8) * (1 - seg(lt, 10.9, 11.2)), lamp: 'fail' });
      if (lt > 8.9) stamp(g, '最终失败', x, y - 54, lt - 8.9, { c: C.red, s: 26 });
      if (lt > 9.6 && lt < 11.0) tgt = [x, y - 110];
    }
    robot(g, 1395, FLOOR, tgt, lt, { state: 'run' });
    const msg = lt < 6.2 ? '' : lt < 10.8 ? 'callback(true)' : 'callback(false)';
    serviceWindow(g, 1720, 560, lt, msg, { c: lt < 10.8 ? '#7CFFB2' : '#FFB4A8' });
    if (lt > 6.4) sign(g, '整批结果，只回调一次', 1720, 790, { s: 24, fill: C.ink2, bar: C.green, k: pop(seg(lt, 6.4, 6.75)) });
    if (lt < 4.2) sign(g, '剩下 2 个子请求：重发', 735, 300, { s: 24, fill: C.ink2, bar: C.yellow, k: pop(seg(lt, .3, .6)), al: 1 - seg(lt, 3.9, 4.2) });
  },
});

/* 第17幕：退避 0.5 秒、1 秒，封顶 2 秒；延迟靠出队时跳过 */
const RX = ms => 340 + ms / 2000 * 1120;
function loop17(u) { // 回流环：工位 → 下降 → 回流带左行 → 上升 → 主带右行到队尾
  const P = [[1270, 556], [1270, 756], [330, 756], [330, 556], [900, 556]];
  const q = partial(P, clamp(u)); return q[q.length - 1];
}
S('s17', {
  cam: [[0, 900, 420, 1.06], [4, 900, 470, 1.0], [12, 900, 470, 1.0], [16, 960, 480, 1.08]],
  cues: [[.3, 'pop'], [1.8, 'tick'], [2.4, 'tick'], [3.0, 'tick'], [3.6, 'latch'], [4.3, 'error', .6], [4.5, 'stamp', .6], [6.0, 'error', .6], [6.2, 'stamp', .6], [7.3, 'error', .6], [7.8, 'thud'], [8.2, 'belt', .6], [12.4, 'scan', .6], [13.4, 'blip'], [14.6, 'pop']],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    // 刻度尺
    sign(g, '退避 = min(次数 × 500ms, 2000ms)', 900, 170, { f: 'mono', s: 28, fill: C.ink2, bar: C.yellow, k: pop(seg(lt, .3, .65)) });
    const rl = eo(seg(lt, .6, 1.6));
    plate(g, 300, 250, 1200 * rl, 26, { fill: C.steelD, r: 4, rivets: false, sb: 10, so: 4 });
    [0, 500, 1000, 1500, 2000].forEach((ms, i) => { if (rl > i / 4) { path(g, [[RX(ms), 250], [RX(ms), 290]], { c: C.cream, w: 3 }); text(g, ms + 'ms', RX(ms), 316, { f: 'mono', s: 24, w: 700, c: C.cream }); } });
    if (lt > 3.4) { plate(g, RX(2000) + 6, 236, 16, 56, { fill: C.red, r: 3, rivets: false }); text(g, '封顶', RX(2000) + 60, 262, { s: 24, w: 900, c: C.red }); }
    let mk = 0;
    if (lt < 4) mk = lt < 1.8 ? 0 : lt < 2.4 ? 500 : lt < 3.0 ? 1000 : lt < 3.6 ? 1500 : 2000;
    else if (lt < 8) mk = lt < 4.5 ? 0 : lt < 6.2 ? 500 : 1000;
    else if (lt < 12) { const n = Math.min(5, 1 + Math.floor((lt - 8.2) / .75)); mk = Math.min(2000, n * 500); }
    else mk = 500;
    const mkx = RX(mk);
    poly(g, [[mkx, 244], [mkx - 12, 226], [mkx + 12, 226]], C.yellow, { lw: 2 });
    // 产线：主带 + 回流带 + 工位 + 最终失败箱
    belt(g, 260, 1180, 560, lt, { v: 80 });
    belt(g, 260, 1320, 760, lt, { v: -110, legs: false, frame: C.paintD });
    bench(g, 1200, 1360, 560);
    rejectBin(g, 1520, FLOOR, lt, { label: '最终失败', w: 170, h: 120 });
    robot(g, 1660, FLOOR, [1340 + wob(lt, .3, 6), 440 + wob(lt, .25, 6)], lt, { state: 'run' });
    // 4–8 s：普通任务三次尝试
    if (lt > 4 && lt < 8.2) {
      let p, tag = null, lamp = null, n = 1;
      if (lt < 4.5) { p = [1270, 556]; lamp = lt > 4.3 ? 'fail' : null; }
      else if (lt < 5.8) { p = loop17(seg(lt, 4.5, 5.8) * .82); tag = '500ms'; n = 1; }
      else if (lt < 6.2) { p = [lerp(900, 1270, eio(seg(lt, 5.8, 6.0))), 556]; lamp = lt > 6.0 ? 'fail' : null; tag = '500ms'; n = 2; }
      else if (lt < 7.1) { p = loop17(seg(lt, 6.2, 7.1) * .82); tag = '1000ms'; n = 2; }
      else if (lt < 7.5) { p = [lerp(900, 1270, eio(seg(lt, 7.1, 7.3))), 556]; lamp = lt > 7.3 ? 'fail' : null; tag = '1000ms'; n = 3; }
      else { const k = eio(seg(lt, 7.5, 7.9)); p = [lerp(1270, 1520, k), lerp(556, FLOOR - 40, k) - Math.sin(k * Math.PI) * 120]; n = 3; lamp = 'fail'; }
      crate(g, p[0], p[1], { kind: 'http', w: 124, h: 90, lamp, al: 1 - seg(lt, 7.9, 8.2) });
      if (tag) timeTag(g, tag, p[0], p[1] - 100, lt, 1);
      sign(g, `普通任务：第 ${n} 次尝试`, 1270, 420, { s: 24, fill: C.ink2, bar: C.cyan });
      if (lt > 7.8) crumble(g, 1520, FLOOR - 70, lt - 7.8, C.red, 14, 70, 3);
    }
    // 8–12 s：周期同步任务一直重试
    if (lt > 8 && lt < 12.2) {
      const u = ((lt - 8.2) / .75) % 1, n = Math.max(1, 1 + Math.floor((lt - 8.2) / .75));
      const p = lt < 8.2 ? [1270, 556] : loop17(u);
      crate(g, p[0], p[1], { kind: 'sync', w: 124, h: 90, al: seg(lt, 8.0, 8.2) * (1 - seg(lt, 11.9, 12.2)) });
      timeTag(g, Math.min(2000, n * 500) + 'ms', p[0], p[1] - 100, lt, 1);
      sign(g, '周期同步：一直重试，最多隔 2 秒', 1270, 420, { s: 24, fill: C.ink2, bar: C.cyan, al: 1 - seg(lt, 11.9, 12.2) });
    }
    // 12–16 s：出队时没到点就跳过
    if (lt > 12) {
      const a = seg(lt, 12, 12.3);
      [[1060, '+500ms', true], [900, null, false], [740, null, false]].forEach(([x, tag, wait], i) => {
        crate(g, x, 556, { kind: 'http', w: 124, h: 90, al: a, lamp: wait && lt > 13.4 ? 'wait' : null });
        if (tag) timeTag(g, tag, x, 456, lt, a);
      });
      const sx = lerp(1180, 600, seg(lt, 12.4, 14.4));
      g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(sx - 40, 0, sx + 40, 0); gr.addColorStop(0, 'rgba(92,200,255,0)'); gr.addColorStop(.5, 'rgba(92,200,255,.35)'); gr.addColorStop(1, 'rgba(92,200,255,0)'); g.fillStyle = gr; g.fillRect(sx - 40, 420, 80, 160); g.restore();
      if (lt > 13.4) sign(g, '没到点：跳过', 1060, 360, { s: 24, fill: C.yellowD, c: '#151515', k: pop(seg(lt, 13.4, 13.7)), rivets: false });
      if (lt > 14.6) at(g, 560, 400, pop(seg(lt, 14.6, 14.95)), () => { wallClock(g, 0, 0, 40, lt * 3); icCross(g, 0, 0, 80, C.red, 1, 8); text(g, '不另开定时器', 0, 80, { s: 24, w: 900, c: C.red }); });
    }
  },
});

/* 第18幕：界面在等的，不重试；401 先通知刷新 token（解读：即时反馈 vs 最终一致） */
S('s18', {
  cam: [[0, 620, 470, 1.12], [4.2, 960, 470, 1.0], [8.4, 1300, 470, 1.12], [12.5, 1290, 470, 1.1]],
  cues: [[1.0, 'error'], [1.4, 'whoosh', .6], [2.2, 'pop'], [4.6, 'error', .5], [4.9, 'stamp', .6], [5.3, 'belt', .5], [8.6, 'thud', .5], [9.3, 'click'], [9.6, 'print'], [11.0, 'stamp', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    // 左：界面发起
    smartScreen(g, 330, 300, .8, lt, { err: lt > 2.2 ? seg(lt, 2.2, 2.5) : 0, errText: '超时' });
    bench(g, 200, 640, 640);
    crate(g, 420, 636, { kind: 'http', w: 130, h: 92, label: '界面', lamp: lt > 1.0 ? 'fail' : null });
    if (lt > .4) sign(g, '带消息号', 420, 480, { s: 24, fill: C.ink2, bar: C.cyan, rivets: false });
    if (lt > 1.2 && lt < 2.3) { const k = eio(seg(lt, 1.3, 2.2)); at(g, lerp(420, 330, k), lerp(540, 300, k), 1, () => { plate(g, -60, -24, 120, 48, { fill: C.redD, r: 8, rivets: false }); text(g, '错误', 0, 2, { s: 24, w: 900 }); }); }
    if (lt > 3.0) { sign(g, '超时', 250, 450, { s: 24, fill: C.redD, c: '#fff', k: pop(seg(lt, 3.0, 3.3)), rivets: false }); sign(g, '其他错误', 410, 450, { s: 24, fill: C.redD, c: '#fff', k: pop(seg(lt, 3.2, 3.5)), rivets: false }); }
    if (lt > 4.6) sign(g, '人在等：立刻回错，不重试', 420, 760, { s: 24, fill: C.ink2, bar: C.red, k: pop(seg(lt, 4.6, 4.95)) });
    // 右：后台任务
    belt(g, 1000, 1640, 760, lt, { v: -90, legs: false, frame: C.paintD });
    bench(g, 1080, 1520, 600);
    const bg1 = lt < 4.9 ? [1300, 596] : (() => { const k = eio(seg(lt, 5.0, 7.6)); return [lerp(1300, 1060, k), lt < 5.4 ? lerp(596, 756, eio(seg(lt, 5.0, 5.4))) : 756]; })();
    if (lt < 8.0) { crate(g, bg1[0], bg1[1], { kind: 'http', w: 124, h: 90, label: '后台', lamp: lt > 4.6 ? 'fail' : null, al: 1 - seg(lt, 7.6, 8.0) }); if (lt > 4.9) timeTag(g, '+500ms', bg1[0], bg1[1] - 100, lt, seg(lt, 4.9, 5.2)); }
    if (lt > 4.8) sign(g, '后台：退避后慢慢补', 1300, 860 - 40, { s: 24, fill: C.ink2, bar: C.green, k: pop(seg(lt, 4.8, 5.15)), al: 1 - seg(lt, 8.2, 8.5) });
    // 401：先按“刷新 token”，再照常回流
    plate(g, 1560, 380, 170, 150, { fill: C.paintD, r: 10, sb: 20, so: 8 });
    text(g, '刷新 token', 1645, 412, { s: 24, w: 900, emboss: true });
    const pr = seg(lt, 9.3, 9.38) * (1 - seg(lt, 9.6, 9.7));
    g.save(); g.beginPath(); g.ellipse(1610, 470 + pr * 4, 18, 11, 0, Math.PI, 0); g.fillStyle = C.red; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); g.restore();
    if (lt > 9.6) slip(g, 1690, lerp(470, 540, eo(seg(lt, 9.6, 10.4))), '新 token', { c: C.green, k: .9 });
    if (lt > 8.4) {
      const k = eio(seg(lt, 11.0, 12.4)), p = lt < 11.0 ? [1300, 596] : [lerp(1300, 1080, k), lt < 11.4 ? lerp(596, 756, eio(seg(lt, 11.0, 11.4))) : 756];
      crate(g, p[0], p[1], { kind: 'http', w: 124, h: 90, label: '后台', al: seg(lt, 8.4, 8.7), lamp: lt < 11 ? 'fail' : null });
      at(g, p[0] + 52, p[1] - 108, 1, () => { plate(g, -44, -22, 88, 44, { fill: C.redD, r: 6, rivets: false }); text(g, '401', 0, 2, { f: 'mono', s: 26, w: 700 }); }, { al: seg(lt, 8.5, 8.8) * (1 - seg(lt, 10.4, 10.8)) });
      if (lt > 11.0) timeTag(g, '+500ms', p[0] - 30, p[1] - 100, lt, seg(lt, 11.0, 11.3));
    }
    let tgt = [1500, 440];
    if (lt > 8.9 && lt < 9.9) tgt = [lerp(1500, 1610, eo(seg(lt, 8.9, 9.3))), lerp(440, 466 + pr * 4, eo(seg(lt, 8.9, 9.3)))];
    robot(g, 1790, FLOOR, tgt, lt, { state: 'run' });
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

/* =====================================================================
 * 第四章 · 插队与闸门（第19、21、22幕；第20幕见后）
 * ===================================================================== */
/* 第19幕：插队——本地任务排到所有网络任务前，加急任务直接插队头 */
const SLOT19 = k => 1300 - k * 150;
function craneCarry(lt, t0, from, to) { // 吊车搬运：t0 起 [到位 .6, 下钩 .3, 起吊 .4, 平移 1.0, 落钩 .4, 松钩 .3]
  const T = [t0, t0 + .6, t0 + .9, t0 + 1.3, t0 + 2.3, t0 + 2.7, t0 + 3.0], low = 620 - 4 - 90 - 12 - 26, top = 236;
  let tx = from, hy = top, carry = false;
  if (lt < T[1]) tx = lerp(1500, from, eio(seg(lt, T[0], T[1])));
  else if (lt < T[2]) hy = lerp(top, low, eio(seg(lt, T[1], T[2])));
  else if (lt < T[3]) { hy = lerp(low, top, eio(seg(lt, T[2], T[3]))); carry = true; }
  else if (lt < T[4]) { tx = lerp(from, to, eio(seg(lt, T[3], T[4]))); carry = true; }
  else if (lt < T[5]) { tx = to; hy = lerp(top, low, eio(seg(lt, T[4], T[5]))); carry = true; }
  else { tx = to; hy = lerp(low, top, eio(seg(lt, T[6] - .1, T[6] + .4))); }
  if (lt < T[0]) tx = 1500;
  if (lt >= T[3] && lt < T[4]) tx = lerp(from, to, eio(seg(lt, T[3], T[4])));
  const sw = lt > T[3] && lt < T[4] ? -Math.sin(seg(lt, T[3], T[4]) * Math.PI) * 20 * Math.sign(to - from) : 0;
  return { tx, hy, carry, sw, placed: lt >= T[5] };
}
S('s19', {
  cam: [[0, 900, 450, 1.05], [13.5, 950, 450, 1.08]],
  cues: [[2.0, 'pop', .6], [6.8, 'thud', .5], [6.9, 'latch'], [7.6, 'whoosh', .6], [8.9, 'thud', .7], [10.4, 'thud', .5], [10.5, 'latch'], [11.2, 'whoosh', .6], [12.5, 'latch']],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 120, 1400, 620, lt, { v: 70, label: '任务队列', labelDx: -300 });
    const s1 = eio(seg(lt, 7.8, 8.5)), s2 = eio(seg(lt, 11.4, 12.1));
    [401, 402, 403, 404].forEach((no, k) => crate(g, SLOT19(k + s1 + s2), 616, { kind: 'http', no, w: 124, h: 90 }));
    // 本地任务
    const c1 = craneCarry(lt, 6.4, 700, SLOT19(0));
    const c2 = craneCarry(lt, 10.0, 550, SLOT19(0));
    const active = lt < 9.8 ? c1 : c2;
    const hook = crane(g, -300, 1700, active.tx, active.hy, lt, { swing: active.sw });
    if (lt > 5.8) {
      let x, y;
      if (!c1.carry && !c1.placed) { x = Math.min(700, -200 + (lt - 5.8) * 900); y = 616; }
      else if (c1.carry && lt < 9.8) { x = hook[0]; y = hook[1] + 76 + 14; }
      else { x = SLOT19(s2); y = 616; }
      crate(g, x, y, { kind: 'local', w: 120, h: 76, glow: c1.carry && lt < 9.8 ? .5 : 0, glowC: C.green, rot: c1.carry && lt < 9.8 ? c1.sw * .004 : 0 });
    }
    if (lt > 9.6) {
      let x, y;
      if (!c2.carry && !c2.placed) { x = Math.min(550, -200 + (lt - 9.6) * 900); y = 616; }
      else if (c2.carry) { x = hook[0]; y = hook[1] + 90 + 14; }
      else { x = SLOT19(0); y = 616; }
      crate(g, x, y, { kind: 'hi', no: 405, w: 124, h: 90, glow: c2.carry ? .5 : 0, glowC: C.orange, rot: c2.carry ? c2.sw * .004 : 0 });
    }
    robot(g, 1600, FLOOR, [1440 + wob(lt, .3, 6), 470 + wob(lt, .25, 6)], lt, { state: 'run' });
    if (lt > 2.0 && lt < 5.8) sign(g, '一条线：谁先谁后，得有规矩', 800, 360, { s: 26, fill: C.ink2, bar: C.cyan, k: pop(seg(lt, 2.0, 2.35)), al: 1 - seg(lt, 5.5, 5.8) });
    if (lt > 8.9 && lt < 10.2) sign(g, '本地任务：排到所有网络任务前', 900, 760, { s: 24, fill: C.greenD, k: pop(seg(lt, 8.9, 9.25)), al: 1 - seg(lt, 9.9, 10.2) });
    if (lt > 12.5) sign(g, '加急：直接插到队头', 1150, 760, { s: 24, fill: '#B5521B', k: pop(seg(lt, 12.5, 12.85)) });
    if (lt > 12.5) sign(g, '普通：照常排队尾', 500, 760, { s: 24, fill: C.ink2, k: pop(seg(lt, 12.7, 13.05)) });
  },
});

/* 第21幕：出队——找第一个能干的活（示意代码 + 扫描光标） */
const CODE21 = [
  'bool gate = false;',
  'for (task *t = head; t; t = t->next) {',
  '    bool waiting = now - t->enq_ms < t->delay_ms;',
  '    if (is_barrier(t)) gate = waiting;',
  '    if (waiting || (gate && is_http(t))) continue;',
  '    return take(t);',
  '}',
  'return NULL;  /* 一个都不行：worker 睡在条件变量上 */',
];
const Q21 = [[1690, 'wait'], [1560, 'barrier'], [1430, 'http'], [1300, 'local'], [1170, 'http']];
S('s21', {
  cam: [[0, 960, 480, 1.0], [12.5, 980, 480, 1.02]],
  cues: [[.3, 'type', .4], [2.4, 'blip', .6], [3.4, 'tick', .6], [4.8, 'blip', .6], [5.6, 'confirm', .6], [8.8, 'scan', .6], [10.8, 'down', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    const lens = CODE21.map(l => l.length), tot = lens.reduce((a, b) => a + b, 0), c5 = lens.slice(0, 5).reduce((a, b) => a + b, 0), c7 = c5 + lens[5] + lens[6];
    const typed = lerp(0, c5, seg(lt, .2, 3.6)) + lerp(0, c7 - c5, seg(lt, 4.2, 5.2)) + lerp(0, tot - c7, seg(lt, 8.6, 9.6));
    const step = lt < 2.4 ? null : lt < 3.4 ? 2 : lt < 4.8 ? 3 : lt < 5.6 ? 4 : lt < 8.6 ? 5 : 7;
    codePanel(g, 70, 210, 880, CODE21, typed / tot, lt, { hl: step, hlC: step === 5 ? C.green : step === 7 ? C.cyan : C.yellow, title: '出队扫描 · 示意代码' });
    belt(g, 1020, 1760, 640, lt, { v: 0, legs: true, legGap: 240 });
    const taken = eio(seg(lt, 5.8, 6.6));
    Q21.forEach(([x, kind], i) => {
      const scan1 = [2.4, 3.4, 4.8, 5.6][i] ?? 99, scan2 = 8.8 + i * .4;
      const lamp = (lt > scan2 && kind !== 'local') ? (kind === 'wait' ? 'wait' : kind === 'barrier' ? null : 'fail') : lt > scan1 ? (kind === 'wait' ? 'wait' : kind === 'http' ? 'fail' : kind === 'local' ? 'ok' : null) : null;
      if (kind === 'local') { if (taken < 1) crate(g, lerp(x, 1980, taken), 636 - Math.sin(taken * Math.PI) * 120, { kind: 'local', w: 110, h: 70, lamp, al: 1 - seg(lt, 6.3, 6.6) }); return; }
      crate(g, x, 636, { kind: kind === 'wait' ? 'http' : kind, w: 110, h: kind === 'barrier' ? 70 : 84, label: kind === 'barrier' ? '屏障' : '网络', lamp });
      if (kind === 'wait') timeTag(g, '+500ms', x, 530, lt, 1);
    });
    const sx = lt < 2.1 ? -999 : lt < 6.2 ? lerp(1760, 1250, seg(lt, 2.1, 6.0)) : lt > 8.6 && lt < 10.8 ? lerp(1760, 1120, seg(lt, 8.7, 10.6)) : -999;
    if (sx > 0) { g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(sx - 50, 0, sx + 50, 0); gr.addColorStop(0, 'rgba(92,200,255,0)'); gr.addColorStop(.5, 'rgba(92,200,255,.4)'); gr.addColorStop(1, 'rgba(92,200,255,0)'); g.fillStyle = gr; g.fillRect(sx - 50, 470, 100, 200); g.restore(); }
    const lbl = [[2.4, 3.4, '退避没到：跳过', C.yellowD, '#151515'], [3.4, 4.8, '屏障还在：闸门落下', C.ink2, C.cream], [4.8, 5.6, '闸门后的网络任务：跳过', C.redD, '#fff'], [5.6, 8.4, '本地任务：取走执行', C.greenD, '#fff'], [10.8, 12.5, '一个都不行：睡在条件变量上', C.ink2, C.cyan]];
    lbl.forEach(([a, b, s, f, c]) => { if (lt > a && lt < b) sign(g, s, 1390, 400, { s: 26, fill: f, c, k: pop(seg(lt, a, a + .3)) }); });
    robot(g, 1900, FLOOR, [1800, 500], lt, { state: lt > 10.8 ? 'sleep' : 'run', label: false });
  },
});

/* 第22幕：1 秒的定时器，到点抬闸（⚠ 前半段假设没有定时器） */
S('s22', {
  demo: true,
  cam: [[0, 1000, 470, 1.1], [4.2, 1000, 450, 1.15], [8.4, 1150, 470, 1.08], [12.5, 1100, 470, 1.04]],
  cues: [[1.0, 'pop', .5], [4.4, 'pop'], [4.6, 'tick', .5], [7.8, 'bell'], [8.6, 'blip'], [9.8, 'clank'], [10.4, 'whoosh', .6], [10.8, 'belt', .7]],
  draw(g, lt, sc, frame) {
    const { beltY, gateX, head } = ST20;
    hall(g, frame);
    belt(g, -420, 1560, beltY, lt, { v: lt > 10.6 ? 120 : 0, label: '任务队列', labelDx: 580 });
    const up = eio(seg(lt, 9.8, 10.3));
    gate(g, gateX, beltY, 1 - up, lt, { label: '同步屏障', span: 170, h: 190, alarm: up < .5 ? 1 : 0 });
    BEHIND20.forEach(([, stop, no], i) => { const go = Math.max(0, lt - 10.6 - i * .15) * 160; crate(g, Math.min(head - i * 142, stop + go), beltY - 4, { kind: 'http', no, w: 124, h: 90, lamp: lt < 10.4 ? 'fail' : 'ok' }); });
    // 读数早已归零，却没人来拆
    if (lt < 4.4) gauge(g, gateX + 160, 452, 44, 1, { read: '0', label: '剩余 ms' });
    if (lt > 1.0 && lt < 4.6) sign(g, '900ms 早过了，可没人来拆', 900, 300, { s: 26, fill: C.ink2, bar: C.red, k: pop(seg(lt, 1.0, 1.35)), al: 1 - seg(lt, 4.3, 4.6) });
    // 屏障自带的 1 秒定时器
    if (lt > 4.4) {
      const k = pop(seg(lt, 4.4, 4.75));
      stopwatch(g, gateX + 160, 452, 48, seg(lt, 4.6, 7.6) * TAU, { sweep: true, c: C.cyan, k });
      sign(g, '屏障自带：1 秒定时器', gateX + 160, 340, { s: 24, fill: C.ink2, bar: C.cyan, k, al: 1 - seg(lt, 11.5, 12) });
      if (lt > 7.8 && lt < 9.2) for (let j = 0; j < 3; j++) { const ph = ((lt - 7.8) * 1.6 + j / 3) % 1; ring(g, gateX + 160, 452, 60 + ph * 90, C.yellow, 4, (1 - ph) * .7 * (1 - seg(lt, 8.6, 9.2))); }
    }
    // worker：睡着 → 被叫醒 → 拆掉屏障
    const awake = lt > 8.6;
    let tgt = [head + 150, 480 + (awake ? 0 : 20)];
    if (lt > 9.0 && lt < 10.4) tgt = [lerp(head + 150, gateX + 80, eo(seg(lt, 9.0, 9.6))), lerp(480, 470, eo(seg(lt, 9.0, 9.6)))];
    if (lt >= 10.4 && lt < 11.2) { const k = eio(seg(lt, 10.4, 11.1)); tgt = [lerp(gateX + 80, 1900, k), 470 - Math.sin(k * Math.PI) * 100]; crate(g, tgt[0], tgt[1] + 100, { kind: 'barrier', w: 110, h: 70, al: 1 - seg(lt, 10.9, 11.2) }); }
    robot(g, ST20.bx, FLOOR, tgt, lt, { state: awake ? 'run' : 'sleep' });
    if (!awake) for (let j = 0; j < 3; j++) { const ph = (lt * .5 + j / 3) % 1; text(g, 'z', ST20.bx - 40 + ph * 60, 560 - ph * 110, { f: 'disp', s: 28 + j * 6, w: 900, c: C.cyan, al: (1 - ph) * .8 }); }
    if (lt > 10.6) sign(g, '闸门拆掉：网络任务继续', 700, 360, { s: 24, fill: C.greenD, k: pop(seg(lt, 10.6, 10.95)) });
  },
});

/* =====================================================================
 * 第五章 · 查重、拒收、工单号
 * ===================================================================== */
const Q23 = [[700, '场景 s1'], [850, '详情 abc'], [1000, '控制 灯1'], [1150, '规格 d'], [1300, '详情 x']];
function paramTag(g, s, x, y, o = {}) {
  const w = textW(g, s, { s: 24, w: 900 }) + 26;
  at(g, x, y, o.k ?? 1, () => { rr(g, -w / 2, -18, w, 36, 6); g.fillStyle = o.fill || C.paper; g.fill(); g.lineWidth = o.lw || 2; g.strokeStyle = o.stroke || C.ink; g.stroke(); text(g, s, 0, 1, { s: 24, w: 900, c: C.ink }); }, { al: o.al });
}
S('s23', {
  cam: [[0, 860, 470, 1.08], [13.5, 860, 470, 1.1]],
  cues: [[2.0, 'belt', .5], [3.2, 'scan', .7], [5.0, 'error'], [6.0, 'stamp'], [6.6, 'thud'], [9.8, 'belt', .5], [11.0, 'confirm']],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 100, 1480, 620, lt, { v: 60 });
    rejectBin(g, 300, FLOOR, lt, { w: 180, h: 130 });
    scanner(g, 420, 620, lt, { label: '扫码门', flash: lt > 5.0 && lt < 6.6 ? 1 : lt > 11.0 && lt < 11.8 ? .8 : 0, flashC: lt > 9 ? C.green : C.red });
    robot(g, 1650, FLOOR, [1500 + wob(lt, .3, 6), 470 + wob(lt, .25, 6)], lt, { state: 'run' });
    Q23.forEach(([x, s], i) => {
      const hitDup = i === 1 && lt > 5.0 && lt < 7.6, hitCtl = i === 2 && lt > 12.2;
      crate(g, x, 616, { kind: 'http', w: 116, h: 88, label: '', lamp: hitDup ? 'fail' : hitCtl ? 'ok' : null });
      const sweep = lt > 3.2 + i * .35 && lt < 3.55 + i * .35;
      paramTag(g, s, x, 486, { fill: hitDup ? '#FFD2CF' : hitCtl ? '#CFF5DA' : sweep ? '#DFF3FF' : C.paper, stroke: hitDup ? C.red : hitCtl ? C.green : C.ink, lw: hitDup || hitCtl ? 3.5 : 2 });
      if (sweep || hitDup) path(g, [[420, 410], [x, 470]], { c: hitDup ? C.red : rgba(C.cyan, .8), w: 3, dash: [8, 6], off: -lt * 40 });
    });
    // 新来的“详情 abc”：判重复，翻进拒收箱
    if (lt > 1.8 && lt < 8.2) {
      let x = Math.min(420, -200 + (lt - 1.9) * 560), y = 616, rot = 0;
      if (lt > 6.6) { const k = seg(lt, 6.6, 7.4); x = lerp(420, 300, k); y = lerp(616, FLOOR - 40, k * k); rot = -k * 1.2; }
      crate(g, x, y, { kind: 'http', w: 116, h: 88, label: '', rot, lamp: lt > 5.0 ? 'fail' : null, al: 1 - seg(lt, 7.6, 8.2) });
      paramTag(g, '详情 abc', x, y - 130, { al: 1 - seg(lt, 6.6, 6.9), stroke: lt > 5.0 ? C.red : C.ink, lw: lt > 5 ? 3.5 : 2 });
      if (lt > 6.0) stamp(g, '重复', x, y - 50, lt - 6.0, { c: C.red, s: 30 });
      if (lt > 7.3) puff(g, 300, FLOOR - 120, lt - 7.3, 80);
    }
    if (lt > 5.2 && lt < 9.6) sign(g, '同类型 + 同参数 = 重复，丢掉', 860, 340, { s: 26, fill: C.redD, c: '#fff', k: pop(seg(lt, 5.2, 5.55)), al: 1 - seg(lt, 9.3, 9.6) });
    // 控制类：免检放行，和队里一样的也不合并
    if (lt > 9.7) {
      const x = lt < 11.2 ? Math.min(420, -200 + (lt - 9.8) * 620) : lerp(420, 560, eio(seg(lt, 11.2, 12.0)));
      crate(g, x, 616, { kind: 'http', w: 116, h: 88, label: '', lamp: lt > 11.0 ? 'ok' : null });
      paramTag(g, '控制 灯1', x, 486, { fill: lt > 12.2 ? '#CFF5DA' : C.paper, stroke: lt > 11 ? C.green : C.ink, lw: lt > 11 ? 3.5 : 2 });
      if (lt > 11.0) sign(g, '免检', 420, 330, { s: 26, fill: C.greenD, k: pop(seg(lt, 11.0, 11.3)), rivets: false });
      if (lt > 12.3) sign(g, '控制、查询、执行场景：不去重', 1000, 340, { s: 24, fill: C.greenD, k: pop(seg(lt, 12.3, 12.65)) });
    }
  },
});

/* 第24幕：满了，拒收新来的（解读：下一轮同步还会再拉；16 格为 demo 配置） */
const SX24 = i => 1580 - i * 88; // i = 0 为队头
S('s24', {
  cam: [[0, 900, 470, 1.04], [12.5, 900, 470, 1.06]],
  cues: [...Array.from({ length: 16 }, (_, i) => [.4 + i * .16, 'tick', .35]), [3.2, 'alarm', .6], [5.2, 'thud'], [5.6, 'error', .6], [6.4, 'pop'], [8.6, 'tick', .5], [10.2, 'tick', .5], [10.0, 'whoosh', .5], [11.4, 'belt', .5], [12.0, 'confirm', .6]],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 180, 1640, 620, lt, { v: 0, legGap: 280 });
    for (let i = 0; i < 16; i++) text(g, String(16 - i), SX24(i), 680, { f: 'mono', s: 24, w: 700, c: C.dim });
    sign(g, 'demo 配置：16 格', 1500, 320, { s: 24, fill: C.ink2, bar: C.yellow });
    const gone = i => i < 4 ? eio(seg(lt, 10.0 + i * .12, 10.6 + i * .12)) : 0, shift = eio(seg(lt, 10.8, 11.4)) * 4;
    for (let i = 0; i < 16; i++) {
      const t0 = .4 + (15 - i) * .16; if (lt < t0) continue;
      const [k, sq] = landing(lt, t0, .25), gk = gone(i);
      if (gk >= 1) continue;
      const x = i < 4 ? lerp(SX24(i), 2000, gk) : SX24(i - shift);
      crate(g, x, lerp(400, 616, k), { kind: 'http', w: 76, h: 60, label: '', sq, al: 1 - gk });
    }
    const n = lt < 10.0 ? Math.min(16, Math.floor((lt - .4) / .16) + 1) : lt < 12.0 ? 12 : 13;
    plate(g, 60, 380, 230, 120, { fill: C.ink2, r: 10 });
    text(g, `${Math.max(0, n)} / 16`, 175, 430, { f: 'mono', s: 36, w: 700, c: n >= 16 ? '#FFB4A8' : '#7CFFB2', glow: rgba(n >= 16 ? '#FFB4A8' : '#7CFFB2', .6), gb: 10 });
    lampDot(g, 175, 474, 10, n >= 16 ? C.red : C.green, 1);
    if (lt > 3.2 && lt < 10.2) sign(g, '队列满了', 175, 330, { s: 24, fill: C.redD, c: '#fff', k: pop(seg(lt, 3.2, 3.5)), rivets: false });
    // 入口挡板 + 拒收箱
    plate(g, 150, 440, 22, 200, { fill: C.steelD, r: 4, rivets: false });
    rejectBin(g, 60, FLOOR, lt, { w: 150, h: 120 });
    if (lt > 4.3 && lt < 7.4) {
      let x = Math.min(110, -200 + (lt - 4.4) * 440), y = 616, rot = 0;
      if (lt > 5.4) { const k = seg(lt, 5.4, 6.0); x = lerp(110, 60, k); y = lerp(616, FLOOR - 40, k * k); rot = -k; }
      crate(g, x, y, { kind: 'http', w: 76, h: 60, label: '', rot, lamp: lt > 5.2 ? 'fail' : null, al: 1 - seg(lt, 6.4, 6.6) });
      crumble(g, 60, FLOOR - 70, lt - 6.4, C.kraft, 16, 80, 7);
    }
    if (lt > 6.0 && lt < 9.0) sign(g, '丢的是新来的：当场释放', 420, 760, { s: 24, fill: C.redD, c: '#fff', k: pop(seg(lt, 6.0, 6.35)), al: 1 - seg(lt, 8.7, 9.0) });
    wallClock(g, 700, 330, 54, seg(lt, 8.6, 10.2) * TAU, { label: '周期同步' });
    if (lt > 11.4) {
      const k = eio(seg(lt, 11.4, 12.1)), x = lerp(-120, SX24(15), k);
      crate(g, x, 616, { kind: 'sync', w: 76, h: 60, label: '', lamp: lt > 12.0 ? 'ok' : null });
      if (lt > 11.8) sign(g, '下一轮同步：再拉一次', 900, 760, { s: 24, fill: C.greenD, k: pop(seg(lt, 11.8, 12.1)) });
    }
  },
});

/* 第25幕：每个任务都有工单号（⚠ 日志与耗时条为示意） */
const LOG25 = ['#0137 入队', '查重通过', '出队', '执行', '完成：排队 + 执行耗时'];
S('s25', {
  demo: true,
  cam: [[0, 820, 470, 1.08], [4.2, 1000, 470, 1.04], [8.4, 960, 430, 1.0], [12.5, 960, 440, 1.02]],
  cues: [[.8, 'spray'], [1.9, 'spray'], [3.0, 'spray'], [4.6, 'punch'], [5.4, 'punch'], [7.2, 'punch'], ...LOG25.map((_, i) => [8.6 + i * .6, 'tick', .5])],
  draw(g, lt, sc, frame) {
    hall(g, frame);
    belt(g, 160, 1380, 620, lt, { v: 90 });
    bench(g, 1420, 1660, 620);
    robot(g, 1790, FLOOR, [1650 + wob(lt, .3, 6), 470 + wob(lt, .25, 6)], lt, { state: lt > 5.4 && lt < 7.2 ? 'run' : 'wait' });
    // 喷码龙门
    plate(g, 380, 330, 24, FLOOR - 330, { fill: C.paintD, r: 4, rivets: false }); plate(g, 560, 330, 24, FLOOR - 330, { fill: C.paintD, r: 4, rivets: false });
    plate(g, 360, 310, 244, 34, { fill: C.paint, r: 6 }); text(g, '入队：发编号', 482, 284, { s: 24, w: 900, emboss: true });
    plate(g, 468, 344, 28, 70, { fill: C.steel, r: 4, rivets: false });
    const nos = [[.8, 137], [1.9, 138], [3.0, 139]];
    nos.forEach(([t0, no], i) => {
      const x = lt < t0 ? -200 + (lt - t0 + 1.2) * 580 : lt < 4.2 ? 482 + (lt - t0) * 130 * (i === 0 ? 1 : .35) : i === 0 ? lerp(482 + (4.2 - t0) * 130, 1540, eio(seg(lt, 4.2, 4.6))) : 482 + (4.2 - t0) * 130 * .35 - (2 - i) * 0;
      const xx = i === 0 ? Math.min(x, 1540) : Math.min(x, 1250 - i * 150);
      crate(g, xx, 616, { kind: 'http', w: 124, h: 90, no: lt > t0 ? no : null });
      if (lt > t0 && lt < t0 + .5) { for (let j = 0; j < 10; j++) dot(g, 482 + (hash(j + t0 * 9) - .5) * 60, 430 + hash(j * 3 + t0) * 120 * ((lt - t0) / .5), 3, C.cream, 1 - (lt - t0) / .5); }
    });
    // 打卡钟 + 工单卡
    plate(g, 1280, 320, 170, 190, { fill: C.paintD, r: 10, sb: 20, so: 8 });
    wallClock(g, 1365, 390, 40, lt * 2);
    text(g, '打卡钟', 1365, 474, { s: 24, w: 900, emboss: true });
    const rows = [['入队', .8], ['开始', 5.4], ['结束', 7.2]];
    at(g, 1540, 380, pop(seg(lt, .9, 1.2)), () => {
      plate(g, -110, -70, 220, 150, { fill: C.paper, r: 6, rivets: false, lw: 2, sb: 14, so: 5 });
      text(g, '#0137', 0, -46, { f: 'mono', s: 24, w: 700, c: C.ink });
      rows.forEach(([s, t0], i) => { const on = lt > t0; text(g, s, -70, -8 + i * 30, { s: 24, w: 900, a: 'left', c: on ? C.ink : '#A89F8E' }); if (on) icCheck(g, 70, -8 + i * 30, 22, C.greenD, seg(lt, t0, t0 + .3), 4); });
    });
    // 两段耗时
    const q = seg(lt, 1.0, 5.4), e = seg(lt, 5.4, 7.2);
    timeBar(g, 1000, 760, [{ w: 300 * q, c: C.yellow, label: q > .3 ? '排队' : '' }, { w: 260 * e, c: C.green, label: e > .3 ? '执行' : '' }], 1, { maxW: 560 });
    // 一条日志串起任务的一生
    if (lt > 8.4) {
      const a = seg(lt, 8.4, 8.7);
      g.save(); g.globalAlpha *= a;
      plate(g, 160, 150, 1600, 76, { fill: '#0B1310', r: 10 });
      let x = 190;
      LOG25.forEach((s, i) => { const on = seg(lt, 8.6 + i * .6, 8.9 + i * .6); if (i) { text(g, '→', x + 10, 188, { f: 'mono', s: 26, w: 700, c: rgba('#7CFFB2', .3 + .7 * on) }); x += 40; } text(g, s, x, 188, { s: 26, w: 700, a: 'left', c: rgba('#7CFFB2', .25 + .75 * on), glow: on > .5 ? 'rgba(124,255,178,.5)' : null, gb: 8 }); x += textW(g, s, { s: 26, w: 700 }) + 10; });
      g.restore();
    }
  },
});

/* =====================================================================
 * 总结 · 第26–28幕：三块工牌
 * ===================================================================== */
const PLQ = [420, 960, 1500];
function plaques(g, lt, ks) {
  plate(g, 140, 236, 1640, 22, { fill: C.steelD, r: 3, rivets: false, sb: 12, so: 5 });
  plaque(g, PLQ[0], 470, 440, 380, '先把约束算清楚', ks[0], lt, (gg, x, y, w, h) => {
    pushPipe(gg, [[x + 380, y + 140], [x + 250, y + 140]], lt, { w: 40, collar: 1, ly: -60 });
    crate(gg, x + 140, y + 236, { kind: 'http', w: 170, h: 120, label: '4.62KB', lamp: 'fail' });
    icCross(gg, x + 300, y + 220, 60, C.red, 1, 8);
  });
  plaque(g, PLQ[1], 470, 440, 380, '单线程 + 多路复用', ks[1], lt, (gg, x, y, w, h) => {
    const xs = [x + 150, x + 190, x + 230, x + 270, x + 310];
    for (const tx of xs) tubeBack(gg, tx, y + 50, y + 200);
    xs.forEach((tx, i) => capsule(gg, tx, y + 90 + ((lt * 1.3 + i * .37) % 1) * 90, { state: 'ok', s: .8 }));
    for (const tx of xs) tubeFront(gg, tx, y + 50, y + 200, lt);
    plate(gg, x + 120, y + 200, 220, 18, { fill: C.steelD, r: 4, rivets: false, shadow: false });
    at(gg, x + 110, y + 296, .5, () => robot(gg, 0, 0, [140, -230], lt, { label: false, state: 'run' }));
  });
  plaque(g, PLQ[2], 470, 440, 380, '不同的活，不同待遇', ks[2], lt, (gg, x, y, w, h) => {
    const ic = [[x + 110, y + 120, '插队'], [x + 330, y + 120, '闸门'], [x + 110, y + 240, '只重试失败的'], [x + 330, y + 240, '界面立刻回错']];
    ic.forEach(([cx, cy, s], i) => {
      const on = ks[3] == null ? 1 : seg(ks[3], 4.2 + i * .45, 4.5 + i * .45);
      gg.save(); gg.globalAlpha *= .35 + .65 * on;
      if (i === 0) { path(gg, [[cx, cy - 50], [cx, cy - 16]], { c: C.ink, w: 3 }); crate(gg, cx, cy + 22, { kind: 'local', w: 60, h: 40, label: '' }); }
      if (i === 1) hazard(gg, cx - 34, cy - 40, 68, 66, { s: 12 });
      if (i === 2) { ring(gg, cx, cy - 8, 28, C.yellow, 7, 1, -Math.PI * .2, Math.PI * 1.4); poly(gg, [[cx + 22, cy - 44], [cx + 40, cy - 24], [cx + 14, cy - 22]], C.yellow, { lw: 0 }); }
      if (i === 3) { plate(gg, cx - 40, cy - 30, 80, 44, { fill: C.redD, r: 6, rivets: false, shadow: false }); text(gg, '!', cx, cy - 7, { f: 'disp', s: 30, w: 900 }); }
      text(gg, s, cx, cy + 50, { s: 24, w: 900, emboss: true });
      gg.restore();
    });
  });
}
S('s26', { cam: [[0, 420, 470, 1.22], [9, 450, 470, 1.24]], cues: [[2.0, 'clank', .7]], draw(g, lt, sc, frame) { hall(g, frame); plaques(g, lt, [seg(lt, 1.8, 2.5), 0, 0]); } });
S('s27', { cam: [[0, 450, 470, 1.24], [1.0, 960, 470, 1.24], [8, 980, 470, 1.24]], cues: [[.3, 'clank', .7]], draw(g, lt, sc, frame) { hall(g, frame); plaques(g, lt + 9, [1, seg(lt, .2, .9), 0]); } });
S('s28', { cam: [[0, 980, 470, 1.24], [1.0, 1500, 470, 1.24], [6.2, 1500, 470, 1.24], [8, 960, 470, 1.0]], cues: [[.3, 'clank', .7], [4.2, 'blip', .5], [4.65, 'blip', .5], [5.1, 'blip', .5], [5.55, 'blip', .5]], draw(g, lt, sc, frame) { hall(g, frame); plaques(g, lt + 17, [1, 1, seg(lt, .2, .9), lt]); } });

/* =====================================================================
 * 结尾 · 第29幕：跑一遍 demo，然后拉远看整条线
 * ===================================================================== */
const TERM29 = ['$ ./demo', ...Array.from({ length: 10 }, (_, i) => `场景 ${String(i + 1).padStart(2, '0')}  ........  OK`), '21/21 通过 · 约 4 s'];
function panorama(g, lt, frame) {
  hall(g, frame);
  rejectBin(g, -120, FLOOR, lt, { w: 150, h: 120 });
  scanner(g, 40, 600, lt, {});
  belt(g, -60, 820, 600, lt, { v: 90 });
  gate(g, 430, 600, 0, lt, { span: 150, h: 190, alarm: 0 });
  [[150, 'http', 160], [300, 'sync', 161], [560, 'local', 162], [710, 'hi', 163]].forEach(([x, kind, no]) => crate(g, x + ((lt * 30) % 10), 596, { kind, no, w: 124, h: kind === 'local' ? 76 : 90 }));
  stationBench(g, -1, 0);
  belt(g, 150, 1185, 770, lt, { v: -170, legs: false, frame: C.paintD });
  elevator(g, ST15.lift, 600, 776);
  bigCrate(g, ST15.cx, 600, { w: 250, h: 120, open: 1, label: '父任务' });
  for (const x of TUBES) tubeBack(g, x, TUBE.y0, TUBE.y1);
  TUBES.forEach((x, i) => { const u = (lt * .8 + i * .23) % 1; capsule(g, x, lerp(DOCK, TUBE.y0 - 30, Math.abs(Math.sin(u * Math.PI))), { state: 'ok', glow: .3 }); });
  for (const x of TUBES) tubeFront(g, x, TUBE.y0, TUBE.y1, lt);
  manifold(g, TUBES, TUBE.man, lt, {});
  cloudDuct(g, TUBES[0] - 60, TUBES[7] + 60, TUBE.duct, lt);
  robot(g, 1395, FLOOR, [1300 + wob(lt, .3, 8), 380 + wob(lt, .25, 8)], lt, { state: 'run' });
  cabinet(g, 1500, 300, 360, 440, lt, (gg, sx, sy, sw, sh) => { scrText(gg, '一个工位', sx + 16, sy + 34, { s: 26 }); scrText(gg, '同时等八个请求', sx + 16, sy + 76, { s: 26, c: '#FFE08A' }); }, { sh: 120 });
}
S('s29', {
  cam: [[0, 960, 480, 1.0], [7.3, 960, 480, 1.0], [7.6, 1180, 440, 1.32], [11, 900, 470, .9]],
  cues: [[.2, 'type', .5], ...Array.from({ length: 10 }, (_, i) => [.6 + i * .3, 'tick', .4]), [4.0, 'confirm'], [7.5, 'whoosh', .6], [8.0, 'swell']],
  draw(g, lt, sc, frame) {
    if (lt > 7.2) panorama(g, lt, frame);
    if (lt < 7.6) {
      g.save(); g.globalAlpha *= 1 - seg(lt, 7.2, 7.6);
      hall(g, frame);
      const lines = TERM29.concat(lt > 4.4 ? ['真实等待：退避 500ms · 屏障 900ms'] : []);
      const shown = Math.min(lines.length, 1 + Math.floor(seg(lt, .3, 3.6) * 11) + (lt > 3.9 ? 1 : 0) + (lt > 4.4 ? 1 : 0));
      codePanel(g, 460, 150, 1000, lines.slice(0, shown), 1, lt, { title: 'demo · 真实源码编译', hl: lt > 3.9 ? 11 : null, hlC: C.green, lh: 44, cursor: true });
      g.restore();
    }
  },
});


/* ---------------- 统一注册（未实现的幕用占位画面） ---------------- */
const TODO = id => ({ draw(g, lt, sc, frame) { hall(g, frame); sign(g, SCRIPT[id].name, 960, 450, { s: 40 }); } });
for (const id of Object.keys(SCRIPT)) if (!ONLY || ONLY.includes(id)) register(id, DEFS[id] || TODO(id));

film.finish();
