/* 字幕中点与抽帧文件名：本地渲染、成片预览共用。 */
export function captionTimes(captions, duration) {
  if (!Array.isArray(captions)) throw new Error('时间线缺少 captions 数组');
  return [...new Set(captions.map(c => {
    if (!Number.isFinite(c.t0) || !Number.isFinite(c.t1) || c.t0 < 0 || c.t1 <= c.t0) throw new Error('字幕必须有合法的 t0 / t1');
    return (c.t0 + c.t1) / 2;
  }).filter(t => t < duration))].sort((a, b) => a - b);
}

export function frameName(t, names = new Map()) {
  let digits = 2, name;
  do { name = `f_${t.toFixed(digits).padStart(digits + 5, '0')}.jpg`; digits++; }
  while (names.has(name) && names.get(name) !== t && digits <= 16);
  if (names.has(name) && names.get(name) !== t) throw new Error(`抽帧文件名冲突：${t}`);
  names.set(name, t); return name;
}
