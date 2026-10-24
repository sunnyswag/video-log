"""离线配乐积木：48 kHz、浮点单声道 (N,) / 立体声 (N, 2)，时间均为秒。

导入不读文件、不解析命令行、不渲染音频、不创建全局随机流。
噪声音色的 rng 接受整数种子或调用方的 np.random.Generator；默认 0 可复现，
传 Generator 会消费它的状态。add / place_cues 原地叠加，其余 DSP 返回新数组。
各期只负责和弦、层级、节奏与卡点；不在这里绑定任何一期的场景或 cue 类型。
"""
import json
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
MUSIC_RMS_DB = -23.0                         # 参考片音乐的非零帧 RMS
SFX_RMS_DB = -24.0                           # 参考片音效有效帧 RMS
DEFAULT_RMS_DB = -24.3832                    # v2 成品整片 RMS，HASHSEED=0，PCM16 / 32768
DEFAULT_PEAK_DB = float(20 * np.log10(.89))  # 参考片 .89 峰值上限，约 -1.0122 dBFS


def tvec(d):
    """d：时长秒；按 round(d * SR) 取样，允许零时长。"""
    if not np.isfinite(d) or d < 0: raise ValueError('时长必须有限且非负')
    return np.arange(int(round(d * SR))) / SR


def mtof(m):
    """m：MIDI 音高（可为小数）；返回 Hz，中央 A = 69。"""
    return 440.0 * 2 ** ((np.asarray(m) - 69) / 12)


def _audio(x):
    x = np.asarray(x, dtype=float)
    if x.ndim not in (1, 2) or (x.ndim == 2 and x.shape[1] != 2):
        raise ValueError('音频须为 (N,) 或 (N, 2)')
    return x


def add(buf, sig, t, gain=1.0, pan=0.0):
    """原地叠加到立体声 buf；t 秒、gain 线性增益、pan ∈ [-1,1]；负起点/尾音裁切。
    单声道使用参考版的等功率声像 × 1.414；立体声保留原声像（pan 不作用）。
    """
    if buf.ndim != 2 or buf.shape[1] != 2 or not np.issubdtype(buf.dtype, np.floating):
        raise ValueError('buf 须为浮点立体声数组')
    if not -1 <= pan <= 1: raise ValueError('pan 必须在 [-1,1]')
    sig = _audio(sig); i = int(round(t * SR))
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l, sig * r], 1) * 1.414
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), len(buf) - i)
    if n > 0: buf[i:i + n] += sig[:n] * gain


def _filter(x, cutoff, kind, order):
    sos = butter(order, np.asarray(cutoff) / (SR / 2), kind, output='sos')
    x = _audio(x)
    return sosfilt(sos, x, axis=0) if len(x) else x.copy()


def lp(x, fc, o=2):
    """低通；fc：截止 Hz（最高 .45 * SR），o：阶数。"""
    return _filter(x, min(fc, SR * .45), 'low', o)


def hp(x, fc, o=2):
    """高通；fc：截止 Hz，o：阶数。"""
    return _filter(x, fc, 'high', o)


def bp(x, a, b, o=2):
    """带通；a/b：低/高截止 Hz，o：阶数。"""
    return _filter(x, [a, min(b, SR * .45)], 'band', o)


def adsr(dur, attack=.01, decay=.1, sustain=.7, release=.15):
    """总长 dur；attack/decay/release 秒、sustain 线性电平；过短音符等比缩短三段。
    release 包含在 dur 内；首末样本为零，零时长返回空数组。
    """
    t = tvec(dur)
    if not all(np.isfinite(v) and v >= 0 for v in (attack, decay, release)) or not 0 <= sustain <= 1:
        raise ValueError('ADSR 时间须非负，sustain 须在 [0,1]')
    if not len(t): return t
    span = t[-1]
    scale = min(1, span / max(attack + decay + release, 1e-12))
    a, d, r = attack * scale, decay * scale, release * scale
    e = np.full(len(t), sustain)
    if a > 0: e[t < a] = t[t < a] / a
    if d > 0:
        mask = (t >= a) & (t < a + d)
        e[mask] = 1 - (1 - sustain) * (t[mask] - a) / d
    if r > 0:
        mask = t >= span - r
        e[mask] = sustain * np.maximum(0, (span - t[mask]) / r)
    e[0] = e[-1] = 0
    return e


