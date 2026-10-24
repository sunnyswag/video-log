/* =====================================================================
 * FilmKit —— 与画风无关的逐帧动画引擎，普通 <script>，全局 FilmKit。
 *
 * API（时间单位为秒，所有绘图使用 W×H 逻辑坐标）：
 * FilmKit.create({W=1920,H=1080,FPS=30,fonts,fontsNeeded,theme,code,captions,...钩子})
 *   返回 film；fonts 为字体族映射，theme 为颜色映射，code 可扩展 keywords/types。
 * film.addScene({id,chapter=0,dur,pre=.55,post=.7,captions,cues,effects,draw})
 *   captions:[{t,text,dur?,end?}] 是局部时间；省略 dur 时由字幕推算场景时长。
 *   也支持 caps:[文本 | [文本,时长]] 自动排句；sc.cs/ce 是局部字幕起止时间。
 *   cues:[{t,type,v=1}]；effects:[{t,type,a,dur}]；二者也可传 sc=>数组。
 *   兼容旧片 chap/sfx(sc)=>元组数组/fx(sc)=>元组数组；draw(g,lt,sc,frame)。
 * film.chapter(n,zh,en,desc) 在当前时间登记章节，不添加场景、不绘制章节卡。
 * film.sceneAt(t) 找场景；film.effectsAt(t,type) 返回带 progress/remaining 的效果点。
 * film.prepare(cw,ch) 创建/复用离屏资源；film.invalidate() 在字体或资源变化后清缓存。
 * film.finish() 封存构建器，生成并设置 window.FILM；重复调用返回同一对象。
 *   FILM: W/H/FPS/duration/scenes/captions/cues/chapters/fontsNeeded/render/drawCover，
 *   时间线字段兼容旧片；chapterInfo 额外保存标题、英文和说明，chapters 仍为 {t,n}。
 * film.render(canvas,t) / film.drawCover(canvas) 与导出的 FILM 方法相同。
 * film.txt/tw/fontStr/tokenize/drawCode/parseRich/capLines 是绑定 fonts/theme 的工具；
 *   同名 FilmKit 工具使用默认字体/颜色；数学工具同时见 FilmKit 和 FilmKit.utils。
 * FilmKit.splitRich(segments,at) 按 Unicode 字符位置分割富文本。
 * FilmKit.rng(seed) 返回可重复的随机序列；每帧重新播种或预计算静态资源。
 * FilmKit.mk(w,h) 建离屏画布；FilmKit.capDur(text) 推算一句字幕的时长。
 *
 * 钩子：prepare(env)=>cache；其他签名均为 (g,frame)，特殊签名见下。
 *   drawBackground → beforeScene → scene.draw → drawTransition → drawChrome
 *   → beforeCaptions → drawCaptionBackground → drawCaption(g,layout,frame)
 *   → afterCaptions。beforeScene 与 scene.draw 共用一次 save/restore，供淡入/抖动。
 *   drawCover(g,frame) 可选，无钩子时渲染第 0 秒。每个其余钩子单独隔离状态。
 *   frame:{canvas,t,lt,sc,cw,ch,W,H,FPS,scaleX,scaleY,cache,film}；
 *   prepare 的 env:{cw,ch,W,H,FPS,scaleX,scaleY,mk}，不含时间，不缓存动画帧。
 *   layout:{caption,font,alpha,ain,aout,wipe,dy,lines:[{segments,visible,width,x,y,reveal}]}。
 *   captions 配置：font/colors/maxWidth/lineHeight/baseY(数值或函数)/slide/fadeIn/
 *   fadeOut/revealDuration(函数)/wrap('wrap' 或旧片 'balanced')/enabled。
 *   {}、[]、^文本^ 分别映射 colors.emphasis/danger/accent（不嵌套）。
 *
 * 确定性约定：绘图只依赖 t、固定资源和参数；不能读取时钟、累加上一帧、使用
 * 未播种随机数。每帧清空画布并重置状态；离屏缓冲若被写入，使用前必须清空。
 * 字体由播放器等待 fontsNeeded 后再渲染；更换字体后调用 invalidate()。
 * ===================================================================== */
