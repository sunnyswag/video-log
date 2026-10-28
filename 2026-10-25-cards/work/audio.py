#!/usr/bin/env python3
"""包豪斯积木配乐：104 BPM / 4/4，48 kHz stereo PCM16，全部离线合成。

用法：python3 audio.py /absolute/timeline.json /absolute/output.wav
依赖 numpy、scipy 和 ../../tools/film-kit/audio_kit.py；FILM_KIT_DIR 可覆盖库路径。
只写指定 WAV，PCM 实测和分轨统计打印到 stdout，不生成旁车或字节码文件。

chapters.n：0 开场、1 片名、2–6 五章、7 总结、8 结尾、9 片尾。
不依赖 scenes、caption 文案或固定节目时间。每个 chapter.t 是局部小节第一拍；
104 BPM 不变，非整小节段落在最后完整小节后收尾留白，再于下一章重新起拍。
不足一小节的章按实际长度截短，音符留短淡出。主题前三音在小节末三枚八分音符，
第四音落在下一小节第一拍；过短片段不加速、也不把主题挤到章节之外。

沿用试点的响度口径：整片 RMS 统一增益，峰值优先，PCM16 / 32768 实测。
所有随机源显式固定种子；无全局随机流，无 Python hash 参与合成。
"""

import argparse
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import wave

sys.dont_write_bytecode = True
KIT_DIR = Path(os.environ.get("FILM_KIT_DIR", Path(__file__).resolve().parent / "../../tools/film-kit")).resolve()
sys.path.insert(0, str(KIT_DIR))
import numpy as np
from scipy.io import wavfile
import audio_kit as ak

SR = ak.SR
BPM = 104.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
SEED = 20261025
FINAL_FADE = 1.5
MUSIC_RMS_DB = -28.0
TARGET_RMS_DB = -24.4
HEADROOM_DB = -1.0
CUE_GAP_DB = 6.0
DUCK_DB = 2.0
REFERENCE_V = .85
LABELS = ("开场", "片名", "第一章", "第二章", "第三章", "第四章", "第五章", "总结", "结尾", "片尾")
KEYS = ("D pedal", "F major", "D dorian", "F major", "C major / A minor", "Bb major", "F major", "F major", "Fsus2", "Fsus2")
ROOTS = (38, 41, 38, 41, 48, 46, 41, 41, 41, 41)
THEME = (65, 69, 72, 77)  # F4–A4–C5–F5
CUE_DURATIONS = {"block": .10, "snap": .18, "stamp": .22, "type": .60,
                 "gate": .18, "whoosh": .40, "error": .28, "success": .82, "tick": .025}


def amp(db):
    return 10.0 ** (db / 20.0)


def db_energy(energy, count):
    return 10 * math.log10(max(energy / max(count, 1), 1e-24))


def stats(x, scale=1.0):
    """分块测量；PCM 用 scale=1/32768，避免全片 float64 临时数组。"""
    energy, peak = 0.0, 0.0
    for a in range(0, len(x), 4 * SR):
        block = np.asarray(x[a:a + 4 * SR], dtype=np.float64) * scale
        if not np.isfinite(block).all():
            raise ValueError("音频含 NaN/Inf")
        energy += float(np.sum(block * block))
        if block.size:
            peak = max(peak, float(np.max(np.abs(block))))
    return dict(rms_dbfs=db_energy(energy, x.size), peak_dbfs=20 * math.log10(max(peak, 1e-12)))


def finite_number(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label} 须为有限数值")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} 须为有限数值")
    return number


