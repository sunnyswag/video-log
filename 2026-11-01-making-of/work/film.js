/* =====================================================================
 * Claude 是怎么做这 8 期视频的（v2）—— 场景编排（字幕在 script.js，图元在 kit.js）
 * 结构：0 开场、1 片名、2 准备、3 流水线（STEP 1–6）、4 分身、5 小插曲、6 第二批、7 上架、8 片尾。
 * 叙述者是“我”（橙色像素小角色）；你的原话以右上角气泡出现。动作尽量踩在 110 BPM 的节拍上。
 * 所有绘制只依赖时间 t。
 * ===================================================================== */
'use strict';
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事' };
const CARD = { 2: '准备', 3: '流水线', 4: '分身', 6: '第二批', 7: '上架' };
const B1 = ['sip-v3', 'curtain', 'taskqueue', 'cards'], B2 = ['subscription', 'jsruntime', 'frameanim', 'fps'], ALL = [...B1, ...B2];
const LABEL = { s01: '开场', s03: '准备 · 手册', s04: 'STEP 1 · 写稿', s05: 'STEP 2 · 核对', s06: 'STEP 3 · 画面', s07: 'STEP 4 · 配乐', s08: 'STEP 5 · 检查', s09: 'STEP 6 · 渲染',
  s10: '分身', s11: '分身', s12: '小插曲', s13: '第二批', s14: '上架', s15: '收工', s16: '回到对话' };
const FILM_DUR = Object.values(SCRIPT).reduce((a, d) => a + d.dur, 0), TOTAL_FR = Math.round(FILM_DUR * FPS);
const START = (() => { const o = {}; let t = 0; for (const id of Object.keys(SCRIPT)) { o[id] = t; t += SCRIPT[id].dur; } return o; })();

