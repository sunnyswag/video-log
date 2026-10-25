#!/usr/bin/env node
'use strict';
// Audit only: no browser, dependencies, source rewriting, or implicit file writes.
// Run: node checks.cjs > checks.report.txt ; FAIL gives exit 1, warnings alone give 0.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const STEP = 0.25, WIDTH = 1920, HEIGHT = 1080, ALPHA = 0.15, OVERLAP = 0.15;
const SEED = 0x43555254, SAMPLE_COUNT = 120;
const EPS = 1e-9;
const CUE_TYPES = new Set('draw tick blip latch stamp whoosh type success error snip'.split(' '));
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
    this.state = defaults(); this.m = identity(); this.dash = []; this.texts = []; this.trace = [];
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
    this.state = defaults(); this.m = identity(); this.dash = [];
    this.hash = createHash('sha256'); this.cachedDigest = null; this.record('reset');
  }
  save() { this.record('save'); this.stack.push({ state: { ...this.state }, m: this.m.slice(), dash: this.dash.slice() }); }
  restore() {
    if (!this.stack.length) throw new Error('restore 下溢（没有对应 save）');
    this.record('restore'); const saved = this.stack.pop(); this.state = saved.state; this.m = saved.m; this.dash = saved.dash;
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
    const [a, b, c, d, e, f] = this.m;
    const points = [[left, top], [left+w, top], [left+w, top+h], [left, top+h]].map(([px, py]) => [
      (a*px+c*py+e)*WIDTH/this.canvas.width, (b*px+d*py+f)*HEIGHT/this.canvas.height,
    ]);
    finite(points, '文字屏幕坐标');
    const bounds = { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) };
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    this.texts.push({ text: String(s), bounds, method, caption: this.harness.captionDepth > 0,
      chrome: this.harness.chromeDepth > 0, alpha: this.globalAlpha,
      size: logicalFontSize(size, this.m, this.canvas, w/width) });
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
        const source = new Error().stack.split('\n').filter(line => /\b(?:kit|film|script|engine)\.js:\d+/.test(line)).slice(0, 3).map(line => line.trim()).join(' ← ');
        this.harness.numericIssues.push({ message: 'globalAlpha 越界', value, source });
        this.record('invalid:globalAlpha', [value]); return;
      }
      if (key === 'font') this.harness.auditFont(value, this, 'set:font');
      this.state[key] = value; this.record(`set:${key}`, [value]);
    },
  });
}
for (const [name, count] of Object.entries({ ...pathMethods, beginPath: 0, fill: 0, stroke: 0, clip: 0, fillRect: 4, clearRect: 4, strokeRect: 4 })) {
  AuditContext.prototype[name] = function (...args) { validatePath(name, args, count); this.record(name, args); };
}

class Harness {
  constructor(fontAudit, recoverAlpha = false) {
    this.contexts = []; this.captionDepth = 0; this.chromeDepth = 0; this.collectText = false;
    this.fontAudit = fontAudit; this.time = null; this.phase = '加载';
    this.recoverAlpha = recoverAlpha; this.numericIssues = [];
  }
  auditFont(font, ctx, method, text) {
    this.fontAudit?.({ font: String(font), family: firstFontFamily(font), method, text,
      t: this.time, phase: this.phase, canvas: `${ctx.canvas.width}×${ctx.canvas.height}`, main: ctx.canvas.main });
  }
  canvas(w, h, main = false) { return new AuditCanvas(this, w, h, main); }
  balanced() {
    for (const c of this.contexts) if (c.stack.length) throw new Error(`${c.canvas.main ? '主' : '离屏'}画布 save/restore 泄漏 ${c.stack.length}`);
  }
  frame(film, canvas, t, { trace = false, text = false } = {}) {
    this.balanced(); this.collectText = text; this.time = t;
    const c = canvas.context; c.capture = trace; c.trace = []; c.texts = [];
    film.render(canvas, t); this.balanced();
    return { commands: c.trace, texts: c.texts, numericIssues: this.numericIssues.splice(0) };
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
    for (const [hook, depth] of [['drawCaption', 'captionDepth'], ['drawChrome', 'chromeDepth']]) {
      if (!opts[hook]) continue;
      const draw = opts[hook];
      opts[hook] = function (...args) { h[depth]++; try { return draw.apply(this, args); } finally { h[depth]--; } };
    }
    return create.call(this, opts);
  };
  for (const source of sources.slice(1)) source.compiled.runInContext(context, { timeout: 10000 });
  if (!context.FILM || typeof context.FILM.render !== 'function') throw new Error('没有导出 FILM.render');
  return { h, film: context.FILM, script: vm.runInContext('SCRIPT', context),
    chapters: vm.runInContext('typeof CHAPTERS === "undefined" ? [] : CHAPTERS', context), context };
}

