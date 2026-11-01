#!/usr/bin/env python3
"""邮局机械：104 BPM / 4/4 / F 大调，确定性的离线配乐与音效。

用法：python3 -B audio.py timeline.json audio.wav
仅写指定 WAV，测量和 SHA-256 输出到 stdout；不产生字节码缓存。
乐器直接排在 t=0 的全局网格上；章节从最近的小节线换进行，层增益过渡一小节。
音符保留自然释音，干声留白后统一送入一次全片混响，湿声不在章界截断。
片名渐强、冻结进出沿用原时长；场景卡点与片尾钟声保持原时间锚点。
所有卡点来自 chapters / scenes / cues；不依赖本地导出的绝对时刻。
总线内部预留混响尾音，最后 0.8 秒淡至零；裁至时间线长度后归一化并写 PCM16。
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
BPM = 104
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
SEED = 20261025
TAIL = 1.5
REVERB_DUR = 1.35
PREDELAY = .018
DUCK_DB = 3.5
# 根音在第三组，低音声部降一八度；琶音第四音是八度根音，不加七音。
CHORDS = {
    "F": (53, (65, 69, 72, 77)),
    "Dm": (50, (62, 65, 69, 74)),
    "Bb": (46, (58, 62, 65, 70)),
    "C": (48, (60, 64, 67, 72)),
    "Am": (45, (57, 60, 64, 69)),
}
PROGRESSIONS = {
    "A": ("F", "Dm", "Bb", "C"),
    "B": ("Dm", "Bb", "F", "C"),
    "C": ("Bb", "C", "Am", "Dm"),
    "D": ("F", "Am", "Bb", "C"),
    "E": ("F", "C", "Dm", "Bb"),
    "end": ("F",),
}
# 线性音量乘数；第二章延续第一章后半的轻沙锤，第三章才达到满配器。
PATTERNS = {
    0: dict(label="开场", prog="A", marimba=0, bass=.12, pad=.018, wood=.065, hat=0, shaker=0, bell=0, cut=480),
    1: dict(label="片名", prog="A", marimba=.13, bass=0, pad=.055, wood=0, hat=0, shaker=0, bell=0, cut=1200),
    2: dict(label="第一章", prog="A", marimba=.135, bass=.15, pad=.030, wood=.065, hat=0, shaker=0, bell=0, cut=950),
    3: dict(label="第二章", prog="B", marimba=.14, bass=.15, pad=.035, wood=.070, hat=.12, shaker=.060, bell=0, cut=1350),
    4: dict(label="第三章", prog="C", marimba=.15, bass=.16, pad=.038, wood=.075, hat=.14, shaker=.13, bell=0, cut=1450),
    5: dict(label="第四章", prog="A", marimba=.14, bass=.15, pad=.035, wood=.070, hat=.12, shaker=0, bell=0, cut=1300),
    6: dict(label="第五章", prog="D", marimba=.14, bass=.15, pad=.035, wood=.070, hat=.075, shaker=0, bell=0, cut=1350),
    7: dict(label="总结", prog="E", marimba=0, bass=.13, pad=.060, wood=0, hat=0, shaker=0, bell=.105, cut=1800),
    8: dict(label="片尾", prog="end", marimba=0, bass=0, pad=.065, wood=0, hat=0, shaker=0, bell=.095, cut=1600),
}
CUE_KINDS = ("whoosh", "thunk", "ding", "drop", "tick", "blip", "latch",
             "stamp", "tear", "shred", "type", "success", "error")


def prepare(info):
    duration = float(info["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration 须为有限正数")
    sections = ak.timeline_sections(info, "chapters")
    if [s.get("n") for s in sections] != list(range(9)):
        raise ValueError("本片须从零开始，按时间顺序包含章节 n=0..8")
    if any(s["end"] <= s["start"] for s in sections):
        raise ValueError("章节须有正时长")
    scenes = {}
    for s in ak.timeline_sections(info, "scenes"):
        if "id" not in s or s["id"] in scenes:
            raise ValueError("场景须从零开始且 id 唯一")
        # 导出器目前用 d；兼容任务接口描述的 dur。
        stop = s["start"] + float(s.get("dur", s.get("d", s["end"] - s["start"])))
        if not math.isfinite(stop) or not s["start"] < stop <= duration + 1 / SR:
            raise ValueError("场景时长越界")
        scenes[s["id"]] = dict(s, end=stop)
    cues = []
    for c in info["cues"]:
        t, v = float(c["t"]), float(c.get("v", 1))
        if c["type"] not in CUE_KINDS:
            raise ValueError(f"未知 cue 类型：{c['type']!r}")
        if not (0 <= t < duration and 0 <= v <= 1):
            raise ValueError("cue.t / cue.v 越界或非有限值")
        cues.append(dict(t=t, type=c["type"], v=v))
    cues.sort(key=lambda c: (c["t"], c["type"], c["v"]))

    def local(scene_id, offset):
        s = scenes[scene_id]
        t = s["start"] + offset
        if not s["start"] <= t < s["end"]:
            raise ValueError(f"{scene_id} 无法容纳局部 {offset} 秒卡点")
        return t

    marks = dict(pause_start=local("s01", 14.6), pause_end=local("s01", 14.6 + 2 * BEAT),
                 title_landing=local("s02", 3.1), brighten=local("s05", 0),
                 freeze_start=local("s09", 7.2), freeze_end=local("s09", 15.2))
    s13 = scenes["s13"]
    marks["notify_stamps"] = [c["t"] for c in cues if c["type"] == "stamp"
                              and s13["start"] <= c["t"] < s13["end"]]
    if not marks["notify_stamps"]:
        raise ValueError("s13 缺少 NOTIFY → INVOKE 的 stamp cue")
    for n, a, b in ((0, marks["pause_start"] - .02, marks["pause_end"] + .02),
                    (1, marks["title_landing"], marks["title_landing"]),
                    (2, marks["brighten"], marks["brighten"]),
                    (3, marks["freeze_start"], marks["freeze_end"] + .4),
                    (5, marks["notify_stamps"][0], marks["notify_stamps"][-1] + 3 * STEP)):
        if not sections[n]["start"] <= a <= b < sections[n]["end"]:
            raise ValueError(f"卡点不在预期章节 n={n} 内")
    return duration, sections, cues, marks


def chord_at(section, t):
    prog = PROGRESSIONS[PATTERNS[section["n"]]["prog"]]
    origin = math.floor(section["start"] / BAR + 1e-9)
    bar = math.floor(t / BAR + 1e-9) - origin
    return CHORDS[prog[bar % len(prog)]]


@lru_cache(maxsize=80)
def mallet(note, dur=.72):
    return ak.marimba(ak.mtof(note), dur=dur, bright=.65)


@lru_cache(maxsize=80)
def low_note(note, dur):
    return ak.fade(ak.pluck(ak.mtof(note), dur=dur, bright=.5), .004, min(.06, dur / 3))


@lru_cache(maxsize=48)
def bell(note, dur=1.4):
    return ak.lp(ak.electric_piano(ak.mtof(note), dur=dur, bell=.8), 5200)


@lru_cache(maxsize=64)
def warm_pad(notes, dur, cut):
    return ak.pad_chord(notes, dur, cut=cut)


def envelope(buf, points):
    """原地施加采样量化的包络；points 是相对总线起点的 (秒, 电平)。"""
    knots, gains = zip(*points)
    curve = np.interp(np.arange(len(buf)), np.rint(np.asarray(knots) * SR), gains)
    buf *= curve[:, None] if buf.ndim == 2 else curve


def freeze_hum(dur, normal_pad):
    t = ak.tvec(dur)
    # 使用无包络的 pad_voice，让外部 .3 / .4 秒包络完整控制进出时刻。
    hum = ak.lp(ak.pad_voice(ak.mtof(41), dur, cut=150), 150, o=4)
    hum *= .86 + .14 * np.sin(2 * np.pi * .5 * t)
    # 按有效稳态 RMS 对齐普通垫底的 1.2 倍，单音不因少了和弦平均而变响。
    ref = warm_pad((50, 53, 57), BAR + .35, 1350)
    ref_rms = np.sqrt(np.mean(ref[round(.5 * SR):-round(.9 * SR)] ** 2))
    hum_rms = np.sqrt(np.mean(hum[round(.6 * SR):-round(.9 * SR)] ** 2))
    return hum * (normal_pad * 1.2 * ref_rms / max(hum_rms, 1e-12))


def layer_points(layer, sections, score, marks, duration):
    """章节仅给出全片层增益；节奏变体独立渐变，不重启或截短音符。"""
    def level(n, t):
        p = PATTERNS[n]
        values = dict(bass_open=p["bass"] if n == 0 else 0,
                      bass=p["bass"] if 2 <= n <= 7 else 0,
                      wood_on=p["wood"] if n != 6 else 0,
                      wood_off=p["wood"] if n == 6 else 0,
                      hat_beat=p["hat"] * (1 if n == 6 else .72),
                      hat_off=p["hat"], hat_odd=p["hat"] * .55 if n == 6 else 0,
                      bell=p["bell"] if n == 7 else 0,
                      reverb=.13 if n == 7 else .10)
        gain = values[layer] if layer in values else p[layer]
        if n == 1 and layer in ("pad", "marimba"):
            title = sections[1]
            gain *= .28 + .72 * np.clip((t - title["start"]) / (title["end"] - title["start"]), 0, 1)
        if n == 2 and layer == "shaker":
            gain = .055 if t >= marks["brighten"] else 0
        return gain

    points = []
    for i, section in enumerate(score):
        n, start = section["n"], section["start"]
        end = score[i + 1]["start"] if i + 1 < len(score) else duration + TAIL
        points.append((start, level(score[i - 1]["n"], start) if i else level(n, start)))
        if i:
            points.append((start + BAR, level(n, start + BAR)))
        if n == 2 and layer == "shaker":
            points.extend(((marks["brighten"], 0), (marks["brighten"] + .03, .055)))
        points.append((end, level(n, end)))
    return points


def music_bus(duration, sections, marks, diagnostics):
    score = [dict(s, start=round(s["start"] / BAR) * BAR) for s in sections]
    layers = ("pad", "marimba", "bell", "bass_open", "bass", "wood_on", "wood_off",
              "hat_beat", "hat_off", "hat_odd", "shaker")
    curves = {layer: layer_points(layer, sections, score, marks, duration) for layer in layers}
    events = {layer: [] for layer in layers}

    def place(layer, sig, t, gain=1, pan=0):
        # 零增益层不保留无效事件；跨自动化起点的自然释音仍参与渐入。
        knots, levels = zip(*curves[layer])
        if max(np.interp((t, t + len(sig) / SR), knots, levels)) > 0:
            events[layer].append((sig, t, gain, pan))

    for bar in range(math.ceil(duration / BAR)):
        t = bar * BAR
        section = ak.section_at(t, score)
        n, p = section["n"], PATTERNS[section["n"]]
        root, notes = chord_at(section, t)
        if n == 8:
            if bar == round(section["start"] / BAR):
                place("pad", warm_pad((53, 57, 60), duration - t + .6, p["cut"]), t)
        else:
            edges = [t, t + BAR]
            if n == 2 and t < marks["brighten"] < t + BAR:
                edges.insert(1, marks["brighten"])
            for left, right in zip(edges, edges[1:]):
                cut = 1400 if n == 2 and left >= marks["brighten"] else p["cut"]
                pad_notes = (root,) if n == 0 else tuple(m - 12 for m in notes[:3])
                place("pad", warm_pad(pad_notes, right - left + .35, cut), left)
        place("bass_open", low_note(root - 12, BAR + .3), t)

    woods = (ak.woodblock(920, .10, bright=.45), ak.woodblock(980, .10, bright=.45))
    for step in range(math.ceil(duration / STEP)):
        t, slot = step * STEP, step % 16
        root, notes = chord_at(ak.section_at(t, score), t)
        if slot % 2 == 0:
            pick = (0, 1, 2, 3, 2, 1, 0, 2)[slot // 2]
            place("marimba", mallet(notes[pick]), t, 1 if slot % 4 == 0 else .76,
                  (-.18, -.06, .10, .20)[pick])
        if slot % 4 == 0:
            pick = (0, 1, 2, 1)[slot // 4]
            place("bell", bell(notes[pick] + 24), t, 1, (-.16, 0, .16)[pick])
        if slot in (0, 8):
            place("bass", low_note(root - 12 + (7 if slot == 8 else 0), BEAT * 1.65),
                  t, 1 if slot == 0 else .82)
        if slot % 4 in (0, 2):
            place("wood_on" if slot % 4 == 0 else "wood_off", woods[(step // 4) % 2], t, 1, -.12)
        hat_layer = "hat_odd" if slot % 2 else ("hat_off" if slot % 4 else "hat_beat")
        place(hat_layer, ak.hat(rng=SEED + 10000 + step), t, 1, .16)
        place("shaker", ak.shaker(.075, bright=.72, rng=SEED + 20000 + step), t,
              1 if slot % 2 else .62, -.18)

    frames = math.ceil((duration + TAIL) * SR)
    harmonic = np.zeros((frames, 2), dtype=np.float32)
    rhythm = np.zeros_like(harmonic)
    # 只分配全片乐器缓冲，逐层汇入总线；没有章节长度缓冲或章界淡出。
    for layer in layers:
        buf = np.zeros_like(harmonic)
        for sig, t, gain, pan in events.pop(layer):
            ak.add(buf, sig, t, gain, pan)
        envelope(buf, curves[layer])
        if layer in ("pad", "marimba", "bell"):
            harmonic += buf
        else:
            rhythm += buf
        del buf
    for stamp in marks["notify_stamps"]:
        for k, note in enumerate(chord_at(sections[5], stamp)[1]):
            ak.add(harmonic, mallet(note + 12, .55), stamp + k * STEP, .14, -.12 + k * .08)
    ending = sections[8]
    for note, pan in zip((89, 93, 96), (-.18, 0, .18)):
        ak.add(harmonic, bell(note, ending["end"] - ending["start"] + .6), ending["start"],
               PATTERNS[8]["bell"] / 1.6, pan)

    a, b = marks["pause_start"], marks["pause_end"]
    # 开场半小节仅停干声；挂钟和低音不恢复，pad 在原卡点后恢复。
    envelope(harmonic, [(0, 0), (.15, 1), (a - .03, 1), (a, 0), (b, 0), (b + .03, 1)])
    envelope(rhythm, [(0, 0), (.15, 1), (a - .03, 1), (a, 0),
                      (score[2]["start"], 0), (score[2]["start"] + .03, 1)])
    diagnostics["pause_regular_dry_peak"] = max(float(np.max(np.abs(buf[round(a * SR):round(b * SR)])))
                                                  for buf in (harmonic, rhythm))
    a, b = marks["freeze_start"], marks["freeze_end"]
    for buf in (harmonic, rhythm):
        envelope(buf, [(0, 1), (a, 1), (a + .3, 0), (b, 0), (b + .4, 1)])
    diagnostics["freeze_regular_dry_peak"] = max(float(np.max(np.abs(buf[round((a + .3) * SR):round(b * SR)])))
                                                   for buf in (harmonic, rhythm))
    # 混响量也在发送端渐变；一次全片卷积让旧音尾巴保留原发送量。
    send = harmonic.copy()
    envelope(send, layer_points("reverb", sections, score, marks, duration))
    wet = ak.reverb(send, dur=REVERB_DUR, decay=.38, wet=1,
                    rng=SEED + 30001, predelay=PREDELAY)
    wet -= send
    del send
    wet += harmonic
    wet += rhythm
    del harmonic, rhythm
    hum = freeze_hum(b - a + .4, PATTERNS[3]["pad"])
    envelope(hum, [(0, 0), (.3, 1), (b - a, 1), (b - a + .4 - 1 / SR, 0)])
    ak.add(wet, hum, a, 1)
    diagnostics["pause_music_peak"] = float(np.max(np.abs(wet[round(marks["pause_start"] * SR):
                                                              round(marks["pause_end"] * SR)])))
    diagnostics["freeze_music_peak"] = float(np.max(np.abs(wet[round((a + .3) * SR):round(b * SR)])))
    return wet


@lru_cache(maxsize=len(CUE_KINDS))
def cue_voice(kind):
    """每种音效固定整数种子；fx[type](v) 在最后按力度线性缩放。"""
    if kind == "whoosh":
        x = ak.s_whoosh(.34, d=.5, rng=SEED + 101)
    elif kind == "tick":
        x = ak.s_tick(.26, rng=SEED + 102)
    elif kind == "blip":
        x = ak.s_blip(.40, f=1320)
    elif kind == "success":
        x = ak.s_confirm(.50)
    elif kind == "error":
        x = ak.s_error(.30)
    elif kind == "thunk":
        x = ak.lp(ak.kick()[:round(.15 * SR)], 180) * .26
        wood = ak.woodblock(220, .09, bright=.3)
        x[:len(wood)] += wood * .065
    elif kind == "ding":
        x = bell(93, 1.2) * .24 + bell(100, 1.2) * .035  # A6 + E7
    elif kind == "drop":
        x = np.zeros(round(.5 * SR))
        for k, offset in enumerate((0, .20, .34, .43)):
            hit = ak.hp(ak.s_tick(.27 * .72 ** k, rng=SEED + 110 + k), 1800)
            i = round(offset * SR)
            x[i:i + len(hit)] += hit
    elif kind == "latch":
        x = ak.woodblock(1600, .075, bright=.55) * .30
    elif kind == "stamp":
        x = ak.lp(ak.kick(), 180) * .24
        clap = ak.clap(rng=SEED + 120)
        x[:len(clap)] += clap * .05
    elif kind == "tear":
        t = ak.tvec(.25)
        rng = np.random.default_rng(SEED + 121)
        noise = ak.bp(rng.standard_normal(len(t)), 1000, 4000)
        grains = np.interp(t, np.linspace(0, .25, 45), rng.uniform(.12, 1, 45))
        x = ak.fade(noise * grains * .16, .008, .025)
    elif kind == "shred":
        t = ak.tvec(.8)
        motor = ak.lp(ak.sq(90, t, nh=24), 330, o=4) * .090
        noise = np.random.default_rng(SEED + 122).standard_normal(len(t))
        paper = ak.lp(ak.hp(noise, 2200), 6000) * .032
        x = ak.fade((motor + paper) * (.85 + .15 * np.sin(2 * np.pi * 27 * t)), .03, .03)
    elif kind == "type":
        x = np.zeros(round(.6 * SR))
        rng = np.random.default_rng(SEED + 123)
        offsets = np.r_[0, np.cumsum(rng.uniform(.065, .105, 5))]
        for k, offset in enumerate(offsets):
            hit = ak.s_tick(.18 * rng.uniform(.75, 1), rng=SEED + 130 + k)
            i = round(offset * SR)
            x[i:i + len(hit)] += hit
    else:
        raise ValueError(kind)
    return ak.fade(x, fade_in=.0005, fade_out=.012)


def effects():
    return {kind: (lambda v, kind=kind: cue_voice(kind) * v) for kind in CUE_KINDS}


def render(info):
    duration, sections, cues, marks = prepare(info)
    diagnostics = {}
    music = music_bus(duration, sections, marks, diagnostics)
    sfx = np.zeros_like(music)
    transitions = [dict(n=s["n"], t=s["start"]) for s in sections if 2 <= s["n"] <= 7]
    # 章节起点已有 whoosh cue 时让同一声兼任转场，防止两阵风声叠得过响。
    transition_samples = {round(tr["t"] * SR) for tr in transitions}
    placed_cues = [c for c in cues if not (c["type"] == "whoosh" and round(c["t"] * SR) in transition_samples)]
    ak.place_cues(sfx, placed_cues, effects())
    for tr in transitions:
        t = tr["t"]
        root = chord_at(sections[tr["n"]], t)[0] - 12
        matched = [c["v"] for c in cues if c["type"] == "whoosh" and round(c["t"] * SR) == round(t * SR)]
        ak.add(sfx, cue_voice("whoosh"), t, max(matched, default=1))
        ak.add(sfx, low_note(root, .48), t, .22)
        ak.add(sfx, ak.fade(ak.lp(ak.kick(), 170), .003, .03), t, .065)
        ak.add(sfx, bell(89), t, .10)
    landing = marks["title_landing"]
    root = chord_at(sections[1], landing)[0] - 12
    ak.add(sfx, low_note(root, .65), landing, .24)
    ak.add(sfx, ak.fade(ak.lp(ak.kick(), 170), .003, .03), landing, .06)
    triggers = [c["t"] for c in cues if c["v"] > 0] + [tr["t"] for tr in transitions] + [landing]
    # times 覆盖轻 cue，key 覆盖连续打字/风声的持续部分；嗡声也随音效轻避让。
    music = ak.duck(music, key=sfx, times=triggers, depth_db=DUCK_DB,
                    threshold=.012, attack=.02, hold=.06, release=.22)
    music += sfx
    del sfx
    end = round(duration * SR)
    fade_frames = min(end, round(.8 * SR))
    music[end - fade_frames:end] *= np.linspace(1, 0, fade_frames)[:, None]
    mix = ak.normalize(music[:end])
    report = dict(sample_rate=SR, channels=2, bpm=BPM, meter="4/4", key="F major", seed=SEED,
                  timeline_seconds=duration, tail_reserve_seconds=TAIL, target_rms_dbfs=ak.DEFAULT_RMS_DB,
                  architecture="global instrument buses / one reverb send / dry-only rests",
                  layer_transition_seconds=BAR,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  marks=marks, transitions=transitions, diagnostics=diagnostics,
                  sections=[dict(n=s["n"], label=PATTERNS[s["n"]]["label"], start=s["start"], end=s["end"],
                                 progression=PATTERNS[s["n"]]["prog"],
                                 music_start=round(s["start"] / BAR) * BAR,
                                 quantization_seconds=round(s["start"] / BAR) * BAR - s["start"])
                            for s in sections])
    return mix, report


def pcm_stats(pcm, start=0, end=None):
    end = len(pcm) if end is None else min(len(pcm), end)
    energy, peak = 0., 0.
    for a in range(start, end, SR * 4):
        block = pcm[a:min(end, a + SR * 4)].astype(np.float64) / 32768
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
    if args.timeline.resolve() == args.output.resolve():
        parser.error("输出 WAV 不能覆盖时间线")
    mix, report = render(ak.read_timeline(args.timeline))
    ak.write_wav(args.output, mix)
    del mix
    sr, pcm = wavfile.read(args.output, mmap=True)
    video_end = round(report["timeline_seconds"] * sr)
    report.update(pcm=pcm_stats(pcm), frames=len(pcm), duration_seconds=len(pcm) / sr,
                  video_span_pcm=pcm_stats(pcm, end=video_end),
                  last_video_second_pcm=pcm_stats(pcm, max(0, video_end - sr), video_end),
                  last_video_frame=pcm[video_end - 1].tolist(), last_file_frame=pcm[-1].tolist())
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
