"""比较整片/分段的边界像素，并确认 concat 没有改变分段解码图像。"""
import json
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image

plan_file, whole, joined, parts, dest = sys.argv[1:]
plan = json.loads(pathlib.Path(plan_file).read_text())
out = pathlib.Path(dest)
out.mkdir(parents=True, exist_ok=True)


def count(file):
    data = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', str(file)])
    return int(json.loads(data)['streams'][0]['nb_read_frames'])


def extract(file, n, name):
    png = out / (name + '.png')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(file), '-vf', rf'select=eq(n\,{n})', '-frames:v', '1', '-fps_mode', 'passthrough', '-update', '1', str(png)], check=True)
    return np.asarray(Image.open(png).convert('RGB')).astype(np.int16)


def compare(a, b):
    diff = np.abs(a - b)
    return dict(different_pixels=int(np.any(diff, axis=2).sum()), total_pixels=int(diff.shape[0] * diff.shape[1]), max_channel_difference=int(diff.max()), mean_absolute_channel_difference=float(diff.mean()))


counts = dict(whole=count(whole), joined=count(joined), expected=plan['totalFrames'])
assert counts['whole'] == counts['joined'] == counts['expected'], counts
results = []
for i, part in enumerate(plan['segments'][:-1]):
    for side, n, source_part, local_n in [('before', part['toFrame'] - 1, part, part['frames'] - 1), ('after', part['toFrame'], plan['segments'][i + 1], 0)]:
        stem = f"{part['id']}-{side}"
        a = extract(whole, n, stem + '-whole')
        b = extract(joined, n, stem + '-joined')
        c = extract(pathlib.Path(parts) / f"part-{source_part['id']}.mp4", local_n, stem + '-part')
        result = dict(frame=n, time=n / plan['fps'], whole_vs_joined=compare(a, b), part_vs_joined=compare(c, b))
        assert result['part_vs_joined']['different_pixels'] == 0, result
        results.append(result)
report = dict(frame_counts=counts, boundaries=results)
(out / 'pixels.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
