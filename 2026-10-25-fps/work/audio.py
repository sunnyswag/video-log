#!/usr/bin/env python3
"""显示屏帧率评估：112 BPM / 4/4，实验室仪表 / 高速摄影。

用法：python3 -B audio.py timeline.json audio.wav
只写指定的 48 kHz 立体声 PCM16 WAV；stdout 报告实测电平、卡点、SHA-256。
导入无渲染副作用；所有噪声/混响固定种子，不产生字节码缓存。

所有音符直接进入全长乐器总线，节拍网格始终以 0 秒为原点。章节编曲起点
量化到最近小节线，各层增益用一小节过渡；音效卡点仍使用时间线原始秒数。
片名和弦沿用半小节网格，其余每小节换和弦；总结 C–F–G–C 后保持 C。
音符保留自然释音，音乐混响只在全长发送总线上计算一次，不在章界截断。
转场后的 1.9 秒不安排节奏音型，30 ms 干声包络保留 pad 和混响尾音。
片尾前仍用 .32 秒收干声并留 80 ms 空隙，单独 C6 钟干声 2 秒、原混响；
成品仅在时间线终点用 .10 秒淡收并裁切，WAV 等长，不再额外输出 5 秒。
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
from scipy.signal import butter, sosfilt
import audio_kit as ak

SR = ak.SR
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
SEED = 20261031
TRANSITION = 1.9
QUIET_RAMP = .030
PAD_RELEASE = .9
OUTRO_DRY = 2.0
OUTRO_IR = 4.5
PREDELAY = .025
DUCK_DB = 2.0

# MIDI：低音根音、pad 三和弦、拨弦的四音排列。
CHORDS = {
    "Am": (33, (57, 60, 64), (69, 72, 76, 81)),
    "F": (29, (53, 57, 60), (65, 69, 72, 77)),
    "C": (36, (55, 60, 64), (67, 72, 76, 79)),
    "G": (31, (55, 59, 62), (67, 71, 74, 79)),
    "E": (28, (52, 56, 59), (64, 68, 71, 76)),
}
PATTERNS = {
    0: dict(label="开场", prog=("Am", "F", "Am", "E"),
            pad=.060, pluck=.085, bass=.125, hat=0, kick=0, cut=1800),
    1: dict(label="片名", prog=("Am", "F", "C", "G"),
            pad=.068, pluck=.155, bass=0, hat=.105, kick=0, cut=1600),
    2: dict(label="第一章", prog=("Am", "F", "C", "G"),
            pad=.055, pluck=.145, bass=.105, hat=.140, kick=0, cut=1200),
    3: dict(label="第二章", prog=("Am", "Am", "F", "E"),
            pad=.055, pluck=.150, bass=.125, hat=.145, kick=.050, cut=1400),
    4: dict(label="第三章", prog=("C", "G", "Am", "F"),
            pad=.080, pluck=.155, bass=.115, hat=.135, kick=.045, cut=1100),
    5: dict(label="总结", prog=("C", "F", "G", "C"),
            pad=.070, pluck=.135, bass=.105, hat=.075, kick=.035, cut=1200),
    6: dict(label="片尾", prog=("C",)),
}
CUE_KINDS = ("draw", "tick", "blip", "latch", "whoosh", "success", "error", "shutter")


def prepare(info):
    duration = float(info["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration 须为有限正数")
    sections = ak.timeline_sections(info)
    if [s.get("n") for s in sections] != list(range(7)):
        raise ValueError("chapters 须从 0 秒开始，按时间顺序包含 n=0..6")
    if any(round(s["end"] * SR) <= round(s["start"] * SR) for s in sections):
        raise ValueError("章节须有正时长")
    cues = []
    for cue in info["cues"]:
        kind = cue["type"]
        if kind not in CUE_KINDS:
            raise ValueError(f"未知 cue: {kind!r}")
        t, v = float(cue["t"]), float(cue.get("v", 1))
        if not (0 <= t < duration and 0 <= v <= 1):
            raise ValueError("cue.t / cue.v 越界或非有限值")
        cues.append(dict(t=t, type=kind, v=v))
    cues.sort(key=lambda c: (c["t"], c["type"], c["v"]))

    def in_section(n, kind):
        s = sections[n]
        return [c for c in cues if c["type"] == kind and s["start"] <= c["t"] < s["end"]]

    opening_errors, chapter_errors = in_section(0, "error"), in_section(3, "error")
    scenes = sorted((s for s in info["scenes"] if s.get("chap") == 4),
                    key=lambda s: float(s["start"]))
    if not opening_errors or len(chapter_errors) < 2 or len(scenes) < 2:
        raise ValueError("缺少开场 error、第二章第二个 error 或第三章第二幕")
    scene_start = float(scenes[1]["start"])
    scene_end = min(sections[4]["end"], scene_start + float(scenes[1]["d"]))
    latches = [c for c in in_section(4, "latch") if scene_start <= c["t"] < scene_end]
    if not latches:
        raise ValueError("第三章第二幕须含公式 latch")
    return duration, sections, cues, dict(fall=opening_errors[0],
                                        tension=chapter_errors[1], stab=latches[0])


def chord_at(section, t):
    unit = BAR / 2 if section["n"] == 1 else BAR
    origin = round(section["start"] / BAR) * (2 if section["n"] == 1 else 1)
    index = max(0, math.floor(t / unit + 1e-9) - origin)
    prog = PATTERNS[section["n"]]["prog"]
    if section["n"] == 5:
        return prog[min(index, len(prog) - 1)]
    return prog[index % len(prog)]


def moving_lowpass(x, knots):
    """10 ms 控制步长，截止频率按对数插值；滤波器状态跨块保留。"""
    times, frequencies = np.asarray(knots, dtype=float).T
    y = np.empty_like(x)
    state = np.zeros((1, 2, x.shape[1]))
    block = SR // 100
    for a in range(0, len(x), block):
        b = min(len(x), a + block)
        fc = float(np.exp(np.interp((a + b) / (2 * SR), times, np.log(frequencies))))
        sos = butter(2, fc, fs=SR, output="sos")
        y[a:b], state = sosfilt(sos, x[a:b], axis=0, zi=state)
    return y


@lru_cache(maxsize=48)
def plucked(note):
    t = ak.tvec(.32)
    # FM 亮度低，主体接近正弦；额外衰减把尾音缩短成仪器提示音。
    x = ak.pluck(ak.mtof(note), .32, bright=.32) * np.exp(-t * 5.0)
    return ak.fade(ak.lp(x, 5000), .002, .025)


@lru_cache(maxsize=96)
def low_note(note, dur):
    t = ak.tvec(dur)
    f = ak.mtof(note)
    # bass 保持低频主体，少量带限方波增加质感，再低通以免刺耳。
    x = ak.bass(f, dur) + .12 * ak.sq(f, t, 9) * ak.adsr(dur, .010, .045, .65, .065)
    return ak.fade(ak.lp(x, 340), .006, min(.055, dur / 3))


def music_grid(sections):
    grid = [dict(s, start=round(s["start"] / BAR) * BAR) for s in sections[:-1]]
    for i, section in enumerate(grid):
        section["end"] = grid[i + 1]["start"] if i + 1 < len(grid) else sections[6]["start"]
    if any(s["end"] <= s["start"] for s in grid):
        raise ValueError("章节量化后须至少保留一个小节")
    return grid


def layer_gain(times, grid, values):
    """从最近小节线开始，用一小节平滑插值；不在章尾归零。"""
    gain = np.full(len(times), values[0], dtype=np.float32)
    for section, before, after in zip(grid[1:], values, values[1:]):
        u = np.clip((times - section["start"]) / BAR, 0, 1)
        gain += (after - before) * (u * u * (3 - 2 * u))
    return gain


def pad_notes(buf, spans, warm=False):
    """沿用 pad_chord 的音色和 .5/.9 秒包络，共同音持有，振荡相位从 0 秒连续。"""
    voices = {}
    for a, b, chord, cut in spans:
        notes = (CHORDS[chord][0] + 12,) if warm else CHORDS[chord][1]
        for note in notes:
            held = voices.setdefault((note, cut), [])
            if held and abs(held[-1][1] - a) < 1e-9:
                held[-1] = (held[-1][0], b)
            else:
                held.append((a, b))
    for (note, cut), held in voices.items():
        wave = ak.lp(ak.pad_voice(ak.mtof(note), held[-1][1] + PAD_RELEASE, cut), cut)
        for a, b in held:
            sig = wave[round(a * SR):round((b + PAD_RELEASE) * SR)].copy()
            attack, release = min(round(.5 * SR), len(sig)), min(round(PAD_RELEASE * SR), len(sig))
            sig[:attack] *= np.linspace(0, 1, attack) ** 1.5
            sig[-release:] *= np.linspace(1, 0, release) ** 1.5
            ak.add(buf, sig, a, 1 if warm else 1 / 3)


def music_bus(sections, tension, frames):
    grid = music_grid(sections)
    times = np.arange(frames) / SR
    outro = sections[6]["start"]
    title = sections[1]["start"]
    layers = {name: np.zeros((frames, 2), dtype=np.float32)
              for name in ("pad", "warm", "opening_pluck", "pluck",
                           "opening_bass", "bass", "hat", "kick")}

    # 和弦只在全局小节线变化，片名沿用原半小节例外；同音色同和弦连续持有。
    spans = []
    for half in range(math.ceil(outro / (BAR / 2))):
        a, b = half * BAR / 2, min(outro, (half + 1) * BAR / 2)
        section = ak.section_at(a, grid)
        chord, cut = chord_at(section, a), PATTERNS[section["n"]]["cut"]
        if spans and spans[-1][2:] == (chord, cut):
            spans[-1] = (spans[-1][0], b, chord, cut)
        else:
            spans.append((a, b, chord, cut))
    pad_notes(layers["pad"], spans)
    pad_notes(layers["warm"], spans, warm=True)

    quiet = [(s["start"], s["start"] + TRANSITION) for s in sections[2:6]]
    for step in range(math.ceil((outro - .40) / STEP - 1e-9)):
        t, slot = step * STEP, step % 16
        if any(a <= t < b - 1e-9 for a, b in quiet):
            continue
        n = ak.section_at(t, grid)["n"]
        root, _, notes = CHORDS[chord_at(grid[n], t)]
        if slot in (0, 4):
            ak.add(layers["opening_bass"], low_note(root, .30 if slot == 0 else .23),
                   t, 1 if slot == 0 else .65)
        if slot == 10 and (step // 16) % 2 == 0:
            ak.add(layers["opening_pluck"], plucked(notes[1]), t, 1, .15)
        if slot % 2 == 0:
            pick = (0, 1, 2, 3, 2, 1, 0, 2)[slot // 2]
            ak.add(layers["pluck"], plucked(notes[pick]), t,
                   1 if slot % 4 == 0 else .73, (-.18, -.06, .08, .18)[pick])
            offsets = (0, 12, 0, 7, 0, 12, 7, 0) if n == 3 else (0, 0, 7, 0, 0, 7, 0, 0)
            ak.add(layers["bass"], low_note(root + offsets[slot // 2], BEAT * .42),
                   t, 1 if slot % 4 == 0 else .64)
        # 片名后半加入踩镲，保留原始时间锚点，首音仍落在全局十六分网格。
        if t >= (title + sections[1]["end"]) / 2:
            strength = (1.0, .48, .70, .48)[slot % 4]
            ak.add(layers["hat"], ak.fade(ak.hat(rng=SEED + 10000 + step), .0005, .008),
                   t, strength, .16)
        if slot in (0, 8):
            ak.add(layers["kick"], ak.fade(ak.lp(ak.kick(), 900), .002, .030),
                   t, 1 if slot == 0 else .85)

    rhythm_gate = np.ones(frames, dtype=np.float32)
    for a, b in quiet:
        rhythm_gate *= np.interp(times, [a - QUIET_RAMP, a, b, b + QUIET_RAMP], [1, 0, 0, 1])
    # 开场 .20 秒起音、总结最后两小节 +1.4 dB、钟前 .32 秒收干声/80 ms 留白。
    dry_gain = np.minimum(1, times / .20)
    dry_gain *= 10 ** (1.4 * np.clip((times - (outro - 2 * BAR)) / (2 * BAR), 0, 1) / 20)
    dry_gain *= np.interp(times, [outro - .40, outro - .08], [1, 0])
    active = sections[3]["start"] + TRANSITION
    push = .85 + .28 * np.clip((times - active) / (sections[3]["end"] - active), 0, 1)
    push = 1 + (push - 1) * layer_gain(times, grid, [0, 0, 0, 1, 0, 0])

    harmonic = np.zeros((frames, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)
    for name in tuple(layers):
        layer = layers.pop(name)
        if name == "warm":
            values = [PATTERNS[n]["pad"] * .25 if n == 4 else 0 for n in range(6)]
        elif name == "pad":
            values = [PATTERNS[n]["pad"] * (.75 if n == 4 else 1) for n in range(6)]
        elif name.startswith("opening_"):
            values = [PATTERNS[0][name.removeprefix("opening_")]] + [0] * 5
        else:
            values = [0] + [PATTERNS[n][name] for n in range(1, 6)]
        layer *= (layer_gain(times, grid, values) * dry_gain)[:, None]
        if name in ("pad", "warm"):
            if name == "pad":
                filtered = moving_lowpass(layer, [(0, 480), (max(0, title - 3), 480), (title, 2200)])
                layer += (filtered - layer) * layer_gain(times, grid, [1, 0, 0, 0, 0, 0])[:, None]
            harmonic += layer
        else:
            layer *= rhythm_gate[:, None]
            if name in ("bass", "kick"):
                layer *= push[:, None]
            if "pluck" in name:
                harmonic += layer
            else:
                rhythm += layer
    del layer, filtered

    # 发送量保留第三章 .15 / 其他 .10 的空间差异；同一个 IR 连续接收全片干声。
    send = harmonic * layer_gain(times, grid, [.10, .10, .10, .10, .15, .10])[:, None]
    harmonic += (ak.reverb(send, dur=1.6, decay=.38, wet=1,
                           rng=SEED + 20000, predelay=.018) - send).astype(np.float32)
    del send
    center = tension["t"]
    # error 前后各 1.5 秒收紧/放开干湿和声，最低 320 Hz，原卡点不量化。
    filtered = moving_lowpass(harmonic, [(center - 1.5, 5000),
                                       (center, 320), (center + 1.5, 5000)])
    harmonic += (filtered - harmonic) * layer_gain(times, grid, [0, 0, 0, 1, 0, 0])[:, None]
    harmonic += rhythm
    return harmonic


def add_mono(buf, sig, offset=0, gain=1):
    i = round(offset * SR)
    count = min(len(sig), len(buf) - i)
    if count > 0:
        buf[i:i + count] += sig[:count] * gain


@lru_cache(maxsize=8)
def cue_voice(kind):
    if kind == "tick":
        x = ak.s_tick(.20, rng=SEED + 301)
    elif kind == "whoosh":
        x = ak.s_whoosh(.24, d=.55, rng=SEED + 302)
    elif kind == "blip":
        t = ak.tvec(.09)
        x = np.sin(2 * np.pi * 1400 * t) * np.exp(-t * 48) * .075
    elif kind == "draw":
        t = ak.tvec(.30)
        noise = np.random.default_rng(SEED + 303).standard_normal(len(t))
        grains = .40 + .60 * np.sin(2 * np.pi * 43 * t) ** 2
        x = ak.bp(noise, 1800, 6200) * grains * np.sin(np.pi * t / .30) ** 1.2 * .045
    elif kind in ("latch", "shutter"):
        x = np.zeros(round((.11 if kind == "shutter" else .10) * SR))
        spacing = .048 if kind == "shutter" else .028
        for k in range(2):
            t = ak.tvec(.040)
            noise = np.random.default_rng(SEED + 310 + 2 * (kind == "shutter") + k).standard_normal(len(t))
            noise = ak.bp(noise, 2400 if kind == "shutter" else 1200, 10500 if kind == "shutter" else 6500)
            transient = noise * np.exp(-t / (.0025 if kind == "shutter" else .004))
            body = np.sin(2 * np.pi * (1900 if kind == "shutter" else 980) * t) * np.exp(-t / .006)
            hit = ak.fade(transient * .10 + body * .065, .0005, .006)
            add_mono(x, hit, k * spacing, 1 if k == 0 else .75)
    elif kind == "error":
        x = np.zeros(round(.43 * SR))
        for k, note in enumerate((50, 45)):
            t = ak.tvec(.24)
            f = ak.mtof(note)
            tone = np.sin(2 * np.pi * f * t) + .20 * ak.sq(f, t, 9)
            tone = ak.lp(tone, 1000) * ak.adsr(.24, .006, .040, .55, .070)
            add_mono(x, tone, .17 * k, .090)
    elif kind == "success":
        x = np.zeros(round(.65 * SR))
        for k, note in enumerate((84, 91)):
            t = ak.tvec(.48)
            f = ak.mtof(note)
            tone = (np.sin(2 * np.pi * f * t) + .12 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 10)
            add_mono(x, ak.fade(tone, .003, .040), .13 * k, .075)
    else:
        raise ValueError(kind)
    return ak.fade(x, .0005, .008)


def bass_fall():
    t = ak.tvec(.60)
    f = ak.mtof(33) * 2 ** (-t / .60)
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(phase) + .12 * np.sin(3 * phase)) * np.exp(-t * 2.2)
    return ak.fade(ak.lp(x, 220), .008, .09)


def riser(dur):
    t = ak.tvec(dur)
    progress = t / dur
    noise = np.random.default_rng(SEED + 400).standard_normal((len(t), 2))
    noise = moving_lowpass(ak.hp(noise, 250), [(0, 550), (dur, 6500)])
    phase = 2 * np.pi * np.cumsum(220 * 4 ** progress) / SR
    x = (noise * .50 + np.sin(phase)[:, None] * .12) * progress[:, None] ** 1.7
    return ak.fade(x, .10, .018)


def ending_bell():
    frames = round((OUTRO_DRY + OUTRO_IR + PREDELAY + .10) * SR)
    bell = np.zeros((frames, 2), dtype=np.float32)
    t = ak.tvec(OUTRO_DRY)
    f = ak.mtof(84)  # 单独 C6 钟音，所有泛音来自这一次敲击。
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t * 1.7)
    for ratio, gain, decay in ((2.76, .22, 3.3), (4.07, .08, 5.0)):
        tone += gain * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * decay)
    ak.add(bell, ak.fade(tone, .004, .12), 0, .125)
    return ak.fade(ak.reverb(bell, dur=OUTRO_IR, decay=1.15, wet=.42,
                             rng=SEED + 401, predelay=PREDELAY), 0, .10)


def render(info):
    duration, sections, cues, markers = prepare(info)
    frames = round(duration * SR)
    music = music_bus(sections, markers["tension"], frames)
    sfx = np.zeros_like(music)
    voices = {kind: (lambda v, kind=kind: cue_voice(kind) * v) for kind in CUE_KINDS}
    ak.place_cues(sfx, cues, voices)
    triggers = [c["t"] for c in cues if c["v"] > 0]

    title = sections[1]["start"]
    riser_duration = min(3.0, sections[0]["end"] - sections[0]["start"])
    ak.add(music, riser(riser_duration), title - riser_duration, .055)
    boom_t = ak.tvec(.85)
    boom_f = 44 + 28 * np.exp(-boom_t * 15)
    boom = np.sin(2 * np.pi * np.cumsum(boom_f) / SR) * np.exp(-boom_t * 5)
    ak.add(sfx, ak.fade(boom, .008, .08), title, .13)
    for k in range(3):
        t = title + k * .13
        ak.add(sfx, cue_voice("shutter"), t, .45, (-.12, 0, .12)[k])
        triggers.append(t)
    fall = markers["fall"]
    ak.add(sfx, bass_fall(), fall["t"], .115 * fall["v"])

    # 边界只增加轻下拍，whoosh 完全由原有 cues 提供，不重复叠加。
    for section in sections[2:6]:
        t = section["start"]
        root = CHORDS[chord_at(section, t)][0]
        ak.add(sfx, low_note(root, .40), t, .10)
        triggers.append(t)
    stab = np.zeros((round(4.0 * SR), 2), dtype=np.float32)
    for note, pan in zip((72, 76, 79), (-.20, 0, .20)):
        ak.add(stab, ak.electric_piano(ak.mtof(note), 1.25, bell=.55), 0, .11, pan)
    stab = ak.reverb(stab, dur=2.5, decay=.65, wet=.23, rng=SEED + 402)
    ak.add(sfx, stab, markers["stab"]["t"], markers["stab"]["v"])

    music = ak.duck(music, key=sfx, times=triggers, depth_db=DUCK_DB,
                    threshold=.012, attack=.012, hold=.040, release=.160)
    music += sfx
    del sfx
    bell = ending_bell()
    # 钟声合成/混响不变，唯一的最终裁切是时间线终点。
    ak.add(music, bell, sections[6]["start"])
    # 沿用片尾 .10 秒收尾，在成片终点归零，避免裁切未结束的钟声混响。
    mix = ak.normalize(ak.fade(music, 0, .10))
    report = dict(duration=duration, sections=sections, cues=cues, markers=markers,
                  grid=music_grid(sections))
    return mix, report


def pcm_stats(pcm, start=0, end=None):
    end = len(pcm) if end is None else min(len(pcm), end)
    energy, peak = 0.0, 0.0
    for a in range(start, end, SR * 4):
        block = pcm[a:min(end, a + SR * 4)].astype(np.float64) / 32768
        energy += float(np.sum(block * block))
        peak = max(peak, float(np.max(np.abs(block))))
    count = max(1, (end - start) * pcm.shape[1])
    return dict(rms=10 * math.log10(max(energy / count, 1e-24)),
                peak=peak, peak_db=20 * math.log10(max(peak, 1e-12)))


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
    full = pcm_stats(pcm)
    video = pcm_stats(pcm, end=round(report["duration"] * sr))
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    counts = Counter(c["type"] for c in report["cues"])
    print(f"format=PCM16 sample_rate={sr} channels=2 bpm={BPM} meter=4/4 seed={SEED}")
    print(f"timeline_seconds={report['duration']:.3f} wav_seconds={len(pcm) / sr:.3f} tail_seconds=0.000")
    print(f"target_rms_dbfs={ak.DEFAULT_RMS_DB:.4f} rms_dbfs={full['rms']:.4f} rms_error_db={full['rms'] - ak.DEFAULT_RMS_DB:+.4f}")
    print(f"video_rms_dbfs={video['rms']:.4f} peak_dbfs={full['peak_db']:.4f} peak_linear={full['peak']:.6f}")
    print(f"frames={len(pcm)} last_frame={pcm[-1].tolist()} duck_db={DUCK_DB:.1f}")
    print("cues=" + str(sum(counts.values())) + " " + " ".join(f"{k}:{counts[k]}" for k in CUE_KINDS))
    print("markers=" + " ".join(f"{k}:{v['t']:.3f}" for k, v in report["markers"].items()))
    print("quiet_transitions=" + " ".join(f"{s['start']:.3f}..{s['start'] + TRANSITION:.3f}" for s in report["sections"][2:6]))
    print(f"automation_seconds={BAR:.6f} quiet_ramp_seconds={QUIET_RAMP:.3f} music_reverb_passes=1")
    for original, aligned in zip(report["sections"], report["grid"]):
        print(f"grid_section={original['n']} original={original['start']:.6f} "
              f"bar_start={aligned['start']:.6f} shift={aligned['start'] - original['start']:+.6f}")
    print(f"ending_bell={report['sections'][6]['start']:.3f} dry_seconds={OUTRO_DRY:.3f} "
          f"ir_seconds={OUTRO_IR:.3f} crop_at={report['duration']:.3f}")
    for section in report["sections"]:
        stats = pcm_stats(pcm, round(section["start"] * sr), round(section["end"] * sr))
        print(f"section={section['n']} {PATTERNS[section['n']]['label']} "
              f"{section['start']:.3f}..{section['end']:.3f} rms_dbfs={stats['rms']:.4f}")
    print(f"sha256={digest.hexdigest()}")
    passed = (abs(full["rms"] + 24.4) <= .1 and full["peak_db"] <= -1.0
              and sr == 48000 and pcm.dtype == np.int16 and pcm.shape == (round(report["duration"] * sr), 2))
    print("level_check=" + ("PASS" if passed else "FAIL"))
    if not passed:
        raise RuntimeError("实测 PCM16 响度或峰值未通过验收")


if __name__ == "__main__":
    main()
