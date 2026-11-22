// The preview cut's player (spec 018, research.md R7): a <video> on the take itself. Before plays it straight; After
// skips every part still cut. The receipt groups what was removed, as the app's does, and each line brings its parts
// back. Used for the visitor's own cut and for the site's example, on the same data (data-model.md section 5).
// The example also has its cut as a file (cutSrc): After plays that straight through while no part is back, so it never
// seeks at a cut (a seek pauses the picture on a phone while it decodes from the keyframe before, founder 2026-11-22).
//
// shortcut: the visitor's own cut has no cut file, so its After skips by seeking, which can show as a short hitch at a
// cut on a slow phone. If testing shows it, play from two <video> elements on the same URL, alternating, with the next
// kept part cued.

// The receipt's lines in print order: the app's own families (app/src/features/cutting/progress/reveal.ts).
const FAMILIES = [
  { key: 'dead_air', reasons: ['lead_in', 'tail', 'dead_air', 'pause_shortened'], one: 'Dead air', many: 'Dead air', counted: false },
  { key: 'demo', reasons: ['dead_air'], demo: true, one: 'Silent demo', many: 'Silent demos', counted: true },
  { key: 'retake', reasons: ['retake'], one: 'Retake', many: 'Retakes', counted: true },
  { key: 'filler', reasons: ['filler', 'stutter'], one: 'Filler', many: 'Fillers', counted: true },
  { key: 'other', reasons: ['false_start', 'meta', 'off_topic'], one: 'Other mistake', many: 'Other mistakes', counted: true },
];
const familyOf = (reason, demo) => (FAMILIES.find((f) => f.reasons.includes(reason) && !demo === !f.demo) ?? FAMILIES[0]).key;

const mm = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Tenths of a second as 0:15.6. The receipt is added up in whole tenths, so its lines always sum to its total. */
const tenths = (t) => `${Math.floor(t / 600)}:${String(Math.floor((t % 600) / 10)).padStart(2, '0')}.${t % 10}`;
const ICON = {
  undo: '<svg class="undo" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 10.5 2.5 7 6 3.5"/><path d="M2.5 7h7a4 4 0 0 1 4 4v1.5"/></svg>',
  redo: '<svg class="redo" viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="M14 3 5.5 10.5M10 10l4 3M5.5 5.5 8 8"/></svg>',
  play: '<svg class="play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z"/></svg>',
};
const MARKUP = `
<figure class="p-frame">
  <video playsinline muted preload="auto" aria-label="The take"></video>
  <p class="p-cap" aria-hidden="true"></p>
  <span class="p-tc">0:00</span>
  <button class="p-snd" type="button" aria-pressed="false"><svg class="off" viewBox="0 0 16 16" aria-hidden="true"><path d="M7 3.5 4 6H2v4h2l3 2.500zM10.5 6.500l3 3M13.5 6.500l-3 3"/></svg><svg class="on" viewBox="0 0 16 16" aria-hidden="true"><path d="M7 3.5 4 6H2v4h2l3 2.500zM10.5 6a3 3 0 0 1 0 4M12.5 4a5.6 5.6 0 0 1 0 8"/></svg>Sound</button>
  <button class="p-play" type="button" aria-label="Play"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10l8-5z"/></svg></button>
</figure>
<fieldset class="seg p-mode">
  <legend class="sr">Show the take before or after the cut</legend>
  <label><input type="radio" name="p-mode" value="before">Before <b data-t="before"></b></label>
  <label><input type="radio" name="p-mode" value="after" checked>After <b data-t="after"></b></label>
</fieldset>
<div class="p-track" aria-hidden="true"><i class="p-head"></i></div>
<div class="r-wrap"><ol class="receipt p-receipt" aria-label="Receipt for this cut"></ol></div>
<p class="p-hint"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 10.5 2.5 7 6 3.5"/><path d="M2.5 7h7a4 4 0 0 1 4 4v1.5"/></svg>Tap a line to bring that part back.</p>`;

/** data: { duration, segments: [{ s, e, reason?, demo? }], wave, waveStep, words: [[s, e, text]] }, times in seconds.
 *  cutSrc: the kept parts already joined, in order (the site's example), or none. */
