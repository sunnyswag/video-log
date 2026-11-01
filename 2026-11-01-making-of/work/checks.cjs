#!/usr/bin/env node
'use strict';
// Audit only: no browser, dependencies, source rewriting, or implicit file writes.
// Run: node checks.cjs > checks.report.txt ; FAIL gives exit 1, warnings alone give 0.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const STEP = 0.5, WIDTH = 1920, HEIGHT = 1080, ALPHA = 0.15, OVERLAP = 0.15;
const SEED = 0x4d414b45, SAMPLE_COUNT = 32;
const EPS = 1e-9;
Error.stackTraceLimit = 35;
const CUE_TYPES = new Set('whoosh blip tick latch hit clap type error success draw snip scan cut flap'.split(' '));
const FONT_FAMILIES = new Set(['FCJK', 'FDisp', 'FSup', 'FMono', 'FMonoCJK']);
const FILES = ['../../tools/film-kit/engine.js', 'script.js', 'kit.js', 'film.js'];
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = () => [1, 0, 0, 1, 0, 0];
const quote = s => JSON.stringify(s);
const f3 = n => n.toFixed(3);
const rounded = n => Number(n.toFixed(3)); // FilmKit.finish() exports milliseconds.
const sameNumber = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= EPS;

function firstFontFamily(font) {
  const tail = String(font).match(/(?:\d+(?:\.\d*)?|\.\d+)(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|%)(?:\s*\/\s*(?:normal|[\d.]+(?:[a-z%]+)?))?\s+(.+)$/i)?.[1];
  if (!tail) return null;
  const match = tail.match(/^(?:"([^"]+)"|'([^']+)'|([^,]+?))\s*(?:,|$)/);
  return match ? (match[1] ?? match[2] ?? match[3]).trim() : null;
}
function logicalFontSize(size, m, canvas, squeeze = 1) {
  const [a, b, c, d] = [m[0]*WIDTH/canvas.width*squeeze, m[1]*HEIGHT/canvas.height*squeeze,
    m[2]*WIDTH/canvas.width, m[3]*HEIGHT/canvas.height];
  // Minimum singular value: rotation invariant; conservative under shear/nonuniform scale.
  const maxScale = (Math.hypot(a+d, b-c) + Math.hypot(a-d, b+c))/2;
  const value = size * (maxScale ? Math.abs(a*d-b*c)/maxScale : 0);
  finite(value, '逻辑字号'); return value;
}