def fade(x, fade_in=0, fade_out=0):
    """首尾线性淡变；fade_in/fade_out 秒，重叠时相乘，不改变长度。"""
    x = _audio(x)
    if min(fade_in, fade_out) < 0: raise ValueError('淡变时长须非负')
    e = np.ones(len(x))
    for seconds, end in ((fade_in, False), (fade_out, True)):
        n = min(len(x), int(round(seconds * SR)))
        if n:
            if end: e[-n:] *= np.linspace(1, 0, n)
            else: e[:n] *= np.linspace(0, 1, n)
    return x * (e[:, None] if x.ndim == 2 else e)


def read_timeline(path):
    """读取 {duration, scenes, captions, cues, chapters}；缺失的列表补空，不改原文件。"""
    with open(path, encoding='utf-8') as f: info = json.load(f)
    d = float(info['duration'])
    if not np.isfinite(d) or d < 0: raise ValueError('duration 必须有限且非负')
    info['duration'] = d
    for key in ('scenes', 'captions', 'cues', 'chapters'):
        info.setdefault(key, [])
        if not isinstance(info[key], list): raise ValueError(f'{key} 须为列表')
    return info


def write_wav(path, x):
    """写 48 kHz PCM16（与参考版相同的 ×32767 截断）；越界/NaN 报错，先做限幅。
    输入 (N,2) 写立体声，(N,) 写单声道；不自动创建目录、不自动归一。
    """
    x = _audio(x)
    if not np.isfinite(x).all() or (x.size and np.max(np.abs(x)) > 1):
        raise ValueError('写 WAV 前须保证样本有限且在 [-1,1]，请先 normalize / limit_bus')
    wavfile.write(path, SR, (x * 32767).astype(np.int16))


# ---------------------------------------------------------------- 参考片音色
def pad_voice(f, dur, cut=1600):
    """暖垫单音；f：Hz，dur：秒，cut：控制谐波数量的截止 Hz，无包络。"""
    t = tvec(dur); x = np.zeros_like(t)
    for det in (-.06, .06):
        ff = f * 2 ** (det / 12)
        ph = (hash((round(float(f), 2), det)) % 1000) / 1000 * 2 * np.pi
        for h in range(1, 14):
            if ff * h > cut * 1.6: break
            x += np.sin(2 * np.pi * ff * h * t + ph * h) / h ** 1.6
    return x


def pad_chord(notes, dur, cut=1600, amp=1.0):
    """暖垫和弦；notes：非空 MIDI 列表，dur：秒，cut：低通 Hz，amp：线性音量。"""
    notes = tuple(notes)
    if not notes: raise ValueError('和弦至少需要一个音')
    x = sum(pad_voice(mtof(m), dur, cut) for m in notes) / len(notes)
    x = lp(x, cut); e = np.ones(len(x))
    a, r = min(int(.5 * SR), len(x)), min(int(.9 * SR), len(x))
    if a: e[:a] = np.linspace(0, 1, a) ** 1.5
    if r: e[-r:] *= np.linspace(1, 0, r) ** 1.5
    return x * e * amp


def pluck(f, dur=.9, bright=1.0):
    """柔和 FM 拨弦；f：Hz，dur：秒，bright：亮度（通常 .5–1.5）。"""
    t = tvec(dur); idx = 1.6 * bright * np.exp(-t * 9)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * 2 * f * t))
    x += .25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6)
    return x * np.minimum(1, t / .004) * np.exp(-t * 4.2) * .5


def bass(f, dur):
    """正弦低音；f：Hz，dur：含 70 ms 收尾的总秒数。"""
    t = tvec(dur)
    x = np.sin(2 * np.pi * f * t) + .28 * np.sin(4 * np.pi * f * t) + .08 * np.sin(6 * np.pi * f * t)
    e = np.minimum(1, t / .008) * (.75 + .25 * np.exp(-t * 6))
    nr = min(int(.07 * SR), len(t))
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return lp(x * e, 600) * .55


def kick():
    """参考版底鼓，无参数；固定 .45 秒，音量在 add 的 gain 调整。"""
    t = tvec(.45); f = 44 + 90 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5) * .9


def hat(open_=False, rng=0):
    """踩镲；open_：开镲/闭镲，rng：种子或调用方随机流。"""
    t = tvec(.18 if open_ else .05)
    return hp(np.random.default_rng(rng).standard_normal(len(t)), 7500) * np.exp(-t * (18 if open_ else 70)) * .12


