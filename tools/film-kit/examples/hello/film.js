/* Hello FilmKit：15 秒、两个场景。复制到一期 work/ 后搭配 template/film.html。 */
(function () {
'use strict';
const { TAU, eo, seg, lerp, rng } = FilmKit;
const W = 1920, H = 1080, ink = '#243c43', accent = '#c76e42';
const film = FilmKit.create({
  W, H, FPS: 30, fonts: { cjk: 'sans-serif', disp: 'sans-serif', mono: 'monospace' },
  fontsNeeded: [], theme: { bg: '#f3f0e7', white: ink, code: ink, punct: '#687b7b', pink: '#995b66', blue: '#376a87', cyan: accent, red: '#a23b4d', amber: '#84702e' },
  captions: { font: { s: 38, w: 500 }, baseY: 965, slide: 6 },
  // 只缓存与时间无关的资源；重建后也是同一组星点。
  prepare({ mk, cw, ch }) {
    const paper = mk(cw, ch), g = paper.getContext('2d'), random = rng('hello-paper');
    g.fillStyle = '#f3f0e7'; g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#243c430a';
    for (let i = 0; i < 700; i++) g.fillRect(random() * cw, random() * ch, 2, 2);
    return { paper };
  },
  drawBackground(g, { cache }) { g.drawImage(cache.paper, 0, 0, W, H); },
  beforeScene(g, { lt, sc }) { g.globalAlpha = Math.min(eo(seg(lt, 0, .5)), 1 - seg(lt, sc.d - .4, sc.d)); },
  drawChrome(g, { t }) {
    film.txt(g, 'FILM KIT / 001', 110, 105, { f: 'mono', s: 22, c: ink });
    g.fillStyle = accent; g.fillRect(110, 1020, 1700 * t / 15, 3);
  },
});
const { txt, drawCode } = film;
film.chapter(1, '你好，时间线', 'HELLO, TIMELINE', '风格与场景交给你，时间交给引擎');
film.addScene({
  id: 'hello', chapter: 1, dur: 7.5,
  captions: [{ t: .7, text: '从一个{确定的时刻}开始。' }, { t: 3.8, text: '每一帧，都可以直接抵达。' }],
  cues: [{ t: 1.2, type: 'blip', v: .6 }],
  draw(g, t) {
    const p = eo(seg(t, .15, 1.8));
    txt(g, '你好，时间线。', 160, 445, { s: 100, w: 700, c: ink });
    txt(g, 'ONE FRAME. ANY MOMENT.', 168, 530, { f: 'mono', s: 27, c: accent });
    g.strokeStyle = '#243c4322'; g.lineWidth = 2;
    g.beginPath(); g.arc(1420, 470, 180, 0, TAU); g.stroke();
    g.strokeStyle = accent; g.lineWidth = 12; g.lineCap = 'round';
    g.beginPath(); g.arc(1420, 470, 180, -TAU / 4, -TAU / 4 + TAU * p * .8); g.stroke();
    txt(g, t.toFixed(1), 1420, 500, { f: 'mono', s: 72, c: ink, a: 'center' });
    g.fillStyle = accent; g.beginPath(); g.arc(lerp(170, 950, seg(t, 0, 7.5)), 700, 11, 0, TAU); g.fill();
  },
});
film.addScene({
  id: 'create', chapter: 1, dur: 7.5,
  captions: [{ t: .7, text: '写下{风格}，再写下{场景}。' }, { t: 4.2, text: '剩下的，交给 ^FilmKit^。' }],
  draw(g, t) {
    txt(g, '从这里开始', 160, 350, { s: 88, w: 700, c: ink });
    txt(g, 'STYLE + SCENES', 166, 420, { f: 'mono', s: 26, c: accent });
    drawCode(g, 200, 570, [
      'const film = FilmKit.create({ theme });',
      'film.addScene({ id, dur, captions, draw });',
      'film.finish();',
    ], { s: 31, lh: 62, p: seg(t, .4, 2.5), t });
  },
});
film.finish();
})();