function finite(value, label) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label}: 非有限数 ${value}`);
  if (Array.isArray(value)) value.forEach((v, i) => finite(v, `${label}[${i}]`));
  else if (value && Object.getPrototypeOf(value) !== null && typeof value === 'object' && !value.snapshot) {
    for (const [k, v] of Object.entries(value)) finite(v, `${label}.${k}`);
  }
}
function numbers(args, count, name) {
  for (let i = 0; i < count; i++) {
    if (typeof args[i] !== 'number' || !Number.isFinite(args[i])) throw new Error(`${name}[${i}]: 坐标/尺寸必须有限，实际 ${args[i]}`);
  }
}
function multiply(m, n) {
  const [a, b, c, d, e, f] = m, [A, B, C, D, E, F] = n;
  const r = [a*A+c*B, b*A+d*B, a*C+c*D, b*C+d*D, a*E+c*F+e, b*E+d*F+f];
  finite(r, '变换矩阵'); return r;
}
function matrix(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    const m = args[0]; return [m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0, m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1, m.e ?? m.m41 ?? 0, m.f ?? m.m42 ?? 0];
  }
  return args.length ? Array.from(args) : identity();
}
// Canonical resource descriptions contain content, never allocation IDs or addresses.
function canonical(v) {
  if (typeof v === 'number') { finite(v, '指令'); return Number(v.toFixed(3)); }
  if (v === undefined) return '<undefined>';
  if (v === null || typeof v !== 'object') return v;
  if (typeof v.snapshot === 'function') return canonical(v.snapshot());
  if (Array.isArray(v)) return Array.from(v, canonical);
  if (ArrayBuffer.isView(v)) return { bytes: v.byteLength, sha256: sha(Buffer.from(v.buffer, v.byteOffset, v.byteLength)) };
  return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
}
const defaults = () => ({
  globalAlpha: 1, globalCompositeOperation: 'source-over', shadowColor: 'rgba(0,0,0,0)',
  shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, letterSpacing: '0px',
  font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr',
  lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
  fillStyle: '#000000', strokeStyle: '#000000', filter: 'none', imageSmoothingEnabled: true,
});

class AuditCanvas {
  constructor(harness, w, h, main = false) {
    numbers([w, h], 2, 'canvas'); this.harness = harness; this.main = main;
    this._width = w; this._height = h; this.context = new AuditContext(this);
    harness.contexts.push(this.context);
  }
  get width() { return this._width; }
  set width(w) { numbers([w], 1, 'canvas.width'); this._width = w; this.context.reset(); }
  get height() { return this._height; }
  set height(h) { numbers([h], 1, 'canvas.height'); this._height = h; this.context.reset(); }
  getContext(kind) { if (kind !== '2d') throw new Error(`未支持的 context ${kind}`); return this.context; }
  snapshot() { return { canvas: [this.width, this.height], commands: this.context.digest() }; }
}
class AuditPath {
  constructor(source) {
    if (source != null && !(source instanceof AuditPath) && typeof source !== 'string') throw new Error('Path2D 参数未支持');
    this.commands = source instanceof AuditPath ? source.commands.slice() : source ? [['svg', source]] : [];
  }
  snapshot() { return { Path2D: this.commands }; }
  addPath(p, transform = {}) { this.commands.push(['addPath', canonical(p), matrix([transform])]); finite(matrix([transform]), 'Path2D.addPath'); }
}
const pathMethods = { moveTo: 2, lineTo: 2, quadraticCurveTo: 4, bezierCurveTo: 6, arc: 5, arcTo: 5, ellipse: 7, roundRect: 4, rect: 4, closePath: 0 };
for (const [name, count] of Object.entries(pathMethods)) {
  AuditPath.prototype[name] = function (...args) { validatePath(name, args, count); this.commands.push([name, canonical(args)]); };
}
function validatePath(name, args, count) {
  numbers(args, count, name); finite(args, name);
  if ((name === 'arc' && args[2] < 0) || (name === 'arcTo' && args[4] < 0)) throw new Error(`${name}: 负半径`);
  if (name === 'roundRect' && args[4] != null) {
    for (const r of Array.isArray(args[4]) ? args[4] : [args[4]]) {
      const radii = typeof r === 'object' ? [r.x, r.y] : [r];
      numbers(radii, radii.length, name); if (radii.some(n => n < 0)) throw new Error('roundRect: 负半径');
    }
  }
}
class AuditGradient {
  constructor(ctx, kind, args) { this.ctx = ctx; this.kind = kind; this.args = args; this.transform = ctx.m.slice(); this.stops = []; }
  addColorStop(offset, color) {
    numbers([offset], 1, 'addColorStop'); if (offset < 0 || offset > 1) throw new Error('渐变 stop 越界');
    this.stops.push([offset, color]); this.ctx.record('gradient.addColorStop', [this, offset, color]);
  }
  snapshot() { return { gradient: this.kind, args: this.args, transform: this.transform, stops: this.stops }; }
}
class AuditPattern {
  constructor(ctx, source, repeat) { this.ctx = ctx; this.source = source; this.repeat = repeat; this.m = identity(); }
  setTransform(m = {}) { this.m = matrix([m]); numbers(this.m, 6, 'pattern.setTransform'); this.ctx.record('pattern.setTransform', [this, m]); }
  snapshot() { return { pattern: this.source.snapshot(), repeat: this.repeat, transform: this.m }; }
}
class AuditContext {
  constructor(canvas) {
    this.canvas = canvas; this.harness = canvas.harness; this.stack = [];
    this.state = defaults(); this.m = identity(); this.dash = []; this.clips = []; this.paths = []; this.texts = []; this.trace = [];
    this.hash = createHash('sha256'); this.cachedDigest = null; this.capture = false;
  }
  record(name, args = []) {
    finite(args, name);
    if (this.canvas.main && !this.capture) return;
    const line = JSON.stringify([name, canonical(args)]);
    if (this.canvas.main) this.trace.push(line);
    else { this.hash.update(line + '\n'); this.cachedDigest = null; }
  }
  digest() { return this.cachedDigest ??= this.hash.copy().digest('hex'); }
  reset() {
    // Detect a leak BEFORE browser-style reset clears the stack.
    if (this.stack.length) throw new Error(`reset 前 save/restore 不平衡: ${this.stack.length}`);
    this.state = defaults(); this.m = identity(); this.dash = []; this.clips = []; this.paths = [];
    this.hash = createHash('sha256'); this.cachedDigest = null; this.record('reset');
  }
  save() { this.record('save'); this.stack.push({ state: { ...this.state }, m: this.m.slice(), dash: this.dash.slice(), clips: this.clips.slice() }); }
  restore() {
    if (!this.stack.length) throw new Error('restore 下溢（没有对应 save）');
    this.record('restore'); const saved = this.stack.pop(); this.state = saved.state; this.m = saved.m; this.dash = saved.dash; this.clips = saved.clips;
  }
  translate(x, y) { numbers(arguments, 2, 'translate'); this.m = multiply(this.m, [1, 0, 0, 1, x, y]); this.record('translate', [x, y]); }
  scale(x, y) { numbers(arguments, 2, 'scale'); this.m = multiply(this.m, [x, 0, 0, y, 0, 0]); this.record('scale', [x, y]); }
  rotate(a) { numbers(arguments, 1, 'rotate'); this.m = multiply(this.m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); this.record('rotate', [a]); }
  transform(...args) { numbers(args, 6, 'transform'); this.m = multiply(this.m, args); this.record('transform', args); }
  setTransform(...args) { const m = matrix(args); numbers(m, 6, 'setTransform'); this.m = m; this.record('setTransform', args); }
  resetTransform() { this.m = identity(); this.record('resetTransform'); }
  getTransform() { this.record('getTransform'); return Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => [k, this.m[i]])); }
  setLineDash(dash) { numbers(dash, dash.length, 'setLineDash'); this.dash = Array.from(dash); this.record('setLineDash', [dash]); }
  getLineDash() { this.record('getLineDash'); return this.dash.slice(); }
  createLinearGradient(...args) { numbers(args, 4, 'createLinearGradient'); this.record('createLinearGradient', args); return new AuditGradient(this, 'linear', args); }
  createRadialGradient(...args) { numbers(args, 6, 'createRadialGradient'); this.record('createRadialGradient', args); return new AuditGradient(this, 'radial', args); }
  createPattern(source, repeat) {
    if (!(source instanceof AuditCanvas)) throw new Error('createPattern: 未知图像源');
    this.record('createPattern', [source, repeat]); return new AuditPattern(this, source, repeat);
  }
  createImageData(w, h) {
    if (typeof w === 'object') { h = w.height; w = w.width; }
    numbers([w, h], 2, 'createImageData');
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) throw new Error('ImageData 尺寸必须为正整数');
    this.record('createImageData', [w, h]); return { width: w, height: h, data: new Uint8ClampedArray(w*h*4) };
  }
  putImageData(data, ...args) {
    numbers(args, args.length === 2 ? 2 : 6, 'putImageData');
    if (!data || !ArrayBuffer.isView(data.data)) throw new Error('putImageData: 缺少像素数组');
    // Hash the actual bytes on EVERY upload, even if the same ImageData is reused.
    this.record('putImageData', [{ width: data.width, height: data.height, pixels: sha(Buffer.from(data.data.buffer, data.data.byteOffset, data.data.byteLength)) }, ...args]);
  }
  drawImage(source, ...args) {
    if (![2, 4, 8].includes(args.length) || !(source instanceof AuditCanvas)) throw new Error('drawImage: 参数/图像源未支持');
    numbers(args, args.length, 'drawImage'); this.record('drawImage', [source, ...args]);
  }
  metrics(text) {
    const size = Number(this.font.match(/([\d.]+)px\b/)?.[1]);
    if (!Number.isFinite(size) || size <= 0) throw new Error(`无法测量 font ${this.font}`);
    const chars = Array.from(String(text)), spacing = parseFloat(this.letterSpacing) || 0;
    // ASCII 0.6em, all non-ASCII (including CJK/punctuation) 1em; no kerning/shaping.
    const width = chars.reduce((w, c) => w + (c.codePointAt(0) < 128 ? 0.6 : 1)*size, 0) + Math.max(0, chars.length-1)*spacing;
    finite(width, 'measureText.width'); return { width, size, actualBoundingBoxAscent: size, actualBoundingBoxDescent: size*0.2 };
  }
  measureText(s) { this.record('measureText', [s]); return this.metrics(s); }
  fillText(s, x, y, maxWidth) {
    this.drawText('fillText', s, x, y, maxWidth);
  }
  strokeText(s, x, y, maxWidth) { this.drawText('strokeText', s, x, y, maxWidth); }
  drawText(method, s, x, y, maxWidth) {
    numbers([x, y], 2, method); if (maxWidth !== undefined) numbers([maxWidth], 1, `${method}.maxWidth`);
    this.harness.auditFont(this.font, this, method, String(s));
    this.record(method, maxWidth === undefined ? [s, x, y] : [s, x, y, maxWidth]);
    if (!this.canvas.main || !this.harness.collectText || this.globalAlpha < ALPHA || !String(s).trim()) return;
    const { width, size } = this.metrics(s), w = maxWidth == null ? width : Math.min(width, maxWidth), h = size*1.2;
    if (w <= 0) return;
    let left = x;
    const align = this.textAlign === 'start' ? (this.direction === 'rtl' ? 'right' : 'left') : this.textAlign === 'end' ? (this.direction === 'rtl' ? 'left' : 'right') : this.textAlign;
    if (align === 'center') left -= w/2; else if (align === 'right') left -= w;
    const top = y - ({ top: 0, hanging: size*0.2, middle: h/2, alphabetic: size, ideographic: h, bottom: h }[this.textBaseline] ?? size);
    const points = rectPoints(left, top, w, h).map(p => logicalPoint(this, p));
    const poly = applyClips(points, this.clips);
    if (polyArea(poly) <= EPS) { this.harness.clippedText++; return; }
    const alpha = this.globalAlpha * paintAlpha(method === 'strokeText' ? this.strokeStyle : this.fillStyle);
    if (alpha < ALPHA) return;
    const source = sourceAt(), order = ++this.harness.order;
    const text = { text: String(s), bounds: bounds(poly), poly, rawPoly: points, method,
      caption: this.harness.captionDepth > 0, chrome: this.harness.chromeDepth > 0,
      hook: this.harness.hook, alpha, size: logicalFontSize(size, this.m, this.canvas, w/width),
      nominalSize: size, source, order, clipped: polyArea(poly) < polyArea(points)-EPS,
      scopes: [...this.harness.scopes] };
    this.texts.push(text);

  }
}
for (const key of Object.keys(defaults())) {
  Object.defineProperty(AuditContext.prototype, key, {
    get() { return this.state[key]; },
    set(value) {
      finite(value, key);
      if (typeof defaults()[key] === 'number') numbers([value], 1, key);
      if (key === 'globalAlpha' && (value < 0 || value > 1)) {
        if (!this.harness.recoverAlpha) throw new Error(`globalAlpha 越界 ${value}`);
        // Keep the numeric FAIL; Canvas ignores invalid alpha assignments. Continuing
        // here lets an unrelated background error coexist with a complete text audit.
        const origin = sourceAt(), source = origin.frames.slice(0, 4).join(' ← ');
        this.harness.numericIssues.push({ message: 'globalAlpha 越界', value, source, origin });
        this.record('invalid:globalAlpha', [value]); return;
      }
      if (key === 'font') this.harness.auditFont(value, this, 'set:font');
      this.state[key] = value; this.record(`set:${key}`, [value]);
    },
  });
}

class Harness {
  constructor(fontAudit, recoverAlpha = false) {
    this.contexts = []; this.captionDepth = 0; this.chromeDepth = 0; this.collectText = false;
    this.fontAudit = fontAudit; this.time = null; this.phase = '加载';
    this.recoverAlpha = recoverAlpha; this.numericIssues = []; this.hook = 'scene'; this.scopes = []; this.order = 0; this.clippedText = 0; this.shapes = []; this.registrations = [];
  }
  auditFont(font, ctx, method, text) {
    this.fontAudit?.({ font: String(font), family: firstFontFamily(font), method, text,
      t: this.time, phase: this.phase, source: FONT_FAMILIES.has(firstFontFamily(font)) ? null : sourceAt(), canvas: `${ctx.canvas.width}×${ctx.canvas.height}`, main: ctx.canvas.main });
  }
  canvas(w, h, main = false) { return new AuditCanvas(this, w, h, main); }
  balanced() {
    for (const c of this.contexts) if (c.stack.length) throw new Error(`${c.canvas.main ? '主' : '离屏'}画布 save/restore 泄漏 ${c.stack.length}`);
  }
  frame(film, canvas, t, { trace = false, text = false } = {}) {
    this.balanced(); this.collectText = text; this.time = t;
    const c = canvas.context; c.capture = trace; c.trace = []; c.texts = []; this.shapes = []; this.order = 0; this.hook = 'scene'; this.currentFrame = null;
    film.render(canvas, t); this.balanced();
    return { commands: c.trace, texts: c.texts, shapes: this.shapes, actualScene: this.currentFrame?.sc, numericIssues: this.numericIssues.splice(0) };
  }
}
function load(sources, fontAudit) {
  const h = new Harness(fontAudit, true);
  const context = vm.createContext({
    console, Path2D: AuditPath,
    OffscreenCanvas: class { constructor(w, height) { return h.canvas(w, height); } },
    document: { createElement(tag) { if (tag !== 'canvas') throw new Error(`未支持 DOM ${tag}`); return h.canvas(300, 150); } },
  });
  vm.runInContext(`
    globalThis.window = globalThis;
    const impure = name => { throw new Error('禁止非确定性来源: ' + name); };
    Math.random = () => impure('Math.random');
    const NativeDate = Date;
    Date = new Proxy(NativeDate, {
      apply: () => impure('Date()'),
      construct: (target, args) => args.length ? Reflect.construct(target, args) : impure('new Date()'),
      get: (target, key) => key === 'now' ? () => impure('Date.now') : Reflect.get(target, key)
    });
    globalThis.performance = { now: () => impure('performance.now') };
  `, context);
  sources[0].compiled.runInContext(context, { timeout: 10000 });
  // Tag the ACTUAL hooks, not matching strings/font/coordinates. No source edits.
  const create = context.FilmKit.create;
  context.FilmKit.create = function (options) {
    const opts = { ...options };
    for (const hook of ['prepare', 'drawBackground', 'beforeScene', 'drawTransition', 'drawChrome',
      'beforeCaptions', 'drawCaptionBackground', 'drawCaption', 'afterCaptions', 'drawCover']) {
      if (!opts[hook]) continue;
      const draw = opts[hook];
      opts[hook] = function (...args) {
        if (hook === 'beforeScene') h.currentFrame = args[1];
        const old = h.hook; h.hook = hook;
        const caption = hook === 'drawCaption' || hook === 'drawCaptionBackground';
        if (caption) h.captionDepth++; if (hook === 'drawChrome') h.chromeDepth++;
        try { return draw.apply(this, args); }
        finally { h.hook = old; if (caption) h.captionDepth--; if (hook === 'drawChrome') h.chromeDepth--; }
      };
    }
    const builder = create.call(this, opts), add = builder.addScene;
    h.options = options;
    builder.addScene = function (o) {
      h.registrations.push({ options: o, source: sourceAt() });
      return add.call(this, o);
    };
    return builder;
  };
  for (const source of sources.slice(1)) {
    source.compiled.runInContext(context, { timeout: 10000 });
    // Runtime instrumentation only; input sources are never rewritten.
    // Geometry inside bitmap-like thumbnails/postFX is decorative; numerical validation stays active.
    for (const name of ['thumb', 'seg7', 'postFX']) {
      if (typeof context[name] !== 'function' || context[name].auditWrapped) continue;
      const fn = context[name];
      context[name] = function (...args) { h.scopes.push(name); try { return fn.apply(this, args); } finally { h.scopes.pop(); } };
      context[name].auditWrapped = true;
    }
  }

  if (!context.FILM || typeof context.FILM.render !== 'function') throw new Error('没有导出 FILM.render');
  return { h, film: context.FILM, script: vm.runInContext('SCRIPT', context),
    chapters: vm.runInContext('typeof CHAPTERS === "undefined" ? [] : CHAPTERS', context), context };
}

function markerError(text) {
  let closing = null;
  for (const [i, char] of Array.from(text).entries()) {
    if (!'{}[]^'.includes(char)) continue;
    if (closing) {
      if (char !== closing) return `第 ${i+1} 字符 ${quote(char)} 嵌套或错配，应先闭合 ${quote(closing)}`;
      closing = null;
    } else if (char === '{') closing = '}';
    else if (char === '[') closing = ']';
    else if (char === '^') closing = '^';
    else return `第 ${i+1} 字符 ${quote(char)} 没有对应起始标记`;
  }
  return closing ? `缺少闭合标记 ${quote(closing)}` : null;
}
const weightedLength = text => Array.from(text.replace(/[{}\[\]^]/g, '')).reduce((n, c) => n + (c.codePointAt(0) < 128 ? .5 : 1), 0);
function auditScript(script) {
  const issues = [], counts = { scenes: 0, captions: 0 };
  for (const [id, sc] of Object.entries(script)) {
    counts.scenes++;
    const fail = (i, c, rule, detail) => issues.push({ id, index: i+1, start: c?.[0], end: c?.[1], text: c?.[2], rule, detail });
    if (!Number.isFinite(sc.dur) || sc.dur <= 0) fail(-1, null, '场景时长', `dur=${sc.dur}`);
    if (!Array.isArray(sc.caps)) { fail(-1, null, '字幕数据', 'caps 必须为数组'); continue; }
    let previousEnd = -Infinity;
    sc.caps.forEach((c, i) => {
      counts.captions++;
      if (!Array.isArray(c) || c.length !== 3 || typeof c[2] !== 'string') { fail(i, c, '字幕数据', '应为 [起, 止, 文本]'); return; }
      const [start, end, text] = c, weight = weightedLength(text), duration = end-start;
      if (weight > 22) fail(i, c, '加权字数', `${weight} > 22`);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > sc.dur || end <= start) fail(i, c, '字幕范围', `应落在 [0, ${sc.dur}] 且结束晚于开始`);
      if (!Number.isFinite(duration) || duration + EPS < 1.6 || duration + EPS < weight/4.5) fail(i, c, '阅读时长', `${f3(duration)} s；至少 max(1.6, ${weight}/4.5)=${f3(Math.max(1.6, weight/4.5))} s`);
      if (start + EPS < previousEnd) fail(i, c, '时间顺序/重叠', `本句起点 ${start} 早于前句终点 ${previousEnd}`);
      previousEnd = end;
      const error = markerError(text); if (error) fail(i, c, '富文本标记', error);
    });
  }
  return { issues, counts };
}

// Geometry is in the film's logical coordinates. Explicit clips are applied before
// viewport tests: a monitor's discarded content must not be called off-screen text.
const VIEW = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
const rectPoints = (x, y, w, h) => [[x,y], [x+w,y], [x+w,y+h], [x,y+h]];
const boxPoly = b => rectPoints(b.left, b.top, b.right-b.left, b.bottom-b.top);
const bounds = p => p.length ? ({ left: Math.min(...p.map(v=>v[0])), top: Math.min(...p.map(v=>v[1])),
  right: Math.max(...p.map(v=>v[0])), bottom: Math.max(...p.map(v=>v[1])) }) : { left:0, top:0, right:0, bottom:0 };
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const signedArea = p => p.reduce((v,a,i)=>{ const b=p[(i+1)%p.length]; return v+a[0]*b[1]-a[1]*b[0]; },0)/2;
const polyArea = p => Math.abs(signedArea(p));
const area = b => Math.max(0,b.right-b.left)*Math.max(0,b.bottom-b.top);
const intersection = (a,b) => Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
function clipPolygon(subject, boundary) {
  if (boundary.length < 3) return [];
  const sign = signedArea(boundary) >= 0 ? 1 : -1;
  let out = subject;
  for (let i=0;i<boundary.length && out.length;i++) {
    const a=boundary[i], b=boundary[(i+1)%boundary.length], input=out; out=[];
    let prev=input.at(-1), dp=sign*cross(a,b,prev);
    for (const cur of input) {
      const dc=sign*cross(a,b,cur);
      if ((dc >= -EPS) !== (dp >= -EPS)) {
        const u=dp/(dp-dc); out.push([prev[0]+(cur[0]-prev[0])*u,prev[1]+(cur[1]-prev[1])*u]);
      }
      if (dc >= -EPS) out.push(cur);
      prev=cur; dp=dc;
    }
  }
  return out;
}
function applyClips(poly, clips) { for (const c of clips) { poly=clipPolygon(poly,c); if (!poly.length) break; } return poly; }
function logicalPoint(ctx, [x,y]) {
  const [a,b,c,d,e,f]=ctx.m;
  return [(a*x+c*y+e)*WIDTH/ctx.canvas.width,(b*x+d*y+f)*HEIGHT/ctx.canvas.height];
}
function paintAlpha(paint) {
  if (paint instanceof AuditGradient) return Math.max(0,...paint.stops.map(s=>paintAlpha(s[1])));
  if (paint instanceof AuditPattern) return 1;
  const s=String(paint).trim();
  if (s==='transparent') return 0;
  const m=s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const parts=m[1].split(/[,/]/); return parts.length===4 ? parseFloat(parts[3]) : 1; }
  if (/^#[\da-f]{8}$/i.test(s)) return parseInt(s.slice(-2),16)/255;
  return 1;
}
function sourceAt(error) {
  const stack=(error?.stack || new Error().stack).split('\n');
  const frames=stack.filter(s=>/(?:film|kit|script|engine)\.js:\d+:\d+/.test(s)).map(s=>s.trim());
  const locations=frames.map(s=>s.match(/((?:[.\w/-]*\/)?(?:film|kit|script|engine)\.js):(\d+):(\d+)/)).filter(Boolean);
  return { frames, key: frames.join(' ← '), filmLines: [...new Set(locations.filter(m=>m[1]==='film.js').map(m=>+m[2]))],
    at: locations.length ? `${locations[0][1]}:${locations[0][2]}` : 'checks.cjs' };
}
function sourceLabel(s) {
  const first=s?.filmLines?.[0];
  const call=s?.frames?.find(f=>/at (?:Object\.)?draw \(film\.js:/.test(f));
  const caller=call?.match(/film\.js:(\d+):/)?.[1];
  return `${first ? 'film.js:'+first : s?.at || 'checks.cjs'}${caller&&+caller!==first?' → film.js:'+caller:''}${s?.at && s.at!=='film.js:'+first ? '（绘制 '+s.at+'）' : ''}`;
}
function geometryEnabled(g) { return g.canvas.main && g.harness.collectText; }
function addPathCommand(g,name,args) {
  const point=(x,y)=>logicalPoint(g,[x,y]);
  const push=p=>{ if (!g.paths.length) g.paths.push([]); g.paths.at(-1).push(p); };
  if (name==='moveTo') { g.paths.push([point(args[0],args[1])]); return; }
  if (name==='lineTo') { push(point(args[0],args[1])); return; }
  if (name==='closePath') { const p=g.paths.at(-1); if (p?.length) p.closed=true; return; }
  if (name==='rect' || name==='roundRect') {
    let [x,y,w,h]=args; if (w<0) { x+=w; w=-w; } if(h<0) { y+=h; h=-h; }
    if (name==='rect' || !args[4]) { const p=rectPoints(x,y,w,h).map(v=>point(...v)); p.closed=true; g.paths.push(p); return; }
    const raw=Array.isArray(args[4]) ? args[4] : [args[4]], v=raw.map(r=>typeof r==='number'?r:Math.max(r.x,r.y));
    const rs=v.length===1?[v[0],v[0],v[0],v[0]]:v.length===2?[v[0],v[1],v[0],v[1]]:v.length===3?[v[0],v[1],v[2],v[1]]:v;
    const radii=rs.map(r=>Math.min(w/2,h/2,r)), p=[];
    for (const [i,cx,cy,a0] of [[0,x+radii[0],y+radii[0],Math.PI],[1,x+w-radii[1],y+radii[1],-Math.PI/2],[2,x+w-radii[2],y+h-radii[2],0],[3,x+radii[3],y+h-radii[3],Math.PI/2]]) {
      for(let j=0;j<=6;j++){const a=a0+j*Math.PI/12; p.push(point(cx+Math.cos(a)*radii[i],cy+Math.sin(a)*radii[i]));}
    }
    p.closed=true; g.paths.push(p); return;
  }
  if (name==='arc' || name==='ellipse') {
    const [x,y]=args, rx=args[2], ry=name==='arc'?rx:args[3], rot=name==='arc'?0:args[4];
    const a0=args[name==='arc'?3:5], a1=args[name==='arc'?4:6], ccw=!!args[name==='arc'?5:7];
    let sweep=a1-a0;
    if(!ccw){if(sweep>=Math.PI*2) sweep=Math.PI*2; else { sweep%=Math.PI*2; if(sweep<0)sweep+=Math.PI*2; }}
    else {if(sweep<=-Math.PI*2) sweep=-Math.PI*2; else {sweep%=Math.PI*2;if(sweep>0)sweep-=Math.PI*2;}}
    const n=Math.max(2,Math.ceil(Math.abs(sweep)/(Math.PI/16)));
    for(let i=0;i<=n;i++){const a=a0+sweep*i/n,X=rx*Math.cos(a),Y=ry*Math.sin(a);push(point(x+X*Math.cos(rot)-Y*Math.sin(rot),y+X*Math.sin(rot)+Y*Math.cos(rot)));} return;
  }
  if (name==='quadraticCurveTo' || name==='bezierCurveTo') {
    const start=g.paths.at(-1)?.at(-1) || point(args[0],args[1]), pts=[];
    for(let i=0;i<args.length;i+=2)pts.push(point(args[i],args[i+1]));
    for(let k=1;k<=16;k++){const t=k/16,u=1-t;
      push([0,1].map(i=>pts.length===2?u*u*start[i]+2*u*t*pts[0][i]+t*t*pts[1][i]:u*u*u*start[i]+3*u*u*t*pts[0][i]+3*u*t*t*pts[1][i]+t*t*t*pts[2][i]));}return;
  }
  if(name==='arcTo') throw new Error('几何扫描尚未支持 arcTo，不能静默放过裁切');
}
function pathPolys(g, p) {
  if (!(p instanceof AuditPath)) return g.paths;
  const old=g.paths; g.paths=[];
  try { for(const [name,args] of p.commands){ if(!pathMethods.hasOwnProperty(name))throw new Error('不支持的 Path2D 几何 '+name); addPathCommand(g,name,args); } return g.paths; }
  finally { g.paths=old; }
}
for (const [name,count] of Object.entries(pathMethods)) {
  AuditContext.prototype[name]=function(...args){ validatePath(name,args,count);this.record(name,args);if(geometryEnabled(this))addPathCommand(this,name,args); };
}
AuditContext.prototype.beginPath=function(){this.record('beginPath');this.paths=[];};
AuditContext.prototype.clip=function(...args){
  this.record('clip',args); if(!geometryEnabled(this))return;
  const polys=pathPolys(this,args[0]);
  if(polys.length!==1)throw new Error('几何 clip 仅接受单一凸轮廓，不能静默忽略复杂裁切');
  const p=polys[0], sign=signedArea(p)>=0?1:-1;
  if(p.some((a,i)=>sign*cross(a,p[(i+1)%p.length],p[(i+2)%p.length]) < -1e-5))throw new Error('几何 clip 为非凸轮廓');
  this.clips.push(p);
};
function recordShape(g,kind,polys,stroke=false) {
  const h=g.harness;
  if(!geometryEnabled(g) || h.scopes.length || ['drawBackground','prepare'].includes(h.hook))return;
  const paint=stroke?g.strokeStyle:g.fillStyle, alpha=g.globalAlpha*paintAlpha(paint);
  if(alpha<ALPHA)return;
  let pieces=[];
  if(stroke){
    const [a,b,c,d]=g.m, radius=g.lineWidth*Math.max(Math.hypot(a*WIDTH/g.canvas.width,b*HEIGHT/g.canvas.height),Math.hypot(c*WIDTH/g.canvas.width,d*HEIGHT/g.canvas.height))/2;
    for(const p of polys){ const q=p.closed?[...p,p[0]]:p;
      for(let i=1;i<q.length;i++){const A=q[i-1],B=q[i],len=Math.hypot(B[0]-A[0],B[1]-A[1]);if(len<EPS)continue;
        const dx=-(B[1]-A[1])*radius/len,dy=(B[0]-A[0])*radius/len;
        pieces.push([[A[0]+dx,A[1]+dy],[B[0]+dx,B[1]+dy],[B[0]-dx,B[1]-dy],[A[0]-dx,A[1]-dy]]);}
    }
  }else pieces=polys.filter(p=>p.length>=3);
  pieces=pieces.map(p=>applyClips(p,g.clips)).filter(p=>polyArea(p)>EPS);
  if(!pieces.length)return;
  const b=bounds(pieces.flat());
  const zone=(!h.chromeDepth && b.top<110 && b.bottom>0)||(!h.captionDepth && b.bottom>890 && b.top<HEIGHT);
  if(!zone && !g.texts.some(t=>intersection(t.bounds,b)>0))return;
  const source=sourceAt();
  // Curved/concave fills are useful candidates, never conclusive hard failures.
  h.shapes.push({kind,text:kind,polys:pieces,bounds:b,alpha,source,
    order:++h.order,caption:h.captionDepth>0,chrome:h.chromeDepth>0,hook:h.hook,
    gradient:paint instanceof AuditGradient,stroke});
}
for(const method of ['fill','stroke']) AuditContext.prototype[method]=function(...args){
  this.record(method,args); if(geometryEnabled(this))recordShape(this,method,pathPolys(this,args[0]),method==='stroke');
};
for(const method of ['fillRect','strokeRect','clearRect']) AuditContext.prototype[method]=function(...args){
  numbers(args,4,method);this.record(method,args);
  if(geometryEnabled(this) && method!=='clearRect'){const p=rectPoints(...args).map(v=>logicalPoint(this,v));p.closed=true;recordShape(this,method,[p],method==='strokeRect');}
};

function auditTimeline(film, script, chapters) {
  const issues=[], expectedScenes=[], expectedCaps=[], expectedChapters=[]; let total=0,last=-1;
  for(const [id,s] of Object.entries(script)){
    expectedScenes.push({id,chap:s.chapter,start:rounded(total),d:rounded(s.dur)});
    if(!Number.isInteger(s.chapter)||s.chapter<0||s.chapter>=chapters.length||s.chapter<last)issues.push(`${id}：SCRIPT 章号非法或倒退`);
    if(s.chapter!==last){expectedChapters.push({n:s.chapter,t:rounded(total)});last=s.chapter;}
    for(const [a,b,text] of s.caps)expectedCaps.push({t0:rounded(total+a),t1:rounded(total+b),text});
    total+=s.dur;
  }
  const compare=(label,exp,act,keys)=>{
    for(let i=0;i<Math.max(exp.length,act.length);i++){
      const a=exp[i],b=act[i];
      if(!a||!b||keys.some(k=>typeof a[k]==='number'?(!Number.isFinite(b[k])||!sameNumber(a[k],rounded(b[k]))):a[k]!==b[k]))issues.push(`${label} #${i+1}：期望 ${JSON.stringify(a)}；实际 ${JSON.stringify(b)}`);
    }
  };
  compare('幕',expectedScenes,film.scenes,['id','chap','start','d']);
  compare('字幕',expectedCaps,film.captions,['t0','t1','text']);
  compare('章节',expectedChapters,film.chapters,['n','t']);
  if(expectedChapters.length!==chapters.length)issues.push('SCRIPT 使用的章节数与 CHAPTERS 不一致');
  expectedChapters.forEach((c,i)=>{const actual=film.chapterInfo[i], data=chapters[c.n];
    if(!actual||['zh','en','desc'].some((k,j)=>actual[k]!==data?.[j]))issues.push(`章节 ${c.n} 标题/英文/说明与 CHAPTERS 不一致`);});
  if(!sameNumber(rounded(total),rounded(film.duration)))issues.push(`总时长：SCRIPT=${total}，FILM=${film.duration}`);
  return {issues,expectedScenes,expectedCaps,expectedChapters,duration:total};
}

