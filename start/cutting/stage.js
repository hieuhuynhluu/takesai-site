// The cutting view: the app's cutting screen on the visitor's own video (founder, 2026-11-21: "the cutting your video
// animation should mirror the in-app's one. all the details"). This file is the screen around the picture, after
// app/src/features/cutting/CuttingScreen.tsx and progress/CutAnimation.tsx; the picture itself is draw.js, a port of
// progress/draw.ts, and the step and the bar are progress.js, a port of stage-label.ts. Change the app first.
//
// What the web does differently, because it has to: the frames come from a <video> on the visitor's file, the sound is
// the audio.wav the page has just made, and the upload has no byte count (the bar creeps through step 1 as it does in
// the app while a job waits). There is no haptic.
import { easeInOut, easeOutExpo, seg } from './math.js';
import { bars as barsOf, loudness, speech as speechOf } from './sound.js';
import { keptText, marks, pieces, revealOf } from './reveal.js';
import { formatDuration, reconcileReceipt } from './duration.js';
import { cutEstimateMs, cutProgress, forget, percentOf, READY_STEP, stepLabel, stepTimes, STEPS } from './progress.js';
import { BARS, canvasPen, cycleMs, drawCut, geometry, schedule } from './draw.js';

const $ = (id) => document.getElementById(id);
/** What each step's work really is (CutAnimation.tsx DETAIL). Step 1 says only its label. */
const DETAIL = ['', 'Every word, timed', 'Retakes, ums and pauses', 'Each cut on an exact frame', 'Each join heard again'];
const FILL_MS = 600; // the bar's ease to a new value
const MAX_TAKES = 12; // step 3 compares at most this many stretches of speech
const STILL_MS = 4000; // after the ready moment begins, nothing moves again
const TICK_MS = 250; // how often the step and the bar are worked out (CuttingScreen.tsx)
const FRAMES = 12; // one per tile of the timeline (progress/frames.ts)
// The app's palette for the picture (app/src/ui/tokens.ts hexColors), which the site's own tokens equal or sit beside.
const PALETTE = {
  light: { bg: '#F6F6F7', label: '#0E0E10', second: '#55555B', third: '#6B6B71', fill: 'rgba(14,14,16,0.06)', sep: 'rgba(14,14,16,0.08)', tint: '#0E0E10', cut: '#C8243A' },
  dark: { bg: '#0A0A0B', label: '#F4F4F0', second: '#A8A8AD', third: '#8F8F95', fill: 'rgba(255,255,255,0.08)', sep: 'rgba(255,255,255,0.07)', tint: '#F4F4F0', cut: '#FF5A6A' },
};
// The receipt's measures (tokens.ts: receiptType, stripPadding, space), which the picture makes room by.
const ROW = 18 + 2 * 4, STRIP_PAD = 22, TOTAL_H = 34, TOOTH = 8, TEAR = 5;
/** Tips that are true on the web (the app's are about its editor: Tips.tsx). */
const TIPS = [
  'Anything the cut removed can go back in: tap its line on the receipt.',
  'Your video stays on this device. Only its sound is sent to make the cut.',
  'Want it snappier? In the app, pick Tight for shorter pauses.',
  'In the app, captions come on by themselves, and you choose their look.',
];
/** The animation's clock. Every picture is drawn from "how long since", so the browser tests run it faster. */
export const clock = { now: () => Date.now() };
const dark = matchMedia('(prefers-color-scheme: dark)'), still = matchMedia('(prefers-reduced-motion: reduce)');

const stage = $('c-stage'), canvas = $('c-canvas'), foot = $('c-foot'), detail = $('c-detail'), slip = $('c-slip'), feed = $('c-feed'), paper = $('c-paper');
const said = $('c-said'), saying = said.firstElementChild, tips = $('c-tips'), view = stage.closest('.s-view');
let pen = null, g2d = null;
let key = null, raf = 0, ticker = 0, late = 0, rest = 0, printing = [];
let size = { w: 0, h: 0 }, room = 0, dpr = 1;
let raw_ms = 0, sound = null, heard = { speech: [], takes: [], wash: false }, bars = [];
let video = null, frames = Array(FRAMES).fill(null), own = 0, grabbing = 0;
let input = null, upload = null, cut = null, reveal = null, revealAt = 0, cycles = [];
let progress = null, step = 0, times = [0], bar = { from: 0, to: 0, at: 0 }, drawnAt = 0, readyAt = null, onReady = null, returnedAt = 0;

// ---- the video itself, read on the device ----

