#!/usr/bin/env python3
"""幕后制作 v3：C 大调、110 BPM、4/4，一条连续的 lo-fi 配乐。

用法：python3 -B audio.py timeline.json audio.wav
保持 film-kit 导入方式；只写指定的 48 kHz 立体声 PCM16 WAV。
所有声部使用从零开始的绝对节拍网格，和弦仅在小节线上变化。
章节、入场、睡觉、合体和收工均从时间线查找，不写死章节秒数。
乐器总线平滑自动化；混响、延时跨章延续，睡觉保持原有和声与节拍。
结尾包络作用于完整混音，限幅后整片对齐 −24.4 dBFS；无硬静音段。
所有随机声源显式固定种子；导入不渲染、不写字节码。
"""

import argparse
from collections import Counter
from functools import lru_cache
from itertools import product
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
# 各类音效相对原始合成的增益：元素切换的 pop / tick 要听得清，whoosh 不压过音乐
CUE_GAIN_DB = dict(pop=13, tick=14, hop=6, type=8, ding=5, snip=6, flip=5, bloop=5, bonk=5, poof=5, whoosh=-1)
FADE_SECONDS = 3.0
TARGET_RMS_DB = -24.4
PEAK_DB = -1.0
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
# 各章只改变层增益；所有音符、延时和混响共用全片总线。
LAYERS = ("pad", "keys", "pluck", "bass", "kick", "clap", "shaker", "hat", "box")
LEVELS = dict(pad=.105, keys=.105, pluck=.073, bass=.095, kick=.080,
              clap=.075, shaker=.18, hat=.030, box=.060)
PATTERNS = {
    0: (1, .7, 0, 0, 0, 0, 0, 0, 0),
    1: (1, 1, 1, 1, 1, 1, 1, 0, 0),
    2: (1, 1, .6, 1, 1, 1, 1, 0, 0),
    3: (1, 1, 1, 1, 1, 1, 1, 1, 0),
    4: (1, 1, 1, 1, 1, 1, 1, 1, 0),
    5: (1, 1, 1, 1, 1, 1, 1, 0, 0),
    6: (1, 1, 1, 1, 1, 1, 1, 1, 0),
    7: (1, 1.05, 1, 1, 1, 1, 1, 0, 0),
    8: (1, 1, .75, 1, 1, 1, 1, 0, 0),
}
CUE_DURATIONS = dict(type=.30, pop=.18, hop=.12, whoosh=.60, tick=.04,
                     ding=.65, snip=.14, flip=.25, zzz=1.15, bonk=.24,
                     poof=.40, bloop=.26)


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
    fade_start = max(outro, duration - FADE_SECONDS)
    anchors = dict(entry=entry[0], sleep_start=sleeps[0]["t"], sleep_end=wakes[0]["t"],
                   clones=clones[-4:], stabs=stabs, reunions=reunions,
                   pipeline=[scenes[f"s{k:02d}"]["start"] for k in range(4, 10)],
                   reunion_start=scenes["s15"]["start"], outro=outro,
                   fade_start=fade_start)
    return duration, sections, cues, anchors


def bar_line(t, rounding="nearest"):
    position = t / BAR
    bar = (math.floor(position + .5) if rounding == "nearest" else
           math.ceil(position - EPS) if rounding == "next" else math.floor(position + EPS))
    return bar * BAR


def chord_at(section, t):
    # 前六章共用连续的四小节循环；新进行从该章首个完整小节开始。
    bar = math.floor(t / BAR + EPS)
    origin = 0 if section["n"] < 6 else math.ceil(section["start"] / BAR - EPS)
    prog = PROGRESSIONS[section["n"]]
    return prog[max(0, bar - origin) % len(prog)]


def voice_lead(notes, previous):
    choices = [tuple(sorted(note + shift for note, shift in zip(notes, shifts)))
               for shifts in product((-12, 0, 12), repeat=3)]
    choices = [v for v in choices if 55 <= v[0] and v[-1] <= 76 and v[-1] - v[0] <= 12]
    return min(choices, key=lambda v: (sum(abs(a - b) for a, b in zip(v, previous)), v))


