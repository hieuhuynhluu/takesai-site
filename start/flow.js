// The web onboarding's steps, answers and screens 1 to 7 (spec 018). Step 8 is cut.js.
// Figures and words come from maths.js, the port of the app's own; this file only puts them on the page.
import * as m from './maths.js';
import { track, setStep } from './track.js';
import * as cut from './cut.js';

const STEPS = ['who', 'goal', 'videos', 'edit-time', 'savings', 'clock', 'target', 'cut'];
const KEY = 'takesai.start';
const TIER_NAME = { starter: 'Starter', pro: 'Pro', ultimate: 'Ultimate' };
const $ = (id) => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- The answers (data-model.md section 1): read back with nothing taken on trust ----
function load() {
  let raw = null;
  try { raw = JSON.parse(sessionStorage.getItem(KEY)); } catch { /* blocked or damaged: start fresh */ }
  if (!raw || raw.v !== 1) raw = {};
  const stop = (stops, v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? stops[m.stopIndex(stops, v)].value : undefined);
  return {
    v: 1,
    persona: m.PERSONAS.includes(raw.persona) ? raw.persona : undefined,
    goal: m.GOALS.includes(raw.goal) ? raw.goal : undefined,
    videos_per_day: stop(m.VIDEO_STOPS, raw.videos_per_day),
    edit_minutes: stop(m.EDIT_STOPS, raw.edit_minutes),
    target_videos_per_day: stop(m.VIDEO_STOPS, raw.target_videos_per_day),
    reached: STEPS.includes(raw.reached) ? raw.reached : STEPS[0],
  };
}
const state = load();
function save(patch) {
  Object.assign(state, patch);
  // A target is never below today's answer.
  if (state.target_videos_per_day != null && state.target_videos_per_day < now()) state.target_videos_per_day = undefined;
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked: the answers last for this page */ }
}
const now = () => state.videos_per_day ?? m.DEFAULT_VIDEOS_PER_DAY;
const edit = () => state.edit_minutes ?? m.DEFAULT_EDIT_MINUTES;
/** The minutes a video steps 5 to 7 count: the answer, up to a waking day's editing (maths.js countedEdit). */
const counted = () => m.countedEdit(now(), edit());
/** The promise as later screens read it back ("35 a week"), or null before one is made. */
const echo = () => (state.target_videos_per_day == null ? null
  : m.targetScreen({ nowPerDay: now(), targetPerDay: state.target_videos_per_day, editMinutes: counted() }).goalWeek);
// A plan and period chosen before the quiz (the home page's plan picker sends them when its QUIZ_ON is true). Each is one of a fixed list or ignored.
const HERE = new URLSearchParams(location.search), ORDER = ['starter', 'pro', 'ultimate'];
const asked = { plan: ORDER.find((t) => t === HERE.get('plan')), period: ['monthly', 'yearly'].find((p) => p === HERE.get('period')) };
/** The plan the answers ask for, or the visitor's own choice when that is the bigger one: the plan named always covers the target. */
const plan = () => { const t = m.planFor(now(), state.target_videos_per_day ?? null).tier; return ORDER.indexOf(asked.plan) > ORDER.indexOf(t) ? asked.plan : t; };

/** The existing checkout, opened with the plan (above), the period the visitor chose or monthly, and their own ref or code (FR-007). */
function checkoutUrl() {
  const q = new URLSearchParams({ plan: plan(), period: asked.period ?? 'monthly' });
  for (const k of ['ref', 'code']) { const v = HERE.get(k); if (v) q.set(k, v.slice(0, 80)); }
  return '../checkout/?' + q;
}

