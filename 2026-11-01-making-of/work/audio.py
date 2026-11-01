#!/usr/bin/env python3
"""幕后制作 v2：C 大调、110 BPM、4/4，轻快而克制的 lo-fi 拨弦。

用法：python3 -B audio.py timeline.json audio.wav
保持 film-kit 导入方式；只写指定的 48 kHz 立体声 PCM16 WAV。
常规演奏使用从零开始的绝对八分网格，cue 落点不重置节拍。
章节、入场、睡觉、合体和收工均从时间线查找，不写死章节秒数。
睡觉与纯 pad 段单独渲染混响，旧乐队尾音不会串入；无片外尾音。
结尾包络先作用于完整混音，再做一次整片恒定 RMS 增益；不分段归一。
所有随机声源显式固定种子；导入不渲染、不写字节码。
"""

import argparse
from collections import Counter
from functools import lru_cache
import hashlib
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/film-kit"))
import numpy as np
from scipy.io import wavfile
import audio_kit as ak

SR = ak.SR
BPM = 110
BEAT = 60 / BPM
BAR = BEAT * 4
STEP = BEAT / 2
SEED = 20261101
DUCK_DB = 1.8
SILENCE = .5
FADE_SECONDS = 1.8
EPS = 1e-8

# root 为圆润低音，notes 为电钢和弦；拨弦通常高一个八度。
CHORDS = {
    "C": (36, (60, 64, 67)), "Am": (33, (60, 64, 69)),
    "F": (41, (60, 65, 69)), "G": (43, (59, 62, 67)),
    "Em": (40, (59, 64, 67)),
}
PROGRESSIONS = {n: ("C", "Am", "F", "G") for n in range(6)}
PROGRESSIONS.update({6: ("F", "G", "Em", "Am"),
                     7: ("F", "G", "C", "C"), 8: ("C",)})
LABELS = ("开场", "片名", "准备", "流水线", "分身", "小插曲", "第二批", "上架", "收工")
PATTERNS = {
    0: dict(piano=.125, pluck=.145, bass=.105, kick=.075, shaker=.13, marimba=.060, pad=.028),
    1: dict(piano=.125, pluck=.150, bass=.110, kick=.078, shaker=.14, marimba=.060, pad=.030),
    2: dict(piano=.125, pluck=.145, bass=.110, kick=.078, shaker=.14, marimba=.065, pad=.028),
    3: dict(piano=.125, pluck=.150, bass=.115, kick=.080, shaker=.15, marimba=.070, pad=.028),
    4: dict(piano=.120, pluck=.125, bass=.115, kick=.080, shaker=.16, marimba=.055, pad=.028),
    5: dict(piano=.095, pluck=.105, bass=.085, kick=.055, shaker=.10, marimba=.040, pad=.022),
    6: dict(piano=.125, pluck=.145, bass=.115, kick=.080, shaker=.15, marimba=.060, pad=.030),
    7: dict(piano=.135, pluck=.120, bass=.100, kick=.065, shaker=.10, marimba=.040, pad=.038),
    8: dict(piano=.100, pluck=.090, bass=.085, kick=.050, shaker=.08, marimba=0, pad=.034),
}
CUE_DURATIONS = dict(type=.30, pop=.18, hop=.12, whoosh=.60, tick=.04,
                     ding=.65, snip=.14, flip=.25, zzz=1.15, bonk=.24,
                     poof=.40, bloop=.26)
STAB_NOTES = ((60, 64, 67), (60, 64, 67), (64, 67, 72), (67, 72, 76))