function intersection(a, b) {
  return Math.max(0, Math.min(a.right, b.right)-Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom)-Math.max(a.top, b.top));
}
const area = b => (b.right-b.left)*(b.bottom-b.top);
function overlapHits(texts) {
  const hits = [];
  for (let i = 0; i < texts.length; i++) for (let j = i+1; j < texts.length; j++) {
    const a = texts[i], b = texts[j], ratio = intersection(a.bounds, b.bounds)/Math.min(area(a.bounds), area(b.bounds));
    if (ratio < OVERLAP) continue;
    const pair = [a.text, b.text].sort(); // Identical CONTENT from distinct fillText calls still counts.
    hits.push({ key: JSON.stringify(pair), texts: pair, ratio });
  }
  return hits;
}
class Intervals {
  constructor() { this.groups = []; this.active = new Map(); this.hits = 0; this.frames = 0; }
  add(index, t, hits, scene) {
    this.hits += hits.length; if (hits.length) this.frames++;
    const unique = new Map();
    for (const hit of hits) {
      const old = unique.get(hit.key);
      if (!old || (hit.ratio ?? 0) > (old.ratio ?? 0)) unique.set(hit.key, { ...hit,
        minSize: Math.min(hit.size ?? Infinity, old?.minSize ?? Infinity),
        maxSize: Math.max(hit.size ?? -Infinity, old?.maxSize ?? -Infinity) });
      else if (hit.size != null) { old.minSize = Math.min(old.minSize, hit.size); old.maxSize = Math.max(old.maxSize, hit.size); }
    }
    const next = new Map();
    for (const [key, hit] of unique) {
      let group = this.active.get(key);
      if (!group || group.lastIndex !== index-1) {
        group = { ...hit, start: t, end: t, count: 0, minRatio: hit.ratio, maxRatio: hit.ratio, scenes: new Set(), sampleTime: t };
        this.groups.push(group);
      }
      group.end = t; group.lastIndex = index; group.count++; group.scenes.add(scene);
      if (hit.size != null) {
        group.minSize = Math.min(group.minSize, hit.minSize); group.maxSize = Math.max(group.maxSize, hit.maxSize);
      }
      if (hit.ratio != null) {
        if (hit.ratio > group.maxRatio) { group.sampleTime = t; group.bounds = hit.bounds; }
        group.minRatio = Math.min(group.minRatio, hit.ratio); group.maxRatio = Math.max(group.maxRatio, hit.ratio);
      }
      next.set(key, group);
    }
    this.active = next;
  }
  sorted() { return this.groups.slice().sort((a, b) => (b.end-b.start)-(a.end-a.start) || a.start-b.start || (a.key < b.key ? -1 : 1)); }
}
const boxLabel = b => `[${f3(b.left)}, ${f3(b.top)}]–[${f3(b.right)}, ${f3(b.bottom)}]`;
const intervalLabel = g => `${f3(g.start)}–${f3(g.end)} s | 跨度 ${f3(g.end-g.start)} s / ${g.count} 采样点 | ${[...g.scenes].join(',')}`;

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
function auditTimeline(film, script, chapters) {
  const ids = Object.keys(script), registered = new Set(), sceneIssues = [], captionIssues = [], chapterIssues = [], expectedCaps = [];
  let expectedDuration = 0, lastIndex = -1;
  film.scenes.forEach((sc, index) => {
    const where = `${sc.id} @ ${sc.start} s`, sourceIndex = ids.indexOf(sc.id);
    if (registered.has(sc.id)) sceneIssues.push(`${where}：重复注册`);
    registered.add(sc.id);
    if (sourceIndex < 0) { sceneIssues.push(`${where}：不在 SCRIPT 中`); return; }
    if (sourceIndex <= lastIndex) sceneIssues.push(`${where}：顺序不符合 SCRIPT 键顺序`);
    lastIndex = sourceIndex;
    const expected = script[sc.id];
    if (!sameNumber(sc.d, rounded(expected.dur))) sceneIssues.push(`${where}：dur=${sc.d}，SCRIPT=${expected.dur}`);
    if (sc.chap !== expected.chapter) sceneIssues.push(`${where}：chapter=${sc.chap}，SCRIPT=${expected.chapter}`);
    if (!sameNumber(sc.start, rounded(expectedDuration))) sceneIssues.push(`${where}：起点应为 ${rounded(expectedDuration)} s`);
    for (const [t0, t1, text] of expected.caps) expectedCaps.push({ id: sc.id, t0: rounded(expectedDuration+t0), t1: rounded(expectedDuration+t1), text });
    expectedDuration += expected.dur;
  });
  for (let i = 0; i < Math.max(expectedCaps.length, film.captions.length); i++) {
    const e = expectedCaps[i], a = film.captions[i];
    if (!e || !a || e.text !== a.text || !sameNumber(e.t0, a.t0) || !sameNumber(e.t1, a.t1)) captionIssues.push(`#${i+1}：SCRIPT=${JSON.stringify(e) ?? '<无>'}；FILM=${JSON.stringify(a) ?? '<无>'}`);
  }
  const validChapter = n => Number.isInteger(n) && n >= 0 && n < chapters.length;
  film.chapters.forEach((c, i) => {
    if (!validChapter(c.n) || (i && c.n <= film.chapters[i-1].n)) chapterIssues.push(`FILM 章节 #${i+1} @ ${c.t} s：编号 ${c.n} 不在 CHAPTERS 范围内或未严格递增`);
    if (!Number.isFinite(c.t) || (i ? c.t <= film.chapters[i-1].t : c.t !== 0)) chapterIssues.push(`FILM 章节 #${i+1}：时间 ${c.t} 未从 0 严格递增`);
  });
  for (const [label, scenes] of [['SCRIPT', Object.entries(script).map(([id, s]) => ({ id, chap: s.chapter }))], ['FILM', film.scenes]]) {
    scenes.forEach((sc, i) => {
      if (!validChapter(sc.chap) || (i && sc.chap < scenes[i-1].chap)) chapterIssues.push(`${label} ${sc.id}：章号 ${sc.chap} 非法或倒退`);
    });
  }
  return { ids, registered, missing: ids.filter(id => !registered.has(id)), expectedDuration, expectedCaps,
    sceneIssues, captionIssues, chapterIssues };
}
function zoneHits(texts, zone, exempt) {
  return texts.filter(x => !x[exempt] && intersection(x.bounds, zone) > 0).map(x => ({
    key: JSON.stringify([x.text]), texts: [x.text], bounds: x.bounds, ratio: intersection(x.bounds, zone)/area(x.bounds),
  }));
}
function smallTextHits(texts) {
  return texts.filter(x => !x.caption && x.size < 24-EPS).map(x => ({
    key: JSON.stringify([x.text]), texts: [x.text], bounds: x.bounds, size: x.size, ratio: 24-x.size,
  }));
}

