/* =====================================================================
 * 卡片架构与看板卡片重构 —— 画面工具（风格包：包豪斯积木）
 * 普通 <script>，顶层声明供 film.js 使用。所有绘制只依赖时间 t（可任意跳帧、分段并行渲染）。
 * 逻辑坐标 1920×1080；canvas 阴影参数不随变换缩放，统一乘 SH（设备像素/逻辑像素 × 镜头缩放）。
 * 画风要点：一切都是“块”（矩形/圆/半圆/四分之一圆/三角），4 px 墨线 + 纯黑硬投影（不模糊）。
 * ===================================================================== */
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, eback, hash, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;

/* ---------------- 主题 ---------------- */
const C = {
  paper: '#F2EDE3', paper2: '#E8E1D3', white: '#FBF9F4', ink: '#161616', ink2: '#55524C', line: '#C8C0B0',
  red: '#D93A2B', redL: '#F7D6CF', yellow: '#F2B705', yellowL: '#FCEBB4', blue: '#1F4FA8', blueL: '#D5DEF2',
  grey: '#8D8A82', greyL: '#E2DDD2', ochre: '#94650A',   // ochre：白底代码里的字符串色（黄字在白底上不可读）
};
const F = {
  cjk: '"FCJK","FSup","Noto Sans CJK SC","PingFang SC",sans-serif',
  disp: '"FDisp","Inter Display","Inter","FCJK",sans-serif',
  mono: '"FMono","FMonoCJK","DejaVu Sans Mono",monospace',
};
const fontsNeeded = [
  ...[500, 700, 900].map(w => `${w} 32px "FCJK"`),
  ...[800, 900].map(w => `${w} 32px "FDisp"`),
  ...[500, 700, 900].map(w => `${w} 32px "FSup"`),
  ...[400, 700].flatMap(w => [`${w} 32px "FMono"`, `${w} 32px "FMonoCJK"`]),
];
/* 黄底上的字用墨色，其余色块上的字用白色 */
const onCol = c => c === C.yellow || c === C.yellowL || c === C.white || c === C.paper ? C.ink : '#fff';

/* ---------------- 运动曲线 ---------------- */
const pop = p => p <= 0 ? 0 : p >= 1 ? 1 : eback(p);                      // 带回弹的弹出
const spring = (t, k = 6, f = 1.4) => t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(f * TAU * t); // 弹簧落定
const win = (lt, a, b, fi = .3, fo = .3) => Math.min(eo(seg(lt, a, a + fi)), 1 - eo(seg(lt, b - fo, b))); // 区间可见度
const wob = (t, f = 1, a = 1, s = 0) => Math.sin((t + s) * TAU * f) * a;
/* 积木落位：从 dy 高处落下，落地挤压一次。返回 [y 偏移, 横向拉伸] */
function landing(lt, t0, dur = .5, dy = -220) {
  const k = seg(lt, t0, t0 + dur);
  if (k < 1) return [dy * (1 - k * k), 1];
  const q = seg(lt, t0 + dur, t0 + dur + .28);
  return [0, 1 + Math.sin(q * Math.PI) * .14 * (1 - q)];
}

/* ---------------- 全局渲染状态 ---------------- */
let SCX = 1, CAMZ = 1;
const SH = () => SCX * CAMZ;

/* ---------------- 文字 ---------------- */
const font = o => `${o.w || 700} ${o.s || 30}px ${F[o.f || 'cjk']}`;
function text(g, s, x, y, o = {}) {
  g.save();
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.font = font(o); g.textAlign = o.a || 'center'; g.textBaseline = o.b || 'middle';
  if (o.ls) g.letterSpacing = o.ls + 'px';
  if (o.shc) { g.fillStyle = o.shc; const d = o.shd || 5; g.fillText(s, x + d, y + d); } // 硬投影字
  g.fillStyle = o.c || C.ink; g.fillText(s, x, y);
  g.restore();
}
function textW(g, s, o = {}) { g.save(); g.font = font(o); if (o.ls) g.letterSpacing = o.ls + 'px'; const w = g.measureText(s).width; g.restore(); return w; }

