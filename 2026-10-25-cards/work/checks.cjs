#!/usr/bin/env node
'use strict';
/*
 * 卡片视频自动检查；改编自 2026-10-24-screen-intercom-protocol/work/checks.cjs。
 * 运行（Node 18+）：CHROME_PATH=/absolute/path/to/chrome node checks.cjs [--quick]
 * 默认：每幕 0.25s 网格 + 0 + 末尾前 0.05s + 每句字幕中点。
 * --quick：每幕仅 0、时长中点、末尾前 0.05s；字幕规则仍全量检查。
 * 依赖从 ../../tools/render/node_modules 解析；优先 Playwright，兼容该目录
 * 已安装的 puppeteer-core（与 render_local.mjs 相同）。不安装任何依赖。
 * 仅写本目录 checks.report.txt；不改源文件、不保存截帧、不启动 HTTP 服务。
 * 真错误/检查未完成 => 1；只有已知动画误报或待复核项 => 0。
 * 与试点的差别：原生 TextMetrics/CTM，原始 RGBA 的 SHA-256 像素比较，
 * 不再用估算字宽或绘图指令哈希代替真实浏览器。乱序沿用同一页面/缓存，
 * 不重置随机数或时钟，避免掩盖依赖渲染历史的问题。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const W = 1920, H = 1080, STEP = 0.25, EPS = 0.0011, SEED = 0x43415244;
const INPUTS = ['../../tools/film-kit/engine.js', 'script.js', 'kit.js', 'film.js', 'film.html', 'fonts.css'];
const sha = value => createHash('sha256').update(value).digest('hex');
const fmt = n => Number.isFinite(n) ? n.toFixed(3) : String(n ?? '—');
const quote = value => JSON.stringify(value ?? '—');
const area = b => b ? Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top) : 0;
function intersect(a, b) {
  if (!a || !b) return null;
  const r = { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) };
  return area(r) > 0 ? r : null;
}
const screen = { left: 0, top: 0, right: W, bottom: H };
const topZone = { ...screen, bottom: 110 }, bottomZone = { ...screen, top: 890 };
const outside = b => b.left < -1e-6 || b.top < -1e-6 || b.right > W + 1e-6 || b.bottom > H + 1e-6;
const boxLabel = b => b ? `[${fmt(b.left)}, ${fmt(b.top)}]–[${fmt(b.right)}, ${fmt(b.bottom)}]` : '不适用';
function charCount(s) {
  // 标点、空格仍计字；Unicode 拉丁字母及十进制数字半字，其余码点一字。
  return Array.from(s.replace(/[{}\[\]^]/g, '')).reduce((n, c) => n + (/\p{Script=Latin}|\p{Decimal_Number}/u.test(c) ? 0.5 : 1), 0);
}
function titleScene(id, data, registered) {
  // 未登记的片尾也需要豁免；不依赖固定幕号或章节号。
  return !!(registered?.title || data?.title || /^(?:系列)?片(?:名|尾)$/.test(data?.name || ''));
}
function shuffle(items) {
  const out = items.slice(); let seed = SEED;
  for (let i = out.length - 1; i > 0; i--) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const j = Math.floor((seed >>> 0) / 4294967296 * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((x, i) => x === items[i])) out.reverse();
  return out;
}
function samplesFor(sc, quick) {
  if (!Number.isFinite(sc.d) || sc.d <= 0 || !Number.isFinite(sc.start)) return [];
  const end = Math.max(0, sc.d - Math.min(0.05, sc.d / 4));
  const times = new Set([0, sc.d / 2, end]);
  if (!quick) {
    for (let t = STEP; t < sc.d; t += STEP) times.add(t);
    for (let i = 0; i < sc.cs.length; i++) {
      const t = (sc.cs[i] + sc.ce[i]) / 2;
      if (Number.isFinite(t) && t >= 0 && t < sc.d) times.add(t);
    }
  }
  return [...times].sort((a, b) => a - b).map((lt, index) => ({ id: sc.id, lt, t: sc.start + lt, index }));
}

class Report {
  constructor(quick) { this.quick = quick; this.findings = []; this.statuses = []; this.notes = []; this.inputs = []; this.script = {}; this.scenes = []; this.rendered = new Map(); }
  add(level, code, message, extra = {}) { this.findings.push({ level, code, message, id: '全局', t: null, lt: null, texts: [], boxes: [], ...extra }); }
  status(name, detail) { this.statuses.push(`${name}：${detail}`); }
  finish() {
    const counts = level => this.findings.filter(x => x.level === level).length;
    const errors = counts('错误'), known = counts('已知误报'), review = counts('待复核');
    const lines = ['卡片架构与看板卡片重构 — 自动检查完整报告',
      `Node ${process.version}；逻辑/像素画布 ${W}×${H}；${this.quick ? '--quick 每幕3帧' : '0.25s 网格 + 字幕中点 + 幕首尾'}；固定乱序种子 0x${SEED.toString(16)}`,
      '时间：t 为已登记影片全局秒数，lt 为幕内秒数；未登记幕 t 不适用。坐标为屏幕像素。',
      '错误、已知误报、待复核分别统计；待复核不是通过证明。未完成的必需检查计错误。', '', '本次输入 SHA-256：'];
    for (const s of this.inputs) lines.push(`  ${s.name}  ${s.hash}`);
    lines.push('', ...this.statuses, '', `按幕问题：错误 ${errors}；已知误报 ${known}；待复核 ${review}（以下按相邻采样点合并）`);
    const ids = [...new Set(['全局', ...Object.keys(this.script), ...this.scenes.map(s => s.id), ...this.findings.map(f => f.id)])];
    for (const id of ids) {
      const sc = this.scenes.find(s => s.id === id), data = this.script[id];
      const hits = this.findings.filter(f => f.id === id);
      if (id === '全局' && !hits.length) continue;
      lines.push('', `${id}${data?.name ? ' · ' + data.name : ''}${sc ? ` | ${fmt(sc.start)}–${fmt(sc.start + sc.d)} s` : id !== '全局' ? ' | 未登记' : ''}`);
      if (!hits.length) {
        const count = this.rendered.get(id) || 0;
        lines.push(count ? `  [通过] 时间线与本幕 ${count} 个采样点未发现问题。` : '  [未完成] 时间线未发现问题；本幕尚无成功渲染采样。');
        continue;
      }
      for (const level of ['错误', '已知误报', '待复核']) {
        // 保留同名异位调用；仅同一规则、调用位置、连续采样点可合并。
        const groups = [], active = new Map();
        for (const f of hits.filter(h => h.level === level).sort((a, b) => (a.t ?? -1) - (b.t ?? -1))) {
          const key = JSON.stringify([f.code, f.reason, f.texts, f.key ?? f.message]);
          const prev = active.get(key);
          if (Number.isInteger(f.index) && prev && f.index === prev.last.index + 1) { prev.last = f; prev.count++; }
          else { const g = { first: f, last: f, count: 1 }; groups.push(g); active.set(key, g); }
        }
        for (const { first: f, last, count } of groups) {
          lines.push(`  [${level}] ${f.code} | t=${fmt(f.t)}${count > 1 ? '–' + fmt(last.t) : ''} s | lt=${fmt(f.lt)}${count > 1 ? '–' + fmt(last.lt) : ''} s${count > 1 ? ` | ${count}采样点` : ''}`,
            `    ${f.message}${f.reason ? '；归类依据：' + f.reason : ''}`,
            `    文字：${f.texts.length ? f.texts.map(quote).join(' ↔ ') : '不适用'} | 坐标：${f.boxes.length ? f.boxes.map(boxLabel).join(' ↔ ') : '不适用'}`);
          if (count > 1 && last.boxes.length) lines.push(`    末次坐标：${last.boxes.map(boxLabel).join(' ↔ ')}`);
        }
      }
    }
    lines.push('', '检查口径与覆盖限制：', ...this.notes.map((s, i) => `${i + 1}. ${s}`), '',
      `总结果：[${errors ? '失败' : '通过'}] 真错误 ${errors}，已知误报 ${known}，待复核 ${review}。退出码 ${errors ? 1 : 0}。`);
    const target = path.join(__dirname, 'checks.report.txt');
    fs.writeFileSync(target, lines.join('\n') + '\n');
    console.log(this.statuses.join('\n'));
    console.log(`\n[${errors ? '失败' : '通过'}] 真错误 ${errors}；已知误报 ${known}；待复核 ${review}。\n完整报告：${target}`);
    process.exitCode = errors ? 1 : 0;
  }
}

function loadProject(report) {
  const sources = new Map();
  for (const name of INPUTS) {
    const content = fs.readFileSync(path.resolve(__dirname, name), 'utf8');
    sources.set(name, content); report.inputs.push({ name, hash: sha(content) });
  }
  // 仅执行登记，不调用 render/prepare；与试点一样共享普通 script 的词法作用域。
  const context = vm.createContext({ console });
  vm.runInContext('globalThis.window = globalThis;', context);
  new vm.Script(sources.get(INPUTS[0]), { filename: INPUTS[0] }).runInContext(context, { timeout: 10000 });
  new vm.Script(sources.get('script.js'), { filename: 'script.js' }).runInContext(context, { timeout: 10000 });
  const script = vm.runInContext('SCRIPT', context);
  if (!script || typeof script !== 'object' || Array.isArray(script)) throw new Error('SCRIPT 必须为按幕号索引的对象');
  report.script = script;
  const registered = [], create = context.FilmKit.create; let registering = null;
  context.FilmKit.create = function (options) {
    const film = create.call(this, options), add = film.addScene;
    film.addScene = function (o) { registering = o.id; const sc = add.call(this, o); registered.push(sc); registering = null; return sc; };
    return film;
  };
  let registrationOK = true;
  try {
    for (const file of ['kit.js', 'film.js']) new vm.Script(sources.get(file), { filename: file }).runInContext(context, { timeout: 10000 });
  } catch (e) { registrationOK = false; report.add('错误', '场景登记异常', e.stack, { id: registering || '全局' }); }
  report.scenes = registered;
  return { script, registered, film: context.FILM, registrationOK };
}

function checkTimeline(project, report) {
  const { script, registered, film, registrationOK } = project;
  const ids = Object.keys(script), byID = new Map(registered.map(s => [s.id, s]));
  let fullDuration = 0, declaredRegistered = 0, actualSum = 0, capCount = 0, exempt = 0;
  const startErrors = report.findings.filter(f => f.level === '错误').length;
  for (const id of ids) {
    const data = script[id], sc = byID.get(id), base = { id, t: sc?.start ?? null, lt: 0 };
    if (!data || !Number.isFinite(data.dur) || data.dur <= 0) { report.add('错误', 'SCRIPT 时长', `dur 必须为正有限数：${data?.dur}`, base); continue; }
    fullDuration += data.dur;
    if (!sc) report.add('错误', '未登记场景', `SCRIPT 中存在，film.js 未成功登记；声明时长 ${data.dur}s${registrationOK ? '' : '（登记曾中止，后续幕不能据此认定源码缺失）'}`, base);
    else declaredRegistered += data.dur;
    if (!Array.isArray(data.caps)) { report.add('错误', 'SCRIPT 字幕', 'caps 必须为数组', base); continue; }
    const title = titleScene(id, data, sc); if (title) exempt++;
    for (const [i, cap] of data.caps.entries()) {
      capCount++;
      const [begin, end, text] = Array.isArray(cap) ? cap : [];
      const pos = { ...base, lt: begin, t: sc && Number.isFinite(begin) ? sc.start + begin : null, texts: typeof text === 'string' ? [text] : [] };
      if (!Number.isFinite(begin) || !Number.isFinite(end) || begin < 0 || end > data.dur + 1e-9 || end <= begin)
        report.add('错误', '字幕时间越界', `字幕 #${i + 1} [${begin}, ${end}]，场景 [0, ${data.dur}]`, pos);
      if (typeof text !== 'string') { report.add('错误', '字幕类型', `字幕 #${i + 1} 不是字符串`, pos); continue; }
      const count = charCount(text), minimum = Math.max(1.6, count / 4.5);
      if (count > 22) report.add('错误', '字幕过长', `去标记后 ${count} 字 > 22（拉丁字母/数字半字）`, pos);
      if (!title && Number.isFinite(end - begin) && end - begin + 1e-9 < minimum)
        report.add('错误', '字幕停留不足', `${fmt(end - begin)}s < max(1.6, ${count}/4.5) = ${fmt(minimum)}s`, pos);
    }
  }
  let cursor = 0;
  const expectedCaps = [];
  for (const sc of registered) {
    const data = script[sc.id], pos = { id: sc.id, t: sc.start, lt: 0 };
    if (!data) report.add('错误', '未知登记场景', '已登记 id 不在 SCRIPT 中', pos);
    if (!Number.isFinite(sc.start) || Math.abs(sc.start - cursor) > EPS) report.add('错误', '场景不首尾相接', `start=${sc.start}，前幕结束=${cursor}`, pos);
    if (!Number.isFinite(sc.d) || sc.d <= 0 || (data && Math.abs(sc.d - data.dur) > EPS)) report.add('错误', '场景时长不一致', `登记 ${sc.d}s；SCRIPT ${data?.dur}s`, pos);
    if (data && sc.chapter !== data.chapter) report.add('错误', '章节不一致', `登记 ${sc.chapter}；SCRIPT ${data.chapter}`, pos);
    cursor = sc.start + sc.d; actualSum += sc.d;
    const caps = sc.captions || [];
    if (data && caps.length !== data.caps?.length) report.add('错误', '登记字幕数量', `登记 ${caps.length}；SCRIPT ${data.caps?.length}`, pos);
    caps.forEach((c, i) => {
      const a = sc.cs[i], b = sc.ce[i], p = { id: sc.id, lt: a, t: sc.start + a, texts: [c.text] };
      if (![a, b].every(Number.isFinite) || a < 0 || b > sc.d + 1e-9 || b <= a) report.add('错误', '登记字幕越界', `[${a}, ${b}] 不在 [0, ${sc.d}] 内`, p);
      const want = data?.caps?.[i];
      if (want && (want[2] !== c.text || Math.abs(a - want[0]) > EPS || Math.abs(b - want[1]) > EPS)) report.add('错误', '字幕登记差异', `SCRIPT=${quote(want)}，登记=${quote([a, b, c.text])}`, p);
      expectedCaps.push({ t0: sc.start + a, t1: sc.start + b, text: c.text, id: sc.id, lt: a });
    });
  }
  if (!film || typeof film.render !== 'function') report.add('错误', 'FILM 导出', '未生成可调用的 FILM.render');
  else {
    if (!Number.isFinite(film.duration) || Math.abs(film.duration - actualSum) > EPS || Math.abs(film.duration - declaredRegistered) > EPS)
      report.add('错误', '影片总时长', `FILM=${film.duration}；登记场景和=${actualSum}；对应 SCRIPT 时长和=${declaredRegistered}`);
    const exported = film.scenes || [];
    if (exported.length !== registered.length) report.add('错误', '导出场景数量', `${exported.length} != ${registered.length}`);
    exported.forEach((s, i) => {
      const raw = registered[i];
      if (!raw || s.id !== raw.id || !Number.isFinite(s.start) || !Number.isFinite(s.d) || Math.abs(s.start - raw.start) > EPS || Math.abs(s.d - raw.d) > EPS)
        report.add('错误', '导出时间线差异', quote(s), { id: s.id, t: s.start, lt: 0 });
    });
    const exportedCaps = film.captions || [];
    if (exportedCaps.length !== expectedCaps.length) report.add('错误', '导出字幕数量', `${exportedCaps.length} != ${expectedCaps.length}`);
    expectedCaps.forEach((c, i) => {
      const got = exportedCaps[i];
      if (!got || got.text !== c.text || !Number.isFinite(got.t0) || !Number.isFinite(got.t1) || Math.abs(got.t0 - c.t0) > EPS || Math.abs(got.t1 - c.t1) > EPS)
        report.add('错误', '导出字幕差异', `第 ${i + 1} 句：${quote(got)}`, { id: c.id, t: c.t0, lt: c.lt, texts: [c.text] });
    });
  }
  const missing = ids.filter(id => !byID.has(id));
  report.status('时间线', `SCRIPT ${ids.length}幕/${fmt(fullDuration)}s；登记 ${registered.length}幕/${fmt(actualSum)}s；未登记 ${missing.length}幕${missing.length ? '（' + missing.join('、') + '）' : ''}`);
  report.status('字幕', `全量 ${capCount}句；${exempt}个 title/片名/片尾幕豁免停留时长；时间线及字幕新增错误 ${report.findings.filter(f => f.level === '错误').length - startErrors}`);
}

/* 此函数由浏览器在任何页面脚本执行前安装；不得引用 Node 侧闭包。 */
function installBrowserAudit() {
  const A = window.__checksAudit = { active: false, main: null, role: 'scene', texts: [], boards: [], covers: [], numeric: [], atStack: [], owner: null, camera: null, frame: null, registered: [], hooks: [], offscreenText: 0 };
  const contexts = new WeakMap(), pathInfo = new WeakMap();
  const rectArea = b => b ? Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top) : 0;
  const intersection = (a, b) => {
    if (!a || !b) return null;
    return { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) };
  };
  const mat = g => { const m = g.getTransform(); return [m.a, m.b, m.c, m.d, m.e, m.f]; };
  const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const bounds = points => ({ left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) });
  const rect = (m, x, y, w, h) => bounds([[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(p => point(m, ...p)));
  const site = () => new Error().stack.split('\n').filter(s => /\/(?:film|kit)\.js:/.test(s)).map(s => s.trim()).join(' > ') || A.role;
  function state(g) { if (!contexts.has(g)) contexts.set(g, { clip: null, unknownClip: false, stack: [], path: null }); return contexts.get(g); }
  function bad(label, value) {
    const text = `${label}: ${String(value)}`;
    if (A.active) {
      const source = site(), key = text + source;
      if (!A.numericKeys.has(key)) {
        A.numericKeys.add(key);
        A.numeric.push({ message: text, role: A.role, source, text: A.owner?.text });
      }
    }
  }
  function finite(value, label, seen = new WeakSet()) {
    if (typeof value === 'number') { if (!Number.isFinite(value)) bad(label, value); return; }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach((v, i) => finite(v, `${label}[${i}]`, seen)); return; }
    if (ArrayBuffer.isView(value)) {
      // 整数/像素数组不可能包含 NaN；浮点 dash/矩阵参数不能漏掉。
      if (value instanceof Float32Array || value instanceof Float64Array) value.forEach((v, i) => finite(v, `${label}[${i}]`, seen));
      return;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) for (const [k, v] of Object.entries(value)) finite(v, `${label}.${k}`, seen);
    else for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'm11', 'm12', 'm21', 'm22', 'm41', 'm42', 'x', 'y', 'z', 'w', 'width', 'height']) {
      if (typeof value[k] === 'number' && !Number.isFinite(value[k])) bad(`${label}.${k}`, value[k]);
    }
  }
  function alpha(g, stroke = false) {
    const fill = stroke ? g.strokeStyle : g.fillStyle;
    let a = 1;
    if (typeof fill === 'string') {
      if (fill === 'transparent') a = 0;
      else if (/^#[\da-f]{8}$/i.test(fill)) a = parseInt(fill.slice(7, 9), 16) / 255;
      else if (/^#[\da-f]{4}$/i.test(fill)) a = parseInt(fill[4] + fill[4], 16) / 255;
      else {
        const match = fill.match(/(?:rgba|hsla)\([^)]*,\s*([\d.]+)(%)?\s*\)$/i) || fill.match(/\/\s*([\d.]+)(%)?\s*\)$/);
        if (match) a = Number(match[1]) / (match[2] ? 100 : 1);
      }
    }
    return g.globalAlpha * a;
  }
  function rawPath(args, g) {
    const p = args[0] && typeof args[0] === 'object' ? pathInfo.get(args[0]) : state(g).path;
    if (!p || p.unknown || p.rects.length !== 1) return null;
    const r = p.rects[0];
    return r.bounds || rect(mat(g), ...r.args);
  }
  function captureFill(g, b) {
    if (!A.active || g.canvas !== A.main || !b || rectArea(b) <= 0) return;
    const st = state(g), visible = st.clip ? intersection(b, st.clip) : b;
    if (rectArea(visible) <= 0) return;
    const item = { bounds: visible, alpha: alpha(g), seq: A.seq++, unknownClip: st.unknownClip };
    if (A.role === 'captionBackground' && item.alpha > 0) A.boards.push(item);
    if (A.role === 'transition' && item.alpha >= 0.98 && g.globalCompositeOperation === 'source-over' && !st.unknownClip) A.covers.push(item);
  }
  function captureText(g, args, method, measure) {
    if (!A.active) return;
    if (g.canvas !== A.main) { A.offscreenText++; return; }
    const [value, x, y, maxWidth] = args, text = String(value), opacity = alpha(g, method === 'strokeText');
    if (!text.trim() || opacity <= 0) return;
    const m = mat(g), metrics = measure.call(g, text), size = Number(g.font.match(/([\d.]+)px\b/)?.[1]);
    finite(metrics, 'TextMetrics'); finite(m, '文字矩阵');
    const shrink = maxWidth == null || metrics.width <= maxWidth ? 1 : maxWidth / metrics.width;
    if (!(shrink > 0)) return;
    let left, right, top, bottom, estimated = false;
    if (['actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent'].every(k => Number.isFinite(metrics[k]))) {
      left = x - metrics.actualBoundingBoxLeft * shrink; right = x + metrics.actualBoundingBoxRight * shrink;
      top = y - metrics.actualBoundingBoxAscent; bottom = y + metrics.actualBoundingBoxDescent;
    } else {
      estimated = true;
      const w = metrics.width * shrink, h = size * 1.2;
      const align = g.textAlign === 'start' ? (g.direction === 'rtl' ? 'right' : 'left') : g.textAlign === 'end' ? (g.direction === 'rtl' ? 'left' : 'right') : g.textAlign;
      left = x - (align === 'center' ? w / 2 : align === 'right' ? w : 0); right = left + w;
      top = y - ({ top: 0, hanging: size * .2, middle: h / 2, alphabetic: size, ideographic: h, bottom: h }[g.textBaseline] ?? size); bottom = top + h;
    }
    const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(p => point(m, ...p));
    const b = bounds(corners), st = state(g), visible = st.clip ? intersection(b, st.clip) : b;
    let uncam = b;
    if (A.role === 'scene' && A.camera) {
      const [a, bb, c, d, e, f] = A.camera, det = a * d - bb * c;
      if (Math.abs(det) > 1e-12) uncam = bounds(corners.map(([px, py]) => [(d * (px - e) - c * (py - f)) / det, (-bb * (px - e) + a * (py - f)) / det]));
    }
    // 字号取字形纵轴经完整 CTM 变换后的长度；不再额外乘 CAMZ/SCX。
    const fontPx = size * Math.hypot(m[2], m[3]);
    finite([b.left, b.top, b.right, b.bottom, fontPx], '文字包围盒/屏幕字号');
    const owner = A.owner;
    const decorative = !!(owner?.shadow && owner.calls++ === 0);
    const source = owner?.source || site(), stem = JSON.stringify([A.role, source, text]);
    const occurrence = A.occurrences.get(stem) || 0; A.occurrences.set(stem, occurrence + 1);
    A.texts.push({ text, bounds: b, visible, uncam, fontPx, size, alpha: opacity, globalAlpha: g.globalAlpha,
      role: A.role, source, key: stem + '#' + occurrence, at: A.atStack.map(x => ({ ...x })), decorative,
      method, seq: A.seq++, estimated, unknownClip: st.unknownClip, composite: g.globalCompositeOperation,
      rotated: Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6 });
  }
  const numericArgs = { arc: [0, 1, 2, 3, 4], arcTo: [0, 1, 2, 3, 4], ellipse: [0, 1, 2, 3, 4, 5, 6], moveTo: [0, 1], lineTo: [0, 1], rect: [0, 1, 2, 3], roundRect: [0, 1, 2, 3], fillRect: [0, 1, 2, 3], strokeRect: [0, 1, 2, 3], clearRect: [0, 1, 2, 3], translate: [0, 1], scale: [0, 1], rotate: [0], transform: [0, 1, 2, 3, 4, 5], quadraticCurveTo: [0, 1, 2, 3], bezierCurveTo: [0, 1, 2, 3, 4, 5], fillText: [1, 2], strokeText: [1, 2], createLinearGradient: [0, 1, 2, 3], createRadialGradient: [0, 1, 2, 3, 4, 5], createConicGradient: [0, 1, 2], getImageData: [0, 1, 2, 3] };
  const pathMethods = new Set(['moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'bezierCurveTo', 'quadraticCurveTo', 'addPath']);
  function instrumentContext(proto) {
    if (!proto) return;
    const measure = proto.measureText;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (name === 'constructor') continue;
      if (typeof desc.value === 'function') {
        const native = desc.value;
        Object.defineProperty(proto, name, { ...desc, value: function (...args) {
          if (A.active) {
            args.forEach((v, i) => finite(v, `${name}[${i}]`));
            for (const i of numericArgs[name] || []) if (!Number.isFinite(Number(args[i]))) bad(`${name}[${i}]`, args[i]);
            if (['fillText', 'strokeText'].includes(name) && args.length > 3 && !Number.isFinite(Number(args[3]))) bad(`${name}.maxWidth`, args[3]);
          }
          const st = state(this);
          if (name === 'save') st.stack.push({ clip: st.clip, unknownClip: st.unknownClip });
          if (name === 'restore' && st.stack.length) Object.assign(st, st.stack.pop());
          if (name === 'reset') { st.clip = null; st.unknownClip = false; st.stack = []; st.path = null; }
          if (name === 'beginPath') st.path = { rects: [], unknown: false };
          if (name === 'rect' || name === 'roundRect') {
            st.path ||= { rects: [], unknown: false };
            st.path.rects.push({ bounds: rect(mat(this), ...args.slice(0, 4)) });
            if (name === 'roundRect') st.path.unknown = true;
          } else if (pathMethods.has(name) && st.path) st.path.unknown = true;
          if (name === 'clip') {
            const b = rawPath(args, this), m = mat(this);
            if (b) st.clip = st.clip ? intersection(st.clip, b) : b;
            if (!b || Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6) st.unknownClip = true;
          }
          if (name === 'fillText' || name === 'strokeText') captureText(this, args, name, measure);
          if (name === 'fill') captureFill(this, rawPath(args, this));
          if (name === 'fillRect') captureFill(this, rect(mat(this), ...args));
          const result = native.apply(this, args);
          if (name === 'measureText' && A.active) for (const k of ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent']) if (typeof result[k] === 'number') finite(result[k], `measureText.${k}`);
          return result;
        } });
      } else if (desc.set) {
        Object.defineProperty(proto, name, { ...desc, set(value) { if (A.active) finite(value, `context.${name}`); return desc.set.call(this, value); } });
      }
    }
  }
  instrumentContext(window.CanvasRenderingContext2D?.prototype);
  instrumentContext(window.OffscreenCanvasRenderingContext2D?.prototype);
  for (const ctor of [window.CanvasGradient, window.CanvasPattern, window.Path2D]) {
    if (!ctor) continue;
    for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
      const desc = Object.getOwnPropertyDescriptor(ctor.prototype, name);
      if (name === 'constructor' || typeof desc.value !== 'function') continue;
      Object.defineProperty(ctor.prototype, name, { ...desc, value: function (...args) {
        if (A.active) args.forEach((v, i) => finite(v, `${ctor.name}.${name}[${i}]`));
        if (ctor === NativePath) {
          if (!pathInfo.has(this)) pathInfo.set(this, { rects: [], unknown: false });
          const p = pathInfo.get(this);
          if (name === 'rect') p.rects.push({ args: args.slice(0, 4) });
          else if (name !== 'closePath') p.unknown = true;
        }
        return desc.value.apply(this, args);
      } });
    }
  }
  // 捕获 Path2D 构造的 SVG/复制路径，避免把未知路径误当单一矩形。
  const NativePath = window.Path2D;
  if (NativePath) window.Path2D = new Proxy(NativePath, { construct(target, args) {
    const p = Reflect.construct(target, args);
    pathInfo.set(p, { rects: [], unknown: args.length > 0 }); return p;
  } });
  function role(name, fn) {
    return function (...args) { const old = A.role; A.role = name; try { return fn.apply(this, args); } finally { A.role = old; } };
  }
  function hookCreate(kit) {
    const create = kit.create;
    kit.create = function (options) {
      // kit.js 已加载，普通 script 的函数声明可通过 window 包装，不改磁盘源码。
      if (typeof window.at === 'function' && !A.atWrapped) {
        A.atWrapped = true; const at = window.at;
        window.at = function (g, x, y, s, fn, o = {}) {
          if (!A.active) return at.apply(this, arguments);
          const key = site(); A.atStack.push({ key, scale: s, sx: o.sx ?? 1, sy: o.sy ?? 1 });
          try { return at.apply(this, arguments); } finally { A.atStack.pop(); }
        };
      }
      if (typeof window.text === 'function' && !A.textWrapped) {
        A.textWrapped = true; const text = window.text;
        window.text = function (g, s, x, y, o = {}) {
          const old = A.owner; A.owner = { shadow: !!o.shc, calls: 0, source: site(), text: String(s) };
          try { return text.apply(this, arguments); } finally { A.owner = old; }
        };
      }
      const opts = { ...options };
      for (const [hook, kind] of Object.entries({ drawBackground: 'background', drawTransition: 'transition', drawChrome: 'chrome', drawCaptionBackground: 'captionBackground', drawCaption: 'caption', beforeCaptions: 'beforeCaptions', afterCaptions: 'afterCaptions' })) {
        if (opts[hook]) { opts[hook] = role(kind, opts[hook]); A.hooks.push(hook); }
      }
      const before = opts.beforeScene;
      opts.beforeScene = function (g, frame) { const value = before?.call(this, g, frame); A.camera = mat(g); A.frame = frame; return value; };
      const film = create.call(this, opts), add = film.addScene;
      film.addScene = function (o) {
        const sc = add.call(this, { ...o, draw: role('scene', o.draw) });
        A.registered.push({ id: sc.id, start: sc.start, d: sc.d, chapter: sc.chapter, title: !!sc.title, card: sc.card ?? null, cam: sc.cam || null, cs: sc.cs, ce: sc.ce });
        return sc;
      };
      return film;
    };
  }
  let filmKit;
  Object.defineProperty(window, 'FilmKit', { configurable: true, enumerable: true,
    get() { return filmKit; }, set(value) { filmKit = value; hookCreate(value); } });
  A.render = async function (time, layout) {
    const canvas = document.getElementById('c');
    if (!canvas) throw new Error('缺少 canvas#c');
    // 引擎会 reset() 或重设 canvas.width；同步清除主画布的裁切跟踪状态。
    contexts.delete(canvas.getContext('2d'));
    A.main = canvas; A.texts = []; A.boards = []; A.covers = []; A.numeric = []; A.atStack = []; A.owner = null;
    A.camera = null; A.frame = null; A.role = 'scene'; A.seq = 0; A.occurrences = new Map(); A.numericKeys = new Set(); A.offscreenText = 0;
    let error = null, digest = null;
    A.active = true;
    try { window.FILM.render(canvas, time); } catch (e) { error = e.stack || String(e); }
    finally { A.active = false; }
    if (!error) {
      try {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const hash = await crypto.subtle.digest('SHA-256', pixels.data);
        digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) { error = `像素读取/哈希失败：${e.stack || e}`; }
    }
    return { error, digest, numeric: A.numeric, texts: layout ? A.texts : [], boards: layout ? A.boards : [], covers: layout ? A.covers : [], offscreenText: A.offscreenText };
  };
}

