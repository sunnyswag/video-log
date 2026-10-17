"""配乐 v2：全片统一 96 BPM、A 小调，按小节网格对齐；段落之间只改变“层”的音量，
不再切换速度和调性。音色换成柔和的 FM 拨弦 + 暖垫 + 干净的正弦低音。
音效沿用 audio_hud.py 里的合成函数。
用法：python3 audio_v2.py timeline.json out.wav [music_only.wav]"""
import json, sys, importlib.util, types
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
info = json.load(open(sys.argv[1]))
DUR = info['duration'] + 1.5
N = int(DUR * SR)
rng = np.random.default_rng(7)

BPM = 96
BEAT = 60 / BPM
BAR = BEAT * 4


def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def tvec(d): return np.arange(int(round(d * SR))) / SR
def lp(x, fc, o=2): return sosfilt(butter(o, min(fc, SR * .45) / (SR / 2), 'low', output='sos'), x, axis=0)
def hp(x, fc, o=2): return sosfilt(butter(o, fc / (SR / 2), 'high', output='sos'), x, axis=0)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a / (SR / 2), min(b, SR * .45) / (SR / 2)], 'band', output='sos'), x, axis=0)


def add(buf, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l, sig * r], 1) * 1.414
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), len(buf) - i)
    if n > 0: buf[i:i + n] += sig[:n] * gain


# ---------------------------------------------------------------- 音色
def pad_voice(f, dur, cut):
    t = tvec(dur)
    x = np.zeros_like(t)
    for det in (-0.06, 0.06):                       # 两个轻微失谐的声部
        ff = f * 2 ** (det / 12)
        ph = (hash((round(f, 2), det)) % 1000) / 1000 * 2 * np.pi
        for h in range(1, 14):
            if ff * h > cut * 1.6: break
            x += np.sin(2 * np.pi * ff * h * t + ph * h) / h ** 1.6
    return x


def pad_chord(notes, dur, cut=1600, amp=1.0):
    t = tvec(dur)
    x = sum(pad_voice(mtof(m), dur, cut) for m in notes) / len(notes)
    x = lp(x, cut)
    a, r = int(.5 * SR), int(.9 * SR)
    e = np.ones(len(t)); e[:a] = np.linspace(0, 1, a) ** 1.5; e[-r:] *= np.linspace(1, 0, r) ** 1.5
    return x * e * amp


def pluck(f, dur=.9, bright=1.0):
    t = tvec(dur)
    idx = 1.6 * bright * np.exp(-t * 9)             # FM 指数衰减：起音亮、尾音圆润
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * 2 * f * t))
    x += .25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6)
    e = np.minimum(1, t / .004) * np.exp(-t * 4.2)
    return x * e * .5


def bass(f, dur):
    t = tvec(dur)
    x = np.sin(2 * np.pi * f * t) + .28 * np.sin(4 * np.pi * f * t) + .08 * np.sin(6 * np.pi * f * t)
    e = np.minimum(1, t / .008) * (0.75 + 0.25 * np.exp(-t * 6))
    nr = min(int(.07 * SR), len(t)); e[-nr:] *= np.linspace(1, 0, nr)
    return lp(x * e, 600) * .55


def kick():
    t = tvec(.45)
    f = 44 + 90 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5) * .9


def hat(open_=False):
    t = tvec(.18 if open_ else .05)
    return hp(rng.standard_normal(len(t)), 7500) * np.exp(-t * (18 if open_ else 70)) * .12


def clap():
    t = tvec(.25)
    n = bp(rng.standard_normal(len(t)), 1000, 5000)
    e = np.exp(-t * 20)
    for k in (0.0, .012, .024):
        i = int(k * SR); e[i:i + 40] += .5
    return n * e * .16


# ---------------------------------------------------------------- 编曲
CH = {'Am': (45, [57, 60, 64]), 'F': (41, [53, 57, 60]), 'C': (48, [55, 60, 64]), 'G': (43, [55, 59, 62]),
      'Dm': (38, [50, 53, 57]), 'E': (40, [52, 56, 59]), 'Em': (40, [52, 55, 59])}

sc = {s['id']: s for s in info['scenes']}
S = lambda i: sc[i]['start']
fail_t = next(c['t0'] for c in info['captions'] if '又不能用了' in c['plain'])
flip_t = next(c['t0'] for c in info['captions'] if c['plain'].startswith('再过 1 毫秒')) + 1.15

