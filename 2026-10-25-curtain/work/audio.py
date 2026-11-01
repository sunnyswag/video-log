#!/usr/bin/env python3
"""窗帘固件：92 BPM / 4/4，C 小调 → E♭ 大调，离线合成 48 kHz PCM16。

用法：python3 -B audio.py timeline.json audio.wav
仅写指定 WAV；实测响度、静音窗口、转场、SHA-256 输出到 stdout。
所有随机声源使用固定整数种子；导入不渲染、不产生字节码缓存。

所有声部沿从 0 秒起算的全局网格排入乐器总线，音符不按章节裁切。
章节编制从最近小节线开始用一小节过渡；A 连续循环，B/C/D 从该
小节线起换和声。第六章保留 C 低音踏板，片名保留原时长的渐强。
剪刀留白只收干声，斜坡 30 ms；和声总线只混响一次，尾音跨章延续。
转场、片名落点和片尾和弦保持画面锚点。片尾干声 4 秒，内部预留
5 秒供释音与混响计算，最终按时间线时长、末尾 0.8 秒淡出后归一。
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
SNIP_FADE = .030
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


def bar_start(section):
    return math.floor(section["start"] / BAR + .5) * BAR


def chord_at(section, t, anchored=False):
    family = PATTERNS[section["n"]]["prog"]
    # 画面锚定的低音重音沿用原来的音高；编曲的进行从最近小节线起算。
    origin = 0 if family == "A" else math.floor(
        section["start"] / BAR + (1e-9 if anchored else .5))
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


def layer_level(section, layer):
    n = section["n"]
    p = PATTERNS[n]
    if layer == "wet":
        return .15 if n == 8 else .11
    if n == 9:
        return 0  # 片尾单次和弦另按画面锚点摆放。
    if layer == "piano":
        return p["piano"] if n != 8 else 0
    if layer == "piano_summary":
        return p["piano"] if n == 8 else 0
    if layer == "bass_open":
        return p["bass"] if n == 0 else 0
    if layer == "bass_pedal":
        return p["bass"] if n == 7 else 0
    if layer == "bass":
        return p["bass"] if 2 <= n <= 8 and n != 7 else 0
    return p[layer]


def layer_envelope(layer, frames, sections):
    """整条声部的增益；章节只提供控制点，不拥有音频缓冲。"""
    env = np.zeros(frames, dtype=np.float32)

    def level(section, a, b):
        gain = layer_level(section, layer)
        if section["n"] == 1 and layer in ("piano", "pad"):
            # 保留片名原来的 7.1 秒渐强，不用一小节替代。
            start = round(section["start"] * SR)
            span = round(section["end"] * SR) - start - 1
            return gain * (.30 + .70 * np.clip((np.arange(a, b) - start) / span, 0, 1))
        return gain

    for i, section in enumerate(sections):
        a = round(bar_start(section) * SR)
        b = round(bar_start(sections[i + 1]) * SR) if i + 1 < len(sections) else frames
        a, b = max(0, a), min(frames, b)
        if b <= a:
            continue
        env[a:b] = level(section, a, b)
        if i:
            end = min(b, round((bar_start(section) + BAR) * SR))
            w = np.linspace(0, 1, end - a, dtype=np.float32)
            w = w * w * (3 - 2 * w)
            env[a:end] = level(sections[i - 1], a, end) * (1 - w) + env[a:end] * w
    return env


def music_score(sections):
    """一次遍历全局十六分网格；节奏型分别成层，章界交叉改变增益。"""
    score = {layer: [] for layer in ("pad", "piano", "piano_summary", "pluck",
             "bass_open", "bass", "bass_pedal", "wood", "hat", "shaker")}
    wood = ak.woodblock(810, .10, bright=.40)
    index = 0
    for step in range(math.ceil(sections[-1]["start"] / STEP - 1e-9)):
        t, slot = step * STEP, step % 16
        if slot == 0:
            # 片尾是原设计的画面落点，常规 D 进行在此之前继续运行。
            while index + 1 < len(sections) - 1 and t >= bar_start(sections[index + 1]) - 1e-9:
                index += 1
            section = sections[index]
            p = PATTERNS[section["n"]]
            roots, notes = CHORDS[chord_at(section, t)]
            pad_notes = tuple(m - 12 for m in notes[:3])
            if section["n"] == 0:
                pad_notes = (roots[0] + 12,)
            elif section["n"] == 7:
                pad_notes = (36, 39, 43)
            score["pad"].append((t, warm_pad, (pad_notes, BAR + .45, p["cut"]), 1, 0))
            score["bass_open"].append((t, low_note, (roots[0], BAR), 1, 0))
        if slot % 2 == 0:
            pick = (0, 1, 2, 3, 2, 1, 0, 2)[slot // 2]
            score["piano"].append((t, piano, (notes[pick],),
                1 if slot % 4 == 0 else .76, (-.20, -.08, .12, .24)[pick]))
            score["hat"].append((t, ak.hat, (False, SEED + 10000 + step),
                                  1 if slot % 4 else .70, .20))
        if slot % 4 == 0:
            pick = slot // 4
            score["piano_summary"].append((t, piano, (notes[pick],),
                                           1, (-.20, -.08, .12, .24)[pick]))
            score["bass_pedal"].append((t, low_note, (36, .20), 1, 0))
            score["wood"].append((t, None, wood, 1 if slot == 0 else .78, -.16))
        if slot in (0, 8):
            score["bass"].append((t, low_note, (roots[slot // 8], BEAT * 1.45),
                                   1 if slot == 0 else .82, 0))
            score["pluck"].append((t, ornament, (notes[0 if slot == 0 else 2] + 12,),
                                    1 if slot == 0 else .85, .24))
        score["shaker"].append((t, ak.shaker, (.075, .72, SEED + 20000 + step),
                                 1 if slot % 2 else .62, -.24))
    return score


def music_bus(duration, sections, cues):
    frames = math.ceil((duration + TAIL) * SR)
    harmonic = np.zeros((frames, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)
    for layer, events in music_score(sections).items():
        bus = np.zeros_like(harmonic)
        gain = layer_envelope(layer, frames, sections)
        for t, voice, args, strength, pan in events:
            first = round(t * SR)
            if not gain[min(first + 1, frames - 1)]:
                continue
            sig = voice(*args) if voice is not None else args
            ak.add(bus, sig, t, strength, pan)
        bus *= gain[:, None]
        if layer in ("pad", "piano", "piano_summary", "pluck"):
            harmonic += bus
        else:
            rhythm += bus
        del bus, gain

    end = sections[-1]
    p = PATTERNS[9]
    pad = ak.pad_chord((51, 55, 58, 63), OUTRO_DRY, cut=p["cut"])
    pad *= np.exp(-ak.tvec(OUTRO_DRY) / 1.15)
    ak.add(harmonic, pad, end["start"], p["pad"])
    for note, pan in zip((63, 67, 70), (-.25, 0, .25)):
        ak.add(harmonic, piano(note, OUTRO_DRY), end["start"], p["piano"], pan)
    for bus in (harmonic, rhythm):
        fade = round(.20 * SR)
        bus[:fade] *= np.linspace(0, 1, fade)[:, None]
    windows = mute_snips(harmonic, rhythm, cues)
    # 只向全局混响发送和声；保留总结 .15、其余 .11 的空间层次。
    send = harmonic * layer_envelope("wet", frames, sections)[:, None]
    music = ak.reverb(send, dur=REVERB_DUR, decay=.48, wet=1,
                      rng=SEED + 30001, predelay=PREDELAY)
    music -= send
    music += harmonic
    music += rhythm
    for window in windows:
        a, b = round(window["mute_start"] * SR), round(window["mute_end"] * SR)
        window["tail_peak"] = float(np.max(np.abs(music[a:b])))
    return music, windows


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


def mute_snips(harmonic, rhythm, cues):
    """剪刀处半拍留白只收干声；全局混响的既有尾音继续衰减。"""
    windows = []
    for cue in cues:
        if cue["type"] != "snip":
            continue
        a = round(cue["t"] * SR)
        b = round((cue["t"] + BEAT / 2) * SR)
        fade = round(SNIP_FADE * SR)
        left, right = max(0, a - fade), min(len(harmonic), b + fade)
        for bus in (harmonic, rhythm):
            bus[left:a] *= np.linspace(1, 0, a - left, endpoint=False)[:, None]
            bus[a:b] = 0
            bus[b:right] *= np.linspace(0, 1, right - b)[:, None]
        windows.append(dict(fade_out_start=left / SR, mute_start=a / SR,
                            mute_end=b / SR, fade_in_end=right / SR,
                            dry_peak=max(float(np.max(np.abs(bus[a:b])))
                                         for bus in (harmonic, rhythm))))
    return windows


def render(info):
    duration, sections, cues = prepare(info)
    music, windows = music_bus(duration, sections, cues)
    sfx = np.zeros_like(music)
    ak.place_cues(sfx, cues, effects())
    transitions = []
    for section in sections:
        if not 2 <= section["n"] <= 8:
            continue
        t = section["start"]
        root = CHORDS[chord_at(section, t, anchored=True)][0][0]
        ak.add(sfx, ak.s_whoosh(.24, d=.50, rng=SEED + 200 + section["n"]), t)
        ak.add(sfx, low_note(root - 12, .48), t, .20)
        ak.add(sfx, ak.fade(ak.lp(ak.kick(), 170), .003, .03), t, .075)
        transitions.append(dict(n=section["n"], t=round(t * SR) / SR,
                                whoosh_seconds=.50, bass_midi=root - 12))
    title = sections[1]
    landing = title["start"] + 3.6
    if landing >= title["end"]:
        raise ValueError("片名幕不足 3.6 秒，无法放置落定重音")
    root = CHORDS[chord_at(title, landing, anchored=True)][0][0]
    ak.add(sfx, low_note(root - 12, .75), landing, .22)
    # times 确保极轻的 cue 也触发；key 则覆盖 type / whoosh 的整个发声期。
    triggers = [c["t"] for c in cues if c["v"] > 0]
    triggers += [tr["t"] for tr in transitions] + [landing]
    music = ak.duck(music, key=sfx, times=triggers, depth_db=DUCK_DB,
                    threshold=.008, attack=.020, hold=.060, release=.220)
    music += sfx
    del sfx
    # 先按成片时长及原有 0.8 秒收尾，再测量归一，预留尾音不计入响度。
    end, fo = round(duration * SR), round(.8 * SR)
    music[end - fo:end] *= np.linspace(1, 0, fo, dtype=music.dtype)[:, None]
    mix = ak.normalize(music[:end])
    report = dict(sample_rate=SR, channels=2, bpm=BPM, meter="4/4", seed=SEED,
                  timeline_seconds=duration, tail_reserve_seconds=TAIL,
                  target_rms_dbfs=ak.DEFAULT_RMS_DB, peak_ceiling=.89,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  title_landing=round(landing * SR) / SR, transitions=transitions,
                  snip_windows=windows, arrangement="global_grid_layer_automation",
                  reverb_passes=1, transition_seconds=BAR, snip_fade_seconds=SNIP_FADE,
                  title_crescendo_seconds=title["end"] - title["start"],
                  outro_chord_seconds=sections[-1]["start"], final_fade_seconds=.8,
                  sections=[dict(n=s["n"], start=s["start"],
                  end=s["end"], label=PATTERNS[s["n"]]["label"],
                  progression=PATTERNS[s["n"]]["prog"],
                  automation_start=round(bar_start(s) * SR) / SR,
                  grid_shift_seconds=round(bar_start(s) * SR) / SR - s["start"],
                  automation_end=round((bar_start(s) + BAR) * SR) / SR
                  if s["n"] else 0) for s in sections])
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