def prepare(info):
    duration = finite_number(info["duration"], "duration")
    if duration < 0:
        raise ValueError("duration 不能为负")
    markers = []
    for chapter in info.get("chapters", []):
        t = finite_number(chapter["t"], "chapter.t")
        n = finite_number(chapter["n"], "chapter.n")
        if n != int(n) or not 0 <= n <= 9:
            raise ValueError("chapter.n 须为整数 0..9")
        if not 0 <= t <= duration:
            raise ValueError("chapter.t 须在 [0, duration] 内")
        if t < duration:
            markers.append((t, int(n)))
    markers.sort()
    if any(round(a[0] * SR) == round(b[0] * SR) for a, b in zip(markers, markers[1:])):
        raise ValueError("章节起点不能落在同一采样点")
    # 首章前未编号部分 / 无章节输入，保守使用稀疏开场。
    if not markers or markers[0][0] > 0:
        markers.insert(0, (0.0, 0))
    sections = [dict(start=t, end=markers[i + 1][0] if i + 1 < len(markers) else duration,
                     n=n, label=LABELS[n], key=KEYS[n]) for i, (t, n) in enumerate(markers) if t < duration]
    cues, unknown = [], set()
    for item in info.get("cues", []):
        kind = str(item.get("type", ""))
        if kind not in CUE_DURATIONS:
            unknown.add(kind)
            continue
        t = finite_number(item["t"], "cue.t")
        v = finite_number(item.get("v", 1), "cue.v")
        pan = finite_number(item.get("pan", 0), "cue.pan")
        if not 0 <= t <= duration or v < 0 or not -1 <= pan <= 1:
            raise ValueError("cue.t / v / pan 越界")
        if t < duration:
            cues.append(dict(t=t, type=kind, v=v, pan=pan))
    # 一个输入只打印一次未知类型警告，不因重复 cue 刷屏。
    if unknown:
        print("Warning: 忽略未知 cue 类型：" + ", ".join(repr(k) for k in sorted(unknown)), file=sys.stderr)
    cues.sort(key=lambda c: (c["t"], c["type"], c["v"], c["pan"]))
    return duration, sections, cues


@lru_cache(maxsize=128)
def mallet(note, duration=.65):
    return ak.marimba(ak.mtof(note), duration, bright=.65)


@lru_cache(maxsize=64)
def wood(frequency, duration=.09):
    return ak.woodblock(frequency, duration, bright=.45)


@lru_cache(maxsize=128)
def bell(note, duration=1.25):
    """钢片琴/钟琴：基音 + 少量非整数泛音，圆滑起音，抑制刺耳高频。"""
    t = ak.tvec(duration)
    f = ak.mtof(note)
    x = np.zeros_like(t)
    for ratio, gain, decay in ((1, 1, .55), (2, .20, .32), (2.76, .10, .19), (5.4, .025, .08)):
        if f * ratio < SR * .45:
            x += gain * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / decay)
    return ak.fade(ak.lp(x, 5800) * np.minimum(t / .003, 1) * .42, 0, min(.08, duration / 3))


def bass_oscillator(note, t):
    f = ak.mtof(note)
    # 带限锯齿的各谐波预乘二阶低通的幅频响应；连续相位适用于分块长音。
    saw = np.zeros_like(t)
    for h in range(1, 13):
        saw += -2 / np.pi * np.sin(2 * np.pi * f * h * t) / (h * math.sqrt(1 + (f * h / 300) ** 4))
    return .55 * (np.sin(2 * np.pi * f * t) + .23 * saw)


@lru_cache(maxsize=128)
def low_note(note, duration):
    t = ak.tvec(duration)
    return bass_oscillator(note, t) * ak.adsr(duration, .012, .045, .82, min(.09, duration / 3))


@lru_cache(maxsize=24)
def soft_pad(notes, duration, decaying=False):
    t = ak.tvec(duration)
    x = np.zeros_like(t)
    for i, note in enumerate(notes):
        f = ak.mtof(note)
        for detune in (-.035, .035):
            phase = 2 * np.pi * f * 2 ** (detune / 12) * t + i * .73
            x += np.sin(phase) + .12 * np.sin(2 * phase) + .035 * np.sin(3 * phase)
    x *= .32 / (2 * len(notes))
    x *= ak.adsr(duration, min(.5, duration / 4), .25, .8, min(.9, duration / 3))
    if decaying:
        x *= np.exp(-t / 1.5)
    return x