/* ---------------- 基础形状 ---------------- */
function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; }
/* 实心积木：build() 建路径 → 硬投影填充 → 墨线描边。o: sh 投影距离(0 关闭)、lw、stroke、dash、al */
function solid(g, build, fill, o = {}) {
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  build();
  const sd = o.sh ?? 7;
  if (sd && fill) { g.shadowColor = o.shc || C.ink; g.shadowBlur = 0; g.shadowOffsetX = sd * SH(); g.shadowOffsetY = sd * SH(); }
  if (fill) { g.fillStyle = fill; g.fill(); }
  noShadow(g);
  if (o.lw !== 0) { g.lineWidth = o.lw ?? 4; g.strokeStyle = o.stroke || C.ink; g.lineJoin = 'miter'; if (o.dash) { g.setLineDash(o.dash); g.lineDashOffset = o.off || 0; } g.stroke(); }
  g.restore();
}
const box = (g, x, y, w, h, fill, o = {}) => { if (w > 0 && h > 0) solid(g, () => { g.beginPath(); o.r ? g.roundRect(x, y, w, h, o.r) : g.rect(x, y, w, h); }, fill, o); };
const disc = (g, x, y, r, fill, o = {}) => { if (r > 0) solid(g, () => { g.beginPath(); g.arc(x, y, r, 0, TAU); }, fill, o); };
/* 三角：dir 0 尖朝上，1 朝右，2 朝下，3 朝左；s 为外接正方形边长 */
function tri(g, x, y, s, fill, o = {}) {
  if (s <= 0) return;
  solid(g, () => {
    g.beginPath(); const h = s / 2, a = (o.dir || 0) * TAU / 4 + (o.rot || 0);
    const P = [[0, -h], [h, h], [-h, h]].map(([px, py]) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)]);
    g.moveTo(...P[0]); g.lineTo(...P[1]); g.lineTo(...P[2]); g.closePath();
  }, fill, o);
}
/* 半圆 / 四分之一圆：以 (x,y) 为圆心，a0 为起始角 */
const half = (g, x, y, r, fill, a0 = Math.PI, o = {}) => { if (r > 0) solid(g, () => { g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0, a0 + Math.PI); g.closePath(); }, fill, o); };
const quarter = (g, x, y, r, fill, a0 = Math.PI, o = {}) => { if (r > 0) solid(g, () => { g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0, a0 + Math.PI / 2); g.closePath(); }, fill, o); };
function dot(g, x, y, r, c, al = 1) { if (r <= 0) return; g.save(); g.globalAlpha *= al; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = c; g.fill(); g.restore(); }
function ring(g, x, y, r, c, lw = 3, al = 1, a0 = -TAU / 4, a1 = a0 + TAU) {
  if (r <= 0) return; g.save(); g.globalAlpha *= al; g.beginPath(); g.arc(x, y, r, a0, a1); g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'butt'; g.stroke(); g.restore();
}
function path(g, pts, o = {}) {
  if (pts.length < 2) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.strokeStyle = o.c || C.ink; g.lineWidth = o.w || 4; g.lineCap = o.cap || 'square'; g.lineJoin = 'miter';
  if (o.dash) { g.setLineDash(o.dash); g.lineDashOffset = o.off || 0; }
  g.stroke(); g.restore();
}
/* 画到一部分的折线（p∈[0,1]） */
function partial(pts, p) {
  const L = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(d); tot += d; }
  let need = tot * clamp(p); const out = [pts[0]];
  for (let i = 1; i < pts.length && need > 0; i++) {
    const d = L[i - 1];
    if (need >= d) { out.push(pts[i]); need -= d; }
    else { const k = need / d; out.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]); need = 0; }
  }
  return out;
}
/* 三角箭头（实心积木三角） */
function arrowHead(g, x, y, ang, c, s = 22, al = 1) {
  g.save(); g.globalAlpha *= al; g.translate(x, y); g.rotate(ang); g.beginPath();
  g.moveTo(2, 0); g.lineTo(-s, -s * .62); g.lineTo(-s, s * .62); g.closePath(); g.fillStyle = c; g.fill(); g.restore();
}
function arrow(g, pts, o = {}) {
  const q = partial(pts, o.p ?? 1); if (q.length < 2) return;
  const a = q[q.length - 2], b = q[q.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hs = o.hs || 22;
  const q2 = q.slice(); q2[q2.length - 1] = [b[0] - Math.cos(ang) * hs * .8, b[1] - Math.sin(ang) * hs * .8];
  path(g, q2, o);
  if ((o.p ?? 1) > .02) arrowHead(g, b[0], b[1], ang, o.c || C.ink, hs, o.al ?? 1);
}
/* 以 (x,y) 为中心缩放/旋转后绘制 */
function at(g, x, y, s, fn, o = {}) {
  if (s <= .001 || (o.al != null && o.al <= .001)) return;
  g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); g.scale(s * (o.sx || 1), s * (o.sy || 1));
  if (o.al != null) g.globalAlpha *= clamp(o.al);
  fn(); g.restore();
}
const bez = (a, m, b, u) => { const v = 1 - u; return [v * v * a[0] + 2 * v * u * m[0] + u * u * b[0], v * v * a[1] + 2 * v * u * m[1] + u * u * b[1]]; };
/* 抛物线飞行位置：a→b，顶点抬高 lift */
function arcPos(a, b, u, lift = 120) { return bez(a, [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift], b, u); }