(function (root) {
'use strict';
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => a === b ? +(t >= b) : clamp((t - a) / (b - a));
const eo = t => 1 - Math.pow(1 - clamp(t), 3);
const eio = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const eback = t => { t = clamp(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const pulse = (t, f = 1) => .5 + .5 * Math.sin(t * TAU * f);
const blink = (t, f = 2) => Math.floor(t * f * 2) % 2 === 0 ? 1 : .25;
const typed = (s, p) => Array.from(s).slice(0, Math.round(Array.from(s).length * clamp(p))).join('');
const plain = s => (Array.isArray(s) ? s[0] : s).replace(/[{}\[\]\^]/g, '');
const capDur = s => Array.isArray(s) ? s[1] : Math.max(2, .8 + plain(s).length * .175);
function rng(seed) { // Mulberry32；字符串种子先做整数散列
  let a = typeof seed === 'number' ? seed >>> 0 : 2166136261;
  if (typeof seed !== 'number') for (const c of String(seed)) a = Math.imul(a ^ c.codePointAt(0), 16777619) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function rgba(hex, a) {
  let h = hex.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join('');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function mk(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const DEFAULT_FONTS = { cjk: 'sans-serif', disp: 'sans-serif', mono: 'monospace' };
const DEFAULT_THEME = { bg: '#151719', white: '#f4f4ef', cyan: '#71c7c1', red: '#ed817e', amber: '#e9c580', green: '#93c69a', blue: '#92bce0', pink: '#d6a9d4', code: '#e2e2dc', comment: '#92958f', punct: '#b8bcb8', constant: '#e9c580' };
const KEYWORDS = ['if', 'else', 'return', 'static', 'void', 'const', 'while', 'for', 'unsigned', 'long', 'signed'];
const TYPES = ['uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'int', 'uint16_t', 'int16_t'];
function parseRich(s, colors = {}) {
  const palette = { emphasis: DEFAULT_THEME.cyan, danger: DEFAULT_THEME.red, accent: DEFAULT_THEME.amber, ...colors };
  const out = []; let cur = '', role = null;
  const flush = () => { if (cur) out.push({ s: cur, c: role ? palette[role] : null }); cur = ''; };
  for (const ch of s) {
    if (ch === '{') { flush(); role = 'emphasis'; }
    else if (ch === '[') { flush(); role = 'danger'; }
    else if (ch === '^') { flush(); role = role === 'accent' ? null : 'accent'; }
    else if (ch === '}' || ch === ']') { flush(); role = null; }
    else cur += ch;
  }
  flush(); return out;
}
function splitRich(segs, at) {
  const A = [], B = []; let n = 0;
  for (const sg of segs) {
    const chars = Array.from(sg.s), len = chars.length;
    if (n + len <= at) A.push(sg);
    else if (n >= at) B.push(sg);
    else { A.push({ ...sg, s: chars.slice(0, at - n).join('') }); B.push({ ...sg, s: chars.slice(at - n).join('') }); }
    n += len;
  }
  return [A, B];
}

function create(options = {}) {
  const W = options.W ?? 1920, H = options.H ?? 1080, FPS = options.FPS ?? 30;
  for (const v of [W, H, FPS]) if (!Number.isFinite(v) || v <= 0) throw new Error('W/H/FPS 必须为正数');
  const F = { ...DEFAULT_FONTS, ...options.fonts }, C = { ...DEFAULT_THEME, ...options.theme };
  const cc = { font: { f: 'cjk', s: H * 46 / 1080, w: 700 }, maxWidth: W * .8125, lineHeight: H * 62 / 1080, slide: H * 14 / 1080, fadeIn: .22, fadeOut: .22, wrap: 'wrap', ...options.captions };
  cc.font = { f: 'cjk', s: H * 46 / 1080, w: 700, ...options.captions?.font };
  cc.colors = { emphasis: C.cyan, danger: C.red, accent: C.amber, ...options.captions?.colors };
  const KW = new Set([...KEYWORDS, ...(options.code?.keywords || [])]), TY = new Set([...TYPES, ...(options.code?.types || [])]);
  const scenes = [], caps = [], cues = [], effects = [], chapters = [], chapterInfo = [];
  let total = 0, api = null, cache = null, lastSize = '', SC = 1;
  const round = n => +n.toFixed(3);
  function editable() { if (api) throw new Error('finish() 后不能再修改时间线'); }
  function nonnegative(v, name) { if (!Number.isFinite(v) || v < 0) throw new Error(name + ' 必须是非负秒数'); return v; }
  function fontStr(o = {}) { return `${o.w || 500} ${o.s || 32}px ${F[o.f || 'cjk'] || o.f}`; }
  function txt(g, s, x, y, o = {}) {
    g.save();
    if (o.al != null) g.globalAlpha *= o.al;
    g.font = fontStr(o); g.textAlign = o.a || 'left'; g.textBaseline = o.b || 'alphabetic';
    if (o.ls) g.letterSpacing = o.ls + 'px';
    if (o.sh) { g.shadowColor = o.sh; g.shadowBlur = (o.sb || 14) * SC; }
    if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.lw || 2; g.lineJoin = 'round'; g.strokeText(s, x, y); }
    if (!o.noFill) { g.fillStyle = o.c || C.white; g.fillText(s, x, y); }
    g.restore();
  }
  function tw(g, s, o = {}) {
    g.save(); g.font = fontStr(o); if (o.ls) g.letterSpacing = o.ls + 'px';
    const w = g.measureText(s).width; g.restore(); return w;
  }
  function tokenize(line, extra = {}) {
    const kw = extra.keywords ? new Set([...KW, ...extra.keywords]) : KW, ty = extra.types ? new Set([...TY, ...extra.types]) : TY;
    // 字符串优先，避免把 URL 或字符串中的 // 当作注释；这是单行着色，不是完整语法分析。
    const toks = line.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/.*|\/\*.*|0x[0-9A-Fa-f]+|\d+[uUlL]*|#\s*\w+|[A-Za-z_][A-Za-z0-9_]*|\s+|./g) || [];
    if (/^\s*\$/.test(line)) {
      const ci = toks.findIndex(s => /^(\/\/|\/\*)/.test(s));
      return ci < 0 ? [{ s: line, c: C.white }] : [{ s: toks.slice(0, ci).join(''), c: C.white }, { s: toks.slice(ci).join(''), c: C.comment }];
    }
    return toks.map((s, i) => {
      let c = C.code;
      if (/^(\/\/|\/\*)/.test(s)) c = C.comment;
      else if (s[0] === '"' || s[0] === "'" || /^(0x[0-9A-Fa-f]+|\d+[uUlL]*)$/.test(s)) c = C.amber;
      else if (s[0] === '#') c = C.pink;
      else if (ty.has(s)) c = C.blue;
      else if (kw.has(s)) c = C.pink;
      else if (/^[A-Za-z_]/.test(s)) {
        let j = i + 1; while (j < toks.length && /^\s+$/.test(toks[j])) j++;
        c = toks[j] === '(' ? C.cyan : /^[A-Z_0-9]+$/.test(s) && s.length > 2 ? C.constant : C.code;
      } else if (/^\s+$/.test(s)) c = null;
      else c = C.punct;
      return { s, c };
    });
  }
  function drawCode(g, x, y, lines, o = {}) {
    const s = o.s || 22, lh = o.lh || s * 1.55;
    const total = lines.reduce((a, l) => a + l.length + 1, 0);
    let budget = o.p == null ? 1e9 : Math.round(total * clamp(o.p));
    const typing = o.p != null && o.p < 1;
    g.save(); if (o.al != null) g.globalAlpha *= o.al;
    g.font = fontStr({ f: 'mono', s, w: o.w || 400 });
    let cx = x, cy = y;
    for (let li = 0; li < lines.length; li++) {
      if (budget <= 0) break;
      const ln = lines[li], ly = y + li * lh;
      let bg = o.diff ? ln[0] === '+' ? C.green : ln[0] === '-' ? C.red : null : null;
      if (o.hl?.[li]) bg = o.hl[li];
      if (bg) {
        g.fillStyle = rgba(bg, o.hlA || .14); g.fillRect(x - 14, ly - s * 1.02, o.width || 820, lh * .92);
        g.fillStyle = rgba(bg, .9); g.fillRect(x - 14, ly - s * 1.02, 3, lh * .92);
      }
      cx = x;
      for (const tk of tokenize(ln, o)) {
        if (budget <= 0) break;
        const part = tk.s.slice(0, budget); budget -= part.length;
        if (tk.c) { g.fillStyle = tk.c; g.fillText(part, cx, ly); }
        cx += g.measureText(part).width;
      }
      cy = ly; budget -= 1;
    }
    if (typing || o.cursor) { g.fillStyle = rgba(C.cyan, blink(o.t || 0, 2) > .5 ? .9 : .2); g.fillRect(cx + 2, cy - s * .85, s * .55, s); }
    g.restore();
  }

  /* ---------------- 时间线 ---------------- */
  function addScene(o) {
    editable();
    if (!o.id || scenes.some(s => s.id === o.id)) throw new Error('场景 id 必须非空且唯一');
    if (typeof o.draw !== 'function') throw new Error(o.id + ': 缺少 draw');
    if (o.caps && o.captions) throw new Error('caps 和 captions 只能选一种');
    const pre = nonnegative(o.pre ?? .55, 'pre'), post = nonnegative(o.post ?? .7, 'post');
    let tt = pre;
    const local = o.captions ? o.captions.map(c => ({ ...c, t: nonnegative(c.t, '字幕 t') })).sort((a, b) => a.t - b.t) : (o.caps || []).map(c => {
      const item = { t: tt, text: Array.isArray(c) ? c[0] : c }; tt += nonnegative(capDur(c), '字幕时长'); return item;
    });
    if (o.captions?.length) tt = Math.max(...local.map(c => c.end ?? (c.t + (c.dur ?? capDur(c.text)))));
    const d = o.dur ?? tt + post;
    if (!Number.isFinite(d) || d <= 0) throw new Error('场景时长必须大于 0');
    const cs = local.map(c => c.t), ce = local.map((c, i) => c.end ?? (c.dur != null ? c.t + c.dur : i + 1 < local.length ? cs[i + 1] - .15 : d - .3));
    local.forEach((c, i) => {
      if (typeof c.text !== 'string' || !Number.isFinite(ce[i]) || c.t >= d || ce[i] <= c.t || ce[i] > d) throw new Error(o.id + ': 字幕时间必须落在场景内，且结束晚于开始');
    });
    const sc = { ...o, chap: o.chapter ?? o.chap ?? 0, start: total, d, cs, ce };
    const events = (value, legacy) => { const src = value ?? legacy ?? []; return typeof src === 'function' ? src(sc) : src; };
    const localCues = events(o.cues, o.sfx).map(c => {
      const v = Array.isArray(c) ? { t: c[0], type: c[1], v: c[2] ?? 1 } : { v: 1, ...c };
      nonnegative(v.t, 'cue t'); if (!v.type || !Number.isFinite(v.v)) throw new Error('cue 需要 type 和有限音量 v');
      return { t: total + v.t, type: v.type, v: v.v };
    });
    const localEffects = events(o.effects, o.fx).map(c => {
      const v = Array.isArray(c) ? { t: c[0], type: c[1], a: c[2], dur: c[3] } : { ...c };
      nonnegative(v.t, 'effect t'); if (!v.type || !Number.isFinite(v.dur) || v.dur <= 0) throw new Error('effect 需要 type 和正数 dur');
      return { ...v, t: total + v.t };
    });
    scenes.push(sc);
    local.forEach((c, i) => caps.push({ t0: total + cs[i], t1: total + ce[i], text: c.text }));
    cues.push(...localCues); effects.push(...localEffects); total += d;
    return sc;
  }
  function chapter(n, zh = '', en = '', desc = '') {
    editable(); if (chapters.some(c => c.n === n)) throw new Error('章节编号不能重复');
    const entry = { t: total, n }; chapters.push(entry); chapterInfo.push({ ...entry, zh, en, desc }); return entry;
  }
  function sceneAt(t) {
    let lo = 0, hi = scenes.length - 1;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (t < scenes[m].start + scenes[m].d) hi = m; else lo = m + 1; }
    return scenes[lo] || null;
  }
  function effectsAt(t, type) {
    return effects.filter(f => (type == null || f.type === type) && t >= f.t && t <= f.t + f.dur).map(f => ({ ...f, progress: (t - f.t) / f.dur, remaining: 1 - (t - f.t) / f.dur }));
  }

  /* ---------------- 字幕排版 / 动画（装饰由钩子提供） ---------------- */
  const rich = text => parseRich(text, cc.colors);
  function capLines(g, text) {
    const segs = rich(text), pl = segs.map(s => s.s).join(''), chars = Array.from(pl);
    if (tw(g, pl, cc.font) <= cc.maxWidth && !pl.includes('\n')) return [segs];
    if (cc.wrap === 'balanced' && !pl.includes('\n')) { // 与参考片完全相同的双行断点
      let best = -1, bd = 1e9;
      for (let i = 1; i < chars.length - 1; i++) if ('，：；、——？！ '.includes(chars[i - 1])) {
        const d = Math.abs(i - chars.length / 2); if (d < bd) { bd = d; best = i; }
      }
      return splitRich(segs, best < 0 ? Math.ceil(chars.length / 2) : best);
    }
    const lines = []; let rest = segs;
    while (rest.length) {
      const str = Array.from(rest.map(s => s.s).join(''));
      let end = 0, preferred = 0;
      while (end < str.length && str[end] !== '\n' && (end === 0 || tw(g, str.slice(0, end + 1).join(''), cc.font) <= cc.maxWidth)) {
        end++; if ('，：；、——？！ 。!?;,:'.includes(str[end - 1])) preferred = end;
      }
      const newline = str[end] === '\n';
      if (!newline && end < str.length && preferred > end / 2) end = preferred;
      const [line, tail] = splitRich(rest, end); lines.push(line);
      rest = newline ? splitRich(tail, 1)[1] : tail;
    }
    return lines.length ? lines : [[]];
  }
  function captionLayout(g, c, t) {
    const ain = seg(t, c.t0, c.t0 + cc.fadeIn), aout = 1 - seg(t, c.t1, c.t1 + cc.fadeOut), alpha = Math.min(ain, aout);
    if (alpha <= 0) return null;
    const parts = capLines(g, c.text), n = Array.from(plain(c.text)).length;
    const revealDuration = cc.revealDuration ? cc.revealDuration(n) : Math.min(.55, .15 + n * .013);
    const wipe = eo(seg(t, c.t0, c.t0 + revealDuration)), dy = (1 - eo(ain)) * cc.slide;
    const baseY = typeof cc.baseY === 'function' ? cc.baseY(parts.length) : cc.baseY ?? H - H / 15 - (parts.length - 1) * cc.lineHeight;
    const lines = parts.map((segments, i) => {
      const width = segments.reduce((s, x) => s + tw(g, x.s, cc.font), 0), reveal = clamp(wipe * parts.length - i);
      const count = segments.reduce((s, x) => s + Array.from(x.s).length, 0);
      return { segments, width, x: W / 2 - width / 2, y: baseY + i * cc.lineHeight + dy, reveal, visible: splitRich(segments, Math.round(count * reveal))[0] };
    });
    return { caption: c, font: cc.font, alpha, ain, aout, wipe, dy, lines };
  }
  function defaultCaption(g, layout) {
    for (const line of layout.lines) {
      let x = line.x;
      for (const s of line.visible) { txt(g, s.s, x, line.y, { ...layout.font, c: s.c || C.white, sh: '#000000', sb: 6 }); x += tw(g, s.s, layout.font); }
    }
  }
  function drawCaptions(g, frame) {
    if (cc.enabled === false) return;
    call('drawCaptionBackground', g, frame);
    for (const c of caps) {
      if (frame.t < c.t0 || frame.t >= c.t1 + cc.fadeOut) continue;
      const layout = captionLayout(g, c, frame.t); if (!layout) continue;
      g.save();
      try { g.globalAlpha *= layout.alpha; (options.drawCaption || defaultCaption)(g, layout, frame); } finally { g.restore(); }
    }
  }

  /* ---------------- 逐帧渲染 / 离屏缓存 ---------------- */
  function prepare(cw, ch) {
    const key = cw + 'x' + ch;
    if (key !== lastSize) {
      SC = cw / W;
      const next = options.prepare?.({ cw, ch, W, H, FPS, scaleX: cw / W, scaleY: ch / H, mk }) ?? {};
      cache = next; lastSize = key; // 钩子成功之后才登记，失败可重试
    }
    return cache;
  }
  function invalidate() { lastSize = ''; cache = null; }
  function call(name, g, frame) {
    if (!options[name]) return;
    g.save(); try { options[name](g, frame); } finally { g.restore(); }
  }
  function begin(canvas, t) {
    if (!Number.isFinite(t)) throw new Error('render 的 t 必须为有限秒数');
    const cw = canvas.width, ch = canvas.height;
    if (!cw || !ch) throw new Error('画布尺寸不能为 0');
    SC = cw / W;
    const resources = prepare(cw, ch), g = canvas.getContext('2d');
    if (g.reset) g.reset(); else canvas.width = cw;
    g.setTransform(cw / W, 0, 0, ch / H, 0, 0);
    const sc = sceneAt(t);
    return { g, frame: { canvas, t, lt: sc ? t - sc.start : 0, sc, cw, ch, W, H, FPS, scaleX: cw / W, scaleY: ch / H, cache: resources, film } };
  }
  function render(canvas, t) {
    if (!Number.isFinite(t)) throw new Error('render 的 t 必须为有限秒数');
    const { g, frame } = begin(canvas, clamp(t, 0, total));
    if (options.drawBackground) call('drawBackground', g, frame);
    else { g.fillStyle = C.bg; g.fillRect(0, 0, W, H); }
    if (frame.sc) {
      g.save();
      try { options.beforeScene?.(g, frame); frame.sc.draw(g, frame.lt, frame.sc, frame); } finally { g.restore(); }
    }
    call('drawTransition', g, frame); call('drawChrome', g, frame);
    call('beforeCaptions', g, frame); drawCaptions(g, frame); call('afterCaptions', g, frame);
  }
  function drawCover(canvas) {
    if (!options.drawCover) return render(canvas, 0);
    const { g, frame } = begin(canvas, 0); call('drawCover', g, frame);
  }
  function finish() {
    if (api) { root.FILM = api; return api; }
    if (!scenes.length) throw new Error('至少添加一个场景再 finish()');
    api = {
      W, H, FPS, duration: total, render, drawCover,
      scenes: scenes.map(s => ({ id: s.id, chap: s.chap, start: round(s.start), d: round(s.d) })),
      captions: caps.map(c => ({ t0: round(c.t0), t1: round(c.t1), text: c.text, plain: plain(c.text) })),
      cues: cues.map(c => ({ t: round(c.t), type: c.type, v: c.v })).sort((a, b) => a.t - b.t),
      chapters: chapters.map(c => ({ ...c })), chapterInfo: chapterInfo.map(c => ({ ...c })),
      fontsNeeded: [...(options.fontsNeeded || [])],
    };
    root.FILM = api; return api;
  }
  const film = { W, H, FPS, get duration() { return total; }, addScene, chapter, sceneAt, effectsAt, prepare, invalidate, render, drawCover, finish, txt, tw, fontStr, tokenize, drawCode, parseRich: rich, capLines, captionLayout };
  return film;
}
const utils = { TAU, clamp, lerp, seg, eo, eio, eback, hash, pulse, blink, typed, plain, capDur, rng, rgba, mk, parseRich, splitRich };
const defaults = create();
const FilmKit = { create, utils, ...utils };
for (const key of ['txt', 'tw', 'fontStr', 'tokenize', 'drawCode', 'capLines']) FilmKit[key] = defaults[key];
root.FilmKit = FilmKit;
if (typeof module !== 'undefined' && module.exports) module.exports = FilmKit;
})(typeof window !== 'undefined' ? window : globalThis);