# 段落：(开始秒, 名称)。每段规定：和弦进行、各层音量、琶音密度
SECTIONS = [
    (0.0,            'intro'),
    (S('title'),     'title'),
    (S('ch1'),       'story'),
    (S('ch2'),       'tension'),
    (S('cause2'),    'tension2'),
    (S('ch3'),       'fix'),
    (S('ch4'),       'soak'),
    (fail_t,         'silence'),
    (S('trap') + .3, 'dark'),
    (S('blame'),     'dark2'),
    (S('ch5'),       'groove'),
    (S('os'),        'groove2'),
    (S('outro'),     'outro'),
]
P = {  # prog, pad, bass, arp, arp_rate(每拍几个音), drums, pad 截止频率
    'intro':    (['Am'], .55, .0, .0, 0, None, 700),
    'title':    (['Am', 'F'], .7, .35, .25, 1, None, 1100),
    'story':    (['Am', 'F', 'C', 'G'], .6, .45, .32, 2, None, 1500),
    'tension':  (['Am', 'F', 'Dm', 'E'], .55, .5, .34, 2, 'hats', 1300),
    'tension2': (['Am', 'F', 'Dm', 'E'], .55, .55, .36, 2, 'pulse', 1300),
    'fix':      (['F', 'G', 'Am', 'C'], .55, .55, .38, 2, 'beat', 2000),
    'soak':     (['Am', 'F', 'C', 'G'], .45, .5, .36, 4, 'beat', 2200),
    'silence':  (['Am'], .0, .0, .0, 0, None, 600),
    'dark':     (['Am', 'F', 'Dm', 'E'], .6, .4, .22, 1, 'heart', 900),
    'dark2':    (['Am', 'F', 'Dm', 'E'], .6, .45, .22, 1, 'heart', 900),
    'groove':   (['F', 'G', 'Em', 'Am'], .5, .55, .36, 2, 'full', 2200),
    'groove2':  (['F', 'G', 'Em', 'Am'], .5, .55, .36, 2, 'full', 2400),
    'outro':    (['F', 'G', 'C', 'Am'], .6, .35, .25, 1, None, 1400),
}


def section_at(t):
    name = SECTIONS[0][1]; start = 0
    for st, nm in SECTIONS:
        if t >= st - 1e-6: name, start = nm, st
    return name, start


pad_b = np.zeros((N, 2)); bass_b = np.zeros((N, 2)); arp_b = np.zeros((N, 2)); drum_b = np.zeros((N, 2))
nbars = int(np.ceil(DUR / BAR)) + 1
for b in range(nbars):
    t0 = b * BAR
    name, st = section_at(t0 + 0.05)
    prog, gpad, gbass, garp, rate, drums, cut = P[name]
    k = int(round((t0 - st) / BAR)) if t0 >= st else 0
    chord = prog[k % len(prog)]
    root, notes = CH[chord]
    # 垫音：每小节一个和弦，前后重叠形成连奏
    if gpad > 0:
        add(pad_b, pad_chord(notes + [notes[0] - 12], BAR + .9, cut, gpad), t0 - .2)
    # 低音
    if gbass > 0:
        if name in ('groove', 'groove2', 'fix', 'soak'):
            for q, n in enumerate([root, root, root + 12, root]):
                add(bass_b, bass(mtof(n), BEAT * .9), t0 + q * BEAT, gbass)
        elif name in ('tension', 'tension2'):
            for q in range(8):
                add(bass_b, bass(mtof(root), BEAT * .45), t0 + q * BEAT / 2, gbass * (1 if q % 2 == 0 else .7))
        else:
            add(bass_b, bass(mtof(root), BAR * .48), t0, gbass); add(bass_b, bass(mtof(root), BAR * .48), t0 + BAR / 2, gbass * .8)
    # 琶音
    if garp > 0 and rate > 0:
        tones = [n + 12 for n in notes] + [notes[0] + 24]
        seq = [0, 1, 2, 3, 2, 1] if rate >= 2 else [0, 2, 1, 3]
        steps = 4 * rate
        for s in range(steps):
            n = tones[seq[s % len(seq)]]
            vel = .75 + .25 * (s % 2 == 0)
            add(arp_b, pluck(mtof(n), .8, .9 if rate < 4 else 1.1), t0 + s * BEAT / rate, garp * vel, pan=((s % 4) - 1.5) * .22)
    # 鼓
    if drums == 'hats':
        for q in range(8): add(drum_b, hat(), t0 + q * BEAT / 2, .8 if q % 2 else 1, pan=.25)
    elif drums == 'pulse':
        add(drum_b, kick(), t0, .7); add(drum_b, kick(), t0 + 2 * BEAT, .6)
        for q in range(8): add(drum_b, hat(), t0 + q * BEAT / 2, .8 if q % 2 else 1, pan=.25)
    elif drums == 'beat':
        add(drum_b, kick(), t0, .8); add(drum_b, kick(), t0 + 2 * BEAT, .7)
        add(drum_b, clap(), t0 + BEAT, .8, pan=-.05); add(drum_b, clap(), t0 + 3 * BEAT, .8, pan=-.05)
        for q in range(8): add(drum_b, hat(q % 4 == 2), t0 + q * BEAT / 2, .8 if q % 2 else 1, pan=.25)
    elif drums == 'full':
        for q in range(4): add(drum_b, kick(), t0 + q * BEAT, .75)
        add(drum_b, clap(), t0 + BEAT, .9, pan=-.05); add(drum_b, clap(), t0 + 3 * BEAT, .9, pan=-.05)
        for q in range(8): add(drum_b, hat(q % 2 == 1), t0 + q * BEAT / 2, .7, pan=.25)
    elif drums == 'heart':                          # 心跳：咚-咚
        add(drum_b, kick(), t0, .55); add(drum_b, kick(), t0 + .28, .35)
        add(drum_b, kick(), t0 + 2 * BEAT, .55); add(drum_b, kick(), t0 + 2 * BEAT + .28, .35)

