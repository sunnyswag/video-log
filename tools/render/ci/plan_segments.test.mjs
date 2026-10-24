import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, validatePlan } from './plan_segments.mjs';
import { config } from './common.mjs';
import { captionTimes, frameName } from './frames.mjs';

const cfg = { name: 'test', fps: 30 };
test('参考片：全片及前四秒的帧数与边界', () => {
  const full = makePlan(cfg, { duration: 356 });
  assert.equal(full.totalFrames, 10680);
  assert.deepEqual(full.segments.map(s => s.frames), Array(10).fill(1068));
  const short = makePlan(cfg, { duration: 356 }, { to: 4, segments: 2 });
  assert.equal(short.totalFrames, 120);
  assert.deepEqual(short.segments.map(s => [s.fromFrame, s.toFrame]), [[0, 60], [60, 120]]);
});
test('不同帧率、不能整除的段数、非整帧结尾：全局采样不重不漏', () => {
  for (const fps of [1, 24, 25, 30, 60, 120]) for (const frames of [1, 2, 17, 103, 1001]) for (const segments of [1, 2, 3, 10, 20]) {
    const plan = makePlan({ ...cfg, fps }, { duration: (frames + 0.3) / fps }, { segments });
    assert.equal(plan.totalFrames, frames);
    assert.equal(plan.segments.length, Math.min(frames, segments));
    const seen = [];
    for (const s of plan.segments) {
      assert.ok(s.frames > 0);
      assert.equal(Math.round((s.to - s.from) * fps), s.frames);
      const start = Math.round(s.from * fps);
      for (let i = 0; i < s.frames; i++) seen.push((start + i) / fps);
    }
    assert.deepEqual(seen, Array.from({ length: frames }, (_, i) => i / fps));
    validatePlan(plan);
  }
});
test('非法输入和被篡改的规划会失败', () => {
  for (const opts of [{ segments: 0 }, { segments: 21 }, { segments: 1.5 }, { to: 0 }, { to: 357 }, { to: 'NaN' }, { to: 0.001 }, { scale: 0 }, { scale: '2; echo bad' }]) assert.throws(() => makePlan(cfg, { duration: 356 }, opts));
  assert.throws(() => makePlan({ fps: 29.97 }, { duration: 356 }));
  const plan = makePlan(cfg, { duration: 356 }); plan.segments[1].fromFrame++;
  assert.throws(() => validatePlan(plan));
  for (const project of ['..', '../ci', '/tmp', 'x\ny', 'x\\y']) assert.throws(() => config(project));
});
test('字幕中点、重复时间、文件名与舍入冲突', () => {
  assert.deepEqual(captionTimes([{ t0: 1, t1: 3 }, { t0: 1, t1: 3 }, { t0: 6, t1: 8 }], 5), [2]);
  assert.throws(() => captionTimes([{ t0: 2, t1: 1 }], 10));
  const names = new Map();
  assert.equal(frameName(61.5, names), 'f_0061.50.jpg');
  assert.equal(frameName(61.501, names), 'f_0061.501.jpg');
  assert.equal(names.size, 2);
});