const RULE = { overlap:'文字压文字', outside:'文字出画', small:'字号不足', top:'文字越过顶部外框区',
  bottom:'文字进入字幕区', shapeTop:'图元进入顶部外框区', shapeBottom:'图元进入字幕区', cover:'后绘图元遮挡文字' };
const normText = s => /^\d{1,2}(:\d{2}){1,3}$/.test(s)?'<时间码>':/^\d+(?:\.\d+)?%$/.test(s)?'<百分比>':s;
const identityOf = o => `${o.source?.key}|${o.kind || o.method}|${normText(o.text)}`;
const overlapArea = (a,b) => intersection(a.bounds,b.bounds)>0 ? polyArea(clipPolygon(a.poly,b.poly)) : 0;
const boxLabel = b => `[${f3(b.left)},${f3(b.top)}]–[${f3(b.right)},${f3(b.bottom)}]`;
function hit(rule,objects,ratio,detail='') { return {rule,objects,ratio,detail,key:rule+'|'+objects.map(identityOf).sort().join(' || ')}; }
function geometryHits(frame) {
  const {texts,shapes}=frame, hits=[];
  const fills=texts.filter(t=>t.method==='fillText');
  for(let i=0;i<fills.length;i++)for(let j=i+1;j<fills.length;j++){
    const a=fills[i],b=fills[j];
    const ratio=overlapArea(a,b)/Math.min(polyArea(a.poly),polyArea(b.poly));
    if(ratio>=OVERLAP)hits.push(hit('overlap',[a,b],ratio));
  }
  for(const t of texts){
    const size=t.caption?54:24;
    if(t.size<size-1e-5 && polyArea(clipPolygon(t.poly,boxPoly(VIEW)))>EPS)hits.push(hit('small',[t],size-t.size,`${f3(t.size)} px；门槛 ${size} px；原始 ${t.nominalSize} px`));
    if(!t.chrome){ const p=clipPolygon(t.poly,rectPoints(0,0,WIDTH,110));if(polyArea(p)>EPS)hits.push(hit('top',[t],polyArea(p)/polyArea(t.poly))); }
    if(!t.caption){ const p=clipPolygon(t.poly,rectPoints(0,890,WIDTH,HEIGHT-890));if(polyArea(p)>EPS)hits.push(hit('bottom',[t],polyArea(p)/polyArea(t.poly))); }
    const inside=polyArea(clipPolygon(t.poly,boxPoly(VIEW))), outside=1-inside/polyArea(t.poly);
    if(outside>1e-6)hits.push(hit('outside',[t],outside));
  }
  for(const s of shapes){
    for(const [rule,zone,exempt] of [['shapeTop',rectPoints(0,0,WIDTH,110),s.chrome],['shapeBottom',rectPoints(0,890,WIDTH,HEIGHT-890),s.caption]]){
      if(exempt)continue;
      const a=s.polys.reduce((n,p)=>n+polyArea(clipPolygon(p,zone)),0);
      if(a>1)hits.push(hit(rule,[s],a/s.polys.reduce((n,p)=>n+polyArea(p),0)));
    }
    // Only later foreground drawing can occlude text. Backgrounds, thumbnail
    // internals and postFX are not foreground occluders; numeric checks still run.
    for(const t of fills){
      if(s.order<=t.order || intersection(s.bounds,t.bounds)<=0 || (t.caption&&s.caption)||(t.chrome&&s.chrome))continue;
      const a=s.polys.reduce((n,p)=>n+polyArea(clipPolygon(p,t.poly)),0),ratio=Math.min(1,a/polyArea(t.poly));
      if(ratio>=OVERLAP)hits.push(hit('cover',[t,s],ratio,'几何候选：不模拟像素合成；渐变用最大 alpha，虚线按连续线保守估计'));
    }
  }
  return hits;
}
function expectedReason(h, sc, lt, sourceLines) {
  if(sc.card && lt<1.95) return '章节转场划像';
  const cameraRules=new Set(['outside','small','top','bottom','shapeTop','shapeBottom']);
  const cameraZone=h.rule==='overlap'&&h.objects.some(o=>o.chrome||o.caption);
  // Only the explicitly named travelling cameras, during their actual pan/zoom
  // window. Body/body text collisions are never blanket-exempted by scene id.
  const cs=sc.captions?.map(c=>c.t)||[];
  const travelling=(sc.id==='s01' && lt<4.6)||(sc.id==='s09'&&lt>cs[1]-.3&&lt<sc.dur)||
    (sc.id==='s13'&&lt>cs[1]-.2&&lt<cs[4]+.7)||(sc.id==='s14'&&lt>cs[1]-.3&&lt<sc.dur);
  if(travelling&&(cameraRules.has(h.rule)||cameraZone) && h.objects.some(o=>o.hook==='scene') &&
    !(h.rule==='small'&&h.objects[0].nominalSize<24))return '指定镜头推拉/横移';
  const lines=h.objects.flatMap(o=>o.source?.filmLines||[]), has=s=>lines.some(n=>sourceLines[n-1]?.includes(s));
  // The collapsed SEGS labels intentionally retain 15% alpha while assemble
  // fades in. Keep this explicitly reviewed crossfade separate, even if it lasts
  // several seconds; do not broadly exempt other low-alpha scene collisions.
  if(sc.id==='s07' && ['overlap','cover'].includes(h.rule) && lt>=cs[1]+.5 && lt<cs[2] &&
    h.objects.some(o=>o.alpha<=.16) && h.objects.every(o=>(o.source?.filmLines||[]).some(n=>
      ["text(g, '段 '","text(g, '✓ ' + mmss", "text(g, 'assemble'",'bar(g, 290, y','bar(g, 290, 672'].some(s=>sourceLines[n-1]?.includes(s)))))return 's07 分段收拢的交叉淡化残影';
  if(['s11','s12','s18'].includes(sc.id) && ['overlap','cover'].includes(h.rule)){
    if(has('text(g, hm(M), x, 496') || has('path(g, [[x, 494], [x, 852]]')) return '时间线播放头/时间码经过刻度或标签';
    if(h.rule==='cover' && has('text(g, lab, cx,') && has('g.fillStyle = PH[ph]'))return '时间线片段色块经过中断标签';
    if(h.rule==='cover' && has('if (o.future)'))return '时间线未来区域有意压暗';
  }
  if(h.rule==='cover' && sc.id==='s05' && has('dot(g, p[0], p[1], 12'))return 's05 流动光点';
  if(h.rule==='cover' && sc.id==='s06' && has('rr(g, sx, sy, sw, sh'))return 's06 飞行分段条';
  return null;
}
class Findings {
  constructor(){this.groups=[];this.active=new Map();this.hits=0;}
  add(index,t,sc,hits,sourceLines){
    const unique=new Map();
    for(const item of hits){
      const expected=expectedReason(item,sc,t-sc.start,sourceLines),key=sc.id+'|'+(expected||'')+'|'+item.key;
      this.hits++; const old=unique.get(key);
      if(!old||item.ratio>old.ratio)unique.set(key,{...item,expected,key});
    }
    const next=new Map();
    for(const [key,item] of unique){
      let g=this.active.get(key);
      if(!g||g.lastIndex!==index-1){g={...item,id:sc.id,sceneStart:sc.start,start:t,end:t,count:0,sampleTime:t,maxRatio:item.ratio,
        minSize:item.objects[0].size,maxSize:item.objects[0].size,minAlpha:1,allFaded:true};this.groups.push(g);}
      g.end=t;g.count++;g.lastIndex=index;g.minAlpha=Math.min(g.minAlpha,...item.objects.map(o=>o.alpha));
      g.allFaded &&= item.objects.some(o=>o.alpha<.95);
      if(item.rule==='small'){g.minSize=Math.min(g.minSize,item.objects[0].size);g.maxSize=Math.max(g.maxSize,item.objects[0].size);}
      if(item.ratio>g.maxRatio){g.objects=item.objects;g.detail=item.detail;g.maxRatio=item.ratio;g.sampleTime=t;}
      next.set(key,g);
    }
    this.active=next;
  }
  finish(maxSizes){
    for(const g of this.groups){
      const span=g.end-g.start, o=g.objects[0];
      if(!g.expected && g.rule==='small' && o.nominalSize>=24 && span<=.8 &&
        (maxSizes.get(g.id+'|'+identityOf(o))||0)>=24-1e-5)g.expected='弹出/回弹/翻牌瞬时缩小';
      if(!g.expected && ['overlap','cover'].includes(g.rule) && g.allFaded && g.minAlpha<.85 && span<=.8)g.expected='短暂交叉淡化/渐显';
      g.severity=g.expected?'EXPECTED':(['overlap','outside'].includes(g.rule)&&span>=.5&&g.count>=2&&g.maxRatio>=.15?'FAIL':'WARN');
      if(g.rule==='small'&&o.caption&&!g.expected)g.severity='FAIL';
    }
    return this.groups;
  }
}
function describe(g, full=true) {
  const where=`${g.id} lt=${f3(g.sampleTime-g.sceneStart)}s（全局 ${f3(g.sampleTime)}s）`;
  const objects=g.objects.map(o=>`${quote(o.text)} @ ${boxLabel(o.bounds)} · ${sourceLabel(o.source)}`).join(' ↔ ');
  return `${where} | ${RULE[g.rule]} | ${objects}${g.rule==='small'?` | ${f3(g.minSize)}–${f3(g.maxSize)} px`: ` | 比例 ${(g.maxRatio*100).toFixed(1)}%`}`+
    (full?` | 局部区间 ${f3(g.start-g.sceneStart)}–${f3(g.end-g.sceneStart)}s，${g.count} 点`:'')+(g.expected?` | 预期：${g.expected}`:'');
}
function sampleTimes(film, registrations){
  const times=new Set(),add=t=>{if(t>=0&&t<=film.duration)times.add(+t.toFixed(6));};
  for(let t=0;t<=film.duration;t+=STEP)add(t);add(film.duration);
  for(const sc of film.scenes){
    const o=registrations.find(r=>r.options.id===sc.id)?.options;
    for(const x of [0,1/film.FPS,.25,.75,1.5,1.94,1.96,2.1,sc.d-1/film.FPS])if(x<sc.d)add(sc.start+x);
    for(const cap of o?.captions||[])for(const x of [cap.t-1/film.FPS,cap.t+.15,cap.end-1/film.FPS])if(x>=0&&x<sc.d)add(sc.start+x);
  }
  return [...times].sort((a,b)=>a-b);
}
function loadSources(){return FILES.map(name=>{const text=fs.readFileSync(path.join(__dirname,name),'utf8');return {name,text,hash:sha(text),compiled:new vm.Script(text,{filename:name})};});}