def prepare(info):
    duration = float(info["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration 须为有限正数")
    sections = ak.timeline_sections(info)
    if [s.get("n") for s in sections] != list(range(9)):
        raise ValueError("须有从 0 秒开始、按顺序编号 0..8 的章节")
    if any(s["end"] <= s["start"] for s in sections):
        raise ValueError("章节须有正时长")
    cues = []
    for c in info["cues"]:
        kind, t, v = c["type"], float(c["t"]), float(c.get("v", 1))
        if kind not in CUE_DURATIONS:
            raise ValueError(f"未知 cue 类型：{kind!r}")
        if not (0 <= t < duration and math.isfinite(v) and v >= 0):
            raise ValueError("cue 时间/力度须有限且非负，时间须在视频内")
        cues.append(dict(t=t, type=kind, v=v))
    cues.sort(key=lambda c: (c["t"], c["type"], c["v"]))
    scenes = {}
    for s in info["scenes"]:
        start, d = float(s["start"]), float(s["d"])
        if s["id"] in scenes or not (0 <= start < duration and d > 0 and start + d <= duration + EPS):
            raise ValueError("场景重复或 start/d 越界")
        scenes[s["id"]] = dict(s, start=start, end=start + d)
    expected = (0, 1, 2, 3, 3, 3, 3, 3, 3, 4, 4, 5, 6, 7, 8, 8)
    if set(scenes) != {f"s{k:02d}" for k in range(1, 17)}:
        raise ValueError("v2 须包含 s01..s16 共 16 幕")
    previous_end = 0.0
    for k, chap in enumerate(expected, 1):
        s, section = scenes[f"s{k:02d}"], sections[chap]
        if (s.get("chap") != chap or abs(s["start"] - previous_end) > EPS
                or s["start"] < section["start"] - EPS or s["end"] > section["end"] + EPS):
            raise ValueError(f"s{k:02d} 顺序或章节范围不符")
        previous_end = s["end"]
    if abs(previous_end - duration) > EPS:
        raise ValueError("s16 须结束于 duration")

    def in_scene(sid, kind):
        s = scenes[sid]
        return [c for c in cues if s["start"] <= c["t"] < s["end"] and c["type"] == kind]

    entry = in_scene("s01", "hop")
    clones, sleeps = in_scene("s10", "hop"), in_scene("s12", "zzz")
    stabs, reunions = in_scene("s13", "ding"), in_scene("s15", "pop")
    if not entry or not sleeps or len(clones) < 4 or len(stabs) != 4 or len(reunions) != 8:
        raise ValueError("缺少 s01 hop、s10 末四个 hop、s12 zzz、s13 四个 ding 或 s15 八个 pop")
    wakes = [c for c in in_scene("s12", "ding") if c["t"] > sleeps[0]["t"]]
    if not wakes:
        raise ValueError("s12 zzz 之后须有 ding")
    outro = scenes["s16"]["start"]
    silence_start = duration - SILENCE
    fade_start = max(outro + (duration - outro) / 2, silence_start - FADE_SECONDS)
    if fade_start >= silence_start:
        raise ValueError("s16 太短，无法安排淡出和末尾静音")
    anchors = dict(entry=entry[0], sleep_start=sleeps[0]["t"], sleep_end=wakes[0]["t"],
                   clones=clones[-4:], stabs=stabs, reunions=reunions,
                   pipeline=[scenes[f"s{k:02d}"]["start"] for k in range(4, 10)],
                   reunion_start=scenes["s15"]["start"], outro=outro,
                   fade_start=fade_start, silence_start=silence_start)
    return duration, sections, cues, anchors


def chord_at(section, t):
    # 章节起点的残小节与首个完整小节共用首和弦，绝对小节网格不变。
    bar = math.floor(t / BAR + EPS)
    origin = math.ceil(section["start"] / BAR - EPS)
    index = max(0, bar - origin)
    prog = PROGRESSIONS[section["n"]]
    if section["n"] == 7:
        index = min(index, len(prog) - 1)  # 上架 F–G–C–C 后保持 C。
    return prog[index % len(prog)]


def mode_at(t, anchors):
    if t >= anchors["outro"]:
        return "pad_only"
    if anchors["sleep_start"] <= t < anchors["sleep_end"]:
        return "lullaby"
    return "intro" if t < anchors["entry"]["t"] else "normal"


def segments(section, anchors):
    points = {section["start"], section["end"]}
    points.update(t for t in (anchors["entry"]["t"], anchors["sleep_start"],
                              anchors["sleep_end"], anchors["outro"])
                  if section["start"] < t < section["end"])
    points = sorted(points)
    return [(a, b, mode_at((a + b) / 2, anchors)) for a, b in zip(points, points[1:])]


@lru_cache(maxsize=96)
def piano(note, dur=1.75):
    return ak.electric_piano(ak.mtof(note), dur=dur, bell=.14)


@lru_cache(maxsize=64)
def bass(note, dur=.43):
    return ak.fade(ak.lp(ak.bass(ak.mtof(note), dur), 420), .006, .045)


@lru_cache(maxsize=64)
def pluck(note):
    return ak.fade(ak.pluck(ak.mtof(note), .34, bright=.72), .003, .065)


@lru_cache(maxsize=32)
def marimba(note, dur=.55):
    return ak.marimba(ak.mtof(note), dur, bright=.55)


@lru_cache(maxsize=1)
def kick():
    return ak.fade(ak.lp(ak.kick(), 850), .004, .055)


def noise(dur, seed):
    return np.random.default_rng(SEED + seed).standard_normal(round(dur * SR))


def sweep(dur, seed):
    """带通噪声连续交叉扫频，避免分块滤波产生接缝。"""
    t = ak.tvec(dur)
    n, out = noise(dur, seed), np.zeros(len(t))
    centers = np.geomspace(350, 6500, 10)
    for k, center in enumerate(centers):
        weight = np.maximum(0, 1 - np.abs(t / dur * (len(centers) - 1) - k))
        out += ak.bp(n, center * .6, center * 1.4) * weight
    return out


def mono_add(out, sig, t, gain=1):
    i = round(t * SR)
    count = min(len(sig), len(out) - i)
    if count > 0:
        out[i:i + count] += sig[:count] * gain


@lru_cache(maxsize=12)
def cue_voice(kind):
    d = CUE_DURATIONS[kind]
    t, x = ak.tvec(d), np.zeros(round(d * SR))
    if kind == "type":
        for k, offset in enumerate((0, .064, .140, .222)):
            tt = ak.tvec(.035)
            hit = ak.bp(noise(.035, 120 + k), 1900, 7000) * np.exp(-tt / .004) * .045
            hit += ak.woodblock(1250 + 170 * k, .035, .45) * .075
            mono_add(x, ak.fade(hit, .0004, .005), offset, .90 if k % 2 else 1)
    elif kind == "pop":
        f = 180 + 520 * np.exp(-t * 32)
        x = .13 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28)
        x += ak.lp(noise(d, 130), 2400) * np.exp(-t * 110) * .028
    elif kind == "hop":
        f = 420 + 1100 * (t / d) ** 1.2
        x = .075 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / d) ** 1.5
    elif kind == "whoosh":
        x = sweep(d, 131) * np.sin(np.pi * t / d) ** 2 * .095
    elif kind == "tick":
        x = ak.s_tick(.16, rng=SEED + 132)
    elif kind == "ding":
        f = ak.mtof(84)
        x = (np.sin(2 * np.pi * f * t) + .28 * np.sin(2 * np.pi * f * 2 * t))
        x *= np.exp(-t * 9) * .085
    elif kind == "snip":
        for k, offset in enumerate((0, .065)):
            tt = ak.tvec(.055)
            hit = ak.bp(noise(.055, 134 + k), 3200, 11500) * .075
            hit += .025 * np.sin(2 * np.pi * (4100 + 630 * k) * tt)
            mono_add(x, ak.fade(hit * np.exp(-tt / .006), .0004, .006), offset)
    elif kind == "flip":
        grain = .55 + .45 * np.sin(2 * np.pi * 37 * t) ** 2
        x = ak.bp(noise(d, 136), 750, 4800) * grain * np.sin(np.pi * t / d) ** 1.2 * .085
    elif kind == "zzz":
        for k, note in enumerate((43, 40, 36)):
            tt = ak.tvec(.42)
            f = ak.mtof(note) * (1 - .16 * tt / .42) * (1 + .018 * np.sin(2 * np.pi * 5 * tt))
            phase = 2 * np.pi * np.cumsum(f) / SR
            tone = np.sin(phase) + .18 * np.sin(2 * phase) + .06 * np.sin(3 * phase)
            tone *= np.sin(np.pi * tt / .42) ** 2 * .085
            mono_add(x, ak.lp(tone, 450), k * .35)
    elif kind == "bonk":
        f = 48 + 250 * np.exp(-t * 35)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 19) * .16
    elif kind == "poof":
        x = ak.lp(noise(d, 137), 1100) * np.sin(np.pi * t / d) ** 2 * .15
    elif kind == "bloop":
        f = np.interp(t, (0, .065, d), (190, 900, 140))
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / d) ** 1.7 * .10
    else:
        raise ValueError(kind)
    return ak.fade(x, .0005, .008)


