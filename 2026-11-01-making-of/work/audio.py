#!/usr/bin/env python3
"""导播间 / 电视台幕后：100 BPM、4/4，D 小调 → F 大调。

用法：python3 -B audio.py timeline.json audio.wav
只写指定的 48 kHz PCM16 WAV；stdout 报告量化后的 RMS、峰值与 SHA-256。
随机声源均显式使用固定种子；导入不渲染、不写字节码。

鼓、低音、琶音一直沿用从零开始的十六分网格。章节首个残小节与
随后完整小节共用首和弦；片名/总结每和弦两小节，首尾按章节裁切。
抽空区间分开渲染，连非 pad 的混响一起收掉，cue 音效仍正常发声。
片尾仅一声 F 钟，干声 2 秒，视频时长后另留 5 秒混响空间。
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
BPM = 100
BEAT = 60 / BPM
BAR = BEAT * 4
STEP = BEAT / 4
SEED = 20261101
TAIL = 5.0
WIPE = 1.9
DUCK_DB = 2.2
OUTRO_DRY = 2.0
EPS = 1e-8

# root 是低音 MIDI，notes 是电钢的中音区排列；pad 另降八度。
CHORDS = {
    "Dm": (38, (62, 65, 69)), "Bb": (34, (62, 65, 70)),
    "F": (41, (60, 65, 69)), "C": (36, (60, 64, 67)),
    "Gm": (31, (62, 67, 70)), "A": (33, (61, 64, 69)),
    "Dm9": (38, (60, 62, 65, 69, 76)),
    "Bbmaj7": (34, (62, 65, 69, 70)),
}
PROGRESSIONS = {
    0: ("Dm",), 1: ("Dm9", "Bbmaj7"),
    2: ("Dm", "Bb", "F", "C"), 3: ("Dm", "Bb", "Gm", "A"),
    4: ("Dm", "F", "C", "Bb"), 5: ("Dm", "Gm", "Dm", "A"),
    6: ("Dm", "Bb", "F", "C"), 7: ("F", "Bb", "C", "F"),
    8: ("F",), "major": ("F", "C", "Dm", "Bb"),
}
LABELS = ("开场", "片名", "第一章", "第二章", "第三章", "第四章", "第五章", "总结", "系列片尾")
# hat_every / bass_every 以十六分音符为单位，0 表示不演奏。
PATTERNS = {
    0: dict(pad=.055, cut=700, piano=0, bass=0, bass_every=0, hat=.035, hat_every=2, kick=(), rim=0, pluck=.065),
    1: dict(pad=.050, cut=1000, piano=.125, bass=0, bass_every=0, hat=0, hat_every=0, kick=(), rim=0, pluck=0),
    2: dict(pad=.040, cut=1100, piano=.125, bass=.105, bass_every=4, hat=.040, hat_every=2, kick=(), rim=0, pluck=0),
    3: dict(pad=.042, cut=1200, piano=.125, bass=.112, bass_every=2, hat=.042, hat_every=1, kick=(0, 8), rim=0, pluck=0),
    4: dict(pad=.044, cut=1350, piano=.125, bass=.105, bass_every=2, hat=.038, hat_every=1, kick=(0, 4, 8, 12), rim=.23, pluck=.070),
    5: dict(pad=.045, cut=800, piano=.110, bass=.100, bass_every=4, hat=.030, hat_every=2, kick=(0,), rim=0, pluck=0),
    6: dict(pad=.044, cut=1200, piano=.125, bass=.108, bass_every=2, hat=.038, hat_every=1, kick=(0, 4, 8, 12), rim=.23, pluck=0),
    7: dict(pad=.055, cut=1800, piano=.125, bass=.105, bass_every=4, hat=.025, hat_every=2, kick=(0, 8), rim=0, pluck=0),
}
CUE_DURATIONS = dict(whoosh=.60, blip=.09, tick=.04, latch=.10,
                     hit=.75, clap=.16, type=.30, error=.42, success=.62,
                     draw=.30, snip=.12, scan=.80, cut=.25, flap=.30)
STAB_CHORDS = ((65, 69, 72), (67, 70, 74), (69, 72, 76), (72, 76, 79))
STAB_NAMES = ("F", "Gm", "Am", "C")


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
    for sid, chap in (("s12", 5), ("s13", 5), ("s14", 5), ("s15", 5), ("s17", 6), ("s18", 6)):
        s, section = scenes[sid], sections[chap]
        if s.get("chap") != chap or s["start"] < section["start"] - EPS or s["end"] > section["end"] + EPS:
            raise ValueError(f"{sid} 须位于章节 {chap} 内")

    def in_scene(sid, kind):
        s = scenes[sid]
        return [c for c in cues if s["start"] <= c["t"] < s["end"] and c["type"] == kind]

    errors, successes = in_scene("s12", "error"), in_scene("s12", "success")
    claps, stabs = in_scene("s17", "clap"), in_scene("s18", "success")
    if not errors or not successes or len(claps) < 2 or len(stabs) != 4:
        raise ValueError("须有 s12 error/success、s17 两次 clap、s18 四次 success")
    windows = [dict(name="blackout", start=errors[0]["t"], end=successes[0]["t"]),
               dict(name="pause", start=claps[0]["t"], end=claps[1]["t"])]
    if any(w["end"] <= w["start"] for w in windows):
        raise ValueError("抽空区间的恢复 cue 须晚于开始 cue")
    return duration, sections, cues, dict(windows=windows, major=claps[1]["t"],
        sparse=[(scenes[s]["start"], scenes[s]["end"]) for s in ("s13", "s14", "s15")], stabs=stabs)


def chord_at(section, t, anchors):
    n = section["n"]
    prog = PROGRESSIONS[n]
    bar = math.floor(t / BAR + EPS)
    if n in (1, 7):
        # 两小节一个和弦；沿全片网格，章节外的首尾部分裁掉。
        origin = math.floor(section["start"] / BAR + EPS)
        index = min((bar - origin) // 2, len(prog) - 1)
    else:
        origin = math.ceil(section["start"] / BAR - EPS)
        if n == 6 and t >= anchors["major"] - EPS:
            prog = PROGRESSIONS["major"]
            origin = math.ceil(anchors["major"] / BAR - EPS)
        index = max(0, bar - origin) % len(prog)
    return prog[index]


def mode_at(section, t, anchors):
    if any(w["start"] <= t < w["end"] for w in anchors["windows"]):
        return "pad_only"
    if section["n"] == 5 and any(a <= t < b for a, b in anchors["sparse"]):
        return "sparse"
    return "major" if section["n"] == 6 and t >= anchors["major"] else "normal"


def segments(section, anchors):
    points = {section["start"], section["end"]}
    candidates = [v for w in anchors["windows"] for v in (w["start"], w["end"])]
    candidates += [v for pair in anchors["sparse"] for v in pair]
    points.update(v for v in candidates if section["start"] < v < section["end"])
    points = sorted(points)
    result = []
    for a, b in zip(points, points[1:]):
        mode = mode_at(section, (a + b) / 2, anchors)
        if result and result[-1][2] == mode:
            result[-1] = (result[-1][0], b, mode)
        else:
            result.append((a, b, mode))
    return result


@lru_cache(maxsize=96)
def piano(note, dur=2.15):
    return ak.electric_piano(ak.mtof(note), dur=dur, bell=.16)


@lru_cache(maxsize=64)
def bass(note, dur=.23):
    x = ak.lp(ak.bass(ak.mtof(note), dur), 420)
    return ak.fade(x, .006, min(.045, dur / 3))


@lru_cache(maxsize=32)
def pluck(note):
    return ak.fade(ak.pluck(ak.mtof(note), .36, bright=.85), .002, .05)


def noise(dur, seed):
    return np.random.default_rng(SEED + seed).standard_normal(round(dur * SR))


@lru_cache(maxsize=1)
def kick():
    return ak.fade(ak.lp(ak.kick(), 1500), .002, .04)


@lru_cache(maxsize=1)
def rimshot():
    t = ak.tvec(.075)
    n = noise(.075, 10)
    x = ak.bp(n, 1400, 4200) * np.exp(-t / .012)
    x += .6 * ak.hp(n, 6500) * np.exp(-t / .0025)
    return ak.fade(x * .18, .0005, .008)


def sweep(dur, seed, low=350, high=6500):
    """对数分布的带通噪声交叉淡变，连续扫频，无逐块滤波接缝。"""
    t = ak.tvec(dur)
    u = t / dur
    n, out = noise(dur, seed), np.zeros(len(t))
    centers = np.geomspace(low, high, 10)
    for i, center in enumerate(centers):
        weight = np.maximum(0, 1 - np.abs(u * (len(centers) - 1) - i))
        out += ak.bp(n, center * .6, center * 1.4) * weight
    return out


def mono_add(out, sig, t, gain=1):
    i = round(t * SR)
    count = min(len(sig), len(out) - i)
    if count > 0:
        out[i:i + count] += sig[:count] * gain


@lru_cache(maxsize=14)
def cue_voice(kind):
    d = CUE_DURATIONS[kind]
    t, x = ak.tvec(d), np.zeros(round(d * SR))
    if kind == "whoosh":
        x = ak.s_whoosh(.26, d=d, rng=SEED + 100)
    elif kind == "blip":
        x = .095 * np.sin(2 * np.pi * 1380 * t) * np.exp(-t * 50)
    elif kind == "tick":
        x = ak.s_tick(.16, rng=SEED + 101)
    elif kind in ("latch", "type", "flap"):
        offsets = {"latch": (0, .045), "type": (0, .064, .140, .222),
                   "flap": (0, .047, .100, .161, .222)}[kind]
        for k, offset in enumerate(offsets):
            tt = ak.tvec(.035)
            hit = ak.bp(noise(.035, 120 + k), 1900, 7000) * np.exp(-tt / .004)
            hit = hit * .065 + ak.woodblock(1250 + 170 * k, .035, .45) * .17
            mono_add(x, ak.fade(hit, .0004, .005), offset,
                     (.90 if k % 2 else 1) * (.60 if kind == "type" else 1))
    elif kind == "hit":
        freq = 43 + 37 * np.exp(-t * 18)
        x = .16 * np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 7)
        x += ak.bp(noise(d, 131), 600, 3500) * np.exp(-t * 65) * .065
    elif kind == "clap":
        x = ak.bp(noise(d, 132), 800, 4200) * np.exp(-t * 65) * .17
        x += np.sin(2 * np.pi * 185 * t) * np.exp(-t * 45) * .065
    elif kind == "error":
        for k, m in enumerate((45, 41)):
            tt = ak.tvec(.24)
            f = ak.mtof(m)
            tone = np.sin(2 * np.pi * f * tt) * .070 + ak.sq(f, tt, 11) * .018
            tone *= ak.adsr(.24, .004, .040, .55, .07)
            mono_add(x, ak.lp(tone, 1500), k * .17)
    elif kind == "success":
        for k, m in enumerate((77, 84)):
            tt = ak.tvec(.48)
            f = ak.mtof(m)
            tone = (np.sin(2 * np.pi * f * tt) + .13 * np.sin(2 * np.pi * 2 * f * tt))
            tone *= .085 * np.exp(-tt * 9)
            mono_add(x, ak.fade(tone, .002, .025), k * .11)
    elif kind == "draw":
        grain = .45 + .55 * np.sin(2 * np.pi * 47 * t) ** 2
        x = ak.bp(noise(d, 133), 1800, 5000) * np.sin(np.pi * t / d) ** 2 * grain * .065
    elif kind == "snip":
        for k, offset in enumerate((0, .065)):
            tt = ak.tvec(.045)
            hit = ak.lp(ak.hp(noise(.045, 134 + k), 4000), 11500)
            hit *= np.exp(-tt / .006) * (.09 if k == 0 else .075)
            mono_add(x, ak.fade(hit, .0004, .006), offset)
    elif kind == "scan":
        phase = 2 * np.pi * (850 * t + 650 * t * t / (2 * d))
        x = (sweep(d, 136) * .09 + np.sin(phase) * .018) * np.sin(np.pi * t / d)
    elif kind == "cut":
        freq = 55 + 1500 * np.exp(-t * 24)
        x = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 10) * .075
        x += ak.hp(noise(d, 137), 5000) * np.exp(-t * 180) * .045
    else:
        raise ValueError(kind)
    return ak.fade(x, .0005, .008)


def bell():
    t, f = ak.tvec(OUTRO_DRY), ak.mtof(77)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / .72)
    for ratio, gain, decay in ((2.006, .35, .40), (2.99, .16, .27), (4.17, .06, .12)):
        x += gain * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / decay)
    return ak.fade(x * .13, .003, .18)


def segment_audio(section, start, end, mode, anchors):
    n = section["n"]
    p = dict(PATTERNS[n])
    if mode == "pad_only":
        p.update(pad=p["pad"] * .72, cut=300, piano=0, bass=0,
                 bass_every=0, hat=0, hat_every=0, kick=(), rim=0, pluck=0)
    elif mode == "sparse":
        p.update(piano=0, bass=.080, bass_every=4, hat=.022, hat_every=2,
                 kick=(), rim=0, pluck=0, cut=750)
    first = round(start * SR)
    frames = round(end * SR) - first
    pad = np.zeros((frames, 2), dtype=np.float32)
    harmonic, rhythm = np.zeros_like(pad), np.zeros_like(pad)

    def place(buf, sig, t, gain, pan=0):
        ak.add(buf, sig, (round(t * SR) - first) / SR, gain, pan)

    def ep_chord(notes, t, gain, dur=2.15):
        for note, pan in zip(notes, np.linspace(-.22, .22, len(notes))):
            place(harmonic, piano(note, dur), t, gain, pan)

    # pad 按小节续接，释放段重叠；整段结尾再统一淡收。
    first_bar, last_bar = math.floor(start / BAR + EPS), math.ceil(end / BAR - EPS)
    previous = None
    for bar in range(first_bar, last_bar):
        t, stop = max(start, bar * BAR), min(end, (bar + 1) * BAR)
        chord = chord_at(section, t, anchors)
        notes = CHORDS[chord][1]
        cut, gain = p["cut"], p["pad"]
        if mode == "major":
            progress = np.clip((t - anchors["major"]) / (section["end"] - anchors["major"]), 0, 1)
            cut, gain = 1200 + progress * 1300, .044 + progress * .008
        place(pad, ak.pad_chord(tuple(m - 12 for m in notes), stop - t + .55, cut=cut), t, gain)
        if p["piano"]:
            at = t
            if 2 <= n <= 7:
                at = math.ceil(max(t, section["start"] + WIPE) / BEAT - EPS) * BEAT
            if at < stop - EPS and (n != 1 or chord != previous):
                ep_chord(notes, at, p["piano"] * (3 / len(notes)) ** .5,
                         3.8 if n == 1 else 2.15)
        previous = chord

    landings = [section["start"]] if 2 <= n <= 7 else []
    landings.extend(w["end"] for w in anchors["windows"])
    for step in range(math.ceil(start / STEP - EPS), math.ceil(end / STEP - EPS)):
        t, slot = step * STEP, step % 16
        if 2 <= n <= 7 and t < section["start"] + WIPE - EPS:
            continue
        root, notes = CHORDS[chord_at(section, t, anchors)]
        # cue 恢复落点若离下一格不足一格，用落点替代，避免底鼓双击。
        near_landing = any(-EPS <= t - u < STEP - EPS for u in landings)
        if p["bass_every"] and step % p["bass_every"] == 0 and not near_landing:
            place(rhythm, bass(root, .23 if p["bass_every"] == 2 else .42), t,
                  p["bass"] * (1 if slot % 4 == 0 else .72))
        if p["hat_every"] and step % p["hat_every"] == 0:
            hat_gain = p["hat"] * (1 if slot % 4 == 0 else .62 if slot % 2 else .80)
            place(rhythm, ak.hat(rng=SEED + 10000 + step), t, hat_gain, .20)
        if slot in p["kick"] and not near_landing:
            place(rhythm, kick(), t, .055 if n in (4, 6) else .050)
        if p["rim"] and slot in (4, 12):
            place(rhythm, rimshot(), t, p["rim"], -.12)
        gain = p["pluck"]
        if mode == "major":
            progress = np.clip((t - anchors["major"]) / (section["end"] - anchors["major"]), 0, 1)
            gain = .055 + .023 * progress
        if gain and (n != 0 or step % 32 == 8):
            pick = (0, 1, 2, 1, 0, 2, 1, 2)[step % 8]
            place(harmonic, pluck(notes[pick] + 12), t, gain * (1 if slot % 4 == 0 else .75),
                  (-.25, .12, .26)[pick])

    # 划像只响一次轻下拍；恢复时增加一次下拍，但不移动后续网格。
    for t in landings:
        if start <= t < end and mode != "pad_only":
            root = CHORDS[chord_at(section, t, anchors)][0]
            place(rhythm, bass(root, .42), t, .100)
            place(rhythm, kick(), t, .052)
    if n == 1 and start == section["start"]:
        place(rhythm, cue_voice("hit"), start, .65)
    if n in (0, 1):
        dur = min(2.0 if n == 0 else 1.2, end - start)
        tt = ak.tvec(dur)
        riser = sweep(dur, 200 + n) * (tt / dur) ** 1.6 * .065
        place(rhythm, ak.fade(riser, .04, .025), end - dur, 1)
    if n == 6:
        for cue, notes in zip(anchors["stabs"], STAB_CHORDS):
            if start <= cue["t"] < end and mode != "pad_only":
                ep_chord(notes, cue["t"], .170 * cue["v"], .72)

    # 混响在每个状态段内部完成；断电/暂停前的尾音也会被切干净。
    active = ak.reverb(harmonic, dur=1.35, decay=.36, wet=.085,
                       rng=SEED + 300, predelay=.018)
    active += rhythm
    active = ak.fade(active, .002, .025)
    active_peak = float(np.max(np.abs(active)))
    if mode == "pad_only" and active_peak != 0:
        raise AssertionError("抽空段残留非 pad 声部")
    active += ak.reverb(pad, dur=1.6, decay=.45, wet=.10,
                        rng=SEED + 301, predelay=.025)
    out = ak.fade(active, .10 if n == 0 else .012, .030)
    if n == 7:
        # 最后两小节轻增至 +1.2 dB，片尾落点前 60 ms 收住。
        times = np.arange(frames) / SR + first / SR
        ramp = np.clip((times - (end - 2 * BAR)) / (2 * BAR), 0, 1)
        out *= (10 ** (1.2 * ramp / 20))[:, None]
        stop = max(0, frames - round(.060 * SR))
        fade = min(stop, round(.22 * SR))
        out[stop - fade:stop] *= np.linspace(1, 0, fade)[:, None]
        out[stop:] = 0
    return out.astype(np.float32), active_peak


def music_bus(duration, sections, anchors):
    music = np.zeros((round((duration + TAIL) * SR), 2), dtype=np.float32)
    for section in sections:
        if section["n"] == 8:
            first = round(section["start"] * SR)
            out = np.zeros((len(music) - first, 2), dtype=np.float32)
            ak.add(out, bell(), 0)
            out = ak.reverb(out, dur=4.5, decay=1.25, wet=.30,
                            rng=SEED + 302, predelay=.025)
            music[first:] += ak.fade(out, .001, .10).astype(np.float32)
            continue
        for start, end, mode in segments(section, anchors):
            sig, active_peak = segment_audio(section, start, end, mode, anchors)
            first = round(start * SR)
            music[first:first + len(sig)] += sig
            if mode == "pad_only":
                window = next(w for w in anchors["windows"] if w["start"] == start)
                window["non_pad_peak"] = active_peak
    return music


def render(info):
    duration, sections, cues, anchors = prepare(info)
    music = music_bus(duration, sections, anchors)
    sfx = np.zeros_like(music)
    fx = {kind: (lambda v, kind=kind: cue_voice(kind) * v) for kind in CUE_DURATIONS}
    ak.place_cues(sfx, cues, fx)
    # 分块调用同一 duck；halo 覆盖 attack/hold/release，块缝不重置侧链。
    triggers = np.array([c["t"] for c in cues if c["v"] > 0])
    chunk, halo = SR * 20, SR
    for a in range(0, len(music), chunk):
        b = min(len(music), a + chunk)
        left, right = max(0, a - halo), min(len(music), b + halo)
        times = triggers[(triggers >= left / SR) & (triggers < right / SR)] - left / SR
        ducked = ak.duck(music[left:right], key=sfx[left:right], times=times,
                         depth_db=DUCK_DB, threshold=.006, attack=.015, hold=.050, release=.160)
        music[a:b] = ducked[a - left:b - left]
    music += sfx
    del sfx
    mix = ak.normalize(music)
    report = dict(sample_rate=SR, bpm=BPM, seed=SEED, timeline_seconds=duration,
                  tail_seconds=TAIL, target_rms_dbfs=ak.DEFAULT_RMS_DB,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  windows=anchors["windows"], major_from=anchors["major"],
                  stabs=[dict(t=c["t"], chord=name) for c, name in zip(anchors["stabs"], STAB_NAMES)],
                  sections=sections)
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
    video = pcm_stats(pcm, end=round(report["timeline_seconds"] * sr))
    error = stats["rms_dbfs"] - ak.DEFAULT_RMS_DB
    if abs(error) > .3 or stats["peak"] >= 1:
        raise RuntimeError(f"响度或峰值验收失败：{stats}, RMS 差 {error:.6f} dB")
    print(f"format=PCM16 sample_rate={sr} channels=2 bpm={BPM} meter=4/4 seed={SEED}")
    print(f"timeline_seconds={report['timeline_seconds']:.6f} duration_seconds={len(pcm) / sr:.6f} tail_seconds={TAIL:.1f}")
    print(f"target_rms_dbfs={ak.DEFAULT_RMS_DB:.6f} pcm_rms_dbfs={stats['rms_dbfs']:.6f} rms_error_db={error:+.6f}")
    print(f"peak={stats['peak']:.9f} peak_dbfs={stats['peak_dbfs']:.6f} video_span_rms_dbfs={video['rms_dbfs']:.6f}")
    for w in report["windows"]:
        print(f"{w['name']}={w['start']:.6f}..{w['end']:.6f} non_pad_peak={w['non_pad_peak']:.9f}")
    print(f"F_major_from={report['major_from']:.6f}")
    print("s18_stabs=" + ", ".join(f"{s['t']:.3f}:{s['chord']}" for s in report["stabs"]))
    print("cue_counts=" + ", ".join(f"{k}:{v}" for k, v in report["cue_counts"].items()))
    for s in report["sections"]:
        measurement = pcm_stats(pcm, round(s["start"] * sr), round(s["end"] * sr))
        print(f"chapter={s['n']} {LABELS[s['n']]} {s['start']:.3f}..{s['end']:.3f} rms_dbfs={measurement['rms_dbfs']:.6f}")
    tail = pcm_stats(pcm, start=round(report["timeline_seconds"] * sr))
    print(f"tail_rms_dbfs={tail['rms_dbfs']:.6f} last_frame={pcm[-1].tolist()}")
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    print(f"sha256={digest.hexdigest()}")


if __name__ == "__main__":
    main()