function selfTest(){
  let count=0; const check=fn=>{fn();count++;};
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;
    g.font='24px FCJK';g.textBaseline='top';g.translate(100,200);g.beginPath();g.rect(0,0,60,40);g.clip();g.translate(10,10);
    g.fillText('监视器文字',0,0);assert.deepEqual(g.texts[0].bounds,{left:110,top:210,right:160,bottom:238.8});
    g.fillText('被裁掉',80,0);assert.equal(g.texts.length,1);assert.equal(h.clippedText,1);
    g.save();g.beginPath();g.rect(0,0,2,2);g.clip();g.restore();assert.equal(g.clips.length,1);g.reset();assert.equal(g.clips.length,0);
  });
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH*2,HEIGHT*2,true).context;h.collectText=true;
    g.font='24px FCJK';g.scale(2,2);g.translate(100,200);g.rotate(Math.PI/2);g.textBaseline='top';g.fillText('A',0,0);
    assert.ok(Math.abs(g.texts[0].size-24)<EPS);assert.ok(Math.abs(g.texts[0].bounds.left-71.2)<EPS);
    g.scale(.5,1);g.fillText('缩',0,0);assert.ok(Math.abs(g.texts[1].size-12)<EPS);
  });
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;
    const p=new AuditPath();p.moveTo(0,0);p.lineTo(100,0);p.lineTo(80,100);p.lineTo(0,100);p.closePath();g.clip(p);
    g.font='24px FCJK';g.textBaseline='top';g.fillText('右边被裁切',70,50);assert.ok(g.texts[0].bounds.right<=90+EPS);
    g.reset();g.beginPath();g.roundRect(0,0,100,100,10);g.clip();g.fillText('圆角裁切',0,0);assert.ok(g.texts.at(-1).clipped);
  });
  check(()=>{
    const h=new Harness(null,true),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;
    assert.throws(()=>g.translate(NaN,0));assert.throws(()=>g.lineTo(Infinity,0));assert.throws(()=>g.restore());
    g.globalAlpha=-.1;assert.equal(h.numericIssues.length,1);assert.equal(g.globalAlpha,1);
    g.save();assert.throws(()=>h.balanced());g.restore();h.balanced();
  });
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;g.font='24px FCJK';
    g.fillStyle='rgba(0,0,0,.1)';g.fillText('透明',100,100);assert.equal(g.texts.length,0);
    g.fillStyle='#fff';g.fillText('同名',100,100);g.fillText('同名',100,100);
    assert.equal(geometryHits({texts:g.texts,shapes:[]}).filter(x=>x.rule==='overlap').length,1);
  });
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;g.font='24px FCJK';g.textBaseline='top';
    g.fillText('上',0,100);h.chromeDepth++;g.fillText('外框',50,100);h.chromeDepth--;
    g.fillText('下',0,900);h.captionDepth++;g.font='54px FCJK';g.fillText('字幕',50,900);h.captionDepth--;
    const hits=geometryHits({texts:g.texts,shapes:[]});assert.equal(hits.filter(x=>x.rule==='top').length,1);assert.equal(hits.filter(x=>x.rule==='bottom').length,1);
  });
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;g.font='24px FCJK';g.textBaseline='top';g.fillText('字',100,200);
    g.fillRect(100,200,24,30);assert.equal(geometryHits({texts:g.texts,shapes:h.shapes}).filter(x=>x.rule==='cover').length,1);
    const b=h.canvas(1,1),c=h.canvas(1,1);b.context.fillRect(0,0,1,1);c.context.fillRect(0,0,1,1);assert.deepEqual(b.snapshot(),c.snapshot());
    c.context.fillRect(0,0,2,1);assert.notDeepEqual(b.snapshot(),c.snapshot());
  });
  check(()=>{
    for(const cue of 'whoosh blip tick latch hit clap type error success draw snip scan cut flap'.split(' '))assert.ok(CUE_TYPES.has(cue));
    assert.ok(!CUE_TYPES.has('stamp'));assert.equal(firstFontFamily('700 24px "FCJK", sans-serif'),'FCJK');
    assert.equal(markerError('{甲}[乙]^丙^'),null);assert.ok(markerError('{坏]'));
    assert.ok(auditScript({s:{dur:2,caps:[[0,1,'中'.repeat(23)]]}}).issues.length>=2);
  });
  check(()=>{
    const script={a:{dur:2,chapter:0,caps:[[.1,1.8,'甲']]},b:{dur:3,chapter:1,caps:[[.2,2.8,'乙']]}},chapters=[['甲','A','a'],['乙','B','b']];
    const film={duration:5,scenes:[{id:'a',chap:0,start:0,d:2},{id:'b',chap:1,start:2,d:3}],
      captions:[{t0:.1,t1:1.8,text:'甲'},{t0:2.2,t1:4.8,text:'乙'}],chapters:[{n:0,t:0},{n:1,t:2}],
      chapterInfo:[{n:0,t:0,zh:'甲',en:'A',desc:'a'},{n:1,t:2,zh:'乙',en:'B',desc:'b'}]};
    assert.equal(auditTimeline(film,script,chapters).issues.length,0);
    const missing=structuredClone(film);missing.scenes.pop();assert.ok(auditTimeline(missing,script,chapters).issues.length);
    const changed=structuredClone(film);changed.captions[1].text='错';changed.chapterInfo[0].zh='错';changed.duration=4;
    assert.equal(auditTimeline(changed,script,chapters).issues.length,3);
    const shuffled=structuredClone(film);shuffled.scenes.reverse();assert.ok(auditTimeline(shuffled,script,chapters).issues.length);
  });
  check(()=>{
    const source=(text,name)=>({name,compiled:new vm.Script(text,{filename:name})});
    const make=body=>load([source('var FilmKit={create:o=>({...o,addScene(){}})};','engine.js'),source('const SCRIPT={};','script.js'),source('','kit.js'),
      source(`var options=FilmKit.create({drawChrome(){},drawCaptionBackground(){},drawCaption(){}});var FILM={render(){${body}}};`,'film.js')]);
    for(const expr of ['Math.random()','Date.now()','new Date()','Date()','performance.now()'])assert.throws(()=>make(expr).film.render(),/禁止非确定性/);
    const rt=make('options.drawChrome();options.drawCaptionBackground();options.drawCaption();');
    rt.film.render();assert.equal(rt.h.captionDepth,0);assert.equal(rt.h.chromeDepth,0);
    const h=new Harness(),cv=h.canvas(1920,1080,true);let history=0;
    const film={render(canvas,t){const g=canvas.context;g.reset();g.fillRect(t,history++,1,1);}};
    assert.notDeepEqual(h.frame(film,cv,1,{trace:true}).commands,h.frame(film,cv,1,{trace:true}).commands);
  });
  check(()=>{
    const object={text:'字号',method:'fillText',size:12,nominalSize:24,alpha:1,hook:'scene',poly:rectPoints(0,0,1,1),bounds:VIEW,source:{key:'test',filmLines:[],frames:[]}};
    const sc={id:'x',start:0,card:2},small=hit('small',[object],12);
    assert.equal(expectedReason(small,sc,1.94,[]),'章节转场划像');assert.equal(expectedReason(small,sc,1.96,[]),null);
    const timelineSc={id:'s11',start:0};assert.equal(expectedReason(hit('overlap',[object,object],1),timelineSc,10,[]),null);
    const transient=new Findings();transient.add(0,2,timelineSc,[small],[]);transient.add(1,2.5,timelineSc,[],[]);
    assert.equal(transient.finish(new Map([['s11|'+identityOf(object),24]]))[0].severity,'EXPECTED');
    const persistent=new Findings();for(let i=0;i<4;i++)persistent.add(i,2+i*.5,timelineSc,[small],[]);
    assert.equal(persistent.finish(new Map([['s11|'+identityOf(object),24]]))[0].severity,'WARN');
    const overlaps=new Findings();for(let i=0;i<4;i++)overlaps.add(i,2+i*.5,timelineSc,[hit('overlap',[object,object],1)],[]);
    assert.equal(overlaps.finish(new Map())[0].severity,'FAIL');
  });
  return count;
}