def clap(rng=0):
    """拍手；rng：种子或调用方随机流，固定 .25 秒。"""
    t = tvec(.25); n = bp(np.random.default_rng(rng).standard_normal(len(t)), 1000, 5000)
    e = np.exp(-t * 20)
    for k in (0, .012, .024):
        i = int(k * SR); e[i:i + 40] += .5
    return n * e * .16


# ---------------------------------------------------------------- 明快 MG / 像素终端 / 安静叙事
def marimba(f, dur=.8, bright=1.0):
    """马林巴；f：Hz，dur：秒，bright：敲击亮度；非整数泛音带来木质感。"""
    t = tvec(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 5)
    for ratio, gain, decay in ((3.99, .28, 18), (10.01, .08, 32)):
        if f * ratio < SR * .45:
            x += bright * gain * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * decay)
    return fade(x * np.minimum(1, t / .002) * .65, fade_out=.03)


def woodblock(f=950, dur=.12, bright=1.0):
    """轻木块；f：主体 Hz，dur：秒，bright：高频敲击量，适合轻打击。"""
    t = tvec(dur)
    x = np.sin(2 * np.pi * f * t) + .35 * bright * np.sin(2 * np.pi * f * 1.47 * t)
    return fade(x * np.minimum(1, t / .001) * np.exp(-t * 45) * .35, fade_out=.01)


def shaker(dur=.09, bright=1.0, rng=0):
    """轻沙锤；dur：秒，bright：高通亮度倍率，rng：种子或随机流。"""
    t = tvec(dur); n = np.random.default_rng(rng).standard_normal(len(t))
    n = hp(n, np.clip(4500 * bright, 100, SR * .4))
    return fade(n * np.minimum(1, t / .006) * np.exp(-t * 38) * .09, fade_out=.015)


def sq(f, t, nh=16):
    """带限方波振荡器；f：Hz，t：秒数组，nh：谐波上界（不含），兼容 HUD。"""
    x = np.zeros_like(t)
    for h in range(1, nh, 2):
        if f * h > 15000: break
        x += np.sin(2 * np.pi * f * h * t) / h
    return x * .8


def chip_square(f, dur=.3, bright=1.0):
    """芯片方波音；f：Hz，dur：秒，bright：谐波量；带限防高频混叠。"""
    t = tvec(dur); x = sq(f, t, max(2, int(32 * bright)))
    return x * adsr(dur, .002, .04, .65, .025) * .5


def chip_triangle(f, dur=.4):
    """芯片三角波音；f：Hz，dur：秒，适合作像素风低音/柔和副旋律。"""
    t = tvec(dur); x = np.zeros_like(t)
    for h in range(1, 64, 2):
        if f * h > 15000: break
        x += (-1) ** ((h - 1) // 2) * np.sin(2 * np.pi * f * h * t) / h ** 2
    return x * (8 / np.pi ** 2) * adsr(dur, .003, .04, .8, .03) * .6


def fm_piano(f, dur=1.8, velocity=.75):
    """柔和 FM 钢琴；f：Hz，dur：秒，velocity：力度 0–1，同时控制音量与敲击亮度。"""
    if not 0 <= velocity <= 1: raise ValueError('velocity 须在 [0,1]')
    t = tvec(dur); idx = 1.8 * velocity * np.exp(-t * 8)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * 2.001 * f * t))
    x += .16 * np.sin(2 * np.pi * f * 1.001 * t) * np.exp(-t * 2)
    return fade(x * np.minimum(1, t / .003) * np.exp(-t * 2.3) * velocity * .55, fade_out=.08)


def electric_piano(f, dur=2.2, bell=.5):
    """柔和电钢；f：Hz，dur：秒，bell：金属铃音调制量（通常 0–1）。"""
    t = tvec(dur); idx = bell * 2.5 * np.exp(-t * 3.5)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 14 * t))
    x += .18 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 4)
    return fade(x * np.minimum(1, t / .006) * np.exp(-t * 1.8) * .5, fade_out=.1)


# ---------------------------------------------------------------- 通用音效，保留参考音色；cue 映射由调用方提供
def s_tick(v=1, rng=0):
    """滴答；v：强度，rng：种子或随机流。"""
    t = tvec(.04); n = np.random.default_rng(rng).standard_normal(len(t))
    return (np.sin(2 * np.pi * 2600 * t) * np.exp(-t * 180) + hp(n, 4000) * np.exp(-t * 400) * .4) * .35 * v