/* ---------------- 引擎与钩子 ---------------- */
const film = FilmKit.create({
  W, H, FPS, fontsNeeded,
  fonts: { cjk: F.cjk, disp: F.disp, mono: F.mono },
  theme: { bg: C.bg0, white: C.ink, cyan: C.orange, red: C.red, amber: C.amber },
  captions: { font: { f: 'cjk', s: 54, w: 700 }, colors: { emphasis: C.ochre, danger: C.red, accent: C.amber },
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

/* 章节转场：赭橙色带从左扫到右，我在色带前沿奔跑把它拉过去 */
function chapterWipe(g, { sc, lt, t }) {
  const name = CARD[sc.card]; if (!name || lt > 1.95) return;
  const sub = CHAPTERS[sc.card][0].split('｜').pop();
  const pin = eio(seg(lt, 0, .5)), pout = eio(seg(lt, 1.4, 1.92));
  const x0 = lerp(-W - 300, -150, pin) + lerp(0, W + 500, pout);
  const band = new Path2D(); band.moveTo(x0, 0); band.lineTo(x0 + W + 300, 0); band.lineTo(x0 + W + 150, H); band.lineTo(x0 - 150, H); band.closePath();
  g.save();
  g.save(); shadow(g, .5, 40, 0); g.fillStyle = C.ochre; g.fill(band); g.restore();
  g.clip(band);
  for (let k = 0; k < 30; k++) { const yy = 60 + k * 36; g.fillStyle = 'rgba(26,18,13,.05)'; g.fillRect(x0 - 200 + hash(k) * 300, yy, 200 + hash(k * 3) * 500, 10); }
  const a = eo(seg(lt, .3, .6)) * (1 - eo(seg(lt, 1.3, 1.5))), dx = (1 - eo(seg(lt, .3, .75))) * 70;
  text(g, name, 960 + dx, 470, { f: 'title', s: 150, w: 900, c: C.dark, ls: 10, al: a });
  text(g, sub, 960 + dx * .6, 600, { s: 40, w: 700, c: rgba(C.dark, .8), ls: 4, al: a });
  g.restore();
  // 我在色带前沿跑
  const fx = (lt < 1.4 ? x0 + W + 230 : x0 + W + 230), fy = 760;
  if (fx > -100 && fx < W + 100) hero(g, fx, fy, 1.3, t, { pose: 'walk', face: 'happy' });
}

/* 外框：左 STEP/段落名，中片名，右帧计数 */
function drawChrome(g, { sc, lt, t }) {
  CAMZ = 1;
  if (sc.title) return;
  const a = sc.card ? eo(seg(lt, 1.6, 2.1)) : 1;
  g.save(); g.globalAlpha *= a;
  const lab = LABEL[sc.id] || '';
  if (lab) { rr(g, 56, 48, 14, 14, 3); g.fillStyle = C.orange; g.fill(); text(g, lab, 84, 56, { s: 26, w: 700, a: 'left', c: C.ink }); }
  text(g, 'Claude 是怎么做视频的', 960, 56, { f: 'title', s: 26, w: 700, c: C.ink3, ls: 4 });
  const fr = Math.min(TOTAL_FR, Math.floor(t * FPS) + 1);
  text(g, `第 ${String(fr).padStart(4, '0')} 帧 / 共 ${TOTAL_FR} 帧`, 1864, 56, { f: 'mono', s: 24, w: 700, a: 'right', c: C.ink3 });
  path(g, [[56, 92], [1864, 92]], { c: 'rgba(243,233,218,.07)', w: 2 });
  g.restore();
}

/* 字幕：奶白粗体，暗色圆角底板，下沿细橙线 */
function capState(g, frame) {
  const { sc, lt } = frame; if (sc.title || sc.noCaption || !sc.captions?.length) return null;
  const i = sc.cs.findIndex((s, k) => lt >= s && lt < sc.ce[k]); if (i < 0) return null;
  const c = { t0: sc.start + sc.cs[i], t1: sc.start + sc.ce[i], text: sc.captions[i].text }, layout = film.captionLayout(g, c, frame.t);
  if (!layout) return null;
  return { layout, alpha: Math.min(seg(lt, sc.cs[i], sc.cs[i] + .12), 1 - seg(lt, sc.ce[i] - .12, sc.ce[i])) };
}
function drawCaptionBackground(g, frame) {
  CAMZ = 1; const c = capState(g, frame); if (!c) return;
  const L = c.layout.lines, w = Math.max(...L.map(l => l.width)) + 90, top = L[0].y - 66, h = (L.length - 1) * 64 + 98, x = (W - w) / 2;
  const k = eo(seg(frame.t, c.layout.caption.t0, c.layout.caption.t0 + .3));
  g.save(); g.globalAlpha *= c.alpha;
  shadow(g, .5, 24, 8); rr(g, x, top + (1 - k) * 8, w, h, 20); g.fillStyle = 'rgba(22,16,12,.9)'; g.fill(); noShadow(g);
  rr(g, x + 30, top + h - 6 + (1 - k) * 8, (w - 60) * k, 4, 2); g.fillStyle = C.orange; g.fill();
  g.restore();
}
function drawCaption(g, layout, frame) {
  if (frame.sc.title || frame.sc.noCaption || frame.t >= layout.caption.t1) return;
  const k = eo(seg(frame.t, layout.caption.t0, layout.caption.t0 + .25));
  g.globalAlpha = Math.min(seg(frame.t, layout.caption.t0, layout.caption.t0 + .12), 1 - seg(frame.t, layout.caption.t1 - .12, layout.caption.t1));
  for (const l of layout.lines) {
    let x = l.x;
    for (const s of l.segments) {
      const w = textW(g, s.s, { s: 54, w: 700 });
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
    captions: d.caps.map(([t, end, text]) => ({ t, end, text })),
    cues: (o.cues || []).map(([t, type, v]) => ({ t, type, v: v ?? 1 })),
    draw: (g, lt, sc) => o.draw(g, lt, sc.start + lt, sc),
  });
}
const CS = id => SCRIPT[id].caps.map(c => c[0]);
const CE = id => SCRIPT[id].caps.map(c => c[1]);
const ap = (lt, t0, d = .5) => pop(seg(lt, t0, t0 + d));
const fa = (lt, t0, d = .4) => eo(seg(lt, t0, t0 + d));
const fo = (lt, t0, d = .4) => 1 - eo(seg(lt, t0, t0 + d));
const typedN = (lt, t0, cps = 14) => Math.floor(Math.max(0, lt - t0) * cps);
/* 抛物线跳：从 a 到 b，时长 d，高 hgt；返回 [x, y, 挤压] */
function hopPos(lt, t0, d, a, b, hgt = 120) {
  const u = seg(lt, t0, t0 + d);
  const x = lerp(a[0], b[0], u), y = lerp(a[1], b[1], u) - Math.sin(u * Math.PI) * hgt;
  const land = lt - t0 - d, sq = u <= 0 ? 0 : u < 1 ? -.08 * Math.sin(u * Math.PI) : land < .25 ? .16 * Math.sin(land / .25 * Math.PI) : 0;
  return [x, y, sq];
}
const GROUND = 820;

/* =====================================================================
 * 开场：对话
 * ===================================================================== */
const CHAT = { x: 520, y: 140, w: 920, h: 720 };
function chatMessages(c) {
  return [
    { who: 'you', s: '主要说明这 8 期视频是如何做出来的', t0: .3, cps: 16 },
    { who: 'me', s: '好，边演边讲。', t0: 3.0, cps: 20 },
    { who: 'me', kind: 'eps', t0: c[0] + .2, h: 128 },
    { who: 'me', kind: 'list', t0: c[1] + .1, h: 136 },
    { who: 'me', s: '只有代码  </>', t0: c[2] + .2, cps: 20 },
    { who: 'me', s: '秘诀：分身。', t0: c[3] + .2, cps: 20 },
  ];
}
function drawChat(g, msgs, lt, t, o = {}) {
  const { x, y, w, h } = CHAT;
  chatWin(g, x, y, w, h, { t, placeholder: o.placeholder });
  const top = y + 80, bottom = y + h - 100, area = bottom - top;
  const hs = msgs.map(m => m.h || 72);
  let tot = 0; msgs.forEach((m, i) => { tot += (hs[i] + 18) * eo(seg(lt, m.t0, m.t0 + .35)); });
  const scroll = Math.max(0, tot - area);
  g.save(); rr(g, x + 4, top - 10, w - 8, area + 14, 4); g.clip();
  let yy = top - scroll;
  msgs.forEach((m, i) => {
    const e = eo(seg(lt, m.t0, m.t0 + .35)); if (e <= 0) return;
    const bx = m.who === 'you' ? x + w - 30 : x + 30;
    if (m.kind === 'eps') {
      g.save(); g.globalAlpha *= e; rr(g, bx, yy, 560, 128, 18); g.fillStyle = C.orange; g.fill();
      ALL.forEach((s, k) => { const p = ap(lt, m.t0 + .2 + k * .12, .35); at(g, bx + 44 + k * 42, yy + 46, p, () => { rr(g, -15, -15, 30, 30, 5); g.fillStyle = EPC[s]; g.fill(); rr(g, -15, -15, 30, 30, 5); g.lineWidth = 2; g.strokeStyle = C.dark; g.stroke(); }); });
      text(g, '8 期 · 44:27', bx + 30, yy + 98, { f: 'title', s: 36, w: 900, a: 'left', c: C.dark, al: fa(lt, m.t0 + 1.3) });
      g.restore();
    } else if (m.kind === 'list') {
      g.save(); g.globalAlpha *= e; rr(g, bx, yy, 340, 136, 18); g.fillStyle = C.orange; g.fill();
      ['摄像机', '剪辑软件'].forEach((s, k) => { const ly = yy + 42 + k * 52, sw = textW(g, s, { s: 32, w: 700 }); text(g, s, bx + 30, ly, { s: 32, w: 700, a: 'left', c: C.dark });
        const st = eo(seg(lt, m.t0 + .4 + k * .8, m.t0 + .7 + k * .8)); if (st > 0) path(g, [[bx + 24, ly + 2], [bx + 24 + (sw + 14) * st, ly + 2]], { c: C.red, w: 5 });
        if (st >= 1) icCross(g, bx + 300, ly, 26, C.red, 1, 5); });
      g.restore();
    } else {
      const n = typedN(lt, m.t0, m.cps);
      bubble(g, bx, yy, m.s, m.who, n, { p: e, fs: 30 });
    }
    yy += (hs[i] + 18) * e;
  });
  if (o.typing) typingDots(g, x + 30, yy, t, o.typing);
  g.restore();
}
S('s01', {
  fi: .5,
  cam: [[0, 960, 520, 1.04], [3.0, 960, 530, 1.02], [SCRIPT.s01.dur, 960, 540, 1]],
  cues: (() => { const c = CS('s01'); return [[.3, 'type', .5], [2.4, 'hop'], [3.0, 'type', .4], [c[0] + .2, 'pop'], ...ALL.map((_, k) => [c[0] + .4 + k * .12, 'tick', .5]), [c[1] + .1, 'pop'], [c[1] + .5, 'snip', .7], [c[1] + 1.3, 'snip', .7], [c[2] + .2, 'ding'], [c[3] + .2, 'pop'], [c[3] + .8, 'poof']]; })(),
  draw(g, lt, t) {
    const c = CS('s01'), msgs = chatMessages(c);
    drawChat(g, msgs, lt, t, { typing: lt > 2.4 && lt < 3.0 ? 1 : 0 });
    // 我：从下面蹦出来，挥手，之后待机；最后分身
    if (lt > 2.2) {
      const [x, y, sq] = hopPos(lt, 2.2, BEAT, [330, 960], [330, GROUND], 220);
      const pose = lt < 2.2 + BEAT ? 'hop' : lt < 4.4 ? 'wave' : lt > c[3] + .8 ? 'wave' : 'idle';
      const split = lt > c[3] + .8;
      if (split) [-1, 1, -2, 2].forEach((k, i) => { const p = ap(lt, c[3] + .9 + i * .1, .4); if (p > 0) hero(g, 330 + k * 70, GROUND - 6 - Math.abs(k) * 4, .62 * p, t + i * .3, { pose: 'idle', face: 'happy', seed: i + 1 }); });
      hero(g, x, y, 1.45, t, { pose, sq, face: lt > c[2] ? 'happy' : 'normal' });
      poof(g, 330, GROUND - 40, lt - c[3] - .8, 110);
    }
  },
});

/* =====================================================================
 * 片名
 * ===================================================================== */
S('s02', {
  title: true,
  cues: [[.2, 'whoosh', .6], [1.5, 'hop'], [1.5 + BEAT, 'pop'], [3.0, 'pop', .5], [3.15, 'pop', .5], [3.3, 'pop', .5], [3.45, 'pop', .5], [4.6, 'pop', .6]],
  draw(g, lt, t) {
    const lines = [['Claude 是怎么做', 400], ['这 8 期视频的', 540]], o = { f: 'title', s: 124, w: 900, ls: 6 };
    lines.forEach(([s, y], li) => {
      const chars = Array.from(s), tw = textW(g, s, o); let x = 960 - tw / 2;
      chars.forEach((ch, i) => { const w = textW(g, ch, o), p = seg(lt, .2 + li * .4 + i * .05, .65 + li * .4 + i * .05);
        at(g, x + w / 2, y + (1 - eo(p)) * 60, .5 + .5 * pop(p), () => text(g, ch, 0, 0, { ...o, ls: 0, c: ch === '8' ? C.orange : C.ink }), { al: eo(p) }); x += w; });
    });
    // 4 个分身从字后面探头
    [700, 860, 1060, 1220].forEach((x, i) => { const p = eo(seg(lt, 3.0 + i * .15, 3.4 + i * .15)); if (p > 0) { g.save(); g.beginPath(); g.rect(0, 0, W, 470); g.clip(); hero(g, x, 470 + (1 - p) * 60, .5, t + i * .4, { face: 'happy', seed: i }); g.restore(); } });
    // 我跳上片名
    if (lt > 1.5) { const [x, y, sq] = hopPos(lt, 1.5, BEAT * 2, [-80, 760], [1430, 334], 300); hero(g, x, y, 1.0, t, { pose: lt < 1.5 + BEAT * 2 ? 'hop' : 'wave', sq, face: 'happy' }); }
    text(g, '一本手册 · 几个分身 · 两个帮手', 960, 670, { s: 38, w: 700, c: C.ink2, ls: 6, al: fa(lt, 4.0, .6) });
    if (lt > 4.6) { zcode(g, 640, 840, 1, t, { prop: 'book', al: fa(lt, 4.6) }); codex(g, 1280, 840, 1, t, { prop: 'wrench', al: fa(lt, 4.7) }); }
  },
});

/* =====================================================================
 * 准备：手册
 * ===================================================================== */
S('s03', {
  cues: (() => { const c = CS('s03'); return [[c[0] + .6, 'pop'], [c[1], 'flip'], ...[0, 1, 2].map(k => [c[1] + .5 + k * .8, 'tick', .7]), [c[2], 'flip', .6], ...ALL.map((_, k) => [c[2] + .5 + k * .12, 'pop', .5]), [c[2] + 1.6, 'hop']]; })(),
  draw(g, lt, t) {
    const c = CS('s03');
    const wx = lerp(-120, 470, eio(seg(lt, 1.3, 2.6)));
    const open = eio(seg(lt, c[1], c[1] + .6)) * (1 - eio(seg(lt, c[2], c[2] + .5)));
    const bs = ap(lt, c[0] + .6, .5);
    if (bs > 0) handbook(g, 1080, 440, bs * (1 - .25 * eio(seg(lt, c[2], c[2] + .6))), open, {
      left: (gg, W2, H2, k) => ['流程', '分工', '规矩'].forEach((s, i) => { const p = ap(lt, c[1] + .4 + i * .2, .4); if (p <= 0) return; at(gg, -W2 * k + 70, -90 + i * 80, p, () => { rr(gg, -50, -24, 120, 48, 10); gg.fillStyle = [C.orange, C.zc, C.cx][i]; gg.fill(); text(gg, s, 10, 1, { s: 28, w: 900, c: C.dark }); }); }),
      right: (gg, W2, H2) => ['一期怎么做', '谁做什么', '哪些坑别踩'].forEach((s, i) => { const t0 = c[1] + .5 + i * .8; if (lt < t0) return; const y = -90 + i * 84; icCheck(gg, 36, y, 30, C.orange, seg(lt, t0, t0 + .3), 6); text(gg, s, 62, y + 1, { s: 30, w: 900, a: 'left', c: C.dark, al: fa(lt, t0) }); }),
    });
    // 复印出 8 本小册子
    ALL.forEach((s, k) => { const p = ap(lt, c[2] + .5 + k * .12, .4); if (p <= 0) return; at(g, 420 + k * 154, 760, p, () => { rr(g, -44, -60, 88, 120, 8); g.fillStyle = C.orange; g.fill(); g.fillStyle = EPC[s]; g.fillRect(-44, -60, 18, 120); text(g, String(k + 1), 10, -4, { f: 'title', s: 40, w: 900, c: C.dark }); }); });
    const jump = lt > c[2] + 1.6 ? hopPos(lt, c[2] + 1.6, BEAT, [470, 640], [470, 640], 70) : [wx, 640, 0];
    hero(g, jump[0], jump[1], 1.45, t, { pose: lt < 2.6 ? 'walk' : lt > c[2] + 1.6 && lt < c[2] + 1.6 + BEAT ? 'hop' : 'idle', sq: jump[2], face: lt > c[2] ? 'happy' : 'normal' });
  },
});

/* =====================================================================
 * 流水线：六步（顶上一条步骤轨道，我先跳上这一格，再跳下来干活）
 * ===================================================================== */
function stepHero(g, i, lt, t, t0, dest, o = {}) {
  // t0：开始跳；先从上一格跳到这一格（BEAT），停一拍，再跳到舞台 dest
  const a = i === 0 ? [stepX(0) - 220, STEP_Y - 26] : [stepX(i - 1), STEP_Y - 26], b = [stepX(i), STEP_Y - 26];
  if (lt < t0) return null;
  if (lt < t0 + BEAT * 2) { const [x, y, sq] = hopPos(lt, t0, BEAT, a, b, 46); hero(g, x, y, .5, t, { pose: lt < t0 + BEAT ? 'hop' : 'idle', sq }); return null; }
  const [x, y, sq] = hopPos(lt, t0 + BEAT * 2, BEAT * 1.5, b, dest, 120);
  const s = lerp(.5, o.s || 1.4, seg(lt, t0 + BEAT * 2, t0 + BEAT * 3.5));
  if (lt < t0 + BEAT * 3.5 + .3) { hero(g, x, y, s, t, { pose: 'hop', sq }); return null; }
  return { x: dest[0], y: dest[1], s: o.s || 1.4, sq };
}
const stepT0 = id => id === 's04' ? 1.9 : .1;
function paper(g, x, y, w, h, o = {}) {
  card(g, x, y, w, h, { r: 8, fill: '#F6ECDD', lw: 0, sa: .45, sb: 24, so: 10 });
  if (o.title) text(g, o.title, x + w / 2, y + 48, { f: 'title', s: 40, w: 900, c: C.dark });
}
S('s04', {
  cues: (() => { const c = CS('s04'); return [[1.9, 'hop', .7], [1.9 + BEAT * 2, 'hop'], [c[0] + .2, 'whoosh', .6], [c[0] + .8, 'pop', .6], [c[0] + 2.2, 'pop'], [c[1] + .3, 'type', .6], [c[1] + 1.4, 'type', .6]]; })(),
  draw(g, lt, t) {
    const c = CS('s04');
    stepTrack(g, 0, lt, { al: fa(lt, 1.6) });
    // ZCode 抱着一摞笔记飞进来，压成一张“知识点总结”
    const zx = lerp(2050, 1420, eio(seg(lt, c[0] + .1, c[0] + 1.0)));
    const comp = seg(lt, c[0] + 1.6, c[0] + 2.2);
    zcode(g, zx, GROUND, 1.25, t, { prop: comp < .5 ? 'stack' : 'book', n: Math.round(10 * (1 - comp)) || 1, fly: lt < c[0] + 1.0 });
    if (lt > c[0] + .8) nameTag(g, 'ZCode', zx, GROUND + 40, C.zc, seg(lt, c[0] + .8, c[0] + 1.2));
    const kp = ap(lt, c[0] + 2.2, .5);
    if (kp > 0) at(g, lerp(1420, 1250, eio(seg(lt, c[1], c[1] + .6))), lerp(520, 470, eio(seg(lt, c[1], c[1] + .6))), kp, () => { card(g, -150, -42, 300, 84, { r: 12, fill: C.cream, lw: 0 }); text(g, '知识点总结', 0, 1, { s: 32, w: 900, c: C.dark }); });
    // 写稿
    const pa = fa(lt, c[1] - .2);
    if (pa > 0) { g.save(); g.globalAlpha *= pa; paper(g, 760, 300, 360, 460, { title: '视频稿' });
      for (let k = 0; k < 7; k++) { const p = seg(lt, c[1] + .4 + k * .35, c[1] + .7 + k * .35); if (p > 0) { rr(g, 800, 380 + k * 50, (k % 3 === 2 ? 180 : 280) * p, 12, 6); g.fillStyle = 'rgba(26,18,13,.55)'; g.fill(); } }
      g.restore(); }
    const h = stepHero(g, 0, lt, t, stepT0('s04'), [620, GROUND]);
    if (h) hero(g, h.x, h.y, h.s, t, { pose: lt > c[1] ? 'type' : 'idle', prop: lt > c[1] ? 'pencil' : null, sq: h.sq });
  },
});

S('s05', {
  cues: (() => { const c = CS('s05'); return [[.1, 'hop', .7], [.1 + BEAT * 2, 'hop'], ...[0, 1, 2, 3, 4].map(k => [c[0] + .4 + k * .6, k === 2 ? 'snip' : 'tick', .7]), [c[0] + 3.6, 'ding']]; })(),
  draw(g, lt, t) {
    const c = CS('s05');
    stepTrack(g, 1, lt);
    paper(g, 760, 300, 400, 480, { title: '视频稿' });
    const ly = k => 400 + k * 62;
    for (let k = 0; k < 5; k++) {
      const t0 = c[0] + .4 + k * .6, w = k % 2 ? 230 : 300;
      rr(g, 800, ly(k) - 6, w, 12, 6); g.fillStyle = 'rgba(26,18,13,.55)'; g.fill();
      if (k === 2 && lt > t0) { path(g, [[796, ly(k)], [796 + (w + 8) * eo(seg(lt, t0, t0 + .25)), ly(k)]], { c: C.red, w: 5 }); if (lt > t0 + .3) { rr(g, 800, ly(k) + 16, 200 * eo(seg(lt, t0 + .3, t0 + .6)), 10, 5); g.fillStyle = C.orangeD; g.fill(); } }
      if (lt > t0 + .2) icCheck(g, 1120, ly(k), 30, k === 2 ? C.orange : '#4E9A5C', seg(lt, t0 + .2, t0 + .45), 6);
    }
    const k = clamp((lt - c[0] - .4) / .6, 0, 4.4);
    zcode(g, 1300, ly(0) + k * 62 + 70, 1.1, t, { prop: 'lens', fly: true });
    const h = stepHero(g, 1, lt, t, stepT0('s05'), [560, GROUND]);
    if (h) hero(g, h.x, h.y, h.s, t, { face: lt > c[0] + 3.6 ? 'happy' : 'normal', sq: h.sq });
  },
});

const CODE_V2 = ['function render(canvas, t) {', '  const 幕 = 找到这一幕(t);', '  幕.画(canvas, t);', '}', '// 只看 t，不记上一帧'];
S('s06', {
  cues: (() => { const c = CS('s06'); return [[.1, 'hop', .7], [.1 + BEAT * 2, 'hop'], [c[0] + .4, 'pop'], [c[0] + 1.2, 'snip', .6], [c[0] + 1.8, 'ding'], [c[1] + .3, 'bloop'], [c[1] + .6, 'type', .6], [c[2] + .3, 'tick'], [c[2] + 1.6, 'tick']]; })(),
  draw(g, lt, t) {
    const c = CS('s06');
    stepTrack(g, 2, lt);
    // 第一句：两个画框对比
    const a1 = fa(lt, c[0]) * fo(lt, c[1] - .1);
    if (a1 > 0) {
      g.save(); g.globalAlpha *= a1;
      pane(g, 420, 320, 460, 300, '交给帮手写', C.ink3, (gg, w, h) => { gg.fillStyle = '#CFCAC2'; gg.fillRect(0, 0, w, h); gg.fillStyle = '#8E949E'; gg.fillRect(50, 90, 110, 90); gg.fillRect(w - 160, 90, 110, 90); gg.fillRect(160, 132, w - 320, 6); gg.fillStyle = '#5B6CC0'; gg.fillRect(Math.floor(lt * 2) % 2 ? 250 : 190, 120, 40, 26); });
      pane(g, 1040, 320, 460, 300, '我自己写', C.orange, (gg, w, h) => thumb(gg, 'sip-v3', w, h, t));
      if (lt > c[0] + 1.2) icCross(g, 860, 320, 44, C.red, seg(lt, c[0] + 1.2, c[0] + 1.5), 9);
      if (lt > c[0] + 1.8) { dot(g, 1490, 320, 34 * pop(seg(lt, c[0] + 1.8, c[0] + 2.2)), C.green); icCheck(g, 1490, 322, 40, C.dark, seg(lt, c[0] + 1.9, c[0] + 2.2), 7); }
      g.restore();
    }
    // 第二、三句：代码窗 + 画框 + 时间滑块
    const a2 = fa(lt, c[1] - .1);
    if (a2 > 0) {
      g.save(); g.globalAlpha *= a2;
      codeWin(g, 300, 300, 760, 300, CODE_V2, typedN(lt, c[1] + .5, 40));
      const tt = 1 + Math.sin((lt - c[2]) * 1.6) * .9, ballX = 80 + tt * 180, ballY = 200 - Math.abs(Math.sin(tt * 3)) * 140;
      const fa3 = fa(lt, c[2] - .1);
      g.save(); g.globalAlpha *= fa3;
      pane(g, 1180, 300, 440, 300, '画出的那一帧', C.orange, (gg, w, h) => { gg.fillStyle = '#100B08'; gg.fillRect(0, 0, w, h); gg.fillStyle = C.line; gg.fillRect(20, 214, w - 40, 4); dot(gg, ballX, ballY, 22, C.orange); });
      arrow(g, [[1070, 450], [1166, 450]], { c: C.orange, w: 5, hs: 16, p: fa(lt, c[2]) });
      rr(g, 1200, 680, 400, 10, 5); g.fillStyle = C.line; g.fill(); const kx = 1200 + 400 * (tt / 2); dot(g, kx, 685, 16, C.orange); ring(g, kx, 685, 16, C.cream, 3, 1, 0, TAU);
      text(g, `t = ${tt.toFixed(2)} s`, 1400, 734, { f: 'mono', s: 28, w: 700, c: C.ink });
      g.restore(); g.restore();
    }
    const h = stepHero(g, 2, lt, t, stepT0('s06'), [560, GROUND]);
    if (h) {
      if (lt > c[1] + .1 && lt < c[1] + .1 + BEAT * 1.5) { const [x, y, sq] = hopPos(lt, c[1] + .1, BEAT * 1.5, [560, GROUND], [520, 600], 220); hero(g, x, y, lerp(1.1, .6, seg(lt, c[1] + .1, c[1] + .1 + BEAT * 1.5)), t, { pose: 'hop', sq }); burst(g, 520, 590, lt - c[1] - .1 - BEAT * 1.4, C.orange, 10, 90); }
      else if (lt >= c[1] + .1 + BEAT * 1.5) { hero(g, 990, 590, .6, t, { pose: 'type', face: 'happy' }); }
      else hero(g, h.x, h.y, h.s, t, { sq: h.sq });
    }
  },
});

S('s07', {
  cues: (() => { const c = CS('s07'); return [[.1, 'hop', .7], [.1 + BEAT * 2, 'hop'], [c[0] + .4, 'pop', .6], ...[0, 1, 2, 3].map(k => [c[0] + .8 + k * BEAT * 2, 'pop', .5]), [c[0] + 2.4, 'type', .6]]; })(),
  draw(g, lt, t) {
    const c = CS('s07');
    stepTrack(g, 3, lt);
    codex(g, 1200, GROUND, 1.25, t, { al: fa(lt, c[0] - .3) });
    if (lt > c[0] + .4) nameTag(g, 'Codex', 1200, GROUND + 40, C.cx, seg(lt, c[0] + .4, c[0] + .8));
    // 终端 + 声波
    const ta = fa(lt, c[0] + .2);
    g.save(); g.globalAlpha *= ta;
    card(g, 1060, 330, 560, 300, { r: 14, fill: '#120D0A', lw: 2, stroke: C.line });
    text(g, 'audio.py', 1090, 366, { f: 'mono', s: 26, w: 700, a: 'left', c: C.cxL });
    const n = Math.floor(clamp((lt - c[0] - .8) / 3.2) * 24);
    for (let k = 0; k < n; k++) { const hh = 20 + 70 * Math.abs(Math.sin(k * 1.7 + t * 4)) * (k % 4 === 0 ? 1 : .6); rr(g, 1090 + k * 21, 520 - hh / 2, 12, hh, 6); g.fillStyle = k % 4 === 0 ? C.orange : C.cx; g.fill(); }
    g.restore();
    // 音符从指挥棒飘向 Codex
    for (let k = 0; k < 4; k++) { const t0 = c[0] + .8 + k * BEAT * 2, u = seg(lt, t0, t0 + .9); if (u <= 0 || u >= 1) continue;
      const x = lerp(760, 1180, u), y = 600 - Math.sin(u * Math.PI) * 180; at(g, x, y, 1, () => { pxMap(g, ['..aa', '..ab', '..a.', 'aaa.', 'aaa.'], { a: C.amber, b: C.amber }, 7, -14, -18); }); }
    const h = stepHero(g, 3, lt, t, stepT0('s07'), [620, GROUND]);
    if (h) hero(g, h.x, h.y, h.s, t, { pose: lt > c[0] ? 'type' : 'idle', prop: lt > c[0] ? 'baton' : null, sq: h.sq });
  },
});

S('s08', {
  cues: (() => { const c = CS('s08'); return [[.1, 'hop', .7], [.1 + BEAT * 2, 'hop'], ...[0, 1, 2, 3, 4].map(k => [c[0] + .3 + k * .45, k === 3 ? 'bonk' : 'tick', .6]), [c[0] + 2.8, 'ding', .6], ...Array.from({ length: 12 }, (_, k) => [c[1] + .2 + k * .17, 'tick', .4]), [c[1] + 2.4, 'ding']]; })(),
  draw(g, lt, t) {
    const c = CS('s08');
    stepTrack(g, 4, lt);
    // Codex 的检查清单
    const la = fa(lt, c[0] - .2);
    g.save(); g.globalAlpha *= la;
    paper(g, 360, 300, 420, 430, { title: 'checks' });
    ['时间线', '字号', '文字重叠', '确定性', '出画'].forEach((s, k) => { const t0 = c[0] + .3 + k * .45, y = 400 + k * 62; text(g, s, 410, y, { s: 30, w: 700, a: 'left', c: C.dark });
      if (lt > t0) { if (k === 3 && lt < t0 + .5) icCross(g, 730, y, 28, C.red, seg(lt, t0, t0 + .2), 6); else icCheck(g, 730, y, 30, '#4E9A5C', seg(lt, k === 3 ? t0 + .5 : t0, (k === 3 ? t0 + .5 : t0) + .25), 6); } });
    g.restore();
    codex(g, 260, GROUND, 1.1, t, { prop: 'list' });
    // 我拿放大镜看缩略图墙
    const ga = fa(lt, c[1] - .3);
    if (ga > 0) {
      g.save(); g.globalAlpha *= ga;
      for (let k = 0; k < 12; k++) { const x = 940 + (k % 4) * 170, y = 310 + Math.floor(k / 4) * 112; g.save(); rr(g, x, y, 156, 96, 8); g.clip(); g.translate(x, y); thumb(g, ALL[k % 8], 156, 96, t + k); g.restore(); rr(g, x, y, 156, 96, 8); g.lineWidth = 2; g.strokeStyle = C.line; g.stroke();
        const t0 = c[1] + .2 + k * .17; if (lt > t0) { dot(g, x + 138, y + 18, 13, C.green); icCheck(g, x + 138, y + 19, 15, C.dark, seg(lt, t0, t0 + .15), 3); } }
      const pass = lt < c[1] + 1.0 ? 1 : lt < c[1] + 1.7 ? 2 : 3;
      text(g, `第 ${pass} 遍`, 1280, 668, { s: 32, w: 900, c: C.orange });
      g.restore();
    }
    const h = stepHero(g, 4, lt, t, stepT0('s08'), [800, GROUND]);
    if (h) hero(g, h.x, h.y, h.s, t, { prop: lt > c[1] ? 'lens' : null, sq: h.sq, face: lt > c[1] + 2.4 ? 'happy' : 'normal' });
  },
});

const SEGD = [275, 381, 335, 244, 249, 337, 291, 349, 365, 252];   // 分段相对快慢（取自试点 v2 那次 4K 运行）
S('s09', {
  cues: (() => { const c = CS('s09'); const r = [[.1, 'hop', .7], [.1 + BEAT * 2, 'hop']]; for (let k = 1; k < 10; k++) r.push([c[0] + .4 + k * .2, 'snip', .5]); SEGD.slice().sort((a, b) => a - b).forEach(d => r.push([c[1] + .4 + (d - 240) / 145 * 2.4, 'tick', .5])); r.push([c[2] + 1.0, 'whoosh', .6], [c[2] + 1.9, 'ding']); return r; })(),
  draw(g, lt, t) {
    const c = CS('s09');
    stepTrack(g, 5, lt);
    const X0 = 300, X1 = 1620, sw = (X1 - X0) / 10;
    const drop = k => eio(seg(lt, c[1] + .05 + k * .04, c[1] + .5 + k * .04)), back = eio(seg(lt, c[2] + .9, c[2] + 1.5));
    const doneAt = k => c[1] + .4 + (SEGD[k] - 240) / 145 * 2.4;
    for (let k = 0; k < 10; k++) {
      const cx = X0 + k * 140 + 70, cy = 640;
      // 机器格
      const ma = fa(lt, c[1]) * (1 - back);
      if (ma > 0) { g.save(); g.globalAlpha *= ma; card(g, cx - 60, cy - 50, 120, 120, { r: 12, fill: '#1E1611', lw: 2, stroke: lt > doneAt(k) ? C.green : C.line }); text(g, String(k + 1), cx, cy - 18, { f: 'title', s: 30, w: 900, c: C.ink2 });
        const p = clamp((lt - c[1] - .4) / ((SEGD[k] - 240) / 145 * 2.4 + .01)); rr(g, cx - 40, cy + 34, 80, 12, 6); g.fillStyle = C.line; g.fill(); rr(g, cx - 40, cy + 34, 80 * p, 12, 6); g.fillStyle = p >= 1 ? C.green : C.orange; g.fill(); g.restore(); }
      // 胶片段：在长条上 → 掉进格子 → 拼回
      const gap = 10 * eo(seg(lt, c[0] + .4 + k * .2, c[0] + .6 + k * .2));
      const sx = lerp(lerp(X0 + k * sw + (k - 4.5) * gap * .4, cx - 50, drop(k)), X0 + k * sw, back), sy = lerp(lerp(420, cy - 40, drop(k)), 420, back);
      const ww = lerp(lerp(sw - 2, 100, drop(k)), sw, back), hh = lerp(lerp(70, 30, drop(k)), 70, back);
      const roll = eio(seg(lt, c[2] + 1.6, c[2] + 2.2));
      if (roll < 1) { g.save(); g.globalAlpha *= 1 - roll; rr(g, sx + roll * (960 - sx), sy, ww * (1 - roll * .9), hh, 4); g.fillStyle = '#2A1F18'; g.fill();
        for (let q = 0; q < 3; q++) { g.fillStyle = C.cream; g.fillRect(sx + roll * (960 - sx) + 6 + q * ww / 3, sy + 4, 8, 6); g.fillRect(sx + roll * (960 - sx) + 6 + q * ww / 3, sy + hh - 10, 8, 6); }
        g.fillStyle = rgba(EPC[ALL[k % 8]], .8); g.fillRect(sx + roll * (960 - sx) + 4, sy + 14, Math.max(0, ww * (1 - roll * .9) - 8), hh - 28); g.restore(); }
    }
    // 剪刀
    if (lt > c[0] + .2 && lt < c[0] + 2.4) { const k = clamp((lt - c[0] - .4) / .2 + 1, 1, 9); scissors(g, X0 + k * sw, 360, 1.1, Math.abs(Math.sin(lt * 14))); }
    // 卷成一卷，落到我手里
    const rp = seg(lt, c[2] + 2.0, c[2] + 2.6);
    if (rp > 0) { const [x, y] = hopPos(lt, c[2] + 2.0, .6, [960, 420], [280, GROUND - 120], 120); reel(g, x, y, 54, C.orange, t, { spin: 3 }); }
    const h = stepHero(g, 5, lt, t, stepT0('s09'), [180, GROUND]);
    if (h) hero(g, h.x, h.y, h.s, t, { face: rp >= 1 ? 'happy' : 'normal', armsUp: rp > .6, sq: h.sq });
  },
});

/* =====================================================================
 * 分身
 * ===================================================================== */
function hatShape(g, x, y, col, s = 1) { at(g, x, y, s, () => { const P = 9; g.fillStyle = col; g.fillRect(-4 * P, 0, 8 * P, P); g.fillRect(-3 * P, -2 * P, 6 * P, 2 * P); g.fillStyle = rgba('#000000', .25); g.fillRect(-3 * P, -P, 6 * P, P); }); }
const DESKX = k => 250 + k * 203;
function desk(g, k, al = 1) { const x = DESKX(k), col = EPC[ALL[k]]; g.save(); g.globalAlpha *= al; rr(g, x - 80, 800, 160, 22, 6); g.fillStyle = col; g.fill(); g.fillStyle = '#3B2F26'; g.fillRect(x - 70, 822, 12, 38); g.fillRect(x + 58, 822, 12, 38); g.restore(); }
S('s10', {
  cues: (() => { const c = CS('s10'); return [...[0, 1, 2, 3].map(k => [c[0] + .3 + k * BEAT, 'tick', .5]), [c[1] + .2, 'poof'], ...ALL.map((_, k) => [c[1] + .5 + k * .1, 'pop', .5]), [c[2], 'pop'], [c[2] + .6, 'poof', .7], ...[0, 1, 2, 3].map(k => [c[2] + .9 + k * BEAT * .5, 'hop', .6])]; })(),
  draw(g, lt, t) {
    const c = CS('s10');
    // 第一句：8 卷片子排队，我跺脚
    const qa = fa(lt, c[0] - .3) * fo(lt, c[1] + .2);
    if (qa > 0) { ALL.forEach((s, k) => reel(g, 1150 + k * 86, 700, 38, EPC[s], 0, { al: qa }));
      g.save(); g.globalAlpha *= qa; ring(g, 960, 470, 34, C.cream, 5, 1, 0, TAU); path(g, [[960, 470], [960 + Math.cos(lt * 6) * 24, 470 + Math.sin(lt * 6) * 24]], { c: C.orange, w: 5 }); g.restore(); }
    // 第二句：8 张工作台，台上各一顶帽子
    ALL.forEach((s, k) => {
      const p = ap(lt, c[1] + .5 + k * .1, .4); if (p <= 0) return;
      desk(g, k, Math.min(1, p));
      const b1 = k < 4, lit = b1 && lt > c[2] + .3;
      const take = b1 ? eio(seg(lt, c[2] + .9 + k * BEAT * .5, c[2] + 1.3 + k * BEAT * .5)) : 0;
      if (take < 1) { if (lit) dot(g, DESKX(k), 770, 46, rgba(EPC[s], .25 + .15 * Math.sin(t * 6))); hatShape(g, DESKX(k), 780 - take * 40, EPC[s], p); }
    });
    // 第三句：分出 4 个分身，各自戴上帽子
    B1.forEach((s, k) => {
      const t0 = c[2] + .9 + k * BEAT * .5; if (lt < t0) return;
      const [x, y, sq] = hopPos(lt, t0, BEAT, [960, 640], [DESKX(k), 790], 160);
      hero(g, x, y, .55, t + k * .3, { pose: lt < t0 + BEAT ? 'hop' : 'idle', hat: lt > t0 + BEAT * .6 ? EPC[s] : null, sq, face: 'happy', seed: k + 1 });
    });
    poof(g, 960, 600, lt - c[1] - .2, 140); poof(g, 960, 600, lt - c[2] - .6, 120);
    hero(g, 960, 640, 1.45, t, { face: lt > c[2] + 1 ? 'happy' : 'normal', armsUp: lt > c[2] + .6 && lt < c[2] + 1.2 });
    youSay(g, '可以先输出 4 个吧', seg(lt, c[2], c[2] + .4));
  },
});

const PANEX = k => 130 + k * 425, PANEY = 170, PANEW = 380, PANEH = 270;
S('s11', {
  cues: (() => { const c = CS('s11'); return [...[0, 1, 2, 3].map(k => [c[0] + .2 + k * .2, 'pop', .6]), ...[0, 1, 2, 3].map(k => [c[1] + .2 + k * BEAT, 'whoosh', .4]), ...[0, 1, 2, 3].map(k => [c[1] + 2.0 + k * .35, 'tick', .5]), [c[2], 'pop'], [c[2] + .6, 'whoosh', .7], ...[0, 1, 2, 3].map(k => [c[2] + 1.6 + k * .18, 'ding', .5])]; })(),
  draw(g, lt, t) {
    const c = CS('s11');
    const ff = seg(lt, c[2] + .5, c[2] + 1.5);
    B1.forEach((s, k) => {
      const p = ap(lt, c[0] + .2 + k * .2, .45); if (p <= 0) return;
      const rv = Math.max(clamp((lt - c[0] - .6 - k * .3) / 14) * .62, ff);
      at(g, PANEX(k) + PANEW / 2, PANEY + PANEH / 2, p, () => {
        pane(g, -PANEW / 2, -PANEH / 2, PANEW, PANEH, s, EPC[s], (gg, w, h) => growThumb(gg, s, w, h, t + k, rv), { done: ff >= 1 ? seg(lt, c[2] + 1.6 + k * .18, c[2] + 1.9 + k * .18) : 0 });
        hero(g, -PANEW / 2 + 52, PANEH / 2 - 8, .42, t + k * .25, { pose: 'type', hat: EPC[s], seed: k + 2 });
      });
    });
    // 帮手在窗格之间来回
    const zu = (lt * .22) % 1, zx = 300 + (zu < .5 ? zu * 2 : 2 - zu * 2) * 1320;
    zcode(g, zx, 560, .8, t, { prop: 'book', fly: true, dir: zu < .5 ? 1 : -1, al: fa(lt, .4) });
    const cu = (lt * .16 + .5) % 1, cxp = 300 + (cu < .5 ? cu * 2 : 2 - cu * 2) * 1320;
    codex(g, cxp, GROUND + 10, .8, t, { prop: 'wrench', dir: cu < .5 ? 1 : -1, al: fa(lt, .6) });
    // 我：抛任务卡，收片子
    for (let k = 0; k < 4; k++) { const t0 = c[1] + .2 + k * BEAT, u = seg(lt, t0, t0 + .6); if (u > 0 && u < 1) { const x = lerp(960, PANEX(k) + PANEW / 2, u), y = lerp(700, PANEY + PANEH, u) - Math.sin(u * Math.PI) * 120; at(g, x, y, 1, () => { rr(g, -30, -20, 60, 40, 6); g.fillStyle = C.cream; g.fill(); g.fillStyle = EPC[B1[k]]; g.fillRect(-22, -8, 44, 6); }, { rot: u * 6 }); } }
    const reels = [];
    for (let k = 0; k < 4; k++) { reels.push(c[1] + 2.0 + k * .35); reels.push(c[2] + 1.7 + k * .18); }
    reels.forEach((t0, j) => { if (lt < t0) return; const k = j >> 1 ? (j >> 1) % 4 : 0, kk = Math.floor(j / 2) % 4, from = [PANEX(kk) + PANEW / 2, PANEY + PANEH], to = [1110 + (j % 8) * 46, GROUND - 26]; const [x, y] = hopPos(lt, t0, .7, from, to, 80); reel(g, x, y, 24, EPC[B1[kk]], t, { spin: lt < t0 + .7 ? 6 : 0 }); });
    hero(g, 960, GROUND, 1.4, t, { pose: lt > c[1] && lt < c[1] + 2.4 ? 'wave' : 'idle', face: ff >= 1 ? 'happy' : 'normal' });
    youSay(g, '不用考虑制作样片了……可以直接出成片', seg(lt, c[2], c[2] + .4), { y: 486, fs: 26 });
  },
});

/* =====================================================================
 * 小插曲
 * ===================================================================== */
S('s12', {
  fi: .3,
  cues: (() => { const c = CS('s12'); return [[c[0] + 1.4, 'zzz'], [c[0] + 3.8, 'ding', .6], [c[1] + .9, 'bonk'], [c[1] + 1.6, 'pop', .6], [c[1] + 2.0, 'ding', .6]]; })(),
  draw(g, lt, t) {
    const c = CS('s12');
    const night = fa(lt, c[0] + .2, .6) * fo(lt, c[0] + 3.4, .6);
    nightSky(g, night, t); moon(g, 1500, 260, 46, night);
    sun(g, 1500, 260, 40, t, fa(lt, c[0] + 3.5) * fo(lt, c[1] + .2));
    const lvl = lt < c[0] + 1.4 ? 1 - seg(lt, c[0] + .3, c[0] + 1.4) : seg(lt, c[0] + 2.2, c[0] + 3.4);
    const ba = fo(lt, c[1] - .2);
    if (ba > 0) { g.save(); g.globalAlpha *= ba; battery(g, 905, 520, lvl); g.restore(); }
    const asleep = lt > c[0] + 1.4 && lt < c[0] + 3.8;
    if (lt < c[1]) {
      const [x, y, sq] = lt > c[0] + 3.8 ? hopPos(lt, c[0] + 3.8, BEAT, [960, GROUND], [960, GROUND], 90) : [960, GROUND, asleep ? .06 + .03 * Math.sin(t * 2) : 0];
      hero(g, x, y, 1.6, t, { pose: asleep ? 'sleep' : lt > c[0] + 3.8 ? 'hop' : 'idle', face: asleep ? 'sleep' : lt > c[0] + 3.8 ? 'happy' : 'normal', sq });
      if (asleep) zzz(g, 1040, 700, t);
      youSay(g, '其他的先暂停，等有 token 之后再做', seg(lt, c[0] + .6, c[0] + 1.0) * fo(lt, c[0] + 3.4), { fs: 26 });
    } else {
      const bump = c[1] + .9, wx = lt < bump ? lerp(960, 1170, eio(seg(lt, c[1], bump))) : lt < c[1] + 2.2 ? 1170 : lerp(1170, 1700, seg(lt, c[1] + 2.2, c[1] + 3.6));
      const sq = lt > bump && lt < bump + .3 ? -.14 * Math.sin((lt - bump) / .3 * Math.PI) : 0;
      barrier(g, 1300, GROUND, eio(seg(lt, c[1] + 2.0, c[1] + 2.4)));
      hero(g, wx, GROUND, 1.5, t, { pose: lt < bump || lt > c[1] + 2.2 ? 'walk' : 'idle', face: lt > bump && lt < c[1] + 2.0 ? 'wow' : 'normal', sq, dir: lt > bump && lt < c[1] + 1.6 ? -1 : 1 });
      if (lt > bump + .2 && lt < c[1] + 2.2) text(g, '?', 1170, 640 - Math.abs(Math.sin(t * 6)) * 8, { f: 'title', s: 64, w: 900, c: C.amber, al: fa(lt, bump + .2) });
      youSay(g, '✓', seg(lt, c[1] + 1.6, c[1] + 2.0), { fs: 34 });
    }
  },
});

/* =====================================================================
 * 第二批
 * ===================================================================== */
S('s13', {
  cues: (() => { const c = CS('s13'); return [...[0, 1, 2].map(k => [c[0] + .5 + k * .7, 'snip', .7]), [c[1], 'pop'], ...[0, 1, 2, 3].map(k => [c[1] + .6 + k * BEAT, 'whoosh', .4]), ...[0, 1, 2, 3].map(k => [c[1] + 1.0 + k * BEAT, 'hop', .5]), ...[0, 1, 2, 3].map(k => [c[2] + 1.4 + k * .4, 'ding', .6])]; })(),
  draw(g, lt, t) {
    const c = CS('s13');
    const night = fa(lt, c[2] - .1, .8);
    nightSky(g, night, t); moon(g, 1720, 200, 36, night);
    // 便签：写一张撕一张
    for (let k = 0; k < 3; k++) { const t0 = c[0] + .5 + k * .7, p = ap(lt, t0, .4), gone = lt > c[1] + .6 ? 1 : 0; if (p > 0 && !gone) note(g, 760 + k * 14, 560 - k * 10, p * .9, C.amber, { rot: (k - 1) * .08 }); }
    // 新来的 4 个分身
    B2.forEach((s, k) => {
      const x = 1180 + k * 170, p = ap(lt, c[1] + .1 + k * .1, .4); if (p <= 0) return;
      const t0 = c[1] + .6 + k * BEAT, u = seg(lt, t0, t0 + .5);
      if (u > 0 && u < 1) note(g, lerp(780, x, u), lerp(560, 690, u) - Math.sin(u * Math.PI) * 90, .45, C.amber, { rot: u * 4 });
      const [hx, hy, sq] = lt > t0 + .4 && lt < t0 + .4 + BEAT ? hopPos(lt, t0 + .4, BEAT, [x, GROUND], [x, GROUND], 40) : [x, GROUND, 0];
      hero(g, hx, hy, .62 * p, t + k * .3, { hat: EPC[s], face: lt > t0 + .5 ? 'happy' : 'normal', seed: k + 5, sq });
      if (lt > t0 + .5) note(g, x + 46, GROUND - 60, .3, C.amber);
    });
    // 夜里 4 格同时画满
    B2.forEach((s, k) => {
      const a = fa(lt, c[2] + .1 + k * .1); if (a <= 0) return;
      const rv = seg(lt, c[2] + .2, c[2] + 1.4 + k * .4);
      g.save(); g.globalAlpha *= a;
      pane(g, 150 + k * 410, 170, 360, 240, s, EPC[s], (gg, w, h) => growThumb(gg, s, w, h, t + k, rv), { done: seg(lt, c[2] + 1.4 + k * .4, c[2] + 1.7 + k * .4) });
      g.restore();
    });
    hero(g, 600, GROUND, 1.4, t, { pose: lt < c[1] ? 'type' : 'idle', prop: lt < c[1] ? 'pencil' : null, face: lt > c[2] + 2.6 ? 'happy' : 'normal' });
    youSay(g, '现在可以继续剩下的 4 个视频吗', seg(lt, c[1], c[1] + .4) * fo(lt, c[2]), { fs: 26 });
  },
});

/* =====================================================================
 * 上架
 * ===================================================================== */
S('s14', {
  cues: (() => { const c = CS('s14'); return [...ALL.map((_, k) => [c[0] + .2 + k * .14, 'pop', .6]), ...Array.from({ length: 8 }, (_, k) => [c[0] + 1.4 + k * .2, 'tick', .4]), [c[0] + 3.0, 'ding'], [c[1], 'pop'], [c[1] + 1.6, 'pop'], [c[1] + 1.8, 'ding', .7]]; })(),
  draw(g, lt, t) {
    const c = CS('s14');
    g.fillStyle = '#3B2F26'; g.fillRect(220, 560, 1480, 18); g.fillStyle = '#2A2019'; g.fillRect(240, 578, 18, 60); g.fillRect(1662, 578, 18, 60);
    ALL.forEach((s, k) => { const x = 315 + k * 184, p = ap(lt, c[0] + .2 + k * .14, .4); if (p <= 0) return;
      at(g, x, 500, p, () => reel(g, 0, 0, 56, EPC[s], t, { spin: .4 }));
      const q = ap(lt, c[0] + .5 + k * .14, .4); if (q > 0) at(g, x, 360, q, () => { g.save(); rr(g, -76, -44, 152, 88, 8); g.clip(); g.translate(-76, -44); thumb(g, s, 152, 88, t + k); g.restore(); rr(g, -76, -44, 152, 88, 8); g.lineWidth = 2; g.strokeStyle = EPC[s]; g.stroke(); }); });
    const secs = 2667 * eo(seg(lt, c[0] + 1.4, c[0] + 3.0));
    text(g, '8 期合计', 960, 662, { s: 28, w: 700, c: C.ink2, al: fa(lt, c[0] + 1.2) });
    text(g, `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`, 960, 744, { f: 'title', s: 96, w: 900, c: C.orange, al: fa(lt, c[0] + 1.2) });
    // 上传按钮 + 光标
    const ba = fa(lt, c[1] + .3);
    if (ba > 0) { const done = lt > c[1] + 1.7; g.save(); g.globalAlpha *= ba; rr(g, 1420, 760, 230, 76, 20); g.fillStyle = done ? C.green : C.orange; g.fill(); text(g, done ? '上传 ✓' : '上传', 1535, 799, { s: 34, w: 900, c: C.dark }); g.restore();
      const mv = eio(seg(lt, c[1] + .4, c[1] + 1.5)), pr = Math.sin(clamp((lt - c[1] - 1.5) / .3) * Math.PI);
      cursorHand(g, lerp(1820, 1560, mv), lerp(1000, 812, mv), 1, pr); ripple(g, 1540, 800, lt - c[1] - 1.6, C.cream, 20, 80, .5); }
    hero(g, 300, GROUND, 1.4, t, { pose: lt > c[1] + 1.8 ? 'wave' : 'idle', face: lt > c[0] + 3 ? 'happy' : 'normal' });
    youSay(g, '四期都没问题，合进 main 准备上传吧', seg(lt, c[1], c[1] + .4), { fs: 26 });
  },
});

/* =====================================================================
 * 收工：分身合回本体 → 回到对话框 → 留一个开放的问题
 * ===================================================================== */
const MINIX = k => 160 + k * 229, MINIY = 300;
S('s15', {
  cues: (() => { const c = CS('s15'); return [...ALL.map((_, k) => [.55 + k * .26 + .36, 'pop', .8]), [.55 + 7 * .26 + .6, 'ding', .7]]; })(),
  draw(g, lt, t) {
    // 一排 8 块小屏，全部亮绿灯
    ALL.forEach((s, k) => {
      const x = MINIX(k);
      card(g, x - 95, MINIY - 60, 190, 120, { r: 10, fill: '#17110D', lw: 2, stroke: C.line });
      g.save(); rr(g, x - 89, MINIY - 54, 178, 100, 6); g.clip(); g.translate(x - 89, MINIY - 54); thumb(g, s, 178, 100, t + k); g.restore();
      lamp(g, x, MINIY + 82, 9, C.green, 1, { halo: 3 });
      // 分身从小屏里跳出来，“啵”地合回本体
      const t0 = .55 + k * .26, d = .36;
      if (lt < t0) hero(g, x + 60, MINIY + 52, .34, t + k * .3, { hat: EPC[s], face: 'happy', seed: k + 1 });
      else if (lt < t0 + d) { const [hx, hy] = hopPos(lt, t0, d, [x + 60, MINIY + 52], [960, GROUND - 40], 160); hero(g, hx, hy, lerp(.34, .2, seg(lt, t0, t0 + d)), t, { pose: 'hop', hat: EPC[s], face: 'happy' }); }
      poof(g, 960, GROUND - 60, lt - t0 - d, 70);
    });
    const last = .55 + 7 * .26 + .36;
    const merges = ALL.map((_, k) => .55 + k * .26 + .36);
    const sq = merges.reduce((a, tm) => { const k = lt - tm; return k > 0 && k < .22 ? Math.max(a, .14 * Math.sin(k / .22 * Math.PI)) : a; }, 0);
    hero(g, 960, GROUND, 1.5, t, { sq, face: 'happy', armsUp: lt > last && lt < last + .9, pose: lt > last + .9 ? 'wave' : 'idle' });
    zcode(g, 520, GROUND, 1.1, t, { wave: true, prop: 'book' });
    codex(g, 1400, GROUND, 1.1, t, { wave: true });
  },
});

S('s16', {
  noCaption: true, fi: .3, fo: .7,
  cues: (() => { const c = CS('s16'); return [[c[0], 'type', .5], [c[1], 'type', .5]]; })(),
  draw(g, lt, t) {
    const c = CS('s16');
    const msgs = [
      { who: 'me', s: '只有代码  </>', t0: -9 }, { who: 'me', s: '秘诀：分身。', t0: -9 },
      { who: 'me', s: '这一期，也是这么做出来的。', t0: c[0], cps: 16 },
      { who: 'me', s: '下一期想看什么？\n告诉我，我再分个身。', t0: c[1], cps: 16, h: 114 },
    ];
    drawChat(g, msgs, lt, t, { placeholder: lt < c[1] + 1.4 });
    hero(g, 300, GROUND, 1.45, t, { pose: lt < c[1] + 1.4 ? 'type' : 'idle', face: 'happy' });
  },
});

/* ---------------- 封面 ---------------- */
function drawCover(g, frame) {
  SCX = frame.scaleX; CAMZ = 1;
  drawBackground(g, { ...frame, t: 2 });
  text(g, '我分了 4 个身', 960, 190, { f: 'title', s: 140, w: 900, ls: 8 });
  text(g, 'Claude 讲它怎么做这 8 期视频', 960, 318, { s: 50, w: 900, c: C.ochre, ls: 4 });
  B1.forEach((s, k) => { const x = 250 + k * 470; pane(g, x - 190, 400, 380, 250, s, EPC[s], (gg, w, h) => growThumb(gg, s, w, h, 3 + k, .55 + k * .12));
    hero(g, x, 860, .8, 1.1 + k * .2, { hat: EPC[s], face: 'happy', pose: 'type' }); });
  hero(g, 960, 1020, 1.0, 1.4, { face: 'happy', armsUp: true });
  postFX(g, { ...frame, t: 0 });
}

film.finish();
