import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
export function run(cmd, args, options = {}) {
  const p = spawnSync(cmd, args.map(String), { cwd: root, stdio: 'inherit', ...options });
  if (p.error) throw p.error;
  if (p.status !== 0) throw new Error(`${cmd} 执行失败：${p.status ?? p.signal}`);
  return p.stdout;
}
export function probe(file, frames = false) {
  const args = ['-v', 'error', '-show_streams', '-show_format', '-show_data_hash', 'sha256'];
  if (frames) args.push('-count_frames', '-show_frames', '-show_entries', 'frame=media_type,best_effort_timestamp_time:stream:format');
  args.push('-of', 'json', file);
  return JSON.parse(run('ffprobe', args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}
export function number(value, name, min, max, integer = false) {
  const n = typeof value === 'string' && !value.trim() ? NaN : Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${name} 必须为 ${min}–${max} 内的${integer ? '整数' : '数值'}`);
  return n;
}
function inside(base, file) {
  const p = fs.realpathSync(file), rel = path.relative(fs.realpathSync(base), p);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(`路径超出目录：${file}`);
  return p;
}
export function config(project) {
  // 输入只允许一个顶层目录；先校验，再把它传给 Python / Chrome。
  if (!project || project.startsWith('.') || /[/\\\x00-\x1f\x7f]/.test(project)) throw new Error('project 必须为仓库内的一个顶层目录名');
  const dir = inside(root, path.join(root, project)), work = inside(dir, path.join(dir, 'work'));
  const manifest = readJSON(inside(work, path.join(work, 'render.json')));
  for (const [key, ext] of [['page', '.html'], ['audio', '.py']]) {
    const value = manifest[key];
    if (typeof value !== 'string' || path.isAbsolute(value) || /[\\\x00-\x1f\x7f]/.test(value) || !value.endsWith(ext)) throw new Error(`render.json 的 ${key} 必须为 work 内的相对 ${ext} 路径`);
    if (!fs.statSync(inside(work, path.resolve(work, value))).isFile()) throw new Error(`${key} 不是文件`);
  }
  if (typeof manifest.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.name)) throw new Error('name 仅允许英文字母、数字、点、下划线、短横线，且以字母或数字开头');
  return { project, page: manifest.page, audio: manifest.audio, name: manifest.name, fps: number(manifest.fps ?? 30, 'fps', 1, 120, true) };
}
export function output(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
export function main(fn) {
  try { fn(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
