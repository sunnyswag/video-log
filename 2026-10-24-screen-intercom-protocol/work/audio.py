#!/usr/bin/env python3
"""Kotlin 实现 SIP 通信协议：90 BPM 木质 MG 配乐，48 kHz / stereo / PCM16。

python3 audio.py /absolute/timeline.json /absolute/audio.wav

依赖：numpy、scipy、audio_kit。FILM_KIT_DIR 可覆盖相对脚本的
../../tools/film-kit。只在显式调用 main/render 时合成，不写工具包缓存。

章节协议：n=1..5 为第一至第五章，6=总结，7=结尾，8=系列片尾；
n=0 为开场。参考导出器只列正式章节时，未编号段用 scenes 的
id=hook/title/outro/endcard（也接受 intro/ending/series_outro）定位。
title 场景可在 n=0 内；不存在明确标题场景时保持稀疏开场至第一章。
场景的 chap/title/name 和显示文案均不用于猜测章节。无绝对节目时间。

附带 <输出文件名>.metrics.json：PCM 实测、浮点分轨统计、0.5 s RMS 曲线。
音乐与提示音比较使用相同的有效音效窗口，排除 ring 的 100 ms 间隙；
不把整片中大量无音效的静音计入提示音响度。RMS 不是 LUFS。
"""

import argparse
from collections import Counter
from functools import lru_cache
import hashlib
import json
import math
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
KIT_DIR = Path(os.environ.get("FILM_KIT_DIR", Path(__file__).resolve().parent / "../../tools/film-kit")).resolve()
sys.path.insert(0, str(KIT_DIR))
import numpy as np
from scipy.io import wavfile
import audio_kit as ak

SR = ak.SR
BPM = 90.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
SEED = 20261024
FINAL_FADE = 0.4
MUSIC_RMS_DB = -28.0
HEADROOM_DB = -1.0
TARGET_RMS_DB = -24.4
CUE_GAP_DB = 8.0
DUCK_DB = 2.0
REFERENCE_V = 0.85

# 段落表 → 和弦、层级、每小节八分音符槽位。主章节只按 n 分派。
CHORDS = {
    "Am(add9,no3)": (45, (69, 71, 76)),
    "C6": (48, (67, 69, 72, 76)),
    "Am7": (45, (67, 69, 72, 76)),
    "Fmaj7": (41, (69, 72, 76, 77)),
    "Gsus2": (43, (67, 69, 74)),
    "Dm7": (50, (69, 72, 74, 77)),
    "G6": (43, (67, 71, 74, 76)),
    "C6/9": (48, (72, 74, 76, 81)),
    "C/E": (40, (67, 72, 76, 79)),
}
PATTERNS = {
    "intro": dict(label="开场", prog=("Am(add9,no3)",), mallet=.25, bass=0, perc=.25, slots=(0,), bright=.35),
    "title": dict(label="标题", prog=("C6", "Gsus2"), mallet=.30, bass=.15, perc=.34, slots=(0, 3, 6), bright=.60),
    "1": dict(label="第一章", prog=("C6", "Am7", "Fmaj7", "Gsus2"), mallet=.40, bass=.22, perc=.43, slots=(0, 2, 5, 6), bright=.67),
    "2": dict(label="第二章", prog=(), mallet=0, bass=0, perc=.44, slots=(), bright=.3),
    "3": dict(label="第三章", prog=(), mallet=0, bass=0, perc=.46, slots=(), bright=.3),
    "4": dict(label="第四章", prog=("Dm7", "Gsus2", "Am7", "Fmaj7"), mallet=.43, bass=.23, perc=.46, slots=(0, 2, 5, 6), bright=.7),
    "5": dict(label="第五章", prog=("C6/9", "Fmaj7", "G6", "C/E"), mallet=.51, bass=.27, perc=.53, slots=(0, 1, 2, 4, 5, 7), bright=.95),
    "6": dict(label="总结", prog=("Fmaj7", "G6", "C6", "C6"), mallet=.43, bass=.23, perc=.46, slots=(0, 2, 4, 7), bright=.85),
    "7": dict(label="结尾", prog=("Fmaj7", "Gsus2", "C6", "C6"), mallet=.31, bass=.16, perc=.30, slots=(0, 3, 6), bright=.6),
    "8": dict(label="系列片尾", prog=("C6",), mallet=.26, bass=.11, perc=0, slots=(), bright=.55),
}
# film.js 的章节编号：0 开场、1 片名、2–6 五个主章节、7 总结、8 结尾、9 系列片尾
FILM_CHAPTERS = {0: "intro", 1: "title", 2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7", 9: "8"}
SCENE_ROLES = {"hook": "intro", "intro": "intro", "title": "title", "outro": "7", "ending": "7", "endcard": "8", "series_outro": "8"}
CUE_DURATIONS = {"send": .070, "latch": .080, "success": .220, "error": .180, "whoosh": .250, "tick": .040, "ring": .280}


def amp(db):
    return 10.0 ** (db / 20.0)


def db_energy(total, count):
    return float(10 * np.log10(max(total / max(count, 1), 1e-24)))


def stats(x):
    """分块测量，避免对整片分配 float64 临时副本。"""
    energy = 0.0
    peak = 0.0
    for a in range(0, len(x), SR * 4):
        block = np.asarray(x[a:a + SR * 4], dtype=np.float64)
        energy += float(np.sum(block * block))
        if block.size:
            peak = max(peak, float(np.max(np.abs(block))))
    return dict(rms_dbfs=db_energy(energy, x.size), peak_dbfs=20 * math.log10(max(peak, 1e-12)))


def finite_number(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label} 须为有限数值")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{label} 须为有限数值")
    return result


