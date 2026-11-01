#!/usr/bin/env python3
"""订阅线路：100 BPM / 4/4 / D 大调，离线合成城市通勤电子配乐。

用法：python3 audio.py <完整 timeline.json> <out.wav>
只写指定的 48 kHz / 立体声 / PCM16 WAV，stdout 输出自测 JSON。
音符直接排入从 0 秒连续运行的全局网格，各乐器总线独立自动化。
章节/叠层从最近小节线起用一小节过渡；和弦只在小节线更换，
仍以原章首后的首个完整小节计算进行。特写卡点保留原时间锚点。
连续暖垫沿用每小节和弦，慢起音、立体声铺宽，换和弦交叉淡化一拍；
以第一章稳定马林巴层的 RMS 校准，章节目标低 12–15 dB。
第五章第 3 拍整拍（0.6 秒）只停原干声，暖垫和湿声继续；
仅 s07 error 半小节全音乐静音，进出斜坡 30 ms，音效照旧。
各层汇合后只做一次全片混响，释音和湿声跨章延续，无段界收边。
音乐以有效帧 RMS 比音效低 6 dB，再侧链 duck；最后默认 normalize。
片尾落点不移动，原 1.5 秒收尾放在时间线内，输出时长等于时间线。
所有噪声固定种子；stdout 同时报告量化、干声留白及每章 PCM RMS。
"""

import argparse
from collections import Counter
from functools import lru_cache, partial
import hashlib
import json
import math
from pathlib import Path
import sys
import time

# CI 不应在只读积木目录或本目录留下 __pycache__。
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
TAIL = 1.5
SEED = 20261025
MUSIC_RELATIVE_DB = -6.0
DUCK_DB = 4.0
BED_CUTOFF = 1650
BED_CROSSFADE = BEAT
# 相对第一章稳定主马林巴层的 RMS；章节情绪只作轻微变化。
BED_DB = (-14.0, -15.0, -12.0, -12.0, -13.0, -12.0, -12.0, -12.0, -14.0, -15.0)

# (低音根音, 电钢/马林巴三和弦 MIDI)；邻近转位避免主旋律大幅跳动。
CHORDS = {
    "D": (38, (62, 66, 69)),
    "Bm": (35, (62, 66, 71)),
    "G": (31, (62, 67, 71)),
    "A": (33, (61, 64, 69)),
    "Em": (40, (64, 67, 71)),
    "F#": (30, (61, 66, 70)),
    "Bdim": (35, (59, 62, 65)),
}
PROGRESSIONS = {
    0: ("Bm", "G", "Em", "F#"),
    1: ("D",),
    2: ("D", "Bm", "G", "A"),
    3: ("Bm", "G", "D", "A"),
    4: ("D", "A", "Bm", "G"),
    5: ("D", "Bm", "G", "A"),
    6: ("Bm", "Em", "G", "F#"),
    7: ("G", "A", "D", "D"),
    8: ("D", "G", "Bm", "A"),
    9: ("D",),
}
LABELS = ("开场", "片名", "第一章", "第二章", "第三章", "第四章",
          "第五章", "第六章", "总结", "片尾")
TRANSITION_SCENES = ("s04", "s06", "s10", "s13", "s16", "s19", "s21")
CUE_TYPES = ("draw", "tick", "blip", "latch", "snap", "whoosh", "type",
             "success", "error", "confirm", "stamp", "snip")


def frame(t):
    return round(float(t) * SR)


def bar_index(t):
    return math.floor(t / BAR + 1e-9)


def first_full_bar(section):
    return math.ceil(section["start"] / BAR - 1e-9)


def nearest_bar(t):
    return math.floor(t / BAR + .5) * BAR


