/* workflow 只负责编排；这里同样可在仓库根目录手动运行。 */
import fs from 'node:fs';
import path from 'node:path';
import { captionTimes, frameName } from './frames.mjs';
import { config, main, output, probe, readJSON, root, run, writeJSON } from './common.mjs';
import { makePlan, validatePlan } from './plan_segments.mjs';
import { checkVideo, concat } from './concat.mjs';

const renderer = path.join(root, 'tools/render/render_local.mjs');
const browserArgs = () => process.env.RENDER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
function timelineTarget(plan) {
  return { fps: plan.fps, scale: plan.scale, totalFrames: plan.totalFrames, duration: plan.duration, requestedDuration: plan.requestedDuration };
}
function previews(plan, timeline, movie, outDir) {
  const dir = path.join(outDir, 'frames'), names = new Map();
  fs.mkdirSync(dir, { recursive: true });
  const times = captionTimes(timeline.captions, plan.duration);
  if (!times.length) { times.push(0); console.log('截短区间内无字幕中点，预览首帧'); }
  for (const t of times) {
    // 取包含中点的那一帧；-ss 放在输入之前，FFmpeg 默认精确 seek。
    const seek = Math.floor(t * plan.fps) / plan.fps, file = path.join(dir, frameName(t, names));
    run('ffmpeg', ['-y', '-v', 'error', '-ss', seek, '-i', movie, '-map', '0:v:0', '-frames:v', '1', '-q:v', '2', '-update', '1', file]);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`关键帧提取失败：${t}`);
  }
  run('python3', [path.join(root, 'tools/preview/sheet.py'), dir, path.join(outDir, 'sheet')]);
}

main(() => {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'check') {
    const [project] = args;
    config(project);
    if (!process.env.SENSITIVE_WORDS?.trim()) throw new Error('SENSITIVE_WORDS 为空：请配置仓库 secret 后重试');
    const script = path.join(root, 'tools/check/sensitive.py');
    if (!fs.existsSync(script)) throw new Error('缺少 tools/check/sensitive.py，敏感词检查不能跳过');
    run('python3', [script, project]);
  } else if (action === 'prepare') {
    const [project, dir, scale = '2', segments = '10', to = ''] = args;
    if (!dir) throw new Error('prepare 需要 project 和输出目录');
    const cfg = config(project), work = path.join(root, project, 'work'), build = path.resolve(dir);
    // 在启动浏览器前拦截不合法输入；真正的 to 上限由导出的时间线决定。
    makePlan(cfg, { duration: 6 * 3600 }, { scale, segments, to });
    fs.mkdirSync(build, { recursive: true });
    const timelineFile = path.join(build, 'timeline.json');
    run(process.execPath, [renderer, path.join(work, cfg.page), timelineFile, '--scale', '1', ...browserArgs()]);
    const timeline = readJSON(timelineFile), plan = makePlan(cfg, timeline, { scale, segments, to });
    timeline.render = timelineTarget(plan); // 保留 FILM.duration 和完整内容，供依赖后半段场景的配乐脚本使用。
    writeJSON(timelineFile, timeline); writeJSON(path.join(build, 'plan.json'), plan);
    const fullAudio = path.join(build, 'audio-full.wav'), audio = path.join(build, 'audio.wav');
    run('python3', [path.join(work, cfg.audio), timelineFile, fullAudio], { cwd: work, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0' } });
    const a = probe(fullAudio).streams.find(s => s.codec_type === 'audio');
    if (!a || !Number.isFinite(Number(a.duration)) || Number(a.duration) < plan.duration - 1 / 48000) throw new Error('配乐脚本输出的音轨长度不足');
    run('ffmpeg', ['-y', '-v', 'error', '-i', fullAudio, '-map', '0:a:0', '-t', plan.duration, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', audio]);
    fs.unlinkSync(fullAudio);
    output('matrix', JSON.stringify({ include: plan.segments })); output('name', plan.name);
    console.log(`${plan.totalFrames} 帧 / ${plan.duration} 秒，${plan.segments.length} 个 runner，产物 → ${build}`);
  } else if (action === 'render') {
    const [planFile, id, dir] = args;
    if (!dir) throw new Error('render 需要 plan.json、分段 id 和输出目录');
    const plan = validatePlan(readJSON(planFile)), cfg = config(plan.project), part = plan.segments.find(s => s.id === id);
    if (!part) throw new Error(`找不到分段 ${id}`);
    for (const key of Object.keys(cfg)) if (cfg[key] !== plan[key]) throw new Error('清单与 plan.json 不一致');
    fs.mkdirSync(dir, { recursive: true });
    const movie = path.resolve(dir, `part-${id}.mp4`);
    run(process.execPath, [renderer, path.join(root, plan.project, 'work', plan.page), movie, '--from', part.from, '--to', part.to, '--fps', plan.fps, '--scale', plan.scale, '--encoder', 'x264', '--workers', '2', ...browserArgs()]);
    checkVideo(movie, plan, { frames: part.frames });
  } else if (action === 'assemble') {
    const [dir, partsDir, dest] = args;
    if (!dest) throw new Error('assemble 需要 prepare 目录、分段目录和成片目录');
    const plan = validatePlan(readJSON(path.join(dir, 'plan.json'))), timeline = readJSON(path.join(dir, 'timeline.json'));
    if (timeline.duration !== plan.sourceDuration || JSON.stringify(timeline.render) !== JSON.stringify(timelineTarget(plan))) throw new Error('时间线与分段规划不一致');
    const outDir = path.resolve(dest), movie = path.join(outDir, `${plan.name}.mp4`);
    concat(plan, partsDir, movie, path.join(dir, 'audio.wav'));
    previews(plan, timeline, movie, outDir);
    writeJSON(path.join(outDir, 'timeline.json'), timeline);
  } else throw new Error('用法：node pipeline.mjs check|prepare|render|assemble ...（参数见 README）');
});