def prepare(info):
    duration = finite_number(info["duration"], "duration")
    if duration <= 0 or round(duration * SR) < 2:
        raise ValueError("duration 须至少包含两个采样点")
    markers = []
    for chapter in info.get("chapters", []):
        t = finite_number(chapter["t"], "chapter.t")
        value = finite_number(chapter["n"], "chapter.n")
        if value != int(value) or int(value) not in FILM_CHAPTERS:
            raise ValueError("chapter.n 须为 0..9（见 FILM_CHAPTERS）")
        if not 0 <= t < duration:
            raise ValueError("章节起点须在 [0, duration) 内")
        role = FILM_CHAPTERS[int(value)]
        markers.append((t, role, int(role) if role.isdigit() else None))
    markers.sort()
    if any(a[0] == b[0] for a, b in zip(markers, markers[1:])):
        raise ValueError("章节起点不能重复")
    # 标题、结尾在参考导出器中可能只有场景，没有章节 marker。
    overlays = []
    for scene in info.get("scenes", []):
        role = SCENE_ROLES.get(scene.get("id"))
        if role is None:
            continue
        start = finite_number(scene["start"], "scene.start")
        length = finite_number(scene["d"], "scene.d")
        if length <= 0 or start < 0 or start + length > duration + 1e-6:
            raise ValueError("特殊场景区间越界或为空")
        overlays.append((start, min(duration, start + length), role))
    overlays.sort()
    if any(a[1] > b[0] + 1e-6 for a, b in zip(overlays, overlays[1:])):
        raise ValueError("特殊场景不能重叠")
    boundaries = sorted({0.0, duration, *(m[0] for m in markers), *(v for a, b, _ in overlays for v in (a, b))})
    sections = []
    for start, end in zip(boundaries, boundaries[1:]):
        role, number = "intro", None
        for t, r, n in markers:
            if t <= start:
                role, number = r, n
        for a, b, r in overlays:
            if a <= start < b:
                # 仅未编号前奏可被 hook/title 覆盖，绝不覆盖 n=1..5。
                if r in ("7", "8") or role == "intro":
                    role = r
                    number = int(r) if r.isdigit() else None
        if sections and sections[-1]["role"] == role and sections[-1]["n"] == number:
            sections[-1]["end"] = end
        else:
            sections.append(dict(start=start, end=end, role=role, n=number, label=PATTERNS[role]["label"]))
    cues = []
    for item in info.get("cues", []):
        kind = item["type"]
        if kind not in CUE_DURATIONS:
            raise ValueError(f"未知 cue.type: {kind!r}")
        t = finite_number(item["t"], "cue.t")
        v = finite_number(item.get("v", 1), "cue.v")
        pan = finite_number(item.get("pan", 0), "cue.pan")
        if not 0 <= t < duration or not 0 <= v <= 1 or not -1 <= pan <= 1:
            raise ValueError("cue.t / v / pan 越界")
        if "gain" in item and finite_number(item["gain"], "cue.gain") != 1:
            raise ValueError("本片使用 v 控制力度；不另叠加 cue.gain")
        cues.append(dict(t=t, type=kind, v=v, pan=pan))
    # 同时刻 cue 也采用稳定顺序，和字典插入顺序、字符串哈希无关。
    cues.sort(key=lambda c: (c["t"], c["type"], c["v"], c["pan"]))
    return duration, sections, cues