def prepare(info):
    duration = float(info["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration 须为有限正数")
    sections = ak.timeline_sections(info, "chapters")
    if [s.get("n") for s in sections] != list(range(10)):
        raise ValueError("本片须包含从 0 秒开始、按顺序排列的章节 0..9")
    if any(frame(s["end"]) <= frame(s["start"]) for s in sections):
        raise ValueError("章节时长须为正")
    scenes = {}
    for scene in info["scenes"]:
        start, dur = float(scene["start"]), float(scene["d"])
        if (not math.isfinite(start + dur) or start < 0 or dur <= 0
                or frame(start + dur) > frame(duration)):
            raise ValueError(f"场景时长/位置非法：{scene['id']}")
        if scene["id"] in scenes:
            raise ValueError(f"场景 id 重复：{scene['id']}")
        scenes[scene["id"]] = dict(scene, start=start, end=start + dur)
    cues = []
    for cue in info["cues"]:
        t, v = float(cue["t"]), float(cue.get("v", 1))
        if not (0 <= t < duration and 0 <= v <= 1):
            raise ValueError("cue.t / cue.v 须有限且在时间线 / 0..1 范围内")
        cues.append(dict(t=t, type=cue["type"], v=v))
    # 提前预检，正式 place_cues 也保留 strict 默认值。
    unknown = sorted({c["type"] for c in cues} - set(CUE_TYPES))
    if unknown:
        raise KeyError(f"未映射的 cue 类型：{unknown}")

    def in_scene(sid, kind):
        scene = scenes[sid]
        result = sorted(c["t"] for c in cues if c["type"] == kind
                        and frame(scene["start"]) <= frame(c["t"]) < frame(scene["end"]))
        if not result:
            raise ValueError(f"缺少卡点：{sid} 内的 {kind}")
        return result

    for sid, n in zip(TRANSITION_SCENES, range(2, 9)):
        scene = scenes[sid]
        if frame(scene["start"]) != frame(sections[n]["start"]):
            raise ValueError(f"{sid} 未与章节 {n} 起点对齐")
        if not any(frame(t) == frame(scene["start"]) for t in in_scene(sid, "whoosh")):
            raise ValueError(f"缺少章首 whoosh：{sid}")
    for sid in ("s11", "s12"):
        if sid not in scenes:
            raise ValueError(f"缺少逐层叠加场景：{sid}")
    markers = dict(errors=in_scene("s07", "error"),
                   merge=in_scene("s14", "snap")[-1],
                   diminished_bars=sorted({bar_index(t) for t in in_scene("s17", "error")}),
                   success=in_scene("s19", "success")[-1])
    # 上行收束等 success 的 0.6 秒发声完毕，再落在下一个十六分网格。
    markers["rise"] = math.ceil((markers["success"] + .6) / STEP - 1e-9) * STEP
    if markers["rise"] + 4 * STEP >= sections[7]["end"]:
        raise ValueError("第六章没有足够时长容纳 success 后的上行收束")
    return duration, sections, scenes, cues, markers


def chord_at(section, t, markers):
    bar = bar_index(t)
    if section["n"] == 6 and bar in markers["diminished_bars"]:
        return "Bdim"
    progression = PROGRESSIONS[section["n"]]
    return progression[max(0, bar - first_full_bar(section)) % len(progression)]


@lru_cache(maxsize=128)
def mallet(note, dur=.48):
    return ak.marimba(ak.mtof(note), dur=dur, bright=.65)


@lru_cache(maxsize=128)
def sine_bass(note, dur):
    t = ak.tvec(dur)
    return (np.sin(2 * np.pi * ak.mtof(note) * t)
            * ak.adsr(dur, .010, .10, .78, .075) * .55)


@lru_cache(maxsize=64)
def piano_chord(notes):
    return sum(ak.electric_piano(ak.mtof(m), dur=1.7, bell=.22)
               for m in notes) / len(notes)


def bed_chord(notes, start):
    """同音使用全局相位，跨小节不重触发；左右微失谐，避免单声道复制。"""
    t = ak.tvec(BAR + BED_CROSSFADE) + start
    voice = np.zeros((len(t), 2))
    for channel, detune in enumerate((-.035, .035)):
        for note in notes:
            f = ak.mtof(note - 12) * 2 ** (detune / 12)
            phase = (note * .61803398875 + channel * .23) * 2 * np.pi
            angle = 2 * np.pi * f * t + phase
            voice[:, channel] += (np.sin(angle) + .18 * np.sin(2 * angle)
                                  + .06 * np.sin(3 * angle)) / math.sqrt(len(notes))
    voice = ak.lp(voice, BED_CUTOFF)
    ramp = frame(BED_CROSSFADE)
    u = np.linspace(0, 1, ramp)
    curve = u * u * (3 - 2 * u)
    voice[:ramp] *= curve[:, None]
    voice[-ramp:] *= (1 - curve)[:, None]
    return voice.astype(np.float32)


def layer_gains(n, percussion=True, piano=True):
    """原编制的各层电平；密度变体共用全局网格，交接时平滑换层。"""
    regular = 2 <= n <= 8
    drums = regular and percussion
    return dict(
        intro_marimba=.10 if n == 0 else 0,
        marimba=.27 if regular and n != 7 else 0,
        arpeggio=.23 if n == 7 else 0,
        bass=.16 if n == 0 else (.19 if regular and n != 6 else 0),
        dispatch_bass=.19 if n == 6 else 0,
        piano=.09 if regular and piano else 0,
        kick=.055 if drums else 0,
        kick_half=.055 if drums and n != 8 else 0,
        shaker=(.17 if n == 8 else .23) if drums else 0,
        shaker_odd=.23 if drums and n != 8 else 0,
        hat=(.10 if n == 5 else .055) if drums and n in (2, 3, 5, 6) else 0,
        hat_odd=.10 if drums and n == 5 else 0,
        square=.065 if n == 3 else 0,
        pad=.14 if n == 8 else 0,
        title_pad=.13 if n == 1 else 0,
        bed=10 ** (BED_DB[n] / 20),
        woodblock=1 if n == 0 else 0)


def arrangement(sections, scenes):
    changes = []
    for section in sections:
        n = section["n"]
        changes.append(dict(t=nearest_bar(section["start"]), source=section["start"],
                            reason=f"chapter_{n}", n=n,
                            gains=layer_gains(n, n != 4, n != 4)))
    for sid, piano in (("s11", False), ("s12", True)):
        start = scenes[sid]["start"]
        changes.append(dict(t=nearest_bar(start), source=start, reason=sid, n=4,
                            gains=layer_gains(4, True, piano)))
    changes.sort(key=lambda change: change["t"])
    if any(b["t"] - a["t"] < BAR - 1e-9 for a, b in zip(changes, changes[1:])):
        raise ValueError("编制自动化间距不足一小节")
    return changes


def layer_envelope(length, changes, layer):
    env = np.full(length, changes[0]["gains"][layer], dtype=np.float32)
    previous = changes[0]["gains"][layer]
    for change in changes[1:]:
        target = change["gains"][layer]
        a, b = frame(change["t"]), min(length, frame(change["t"] + BAR))
        if a >= length:
            break
        u = np.arange(b - a, dtype=np.float32) / frame(BAR)
        env[a:b] = previous + (target - previous) * u * u * (3 - 2 * u)
        env[b:] = target
        previous = target
    # 成片末端沿用 1.5 秒收束，让跨入片尾的伴奏层也在时间线内退场。
    tail = min(length, frame(TAIL))
    env[-tail:] *= np.linspace(1, 0, tail)
    return env


def music_bus(duration, sections, scenes, markers):
    """只排一次全片音符；逐乐器合成全长总线，干声自动化后统一混响。"""
    length = frame(duration)
    changes = arrangement(sections, scenes)
    events = {layer: [] for layer in changes[0]["gains"]}
    events.update(special_harmonic=[], special_rhythm=[])
    audits = [dict(n=s["n"], label=LABELS[s["n"]], start=s["start"], end=s["end"],
                   grid_start=nearest_bar(s["start"]),
                   progression=list(PROGRESSIONS[s["n"]]), layers_by_scene={})
              for s in sections]
    accents = []

    def enabled(layer, t):
        if layer.startswith("special_"):
            return True
        index = max(i for i, change in enumerate(changes) if change["t"] <= t + 1e-9)
        current = changes[index]
        return (current["gains"][layer] > 0
                or (index > 0 and t < current["t"] + BAR - 1e-9
                    and changes[index - 1]["gains"][layer] > 0))

    def place(layer, voice, t, gain=1, pan=0, label=None):
        if not enabled(layer, t):
            return
        events[layer].append((t, voice, gain, pan))
        sid = next((sid for sid, sc in scenes.items()
                    if frame(sc["start"]) <= frame(t) < frame(sc["end"])), "tail")
        n = ak.section_at(t, sections)["n"]
        audits[n]["layers_by_scene"].setdefault(sid, Counter())[label or layer] += 1

    # 和弦在小节线统一选择；原首个完整小节仍是进行的计数原点。
    section = sections[0]
    for step in range(math.ceil(duration / STEP - 1e-9)):
        t, slot = step * STEP, step % 16
        if slot == 0:
            section = sections[max(s["n"] for s in sections
                                   if nearest_bar(s["start"]) <= t + 1e-9)]
        root, notes = CHORDS[chord_at(section, t, markers)]
        if slot == 0:
            place("bed", bed_chord(notes, t), t)
        if sections[6]["start"] <= t < sections[6]["end"] and 8 <= slot < 12:
            continue  # 第五章第 3 拍不触发原节奏新音；暖垫、湿声继续。
        if slot == 2 and bar_index(t) % 2 == 0 and enabled("intro_marimba", t):
            place("intro_marimba", mallet(notes[1], .4), t, pan=-.12, label="marimba")
        if slot % 2 == 0 and enabled("marimba", t):
            pitches = (*notes, notes[0] + 12)
            pick = (0, 1, 2, 3, 2, 1, 0, 2)[slot // 2]
            place("marimba", mallet(pitches[pick], .48), t,
                  1 if slot % 4 == 0 else .76, (pick - 1.5) * .12)
        if enabled("arpeggio", t):
            pitches, pick = (*notes, notes[0] + 12), slot % 4
            place("arpeggio", mallet(pitches[pick], .34), t,
                  1 if slot % 4 == 0 else .76, (pick - 1.5) * .12, "marimba")
        if slot in (0, 8) and enabled("bass", t):
            place("bass", sine_bass(root, BEAT * 1.90), t)
        if slot in (0, 12) and enabled("dispatch_bass", t):
            dur = BEAT * (.90 if slot == 12 else 1.90)
            place("dispatch_bass", sine_bass(root, dur), t, label="bass")
        if slot == 0 and enabled("piano", t):
            place("piano", piano_chord(notes), t, pan=-.10)
        if slot in (0, 8):
            place("kick" if slot == 0 else "kick_half", ak.kick(), t, label="kick")
        shaker = "shaker" if slot % 2 == 0 else "shaker_odd"
        if enabled(shaker, t):
            place(shaker, ak.shaker(.07, bright=.8, rng=SEED + 10000 + step),
                  t, .68 if slot % 2 == 0 else 1, -.28, "shaker")
        hat = "hat" if slot % 2 == 0 else "hat_odd"
        if enabled(hat, t):
            place(hat, ak.hat(rng=SEED + 20000 + step), t, pan=.25, label="hat")
        if slot == 12 and enabled("square", t):
            place("square", ak.chip_square(ak.mtof(notes[2] + 12), .10, bright=.18),
                  t, pan=.22)
        if slot == 0 and enabled("pad", t):
            place("pad", ak.pad_chord(tuple(m - 12 for m in notes), BAR + .25, cut=1500), t)

    # 原开场木块序列和片名/片尾三音动机保持各自时间锚点。
    rng = np.random.default_rng(SEED + 1)
    t = sections[0]["start"] + float(rng.uniform(.35, .85))
    while t < sections[0]["end"]:
        place("woodblock", ak.woodblock(float(rng.uniform(780, 1150)), .10, bright=.5),
              t, float(rng.uniform(.12, .20)), float(rng.uniform(-.2, .2)))
        t += float(rng.uniform(.85, 2.15))
    for n in (1, 9):
        start = sections[n]["start"]
        # 片名长垫延伸过编制交接；片尾在成片内按原指数及 1.5 秒淡出收束。
        stop = nearest_bar(sections[2]["start"]) + BAR + .9 if n == 1 else duration
        span = stop - start
        pad = ak.pad_chord((50, 57, 62, 66), span, cut=1300)
        if n == 9:
            pad *= np.exp(-ak.tvec(span) / 1.8)
            pad = ak.fade(pad, fade_out=TAIL)
        place("title_pad" if n == 1 else "special_harmonic", pad, start,
              1 if n == 1 else .13, label="pad")
        for k, note in enumerate((74, 78, 81)):
            t = start + k * BEAT / 2
            place("special_harmonic", mallet(note, .8), t, .31, (k - 1) * .15, "marimba")
            place("special_harmonic", ak.electric_piano(ak.mtof(note), 1.5, bell=.25),
                  t, .12, (1 - k) * .10, "piano")
    for section in sections[2:9]:
        t = first_full_bar(section) * BAR
        if t + BAR > section["end"] + 1e-9:
            raise ValueError(f"章节 {section['n']} 不足一个完整小节")
        root = CHORDS[chord_at(section, t, markers)][0]
        place("special_rhythm", sine_bass(root, .85), t, .15, label="bass_accent")
        accents.append(dict(n=section["n"], t=t, root_midi=root))
    place("special_rhythm", ak.kick(), markers["merge"], .12, label="merge_kick")
    place("special_rhythm", sine_bass(CHORDS["D"][0] - 12, 1.35), markers["merge"],
          .26, label="merge_bass")
    for k, note in enumerate((74, 78, 81, 86)):
        place("special_harmonic", mallet(note, .6), markers["rise"] + k * STEP,
              .27 + k * .015, (k - 1.5) * .12, "rise")

    harmonic = np.zeros((length, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)
    reference_start = frame(nearest_bar(sections[2]["start"]) + BAR)
    reference_end = frame(nearest_bar(sections[3]["start"]))
    harmonic_layers = {"intro_marimba", "marimba", "arpeggio", "piano", "square",
                       "pad", "title_pad", "special_harmonic"}
    for layer, notes in events.items():
        bus = np.zeros_like(harmonic)
        for t, voice, gain, pan in notes:
            ak.add(bus, voice, t, gain, pan)
        if not layer.startswith("special_"):
            bus *= layer_envelope(length, changes, layer)[:, None]
        if layer == "marimba":
            melody_level = ak.rms_db(bus[reference_start:reference_end])
        if layer == "bed":
            bed = bus
        elif layer in harmonic_layers:
            harmonic += bus
        else:
            rhythm += bus
    del bus, events
    windows = mute_dry(harmonic, rhythm, sections, markers)
    # 持续音与敲击音的占空比不同，不能用推子比值冒充实际 RMS 比值。
    bed_level = ak.rms_db(bed[reference_start:reference_end])
    bed_trim = 10 ** ((melody_level + BED_DB[2] - bed_level) / 20)
    bed *= bed_trim
    for audit in audits:
        a, b = frame(audit["start"]), frame(audit["end"])
        level = ak.rms_db(bed[a:b])
        audit["bed"] = dict(gain=bed_trim * 10 ** (BED_DB[audit["n"]] / 20),
                            target_relative_rms_db=BED_DB[audit["n"]], rms_dbfs=level,
                            measured_relative_rms_db=level - melody_level,
                            reference_rms_dbfs=melody_level,
                            reference_start=reference_start / SR, reference_end=reference_end / SR)
    harmonic += bed
    # 原混响参数/路由不变；只使用一个固定 IR，不截章节湿声。
    music = ak.reverb(harmonic, dur=.45, decay=.12, wet=.065,
                      rng=SEED + 30000, predelay=.012)
    music += rhythm
    for window in windows:
        a, b = frame(window["start"]), frame(window["end"])
        window["bed_peak"] = float(np.max(np.abs(bed[a:b])))
        window["wet_peak"] = float(np.max(np.abs(music[a:b] - bed[a:b])))
        if window["reason"] == "s07_error":
            ramp = frame(window["ramp_seconds"])
            left, right = max(0, a - ramp), min(length, b + ramp)
            music[left:a] *= np.linspace(1, 0, a - left, endpoint=False)[:, None]
            music[a:b] = 0
            music[b:right] *= np.linspace(0, 1, right - b)[:, None]
        window["music_peak"] = float(np.max(np.abs(music[a:b])))
        window["scope"] = "all_music" if window["reason"] == "s07_error" else "original_dry"
    del bed
    # 仅成片末端收边；不对任何内部章节施加总线淡变。
    music = ak.fade(music, fade_out=.06)
    automation = [dict(reason=c["reason"], source=c["source"], start=c["t"],
                       end=c["t"] + BAR, rendered_end=min(duration, c["t"] + BAR),
                       shift_seconds=c["t"] - c["source"],
                       gains=c["gains"]) for c in changes[1:]]
    return music.astype(np.float32), audits, accents, windows, automation


@lru_cache(maxsize=len(CUE_TYPES))
def cue_voice(kind):
    """未乘 v 的固定音色；每种随机音色有独立整数种子。"""
    if kind == "draw":
        t = ak.tvec(.35)
        noise = np.random.default_rng(SEED + 401).standard_normal(len(t))
        x = ak.bp(noise, 1600, 5500) * ak.adsr(.35, .025, .055, .55, .12) * .055
    elif kind == "tick":
        x = ak.s_tick(.42, rng=SEED + 402)
    elif kind == "blip":
        x = ak.s_blip(.65, f=1500)
    elif kind == "latch":
        x = ak.woodblock(1050, .12, bright=.65) * .40
        tick = ak.s_tick(.22, rng=SEED + 403)
        x[:len(tick)] += tick
    elif kind == "snap":
        x = ak.fade(ak.clap(rng=SEED + 404)[:frame(.14)], fade_out=.025) * .8
    elif kind == "whoosh":
        x = ak.s_whoosh(.42, d=.55, rng=SEED + 405)
    elif kind == "type":
        x = np.zeros(frame(.22))
        for k in range(4):
            tick = ak.s_tick(.20, rng=SEED + 410 + k)
            start = frame(k * .06)
            x[start:start + len(tick)] += tick
    elif kind == "success":
        x = ak.s_confirm(.9)
    elif kind == "error":
        x = ak.s_error(.42)
    elif kind == "confirm":
        x = np.zeros(frame(.60))
        for k, note in enumerate((81, 86)):  # A5 → D6，间隔 120 ms。
            hit = mallet(note, .48) * .24
            start = frame(k * .12)
            x[start:start + len(hit)] += hit
    elif kind == "stamp":
        x = ak.kick() * .21
        low_clap = ak.lp(ak.clap(rng=SEED + 420), 900) * .85
        x[:len(low_clap)] += low_clap
    elif kind == "snip":
        x = np.zeros(frame(.095))
        t = ak.tvec(.025)
        noise = np.random.default_rng(SEED + 421).standard_normal(len(t))
        cut = ak.hp(noise, 6500) * np.exp(-t / .004) * .065
        x[:len(cut)] += ak.fade(cut, .0005, .005)
        for k, offset in enumerate((.015, .055)):
            tick = ak.s_tick(.24, rng=SEED + 422 + k)
            start = frame(offset)
            x[start:start + len(tick)] += tick
    else:
        raise KeyError(f"未映射的 cue 类型：{kind}")
    return ak.fade(x, fade_in=.0005, fade_out=.005)


def cue_scaled(v, *, kind):
    return cue_voice(kind) * v


def effects():
    # fx[type](v)，只在此乘一次 v；partial 绑定类型，音色内部绑定种子。
    return {kind: partial(cue_scaled, kind=kind) for kind in CUE_TYPES}


def mute_dry(harmonic, rhythm, sections, markers):
    """原留白窗口只压干声；窗口之外各留 30 ms，湿声不经过此包络。"""
    windows = [(t, t + BAR / 2, "s07_error") for t in markers["errors"]]
    dispatch = sections[6]
    for bar in range(bar_index(dispatch["start"]), math.ceil(dispatch["end"] / BAR - 1e-9)):
        start = max(dispatch["start"], bar * BAR + 2 * BEAT)
        end = min(dispatch["end"], bar * BAR + 3 * BEAT)
        if start < end:
            windows.append((start, end, "dispatch_beat_3"))
    report = []
    ramp = frame(.030)
    for start, end, reason in sorted(windows):
        a, b = max(0, frame(start)), min(len(harmonic), frame(end))
        left, right = max(0, a - ramp), min(len(harmonic), b + ramp)
        for bus in (harmonic, rhythm):
            bus[left:a] *= np.linspace(1, 0, a - left, endpoint=False)[:, None]
            bus[a:b] = 0
            bus[b:right] *= np.linspace(0, 1, right - b)[:, None]
        report.append(dict(start=a / SR, end=b / SR, reason=reason,
                           ramp_seconds=ramp / SR,
                           dry_peak=max(float(np.max(np.abs(harmonic[a:b]))),
                                        float(np.max(np.abs(rhythm[a:b]))))))
    return report


def calibrate_bus(bus, target):
    """用有效帧而非整片空隙校准，避免稀疏音效被人为放大。"""
    active = np.max(np.abs(bus), axis=1) > 1e-7
    calibrated = ak.normalize(bus, target_rms_db=target, peak_db=None, mask=active).astype(np.float32)
    return calibrated, dict(active_rms_dbfs=ak.rms_db(calibrated[active]),
                            active_seconds=int(active.sum()) / SR)


def render(info):
    duration, sections, scenes, cues, markers = prepare(info)
    music, audits, accents, windows, automation = music_bus(duration, sections, scenes, markers)
    sfx = np.zeros_like(music)
    ak.place_cues(sfx, cues, effects())  # strict=True：未知类型不能忽略。
    music, music_level = calibrate_bus(music, ak.SFX_RMS_DB + MUSIC_RELATIVE_DB)
    sfx, sfx_level = calibrate_bus(sfx, ak.SFX_RMS_DB)
    music = ak.duck(music, key=sfx, times=[c["t"] for c in cues if c["v"] > 0],
                    depth_db=DUCK_DB, threshold=.008, attack=.015, hold=.045, release=.18)
    # 原音效及避让参数不变；全音乐静音也不影响 error 音效。
    music += sfx
    del sfx
    mix = ak.normalize(music)
    report = dict(sample_rate=SR, channels=2, bpm=BPM, meter="4/4", key="D major",
                  seed=SEED, timeline_seconds=duration, tail_seconds=TAIL,
                  tail_placement="inside_timeline", appended_tail_seconds=0,
                  target_rms_dbfs=ak.DEFAULT_RMS_DB, peak_ceiling=.89,
                  music_bus=music_level, sfx_bus=sfx_level, duck_depth_db=DUCK_DB,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  markers=markers, transitions=accents, music_mutes=windows,
                  automation=automation, reverb_seed=SEED + 30000, sections=audits,
                  continuous_bed=dict(cutoff_hz=BED_CUTOFF, crossfade_seconds=BED_CROSSFADE,
                                      chapter_transition_seconds=BAR,
                                      reference_layer="chapter_1_steady_marimba",
                                      relative_rms_db=BED_DB))
    return mix, report


def pcm_stats(pcm, start=0, end=None):
    end = len(pcm) if end is None else min(len(pcm), end)
    energy, peak = 0.0, 0.0
    for offset in range(start, end, SR * 4):
        block = pcm[offset:min(end, offset + SR * 4)].astype(np.float64) / 32768
        energy += float(np.sum(block * block))
        peak = max(peak, float(np.max(np.abs(block))))
    count = max(1, (end - start) * pcm.shape[1])
    return dict(rms_dbfs=10 * math.log10(max(energy / count, 1e-24)), peak=peak,
                peak_dbfs=20 * math.log10(max(peak, 1e-12)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.resolve() in (args.timeline.resolve(), Path(__file__).resolve()):
        parser.error("输出 WAV 不能覆盖时间线或脚本")
    started = time.perf_counter()
    mix, report = render(ak.read_timeline(args.timeline))
    ak.write_wav(args.output, mix)
    del mix
    sr, pcm = wavfile.read(args.output, mmap=True)
    report.update(frames=len(pcm), duration_seconds=len(pcm) / sr, pcm=pcm_stats(pcm),
                  video_span_pcm=pcm_stats(pcm, end=frame(report["timeline_seconds"])),
                  tail_pcm=pcm_stats(pcm, start=max(0, len(pcm) - frame(TAIL))),
                  last_frame=pcm[-1].tolist())
    for section in report["sections"]:
        section["pcm"] = pcm_stats(pcm, frame(section["start"]), frame(section["end"]))
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    report.update(sha256=digest.hexdigest(), elapsed_seconds=time.perf_counter() - started)
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
