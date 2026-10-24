/* 检查各段 → concat demuxer 无损拼接 → 混音 → 解码检查帧数和 PTS。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { main, probe, readJSON, run } from './common.mjs';
import { validatePlan } from './plan_segments.mjs';

const ratio = s => { const [a, b = 1] = String(s).split('/').map(Number); return a / b; };
const near = (actual, expected, tolerance, label) => {
  if (!Number.isFinite(Number(actual)) || Math.abs(Number(actual) - expected) > tolerance) throw new Error(`${label} 不符：实际 ${actual}，预期 ${expected}（容差 ${tolerance}）`);
};
export function checkVideo(file, plan, { frames = plan.totalFrames, audio = false, decode = false } = {}) {
  const data = probe(file, decode), videos = data.streams.filter(s => s.codec_type === 'video'), audios = data.streams.filter(s => s.codec_type === 'audio');
  if (videos.length !== 1 || audios.length !== (audio ? 1 : 0)) throw new Error(`${file} 音视频流数量不符`);
  const v = videos[0], duration = frames / plan.fps;
  if (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' || v.width !== 1920 * plan.scale || v.height !== 1080 * plan.scale) throw new Error(`${file} 编码或分辨率不符`);
  near(ratio(v.avg_frame_rate), plan.fps, 1e-8, `${file} 帧率`);
  near(v.nb_frames, frames, 0, `${file} 容器帧数`);
  near(v.duration, duration, 0.001, `${file} 视频时长`);
  near(v.start_time, 0, 0.001, `${file} 视频起点`);
  let tolerance = 0.001;
  if (audio) {
    const a = audios[0];
    if (a.codec_name !== 'aac' || Number(a.sample_rate) !== 48000) throw new Error(`${file} 音轨必须为 48kHz AAC`);
    tolerance += 1024 / Number(a.sample_rate); // AAC 最后一个采样帧允许不足 1024 samples。
    near(a.duration, duration, tolerance, `${file} 音频时长`);
    near(a.start_time, 0, tolerance, `${file} 音频起点`);
  }
  near(data.format.duration, duration, tolerance, `${file} 容器时长`);
  if (decode) {
    near(v.nb_read_frames, frames, 0, `${file} 实际解码帧数`);
    const pts = data.frames.filter(f => f.media_type === 'video');
    near(pts.length, frames, 0, `${file} 帧时间戳数量`);
    for (let i = 0; i < pts.length; i++) near(pts[i].best_effort_timestamp_time, i / plan.fps, 0.001, `${file} 第 ${i} 帧 PTS`);
  }
  return v;
}

export function concat(plan, partsDir, outFile, audioFile) {
  validatePlan(plan);
  partsDir = path.resolve(partsDir); outFile = path.resolve(outFile);
  const expected = plan.segments.map(s => `part-${s.id}.mp4`), actual = fs.readdirSync(partsDir).filter(s => s.endsWith('.mp4')).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('分段文件缺失或混入了其他 mp4，请使用空的分段目录');
  let signature;
  for (const s of plan.segments) {
    const v = checkVideo(path.join(partsDir, `part-${s.id}.mp4`), plan, { frames: s.frames });
    const sig = JSON.stringify(['codec_name', 'profile', 'level', 'width', 'height', 'pix_fmt', 'sample_aspect_ratio', 'field_order', 'r_frame_rate', 'time_base', 'color_range', 'color_space', 'color_transfer', 'color_primaries', 'extradata_hash'].map(k => v[k]));
    if (signature && sig !== signature) throw new Error(`分段 ${s.id} 的编码参数与前段不同`);
    signature = sig;
  }
  if (audioFile) {
    audioFile = path.resolve(audioFile);
    const a = probe(audioFile).streams.find(s => s.codec_type === 'audio');
    if (!a || !Number.isFinite(Number(a.duration)) || Number(a.duration) < plan.duration - 1 / 48000) throw new Error('配乐长度不足，不能用 -shortest 截掉视频');
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-concat-'));
  try {
    // 用固定安全的临时文件名，避免 concat 对空格、引号、反斜线的转义差异。
    for (const name of expected) fs.symlinkSync(path.join(partsDir, name), path.join(tmp, name));
    const list = path.join(tmp, 'list.ffconcat');
    // MP4 的容器时长可能取整到毫秒；明确指定帧时长，防止多段累计偏移。
    fs.writeFileSync(list, 'ffconcat version 1.0\n' + expected.map((name, i) => `file '${name}'\nduration ${(plan.segments[i].frames / plan.fps).toFixed(12)}\n`).join(''));
    const joined = audioFile ? path.join(tmp, 'joined.mp4') : outFile;
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', list, '-map', '0:v:0', '-c', 'copy', '-an', '-movflags', '+faststart', joined]);
    if (audioFile) run('ffmpeg', ['-y', '-v', 'error', '-i', joined, '-i', audioFile, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', plan.duration, '-movflags', '+faststart', outFile]);
    checkVideo(outFile, plan, { audio: Boolean(audioFile), decode: true });
    console.log(`校验通过：${plan.totalFrames} 帧 / ${plan.duration} 秒 / ${1920 * plan.scale}×${1080 * plan.scale} → ${outFile}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(() => {
  const [planFile, partsDir, outFile, audioFile] = process.argv.slice(2);
  if (!outFile) throw new Error('用法：node concat.mjs <plan.json> <分段目录> <out.mp4> [audio.wav]');
  concat(readJSON(planFile), partsDir, outFile, audioFile);
});
