#!/usr/bin/env bash
# 沙箱外运行：完整字幕拼图 + 参考片 0–4 秒整段/两段比较；全部产物写到独立目录。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
out="${1:-$(mktemp -d /tmp/video-render-validation-XXXXXX)}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
if [ -n "$(ls -A "$out")" ]; then
  echo "请使用空输出目录：$out" >&2
  exit 1
fi
echo "验证产物：$out"
project=2026-10-16-32bit-ms-timer
page="$project/work/film.html"
browser_args=()
if [ "${RENDER_NO_SANDBOX:-0}" = 1 ]; then browser_args+=(--no-sandbox); fi
node tools/render/render_local.mjs "$page" "$out/timeline.json" --scale 1 "${browser_args[@]}"
node tools/render/render_local.mjs "$page" --frames captions --out-dir "$out/captions" --scale 1 "${browser_args[@]}"
python3 tools/preview/sheet.py "$out/captions" "$out/captions-sheet"
node tools/render/render_local.mjs "$page" "$out/whole.mp4" --from 0 --to 4 --scale 1 --fps 30 --workers 2 --encoder x264 "${browser_args[@]}"
node tools/render/ci/plan_segments.mjs "$project" "$out/timeline.json" "$out/plan.json" --to 4 --segments 2 --scale 1
node tools/render/ci/pipeline.mjs render "$out/plan.json" 0000 "$out/parts"
node tools/render/ci/pipeline.mjs render "$out/plan.json" 0001 "$out/parts"
node tools/render/ci/concat.mjs "$out/plan.json" "$out/parts" "$out/joined.mp4"
python3 tools/render/ci/verify_pixels.py "$out/plan.json" "$out/whole.mp4" "$out/joined.mp4" "$out/parts" "$out/boundary"
echo "完成；拼图：$out/captions-sheet_*.jpg；帧数和像素差异：$out/boundary/pixels.json"
