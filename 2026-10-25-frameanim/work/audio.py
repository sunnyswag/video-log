#!/usr/bin/env python3
"""帧动画：温暖胶片 / 轻电子，92 BPM、4/4、48 kHz PCM16 立体声。

用法：python3 audio.py /absolute/timeline.json /absolute/out.wav
仅写指定 WAV；长度严格等于时间线，最终使用 audio_kit.normalize 默认目标。
随机声源均用固定整数种子，导入不合成、不写缓存。

所有乐器直接排入从 0 秒连续运行的全局小节/16 分音符网格；场景组只提供
编配参数，不单独渲染。和弦/节奏型在离组起点最近的小节线切换，各层增益
用一小节平滑交接，同一编配跨幕延续和弦。干声汇入一次全片混响，尾音跨幕。
片名/片尾的一次性音符及原有渐强/渐弱仍对齐场景；无节奏段、齿轮活动区间、
s07 半音量保持原时间锚点，以至少 30 ms 干声包络处理，混响不随之截断。
第四章 tense 的短音留空仍保留；pad 持续到小节线后释音，填住干声间隙。
齿轮仍只在 s08–s11、s15–s17；s12–s14 无 hat。片尾在时间线内收尾。
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
    for i, group in enumerate(groups):
        group["bar"] = round(group["start"] / BAR)
        group["change"] = (round(groups[i + 1]["start"] / BAR) * BAR
                           if i + 1 < len(groups) else math.inf)
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
    return max(0, math.floor(t / BAR + 1e-9) - group["bar"])


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


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def layer_gain(group, t):
    # 在音符上采样全局自动化，等价于各层总线乘包络；不切音符或创建段长缓冲。
    gain = 1 if group["bar"] == 0 else smoothstep((t - group["bar"] * BAR) / BAR)
    return gain * (1 - smoothstep((t - group["change"]) / BAR))


def music_bus(duration, scenes, groups):
    frames = round(duration * SR)
    harmonic = ("pad", "drone", "felt", "celesta", "pluck")
    rhythmic = ("bass", "kick", "shaker", "hat")
    buses = {name: np.zeros((frames, 2), dtype=np.float32)
             for name in harmonic + rhythmic}
    send = np.zeros((frames, 2), dtype=np.float32)
    quiet = next((s for s in scenes if s["id"] == "s07"), None)
    rests = [g for g in groups if g["family"] in ("title", "outro")]
    gears = [g for g in groups if g["family"] in ("clock", "warm")]

    def place(layer, sig, t, gain, pan=0, group=None):
        # 片名/片尾只触发原有的一次性事件；前一编配已发出的音符仍可自然释音。
        if group is not None and any(r["start"] <= t < r["end"] for r in rests):
            return
        times = (round(t * SR) + np.arange(len(sig))) / SR
        env = layer_gain(group, times) if group is not None else np.ones(len(sig))
        if quiet is not None:
            start, end = quiet["start"], quiet["end"]
            env = env * np.interp(times, [start - .03, start, end, end + .03],
                                  [1, .5, .5, 1])
        if layer in rhythmic or layer == "pluck":
            for rest in rests:
                start, end = rest["start"], rest["end"]
                env = env * np.interp(times, [start - .03, start, end, end + .03],
                                      [1, 0, 0, 1])
        if layer == "hat":
            gate = np.zeros(len(sig))
            for gear in gears:
                start, end = gear["start"], gear["end"]
                gate = np.maximum(gate, np.interp(times,
                                  [start, start + .03, end - .03, end], [0, 1, 1, 0]))
            env = env * gate
        sig = sig * env
        ak.add(buses[layer], sig, t, gain, pan)
        if layer in harmonic:
            wet = .13 if group is not None and group["family"] == "warm" else .10
            ak.add(send, sig, t, gain * wet, pan)

    # 场景锚定的长音/重音是全局事件；片名六秒渐强、片尾两秒渐弱保持原时长。
    for group in groups:
        family, start, end = group["family"], group["start"], group["end"]
        if family in ("title", "outro"):
            dur = end - start
            pad = warm_pad((48, 55, 60, 64), dur + (.9 if family == "title" else 0), 1400).copy()
            phase = np.minimum(1, np.arange(len(pad)) / max(1, round(dur * SR) - 1))
            if family == "title":
                pad *= .12 + .88 * phase
                for k, note in enumerate((84, 88, 91, 96)):
                    place("celesta", celesta(note), start + k * BEAT / 2, .22, -.15 + k * .10)
            else:
                pad *= (1 - phase) ** 1.2
                place("celesta", celesta(84), start, .22)
            place("pad", pad, start, .065 if family == "title" else .07)
        elif family == "dark":
            # A1 + E2 持续低音，跨 s05–s07 不重触发，交接后一小节才退场。
            t = group["bar"] * BAR
            place("drone", warm_pad((33, 40), group["change"] + BAR - t + .9, 430),
                  t, .045, group=group)

    kick = ak.fade(ak.lp(ak.kick(), 320), .003, .04)
    current = 0
    for bar in range(math.ceil(duration / BAR)):
        t = bar * BAR
        while current + 1 < len(groups) and groups[current + 1]["bar"] <= bar:
            current += 1
        group = groups[current]
        root, notes = chord_at(group, t)
        active = [group]
        if current and bar == group["bar"] and group["family"] not in ("title", "outro"):
            active.insert(0, groups[current - 1])
        for part in active:
            t = bar * BAR
            family = part["family"]
            if family in ("title", "outro"):
                continue
            put = partial(place, group=part)
            pad_gain = dict(opening=.025, playful=.018, dark=.016, clock=.020,
                            tense=.021, warm=.060, closing=.055)[family]
            pad_notes = tuple(n - 12 for n in notes)
            if family == "tense":
                # pad 的 900 ms 释音从小节线才开始；干声短音/空拍不变，湿声自然延续。
                pad = warm_pad(pad_notes, BAR + .9, 1400).copy()
                times = (round(t * SR) + np.arange(len(pad))) / SR
                # 只从本章实际起点以 30 ms 进入，最高为 warm 的常规 pad 增益 .060。
                pad *= 1 + (.060 / pad_gain - 1) * smoothstep((times - part["start"]) / .03)
            else:
                pad = warm_pad(pad_notes, BAR + .35,
                               650 if family in ("opening", "dark") else 1400)
            put("pad", pad, t, pad_gain, -.12)
            if family in ("playful", "warm", "closing"):
                put("felt", felt_chord(notes), t, .065 if family == "playful" else .12, .12)
            # 整小节为持音时值，另留原音色的 70 ms 释音，不在小节线前提前收断。
            if family == "opening":
                put("bass", low_note(STAIRS[bar_index(part, t) % len(STAIRS)], BAR + .07), t, .11)
                put("celesta", celesta(notes[0] + 24), t, .085, -.1)
            elif family in ("playful", "clock", "warm", "closing"):
                put("bass", low_note(root, BAR + .07), t, .115 if family == "warm" else .09)

            for slot in range(16):
                step = bar * 16 + slot
                t = step * STEP
                if t >= duration:
                    break
                eighth = slot // 2
                if family in ("playful", "closing") and slot % 2 == 0:
                    note = MOTIF[bar_index(part, t) % len(MOTIF)][eighth]
                    if note is not None:
                        put("celesta", celesta(note), t, .17 if family == "playful" else .18, .16)
                if family in ("playful", "clock") and slot % 2 == 0:
                    note = notes[(0, 1, 2, 1, 0, 2, 1, 2)[eighth]] + 12
                    put("pluck", plucked(note), t, .075 if family == "playful" else .105,
                        -.22 if eighth % 2 else .22)
                if family == "tense" and slot % 2 == 0:
                    # 四音上行后回根音；按和弦实际三度取音，避免转位影响大小调判断。
                    third = next(n for n in notes if (n - root) % 12 in (3, 4))
                    note = (root + 36, root + 36 + (third - root) % 12,
                            root + 43, root + 48)[eighth % 4]
                    put("pluck", plucked(note, True), t, .13, -.12 if eighth % 2 else .12)
                if family == "warm" and slot in (0, 8):
                    put("celesta", celesta(notes[0 if slot == 0 else 2] + 24), t, .085, .15)
                if family == "dark" and slot % 4 == 0:
                    put("bass", low_note(root + 12, .22), t, .14)
                if family == "tense" and slot in (0, 8):
                    put("bass", low_note(root, BEAT * 1.25), t, .105)
                kick_here = ((family == "opening" and t - part["start"] >= 8 and slot in (0, 8))
                             or (family == "clock" and slot % 4 == 0)
                             or (family == "tense" and slot in (0, 8)))
                if kick_here:
                    put("kick", kick, t, .055 if family == "opening" else .065)
                if family == "playful" and slot % 2 == 0:
                    put("shaker", ak.shaker(.085, bright=.65, rng=SEED + 10000 + step),
                        t, .11 if slot % 4 else .075, -.22)
                if family in ("clock", "warm"):
                    # 低电平 16 分音符放映机齿轮；原场景窗口只约束干声。
                    hat = ak.lp(ak.hat(rng=SEED + 20000 + step), 10000)
                    put("hat", hat, t, (.035 if family == "clock" else .022)
                        * (1 if slot % 4 else .65), .22)

    # 发送量也随各层自动化；只卷积一次，不在返回的湿声上套场景包络。
    music = ak.reverb(send, dur=1.2, decay=.34, wet=1,
                      predelay=.018, rng=SEED + 30000)
    music -= send
    for layer in harmonic + rhythmic:
        music += buses.pop(layer)
    return ak.fade(music, .12, .15)


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
    sfx = np.zeros((round(duration * SR), 2), dtype=np.float32)
    ak.place_cues(sfx, cues, effects())  # strict 默认 True；未知类型立即报错。
    music = music_bus(duration, scenes, groups)
    music = ak.duck(music, key=sfx, depth_db=5, threshold=.012,
                    attack=.018, hold=.06, release=.24)
    music += sfx
    del sfx
    # 只在整片末尾做很短淡出；片尾 pad/混响在时间线内收尾，归一参数不变。
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
    _, _, groups, _ = prepare(info)
    for group in groups:
        grid = group["bar"] * BAR
        print(f"GRID {group['family']}: {group['start']:.3f} -> {grid:.3f} s "
              f"({grid - group['start']:+.3f}); layer transition {BAR:.3f} s")
    print("ANCHORS: title/outro notes + cresc./dim., s07 half gain, rhythm/hat windows unchanged; "
          "dry ramps 30 ms; reverb once; ending within timeline (no appended 1.5 s)")
    print(f"WAV: {len(mix) / SR:.3f} s (timeline {info['duration']:.3f}), "
          f"{SR} Hz, stereo PCM16; float RMS {ak.rms_db(mix):.4f} dBFS; "
          f"peak {ak.peak_db(mix):.4f} dBFS; elapsed {time.perf_counter() - started:.3f} s")


if __name__ == "__main__":
    main()
