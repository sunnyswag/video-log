/* node --test tools/film-kit/engine.test.cjs；浏览器像素验收见移植版 compare.mjs。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('./engine.js');
const draw = () => {};
// 只替代测宽与状态栈，用来验证时间/排版/钩子契约；不冒充像素验收。
function canvas(width = 1920, height = 1080) {
  let state, stack = [];
  const calls = [], initial = () => ({ globalAlpha: 1, font: '10px sans-serif', fillStyle: '#000' });
  const methods = {
    reset() { state = initial(); stack = []; calls.length = 0; },
    save() { stack.push({ ...state }); }, restore() { assert.ok(stack.length); state = stack.pop(); },
    setTransform(...v) { calls.push(['transform', ...v]); },
    measureText(s) { return { width: Array.from(s).length * 10 }; },
    fillText(...v) { calls.push(['text', ...v, { ...state }]); },
    fillRect(...v) { calls.push(['rect', ...v, { ...state }]); },
  };
  state = initial();
  const g = new Proxy(methods, { get: (o, k) => k in o ? o[k] : state[k], set: (o, k, v) => (state[k] = v, true) });
  return { width, height, getContext: () => g, calls, depth: () => stack.length };
}

test('自动字幕排期、显式字幕、章节元数据和导出格式', () => {
  const f = K.create({ fontsNeeded: ['700 32px sans-serif'] });
  f.chapter(1, '第一章', 'ONE', '说明');
  const a = f.addScene({ id: 'a', chapter: 1, caps: [['{你好}', 2], ['世界', 3]], cues: sc => [{ t: sc.cs[1], type: 'hit' }], draw });
  assert.equal(a.d, 6.25); assert.deepEqual(a.cs, [.55, 2.55]); assert.deepEqual(a.ce, [2.4, 5.95]);
  f.addScene({ id: 'b', captions: [{ t: 1, text: '^定时^', dur: 2 }], draw });
  const api = f.finish();
  assert.equal(api.duration, 9.95); assert.deepEqual(api.scenes[0], { id: 'a', chap: 1, start: 0, d: 6.25 });
  assert.deepEqual(api.captions[0], { t0: .55, t1: 2.4, text: '{你好}', plain: '你好' });
  assert.deepEqual(api.captions[2], { t0: 7.25, t1: 9.25, text: '^定时^', plain: '定时' });
  assert.deepEqual(api.chapters, [{ t: 0, n: 1 }]); assert.equal(api.chapterInfo[0].zh, '第一章');
  assert.deepEqual(api.cues, [{ t: 2.55, type: 'hit', v: 1 }]); assert.equal(globalThis.FILM, api);
  assert.equal(f.finish(), api); assert.throws(() => f.addScene({ id: 'c', dur: 1, draw }), /finish/);
});

test('旧片事件元组、场景边界、效果不依赖查询顺序', () => {
  const f = K.create();
  f.addScene({ id: 'a', dur: 2, draw, sfx: () => [[1, 'blip']], fx: () => [[.5, 'custom', 7, 1]] });
  f.addScene({ id: 'b', dur: 2, draw, cues: [{ t: 0, type: 'end', v: .5 }] });
  assert.equal(f.sceneAt(1.999).id, 'a'); assert.equal(f.sceneAt(2).id, 'b'); assert.equal(f.sceneAt(4).id, 'b');
  const first = f.effectsAt(1, 'custom'); f.effectsAt(3);
  assert.deepEqual(f.effectsAt(1, 'custom'), first); assert.equal(first[0].remaining, .5);
  assert.equal(f.effectsAt(.1).length, 0); assert.equal(f.effectsAt(1, 'missing').length, 0);
  assert.equal(f.finish().cues[0].v, 1);
});

test('拒绝无效时间线；失败不追加半个场景', () => {
  const f = K.create();
  assert.throws(() => f.finish(), /至少/);
  for (const dur of [0, -1, Infinity, NaN]) assert.throws(() => f.addScene({ id: 'bad', dur, draw }));
  assert.throws(() => f.addScene({ id: 'bad', dur: 2, captions: [{ t: 1, text: 'x', end: .5 }], draw }));
  assert.throws(() => f.addScene({ id: 'bad', dur: 2, cues: [{ t: NaN, type: 'x' }], draw }));
  assert.equal(f.duration, 0);
  f.addScene({ id: 'ok', dur: 2, draw });
  assert.throws(() => f.addScene({ id: 'ok', dur: 2, draw }), /唯一/);
});

test('富文本映射、颜色相同的标记、Unicode 分割', () => {
  const segs = K.parseRich('a{😀中}[警]^金^z', { emphasis: '#111', danger: '#111', accent: '#111' });
  assert.deepEqual(segs.map(x => x.s), ['a','😀中','警','金','z']);
  const [a, b] = K.splitRich(segs, 2);
  assert.equal(a.map(x => x.s).join(''), 'a😀'); assert.equal(b.map(x => x.s).join(''), '中警金z');
  assert.equal(K.typed('😀中', .5), '😀'); assert.equal(K.plain('a{b}[c]^d^'), 'abcd');
});

test('默认换行覆盖多行和显式换行，旧片平衡双行可选', () => {
  const g = canvas().getContext('2d'), f = K.create({ captions: { maxWidth: 30 } });
  const lines = f.capLines(g, '{甲乙丙丁戊己庚辛}\n九十');
  assert.deepEqual(lines.map(l => l.map(x => x.s).join('')), ['甲乙丙','丁戊己','庚辛','九十']);
  const old = K.create({ captions: { maxWidth: 40, wrap: 'balanced' } });
  assert.deepEqual(old.capLines(g, '甲乙，丙丁戊己').map(l => l.map(x => x.s).join('')), ['甲乙，','丙丁戊己']);
});

test('字幕淡入、退场和逐字揭示由引擎计算', () => {
  const f = K.create(), g = canvas().getContext('2d'), c = { t0: 1, t1: 3, text: '测试字幕' };
  assert.equal(f.captionLayout(g, c, .9), null);
  const early = f.captionLayout(g, c, 1.1), full = f.captionLayout(g, c, 2);
  assert.ok(early.alpha > 0 && early.alpha < 1); assert.ok(early.dy > 0); assert.ok(early.wipe < 1);
  assert.equal(full.alpha, 1); assert.equal(full.dy, 0); assert.equal(full.lines[0].visible[0].s, c.text);
  assert.equal(f.captionLayout(g, c, 3.3), null);
});

test('分词扩展、字符串中的注释符，以及实例间颜色隔离', () => {
  const f = K.create({ theme: { pink: '#123', blue: '#456' }, code: { keywords: ['await'], types: ['Widget'] } });
  const tokens = f.tokenize('await Widget("https://a/*b"); // 注释');
  assert.equal(tokens.find(t => t.s === 'await').c, '#123'); assert.equal(tokens.find(t => t.s === 'Widget').c, '#456');
  assert.equal(tokens.find(t => t.s.startsWith('"')).s, '"https://a/*b"');
  assert.equal(tokens.at(-1).s, '// 注释'); assert.notEqual(K.tokenize('Widget')[0].c, '#456');
  assert.equal(f.tokenize('extra', { keywords: ['extra'] })[0].c, '#123');
});

test('随机数在相同种子下可重建；时间段包含零宽边界', () => {
  const seq = seed => { const r = K.rng(seed); return Array.from({ length: 20 }, r); };
  assert.deepEqual(seq('same'), seq('same')); assert.notDeepEqual(seq('same'), seq('different'));
  assert.ok(seq(7).every(n => n >= 0 && n < 1));
  assert.equal(K.seg(1, 1, 1), 1); assert.equal(K.seg(.9, 1, 1), 0);
});

test('每帧重置、钩子顺序、状态隔离、尺寸与缓存失效', () => {
  const order = [], cv = canvas(); let prepared = 0;
  const hook = name => (g, frame) => { order.push(name); assert.equal(g.globalAlpha, 1); assert.equal(frame.cache.serial, prepared); g.globalAlpha = .2; };
  const f = K.create({
    prepare: () => ({ serial: ++prepared }), drawBackground: hook('background'),
    beforeScene(g) { order.push('before'); assert.equal(g.globalAlpha, 1); g.globalAlpha = .5; },
    drawTransition: hook('transition'), drawChrome: hook('chrome'), beforeCaptions: hook('bloom'),
    drawCaptionBackground: hook('captionBackground'),
    drawCaption(g, layout) { order.push('caption'); assert.equal(g.globalAlpha, layout.alpha); },
    afterCaptions: hook('after'),
  });
  f.addScene({ id: 'a', dur: 4, captions: [{ t: 0, text: '字幕' }], draw(g, lt, sc, frame) { order.push('scene'); assert.equal(g.globalAlpha, .5); assert.equal(lt, frame.t); } });
  f.render(cv, 1); assert.deepEqual(order, ['background','before','scene','transition','chrome','bloom','captionBackground','caption','after']);
  f.render(cv, 2); assert.equal(prepared, 1); assert.equal(cv.depth(), 0);
  cv.width = 960; cv.height = 540; f.render(cv, 1); assert.equal(prepared, 2);
  f.invalidate(); f.render(cv, 1); assert.equal(prepared, 3);
  for (const t of [Infinity, NaN]) assert.throws(() => f.render(cv, t), /有限/);
});

test('直接、乱序、封面后的同一帧得到相同绘图指令', () => {
  const f = K.create(), cv = canvas();
  f.addScene({ id: 'a', dur: 5, captions: [{ t: .5, text: '{可以}跳帧' }], draw(g, t) { f.txt(g, String(t), t * 10, 20); } });
  f.render(cv, 1); const direct = JSON.stringify(cv.calls);
  f.render(cv, 4); f.drawCover(cv); f.render(cv, 1);
  assert.equal(JSON.stringify(cv.calls), direct); assert.equal(cv.depth(), 0);
});

test('离屏 prepare 异常后能够重试', () => {
  let attempts = 0;
  const f = K.create({ prepare() { if (!attempts++) throw new Error('resource'); return { ready: true }; } });
  assert.throws(() => f.prepare(100, 100), /resource/);
  assert.deepEqual(f.prepare(100, 100), { ready: true }); assert.equal(attempts, 2);
});