def s_blip(v=1, f=1600):
    """短提示；v：强度，f：基频 Hz。"""
    t = tvec(.09)
    return sq(f, t, 5) * np.exp(-t * 45) * .12 * v


def s_confirm(v=1):
    """双音确认；v：强度，固定 .6 秒。"""
    out = np.zeros(int(.6 * SR))
    for k, m in enumerate([84, 91]):
        t = tvec(.4)
        s = (np.sin(2 * np.pi * mtof(m) * t) + .3 * np.sin(2 * np.pi * mtof(m) * 2 * t)) * np.exp(-t * 9) * .12
        i = int(k * .08 * SR); out[i:i + len(s)] += s
    return out * v


def s_error(v=1):
    """拍频错误提示；v：强度，固定 .35 秒。"""
    t = tvec(.35); x = sq(110, t, 9) * .5 + sq(116, t, 9) * .4
    x = lp(x, 1600) * np.minimum(1, t / .01) * np.minimum(1, (.35 - t) / .04)
    return x * .2 * v


def s_whoosh(v=1, d=.7, rng=0):
    """转场风声；v：强度，d：秒，rng：种子或随机流。"""
    t = tvec(d); n = np.random.default_rng(rng).standard_normal(len(t)); y = np.zeros_like(n)
    seg = SR // 50
    for i in range(0, len(t), seg):
        c = 500 + 4000 * np.sin(np.pi * i / len(t)) ** 2
        y[i:i + seg] = bp(n[max(0, i - 2000):i + seg], c * .6, c * 1.4)[-len(n[i:i + seg]):]
    return y * np.sin(np.pi * t / d) ** 2 * .3 * v if len(t) else y


# ---------------------------------------------------------------- 效果与响度；不隐式增加尾音时长
def delay(x, dt, fb=.28, wet=.22, taps=4, legacy=False):
    """乒乓延迟；dt：秒，fb：0–1 反馈，wet：湿声增益，taps：抽头数。
    legacy=True 保留 v2 双重衰减（抽头权重 1, fb², fb⁴, fb⁶）；默认常规衰减。
    """
    x = _audio(x)
    if not np.isfinite(dt) or dt <= 0 or not 0 <= fb <= 1 or taps < 0 or int(taps) != taps:
        raise ValueError('dt 须为正数，fb 须在 [0,1]，taps 须为非负整数')
    d = int(dt * SR)
    if d < 1: raise ValueError('延迟至少一个采样点')
    y = x.copy(); tap = x.copy(); out = np.zeros_like(x)
    for k in range(1, int(taps) + 1):
        tap = np.roll(lp(tap, 3500), d, axis=0); tap[:d] = 0
        if k > 1: tap *= fb
        side = tap[:, ::-1] if x.ndim == 2 and k % 2 else tap
        out += side * (fb ** (k - 1) if legacy else 1)
    return y + out * wet


def reverb(x, dur=2.4, decay=.55, wet=.18, rng=0, predelay=.02):
    """统计混响；dur：IR 秒，decay：指数衰减秒，wet：湿声增益，predelay：预延迟秒。
    rng：种子/随机流；返回干声 + 湿声，输出长等于输入，须事先预留尾音。
    """
    x = _audio(x); t = tvec(dur)
    if not len(t) or not np.isfinite(decay) or decay <= 0 or not np.isfinite(predelay) or predelay < 0:
        raise ValueError('混响长度/decay 须为正数，predelay 须非负')
    if not len(x): return x.copy()
    xx = x[:, None] if x.ndim == 1 else x
    ir = np.random.default_rng(rng).standard_normal((len(t), xx.shape[1])) * np.exp(-t / decay)[:, None]
    # 单声道内部借用双声道滤波路径以外的 scipy 直接滤波。
    ir = sosfilt(butter(2, 4500 / (SR / 2), 'low', output='sos'), ir, axis=0)
    ir = sosfilt(butter(2, 200 / (SR / 2), 'high', output='sos'), ir, axis=0)
    ir = np.vstack([np.zeros((int(predelay * SR), xx.shape[1])), ir])
    ir /= np.maximum(np.sqrt((ir ** 2).sum(0)), 1e-12)
    y = np.stack([fftconvolve(xx[:, c], ir[:, c])[:len(x)] for c in range(xx.shape[1])], 1)
    return x + (y[:, 0] if x.ndim == 1 else y) * wet