async function launchBrowser() {
  const requireRender = createRequire(path.resolve(__dirname, '../../tools/render/render_local.mjs'));
  let driver, kind;
  for (const name of ['playwright', 'playwright-core', 'puppeteer-core']) {
    let resolved; try { resolved = requireRender.resolve(name); } catch (e) { if (e.code === 'MODULE_NOT_FOUND') continue; throw e; }
    driver = requireRender(resolved); kind = name; break;
  }
  if (!driver) throw new Error('tools/render/node_modules 中无 playwright/playwright-core/puppeteer-core；未执行安装。');
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath) throw new Error('请设置 CHROME_PATH 为 Chrome/Chromium 可执行文件的绝对路径。');
  const args = ['--allow-file-access-from-files', '--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars', '--font-render-hinting=none'];
  if (kind.startsWith('playwright')) {
    const browser = await driver.chromium.launch({ executablePath, headless: true, args, timeout: 30000 });
    try { return { browser, kind, page: await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }) }; }
    catch (e) { await browser.close(); throw e; }
  }
  const browser = await driver.launch({ executablePath, headless: true, args, timeout: 30000 });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    return { browser, kind, page };
  } catch (e) { await browser.close(); throw e; }
}

function layoutCandidates(frame, sample, sc, histories, atHistory) {
  const visible = frame.texts.filter(t => !t.decorative && area(t.visible) > 0);
  const results = [];
  const push = (code, message, texts, extra = {}) => results.push({ code, message, texts, sample, sc, covers: frame.covers, ...extra });
  for (const t of visible) {
    const key = sample.id + ':' + t.key;
    if (!histories.has(key)) histories.set(key, []);
    histories.get(key).push({ time: sample.lt, alpha: t.globalAlpha });
    for (const a of t.at) {
      const k = sample.id + ':' + a.key, values = atHistory.get(k) || { min: Infinity, max: -Infinity };
      values.min = Math.min(values.min, a.scale); values.max = Math.max(values.max, a.scale); atHistory.set(k, values);
    }
    if (t.fontPx < 24 - 1e-6) push('字号不足', `实际 ${fmt(t.fontPx)}px < 24px；声明 ${t.size}px；${t.role}`, [t]);
    if (t.role !== 'chrome' && intersect(t.visible, topZone)) push('侵入顶部外框区', '屏幕 y < 110 只允许 drawChrome 的文字', [t]);
    if (t.role !== 'caption' && intersect(t.visible, bottomZone)) push('侵入字幕区', '屏幕 y > 890 只允许 drawCaption 的文字', [t]);
    if (outside(t.visible)) push('文字出画', '文字包围盒超出 [0,1920]×[0,1080]', [t]);
    if (t.role === 'scene') {
      const board = frame.boards.find(b => area(intersect(t.visible, b.bounds)) > 0);
      if (board) push('压字幕底板', '场景文字与实际绘制的字幕底板相交', [t], { board: board.bounds });
    }
  }
  // 只检查场景正文；转场参与对比，以便单列被章节卡覆盖的假碰撞。
  const sceneTexts = visible.filter(t => t.role === 'scene' || t.role === 'transition');
  for (let i = 0; i < sceneTexts.length; i++) for (let j = i + 1; j < sceneTexts.length; j++) {
    const a = sceneTexts[i], b = sceneTexts[j];
    if (a.text === b.text && a.source === b.source && a.method !== b.method && JSON.stringify(a.bounds) === JSON.stringify(b.bounds)) continue; // 同一文字描边+填充。
    const overlap = intersect(a.visible, b.visible), ratio = area(overlap) / Math.min(area(a.visible), area(b.visible));
    if (ratio > 0.15) push('文字重叠', `交集/较小包围盒 = ${(ratio * 100).toFixed(2)}% > 15%`, [a, b], { overlap });
  }
  return results;
}
function fadeTrend(history, t) {
  if (!history || history.length < 2) return 0;
  const index = history.findIndex(h => h.time === t);
  if (index < 0) return 0;
  const a = history[Math.max(0, index - 1)], b = history[Math.min(history.length - 1, index + 1)];
  return b.alpha - a.alpha;
}
function classify(hit, histories, atHistory, firstByChapter) {
  const { texts, sample, sc } = hit;
  const chapterWindow = sample.lt >= 0 && sample.lt <= 2 && (sc.card != null || firstByChapter.get(sc.chapter) === sc.id);
  if (chapterWindow) {
    const hidden = texts.some(t => hit.covers.some(c => c.seq > t.seq && area(intersect(c.bounds, t.visible)) >= area(t.visible) * .85));
    if (hidden || texts.some(t => t.role === 'transition')) return ['已知误报', '章节转场 0–2s；实际转场钩子文字或后绘不透明色块覆盖至少85%'];
  }
  for (const text of texts) for (const a of text.at) {
    const h = atHistory.get(sample.id + ':' + a.key);
    if (a.scale > 0 && a.scale < 1 && h && h.max - h.min > .01 && a.scale < h.max - .005) {
      // 持续 .85 缩放不豁免；字号错误还必须在观测到的最大尺度能恢复到24px。
      if (hit.code !== '字号不足' || text.fontPx * h.max / a.scale >= 24 - 1e-6)
        return ['已知误报', `at() 弹出/缩放瞬间：scale=${fmt(a.scale)}；同调用采样范围 ${fmt(h.min)}–${fmt(h.max)}（基于采样推断）`];
    }
  }
  if (hit.code === '文字重叠' && texts.length === 2) {
    const [a, b] = texts, da = fadeTrend(histories.get(sample.id + ':' + a.key), sample.lt), db = fadeTrend(histories.get(sample.id + ':' + b.key), sample.lt);
    if (a.globalAlpha < .999 && b.globalAlpha < .999 && da * db < -.0001)
      return ['已知误报', '两段文字同时半透明，邻近样本透明度一升一降，符合交叉淡化（基于采样推断）'];
  }
  if (texts.length === 1 && Array.isArray(sc.cam) && sc.cam.length > 1 && sc.cam.some(k => k.slice(1).some((v, i) => v !== sc.cam[0][i + 1]))) {
    const text = texts[0], b = text.uncam;
    if (text.role === 'scene' && outside(text.bounds) && !outside(b) &&
      (hit.code === '文字出画' || (hit.code === '侵入顶部外框区' && !intersect(b, topZone)) || (hit.code === '侵入字幕区' && !intersect(b, bottomZone))))
      return ['已知误报', '有推拉/平移镜头；撤销 beforeScene 镜头矩阵后文字在画内，当前文字出画'];
  }
  if (texts.some(t => t.unknownClip || t.estimated || t.composite !== 'source-over'))
    return ['待复核', '涉及非矩形裁切、估算 TextMetrics 或非 source-over 合成，包围盒无法确定最终可见性'];
  if (hit.code === '文字重叠' && texts.some(t => t.rotated)) return ['待复核', '旋转文字使用轴对齐外接框，空白角可能造成相交'];
  return ['错误', ''];
}