/* ---------------- 小图标与标签 ---------------- */
function icCheck(g, x, y, s, c = '#fff', p = 1, lw) {
  path(g, partial([[x - s * .42, y], [x - s * .1, y + s * .32], [x + s * .46, y - s * .36]], p), { c, w: lw || s * .2, cap: 'square' });
}
function icCross(g, x, y, s, c = '#fff', p = 1, lw) {
  const k = s * .38;
  path(g, partial([[x - k, y - k], [x + k, y + k]], clamp(p * 2)), { c, w: lw || s * .2 });
  path(g, partial([[x + k, y - k], [x - k, y + k]], clamp(p * 2 - 1)), { c, w: lw || s * .2 });
}
/* 圆形徽标：勾/叉/问号 */
function badge(g, x, y, r, c, kind, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    disc(g, 0, 0, r, c, { sh: 6 });
    if (kind === 'check') icCheck(g, 0, 2, r * 1.1, onCol(c), 1, r * .24);
    else if (kind === 'cross') icCross(g, 0, 0, r * 1.1, onCol(c), 1, r * .24);
    else text(g, kind, 0, 3, { f: 'disp', w: 900, s: r * 1.3, c: onCol(c) });
  }, { rot: o.rot, al: o.al });
}
/* 色块标签：弹出 + 微转 */
function tagB(g, s, x, y, col, p = 1, o = {}) {
  at(g, x, y, pop(p), () => {
    const fs = o.fs || 28, ww = textW(g, s, { s: fs, w: 900, f: o.f }) + 36 + (o.icon ? fs : 0), hh = fs + 24;
    box(g, -ww / 2, -hh / 2, ww, hh, col, { sh: o.sh ?? 6 });
    if (o.icon === 'check') icCheck(g, -ww / 2 + 18 + fs * .45, 1, fs * .8, onCol(col), 1, fs * .17);
    if (o.icon === 'cross') icCross(g, -ww / 2 + 18 + fs * .45, 0, fs * .8, onCol(col), 1, fs * .17);
    text(g, s, (o.icon ? fs / 2 : 0), 2, { s: fs, w: 900, f: o.f, c: o.tc || onCol(col) });
  }, { rot: o.rot || 0, al: o.al });
}
/* 小号外框标签（右上角“⚠ 机制演绎”等）：右对齐到 xr，返回宽度 */
function tagSmall(g, s, xr, y, c) {
  const w = textW(g, s, { s: 24, w: 700 }) + 34;
  box(g, xr - w, y - 22, w, 44, c, { sh: 4, lw: 3 });
  text(g, s, xr - w / 2, y + 1, { s: 24, w: 700, c: onCol(c) });
  return w;
}

