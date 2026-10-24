"""赛博朋克 HUD 风格配乐 + 音效（纯 numpy/scipy 合成，无外部采样）
用法：python3 audio_hud.py info.json out.wav
info.json 由 render2.mjs info 导出（场景、章节、音效点）。"""
import json, sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
rng = np.random.default_rng(32)
info = json.load(open(sys.argv[1]))
D = info['duration'] + 1.0
N = int(D * SR)
mus = np.zeros((N, 2))
sfx = np.zeros((N, 2))


def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def tvec(d): return np.arange(int(d * SR)) / SR


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR * .47) / (SR / 2), 'low', output='sos'), x, axis=0)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc / (SR / 2), 'high', output='sos'), x, axis=0)


def bp(x, f1, f2, order=2):
    return sosfilt(butter(order, [f1 / (SR / 2), min(f2, SR * .47) / (SR / 2)], 'band', output='sos'), x, axis=0)


def add(buf, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l * 1.414, sig * r * 1.414], 1)
    if i < 0:
        sig = sig[-i:]; i = 0
    n = min(len(sig), len(buf) - i)
    if n > 0:
        buf[i:i + n] += sig[:n] * gain


def saw(f, t, nh=24):
    x = np.zeros_like(t)
    for h in range(1, nh):
        if f * h > 15000: break
        x += np.sin(2 * np.pi * f * h * t) / h
    return x * .6


def sq(f, t, nh=16):
    x = np.zeros_like(t)
    for h in range(1, nh, 2):
        if f * h > 15000: break
        x += np.sin(2 * np.pi * f * h * t) / h
    return x * .8

# ---------------------------------------------------------------- 乐器


def arp_pluck(f, dur=.5, cut=3000, amp=1.0):
    t = tvec(dur)
    x = saw(f, t, 18) * .6 + sq(f * 2.003, t, 9) * .25
    y = np.zeros_like(x)
    # 简单的包络滤波：前段亮，后段暗
    y = lp(x, cut) * .6 + lp(x, cut * .35) * .4
    e = np.minimum(1, t / .003) * np.exp(-t * 7)
    return y * e * .35 * amp


def pad(notes, dur, cutoff=1200, amp=.12):
    t = tvec(dur)
    x = np.zeros((len(t), 2))
    for m in notes:
        f = mtof(m)
        for k, det in enumerate([-.13, -.04, .05, .14]):
            v = saw(f * 2 ** (det / 12), t + rng.random(), 14)
            pan = (k - 1.5) * .45
            x[:, 0] += v * (1 - pan) * .5
            x[:, 1] += v * (1 + pan) * .5
    x = lp(x, cutoff, 2)
    n = len(t); a = min(int(.9 * SR), n // 3); r = min(int(1.2 * SR), n // 3)
    e = np.ones(n); e[:a] = np.linspace(0, 1, a); e[-r:] *= np.linspace(1, 0, r)
    return x * e[:, None] * amp / len(notes)


def bass(f, dur, amp=.4, cut=500):
    t = tvec(dur)
    x = saw(f, t, 12) * .7 + np.sin(2 * np.pi * f * .5 * t) * .5
    x = lp(x, cut)
    e = np.minimum(1, t / .006) * np.exp(-t * 3.0)
    nr = min(int(.04 * SR), len(t)); e[-nr:] *= np.linspace(1, 0, nr)
    return np.tanh(x * 1.6) * e * amp


def kick(amp=.9):
    t = tvec(.42)
    f = 42 + 110 * np.exp(-t * 32)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8) * amp


def hat(amp=.1, d=.045):
    t = tvec(d)
    return hp(rng.standard_normal(len(t)), 8000) * np.exp(-t * 80) * amp


def snare(amp=.3):
    t = tvec(.3)
    n = bp(rng.standard_normal(len(t)), 1200, 7000) * np.exp(-t * 16)
    b = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * .5
    return (n + b) * amp