def envelope(frames, initial, events, offset=0):
    """绝对时间上的余弦渐变；新事件接续当时的增益，不跳回旧目标。"""
    t = (np.arange(frames) + offset) / SR
    out = np.full(frames, initial, dtype=np.float32)
    start, span, source, target = 0.0, 0.0, initial, initial
    for when, seconds, value in sorted(events, key=lambda e: e[0]):
        phase = np.clip((when - start) / span, 0, 1) if span else 1
        source = source + (target - source) * (.5 - .5 * np.cos(np.pi * phase))
        start, span, target = when, seconds, value
        phase = np.clip((t - start) / span, 0, 1)
        mask = t >= start
        out[mask] = (source + (target - source) * (.5 - .5 * np.cos(np.pi * phase[mask])))
    return out


def automate(bus, initial, events):
    for a in range(0, len(bus), SR * 4):
        b = min(len(bus), a + SR * 4)
        bus[a:b] *= envelope(b - a, initial, events, a)[:, None]


def automation(sections, anchors):
    events = {layer: [] for layer in LAYERS}
    for s in sections[1:]:
        # 片名的乐队入场取章内第一个小节线，其余章节取最近的小节线。
        t = bar_line(s["start"], "next" if s["n"] == 1 else "nearest")
        for layer, value in zip(LAYERS, PATTERNS[s["n"]]):
            events[layer].append((t, BAR, value))
    sleep = bar_line(anchors["sleep_start"], "floor")
    wake = anchors["sleep_end"]
    return_bar = bar_line(wake, "next")
    for layer in ("kick", "clap", "shaker", "hat"):
        events[layer].extend(((sleep, BAR, 0), (return_bar, BAR, 0 if layer == "hat" else 1)))
    events["pluck"].extend(((sleep, BAR, .35), (return_bar, BAR, 1)))
    events["box"].extend(((sleep, BAR, 1), (wake, BAR / 2, 0)))
    outro = bar_line(anchors["outro"])
    for layer in ("kick", "clap", "shaker", "hat", "pluck"):
        events[layer].append((outro, BAR * 2, 0))
    # 收束前低音也缓慢退下，留下持续的 C 和弦。
    events["bass"].append((outro, BAR * 2, 0))
    cutoff = [(bar_line(s["start"]), BAR, 8500 if s["n"] == 4 else 7000)
              for s in sections[1:]]
    cutoff.extend(((sleep, BAR, 1200), (wake, BAR / 2, 7000)))
    lift = [(bar_line(sections[1]["start"], "next"), BAR, 1.02),
            (bar_line(sections[7]["start"]), BAR, 1.06), (outro, BAR * 2, 1)]
    return events, cutoff, lift


@lru_cache(maxsize=96)
def piano(note, dur=1.75):
    return ak.electric_piano(ak.mtof(note), dur=dur, bell=.14)


@lru_cache(maxsize=64)
def bass(note, dur=.43):
    return ak.fade(ak.lp(ak.bass(ak.mtof(note), dur), 420), .006, .045)


@lru_cache(maxsize=64)
def pluck(note):
    return ak.fade(ak.pluck(ak.mtof(note), .95, bright=.72), .003, .12)


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


@lru_cache(maxsize=16)
def pad(notes):
    # 去掉工具内置的长起落，改为相邻小节重叠 0.3 秒的互补交叉淡化。
    frames, trim = round((BAR + .3) * SR), round(.5 * SR)
    tone = ak.pad_chord(notes, (frames + trim) / SR + .9, cut=1600)[trim:trim + frames]
    stereo = np.column_stack((tone, np.r_[np.zeros(round(.011 * SR)), tone][:frames]))
    return ak.fade(stereo, .3, .3)


