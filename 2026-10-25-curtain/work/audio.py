#!/usr/bin/env python3
"""窗帘固件：92 BPM / 4/4，C 小调 → E♭ 大调，离线合成 48 kHz PCM16。

用法：python3 -B audio.py timeline.json audio.wav
仅写指定 WAV；实测响度、静音窗口、转场、SHA-256 输出到 stdout。
所有随机声源使用固定整数种子；导入不渲染、不产生字节码缓存。

节拍从 0 秒连续运行，不随章节重置。A 段连续循环；B/C/D 在章节
边界换和声，边界所在的不完整小节按章节裁切，其余每和弦一小节。
第六章采用 C 低音踏板。片尾干声 4 秒，额外留 5 秒容纳完整混响。
CI 仍会按视频时长裁音频，完整尾音保留在本地 WAV 中。
"""

import argparse
from collections import Counter
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/film-kit"))
import numpy as np
from scipy.io import wavfile
import audio_kit as ak

SR = ak.SR
BPM = 92
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
SEED = 20261025
TAIL = 5.0
OUTRO_DRY = 4.0
REVERB_DUR = 2.2
PREDELAY = .022
SNIP_FADE = .020
DUCK_DB = 3.5

# bass 的第一、第三拍；电钢声部均只用三和弦音。B♭/D 的低音是 D，
# 第三拍仍取 B♭ 和弦的五度 F，不误用 D 的五度 A。
CHORDS = {
    "Cm": ((36, 43), (60, 63, 67, 72)),
    "Ab": ((32, 39), (60, 63, 68, 72)),
    "Eb": ((39, 46), (58, 63, 67, 70)),
    "Bb": ((34, 41), (58, 62, 65, 70)),
    "Fm": ((41, 48), (60, 65, 68, 72)),
    "G": ((31, 38), (59, 62, 67, 71)),
    "Bb/D": ((38, 41), (58, 62, 65, 70)),
}
PROGRESSIONS = {
    "A": ("Cm", "Ab", "Eb", "Bb"),
    "B": ("Fm", "Cm", "Ab", "G"),
    "C": ("Ab", "Bb", "Cm", "Eb"),
    "D": ("Eb", "Bb/D", "Cm", "Ab"),
    "pedal": ("Cm",),
    "end": ("Eb",),
}
# 音量是乐器输出的线性乘数；打击始终轻于电钢/低音。
PATTERNS = {
    0: dict(label="开场", prog="A", piano=0, bass=.115, pad=.045, wood=0, hat=0, shaker=0, pluck=0, cut=480),
    1: dict(label="片名", prog="A", piano=.135, bass=0, pad=.075, wood=0, hat=0, shaker=0, pluck=0, cut=1200),
    2: dict(label="第一章", prog="A", piano=.165, bass=.145, pad=.028, wood=.070, hat=0, shaker=0, pluck=0, cut=1100),
    3: dict(label="第二章", prog="A", piano=.175, bass=.150, pad=.030, wood=.075, hat=.12, shaker=0, pluck=0, cut=1200),
    4: dict(label="第三章", prog="A", piano=.180, bass=.160, pad=.032, wood=.080, hat=.14, shaker=.11, pluck=0, cut=1300),
    5: dict(label="第四章", prog="B", piano=.180, bass=.160, pad=.032, wood=.080, hat=.14, shaker=0, pluck=0, cut=1300),
    6: dict(label="第五章", prog="C", piano=.180, bass=.155, pad=.040, wood=.075, hat=.14, shaker=0, pluck=.075, cut=1500),
    7: dict(label="第六章", prog="pedal", piano=0, bass=.105, pad=.045, wood=0, hat=0, shaker=0, pluck=0, cut=420),
    8: dict(label="总结", prog="D", piano=.185, bass=.140, pad=.065, wood=0, hat=0, shaker=0, pluck=0, cut=1900),
    9: dict(label="片尾", prog="end", piano=.140, bass=0, pad=.080, wood=0, hat=0, shaker=0, pluck=0, cut=1700),
}
CUE_DURATIONS = dict(draw=.25, tick=.04, blip=.09, latch=.08,
                     stamp=.45, whoosh=.50, type=.60, success=.60,
                     error=.35, snip=.135)