def duck(music, key=None, times=(), depth_db=6, threshold=.05, attack=.02, hold=.08, release=.25):
    """侧链；key：同长音效数组，times：重点时刻秒列表，可同时用；返回压低后的音乐。
    key 峰值超过线性 threshold 即触发；depth_db 最大压低量；attack 提前渐入、
    hold 触发结束后保持秒数、release 线性恢复秒数；声道联动，交叠不重复压低。
    """
    music = _audio(music)
    if not all(np.isfinite(v) and v >= 0 for v in (depth_db, threshold, attack, hold, release)):
        raise ValueError('侧链参数须有限且非负')
    spans = [(float(t), float(t)) for t in times]
    if not all(np.isfinite(t) for s in spans for t in s): raise ValueError('卡点须为有限秒数')
    if key is not None:
        key = _audio(key)
        if len(key) != len(music): raise ValueError('侧链 key 与 music 长度须相同')
        peak = np.abs(key) if key.ndim == 1 else np.max(np.abs(key), axis=1)
        edges = np.diff(np.r_[False, peak > threshold, False].astype(np.int8))
        starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
        if len(starts):
            split = np.r_[True, starts[1:] - ends[:-1] > hold * SR]
            spans.extend(zip(starts[split] / SR, ends[np.r_[split[1:], True]] / SR))
    env = np.zeros(len(music))
    for start, end in spans:
        a, b = max(0, int(np.floor((start - attack) * SR))), min(len(env), int(np.ceil((end + hold + release) * SR)) + 1)
        if b <= a: continue
        curve = np.interp(np.arange(a, b) / SR, [start - attack, start, end + hold, end + hold + release], [0, 1, 1, 0])
        env[a:b] = np.maximum(env[a:b], curve)
    gain = 1 - env * (1 - 10 ** (-depth_db / 20))
    return music * (gain[:, None] if music.ndim == 2 else gain)


def rms_db(x):
    """所有样本/声道的 RMS dBFS；静音/空数组为 -240，不是 LUFS。"""
    x = _audio(x)
    return float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)) if x.size else -240.0


def peak_db(x):
    """采样峰值 dBFS；静音/空数组为 -240，不估计重建后的 true peak。"""
    x = _audio(x)
    return float(20 * np.log10(np.max(np.abs(x)) + 1e-12)) if x.size else -240.0


def limit_bus(x, ceiling_db=DEFAULT_PEAK_DB):
    """总线峰值保护：统一衰减至 ceiling_db，保持动态与声像，不硬削波、不自动增益。"""
    x = _audio(x)
    if not np.isfinite(ceiling_db) or ceiling_db > 0: raise ValueError('峰值上限须有限且 ≤ 0 dBFS')
    if not np.isfinite(x).all(): raise ValueError('音频含 NaN/Inf')
    peak = np.max(np.abs(x)) if x.size else 0
    return x * min(1, 10 ** (ceiling_db / 20) / max(peak, 1e-12))


def normalize(x, target_rms_db=DEFAULT_RMS_DB, peak_db=DEFAULT_PEAK_DB, mask=None):
    """按 RMS 统一增益后保护峰值；目标冲突时峰值优先，实际 RMS 可能低于目标。
    target_rms_db=None 只按峰值归一；peak_db=None 不限制峰值；mask 为选入 RMS 的帧掩码。
    默认成品目标 -24.3832 dBFS RMS / .89 峰值；空掩码/静音不放大。
    """
    x = _audio(x)
    if not np.isfinite(x).all(): raise ValueError('音频含 NaN/Inf')
    if target_rms_db is not None and not np.isfinite(target_rms_db): raise ValueError('RMS 目标须有限')
    if peak_db is not None and (not np.isfinite(peak_db) or peak_db > 0): raise ValueError('峰值目标须有限且 ≤ 0 dBFS')
    if mask is not None:
        mask = np.asarray(mask)
        if mask.shape != (len(x),) or mask.dtype != bool: raise ValueError('mask 须为长度 N 的布尔数组')
    measured = x if mask is None else x[mask]
    peak = np.max(np.abs(x)) if x.size else 0
    gain = 1.0
    if target_rms_db is not None:
        if measured.size and np.max(np.abs(measured)) > 1e-12:
            gain = 10 ** ((target_rms_db - rms_db(measured)) / 20)
    elif peak_db is not None and peak > 1e-12:
        gain = 10 ** (peak_db / 20) / peak
    if peak_db is not None and peak > 0: gain = min(gain, 10 ** (peak_db / 20) / peak)
    return x * gain