async function checkBrowser(project, report) {
  let browser, page, kind, completed = false;
  const samples = project.registered.flatMap(sc => samplesFor(sc, report.quick)).sort((a, b) => a.t - b.t);
  if (!samples.length) throw new Error('没有可采样场景');
  const histories = new Map(), atHistory = new Map(), candidates = [], baseline = new Map();
  const byID = new Map(project.registered.map(s => [s.id, s]));
  const pageErrors = []; let current = null, loaded = false, goodFrames = 0, compared = 0, matched = 0, offscreen = 0;
  try {
    ({ browser, page, kind } = await launchBrowser());
    page.on('pageerror', e => pageErrors.push({ message: e.stack || String(e), sample: current }));
    if (kind.startsWith('playwright')) await page.addInitScript(installBrowserAudit);
    else await page.evaluateOnNewDocument(installBrowserAudit);
    await page.goto(pathToFileURL(path.join(__dirname, 'film.html')).href, { waitUntil: 'load', timeout: 60000 });
    const ready = () => window.__ready === true || !!window.__error;
    if (kind.startsWith('playwright')) await page.waitForFunction(ready, undefined, { timeout: 60000 });
    else await page.waitForFunction(ready, { timeout: 60000 });
    const meta = await page.evaluate(async () => {
      if (window.__error) throw new Error(window.__error);
      window.__pause?.();
      const canvas = document.getElementById('c'); canvas.width = 1920; canvas.height = 1080;
      await Promise.all(window.FILM.fontsNeeded.map(f => document.fonts.load(f, '时间0aA')));
      await document.fonts.ready;
      const fonts = window.FILM.fontsNeeded.map(f => ({ font: f, ready: document.fonts.check(f, '时间0aA') }));
      // 首帧资源已由播放器创建；重新 prepare 让离屏构建也接受数值检查。
      if (typeof film !== 'undefined' && typeof film.invalidate === 'function') film.invalidate();
      return { scenes: window.__checksAudit.registered, hooks: window.__checksAudit.hooks, fonts,
        atWrapped: window.__checksAudit.atWrapped, textWrapped: window.__checksAudit.textWrapped,
        duration: window.FILM.duration, width: canvas.width, height: canvas.height };
    });
    loaded = true;
    if (!meta.atWrapped || !meta.textWrapped || !['drawChrome', 'drawCaption', 'drawCaptionBackground'].every(h => meta.hooks.includes(h)))
      throw new Error('无法包装 at/text 或必需外框/字幕钩子；不能可靠分类文字');
    if (meta.scenes.length !== project.registered.length || meta.scenes.some((s, i) => s.id !== project.registered[i]?.id || Math.abs(s.start - project.registered[i]?.start) > EPS || Math.abs(s.d - project.registered[i]?.d) > EPS))
      throw new Error('浏览器登记时间线与 Node 登记时间线不一致');
    for (const f of meta.fonts) if (!f.ready) report.add('错误', '字体未就绪', f.font);
    report.status('浏览器', `${kind}；${await browser.version()}；字体 ${meta.fonts.filter(f => f.ready).length}/${meta.fonts.length}；${meta.width}×${meta.height}`);
    async function render(sample, layout) {
      current = sample;
      const out = await page.evaluate(({ t, layout }) => window.__checksAudit.render(t, layout), { t: sample.t, layout });
      for (const n of out.numeric) report.add('错误', 'Canvas 非有限参数', `${n.message}；${n.role}；${n.source}`, { ...sample, texts: n.text ? [n.text] : [] });
      if (out.error) report.add('错误', '渲染/像素异常', out.error, { ...sample });
      offscreen += out.offscreenText;
      return out;
    }
    console.log(`浏览器就绪：${samples.length} 个时间点，正序与固定乱序各一次。`);
    let progressAt = Date.now();
    for (const [i, sample] of samples.entries()) {
      const out = await render(sample, true);
      if (!out.error) {
        goodFrames++; baseline.set(sample.t, out.digest);
        report.rendered.set(sample.id, (report.rendered.get(sample.id) || 0) + 1);
      }
      candidates.push(...layoutCandidates(out, sample, byID.get(sample.id), histories, atHistory));
      if (Date.now() - progressAt > 15000) { console.log(`正序检查 ${i + 1}/${samples.length}`); progressAt = Date.now(); }
    }
    for (const [i, sample] of shuffle(samples).entries()) {
      const out = await render(sample, false);
      if (out.digest && baseline.has(sample.t)) {
        compared++;
        if (out.digest === baseline.get(sample.t)) matched++;
        else report.add('错误', '像素不确定', `同一 t 的原始 RGBA SHA-256 不一致；正序 ${baseline.get(sample.t)}；乱序 ${out.digest}`, { ...sample, boxes: [screen] });
      }
      if (Date.now() - progressAt > 15000) { console.log(`乱序复检 ${i + 1}/${samples.length}`); progressAt = Date.now(); }
    }
    if (compared !== samples.length) report.add('错误', '确定性检查未完成', `只有 ${compared}/${samples.length} 对可比较像素`);
    completed = true;
  } finally {
    const firstByChapter = new Map();
    for (const [id, data] of Object.entries(project.script)) if (data && !firstByChapter.has(data.chapter)) firstByChapter.set(data.chapter, id);
    for (const hit of candidates) {
      const [level, reason] = classify(hit, histories, atHistory, firstByChapter);
      report.add(level, hit.code, hit.message, { ...hit.sample, reason, texts: hit.texts.map(t => t.text), boxes: [...hit.texts.map(t => t.bounds), ...(hit.board ? [hit.board] : [])], key: hit.texts.map(t => t.key) });
    }
    for (const e of pageErrors) report.add('错误', '页面异常', e.message, e.sample || {});
    if (offscreen) report.add('待复核', '离屏文字覆盖限制', `发现 ${offscreen} 次离屏文字调用；数值及最终像素已检查，文字图像再贴入主画布后的包围盒未推导。`);
    const numericCount = report.findings.filter(f => f.code === 'Canvas 非有限参数').length;
    report.status('数值/布局采样', `${goodFrames}/${samples.length} 正序帧成功；两轮非有限参数 ${numericCount} 条；${loaded ? '使用原生 Canvas 与当前 CTM' : '浏览器未就绪，未完成'}`);
    report.status('确定性', `${matched}/${compared} 对 RGBA SHA-256 一致；要求 ${samples.length} 对；${completed ? '两轮结束' : '未完成'}`);
    if (browser) await browser.close();
  }
}