/** Where there is speech, and the stretches step 3 compares (CutAnimation.tsx `heard`). */
function hear() {
  const loud = sound?.loud;
  if (!loud || size.w === 0 || raw_ms === 0) return { speech: [], takes: [], wash: false };
  // Stretches closer than six points run together; on a long video, until few enough are left to compare.
  let bridge = Math.max(500, (6 / size.w) * raw_ms);
  let speech = speechOf(loud, 100, bridge);
  while (speech.length > MAX_TAKES) speech = speechOf(loud, 100, (bridge *= 2));
  // Too few stretches to compare (one long take, or no speech heard): four equal windows of what there is.
  const [from, to] = speech.length > 0 ? [speech[0][0], speech[speech.length - 1][1]] : [0, raw_ms];
  const takes = speech.length >= 3 ? speech : Array.from({ length: 4 }, (_, i) => [from + ((to - from) * i) / 4, from + ((to - from) * (i + 1)) / 4]);
  // Pauses recede in step 3, unless they are nearly the whole take: then there would be nothing left to see.
  const spoken = speech.reduce((ms, [a, z]) => ms + z - a, 0);
  return { speech, takes, wash: spoken > 0.2 * raw_ms };
}

/** One frame of the video at `ms`, as a small canvas; null when the browser gives none. Safari hands a frame to a
 *  canvas only once it has shown it, so after the seek the picture waits for the frame to be presented, and a canvas
 *  that came out empty counts as no frame (seen on an iPhone, 2026-11-21: every tile was blank). */
function frameAt(ms) {
  return new Promise((done) => {
    const v = video;
    let over = false;
    const finish = (image) => { if (over) return; over = true; clearTimeout(timer); v.removeEventListener('seeked', seeked); done(image); };
    const take = () => {
      if (over) return;
      if (!v.videoWidth) return finish(null);
      const h = Math.round(300 * Math.min(2, devicePixelRatio || 1)), c = document.createElement('canvas');
      c.height = h; c.width = Math.max(1, Math.round((h * v.videoWidth) / v.videoHeight));
      try {
        const g = c.getContext('2d');
        g.drawImage(v, 0, 0, c.width, c.height);
        finish(g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0 ? c : null);
      } catch { finish(null); }
    };
    const seeked = () => {
      if (!v.requestVideoFrameCallback) return take();
      v.requestVideoFrameCallback(take);
      setTimeout(take, 300); // already presented, or the callback never comes: take what is there
    };
    const timer = setTimeout(() => finish(null), 4000);
    v.addEventListener('seeked', seeked);
    v.currentTime = ms / 1000;
  });
}
/** The cover first (every tile shows it until its own frame is made), then FRAMES pictures at even times, each the
 *  middle of its twelfth (frames.ts). A frame that can't be made is simply missing. */
async function grab(all) {
  const mine = ++grabbing, v = video;
  if (!v) return;
  if (v.readyState < 1) await new Promise((r) => { v.addEventListener('loadedmetadata', r, { once: true }); v.addEventListener('error', r, { once: true }); });
  if (mine !== grabbing || !v.videoWidth) return;
  if (raw_ms === 0) raw_ms = Math.round(v.duration * 1000) || 0;
  // Started once, muted and in the page: a video that has never played gives Safari nothing to draw.
  if (v.paused && v.played.length === 0) { try { await v.play(); } catch { /* not allowed: the frames may be missing */ } v.pause(); }
  if (mine !== grabbing) return;
  if (own === 0 && !frames[0]) {
    const cover = await frameAt(Math.min(100, Math.max(1, raw_ms - 1)));
    if (mine !== grabbing) return;
    if (cover && own === 0) frames = frames.map(() => cover);
  }
  if (!all || raw_ms === 0) return;
  const made = Array(FRAMES).fill(false);
  for (let i = 0; i < FRAMES; i++) {
    const image = await frameAt(Math.min(Math.max(0, raw_ms - 1), Math.round(((i + 0.5) * raw_ms) / FRAMES)));
    if (mine !== grabbing) return;
    if (!image) continue;
    made[i] = true;
    frames = frames.map((f, k) => (k === i ? image : f));
    own = made.filter(Boolean).length;
  }
}

// ---- the real cut, once it is here ----