@dataclass(frozen=True)
class Event:
    kind: str
    t: float
    pitch: object
    duration: float
    gain: float
    pan: float = 0.0


def section_events(section):
    """只排事件，便于核对速度、音阶和声部；所有时间相对章节或小节。"""
    start, end, n = section["start"], section["end"], section["n"]
    length = end - start
    full_bars = math.floor(length / BAR + 1e-9)
    rhythm_end = min(end, start + full_bars * BAR) if full_bars else end
    events = []

    def put(kind, t, pitch, gain, duration=None, pan=0.0):
        if start <= t < end - .5 / SR:
            defaults = dict(mallet=.65, wood=.09, bass=BEAT * .82, bell=1.25, pad=2 * BAR, tailpad=2 * BAR)
            events.append(Event(kind, t, pitch, defaults[kind] if duration is None else duration, gain, pan))

    def chord(kind, t, notes, gain, duration=None):
        for i, note in enumerate(notes):
            put(kind, t, note, gain / math.sqrt(len(notes)), duration, (i - (len(notes) - 1) / 2) * .16)

    def theme(t, notes=THEME, gain=.24):
        # 第四音在下一小节第一拍；前三音为上行八分音符弱起。
        for i, note in enumerate(notes):
            put("mallet", t + (2.5 + .5 * i) * BEAT, note, gain * (1.18 if i == 3 else 1), pan=(i - 1.5) * .12)

    # 每章准确的画面卡点。片尾也有极轻过渡；不额外重复片尾和弦。
    accent = .45 if n == 1 else (.10 if n == 9 else .27)
    put("wood", start, 340, accent, .15)
    put("bass", start, ROOTS[n], accent * .8, BEAT * .85)

    if n == 0:
        for step in range(math.ceil((rhythm_end - start) / (BEAT / 2))):
            put("wood", start + step * BEAT / 2, 760, .15 if step % 2 == 0 else .10)
        for bar in range(0, max(1, full_bars), 2):
            for offset, note in ((1, 62), (2.5, 69)):
                put("mallet", start + bar * BAR + offset * BEAT, note, .10)
        # D 单音长音由 music_bus 分块合成，不随小节重击。
        return events
    if n == 1:
        chord("bell", start, (77, 81, 84), .25, 1.6)
        theme(start, gain=.30)
        # 标题主题只奏一遍，剩余时间保留极简木块/低音。
    if n == 9:
        chord("bell", start, (77, 79, 84), .18, min(3.5, length))
        return events

    # 结尾最后一记 Fsus2 放在可留至少两小节自然衰减的局部下拍。
    final_chord = start + max(0, math.floor((length - min(2 * BAR, length)) / BAR)) * BAR
    bar_count = max(1, full_bars)
    for bar in range(bar_count):
        t = start + bar * BAR
        if t >= rhythm_end:
            break
        if n == 8:
            if t >= final_chord:
                continue
            if bar % 2 == 0:
                for beat, note in ((0, 65), (1.5, 72), (3, 67)):
                    if t + beat * BEAT < final_chord:
                        put("mallet", t + beat * BEAT, note, .16)
                put("bass", t, 41, .19, 2 * BEAT)
            continue
        if n == 5:
            sequence = ((58, 62, 65, 70), (60, 63, 67, 72), (62, 65, 69, 74), (63, 67, 70, 75))
            notes = sequence[bar % 4]
            theme(t, notes, .26)
            root = notes[0] - 12
        else:
            root = ROOTS[n]
        if n == 7:
            if bar % 2 == 0:
                theme(t, gain=.24)
            put("pad", t, (53, 60, 65, 69), .22, 2 * BAR)
        for slot in range(16):
            at = t + slot * BEAT / 4
            if at >= rhythm_end:
                break
            progress = (at - start) / length
            if n == 1:
                if slot in (0, 8) and at > start:
                    put("wood", at, 720, .10)
                if slot == 0 and bar > 0:
                    put("bass", at, 41, .17, 1.5 * BEAT)
            elif n == 2:
                # 前半章八分音符；后半章按四组逐步填入十六分音符。
                rank = (0, 2, 1, 3)[(slot // 2) % 4]
                dense = progress > .5 + rank / 8
                if slot % 2 == 0 or dense:
                    notes = (62, 65, 69, 71, 72, 69, 67, 64)  # D dorian，含 B 自然音
                    put("mallet", at, notes[(slot // 2 + slot % 2) % 8], .19 if slot % 2 == 0 else .115,
                        .42, -.18 if slot % 4 < 2 else .18)
                if slot % 2 == 0:
                    put("bass", at, 38 if slot < 8 else 45, .23, BEAT * .40)
                    put("wood", at, 820, .12 if slot % 4 == 0 else .075)
            elif n == 3:
                if slot in (0, 4, 6, 8, 12):
                    put("mallet", at, (65, 69, 72, 77, 72)[(0, 4, 6, 8, 12).index(slot)], .21, pan=-.16)
                if slot % 4 == 2:
                    put("bell", at, (77, 81, 84, 81)[slot // 4], .115, pan=.24)
                if slot % 4 == 0:
                    put("bass", at, (41, 48, 45, 48)[slot // 4], .22)
                if slot % 2 == 0:
                    put("wood", at, 720, .075)
            elif n == 4:
                put("wood", at, 630 if slot % 4 == 0 else 900, .14 if slot % 4 == 0 else .075,
                    pan=-.12 if slot % 2 else .12)
                minor = (bar // 2) % 2
                if slot % 2 == 0:
                    notes = (57, 64, 60, 64) if minor else (60, 67, 64, 67)
                    put("mallet", at, notes[(slot // 2) % 4], .205, .44)
                if slot in (0, 8):
                    put("bass", at, 45 if minor else 48, .23, BEAT * 1.4)
            elif n == 5:
                if slot % 2 == 0:
                    put("wood", at, 920, .105 if slot % 4 == 0 else .07)
                if slot % 4 == 0:
                    put("bass", at, root if slot < 8 else root + 7, .23)
            elif n == 6:
                if slot % 4 == 0:
                    walk = (41, 45, 48, 50, 53, 52, 48, 43)
                    put("bass", at, walk[(bar * 4 + slot // 4) % 8], .24)
                if slot % 2 == 0:
                    put("wood", at, 1380, .115 if slot % 4 == 0 else .075, pan=.12)
                if slot in (0, 6, 8, 12):
                    put("mallet", at, (72, 77, 81, 79)[(0, 6, 8, 12).index(slot)], .20, pan=-.15)
                if bar % 2 == 0 and slot == 6:
                    put("bell", at, (84, 89, 88, 86)[(bar // 2) % 4], .15, pan=.25)
            elif n == 7:
                if slot in (0, 8):
                    put("bass", at, 41, .22, BEAT * 1.6)
                if slot % 4 == 0:
                    put("wood", at, 700, .085)
    if n == 8:
        chord("mallet", final_chord, (65, 67, 72), .24, min(2.5, end - final_chord))
        put("bass", final_chord, 41, .20, min(2 * BEAT, end - final_chord))
        put("tailpad", final_chord, (53, 60, 67), .20, min(2 * BAR, end - final_chord))
    return events


def add_in_section(buf, sig, t, section, gain=1.0, pan=0.0):
    begin, end = round(section["start"] * SR), round(section["end"] * SR)
    sample = round(t * SR)
    room = end - sample
    if sample < begin or room <= 0 or gain <= 0:
        return
    if room < len(sig):
        sig = ak.fade(sig[:room], fade_out=min(.025, room / SR))
    ak.add(buf[begin:end], sig, (sample - begin) / SR, gain, pan)


def add_drone(music, section):
    length = round((section["end"] - section["start"]) * SR)
    for a in range(0, length, 4 * SR):
        t = np.arange(a, min(length, a + 4 * SR)) / SR
        envelope = np.minimum(t / .035, 1) * np.clip((length / SR - t) / .1, 0, 1)
        add_in_section(music, bass_oscillator(38, t) * envelope, section["start"] + a / SR, section, .17)


def music_bus(duration, sections):
    music = np.zeros((round(duration * SR), 2), dtype=np.float32)
    counts = Counter()
    for section in sections:
        for ev in section_events(section):
            if ev.kind == "mallet":
                sig = mallet(ev.pitch, ev.duration)
            elif ev.kind == "wood":
                sig = wood(ev.pitch, ev.duration)
            elif ev.kind == "bass":
                sig = low_note(ev.pitch, ev.duration)
            elif ev.kind == "bell":
                sig = bell(ev.pitch, ev.duration)
            else:
                sig = soft_pad(ev.pitch, ev.duration, ev.kind == "tailpad")
            add_in_section(music, sig, ev.t, section, ev.gain, ev.pan)
            counts[ev.kind] += 1
        if section["n"] == 0:
            add_drone(music, section)
            start, end = round(section["start"] * SR), round(section["end"] * SR)
            # 最后 1 秒内渐弱，末一拍留空；短章按四分之一段长缩小留空。
            gap = min(round(BEAT * SR), (end - start) // 4)
            a, b = max(start, end - SR), end - gap
            if b > a:
                music[a:b] *= np.linspace(1, 0, b - a, dtype=np.float32)[:, None]
            music[b:end] = 0
    fi = min(len(music), round(.008 * SR))
    if fi:
        music[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)[:, None]
    level = stats(music)
    if level["rms_dbfs"] > -240:
        music *= amp(MUSIC_RMS_DB - level["rms_dbfs"])
    return music, counts


@lru_cache(maxsize=1)
def typing_times():
    rng = np.random.default_rng(SEED + 31)
    times = np.r_[0.0, np.cumsum(rng.uniform(.055, .09, 6))]
    return tuple(times * (.55 / times[-1]))  # 七下，最后一下在 .55 s


def cue_ranges(kind):
    if kind == "type":
        return tuple((t, t + .045) for t in typing_times())
    if kind == "error":
        return ((0, .10), (.16, .26))
    return ((0, CUE_DURATIONS[kind]),)


def overlay_mono(buf, sig, offset, gain=1.0):
    i = round(offset * SR)
    count = min(len(sig), len(buf) - i)
    if count > 0:
        buf[i:i + count] += sig[:count] * gain


@lru_cache(maxsize=9)
def cue_voice(kind):
    duration = CUE_DURATIONS[kind]
    t = ak.tvec(duration)
    x = np.zeros_like(t)
    if kind == "block":
        x = wood(920, duration).copy()
    elif kind == "snap":
        overlay_mono(x, wood(1750, .055), 0)
        overlay_mono(x, mallet(89, duration), 0, .075)
    elif kind == "stamp":
        phase = 2 * np.pi * (85 * t + 45 * .018 * (1 - np.exp(-t / .018)))
        x = .48 * np.sin(phase) * np.minimum(t / .002, 1) * np.exp(-t / .045)
        overlay_mono(x, wood(390, .13), 0, .85)
    elif kind == "type":
        rng = np.random.default_rng(SEED + 32)
        for offset in typing_times():
            overlay_mono(x, wood(float(rng.uniform(1200, 1900)), .045), offset, float(rng.uniform(.65, 1)))
    elif kind == "gate":
        for f, gain in ((190, .55), (431, .28), (713, .12), (1117, .045)):
            x += gain * np.sin(2 * np.pi * f * t) * np.exp(-t / .035)
        x *= np.minimum(t / .0015, 1)
        overlay_mono(x, wood(420, .07), .032, .35)
    elif kind == "whoosh":
        # 交叠的带通噪声窗平滑扫频；固定噪声，0.4 s，避免硬切滤波块。
        noise = np.random.default_rng(SEED + 41).standard_normal(len(t))
        for i, center in enumerate(np.geomspace(450, 3400, 9)):
            weight = np.maximum(0, 1 - np.abs(t / duration * 8 - i))
            x += ak.bp(noise, center * .67, center * 1.4) * weight
        x *= np.sin(np.pi * t / duration) ** 2
    elif kind == "error":
        overlay_mono(x, wood(350, .10), 0)
        overlay_mono(x, wood(300, .10), .16, .9)
    elif kind == "success":
        for i, note in enumerate((77, 81, 84)):
            overlay_mono(x, bell(note, .60), i * .11, .9 + .05 * i)
    elif kind == "tick":
        x = wood(2350, duration).copy()
    else:
        raise ValueError(kind)
    x = ak.fade(x, 0, min(.015, duration / 4))
    x[0] = x[-1] = 0
    ranges = [(round(a * SR), round(b * SR)) for a, b in cue_ranges(kind)]
    energy = sum(float(np.sum(x[a:b] ** 2)) for a, b in ranges)
    x *= amp(-20 - db_energy(energy, sum(b - a for a, b in ranges)))
    return x


def cue_spans(cues, frames, positive_only=False):
    spans = []
    for cue in cues:
        if positive_only and cue["v"] == 0:
            continue
        for a, b in cue_ranges(cue["type"]):
            left = max(0, round((cue["t"] + a) * SR))
            right = min(frames, round((cue["t"] + b) * SR))
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
    energy = 0.0
    for a, b in spans:
        for i in range(a, b, 4 * SR):
            block = np.asarray(x[i:min(b, i + 4 * SR)], dtype=np.float64)
            energy += float(np.sum(block * block))
    return db_energy(energy, sum((b - a) * 2 for a, b in spans))


def duck_in_place(music, cues):
    env = np.ones(len(music), dtype=np.float32)
    for cue in cues:
        if cue["v"] == 0:
            continue
        start, end = cue["t"], cue["t"] + CUE_DURATIONS[cue["type"]]
        a, b = max(0, round((start - .025) * SR)), min(len(music), round((end + .15) * SR))
        curve = np.interp(np.arange(a, b) / SR, [start - .025, start, end + .025, end + .15],
                          [1, amp(-DUCK_DB), amp(-DUCK_DB), 1])
        np.minimum(env[a:b], curve, out=env[a:b])
    music *= env[:, None]


def limit_sfx_in_place(sfx):
    """只压叠加后的高峰；声道联动，软膝上限 .5，不反向归一 cue.v。"""
    affected = 0
    knee, ceiling = .24, .50
    for a in range(0, len(sfx), 4 * SR):
        block = sfx[a:a + 4 * SR]
        peak = np.max(np.abs(block), axis=1)
        mask = peak > knee
        limited = knee + (ceiling - knee) * np.tanh((peak[mask] - knee) / (ceiling - knee))
        block[mask] *= (limited / peak[mask])[:, None]
        affected += int(np.count_nonzero(mask))
    return affected


def render(info):
    duration, sections, cues = prepare(info)
    music, counts = music_bus(duration, sections)
    sfx = np.zeros_like(music)
    all_spans = cue_spans(cues, len(music))
    active_spans = cue_spans(cues, len(music), positive_only=True)
    # 固定参考力度 .85；含 v=0 的窗口不因调低 v 而反向补偿。
    reference = max(MUSIC_RMS_DB - 6, window_rms(music, all_spans)) if all_spans else MUSIC_RMS_DB
    cue_target = reference - DUCK_DB + CUE_GAP_DB - 20 * math.log10(REFERENCE_V)
    for cue in cues:
        ak.add(sfx, cue_voice(cue["type"]), cue["t"], amp(cue_target + 20) * cue["v"], cue["pan"])
    limited = limit_sfx_in_place(sfx)
    duck_in_place(music, cues)
    # 与试点同样先结束所有尾音，再以整片 RMS 统一增益。
    fade_length = min(len(music), round(FINAL_FADE * SR))
    if fade_length:
        fade = np.linspace(1, 0, fade_length, dtype=np.float32)[:, None]
        music[-fade_length:] *= fade
        sfx[-fade_length:] *= fade
    mix = music + sfx
    level = stats(mix)
    gain = min(amp(TARGET_RMS_DB - level["rms_dbfs"]), amp(HEADROOM_DB - level["peak_dbfs"])) if level["peak_dbfs"] > -240 else 1.0
    music *= gain
    sfx *= gain
    mix *= gain
    music_active = window_rms(music, active_spans) if active_spans else None
    sfx_active = window_rms(sfx, active_spans) if active_spans else None
    report = dict(sample_rate=SR, channels=2, frames=len(mix), duration_seconds=len(mix) / SR,
                  bpm=BPM, time_signature="4/4", seed=SEED, target_rms_dbfs=TARGET_RMS_DB,
                  headroom_dbfs=HEADROOM_DB, final_fade_seconds=fade_length / SR,
                  music=stats(music), sfx=stats(sfx), master_gain_db=20 * math.log10(gain),
                  peak_limited=gain < amp(TARGET_RMS_DB - level["rms_dbfs"]) - 1e-10 if level["peak_dbfs"] > -240 else False,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  music_event_counts=dict(sorted(counts.items())), sfx_limited_frames=limited,
                  cue_window_seconds=sum(b - a for a, b in active_spans) / SR,
                  music_cue_window_rms_dbfs=music_active, sfx_cue_window_rms_dbfs=sfx_active,
                  sfx_minus_music_db=sfx_active - music_active if active_spans else None,
                  level_method="Whole-file RMS; peak priority. Stems: pre-PCM, post-duck/fade/master. Cue comparison: same sounding windows, type/error gaps excluded; nominal v=0.85.",
                  bar_alignment="Each chapter.t is a local downbeat; fixed 104 BPM, incomplete final bar reserved for tails/rest.",
                  sections=[])
    for section in sections:
        a, b = round(section["start"] * SR), round(section["end"] * SR)
        report["sections"].append(dict(section, music_rms_dbfs=stats(music[a:b])["rms_dbfs"],
                                       sfx_rms_dbfs=stats(sfx[a:b])["rms_dbfs"]))
    return mix, report


def write_pcm16(path, mix):
    """与 ak.write_wav 一样 ×32767 截断，分块写以控制长片内存。"""
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(SR)
        out.setnframes(len(mix))
        for a in range(0, len(mix), 4 * SR):
            block = np.asarray(mix[a:a + 4 * SR], dtype=np.float64)
            if not np.isfinite(block).all() or np.max(np.abs(block)) > amp(HEADROOM_DB) + 1e-7:
                raise ValueError("写 WAV 前音频须有限且峰值不超过 -1 dBFS")
            out.writeframesraw((block * 32767).astype("<i2").tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    info = ak.read_timeline(args.timeline)
    mix, report = render(info)
    write_pcm16(args.output, mix)
    del mix
    sr, pcm = wavfile.read(args.output, mmap=True)
    report["pcm"] = stats(pcm, 1 / 32768)
    report["last_frame"] = pcm[-1].tolist() if len(pcm) else []
    for section in report["sections"]:
        a, b = round(section["start"] * sr), round(section["end"] * sr)
        section["mix_rms_dbfs"] = stats(pcm[a:b], 1 / 32768)["rms_dbfs"]
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    report["sha256"] = digest.hexdigest()
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