function main(){
  const began=process.hrtime.bigint(),statuses=[],hard=[],fontIssues=new Map(),families=new Set();let fontChecks=0;
  const status=(name,pass,detail)=>{statuses.push({name,pass});console.log(`[${pass?'PASS':'FAIL'}] ${name}：${detail}`);};
  const fail=(name,id,lt,message,source)=>hard.push({name,id,lt,message,source});
  console.log('Claude 是怎么做这 8 期视频的 — 自动检查报告');
  console.log(`Node ${process.version}；逻辑画布 ${WIDTH}×${HEIGHT}；半秒网格 + 幕/字幕/转场边界补点。`);
  console.log('仅读 engine.js / script.js / kit.js / film.js；不启动浏览器，不改输入，不隐式写文件。');
  console.log('用法：node checks.cjs > checks.report.txt；硬检查或明确的持续重叠/出画失败 exit 1；仅 WARN/EXPECTED exit 0。\n');
  status('检查器自检',true,`${selfTest()} 组通过：变换/4K、监视器裁切/restore/reset、Path2D/圆角、数值/栈、透明度/同名重叠、钩子分区、遮挡/资源哈希、白名单/字幕规则、缺幕/错字幕/乱序注入、非确定性来源、预期分类边界`);
  const sources=loadSources(),lines=sources.find(s=>s.name==='film.js').text.split('\n');
  const scriptLines=sources.find(s=>s.name==='script.js').text.split('\n');
  console.log('\n输入 SHA-256：');for(const s of sources)console.log(`  ${s.name} ${s.hash}`);
  const fontAudit=e=>{
    fontChecks++;families.add(e.family);if(FONT_FAMILIES.has(e.family))return;
    const key=e.font+'|'+e.source?.key;
    const old=fontIssues.get(key);if(old)old.count++;else fontIssues.set(key,{...e,count:1});
  };
  const make=()=>load(sources,fontAudit),loaded=make(),{film,script,chapters}=loaded;
  const registrations=loaded.h.registrations;
  const scAt=t=>film.scenes.find(s=>t>=s.start&&t<s.start+s.d)||film.scenes.at(-1);
  const optionsAt=sc=>({...registrations.find(r=>r.options.id===sc.id)?.options,start:sc.start});
  const registrationSource=id=>registrations.find(r=>r.options.id===id)?.source;
  const atIssue=(name,t,message,source)=>{const sc=scAt(t??0);fail(name,sc?.id||'全片',t==null?null:t-sc.start,message,source||registrationSource(sc?.id));};
  status('共享 VM 加载',true,'engine → script → kit → film；禁止 Math.random / 无参 Date / Date.now / performance.now');
  const timeline=auditTimeline(film,script,chapters);
  status('全量时间线',!timeline.issues.length,`SCRIPT ${Object.keys(script).length} 幕、${timeline.expectedCaps.length} 字幕；FILM ${film.scenes.length} 幕、${film.captions.length} 字幕；${f3(timeline.duration)} s（${Math.floor(timeline.duration/60)}:${f3(timeline.duration%60).padStart(6,'0')}），差异 ${timeline.issues.length}`);
  console.log(`  幕顺序：${Object.keys(script).join(' → ')}；章号：${timeline.expectedChapters.map(c=>c.n).join(' → ')}`);
  console.log('  总时长、幕数、幕 id、字幕全文/起止、章号/章节起点/章标题全部来自 SCRIPT/CHAPTERS；缺幕、多幕、重排均 FAIL。');
  console.log('  本期约定：0 开场、1 片名、2–6 五章、7 总结、8 系列片尾；不把这些数字当幕数或时长期望值。');
  for(const e of timeline.issues)fail('时间线','全片',null,e,{at:'script.js:3',filmLines:[]});
  const subs=auditScript(script);
  status('全量字幕数据规则',!subs.issues.length,`${subs.counts.captions} 条，违规 ${subs.issues.length}；沿用模板：加权字数≤22、时长≥max(1.6,字数/4.5)、范围/顺序/富文本标记`);
  for(const e of subs.issues){const n=scriptLines.findIndex(l=>new RegExp('^\\s*'+e.id+':').test(l))+1;
    fail('字幕数据',e.id,e.start,`${e.rule}：${e.detail}；${quote(e.text)}；script.js:${n}`,registrationSource(e.id));}
  const counts={},badCues=[];
  for(const reg of registrations){const sc=film.scenes.find(s=>s.id===reg.options.id);let cues=reg.options.cues||[];
    if(typeof cues==='function')cues=cues({...reg.options,start:sc.start,d:sc.d});
    if(!Array.isArray(cues)){badCues.push({reg,t:0,message:'cue 必须解析成数组'});continue;}
    for(const c of cues){counts[c.type]=(counts[c.type]||0)+1;
      if(!CUE_TYPES.has(c.type)||!Number.isFinite(c.t)||c.t<0||c.t>=sc.d||!Number.isFinite(c.v))badCues.push({reg,t:c.t,message:JSON.stringify(c)});}
  }
  status('cue 白名单/局部范围',!badCues.length,`${film.cues.length} 个；${JSON.stringify(counts)}；异常 ${badCues.length}`);
  console.log(`  白名单：${[...CUE_TYPES].join(' ')}；检查 S()/addScene() 收到的实际数组，支持 IIFE 生成的 cues。`);
  for(const e of badCues)fail('cue',e.reg.options.id,e.t,e.message,e.reg.source);
  if(!Number.isFinite(film.duration)||film.duration<=0||film.duration>3600)throw new Error('无法扫描异常时长 '+film.duration);
  const times=sampleTimes(film,registrations),findings=new Findings(),maxSizes=new Map();let frames=0,textCount=0,shapeCount=0,clipped=0;
  console.log(`\n几何/数值扫描：${times.length} 个 1080p 时刻；每一幕和字幕边界有补点；不按 30fps 穷举。`);
  let runtime=make(),canvas=runtime.h.canvas(WIDTH,HEIGHT,true);runtime.h.phase='1080p 数值/几何';
  let numericStart=hard.length;
  for(const [index,t] of times.entries()){
    const sc=scAt(t),options=optionsAt(sc);
    try{
      const frame=runtime.h.frame(runtime.film,canvas,t,{text:true});frames++;textCount+=frame.texts.length;shapeCount+=frame.shapes.length;
      for(const e of frame.numericIssues)atIssue('数值',t,`${e.message} ${e.value}；图元/属性 ${e.source}`,e.origin);
      const actual=frame.actualScene || options;
      for(const o of frame.texts){const key=actual.id+'|'+identityOf(o);maxSizes.set(key,Math.max(maxSizes.get(key)||0,o.size));}
      findings.add(index,t,actual,geometryHits(frame),lines);
    }catch(e){
      atIssue('帧异常',t,e.message,sourceAt(e));
      findings.add(index,t,options,[],lines);clipped+=runtime.h.clippedText;
      runtime=make();canvas=runtime.h.canvas(WIDTH,HEIGHT,true);runtime.h.phase='1080p 数值/几何恢复';
    }
  }
  clipped+=runtime.h.clippedText;
  status('1080p 数值健康/扫描完整性',hard.length===numericStart&&frames===times.length,`${frames}/${times.length} 帧；异常 ${hard.length-numericStart}；文字 ${textCount} 次；前景图元候选 ${shapeCount} 次；显式 clip 全裁掉文字 ${clipped} 次`);
  const groups=findings.finish(maxSizes);
  // At 4K, verify numeric state at all scene starts/midpoints/ends; affine logical
  // conversion has its own self-test and 4K determinism tests below.
  const fourK=new Set();for(const sc of film.scenes)for(const d of [0,1/film.FPS,sc.d/2,sc.d-1/film.FPS])fourK.add(+(sc.start+d).toFixed(6));
  runtime=make();canvas=runtime.h.canvas(WIDTH*2,HEIGHT*2,true);runtime.h.phase='4K 数值';numericStart=hard.length;let fourCount=0;
  for(const t of [...fourK].sort((a,b)=>a-b))try{const out=runtime.h.frame(runtime.film,canvas,t);fourCount++;
    for(const e of out.numericIssues)atIssue('4K 数值',t,`${e.message} ${e.value}；${e.source}`,e.origin);
  }catch(e){atIssue('4K 帧异常',t,e.message,sourceAt(e));runtime=make();canvas=runtime.h.canvas(WIDTH*2,HEIGHT*2,true);}
  status('4K 数值健康',numericStart===hard.length,`${fourCount}/${fourK.size} 幕边界/中点帧；异常 ${hard.length-numericStart}`);

  console.log('\n乱序渲染确定性：');
  let seed=SEED;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const samples=new Set(film.scenes.map(sc=>+(sc.start+sc.d*.53).toFixed(6)));
  for(let i=0;i<SAMPLE_COUNT;i++)samples.add(+((i+random())/SAMPLE_COUNT*film.duration).toFixed(6));
  const ordered=[...samples].sort((a,b)=>a-b),shuffled=ordered.slice();
  for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  console.log(`  种子 0x${SEED.toString(16)}；${ordered.length} 时刻（每幕一个 + ${SAMPLE_COUNT} 分层随机）；两种尺寸分别比对顺序/倒序/乱序/独立 VM 首帧。`);
  console.log('  比较所有方法/参数/属性写入，浮点保留 3 位；离屏引用用绘制指令和 ImageData 字节哈希；不把时钟或随机数替换成常数。');
  for(const [w,h] of [[WIDTH,HEIGHT],[WIDTH*2,HEIGHT*2]]){
    const rt=make(),cv=rt.h.canvas(w,h,true),baseline=new Map();let checked=0;const begin=hard.length;
    const draw=(r,c,t,label)=>{
      r.h.phase=`确定性 ${w} ${label}`;
      try{const o=r.h.frame(r.film,c,t,{trace:true});for(const e of o.numericIssues)atIssue('确定性数值',t,`${label} ${e.message} ${e.value}；${e.source}`,e.origin);
        return {hash:sha(o.commands.join('\n')),commands:o.commands};
      }catch(e){atIssue('确定性渲染',t,`${label}：${e.message}`,sourceAt(e));return null;}
    };
    for(const t of ordered)baseline.set(t,draw(rt,cv,t,'顺序'));
    const compare=(t,out,label)=>{const expected=baseline.get(t);checked++;
      if(!expected||!out)return;
      if(expected.hash!==out.hash){const i=expected.commands.findIndex((s,i)=>s!==out.commands[i]),j=i<0?expected.commands.length:i;
        atIssue('确定性差异',t,`${w}×${h} ${label}，指令 #${j}；顺序 ${expected.commands[j]}；实际 ${out.commands[j]}`);}
    };
    for(const t of ordered.slice().reverse())compare(t,draw(rt,cv,t,'倒序'),'倒序');
    for(const t of shuffled)compare(t,draw(rt,cv,t,'乱序'),'乱序');
    for(const t of ordered){const one=make();compare(t,draw(one,one.h.canvas(w,h,true),t,'独立 VM'),'独立 VM');}
    status(`确定性 ${w}×${h}`,begin===hard.length,`${checked} 组指令比较；异常 ${hard.length-begin}`);
  }
  status('字体首族白名单',!fontIssues.size,`${fontChecks} 次赋值/绘制检查；首族 ${[...families].sort().join(' / ')}；异常 ${fontIssues.size}`);
  console.log('  允许 FCJK / FDisp / FSup / FMono / FMonoCJK；沿用模板只约束首族，F 中后续系统回退字体不算违规；初始默认字体在实际绘字时仍检查。');
  for(const e of fontIssues.values())atIssue('字体族',e.t,`${quote(e.font)}；${e.count} 次；文字 ${quote(e.text||'<仅赋值/测宽>')}`,e.source);
  const changed=sources.filter(s=>sha(fs.readFileSync(path.join(__dirname,s.name),'utf8'))!==s.hash);
  status('输入版本未变',!changed.length,`${sources.length-changed.length}/${sources.length} 文件哈希一致`);
  for(const s of changed)fail('输入变化','全片',null,s.name,{at:s.name+':1',filmLines:[]});
  const failures=groups.filter(g=>g.severity==='FAIL'),warnings=groups.filter(g=>g.severity==='WARN'),expected=groups.filter(g=>g.severity==='EXPECTED');
  status('持续文字重叠/出画及字幕字号',!failures.length,`${failures.length} 个 FAIL 区间；非预期的重叠/出画至少跨度 0.5s、2 点且比例≥15%；普通字号/分区沿用模板记 WARN`);
  console.log('\n================ FAIL（逐条，影响退出码） ================');
  if(!hard.length&&!failures.length)console.log('无。');
  hard.forEach((e,i)=>console.log(`F${i+1}. ${e.id} lt=${Number.isFinite(e.lt)?f3(e.lt)+'s':'N/A'} | ${e.name} | ${e.message} | ${sourceLabel(e.source)}`));
  failures.sort((a,b)=>a.start-b.start).forEach((g,i)=>console.log(`F${hard.length+i+1}. ${describe(g)}`));
  console.log('\n================ WARN 分类汇总（不影响退出码） ================');
  const categories=new Map();for(const g of warnings){if(!categories.has(g.rule))categories.set(g.rule,[]);categories.get(g.rule).push(g);}
  for(const [rule,list] of categories){
    console.log(`[WARN] ${RULE[rule]}：${list.length} 条区间，${list.reduce((n,g)=>n+g.count,0)} 区间采样命中；代表例子：`);
    for(const g of representative(list))console.log('  '+describe(g));
    if(list.length<3)console.log(`  本类仅 ${list.length} 条，不虚构第 3 个例子。`);
  }
  if(!warnings.length)console.log('无。');
  console.log('\n================ EXPECTED 已知预期（单独归类） ================');
  const expectedNames=['章节转场划像','指定镜头推拉/横移','弹出/回弹/翻牌瞬时缩小','短暂交叉淡化/渐显','s07 分段收拢的交叉淡化残影','时间线播放头/时间码经过刻度或标签','时间线片段色块经过中断标签','时间线未来区域有意压暗','s05 流动光点','s06 飞行分段条'];
  for(const reason of expectedNames){const list=expected.filter(g=>g.expected===reason);
    console.log(`[EXPECTED] ${reason}：${list.length} 条区间，${list.reduce((n,g)=>n+g.count,0)} 区间采样命中。`);
    for(const g of representative(list))console.log('  '+describe(g));
    if(list.length&&list.length<3)console.log(`  本类只有 ${list.length} 条。`);
  }
  console.log('\n================ 判断为真问题：优先复核前 15 条 ================');
  const ranked=rankTrueIssues(groups);
  if(!ranked.length)console.log('没有足够证据列出真问题；不把预期动画充数。');
  ranked.slice(0,15).forEach((g,i)=>console.log(`${i+1}. [${g.severity}] ${describe(g)}${g.rule==='small'?'；持续可见字号不足，非瞬时 pop':''}`));
  console.log(`  真问题候选共 ${ranked.length} 项；按“幕 + 规则 + 文字/调用来源”去重，多个时间区间合并选最严重代表。前 15 条均排除已知预期与短暂/弱证据几何告警。`);
  console.log('\n非预期文字 WARN 完整明细（方便修画面）：');
  warnings.filter(g=>!['shapeTop','shapeBottom','cover'].includes(g.rule)).sort((a,b)=>a.start-b.start).forEach(g=>console.log('  '+describe(g)));
  console.log('\n方法、保守选择和覆盖限制：');
  console.log('1. 文本宽度沿用模板：ASCII 0.6em、其他 Unicode 1em，加 letterSpacing；高 1.2em，alphabetic 为 −1em/+0.2em。未加载真实字形，结论是几何检查，不能替代实际字体/像素验收。');
  console.log('2. 四角经过完整仿射变换再换算到1920×1080；重叠使用变换后的凸多边形交集，坐标输出其外接框。逻辑字号取最小奇异值，含 maxWidth 压缩；字幕目标54px，正文24px。');
  console.log('3. clip 在调用时冻结到逻辑坐标，支持 save/restore/reset、嵌套矩形/圆角/凸 Path2D（章节划像）；先裁切再检查。圆角每角6段近似。完全裁掉的文字不参加任何几何检查；剩余可见部分才判出画/分区。');
  console.log('4. 曲线/弧按多段线近似；非凸/多子路径 clip 或未支持 API 显式失败，不静默 no-op。描边用分段矩形近似，虚线间隙/圆帽未精确模拟；图元遮挡一律 WARN 或 EXPECTED。');
  console.log('5. drawChrome 实际钩子内的图文豁免顶部；drawCaptionBackground/drawCaption 实际钩子内的图文豁免字幕区。背景/后期全屏材质不作为前景分区违规；场景前景图元仍检查。');
  console.log('6. thumb 内无文字，缩略图内部装饰和 seg7 数码管不做文字/前景遮挡分析；监视器回调 s02/s04/s16/s20 的 fillText 正常参与变换和 clip。所有路径仍接受数值/确定性检查。');
  console.log('7. globalAlpha 与填充/描边色 alpha 相乘，低于0.15不计几何；渐变以最大 stop alpha 保守判定。后绘图元仅检查在它之前画的字，不把标签底板误作遮挡；不做像素合成、阴影/滤镜或字形墨迹模拟。');
  console.log('8. 章节 card 且 lt<1.95 的几何命中全部单列预期；指定镜头仅豁免推拉区间的出画/字号/分区及正文与外框字幕相交，正文互相重叠仍查。时间线预期按具体调用来源识别，不豁免整幕。');
  console.log('9. 瞬时缩字须原始字号≥24、同幕同文字来源另有达标采样且区间≤0.8s，才算弹出预期；持续缩小或原始字号不足仍 WARN。短暂交叉淡化须整个区间有 alpha<0.95、至少一处<0.85、跨度≤0.8s；其余保留。');
  console.log('   单独按源码确认：s07 分段收拢后保留15% alpha 的旧标签与 assemble 叠合，归交叉淡化残影；只匹配分段/assemble 的具体调用和该时窗。时间线 o.future 的半透明压暗也单列预期；刻度与断轴省略号的静态重叠不豁免。');
  console.log('10. 连续区间指相邻采样命中，不保证中间每帧都命中。条数按幕/规则/源码调用栈/文字聚合，同帧同来源重复形状取最严重；动态时间码/百分比归一化，其余文字保留。坐标、文字和局部时间来自同一代表帧。');
  console.log('11. .5s 网格和补点仍可能漏掉极短冲突；4K数值只扫各幕边界/中点，确定性每幕+分层抽样；不检音频波形或 drawCover。命令一致性不是数学证明/像素一致性证明。');
  console.log('12. 非法 alpha 仍记 FAIL，忽略赋值以模拟 Canvas 容错后继续扫描；非有限坐标或栈异常会记 FAIL 并重载 VM。检查器自检只验证审计机制，没有修改或给画面补测试。');
  console.log('13. 以上一期 checks.cjs 为基础保留 VM/资源哈希/数值/字体/字幕校验，新增真实 clip、前景图元、源码溯源、全量注册/章标题比对、本期 cue、预期分类、局部时间和真问题排序。');
  const failed=hard.length>0||failures.length>0||statuses.some(s=>!s.pass),seconds=Number(process.hrtime.bigint()-began)/1e9;
  console.log(`\n总结果：[${failed?'FAIL':'PASS'}]；硬异常 ${hard.length} 条，布局 FAIL ${failures.length} 条区间；WARN ${warnings.length} 条/${categories.size} 类；EXPECTED ${expected.length} 条；耗时 ${seconds.toFixed(2)}s；退出码 ${failed?1:0}。`);
  process.exitCode=failed?1:0;
}
function representative(list){
  const sorted=list.slice().sort((a,b)=>(b.end-b.start)-(a.end-a.start)||b.maxRatio-a.maxRatio),out=[],scenes=new Set();
  for(const g of sorted)if(!scenes.has(g.id)){out.push(g);scenes.add(g.id);if(out.length===3)return out;}
  for(const g of sorted)if(!out.includes(g)){out.push(g);if(out.length===3)break;}
  return out;
}
function rankTrueIssues(groups){
  const map=new Map();
  for(const g of groups){
    if(g.expected || !['overlap','outside','small','top','bottom'].includes(g.rule)||g.end-g.start<.5||g.count<2)continue;
    if(g.rule!=='small'&&g.maxRatio<.15)continue;
    const key=g.id+'|'+g.key,old=map.get(key);
    if(!old||(g.end-g.start)>(old.end-old.start))map.set(key,g);
  }
  const priority={overlap:5,bottom:4,small:3,top:2,outside:1};
  return [...map.values()].sort((a,b)=>priority[b.rule]-priority[a.rule]||(b.end-b.start)-(a.end-a.start)||b.maxRatio-a.maxRatio);
}
if(require.main===module){try{main();}catch(e){console.log(`\n[FAIL] 检查器/加载中止：${e.stack}`);process.exitCode=1;}}
module.exports={Harness,load,loadSources,AuditPath,selfTest,auditScript,auditTimeline,geometryHits,Findings,expectedReason,
  rankTrueIssues,clipPolygon,polyArea,logicalFontSize,sourceAt,sourceLabel};