CH = {  # 根音, 和弦音
    'Am': (45, [57, 60, 64, 67]), 'F': (41, [53, 57, 60, 64]), 'C': (48, [55, 60, 64, 67]), 'G': (43, [55, 59, 62, 67]),
    'Dm': (38, [53, 57, 62, 65]), 'E': (40, [52, 56, 59, 64]), 'Em': (40, [55, 59, 64, 67]), 'Bb': (46, [53, 58, 62, 65]),
}
MOODS = {
    'calm':   dict(bpm=96, prog=['Am', 'F', 'C', 'G'], cut=1400, pad=.10, arp='8th', acut=2200, bass=.26, drums='light'),
    'tense':  dict(bpm=96, prog=['Am', 'F', 'Dm', 'E'], cut=900, pad=.10, arp='16th', acut=1600, bass=.32, drums='pulse'),
    'fix':    dict(bpm=104, prog=['F', 'G', 'Am', 'C'], cut=2000, pad=.09, arp='8th', acut=3200, bass=.30, drums='beat'),
    'wait':   dict(bpm=120, prog=['Am', 'F', 'C', 'G'], cut=1600, pad=.08, arp='16th', acut=2600, bass=.26, drums='hats'),
    'dark':   dict(bpm=96, prog=['Am', 'Bb', 'Am', 'E'], cut=700, pad=.11, arp='sparse', acut=1200, bass=.34, drums='pulse'),
    'groove': dict(bpm=108, prog=['F', 'G', 'Em', 'Am'], cut=2400, pad=.08, arp='16th', acut=3600, bass=.30, drums='full'),
    'resolve': dict(bpm=84, prog=['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'], cut=1600, pad=.11, arp='sparse', acut=2000, bass=.24, drums=None),
}


def render_mood(mood, d):
    out = np.zeros((int((d + 3) * SR), 2))
    if mood in ('drone', 'silence'):
        t = tvec(d + 2)
        x = np.zeros((len(t), 2))
        for m, a in [(33, 1), (40, .5), (45, .35)]:
            for k, det in enumerate([-.07, .08]):
                x[:, k] += saw(mtof(m) * 2 ** (det / 12), t, 10) * a
        x = lp(x, 380 if mood == 'drone' else 200)
        e = np.minimum(1, t / 1.5) * (1 + .25 * np.sin(2 * np.pi * .4 * t))
        add(out, x * e[:, None] * (.10 if mood == 'drone' else .05), 0)
        return out
    M = MOODS[mood]
    beat = 60 / M['bpm']; bar = beat * 4
    for b in range(int(np.ceil(d / bar)) + 1):
        t0 = b * bar
        root, notes = CH[M['prog'][b % len(M['prog'])]]
        add(out, pad(notes, bar + 1.0, M['cut'], M['pad']), t0)
        # 低音：8 分音符脉冲
        for k in range(8):
            v = 1 if k % 2 == 0 else .6
            add(out, bass(mtof(root), beat * .48, M['bass'] * v), t0 + k * beat / 2)
        # 琶音
        tones = [n + 12 for n in notes] + [notes[0] + 24]
        if M['arp'] == '16th':
            pat = [(i * .25, [0, 2, 1, 3, 2, 4, 3, 1][i % 8]) for i in range(16)]
        elif M['arp'] == '8th':
            pat = [(i * .5, [0, 1, 2, 3, 4, 3, 2, 1][i]) for i in range(8)]
        else:
            pat = [(0, 0), (1.5, 2), (2.5, 3), (3.5, 1)]
        for k, (off, idx) in enumerate(pat):
            vel = .65 + .35 * ((k * 5) % 4) / 3
            add(out, arp_pluck(mtof(tones[idx]), .45, M['acut']), t0 + off * beat, .22 * vel, pan=(idx - 2) * .28)
            # 简单延迟回声
            add(out, arp_pluck(mtof(tones[idx]), .45, M['acut'] * .6), t0 + off * beat + beat * .75, .08 * vel, pan=-(idx - 2) * .35)
        dr = M['drums']
        if dr == 'light':
            for k in range(4): add(out, hat(.05), t0 + (k + .5) * beat, pan=.3)
        elif dr == 'hats':
            for k in range(16): add(out, hat(.06 if k % 2 else .09, .03), t0 + k * beat / 4, pan=.25)
            add(out, kick(.5), t0)
        elif dr == 'pulse':
            add(out, kick(.55), t0); add(out, kick(.45), t0 + 2 * beat)
            for k in range(8): add(out, hat(.05 if k % 2 else .08), t0 + k * beat / 2, pan=.3)
        elif dr == 'beat':
            for off in (0, 2): add(out, kick(.6), t0 + off * beat)
            for off in (1, 3): add(out, snare(.18), t0 + off * beat, pan=-.05)
            for k in range(8): add(out, hat(.05 if k % 2 else .08), t0 + k * beat / 2, pan=.3)
        elif dr == 'full':
            for off in (0, 1, 2, 3): add(out, kick(.55), t0 + off * beat)
            for off in (1, 3): add(out, snare(.2), t0 + off * beat, pan=-.05)
            for k in range(16): add(out, hat(.04 if k % 2 else .07, .03), t0 + k * beat / 4, pan=.3)
    return out


