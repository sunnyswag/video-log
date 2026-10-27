#!/usr/bin/env node
'use strict';
// Audit only: no browser, dependencies, source rewriting, or implicit file writes.
// Run: node checks.cjs > checks.report.txt ; a finding gives exit status 1.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const STEP = 0.25, WIDTH = 1920, HEIGHT = 1080, ALPHA = 0.15, OVERLAP = 0.15;
const BODY_SIZE = 23.5, TOP_RESERVED = 110;
const SEED = 0x53495032, SAMPLE_COUNT = 120;
const FILES = ['../../tools/film-kit/engine.js', 'script.js', 'kit.js', 'film.js'];
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = () => [1, 0, 0, 1, 0, 0];
const quote = s => JSON.stringify(s);
const f3 = n => n.toFixed(3);

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
    // 局部纵轴 (0,1) 经矩阵后的长度；旋转不缩小字号，镜头缩放计入。
    this.texts.push({ text: String(s), bounds, size: size*Math.hypot(c, d),
      caption: this.harness.captionDepth > 0, transition: this.harness.transitionDepth > 0,
      chrome: this.harness.chromeDepth > 0, scene: this.harness.sceneDepth > 0, alpha: this.globalAlpha });
  }
  strokeText(s, x, y, maxWidth) { numbers([x, y], 2, 'strokeText'); this.record('strokeText', maxWidth == null ? [s, x, y] : [s, x, y, maxWidth]); }
}
for (const key of Object.keys(defaults())) {
  Object.defineProperty(AuditContext.prototype, key, {
    get() { return this.state[key]; },
    set(value) {
      finite(value, key);
      if (typeof defaults()[key] === 'number') numbers([value], 1, key);
      if (key === 'globalAlpha' && (value < 0 || value > 1)) throw new Error(`globalAlpha 越界 ${value}`);
      this.state[key] = value; this.record(`set:${key}`, [value]);
    },
  });
}
for (const [name, count] of Object.entries({ ...pathMethods, beginPath: 0, fill: 0, stroke: 0, clip: 0, fillRect: 4, clearRect: 4, strokeRect: 4 })) {
  AuditContext.prototype[name] = function (...args) { validatePath(name, args, count); this.record(name, args); };
}