@lru_cache(maxsize=256)
def mallet(note, bright):
    dry = ak.marimba(ak.mtof(note), dur=.55, bright=bright)
    # 两个极轻短反射，保持木质击点；没有长混响或拖尾琶音。
    x = np.zeros(len(dry) + round(.085 * SR))
    x[:len(dry)] = dry
    for delay, gain in ((.037, .065), (.085, .035)):
        i = round(delay * SR)
        x[i:i + len(dry)] += dry * gain
    return x


@lru_cache(maxsize=64)
def low_note(note):
    return ak.fade(ak.bass(ak.mtof(note), BEAT * .82), .015, .085)


@lru_cache(maxsize=1)
def soft_pulse():
    t = ak.tvec(.16)
    phase = 2 * np.pi * (52 * t + 30 * .023 * (1 - np.exp(-t / .023)))
    return ak.fade(np.sin(phase) * (1 - np.exp(-t / .004)) * np.exp(-t / .042), 0, .025) * .4


def add_in_section(buf, sig, t, section, gain=1.0, pan=0.0):
    begin = round(section["start"] * SR)
    end = round(section["end"] * SR)
    sample = round(t * SR)
    room = end - sample
    if sample < begin or room <= 0 or gain <= 0:
        return
    if room < len(sig):
        sig = ak.fade(sig[:room], fade_out=min(.018, room / SR))
    ak.add(buf[begin:end], sig, (sample - begin) / SR, gain, pan)


