#!/usr/bin/env python3
"""订阅线路：100 BPM / 4/4 / D 大调，离线合成城市通勤电子配乐。

用法：python3 audio.py <完整 timeline.json> <out.wav>
只写指定的 48 kHz / 立体声 / PCM16 WAV，stdout 输出自测 JSON。
节拍从 0 秒连续运行；章首不足一小节的部分先用首和弦，首个完整
小节才开始四和弦循环。除特写卡点外，音符均在此全片网格上。
第五章第 3 拍整拍（0.6 秒）音乐静音，音效不受影响。
音乐以有效帧 RMS 比音效低 6 dB，再侧链 duck；最后默认 normalize。
尾音真实保留 1.5 秒，不受 CI 视频预览长度影响。所有噪声固定种子。
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


def section_audio(section, scenes, markers):
    """每章独立分层、混响、收边，片尾单独延伸至预留尾音末端。"""
    n, start, end = section["n"], section["start"], section["end"]
    origin = frame(start)
    length = frame(end + (TAIL if n == 9 else 0)) - origin
    harmonic = np.zeros((length, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)
    layers_by_scene = {}

    def place(bus, voice, t, gain, layer, pan=0):
        ak.add(bus, voice, (frame(t) - origin) / SR, gain, pan)
        sid = next((sid for sid, sc in scenes.items()
                    if frame(sc["start"]) <= frame(t) < frame(sc["end"])), "tail")
        layers_by_scene.setdefault(sid, Counter())[layer] += 1

    if n in (1, 9):
        span = length / SR
        pad = ak.pad_chord((50, 57, 62, 66), span, cut=1300)
        if n == 9:
            pad *= np.exp(-ak.tvec(span) / 1.8)
            pad = ak.fade(pad, fade_out=TAIL)
        place(harmonic, pad, start, .13, "pad")
        for k, note in enumerate((74, 78, 81)):
            t = start + k * BEAT / 2
            place(harmonic, mallet(note, .8), t, .31, "marimba", (k - 1) * .15)
            place(harmonic, ak.electric_piano(ak.mtof(note), 1.5, bell=.25),
                  t, .12, "piano", (1 - k) * .10)
    else:
        for step in range(math.ceil(start / STEP - 1e-9), math.ceil(end / STEP - 1e-9)):
            t, slot = step * STEP, step % 16
            root, notes = CHORDS[chord_at(section, t, markers)]
            if n == 6 and 8 <= slot < 12:
                continue  # 第 3 拍既不触发新音，也会在混响后抹净持续音。
            if n == 0:
                if slot in (0, 8):
                    place(rhythm, sine_bass(root, BEAT * 1.9), t, .16, "bass")
                if slot == 2 and bar_index(t) % 2 == 0:
                    place(harmonic, mallet(notes[1], .4), t, .10, "marimba", -.12)
                continue

            # s10: 两层；s11: 加 shaker / kick；s12: 再加柱式电钢。
            percussion = n != 4 or frame(t) >= frame(scenes["s11"]["start"])
            piano = n != 4 or frame(t) >= frame(scenes["s12"]["start"])
            if n == 7 or slot % 2 == 0:
                pitches = (*notes, notes[0] + 12)
                pick = slot % 4 if n == 7 else (0, 1, 2, 3, 2, 1, 0, 2)[slot // 2]
                strength = 1 if slot % 4 == 0 else .76
                place(harmonic, mallet(pitches[pick], .34 if n == 7 else .48), t,
                      (.23 if n == 7 else .27) * strength, "marimba", (pick - 1.5) * .12)
            if slot in ((0, 12) if n == 6 else (0, 8)):
                dur = BEAT * (.90 if n == 6 and slot == 12 else 1.90)
                place(rhythm, sine_bass(root, dur), t, .19, "bass")
            if piano and slot == 0:
                place(harmonic, piano_chord(notes), t, .09, "piano", -.10)
            if percussion:
                # 总结：kick 仅第 1 拍，shaker 从 16 分减成 8 分。
                if slot in ((0,) if n == 8 else (0, 8)):
                    place(rhythm, ak.kick(), t, .055, "kick")
                if n != 8 or slot % 2 == 0:
                    place(rhythm, ak.shaker(.07, bright=.8, rng=SEED + 10000 + step),
                          t, (.17 if n == 8 else .23) * (1 if slot % 2 else .68),
                          "shaker", -.28)
                # 通常轻八分 hat，第三章按逐层表；第六章让位给 16 分琶音。
                # 第四章 16 分 hat + shaker，使其总事件密度高于第六章。
                if n in (2, 3, 5, 6) and (n == 5 or slot % 2 == 0):
                    place(rhythm, ak.hat(rng=SEED + 20000 + step), t,
                          .10 if n == 5 else .055, "hat", .25)
            if n == 3 and slot == 12:
                place(harmonic, ak.chip_square(ak.mtof(notes[2] + 12), .10, bright=.18),
                      t, .065, "square", .22)

        if n == 0:
            # 不规则、低密度；随机只决定开场木块，不影响其它章节。
            rng = np.random.default_rng(SEED + 1)
            t = start + float(rng.uniform(.35, .85))
            while t < end:
                place(rhythm, ak.woodblock(float(rng.uniform(780, 1150)), .10, bright=.5),
                      t, float(rng.uniform(.12, .20)), "woodblock", float(rng.uniform(-.2, .2)))
                t += float(rng.uniform(.85, 2.15))
        if n == 8:
            for bar in range(bar_index(start), math.ceil(end / BAR - 1e-9)):
                t, stop = max(start, bar * BAR), min(end, (bar + 1) * BAR)
                _, notes = CHORDS[chord_at(section, t, markers)]
                pad = ak.pad_chord(tuple(m - 12 for m in notes), stop - t + .25, cut=1500)
                place(harmonic, pad, t, .14, "pad")

    accent = None
    if 2 <= n <= 8:
        t = first_full_bar(section) * BAR
        if t + BAR > end + 1e-9:
            raise ValueError(f"章节 {n} 不足一个完整小节")
        root = CHORDS[chord_at(section, t, markers)][0]
        place(rhythm, sine_bass(root, .85), t, .15, "bass_accent")
        accent = dict(n=n, t=t, root_midi=root)
    if n == 5:
        place(rhythm, ak.kick(), markers["merge"], .12, "merge_kick")
        place(rhythm, sine_bass(CHORDS["D"][0] - 12, 1.35), markers["merge"],
              .26, "merge_bass")
    if n == 7:
        for k, note in enumerate((74, 78, 81, 86)):
            place(harmonic, mallet(note, .6), markers["rise"] + k * STEP,
                  .27 + k * .015, "rise", (k - 1.5) * .12)

    wet = ak.reverb(harmonic, dur=.45, decay=.12, wet=.065,
                    rng=SEED + 30000 + n, predelay=.012)
    wet += rhythm
    wet = ak.fade(wet, fade_in=.025, fade_out=.06 if n == 9 else .018)
    audit = dict(n=n, label=LABELS[n], start=start, end=end,
                 progression=list(PROGRESSIONS[n]), layers_by_scene=layers_by_scene)
    return wet.astype(np.float32), audit, accent


def music_bus(duration, sections, scenes, markers):
    music = np.zeros((frame(duration + TAIL), 2), dtype=np.float32)
    audits, accents = [], []
    for section in sections:
        signal, audit, accent = section_audio(section, scenes, markers)
        start = frame(section["start"])
        music[start:start + len(signal)] += signal
        audits.append(audit)
        if accent is not None:
            accents.append(accent)
    return music, audits, accents


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


def mute_music(music, sections, markers):
    """在混响之后整条音乐总线拉零，窗口之外各留 8 ms 防点击淡变。"""
    windows = [(t, t + BAR / 2, "s07_error") for t in markers["errors"]]
    dispatch = sections[6]
    for bar in range(bar_index(dispatch["start"]), math.ceil(dispatch["end"] / BAR - 1e-9)):
        start = max(dispatch["start"], bar * BAR + 2 * BEAT)
        end = min(dispatch["end"], bar * BAR + 3 * BEAT)
        if start < end:
            windows.append((start, end, "dispatch_beat_3"))
    report = []
    ramp = frame(.008)
    for start, end, reason in sorted(windows):
        a, b = max(0, frame(start)), min(len(music), frame(end))
        left, right = max(0, a - ramp), min(len(music), b + ramp)
        music[left:a] *= np.linspace(1, 0, a - left, endpoint=False)[:, None]
        music[a:b] = 0
        music[b:right] *= np.linspace(0, 1, right - b)[:, None]
        report.append(dict(start=a / SR, end=b / SR, reason=reason,
                           music_peak=float(np.max(np.abs(music[a:b])))))
    return report


def calibrate_bus(bus, target):
    """用有效帧而非整片空隙校准，避免稀疏音效被人为放大。"""
    active = np.max(np.abs(bus), axis=1) > 1e-7
    calibrated = ak.normalize(bus, target_rms_db=target, peak_db=None, mask=active).astype(np.float32)
    return calibrated, dict(active_rms_dbfs=ak.rms_db(calibrated[active]),
                            active_seconds=int(active.sum()) / SR)


def render(info):
    duration, sections, scenes, cues, markers = prepare(info)
    music, audits, accents = music_bus(duration, sections, scenes, markers)
    windows = mute_music(music, sections, markers)
    sfx = np.zeros_like(music)
    ak.place_cues(sfx, cues, effects())  # strict=True：未知类型不能忽略。
    music, music_level = calibrate_bus(music, ak.SFX_RMS_DB + MUSIC_RELATIVE_DB)
    sfx, sfx_level = calibrate_bus(sfx, ak.SFX_RMS_DB)
    music = ak.duck(music, key=sfx, times=[c["t"] for c in cues if c["v"] > 0],
                    depth_db=DUCK_DB, threshold=.008, attack=.015, hold=.045, release=.18)
    # duck 仅乘增益，不会重新产生静音窗口内的样本；音效直接保留。
    music += sfx
    del sfx
    mix = ak.normalize(music)
    report = dict(sample_rate=SR, channels=2, bpm=BPM, meter="4/4", key="D major",
                  seed=SEED, timeline_seconds=duration, tail_seconds=TAIL,
                  target_rms_dbfs=ak.DEFAULT_RMS_DB, peak_ceiling=.89,
                  music_bus=music_level, sfx_bus=sfx_level, duck_depth_db=DUCK_DB,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  markers=markers, transitions=accents, music_mutes=windows, sections=audits)
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
                  tail_pcm=pcm_stats(pcm, start=frame(report["timeline_seconds"])),
                  last_frame=pcm[-1].tolist())
    digest = hashlib.sha256()
    with args.output.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    report.update(sha256=digest.hexdigest(), elapsed_seconds=time.perf_counter() - started)
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