# 琶音加一点立体声附点八分延迟（干净、反馈小）
def delay(x, dt, fb=.28, wet=.22):
    d = int(dt * SR); y = x.copy(); out = np.zeros_like(x)
    tap = x.copy()
    for k in range(1, 5):
        tap = np.roll(lp(tap, 3500), d, axis=0); tap[:d] = 0; tap *= fb if k > 1 else 1
        side = tap[:, ::-1] if k % 2 else tap
        out += side * (fb ** (k - 1))
    return y + out * wet
arp_b = delay(arp_b, BEAT * .75)

# 总的音乐包络：失败瞬间硬切，结尾淡出
env = np.ones(N)
tt = np.arange(N) / SR
cut_i = int(fail_t * SR); env[cut_i:cut_i + int(.04 * SR)] *= np.linspace(1, 0, int(.04 * SR)); env[cut_i + int(.04 * SR):int((S('trap') + .3) * SR)] = 0
fi = int((S('trap') + .3) * SR); env[fi:fi + int(1.5 * SR)] *= np.linspace(0, 1, int(1.5 * SR))
env *= np.clip(tt / 2.0, 0, 1)                      # 开头 2 秒淡入
end_t = info['duration']
env *= np.clip((end_t + .8 - tt) / 6.0, 0, 1)       # 最后 6 秒淡出
music = (pad_b * .55 + bass_b * .65 + arp_b * .55 + drum_b * .6) * env[:, None]

# 混响（平滑的统计混响，带预延迟）
def reverb(x, dur=2.4, decay=.55, wet=.18):
    t = tvec(dur)
    ir = rng.standard_normal((len(t), 2)) * np.exp(-t / decay)[:, None]
    ir = lp(ir, 4500); ir = hp(ir, 200)
    pre = np.zeros((int(.02 * SR), 2)); ir = np.vstack([pre, ir])
    ir /= np.sqrt((ir ** 2).sum(0))
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)
    return x + y * wet
music = reverb(music)
music = hp(music, 30)

# ---------------------------------------------------------------- 音效（沿用 v1）
spec = importlib.util.spec_from_file_location('v1fx', __file__.replace('audio_v2.py', 'audio_hud.py'))
src = open(spec.origin, encoding='utf-8').read()
fx_src = src.split('# ---------------------------------------------------------------- 音效', 1)[1].split('missing = set()', 1)[0]
ns = dict(np=np, SR=SR, rng=np.random.default_rng(11), tvec=tvec, lp=lp, hp=hp, bp=bp, mtof=mtof)
exec(compile(src[src.index('def saw('):src.index('# ---------------------------------------------------------------- 乐器')], 'saw', 'exec'), ns)
exec(compile(fx_src, 'fx', 'exec'), ns)
FX = ns['FX']
sfx = np.zeros((N, 2))
for ev in info['cues']:
    fn = FX.get(ev['type'])
    if fn is None: continue
    add(sfx, fn(ev.get('v', 1)), ev['t'], 1.0, pan=((hash(ev['type']) % 5) - 2) * .08)
sfx = reverb(sfx, dur=1.2, decay=.25, wet=.12)

# ---------------------------------------------------------------- 混音：音乐做背景，音效在上面
def rms_db(x): return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)
music *= 10 ** ((-23 - rms_db(music[music.any(1)])) / 20)    # 音乐床先压到约 -23 dBFS RMS
sfx *= 10 ** ((-24 - rms_db(sfx[np.abs(sfx).max(1) > 1e-4])) / 20)
mix = music + sfx
peak = np.abs(mix).max()
if peak > .89: mix *= .89 / peak
wavfile.write(sys.argv[2], SR, (mix * 32767).astype(np.int16))
if len(sys.argv) > 3:
    m = music / max(1e-9, np.abs(music).max()) * .89
    wavfile.write(sys.argv[3], SR, (m * 32767).astype(np.int16))
print('ok', sys.argv[2], f'{len(mix) / SR:.1f}s', file=sys.stderr)