/* ---------------- 卡片图标（原点在中心，s=1 约 100×100） ---------------- */
function icon(g, kind, x, y, s, lt = 0, o = {}) {
  const on = o.on ?? 1;
  at(g, x, y, s, () => {
    switch (kind) {
      case 'lamp': // 灯：黄圆灯泡 + 黑灯座 + 光芒
        for (let i = 0; i < 5; i++) { const a = -Math.PI * .9 + i * Math.PI * .2, r0 = 44, r1 = 56 + 4 * Math.sin(lt * 3 + i); if (on > .5) path(g, [[Math.cos(a) * r0, -8 + Math.sin(a) * r0], [Math.cos(a) * r1, -8 + Math.sin(a) * r1]], { w: 6 }); }
        disc(g, 0, -8, 34, on > .5 ? C.yellow : C.greyL, { sh: 4 }); box(g, -16, 26, 32, 20, C.ink, { sh: 0, lw: 0 }); break;
      case 'switch': { // 开关：轨道矩形 + 圆钮
        box(g, -46, -24, 92, 48, on > .5 ? C.red : C.greyL, { sh: 4 });
        disc(g, lerp(-22, 22, on), 0, 18, C.white, { sh: 0 }); break; }
      case 'ac': // 空调：蓝方块 + 三道风口
        box(g, -42, -36, 84, 64, C.blue, { sh: 4 });
        for (let i = 0; i < 3; i++) box(g, -28, -20 + i * 16, 56 - i * 10 + 4 * Math.sin(lt * 2 + i), 7, '#fff', { sh: 0, lw: 0 });
        disc(g, 30, 38, 10, C.red, { sh: 0, lw: 3 }); break;
      case 'curtain': // 窗帘：黑色轨道 + 两片帘
        box(g, -46, -44, 92, 10, C.ink, { sh: 0, lw: 0 });
        box(g, -42, -34, 36 + 3 * Math.sin(lt * 1.5), 76, C.blue, { sh: 4 }); box(g, 6 - 3 * Math.sin(lt * 1.5), -34, 36, 76, C.blueL, { sh: 4 }); break;
      case 'scene': tri(g, 4, 0, 78, C.red, { dir: 1, sh: 4 }); break; // 场景：红色播放三角
      case 'album': // 相册：画框 + 太阳 + 山
        box(g, -46, -36, 92, 72, C.white, { sh: 4 });
        g.save(); g.beginPath(); g.rect(-44, -34, 88, 68); g.clip();
        disc(g, 18, -12, 12, C.yellow, { sh: 0, lw: 3 }); tri(g, -10, 18, 52, C.blue, { sh: 0, lw: 3 }); g.restore(); break;
      case 'music': // 音乐：同心半圆声波 + 黑点
        for (let i = 2; i >= 0; i--) half(g, -24, 0, 18 + i * 16, [C.red, C.white, C.red][i], -Math.PI / 2, { sh: i === 2 ? 4 : 0, lw: 4 });
        disc(g, -24, 0, 9, C.ink, { sh: 0 }); break;
      case 'energy': // 能耗：三根柱
        [[C.yellow, 40], [C.red, 66], [C.blue, 50]].forEach(([c, h], i) => box(g, -42 + i * 30, 36 - h - 6 * Math.sin(lt * 2 + i), 24, h + 6 * Math.sin(lt * 2 + i), c, { sh: 4 })); break;
      case 'lock': // 门锁：锁梁 + 黄色锁体
        ring(g, 0, -12, 22, C.ink, 9, 1, Math.PI, TAU); box(g, -32, -12, 64, 50, C.yellow, { sh: 4 }); disc(g, 0, 10, 7, C.ink, { sh: 0, lw: 0 }); break;
      case 'thermo': // 温控：红色半圆表盘 + 指针
        half(g, 0, 18, 44, C.red, Math.PI, { sh: 4 }); { const a = Math.PI * (1.2 + .25 * Math.sin(lt)); path(g, [[0, 18], [Math.cos(a) * 34, 18 + Math.sin(a) * 34]], { w: 6 }); } disc(g, 0, 18, 7, C.ink, { sh: 0, lw: 0 }); break;
      case 'camera': // 摄像头：灰机身 + 黑镜头 + 红灯
        box(g, -44, -30, 88, 60, C.greyL, { sh: 4 }); disc(g, -4, 0, 20, C.ink, { sh: 0, lw: 0 }); disc(g, -4, 0, 8, C.blue, { sh: 0, lw: 0 });
        dot(g, 30, -16, 6, C.red, .5 + .5 * Math.sin(lt * 4)); break;
      case 'socket': // 插座：白方 + 两孔
        box(g, -38, -38, 76, 76, C.white, { sh: 4 }); box(g, -16, -14, 8, 26, C.ink, { sh: 0, lw: 0 }); box(g, 8, -14, 8, 26, C.ink, { sh: 0, lw: 0 });
        quarter(g, 38, 38, 26, C.red, Math.PI, { sh: 0, lw: 3 }); break;
      case 'header': // 头部卡：黄太阳 + 黑条
        disc(g, -18, -8, 26, C.yellow, { sh: 4 }); box(g, 14, -18, 34, 10, C.ink, { sh: 0, lw: 0 }); box(g, 14, 2, 22, 10, C.ink, { sh: 0, lw: 0 }); break;
      default: box(g, -36, -36, 72, 72, C.greyL, { sh: 4 });
    }
  }, { al: o.al, rot: o.rot });
}

/* ---------------- 积木卡片 ----------------
 * (x,y,w,h) 卡片外框；o: kind 图标、name 名字（≥24px，卡太小时不写）、acc 顶条颜色、on、al、sh、tag 右下角尺寸标 */