export function mount(root, { src, cutSrc, poster, data, onRestore = () => {} }) {
  const D = data.duration, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = data.segments.map((sg) => ({ s: sg.s, e: sg.e, family: sg.reason ? familyOf(sg.reason, sg.demo) : null }));
  const lines = FAMILIES.map((f) => ({ ...f, parts: parts.filter((p) => p.family === f.key) })).filter((l) => l.parts.length)
    .map((l) => ({ ...l, t: Math.round(l.parts.reduce((n, p) => n + p.e - p.s, 0) * 10), label: l.counted && l.parts.length > 1 ? `${l.many} ×${l.parts.length}` : l.one }));
  const rawT = Math.round(D * 10), back = new Set();
  let mode = 'after', raf = 0, capKey = '', wanted = false, settle = 0; // wanted: the visitor wants it playing (not paused by them)
  const cutT = () => rawT - lines.reduce((n, l) => n + (back.has(l.key) ? 0 : l.t), 0);

  root.className = 'p paused';
  root.innerHTML = MARKUP; // fixed markup; every word and figure below goes in as text
  const q = (sel) => root.querySelector(sel);
  const v = q('video'), cap = q('.p-cap'), tc = q('.p-tc'), snd = q('.p-snd'), track = q('.p-track'), head = q('.p-head'), receipt = q('.p-receipt'), frame = q('.p-frame');
  if (poster) v.poster = poster;
  const vc = cutSrc ? v.cloneNode() : null; // the cut file, on show in After while no part is back; the take's video is .off
  if (vc) {
    vc.loop = true; v.classList.add('off'); v.after(vc); vc.src = cutSrc;
    // The take loads once the cut can play through, so the two don't split a slow connection (home.js does the reverse).
    v.preload = 'metadata'; vc.addEventListener('canplaythrough', () => { v.preload = 'auto'; }, { once: true });
  }
  v.src = src;
  for (const x of [v, vc]) x?.addEventListener('loadedmetadata', () => { if (x.videoWidth && x.videoHeight) frame.style.setProperty('--ar', (x.videoWidth / x.videoHeight).toFixed(4)); });

  // ---- time ----
  const plays = (p) => mode === 'before' || !p.family || back.has(p.family);
  const partAt = (t) => parts.find((p) => t < p.e) ?? parts[parts.length - 1];
  const firstPlaying = (from) => parts.find((p) => plays(p) && p.e > from + 0.02);
  const elapsed = (t) => { let acc = 0; for (const p of parts) { if (!plays(p)) continue; if (t < p.e) return acc + Math.max(0, t - p.s); acc += p.e - p.s; } return acc; };
  // The cut file's time for a time in the take, and back. A time in a removed part is the start of the next kept part.
  const kept = parts.filter((p) => !p.family);
  const toCut = (t) => { let acc = 0; for (const p of kept) { if (t < p.e) return acc + Math.max(0, t - p.s); acc += p.e - p.s; } return acc; };
  const toRaw = (c) => { let acc = 0; for (const p of kept) { if (c < acc + p.e - p.s) return p.s + c - acc; acc += p.e - p.s; } return kept.at(-1)?.e ?? 0; };
  const onCut = () => Boolean(vc) && mode === 'after' && !back.size;
  const now = () => (onCut() ? toRaw(vc.currentTime) : v.currentTime);

  // ---- the timeline: one block a part, and in it the take's loudness as thin bars, one every 3 points as on the app's
  // timeline (app/src/features/editor/timeline/geometry.ts), edge to edge with a 1-point seam between parts as there
  // (lane-draw.ts GAP). A part's bars are counted for the width it has in the mode on screen, so a short cut that fills
  // the track in After is drawn as finely as the whole take in Before. ----
  for (const p of parts) {
    p.el = document.createElement('div');
    p.el.className = 'p-part' + (p.family ? ' x' : '');
    p.el.style.setProperty('--g', (p.e - p.s).toFixed(3));
    track.insertBefore(p.el, head);
  }
  const PITCH = 3; // a 2-point bar and a 1-point gap
  /** How loud the take is from a to z seconds: the loudest sample they cover, or, for a bar narrower than a sample, the
   *  sound at its middle, between the two nearest samples (so neighbouring bars are not all one height). */
  const level = (a, z) => {
    const step = data.waveStep;
    if (z - a < step) {
      const x = Math.max(0, (a + z) / 2 / step - 0.5), k = Math.floor(x), f = x - k;
      return (data.wave[k] || 0) * (1 - f) + (data.wave[k + 1] ?? data.wave[k] ?? 0) * f;
    }
    let peak = 0;
    for (let k = Math.floor(a / step); k <= Math.min(data.wave.length - 1, Math.floor(z / step)); k++) peak = Math.max(peak, data.wave[k] || 0);
    return peak;
  };
  /** Counted once per change, never while the parts animate (the bars are flex: 1 and stretch with them). A part that
   *  shrinks keeps its bars until the timeline has settled, so they never thicken on the way; `now` counts every part. */
  function waves(now) {
    const w = track.clientWidth;
    if (!w) return;
    clearTimeout(settle);
    if (!now) settle = setTimeout(waves, 950, true); // .p-part's flex-grow runs 0.9 s
    // The parts on show share what the track has left after the seam after each but the last: a part's bars fill its
    // share, one every PITCH points.
    const shown = parts.filter(plays), total = shown.reduce((n, p) => n + p.e - p.s, 0), room = w - (shown.length - 1);
    for (const p of shown) {
      const len = p.e - p.s, bars = Math.max(1, Math.round(((len / total) * room + 1) / PITCH)); // rounded: a bar stays under 3.5 points, a part only a bar wide too
      if (p.bars === bars || (!now && bars < p.bars)) continue;
      p.bars = bars;
      p.el.replaceChildren(...Array.from({ length: bars }, (_, b) => {
        const bar = document.createElement('i');
        bar.style.setProperty('--a', `${Math.max(6, Math.round(level(p.s + (len * b) / bars, p.s + (len * (b + 1)) / bars) * 100))}%`);
        return bar;
      }));
    }
  }
  const resized = new ResizeObserver(() => waves(true));
  resized.observe(track);

  // ---- the receipt ----
  const row = (cls, label, value) => { const li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('span'); li.className = cls; a.textContent = label; b.textContent = value; li.append(a, b); return li; };
  const total = row('total', 'Your cut', '');
  receipt.append(row('head', 'Your video', tenths(rawT)));
  for (const l of lines) {
    l.li = document.createElement('li');
    l.li.className = 'x';
    l.btn = document.createElement('button');
    l.btn.type = 'button';
    l.btn.className = 'p-row';
    l.btn.innerHTML = `<span class="l"></span><span class="v"></span>${ICON.undo}${ICON.redo}${ICON.play}`;
    l.btn.firstChild.textContent = `− ${l.label}`;
    l.btn.children[1].textContent = tenths(l.t);
    l.btn.addEventListener('click', () => lineTap(l));
    const hot = (on) => () => { l.li.classList.toggle('hot', on); for (const p of l.parts) p.el.classList.toggle('hot', on); };
    l.li.addEventListener('pointerenter', hot(true)); l.li.addEventListener('pointerleave', hot(false));
    l.li.addEventListener('focusin', hot(true)); l.li.addEventListener('focusout', hot(false));
    l.li.append(l.btn);
    receipt.append(l.li);
  }
  receipt.append(total);
  q('.p-hint').hidden = !lines.length;

  // ---- captions: up to three words a line (the app's words_per_chunk), broken at pauses, punctuation and the edges of
  // cut parts ----
  const caps = [];
  for (const w of data.words ?? []) {
    const p = partAt(w[0] + 0.01), cur = caps[caps.length - 1];
    if (!cur || cur.p !== p || w[0] - cur.e > 0.45 || cur.w.length >= 3 || /[.?!,]$/.test(cur.w[cur.w.length - 1][2])) caps.push({ s: w[0], e: w[1], p, w: [w] });
    else { cur.w.push(w); cur.e = w[1]; }
  }
  function caption(t) {
    const line = mode === 'after' ? caps.find((l) => t >= l.s - 0.05 && t <= l.e + 0.35 && plays(l.p)) : null;
    let k = -1;
    if (line) line.w.forEach((w, j) => { if (t >= w[0]) k = j; });
    const key = line ? `${line.s}:${k}` : '';
    if (key === capKey) return;
    capKey = key;
    cap.replaceChildren(...(line ? line.w.flatMap((w, j) => { const s = document.createElement('span'); s.textContent = w[2]; if (j === k) s.className = 'on'; return j ? [' ', s] : [s]; }) : []));
  }

  // ---- drawing and playing ----
  function draw(t) {
    const p = partAt(t);
    if (plays(p)) head.style.transform = `translateX(${p.el.offsetLeft + Math.min(1, Math.max(0, (t - p.s) / (p.e - p.s))) * p.el.offsetWidth}px)`;
    tc.textContent = `${mm(elapsed(t))} / ${mm(mode === 'before' ? D : cutT() / 10)}`;
    if (mode === 'before') for (const l of lines) { const on = l.parts.includes(p); l.li.classList.toggle('hot', on); for (const x of l.parts) x.el.classList.toggle('hot', on && x === p); }
    caption(t);
  }
  function tick() {
    raf = requestAnimationFrame(tick);
    if (onCut()) return draw(toRaw(vc.currentTime)); // the cut file plays straight through, and loops
    let t = v.currentTime;
    if (!v.seeking) {
      const p = partAt(t), done = v.ended || t >= D - 0.04;
      // Over a part still cut, jump to the next one that plays; at the end, start again.
      if (done || !plays(p)) {
        const next = (done ? null : firstPlaying(p.e)) ?? firstPlaying(-1);
        if (next) { v.currentTime = t = next.s + 0.01; if (v.paused && wanted) v.play().catch(() => {}); }
      }
    }
    draw(t);
  }
  function play() {
    wanted = true;
    root.classList.remove('paused');
    q('.p-play').setAttribute('aria-label', 'Pause');
    cancelAnimationFrame(raf);
    const x = onCut() ? vc : v, other = x === v ? vc : v;
    other?.pause();
    // The other video leaves once this one shows the frame asked for: a seek still running would flash the frame it left.
    const swap = () => { if ((onCut() ? vc : v) === x) { x.classList.remove('off'); other?.classList.add('off'); } };
    if (x.seeking) x.addEventListener('seeked', swap, { once: true }); else swap();
    // A browser that refuses to start (sound on with no tap) shows the play button instead. A play() cut short by a pause
    // of ours (a drag on the timeline grabbing it) is not a refusal: the visitor still wants it playing.
    x.play().then(() => { raf = requestAnimationFrame(tick); }, (e) => { if (e?.name !== 'AbortError') pause(); });
  }
  function pause() {
    wanted = false;
    cancelAnimationFrame(raf);
    v.pause(); vc?.pause();
    root.classList.add('paused');
    q('.p-play').setAttribute('aria-label', 'Play');
    draw(now());
  }
  /** Puts the video on show at a time in the take (seconds); with no time, at the first part that plays. */
  function seek(at) {
    if (onCut()) vc.currentTime = toCut(at ?? 0) + 0.01; // + 0.01 s: the frame make-demo.py keys
    else v.currentTime = (at ?? firstPlaying(-1)?.s ?? 0) + 0.01;
  }
  /** Play from a time in the take (seconds); with no time, from the first part that plays. */
  function go(at) {
    seek(at);
    draw(now());
    play();
  }

  // ---- modes and lines ----
  function labels() {
    q('[data-t="before"]').textContent = mm(D);
    q('[data-t="after"]').textContent = mm(cutT() / 10);
    total.lastChild.textContent = tenths(cutT());
    root.classList.toggle('before', mode === 'before');
    for (const l of lines) {
      const isBack = back.has(l.key);
      l.li.classList.toggle('restored', isBack);
      l.btn.setAttribute('aria-label', `${mode === 'before' ? 'Play' : isBack ? 'Cut again:' : 'Bring back:'} ${l.label}, ${(l.t / 10).toFixed(1)} seconds`);
      for (const p of l.parts) { p.el.classList.toggle('gone', mode === 'after' && !isBack); p.el.classList.toggle('back', isBack); p.el.classList.remove('hot'); }
      if (mode === 'after') l.li.classList.remove('hot');
    }
    waves(); // the parts on show have changed: their bars are counted again for the width each will have
  }
  function lineTap(l) {
    if (mode === 'before') return go(l.parts[0].s); // Before: hear the part that was cut
    const isBack = !back.has(l.key);
    if (isBack) back.add(l.key); else back.delete(l.key);
    labels();
    onRestore({ reason: l.key, back: isBack });
    // Play from just before the first of its parts, so it is heard in place.
    const first = l.parts[0], from = Math.max(0, first.s - 1.5);
    go(isBack ? (plays(partAt(from)) ? from : first.s) : firstPlaying(first.e)?.s ?? firstPlaying(-1)?.s);
  }
  q('.p-mode').addEventListener('change', (e) => { mode = e.target.value; labels(); go(); });

  // ---- the timeline: a tap or a drag lands where it is made, playing or paused (site/README.md, "The timelines' taps") ----
  /** The take's time under the pointer, over the parts on show: the inverse of draw's playhead (a seam belongs to the part
   *  before it). Measured as drawn, to the fraction of a pixel: the seams are 1 point. */
  const timeAt = (x) => {
    const on = parts.filter(plays), p = on.find((_, i) => i === on.length - 1 || x < on[i + 1].el.getBoundingClientRect().left), r = p.el.getBoundingClientRect();
    return Math.min(p.e - 0.02, p.s + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (p.e - p.s)); // a seek's + 0.01 s stays in the part
  };
  const scrub = (x) => { seek(timeAt(x)); draw(now()); };
  // A mouse seeks as it presses and scrubs as it drags; a finger seeks when it lifts, or scrubs once it moves sideways, and
  // a finger that moves up or down is scrolling the page (.p-track is touch-action: pan-y), so it never moves the video.
  let press = null;
  const grab = (x, drag) => { press.on = true; if (drag) track.setPointerCapture(press.id); cancelAnimationFrame(raf); v.pause(); vc?.pause(); scrub(x); }; // a drag keeps the pointer past the track's ends
  const release = () => { const was = press?.on; press = null; if (was && wanted) play(); };
  track.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
    if (e.pointerType === 'mouse') grab(e.clientX, true);
  });
  track.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.on) { const dx = Math.abs(e.clientX - press.x), dy = Math.abs(e.clientY - press.y); if (dy > 8 && dy >= dx) { press = null; return; } if (dx <= 8) return; return grab(e.clientX, true); }
    scrub(e.clientX);
  });
  track.addEventListener('pointerup', (e) => { if (!press || e.pointerId !== press.id) return; if (!press.on) grab(e.clientX); release(); });
  track.addEventListener('pointercancel', release);
  frame.addEventListener('click', (e) => { if (e.target.closest('.p-snd')) return; if (wanted) pause(); else play(); });
  snd.addEventListener('click', () => { v.muted = !v.muted; if (vc) vc.muted = v.muted; snd.setAttribute('aria-pressed', String(!v.muted)); if (!v.muted && !wanted) play(); });
  v.addEventListener('ended', () => { if (wanted) go(); });

  labels();
  draw(0);
  return {
    /** Starts After from the top, muted (a browser lets a muted video start by itself). Under Reduce Motion it waits for a tap. */
    start() { seek(); if (reduce) draw(now()); else play(); },
    pause,
    cutSeconds: () => cutT() / 10,
    removals: lines.reduce((n, l) => n + l.parts.length, 0),
    destroy() { cancelAnimationFrame(raf); clearTimeout(settle); resized.disconnect(); for (const x of [v, vc]) if (x) { x.pause(); x.removeAttribute('src'); x.load(); } root.replaceChildren(); },
  };
}