function selfTest() {
  let count = 0;
  const check = fn => { fn(); count++; };
  check(() => {
    const h = new Harness(), g = h.canvas(1920, 1080, true).context;
    h.collectText = true; g.font = '20px sans-serif'; g.letterSpacing = '2px';
    assert.equal(g.measureText('中A').width, 34);
    g.translate(100, 200); g.rotate(Math.PI/2); g.scale(2, 3); g.textBaseline = 'top'; g.fillText('A', 0, 0);
    const b = g.texts[0].bounds;
    assert.ok(Math.abs(b.left-28) < 1e-8 && Math.abs(b.right-100) < 1e-8 && Math.abs(b.bottom-224) < 1e-8);
    g.save(); g.letterSpacing = '9px'; g.translate(5, 8); g.restore(); assert.equal(g.letterSpacing, '2px');
  });
  check(() => {
    const h = new Harness(), g = h.canvas(10, 10, true).context; h.collectText = true;
    g.globalAlpha = .149; g.fillText('X', 0, 0); assert.equal(g.texts.length, 0);
    g.globalAlpha = .15; g.fillText('X', 0, 0); g.fillText('X', 0, 0);
    assert.equal(overlapHits(g.texts).length, 1); assert.equal(overlapHits(g.texts.slice(0, 1)).length, 0);
  });
  check(() => {
    const h = new Harness(), g = h.canvas(10, 10).context;
    assert.throws(() => g.lineTo(NaN, 0)); assert.throws(() => g.translate(Infinity, 0));
    assert.throws(() => { g.shadowBlur = NaN; }); assert.throws(() => g.restore());
    g.save(); assert.throws(() => h.balanced()); assert.throws(() => g.reset()); g.restore(); h.balanced();
  });
  check(() => {
    const h = new Harness(), a = h.canvas(1, 1), b = h.canvas(1, 1), c = h.canvas(1, 1);
    const pixels = a.context.createImageData(1, 1); a.context.putImageData(pixels, 0, 0);
    const pixels2 = b.context.createImageData(1, 1); b.context.putImageData(pixels2, 0, 0);
    assert.deepEqual(a.snapshot(), b.snapshot()); pixels2.data[0] = 255; b.context.putImageData(pixels2, 0, 0);
    assert.notDeepEqual(a.snapshot(), b.snapshot()); c.context.fillStyle = '#fff'; c.context.fillRect(0, 0, 1, 1);
    assert.notDeepEqual(a.snapshot(), c.snapshot());
  });
  check(() => {
    const a = new Intervals(), hit = { key: 'x', texts: ['a', 'b'], ratio: .5 };
    a.add(0, 0, [hit, hit], 's1'); a.add(1, .25, [hit], 's1'); a.add(2, .5, [], 's1'); a.add(3, .75, [hit], 's1');
    assert.equal(a.groups.length, 2); assert.equal(a.groups[0].count, 2); assert.equal(a.hits, 4);
  });
  check(() => {
    const h = new Harness(), g = h.canvas(1920, 1080, true).context; h.collectText = true;
    g.font = '20px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('中', 100, 100);
    assert.deepEqual(g.texts[0].bounds, { left: 90, right: 110, top: 88, bottom: 112 });
    h.captionDepth++; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillText('中', 100, 100); h.captionDepth--;
    assert.deepEqual(g.texts[1].bounds, { left: 80, right: 100, top: 80, bottom: 104 });
    assert.equal(g.texts[0].caption, false); assert.equal(g.texts[1].caption, true);
    const box = (left, right) => ({ text: 'X', bounds: { left, right, top: 0, bottom: 100 } });
    assert.equal(overlapHits([box(0, 100), box(85, 185)]).length, 1);
    assert.equal(overlapHits([box(0, 100), box(85.01, 185.01)]).length, 0);
  });
  check(() => {
    const source = text => ({ compiled: new vm.Script(text) });
    const make = (body = '') => load([
      source('var FilmKit = { create: o => o };'), source('const SCRIPT = { x: 42 };'),
      source('const shared = SCRIPT.x;'), source(`var FILM = { render() { ${body} }, value: shared };`),
    ]);
    const rt = make(); assert.equal(rt.film.value, 42);
    for (const body of ['Math.random()', 'Date.now()', 'new Date()', 'Date()', 'performance.now()']) {
      assert.throws(() => make(body).film.render(), /禁止非确定性来源/);
    }
    const states = [];
    const tracked = load([source('var FilmKit = { create: o => o };'), source('const SCRIPT = {};'), source(''),
      source('const opt = FilmKit.create({ drawCaption(g) { g.fillText("同文", 0, 0); } }); var FILM = { render(g) { g.fillText("同文", 0, 0); opt.drawCaption(g); } };')]);
    tracked.film.render({ fillText() { states.push(tracked.h.captionDepth); } });
    assert.deepEqual(states, [0, 1]); assert.equal(tracked.h.captionDepth, 0);
  });
  check(() => {
    const h = new Harness(), cv = h.canvas(10, 10, true), tile = h.canvas(1, 1);
    let history = 0;
    const draw = { render(c, t) { const g = c.getContext('2d'); g.reset(); g.fillRect(t, history, 1, 1); g.drawImage(tile, 0, 0); } };
    const first = h.frame(draw, cv, 1.00001, { trace: true }).commands;
    assert.deepEqual(first, h.frame(draw, cv, 1.00002, { trace: true }).commands);
    history++;
    assert.notDeepEqual(first, h.frame(draw, cv, 1.00001, { trace: true }).commands);
    history = 0; tile.context.putImageData({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) }, 0, 0);
    assert.notDeepEqual(first, h.frame(draw, cv, 1.00001, { trace: true }).commands);
  });
  check(() => {
    assert.equal(weightedLength('{中A}[文]^B^'), 3);
    assert.equal(weightedLength('😀 A'), 2);
    for (const text of ['{中}[文]^字^', '普通', '{}[]^^']) assert.equal(markerError(text), null);
    for (const text of ['{未闭合', '错配]', '{[嵌套]}', '^嵌{套}^', '[交叉}']) assert.ok(markerError(text));
    assert.equal(auditScript({ x: { dur: 3.2, caps: [[0, 1.6, 'abc'], [1.6, 3.2, '{文}']] } }).issues.length, 0);
    const issues = auditScript({ unregistered: { dur: 4, caps: [[0, 1, '中'.repeat(23)], [.5, 5, '{错]']] } }).issues;
    for (const rule of ['加权字数', '阅读时长', '字幕范围', '时间顺序/重叠', '富文本标记']) assert.ok(issues.some(x => x.rule === rule));
    assert.ok(auditScript({ x: { dur: 2, caps: [[0, 1.6, '中'.repeat(8)]] } }).issues.some(x => x.rule === '阅读时长'));
  });
  check(() => {
    const script = { a: { dur: 2.12345, chapter: 0, caps: [[.1, 1.7, '甲']] }, b: { dur: 2.5, chapter: 2, caps: [[.2, 2, '乙']] } };
    const chapters = [[], [], []];
    const make = ids => {
      const film = { scenes: [], captions: [], chapters: [], duration: 0 };
      for (const id of ids) {
        const s = script[id], start = film.duration;
        film.scenes.push({ id, d: rounded(s.dur), chap: s.chapter, start: rounded(start) });
        film.captions.push(...s.caps.map(([a, b, text]) => ({ t0: rounded(start+a), t1: rounded(start+b), text })));
        film.chapters.push({ n: s.chapter, t: start }); film.duration += s.dur;
      }
      return film;
    };
    for (const ids of [['b'], ['a', 'b']]) {
      const film = make(ids), result = auditTimeline(film, script, chapters);
      assert.equal(result.sceneIssues.length + result.captionIssues.length + result.chapterIssues.length, 0);
      assert.equal(result.expectedDuration, film.duration); assert.equal(result.missing.length, 2-ids.length);
    }
    const wrong = make(['a', 'b']); wrong.scenes[0].d++; wrong.scenes[0].chap++; wrong.captions[1].t0++; wrong.captions[0].text = '错';
    const result = auditTimeline(wrong, script, chapters);
    assert.equal(result.sceneIssues.length, 2); assert.equal(result.captionIssues.length, 2);
    assert.ok(auditTimeline(make(['b', 'a']), script, chapters).sceneIssues.length);
    assert.ok(auditTimeline(make(['b', 'a']), script, chapters).chapterIssues.length);
    const unknown = make(['a']); unknown.scenes[0].id = 'unknown'; assert.ok(auditTimeline(unknown, script, chapters).sceneIssues.length);
    assert.ok(auditTimeline(make(['a', 'a']), script, chapters).sceneIssues.length);
  });
  check(() => {
    for (const name of FONT_FAMILIES) for (const family of [name, `'${name}'`, `"${name}"`]) assert.equal(firstFontFamily(`italic 700 24px ${family}, sans-serif`), name);
    assert.equal(firstFontFamily('700 24px/1.2 "FCJK", sans-serif'), 'FCJK');
    assert.equal(firstFontFamily('24px sans-serif, FCJK'), 'sans-serif');
    assert.equal(firstFontFamily('bad font'), null);
    const events = [], h = new Harness(x => events.push(x)), g = h.canvas(1920, 1080, true).context;
    g.font = '24px serif'; g.fillText('错误字体', 0, 0);
    h.canvas(10, 10).context.font = '24px serif';
    assert.equal(events.filter(x => !FONT_FAMILIES.has(x.family)).length, 3);
    for (const cue of ['draw', 'blip', 'snip']) assert.ok(CUE_TYPES.has(cue));
    for (const cue of ['send', 'ring', 'unknown']) assert.ok(!CUE_TYPES.has(cue));
  });
  check(() => {
    const h = new Harness(), g = h.canvas(3840, 2160, true).context; h.collectText = true;
    g.font = '24px FCJK'; g.scale(2, 2); g.rotate(Math.PI/3); g.fillText('达标', 100, 100);
    assert.equal(smallTextHits(g.texts).length, 0);
    g.scale(.5, 1); g.strokeText('压缩', 100, 100);
    assert.ok(Math.abs(g.texts[1].size-12) < EPS); assert.equal(smallTextHits(g.texts).length, 1);
    h.captionDepth++; g.fillText('字幕', 100, 100); h.captionDepth--;
    assert.equal(smallTextHits(g.texts).length, 1);
    assert.throws(() => g.strokeText('坏参数', 0, 0, NaN));
    const a = new Intervals(), hit = size => ({ key: 'x', texts: ['压缩'], size, ratio: 24-size });
    a.add(0, 0, [hit(20), hit(12)], 'x'); a.add(1, .25, [hit(18)], 'x');
    assert.equal(a.groups[0].minSize, 12); assert.equal(a.groups[0].maxSize, 20);
  });
  check(() => {
    const h = new Harness(), g = h.canvas(1920, 1080, true).context; h.collectText = true;
    g.font = '24px FCJK'; g.textBaseline = 'top'; g.fillText('场景', 10, 100);
    h.chromeDepth++; g.strokeText('外框', 10, 100); h.chromeDepth--;
    assert.equal(zoneHits(g.texts, { left: 0, right: WIDTH, top: 0, bottom: 110 }, 'chrome').length, 1);
    g.fillText('临界', 10, 110);
    assert.equal(zoneHits(g.texts.slice(2), { left: 0, right: WIDTH, top: 0, bottom: 110 }, 'chrome').length, 0);
    g.translate(0, 800); g.strokeText('底部场景', 10, 100);
    h.captionDepth++; g.fillText('字幕', 10, 100); h.captionDepth--;
    assert.equal(zoneHits(g.texts, { left: 0, right: WIDTH, top: 890, bottom: HEIGHT }, 'caption').length, 1);
  });
  check(() => {
    const source = text => ({ compiled: new vm.Script(text) });
    const rt = load([source('var FilmKit = { create: o => o };'), source('const SCRIPT = {};'), source(''),
      source('const opt = FilmKit.create({ drawChrome(g) { g(); }, drawCaption(g) { g(); } }); var FILM = { render(g) { opt.drawChrome(g); opt.drawCaption(g); } };')]);
    const states = []; rt.film.render(() => states.push([rt.h.chromeDepth, rt.h.captionDepth]));
    assert.deepEqual(states, [[1, 0], [0, 1]]);
    assert.throws(() => rt.film.render(() => { throw new Error('hook error'); }));
    assert.equal(rt.h.chromeDepth, 0); assert.equal(rt.h.captionDepth, 0);
  });
  check(() => {
    const h = new Harness(null, true), canvas = h.canvas(1920, 1080, true), g = canvas.context;
    const film = { render() { g.globalAlpha = .5; g.globalAlpha = -.01; g.globalAlpha = 1.01; g.font = '24px FCJK'; g.fillText('继续检查', 100, 100); } };
    const out = h.frame(film, canvas, 0, { text: true, trace: true });
    assert.equal(out.numericIssues.length, 2); assert.equal(out.texts.length, 1); assert.equal(g.globalAlpha, .5);
    assert.ok(out.commands.some(line => line.includes('invalid:globalAlpha')));
    assert.throws(() => { g.globalAlpha = NaN; });
  });
  return count;
}