def instrument_bus(layer, frames, bars):
    bus = np.zeros((frames, 2), dtype=np.float32)
    rng = np.random.default_rng(SEED + 200)
    closing = bar_line(frames / SR - FADE_SECONDS, "floor")
    for bar, t, section, chord, voicing in bars:
        root, notes = CHORDS[chord]
        high = tuple(sorted(72 + note % 12 for note in notes))
        gain = LEVELS[layer]
        if layer == "pad":
            ak.add(bus, pad(tuple(note - 12 for note in notes)), t, gain)
        elif layer == "keys":
            for beat, accent in ((0, 1), (1.5, .48), (3, .62)):
                when = t + beat * BEAT
                if when >= closing - EPS:
                    continue
                when = max(0, when + rng.uniform(-.008, .008))
                velocity = gain * accent * rng.uniform(.9, 1.1)
                for note, pan in zip(voicing, (-.25, 0, .25)):
                    ak.add(bus, piano(note), when, velocity, pan)
        elif layer == "pluck":
            for slot, pick in enumerate((0, 1, 2, 1, 0, 1, 2, 1)):
                when = t + (slot // 2 + .56 * (slot % 2)) * BEAT
                ak.add(bus, pluck(high[pick]), when, gain * (.82 if slot % 2 else 1),
                       (-.28, .08, .28)[pick])
        elif layer == "bass":
            ak.add(bus, bass(root, .95), t, gain)
            octave = bar % 4 == 3
            ak.add(bus, bass(root + 7, .25 if octave else .50), t + 2.5 * BEAT, gain * .65)
            if octave:
                ak.add(bus, bass(root + 12, .38), t + 3 * BEAT, gain * .45)
        elif layer == "kick":
            for beat, accent in ((0, 1), (1.5, .55)):
                ak.add(bus, kick(), t + beat * BEAT, gain * accent)
        elif layer == "clap":
            hit = ak.lp(ak.clap(rng=SEED + 3000 + bar), 3000)
            for beat in (1, 3):
                ak.add(bus, hit, t + beat * BEAT, gain, -.08)
        elif layer == "shaker":
            for slot in range(8):
                when = t + (slot // 2 + .56 * (slot % 2)) * BEAT
                hit = ak.shaker(bright=.8, rng=SEED + 10000 + bar * 8 + slot)
                ak.add(bus, hit, when, gain * (.6 if slot % 2 == 0 else 1), .20)
        elif layer == "hat":
            for slot in range(16):
                hit = ak.hat(rng=SEED + 20000 + bar * 16 + slot)
                ak.add(bus, hit, t + slot * BEAT / 4, gain * (.65 if slot % 2 == 0 else 1), -.20)
        elif layer == "box":
            for beat, pick in enumerate((0, 1, 2, 1)):
                ak.add(bus, marimba(high[pick] + 12, 1.15), t + beat * BEAT, gain, -.12)
    if layer == "keys":
        for note, pan in zip((48, 55, 59, 64, 74), np.linspace(-.3, .3, 5)):
            ak.add(bus, piano(note, frames / SR - closing), closing, LEVELS[layer] * .78, pan)
    return bus


def lowpass_bus(music, events):
    """连续滤波器组按对数截止频率交叉混合，所有滤波器保留全片状态。"""
    centers = np.array((1200, 1800, 2700, 4000, 5500, 7000, 8500))
    out = np.zeros_like(music)
    for k, center in enumerate(centers):
        filtered = ak.lp(music, center)
        for a in range(0, len(music), SR * 4):
            b = min(len(music), a + SR * 4)
            cut = envelope(b - a, 7000, events, a)
            position = np.interp(np.log(cut), np.log(centers), np.arange(len(centers)))
            weight = np.maximum(0, 1 - np.abs(position - k))
            out[a:b] += filtered[a:b] * weight[:, None]
        del filtered
    return out


def texture(frames, music):
    rng = np.random.default_rng(SEED + 400)
    bed = ak.bp(rng.standard_normal((frames, 2)), 800, 6000).astype(np.float32)
    # 以整片音乐为参考，底噪低 19 dB；噼啪声稀疏且使用独立固定随机流。
    bed *= 10 ** ((ak.rms_db(music) - 19 - ak.rms_db(bed)) / 20)
    level = 10 ** (ak.rms_db(music) / 20)
    for t in np.arange(.8, frames / SR, 1.9):
        if rng.random() < .6:
            grain = ak.bp(rng.standard_normal(round(.007 * SR)), 800, 6000)
            grain = ak.fade(grain, .0002, .006)
            ak.add(bed, grain, t + rng.uniform(-.4, .4), level * .035, rng.uniform(-.6, .6))
    return bed


def music_bus(duration, sections, anchors):
    frames = round(duration * SR)
    music = np.zeros((frames, 2), dtype=np.float32)
    events, cutoff, lift = automation(sections, anchors)
    bars, previous = [], CHORDS["C"][1]
    for bar in range(math.ceil(duration / BAR)):
        t = bar * BAR
        section = ak.section_at(t, sections)
        chord = chord_at(section, t)
        previous = voice_lead(CHORDS[chord][1], previous)
        bars.append((bar, t, section, chord, previous))
    # 逐乐器渲染完整时间轴以控制内存；只在全局总线做一次延时和混响。
    for layer in ("pad", "keys", "pluck", "box"):
        bus = instrument_bus(layer, frames, bars)
        automate(bus, PATTERNS[0][LAYERS.index(layer)], events[layer])
        if layer == "pluck":
            bus = ak.delay(bus, dt=BEAT * .75, fb=.28, wet=.12).astype(np.float32)
        music += bus
        del bus
    for c in anchors["reunions"]:
        for note, pan in zip((72, 76, 79), (-.2, 0, .2)):
            ak.add(music, marimba(note, .85), c["t"], .033 * c["v"], pan)
    music = ak.reverb(music, dur=1.5, decay=.40, wet=.09,
                      rng=SEED + 300, predelay=.018).astype(np.float32)
    for layer in ("bass", "kick", "clap", "shaker", "hat"):
        bus = instrument_bus(layer, frames, bars)
        automate(bus, PATTERNS[0][LAYERS.index(layer)], events[layer])
        music += bus
        del bus
    return_bar = bar_line(anchors["sleep_end"], "next")
    ak.add(music, ak.s_whoosh(v=.018, d=.45, rng=SEED + 500), return_bar - .45)
    music += texture(frames, music)
    music = lowpass_bus(music, cutoff)
    automate(music, 1, lift)
    # Kick 同步侧链：静音的鼓不触发；轻拍按其实际力度缩小压低量。
    pump = np.zeros(frames, dtype=np.float32)
    for bar, t, section, chord, voicing in bars:
        for beat, accent in ((0, 1), (1.5, .55)):
            when = t + beat * BEAT
            strength = envelope(1, 0, events["kick"], round(when * SR))[0] * accent
            a, b = max(0, round((when - .006) * SR)), min(frames, round((when + .18) * SR))
            curve = np.interp(np.arange(a, b) / SR, (when - .006, when, when + .18), (0, strength, 0))
            pump[a:b] = np.maximum(pump[a:b], curve)
    music *= (10 ** (-2 * pump / 20))[:, None]
    return music


def ending_envelope(mix, anchors):
    """唯一的总线淡出包含音效与混响；余弦曲线在最后一个采样点归零。"""
    a = round(anchors["fade_start"] * SR)
    mix[a:] *= (np.cos(np.linspace(0, np.pi / 2, len(mix) - a)) ** 2)[:, None]
    mix[-1] = 0


def render(info):
    duration, sections, cues, anchors = prepare(info)
    music = music_bus(duration, sections, anchors)
    sfx = np.zeros_like(music)
    fx = {kind: (lambda v, kind=kind: cue_voice(kind) * v * 10 ** (CUE_GAIN_DB.get(kind, 0) / 20))
          for kind in CUE_DURATIONS}
    ak.place_cues(sfx, cues, fx)
    # 分块侧链节省内存；halo 覆盖最长 cue，始终读取未避让的音乐。
    triggers = np.array([c["t"] for c in cues if c["v"] > 0])
    chunk, halo = SR * 20, SR * 2
    for a in range(0, len(music), chunk):
        b = min(len(music), a + chunk)
        left, right = max(0, a - halo), min(len(music), b + halo)
        times = triggers[(triggers >= left / SR) & (triggers < right / SR)] - left / SR
        ducked = ak.duck(np.ones((right - left, 2), dtype=np.float32),
                         key=sfx[left:right], times=times, depth_db=DUCK_DB,
                         threshold=.008, attack=.012, hold=.045, release=.150)
        music[a:b] *= ducked[a - left:b - left]
    # 连续性只检查音乐本身：音效的起落不算断裂
    music_only = music.copy()
    ending_envelope(music_only, anchors)
    music += sfx
    del sfx
    ending_envelope(music, anchors)
    mix = ak.limit_bus(music, ceiling_db=PEAK_DB)
    mix = ak.normalize(mix, target_rms_db=TARGET_RMS_DB, peak_db=PEAK_DB)
    report = dict(music_only=music_only, timeline_seconds=duration, anchors=anchors, sections=sections,
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


def continuity_stats(pcm, sr):
    frames = round(.05 * sr)
    count = len(pcm) // frames
    db = np.empty(count)
    for k in range(count):
        block = pcm[k * frames:(k + 1) * frames].astype(np.float64) / 32768
        db[k] = 10 * np.log10(max(np.mean(block * block), 1e-24))
    times = (np.arange(count) + .5) * frames / sr
    # 与前后各 100 ms 处的 50 ms 格比较；两侧都超过 6 dB 才算凹陷。
    dip = np.minimum(db[:-4], db[4:]) - db[2:-2]
    valid = (times[2:-2] >= 2) & (times[2:-2] <= len(pcm) / sr - 4)
    candidates = np.flatnonzero(valid)
    worst = candidates[np.argmax(dip[valid])]
    failures = times[2:-2][valid & (dip > 6)]
    return dict(windows=int(valid.sum()), failures=failures.tolist(),
                max_dip_db=float(dip[worst]), worst_seconds=float(times[worst + 2]))


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
    error = stats["rms_dbfs"] - TARGET_RMS_DB
    continuity = continuity_stats(report.pop("music_only"), sr)
    nonzero = np.flatnonzero(np.any(pcm != 0, axis=1))
    silent_tail = (len(pcm) - nonzero[-1] - 1) / sr if len(nonzero) else len(pcm) / sr
    if (sr != SR or pcm.dtype != np.int16 or pcm.ndim != 2 or pcm.shape[1] != 2
            or abs(error) > .1 or stats["peak_dbfs"] > PEAK_DB
            or len(pcm) != round(report["timeline_seconds"] * sr)
            or continuity["failures"] or silent_tail > .2 or np.any(pcm[-1])):
        raise RuntimeError(f"验收失败：{stats}, RMS 差 {error:.6f} dB, continuity={continuity}, tail={silent_tail}")
    print(f"format=PCM16 sample_rate={sr} channels=2 bpm={BPM} meter=4/4 beat_origin_seconds=0 seed={SEED}")
    print(f"timeline_seconds={report['timeline_seconds']:.6f} duration_seconds={len(pcm) / sr:.6f} tail_seconds=0.0")
    print(f"target_rms_dbfs={TARGET_RMS_DB:.6f} pcm_rms_dbfs={stats['rms_dbfs']:.6f} rms_error_db={error:+.6f}")
    print(f"peak={stats['peak']:.9f} peak_dbfs={stats['peak_dbfs']:.6f}")
    a = report["anchors"]
    print(f"band_entry={bar_line(report['sections'][1]['start'], 'next'):.6f}")
    print(f"sleep_cue={a['sleep_start']:.3f} sleep_ramp={bar_line(a['sleep_start'], 'floor'):.6f}")
    print(f"wake_filter={a['sleep_end']:.3f} drum_return={bar_line(a['sleep_end'], 'next'):.6f}")
    print("s15_marimba_C5_E5_G5=" + ",".join(f"{c['t']:.3f}" for c in a["reunions"]))
    print(f"outro_ramp={bar_line(a['outro']):.6f} closing_Cmaj9={bar_line(report['timeline_seconds'] - FADE_SECONDS, 'floor'):.6f}")
    print(f"fade={a['fade_start']:.6f}..{report['timeline_seconds']:.6f}")
    print("cue_counts=" + ", ".join(f"{k}:{v}" for k, v in report["cue_counts"].items()))
    for s in report["sections"]:
        measurement = pcm_stats(pcm, round(s["start"] * sr), round(s["end"] * sr))
        print(f"chapter={s['n']} {LABELS[s['n']]} {s['start']:.3f}..{s['end']:.3f} rms_dbfs={measurement['rms_dbfs']:.6f}")
    print(f"continuity_windows={continuity['windows']} failures={len(continuity['failures'])} max_dip_db={continuity['max_dip_db']:.6f} worst_seconds={continuity['worst_seconds']:.3f}")
    print(f"silent_tail_seconds={silent_tail:.6f} last_frame={pcm[-1].tolist()}")
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    print(f"sha256={digest.hexdigest()}")


if __name__ == "__main__":
    main()