// ---- Steps, the hash and the history ----
let current = null, depth = history.state?.start ?? 0, moving = 0, shownAt = 0;
const sectionOf = (step) => document.querySelector(`.s-step[data-step="${step}"]`);
/** A step can be opened once every step before it has been shown; anything else opens the furthest one reached. */
function resolve(name) {
  const i = STEPS.indexOf(name), max = STEPS.indexOf(state.reached);
  return STEPS[i < 0 ? max : Math.min(i, max)];
}
function go(step) {
  if (STEPS.indexOf(step) > STEPS.indexOf(state.reached)) save({ reached: step });
  history.pushState({ start: ++depth }, '', '#' + step);
  show(step);
}
function show(step, initial = false) {
  if (moving) { clearTimeout(moving); moving = 0; } // Back pressed right after a tap: the tap's move is dropped
  if (step === current) return;
  const i = STEPS.indexOf(step), from = STEPS.indexOf(current), max = STEPS.indexOf(state.reached), el = sectionOf(step);
  if (current === 'cut') cut.leave();
  current = step;
  shownAt = performance.now();
  for (const s of document.querySelectorAll('.s-step')) s.hidden = s !== el;
  [...$('rail').children].forEach((seg, k) => { seg.className = k === i ? 'now' : k <= max ? 'on' : ''; });
  $('rail').setAttribute('aria-valuenow', i + 1);
  $('rail').setAttribute('aria-valuetext', `Step ${i + 1} of 9`);
  $('count').textContent = `${i + 1}/9`;
  $('back').hidden = i === 0;
  $('skip').hidden = true; // step 8 shows it (cut.js)
  $('count').hidden = false;
  RENDER[step]?.();
  el.classList.remove('enter', 'back');
  if (!initial) { void el.offsetWidth; el.classList.add('enter'); el.classList.toggle('back', i < from); }
  scrollTo(0, 0);
  if (!initial && step !== 'cut') el.querySelector('h1').focus({ preventScroll: true }); // the cut step focuses its own view
  setStep(step);
  track('start_step_viewed', { n: i + 1 });
}
addEventListener('popstate', () => { depth = history.state?.start ?? 0; show(resolve(location.hash.slice(1))); });
$('back').addEventListener('click', () => {
  const i = STEPS.indexOf(current);
  if (i <= 0) return;
  if (depth > 0) history.back();
  else { history.replaceState({ start: 0 }, '', '#' + STEPS[i - 1]); show(STEPS[i - 1]); } // opened straight on this step
});

// ---- Screens 1 and 2: a tap answers and moves on ----
for (const group of document.querySelectorAll('.s-opts')) {
  group.addEventListener('click', (e) => {
    const b = e.target.closest('.s-opt');
    if (!b || moving) return;
    const question = group.dataset.question;
    save({ [question]: b.dataset.value });
    mark(group);
    track('start_answered', { question, answer: b.dataset.value });
    // The choice shows as chosen for a beat, then the next question comes.
    moving = setTimeout(() => { moving = 0; go(STEPS[STEPS.indexOf(current) + 1]); }, reduce ? 0 : 240);
  });
}
function mark(group) {
  for (const b of group.querySelectorAll('.s-opt')) b.setAttribute('aria-pressed', b.dataset.value === state[group.dataset.question]);
}

// ---- Screens 3 and 4: sliders over the app's stops ----
/** The thumb is 30 px wide, so the fill ends at its centre, not at the bare percentage. */
const fill = (r) => r.style.setProperty('--p', `calc(${+r.max ? r.value / r.max : 0} * (100% - 30px) + 15px)`);
/** `after(stop)` runs on every paint, for a line that follows the answer. */
function slider(prefix, stops, field, value, after) {
  const r = $(prefix + '-r');
  const paint = () => {
    const s = stops[+r.value];
    $(prefix + '-n').textContent = s.number;
    $(prefix + '-u').textContent = s.unit;
    r.setAttribute('aria-valuetext', `${s.spoken ?? s.number} ${s.unit}`);
    fill(r);
    after?.(s);
  };
  r.max = stops.length - 1;
  r.value = m.stopIndex(stops, value());
  r.oninput = () => { paint(); save({ [field]: stops[+r.value].value }); };
  paint();
  return () => stops[+r.value].value;
}
let videosValue, editValue;

