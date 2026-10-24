import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, main, number, output, readJSON, writeJSON } from './common.mjs';

export function makePlan(cfg, timeline, { scale = 2, segments = 10, to = '' } = {}) {
  scale = number(scale, 'scale', 1, 2, true);
  segments = number(segments, 'segments', 1, 20, true);
  const fps = number(cfg.fps, 'fps', 1, 120, true);
  const sourceDuration = number(timeline.duration, 'FILM.duration', Number.MIN_VALUE, 6 * 3600);
  const requestedDuration = to === '' ? sourceDuration : number(to, 'to', Number.MIN_VALUE, sourceDuration);
  // 向下取整，保证 --to 不会多渲染。极小的补偿只修正浮点整帧误差。
  const totalFrames = Math.floor(requestedDuration * fps + 1e-7);
  if (totalFrames < 1) throw new Error('渲染时长不足一帧');
  const count = Math.min(segments, totalFrames);
  const parts = Array.from({ length: count }, (_, i) => {
    const fromFrame = Math.floor(i * totalFrames / count), toFrame = Math.floor((i + 1) * totalFrames / count);
    return { id: String(i).padStart(4, '0'), fromFrame, toFrame, frames: toFrame - fromFrame, from: fromFrame / fps, to: toFrame / fps };
  });
  return { ...cfg, fps, scale, sourceDuration, requestedDuration, duration: totalFrames / fps, totalFrames, requestedSegments: segments, segments: parts };
}

export function validatePlan(plan) {
  const expected = makePlan(plan, { duration: plan.sourceDuration }, { scale: plan.scale, segments: plan.requestedSegments, to: plan.requestedDuration });
  for (const key of ['duration', 'totalFrames', 'segments']) {
    if (JSON.stringify(plan[key]) !== JSON.stringify(expected[key])) throw new Error(`plan.json 的 ${key} 不一致，请重新规划`);
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(() => {
  const [project, timelineFile, outFile, ...args] = process.argv.slice(2);
  if (!outFile) throw new Error('用法：node plan_segments.mjs <project> <timeline.json> <plan.json> [--scale 2] [--segments 10] [--to 秒]');
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--scale', '--segments', '--to'].includes(args[i]) || args[i + 1] === undefined) throw new Error('分段参数错误');
    opts[args[i].slice(2)] = args[i + 1];
  }
  const plan = makePlan(config(project), readJSON(timelineFile), opts);
  writeJSON(outFile, plan); output('matrix', JSON.stringify({ include: plan.segments }));
  console.log(`${plan.totalFrames} 帧 / ${plan.duration} 秒 → ${plan.segments.length} 段，已写入 ${outFile}`);
});
