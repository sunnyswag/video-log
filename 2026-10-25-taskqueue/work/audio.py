"""车间律动：100 BPM / 4/4，D 小调 → F 大调，48 kHz PCM16 立体声。

用法：python3 audio.py /absolute/timeline.json /absolute/output.wav
只读完整时间线；只写指定 WAV，测量与耗时打印到 stdout。
章节在下一个全局小节切换，短片名取最近小节以容纳 F–C。
片名重音、s22 屏息、片尾落点按画面卡点。
所有普通和弦保持两小节，章节结束可截短；片尾承接结尾的 F 和弦。
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

# 不在只读的 film-kit / 工作目录里产生 __pycache__。
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/film-kit"))
import numpy as np
from scipy.io import wavfile
import audio_kit as ak

SR = ak.SR
BPM = 100.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
TAIL = 1.5
SEED = 20261025
MUSIC_DB = -30.0
SFX_DB = -24.0
DUCK_DB = 2.0

# 根音 / 暖垫声部 / 马林巴音阶片段；A 大三和弦保留 D 小调属和弦的 C#。
CHORDS = {
    "Dm9": (38, (50, 57, 64, 65), (62, 65, 69, 72)),
    "Dm": (38, (50, 57, 62, 65), (62, 65, 69, 72)),
    "Bb": (34, (53, 58, 62, 65), (58, 62, 65, 70)),
    "F": (41, (53, 60, 65, 69), (60, 65, 69, 72)),
    "C": (36, (52, 55, 60, 64), (60, 64, 67, 72)),
    "Gm": (31, (50, 55, 58, 62), (62, 67, 70, 74)),
    "A": (33, (52, 57, 61, 64), (61, 64, 69, 73)),
}
PROGRESSIONS = {
    0: ("Dm9",), 1: ("F", "C"), 2: ("Dm", "Bb", "F", "C"),
    3: ("Dm", "Gm", "Bb", "A"), 4: ("Dm", "Bb", "Gm", "A"),
    5: ("Gm", "A", "Dm", "Bb"), 6: ("F", "C", "Dm", "Bb"),
    7: ("F", "C", "Dm", "Bb"), 8: ("Bb", "C", "F"), 9: ("F",),
}
PATTERNS = {
    str(n): {"prog": tuple(c for chord in prog for c in (chord, chord))}
    for n, prog in PROGRESSIONS.items()
}
CUE_TYPES = (
    "whoosh", "swoosh", "shutter", "clank", "stamp", "thud", "latch",
    "click", "tick", "type", "blip", "pop", "slide", "error", "confirm",
    "weld", "send", "bell", "down", "chop", "hum", "print", "scan",
    "alarm", "spray", "punch", "swell", "belt",
)


def amplitude(db):
    return 10.0 ** (db / 20.0)


def finite(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label} 必须为有限数值")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{label} 必须为有限数值")
    return value


def grid_after(t):
    return math.ceil(t / BAR - 1e-9) * BAR


def prepare(info):
    duration = finite(info["duration"], "duration")
    if duration <= 0:
        raise ValueError("duration 必须大于零")
    # 先校验所有类型，未知 cue 在合成/写文件前失败。
    cues = []
    for cue in info.get("cues", []):
        kind = cue["type"]
        if kind not in CUE_TYPES:
            raise ValueError(f"未映射的 cue.type: {kind!r}")
        t = finite(cue["t"], "cue.t")
        v = finite(cue.get("v", 1), "cue.v")
        pan = finite(cue.get("pan", 0), "cue.pan")
        if not 0 <= t <= duration or v < 0 or not -1 <= pan <= 1:
            raise ValueError("cue.t / v / pan 越界；v 是非负增益倍数，可大于 1")
        cues.append(dict(t=t, type=kind, v=v, pan=pan))
    cues.sort(key=lambda c: (c["t"], c["type"], c["v"], c["pan"]))

    chapters = ak.timeline_sections(info, "chapters")
    sections, seen = [], set()
    for row in chapters:
        n = finite(row.get("n", 0), "chapter.n")
        if n != int(n) or int(n) not in PROGRESSIONS or n in seen:
            raise ValueError("chapter.n 须为不重复的 0..9")
        n = int(n)
        seen.add(n)
        row["n"], row["name"] = n, str(n)
        start = round(row["start"] / BAR) * BAR if n == 1 else grid_after(row["start"])
        section = dict(row, start=start, actual_start=row["start"])
        # 极短章节落在同一小节线时，采用该线之前最后出现的章节。
        if sections and abs(sections[-1]["start"] - start) < 1e-8:
            sections[-1] = section
        else:
            sections.append(section)
    for i, row in enumerate(sections):
        row["end"] = sections[i + 1]["start"] if i + 1 < len(sections) else duration

    scenes = {}
    for scene in info.get("scenes", []):
        start = finite(scene["start"], "scene.start")
        length = finite(scene["d"], "scene.d")
        if start < 0 or length <= 0 or start + length > duration + 1e-6:
            raise ValueError("场景区间越界或为空")
        if scene["id"] in scenes:
            raise ValueError("scene.id 重复")
        scenes[scene["id"]] = (start, min(duration, start + length))
    breath = None
    if "s22" in scenes:
        start, end = scenes["s22"]
        bells = [c["t"] for c in cues if c["type"] == "bell" and start <= c["t"] < end]
        breath = (start, min(bells) if bells else end)
    return duration, chapters, sections, scenes, cues, breath


def combine(parts, duration=None):
    """合成短单声道音效；parts 为 (秒偏移, 波形, 增益)。"""
    size = round(duration * SR) if duration is not None else max(
        round(t * SR) + len(x) for t, x, _ in parts
    )
    out = np.zeros(size)
    for t, x, gain in parts:
        start = round(t * SR)
        count = min(len(x), size - start)
        if count > 0:
            out[start:start + count] += x[:count] * gain
    return out


@lru_cache(maxsize=28)
def cue_voice(kind):
    """固定种子、固定名义响度；v 在调用方线性相乘，不逐事件重新归一。"""
    if kind not in CUE_TYPES:
        raise ValueError(f"未映射的 cue.type: {kind!r}")
    seed = SEED + 1000 + CUE_TYPES.index(kind)
    rng = np.random.default_rng(seed)
    quiet = 1.0
    if kind == "whoosh":
        x = ak.s_whoosh(d=.55, rng=seed)
    elif kind == "swoosh":
        x = ak.hp(ak.s_whoosh(d=.23, rng=seed), 950)
    elif kind == "shutter":
        t = ak.tvec(.68)
        noise = ak.lp(rng.standard_normal(len(t)), 850)
        noise *= ak.adsr(.68, .008, .13, .25, .3)
        x = combine([(0, ak.kick(), .65), (0, noise, .8),
                     (.025, ak.woodblock(180, .18, .4), .5)], .95)
        x = ak.reverb(x, dur=.22, decay=.065, wet=.16, rng=seed)
    elif kind == "clank":
        x = combine([(0, ak.woodblock(180, .2, .7), 1),
                     (0, ak.lp(ak.hat(rng=seed), 5500), .6)])
    elif kind == "stamp":
        dry_clap = ak.fade(ak.clap(rng=seed)[:round(.065 * SR)], 0, .012)
        x = combine([(0, ak.woodblock(720, .10, .5), 1), (0, dry_clap, .55)])
    elif kind == "thud":
        x = ak.fade(ak.lp(ak.kick()[:round(.19 * SR)], 350), .004, .04)
    elif kind in ("latch", "click", "tick", "type"):
        x = ak.s_tick(rng=seed)
        quiet = .50 if kind == "type" else 1.0
    elif kind in ("blip", "pop"):
        x = ak.s_blip(f=1100 if kind == "blip" else 1900)
    elif kind == "slide":
        x = ak.lp(ak.s_whoosh(d=.24, rng=seed), 850)
    elif kind == "error":
        x = ak.lp(ak.s_error(), 850)
        quiet = .8
    elif kind == "confirm":
        x = ak.s_confirm()
    elif kind == "weld":
        t = ak.tvec(.8)
        noise = ak.lp(ak.hp(rng.standard_normal(len(t)), 1400), 6500)
        x = noise * (.68 + .32 * np.sin(2 * np.pi * 29 * t))
        x *= ak.adsr(.8, .025, .04, .8, .10)
        quiet = .8
    elif kind == "send":
        x = combine([(0, ak.s_whoosh(d=.16, rng=seed), .7),
                     (.12, ak.s_blip(f=1100), 1)])
    elif kind == "bell":
        x = combine([(0, ak.marimba(ak.mtof(86), .85, .55), 1),
                     (.035, ak.marimba(ak.mtof(93), .7, .4), .55)], 1.35)
        x = ak.delay(x, .15, fb=.32, wet=.32, taps=3)
    elif kind == "down":
        x = combine([(0, ak.s_blip(f=ak.mtof(74)), 1),
                     (.11, ak.s_blip(f=ak.mtof(69)), .85)])
    elif kind == "chop":
        noise = ak.hp(rng.standard_normal(round(.025 * SR)), 2500)
        x = combine([(0, ak.woodblock(1450, .09, .65), 1),
                     (0, ak.fade(noise, .001, .023), .12)])
    elif kind == "hum":
        t = ak.tvec(.6)
        x = np.sin(2 * np.pi * ak.mtof(38) * t) * ak.adsr(.6, .05, .08, .8, .12)
        quiet = .8
    elif kind == "print":
        x = combine([(i * .055, ak.s_tick(rng=seed + i), 1 - .12 * i) for i in range(4)])
    elif kind == "scan":
        t = ak.tvec(.22)
        phase = 2 * np.pi * (550 * t + (1700 - 550) * t * t / (.22 * 2))
        x = (np.sin(phase) + .16 * np.sin(3 * phase)) * ak.adsr(.22, .008, .03, .7, .06)
    elif kind == "alarm":
        x = combine([(0, ak.chip_square(ak.mtof(74), .25, .2), 1),
                     (.25, ak.chip_square(ak.mtof(77), .25, .2), .85)], .5)
        x = ak.lp(x, 1800)
        quiet = .75
    elif kind == "spray":
        x = ak.bp(rng.standard_normal(round(.3 * SR)), 1500, 2700)
        x *= ak.adsr(.3, .025, .03, .8, .07)
        quiet = .85
    elif kind == "punch":
        x = combine([(0, ak.woodblock(500, .11, .45), 1),
                     (0, ak.s_tick(rng=seed), .45)])
    elif kind == "swell":
        x = ak.pad_chord(CHORDS["Dm9"][1], 2.4, cut=1200)[:round(1.5 * SR)]
        x *= np.linspace(0, 1, len(x)) ** 1.4
        x = ak.fade(x, 0, .06)
        quiet = .85
    elif kind == "belt":
        x = combine([(i * .075, ak.shaker(.1, .7, seed + i), .8 if i % 2 else 1)
                     for i in range(8)], .6)
        x = ak.fade(x, .012, .035)
        quiet = .8
    # 去掉微小尾巴/预留静音对名义音效 RMS 的影响，保留包络和音色差异。
    x = ak.fade(x, .001, min(.015, len(x) / SR / 4))
    active = np.abs(x) > np.max(np.abs(x)) * .015
    return ak.normalize(x, target_rms_db=SFX_DB, peak_db=-8, mask=active) * quiet


def cue_at_gain(kind, v):
    return cue_voice(kind) * v


@lru_cache(maxsize=160)
def note_voice(voice, note, duration):
    f = ak.mtof(note)
    if voice == "marimba":
        return ak.marimba(f, duration, bright=.58)
    if voice == "bass":
        return ak.fade(ak.bass(f, duration), .006, .025)
    if voice == "electric_piano":
        return ak.electric_piano(f, duration, bell=.22)
    if voice == "fm_piano":
        return ak.fm_piano(f, duration, velocity=.64)
    raise ValueError(voice)


def mute_window(buf, start, end):
    """屏息区精确静音，边缘 12 ms 淡变；同时收掉之前的混响尾音。"""
    if end <= start:
        return
    a, b = round(start * SR), round(end * SR)
    ramp = round(.012 * SR)
    lo, hi = max(0, a - ramp), min(len(buf), b + ramp)
    buf[lo:a] *= np.linspace(1, 0, a - lo)[:, None]
    buf[a:b] = 0
    buf[b:hi] *= np.linspace(0, 1, hi - b)[:, None]


def room_in_place(buf):
    """同一固定 IR 分块卷积；倒序处理，湿声不会被当作后续块的干声。"""
    block = SR * 8
    tail = round(1.22 * SR)
    for start in reversed(range(0, len(buf), block)):
        end = min(len(buf), start + block)
        dry = np.zeros((min(end + tail, len(buf)) - start, 2))
        dry[:end - start] = buf[start:end]
        wet = ak.reverb(dry, dur=1.2, decay=.32, wet=.14, rng=SEED + 9000) - dry
        buf[start:start + len(wet)] += wet


def music_bus(duration, chapters, sections, scenes, breath):
    count = round((duration + TAIL) * SR)
    # 屏息时 pad/woodblock 保留，其他乐器（含混响）全部收掉。
    steady = np.zeros((count, 2), dtype=np.float32)
    moving = np.zeros_like(steady)
    starts = {row["n"]: row["start"] for row in chapters}
    title = next((row for row in chapters if row["n"] == 1), None)
    title_hit = min(title["start"] + .5, title["end"]) if title else None
    endcard = starts.get(9, duration)
    opened = scenes.get("s10", (math.inf, math.inf))[0]
    half_ranges = [scenes[s] for s in ("s20", "s21") if s in scenes]
    kick = ak.fade(ak.lp(ak.kick(), 650), .003, .05)
    clap = ak.lp(ak.clap(rng=SEED + 1), 4200)
    hat = ak.lp(ak.hat(rng=SEED + 2), 9500)
    shaker = ak.shaker(.075, bright=.7, rng=SEED + 3)
    wood = ak.woodblock(760, .095, .45)
    bars = list(ak.schedule_bars(sections, PATTERNS, duration, bpm=BPM, beats=4))

    def put(buf, sig, t, gain, pan=0, until=endcard):
        if t >= until - 1e-8 or gain <= 0:
            return
        room = round(until * SR) - round(t * SR)
        if len(sig) > room:
            sig = ak.fade(sig[:room], 0, min(.025, room / SR))
        ak.add(buf, sig, t, gain, pan)

    # 连续同和弦合成一个 pad，避免每小节重启包络；换和弦只留短交叠。
    groups = []
    for bar in bars:
        n, start = int(bar["section"]), bar["t"]
        if n == 9 or start >= endcard:
            continue
        end = min(start + BAR, endcard)
        if n == 0 and title_hit is not None:
            end = min(end, title_hit)
        if end <= start:
            continue
        key = (n, bar["chord"])
        if groups and groups[-1][0] == key and abs(groups[-1][2] - start) < 1e-8:
            groups[-1] = (key, groups[-1][1], end)
        else:
            groups.append((key, start, end))
    for (n, chord), start, end in groups:
        overlap = min(.35, max(0, endcard - end))
        if n == 0:
            overlap = 0
        pad = ak.pad_chord(CHORDS[chord][1], end - start + overlap, cut=1250)
        if n == 0:
            absolute = start + np.arange(len(pad)) / SR
            rise_end = min(title_hit, end) if title_hit is not None else end
            pad *= .55 + .7 * np.clip((absolute - (rise_end - 2 * BAR)) / (2 * BAR), 0, 1)
        ak.add(steady, pad, start, .19 if n == 7 else .14, -.07)

    for bar in bars:
        n, chord, start = int(bar["section"]), bar["chord"], bar["t"]
        if n == 9 or start >= endcard:
            continue
        root, notes, arp = CHORDS[chord]
        local_bar = round((start - bar["start"]) / BAR)
        if n == 7 and local_bar % 2 == 0:
            for i, note in enumerate(notes):
                put(moving, note_voice("electric_piano", note, 3.6), start,
                    .22 / math.sqrt(len(notes)), (i - 1.5) * .12)
        for slot in range(16):
            t = start + slot * BEAT / 4
            if t >= endcard or (n == 0 and title_hit is not None and t >= title_hit):
                continue
            if n == 1 and title_hit is not None and t < title_hit:
                continue
            half = any(a <= t < b for a, b in half_ranges)
            held = breath is not None and breath[0] <= t < breath[1]
            offbeat = slot % 4 == 2
            # 木块是开场时钟、第二章反拍和屏息时唯一保留的节拍。
            wood_hit = ((n == 0 and slot % 4 == 0) or
                        (n in (3, 4, 5, 8) and offbeat) or
                        (n == 6 and slot in (0, 6, 8, 14)))
            if wood_hit:
                put(steady, wood, t, .23 if n == 0 else .18, -.23)
            if n == 0:
                if slot == 0:
                    put(moving, note_voice("bass", root, .75), t, .16, until=title_hit or endcard)
                continue
            if held:
                continue

            if n in (1, 2, 3, 8):
                mallet_hit = slot % 2 == 0
            elif n == 4:
                mallet_hit = True
            elif n == 5:
                mallet_hit = slot in ((0, 6, 10, 14) if half else (0, 3, 6, 8, 11, 14))
            elif n == 6:
                mallet_hit = slot in (0, 2, 6, 8, 10, 14)
            else:  # 总结：四分音符旋律，留出第四拍。
                mallet_hit = slot in (0, 4, 8)
            if mallet_hit:
                index = slot if n == 4 else slot // 2
                step = (0, 1, 2, 3, 2, 1, 0, 1)[index % 8]
                if n == 7:
                    step = (1, 2, 3)[slot // 4]
                note = arp[step]
                length = .16 if n in (4, 6) else (.38 if n == 7 else .28)
                gain = {1: .22, 2: .18, 3: .17, 4: .125, 5: .18,
                        6: .19, 7: .12, 8: .14}[n]
                put(moving, note_voice("marimba", note, length), t,
                    gain * (1 if slot % 4 == 0 else .77), .16 if index % 2 else -.13)

            if n in (3, 4, 5) and not half:
                bass_hit, bass_length = slot % 2 == 0, .24
            else:
                bass_hit, bass_length = slot == 0, .85
            if bass_hit and n != 7:
                put(moving, note_voice("bass", root, bass_length), t,
                    .20 if slot % 4 == 0 else .145)
            kick_slots = (0,) if n in (2, 6) or half else (0, 8)
            if n in (2, 3, 4, 5, 6, 8) and slot in kick_slots:
                put(moving, kick, t, .14 if n in (6, 8) else .20)
            # 拍手仅用于最忙的章节和轻柔回归的结尾。
            if n in (4, 5, 8) and not half and slot in (4, 12):
                put(moving, clap, t, .15 if n == 8 else .22, .08)
            opened_hat = (n == 3 and t >= opened) or n in (4, 5, 8)
            if opened_hat and not half and slot % 2 == 0:
                put(moving, hat, t, .17 if n == 8 else .24, .20)
            if n in (2, 3, 4, 5, 8):
                put(moving, shaker, t, .11 if slot % 2 else .075, .27)

    if title_hit is not None and title_hit < endcard:
        put(moving, kick, title_hit, .42)
        put(moving, clap, title_hit, .38)
        for i, note in enumerate(CHORDS["F"][1]):
            put(moving, note_voice("fm_piano", note, 2.2), title_hit, .19, (i - 1.5) * .10)
        # 精确片名重音后的弱起琶音仍落在原来的八分网格上。
        title_grid = next(s["start"] for s in sections if s["n"] == 1)
        for step in range(math.ceil((title_hit + .001) / (BEAT / 2)),
                          math.ceil(title_grid / (BEAT / 2) - 1e-9)):
            put(moving, note_voice("marimba", (65, 69, 72, 77)[step % 4], .28),
                step * BEAT / 2, .19, .1)
    if 9 in starts:
        length = duration + TAIL - endcard
        ak.add(steady, ak.pad_chord(CHORDS["F"][1], length, cut=1150), endcard, .23)
        for i, note in enumerate(CHORDS["F"][1]):
            ak.add(moving, note_voice("fm_piano", note, length), endcard, .15, (i - 1.5) * .12)

    room_in_place(steady)
    room_in_place(moving)
    if breath is not None:
        mute_window(moving, *breath)
    steady += moving
    del moving
    # 片尾淡出跨越预留的 1.5 s 尾音，不在 duration 处硬切。
    fade_length = min(len(steady), round((duration + TAIL - endcard) * SR))
    steady[-fade_length:] *= np.linspace(1, 0, fade_length, dtype=np.float32)[:, None]
    steady[:round(.025 * SR)] *= np.linspace(0, 1, round(.025 * SR))[:, None]
    return ak.normalize(steady, target_rms_db=MUSIC_DB, peak_db=None)


def render(info):
    duration, chapters, sections, scenes, cues, breath = prepare(info)
    music = music_bus(duration, chapters, sections, scenes, breath)
    sfx = np.zeros(music.shape, dtype=np.float32)
    fx = {kind: partial(cue_at_gain, kind) for kind in CUE_TYPES}
    ak.place_cues(sfx, cues, fx, strict=True)
    mix = ak.duck(music, key=sfx, depth_db=DUCK_DB, threshold=.012,
                  attack=.018, hold=.06, release=.20)
    del music
    mix += sfx
    del sfx
    # 只对文件末尾收尾；画面结束后仍有混响/提示音的自然衰减。
    tail_fade = min(round(.4 * SR), len(mix))
    mix[-tail_fade:] *= np.linspace(1, 0, tail_fade)[:, None]
    mix = ak.normalize(mix)
    report = dict(bpm=BPM, seed=SEED, sample_rate=SR, channels=2,
                  duration_seconds=len(mix) / SR, tail_seconds=TAIL,
                  music_bed_rms_dbfs=MUSIC_DB, nominal_sfx_rms_dbfs=SFX_DB,
                  duck_depth_db=DUCK_DB,
                  cue_counts=dict(sorted(Counter(c["type"] for c in cues).items())),
                  supported_cue_types=list(CUE_TYPES), breath_window=breath,
                  chapter_grid=[dict(n=s["n"], actual=s["actual_start"], grid=round(s["start"], 6))
                                for s in sections])
    return mix, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.resolve() in (args.timeline.resolve(), Path(__file__).resolve()):
        parser.error("输出不能覆盖时间线或 audio.py")
    started = time.perf_counter()
    mix, report = render(ak.read_timeline(args.timeline))
    ak.write_wav(args.output, mix)
    report["synthesis_seconds"] = round(time.perf_counter() - started, 3)
    del mix
    sr, pcm = wavfile.read(args.output)
    samples = pcm.astype(np.float64) / 32768.0
    report["rms_dbfs"] = ak.rms_db(samples)
    report["peak_dbfs"] = ak.peak_db(samples)
    report["frames"] = len(pcm)
    report["duration_seconds"] = len(pcm) / sr
    report["last_frame"] = pcm[-1].tolist()
    digest = hashlib.sha256()
    with args.output.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    report["sha256"] = digest.hexdigest()
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