function bcard(g, x, y, w, h, o = {}) {
  if (w <= 2 || h <= 2) return;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  box(g, x, y, w, h, o.fill || C.white, { sh: o.sh ?? 7, lw: o.lw ?? 4 });
  if (o.acc) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); box(g, x, y, w, Math.min(18, h * .16), o.acc, { sh: 0, lw: 0 }); g.restore(); path(g, [[x, y + Math.min(18, h * .16)], [x + w, y + Math.min(18, h * .16)]], { w: 3 }); }
  const horiz = w >= h * 1.55, b = horiz ? Math.min(h * .62, w * .42) : Math.min(w * .62, h * .5);
  const s = b / 110, lt = o.lt || 0;
  const ix = horiz ? x + 16 + b / 2 + h * .06 : x + w / 2, iy = horiz ? y + h / 2 + 6 : y + h * .44;
  if (o.kind) icon(g, o.kind, ix, iy, s, lt, { on: o.on });
  const fs = o.fs || Math.round(clamp(h * .22, 24, 36));
  if (o.name && (horiz ? h >= 90 : w >= 120)) {
    if (horiz) text(g, o.name, ix + b / 2 + 22, y + h / 2 + 4, { s: fs, w: 900, a: 'left' });
    else text(g, o.name, x + w / 2, y + h - fs * .9, { s: fs, w: 900 });
  }
  if (o.tag) text(g, o.tag, x + w - 14, y + h - 22, { f: 'disp', s: 26, w: 900, a: 'right', c: C.ink2 });
  g.restore();
}

/* ---------------- 积木厂房（工厂）：原点在底边中点，s=1 约 170×150 ---------------- */
function factory(g, x, y, s, col, lt, o = {}) {
  at(g, x, y, s, () => {
    for (let k = 0; k < 3; k++) { // 烟：三团圆，持续上升
      const ph = (lt * .45 + k / 3 + (o.seed || 0)) % 1;
      disc(g, 54 + ph * 26, -150 - ph * 70, 8 + ph * 12, C.white, { sh: 0, lw: 3, al: (1 - ph) * .9 });
    }
    box(g, 42, -158, 24, 70, C.ink, { sh: 0, lw: 0 });
    solid(g, () => { g.beginPath(); const tw = 160 / 3; g.moveTo(-80, -88); for (let i = 0; i < 3; i++) { g.lineTo(-80 + i * tw, -128); g.lineTo(-80 + (i + 1) * tw, -88); } g.closePath(); }, C.ink, { sh: 0, lw: 0 });
    solid(g, () => { g.beginPath(); const tw = 160 / 3; g.moveTo(-80, -88); for (let i = 0; i < 3; i++) { g.lineTo(-80 + i * tw + 4, -122); g.lineTo(-80 + (i + 1) * tw, -88); } g.closePath(); }, o.roof || C.yellow, { sh: 0, lw: 0 });
    box(g, -80, -88, 160, 88, col, { sh: 6 });
    box(g, -20, -50, 40, 50, C.ink, { sh: 0, lw: 0 });
    const lit = o.busy ? (Math.floor(lt * 6) % 2) : 1;
    box(g, -62, -70, 26, 22, lit ? C.yellow : C.white, { sh: 0, lw: 3 }); box(g, 36, -70, 26, 22, C.white, { sh: 0, lw: 3 });
  }, { al: o.al });
  if (o.label) text(g, o.label, x, y + 26 * Math.max(s, .6) + 6, { f: 'mono', s: o.fs || 24, w: 700, al: o.al });
}

/* ---------------- 网格格子：cols×rows 个小方块依次弹出（p 0→1） ---------------- */
function cells(g, x, y, cols, rows, cell, p, col, o = {}) {
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    const cx = i % cols, cy = Math.floor(i / cols), k = clamp(p * (n + 3) - i - (o.order ? hash(i * 3.7) * 3 : 0));
    if (k <= 0) continue;
    const ss = (cell - 8) * pop(k);
    box(g, x + cx * cell + cell / 2 - ss / 2, y + cy * cell + cell / 2 - ss / 2, ss, ss, col, { sh: 0, lw: 2.5 });
  }
  if (o.frame !== false) box(g, x - 6, y - 6, cols * cell + 12, rows * cell + 12, null, { lw: 4, dash: o.dash });
}

/* ---------------- IDE 小窗 ----------------
 * 直角窗口、黑标题栏（红圆/黄方/蓝三角按钮 + 文件名），浅色代码区、行号栏、diff 行着色。
 * 没有作者 / blame 列（原笔记截图带同事署名，本片的代码窗口一律不画这类信息）。
 * lines: [{t 文本, k ' '|'+'|'-'|'@', p 可见比例(打字), hk 行高比例(插入动画), hl 高亮色, dim}]
 * o: title 文件名, tag 右上角小字, s 字号, lh 行高, n0 起始行号, al, sh, lt（光标闪烁）, caret */
