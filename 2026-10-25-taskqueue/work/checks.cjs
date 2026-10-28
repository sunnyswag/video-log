#!/usr/bin/env node
'use strict';
// Adapted from the screen-intercom pilot. Audit only: no dependencies or source edits.
// Run: node checks.cjs > checks.report.txt ; a finding gives exit status 1.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const STEP = 0.25, WIDTH = 1920, HEIGHT = 1080, ALPHA = 0.15, OVERLAP = 0.15;
const SEED = 0x53495032, SAMPLE_COUNT = 120;
const FILES = ['../../tools/film-kit/engine.js', 'script.js', 'kit.js', 'film.js'];
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = () => [1, 0, 0, 1, 0, 0];
const quote = s => JSON.stringify(s);
const f3 = n => n.toFixed(3);
const EPS = 1e-7;
const FAMILIES = new Set(['FCJK', 'FDisp', 'FSup', 'FMono', 'FMonoCJK']);
const SYSTEM_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy', 'Arial', 'Helvetica', 'Times New Roman', 'Consolas', 'Menlo', 'Monaco', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', 'SimHei', 'SimSun', 'DejaVu Sans Mono', 'Inter', 'Inter Display']);
const CUES = new Set('whoosh clank stamp weld latch blip error pop slide click thud confirm tick send bell shutter down swoosh chop type hum print scan alarm spray punch swell belt'.split(' '));
const plain = s => String(s).replace(/[{}\[\]^]/g, '');
const round = n => +n.toFixed(3);
function fontIssue(font) {
  const match = String(font).match(/([\d.]+)px(?:\s*\/\s*[\d.]+(?:px|em|%)?)?\s+(.+)$/);
  if (!match || !Number.isFinite(+match[1]) || +match[1] <= 0) return { level: 'FAIL', reason: '无法解析正字号和字体族' };
  const families = match[2].split(',').map(s => s.trim().replace(/^(['"])(.*)\1$/, '$2'));
  if (!FAMILIES.has(families[0])) return { level: 'FAIL', reason: '首选字体族必须是 FCJK/FDisp/FSup/FMono/FMonoCJK' };
  const unknown = families.slice(1).filter(f => !FAMILIES.has(f) && !SYSTEM_FAMILIES.has(f));
  return unknown.length ? { level: 'WARN', reason: `不能确认是否系统回退字体：${unknown.join(', ')}` } : null;
}
function provenance() {
  const lines = (new Error().stack || '').split('\n').filter(s => /(?:^|[ (])(?:kit|film)\.js:\d+/.test(s));
  return lines.slice(0, 4).map(s => s.trim().replace(/^at /, '')).join(' ← ') || '检查器自检';
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
  if (name === 'ellipse' && (args[2] < 0 || args[3] < 0)) throw new Error('ellipse: 负半径');
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
    this.lines = []; this.geomPath = []; this.pen = null; this.substart = null; this.clipDepth = 0;
  }
  record(name, args = []) {
    finite(args, name);
    if (this.canvas.main && this.harness.collectText) this.geometry(name, args);
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
    this.geomPath = []; this.pen = null; this.substart = null; this.clipDepth = 0;
    this.hash = createHash('sha256'); this.cachedDigest = null; this.record('reset');
  }
  save() { this.record('save'); this.stack.push({ state: { ...this.state }, m: this.m.slice(), dash: this.dash.slice(), clipDepth: this.clipDepth }); }
  restore() {
    if (!this.stack.length) throw new Error('restore 下溢（没有对应 save）');
    this.record('restore'); const saved = this.stack.pop(); this.state = saved.state; this.m = saved.m; this.dash = saved.dash;
    this.clipDepth = saved.clipDepth;
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
  createRadialGradient(...args) { numbers(args, 6, 'createRadialGradient'); if (args[2] < 0 || args[5] < 0) throw new Error('createRadialGradient: 负半径'); this.record('createRadialGradient', args); return new AuditGradient(this, 'radial', args); }
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
    numbers([x, y], 2, 'fillText'); if (maxWidth !== undefined) numbers([maxWidth], 1, 'fillText.maxWidth');
    this.record('fillText', maxWidth === undefined ? [s, x, y] : [s, x, y, maxWidth]);
    if (!this.canvas.main || !this.harness.collectText || this.globalAlpha < ALPHA || !String(s).trim()) return;
    const { width, size } = this.metrics(s), w = maxWidth == null ? width : Math.min(width, maxWidth), h = size*1.2;
    if (w <= 0) return;
    let left = x;
    const align = this.textAlign === 'start' ? (this.direction === 'rtl' ? 'right' : 'left') : this.textAlign === 'end' ? (this.direction === 'rtl' ? 'left' : 'right') : this.textAlign;
    if (align === 'center') left -= w/2; else if (align === 'right') left -= w;
    const top = y - ({ top: 0, hanging: size*0.2, middle: h/2, alphabetic: size, ideographic: h, bottom: h }[this.textBaseline] ?? size);
    const [a, b, c, d, e, f] = this.m;
    const points = [[left, top], [left+w, top], [left+w, top+h], [left, top+h]].map(([px, py]) => [a*px+c*py+e, b*px+d*py+f]);
    finite(points, '文字屏幕坐标');
    const bounds = { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) };
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    const meta = this.harness.textCall;
    this.texts.push({ text: String(s), bounds, caption: this.harness.captionDepth > 0, chrome: this.harness.chromeDepth > 0,
      alpha: this.globalAlpha, size, font: this.font, source: provenance(), clip: this.clipDepth > 0,
      call: 'fillText', textGroup: meta?.id, emboss: meta?.emboss && meta.n++ === 0,
      effectiveSize: size * Math.hypot(this.m[2], this.m[3]) / (this.canvas.height / HEIGHT) });
  }
  strokeText(s, x, y, maxWidth) {
    numbers([x, y], 2, 'strokeText'); if (maxWidth !== undefined) numbers([maxWidth], 1, 'strokeText.maxWidth');
    // Reuse bounds without recording an extra fillText command.
    const record = this.record; this.record = () => {};
    const n = this.texts.length;
    try { this.fillText(s, x, y, maxWidth); } finally { this.record = record; }
    if (this.texts.length > n) this.texts.at(-1).call = 'strokeText';
    this.record('strokeText', maxWidth == null ? [s, x, y] : [s, x, y, maxWidth]);
  }
}
// Geometry records are separate from the command trace and cannot alter rendering.
AuditContext.prototype.geometry = function (name, args) {
  const point = (x, y) => [this.m[0]*x+this.m[2]*y+this.m[4], this.m[1]*x+this.m[3]*y+this.m[5]];
  const move = p => { this.pen = p; this.substart = p; };
  const line = p => { if (this.pen) this.geomPath.push([this.pen, p]); this.pen = p; };
  const rect = (x, y, w, h) => { move(point(x, y)); line(point(x+w, y)); line(point(x+w, y+h)); line(point(x, y+h)); line(this.substart); };
  if (name === 'beginPath') { this.geomPath = []; this.pen = null; this.substart = null; }
  else if (name === 'moveTo') move(point(...args));
  else if (name === 'lineTo') line(point(...args));
  else if (name === 'closePath' && this.substart) line(this.substart);
  else if (name === 'rect' || name === 'roundRect') rect(...args);
  else if (name === 'arc' || name === 'ellipse') {
    let x, y, rx, ry, rotation, start, end, ccw;
    if (name === 'arc') { [x, y, rx, start, end, ccw] = args; ry = rx; rotation = 0; }
    else [x, y, rx, ry, rotation, start, end, ccw] = args;
    let sweep = end-start;
    if (Math.abs(sweep) >= Math.PI*2) sweep = (ccw ? -1 : 1)*Math.PI*2;
    else if (ccw && sweep > 0) sweep -= Math.PI*2;
    else if (!ccw && sweep < 0) sweep += Math.PI*2;
    const n = Math.max(8, Math.ceil(Math.abs(sweep)*12));
    for (let i = 0; i <= n; i++) {
      const a = start+sweep*i/n, u = rx*Math.cos(a), v = ry*Math.sin(a);
      const p = point(x+u*Math.cos(rotation)-v*Math.sin(rotation), y+u*Math.sin(rotation)+v*Math.cos(rotation));
      if (!this.pen) move(p); else line(p);
    }
  } else if (name === 'quadraticCurveTo' || name === 'bezierCurveTo') {
    const p0 = this.pen || point(args[0], args[1]);
    const p1 = point(args[0], args[1]), p2 = point(args[2], args[3]);
    const p3 = name === 'bezierCurveTo' ? point(args[4], args[5]) : null;
    for (let i = 1; i <= 24; i++) {
      const t = i/24, u = 1-t;
      line([0, 1].map(k => p3 ? u**3*p0[k]+3*u*u*t*p1[k]+3*u*t*t*p2[k]+t**3*p3[k] : u*u*p0[k]+2*u*t*p1[k]+t*t*p2[k]));
    }
  } else if (name === 'arcTo') {
    // Conservative tangent approximation, always reported as a warning if intersecting.
    line(point(args[0], args[1])); line(point(args[2], args[3]));
  } else if (name === 'clip') this.clipDepth++;
  else if (name === 'stroke' || name === 'strokeRect' || (name === 'fillRect' && Math.min(Math.abs(args[2]), Math.abs(args[3])) <= 6 && Math.max(Math.abs(args[2]), Math.abs(args[3])) >= 12)) {
    if (this.globalAlpha < ALPHA) return;
    const saved = { path: this.geomPath, pen: this.pen, substart: this.substart };
    let parts = this.geomPath;
    if (name.endsWith('Rect')) {
      this.geomPath = []; this.pen = null; rect(...args); parts = this.geomPath;
    } else if (args[0] instanceof AuditPath) {
      this.geomPath = []; this.pen = null; this.substart = null;
      const replay = p => { for (const [method, values, m] of p.commands) {
        if (method === 'addPath') { this.harness.geometryNotes.add('Path2D.addPath 的几何仅做保守检查，指令完整记录'); }
        else if (method === 'svg') this.harness.geometryNotes.add('SVG Path2D 字符串未展开几何，指令完整记录');
        else this.geometry(method, values);
      } };
      replay(args[0]); parts = this.geomPath;
    }
    const [a, b, c, d] = this.m, sum = a*a+b*b+c*c+d*d, det = a*d-b*c;
    const scale = Math.sqrt((sum+Math.sqrt(Math.max(0, sum*sum-4*det*det)))/2);
    const source = provenance();
    const width = name === 'fillRect' ? 0 : this.lineWidth * scale;
    this.lines.push({ parts: parts.slice(), width, source, call: name, clip: this.clipDepth > 0,
      plate: this.harness.plateBounds, alpha: this.globalAlpha,
      description: name === 'stroke' ? `stroke()，${parts.length} 段` : `${name}(${args.join(', ')})` });
    this.geomPath = saved.path; this.pen = saved.pen; this.substart = saved.substart;
  }
};
for (const key of Object.keys(defaults())) {
  Object.defineProperty(AuditContext.prototype, key, {
    get() { return this.state[key]; },
    set(value) {
      finite(value, key);
      if (typeof defaults()[key] === 'number') numbers([value], 1, key);
      if (key === 'globalAlpha' && (value < 0 || value > 1)) throw new Error(`globalAlpha 越界 ${value}`);
      if (key === 'font') {
        const issue = fontIssue(value); this.harness.fontWrites++;
        this.harness.fonts.add(String(value));
        if (issue) this.harness.fontIssues.push({ ...issue, font: value, source: provenance(), offscreen: !this.canvas.main });
      }
      this.state[key] = value; this.record(`set:${key}`, [value]);
    },
  });
}
for (const [name, count] of Object.entries({ ...pathMethods, beginPath: 0, fill: 0, stroke: 0, clip: 0, fillRect: 4, clearRect: 4, strokeRect: 4 })) {
  AuditContext.prototype[name] = function (...args) { validatePath(name, args, count); this.record(name, args); };
}

class Harness {
  constructor() { this.contexts = []; this.captionDepth = 0; this.chromeDepth = 0; this.collectText = false;
    this.fontWrites = 0; this.fontIssues = []; this.fonts = new Set(); this.textSerial = 0; this.textCall = null; this.geometryNotes = new Set(); }
  canvas(w, h, main = false) { return new AuditCanvas(this, w, h, main); }
  balanced() {
    for (const c of this.contexts) if (c.stack.length) throw new Error(`${c.canvas.main ? '主' : '离屏'}画布 save/restore 泄漏 ${c.stack.length}`);
  }
  frame(film, canvas, t, { trace = false, text = false } = {}) {
    this.balanced(); this.collectText = text;
    const c = canvas.context; c.capture = trace; c.trace = []; c.texts = []; c.lines = [];
    this.fontIssues = [];
    film.render(canvas, t); this.balanced();
    return { commands: c.trace, texts: c.texts, lines: c.lines, fonts: this.fontIssues.slice() };
  }
}
function load(sources) {
  const h = new Harness();
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
  // Tag ACTUAL hooks, never infer chrome/caption identity from strings or coordinates.
  const create = context.FilmKit.create;
  let builder; const registrations = [];
  context.FilmKit.create = function (options) {
    const opts = { ...options };
    for (const [hook, depth] of [['drawCaption', 'captionDepth'], ['drawChrome', 'chromeDepth']]) {
      if (!opts[hook]) continue;
      const draw = opts[hook];
      opts[hook] = function (...args) { h[depth]++; try { return draw.apply(this, args); } finally { h[depth]--; } };
    }
    builder = create.call(this, opts);
    if (builder.addScene) {
      const add = builder.addScene;
      builder.addScene = function (o) { registrations.push(o); return add.call(this, o); };
    }
    return builder;
  };
  for (const [i, source] of sources.slice(1).entries()) {
    source.compiled.runInContext(context, { timeout: 10000 });
    if (i === 1 && typeof context.text === 'function') {
      const draw = context.text;
      context.text = function (...args) {
        if (!h.collectText) return draw.apply(this, args);
        const previous = h.textCall;
        h.textCall = { id: ++h.textSerial, n: 0, emboss: !!args[4]?.emboss };
        try { return draw.apply(this, args); } finally { h.textCall = previous; }
      };
    }
    if (i === 1 && typeof context.plate === 'function') {
      const draw = context.plate;
      context.plate = function (g, x, y, w, height, ...rest) {
        if (!h.collectText) return draw.call(this, g, x, y, w, height, ...rest);
        const previous = h.plateBounds, [a, b, c, d, e, f] = g.m;
        const points = [[x, y], [x+w, y], [x+w, y+height], [x, y+height]].map(([px, py]) => [a*px+c*py+e, b*px+d*py+f]);
        h.plateBounds = { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) };
        try { return draw.call(this, g, x, y, w, height, ...rest); } finally { h.plateBounds = previous; }
      };
    }
  }
  if (!context.FILM || typeof context.FILM.render !== 'function') throw new Error('没有导出 FILM.render');
  const config = vm.runInContext('({ only: typeof ONLY === "undefined" ? null : ONLY, sample: typeof SAMPLE_OPT === "undefined" ? {} : SAMPLE_OPT })', context);
  return { h, film: context.FILM, script: vm.runInContext('SCRIPT', context), context, builder, registrations, ...config };
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
    hits.push({ key: JSON.stringify(pair), texts: pair, ratio, a, b });
  }
  return hits;
}
class Intervals {
  constructor() { this.groups = []; this.active = new Map(); this.hits = 0; this.frames = 0; }
  add(index, t, hits, scene) {
    this.hits += hits.length; if (hits.length) this.frames++;
    const unique = new Map();
    for (const hit of hits) {
      const key = JSON.stringify([scene, hit.key]);
      const old = unique.get(key);
      if (!old || (hit.ratio ?? 0) > (old.ratio ?? 0)) unique.set(key, hit);
    }
    const next = new Map();
    for (const [key, hit] of unique) {
      let group = this.active.get(key);
      if (!group || group.lastIndex !== index-1) {
        group = { ...hit, start: t, end: t, count: 0, minRatio: hit.ratio, maxRatio: hit.ratio, scenes: new Set(), sampleTime: t };
        this.groups.push(group);
      }
      group.end = t; group.lastIndex = index; group.count++; group.scenes.add(scene);
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

function pilotSelfTest() {
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
  return count;
}

function derive(script, only, sample = {}) {
  const errors = [], scenes = [], captions = [];
  if (only !== null && !Array.isArray(only)) errors.push('ONLY 必须为 null 或 id 数组');
  const ids = Array.isArray(only) ? only : Object.keys(script);
  if (new Set(ids).size !== ids.length) errors.push('ONLY 含重复 id');
  for (const id of ids) if (!Object.hasOwn(script, id)) errors.push(`ONLY 未知场景 ${id}`);
  let duration = 0;
  // ONLY is a membership filter in S(), not a reorder instruction.
  for (const [id, sc] of Object.entries(script)) {
    if (!ids.includes(id)) continue;
    const lead = sample[id]?.lead ?? 0;
    if (!Number.isFinite(lead) || lead < 0) errors.push(`${id} 的 lead 必须非负且有限`);
    if (!Number.isFinite(sc.dur) || sc.dur <= 0) errors.push(`${id} 的 dur 必须为正且有限`);
    const row = { id, start: duration, d: sc.dur+lead, chap: sc.chapter, lead, card: sample[id]?.card };
    scenes.push(row);
    for (const [local0, local1, text] of sc.caps) captions.push({ id, t0: round(duration+local0+lead), t1: round(duration+local1+lead), local0: local0+lead, local1: local1+lead, text, scene: row });
    duration += row.d;
  }
  if (!scenes.length) errors.push('没有入选场景');
  return { scenes, captions, duration, errors };
}
function captionRules(captions, scenes) {
  const issues = [], previous = new Map();
  for (const c of captions) {
    const sc = c.scene || scenes.find(s => s.id === c.id), chars = Array.from(plain(c.text)).length;
    const add = (rule, reason) => issues.push({ rule, t: c.t0, end: c.t1, scene: c.id, content: quote(c.text), reason });
    if (chars > 22) add('字幕字数', `去标记 ${chars} 字符 > 22（空格、标点各计一字符）`);
    if (!Number.isFinite(c.t0) || !Number.isFinite(c.t1) || c.t1-c.t0 < 1.6-EPS) add('字幕时长', `句长 ${c.t1-c.t0} s < 1.6 s 或时间非有限`);
    if (!sc || !Number.isFinite(c.t0) || !Number.isFinite(c.t1) || c.t0 < sc.start-EPS || c.t1 > sc.start+sc.d+EPS || c.t1 <= c.t0) add('字幕幕内边界', '字幕起止必须有序且落在所属幕内');
    const prev = previous.get(c.id);
    if (prev && c.t0 < prev.t1-EPS) add('字幕不重叠', `与前句 ${quote(prev.text)} [${f3(prev.t0)}, ${f3(prev.t1)}] s 重叠或时间逆序`);
    if (!prev || c.t1 > prev.t1) previous.set(c.id, c);
  }
  return issues;
}
function segmentBox(a, b, box, padding = 0) {
  let t0 = 0, t1 = 1;
  for (const [k, lo, hi] of [[0, box.left-padding, box.right+padding], [1, box.top-padding, box.bottom+padding]]) {
    const d = b[k]-a[k];
    if (Math.abs(d) < 1e-10) { if (a[k] < lo || a[k] > hi) return false; continue; }
    const x = (lo-a[k])/d, y = (hi-a[k])/d;
    t0 = Math.max(t0, Math.min(x, y)); t1 = Math.min(t1, Math.max(x, y));
    if (t0 > t1) return false;
  }
  return true;
}
function probeLead(runtime, expected) {
  const issues = [], builder = runtime.builder;
  const registerName = typeof runtime.context.register === 'function' ? 'register' : 'S';
  if (typeof runtime.context[registerName] !== 'function' || !builder) return [{ scene: '全局', content: `${registerName}(id, options)`, reason: `未找到可独立探测的 ${registerName} 注册函数` }];
  const original = { chapter: builder.chapter, addScene: builder.addScene };
  try {
    builder.chapter = () => {};
    for (const sc of expected.scenes) {
      let captured;
      builder.addScene = o => { captured = o; return o; };
      runtime.context[registerName](sc.id, { draw() {}, cues: [[.125, 'tick', .7]] });
      const cue = registerName === 'register' ? captured?.cues?.find(c => c.type === 'tick') : captured?.cues?.[0];
      const caps = expected.captions.filter(c => c.id === sc.id);
      if (!captured || Math.abs(captured.dur-sc.d) > EPS || !cue || Math.abs(cue.t-(.125+sc.lead)) > EPS || cue.type !== 'tick' || cue.v !== .7 || captured.captions.length !== caps.length || captured.captions.some((c, i) => Math.abs(c.t-caps[i].local0) > EPS || Math.abs(c.end-caps[i].local1) > EPS || c.text !== caps[i].text)) issues.push({ t: sc.start, scene: sc.id, content: `${registerName}(${quote(sc.id)}, {cues:[[0.125,"tick",0.7]]})`, reason: `注册函数未正确同时平移时长、字幕或 cue；lead=${sc.lead}；实际 cue=${JSON.stringify(cue)}` });
    }
  } finally { builder.chapter = original.chapter; builder.addScene = original.addScene; }
  return issues;
}
function cameraMoved(sc) {
  return !!sc?.cam?.some(k => Math.abs(k[1]-WIDTH/2) > EPS || Math.abs(k[2]-HEIGHT/2) > EPS || Math.abs(k[3]-1) > EPS);
}
function geometryHits(out, sc, lt) {
  const hits = [], screen = { left: 0, right: WIDTH, top: 0, bottom: HEIGHT };
  const card = sc?.card != null && lt >= -EPS && lt <= 2+EPS;
  const add = (rule, texts, reason, extra = {}, level = 'WARN', expected = false) => {
    const content = texts.map(x => quote(x.text)).join(' ↔ ');
    hits.push({ rule, texts: texts.map(x => x.text), content, reason, level, expected,
      bounds: texts[0]?.bounds, source: texts.map(x => x.source).filter(Boolean).join(' ↔ '), ...extra,
      key: JSON.stringify([rule, content, level, expected, reason, extra.lineKey || '']) });
  };
  for (const hit of overlapHits(out.texts)) {
    const { a, b } = hit;
    const emboss = a.textGroup != null && a.textGroup === b.textGroup && (a.emboss || b.emboss);
    const reason = card ? '章节卷帘门局部 0–2 s，未消除遮挡' : emboss ? '同次 text(..., {emboss:true}) 的阴影与正文重复绘制' : '估算文字框相交 ≥15%；字形墨迹、裁切及后绘遮挡待复核';
    add('文字重叠', [a, b].sort((x, y) => x.text.localeCompare(y.text)), reason, { ratio: hit.ratio }, 'WARN', card || emboss);
  }
  for (const x of out.texts) {
    const outside = x.bounds.left < -EPS || x.bounds.top < -EPS || x.bounds.right > WIDTH+EPS || x.bounds.bottom > HEIGHT+EPS;
    if (outside) add('文字越界', [x], card ? '章节卷帘门局部 0–2 s，文字随门出画' : cameraMoved(sc) ? '场景有镜头推拉/平移；出画元素保留记录' : '文字超出画布；入场动画/裁切待复核', { ratio: 1-intersection(x.bounds, screen)/area(x.bounds) }, 'WARN', card || cameraMoved(sc));
    for (const [rule, allowed, region] of [
      ['顶部保留区', x.chrome, { left: 0, right: WIDTH, top: 0, bottom: 110 }],
      ['字幕保留区', x.caption, { left: 0, right: WIDTH, top: 890, bottom: HEIGHT }],
    ]) {
      const overlap = intersection(x.bounds, region);
      if (!allowed && overlap > EPS) add(rule, [x], card ? '章节卷帘门局部 0–2 s，未消除遮挡' : outside && cameraMoved(sc) ? '镜头运动中出画文字进入保留区' : `${rule === '顶部保留区' ? '非 drawChrome 文字进入 y<110' : '非 drawCaption 文字进入 y>890'}；估算字框/裁切待复核`, { ratio: overlap/area(x.bounds) }, 'WARN', card || (outside && cameraMoved(sc)));
    }
    if (!x.caption && x.size < 24-EPS) add('非字幕字号', [x], `ctx.font 声明字号 ${x.size}px < 24px`, { font: x.font }, 'FAIL');
    else if (!x.caption && x.effectiveSize < 24-EPS && intersection(x.bounds, screen) > EPS) add('变换后字号', [x], '声明字号合规，缩放后可见高度折算字号不足 24px；字号口径待复核', { effectiveSize: x.effectiveSize });
    for (const line of out.lines) {
      const part = line.parts.find(([a, b]) => segmentBox(a, b, x.bounds, line.width/2));
      if (!part) continue;
      const cx = (x.bounds.left+x.bounds.right)/2, cy = (x.bounds.top+x.bounds.bottom)/2;
      const onPlate = line.plate && cx >= line.plate.left && cx <= line.plate.right && cy >= line.plate.top && cy <= line.plate.bottom;
      const expected = card || onPlate;
      const reason = card ? '章节卷帘门局部 0–2 s，未消除遮挡' : onPlate ? '文字中心位于该钢板/牌子范围，描边、高光或铆钉与文字框相交；底板归属待复核' : '描边/细长填充条穿过文字估算框；字形、裁切及绘制先后遮挡待复核';
      add('文字压线', [x], reason, { lineKey: `${line.call}:${line.source}`, line: `${line.description}；屏幕线段 ${JSON.stringify(canonical(part))}；${line.source}` }, 'WARN', expected);
    }
  }
  return hits;
}

function selfTest() {
  let count = pilotSelfTest();
  const check = fn => { fn(); count++; };
  check(() => {
    const s = { a: { dur: 4, chapter: 1, caps: [[0, 2, '甲']] }, b: { dur: 5, chapter: 4, caps: [[1, 3, '乙']] } };
    const sample = derive(s, ['b'], { b: { lead: 1.6, card: 4 } });
    assert.equal(sample.duration, 6.6); assert.equal(sample.captions[0].t0, 2.6); assert.equal(sample.captions[0].t1, 4.6);
    const full = derive(s, null, {}); assert.equal(full.scenes.length, 2); assert.equal(full.duration, 9); assert.equal(full.captions[1].t0, 5);
    assert.deepEqual(derive(s, ['b', 'a'], {}).scenes.map(x => x.id), ['a', 'b']);
    assert.ok(derive(s, ['missing'], {}).errors.length); assert.ok(derive(s, ['a', 'a'], {}).errors.length);
  });
  check(() => {
    const s = [{ id: 'a', start: 0, d: 5 }];
    assert.equal(captionRules([{ id: 'a', t0: 0, t1: 1.6, text: '{甲}'.repeat(22) }], s).length, 0);
    const bad = captionRules([{ id: 'a', t0: 0, t1: 2, text: '^甲^'.repeat(23) }, { id: 'a', t0: 1, t1: 2, text: '乙' }, { id: 'a', t0: 4, t1: 6, text: '丙' }], s);
    assert.deepEqual(new Set(bad.map(x => x.rule)), new Set(['字幕字数', '字幕时长', '字幕不重叠', '字幕幕内边界']));
  });
  check(() => {
    assert.equal(fontIssue('700 24px "FCJK","FSup",sans-serif'), null);
    assert.equal(fontIssue('900 24px "FMono","FMonoCJK","DejaVu Sans Mono",monospace'), null);
    assert.equal(fontIssue('24px Arial,FCJK').level, 'FAIL');
    assert.equal(fontIssue('24px FCJK,UnknownWebFont').level, 'WARN');
    const h = new Harness(); h.canvas(10, 10).context.font = '24px Arial'; assert.equal(h.fontIssues[0].offscreen, true);
  });
  check(() => {
    const source = text => ({ compiled: new vm.Script(text) });
    const rt = load([source('var FilmKit={create:o=>o};'), source('const SCRIPT={};'), source(''), source('const o=FilmKit.create({drawChrome(g){g.fillText("⚠ 机制演绎",0,50)},drawCaption(g){g.fillText("字幕",0,950)}});var FILM={render(g){o.drawChrome(g);o.drawCaption(g);g.fillText("普通",0,50)}};')]);
    const g = rt.h.canvas(1920, 1080, true).context; rt.h.collectText = true; g.font = '24px FCJK'; rt.film.render(g);
    assert.deepEqual(g.texts.map(x => [x.chrome, x.caption]), [[true, false], [false, true], [false, false]]);
    const hits = geometryHits({ texts: g.texts, lines: [] }, {}, 3);
    assert.equal(hits.filter(x => x.rule === '顶部保留区').length, 1);
  });
  check(() => {
    const h = new Harness(), g = h.canvas(1920, 1080, true).context; h.collectText = true;
    g.font = '24px FCJK'; g.textBaseline = 'top'; g.fillText('甲', 100, 100);
    g.beginPath(); g.moveTo(0, 112); g.lineTo(200, 112); g.stroke();
    assert.equal(geometryHits({ texts: g.texts, lines: g.lines }, {}, 3).filter(x => x.rule === '文字压线').length, 1);
    assert.equal(segmentBox([0, 0], [1, 1], g.texts[0].bounds), false);
    g.save(); g.clip(); g.restore(); assert.equal(g.clipDepth, 0);
    g.beginPath(); g.moveTo(300, 300); g.lineTo(400, 400); g.stroke();
    assert.equal(g.lines[0].parts[0][0][0], 0); // stroke path snapshots are immutable.
    assert.throws(() => g.ellipse(0, 0, -1, 1, 0, 0, 1));
    assert.throws(() => g.createRadialGradient(0, 0, -1, 0, 0, 2));
  });
  check(() => {
    const h = new Harness(), g = h.canvas(1920, 1080, true).context; h.collectText = true;
    g.font = '23px FCJK'; g.fillText('小字', 300, 300);
    assert.equal(geometryHits({ texts: g.texts, lines: [] }, { card: 4 }, 1).find(x => x.rule === '非字幕字号').level, 'FAIL');
    g.font = '24px FCJK'; g.fillText('重叠', 300, 300); g.fillText('重叠', 300, 300);
    const out = { texts: g.texts, lines: [] };
    assert.ok(geometryHits(out, { card: 4 }, 2).find(x => x.rule === '文字重叠').expected);
    assert.ok(!geometryHits(out, { card: 4 }, 2.001).find(x => x.rule === '文字重叠').expected);
  });
  check(() => {
    const x = new Intervals(), hit = { key: 'same', texts: ['甲'] };
    x.add(0, 0, [hit], 'a'); x.add(1, .25, [hit], 'b'); assert.equal(x.groups.length, 2);
  });
  check(() => {
    const input = { a: { dur: 3, chapter: 1, caps: [[0, 2, '甲']] } }, expected = derive(input, ['a'], { a: { lead: 1.6 } });
    const builder = { chapter() {}, addScene() {} }, rt = { builder, context: {} };
    rt.context.S = (id, o) => builder.addScene({ dur: 4.6, captions: [{ t: 1.6, end: 3.6, text: '甲' }], cues: o.cues.map(([t, type, v]) => ({ t: t+1.6, type, v })) });
    assert.equal(probeLead(rt, expected).length, 0);
    rt.context.register = {}; // A non-function register must still fall back to S.
    assert.equal(probeLead(rt, expected).length, 0);
    rt.context.S = (id, o) => builder.addScene({ dur: 4.6, captions: [{ t: 1.6, end: 3.6, text: '甲' }], cues: o.cues.map(([t, type, v]) => ({ t, type, v })) });
    assert.equal(probeLead(rt, expected).length, 1);
  });
  check(() => {
    const input = { a: { dur: 3, chapter: 1, caps: [[0, 2, '甲']] } }, expected = derive(input, ['a'], { a: { lead: 1.6, card: 4 } });
    const builder = { chapter() {}, addScene() {} }, original = { ...builder };
    const rt = { builder, context: { S() { assert.fail('register 存在时不应调用 S'); } } };
    const extras = [{ t: 0, type: 'shutter', v: 1 }, { t: 1.42, type: 'whoosh', v: .5 }];
    let cueLead = 1.6, extrasFirst = false, omitTick = false;
    rt.context.register = (id, o) => {
      assert.equal(id, 'a'); assert.equal(typeof o.draw, 'function');
      builder.chapter(1);
      const cues = omitTick ? [] : o.cues.map(([t, type, v]) => ({ t: t+cueLead, type, v }));
      return builder.addScene({ dur: 4.6, captions: [{ t: 1.6, end: 3.6, text: '甲' }], cues: extrasFirst ? [...extras, ...cues] : [...cues, ...extras] });
    };
    assert.equal(probeLead(rt, expected).length, 0);
    extrasFirst = true; // Locate tick by type even if other cues precede it.
    assert.equal(probeLead(rt, expected).length, 0);
    cueLead = 0;
    const issues = probeLead(rt, expected);
    assert.equal(issues.length, 1); assert.match(issues[0].content, /^register\(/);
    cueLead = 1.6; omitTick = true;
    assert.equal(probeLead(rt, expected).length, 1);
    assert.equal(builder.chapter, original.chapter); assert.equal(builder.addScene, original.addScene);
  });
  return count;
}


function main() {
  const statuses = [], findings = [], geometry = new Intervals();
  const add = (rule, detail, level = 'FAIL') => findings.push({ rule, level, ...detail });
  const status = (name, pass, detail) => { statuses.push({ name, pass, detail }); console.log(`[${pass ? '通过' : 'FAIL'}] ${name}：${detail}`); };
  const reportIssues = (name, issues, total) => {
    for (const issue of issues) add(name, issue);
    status(name, !issues.length, `${total} 项核验；通过 ${Math.max(0, total-issues.length)}，失败 ${issues.length}`);
  };
  console.log('把任务队列改成网络线程池 — 自动检查完整报告');
  console.log(`Node ${process.version}；逻辑画布 ${WIDTH}×${HEIGHT}；${STEP} s 网格 + 场景/字幕/cue 边界，含 0 与片尾`);
  console.log('只读源文件；无浏览器、无依赖、无联网。FAIL 决定退出码；预期内告警和待复核告警不计 FAIL。\n');
  status('检查器自检', true, `${selfTest()} 组通过，0 失败；保留试点 8 组，新增样片/全片推算、字幕四规则、字体族、外框钩子、线段、例外边界、跨幕区间`);
  const sourceNames = [...FILES, 'film.html', 'fonts.css', 'render.json'];
  const snapshots = sourceNames.filter(name => fs.existsSync(path.join(__dirname, name))).map(name => {
    const content = fs.readFileSync(path.join(__dirname, name), 'utf8');
    return { name, content, hash: sha(content) };
  });
  const sources = snapshots.filter(s => FILES.includes(s.name)).map(s => ({ ...s, compiled: new vm.Script(s.content, { filename: s.name }) }));
  console.log('\n本次输入 SHA-256：');
  for (const s of snapshots) console.log(`  ${s.name}  ${s.hash}`);
  const loaded = load(sources), { film, script, only, sample } = loaded;
  const expected = derive(script, only, sample);
  const actualAt = t => loaded.builder?.sceneAt?.(t) || film.scenes.find(s => t >= s.start && t < s.start+s.d) || film.scenes.at(-1);
  const sceneAt = t => actualAt(t)?.id || '全局';
  const sourcesInHTML = [...snapshots.find(s => s.name === 'film.html').content.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const orderOK = JSON.stringify(sourcesInHTML) === JSON.stringify(FILES);
  if (!orderOK) add('加载', { scene: '全局', content: JSON.stringify(sourcesInHTML), reason: `film.html 外部脚本顺序应为 ${FILES.join(' → ')}` });
  status('加载', orderOK, '共享 vm context；FILM.render 可调用；film.html 外部脚本顺序' + (orderOK ? '一致' : '不一致'));
  reportIssues('配置推算', expected.errors.map(reason => ({ scene: '全局', content: `ONLY=${JSON.stringify(only)} SAMPLE_OPT=${JSON.stringify(sample)}`, reason })), 1);
  console.log(`模式：${only === null ? '全片' : '样片'}；SCRIPT ${Object.keys(script).length} 幕；ONLY=${JSON.stringify(only)}；SAMPLE_OPT=${JSON.stringify(sample)}`);
  console.log(`独立推算：${expected.scenes.length} 幕 / ${expected.duration} s / ${expected.captions.length} 句；ONLY=null、SAMPLE_OPT={} 时 ${derive(script, null, {}).scenes.length} 幕 / ${derive(script, null, {}).duration} s / ${derive(script, null, {}).captions.length} 句。`);
  for (const s of expected.scenes) console.log(`  ${s.id}：${f3(s.start)}–${f3(s.start+s.d)} s；dur=${s.d}；lead=${s.lead}；chapter=${s.chap}`);
  const durationOK = Number.isFinite(film.duration) && Math.abs(film.duration-expected.duration) < EPS;
  status('时长', durationOK, `FILM ${film.duration} s / 推算 ${expected.duration} s`);
  if (!durationOK) add('时长', { scene: '全局', content: `FILM.duration=${film.duration}`, reason: `目标 ${expected.duration} s` });
  const sceneIssues = [];
  for (let i = 0; i < Math.max(expected.scenes.length, film.scenes.length); i++) {
    const ex = expected.scenes[i], got = film.scenes[i];
    if (!ex || !got || got.id !== ex.id || Math.abs(got.start-round(ex.start)) > EPS || Math.abs(got.d-round(ex.d)) > EPS || got.chap !== ex.chap) sceneIssues.push({ t: got?.start ?? ex?.start, scene: got?.id ?? ex?.id, content: JSON.stringify(got), reason: `第 ${i+1} 幕应为 ${JSON.stringify(ex)}` });
  }
  reportIssues('场景', sceneIssues, Math.max(expected.scenes.length, film.scenes.length));
  const captionIssues = [];
  for (let i = 0; i < Math.max(expected.captions.length, film.captions.length); i++) {
    const ex = expected.captions[i], got = film.captions[i];
    if (!ex || !got || got.text !== ex.text || Math.abs(got.t0-ex.t0) > EPS || Math.abs(got.t1-ex.t1) > EPS) captionIssues.push({ t: got?.t0 ?? ex?.t0, scene: ex?.id ?? sceneAt(got.t0), content: JSON.stringify(got), reason: `第 ${i+1} 句期望 ${JSON.stringify(ex && { t0: ex.t0, t1: ex.t1, text: ex.text })}` });
  }
  reportIssues('字幕逐条一致', captionIssues, Math.max(expected.captions.length, film.captions.length));
  const actualCaps = film.captions.map((c, i) => ({ ...c, id: expected.captions[i]?.id ?? sceneAt(c.t0), scene: film.scenes.find(s => s.id === expected.captions[i]?.id) }));
  const allCaptionIssues = [...captionRules(expected.captions, expected.scenes), ...captionRules(actualCaps, film.scenes)];
  const uniqueCaptionIssues = [...new Map(allCaptionIssues.map(x => [JSON.stringify([x.rule, x.t, x.scene, x.content, x.reason]), x])).values()];
  for (const rule of ['字幕字数', '字幕时长', '字幕不重叠', '字幕幕内边界']) reportIssues(rule, uniqueCaptionIssues.filter(x => x.rule === rule), Math.max(expected.captions.length, film.captions.length));
  console.log('入选字幕清单（保留原文标记）：');
  for (const c of expected.captions) console.log(`  ${c.id} ${f3(c.t0)}–${f3(c.t1)} s | ${Array.from(plain(c.text)).length} 字符 / ${f3(c.t1-c.t0)} s | ${quote(c.text)}`);
  const cueCounts = {}, cueIssues = [];
  for (const cue of film.cues) {
    cueCounts[cue.type] = (cueCounts[cue.type] || 0)+1;
    if (!CUES.has(cue.type)) cueIssues.push({ t: cue.t, scene: sceneAt(cue.t), content: JSON.stringify(cue), reason: 'cue 类型不在本期白名单' });
  }
  reportIssues('cue 类型', cueIssues, film.cues.length); console.log(`  ${JSON.stringify(cueCounts)}`);
  const expectedCues = loaded.registrations.flatMap(o => {
    const sc = expected.scenes.find(s => s.id === o.id);
    if (!sc || !Array.isArray(o.cues)) return [];
    return Array.from(o.cues, c => ({ t: round(sc.start+c.t), type: c.type, v: c.v ?? 1, id: sc.id, local: c.t, d: sc.d }));
  }).sort((a, b) => a.t-b.t);
  const cueTimeIssues = [];
  for (let i = 0; i < Math.max(expectedCues.length, film.cues.length); i++) {
    const ex = expectedCues[i], got = film.cues[i];
    if (!ex || !got || !Number.isFinite(got.t) || !Number.isFinite(got.v) || Math.abs(got.t-ex.t) > EPS || ex.type !== got.type || ex.v !== got.v || ex.local < 0 || ex.local > ex.d+EPS) cueTimeIssues.push({ t: got?.t ?? ex?.t, scene: ex?.id ?? '全局', content: JSON.stringify(got), reason: `cue 时间/音量/所属幕异常；注册后局部时间推算 ${JSON.stringify(ex)}` });
  }
  reportIssues('cue 时间', cueTimeIssues, Math.max(expectedCues.length, film.cues.length));
  reportIssues('lead 偏移', probeLead(load(sources), expected), expected.scenes.length);
  const expectedChapters = expected.scenes.filter((s, i, a) => !i || s.chap !== a[i-1].chap).map(s => ({ n: s.chap, t: s.start }));
  const chapterIssues = [];
  for (let i = 0; i < Math.max(expectedChapters.length, film.chapters.length); i++) {
    const c = film.chapters[i], e = expectedChapters[i], prev = film.chapters[i-1];
    if (!c || !e || !Number.isInteger(c.n) || c.n !== e.n || !Number.isFinite(c.t) || Math.abs(c.t-e.t) > EPS || (prev && (c.n <= prev.n || c.t <= prev.t))) chapterIssues.push({ t: c?.t ?? e?.t, scene: sceneAt(c?.t ?? e?.t), content: JSON.stringify(c), reason: `章节编号和时间须严格递增，允许跳号；推算 ${JSON.stringify(e)}` });
  }
  reportIssues('章节', chapterIssues, expectedChapters.length);
  console.log(`  编号 ${film.chapters.map(x => x.n).join(' → ')}（不要求连续）`);
  const duration = film.duration;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error(`无法扫描时长 ${duration}`);
  const grid = Array.from({ length: Math.floor(duration/STEP)+1 }, (_, i) => i*STEP);
  const boundaries = [0, duration, ...film.scenes.flatMap(s => [s.start, s.start+s.d]), ...film.captions.flatMap(c => [c.t0, c.t1]), ...film.cues.map(c => c.t)];
  const times = [...new Set([...grid, ...boundaries, ...film.scenes.flatMap(s => [s.start+.001, s.start+s.d-.001])].filter(t => t >= 0 && t <= duration).map(t => +t.toFixed(6)))].sort((a, b) => a-b);
  let layoutFrames = 0, visibleTexts = 0, fontWrites = loaded.h.fontWrites;
  const fontSet = new Set(loaded.h.fonts), geometryNotes = new Set();
  const fonts = new Intervals();
  for (const issue of loaded.h.fontIssues) add('字体族', { scene: '加载期', content: `ctx.font=${quote(issue.font)}`, reason: issue.reason, source: issue.source }, issue.level);
  console.log('\n数值健康与几何扫描：');
  for (const [w, h] of [[WIDTH, HEIGHT], [WIDTH*2, HEIGHT*2]]) {
    let runtime = load(sources), canvas = runtime.h.canvas(w, h, true), checked = 0;
    const errors = [];
    for (const [index, t] of times.entries()) {
      try {
        const before = runtime.h.fontWrites;
        const out = runtime.h.frame(runtime.film, canvas, t, { text: w === WIDTH }); checked++;
        fontWrites += runtime.h.fontWrites-before;
        for (const font of runtime.h.fonts) fontSet.add(font);
        for (const note of runtime.h.geometryNotes) geometryNotes.add(note);
        fonts.add(index, t, out.fonts.map(f => ({ ...f, rule: '字体族', content: `ctx.font=${quote(f.font)}${f.offscreen ? ' [离屏]' : ''}`, key: JSON.stringify([w, f.font, f.source, f.offscreen]), expected: false })), sceneAt(t));
        if (w !== WIDTH) continue;
        layoutFrames++; visibleTexts += out.texts.length;
        const sc = runtime.builder.sceneAt(t);
        geometry.add(index, t, geometryHits(out, sc, t-sc.start), sc.id);
      } catch (error) {
        errors.push({ t, scene: sceneAt(t), content: `render(${w}×${h}, ${t})`, reason: error.message });
        runtime = load(sources); canvas = runtime.h.canvas(w, h, true);
      }
    }
    reportIssues(`数值健康 ${w}×${h}`, errors, times.length);
    console.log(`  ${checked}/${times.length} 帧完成；主画布及离屏数值、变换、像素上传、save/restore 均检查。`);
  }
  console.log('\n确定性：');
  let seed = SEED;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0)/4294967296; };
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, i) => Number(((i+random())/SAMPLE_COUNT*duration).toFixed(6)));
  const shuffled = samples.slice();
  for (let i = shuffled.length-1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  console.log(`固定种子 0x${SEED.toString(16)}，${SAMPLE_COUNT} 个分层随机时刻；顺序基线对比倒序、洗牌乱序、每个时刻独立 VM 首帧。`);
  console.log('逐指令比较方法名、参数、属性写入，数字保留 3 位小数；离屏画布按指令内容及实际 ImageData 字节哈希比较。');
  console.log('加载与渲染均禁用 Math.random、无参 Date/new Date、Date.now、performance.now，调用即抛错。');
  console.log(`采样秒数：${samples.join(', ')}`);
  for (const [w, h] of [[WIDTH, HEIGHT], [WIDTH*2, HEIGHT*2]]) {
    const runtime = load(sources), canvas = runtime.h.canvas(w, h, true), baseline = new Map(), errors = [];
    let renders = 0, comparisons = 0, matches = 0;
    const draw = (rt, cv, t, label) => {
      try {
        const out = rt.h.frame(rt.film, cv, t, { trace: true }); renders++;
        for (const issue of out.fonts) add('字体族', { t, scene: sceneAt(t), content: `ctx.font=${quote(issue.font)}`, reason: issue.reason, source: issue.source }, issue.level);
        return out.commands;
      } catch (e) { errors.push({ t, scene: sceneAt(t), content: `${label} render(${w}×${h}, ${t})`, reason: e.message }); return null; }
    };
    for (const t of samples) baseline.set(t, draw(runtime, canvas, t, '顺序'));
    const compare = (t, commands, label) => {
      comparisons++; const expectedCommands = baseline.get(t);
      if (!commands || !expectedCommands) return;
      const first = expectedCommands.findIndex((line, i) => line !== commands[i]);
      if (first < 0 && expectedCommands.length === commands.length) { matches++; return; }
      const at = first < 0 ? expectedCommands.length : first;
      errors.push({ t, scene: sceneAt(t), content: `${label} 指令 #${at}；顺序=${expectedCommands[at] ?? '<结束>'}；实际=${commands[at] ?? '<结束>'}`, reason: `渲染历史改变指令序列（总数 ${expectedCommands.length}/${commands.length}）` });
    };
    for (const t of samples.slice().reverse()) compare(t, draw(runtime, canvas, t, '倒序'), '倒序');
    for (const t of shuffled) compare(t, draw(runtime, canvas, t, '洗牌乱序'), '洗牌乱序');
    for (const t of samples) {
      const single = load(sources), cv = single.h.canvas(w, h, true);
      compare(t, draw(single, cv, t, '独立 VM 首帧'), '独立 VM 首帧');
    }
    for (const error of errors) add(`确定性 ${w}×${h}`, error);
    status(`确定性 ${w}×${h}`, !errors.length && matches === SAMPLE_COUNT*3, `${renders}/${SAMPLE_COUNT*4} 次 render；${matches}/${comparisons} 组逐指令一致；失败/异常 ${errors.length}`);
  }
  const expand = (g, rule = g.rule) => ({ ...g, rule, t: g.start, end: g.end, scene: [...g.scenes].join(','), reason: g.reason + (g.ratio != null ? `；相交/入区/越界比例 ${(g.minRatio*100).toFixed(1)}%–${(g.maxRatio*100).toFixed(1)}%` : '') });
  for (const g of geometry.sorted()) findings.push(expand(g));
  for (const g of fonts.sorted()) findings.push(expand(g, '字体族'));
  for (const note of geometryNotes) add('几何覆盖', { scene: '全局', content: 'Path2D', reason: note }, 'WARN');
  console.log('\n文字与字体核验：');
  console.log(`${layoutFrames}/${times.length} 帧；有效 fillText/strokeText ${visibleTexts} 次；font 写入 ${fontWrites} 次；字体串 ${fontSet.size} 种。`);
  const fontFailures = findings.filter(f => f.rule === '字体族' && f.level === 'FAIL');
  status('字体族', !fontFailures.length, `失败 ${fontFailures.length}；待确认回退字体 ${findings.filter(f => f.rule === '字体族' && f.level === 'WARN').length}；首选族须为 FCJK/FDisp/FSup/FMono/FMonoCJK`);
  for (const rule of ['文字重叠', '文字压线', '文字越界', '顶部保留区', '字幕保留区', '非字幕字号', '变换后字号']) {
    const rows = findings.filter(f => f.rule === rule), fails = rows.filter(f => f.level === 'FAIL'), warns = rows.filter(f => f.level === 'WARN');
    status(rule, layoutFrames === times.length && !fails.length, `FAIL ${fails.length} 区间；告警 ${warns.length} 区间（预期内 ${warns.filter(f => f.expected).length}，待复核 ${warns.filter(f => !f.expected).length}）`);
    if (layoutFrames !== times.length) add(rule, { scene: '全局', content: '几何扫描', reason: `缺少 ${times.length-layoutFrames} 帧的检查结果` });
  }
  const changed = snapshots.filter(s => sha(fs.readFileSync(path.join(__dirname, s.name), 'utf8')) !== s.hash);
  status('输入版本一致性', !changed.length, `${snapshots.length-changed.length}/${snapshots.length} 份输入检查期间未变`);
  for (const s of changed) add('输入版本一致性', { scene: '全局', content: s.name, reason: '检查期间源文件发生变化，请针对当前版本重跑' });
  const failures = findings.filter(f => f.level === 'FAIL');
  const expectedWarnings = findings.filter(f => f.level === 'WARN' && f.expected);
  const warnings = findings.filter(f => f.level === 'WARN' && !f.expected);
  const display = (title, items, prefix) => {
    console.log(`\n${title}（${items.length} 条，全部列出；连续区间合并，无 Top-N 截断）：`);
    if (!items.length) console.log('  无。');
    for (const [i, item] of items.entries()) {
      const time = Number.isFinite(item.t) ? `${f3(item.t)}${Number.isFinite(item.end) && item.end !== item.t ? '–'+f3(item.end) : ''} s` : '加载/全局';
      console.log(`${prefix}${String(i+1).padStart(3, '0')} | ${time} | ${item.scene} | ${item.rule} | ${item.content}`);
      console.log(`  ${item.reason}${item.count ? `；${item.count} 个相邻采样点` : ''}`);
      if (item.bounds) console.log(`  代表帧 ${f3(item.sampleTime ?? item.t)} s 文字框 ${boxLabel(item.bounds)}${item.effectiveSize ? `；折算字号 ${f3(item.effectiveSize)}px` : ''}`);
      if (item.line) console.log(`  绘图调用：${item.line}`);
      if (item.source) console.log(`  来源：${item.source}`);
    }
  };
  display('FAIL', failures, 'F'); display('预期内告警', expectedWarnings, 'E'); display('告警（待复核）', warnings, 'W');
  if (failures.some(f => f.rule.startsWith('确定性') && f.content.includes('set:shadowBlur')) && snapshots.some(s => s.name === 'kit.js' && /shadowBlur\s*=\s*40\s*\*\s*SCX/.test(s.content))) {
    console.log('\n本次确定性失败定位：');
    console.log('kit.js 的 drawBackground 使用 shadowBlur = 40 * SCX；SCX 初值为1，而 film.js 的 beforeScene 才将其更新为 frame.scaleX。引擎先调用 drawBackground，4K 冷首帧得到40，已有历史帧得到80。建议在任何绘制前初始化尺寸状态，或在背景钩子中直接使用当前 frame.scaleX。未修改动画源码。');
  }
  console.log('\n说明：');
  console.log('1. 时长/场景/字幕从 VM 中实际 SCRIPT + ONLY + SAMPLE_OPT 独立推算，按 SCRIPT 顺序过滤 ONLY；不从实际 FILM 反推期望。ONLY=null 选全部 SCRIPT；lead 同时计入 dur、字幕起止。未入选幕不作画面或字幕质量验收。');
  console.log('2. cue 从 addScene 注册数据核验带 lead 的局部时间到全局时间的映射及幕内边界；另在独立 VM 以已知 cue 优先探测 register 注册函数（不是函数时回退 S），逐幕验证 lead 同时平移 dur、字幕和 cue；register 按 type 查找 tick，忽略额外的 shutter/whoosh。此探测只替换私有 VM 的接收器，不修改源码或已渲染的时间线。');
  console.log('3. 字符按 Unicode 码点计数，只去掉 {} [] ^ 标记，保留空格标点；句长≥1.6 s，幕内不重叠；允许相邻句端点相接。标题幕即使隐藏字幕，也核对导出的完整字幕清单。');
  console.log('4. 文字宽度为 ASCII 0.6em、其他字符 1em，加 letterSpacing；高度 1.2em，按 textAlign/textBaseline 和仿射变换取屏幕 AABB。真实字体未加载；旋转空白角落、字形留白和字距会造成误报。');
  console.log('5. 保留试点 globalAlpha≥0.15/非空文本过滤，同名不同绘制照查；文字相交≥15% 才报告。描边用折线段与文字框相交，弧/曲线采样，圆角框保守按矩形，arcTo 保守折线；细长 fillRect（短边≤6px、长边≥12px）也按线条检查。');
  console.log('6. 不执行 clip/遮罩、后绘不透明遮挡/擦除/合成/滤镜，不模拟字形墨迹、抗锯齿与阴影。几何候选均保留为告警，避免把拿不准的交叠硬判 FAIL；明确字号/字体族/数据/确定性/数值违规仍 FAIL。');
  console.log('7. scene.card 存在且局部时间 0–2 s 的卷帘遮挡、镜头出画、plate/rivet 描边与文字交叉归预期内告警；线条归属仍可能是别的底板，已明示待复核。同次 emboss 阴影与正文重叠也单列为预期内告警，未删除绘制调用。');
  console.log('8. 顶部仅 drawChrome 调用期间的文字有豁免，含“⚠ 机制演绎”“时间已放慢”；底部仅 drawCaption 有豁免。任意文字框面积进入屏幕内 y<110 或 y>890 即记录，无15%门槛。');
  console.log('9. 非字幕字号按 ctx.font 声明≥24px 判定；变换后折算不足24px 另列告警。字体首选族必须在五族白名单；后续已知系统字体允许，未知回退名称只告警，不凭名称硬判违规。所有执行到的 font 写入含离屏均检查；未执行分支不作静态证明。');
  console.log('10. 几何以同场景/规则/文字内容对/原因/线条调用栈聚合连续采样点；同一调用点的多条线及同文多个位置可能合并，仍保存代表调用/框。中间无命中即分段，时间区间仅表明采样命中，不推断连续可见。');
  console.log('11. 扫描补充场景、字幕、cue 边界；仍可能漏掉采样间瞬时问题。确定性是固定种子两种尺寸抽检并比较三位小数指令，不是数学纯函数/像素一致性证明。未交替切换尺寸或插入 drawCover。');
  console.log('12. 离屏缓存按构建指令与像素字节内容哈希，无对象分配 id；复杂覆盖与重复离屏绘制可能保守报差异。离屏文字数值/字体检查已覆盖，图片内部文字几何没有映射回主画布。未知 Canvas 方法会报异常，不静默跳过。');
  const failedStatuses = statuses.filter(x => !x.pass);
  console.log(`\n总结果：[${failedStatuses.length || failures.length ? 'FAIL' : '通过'}] ${statuses.length-failedStatuses.length}/${statuses.length} 项通过，${failedStatuses.length} 项失败；FAIL 明细 ${failures.length} 条；预期内告警 ${expectedWarnings.length} 条；待复核告警 ${warnings.length} 条。退出码 ${failedStatuses.length || failures.length ? 1 : 0}。`);
  process.exitCode = failedStatuses.length || failures.length ? 1 : 0;
}
if (require.main === module) {
  try { main(); }
  catch (error) { console.log(`\n[FAIL] 检查器/加载中止：${error.stack}`); process.exitCode = 1; }
}
module.exports = { Harness, load, AuditPath, overlapHits, Intervals, selfTest, derive, captionRules, fontIssue, geometryHits, segmentBox, probeLead };
