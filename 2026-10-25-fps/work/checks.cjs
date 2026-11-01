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
const SEED = 0x46505331, SAMPLE_COUNT = 120;
const EPS = 1e-9;
const CUE_TYPES = new Set('draw tick blip latch whoosh success error shutter'.split(' '));
const FONT_FAMILIES = new Set(['FCJK', 'FDisp', 'FSup', 'FMono', 'FMonoCJK']);
const FILES = ['../../tools/film-kit/engine.js', 'script.js', 'kit.js', 'film.js'];
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = () => [1, 0, 0, 1, 0, 0];
const quote = s => JSON.stringify(s);
const f3 = n => n.toFixed(3);
const rounded = n => Number(n.toFixed(3)); // FilmKit.finish() exports milliseconds.
const sameNumber = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= EPS;
Error.stackTraceLimit = 40;
const SCREEN = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
function sourceSite() {
  const frames = (new Error().stack || '').split('\n').filter(s => /(?:film|kit|script|engine)\.js:\d+:\d+/.test(s));
  const locations = [...new Set(frames.map(s => s.match(/((?:[\w./-]*\/)?(?:film|kit|script|engine)\.js:\d+):\d+/)?.[1]).filter(Boolean))];
  return { source: locations.join(' ← ') || '<检查器>', filmLine: locations.find(s => /^film\.js:/.test(s)), site: locations.join('|'), stack: frames.join('\n') };
}
function clipped(a, b) {
  if (!b) return { ...a };
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}
function transformedBox(box, m, canvas) {
  const [a,b,c,d,e,f] = m;
  const ps = [[box.left,box.top],[box.right,box.top],[box.right,box.bottom],[box.left,box.bottom]].map(([x,y]) => [(a*x+c*y+e)*WIDTH/canvas.width,(b*x+d*y+f)*HEIGHT/canvas.height]);
  finite(ps, '包围框');
  return { left: Math.min(...ps.map(p=>p[0])), right: Math.max(...ps.map(p=>p[0])), top: Math.min(...ps.map(p=>p[1])), bottom: Math.max(...ps.map(p=>p[1])) };
}
function paintAlpha(style) {
  if (typeof style !== 'string') return 1;
  if (style === 'transparent') return 0;
  const m = style.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/);
  return m ? Math.max(0, Math.min(1, Number(m[1]))) : 1;
}

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
    this.clipBox = null; this.clipApprox = false; this.pathBox = null; this.pathSimple = false;
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
    this.clipBox = null; this.clipApprox = false; this.pathBox = null; this.pathSimple = false;
    this.hash = createHash('sha256'); this.cachedDigest = null; this.record('reset');
  }
  save() { this.record('save'); this.stack.push({ state: { ...this.state }, m: this.m.slice(), dash: this.dash.slice(), clipBox: this.clipBox, clipApprox: this.clipApprox }); }
  restore() {
    if (!this.stack.length) throw new Error('restore 下溢（没有对应 save）');
    this.record('restore'); const saved = this.stack.pop(); this.state = saved.state; this.m = saved.m; this.dash = saved.dash;
    this.clipBox = saved.clipBox; this.clipApprox = saved.clipApprox;
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
    const alpha = this.globalAlpha * paintAlpha(method === 'strokeText' ? this.strokeStyle : this.fillStyle);
    if (!this.canvas.main || !this.harness.collectText || alpha < ALPHA || !String(s).trim()) return;
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
    const rawBounds = { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) };
    const bounds = clipped(rawBounds, this.clipBox);
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    this.texts.push({ text: String(s), bounds, rawBounds, method, kind: 'text', ...sourceSite(), clipApprox: this.clipApprox,
      caption: this.harness.captionDepth > 0, chrome: this.harness.chromeDepth > 0, alpha,
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
  AuditContext.prototype[name] = function (...args) {
    validatePath(name, args, count); this.record(name, args);
    if (!this.canvas.main || !this.harness.collectText) return;
    if (name === 'beginPath') { this.pathBox = null; this.pathSimple = true; this.pathApprox = false; }
    else if (name === 'rect' || name === 'roundRect') {
      const [x,y,w,h] = args;
      if (this.pathBox) this.pathSimple = false;
      this.pathBox = transformedBox({ left: Math.min(x,x+w), top: Math.min(y,y+h), right: Math.max(x,x+w), bottom: Math.max(y,y+h) }, this.m, this.canvas);
      // Round corners and rotated rectangles use an enclosing AABB (conservative).
      if (name === 'roundRect' || Math.abs(this.m[1]) > EPS || Math.abs(this.m[2]) > EPS) this.pathApprox = true;
    } else if (name === 'clip') {
      if (!args.some(x=>x instanceof AuditPath) && this.pathSimple && this.pathBox) { this.clipBox = clipped(this.pathBox, this.clipBox); this.clipApprox ||= this.pathApprox; }
      else this.clipApprox = true;
    } else if (name in pathMethods && name !== 'closePath') this.pathSimple = false;
  };
}

class Harness {
  constructor(fontAudit, recoverAlpha = false) {
    this.contexts = []; this.captionDepth = 0; this.chromeDepth = 0; this.collectText = false;
    this.fontAudit = fontAudit; this.time = null; this.phase = '加载';
    this.recoverAlpha = recoverAlpha; this.numericIssues = [];
    this.scenes = new Map(); this.primitives = []; this.flyDepth = 0;
  }
  auditFont(font, ctx, method, text) {
    this.fontAudit?.({ font: String(font), family: firstFontFamily(font), method, text,
      t: this.time, phase: this.phase, canvas: `${ctx.canvas.width}×${ctx.canvas.height}`, main: ctx.canvas.main,
      ...(!FONT_FAMILIES.has(firstFontFamily(font)) ? sourceSite() : {}) });
  }
  canvas(w, h, main = false) { return new AuditCanvas(this, w, h, main); }
  balanced() {
    for (const c of this.contexts) if (c.stack.length) throw new Error(`${c.canvas.main ? '主' : '离屏'}画布 save/restore 泄漏 ${c.stack.length}`);
  }
  frame(film, canvas, t, { trace = false, text = false } = {}) {
    this.balanced(); this.collectText = text; this.time = t;
    const c = canvas.context; c.capture = trace; c.trace = []; c.texts = []; this.primitives = [];
    film.render(canvas, t); this.balanced();
    return { commands: c.trace, texts: c.texts, primitives: this.primitives, numericIssues: this.numericIssues.splice(0) };
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
    for (const [hook, depth] of [['drawCaption', 'captionDepth'], ['drawCaptionBackground', 'captionDepth'], ['drawChrome', 'chromeDepth']]) {
      if (!opts[hook]) continue;
      const draw = opts[hook];
      opts[hook] = function (...args) { h[depth]++; try { return draw.apply(this, args); } finally { h[depth]--; } };
    }
    h.captionConfig = opts.captions;
    const builder = create.call(this, opts);
    if (builder.addScene) {
      const add = builder.addScene;
      builder.addScene = function (o) { const sc = add.call(this, o); h.scenes.set(sc.id, sc); return sc; };
    }
    return builder;
  };
  for (const source of sources.slice(1)) source.compiled.runInContext(context, { timeout: 10000 });
  installPrimitiveAudit(context, h);
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
    for (const cue of ['draw', 'blip', 'shutter']) assert.ok(CUE_TYPES.has(cue));
    for (const cue of ['stamp', 'type', 'snip', 'unknown']) assert.ok(!CUE_TYPES.has(cue));
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

// Instrument callable bindings inside the VM; the four input files stay byte-for-byte intact.
// These boxes supplement actual fillText calls. They never masquerade as font glyphs.
function installPrimitiveAudit(context, h) {
  function add(g, text, kind, box, alpha = g.globalAlpha, extra = {}) {
    if (!h.collectText || !g.canvas.main || alpha < ALPHA) return;
    const rawBounds = transformedBox(box, g.m, g.canvas), bounds = clipped(rawBounds, g.clipBox);
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    h.primitives.push({ text, kind, method: kind, rawBounds, bounds, alpha, ...sourceSite(), ...extra });
  }
  const wrap = (name, observe) => {
    if (typeof context[name] !== 'function') return;
    const original = context[name];
    context[name] = function (...args) { if (h.collectText) observe(...args); return original.apply(this, args); };
  };
  wrap('seg7', (g, s, x, y, height, col, o = {}) => {
    const width = context.seg7W(s, height), left = o.a === 'left' ? x : o.a === 'right' ? x-width : x-width/2;
    // Bound the actual digit cells, including their -0.08 shear, but not glow.
    let advance = 0, lo = Infinity, hi = -Infinity;
    for (const ch of s) {
      const cell = ch === '.' ? [.06-.078, .06+.078] : ch === '+' ? [.04,.42] : [0,.48];
      if (ch !== ' ') { lo = Math.min(lo, advance+cell[0]*height); hi = Math.max(hi, advance+cell[1]*height); }
      advance += (ch === '.' ? .2 : ch === '+' ? .5 : .62)*height;
    }
    if (Number.isFinite(lo)) add(g, `seg7(${s})`, 'seg7', { left: left+lo-.04*height, right: left+hi+.04*height, top: y-height/2, bottom: y+height/2 }, g.globalAlpha*(o.al == null ? 1 : Math.max(0,Math.min(1,o.al))));
  });
  if (typeof context.flyIcon === 'function') {
    const original = context.flyIcon;
    context.flyIcon = function (...args) { h.flyDepth++; try { return original.apply(this,args); } finally { h.flyDepth--; } };
  }
  wrap('icon', (g,x,y,s,k,o={}) => {
    if (!h.flyDepth || s <= .001) return;
    add(g, `飞行 icon(${k})`, 'flyingIcon', { left:x-40*s,right:x+40*s,top:y-47*s,bottom:y+47*s }, g.globalAlpha*(o.al??1));
  });
  wrap('touch', (g,a,b,lt,t0,d) => {
    const clamp = x => Math.max(0,Math.min(1,x)), u0=clamp((lt-t0)/d), u=u0<.5?4*u0**3:1-(-2*u0+2)**3/2;
    const alpha=Math.min(clamp((lt-t0+.15)/.15),1-clamp((lt-t0-d)/.2))*.7*g.globalAlpha;
    const x=a[0]+(b[0]-a[0])*u,y=a[1]+(b[1]-a[1])*u;
    add(g,'手指触点圆圈','touch',{left:x-28,right:x+28,top:y-28,bottom:y+28},alpha);
  });
  wrap('devBoard', (g,x,y,s) => {
    if (s<=.001) return;
    add(g,'开发板屏幕','screen',{left:x-240*s,right:x+240*s,top:y-170*s,bottom:y+102*s});
  });
}

function auditCompleteTimeline(film, script, chapters) {
  const issues=[], ids=Object.keys(script), expectedCaps=[], expectedChapters=[];
  let duration=0,lastChapter;
  for (const [i,id] of ids.entries()) {
    const s=script[id], sc=film.scenes[i];
    const issue=(rule,detail,lt=0,text=id)=>issues.push({id,lt,rule,detail,text});
    if (!sc || sc.id!==id) issue('完整场景序列',`第 ${i+1} 幕期望 ${id}，实际 ${sc?.id??'<缺失>'}`);
    if (sc && (sc.chap!==s.chapter || !sameNumber(sc.d,rounded(s.dur)) || !sameNumber(sc.start,rounded(duration)))) issue('场景参数',`SCRIPT start/dur/chapter=${rounded(duration)}/${s.dur}/${s.chapter}，FILM=${sc.start}/${sc.d}/${sc.chap}`);
    if (!Number.isInteger(s.chapter) || s.chapter<0 || s.chapter>=chapters.length || (lastChapter!=null && s.chapter<lastChapter)) issue('章节范围/顺序',String(s.chapter));
    if (s.chapter!==lastChapter) expectedChapters.push({n:s.chapter,t:duration,id});
    lastChapter=s.chapter;
    for (const [a,b,text] of s.caps) expectedCaps.push({id,lt:a,t0:rounded(duration+a),t1:rounded(duration+b),text});
    duration+=s.dur;
  }
  for (const sc of film.scenes.slice(ids.length)) issues.push({id:sc.id,lt:0,rule:'额外场景',detail:'SCRIPT 中没有对应幕',text:sc.id});
  for(let i=0;i<Math.max(film.captions.length,expectedCaps.length);i++) {
    const a=film.captions[i],e=expectedCaps[i];
    if(!a||!e||a.text!==e.text||!sameNumber(a.t0,e.t0)||!sameNumber(a.t1,e.t1)) issues.push({id:e?.id??'<时间线>',lt:e?.lt??0,rule:'字幕一致性',text:e?.text??a?.text,detail:`#${i+1} SCRIPT=${JSON.stringify(e)} FILM=${JSON.stringify(a)}`});
  }
  for(let i=0;i<Math.max(film.chapters.length,expectedChapters.length,chapters.length);i++) {
    const a=film.chapters[i],e=expectedChapters[i],info=film.chapterInfo?.[i];
    if(!a||!e||a.n!==e.n||!sameNumber(a.t,e.t)||!info||['zh','en','desc'].some((k,j)=>info[k]!==chapters[e.n]?.[j])) issues.push({id:e?.id??'<章节>',lt:0,rule:'完整章节',text:chapters[e?.n]?.[0],detail:`#${i+1} SCRIPT=${JSON.stringify(e)} FILM=${JSON.stringify(a)}；同时核对 CHAPTERS 标题/英文/说明`});
  }
  if(!sameNumber(film.duration,duration)) issues.push({id:'<全片>',lt:0,rule:'总时长',text:'SCRIPT.dur',detail:`期望 ${duration}，实际 ${film.duration}`});
  return {issues,ids,duration,expectedCaps,expectedChapters};
}

// Adjacent sampled hits are grouped by scene and call site, never by text alone.
class Ledger {
  constructor() { this.groups=[];this.active=new Map();this.hits=0; }
  add(index,t,sc,hits) {
    const next=new Map();
    for(const hit of hits) {
      this.hits++;
      const key=JSON.stringify([sc.id,hit.severity,hit.rule,hit.items.map(x=>x.identity).sort()]);
      let g=next.get(key)||this.active.get(key);
      if(!g||g.lastIndex<index-1) {g={...hit,key,id:sc.id,start:t,end:t,startLT:t-sc.start,endLT:t-sc.start,count:0,occurrences:0,sample:{t,lt:t-sc.start,...hit},peak:-Infinity};this.groups.push(g);}
      if(g.lastIndex!==index) g.count++;
      g.lastIndex=index;g.end=t;g.endLT=t-sc.start;g.occurrences++;
      const score=hit.ratio??0;
      if(score>g.peak) {g.peak=score;g.sample={t,lt:t-sc.start,...hit};}
      next.set(key,g);
    }
    this.active=next;
  }
}
function identify(items) {
  const counts=new Map();
  for(const x of items) {
    const base=JSON.stringify([x.kind,x.site,x.chrome,x.caption]),n=counts.get(base)||0;counts.set(base,n+1);
    x.identity=base+'#'+n;
  }
}
function geometryHits(out, sc, lt, camera) {
  const hits=[], glyphs=out.texts.filter(x=>x.method==='fillText'), segs=out.primitives.filter(x=>x.kind==='seg7');
  identify([...out.texts,...out.primitives]);
  const chapter=sc.card!=null&&lt<1.95;
  function add(severity,rule,items,ratio,detail) {
    if(chapter) { detail=`原规则「${rule}」；${detail}；有 card 且 lt<1.95，可能被转场带遮挡`;severity='EXPECTED';rule='章节转场色带'; }
    hits.push({severity,rule,items,ratio,detail});
  }
  const onscreen=x=>intersection(x.bounds,SCREEN)>EPS;
  const visible=[...glyphs,...segs].filter(onscreen);
  for(let i=0;i<visible.length;i++) for(let j=i+1;j<visible.length;j++) {
    const a=visible[i],b=visible[j],ab=clipped(a.bounds,SCREEN),bb=clipped(b.bounds,SCREEN),ratio=intersection(ab,bb)/Math.min(area(ab),area(bb));
    if(ratio<OVERLAP) continue;
    const lines=[a,b].map(x=>Number(x.filmLine?.split(':')[1]));
    const center=x=>[(x.rawBounds.left+x.rawBounds.right)/2,(x.rawBounds.top+x.rawBounds.bottom)/2];
    const ac=center(a),bc=center(b);
    const crossfade=a.kind==='text'&&b.kind==='text'&&a.text!==b.text&&Math.abs(a.alpha+b.alpha-1)<.03&&Math.min(a.alpha,b.alpha)<.85&&Math.abs(lines[0]-lines[1])<=2&&Math.abs(ac[0]-bc[0])<1&&Math.abs(ac[1]-bc[1])<1&&ratio>.85;
    if(crossfade) add('EXPECTED','交叉淡化',[a,b],ratio,'同位置、相邻绘制调用、互补透明度；保留记录');
    else if(a.kind==='seg7'||b.kind==='seg7') add('WARN','七段数码管包围框相交',[a,b],ratio,'数码管按字符单元外接框登记，不代表发光段像素一定压字');
    else add('FAIL','文字压文字',[a,b],ratio,'可见文字估算框相交 ≥15%');
  }
  for(const x of out.texts) {
    if(!onscreen(x)) continue;
    if(!x.chrome&&intersection(x.bounds,{...SCREEN,bottom:110})>EPS) add('WARN','越过顶部外框区',[x],intersection(x.bounds,{...SCREEN,bottom:110})/area(x.bounds),'y<110，仅 drawChrome 归属豁免');
    if(!x.caption&&intersection(x.bounds,{...SCREEN,top:890})>EPS) add('WARN','文字进入字幕区',[x],intersection(x.bounds,{...SCREEN,top:890})/area(x.bounds),'y>890，仅 drawCaptionBackground/drawCaption 归属豁免');
    if(x.caption&&Math.abs(x.size-54)>EPS) add('FAIL','字幕字号',[x],Math.abs(x.size-54),`逻辑字号 ${f3(x.size)} px，要求 54px`);
    if(!x.caption&&!x.chrome&&x.size<24-EPS) add('WARN','正文字号不足',[x],24-x.size,`逻辑字号 ${f3(x.size)} px <24px`);
    const ratio=1-intersection(x.bounds,SCREEN)/area(x.bounds);
    if(ratio>EPS) {
      const [cx,cy,z]=camera||[WIDTH/2,HEIGHT/2,1],b=x.bounds;
      const neutral={left:(b.left-WIDTH/2)/z+cx,right:(b.right-WIDTH/2)/z+cx,top:(b.top-HEIGHT/2)/z+cy,bottom:(b.bottom-HEIGHT/2)/z+cy};
      const cameraOnly=!x.caption&&!x.chrome&&(z!==1||cx!==WIDTH/2||cy!==HEIGHT/2)&&intersection(neutral,SCREEN)>=area(neutral)-EPS;
      add(cameraOnly?'EXPECTED':'WARN',cameraOnly?'镜头推拉出画':'文字出画待复核',[x],ratio,cameraOnly?'撤去镜头变换后框完全在画内':'可能是位移入场或裁切；不将单次屏外框直接判为失败');
    }
  }
  // Targeted primitive/text checks; panels, background, rulers and corner lines are not text.
  for(const p of out.primitives.filter(x=>['flyingIcon','touch'].includes(x.kind))) {
    const targets=p.kind==='touch'?out.primitives.filter(x=>x.kind==='screen'):[...glyphs,...segs];
    for(const x of targets) {
      if(!onscreen(p)||!onscreen(x)) continue;
      const ratio=intersection(p.bounds,x.bounds)/Math.min(area(p.bounds),area(x.bounds));
      if(ratio<OVERLAP) continue;
      const known=p.kind==='touch'&&sc.id==='s01'||p.kind==='flyingIcon'&&['s05','s06'].includes(sc.id);
      add(known?'EXPECTED':'WARN',p.kind==='touch'?'触点圆圈经过屏幕':'飞行图标经过文字',[p,x],ratio,'按图元包围框登记；已知演示动作，未模拟逐像素遮挡');
    }
  }
  return hits;
}

function episodeLabel(g) {
  const s=g.sample;
  return `${g.id} | lt=${f3(g.startLT)}–${f3(g.endLT)}s（${g.count}采样点，${g.occurrences}命中）| 代表 lt=${f3(s.lt)}s / t=${f3(s.t)}s | ${g.rule}\n    ${s.detail}；值=${f3(s.ratio??0)}\n    `+
    s.items.map(x=>`${quote(x.text)} ${boxLabel(x.bounds)}${x.size!=null?` size=${f3(x.size)}px`:''} α=${f3(x.alpha??1)} | ${x.source}`).join('\n    ');
}

const hasFailures = (hard, groups, statuses) => hard.length>0 || groups.some(g=>g.severity==='FAIL') || statuses.some(s=>!s.pass);

function fpsSelfTest() {
  let n=selfTest(); const check=fn=>{fn();n++;};
  check(()=>{
    const s={a:{dur:2,chapter:0,caps:[[0,1.6,'甲']]},b:{dur:2,chapter:1,caps:[[0,1.6,'乙']]}},c=[['甲','A','一'],['乙','B','二']];
    const film={duration:4,scenes:[{id:'a',start:0,d:2,chap:0},{id:'b',start:2,d:2,chap:1}],captions:[{t0:0,t1:1.6,text:'甲'},{t0:2,t1:3.6,text:'乙'}],chapters:[{n:0,t:0},{n:1,t:2}],chapterInfo:[{zh:'甲',en:'A',desc:'一'},{zh:'乙',en:'B',desc:'二'}]};
    assert.equal(auditCompleteTimeline(film,s,c).issues.length,0);
    assert.ok(auditCompleteTimeline({...film,scenes:film.scenes.slice(1)},s,c).issues.length);
    assert.ok(auditCompleteTimeline({...film,duration:2},s,c).issues.some(x=>x.rule==='总时长'));
    assert.ok(auditCompleteTimeline({...film,chapters:[]},s,c).issues.length);
  });
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;g.font='24px FCJK';g.textBaseline='top';
    g.save();g.beginPath();g.rect(100,100,100,100);g.clip();g.fillText('裁切',0,0);assert.equal(g.texts.length,0);
    g.fillText('边界',90,110);assert.equal(g.texts[0].bounds.left,100);g.restore();g.fillText('恢复',0,0);assert.equal(g.texts.length,2);
    g.fillStyle='rgba(1,2,3,.1)';g.fillText('透明',0,0);assert.equal(g.texts.length,2);
  });
  check(()=>{
    const box={left:100,right:200,top:200,bottom:250},item=(text,line,alpha=1)=>({text,kind:'text',method:'fillText',site:line,source:line,filmLine:line,bounds:box,rawBounds:box,alpha,size:30});
    const out={texts:[item('甲','film.js:1'),item('乙','film.js:2')],primitives:[]};
    assert.equal(geometryHits(out,{id:'x'},2).filter(x=>x.severity==='FAIL').length,1);
    assert.ok(geometryHits(out,{id:'x',card:2},1).every(x=>x.severity==='EXPECTED'));
    out.texts[0].alpha=.4;out.texts[1].alpha=.6;assert.ok(geometryHits(out,{id:'x'},2).some(x=>x.rule==='交叉淡化'));
    out.texts=[{...item('正文','film.js:8'),bounds:{...box,top:900,bottom:930},rawBounds:{...box,top:900,bottom:930},size:20}];
    assert.ok(geometryHits(out,{id:'x'},2).some(x=>x.rule==='文字进入字幕区'));
    assert.ok(geometryHits(out,{id:'x'},2).some(x=>x.rule==='正文字号不足'));
    out.texts[0].caption=true;assert.ok(geometryHits(out,{id:'x'},2).some(x=>x.rule==='字幕字号'));
  });
  check(()=>{
    const h=new Harness(),g=h.canvas(WIDTH,HEIGHT,true).context;h.collectText=true;
    const fake={seg7(){},seg7W:s=>s.length*62};installPrimitiveAudit(fake,h);fake.seg7(g,'12',100,200,100,'#fff');
    assert.equal(h.primitives.length,1);assert.equal(h.primitives[0].kind,'seg7');assert.equal(h.primitives[0].bounds.top,150);
    const ledger=new Ledger(),hit={severity:'WARN',rule:'x',items:[{identity:'x'}],ratio:1};
    ledger.add(0,0,{id:'a',start:0},[hit]);ledger.add(1,.25,{id:'b',start:.25},[hit]);assert.equal(ledger.groups.length,2);
  });
  check(()=>{
    const box={left:100,right:200,top:200,bottom:250};
    const item=(kind,text)=>({kind,text,method:kind==='text'?'fillText':kind,site:text,source:'film.js:1',filmLine:'film.js:1',bounds:box,rawBounds:box,alpha:1,size:30});
    const a=item('text','字'),icon=item('flyingIcon','icon');
    for(const id of ['s05','s06']) assert.equal(geometryHits({texts:[a],primitives:[icon]},{id},3)[0].severity,'EXPECTED');
    assert.equal(geometryHits({texts:[a],primitives:[icon]},{id:'s07'},3)[0].severity,'WARN');
    const touch=item('touch','触点'),screen=item('screen','屏幕');
    assert.equal(geometryHits({texts:[],primitives:[touch,screen]},{id:'s01'},3)[0].severity,'EXPECTED');
    assert.equal(geometryHits({texts:[],primitives:[touch,screen]},{id:'s02'},3)[0].severity,'WARN');
    const seg=item('seg7','数码管');seg.size=1;
    assert.deepEqual(geometryHits({texts:[a],primitives:[seg]},{id:'s02'},3).map(x=>x.rule),['七段数码管包围框相交']);
    const off={...a,bounds:{left:-10,right:100,top:200,bottom:250},rawBounds:{left:-10,right:100,top:200,bottom:250}};
    assert.ok(geometryHits({texts:[off],primitives:[]},{id:'x'},3,[1000,540,1]).some(x=>x.rule==='镜头推拉出画'&&x.severity==='EXPECTED'));
    const x={...a,alpha:.4},y={...a,text:'另一个字',alpha:.6,bounds:{...box,left:105,right:205},rawBounds:{...box,left:105,right:205}};
    assert.ok(geometryHits({texts:[x,y],primitives:[]},{id:'x'},3).some(x=>x.rule==='文字压文字'&&x.severity==='FAIL'));
    assert.ok(geometryHits({texts:[a,a],primitives:[]},{id:'x',card:2},1.95).some(x=>x.severity==='FAIL'));
  });
  check(()=>{
    assert.equal(hasFailures([], [{severity:'WARN'},{severity:'EXPECTED'}], [{pass:true}]),false);
    assert.equal(hasFailures([], [{severity:'FAIL'}], []),true);
    assert.equal(hasFailures([{rule:'数值'}], [], []),true);
    assert.equal(hasFailures([], [], [{pass:false}]),true);
  });
  return n;
}