function unveil() {
  if (!cut || size.w === 0) return null;
  const of = revealOf(cut.cutlist), moved = pieces(of.removed, of.raw_ms, size.w);
  // Whole seconds that add up: raw minus the lines is the cut.
  const { rawS, cutS, keptS } = reconcileReceipt(of.raw_ms, of.lines.map((l) => l.ms), of.cut_ms);
  return {
    scene: { gone: moved.gone, slivers: marks(of.removed.filter((s) => !moved.gone.includes(s)), of.raw_ms, size.w), kept: moved.kept, checked: !cut.cutlist.flags?.recheck_skipped },
    clean: of.removed.length === 0,
    raw: formatDuration(rawS * 1000),
    lines: of.lines.map((l, i) => ({ label: l.label, value: formatDuration(cutS[i] * 1000) })),
    kept: formatDuration(keptS * 1000),
    words: keptText(cut.transcript, moved.kept),
  };
}
/** The whole receipt's height before it prints, so the picture knows how much room to give it (CutAnimation.tsx). */
const receiptH = () => (reveal ? 3 + 2 * STRIP_PAD + (1 + reveal.lines.length) * ROW + 2 + 2 * 8 + TOTAL_H + 5 : 0);

function remake() {
  heard = hear();
  bars = sound ? barsOf(sound.loud, BARS) : [];
  reveal = unveil();
  print();
  cycles = cycleMs(raw_ms, heard.takes.length, reveal?.scene.kept.length ?? 1, reveal?.clean ?? false);
  saying.firstElementChild.textContent = reveal?.words ?? '';
}
function measure() {
  const r = stage.getBoundingClientRect();
  if (r.width === 0) return; // the step is left for a moment (Back): the cut goes on as it was last measured
  dpr = Math.min(3, devicePixelRatio || 1);
  if (r.width !== size.w || r.height !== size.h || canvas.width !== Math.round(r.width * dpr)) {
    size = { w: r.width, h: r.height };
    canvas.width = Math.max(1, Math.round(size.w * dpr)); canvas.height = Math.max(1, Math.round(size.h * dpr));
    g2d = canvas.getContext('2d');
    pen = canvasPen(g2d);
    remake();
  }
  room = tips.offsetHeight;
  saying.firstElementChild.style.width = `${Math.max(0, size.w - 40)}px`;
}

// ---- the step and the bar ----

function advance() {
  if (!key) return;
  clearTimeout(late);
  const now = clock.now(), was = step;
  progress = cutProgress(key, input, upload, cutEstimateMs(raw_ms), now, cycles, true, returnedAt);
  step = progress.step;
  times = stepTimes(key, step, progress.since);
  // Forward progress eases out; only a new cut draws it lower, at once.
  const shown = barAt(now);
  if (progress.fraction !== bar.to) bar = progress.fraction >= shown && !still.matches ? { from: shown, to: progress.fraction, at: now } : { from: progress.fraction, to: progress.fraction, at: 0 };
  if (step !== was) say();
  // A step the poll skipped is still shown; the next one comes when its time is up, poll or not.
  if (progress.behind) late = setTimeout(advance, Math.max(0, (progress.until ?? 0) - clock.now()) + 5);
  if (step === READY_STEP && readyAt === null) ready();
}
const barAt = (now) => (bar.at === 0 ? bar.to : bar.from + (bar.to - bar.from) * easeOutExpo(Math.min(1, (now - bar.at) / FILL_MS)));

/** The step's words: the old ones go, then the new ones print. The percent and the screen reader follow. */
function say() {
  const label = stepLabel(step), done = step >= READY_STEP, words = $('c-label');
  if (words.textContent !== label) {
    words.classList.remove('in'); void words.offsetWidth;
    words.textContent = label;
    words.classList.add('in');
  }
  $('c-detail-text').textContent = done ? '' : DETAIL[step - 1];
  $('c-stepof').textContent = done ? '' : `Step ${step} of ${STEPS.length}`;
  detail.hidden = done;
  $('busy-step').textContent = done ? `${label}. ${receiptWords()}` : `${label}, Step ${step} of ${STEPS.length}`;
}
const receiptWords = () => (reveal ? `Raw take ${reveal.raw}. ${reveal.lines.map((l) => `${l.label} removed, ${l.value}. `).join('')}Cut ${reveal.kept}.` : '');

// ---- the ready moment: the receipt prints one row at a time, and the total lands last ----

function row(className, label, value) {
  const li = document.createElement('div'), a = document.createElement('span');
  li.className = `c-row ${className}`;
  if (label == null) return li; // the rule
  a.textContent = label;
  li.append(a);
  if (value != null) { const b = document.createElement('span'); b.textContent = value; li.append(b); }
  return li;
}
function ready() {
  readyAt = times[READY_STEP - 1];
  view.classList.add('is-ready'); // the tips fade; the line and the button change with the picture
  onReady?.();
  print();
}
/** The receipt, once: when the ready moment has begun and the cut can be laid out. If the step was left before it was
 *  ever measured (Back, mid-cut), that is when the visitor comes back to it. */