const KW = new Set(['if', 'else', 'val', 'var', 'fun', 'class', 'interface', 'init', 'by', 'return', 'null', 'when', 'is', 'in', 'override', 'object', 'true', 'false', 'let']);
function codeTokens(s) {
  const toks = s.match(/"(?:\\.|[^"\\])*"?|\/\/.*|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\s+|./g) || [];
  return toks.map((t, i) => {
    let j = i + 1; while (j < toks.length && /^\s+$/.test(toks[j])) j++;
    let c = C.ink, w = 400;
    if (t.startsWith('//')) c = C.grey;
    else if (t[0] === '"') c = toks[j] === ':' ? C.blue : C.ochre;
    else if (/^\d/.test(t)) c = C.ochre;
    else if (KW.has(t)) { c = C.red; w = 700; }
    else if (/^[A-Z]/.test(t)) { c = C.blue; w = 700; }
    else if (/^\s+$/.test(t)) c = null;
    else if (!/^[a-z_]/i.test(t)) c = C.ink2;
    return { s: t, c, w };
  });
}
function ide(g, x, y, w, h, lines, o = {}) {
  const s = o.s || 26, lh = o.lh || 46, bar = 54, gut = o.gutter === false ? 0 : 70;
  g.save(); if (o.al != null) g.globalAlpha *= clamp(o.al);
  box(g, x, y, w, h, C.white, { sh: o.sh ?? 10, lw: 0 });
  g.fillStyle = C.ink; g.fillRect(x, y, w, bar);
  disc(g, x + 30, y + bar / 2, 10, C.red, { sh: 0, lw: 0 });
  box(g, x + 50, y + bar / 2 - 9, 18, 18, C.yellow, { sh: 0, lw: 0 });
  tri(g, x + 92, y + bar / 2 + 1, 21, C.blue, { sh: 0, lw: 0 });
  text(g, o.title || '', x + 122, y + bar / 2 + 1, { f: 'mono', s: 24, w: 700, c: '#fff', a: 'left' });
  if (o.tag) text(g, o.tag, x + w - 22, y + bar / 2 + 1, { s: 24, w: 700, c: rgba('#ffffff', .62), a: 'right' });
  if (gut) { g.fillStyle = C.paper2; g.fillRect(x, y + bar, gut, h - bar); }
  g.save(); g.beginPath(); g.rect(x, y + bar, w, h - bar); g.clip();
  let cy = y + bar + 18 + (o.scroll || 0), num = o.n0 ?? 1, caret = null;
  for (const ln of lines) {
    const hk = ln.hk ?? 1; if (hk <= 0) continue;
    const lhh = lh * hk, k = ln.k || ' ', vis = ln.p ?? 1;
    g.save(); g.beginPath(); g.rect(x, cy, w, lhh); g.clip();
    const bg = k === '+' ? C.blueL : k === '-' ? C.redL : k === '@' ? C.greyL : null, bar2 = k === '+' ? C.blue : k === '-' ? C.red : null;
    if (bg) { g.fillStyle = bg; g.fillRect(x + gut, cy, (w - gut) * (k === '@' ? 1 : eo(clamp(hk * 1.4 - .2))), lhh); }
    if (bar2) { g.fillStyle = bar2; g.fillRect(x + gut, cy, 6, lhh); }
    if (ln.hl) { g.fillStyle = rgba(ln.hl, .2 * (ln.hlA ?? 1)); g.fillRect(x + gut, cy, (w - gut) * (ln.hlW ?? 1), lhh); }
    const base = cy + lh * .5 + 1;
    if (gut) {
      const sign = k === '+' ? '+' : k === '-' ? '−' : '';
      if (sign) text(g, sign, x + gut - 16, base, { f: 'mono', s: 26, w: 700, c: bar2, a: 'right' });
      else if (k !== '@' && o.nums !== false) text(g, String(num), x + gut - 16, base, { f: 'mono', s: 24, w: 400, c: C.grey, a: 'right' });
    }
    if (k !== '-' && k !== '@') num++;
    // 代码文字：按可见比例打字
    const chars = Array.from(ln.t); let budget = Math.round(chars.length * clamp(vis)), tx = x + gut + 22;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    if (ln.dim) g.globalAlpha *= .4;
    for (const tk of (k === '@' ? [{ s: ln.t, c: C.grey, w: 700 }] : codeTokens(ln.t))) {
      if (budget <= 0) break;
      const part = Array.from(tk.s).slice(0, budget).join(''); budget -= Array.from(part).length;
      g.font = font({ f: 'mono', s, w: tk.w || 400 });
      if (tk.c) { g.fillStyle = tk.c; g.fillText(part, tx, base); }
      tx += g.measureText(part).width;
    }
    if (vis > 0 && vis < 1) caret = [tx, base];
    g.restore();
    cy += lhh;
  }
  if (!caret && o.caret) caret = o.caret;
  if (caret && Math.floor((o.lt || 0) * 2.4) % 2 === 0) { g.fillStyle = C.ink; g.fillRect(caret[0] + 2, caret[1] - s * .55, 4, s * 1.1); }
  g.restore();
  g.lineWidth = 4; g.strokeStyle = C.ink; g.strokeRect(x, y, w, h);
  path(g, [[x, y + bar], [x + w, y + bar]], { w: 4 });
  g.restore();
}
/* 代码行里某一段文字的 x 范围（用于高亮/飞出），col 为字符下标 */
function codeX(g, ln, col, x, o = {}) {
  const s = o.s || 26, gut = o.gutter === false ? 0 : 70;
  g.save(); g.font = font({ f: 'mono', s, w: 400 }); const w = g.measureText(Array.from(ln).slice(0, col).join('')).width; g.restore();
  return x + gut + 22 + w;
}
const charW = s => s * .602; // DejaVu Sans Mono 字宽

