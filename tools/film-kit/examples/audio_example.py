"""20 秒明快 MG 配乐：马林巴 + 木块/沙锤 + 三个画面提示音。
用法：python3 -B tools/film-kit/examples/audio_example.py out.wav
"""
from pathlib import Path
from functools import partial
import sys
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audio_kit as ak


def render():
    # 虚构信息图：标题 → 数据出现 → 对比 → 结论；无需外部 timeline 文件。
    info = dict(duration=20, captions=[], chapters=[dict(t=0, n=1), dict(t=12, n=2)],
                scenes=[dict(id='intro', start=0, d=4), dict(id='data', start=4, d=8),
                        dict(id='compare', start=12, d=4), dict(id='outro', start=16, d=4)],
                cues=[dict(t=4, type='appear', v=.8, pan=-.2),
                      dict(t=12, type='transition', v=.7), dict(t=17.5, type='done', v=1)])
    patterns = {
        'intro': dict(prog=['C', 'F'], layers=dict(mallet=.65, bass=.25, perc=.3), density=1),
        'data': dict(prog=['C', 'G', 'Am', 'F'], layers=dict(mallet=.9, bass=.4, perc=.65), density=2),
        'compare': dict(prog=['Dm', 'G'], layers=dict(mallet=.85, bass=.35, perc=.55), density=2),
        'outro': dict(prog=['F', 'C'], layers=dict(mallet=.65, bass=.25, perc=.35), density=1),
    }
    chords = {'C': (48, [72, 76, 79]), 'F': (41, [72, 77, 81]), 'G': (43, [71, 74, 79]),
              'Am': (45, [72, 76, 81]), 'Dm': (50, [74, 77, 81])}
    n = int(info['duration'] * ak.SR)
    mallet = np.zeros((n, 2)); rhythm = np.zeros((n, 2)); sfx = np.zeros((n, 2))
    rng = np.random.default_rng(2026)
    for ev in ak.schedule_bars(ak.timeline_sections(info, 'scenes'), patterns, info['duration'], bpm=120):
        t, beat, rate, layers = ev['t'], ev['beat'], ev['density'], ev['layers']
        root, notes = chords[ev['chord']]
        for k in range(4 * rate):
            pitch = notes[[0, 1, 2, 1, 0, 2, 1, 2][k % 8]]
            ak.add(mallet, ak.marimba(ak.mtof(pitch), bright=.8), t + k * beat / rate,
                   layers['mallet'] * (.85 if k % 2 else 1), pan=(k % 3 - 1) * .25)
        for k in range(4):
            ak.add(rhythm, ak.marimba(ak.mtof(root), dur=.45, bright=.3), t + k * beat, layers['bass'])
            ak.add(rhythm, ak.shaker(rng=rng), t + (k + .5) * beat, layers['perc'], pan=.3)
            if k % 2:
                ak.add(rhythm, ak.woodblock(), t + k * beat, layers['perc'] * .35, pan=-.3)
    mallet = ak.delay(mallet, .375, fb=.18, wet=.12)
    music = ak.fade(ak.reverb(mallet + rhythm, dur=1.1, decay=.25, wet=.08, rng=8), .15, 1.5)
    music = ak.normalize(music, target_rms_db=-25, peak_db=-4)
    # cue 映射可随每期画风替换；v 只由音效函数乘一次。
    fx = dict(appear=partial(ak.s_tick, rng=31), transition=partial(ak.s_whoosh, rng=32), done=ak.s_confirm)
    ak.place_cues(sfx, info['cues'], fx)
    music = ak.duck(music, key=sfx, times=[ev['t'] for ev in info['cues']], depth_db=3)
    return ak.normalize(music + sfx)


def main():
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    audio = render()
    ak.write_wav(sys.argv[1], audio)
    # 报告实际写出的 PCM16；以 32768 为满刻度，避免量化前/后的口径混用。
    from scipy.io import wavfile
    sr, pcm = wavfile.read(sys.argv[1]); decoded = pcm.astype(float) / 32768
    print(f'{len(pcm) / sr:.3f}s  peak={ak.peak_db(decoded):.3f} dBFS  RMS={ak.rms_db(decoded):.3f} dBFS')


if __name__ == '__main__': main()