function print() {
  if (!reveal || readyAt === null || printing.length) return;
  const at = schedule(reveal.clean), rows = [row('raw', 'Raw', reveal.raw), ...reveal.lines.map((l) => row('cut', `− ${l.label}`, l.value)), row('rule'), row('total', 'Cut', reveal.kept)];
  const when = (i) => (i === 0 ? at.raw : i < rows.length - 2 ? at.lines + at.line * (i - 1) : i === rows.length - 2 ? at.rule : at.total);
  const elapsed = (clock.now() - readyAt) / 1000;
  const feedOut = (el) => {
    slip.hidden = false;
    paper.append(el);
    if (!still.matches) el.classList.add('print');
  };
  paper.replaceChildren();
  printing = rows.map((el, i) => setTimeout(() => feedOut(el), Math.max(0, when(i) - elapsed) * 1000));
  // The raw length is struck once the cut's own length has landed.
  printing.push(setTimeout(() => rows[0].classList.add('struck'), Math.max(0, at.strike - elapsed) * 1000));
  // Once the ready moment has played, nothing in the picture moves again: the clock stops.
  rest = setTimeout(() => { cancelAnimationFrame(raf); raf = 0; draw(clock.now()); }, Math.max(0, Math.max(readyAt + STILL_MS, revealAt + 1000) - clock.now()));
}
/** The torn edge under the paper, a tooth every 8 points (receipt/strip.tsx). */
function tear() {
  const w = paper.offsetWidth, teeth = Math.max(1, Math.round(w / TOOTH)), tooth = w / teeth;
  let zigzag = '';
  for (let i = teeth; i > 0; i--) zigzag += `L${(i - 0.5) * tooth} ${TEAR}L${(i - 1) * tooth} 0`;
  const svg = $('c-tear');
  svg.setAttribute('width', w); svg.setAttribute('viewBox', `0 0 ${w} ${TEAR}`);
  svg.firstElementChild.setAttribute('d', `M0 0H${w}${zigzag}Z`);
}
/** A soft edge shows there is more of a long receipt above or below. */
function fades() {
  slip.style.setProperty('--above', Math.min(1, feed.scrollTop / 16));
  slip.style.setProperty('--below', Math.min(1, (feed.scrollHeight - feed.clientHeight - feed.scrollTop) / 16));
}
feed.addEventListener('scroll', fades, { passive: true });
// A long receipt feeds up like a till roll as it prints, so the newest line and the total stay in view.
new ResizeObserver(() => { tear(); feed.scrollTop = feed.scrollHeight; fades(); }).observe(paper);

// ---- one picture ----

function draw(now) {
  if (!pen || size.w === 0) return;
  const scene = {
    w: size.w, h: size.h, lift: 0, y0: 0, room, receiptH: receiptH(), scale: 1, raw_ms, bars, heard_at: sound?.at ?? 0, reveal_at: revealAt,
    speech: heard.speech, takes: heard.takes, wash: heard.wash, times, now, step: Math.max(1, step), fraction: barAt(now), reduced: still.matches,
    frames, varied: own >= 2, reveal: reveal?.scene ?? null, colors: PALETTE[dark.matches ? 'dark' : 'light'],
  };
  g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  g2d.clearRect(0, 0, size.w, size.h);
  drawCut(pen, scene);
  // The words sit under the rollout, and the receipt under them; both follow the picture when it makes room.
  const g = geometry(scene), percent = percentOf(progress?.fraction ?? 0);
  foot.style.transform = `translateY(${g.footY}px)`;
  detail.style.opacity = 1 - g.settle;
  // The bar's number bows out as the total comes in: the cut's length is the one figure at the end.
  const pct = $('c-pct');
  if (pct.textContent !== `${percent}%`) { pct.textContent = `${percent}%`; stage.setAttribute('aria-valuenow', percent); }
  pct.style.opacity = g.R < 0 ? 1 : 1 - seg(g.R, g.at.total - 0.25, g.at.total);
  slip.style.transform = `translateY(${g.footY + g.foot + 4}px)`;
  // The receipt never reaches the button under the screen: it may grow to the foot of the tip card's slot.
  feed.style.maxHeight = `${Math.max(96, size.h + room - g.footY - g.foot - 10)}px`;
  // The visitor's own words print under the stitched strip as the check runs over it.
  said.style.transform = `translateY(${g.speechY - 4}px)`;
  said.style.opacity = seg(g.check, 0, scene.reduced ? 0.25 : 0.12);
  saying.style.width = `${scene.reduced ? size.w - 40 : (size.w - 40) * easeInOut(g.check)}px`;
}
function loop() {
  raf = requestAnimationFrame(loop);
  const now = clock.now();
  // Under Reduce Motion nothing travels, so ten pictures a second are plenty.
  if (still.matches && now - drawnAt < 100) return;
  drawnAt = now;
  draw(now);
}