async function main() {
  const argv = process.argv.slice(2), report = new Report(argv.includes('--quick'));
  report.notes.push(
    'SCRIPT 幕数、时长和字幕均动态读取；未登记幕作为真错误列出，仍检查所有 SCRIPT 字幕。总时长只与已登记幕的时长和比较。导出时间线有3位小数舍入，容差0.0011s。',
    '字数移除 {}[]^；Unicode 拉丁字母、十进制数字各0.5字，其余字符（含标点、空格）1字。title:true 或名称为片名/片尾/系列片尾豁免停留时长，其他字幕规则仍检查。',
    '原生 TextMetrics 墨迹四角经完整 getTransform() 转为屏幕 AABB，含对齐、基线、镜头、嵌套 at 和 maxWidth。字号=声明px×CTM纵轴长度，不重复乘 CAMZ/SCX。字幕和外框同样检查24px。',
    '所有 alpha>0 的非空文字参与检查；仅排除 text(o.shc) 中第一次 fillText 的装饰投影以及同一位置的描边/填充重复对。相同内容的不同绘制仍检查。',
    '矩形 clip 按包围盒裁切；非矩形/旋转 clip、非 source-over 合成、缺失真实度量归待复核。阴影、任意后绘遮挡、图片中的字、字形缺失不做通用像素可见性分析。',
    '已知误报只单列有证据的章节转场、透明度相反变化的交叉淡化、撤销镜头后回到画内的出画、同调用尺度发生变化的 at(scale<1) 瞬间。不会整幕或整段0–2s豁免。动画分类由样本推断，短动画/循环共用调用点可能需复核。',
    '字幕底板来自 drawCaptionBackground 的实际矩形填充；y>890预留区独立检查，即使当前没有字幕也生效。顶部仅 drawChrome 可豁免；drawTransition 不是外框。',
    '确定性比较相同页面、同一组时间点正序/乱序的全画布原始 RGBA SHA-256（非PNG、非绘制指令）；只保存哈希以限制内存。密码学哈希有理论碰撞可能；不证明未采样时间或不同浏览器/机器一致。',
    report.quick ? '--quick 每幕仅3个时间点，可能完全错过转场、交叉淡化和弹出过程；布局结果需结合默认模式。' : '0.25s网格及字幕中点不能覆盖两次采样之间的瞬时问题；报告连续区间仅表示相邻样本命中，不推断整段持续可见。',
    '本脚本不渲染 drawCover。浏览器不可启动、加载失败或像素读取失败会写入报告并返回1，不会伪报通过。'
  );
  try {
    if (argv.some(x => x !== '--quick')) throw new Error('用法：CHROME_PATH=... node checks.cjs [--quick]');
    const project = loadProject(report);
    checkTimeline(project, report);
    console.log(`登记检查完成：${project.registered.length}/${Object.keys(project.script).length} 幕。正在启动浏览器。`);
    await checkBrowser(project, report);
  } catch (e) { report.add('错误', '检查器未完成', e.stack || String(e)); }
  finally {
    for (const input of report.inputs) {
      try { if (sha(fs.readFileSync(path.resolve(__dirname, input.name), 'utf8')) !== input.hash) report.add('错误', '输入版本变化', `${input.name} 检查期间发生变化，请重跑。`); }
      catch (e) { report.add('错误', '输入版本复核失败', `${input.name}: ${e.message}`); }
    }
    report.finish();
  }
}
if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { charCount, samplesFor, shuffle, intersect, layoutCandidates, classify, installBrowserAudit, loadProject, checkTimeline, Report };