/* ---------------- 智能屏外框（看板） ---------------- */
function screenFrame(g, x, y, w, h, lt, o = {}) {
  box(g, x - 22, y - 22, w + 44, h + 44, C.ink, { sh: 10, lw: 0 });
  box(g, x, y, w, h, o.fill || C.paper, { sh: 0, lw: 0 });
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const cell = o.cell || 40;
  g.strokeStyle = rgba(C.ink, .07); g.lineWidth = 1.5;
  for (let xx = x + cell; xx < x + w; xx += cell) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); }
  for (let yy = y + cell; yy < y + h; yy += cell) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
  g.restore();
  dot(g, x + w / 2, y - 11, 5, C.grey, .9);
}

/* ---------------- 效果 ---------------- */
function burst(g, x, y, k, n = 12, r = 140) { // 积木碎屑爆发：小方块/圆/三角，k = 爆发后经过的秒数
  if (k < 0 || k > .9) return;
  const cols = [C.red, C.yellow, C.blue, C.ink];
  for (let i = 0; i < n; i++) {
    const ang = i / n * TAU + hash(i * 3.1) * .5, sp = r * (.6 + hash(i * 7.7) * .6), e = eo(k / .9);
    const px = x + Math.cos(ang) * sp * e, py = y + Math.sin(ang) * sp * e + 80 * k * k, sz = (14 + hash(i) * 10) * (1 - e * .6), c = cols[i % 4];
    g.save(); g.globalAlpha *= 1 - e; g.translate(px, py); g.rotate(e * 3 * (hash(i * 2) - .5));
    const kind = i % 3; if (kind === 0) box(g, -sz / 2, -sz / 2, sz, sz, c, { sh: 0, lw: 2.5 }); else if (kind === 1) disc(g, 0, 0, sz / 2, c, { sh: 0, lw: 2.5 }); else tri(g, 0, 0, sz, c, { sh: 0, lw: 2.5 });
    g.restore();
  }
}
/* 方形涟漪：落地时一圈墨线方框扩散 */
function ripple(g, x, y, k, w0 = 60, h0 = 60, grow = 60, d = .6) {
  if (k < 0 || k >= d) return; const e = eo(k / d);
  g.save(); g.globalAlpha *= 1 - k / d; g.strokeStyle = C.ink; g.lineWidth = 4; g.strokeRect(x - w0 / 2 - grow * e, y - h0 / 2 - grow * e, w0 + grow * 2 * e, h0 + grow * 2 * e); g.restore();
}

/* ---------------- 镜头 ---------------- */
/* 关键帧 [[t, cx, cy, z], ...]，相邻关键帧之间用 eio 插值 */
function camAt(keys, lt) {
  if (!keys || !keys.length) return [W / 2, H / 2, 1];
  if (lt <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (lt <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], k = eio((lt - a[0]) / (b[0] - a[0]));
      return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
    }
  }
  return keys[keys.length - 1].slice(1);
}

