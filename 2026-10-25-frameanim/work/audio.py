#!/usr/bin/env python3
"""帧动画：温暖胶片 / 轻电子，92 BPM、4/4、48 kHz PCM16 立体声。

用法：python3 audio.py /absolute/timeline.json /absolute/out.wav
仅写指定 WAV；长度为时间线 + 1.5 秒，最终使用 audio_kit.normalize 默认目标。
随机声源均用固定整数种子，导入不合成、不写缓存。

按 timeline_sections(info, 'scenes') 的 id 分段；同一编配跨幕延续和弦。
节拍从 0 秒连续运行，段界立刻换调：不足一小节的起段先保持首和弦，
从下一完整小节开始每小节一个和弦。片名/片尾的一次性音符对齐场景起点。
齿轮 16 分音符只在 s08–s11、s15–s17；s12–s14 保持无 hat。
"""

import argparse
from functools import lru_cache, partial
import math
from pathlib import Path
import sys
import time

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/film-kit"))
import numpy as np
import audio_kit as ak

SR = ak.SR
BPM = 92
BEAT = 60 / BPM
BAR = BEAT * 4
STEP = BEAT / 4
TAIL = 1.5
SEED = 20261025

# 根音为低音区 MIDI；和弦采用紧凑的中音区排列，主奏再升两个八度。
CHORDS = {
    "C": (36, (60, 64, 67)), "Am": (33, (57, 60, 64)),
    "F": (41, (57, 60, 65)), "G": (43, (59, 62, 67)),
    "Dm": (38, (57, 62, 65)), "E": (40, (56, 59, 64)),
    "Bb": (34, (58, 62, 65)), "A": (33, (57, 61, 64)),
}
PROGRESSIONS = {
    "opening": ("Am", "Am", "F", "G"),
    "title": ("C",), "playful": ("C", "Am", "F", "G"),
    "dark": ("Am", "F", "Dm", "E"),
    "clock": ("F", "C", "Dm", "Bb"),
    "tense": ("Dm", "Bb", "C", "A"),
    "warm": ("C", "G", "Am", "F"),
    "closing": ("F", "C", "G", "C"), "outro": ("C",),
}
SCENE_PLAN = dict(zip(
    (f"s{i:02d}" for i in range(1, 20)),
    ("opening", "title", *(["playful"] * 2), *(["dark"] * 3),
     *(["clock"] * 4), *(["tense"] * 3), *(["warm"] * 3), "closing", "outro"),
))
MOTIF = ((84, None, 88, 91, 93, 91, 88, None),
         (86, 88, None, 91, 88, 86, 84, None))
STAIRS = (45, 47, 48, 50, 52, 53, 55)  # A2 → B2 → C3 → D3 → E3 → F3 → G3 循环。
CUE_TYPES = tuple("click stamp tick draw pop whoosh reel leader flip success blip error snip latch type send".split())