// ---- for cut.js ----

/** Starts the screen for a new cut. `url`: the visitor's video, or null when the page was reloaded mid-cut (no frames,
 *  no sound: the cover-less strip, the step and the bar). `ready`: called as the ready moment begins. */
export function open({ url = null, ready: whenReady = null } = {}) {
  close();
  key = `cut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  onReady = whenReady;
  input = { status: 'sending', failure_code: null, job: null, cut_duration_ms: null };
  view.classList.remove('is-ready');
  slip.hidden = true; paper.replaceChildren();
  tip(0);
  if (url) {
    video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto', className: 'c-source', tabIndex: -1 });
    for (const a of ['muted', 'playsinline', 'aria-hidden']) video.setAttribute(a, a === 'aria-hidden' ? 'true' : '');
    video.src = url;
    stage.append(video); // in the page, unseen: Safari decodes frames only for a video that is
    grab(false);
  }
  // The view has just been shown: measured once it is laid out.
  requestAnimationFrame(() => { if (!key) return; measure(); advance(); say(); });
  ticker = setInterval(() => { measure(); advance(); }, TICK_MS);
  if (!raf) loop();
}
/** The audio.wav the page made and the video's exact length: the bars rise, and the frames are made. */
export function setSound(wav, duration_ms) {
  if (!key) return;
  raw_ms = duration_ms;
  try { sound = { loud: loudness(wav), at: clock.now() }; } catch { sound = null; } // no sound: the bars stay stubs
  remake();
  grab(true);
}
/** The job as last seen ({ state, stage, failure_code }), and how much of the upload has gone (0 to 1, or null). */
export function setJob(job, sent = upload) {
  if (!key) return;
  input = { ...input, status: job ? 'cutting' : 'sending', job };
  upload = sent;
  advance();
}
/** The real cut is here: steps 4 and 5 draw it, then the ready moment. False when it can't be drawn. `back`: the cut
 *  was made on an earlier visit, so its steps are not played again: the ready moment at once, already over (the app's
 *  rule for a cut that finished while its creator was away, stage-label.ts). */
export function setCut(cutlist, transcript, back = false) {
  if (!key) return false;
  try {
    // Read here what the reveal will read, so a cut it cannot use is refused before the reveal begins.
    keptText(transcript, pieces(revealOf(cutlist).removed, 1, 1).kept);
  } catch { return false; }
  cut = { cutlist, transcript };
  revealAt = clock.now();
  if (back) returnedAt = revealAt;
  input = { ...input, status: 'ready', job: { state: 'ready', stage: null, failure_code: null }, cut_duration_ms: cutlist.paces[cutlist.default_pace].metrics.output_ms };
  remake();
  advance();
  return true;
}
/** The screen is left (Stop, a failure, the player): the clock stops and this cut's bar is forgotten. */
export function close() {
  cancelAnimationFrame(raf); raf = 0;
  clearInterval(ticker); clearTimeout(late); clearTimeout(rest); printing.forEach(clearTimeout); printing = [];
  if (key) forget(key);
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null; }
  grabbing++;
  key = null; onReady = null;
  raw_ms = 0; sound = null; bars = []; heard = { speech: [], takes: [], wash: false };
  frames = Array(FRAMES).fill(null); own = 0;
  input = null; upload = null; cut = null; reveal = null; revealAt = 0; cycles = [];
  progress = null; step = 0; times = [0]; bar = { from: 0, to: 0, at: 0 }; readyAt = null; returnedAt = 0;
}
export const isOpen = () => key !== null;

// ---- the tip card (Tips.tsx): something true to read while the cut runs ----
let shownTip = 0;
function tip(i) {
  shownTip = (i + TIPS.length) % TIPS.length;
  $('c-tip-n').textContent = `Tip ${shownTip + 1} of ${TIPS.length}`;
  const shown = $('c-tip');
  shown.classList.remove('in'); void shown.offsetWidth;
  shown.textContent = TIPS[shownTip];
  shown.classList.add('in');
}
// Every tip, unseen, in one cell: the card is as tall as the longest, so stepping through them moves nothing above.
$('c-tip-sizer').replaceChildren(...TIPS.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
tips.addEventListener('click', (e) => { const by = e.target.closest('[data-tip]')?.dataset.tip; if (by) tip(shownTip + Number(by)); });
addEventListener('resize', () => { if (key) { measure(); if (!raf) draw(clock.now()); } });