// Every expectation comes from SCRIPT/CHAPTERS, including missing scenes. The
// preceding template helpers remain exported for backwards-compatible self-tests.
function main() {
  console.log('显示屏帧率评估 — 自动检查报告');
  console.log(`Node ${process.version}；无浏览器 / 无依赖；坐标统一为 ${WIDTH}×${HEIGHT} 逻辑像素。`);
  console.log('FAIL 与 WARN / EXPECTED 分开；只有 FAIL 使退出码为 1。所有时间同时给出幕内 lt 与全片 t。');
  console.log('几何 FAIL 是估算字框规则命中，需结合源码复核；不宣称完成真实字体像素验收。');
  console.log('\n模板适配：保留模拟 Canvas、数值检查、字体/字幕规则和确定性比较；补全中断留下的主入口。');
  console.log('改为 SCRIPT 全量场景与 CHAPTERS 逐项核对；本期 cue 白名单；按真实钩子标记外框/字幕；');
  console.log('新增源调用栈、幕内时间、矩形 clip、rgba 透明度、seg7 图元框、已知动画分类与前 10 条修正建议。');
  const statuses = [], hard = [], ledger = new Ledger();
  const status = (name, pass, detail) => { statuses.push({ name, pass }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}：${detail}`); };
  status('检查器自检', true, `${fpsSelfTest()} 组通过（错误注入、全量时间线、clip、钩子归属、逻辑字号、已知效果分类、图元与区间聚合）`);
  const sources = FILES.map(name => {
    const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
    return { name, text, hash: sha(text), compiled: new vm.Script(text, { filename: name }) };
  });
  const htmlPath = path.join(__dirname, 'film.html'), htmlHash = sha(fs.readFileSync(htmlPath));
  console.log('\n输入 SHA-256：');
  for (const s of sources) console.log(`  ${s.name}: ${s.hash}`);
  console.log(`  film.html: ${htmlHash}（只校验版本，不执行播放器）`);
  const filmLines = sources.find(s => s.name === 'film.js').text.split('\n');
  const scriptLines = sources.find(s => s.name === 'script.js').text.split('\n');
  const sceneLine = id => {
    const i = filmLines.findIndex(s => new RegExp(`^S\\(['"]${id}['"],`).test(s));
    return i < 0 ? 'film.js（无对应注册）' : `film.js:${i+1}`;
  };
  const scriptLine = id => `script.js:${scriptLines.findIndex(s => s.trimStart().startsWith(id+':'))+1}`;
  const hardIssue = (rule, detail, sc, lt = 0, text = '<无关联文字>', source) => {
    const id = typeof sc === 'string' ? sc : sc?.id ?? '<全片>';
    hard.push({ rule, detail, id, lt, text, source: source || sceneLine(id) });
  };
  const families = new Set(), fontFindings = new Map(); let fontChecks = 0;
  const observeFont = e => {
    fontChecks++; families.add(e.family);
    if (FONT_FAMILIES.has(e.family)) return;
    const key = JSON.stringify([e.font, e.site, e.phase]);
    const old = fontFindings.get(key);
    if (old) old.count++;
    else fontFindings.set(key, { ...e, count: 1 });
  };
  const makeRuntime = () => load(sources, observeFont);
  const runtime = makeRuntime(), { film, script, chapters } = runtime;
  status('加载', true, 'engine → script → kit → film，共享 VM；输入源码未改写');
  const timeline = auditCompleteTimeline(film, script, chapters), subtitles = auditScript(script);
  for (const e of timeline.issues) hardIssue(e.rule, e.detail, e.id, e.lt, e.text, `${scriptLine(e.id)} ← ${sceneLine(e.id)}`);
  for (const e of subtitles.issues) hardIssue(`字幕/${e.rule}`, e.detail, e.id, e.start ?? 0, e.text, `${scriptLine(e.id)} ← ${sceneLine(e.id)}`);
  status('全量时间线', !timeline.issues.length, `${film.scenes.length}/${timeline.ids.length} 幕；${film.captions.length}/${timeline.expectedCaps.length} 句；${film.chapters.length}/${chapters.length} 章；总长 ${f3(film.duration)}s / SCRIPT ${f3(timeline.duration)}s`);
  console.log('  幕数/顺序/时长/字幕文本与起止/章节编号与标题均来自 script.js；缺幕也 FAIL，无固定幕数或时长。');
  console.log(`  幕序：${timeline.ids.join(' → ')}；章序：${film.chapters.map(c=>c.n).join(' → ')}`);
  for (const s of film.scenes) console.log(`  ${s.id} chapter=${s.chap} t=${f3(s.start)}s dur=${f3(s.d)}s | ${sceneLine(s.id)}`);
  status('全量字幕格式与阅读时长', !subtitles.issues.length, `${subtitles.counts.captions} 句，${subtitles.issues.length} 项违规；沿用模板：加权≤22字、≥max(1.6s,加权字数/4.5)、标记配对、不重叠、在幕内`);
  const scAt = (rt, t) => [...rt.h.scenes.values()].find(s => t >= s.start && t < s.start+s.d) || [...rt.h.scenes.values()].at(-1);
  let cueCount = 0; const cueCounts = {}, cueStart = hard.length, expectedCues = [];
  for (const sc of runtime.h.scenes.values()) {
    if (!Array.isArray(sc.cues)) { hardIssue('cue 数组', 'S() 应先执行函数型 cues，再交给引擎数组', sc); continue; }
    for (const c of sc.cues) {
      cueCount++; cueCounts[c.type] = (cueCounts[c.type] || 0)+1;
      expectedCues.push({t:rounded(sc.start+c.t),type:c.type,v:c.v});
      if (!CUE_TYPES.has(c.type) || !Number.isFinite(c.t) || c.t < 0 || c.t > sc.d || !Number.isFinite(c.v) || c.v < 0)
        hardIssue('cue 类型/数值/范围', JSON.stringify(c), sc, c.t, `cue(${c.type})`);
    }
  }
  expectedCues.sort((a,b)=>a.t-b.t);
  if (JSON.stringify(expectedCues)!==JSON.stringify(film.cues)) hardIssue('cue 导出一致性', '注册时局部数组与 FILM.cues 不一致', '<全片>');
  status('cue 白名单与数组求值', hard.length===cueStart, `${cueCount} 个；${JSON.stringify(cueCounts)}；允许 ${[...CUE_TYPES].join(' ')}`);
  if (runtime.h.captionConfig?.font?.s!==54) hardIssue('字幕字号配置','captions.font.s 应为 54','<全片>',0,'字幕字体','film.js:18');
  if (film.W!==WIDTH || film.H!==HEIGHT || !Number.isFinite(film.FPS) || film.FPS<=0) throw new Error('逻辑画布或 FPS 与检查坐标系不兼容');
  const duration = timeline.duration;
  if (!Number.isFinite(duration) || duration<=0 || duration>3600) throw new Error(`无法扫描总时长 ${duration}`);
  const schedule = step => {
    const ts = new Set([0,duration]);
    const add = t => { if (t>=0 && t<=duration) ts.add(Number(t.toFixed(9))); };
    for (let i=0;i*step<duration;i++) add(i*step);
    for (const sc of runtime.h.scenes.values()) {
      const events = [0,sc.d,...sc.cs,...sc.ce,...sc.cues.map(c=>c.t),...(sc.card!=null?[1.95]:[])];
      for (const lt of events) for (const d of [-1/film.FPS,0,1/film.FPS]) add(sc.start+lt+d);
    }
    return [...ts].sort((a,b)=>a-b);
  };
  let layoutFrames=0, textCount=0, segCount=0;
  const checksBySize=[];
  console.log('\n数值健康与几何扫描：');
  console.log('1080p 按 FILM.FPS 全帧网格；4K 按0.25s网格；另加幕/字幕/cue/转场边界及前后1帧。非有限数、栈失衡或非法透明度均 FAIL。');
  for (const [w,h,step] of [[WIDTH,HEIGHT,1/film.FPS],[WIDTH*2,HEIGHT*2,STEP]]) {
    const times=schedule(step); let rt=makeRuntime(),canvas=rt.h.canvas(w,h,true),finished=0,errors=0;
    const numeric = new Map();
    for (const [i,t] of times.entries()) {
      rt.h.phase=`扫描 ${w}×${h}`;
      const sc=scAt(rt,t),lt=t-sc.start;
      try {
        const out=rt.h.frame(rt.film,canvas,t,{text:w===WIDTH});finished++;
        for(const e of out.numericIssues) {
          errors++; const key=JSON.stringify([sc.id,e.message,e.source]);let a=numeric.get(key);
          if(!a) {a={...e,sc,lt,count:0,min:Infinity,max:-Infinity};numeric.set(key,a);}
          a.count++;a.min=Math.min(a.min,e.value);a.max=Math.max(a.max,e.value);a.lastLT=lt;
        }
        if(w===WIDTH) {
          layoutFrames++;textCount+=out.texts.length;segCount+=out.primitives.filter(x=>x.kind==='seg7').length;
          const camera=rt.context.camAt(sc.cam,lt);
          ledger.add(i,t,sc,geometryHits(out,sc,lt,camera));
        }
      } catch(e) {
        errors++;hardIssue('渲染/数值异常',`${w}×${h} t=${f3(t)}s；${e.stack}`,sc,lt);
        if(w===WIDTH) ledger.add(i,t,sc,[]);
        rt=makeRuntime();canvas=rt.h.canvas(w,h,true);
      }
    }
    for(const a of numeric.values()) hardIssue(a.message,`${w}×${h}，lt=${f3(a.lt)}–${f3(a.lastLT)}s（非连续保证），${a.count} 次，范围 ${a.min}～${a.max}；按 Canvas 忽略非法赋值继续扫描`,a.sc,a.lt,'<数值属性>',a.source);
    status(`数值健康 ${w}×${h}`,!errors,`${finished}/${times.length} 次完成，${errors} 次异常`);
    checksBySize.push({w,h,frames:times.length});
  }
  console.log(`  几何覆盖 ${layoutFrames} 帧；可见文字绘制 ${textCount} 次；七段数码管框 ${segCount} 次。`);

  console.log('\n乱序渲染确定性：');
  let seed=SEED;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const samples=Array.from({length:SAMPLE_COUNT},(_,i)=>Number(((i+random())/SAMPLE_COUNT*duration).toFixed(6)));
  console.log(`种子 0x${SEED.toString(16)}，${SAMPLE_COUNT} 个分层随机时刻；顺序基准 vs 倒序 / 固定打乱顺序 / 独立 VM 冷启动首帧。`);
  console.log('比较主画布完整指令，数字保留3位小数；离屏使用指令和 ImageData 字节内容哈希。禁用 Math.random / 时钟。');
  console.log(`采样 t：${samples.join(', ')}`);
  for(const [w,h] of [[WIDTH,HEIGHT],[WIDTH*2,HEIGHT*2]]) {
    const rt=makeRuntime(),canvas=rt.h.canvas(w,h,true),baseline=new Map();let comparisons=0,matches=0,renders=0;
    const before=hard.length,numeric=new Map();
    const draw=(r,cv,t,mode)=>{
      r.h.phase=`确定性 ${w}×${h} ${mode}`;
      try {
        const out=r.h.frame(r.film,cv,t,{trace:true});renders++;
        for(const e of out.numericIssues) {
          const sc=scAt(r,t),key=JSON.stringify([sc.id,e.message,e.source]);
          if(!numeric.has(key)) { numeric.set(key,true);hardIssue(e.message,`${mode} ${w}×${h}：${e.value}`,sc,t-sc.start,'<数值属性>',e.source); }
        }
        return out.commands;
      } catch(e) {const sc=scAt(r,t);hardIssue('确定性渲染异常',`${mode} ${w}×${h}；${e.stack}`,sc,t-sc.start);return null;}
    };
    for(const t of samples) baseline.set(t,draw(rt,canvas,t,'顺序'));
    const compare=(t,actual,mode)=>{
      comparisons++;const expected=baseline.get(t);if(!actual||!expected) return;
      let i=expected.findIndex((s,j)=>s!==actual[j]);
      if(i<0&&expected.length===actual.length) {matches++;return;}
      if(i<0)i=expected.length;
      const sc=scAt(rt,t);hardIssue('乱序渲染不确定',`${mode} ${w}×${h} 指令#${i}，长度${expected.length}/${actual.length}；期望${expected[i]??'<结束>'}；实际${actual[i]??'<结束>'}`,sc,t-sc.start);
    };
    for(const t of samples.slice().reverse()) compare(t,draw(rt,canvas,t,'倒序'),'倒序');
    const shuffled=samples.slice();
    for(let i=shuffled.length-1;i>0;i--) {const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    for(const t of shuffled) compare(t,draw(rt,canvas,t,'打乱'),'打乱');
    for(const t of samples) {const r=makeRuntime(),cv=r.h.canvas(w,h,true);compare(t,draw(r,cv,t,'冷启动'),'冷启动');}
    status(`确定性 ${w}×${h}`,hard.length===before&&matches===SAMPLE_COUNT*3,`${renders} 次渲染，${matches}/${comparisons} 次比较一致`);
  }
  for(const e of fontFindings.values()) {
    const sc=e.t==null?null:scAt(runtime,e.t);
    hardIssue('字体族',`${quote(e.font)} 首族 ${quote(e.family)}，${e.phase}，${e.count} 次`,sc,e.t==null?0:e.t-sc.start,e.text||'<字体赋值/测宽>',e.source);
  }
  status('字体首族白名单',!fontFindings.size,`${fontChecks} 次检查，实际 ${[...families].sort().join(' / ')}；非法组合 ${fontFindings.size}`);
  console.log(`  沿用模板检查首族，只允许 ${[...FONT_FAMILIES].join(' / ')}；后续系统回退族不算违规。无浏览器无法确认实际字形回退。`);
  const changed=sources.filter(s=>sha(fs.readFileSync(path.join(__dirname,s.name),'utf8'))!==s.hash).map(s=>s.name);
  if(sha(fs.readFileSync(htmlPath))!==htmlHash) changed.push('film.html');
  for(const name of changed) hardIssue('输入版本变化',`${name} 在执行期间变化，请重跑`,'<全片>',0,name,name+':1');
  status('输入版本一致性',!changed.length,`${sources.length+1-changed.length}/${sources.length+1} 份文件哈希不变`);

  const bySeverity=s=>ledger.groups.filter(g=>g.severity===s);
  const failures=bySeverity('FAIL'),warnings=bySeverity('WARN'),expected=bySeverity('EXPECTED');
  const order=(a,b)=>a.start-b.start||a.rule.localeCompare(b.rule)||a.key.localeCompare(b.key);
  const summary=(groups,label)=>{
    console.log(`\n${label}：${groups.length} 个连续区间，${groups.reduce((n,g)=>n+g.occurrences,0)} 次命中。`);
    const rules=[...new Set(groups.map(g=>g.rule))].sort();
    if(!rules.length) console.log('  无。');
    for(const rule of rules) {
      const xs=groups.filter(g=>g.rule===rule).sort((a,b)=>(b.end-b.start)-(a.end-a.start)||order(a,b));
      console.log(`  ${rule}：${xs.length} 个区间 / ${xs.reduce((n,g)=>n+g.occurrences,0)} 次；代表 ${Math.min(3,xs.length)} 例：`);
      for(const g of xs.slice(0,3)) console.log('  '+episodeLabel(g));
    }
  };
  console.log(`\nFAIL 完整清单：硬规则 ${hard.length} 条，几何 ${failures.length} 个区间（不截断）。`);
  let ordinal=0;
  for(const e of hard) console.log(`F${++ordinal}. ${e.id} | lt=${Number.isFinite(e.lt)?f3(e.lt):e.lt}s | ${e.rule}\n    ${quote(e.text)} | ${e.source}\n    ${e.detail}`);
  for(const g of failures.sort(order)) console.log(`F${++ordinal}. ${episodeLabel(g)}`);
  if(!ordinal) console.log('  无。');
  console.log('\n文字重点规则命中（排除 EXPECTED 后）：');
  for(const rule of ['文字压文字','文字进入字幕区','越过顶部外框区','字幕字号','正文字号不足','七段数码管包围框相交']) {
    const xs=[...failures,...warnings].filter(g=>g.rule===rule);
    console.log(`  ${rule}：${xs.length} 个区间 / ${xs.reduce((n,g)=>n+g.occurrences,0)} 次。`);
  }
  summary(warnings,'WARN 分类汇总（不影响退出码）');
  summary(expected,'EXPECTED 已知动画效果（不计 FAIL / WARN）');
  console.log(`  镜头推拉出画：${expected.filter(g=>g.rule==='镜头推拉出画').length} 区间；0 条时没有可列代表例。`);
  console.log('\n按明确规则确认的前 10 条问题（按源码位置去重，持续性优先；全部附 film.js 调用行）：');
  console.log('判断：字号下限是实际计算值，不依赖估算字宽，低于24px属确定的规则违规；短时弹出过程的小字保留WARN，不等同于静态排版错误。');
  // Avoid filling the top ten with different times of the same code-level defect.
  const priority=g=>({文字压文字:100,文字进入字幕区:90,越过顶部外框区:85,正文字号不足:70,字幕字号:110}[g.rule]||0)+(g.end-g.start);
  const candidates=[...failures,...warnings].filter(g=>['文字压文字','文字进入字幕区','越过顶部外框区','正文字号不足','字幕字号'].includes(g.rule));
  candidates.sort((a,b)=>priority(b)-priority(a)||order(a,b));
  const seen=new Set(),top=[];
  for(const g of candidates) {
    const key=JSON.stringify([g.id,g.rule,g.items.map(x=>x.site).sort()]);
    if(seen.has(key)) continue;seen.add(key);top.push(g);if(top.length===10)break;
  }
  top.forEach((g,i)=>console.log(`${i+1}. [${g.severity}] ${episodeLabel(g)}\n    判断：${g.rule==='正文字号不足'?(g.end-g.start>=.5?'持续低于24px，优先修正。':'仅短时低于24px；结合源码中的缩放入场评估是否调整。'):'按规则命中；文字框仍需考虑真实字形度量。'}`));
  if(top.length<10)console.log(`  当前只有 ${top.length} 个独立候选，不虚构补足 10 条。`);
  console.log('\nWARN 完整明细（便于按幕定位）：');
  warnings.sort(order).forEach((g,i)=>console.log(`W${i+1}. ${episodeLabel(g)}`));
  if(!warnings.length)console.log('  无。');
  console.log('\n检查口径与限制：');
  console.log('1. 文字宽度 ASCII=0.6em，非ASCII=1em，另加 letterSpacing；高度1.2em。真实字体度量、字距、抗锯齿/阴影不模拟。旋转取AABB，可能高估相交。');
  console.log('2. 字号=当前仿射变换最小奇异值×px字号，扣除输出分辨率倍率，包含 maxWidth 压缩。字幕应54px；正文<24px记WARN；drawChrome不套正文门槛。缩放入场会出现短时小字，需结合持续时间。');
  console.log('3. 透明度=globalAlpha×rgba颜色alpha，低于0.15忽略几何；字体/数值检查不忽略。矩形clip精确到AABB，圆角/Path2D只保守包围，不处理后绘不透明物体遮挡。');
  console.log('4. fillText框相交≥较小框15%为文字压文字FAIL；strokeText参与分区与字号，不与同一次描边填充重复比较。文字/数码管框相交记WARN，不把多边形冒充font。');
  console.log('5. y<110仅实际drawChrome钩子允许；y>890仅实际drawCaptionBackground/drawCaption钩子允许。分区只检查文字的屏幕内正面积。四角取景器括线、背景/面板不是文字，未纳入文字分区。');
  console.log('6. card存在且lt<1.95的几何命中单列章节转场色带；相邻调用、同位置、互补alpha的文字对单列交叉淡化；撤销镜头后框完全在画内的出画单列镜头推拉。');
  console.log('7. 仅追踪flyIcon内icon包围框经过字框（s05/s06），以及touch圆圈经过开发板屏幕（s01）；已知动作单列EXPECTED。并非通用文字/任意图元遮挡检测器。');
  console.log('8. seg7已登记数字单元外接框，包含-0.08斜切；不检查其字体或字号；不模拟段间空洞/辉光。出画文字仅在仍有部分屏内可见时记录。');
  console.log('9. 连续区间按幕、规则、源码完整调用栈和同一调用的序号聚合，动态数字不会拆成数百条；代表点取相交/违规程度最大者。次数是命中次数，区间跨度不是精确持续时长。');
  console.log('10. 主画布覆盖输出帧时间点及事件邻帧；不证明任意实数时刻。确定性为两尺寸各120时刻抽检，不是像素一致性证明；没有交替尺寸、插入封面或音频试听检查。');
  console.log('11. 源文件加载超时10s；当前渲染没有独立超时隔离。未知Canvas API直接报错，不静默跳过；只输出报告，由作者修改画面。');
  const failed=hasFailures(hard,ledger.groups,statuses);
  console.log(`\n最终结果：[${failed?'FAIL':'PASS'}]；硬规则 ${hard.length} 条；几何 FAIL ${failures.length} 区间；WARN ${warnings.length} 区间；EXPECTED ${expected.length} 区间；退出码 ${failed?1:0}。`);
  process.exitCode=failed?1:0;
  return {hard,failures,warnings,expected,top,statuses,checksBySize};
}
if(require.main===module) {
  try {main();}
  catch(error) {console.log(`\n[FAIL] 检查器/加载中止：${error.stack}\n退出码 1；报告覆盖不完整。`);process.exitCode=1;}
}
module.exports={Harness,load,AuditPath,overlapHits,Intervals,selfTest,auditTimeline,auditCompleteTimeline,auditScript,
  firstFontFamily,logicalFontSize,markerError,weightedLength,zoneHits,smallTextHits,geometryHits,Ledger,fpsSelfTest,main};