def prepare(info):
    duration = float(info["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration 须为有限正数")
    scenes = ak.timeline_sections(info, "scenes")
    groups = []
    for scene in scenes:
        sid = scene.get("id")
        if sid not in SCENE_PLAN or scene["end"] <= scene["start"]:
            raise ValueError(f"无法编配场景：{sid!r}，须为 s01–s19 且时长为正")
        family = SCENE_PLAN[sid]
        if groups and groups[-1]["family"] == family:
            groups[-1]["end"] = scene["end"]
        else:
            groups.append(dict(family=family, start=scene["start"], end=scene["end"]))
    cues = info.get("cues", [])
    for cue in cues:
        t = float(cue["t"])
        v, gain, pan = (float(cue.get(k, default)) for k, default in
                        (("v", 1), ("gain", 1), ("pan", 0)))
        if not (0 <= t < duration and math.isfinite(v) and v >= 0
                and math.isfinite(gain) and gain >= 0 and -1 <= pan <= 1):
            raise ValueError(f"cue 时间/音量/声像非法：{cue}")
    return duration, scenes, groups, cues


def bar_index(group, t):
    origin = math.ceil(group["start"] / BAR - 1e-9)
    return max(0, math.floor(t / BAR + 1e-9) - origin)


def chord_at(group, t):
    prog = PROGRESSIONS[group["family"]]
    return CHORDS[prog[bar_index(group, t) % len(prog)]]


@lru_cache(maxsize=64)
def celesta(note):
    t = ak.tvec(.68)
    return (ak.fm_piano(ak.mtof(note), .68, velocity=.58)
            * np.exp(-t * 3.2)).astype(np.float32)


@lru_cache(maxsize=64)
def plucked(note, staccato=False):
    dur = .19 if staccato else .52
    x = ak.pluck(ak.mtof(note), dur, bright=.80 if staccato else .55)
    return ak.fade(x, .003, .035).astype(np.float32)


@lru_cache(maxsize=64)
def felt_chord(notes, dur=2.1):
    x = sum(ak.electric_piano(ak.mtof(n), dur, bell=.12) for n in notes) / len(notes)
    return ak.lp(x, 2300).astype(np.float32)


@lru_cache(maxsize=64)
def low_note(note, dur):
    # 正弦为主，低通进一步柔化二/三次谐波；闷音使用较短总时长。
    return ak.fade(ak.lp(ak.bass(ak.mtof(note), dur), 260), .012,
                   min(.07, dur / 3)).astype(np.float32)


@lru_cache(maxsize=32)
def warm_pad(notes, dur, cut=1200):
    return ak.pad_chord(notes, dur, cut=cut).astype(np.float32)


def group_audio(group):
    family, start, end = group["family"], group["start"], group["end"]
    first_sample = round(start * SR)
    length = round(end * SR) - first_sample
    frames = length + (round(TAIL * SR) if family == "outro" else 0)
    harmonic = np.zeros((frames, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)

    def place(buf, sig, t, gain, pan=0):
        ak.add(buf, sig, (round(t * SR) - first_sample) / SR, gain, pan)

    if family in ("title", "outro"):
        pad = warm_pad((48, 55, 60, 64), end - start, 1400).copy()
        if family == "title":
            pad *= np.linspace(.12, 1, len(pad), dtype=np.float32)
            for k, note in enumerate((84, 88, 91, 96)):
                place(harmonic, celesta(note), start + k * BEAT / 2, .22, -.15 + k * .10)
        else:
            pad *= np.linspace(1, 0, len(pad), dtype=np.float32) ** 1.2
            place(harmonic, celesta(84), start, .22)
        place(harmonic, pad, start, .065 if family == "title" else .07)
    else:
        if family == "dark":
            # A1 + E2 持续低音，与逐小节变化的和弦分开，跨 s05–s07 不重触发。
            place(harmonic, warm_pad((33, 40), end - start, 430), start, .045)
        for bar in range(math.floor(start / BAR), math.ceil(end / BAR)):
            t, stop = max(start, bar * BAR), min(end, (bar + 1) * BAR)
            if stop - t < 1 / SR:
                continue
            root, notes = chord_at(group, t)
            dur = stop - t
            pad_gain = dict(opening=.025, playful=.018, dark=.016, clock=.020,
                            tense=.021, warm=.060, closing=.055)[family]
            place(harmonic, warm_pad(tuple(n - 12 for n in notes), dur + .35,
                                     650 if family in ("opening", "dark") else 1400),
                  t, pad_gain, -.12)
            if family in ("playful", "warm", "closing"):
                place(harmonic, felt_chord(notes), t,
                      .065 if family == "playful" else .12, .12)
            if family == "opening":
                place(rhythm, low_note(STAIRS[bar_index(group, t) % len(STAIRS)], dur), t, .11)
                place(harmonic, celesta(notes[0] + 24), t, .085, -.1)
            elif family in ("playful", "clock", "warm", "closing"):
                place(rhythm, low_note(root, dur), t,
                      .115 if family == "warm" else .09)

        kick = ak.fade(ak.lp(ak.kick(), 320), .003, .04)
        for step in range(math.ceil(start / STEP - 1e-9), math.ceil(end / STEP - 1e-9)):
            t, slot = step * STEP, step % 16
            root, notes = chord_at(group, t)
            eighth = slot // 2
            if family in ("playful", "closing") and slot % 2 == 0:
                note = MOTIF[bar_index(group, t) % len(MOTIF)][eighth]
                if note is not None:
                    place(harmonic, celesta(note), t, .17 if family == "playful" else .18, .16)
            if family in ("playful", "clock") and slot % 2 == 0:
                note = notes[(0, 1, 2, 1, 0, 2, 1, 2)[eighth]] + 12
                place(harmonic, plucked(note), t, .075 if family == "playful" else .105,
                      -.22 if eighth % 2 else .22)
            if family == "tense" and slot % 2 == 0:
                # 四音上行后回根音；以音序制造锯齿感，音色仍是短拨弦。
                # 按和弦实际三度取音，避免转位排列影响大小调判断。
                third = next(n for n in notes if (n - root) % 12 in (3, 4))
                note = (root + 36, root + 36 + (third - root) % 12,
                        root + 43, root + 48)[eighth % 4]
                place(harmonic, plucked(note, True), t, .13, -.12 if eighth % 2 else .12)
            if family == "warm" and slot in (0, 8):
                place(harmonic, celesta(notes[0 if slot == 0 else 2] + 24), t, .085, .15)
            if family == "dark" and slot % 4 == 0:
                place(rhythm, low_note(root + 12, .22), t, .14)
            if family == "tense" and slot in (0, 8):
                place(rhythm, low_note(root, BEAT * 1.25), t, .105)
            kick_here = ((family == "opening" and t - start >= 8 and slot in (0, 8))
                         or (family == "clock" and slot % 4 == 0)
                         or (family == "tense" and slot in (0, 8)))
            if kick_here:
                place(rhythm, kick, t, .055 if family == "opening" else .065)
            if family == "playful" and slot % 2 == 0:
                place(rhythm, ak.shaker(.085, bright=.65, rng=SEED + 10000 + step),
                      t, .11 if slot % 4 else .075, -.22)
            if family in ("clock", "warm"):
                # 低电平 16 分音符放映机齿轮：仅第三章和第四章后半。
                hat = ak.lp(ak.hat(rng=SEED + 20000 + step), 10000)
                place(rhythm, hat, t, (.035 if family == "clock" else .022)
                      * (1 if slot % 4 else .65), .22)

    wet = ak.reverb(harmonic, dur=1.2, decay=.34, wet=.13 if family == "warm" else .10,
                    predelay=.018, rng=SEED + 30000)
    wet += rhythm
    # 段界收住混响和打击，避免齿轮泄漏到未指定段落；片尾保留 1.5s 尾音。
    return ak.fade(wet, .12 if family == "opening" else .012,
                   .15 if family == "outro" else .045).astype(np.float32)


def music_bus(duration, scenes, groups):
    music = np.zeros((round((duration + TAIL) * SR), 2), dtype=np.float32)
    for group in groups:
        sig = group_audio(group)
        start = round(group["start"] * SR)
        music[start:start + len(sig)] += sig
    for scene in scenes:
        if scene["id"] == "s07":
            start, end = round(scene["start"] * SR), round(scene["end"] * SR)
            ramp = min(start, round(.02 * SR))
            if ramp:
                music[start-ramp:start] *= np.linspace(1, .5, ramp)[:, None]
            music[start:end] *= .5  # 包含全部干声与混响；音效不受影响。
    return music


def noise_stroke(dur, low, high, decay, seed):
    t = ak.tvec(dur)
    noise = np.random.default_rng(seed).standard_normal(len(t))
    return ak.fade(ak.bp(noise, low, high) * np.minimum(1, t / .002)
                   * np.exp(-t / decay), 0, .015)


def mono_add(buf, sig, t):
    start = round(t * SR)
    count = min(len(sig), len(buf) - start)
    if count > 0:
        buf[start:start + count] += sig[:count]


@lru_cache(maxsize=16)
def cue_voice(kind):
    if kind == "click":
        x = ak.woodblock(880, .085, bright=.45) * .22
    elif kind == "stamp":
        x = ak.lp(ak.kick(), 420) * .36
        mono_add(x, noise_stroke(.065, 450, 3300, .013, SEED + 1) * .10, 0)
    elif kind == "tick":
        x = ak.s_tick(.16, rng=SEED + 2)
    elif kind == "draw":
        x = noise_stroke(.30, 1300, 4800, .070, SEED + 3) * .025
    elif kind == "pop":
        x = ak.s_blip(.43, f=1600)
    elif kind in ("whoosh", "send"):
        x = ak.s_whoosh(.18 if kind == "whoosh" else .22,
                        d=.50 if kind == "whoosh" else .20, rng=SEED + 4)
        if kind == "send":
            x = ak.hp(x, 2600)
    elif kind in ("reel", "type"):
        rate = 18 if kind == "reel" else 12
        x = np.zeros(round(.8 * SR))
        for k in range(math.ceil(.8 * rate)):
            mono_add(x, ak.s_tick(.15 if kind == "reel" else .17,
                                rng=SEED + 100 + k), k / rate)
        if kind == "reel":
            x *= np.sin(np.linspace(0, np.pi, len(x))) ** .8
    elif kind == "leader":
        x = ak.s_whoosh(.075, d=.28, rng=SEED + 5)
        t = ak.tvec(.08)
        beep = np.sin(2 * np.pi * 1000 * t) * ak.adsr(.08, .004, .008, .7, .014) * .075
        mono_add(x, beep, 0)
    elif kind == "flip":
        x = np.zeros(round(.24 * SR))
        for k, t in enumerate((0, .065, .145)):
            mono_add(x, noise_stroke(.08, 900, 6500, .022, SEED + 10 + k)
                     * (.047, .040, .030)[k], t)
    elif kind == "success":
        x = ak.s_confirm(.42)
    elif kind == "blip":
        x = ak.s_blip(.35, f=880)
    elif kind == "error":
        x = ak.s_error(.22)
    elif kind == "snip":
        x = np.zeros(round(.12 * SR))
        for k, t in enumerate((0, .065)):
            mono_add(x, noise_stroke(.045, 2500, 10000, .009, SEED + 20 + k) * .065, t)
    elif kind == "latch":
        x = ak.woodblock(430, .12, bright=.35) * .24
    else:
        raise KeyError(f"未映射的 cue 类型：{kind}")
    return ak.fade(x, .0005, .008)


def effect(kind, v=1):
    return cue_voice(kind) * v


def effects():
    return {kind: partial(effect, kind) for kind in CUE_TYPES}


def render(info):
    duration, scenes, groups, cues = prepare(info)
    sfx = np.zeros((round((duration + TAIL) * SR), 2), dtype=np.float32)
    ak.place_cues(sfx, cues, effects())  # strict 默认 True；未知类型立即报错。
    music = music_bus(duration, scenes, groups)
    music = ak.duck(music, key=sfx, depth_db=5, threshold=.012,
                    attack=.018, hold=.06, release=.24)
    music += sfx
    del sfx
    # 尾音只做很短淡出，保留片尾 pad 混响；normalize 仍使用全部默认参数。
    return ak.normalize(ak.fade(music, .015, .10))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    started = time.perf_counter()
    info = ak.read_timeline(args.timeline)
    mix = render(info)
    ak.write_wav(args.output, mix)
    print(f"WAV: {len(mix) / SR:.3f} s (timeline {info['duration']:.3f} + tail {TAIL:.1f}), "
          f"{SR} Hz, stereo PCM16; float RMS {ak.rms_db(mix):.4f} dBFS; "
          f"peak {ak.peak_db(mix):.4f} dBFS; elapsed {time.perf_counter() - started:.3f} s")


if __name__ == "__main__":
    main()