class Harness {
  constructor() {
    this.contexts = []; this.collectText = false;
    this.captionDepth = 0; this.transitionDepth = 0; this.chromeDepth = 0; this.sceneDepth = 0;
  }
  canvas(w, h, main = false) { return new AuditCanvas(this, w, h, main); }
  balanced() {
    for (const c of this.contexts) if (c.stack.length) throw new Error(`${c.canvas.main ? '主' : '离屏'}画布 save/restore 泄漏 ${c.stack.length}`);
  }
  frame(film, canvas, t, { trace = false, text = false } = {}) {
    this.balanced(); this.collectText = text;
    const c = canvas.context; c.capture = trace; c.trace = []; c.texts = [];
    film.render(canvas, t); this.balanced();
    return { commands: c.trace, texts: c.texts };
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
  // 按实际钩子/scene.draw 的调用范围标记归属，不猜文字、字体或坐标，不改源码。
  const tagged = (draw, depth) => function (...args) {
    h[depth]++; try { return draw.apply(this, args); } finally { h[depth]--; }
  };
  const create = context.FilmKit.create;
  context.FilmKit.create = function (options) {
    const opts = { ...options };
    for (const [hook, depth] of [['drawCaption', 'captionDepth'], ['drawTransition', 'transitionDepth'], ['drawChrome', 'chromeDepth']]) {
      if (opts[hook]) opts[hook] = tagged(opts[hook], depth);
    }
    const film = create.call(this, opts), addScene = film.addScene;
    if (addScene) {
      film.addScene = function (scene) {
        return addScene.call(this, { ...scene, draw: typeof scene.draw === 'function' ? tagged(scene.draw, 'sceneDepth') : scene.draw });
      };
    }
    return film;
  };
  for (const source of sources.slice(1)) source.compiled.runInContext(context, { timeout: 10000 });
  if (!context.FILM || typeof context.FILM.render !== 'function') throw new Error('没有导出 FILM.render');
  return { h, film: context.FILM, script: vm.runInContext('SCRIPT', context), context };
}

function intersection(a, b) {
  return Math.max(0, Math.min(a.right, b.right)-Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom)-Math.max(a.top, b.top));
}
const area = b => (b.right-b.left)*(b.bottom-b.top);
const bodyText = x => !x.caption && !x.transition && (x.scene || x.chrome);
const smallTextHits = texts => texts.filter(x => bodyText(x) && x.size < BODY_SIZE).map(x => ({
  key: JSON.stringify([x.text]), texts: [x.text], bounds: x.bounds, ratio: BODY_SIZE-x.size,
}));
const topTextHits = texts => texts.filter(x => bodyText(x) && x.scene && !x.chrome && x.bounds.top < TOP_RESERVED).map(x => ({
  key: JSON.stringify([x.text]), texts: [x.text], bounds: x.bounds, ratio: TOP_RESERVED-x.bounds.top,
}));
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
      if (!old || (hit.ratio ?? 0) > (old.ratio ?? 0)) unique.set(hit.key, hit);
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
    const h = new Harness(), g = h.canvas(WIDTH, HEIGHT, true).context;
    h.collectText = true; h.sceneDepth = 1; g.font = '23.5px sans-serif'; g.textBaseline = 'top';
    g.fillText('阈值', 0, TOP_RESERVED);
    assert.equal(smallTextHits(g.texts).length, 0); assert.equal(topTextHits(g.texts).length, 0);
    g.scale(.5, .5); g.fillText('缩小', 0, TOP_RESERVED);
    assert.equal(smallTextHits(g.texts)[0].texts[0], '缩小'); assert.equal(topTextHits(g.texts).length, 1);
    g.resetTransform(); g.rotate(Math.PI/2); g.scale(2, 2); g.fillText('推近', 0, TOP_RESERVED);
    assert.equal(g.texts.at(-1).size, 47); assert.equal(smallTextHits(g.texts).length, 1);
  });
  check(() => {
    const source = text => ({ compiled: new vm.Script(text) });
    const tracked = load([
      source('var FilmKit = { create: o => ({ ...o, addScene(s) { this.scene = s; } }) };'),
      source('const SCRIPT = {};'), source(''),
      source(`const draw = g => g.fillText('同文', 0, 0);
        const opt = FilmKit.create({ drawCaption: draw, drawChrome: draw, drawTransition: draw });
        opt.addScene({ draw });
        var FILM = { render(g) { opt.scene.draw(g); opt.drawChrome(g); opt.drawTransition(g); opt.drawCaption(g); } };`),
    ]);
    tracked.h.collectText = true;
    const g = tracked.h.canvas(WIDTH, HEIGHT, true).context;
    tracked.film.render(g);
    assert.deepEqual(g.texts.map(x => [x.scene, x.chrome, x.transition, x.caption]),
      [[true, false, false, false], [false, true, false, false], [false, false, true, false], [false, false, false, true]]);
    assert.equal(smallTextHits(g.texts).length, 2); assert.equal(topTextHits(g.texts).length, 1);
    assert.deepEqual([tracked.h.sceneDepth, tracked.h.chromeDepth, tracked.h.transitionDepth, tracked.h.captionDepth], [0, 0, 0, 0]);
  });
  return count;
}