// ---- Receipts ----
/** rows: [label, value, kind?]; kind is 'cut', 'total' or 'head'. Text only, so nothing typed or stored is ever markup. */
function receipt(ul, rows) {
  ul.replaceChildren(...rows.map(([label, value, kind], i) => {
    const li = document.createElement('li'), a = document.createElement('span');
    if (kind) li.className = kind;
    li.style.setProperty('--i', i);
    a.textContent = (kind === 'cut' ? '− ' : '') + label;
    li.append(a);
    if (value instanceof Node) li.append(value); else if (value != null) { const b = document.createElement('span'); b.textContent = value; li.append(b); }
    return li;
  }));
  ul.classList.remove('print'); void ul.offsetWidth; ul.classList.add('print');
}
/** Safari repaints only a box around a changing figure, which leaves holes in the drop-shadow of the slip it sits on
 *  (seen on an iPhone, 2026-11-20). Taking the filter off and on in one go has the whole slip painted once more. */
function repaint(wrap) { if (wrap) { wrap.style.filter = 'none'; void wrap.offsetWidth; wrap.style.filter = ''; } }
/** A total counts up to its figure once. Tabular figures, so nothing around it moves. */
function count(el, to, format) {
  if (reduce || !to) { el.textContent = format(to); return; }
  const t0 = performance.now() + 450, ms = 900;
  el.textContent = format(0);
  (function step(t) {
    const p = Math.min(1, Math.max(0, (t - t0) / ms)), e = 1 - Math.pow(1 - p, 4);
    el.textContent = format(p === 1 ? to : to * e);
    if (p < 1 && el.isConnected) requestAnimationFrame(step); else repaint(el.closest('.r-wrap'));
  })(performance.now());
}
const cents = (dollars) => `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RENDER = {
  who: () => mark(sectionOf('who').querySelector('.s-opts')),
  goal: () => mark(sectionOf('goal').querySelector('.s-opts')),
  videos: () => { videosValue = slider('videos', m.VIDEO_STOPS, 'videos_per_day', now); },
  // More than a waking day of editing is counted as a waking day from here on, and the step says so as it is answered.
  'edit-time': () => {
    editValue = slider('edit', m.EDIT_STOPS, 'edit_minutes', edit, (s) => { const note = $('edit-cap'); note.textContent = m.capNote(now(), s.value); note.hidden = !note.textContent; });
  },

  // The app's savings screen (savings.tsx): two receipts whose lines add up to their totals.
  savings() {
    const f = m.savings(now(), counted()), e = counted();
    const editorCost = f.videosPerMonth * m.EDITOR_PER_VIDEO, price = m.TIERS[f.tier].monthly_price;
    const { handMin, appMin, whole, backMin } = m.receiptMonth(f.videosPerMonth, e);
    const timeValue = (min) => m.keepUnits(whole ? `${Math.round(min / 60).toLocaleString('en-US')} h` : m.formatTime(min, { exact: true }));
    const saved = Math.max(0, editorCost - price);
    $('savings-day').textContent = m.keepUnits(m.formatTime(f.spentMinutesDay));
    receipt($('savings-time'), [
      [m.keepUnits(`By hand, ${f.videosPerMonth} × ${m.formatTime(e)}`), timeValue(handMin)],
      [m.keepUnits(`TakesAI, ${f.videosPerMonth} × ${m.APP_MINUTES_PER_VIDEO} min`), timeValue(appMin), 'cut'],
      ['Time back a month', '', 'total'],
    ]);
    count($('savings-time').lastChild.lastChild, backMin, timeValue);
    receipt($('savings-money'), [
      [m.keepUnits(`Editor, ${f.videosPerMonth} × $${m.EDITOR_PER_VIDEO}`), cents(editorCost)],
      [`TakesAI ${TIER_NAME[f.tier]}`, cents(price), 'cut'],
      ['Saved a month', '', 'total'],
    ]);
    count($('savings-money').lastChild.lastChild, saved, cents);
    $('savings-notes').replaceChildren(...[
      `Editing by hand takes you about ${m.formatTime(e)} a video. With TakesAI, about ${m.APP_MINUTES_PER_VIDEO} minute.`,
      m.capNote(now(), edit()),
      `An editor charges about $${m.EDITOR_PER_VIDEO} a video.`,
      `TakesAI ${TIER_NAME[f.tier]} is $${price} a month.`,
    ].filter(Boolean).map((line) => Object.assign(document.createElement('li'), { textContent: line })));
  },

  // The app's clock screen (clock.tsx): the year as a receipt, its editing days in red, the days TakesAI gives back struck
  // through, and the plan for these answers at its price a day (maths.js clockScreen).
  clock() {
    const c = m.clockScreen(now(), counted()), y = c.marks, card = $('clock-year'), svg = $('clock-marks');
    const span = (text) => Object.assign(document.createElement('span'), { textContent: text });
    $('clock-h').textContent = c.title;
    $('clock-keep').replaceChildren(c.keep[0], Object.assign(document.createElement('strong'), { textContent: c.keep[1] }), c.keep[2]);
    $('clock-price').textContent = c.price;
    $('clock-head').replaceChildren(...c.head.map(span));
    $('clock-foot').replaceChildren(...c.foot.map(span));
    svg.setAttribute('viewBox', `-3 -1 ${y.width + 6} ${y.height + 2}`); // the strikes reach 2 units past the marks
    for (const k of ['days', 'kept', 'back']) svg.querySelector('.' + k).setAttribute('d', y[k]);
    card.setAttribute('aria-label', c.label);
    // Each row given back: its days still solid red, and the pen's stroke across it (start.css .s-year).
    const path = (cls, d) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('class', cls); p.setAttribute('d', d); return p; };
    svg.querySelectorAll('.row').forEach((p) => p.remove());
    const rows = y.rows.map((r) => {
      const solid = path('row solid', r.back), pen = path('row strike', r.strike);
      pen.style.strokeDasharray = r.length;
      svg.append(solid, pen);
      return [solid, pen, r.length];
    });
    // The motion (maths.js yearMotion), from the start each time the step shows. Without it (Reduce Motion, or no Web
    // Animations) the receipt is simply there, finished: every animation runs from a state back to the page's own.
    const parts = [$('clock-head'), $('clock-foot'), $('clock-keep'), $('clock-price'), svg];
    parts.flatMap((el) => el.getAnimations?.({ subtree: true }) ?? []).forEach((a) => a.cancel()); // older Safari has animate() only
    if (reduce || !svg.animate) return;
    const t = m.yearMotion(rows.length), out = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const at = (el, frames, delay, duration, easing = out) => el.animate(frames, { delay, duration, easing, fill: 'backwards' });
    const drop = [{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'none' }];
    at($('clock-head'), drop, 0, 300);
    at(svg, [{ transform: 'translateY(-100%)' }, { transform: 'none' }], t.feed, t.feedFor); // fed out of the rule (.s-feed)
    at($('clock-foot'), drop, t.foot, 300);
    rows.forEach(([solid, pen, length], i) => {
      at(solid, [{ opacity: 1 }, { opacity: 0 }], t.cut + i * t.row, t.row, 'linear');
      at(pen, [{ strokeDashoffset: length }, { strokeDashoffset: 0 }], t.cut + i * t.row, t.row, 'linear');
    });
    const rise = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
    at($('clock-keep'), rise, t.payoff, 450);
    at($('clock-price'), rise, t.payoff + 120, 450);
  },

  // The app's target screen (target.tsx): question 3's slider again, from today's answer up, in videos a week.
  target() {
    const stops = m.targetStops(now()), shown = m.weekStops(stops), r = $('target-r');
    r.max = stops.length - 1;
    r.value = state.target_videos_per_day == null ? m.openingStop(state.goal, stops.length) : m.stopIndex(stops, state.target_videos_per_day);
    $('target-slide').hidden = stops.length <= 1; // already at the top stop: no higher number to pick
    $('target-min').textContent = `${shown[0].number} a week, now`;
    $('target-tear').classList.remove('torn');
    $('target-go').disabled = false;
    const paint = (print) => {
      const i = +r.value;
      const s = m.targetScreen({ persona: state.persona, goal: state.goal, nowPerDay: now(), targetPerDay: stops[i].value, editMinutes: counted() });
      $('target-h').textContent = s.title;
      $('target-lead').textContent = s.lead;
      $('target-n').textContent = shown[i].number;
      $('target-c').textContent = shown[i].caption ?? '';
      r.setAttribute('aria-valuetext', `${shown[i].number} a week`);
      fill(r);
      const rows = s.receipt.rows.map((row) => {
        const pair = document.createElement('span'), was = document.createElement('s'), nowB = document.createElement('b');
        pair.className = 'pair'; was.textContent = row.was; nowB.textContent = row.now;
        pair.setAttribute('aria-label', `by hand ${row.was}, in TakesAI ${row.now}`);
        pair.append(was, nowB);
        return [row.label, pair];
      });
      const ul = $('target-receipt'), printed = ul.classList.contains('print');
      receipt(ul, [['Editing', null, 'head'], ...rows, [s.receipt.total.label, s.receipt.total.value, 'total']]);
      if (!print && printed) for (const li of ul.children) li.style.animation = 'none'; // moving the slider reprints nothing
      $('target-go').textContent = s.button;
      return { stop: stops[i].value, more: s.moreWeek };
    };
    r.oninput = () => paint(false);
    paint(true);
    $('target-go').onclick = () => {
      if (tooSoon()) return;
      const { stop, more } = paint(false);
      save({ target_videos_per_day: stop });
      track('start_answered', { question: 'target', answer: stop, more_a_week: more });
      $('target-go').disabled = true;
      // The promise tears the receipt off; the first cut is the reward on the next screen.
      const tear = $('target-tear');
      let left = false;
      const next = () => { if (!left) { left = true; go('cut'); } };
      if (reduce) return next();
      tear.addEventListener('animationend', next, { once: true });
      setTimeout(next, 900); // the animation is CSS's to run or not (Reduce Motion switched on mid-visit): never wait on it alone
      tear.classList.add('torn');
    };
  },

  cut() {
    const tier = plan(), goalWeek = echo();
    for (const a of document.querySelectorAll('[data-checkout]')) a.href = checkoutUrl();
    cut.open({ goalWeek, planLine: `${TIER_NAME[tier]} covers ${goalWeek ?? 'what you post now'}.`, checkoutUrl, track });
  },
};

/** A second tap of a double tap lands on the next screen's button, which sits in the same place: it would answer a
 *  question, or make the promise, unseen. */
const tooSoon = () => performance.now() - shownAt < 350;
document.addEventListener('click', (e) => {
  const next = e.target.closest('[data-next]');
  if (next) {
    if (tooSoon()) return;
    // Saved here too, so an untouched slider still stores its default (as in the app).
    if (current === 'videos') { save({ videos_per_day: videosValue() }); track('start_answered', { question: 'videos_per_day', answer: Math.round(videosValue() * 100) / 100 }); }
    if (current === 'edit-time') { save({ edit_minutes: editValue() }); track('start_answered', { question: 'edit_minutes', answer: editValue() }); }
    return go(STEPS[STEPS.indexOf(current) + 1]);
  }
  const out = e.target.closest('a[data-checkout]');
  if (out) track('start_checkout_opened', { plan: plan(), from: out.dataset.checkout });
});
$('savings-why').addEventListener('toggle', (e) => { if (e.target.open) track('start_assumptions_opened'); });

// Pages the app opens never start the flow (FR-008): site.js has marked them from-app and the notice shows instead.
if (!document.documentElement.classList.contains('from-app')) {
  // The reward is named only where it can be given (W3); otherwise the page's own line stands, which promises the example.
  if (cut.offered) $('who-lead').textContent = 'Four quick questions. Then we cut one of your videos, free.';
  const first = resolve(location.hash.slice(1) || state.reached);
  history.replaceState({ start: depth }, '', '#' + first);
  show(first, true);
  document.documentElement.classList.remove('s-wait'); // index.html's mark for a reload on a later step
}
