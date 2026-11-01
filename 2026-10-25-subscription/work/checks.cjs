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
const SEED = 0x53554253, SAMPLE_COUNT = 120; // SUBS; deterministic audit sampling only.
const EPS = 1e-9;
const CUE_TYPES = new Set('draw tick blip latch snap whoosh type success error confirm stamp snip'.split(' '));
const TITLE_IDS = new Set(['s03', 's22']);
const FONT_FAMILIES = new Set(['FCJK', 'FDisp', 'FSup', 'FMono', 'FMonoCJK']);
const FILES = ['../../tools/film-kit/engine.js', 'script.js', 'kit.js', 'film.js'];
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = () => [1, 0, 0, 1, 0, 0];
const quote = s => JSON.stringify(s);
const f3 = n => n.toFixed(3);
const rounded = n => Number(n.toFixed(3)); // FilmKit.finish() exports milliseconds.
const sameNumber = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= EPS;
const SCREEN = { left: 0, right: WIDTH, top: 0, bottom: HEIGHT };
const HEADER = { ...SCREEN, bottom: 110 }, SUBTITLE = { ...SCREEN, top: 890 };
const boundsOf = points => ({ left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])),
  top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) });
const colorAlpha = color => typeof color === 'string' ? color === 'transparent' ? 0 : Number(color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/)?.[1] ?? 1) : 1;
const roleOf = h => h.role || 'scene';

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
    this.lines = []; this.plates = []; this.paints = []; this.pathParts = []; this.pathComplex = false; this.order = 0; this.clipped = false;
  }
  record(name, args = []) {
    finite(args, name);
    this.order++;
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
    this.pathParts = []; this.pathComplex = false; this.pathRect = null; this.pen = null; this.clipped = false;
    this.hash = createHash('sha256'); this.cachedDigest = null; this.record('reset');
  }
  save() { this.record('save'); this.stack.push({ state: { ...this.state }, m: this.m.slice(), dash: this.dash.slice(), clipped: this.clipped }); }
  restore() {
    if (!this.stack.length) throw new Error('restore 下溢（没有对应 save）');
    this.record('restore'); const saved = this.stack.pop(); this.state = saved.state; this.m = saved.m; this.dash = saved.dash; this.clipped = saved.clipped;
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
    numbers(args, args.length, 'drawImage'); this.record('drawImage', [source, ...args]); this.paint('drawImage');
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
  point(x, y) {
    const [a, b, c, d, e, f] = this.m;
    return [(a*x+c*y+e)*WIDTH/this.canvas.width, (b*x+d*y+f)*HEIGHT/this.canvas.height];
  }
  paint(method) {
    if (this.canvas.main && this.harness.collectText) this.paints.push({ method, role: roleOf(this.harness),
      alpha: this.globalAlpha, color: String(method.startsWith('stroke') ? this.strokeStyle : this.fillStyle) });
  }
  geometry(name, args) {
    if (!this.canvas.main || !this.harness.collectText) return;
    if (['fill', 'stroke', 'fillRect', 'strokeRect'].includes(name)) this.paint(name);
    if (name === 'beginPath') { this.pathParts = []; this.pathComplex = false; this.pathRect = null; this.pen = null; }
    else if (name === 'clip') this.clipped = true;
    else if (name === 'moveTo') this.pen = this.point(...args);
    else if (name === 'lineTo') {
      const next = this.point(...args);
      if (this.pen) this.pathParts.push([this.pen, next]);
      this.pen = next;
    } else if (name === 'arc' && !this.pathComplex && !this.pen && Math.abs(args[4]-args[3]) >= Math.PI*2-EPS && Math.abs(this.m[1]) < EPS && Math.abs(this.m[2]) < EPS) {
      const [x, y, radius] = args, r = radius/Math.SQRT2;
      this.pathRect = boundsOf([this.point(x-r, y-r), this.point(x+r, y+r)]); this.pathComplex = true;
    } else if (['arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'closePath'].includes(name)) { this.pathComplex = true; this.pathRect = null; }
    else if (['rect', 'roundRect', 'fillRect'].includes(name)) {
      const [x, y, w, h] = args;
      // Only the safe rectangular INTERIOR of axis-aligned plates can occlude lines.
      if (name === 'roundRect' && args[4] != null && typeof args[4] !== 'number') { this.pathRect = null; this.pathComplex = true; return; }
      const r = name === 'roundRect' ? Math.min(args[4] || 0, w/2, h/2) : 0;
      // Rectangle with its corners on the rounded-corner 45° points; remains
      // non-degenerate for a capsule (r=h/2), unlike insetting both axes by r.
      const inset = r*(1-1/Math.SQRT2);
      const b = boundsOf([this.point(x+inset, y+inset), this.point(x+w-inset, y+h-inset)]);
      const rect = Math.abs(this.m[1]) < EPS && Math.abs(this.m[2]) < EPS && w >= 2*r && h >= 2*r ? b : null;
      if (name === 'fillRect') this.addPlate(rect);
      else { this.pathComplex = true; this.pathRect = rect; }
    } else if (name === 'fill' && !(args[0] instanceof AuditPath)) this.addPlate(this.pathRect);
    else if (name === 'stroke' && !this.pathComplex && !(args[0] instanceof AuditPath)) {
      const alpha = this.globalAlpha * colorAlpha(this.strokeStyle);
      if (alpha < ALPHA) return;
      const width = logicalFontSize(this.lineWidth, this.m, this.canvas);
      for (const [a, b] of this.pathParts) if (Math.hypot(b[0]-a[0], b[1]-a[1]) > EPS) {
        this.lines.push({ a, b, width, alpha, color: String(this.strokeStyle), role: roleOf(this.harness),
          order: this.order, path: this.order, bounds: boundsOf([a, b]) });
      }
    }
  }
  addPlate(bounds) {
    if (bounds && !this.clipped && typeof this.fillStyle === 'string' && this.globalAlpha * colorAlpha(this.fillStyle) >= .999 && this.globalCompositeOperation === 'source-over') {
      this.plates.push({ bounds, order: this.order });
    }
  }
  drawText(method, s, x, y, maxWidth) {
    numbers([x, y], 2, method); if (maxWidth !== undefined) numbers([maxWidth], 1, `${method}.maxWidth`);
    this.harness.auditFont(this.font, this, method, String(s));
    this.record(method, maxWidth === undefined ? [s, x, y] : [s, x, y, maxWidth]);
    this.paint(method);
    const alpha = this.globalAlpha * colorAlpha(method === 'fillText' ? this.fillStyle : this.strokeStyle);
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
    const bounds = { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) };
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    const camera = this.harness.camera;
    const world = camera ? boundsOf(points.map(([px, py]) => [(px-WIDTH/2)/camera[2]+camera[0], (py-HEIGHT/2)/camera[2]+camera[1]])) : bounds;
    this.texts.push({ text: String(s), bounds, world, method, caption: this.harness.captionDepth > 0,
      chrome: this.harness.chromeDepth > 0, alpha, role: roleOf(this.harness), order: this.order, baseSize: size,
      title: !!this.harness.currentScene?.title, color: String(method === 'fillText' ? this.fillStyle : this.strokeStyle),
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
  AuditContext.prototype[name] = function (...args) { validatePath(name, args, count); this.record(name, args); this.geometry(name, args); };
}

class Harness {
  constructor(fontAudit, recoverAlpha = false) {
    this.contexts = []; this.captionDepth = 0; this.chromeDepth = 0; this.collectText = false;
    this.fontAudit = fontAudit; this.time = null; this.phase = '加载';
    this.recoverAlpha = recoverAlpha; this.numericIssues = [];
    this.registrations = []; this.options = null; this.role = null; this.currentScene = null; this.camera = null;
  }
  auditFont(font, ctx, method, text) {
    this.fontAudit?.({ font: String(font), family: firstFontFamily(font), method, text,
      t: this.time, phase: this.phase, canvas: `${ctx.canvas.width}×${ctx.canvas.height}`, main: ctx.canvas.main });
  }
  canvas(w, h, main = false) { return new AuditCanvas(this, w, h, main); }
  balanced() {
    for (const c of this.contexts) if (c.stack.length) throw new Error(`${c.canvas.main ? '主' : '离屏'}画布 save/restore 泄漏 ${c.stack.length}`);
  }
  frame(film, canvas, t, { trace = false, text = false, cover = false } = {}) {
    this.balanced(); this.collectText = text; this.time = t;
    const c = canvas.context; c.capture = trace; c.trace = []; c.texts = []; c.lines = []; c.plates = []; c.paints = []; c.order = 0;
    this.role = null; this.currentScene = null; this.camera = null;
    if (cover) film.drawCover(canvas); else film.render(canvas, t);
    this.balanced();
    return { commands: c.trace, texts: c.texts, lines: c.lines, plates: c.plates, paints: c.paints,
      scene: this.currentScene, camera: this.camera, numericIssues: this.numericIssues.splice(0) };
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
    h.options = options;
    for (const hook of ['beforeScene', 'drawBackground', 'drawTransition', 'drawChrome', 'drawCaptionBackground', 'drawCaption', 'drawCover']) {
      if (!opts[hook]) continue;
      const depth = { drawCaption: 'captionDepth', drawChrome: 'chromeDepth' }[hook];
      const draw = opts[hook];
      opts[hook] = function (...args) {
        const previous = h.role; h.role = hook;
        if (depth) h[depth]++;
        if (hook === 'beforeScene') h.currentScene = args[1].sc;
        try {
          const result = draw.apply(this, args);
          if (hook === 'beforeScene' && typeof context.camAt === 'function') h.camera = Array.from(context.camAt(args[1].sc.cam, args[1].lt));
          return result;
        } finally { if (depth) h[depth]--; h.role = previous; }
      };
    }
    const builder = create.call(this, opts);
    if (builder.addScene) {
      const add = builder.addScene;
      builder.addScene = function (...args) { const scene = add.apply(this, args); h.registrations.push(scene); return scene; };
    }
    return builder;
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
    hits.push({ key: JSON.stringify(pair), texts: [a.text, b.text], ratio, bounds: a.bounds, otherBounds: b.bounds, items: [a, b] });
  }
  return hits;
}
// Liang–Barsky: segment centerline intersection with an axis-aligned text interior.
function clipLine(a, b, box) {
  const dx = b[0]-a[0], dy = b[1]-a[1]; let lo = 0, hi = 1;
  const p = [-dx, dx, -dy, dy], q = [a[0]-box.left, box.right-a[0], a[1]-box.top, box.bottom-a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < EPS) { if (q[i] < 0) return null; continue; }
    const r = q[i]/p[i]; if (p[i] < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
    if (lo >= hi) return null;
  }
  return [[a[0]+dx*lo, a[1]+dy*lo], [a[0]+dx*hi, a[1]+dy*hi]];
}
function lineHits(texts, lines, plates) {
  const hits = [];
  for (const text of texts) {
    if (intersection(text.bounds, SCREEN) <= 0) continue;
    // Keep a 10% inset to avoid calling an underline or a nearby border a collision.
    const b = text.bounds, dx = (b.right-b.left)*.1, dy = (b.bottom-b.top)*.1;
    const core = { left: Math.max(0, b.left+dx), right: Math.min(WIDTH, b.right-dx), top: Math.max(0, b.top+dy), bottom: Math.min(HEIGHT, b.bottom-dy) };
    if (area(core) <= 0 || core.left >= core.right || core.top >= core.bottom) continue;
    const paths = new Map();
    for (const line of lines) {
      // Background texture is decorative; only scene/transition/chrome/caption lines matter.
      if (line.role === 'drawBackground' || line.role === 'drawCover') continue;
      const clipped = clipLine(line.a, line.b, core); if (!clipped) continue;
      const length = Math.hypot(clipped[1][0]-clipped[0][0], clipped[1][1]-clipped[0][1]);
      if (length < Math.max(4, Math.min(core.right-core.left, core.bottom-core.top)*.25)) continue;
      const hitBox = boundsOf(clipped);
      // A later opaque rectangular plate hiding the entire intersection is sufficient evidence.
      if (plates.some(p => p.order > line.order && p.order < text.order &&
        p.bounds.left <= hitBox.left-line.width/2 && p.bounds.right >= hitBox.right+line.width/2 &&
        p.bounds.top <= hitBox.top-line.width/2 && p.bounds.bottom >= hitBox.bottom+line.width/2)) continue;
      const ratio = Math.min(1, length/Math.max(1, Math.min(core.right-core.left, core.bottom-core.top)));
      const hit = { key: JSON.stringify([text.text, line.color, line.role]), texts: [text.text, `线条 ${line.color} / ${f3(line.width)}px`],
        bounds: text.bounds, otherBounds: line.bounds, segment: [line.a, line.b], ratio, items: [text, line] };
      if (!paths.has(line.path) || paths.get(line.path).ratio < ratio) paths.set(line.path, hit);
    }
    hits.push(...paths.values());
  }
  return hits;
}
function classify(hit, category, sc, lt) {
  const items = hit.items || [], sceneItems = items.filter(x => x.role === 'scene');
  let reason = '';
  if (sc?.card != null && lt < 1.95 && items.some(x => x.role === 'drawTransition')) reason = '章节转场色带/标题叠绘；裁切与遮挡未像素化';
  else if (category === '文字重叠' && hit.crossfade) reason = '前后各0.35s实绘探针确认一项淡出、另一项淡入；交叉淡化';
  else if (category === '文字/线条重叠' && hit.crossfade) reason = '文字探针确认淡出，当前线路与文字alpha互补；推断为线路切换交叉淡化';
  else if (category === '文字出画' && sc?.id === 's21' && sceneItems.length) reason = 's21 横向跟拍；远处站点保留在世界坐标中';
  else if (['文字出画', '字幕区', '页眉区'].includes(category) && sc?.cam?.some(k => k.slice(1).some((v, i) => v !== sc.cam[0][i+1]))) {
    const zone = category === '字幕区' ? SUBTITLE : HEADER;
    if (sceneItems.length && sceneItems.every(x => x.world && (category === '文字出画'
      ? x.world.left >= 0 && x.world.right <= WIDTH && x.world.top >= 0 && x.world.bottom <= HEIGHT
      : intersection(x.world, zone) <= EPS))) reason = '镜头推拉/平移导致入区或出画；去掉 cam 后不触犯该边界';
  }
  return { ...hit, verdict: reason ? '预期误报' : '疑似真问题', reason: reason || '未命中已知合理误报；需按坐标复核估算字框与实际可见性' };
}
class Intervals {
  constructor() { this.groups = []; this.active = new Map(); this.hits = 0; this.frames = 0; }
  add(index, t, hits, scene) {
    this.hits += hits.length; if (hits.length) this.frames++;
    const unique = new Map();
    for (const hit of hits) {
      const identity = JSON.stringify([hit.key, hit.verdict, hit.reason]), old = unique.get(identity);
      if (!old || (hit.ratio ?? 0) > (old.ratio ?? 0)) unique.set(identity, { ...hit,
        minSize: Math.min(hit.size ?? Infinity, old?.minSize ?? Infinity),
        maxSize: Math.max(hit.size ?? -Infinity, old?.maxSize ?? -Infinity) });
      else if (hit.size != null) { old.minSize = Math.min(old.minSize, hit.size); old.maxSize = Math.max(old.maxSize, hit.size); }
    }
    const next = new Map();
    for (const [key, hit] of unique) {
      const groupKey = JSON.stringify([scene, key, hit.verdict, hit.reason]);
      let group = this.active.get(groupKey);
      if (!group || group.lastIndex !== index-1) {
        group = { ...hit, start: t, end: t, count: 0, minRatio: hit.ratio, maxRatio: hit.ratio, scenes: new Set(), sampleTime: t };
        this.groups.push(group);
      }
      group.end = t; group.lastIndex = index; group.count++; group.scenes.add(scene);
      if (hit.size != null) {
        group.minSize = Math.min(group.minSize, hit.minSize); group.maxSize = Math.max(group.maxSize, hit.maxSize);
      }
      if (hit.ratio != null) {
        if (hit.ratio > group.maxRatio) { group.sampleTime = t; group.bounds = hit.bounds; group.otherBounds = hit.otherBounds; group.segment = hit.segment; }
        group.minRatio = Math.min(group.minRatio, hit.ratio); group.maxRatio = Math.max(group.maxRatio, hit.ratio);
      }
      next.set(groupKey, group);
    }
    this.active = next;
  }
  sorted() { return this.groups.slice().sort((a, b) => (b.end-b.start)-(a.end-a.start) || a.start-b.start || (a.key < b.key ? -1 : 1)); }
}
const boxLabel = b => `[${f3(b.left)}, ${f3(b.top)}]–[${f3(b.right)}, ${f3(b.bottom)}]`;

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
  const expectedChapters = [];
  let start = 0;
  for (const sc of film.scenes) {
    const source = script[sc.id]; if (!source) continue;
    if (expectedChapters.at(-1)?.n !== source.chapter) expectedChapters.push({ n: source.chapter, t: start });
    start += source.dur;
  }
  for (let i = 0; i < Math.max(expectedChapters.length, film.chapters.length); i++) {
    const e = expectedChapters[i], a = film.chapters[i];
    if (!e || !a || a.n !== e.n || !sameNumber(a.t, e.t)) chapterIssues.push(`章节 #${i+1}：期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}`);
  }
  if (film.chapterInfo) {
    for (let i = 0; i < Math.max(expectedChapters.length, film.chapterInfo.length); i++) {
      const e = expectedChapters[i], a = film.chapterInfo[i], info = e && chapters[e.n];
      if (!e || !a || a.n !== e.n || !sameNumber(a.t, e.t) ||
        ['zh', 'en', 'desc'].some((key, j) => a[key] !== info?.[j])) chapterIssues.push(`chapterInfo #${i+1}：标题/英文/说明/时间与 CHAPTERS 或 SCRIPT 不一致`);
    }
  }
  return { ids, registered, missing: ids.filter(id => !registered.has(id)), expectedDuration, expectedCaps,
    sceneIssues, captionIssues, chapterIssues };
}
function auditEpisode({ h, script, chapters }) {
  const issues = [], cards = [];
  if (chapters.length !== 10 || chapters.some(c => c.length !== 3 || c.some(s => typeof s !== 'string' || !s))) issues.push('CHAPTERS 应为 10 项，每项含标题、英文、说明');
  const used = [...new Set(Object.values(script).map(s => s.chapter))];
  if (used.join(',') !== '0,1,2,3,4,5,6,7,8,9') issues.push(`SCRIPT 章节应为 0–9，实际 ${used}`);
  if (h.options?.captions?.font?.s !== 54) issues.push('字幕配置字号应为 54px');
  let previous = -1;
  for (const sc of h.registrations) {
    if (!!sc.title !== TITLE_IDS.has(sc.id)) issues.push(`${sc.id} title=${sc.title}；本期仅 s03/s22 为标题幕`);
    const card = sc.chap !== previous && sc.chap >= 2 && sc.chap <= 8 ? sc.chap : undefined;
    if (sc.card !== card) issues.push(`${sc.id} sc.card=${sc.card}，期望 ${card}`);
    if (card != null) {
      cards.push(sc);
      if (!sc.cs.length || sc.cs[0] < 2-EPS) issues.push(`${sc.id} 章节卡预留前 2s，首句实际 ${sc.cs[0]}s`);
    }
    previous = sc.chap;
  }
  return { issues, cards };
}
function presentationIssues(out, t, options) {
  const sc = out.scene, lt = t-sc.start, issues = [];
  const captions = out.texts.filter(x => x.caption);
  if (sc.title) {
    if (out.paints.some(x => ['drawChrome', 'drawCaptionBackground', 'drawCaption'].includes(x.role) && x.alpha > EPS)) issues.push('标题幕实际绘制了外框/字幕底板/字幕');
    return issues;
  }
  const ci = sc.cs.findIndex((start, i) => lt >= start+.3 && lt <= sc.ce[i]-.15);
  if (ci >= 0) {
    const expected = sc.captions[ci].text.replace(/[{}\[\]^\n]/g, '');
    if (captions.map(x => x.text).join('') !== expected) issues.push(`字幕绘制文本不一致：期望 ${quote(expected)}，实际 ${quote(captions.map(x => x.text).join(''))}`);
    if (!out.paints.some(x => x.role === 'drawCaptionBackground' && x.method === 'fill' && x.alpha > ALPHA &&
      /^(?:#1b2a4a|rgba\(27,\s*42,\s*74,\s*0?\.96\))$/i.test(x.color))) issues.push('缺少深蓝站牌字幕底板（#1B2A4A / rgba(...,.96)）');
  }
  const colors = new Set(['#fff', '#ffffff', ...Object.values(options.captions.colors).map(x => x.toLowerCase())]);
  for (const x of captions) {
    if (!sameNumber(x.size, 54)) issues.push(`字幕 ${quote(x.text)} 实际逻辑字号 ${f3(x.size)}，应为 54px`);
    if (!colors.has(x.color.toLowerCase())) issues.push(`字幕 ${quote(x.text)} 颜色 ${x.color}，应为白字或配置的富文本强调色`);
  }
  return [...new Set(issues)];
}
function outsideHits(texts) {
  return texts.filter(x => x.bounds.left < 0 || x.bounds.top < 0 || x.bounds.right > WIDTH || x.bounds.bottom > HEIGHT).map(x => ({
    key: JSON.stringify([x.text, x.role]), texts: [x.text], bounds: x.bounds, caption: x.caption, items: [x],
    ratio: 1-intersection(x.bounds, SCREEN)/area(x.bounds),
  }));
}
function zoneHits(texts, zone, exempt) {
  return texts.filter(x => !x[exempt] && intersection(x.bounds, zone) > 0).map(x => ({
    key: JSON.stringify([x.text, x.role]), texts: [x.text], bounds: x.bounds, items: [x], ratio: intersection(x.bounds, zone)/area(x.bounds),
  }));
}
function smallTextHits(texts) {
  return texts.filter(x => !x.caption && !x.chrome && !x.title && !['drawTransition', 'drawCover'].includes(x.role) && x.size < 24-EPS).map(x => ({
    key: JSON.stringify([x.text]), texts: [x.text], bounds: x.bounds, items: [x], size: x.size, ratio: 24-x.size,
  }));
}
function logicalSnapshot(out) {
  // Compare logical foreground text and straight paths; device-pixel grain and
  // resolution-specific offscreen caches intentionally have different hashes.
  return [
    ...out.texts.map(({ text, bounds, size, alpha, role, method, color }) => ({ text, bounds, size, alpha, role, method, color })),
    ...out.lines.filter(x => x.role !== 'drawBackground').map(({ a, b, width, alpha, role, color }) => ({ a, b, width, alpha, role, color })),
  ].map(x => JSON.stringify(canonical(x)));
}
function crossfadeTrend(hit, before, after) {
  if (hit.items.length !== 2 || hit.items[0].text === hit.items[1].text) return false;
  const alpha = (texts, target) => Math.max(0, ...texts.filter(x => x.text === target.text && x.role === target.role).map(x => x.alpha));
  const changes = hit.items.map(x => alpha(after, x)-alpha(before, x));
  return changes[0] * changes[1] < 0 && changes.every(x => Math.abs(x) > .1);
}
function lineCrossfadeTrend(hit, before, after) {
  const [text, line] = hit.items;
  if (text.role !== 'scene' || line.role !== 'scene' || text.alpha >= .999 || line.alpha >= .999 || Math.abs(text.alpha+line.alpha-1) > .02) return false;
  const alpha = texts => Math.max(0, ...texts.filter(x => x.text === text.text && x.role === text.role).map(x => x.alpha));
  return alpha(before)-alpha(after) > .2;
}
function commandDifference(expected, actual) {
  const first = expected.findIndex((line, i) => line !== actual[i]);
  if (first < 0 && expected.length === actual.length) return null;
  const at = first < 0 ? expected.length : first;
  return `项目 #${at}，总数 ${expected.length}/${actual.length}\n    基准：${expected[at] ?? '<结束>'}\n    实际：${actual[at] ?? '<结束>'}`;
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
    for (const cue of ['draw', 'blip', 'snip', 'snap', 'confirm']) assert.ok(CUE_TYPES.has(cue));
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
  check(() => {
    const h = new Harness(), g = h.canvas(WIDTH, HEIGHT, true).context; h.collectText = true;
    const drawLine = () => { g.beginPath(); g.moveTo(0, 100); g.lineTo(200, 100); g.stroke(); };
    g.font = '24px FCJK'; g.textBaseline = 'middle'; drawLine(); g.fillText('文字', 80, 100);
    assert.equal(lineHits(g.texts, g.lines, g.plates).length, 1);
    g.texts = []; g.fillStyle = '#fff'; g.fillRect(50, 70, 120, 60); g.fillText('文字', 80, 100);
    assert.equal(lineHits(g.texts, g.lines, g.plates).length, 0);
    drawLine(); assert.equal(lineHits(g.texts, g.lines, g.plates).length, 1); // A line drawn after text remains visible.
    g.lines = []; g.texts = []; drawLine(); g.save(); g.beginPath(); g.arc(100, 100, 50, 0, Math.PI*2); g.fill(); g.restore(); g.fillText('字', 90, 100);
    assert.equal(lineHits(g.texts, g.lines, g.plates).length, 0);
    const n = g.plates.length; g.save(); g.clip(); g.fillRect(0, 0, 200, 200); g.restore(); assert.equal(g.plates.length, n);
    assert.equal(clipLine([0, 0], [0, 10], { left: 1, right: 2, top: 1, bottom: 9 }), null);
  });
  check(() => {
    const item = { role: 'scene', alpha: 1, world: { left: 100, right: 150, top: 100, bottom: 140 } };
    const sc = { id: 's14', cam: [[0, 960, 540, 1], [2, 1200, 540, 2]] };
    assert.equal(classify({ items: [item] }, '文字出画', sc, 2).verdict, '预期误报');
    assert.equal(classify({ items: [item] }, '正文小字号', sc, 2).verdict, '疑似真问题');
    assert.equal(classify({ items: [{ ...item, role: 'drawTransition' }] }, '文字重叠', { card: 2 }, .8).verdict, '预期误报');
    assert.equal(classify({ crossfade: true, items: [{ ...item, alpha: .5 }, { ...item, alpha: .5 }] }, '文字重叠', sc, 2).verdict, '预期误报');
    assert.equal(classify({ items: [{ ...item, alpha: .3 }, { ...item, alpha: .3 }] }, '文字重叠', sc, 2).verdict, '疑似真问题');
    const pair = [{ ...item, text: '旧' }, { ...item, text: '新' }];
    assert.ok(crossfadeTrend({ items: pair }, [pair[0]], [pair[1]]));
    assert.equal(crossfadeTrend({ items: pair }, pair, pair), false);
    const linePair = { items: [{ ...pair[0], alpha: .3 }, { role: 'scene', alpha: .7 }] };
    assert.ok(lineCrossfadeTrend(linePair, [pair[0]], []));
    assert.equal(lineCrossfadeTrend(linePair, pair, pair), false);
    const a = new Intervals(), hit = { key: 'x', verdict: '预期误报' };
    a.add(0, 0, [hit], 's1'); a.add(1, .25, [hit], 's2'); a.add(2, .5, [{ ...hit, verdict: '疑似真问题' }], 's2');
    assert.equal(a.groups.length, 3);
  });
  check(() => {
    const script = { a: { dur: 3, chapter: 0, caps: [] } }, chapters = [['标题', 'EN', '说明']];
    const film = { scenes: [{ id: 'a', d: 3, chap: 0, start: 0 }], captions: [], chapters: [{ n: 0, t: 0 }], chapterInfo: [{ n: 0, t: 0, zh: '标题', en: 'EN', desc: '说明' }] };
    assert.equal(auditTimeline(film, script, chapters).chapterIssues.length, 0);
    film.chapterInfo[0].en = '错误'; assert.ok(auditTimeline(film, script, chapters).chapterIssues.length);
    delete film.chapterInfo; film.chapters[0].t = 1; assert.ok(auditTimeline(film, script, chapters).chapterIssues.length);
    film.chapters = []; assert.ok(auditTimeline(film, script, chapters).chapterIssues.length);
  });
  check(() => {
    const sc = { title: true, start: 0, cs: [], ce: [] }, out = { scene: sc, texts: [], paints: [] };
    assert.equal(presentationIssues(out, 1, {}).length, 0);
    out.paints.push({ role: 'drawChrome', alpha: 1 }); assert.ok(presentationIssues(out, 1, {}).length);
    out.paints = [{ role: 'drawCaptionBackground', alpha: 1 }]; assert.ok(presentationIssues(out, 1, {}).length);
    const snapshots = [1, 2].map(scale => {
      const h = new Harness(), g = h.canvas(WIDTH*scale, HEIGHT*scale, true).context; h.collectText = true;
      g.scale(scale, scale); g.translate(10, 20); g.scale(.75, .75); g.font = '24px FCJK'; g.fillText('镜头缩小', 100, 100);
      assert.equal(g.texts[0].size, 18); return logicalSnapshot({ texts: g.texts, lines: [] });
    });
    assert.equal(commandDifference(...snapshots), null);
    assert.ok(commandDifference(snapshots[0], []));
  });
  check(() => {
    const h = new Harness(), g = h.canvas(WIDTH, HEIGHT, true).context; h.collectText = true;
    g.beginPath(); g.moveTo(0, 100); g.lineTo(200, 100); g.lineWidth = 14; g.stroke();
    g.beginPath(); g.roundRect(40, 77, 120, 46, 23); g.fillStyle = '#fff'; g.fill();
    g.font = '24px FCJK'; g.textBaseline = 'middle'; g.fillText('实例', 70, 100);
    assert.equal(lineHits(g.texts, g.lines, g.plates).length, 0);
    const n = g.plates.length; g.beginPath(); g.roundRect(40, 77, 120, 46, [1, 2, 3, 4]); g.fill();
    assert.equal(g.plates.length, n); // Unknown per-corner geometry cannot prove occlusion.
  });
  return count;
}

function main() {
  const statuses = [], warnings = [];
  const status = (name, pass, detail) => { statuses.push({ name, pass }); console.log(`[${pass ? '通过' : '失败'}] ${name}：${detail}`); };
  const warn = (name, hits, detail) => { if (hits) warnings.push({ name, hits }); console.log(`[${hits ? '告警' : '通过'}] ${name}：${detail}`); };
  console.log('设备订阅模块重构 — 自动检查完整报告');
  console.log(`Node ${process.version}；逻辑画布 ${WIDTH}×${HEIGHT}；网格 ${STEP} s，补充幕边界、字幕稳定时刻、章节卡关键时刻`);
  console.log('纯 Node/vm，只读四份画面源码；FAIL 退出码 1，几何估算均为告警，分为预期误报/疑似真问题。\n');
  console.log('相对 curtain 的适配：cue 增加 snap/confirm；10 章及章节卡前2s；s03/s22 标题幕；站牌字幕54px；外框钩子归属；cam 后正文24px；文字/线条告警；已知误报分类；跨尺寸与乱序确定性；按幕号列出重点30条。');
  status('检查器自检', true, `${selfTest()} 组：数值/栈、变换/字号、字幕/时间线错误注入、字体/cue、钩子、几何与分类回归`);
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
  const fullDuration = Object.values(script).reduce((sum, s) => sum+s.dur, 0), delta = Math.abs(film.duration-fullDuration);
  status('时长', Number.isFinite(delta) && delta <= .05+EPS, `${f3(film.duration)} s；全部 SCRIPT.dur 之和 ${f3(fullDuration)} s；误差 ${f3(delta)} s，容许 ≤0.05 s`);
  status('场景', !timeline.sceneIssues.length && !timeline.missing.length, `已注册 ${film.scenes.length} / ${timeline.ids.length} 幕；${film.scenes.map(s => s.id).join(' → ')}；id/dur/chapter/顺序/拼接起点差异 ${timeline.sceneIssues.length}`);
  for (const issue of timeline.sceneIssues) console.log(`  ${issue}`);
  console.log(`  未注册（本期要求全量，遗漏算 FAIL）：${timeline.missing.join(', ') || '无'}`);
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
  status('章节', !timeline.chapterIssues.length && film.chapters.length === chapters.length, `已登记 ${film.chapters.length} / CHAPTERS ${chapters.length} 章；编号 ${film.chapters.map(c => c.n).join(' → ')}；逐章比对首幕起点及中英文标题/说明，SCRIPT/FILM 场景章号不递减`);
  for (const issue of timeline.chapterIssues) console.log(`  ${issue}`);
  const episode = auditEpisode(loaded);
  status('本期编排', !episode.issues.length, `标题幕 s03/s22；章节卡 ${episode.cards.map(s => s.id+'(章'+s.chap+')').join('、')}，首句≥2s；字幕配置54px；差异 ${episode.issues.length}`);
  for (const issue of episode.issues) console.log(`  ${issue}`);
  for (const c of film.chapterInfo) console.log(`  章 ${c.n} @ ${f3(c.t)}s：${c.zh} / ${c.en}`);
  const sceneObjectAt = t => loaded.h.registrations.find(s => t >= s.start && t < s.start+s.d) || loaded.h.registrations.at(-1);
  const sceneAt = t => sceneObjectAt(t).id;
  const duration = film.duration;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error(`无法扫描时长 ${duration}`);
  const timeSet = new Set(Array.from({ length: Math.floor(duration/STEP)+1 }, (_, i) => i*STEP));
  const addTime = t => { if (t >= 0 && t <= duration) timeSet.add(t); };
  addTime(duration);
  for (const sc of loaded.h.registrations) {
    [-.001, 0, .001, sc.d-.001].forEach(lt => addTime(sc.start+lt));
    sc.cs.forEach((start, i) => addTime(sc.start+(start+sc.ce[i])/2));
    if (sc.card != null) [.38, .8, 1.42, 1.92, 1.95, 2, 2.1].forEach(lt => addTime(sc.start+lt));
  }
  const times = [...timeSet].sort((a, b) => a-b);
  const overlap = new Intervals(), outside = new Intervals(), subtitle = new Intervals(), header = new Intervals(), small = new Intervals(), textLine = new Intervals(), ownZone = new Intervals();
  const categories = [['文字重叠', overlap], ['文字/线条重叠', textLine], ['文字出画', outside], ['正文小字号', small], ['页眉区', header], ['字幕区', subtitle], ['外框/字幕自身越区', ownZone]];
  const presentation = [], seenCards = new Set(), titleFrames = new Map();
  const fadeProbe = makeRuntime(), fadeCanvas = fadeProbe.h.canvas(WIDTH, HEIGHT, true);
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
        const sc = out.scene, lt = t-sc.start;
        const add = (intervals, category, hits) => intervals.add(index, t, hits.map(hit => classify(hit, category, sc, lt)), sc.id);
        const overlaps = overlapHits(fills), lineOverlaps = lineHits(fills, out.lines, out.plates);
        if ([...overlaps, ...lineOverlaps].some(hit => hit.items.some(x => x.alpha < .999))) {
          try {
            const before = fadeProbe.h.frame(fadeProbe.film, fadeCanvas, Math.max(sc.start, t-.35), { text: true });
            const after = fadeProbe.h.frame(fadeProbe.film, fadeCanvas, Math.min(sc.start+sc.d-.000001, t+.35), { text: true });
            if (!before.numericIssues.length && !after.numericIssues.length) {
              for (const hit of overlaps) hit.crossfade = crossfadeTrend(hit, before.texts, after.texts);
              for (const hit of lineOverlaps) hit.crossfade = lineCrossfadeTrend(hit, before.texts, after.texts);
            }
          } catch { /* Lack of evidence leaves these warnings suspicious. */ }
        }
        add(overlap, '文字重叠', overlaps);
        add(textLine, '文字/线条重叠', lineOverlaps);
        add(outside, '文字出画', outsideHits(fills));
        add(subtitle, '字幕区', zoneHits(out.texts, SUBTITLE, 'caption'));
        add(header, '页眉区', zoneHits(out.texts, HEADER, 'chrome'));
        add(small, '正文小字号', smallTextHits(out.texts));
        add(ownZone, '外框/字幕自身越区', out.texts.filter(x => (x.caption && x.bounds.top < 890-EPS) || (x.chrome && x.bounds.bottom > 110+EPS)).map(x => ({
          key: JSON.stringify([x.text, x.role]), texts: [x.text], bounds: x.bounds, items: [x], ratio: 1,
        })));
        for (const issue of presentationIssues(out, t, runtime.h.options)) presentation.push({ t, id: sc.id, lt, issue });
        if (sc.title) titleFrames.set(sc.id, (titleFrames.get(sc.id) || 0)+1);
        if (sc.card != null && Math.abs(lt-.8) < EPS) {
          const texts = out.texts.filter(x => x.role === 'drawTransition').map(x => x.text);
          const [zh, en] = chapters[sc.card];
          if (!texts.includes(zh.split('｜').at(-1)) || !texts.includes(en)) presentation.push({ t, id: sc.id, lt, issue: `章节卡未在 drawTransition 绘出 CHAPTERS 的中英文标题；实际 ${texts.map(quote)}` });
          else seenCards.add(sc.id);
        }
        if (sc.card != null && lt > 2+EPS && out.texts.some(x => x.role === 'drawTransition')) presentation.push({ t, id: sc.id, lt, issue: '章节卡文字在前2s之后仍绘制' });
      } catch (error) {
        errors.push({ t, scene: sceneAt(t), message: error.message });
        // Resume with a clean VM so one bad frame cannot contaminate the remaining scan.
        runtime = makeRuntime(); canvas = runtime.h.canvas(w, h, true); runtime.h.phase = `数值健康 ${w}×${h}`;
      }
    }
    status(`数值健康 ${w}×${h}`, !errors.length, `${checked}/${times.length} 帧完成；异常/非有限参数/栈失衡 ${errors.length} 帧（含离屏画布）`);
    for (const e of errors) console.log(`  ${f3(e.t)} s ${e.scene}：${e.message}`);
  }
  status('标题幕/章节卡/字幕绘制', !presentation.length && seenCards.size === episode.cards.length && [...TITLE_IDS].every(id => titleFrames.has(id)),
    `标题幕采样 ${JSON.stringify(Object.fromEntries(titleFrames))}；章节卡实绘 ${seenCards.size}/${episode.cards.length}；字幕文本/54px/白字与强调色/深蓝底板；异常 ${presentation.length}`);
  for (const e of presentation) console.log(`  ${e.id} 局部 ${f3(e.lt)}s / 全局 ${f3(e.t)}s：${e.issue}`);

  console.log('\n确定性：');
  let seed = SEED;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0)/4294967296; };
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, i) => Number(((i+random())/SAMPLE_COUNT*duration).toFixed(6)));
  const shuffled = samples.slice();
  for (let i = shuffled.length-1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const baselines = new Map(), logicalBaselines = new Map();
  console.log(`固定种子 0x${SEED.toString(16)}，${SAMPLE_COUNT} 个分层随机时刻；按方法名/参数/属性写入记录，数字四舍五入至 3 位小数。`);
  console.log('离屏构建不混入主画布序列；drawImage/createPattern 引用离屏指令及真实 ImageData 字节的内容哈希，兼顾冷启动与缓存复用。');
  console.log('Math.random、无参 Date/new Date、Date.now、performance.now 被禁止；没有用固定值掩盖非确定性。');
  console.log('非法透明度写入也纳入指令比较；其数值FAIL单列在数值健康中，不阻断本项的渲染顺序比较。');
  console.log(`采样秒数：${samples.join(', ')}`);
  for (const [w, h] of [[WIDTH, HEIGHT], [WIDTH*2, HEIGHT*2]]) {
    const runtime = makeRuntime(), canvas = runtime.h.canvas(w, h, true), baseline = new Map(), logical = new Map(), errors = [], numericErrors = new Map();
    baselines.set(w, baseline); logicalBaselines.set(w, logical);
    let renders = 0, comparisons = 0, matches = 0;
    const draw = (rt, cv, t, label) => {
      rt.h.phase = `确定性 ${w}×${h} ${label}`;
      try {
        const out = rt.h.frame(rt.film, cv, t, { trace: true, text: label === '顺序' }); renders++;
        if (label === '顺序') logical.set(t, logicalSnapshot(out));
        for (const issue of out.numericIssues) {
          const key = label + issue.message + issue.source, old = numericErrors.get(key);
          if (old) { old.times.add(t); old.count++; old.min = Math.min(old.min, issue.value); old.max = Math.max(old.max, issue.value); }
          else numericErrors.set(key, { ...issue, label, times: new Set([t]), count: 1, min: issue.value, max: issue.value });
        }
        return out.commands;
      }
      catch (e) { errors.push(`${label} ${f3(t)} s ${sceneAt(t)} 局部 ${f3(t-sceneObjectAt(t).start)}s：${e.message}`); return null; }
    };
    for (const t of samples) baseline.set(t, draw(runtime, canvas, t, '顺序'));
    const compare = (t, commands, label) => {
      comparisons++; const expectedCommands = baseline.get(t);
      if (!commands || !expectedCommands) return;
      const difference = commandDifference(expectedCommands, commands);
      if (!difference) { matches++; return; }
      errors.push(`${label} ${f3(t)} s ${sceneAt(t)} 局部 ${f3(t-sceneObjectAt(t).start)}s：${difference}`);
    };
    for (const t of samples.slice().reverse()) compare(t, draw(runtime, canvas, t, '倒序'), '倒序');
    for (const t of shuffled) compare(t, draw(runtime, canvas, t, '随机乱序'), '随机乱序');
    for (const t of samples) {
      const single = makeRuntime(), cv = single.h.canvas(w, h, true);
      compare(t, draw(single, cv, t, '独立 VM 首帧'), '独立 VM 首帧');
    }
    status(`确定性 ${w}×${h}`, !errors.length && !numericErrors.size && matches === SAMPLE_COUNT*3, `${renders}/${SAMPLE_COUNT*4} 次 render；倒序/随机乱序/独立VM首帧 ${matches}/${comparisons} 组逐指令一致；差异/中断 ${errors.length}；数值异常 ${numericErrors.size} 组`);
    for (const error of errors) console.log(`  ${error}`);
    for (const e of numericErrors.values()) {
      const hitTimes = [...e.times].sort((a, b) => a-b);
      console.log(`  ${e.label}：${f3(hitTimes[0])}–${f3(hitTimes.at(-1))} s 的 ${hitTimes.length} 个采样时刻（非连续区间），${e.message} ${e.min}～${e.max}（${e.count}次）；${e.source || '无源码位置'}；无关联文字`);
    }
  }
  const crossErrors = [];
  for (const t of samples) {
    const a = logicalBaselines.get(WIDTH).get(t), b = logicalBaselines.get(WIDTH*2).get(t);
    const difference = a && b ? commandDifference(a, b) : '缺少基准帧，无法比较';
    if (difference) crossErrors.push(`${sceneAt(t)} 局部 ${f3(t-sceneObjectAt(t).start)}s / 全局 ${f3(t)}s：${difference}`);
  }
  status('跨分辨率逻辑几何', !crossErrors.length, `1080p/4K 去除画布分辨率缩放后比较文字、字号、直线路径与线宽：${samples.length-crossErrors.length}/${samples.length} 帧一致；背景粒子/纸纹及像素采样不要求同哈希`);
  crossErrors.forEach(e => console.log(`  ${e}`));
  const switchErrors = [], switchRuntime = makeRuntime(), switchCanvas = switchRuntime.h.canvas(WIDTH, HEIGHT, true);
  let switchMatches = 0, covers = 0;
  for (const [i, t] of shuffled.entries()) {
    const w = i % 2 ? WIDTH*2 : WIDTH;
    try {
      switchCanvas.width = w; switchCanvas.height = w*HEIGHT/WIDTH;
      if (i % 20 === 0 || i % 20 === 1) {
        const cover = switchRuntime.h.frame(switchRuntime.film, switchCanvas, 0, { text: true, cover: true }); covers++;
        if (cover.numericIssues.length) throw new Error(`封面数值异常 ${JSON.stringify(cover.numericIssues)}`);
      }
      const out = switchRuntime.h.frame(switchRuntime.film, switchCanvas, t, { trace: true });
      if (out.numericIssues.length) throw new Error(`数值异常 ${JSON.stringify(out.numericIssues)}`);
      const baseline = baselines.get(w).get(t);
      const difference = baseline ? commandDifference(baseline, out.commands) : '缺少基准帧';
      if (difference) throw new Error(difference);
      switchMatches++;
    } catch (e) { switchErrors.push(`${w}×${w*HEIGHT/WIDTH} ${sceneAt(t)} 局部 ${f3(t-sceneObjectAt(t).start)}s / 全局 ${f3(t)}s：${e.message}`); }
  }
  status('切换尺寸/封面后确定性', !switchErrors.length, `1080p/4K 交替切换并穿插 ${covers} 次封面；${switchMatches}/${samples.length} 帧与各自尺寸基准指令一致`);
  switchErrors.forEach(e => console.log(`  ${e}`));

  console.log('\n字体首族（所有实际执行的 ctx.font 赋值及文字绘制，含离屏/测宽/低透明度路径）：');
  status('字体白名单', !fontFindings.size, `${fontChecks} 次检查；首族 ${[...usedFamilies].map(x => x ?? '<无法解析>').sort().join(', ')}；非法组合 ${fontFindings.size}`);
  console.log(`  允许：${[...FONT_FAMILIES].join(' / ')}；只查首族，允许后续回退族。Canvas 初始默认值不算赋值，未设置字体就绘字仍会被检查。`);
  for (const e of fontFindings.values()) {
    const times = [...e.times].filter(x => x !== null).sort((a, b) => a-b);
    console.log(`  ${quote(e.font)}；首族 ${quote(e.family)}；${e.main ? '主画布' : '离屏'}；${e.count} 次；${times.length ? `首末命中 ${f3(times[0])}–${f3(times.at(-1))} s（不表示连续）` : '加载阶段，无帧时刻'}${e.times.has(null) && times.length ? '，另含加载阶段' : ''}；文字 ${[...e.texts].map(quote).join('、') || '<仅赋值/测宽>'}`);
  }
  console.log('\n文字几何规则与告警汇总：');
  status('几何扫描覆盖', layoutFrames === times.length, `${layoutFrames}/${times.length} 帧；有效 fillText ${visibleTexts} 次、strokeText ${strokeTexts} 次`);
  console.log('宽度按 ASCII 0.6em、其他码点1em，加 letterSpacing；高度1.2em；字框经完整矩阵变换，包含 cam.z 和局部动画缩放，再归一至1920×1080。');
  console.log('正文<24px 告警；字幕/外框/章节卡/标题幕/封面豁免正文门槛。字幕实际54px另作硬检查。透明度=globalAlpha×颜色alpha，低于0.15忽略。');
  console.log('文字相交≥较小框15%告警；文字/直线检测字框内缩10%后的中心线穿越，排除已被后绘不透明矩形内区完全遮住的线。曲线/圆弧/Path2D边线未纳入。');
  console.log('y<110仅外框文字豁免，y>890仅字幕文字豁免；另外检查外框/字幕自身跑出所属区。几何结果不单独导致FAIL。');
  console.log('每幕、同内容/角色/判定/原因、相邻采样点合并一个区间；跨度=末次−首次，单点为0；命中次数保留该帧全部调用对。');
  for (const [name, intervals] of categories) {
    const expected = intervals.groups.filter(g => g.verdict === '预期误报').length;
    warn(name, intervals.hits, `${intervals.groups.length} 条区间：预期误报 ${expected}，疑似真问题 ${intervals.groups.length-expected}；${intervals.hits} 次命中，${intervals.frames} 帧`);
  }
  const allWarnings = categories.flatMap(([category, intervals]) => intervals.groups.map(g => ({ ...g, category })));
  const byScene = (a, b) => [...a.scenes][0].localeCompare([...b.scenes][0]) || a.sampleTime-b.sampleTime || a.category.localeCompare(b.category);
  const score = g => (g.category === '文字重叠' ? 12 : g.category === '正文小字号' ? 4 : g.category === '文字/线条重叠' ? 5 : 2) *
    (1 + Math.min(12, g.end-g.start)) + (g.category === '正文小字号' ? (g.maxRatio || 0)/24 : (g.maxRatio || 0));
  const ranked = verdict => allWarnings.filter(g => g.verdict === verdict).sort((a, b) => score(b)-score(a) || byScene(a, b));
  const picked = [], taken = new Set(), buckets = new Map();
  const choose = (candidates, limit, diverse) => {
    for (const g of candidates) {
      if (picked.length >= limit) break;
      const key = [...g.scenes][0]+' / '+g.category;
      if (taken.has(g) || (diverse && (buckets.get(key) || 0) >= 3)) continue;
      picked.push(g); taken.add(g); buckets.set(key, (buckets.get(key) || 0)+1);
    }
  };
  choose(ranked('疑似真问题'), 24, true);
  choose(ranked('预期误报'), 30, true);
  choose([...ranked('疑似真问题'), ...ranked('预期误报')], 30, false);
  const detail = (g, i) => {
    const sc = loaded.h.registrations.find(s => s.id === [...g.scenes][0]);
    console.log(`${i+1}. ${sc.id} | ${g.category} | ${g.verdict} | 局部 ${f3(g.sampleTime-sc.start)}s / 全局 ${f3(g.sampleTime)}s`);
    console.log(`   ${g.texts.map(quote).join(' ↔ ')} | 框 ${boxLabel(g.bounds)}${g.otherBounds ? ' ↔ '+boxLabel(g.otherBounds) : ''}`);
    if (g.segment) console.log(`   线段 ${g.segment.map(p => '('+p.map(f3).join(', ')+')').join(' → ')}`);
    console.log(`   局部区间 ${f3(g.start-sc.start)}–${f3(g.end-sc.start)}s；${g.count}点；${g.category === '正文小字号' ? '字号 '+f3(g.minSize)+'–'+f3(g.maxSize)+'px' : '命中比例 '+(g.minRatio*100).toFixed(1)+'%–'+(g.maxRatio*100).toFixed(1)+'%'}；${g.reason}`);
  };
  console.log('\n最值得复核的前30条（先取疑似问题24条，兼顾每幕/每类，补入预期误报对照，最后按幕号与局部时间列出）：');
  picked.sort(byScene).forEach(detail);
  if (!picked.length) console.log('  无。');
  console.log('\n全部告警（按幕号、局部时间；包含上面的重点条目）：');
  allWarnings.sort(byScene).forEach(detail);
  if (!allWarnings.length) console.log('  无。');

  const changed = sources.filter(s => sha(fs.readFileSync(path.join(__dirname, s.name), 'utf8')) !== s.hash);
  status('输入版本一致性', !changed.length, `${sources.length-changed.length}/${sources.length} 份输入在检查期间未变；本报告使用开头哈希标识的源码快照`);
  for (const s of changed) console.log(`  检查期间 ${s.name} 已变化，请针对当前源码重跑。`);

  console.log('\n保守口径、预期误报与覆盖限制：');
  console.log('1. 不读取真实字体字形；无抗锯齿或像素截图。字宽、基线、旋转AABB估算可能误报或漏报，几何只作告警。');
  console.log('2. 章节卡 drawTransition 在前1.95s产生的叠字/出画归预期；半透明叠字用前后各0.35s探针确认两项透明度反向变化>0.1。文字/线条需文字淡出>0.2、当前alpha之和距1≤0.02才推断为线路切换淡化，仍可复核。');
  console.log('3. 动态cam导致出画/进入字幕或页眉区，只有逆变换回世界坐标后不越界才归预期；s21横向跟拍远处文字出画单独归预期。');
  console.log('4. 不因字号小发生在动画入场/翻牌就自动豁免；局部压缩、图标内文字与画外小字均保守报告。外框作为界面标签豁免正文24px门槛，标题幕/章节卡/封面整体豁免。');
  console.log('5. 文字/线条检测用不透明矩形、圆角矩形、完整圆的保守内接矩形消除遮挡；clip生效时不推断遮挡。其余曲面边缘、Path2D、擦除、虚线间隙、阴影、合成/滤镜未像素化。');
  console.log('6. 文字重叠/出画使用fillText，字号/分区使用fillText与strokeText；离屏或图像内文字未作几何检查，离屏字体仍查白名单。相同内容多个位置可能合并。');
  console.log('7. 网格0.25s并补充边界/字幕中点/章节卡关键帧，仍可能遗漏短促事件。确定性为120个固定种子分层随机时刻，数值比较保留三位小数。');
  console.log('8. 两尺寸分别比较完整指令与离屏内容哈希；跨尺寸比较归一化文字和直线路径，纸纹/粒子/复杂填充不作像素一致断言。交替切尺寸、穿插封面另验缓存历史污染。');
  console.log('9. 字幕默认白字允许配置的富文本强调色；标题幕仍参与SCRIPT字幕数据一致性，但实际不绘字幕/底板/外框。前2秒章节卡指每章首幕局部[0,2]，不额外插入时间。');
  console.log('10. 场景要求SCRIPT全部注册，时长/字幕/章节首幕时间由数据计算，章节元数据逐项核对CHAPTERS；没有上一期幕号/文案/固定总时长。');
  console.log('11. 非法globalAlpha仍FAIL；按Canvas忽略非法赋值继续扫，非有限数/栈错误则重建VM继续，绝不修改画面源码。所有输入末尾复核哈希。');
  const failures = statuses.filter(s => !s.pass);
  console.log(`\n总结果：[${failures.length ? '失败' : '通过'}] ${statuses.length-failures.length}/${statuses.length} 项硬检查通过，${failures.length} 项失败${failures.length ? '（'+failures.map(s => s.name).join('、')+'）' : ''}；${warnings.length} 类告警${warnings.length ? '（'+warnings.map(s => s.name).join('、')+'）' : ''}不影响退出码。退出码 ${failures.length ? 1 : 0}。`);
  process.exitCode = failures.length ? 1 : 0;
}
if (require.main === module) {
  try { main(); }
  catch (error) { console.log(`\n[失败] 检查器/加载中止：${error.stack}`); process.exitCode = 1; }
}
module.exports = { Harness, load, AuditPath, overlapHits, Intervals, selfTest, auditTimeline, auditScript,
  firstFontFamily, logicalFontSize, markerError, weightedLength, zoneHits, smallTextHits,
  lineHits, classify, crossfadeTrend, presentationIssues, auditEpisode, logicalSnapshot, commandDifference };