# 配乐分段：按场景 id 决定情绪
sc = {s['id']: s for s in info['scenes']}
def S(i): return sc[i]['start']
def E(i): return sc[i]['start'] + sc[i]['d']
segs = [
    (0, S('title'), 'drone'),
    (S('title') + .1, S('ch2'), 'calm'),
    (S('ch2'), S('ch3'), 'tense'),
    (S('ch3'), S('ch4'), 'fix'),
    (S('ch4'), S('fail2') + 2.0, 'wait'),
    (S('fail2') + 2.0, S('trap') + .5, 'silence'),
    (S('trap') + .5, S('ch5'), 'dark'),
    (S('ch5'), S('outro'), 'groove'),
    (S('outro'), info['duration'], 'resolve'),
]
for i, (st, en, mood) in enumerate(segs):
    d = en - st
    x = render_mood(mood, d + 1.5)
    nxt = segs[i + 1][2] if i + 1 < len(segs) else None
    fo = .25 if nxt == 'silence' else 1.2
    L = int((d + fo) * SR); x = x[:L]
    e = np.ones(len(x))
    fi = int((.05 if mood in ('silence',) else .6) * SR)
    if i > 0: e[:fi] = np.linspace(0, 1, fi)
    nfo = int(fo * SR); e[-nfo:] *= np.linspace(1, 0, nfo)
    if i == len(segs) - 1:
        tail = min(len(e), int(6 * SR)); e[-tail:] *= np.linspace(1, 0, tail)
    add(mus, x * e[:, None], st)

# ---------------------------------------------------------------- 音效


def s_tick(v=1):
    t = tvec(.04)
    return (np.sin(2 * np.pi * 2600 * t) * np.exp(-t * 180) + hp(rng.standard_normal(len(t)), 4000) * np.exp(-t * 400) * .4) * .35 * v


def s_blip(v=1, f=1600):
    t = tvec(.09)
    return sq(f, t, 5) * np.exp(-t * 45) * .12 * v


def s_blip2(v=1): return s_blip(v, 2400)


def s_lock(v=1):
    out = np.zeros(int(.3 * SR))
    for k, f in enumerate([1400, 2100]):
        s = s_blip(1, f); i = int(k * .09 * SR); out[i:i + len(s)] += s
    return out * 1.3 * v


def s_alert(v=1):
    out = np.zeros(int(.8 * SR))
    for k in range(4):
        t = tvec(.13); f = 880 if k % 2 == 0 else 660
        s = sq(f, t, 7) * np.minimum(1, t / .005) * np.minimum(1, (.13 - t) / .01) * .12
        i = int(k * .18 * SR); out[i:i + len(s)] += s
    return out * v


def s_alarm(v=1):
    out = np.zeros(int(2.2 * SR))
    for k in range(6):
        t = tvec(.3); f0, f1 = (700, 1000) if k % 2 == 0 else (1000, 700)
        f = np.linspace(f0, f1, len(t))
        s = sq(1, t, 1)  # 占位
        s = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * .5
        s = lp(s, 3500) * np.minimum(1, t / .01) * np.minimum(1, (.3 - t) / .02) * .14
        i = int(k * .34 * SR); out[i:i + len(s)] += s
    return out * v


def s_glitch(v=1):
    t = tvec(.7)
    n = rng.standard_normal(len(t))
    # 采样率降低 + 比特粉碎
    step = 6; n = np.repeat(n[::step], step)[:len(t)]
    n = np.round(n * 3) / 3
    g = (np.sin(2 * np.pi * 23 * t) > -.2).astype(float)
    body = bp(n, 300, 6000) * g * np.exp(-t * 6) * .35
    f = 50 + 140 * np.exp(-t * 18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4) * .8
    return np.tanh((body + sub) * 1.3) * .8 * v


def s_impact(v=1):
    t = tvec(2.4)
    f = 36 + 80 * np.exp(-t * 10)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.0)
    n = lp(rng.standard_normal(len(t)), 1500) * np.exp(-t * 10) * .5
    return np.tanh((boom + n) * 1.6) * .75 * v


def s_stamp(v=1):
    t = tvec(.5)
    f = 60 + 130 * np.exp(-t * 30)
    th = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    n = lp(rng.standard_normal(len(t)), 2800) * np.exp(-t * 35) * .8
    return (th + n) * .65 * v


def s_whoosh(v=1, d=.7):
    t = tvec(d); n = rng.standard_normal(len(t)); y = np.zeros_like(n); seg = SR // 50
    for i in range(0, len(t), seg):
        c = 500 + 4000 * np.sin(np.pi * i / len(t)) ** 2
        y[i:i + seg] = bp(n[max(0, i - 2000):i + seg], c * .6, c * 1.4)[-len(n[i:i + seg]):]
    return y * np.sin(np.pi * t / d) ** 2 * .3 * v