function main() {
  const statuses = [], warnings = [];
  const status = (name, pass, detail) => { statuses.push({ name, pass }); console.log(`[${pass ? '通过' : '失败'}] ${name}：${detail}`); };
  const warn = (name, hits, detail) => { if (hits) warnings.push({ name, hits }); console.log(`[${hits ? '告警' : '通过'}] ${name}：${detail}`); };
  console.log('窗帘单双电机与 spec 隔离 — 自动检查完整报告');
  console.log(`Node ${process.version}；逻辑画布 ${WIDTH}×${HEIGHT}；采样间隔 ${STEP} s（包含 0 和片尾）`);
  console.log('检查只读取源文件。FAIL 导致退出码 1；字号/页眉区/字幕区告警不算 FAIL。几何结果需真实浏览器复核。\n');
  status('检查器自检', true, `${selfTest()} 组：原有8组 + 全量字幕/标记、子集与全量时间线/错误注入、字体与cue白名单、4K逻辑字号/strokeText、分区边界、双钩子归属与异常恢复、非法透明度记FAIL后继续审计`);
  const sources = FILES.map(name => {
    const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
    return { name, hash: sha(text), compiled: new vm.Script(text, { filename: name }) };
  });
  console.log('\n本次输入 SHA-256（方便设计方定位版本）：');
  for (const s of sources) console.log(`  ${s.name}  ${s.hash}`);
  const fontFindings = new Map(), usedFamilies = new Set(); let fontChecks = 0;
  const observeFont = event => {
    fontChecks++; usedFamilies.add(event.family);
    if (FONT_FAMILIES.has(event.family)) return;
    const key = JSON.stringify([event.font, event.main]);
    let finding = fontFindings.get(key);
    if (!finding) { finding = { ...event, count: 0, times: new Set(), texts: new Set(), phases: new Set() }; fontFindings.set(key, finding); }
    finding.count++; finding.times.add(event.t); finding.phases.add(event.phase);
    if (event.text) finding.texts.add(event.text);
  };
  const makeRuntime = () => load(sources, observeFont);
  const loaded = makeRuntime(), { film, script, chapters } = loaded;
  status('加载', true, 'engine.js → script.js → kit.js → film.js，共享一个 vm context；FILM.render 可调用');
  const timeline = auditTimeline(film, script, chapters), subtitles = auditScript(script);
  const delta = Math.abs(film.duration-timeline.expectedDuration);
  status('时长', Number.isFinite(delta) && delta <= .05+EPS, `${f3(film.duration)} s；已注册幕 SCRIPT.dur 之和 ${f3(timeline.expectedDuration)} s；误差 ${f3(delta)} s，容许 ≤0.05 s`);
  status('场景', !timeline.sceneIssues.length, `已注册 ${film.scenes.length} / ${timeline.ids.length} 幕；${film.scenes.map(s => s.id).join(' → ')}；id/dur/chapter/顺序/拼接起点差异 ${timeline.sceneIssues.length}`);
  for (const issue of timeline.sceneIssues) console.log(`  ${issue}`);
  console.log(`  未注册（不算 FAIL）：${timeline.missing.join(', ') || '无'}`);
  status('字幕一致性', !timeline.captionIssues.length, `已注册幕期望 ${timeline.expectedCaps.length} 条，FILM ${film.captions.length} 条；文本和起止时间差异 ${timeline.captionIssues.length}`);
  console.log('  时间按已注册幕顺序累计 SCRIPT.dur，不累计跳过的幕；逐项与 FilmKit.finish() 的三位小数导出值比较。');
  for (const issue of timeline.captionIssues) console.log(`  ${issue}`);
  status('全量字幕规则', !subtitles.issues.length, `SCRIPT 全部 ${subtitles.counts.scenes} 幕 / ${subtitles.counts.captions} 条；违规 ${subtitles.issues.length} 条次（含未注册幕）`);
  console.log('  去掉 {}、[]、^ 后按 Unicode 码点计数：ASCII（含空格/标点）0.5，其余1；≤22；时长≥1.6s且≥字数/4.5；不重叠、幕内、标记配对且不嵌套。');
  for (const e of subtitles.issues) console.log(`  ${e.id} #${e.index} 局部 ${e.start}–${e.end} s ${quote(e.text)}：${e.rule}；${e.detail}`);
  const badCues = film.cues.filter(c => !CUE_TYPES.has(c.type)), cueCounts = Object.create(null);
  for (const cue of film.cues) cueCounts[cue.type] = (cueCounts[cue.type] || 0)+1;
  status('cue 类型', !badCues.length, `共 ${film.cues.length}；非法 ${badCues.length}；${JSON.stringify(cueCounts)}`);
  console.log(`  白名单：${[...CUE_TYPES].join(' ')}`);
  for (const cue of badCues) console.log(`  ${JSON.stringify(cue)}`);
  status('章节', !timeline.chapterIssues.length, `已登记 ${film.chapters.length} / CHAPTERS ${chapters.length} 章；编号 ${film.chapters.map(c => c.n).join(' → ')}；编号严格递增（可跳号），时间从0严格递增，SCRIPT/FILM 场景章号不递减`);
  for (const issue of timeline.chapterIssues) console.log(`  ${issue}`);
  const sceneAt = t => film.scenes.find(s => t >= s.start && t < s.start+s.d)?.id || film.scenes.at(-1).id;
  const duration = film.duration;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error(`无法扫描时长 ${duration}`);
  const times = Array.from({ length: Math.floor(duration/STEP)+1 }, (_, i) => i*STEP);
  if (times.at(-1) < duration) times.push(duration);
  const overlap = new Intervals(), outside = new Intervals(), subtitle = new Intervals(), header = new Intervals(), small = new Intervals();
  let layoutFrames = 0, visibleTexts = 0, strokeTexts = 0;
  console.log('\n数值健康与几何扫描：');
  console.log('globalAlpha 超出[0,1]仍记数值 FAIL，但按 Canvas 语义忽略该赋值、保留前值并继续扫描；非有限数/栈错误等仍中断该帧。');
  for (const [w, h] of [[WIDTH, HEIGHT], [WIDTH*2, HEIGHT*2]]) {
    let runtime = makeRuntime(), canvas = runtime.h.canvas(w, h, true), errors = [], checked = 0;
    runtime.h.phase = `数值健康 ${w}×${h}`;
    for (const [index, t] of times.entries()) {
      try {
        const out = runtime.h.frame(runtime.film, canvas, t, { text: w === WIDTH }); checked++;
        if (out.numericIssues.length) {
          const groups = new Map();
          for (const issue of out.numericIssues) {
            const key = issue.message + issue.source, old = groups.get(key);
            if (old) { old.count++; old.min = Math.min(old.min, issue.value); old.max = Math.max(old.max, issue.value); }
            else groups.set(key, { ...issue, count: 1, min: issue.value, max: issue.value });
          }
          errors.push({ t, scene: sceneAt(t), message: [...groups.values()].map(e => `${e.message} ${e.min}～${e.max}（${e.count}次）；${e.source || '无源码位置'}；无关联文字`).join('；') });
        }
        if (w !== WIDTH) continue;
        const fills = out.texts.filter(x => x.method === 'fillText');
        layoutFrames++; visibleTexts += fills.length; strokeTexts += out.texts.length-fills.length;
        overlap.add(index, t, overlapHits(fills), sceneAt(t));
        outside.add(index, t, fills.filter(x => x.bounds.left < 0 || x.bounds.top < 0 || x.bounds.right > WIDTH || x.bounds.bottom > HEIGHT).map(x => ({
          key: JSON.stringify([x.text, x.caption]), texts: [x.text], bounds: x.bounds, caption: x.caption,
          ratio: 1-intersection(x.bounds, { left: 0, top: 0, right: WIDTH, bottom: HEIGHT })/area(x.bounds),
        })), sceneAt(t));
        subtitle.add(index, t, zoneHits(out.texts, { left: 0, right: WIDTH, top: 890, bottom: HEIGHT }, 'caption'), sceneAt(t));
        header.add(index, t, zoneHits(out.texts, { left: 0, right: WIDTH, top: 0, bottom: 110 }, 'chrome'), sceneAt(t));
        small.add(index, t, smallTextHits(out.texts), sceneAt(t));
      } catch (error) {
        errors.push({ t, scene: sceneAt(t), message: error.message });
        // Resume with a clean VM so one bad frame cannot contaminate the remaining scan.
        runtime = makeRuntime(); canvas = runtime.h.canvas(w, h, true); runtime.h.phase = `数值健康 ${w}×${h}`;
      }
    }
    status(`数值健康 ${w}×${h}`, !errors.length, `${checked}/${times.length} 帧完成；异常/非有限参数/栈失衡 ${errors.length} 帧（含离屏画布）`);
    for (const e of errors) console.log(`  ${f3(e.t)} s ${e.scene}：${e.message}`);
  }

  console.log('\n确定性：');
  let seed = SEED;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0)/4294967296; };
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, i) => Number(((i+random())/SAMPLE_COUNT*duration).toFixed(6)));
  console.log(`固定种子 0x${SEED.toString(16)}，${SAMPLE_COUNT} 个分层随机时刻；按方法名/参数/属性写入记录，数字四舍五入至 3 位小数。`);
  console.log('离屏构建不混入主画布序列；drawImage/createPattern 引用离屏指令及真实 ImageData 字节的内容哈希，兼顾冷启动与缓存复用。');
  console.log('Math.random、无参 Date/new Date、Date.now、performance.now 被禁止；没有用固定值掩盖非确定性。');
  console.log('非法透明度写入也纳入指令比较；其数值FAIL单列在数值健康中，不阻断本项的渲染顺序比较。');
  console.log(`采样秒数：${samples.join(', ')}`);
  for (const [w, h] of [[WIDTH, HEIGHT], [WIDTH*2, HEIGHT*2]]) {
    const runtime = makeRuntime(), canvas = runtime.h.canvas(w, h, true), baseline = new Map(), errors = [], numericErrors = new Map();
    let renders = 0, comparisons = 0, matches = 0;
    const draw = (rt, cv, t, label) => {
      rt.h.phase = `确定性 ${w}×${h} ${label}`;
      try {
        const out = rt.h.frame(rt.film, cv, t, { trace: true }); renders++;
        for (const issue of out.numericIssues) {
          const key = label + issue.message + issue.source, old = numericErrors.get(key);
          if (old) { old.times.add(t); old.count++; old.min = Math.min(old.min, issue.value); old.max = Math.max(old.max, issue.value); }
          else numericErrors.set(key, { ...issue, label, times: new Set([t]), count: 1, min: issue.value, max: issue.value });
        }
        return out.commands;
      }
      catch (e) { errors.push(`${label} ${f3(t)} s：${e.message}`); return null; }
    };
    for (const t of samples) baseline.set(t, draw(runtime, canvas, t, '顺序'));
    const compare = (t, commands, label) => {
      comparisons++; const expectedCommands = baseline.get(t);
      if (!commands || !expectedCommands) return;
      const first = expectedCommands.findIndex((line, i) => line !== commands[i]);
      if (first < 0 && expectedCommands.length === commands.length) { matches++; return; }
      const at = first < 0 ? expectedCommands.length : first;
      errors.push(`${label} ${f3(t)} s ${sceneAt(t)}：指令 #${at}，总数 ${expectedCommands.length}/${commands.length}\n    顺序：${expectedCommands[at] ?? '<结束>'}\n    实际：${commands[at] ?? '<结束>'}`);
    };
    for (const t of samples.slice().reverse()) compare(t, draw(runtime, canvas, t, '倒序'), '倒序');
    for (const t of samples) {
      const single = makeRuntime(), cv = single.h.canvas(w, h, true);
      compare(t, draw(single, cv, t, '独立 VM 首帧'), '独立 VM 首帧');
    }
    status(`确定性 ${w}×${h}`, !errors.length && !numericErrors.size && matches === SAMPLE_COUNT*2, `${renders}/${SAMPLE_COUNT*3} 次 render；${matches}/${comparisons} 组逐指令完全一致；差异/中断 ${errors.length}；数值异常 ${numericErrors.size} 组（数值非法仍使本项FAIL）`);
    for (const error of errors) console.log(`  ${error}`);
    for (const e of numericErrors.values()) {
      const hitTimes = [...e.times].sort((a, b) => a-b);
      console.log(`  ${e.label}：${f3(hitTimes[0])}–${f3(hitTimes.at(-1))} s 的 ${hitTimes.length} 个采样时刻（非连续区间），${e.message} ${e.min}～${e.max}（${e.count}次）；${e.source || '无源码位置'}；无关联文字`);
    }
  }

  console.log('\n字体首族（所有实际执行的 ctx.font 赋值及文字绘制，含离屏/测宽/低透明度路径）：');
  status('字体白名单', !fontFindings.size, `${fontChecks} 次检查；首族 ${[...usedFamilies].map(x => x ?? '<无法解析>').sort().join(', ')}；非法组合 ${fontFindings.size}`);
  console.log(`  允许：${[...FONT_FAMILIES].join(' / ')}；只查首族，允许后续回退族。Canvas 初始默认值不算赋值，未设置字体就绘字仍会被检查。`);
  for (const e of fontFindings.values()) {
    const times = [...e.times].filter(x => x !== null).sort((a, b) => a-b);
    console.log(`  ${quote(e.font)}；首族 ${quote(e.family)}；${e.main ? '主画布' : '离屏'}；${e.count} 次；${times.length ? `首末命中 ${f3(times[0])}–${f3(times.at(-1))} s（不表示连续）` : '加载阶段，无帧时刻'}${e.times.has(null) && times.length ? '，另含加载阶段' : ''}；文字 ${[...e.texts].map(quote).join('、') || '<仅赋值/测宽>'}`);
  }
  console.log('\n文字几何规则：');
  console.log(`1920×1080；成功扫描 ${layoutFrames}/${times.length} 帧；有效 fillText ${visibleTexts} 次、strokeText ${strokeTexts} 次；globalAlpha < ${ALPHA} 或空白文本忽略。`);
  console.log('宽度：ASCII 0.6×字号，CJK/其他非 ASCII 1.0×字号，加 (字符数−1)×letterSpacing；高度 1.2×字号。');
  console.log('按 textAlign/textBaseline 放置，将四角经当前仿射矩阵变换后取屏幕 AABB；alphabetic 为基线−1em 至+0.2em。');
  console.log('相交比例 = 交集面积 / 较小框面积；比例 ≥15% 才报告。只排除同一次调用自身，同名但不同调用照查。');
  console.log('按无序文字对/相邻采样点聚合；中间一个采样点消失即分段。跨度=末次−首次命中，单点跨度为0，不推断两次采样之间持续可见。');
  console.log('同一帧同一内容对只计一个区间采样点；“命中次数”保留全部调用对。按跨度降序、开始时间升序排序。');
  console.log('重叠/出画延续上一期只检查 fillText；新增字号和分区检查 fillText/strokeText，避免把同一字的填充+描边新增为重叠 FAIL。');
  console.log('以下时刻均为当前已注册样片的全局时间；全量字幕规则单独标注幕内局部时间。');
  status('文字重叠', layoutFrames === times.length && !overlap.hits, `${overlap.hits} 对次，${overlap.frames} 帧，${overlap.groups.length} 个连续区间；以下前 ${Math.min(40, overlap.groups.length)} 条`);
  for (const [i, g] of overlap.sorted().slice(0, 40).entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])} ↔ ${quote(g.texts[1])} | 相交 ${(g.minRatio*100).toFixed(1)}%–${(g.maxRatio*100).toFixed(1)}%`);
  if (!overlap.groups.length) console.log('  无。');

  console.log('\n超出画面边界的文字（全部区间）：');
  status('文字越界', layoutFrames === times.length && !outside.hits, `${outside.hits} 次，${outside.frames} 帧，${outside.groups.length} 个区间；边界 [0,1920]×[0,1080]，不套用15%阈值`);
  for (const [i, g] of outside.sorted().entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])}${g.caption ? ' [字幕]' : ''} | 越界 ${(g.minRatio*100).toFixed(1)}%–${(g.maxRatio*100).toFixed(1)}% | ${f3(g.sampleTime)} s 框 ${boxLabel(g.bounds)}`);
  if (!outside.groups.length) console.log('  无。');

  console.log('\n字号告警（全部区间，不算 FAIL）：');
  warn('非字幕字号', small.hits, `${small.hits} 次，${small.frames} 帧，${small.groups.length} 个区间；换算至1920×1080后 <24 px`);
  console.log('逻辑字号 = px字号 × 去除画布分辨率缩放后矩阵的最小奇异值（包含 maxWidth 压缩）；非等比缩放/斜切取最小倍率，旋转不改变字号。');
  for (const [i, g] of small.sorted().entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])} | 字号 ${f3(g.minSize)}–${f3(g.maxSize)} px | 最小字号采样 ${f3(g.sampleTime)} s`);
  if (!small.groups.length) console.log('  无。');

  console.log('\n页眉区/字幕区告警（全部区间，不算 FAIL）：');
  console.log('身份由 FilmKit.create 的 drawChrome/drawCaption 实际钩子调用期间标记；屏幕内保留区任意正面积进入即报告，即使钩子当时没有画字。');
  for (const [name, intervals, rule] of [['页眉区', header, 'y < 110，仅 drawChrome 文字豁免'], ['字幕区', subtitle, 'y > 890，仅 drawCaption 文字豁免']]) {
    warn(name, intervals.hits, `${intervals.hits} 次，${intervals.frames} 帧，${intervals.groups.length} 个区间；${rule}`);
    for (const [i, g] of intervals.sorted().entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])} | 入区 ${(g.minRatio*100).toFixed(1)}%–${(g.maxRatio*100).toFixed(1)}% | ${f3(g.sampleTime)} s 框 ${boxLabel(g.bounds)}`);
    if (!intervals.groups.length) console.log('  无。');
  }
  if (layoutFrames !== times.length) console.log('  扫描存在失败帧，字号/分区覆盖不完整；对应数值健康/文字几何项已记 FAIL。');

  const changed = sources.filter(s => sha(fs.readFileSync(path.join(__dirname, s.name), 'utf8')) !== s.hash);
  status('输入版本一致性', !changed.length, `${sources.length-changed.length}/${sources.length} 份输入在检查期间未变；本报告使用开头哈希标识的源码快照`);
  for (const s of changed) console.log(`  检查期间 ${s.name} 已变化，请针对当前源码重跑。`);

  console.log('\n误报风险与覆盖限制：');
  console.log('1. 字号估宽没有读取 fonts.css 的真实字形度量、字距调整和字形墨迹；font weight/回退字体/中英标点会改变实际宽高，也会改变字幕换行。');
  console.log('2. 旋转后的文字使用轴对齐外接框，空白角落也算面积；1.2em 高度和基线位置是估算，邻近文字可能被多算或漏算。');
  console.log('3. clip/Path2D/遮罩仅记录指令，未执行像素裁切；后绘不透明底板、遮挡、擦除、合成模式和滤镜未做可见性消除。转场/屏幕裁切/故意交叉淡化会产生告警。');
  console.log('4. 仅按 globalAlpha 过滤，fillStyle/strokeStyle 的 rgba 透明度不相乘；描边按相同字框估算、不额外膨胀线宽；阴影、离屏/图片中的字和字形缺失不纳入文字几何框。离屏字体赋值仍查白名单。');
  console.log('5. 字幕富文本按每次 fillText 分段；逐字动画可能只显示单个字。相同文字的多个位置会按内容合并到同一连续区间。');
  console.log('6. y<110/y>890 只检查屏幕内的预留区，不要求与当前页眉/字幕真正相交；完全在屏幕外的字由出画规则报告。字号与分区沿用0.15透明度门槛；小字号不因处于画外而豁免。');
  console.log('7. 0.25s 网格可能漏掉更短的瞬时冲突；确定性是两种尺寸各120个时间点的抽检、3位小数指令一致性，不是数学纯函数证明或像素一致性证明。');
  console.log('8. 不同尺寸分别验证，未交替切换尺寸/穿插 drawCover；离屏哈希按构建指令保守判断，不模拟复杂像素覆盖，冗余的重复离屏绘制可能触发差异。');
  console.log('9. 此假画布对未知方法不提供静默 no-op；当前脚本用到的 API 已实现。Canvas 的浏览器容错、抗锯齿、裁切等语义仍需沙箱外关键帧验收。');
  console.log('10. 字体/几何为实际执行路径审计，不静态推断未注册场景和未采样分支；未提供自定义 drawCaption 时，引擎默认字幕无法由该钩子标记，按普通文字保守报告。当前片使用自定义钩子。');
  console.log('11. 时间线逐项按引擎毫秒导出精度比较；总时长容差0.05s，边界计算仅用1e-9抵消浮点误差。章节范围取 CHAPTERS.length，允许跳过尚未注册章节，保留章节时间从0严格递增检查。');
  console.log('12. 全注册时仍用同一逻辑：FILM顺序须为SCRIPT键序的子序列；每幕源时长累计生成字幕期望，集合差变空即可；不存在样片id、固定幕数、固定字幕数或固定总时长分支。');
  console.log('13. 非法 globalAlpha 不放宽[0,1]阈值，仍使报告FAIL；忽略赋值仅模拟浏览器的继续执行语义，以保留后续文字/确定性覆盖，不改源代码，也不将数值问题隐藏为通过。');
  const failures = statuses.filter(s => !s.pass);
  console.log(`\n总结果：[${failures.length ? '失败' : '通过'}] ${statuses.length-failures.length}/${statuses.length} 项硬检查通过，${failures.length} 项失败${failures.length ? '（'+failures.map(s => s.name).join('、')+'）' : ''}；${warnings.length} 类告警${warnings.length ? '（'+warnings.map(s => s.name).join('、')+'）' : ''}不影响退出码。退出码 ${failures.length ? 1 : 0}。`);
  process.exitCode = failures.length ? 1 : 0;
}
if (require.main === module) {
  try { main(); }
  catch (error) { console.log(`\n[失败] 检查器/加载中止：${error.stack}`); process.exitCode = 1; }
}
module.exports = { Harness, load, AuditPath, overlapHits, Intervals, selfTest, auditTimeline, auditScript,
  firstFontFamily, logicalFontSize, markerError, weightedLength, zoneHits, smallTextHits };
