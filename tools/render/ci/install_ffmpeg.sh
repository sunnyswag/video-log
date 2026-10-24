#!/usr/bin/env bash
# CI 装 ffmpeg：优先用 GitHub Release 上的静态构建（GPL 版，含 libx264；走 GitHub CDN，不依赖 apt 源），
# 失败再退回 apt。每种方式都有超时，避免 apt 源慢时整个 job 挂住。
# 用法：FFMPEG_DIR=~/ffmpeg-static bash tools/render/ci/install_ffmpeg.sh（配合 actions/cache 缓存该目录）
set -euo pipefail
dir="${FFMPEG_DIR:-$HOME/ffmpeg-static}"
url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz"
if [ ! -x "$dir/bin/ffmpeg" ]; then
  mkdir -p "$dir"
  if ! curl -fsSL --retry 3 --retry-delay 5 --max-time 300 "$url" | tar -xJ -C "$dir" --strip-components=1; then
    echo "静态 ffmpeg 下载失败，改用 apt"
    rm -rf "$dir"
    sudo timeout 600 apt-get update -o Acquire::Retries=3
    sudo timeout 600 apt-get install -y --no-install-recommends -o Acquire::Retries=3 ffmpeg
    ffmpeg -hide_banner -version | sed -n 1p
    exit 0
  fi
fi
echo "$dir/bin" >> "${GITHUB_PATH:-/dev/null}"
"$dir/bin/ffmpeg" -hide_banner -version | sed -n 1p
"$dir/bin/ffmpeg" -hide_banner -encoders | grep -c libx264 > /dev/null