def s_riser(v=1, d=1.0):
    t = tvec(d); n = rng.standard_normal(len(t)); y = np.zeros_like(n); seg = SR // 50
    for i in range(0, len(t), seg):
        c = 300 + 6000 * (i / len(t)) ** 2
        y[i:i + seg] = bp(n[max(0, i - 2000):i + seg], c * .7, c * 1.3)[-len(n[i:i + seg]):]
    f = 180 + 1200 * (t / d) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * .2
    return (y * .5 + tone) * (t / d) ** 2.2 * .45 * v


def s_riserUp(v=1): return s_riser(v * .8, 1.3)


def s_ir(v=1):
    out = np.zeros(int(.4 * SR))
    for k in range(5):
        t = tvec(.025); s = np.sin(2 * np.pi * 3800 * t) * np.exp(-t * 90) * .1
        i = int(k * .05 * SR); out[i:i + len(s)] += s
    return out * v


def s_error(v=1):
    t = tvec(.35)
    x = sq(110, t, 9) * .5 + sq(116, t, 9) * .4
    x = lp(x, 1600) * np.minimum(1, t / .01) * np.minimum(1, (.35 - t) / .04)
    return x * .2 * v


def s_warn(v=1): return s_error(v * .7)


def s_power(v=1):
    t = tvec(.7)
    f = 900 * np.exp(-t * 3.5) + 60
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / .7) * .22 * v


def s_confirm(v=1):
    out = np.zeros(int(.6 * SR))
    for k, m in enumerate([84, 91]):
        t = tvec(.4); s = (np.sin(2 * np.pi * mtof(m) * t) + .3 * np.sin(2 * np.pi * mtof(m) * 2 * t)) * np.exp(-t * 9) * .12
        i = int(k * .08 * SR); out[i:i + len(s)] += s
    return out * v


def s_motor(v=1, d=2.0):
    t = tvec(d)
    f = 120 + 15 * np.sin(2 * np.pi * 2 * t)
    ph = np.cumsum(f) / SR; x = 2 * (ph % 1) - 1
    x = lp(x, 700) + lp(rng.standard_normal(len(t)), 2000) * .1
    return x * np.minimum(1, t / .2) * np.minimum(1, (d - t) / .3) * .12 * v


def s_scan(v=1, d=1.4):
    t = tvec(d)
    f = 300 + 2500 * t / d
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * .05 + bp(rng.standard_normal(len(t)), 2000, 6000) * .03
    return x * np.sin(np.pi * t / d) * v


def s_hum(v=1, d=1.8):
    t = tvec(d)
    x = saw(55, t, 10) * .5 + np.sin(2 * np.pi * 110 * t) * .3
    return lp(x, 400) * np.sin(np.pi * t / d) * .2 * v


def s_type(v=1):
    out = np.zeros(int(1.0 * SR))
    for k in range(9):
        s = s_tick(.5 + .4 * rng.random()); i = int((k * .1 + rng.random() * .03) * SR); out[i:i + len(s)] += s
    return out * v


FX = dict(tick=s_tick, blip=s_blip, blip2=s_blip2, lock=s_lock, alert=s_alert, alarm=s_alarm, glitchHit=s_glitch, impact=s_impact,
          stamp=s_stamp, whoosh=s_whoosh, riser=s_riser, riserUp=s_riserUp, ir=s_ir, error=s_error, warn=s_warn, power=s_power,
          confirm=s_confirm, motor=s_motor, scan=s_scan, hum=s_hum, type=s_type)
missing = set()
for ev in info['cues']:
    fn = FX.get(ev['type'])
    if fn is None: missing.add(ev['type']); continue
    add(sfx, fn(ev.get('v', 1)), ev['t'], 1.0, pan=((hash(ev['type']) % 5) - 2) * .08)
if missing: print('missing sfx', missing, file=sys.stderr)

# ---------------------------------------------------------------- 总线


def reverb(x, dur=2.2, decay=.5, wet=.2):
    t = tvec(dur)
    ir = np.stack([rng.standard_normal(len(t)), rng.standard_normal(len(t))], 1) * np.exp(-t / decay)[:, None]
    ir = lp(ir, 6000); ir /= np.sqrt((ir ** 2).sum(0))
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)
    return x * (1 - wet) + y * wet * 2.0


mus = reverb(mus, wet=.25)
sfx = reverb(sfx, dur=1.2, decay=.25, wet=.12)
# 音效出现时轻微压低音乐（侧链）
env = np.abs(sfx).max(1)
env = lp(env, 8)
duck = 1 - np.clip(env * 1.2, 0, .35)
mix = mus * duck[:, None] * .85 + sfx
mix = hp(mix, 30)
mix = mix / np.abs(mix).max() * .9
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
wavfile.write(sys.argv[2], SR, (mix * 32767).astype(np.int16))
print('ok', sys.argv[2], f'{len(mix) / SR:.1f}s', file=sys.stderr)