def segment_audio(section, start, end, mode, anchors):
    first = round(start * SR)
    frames = round(end * SR) - first
    harmonic = np.zeros((frames, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)
    n, p = section["n"], PATTERNS[section["n"]]

    def place(buf, sig, t, gain, pan=0):
        ak.add(buf, sig, (round(t * SR) - first) / SR, gain, pan)

    def ep_chord(notes, t, gain, dur=1.75):
        for note, pan in zip(notes, np.linspace(-.25, .25, len(notes))):
            place(harmonic, piano(note, dur), t, gain, pan)

    if mode == "pad_only":
        # 连续 C 大调垫音，不再触发任何旋律/节奏，原片字幕打字 cue 另保留。
        pad = ak.pad_chord((48, 55, 60, 64, 67), end - start + 1.0, cut=850)
        place(harmonic, pad, start, .055)
    elif mode == "lullaby":
        # zzz 当下给一个 C6 起音；后续仍沿全局每两拍网格，不重置节拍。
        place(harmonic, marimba(84, 1.15), start, .095, -.12)
        first_note = math.ceil(start / (2 * BEAT) - EPS)
        # 起音若恰好贴近网格，略过重复音，避免听成一次快速双击。
        if first_note * 2 * BEAT - start < .25 * BEAT:
            first_note += 1
        for k in range(first_note, math.ceil(end / (2 * BEAT) - EPS)):
            note = (79, 76, 79, 84)[(k - first_note) % 4]
            place(harmonic, marimba(note, 1.15), k * 2 * BEAT, .095, -.12 if k % 2 else .12)
    else:
        for bar in range(math.floor(start / BAR + EPS), math.ceil(end / BAR - EPS)):
            t, stop = max(start, bar * BAR), min(end, (bar + 1) * BAR)
            notes = CHORDS[chord_at(section, t)][1]
            place(harmonic, ak.pad_chord(tuple(m - 12 for m in notes), stop - t + .6, cut=1000),
                  t, p["pad"])
        if mode == "intro":
            ep_chord(CHORDS["C"][1], start, p["piano"])

        landings = [anchors["entry"]["t"], anchors["sleep_end"], *anchors["pipeline"]]
        for step in range(math.ceil(start / STEP - EPS), math.ceil(end / STEP - EPS)):
            t, slot = step * STEP, step % 8
            root, notes = CHORDS[chord_at(section, t)]
            if slot in (0, 4) and (mode != "intro" or t > start + EPS):
                ep_chord(notes, t, p["piano"] * (1 if slot == 0 else .63))
            if mode == "intro":
                continue
            # cue 附近 80 ms 内的常规 kick/bass 让给指定落点，防止双击。
            near_landing = any(abs(t - u) < .08 for u in landings)
            if slot in (0, 4, 6) and not near_landing:
                note = root if slot != 6 else root + 7
                place(rhythm, bass(note, .43 if slot != 6 else .30), t,
                      p["bass"] * (.70 if slot == 6 else 1))
            if slot in (0, 4) and not near_landing:
                place(rhythm, kick(), t, p["kick"])
            place(rhythm, ak.shaker(bright=.8, rng=SEED + 10000 + step), t,
                  p["shaker"] * (.72 if slot % 2 == 0 else 1), .18)
            if n == 4 or slot % 2 == 0:
                pattern = (0, 1, 2, 1, 0, 2, 1, 2) if n == 4 else (0, 1, 2, 1)
                pick = pattern[slot if n == 4 else slot // 2]
                if (step // 8) % 2 and slot == 4:
                    pick = 0
                place(harmonic, pluck(notes[pick] + 12), t,
                      p["pluck"] * (.78 if slot % 2 else 1), (-.22, .10, .24)[pick])
            if slot == 7 and (step // 8) % 2 == 0 and p["marimba"]:
                place(harmonic, marimba(notes[1] + 12), t, p["marimba"], -.23)
            if n == 6 and slot in (3, 7):
                place(harmonic, pluck(notes[2 if slot == 3 else 0] + 24), t, .060, .27)

        if mode == "normal":
            for t in landings:
                if start <= t < end:
                    root, notes = CHORDS[chord_at(section, t)]
                    place(rhythm, kick(), t, p["kick"])
                    place(rhythm, bass(root), t, p["bass"])
                    if t == anchors["entry"]["t"]:
                        place(harmonic, pluck(notes[0] + 12), t, p["pluck"])
            if n == 1 and start == section["start"]:
                for k, note in enumerate((72, 76, 79, 84)):
                    place(harmonic, pluck(note), start + k * STEP, .175, -.24 + .16 * k)
            for k, (c, note) in enumerate(zip(anchors["clones"], (72, 76, 79, 84))):
                if start <= c["t"] < end:
                    place(harmonic, marimba(note), c["t"], .22 * c["v"], -.24 + .16 * k)
            for c, notes in zip(anchors["stabs"], STAB_NOTES):
                if start <= c["t"] < end:
                    ep_chord(notes, c["t"], .21 * c["v"], .30)
            for k, c in enumerate(anchors["reunions"]):
                if start <= c["t"] < end:
                    last = k == len(anchors["reunions"]) - 1
                    gain = (.22 if last else .13 + .008 * k) * c["v"]
                    ep_chord((60, 64, 67), c["t"], gain, .60 if last else .23)
                    if last:
                        ep_chord((48, 72), c["t"], gain * .60, .68)
                        place(rhythm, bass(36, .60), c["t"], .11 * c["v"])

    # 每个状态段内完成混响，再封闭尾音，睡觉/收工边界无旧声部残留。
    out = ak.reverb(harmonic, dur=1.20, decay=.32, wet=.075,
                    rng=SEED + 300, predelay=.018)
    out += rhythm
    return ak.fade(out, .08 if mode in ("intro", "pad_only") else .002, .025).astype(np.float32)


def music_bus(duration, sections, anchors):
    music = np.zeros((round(duration * SR), 2), dtype=np.float32)
    for section in sections:
        for start, end, mode in segments(section, anchors):
            sig = segment_audio(section, start, end, mode, anchors)
            first = round(start * SR)
            music[first:first + len(sig)] += sig
    return music


def ending_envelope(mix, anchors):
    """在响度对齐之前施加唯一的总线淡出，包含音效与混响。"""
    a, b = (round(anchors[k] * SR) for k in ("fade_start", "silence_start"))
    mix[a:b] *= (np.cos(np.linspace(0, np.pi / 2, b - a)) ** 2)[:, None]
    mix[b:] = 0


def render(info):
    duration, sections, cues, anchors = prepare(info)
    music = music_bus(duration, sections, anchors)
    sfx = np.zeros_like(music)
    fx = {kind: (lambda v, kind=kind: cue_voice(kind) * v) for kind in CUE_DURATIONS}
    ak.place_cues(sfx, cues, fx)
    # 分块侧链节省内存；前后 halo 足够覆盖 attack、最长 cue 和 release。
    triggers = np.array([c["t"] for c in cues if c["v"] > 0])
    chunk, halo = SR * 20, SR * 2
    for a in range(0, len(music), chunk):
        b = min(len(music), a + chunk)
        left, right = max(0, a - halo), min(len(music), b + halo)
        times = triggers[(triggers >= left / SR) & (triggers < right / SR)] - left / SR
        ducked = ak.duck(music[left:right], key=sfx[left:right], times=times,
                         depth_db=DUCK_DB, threshold=.008, attack=.012, hold=.045, release=.150)
        music[a:b] = ducked[a - left:b - left]
    music += sfx
    del sfx
    ending_envelope(music, anchors)
    # 与 v1 一样整片 RMS 对齐；仅一个恒定增益，尾部绝无自动补偿/分段抬升。
    mix = ak.normalize(music)
    report = dict(timeline_seconds=duration, anchors=anchors, sections=sections,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())))
    return mix, report


def pcm_stats(pcm, start=0, end=None):
    end = len(pcm) if end is None else min(len(pcm), end)
    energy, peak = 0.0, 0.0
    for a in range(start, end, SR * 4):
        block = pcm[a:min(end, a + SR * 4)].astype(np.float64) / 32768
        energy += float(np.sum(block * block))
        peak = max(peak, float(np.max(np.abs(block))))
    count = max(1, (end - start) * pcm.shape[1])
    return dict(rms_dbfs=10 * math.log10(max(energy / count, 1e-24)),
                peak=peak, peak_dbfs=20 * math.log10(max(peak, 1e-12)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.resolve() in (args.timeline.resolve(), Path(__file__).resolve()):
        parser.error("输出 WAV 不能覆盖时间线或脚本")
    mix, report = render(ak.read_timeline(args.timeline))
    ak.write_wav(args.output, mix)
    del mix
    sr, pcm = wavfile.read(args.output, mmap=True)
    stats = pcm_stats(pcm)
    error = stats["rms_dbfs"] - ak.DEFAULT_RMS_DB
    silent = pcm[round(report["anchors"]["silence_start"] * sr):]
    if (abs(error) > .3 or stats["peak"] >= 1 or np.any(silent)
            or len(pcm) != round(report["timeline_seconds"] * sr)):
        raise RuntimeError(f"响度、峰值、时长或静音验收失败：{stats}, RMS 差 {error:.6f} dB")
    print(f"format=PCM16 sample_rate={sr} channels=2 bpm={BPM} meter=4/4 beat_origin_seconds=0 seed={SEED}")
    print(f"timeline_seconds={report['timeline_seconds']:.6f} duration_seconds={len(pcm) / sr:.6f} tail_seconds=0.0")
    print(f"target_rms_dbfs={ak.DEFAULT_RMS_DB:.6f} pcm_rms_dbfs={stats['rms_dbfs']:.6f} rms_error_db={error:+.6f}")
    print(f"peak={stats['peak']:.9f} peak_dbfs={stats['peak_dbfs']:.6f}")
    a = report["anchors"]
    print(f"band_entry={a['entry']['t']:.3f} sleep={a['sleep_start']:.3f}..{a['sleep_end']:.3f}")
    print("pipeline_downbeats=" + ",".join(f"{t:.3f}" for t in a["pipeline"]))
    print("s10_marimba=" + ",".join(f"{c['t']:.3f}:{note}" for c, note in zip(a["clones"], ("C5", "E5", "G5", "C6"))))
    print("s13_major_stabs=" + ",".join(f"{c['t']:.3f}:C" for c in a["stabs"]))
    print(f"reunion_scene={a['reunion_start']:.3f}..{a['outro']:.3f}")
    print("s15_pop_chords=" + ",".join(f"{c['t']:.3f}:C" for c in a["reunions"]))
    print(f"pad_only_from={a['outro']:.3f} fade={a['fade_start']:.3f}..{a['silence_start']:.3f}")
    print("cue_counts=" + ", ".join(f"{k}:{v}" for k, v in report["cue_counts"].items()))
    for s in report["sections"]:
        measurement = pcm_stats(pcm, round(s["start"] * sr), round(s["end"] * sr))
        print(f"chapter={s['n']} {LABELS[s['n']]} {s['start']:.3f}..{s['end']:.3f} rms_dbfs={measurement['rms_dbfs']:.6f}")
    print(f"silent_tail_seconds={len(silent) / sr:.6f} silent_tail_nonzero_samples={np.count_nonzero(silent)} last_frame={pcm[-1].tolist()}")
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    print(f"sha256={digest.hexdigest()}")


if __name__ == "__main__":
    main()