function main() {
  const statuses = [];
  const status = (name, pass, detail) => { statuses.push({ name, pass }); console.log(`[${pass ? '通过' : '失败'}] ${name}：${detail}`); };
  console.log('Kotlin 实现 SIP 通信协议 — 自动检查完整报告');
  console.log(`Node ${process.version}；逻辑画布 ${WIDTH}×${HEIGHT}；采样间隔 ${STEP} s（包含 0 和片尾）`);
  console.log('检查只读取源文件。FAIL 表示命中规则，几何告警仍需真实浏览器复核。\n');
  status('检查器自检', true, `${selfTest()} 组：仿射变换/测宽/状态恢复、透明度/同名绘制、非有限数/栈、离屏内容、连续区间、基线/阈值、VM加载/时钟禁用/字幕归属、3位小数/历史状态/离屏变化捕获、字号/顶部阈值/镜头缩放、四种绘制归属`);
  const sources = FILES.map(name => {
    const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
    return { name, hash: sha(text), compiled: new vm.Script(text, { filename: name }) };
  });
  console.log('\n本次输入 SHA-256（方便设计方定位版本）：');
  for (const s of sources) console.log(`  ${s.name}  ${s.hash}`);
  const loaded = load(sources), { film, script } = loaded;
  status('加载', true, 'engine.js → script.js → kit.js → film.js，共享一个 vm context；FILM.render 可调用');
  const ids = Object.keys(script), expectedDuration = Object.values(script).reduce((sum, sc) => sum+sc.dur, 0);
  status('时长', Math.abs(film.duration-expectedDuration) < .01, `期望 SCRIPT ${expectedDuration} s，实际 FILM ${film.duration} s；误差 ${Math.abs(film.duration-expectedDuration)}`);
  status('场景', film.scenes.length === ids.length, `期望 SCRIPT ${ids.length}，实际 FILM ${film.scenes.length}`);
  const sceneMismatches = [];
  for (let i = 0; i < Math.max(ids.length, film.scenes.length); i++) {
    const sc = film.scenes[i], expectedScene = script[ids[i]];
    if (!sc || !expectedScene || sc.id !== ids[i] || sc.chap !== expectedScene.chapter) sceneMismatches.push(i);
  }
  status('场景顺序与章号', !sceneMismatches.length, `按 SCRIPT 键顺序逐幕核对 id/chapter；差异 ${sceneMismatches.length}`);
  for (const i of sceneMismatches) console.log(`  #${i+1}: SCRIPT=${quote(ids[i])}/${script[ids[i]]?.chapter}，FILM=${quote(film.scenes[i]?.id)}/${film.scenes[i]?.chap}`);
  const expected = Object.values(script).flatMap(sc => sc.caps.map(c => c[2]));
  const mismatches = [];
  for (let i = 0; i < Math.max(expected.length, film.captions.length); i++) if (expected[i] !== film.captions[i]?.text) mismatches.push(i);
  status('字幕', expected.length === film.captions.length && !mismatches.length, `期望 SCRIPT ${expected.length}，实际 FILM ${film.captions.length}；逐条原文差异 ${mismatches.length}`);
  for (const i of mismatches) console.log(`  #${i+1}: SCRIPT=${quote(expected[i])}，FILM=${quote(film.captions[i]?.text)}`);
  const allowed = new Set(['send', 'latch', 'success', 'error', 'whoosh', 'tick', 'ring']);
  const badCues = film.cues.filter(c => !allowed.has(c.type)), cueCounts = {};
  for (const cue of film.cues) cueCounts[cue.type] = (cueCounts[cue.type] || 0)+1;
  status('cue 类型', !badCues.length, `共 ${film.cues.length}；非法 ${badCues.length}；${JSON.stringify(cueCounts)}`);
  for (const cue of badCues) console.log(`  ${JSON.stringify(cue)}`);
  const chapterOK = film.chapters.length === 10 && film.chapters.every((c, i) => c.n === i && Number.isFinite(c.t) && (i === 0 ? c.t === 0 : c.t > film.chapters[i-1].t));
  const sceneChapterOK = film.scenes.every((sc, i) => Number.isInteger(sc.chap) && sc.chap >= 0 && sc.chap <= 9 && (!i || sc.chap >= film.scenes[i-1].chap));
  status('章节', chapterOK && sceneChapterOK, `${film.chapters.length} 章；编号 ${film.chapters.map(c => c.n).join(' → ')}；章节时间严格递增/场景章号不递减=${chapterOK && sceneChapterOK}`);
  console.log('  v3 章号协议：0 开场、1 片名、2–7 六个主章节、8 总结、9 系列片尾；仅核对编号与顺序，不推断文案语义。');
  const sceneAt = t => film.scenes.find(s => t >= s.start && t < s.start+s.d)?.id || film.scenes.at(-1).id;
  const duration = film.duration;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error(`无法扫描时长 ${duration}`);
  const times = Array.from({ length: Math.floor(duration/STEP)+1 }, (_, i) => i*STEP);
  if (times.at(-1) < duration) times.push(duration);
  const overlap = new Intervals(), outside = new Intervals(), subtitle = new Intervals();
  const smallText = new Intervals(), topText = new Intervals();
  let layoutFrames = 0, visibleTexts = 0;
  console.log('\n数值健康与几何扫描：');
  for (const [w, h] of [[WIDTH, HEIGHT], [WIDTH*2, HEIGHT*2]]) {
    let runtime = load(sources), canvas = runtime.h.canvas(w, h, true), errors = [], checked = 0;
    for (const [index, t] of times.entries()) {
      try {
        const out = runtime.h.frame(runtime.film, canvas, t, { text: w === WIDTH }); checked++;
        if (w !== WIDTH) continue;
        layoutFrames++; visibleTexts += out.texts.length;
        smallText.add(index, t, smallTextHits(out.texts), sceneAt(t));
        topText.add(index, t, topTextHits(out.texts), sceneAt(t));
        overlap.add(index, t, overlapHits(out.texts), sceneAt(t));
        outside.add(index, t, out.texts.filter(x => x.bounds.left < 0 || x.bounds.top < 0 || x.bounds.right > WIDTH || x.bounds.bottom > HEIGHT).map(x => ({
          key: JSON.stringify([x.text, x.caption]), texts: [x.text], bounds: x.bounds, caption: x.caption,
          ratio: 1-intersection(x.bounds, { left: 0, top: 0, right: WIDTH, bottom: HEIGHT })/area(x.bounds),
        })), sceneAt(t));
        subtitle.add(index, t, out.texts.filter(x => !x.caption && intersection(x.bounds, { left: 0, right: WIDTH, top: 890, bottom: HEIGHT }) > 0).map(x => ({
          key: JSON.stringify([x.text]), texts: [x.text], bounds: x.bounds,
          ratio: intersection(x.bounds, { left: 0, right: WIDTH, top: 890, bottom: HEIGHT })/area(x.bounds),
        })), sceneAt(t));
      } catch (error) {
        errors.push({ t, scene: sceneAt(t), message: error.message });
        // Resume with a clean VM so one bad frame cannot contaminate the remaining scan.
        runtime = load(sources); canvas = runtime.h.canvas(w, h, true);
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
  console.log(`采样秒数：${samples.join(', ')}`);
  for (const [w, h] of [[WIDTH, HEIGHT], [WIDTH*2, HEIGHT*2]]) {
    const runtime = load(sources), canvas = runtime.h.canvas(w, h, true), baseline = new Map(), errors = [];
    let renders = 0, comparisons = 0, matches = 0;
    const draw = (rt, cv, t, label) => {
      try { const commands = rt.h.frame(rt.film, cv, t, { trace: true }).commands; renders++; return commands; }
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
      const single = load(sources), cv = single.h.canvas(w, h, true);
      compare(t, draw(single, cv, t, '独立 VM 首帧'), '独立 VM 首帧');
    }
    status(`确定性 ${w}×${h}`, !errors.length && matches === SAMPLE_COUNT*2, `${renders}/${SAMPLE_COUNT*3} 次 render；${matches}/${comparisons} 组逐指令完全一致；差异/异常 ${errors.length}`);
    for (const error of errors) console.log(`  ${error}`);
  }

  console.log('\n文字几何规则：');
  console.log(`1920×1080；成功扫描 ${layoutFrames}/${times.length} 帧；有效 fillText ${visibleTexts} 次；globalAlpha < ${ALPHA} 或空白文本忽略。`);
  console.log('宽度：ASCII 0.6×字号，CJK/其他非 ASCII 1.0×字号，加 (字符数−1)×letterSpacing；高度 1.2×字号。');
  console.log('按 textAlign/textBaseline 放置，将四角经当前仿射矩阵变换后取屏幕 AABB；alphabetic 为基线−1em 至+0.2em。');
  console.log('相交比例 = 交集面积 / 较小框面积；比例 ≥15% 才报告。只排除同一次调用自身，同名但不同调用照查。');
  console.log('按无序文字对/相邻采样点聚合；中间一个采样点消失即分段。跨度=末次−首次命中，单点跨度为0，不推断两次采样之间持续可见。');
  console.log('同一帧同一内容对只计一个区间采样点；“命中次数”保留全部调用对。按跨度降序、开始时间升序排序。');
  status('文字重叠', layoutFrames === times.length && !overlap.hits, `${overlap.hits} 对次，${overlap.frames} 帧，${overlap.groups.length} 个连续区间；以下前 ${Math.min(40, overlap.groups.length)} 条`);
  for (const [i, g] of overlap.sorted().slice(0, 40).entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])} ↔ ${quote(g.texts[1])} | 相交 ${(g.minRatio*100).toFixed(1)}%–${(g.maxRatio*100).toFixed(1)}%`);
  if (!overlap.groups.length) console.log('  无。');

  console.log('\n超出画面边界的文字（全部区间）：');
  status('文字越界', layoutFrames === times.length && !outside.hits, `${outside.hits} 次，${outside.frames} 帧，${outside.groups.length} 个区间；边界 [0,1920]×[0,1080]，不套用15%阈值`);
  for (const [i, g] of outside.sorted().entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])}${g.caption ? ' [字幕]' : ''} | 越界 ${(g.minRatio*100).toFixed(1)}%–${(g.maxRatio*100).toFixed(1)}% | ${f3(g.sampleTime)} s 框 ${boxLabel(g.bounds)}`);
  if (!outside.groups.length) console.log('  无。');

  console.log('\n外框/字幕区冲突（全部区间）：');
  status('字幕区', layoutFrames === times.length && !subtitle.hits, `${subtitle.hits} 次，${subtitle.frames} 帧，${subtitle.groups.length} 个区间；屏幕内 y > 890，非字幕文字任意面积进入即报告`);
  console.log('字幕身份由 FilmKit.create 的 drawCaption 钩子调用期间标记；按保留区检查，即使当时字幕隐藏/切换也报告。');
  for (const [i, g] of subtitle.sorted().entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])} | 入区 ${(g.minRatio*100).toFixed(1)}%–${(g.maxRatio*100).toFixed(1)}% | ${f3(g.sampleTime)} s 框 ${boxLabel(g.bounds)}`);
  if (!subtitle.groups.length) console.log('  无。');

  console.log('\n正文字号（全部区间）：');
  status('正文字号', layoutFrames === times.length && !smallText.hits, `${smallText.hits} 次，${smallText.frames} 帧，${smallText.groups.length} 个区间；scene.draw/drawChrome 实际字号 < ${BODY_SIZE} px`);
  console.log('排除 drawCaption/drawTransition；实际字号 = font 字号 × 当前矩阵纵轴长度（1080p 逻辑像素）。镜头推近可放大，缩小 z<1 导致字号不足也报告，属于预期。');
  for (const [i, g] of smallText.sorted().entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])} | 实际字号 ${f3(BODY_SIZE-g.maxRatio)}–${f3(BODY_SIZE-g.minRatio)} px | ${f3(g.sampleTime)} s 框 ${boxLabel(g.bounds)}`);
  if (!smallText.groups.length) console.log('  无。');

  console.log('\n顶部保留区（全部区间）：');
  status('顶部保留区', layoutFrames === times.length && !topText.hits, `${topText.hits} 次，${topText.frames} 帧，${topText.groups.length} 个区间；scene.draw 文字屏幕框上沿 y < ${TOP_RESERVED}`);
  console.log('排除 drawChrome/drawTransition/drawCaption；两条新规则均按文字内容与连续采样点聚合，列出全部区间。');
  for (const [i, g] of topText.sorted().entries()) console.log(`${i+1}. ${intervalLabel(g)}\n   ${quote(g.texts[0])} | 上沿 y ${f3(TOP_RESERVED-g.maxRatio)}–${f3(TOP_RESERVED-g.minRatio)} | ${f3(g.sampleTime)} s 框 ${boxLabel(g.bounds)}`);
  if (!topText.groups.length) console.log('  无。');

  const changed = sources.filter(s => sha(fs.readFileSync(path.join(__dirname, s.name), 'utf8')) !== s.hash);
  status('输入版本一致性', !changed.length, `${sources.length-changed.length}/${sources.length} 份输入在检查期间未变；本报告使用开头哈希标识的源码快照`);
  for (const s of changed) console.log(`  检查期间 ${s.name} 已变化，请针对当前源码重跑。`);

  console.log('\n误报风险与覆盖限制：');
  console.log('1. 字号估宽没有读取 fonts.css 的真实字形度量、字距调整和字形墨迹；font weight/回退字体/中英标点会改变实际宽高，也会改变字幕换行。');
  console.log('2. 旋转后的文字使用轴对齐外接框，空白角落也算面积；1.2em 高度和基线位置是估算，邻近文字可能被多算或漏算。');
  console.log('3. clip/Path2D/遮罩仅记录指令，未执行像素裁切；后绘不透明底板、遮挡、擦除、合成模式和滤镜未做可见性消除。转场/屏幕裁切/故意交叉淡化会产生告警。');
  console.log('4. 仅按 globalAlpha 过滤，fillStyle 的 rgba 透明度不相乘；阴影、描边、图片中的字和字形缺失不纳入文字框。');
  console.log('5. 字幕富文本按每次 fillText 分段；逐字动画可能只显示单个字。相同文字的多个位置会按内容合并到同一连续区间。');
  console.log('6. y>890 是预留区规则，不要求与某条正在显示的字幕真正相交；边界检查也会报告有意从画外进入/退出的字。');
  console.log('7. 0.25s 网格可能漏掉更短的瞬时冲突；确定性是两种尺寸各120个时间点的抽检、3位小数指令一致性，不是数学纯函数证明或像素一致性证明。');
  console.log('8. 不同尺寸分别验证，未交替切换尺寸/穿插 drawCover；离屏哈希按构建指令保守判断，不模拟复杂像素覆盖，冗余的重复离屏绘制可能触发差异。');
  console.log('9. 此假画布对未知方法不提供静默 no-op；当前脚本用到的 API 已实现。Canvas 的浏览器容错、抗锯齿、裁切等语义仍需沙箱外关键帧验收。');
  console.log('10. 正文字号只查主画布 scene.draw/drawChrome 的 fillText，以矩阵纵轴长度衡量字号，不测实际字形可读性；maxWidth 横向压缩不改变字号。镜头缩小和入场缩放可能触发。');
  console.log('11. 顶部 y<110 是保留区规则，不要求与外框实际相交；估算 AABB、旋转、裁切和画外入场可产生误报。两条新规则不追踪离屏图像中的文字。');
  const failures = statuses.filter(s => !s.pass);
  console.log(`\n总结果：[${failures.length ? '失败' : '通过'}] ${statuses.length-failures.length}/${statuses.length} 项通过，${failures.length} 项失败${failures.length ? '（'+failures.map(s => s.name).join('、')+'）' : ''}。退出码 ${failures.length ? 1 : 0}。`);
  process.exitCode = failures.length ? 1 : 0;
}
if (require.main === module) {
  try { main(); }
  catch (error) { console.log(`\n[失败] 检查器/加载中止：${error.stack}`); process.exitCode = 1; }
}
module.exports = { Harness, load, AuditPath, overlapHits, Intervals, selfTest };