/* ---------------- 纸面质感、背景、后期 ---------------- */
function prepareStyle({ mk, cw, ch }) {
  const paper = mk(cw, ch), p = paper.getContext('2d'); p.scale(cw / W, ch / H);
  const lg = p.createLinearGradient(0, 0, W * .3, H); lg.addColorStop(0, '#F5F0E7'); lg.addColorStop(1, '#ECE4D5');
  p.fillStyle = lg; p.fillRect(0, 0, W, H);
  // 构成网格：60 px 细线，每 4 格一根稍重
  for (let x = 0; x <= W; x += 60) { p.fillStyle = rgba(C.ink, x % 240 === 0 ? .055 : .028); p.fillRect(x, 0, 1.5, H); }
  for (let y = 0; y <= H; y += 60) { p.fillStyle = rgba(C.ink, y % 240 === 0 ? .055 : .028); p.fillRect(0, y, W, 1.5); }
  // 纸纤维：确定性细噪点 + 少量短纤维
  for (let i = 0; i < 11000; i++) { const x = hash(i * 1.17) * W, y = hash(i * 2.31 + 9) * H; p.fillStyle = rgba(C.ink, .016 + hash(i * 5.3) * .028); p.fillRect(x, y, 1.4, 1.4); }
  p.lineWidth = 1;
  for (let i = 0; i < 260; i++) { const x = hash(i * 7.1) * W, y = hash(i * 3.9 + 2) * H, a = hash(i * 1.3) * TAU, l = 6 + hash(i * 9.2) * 14; p.strokeStyle = rgba('#7A6A50', .06 + hash(i) * .05); p.beginPath(); p.moveTo(x, y); p.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); p.stroke(); }
  const vign = mk(cw, ch), v = vign.getContext('2d'); v.scale(cw / W, ch / H);
  const vg = v.createRadialGradient(960, 520, 460, 960, 540, 1250); vg.addColorStop(0, 'rgba(60,40,20,0)'); vg.addColorStop(1, 'rgba(60,40,20,.2)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  const grain = [];
  for (let k = 0; k < 4; k++) {
    const gt = mk(256, 256), gg = gt.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < 65536; i++) { const n = Math.floor(hash(i * 1.37 + k * 911.3) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = n; id.data[i * 4 + 3] = 255; }
    gg.putImageData(id, 0, 0); grain.push(gt);
  }
  return { paper, vign, grain };
}
/* 背景：纸面 + 三块超大几何形缓慢漂移旋转 + 积木尘埃 */
function drawBackground(g, { cache, t }) {
  g.drawImage(cache.paper, 0, 0, W, H);
  g.save(); g.globalAlpha = .07;
  { const x = 250 + wob(t, .013, 90), y = 880 + wob(t, .011, 50, 3); g.beginPath(); g.arc(x, y, 330, 0, TAU); g.fillStyle = C.red; g.fill(); }
  { const a = Math.PI / 2 + wob(t, .009, .25, 1); g.beginPath(); g.moveTo(1920, 0); g.arc(1920, 0, 560 + wob(t, .02, 20), a, a + Math.PI / 2); g.closePath(); g.fillStyle = C.yellow; g.globalAlpha = .12; g.fill(); }
  { g.globalAlpha = .06; const x = 1620 + wob(t, .012, 70, 2), y = 900 + wob(t, .015, 40), r = .25 + wob(t, .008, .2); g.save(); g.translate(x, y); g.rotate(r); g.beginPath(); g.moveTo(0, -300); g.lineTo(280, 200); g.lineTo(-280, 200); g.closePath(); g.fillStyle = C.blue; g.fill(); g.restore(); }
  g.restore();
  // 漂浮的积木尘埃
  for (let i = 0; i < 26; i++) {
    const x = (hash(i * 3.3) * W + t * (6 + hash(i) * 12)) % W, y = (hash(i * 9.1) * H - t * (5 + hash(i * 2) * 8) + H * 10) % H;
    const sz = 4 + hash(i * 4.4) * 6, c = [C.red, C.yellow, C.blue, C.ink][i % 4], al = .1 + .06 * Math.sin(t * .8 + i);
    g.save(); g.globalAlpha = al; g.translate(x, y); g.rotate(t * (hash(i * 5) - .5));
    if (i % 3 === 0) { g.fillStyle = c; g.fillRect(-sz / 2, -sz / 2, sz, sz); } else if (i % 3 === 1) { g.beginPath(); g.arc(0, 0, sz / 2, 0, TAU); g.fillStyle = c; g.fill(); }
    else { g.beginPath(); g.moveTo(0, -sz / 2); g.lineTo(sz / 2, sz / 2); g.lineTo(-sz / 2, sz / 2); g.closePath(); g.fillStyle = c; g.fill(); }
    g.restore();
  }
}
/* 后期：暗角 + 印刷颗粒 */
function postFX(g, { cache, t, cw, ch }) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cache.vign, 0, 0);
  const fr = Math.floor(t * FPS), gp = g.createPattern(cache.grain[fr % 4], 'repeat');
  g.globalAlpha = .065; g.globalCompositeOperation = 'overlay';
  g.translate(Math.floor(hash(fr) * 256), Math.floor(hash(fr + 7) * 256)); g.scale(Math.max(1, SCX * .75), Math.max(1, SCX * .75));
  g.fillStyle = gp; g.fillRect(-512, -512, cw + 1024, ch + 1024);
  g.restore();
}