def music_bus(duration, sections):
    music = np.zeros((round(duration * SR), 2), dtype=np.float32)
    # 从时间线的标题起点启拍；此后全片使用同一个 90 BPM 网格，不逐章重置。
    anchor = next((s["start"] for s in sections if s["role"] == "title"),
                  next((s["start"] for s in sections if s["role"] == "1"), 0.0))
    for section in sections:
        role = section["role"]
        p = PATTERNS[role]
        start, end = section["start"], section["end"]
        first = math.ceil((start - anchor) / (BEAT / 2) - 1e-9)
        last = math.ceil((end - anchor) / (BEAT / 2) - 1e-9)
        first_bar = math.floor(first / 8)
        for step in range(first, last):
            t = anchor + step * BEAT / 2
            if t < start - 1e-7 or t >= end:
                continue
            slot = step % 8
            bar = step // 8 - first_bar
            progress = (t - start) / max(end - start, 1 / SR)
            recover = (.08 + .92 * progress) if role == "4" else 1.0
            taper = (1.0 - .65 * progress) if role == "7" else 1.0
            chord = p["prog"][bar % len(p["prog"])] if p["prog"] else None
            if chord:
                root, notes = CHORDS[chord]
                slots = p["slots"]
                if role == "4" and progress < .30:
                    slots = (0,)
                elif role == "4" and progress < .6:
                    slots = (0, 4)
                if role == "intro" and bar % 2:
                    slots = ()
                # 每四小节留出半小节呼吸，不形成持续抢注意力的旋律。
                if slot in slots and not (bar % 4 == 3 and slot >= 6):
                    pick = (0, 2, 1, 3, 1, 2, 0, 3)[slot]
                    note = notes[(pick + bar // 4) % len(notes)]
                    gain = p["mallet"] * recover * taper * (1 if slot % 2 == 0 else .73)
                    add_in_section(music, mallet(note, p["bright"]), t, section, gain, ((step % 3) - 1) * .24)
                if slot in (0, 4) and p["bass"] and role != "8":
                    add_in_section(music, low_note(root), t, section, p["bass"] * recover * taper * (1 if slot == 0 else .78))
            if not p["perc"]:
                continue
            perc = 3.2 * p["perc"] * taper * ((.7 + .3 * progress) if role == "4" else 1)
            if role == "intro":
                if slot == 0:
                    add_in_section(music, soft_pulse(), t, section, perc * .55)
                if slot == 5 and bar % 2 == 0:
                    add_in_section(music, ak.woodblock(540, .085, .35), t, section, perc * .35, -.15)
                continue
            if slot in (0, 4):
                add_in_section(music, soft_pulse(), t, section, perc * .62)
            if slot in (2, 6):
                add_in_section(music, ak.woodblock(720 if slot == 2 else 630, .095, .45), t, section, perc * .42, -.18)
            if slot % 2 and (role not in ("2", "3") or slot in (3, 7)):
                noise = ak.shaker(.075, bright=.65, rng=SEED + step + 1000000)
                add_in_section(music, noise, t, section, perc * .60, .22)
        if role == "8":
            # 片尾只奏一次 C6 收束，起点来自片尾场景/章节，无额外 cue。
            for k, note in enumerate((60, 67, 69, 76)):
                add_in_section(music, mallet(note, .55), start + k * .055, section, .18, (k - 1.5) * .12)
            add_in_section(music, low_note(48), start, section, .11)
            # 极轻的纯正弦尾韵保持到最后 .4 s 淡出，避免片尾提前完全沉默。
            length = end - start
            t = ak.tvec(length)
            tail = sum(np.sin(2 * np.pi * ak.mtof(m) * t) for m in (60, 67, 76)) / 3
            tail *= np.minimum(t / .04, 1) * np.exp(-t / 1.5) * .045
            add_in_section(music, tail, start, section)
    fi = min(len(music), round(.08 * SR))
    music[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)[:, None]
    music *= amp(MUSIC_RMS_DB - stats(music)["rms_dbfs"]) if np.any(music) else 1
    return music


def wood_tone(frequency, duration, bright=.55, decay=.07):
    t = ak.tvec(duration)
    x = np.sin(2 * np.pi * frequency * t) * np.exp(-t / decay)
    x += .19 * bright * np.sin(2 * np.pi * frequency * 3.99 * t) * np.exp(-t / .018)
    return ak.fade(x * np.minimum(t / .003, 1), 0, min(.018, duration / 4))


@lru_cache(maxsize=7)
def cue_voice(kind):
    duration = CUE_DURATIONS[kind]
    x = np.zeros(round(duration * SR))
    if kind == "send":
        x = wood_tone(ak.mtof(79), duration, .65, .035)
    elif kind == "latch":
        x = ak.woodblock(620, duration, .45)
        second = wood_tone(ak.mtof(60), .055, .25, .022)
        i = round(.025 * SR)
        x[i:i + len(second)] += second * .45
    elif kind == "success":
        first = wood_tone(ak.mtof(72), .095, .65, .045)
        second = wood_tone(ak.mtof(79), .120, .7, .055)
        x[:len(first)] = first
        x[round(.100 * SR):] = second * .95
    elif kind == "error":
        t = ak.tvec(duration)
        # 一枚木质下滑四度，不用蜂鸣、失真或不协和警报。
        f0, f1 = ak.mtof(67), ak.mtof(62)
        phase = 2 * np.pi * (f0 * t + (f1 - f0) * t * t / (2 * duration))
        x = (np.sin(phase) + .10 * np.sin(3.99 * phase) * np.exp(-t / .022))
        x *= np.minimum(t / .008, 1) * np.exp(-t / .09)
        x = ak.fade(ak.lp(x, 1800), 0, .035)
    elif kind == "whoosh":
        t = ak.tvec(duration)
        noise = np.random.default_rng(SEED + 71).standard_normal(len(t))
        # 像沙锤/毛刷扫过木面，频带固定，不使用科幻扫频。
        x = ak.bp(noise, 450, 2800) * np.sin(np.pi * t / duration) ** 1.7
        x = ak.fade(x, .008, .025)
    elif kind == "tick":
        x = ak.woodblock(1120, duration, .45)
    elif kind == "ring":
        # 90 ms + 100 ms 空隙 + 90 ms；短、明亮、木琴式的智能屏双铃。
        for offset, note in ((0, 79), (.190, 83)):
            tone = wood_tone(ak.mtof(note), .090, .95, .060)
            i = round(offset * SR)
            x[i:i + len(tone)] = tone
    else:
        raise ValueError(kind)
    x[0] = x[-1] = 0
    # 使用设计的发声区间（ring 排除空隙），每种声音有相同 nominal RMS。
    ranges = [(0, len(x))] if kind != "ring" else [(0, round(.090 * SR)), (round(.190 * SR), len(x))]
    energy = sum(float(np.sum(x[a:b] ** 2)) for a, b in ranges)
    count = sum(b - a for a, b in ranges)
    x *= amp(-20 - db_energy(energy, count))
    return x


def cue_spans(cues, frames, positive_only=False):
    spans = []
    for cue in cues:
        if positive_only and cue["v"] == 0:
            continue
        ranges = ((0, .09), (.19, .28)) if cue["type"] == "ring" else ((0, CUE_DURATIONS[cue["type"]]),)
        for a, b in ranges:
            left, right = max(0, round((cue["t"] + a) * SR)), min(frames, round((cue["t"] + b) * SR))
            if right > left:
                spans.append((left, right))
    merged = []
    for a, b in sorted(spans):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    return merged


def window_rms(x, spans):
    energy = sum(float(np.sum(np.asarray(x[a:b], dtype=np.float64) ** 2)) for a, b in spans)
    return db_energy(energy, sum((b - a) * 2 for a, b in spans))


def duck_in_place(music, cues):
    env = np.ones(len(music), dtype=np.float32)
    for cue in cues:
        if cue["v"] == 0:
            continue
        start, end = cue["t"], cue["t"] + CUE_DURATIONS[cue["type"]]
        a, b = max(0, round((start - .025) * SR)), min(len(music), round((end + .150) * SR))
        curve = np.interp(np.arange(a, b) / SR, [start - .025, start, end + .025, end + .150], [1, amp(-DUCK_DB), amp(-DUCK_DB), 1])
        np.minimum(env[a:b], curve, out=env[a:b])
    music *= env[:, None]


def render(info):
    duration, sections, cues = prepare(info)
    music = music_bus(duration, sections)
    sfx = np.zeros_like(music)
    all_spans = cue_spans(cues, len(music))
    active_spans = cue_spans(cues, len(music), positive_only=True)
    # 校准按固定参考力度 .85，不按输入 v 反向归一；v=.5 仍是原波形一半。
    cue_target = window_rms(music, all_spans) - DUCK_DB + CUE_GAP_DB - 20 * math.log10(REFERENCE_V) if all_spans else -20
    cue_gain = amp(cue_target + 20)
    for cue in cues:
        ak.add(sfx, cue_voice(cue["type"]), cue["t"], cue_gain * cue["v"], cue["pan"])
    duck_in_place(music, cues)
    # 精确到 timeline.duration；所有尾音在片内，最后 .4 s 同步降至零。
    fade_length = min(len(music), round(FINAL_FADE * SR))
    fade = np.linspace(1, 0, fade_length, dtype=np.float32)[:, None]
    music[-fade_length:] *= fade
    sfx[-fade_length:] *= fade
    mix = music + sfx
    # 整体响度向上一期（32 位计时器，约 −24.4 dBFS RMS）看齐，峰值仍留 HEADROOM_DB 余量
    level = stats(mix)
    gain = min(amp(TARGET_RMS_DB - level["rms_dbfs"]), amp(HEADROOM_DB - level["peak_dbfs"]))
    music *= gain
    sfx *= gain
    mix *= gain
    music_active = window_rms(music, active_spans) if active_spans else None
    sfx_active = window_rms(sfx, active_spans) if active_spans else None
    report = dict(sample_rate=SR, channels=2, frames=len(mix), duration_seconds=len(mix) / SR,
                  bpm=BPM, seed=SEED, cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  music=stats(music), sfx=stats(sfx), master_attenuation_db=20 * math.log10(gain),
                  cue_window_seconds=sum(b-a for a, b in active_spans) / SR,
                  music_cue_window_rms_dbfs=music_active, sfx_cue_window_rms_dbfs=sfx_active,
                  sfx_minus_music_db=(sfx_active - music_active) if active_spans else None,
                  level_method="Same nominal sounding windows; ring gap excluded. Stems are pre-PCM, post-duck/fade/master. v is linear, nominal calibration v=0.85.",
                  final_fade_seconds=fade_length / SR, sections=[])
    for section in sections:
        a, b = round(section["start"] * SR), round(section["end"] * SR)
        report["sections"].append(dict(section, music_rms_dbfs=stats(music[a:b])["rms_dbfs"], sfx_rms_dbfs=stats(sfx[a:b])["rms_dbfs"]))
    curve = []
    for a in range(0, len(mix), SR // 2):
        b = min(a + SR // 2, len(mix))
        curve.append(dict(t=(a + b) / (2 * SR), music=stats(music[a:b])["rms_dbfs"], sfx=stats(sfx[a:b])["rms_dbfs"]))
    report["rms_curve"] = curve
    return mix, report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    info = ak.read_timeline(args.timeline)
    mix, report = render(info)
    ak.write_wav(args.output, mix)
    del mix
    sr, pcm = wavfile.read(args.output, mmap=True)
    # 最终报告以真实 PCM16 / 32768 为准，量化前分轨单独标注。
    def pcm_stats(a, b):
        energy, peak = 0.0, 0.0
        for i in range(a, b, SR * 4):
            x = pcm[i:min(b, i + SR * 4)].astype(np.float64) / 32768
            energy += float(np.sum(x * x))
            peak = max(peak, float(np.max(np.abs(x))) if x.size else 0)
        return dict(rms_dbfs=db_energy(energy, (b-a) * 2), peak_dbfs=20 * math.log10(max(peak, 1e-12)))
    report["pcm"] = pcm_stats(0, len(pcm))
    report["last_frame"] = pcm[-1].tolist()
    for section in report["sections"]:
        section["mix_rms_dbfs"] = pcm_stats(round(section["start"] * SR), round(section["end"] * SR))["rms_dbfs"]
    for index, row in enumerate(report["rms_curve"]):
        # 最后一个半秒窗口可能不足半秒。
        a = index * (SR // 2)
        row["mix"] = pcm_stats(a, min(len(pcm), a + SR // 2))["rms_dbfs"]
    h = hashlib.sha256()
    with args.output.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    report["sha256"] = h.hexdigest()
    report_path = args.output.with_suffix(".metrics.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "rms_curve"}, ensure_ascii=False, indent=2))
    print(f"Metrics: {report_path}")


if __name__ == "__main__":
    main()