def prepare(info):
    """只按 chapters.n 编曲；拒绝未知 cue，避免静默漏音效。"""
    duration = float(info["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration 须为有限正数")
    sections = ak.timeline_sections(info)
    if [s.get("n") for s in sections] != list(range(10)):
        raise ValueError("本片须按时间顺序包含 n=0..9，开场从 0 秒开始")
    if any(s["end"] <= s["start"] for s in sections):
        raise ValueError("章节须有正时长")
    cues = []
    for cue in info["cues"]:
        kind = cue["type"]
        if kind not in CUE_DURATIONS:
            raise ValueError(f"未知 cue: {kind!r}")
        t, v = float(cue["t"]), float(cue.get("v", 1))
        if not (0 <= t < duration and 0 <= v <= 1):
            raise ValueError("cue.t / cue.v 越界或非有限值")
        cues.append(dict(t=t, type=kind, v=v))
    cues.sort(key=lambda c: (c["t"], c["type"], c["v"]))
    return duration, sections, cues


def chord_at(section, t):
    family = PATTERNS[section["n"]]["prog"]
    origin = 0 if family == "A" else math.floor(section["start"] / BAR + 1e-9)
    bar = math.floor(t / BAR + 1e-9) - origin
    prog = PROGRESSIONS[family]
    return prog[bar % len(prog)]


@lru_cache(maxsize=128)
def piano(note, dur=1.65):
    return ak.electric_piano(ak.mtof(note), dur=dur, bell=.22)


@lru_cache(maxsize=128)
def low_note(note, dur):
    return ak.fade(ak.bass(ak.mtof(note), dur), .012, min(.070, dur / 3))


@lru_cache(maxsize=32)
def ornament(note):
    return ak.fade(ak.pluck(ak.mtof(note), .85, bright=.55), 0, .05)


@lru_cache(maxsize=64)
def warm_pad(notes, dur, cut):
    return ak.pad_chord(notes, dur, cut=cut)


def section_audio(section):
    """先合成各章并混响，再淡收章界，避免第六章残留上一章琶音。"""
    n = section["n"]
    p = PATTERNS[n]
    start, end = section["start"], section["end"]
    first_sample = round(start * SR)
    length = round(end * SR) - first_sample
    tail_frames = math.ceil((OUTRO_DRY + REVERB_DUR + PREDELAY + .1) * SR) if n == 9 else 0
    frames = max(length, tail_frames)
    harmonic = np.zeros((frames, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)

    def place(buf, sig, t, gain, pan=0):
        # 先量化绝对时间，再转局部采样位置，避免章界舍入偏一帧。
        offset = (round(t * SR) - first_sample) / SR
        ak.add(buf, sig, offset, gain, pan)

    if n == 9:
        pad = ak.pad_chord((51, 55, 58, 63), OUTRO_DRY, cut=p["cut"])
        pad *= np.exp(-ak.tvec(OUTRO_DRY) / 1.15)
        place(harmonic, pad, start, p["pad"])
        for note, pan in zip((63, 67, 70), (-.25, 0, .25)):
            place(harmonic, piano(note, OUTRO_DRY), start, p["piano"], pan)
    else:
        first_bar = math.floor(start / BAR + 1e-9)
        last_bar = math.ceil(end / BAR - 1e-9)
        for bar in range(first_bar, last_bar):
            t = max(start, bar * BAR)
            stop = min(end, (bar + 1) * BAR)
            roots, notes = CHORDS[chord_at(section, t)]
            pad_notes = (roots[0] + 12,) if n == 0 else tuple(m - 12 for m in notes[:3])
            if n == 7:
                pad_notes = (36, 39, 43)
            dur = stop - t + .45
            pad = warm_pad(pad_notes, dur, p["cut"])
            place(harmonic, pad, t, p["pad"])
            if n == 0:
                place(rhythm, low_note(roots[0], stop - t), t, p["bass"])

        first = math.ceil(start / STEP - 1e-9)
        last = math.ceil(end / STEP - 1e-9)
        wood = ak.woodblock(810, .10, bright=.40)
        for step in range(first, last):
            t = step * STEP
            slot = step % 16
            roots, notes = CHORDS[chord_at(section, t)]
            if p["piano"] and slot % (4 if n == 8 else 2) == 0:
                pick = slot // 4 if n == 8 else (0, 1, 2, 3, 2, 1, 0, 2)[slot // 2]
                strength = 1 if slot % 4 == 0 else .76
                place(harmonic, piano(notes[pick]), t, p["piano"] * strength,
                      (-.20, -.08, .12, .24)[pick])
            if n == 7 and slot % 4 == 0:
                place(rhythm, low_note(36, .20), t, p["bass"])
            elif 2 <= n <= 8 and slot in (0, 8):
                place(rhythm, low_note(roots[slot // 8], BEAT * 1.45), t,
                      p["bass"] * (1 if slot == 0 else .82))
            if p["wood"] and slot % 4 == 0:
                place(rhythm, wood, t, p["wood"] * (1 if slot == 0 else .78), -.16)
            if p["hat"] and slot % 2 == 0:
                place(rhythm, ak.hat(rng=SEED + 10000 + step), t,
                      p["hat"] * (1 if slot % 4 else .70), .20)
            if p["shaker"]:
                place(rhythm, ak.shaker(.075, bright=.72, rng=SEED + 20000 + step),
                      t, p["shaker"] * (1 if slot % 2 else .62), -.24)
            if p["pluck"] and slot in (0, 8):
                place(harmonic, ornament(notes[0 if slot == 0 else 2] + 12),
                      t, p["pluck"] * (1 if slot == 0 else .85), .24)

    if n == 1:
        # 标题的垫底和琶音共同从较弱电平渐强，3.6 秒落点另入音效总线。
        harmonic *= np.linspace(.30, 1, frames, dtype=np.float32)[:, None]
    wet = ak.reverb(harmonic, dur=REVERB_DUR, decay=.48,
                    wet=.11 if n != 8 else .15, rng=SEED + 30001,
                    predelay=PREDELAY)
    wet += rhythm
    # 章界淡变包含干/湿声，第六章一开始即只剩自己的 pad + 低音。
    wet = ak.fade(wet, fade_in=.20 if n == 0 else .020,
                  fade_out=.040 if n != 9 else .050)
    return wet.astype(np.float32)


def music_bus(duration, sections):
    music = np.zeros((math.ceil((duration + TAIL) * SR), 2), dtype=np.float32)
    for section in sections:
        sig = section_audio(section)
        first = round(section["start"] * SR)
        if first + len(sig) > len(music):
            raise ValueError("片尾预留长度不足")
        music[first:first + len(sig)] += sig
    return music


@lru_cache(maxsize=10)
def cue_voice(kind):
    """每种音效固定种子；力度由 fx[type](v) 在线性域缩放。"""
    if kind == "tick":
        x = ak.s_tick(.22, rng=SEED + 101)
    elif kind == "blip":
        x = ak.s_blip(.32, f=1350)
    elif kind == "whoosh":
        x = ak.s_whoosh(.28, d=.50, rng=SEED + 102)
    elif kind == "success":
        x = ak.s_confirm(.42)
    elif kind == "error":
        x = ak.s_error(.26)
    elif kind == "latch":
        x = ak.woodblock(1550, .08, bright=.65) * .26
    elif kind == "draw":
        t = ak.tvec(.25)
        noise = np.random.default_rng(SEED + 103).standard_normal(len(t))
        x = ak.bp(noise, 1500, 5000) * np.minimum(1, t / .002) * np.exp(-t / .060) * .12
    elif kind == "stamp":
        x = ak.lp(ak.kick(), 180) * .19
        clap = ak.clap(rng=SEED + 104)
        x[:len(clap)] += clap * .055
    elif kind == "type":
        x = np.zeros(round(.60 * SR))
        rng = np.random.default_rng(SEED + 105)
        offsets = np.r_[0, np.cumsum(rng.uniform(.065, .105, 5))]
        for k, offset in enumerate(offsets):
            tick = ak.s_tick(.14 * rng.uniform(.75, 1), rng=SEED + 110 + k)
            i = round(offset * SR)
            x[i:i + len(tick)] += tick
    elif kind == "snip":
        x = np.zeros(round(.135 * SR))
        t = ak.tvec(.055)
        for k, offset in enumerate((0, .08)):
            noise = np.random.default_rng(SEED + 120 + k).standard_normal(len(t))
            hit = ak.lp(ak.hp(noise, 3500), 11000)
            hit *= np.minimum(1, t / .001) * np.exp(-t / .012) * (.14 if k == 0 else .12)
            hit = ak.fade(hit, 0, .01)
            i = round(offset * SR)
            x[i:i + len(hit)] += hit
    else:
        raise ValueError(kind)
    return ak.fade(x, fade_in=.0005, fade_out=.008)


def effects():
    return {kind: (lambda v, kind=kind: cue_voice(kind) * v) for kind in CUE_DURATIONS}


def mute_snips(music, cues):
    """混响和 duck 之后拉零音乐总线；不压掉剪刀音效，也不漏湿声。"""
    windows = []
    for cue in cues:
        if cue["type"] != "snip":
            continue
        a = round(cue["t"] * SR)
        b = round((cue["t"] + BEAT / 2) * SR)
        fade = round(SNIP_FADE * SR)
        left, right = max(0, a - fade), min(len(music), b + fade)
        music[left:a] *= np.linspace(1, 0, a - left, endpoint=False)[:, None]
        music[a:b] = 0
        music[b:right] *= np.linspace(0, 1, right - b)[:, None]
        windows.append(dict(fade_out_start=left / SR, mute_start=a / SR,
                            mute_end=b / SR, fade_in_end=right / SR,
                            music_peak=float(np.max(np.abs(music[a:b])))))
    return windows


def render(info):
    duration, sections, cues = prepare(info)
    music = music_bus(duration, sections)
    sfx = np.zeros_like(music)
    ak.place_cues(sfx, cues, effects())
    transitions = []
    for section in sections:
        if not 2 <= section["n"] <= 8:
            continue
        t = section["start"]
        root = CHORDS[chord_at(section, t)][0][0]
        ak.add(sfx, ak.s_whoosh(.24, d=.50, rng=SEED + 200 + section["n"]), t)
        ak.add(sfx, low_note(root - 12, .48), t, .20)
        ak.add(sfx, ak.fade(ak.lp(ak.kick(), 170), .003, .03), t, .075)
        transitions.append(dict(n=section["n"], t=round(t * SR) / SR,
                                whoosh_seconds=.50, bass_midi=root - 12))
    title = sections[1]
    landing = title["start"] + 3.6
    if landing >= title["end"]:
        raise ValueError("片名幕不足 3.6 秒，无法放置落定重音")
    root = CHORDS[chord_at(title, landing)][0][0]
    ak.add(sfx, low_note(root - 12, .75), landing, .22)
    # times 确保极轻的 cue 也触发；key 则覆盖 type / whoosh 的整个发声期。
    triggers = [c["t"] for c in cues if c["v"] > 0]
    triggers += [tr["t"] for tr in transitions] + [landing]
    music = ak.duck(music, key=sfx, times=triggers, depth_db=DUCK_DB,
                    threshold=.008, attack=.020, hold=.060, release=.220)
    windows = mute_snips(music, cues)
    music += sfx
    del sfx
    mix = ak.normalize(music)
    # 成片按画面时长裁切：最后 0.8 秒线性淡出到 0，避免片尾和弦的混响被硬切（CC 补）。
    end, fo = round(duration * SR), round(.8 * SR)
    mix[end - fo:end] *= np.linspace(1, 0, fo, dtype=mix.dtype)[:, None]
    mix[end:] = 0
    report = dict(sample_rate=SR, channels=2, bpm=BPM, meter="4/4", seed=SEED,
                  timeline_seconds=duration, tail_reserve_seconds=TAIL,
                  target_rms_dbfs=ak.DEFAULT_RMS_DB, peak_ceiling=.89,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  title_landing=round(landing * SR) / SR, transitions=transitions,
                  snip_windows=windows, sections=[dict(n=s["n"], start=s["start"],
                  end=s["end"], label=PATTERNS[s["n"]]["label"],
                  progression=PATTERNS[s["n"]]["prog"]) for s in sections])
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
    if args.timeline.resolve() == args.output.resolve():
        parser.error("输出 WAV 不能覆盖时间线")
    mix, report = render(ak.read_timeline(args.timeline))
    ak.write_wav(args.output, mix)
    del mix
    sr, pcm = wavfile.read(args.output, mmap=True)
    report.update(pcm=pcm_stats(pcm), frames=len(pcm), duration_seconds=len(pcm) / sr,
                  last_frame=pcm[-1].tolist(),
                  video_span_pcm=pcm_stats(pcm, end=round(report["timeline_seconds"] * sr)),
                  last_second_pcm=pcm_stats(pcm, start=max(0, len(pcm) - sr)))
    for section in report["sections"]:
        section["pcm"] = pcm_stats(pcm, round(section["start"] * sr), round(section["end"] * sr))
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    report["sha256"] = digest.hexdigest()
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