# ---------------------------------------------------------------- 编曲调度：只分发数据，不限定音色、风格或节奏
def timeline_sections(info, source='chapters'):
    """chapters 的 {t,n} / scenes 的 {start,id,d} → {start,end,name,...} 段落表。
    按起点排序，段尾取下一起点/片尾；首点大于零时补 intro；空列表返回整片 intro。
    """
    if source not in ('chapters', 'scenes'): raise ValueError('source 须为 chapters 或 scenes')
    duration = float(info['duration']); sections = []
    if not np.isfinite(duration) or duration < 0: raise ValueError('duration 须有限且非负')
    for item in info.get(source, []):
        start = float(item['t' if source == 'chapters' else 'start'])
        name = str(item.get('name', item.get('n' if source == 'chapters' else 'id', '')))
        if not np.isfinite(start) or not 0 <= start <= duration: raise ValueError('段落起点越界')
        sections.append(dict(item, start=start, name=name))
    sections.sort(key=lambda s: s['start'])
    if any(a['start'] == b['start'] for a, b in zip(sections, sections[1:])):
        raise ValueError('段落起点不能重复')
    if not sections or sections[0]['start'] > 0: sections.insert(0, dict(start=0.0, name='intro'))
    for i, row in enumerate(sections): row['end'] = sections[i + 1]['start'] if i + 1 < len(sections) else duration
    return sections


def section_at(t, sections):
    """从有序非空段落表查 t 秒所属段；首/尾外沿用首/尾段，用于尾音小节。"""
    if not sections: raise ValueError('段落表不能为空')
    row = sections[0]
    for section in sections:
        if t >= section['start'] - 1e-6: row = section
    return row


def schedule_bars(sections, patterns, duration, bpm=96, beats=4, lookahead=0, extra_bars=0):
    """全片固定 BPM 网格；patterns[name]={prog:[和弦], layers:{层:增益}, density:每拍音数, ...}。
    逐小节产出 {t, beat, bar, section, start, chord, layers, density, ...}；自定义字段透传。
    段内和弦序号用 round((t-start)/bar) 对齐参考版；lookahead 秒提前判段；extra_bars 留尾。
    """
    if not all(np.isfinite(v) for v in (bpm, beats, duration, lookahead)) or bpm <= 0 or beats <= 0 or duration < 0:
        raise ValueError('速度/拍数须正，时长须非负，参数须有限')
    if extra_bars < 0 or int(extra_bars) != extra_bars: raise ValueError('extra_bars 须为非负整数')
    if not sections or any(a['start'] > b['start'] for a, b in zip(sections, sections[1:])):
        raise ValueError('段落表须非空且有序')
    beat = 60 / bpm; bar = beat * beats
    for b in range(int(np.ceil(duration / bar)) + int(extra_bars)):
        t = b * bar; row = section_at(t + lookahead, sections); p = patterns[row['name']]
        if not p['prog']: raise ValueError('和弦进行不能为空')
        k = int(round((t - row['start']) / bar)) if t >= row['start'] else 0
        yield dict(p, t=t, beat=beat, bar=bar, section=row['name'], start=row['start'],
                   chord=p['prog'][k % len(p['prog'])], layers=dict(p.get('layers', {})), density=p.get('density', 0))


def place_cues(buf, cues, fx, pan=0.0, strict=True):
    """按原顺序原地摆音效；fx[type](v) → 波形，推荐 partial 绑定 rng/音色参数。
    cue 为 {t,type,v?,gain?,pan?}；pan 可为常数或 fn(cue)；strict 遇未知类型先报错，
    False 跳过未知类型并返回其排序列表。超界事件依 add 裁切，不自动加长缓冲区。
    """
    cues = list(cues); missing = sorted({ev['type'] for ev in cues if ev['type'] not in fx})
    if strict and missing: raise KeyError(f'未映射的 cue 类型：{missing}')
    for ev in cues:
        fn = fx.get(ev['type'])
        if fn is None: continue
        position = ev['pan'] if 'pan' in ev else (pan(ev) if callable(pan) else pan)
        add(buf, fn(ev.get('v', 1)), ev['t'], ev.get('gain', 1.0), position)
    return missing
