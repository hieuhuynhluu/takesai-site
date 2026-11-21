// The cutting animation's picture for one instant: a port of the app's draw.ts (app/src/features/cutting/progress/),
// line for line, with Skia replaced by a small pen (canvasPen below is the real one, on a 2D canvas). Same names, same
// order, same constants, so the two can be read side by side. site/tools/start/test-cutting.mjs draws thousands of
// scenes with both and fails on any difference: change the app's file and this one together.
//
// The creator's video is rolled out as a timeline of its own frames with its sound under it; the engine's work is
// shown on that timeline, and at ready the real cut is made on it. Everything is a pure function of the scene and the
// clock, so a redraw at any time draws the right picture with no saved state.
//
// The honesty rule (contracts/job-api.md section 2.4): before the cut list is on the page, a moving head is the
// engine at work and claims no position, and the only marks that stay are what the page itself can hear (sound,
// speech, pauses). Cut positions and joins are drawn only from `reveal`.
import { clamp, easeIn, easeInOut, easeOut, easeOutExpo, frac, lerp, seg, spring } from './math.js';
import { STEPS } from './progress.js';

export const BARS = 120;

/** The ready moment, in seconds after it begins: the receipt prints one row at a time and the total lands last. Steps
 *  4 and 5 have already cut, joined and checked the real cut on the strip. A clean take (nothing was removed) has no
 *  cut lines and nothing struck. */
export const schedule = (clean) => {
  const never = 1e6;
  return clean
    ? { raw: 0.2, lines: never, line: 0, rule: 0.45, total: 0.6, strike: never }
    : { raw: 0.2, lines: 0.45, line: 0.16, rule: 1.2, total: 1.35, strike: 1.65 };
};

/** The bar's notches: where each step ends; the last step ends the bar. */
const NOTCHES = STEPS.map((step, i) => (i === STEPS.length - 1 ? 1 : step.end));
const GAP = 32; // between the monitor and the lane: room for the A and B chips
const WAVE = 36;
/** At ready the ruler's rows close up, all but the line the creator's own words print on. */
const CLOSE = 12;
/** The step's line under the rollout: its words and the bar's number, the bar, then what the work really is. At ready
 *  the last row goes. In points at the default text size; `scale` grows it with the creator's text size. */
const FOOT = 58;
const FOOT_READY = 36;
/** The smallest monitor worth showing: a stage too short for it has none, and the cover is one tile of the lane. */
const MONITOR = 64;

// ---- each step's picture in time: when it starts after its step begins, and how long one full cycle lasts ----
/** Seconds after its step begins that each step's picture starts, by step number. */
const START = [0, 0, 0.75, 0.5, 0.15, 0.3];
/** Step 2: one reading pass at a steady speed. */
const passOf = (raw_ms) => clamp(raw_ms / 7500, 4, 20);
/** Step 3: each pair of neighbouring takes. */
const PAIR = 1.2;
/** Step 4 on the real cut, in seconds after step 4 begins: brackets drop round each kept piece, one after another;
 *  the removed spans are marked, then fall away; the kept pieces close up into one, which is the join. A clean take
 *  has nothing to remove: bracketed, it rests. */
const storyOf = (pieces, clean) => {
  const edges = 2 * pieces;
  const stagger = Math.min(0.16, 2 / Math.max(1, edges));
  const mark = START[4] + edges * stagger + 0.4;
  return clean ? { stagger, mark, toss: 1e6, stitch: 1e6, end: mark + 0.4 } : { stagger, mark, toss: mark + 0.85, stitch: mark + 1.7, end: mark + 2.8 };
};
/** Step 5: the check runs over the joined cut once, in this many seconds, ticking each join; then it rests. */
const CHECK = 1.2;

/** One full cycle of each step's picture, in milliseconds by step number (none for step 1, which is the send). The
 *  screen shows every step at least this long, so the whole flow plays every time (progress.js). `takes`: the
 *  stretches step 3 compares; `pieces`: the kept pieces of the real cut. */
export function cycleMs(raw_ms, takes, pieces, clean) {
  return [0, 0, START[2] + passOf(raw_ms), START[3] + PAIR * Math.max(1, takes - 1), storyOf(pieces, clean).end, START[5] + CHECK + 0.5].map((sec) => sec * 1000);
}

// The scene (the app's Scene type, without `font`: the pen measures and draws text):
//   w, h, lift, y0   The stage, in points. `h` is the height the picture is laid out for; it holds still through the
//                    reveal. `lift` is how much taller the view is than `h` (room above the picture, which is drawn
//                    at the view's foot). `y0` is where the stage's top is in the picture's box.
//   room             How far under the stage the receipt may print.
//   receiptH         The whole receipt's height; 0 until there is one.
//   scale            The creator's text size, capped (1 to 1.4).
//   raw_ms           The video's length.
//   bars             BARS loudness values, 0 to 1; empty until the page has read the sound.
//   heard_at         When the page read the sound (milliseconds since the epoch): the bars rise from then.
//   reveal_at        When the real cut arrived while the screen showed (0: it was there from the first frame): it
//                    fades in from then.
//   speech, wash     Where the page hears speech, [from_ms, to_ms]; the pauses between recede from step 3 when `wash`.
//   takes            The stretches step 3 compares, two neighbours at a time: the speech, or equal windows of it.
//   times, now       When each step up to `step` began (progress.js stepTimes), and now, in milliseconds.
//   step             1 to 5, or 6 once the cut is stored.
//   fraction         The bar, 0 to 1 (already eased). In step 1 the sound fills with it.
//   reduced          Reduce Motion.
//   frames, varied   One image (numeric width and height: a canvas or an ImageBitmap) or null per tile; the cover
//                    stands in for a frame not made. `varied`: at least two are different pictures.
//   reveal           The real cut, once it is here, or null: the removed spans that leave (`gone`), those too narrow
//                    to move, which are only marked (`slivers`), what closes up (`kept`), and whether the engine
//                    re-checked the joins (`checked`). See reveal.js.
//   colors           { bg, label, second, third, fill, sep, tint, cut }, CSS colours.

/** Where everything is, in the stage's own coordinates (add `lift` for the view's). Shared with the text the page
 *  lays over the picture. */
export function geometry(s) {
  const T = (k) => (k <= s.step ? (s.now - s.times[k - 1]) / 1000 : -1e6);
  const R = s.step >= 6 ? T(6) : -1;
  const clean = !!s.reveal && s.reveal.gone.length + s.reveal.slivers.length === 0;
  const tileW = s.w / Math.max(1, s.frames.length);
  const laneH = Math.round((tileW * 16) / 9);
  const foot = FOOT * s.scale;
  const rollH = laneH + 6 + WAVE + 6 + 2 + 5 + 5 + 4 + 12;
  const fits = Math.min(0.4 * s.h, s.h - 12 - GAP - rollH - 10 - foot - 8);
  const monLive = fits >= MONITOR ? fits : 0;
  const headroom = (m) => (m > 0 ? m + GAP : 26);
  const blockH = (m) => headroom(m) + rollH + 10 + foot;
  const topLive = Math.max(8, (s.h - blockH(monLive)) / 2);
  // At ready the receipt prints under the step's line. The picture moves only as far as the receipt needs: the
  // ruler's rows and the step's last row close up, then the block rises (into the room above it), then the monitor
  // shrinks (or goes).
  const closed = CLOSE + (FOOT - FOOT_READY) * s.scale;
  const under = s.h + s.room + 6 - s.receiptH + closed;
  const monFit = clamp(under - (10 - s.lift) - blockH(0) - GAP + 26, 0, monLive);
  const monReady = monFit >= MONITOR ? monFit : 0;
  const topReady = Math.min(topLive, Math.max(10 - s.lift, under - blockH(monReady)));
  const settle = R < 0 || s.receiptH <= 0 ? 0 : s.reduced ? seg(R, 0, 0.2) : spring(R, 0.5, 0.9);
  const monH = lerp(monLive, monReady, settle);
  const top = lerp(topLive, topReady, settle);
  const laneY = top + lerp(headroom(monLive), headroom(monReady), settle);
  const waveY = laneY + laneH + 6;
  const speechY = waveY + WAVE + 6;
  const footY = laneY + rollH + 10 - CLOSE * settle;
  return {
    T,
    R,
    clean,
    at: schedule(clean),
    tileW,
    laneH,
    monLive,
    monH,
    top,
    laneY,
    waveY,
    speechY,
    rulerY: speechY + 26,
    footY,
    foot: lerp(foot, FOOT_READY * s.scale, settle),
    settle,
    /** Step 5's check over the joined cut, 0 to 1; the creator's own words print under it. */
    check: s.step < 5 ? 0 : s.step === 5 ? seg(T(5) - START[5], 0, CHECK) : 1,
  };
}

const fmt = (ms) => {
  const sec = Math.round(ms / 1000);
  const rest = sec % 60;
  return `${Math.floor(sec / 60)}:${rest < 10 ? '0' : ''}${rest}`;
};

/** Draws the scene with the pen. Called once per frame. */
export function drawCut(pen, s) {
  const g = geometry(s);
  const { T, R, at, tileW, laneH, laneY, waveY, speechY, footY } = g;
  const { w, reduced, reveal } = s;
  const X = (ms) => (s.raw_ms > 0 ? (ms / s.raw_ms) * w : 0);
  const C = s.colors;
  const TILES = s.frames.length; // one frame per tile
  const roomy = g.monLive > 0;
  /** Step k was on screen long enough to have drawn something (a step the poll never saw was not). */
  const seen = (k) => k <= s.step && s.times[k - 1] > 0 && (k === s.step || s.times[k] - s.times[k - 1] > 300);
  /** How long step k lasted, once the next has begun. */
  const lasted = (k) => (s.times[k] - s.times[k - 1]) / 1000;

  // `alpha` scales the colour's own (the palette's fill and hairlines are translucent): the pen does that.
  const rect = (x, y, rw, rh, color, alpha = 1, r = 0) => {
    if (alpha <= 0.01 || rw <= 0 || rh <= 0) return;
    pen.fillRect(x, y, rw, rh, r, color, alpha);
  };
  const outline = (x, y, rw, rh, r, color, alpha, width) => {
    if (alpha <= 0.01 || rw <= 0 || rh <= 0) return;
    pen.strokeRRect(x, y, rw, rh, r, color, alpha, width);
  };
  /** A frame, cover-fitted into a rounded rectangle; black stands in while there is none. */
  const picture = (image, x, y, pw, ph, r, alpha) => {
    if (alpha <= 0.01 || pw < 1 || ph < 1) return;
    if (!image) {
      pen.fillRect(x, y, pw, ph, r, '#000000', alpha);
      return;
    }
    const [iw, ih] = [image.width, image.height];
    const k = Math.max(pw / iw, ph / ih);
    pen.image(image, (iw - pw / k) / 2, (ih - ph / k) / 2, pw / k, ph / k, x, y, pw, ph, r, alpha);
  };
  const text = (str, x, y, color, alpha, align = 'left') => {
    if (alpha <= 0.01) return;
    const width = align === 'left' ? 0 : pen.measure(str).width;
    pen.text(str, x - (align === 'right' ? width : align === 'center' ? width / 2 : 0), y, color, alpha);
  };
  const frame = (ms) => s.frames[clamp(Math.floor((ms / Math.max(1, s.raw_ms)) * TILES), 0, TILES - 1)];

  // ---- the heads: each is the engine at work, and none claims to know how far the work has got ----
  const HOP = 0.9; // Reduce Motion: a head appears at a tile's centre, then the next, with no travel
  const hop = (t) => ({ x: ((Math.floor(Math.max(0, t) / HOP) % TILES) + 0.5) * tileW, a: seg(frac(Math.max(0, t) / HOP), 0, 0.25) });
  // Step 2: one reading pass at a steady speed; then the head keeps visiting the stretches of speech, fainter.
  const PASS = passOf(s.raw_ms);
  const head2 = (t) => {
    if (reduced) return hop(t);
    if (t <= PASS) return { x: seg(t, 0, PASS) * w, a: seg(t, 0, 0.2) };
    const lap = t - PASS;
    if (s.speech.length === 0) {
      const at6 = frac(lap / 6) * 6;
      return { x: (at6 / 6) * w, a: 0.4 * seg(at6, 0, 0.2) * (1 - seg(at6, 5.8, 6)) };
    }
    let total = 0;
    for (const [a, z] of s.speech) total += Math.max(0.5, (X(z) - X(a)) / 60) + 0.3;
    let left = lap % total;
    for (const [a, z] of s.speech) {
      const d = Math.max(0.5, (X(z) - X(a)) / 60);
      if (left < d) return { x: lerp(X(a), X(z), left / d), a: 0.6 * seg(left, 0, 0.15) * (1 - seg(left, d - 0.15, d)) };
      left -= d + 0.3;
      if (left < 0) break;
    }
    return { x: 0, a: 0 };
  };
  // Steps 4 and 5 tell the real cut, which is on the page before step 4 is shown (progress.js). Each runs on its
  // own clock; a step already over is drawn finished, so a redraw draws where the story got to.
  const st = storyOf(reveal ? reveal.kept.length : 0, g.clean);
  const c4 = s.step < 4 ? -1 : s.step === 4 ? T(4) : 1e6;
  const c5 = s.step < 5 ? -1 : s.step === 5 ? T(5) - START[5] : 1e6;
  // Step 4: brackets drop, one after another, round each piece the real cut keeps, so what is removed next is
  // exactly what lies outside them. They go as the removed pieces fall.
  const spans = reveal ? reveal.kept.map((p) => [p.from_ms, p.to_ms]) : [];
  const edges = spans.flatMap(([a, z]) => [[a, -1], [z, 1]]);
  const brackets = () => {
    const gone = 1 - seg(c4, g.clean ? st.end : st.toss, (g.clean ? st.end : st.toss) + 0.3);
    if (gone <= 0.01) return;
    edges.forEach(([ms, side], i) => {
      const d = c4 - START[4] - i * st.stagger;
      const a = gone * seg(d, 0, reduced ? 0.2 : 0.12);
      if (a <= 0.01) return;
      const drop = reduced ? 1 : spring(d, 0.4, 0.8);
      const trim = reduced ? 1 : spring(d - 0.3, 0.35, 0.8);
      const x = X(ms) - side * 3 * (1 - trim);
      const y = laneY - 3 - 14 * (1 - drop);
      // The app sets this alpha in place of the label's own; the pen scales the label's. The same for an opaque label.
      pen.line(x - side * 5, y, x, y, C.label, a, 2.5);
      pen.line(x, y, x, y + laneH + 6, C.label, a, 2.5);
      pen.line(x, y + laneH + 6, x - side * 5, y + laneH + 6, C.label, a, 2.5);
    });
  };
  const t2 = T(2) - START[2];
  const h2 = s.step === 2 ? head2(t2) : { x: 0, a: 0 };
  // The reading head leaves from where it is: it fades there as step 3 begins, and is never moved first.
  const out2 = s.step === 3 && seen(2) ? 1 - seg(T(3), 0, 0.12) : 0;

  // How much of the video the reading pass has covered: a pass the next step cut short finishes at once.
  const readAt3 = s.step >= 3 ? seg(lasted(2) - START[2], 0, PASS) : 0;
  const read = s.step < 2 ? 0 : s.step === 2 ? seg(t2, 0, PASS) : lerp(readAt3, 1, easeOutExpo(seg(T(3), 0, 0.35)));
  // Step 3 on: the pauses the page can hear recede. Pauses, not cuts. At ready they come back, from as far as they went.
  const washed = s.wash && s.step >= 3 ? easeOutExpo(seg(T(3), 0.3, 0.9)) : 0;
  // They give way to the real cut as step 4 marks it.
  const wash = washed * (1 - seg(c4, st.mark - 0.3, st.mark));
  // Step 3: two neighbouring takes at a time are compared. Shown leaving only if it was ever shown.
  const comparing = s.takes.length >= 2 && (s.step === 3 || (s.step === 4 && seen(3) && T(4) < 0.25));
  const pairOn = s.step === 3 ? seg(T(3), START[3], START[3] + 0.25) : 1 - seg(T(4), 0, 0.2);
  const pairT = Math.max(0, (s.step === 3 ? T(3) : lasted(3)) - START[3]);
  const pairK = Math.floor(pairT / PAIR);
  const pairOf = (k) => {
    const i = k % (s.takes.length - 1);
    return [s.takes[i], s.takes[i + 1]];
  };
  // Where the sound swells: under the reading head as it visits the speech.
  const window = Math.max(1, X(700));
  const swellAt = (x) => (s.step === 2 && t2 > PASS ? 0.5 * h2.a * Math.max(0, 1 - Math.abs(x - h2.x) / window) : 0);
  // Step 1 never stands still: while the page reads its sound, waits to send it or waits its turn, a lift crosses
  // the bars. In points, so it shows on bars not read yet too. It claims no position.
  const LIFT = 24;
  const idle = s.step === 1 && !reduced ? frac(T(1) / 3) * (w + 2 * LIFT) - LIFT : -1e6;
  const lift = (x) => 6 * easeInOut(Math.max(0, 1 - Math.abs(x - idle) / LIFT));
  // Step 1's share of the bar (progress.js): the sound fills with the bar, as one signal.
  const sentAll = clamp(s.fraction / STEPS[0].end);
  const heard = (s.now - s.heard_at) / 1000;
  const tone = (i) => (R >= 0 ? 1 : lerp(0.45, 1, seg(read, (i + 0.5) / TILES - 0.04, (i + 0.5) / TILES + 0.04)));

  pen.save();
  pen.translate(0, s.y0);

  /** The rollout between two source times, moved and faded as one piece: frames and sound. */
  const piece = (ms0, ms1, dx, dy, rot, alpha, mark) => {
    const [x0, x1] = [X(ms0), X(ms1)];
    if (alpha <= 0.01 || !(x1 - x0 >= 0.2)) return;
    pen.save();
    pen.translate(dx, dy);
    if (rot !== 0) pen.rotate(rot, (x0 + x1) / 2, laneY + laneH / 2);
    pen.clipRect(x0, laneY - 6, x1 - x0, waveY + WAVE + 8 - laneY);
    for (let i = Math.floor(x0 / tileW); i < Math.min(TILES, Math.ceil(x1 / tileW)); i++) {
      picture(s.frames[i], i * tileW + 0.5, laneY, tileW - 1, laneH, 3, alpha * tone(i));
    }
    const pitch = w / BARS;
    for (let b = Math.floor(x0 / pitch); b < Math.min(BARS, Math.ceil(x1 / pitch)); b++) {
      const f = (b + 0.5) / BARS;
      // Step 1: each bar darkens as its part of the sound is sent.
      const sent = s.step >= 2 ? 1 : reduced ? seg(sentAll, f - 0.01, f + 0.01) : easeOut(seg(sentAll, f - 0.03, f + 0.03));
      // Until the page has read the sound every bar is a stub: a place for the sound, never a guess at it. Read, the
      // bars rise to their height, left to right, in about half a second.
      const level = b < s.bars.length ? s.bars[b] : 0;
      const risen = s.step >= 2 || reduced ? 1 : easeOut(seg(heard - 0.25 * f, 0, 0.35));
      const bh = Math.min(WAVE, lerp(2, Math.max(2, level * WAVE * (1 + swellAt(f * w))), risen) + lift(f * w));
      const [bx, by, bw] = [b * pitch + 0.6, waveY + (WAVE - bh) / 2, pitch - 1.2];
      if (mark > 0.5 || R >= 0 || read >= f) rect(bx, by, bw, bh, mark > 0.5 ? C.cut : C.label, alpha, 1);
      else {
        if (sent < 0.99) rect(bx, by, bw, bh, C.sep, alpha, 1);
        rect(bx, by, bw, bh, C.third, alpha * sent, 1);
      }
    }
    // The real cut: red means cut.
    if (mark > 0) rect(x0, laneY, x1 - x0, laneH, C.cut, 0.3 * mark * alpha);
    pen.restore();
  };
  const head = (hd, alpha, from = 0) => {
    const a = hd.a * alpha;
    if (a <= 0.01) return;
    const x = hd.x;
    // Its glow trails inside the strip, never past its start.
    const glow = Math.max(from, x - 28);
    rect(glow, laneY, x - glow, laneH, C.label, 0.08 * a);
    rect(x - 1, laneY - 6, 2, waveY + WAVE + 10 - laneY, C.label, a, 1);
    rect(x - 4, laneY - 9, 8, 4, C.label, a, 2);
  };
  const check = (x, y, alpha) => {
    if (alpha <= 0.01) return;
    pen.line(x - 4.5, y, x - 1.2, y + 3.4, C.label, alpha, 2);
    pen.line(x - 1.2, y + 3.4, x + 5, y - 3.6, C.label, alpha, 2);
  };
  const chip = (letter, cx, y, alpha, onPhoto) => {
    rect(cx - 10, y, 20, 18, onPhoto ? '#000000' : C.label, (onPhoto ? 0.6 : 1) * alpha, 6);
    if (alpha <= 0.01) return;
    // The letter's own ink box, centred in the chip both ways: this holds for any face.
    const box = pen.measure(letter);
    pen.text(letter, cx - box.x - box.width / 2, y + 9 - box.y - box.height / 2, onPhoto ? '#FFFFFF' : C.bg, alpha);
  };

  // ---- the cover and the monitor's place ----
  const rolled = s.step >= 2;
  const pose = s.step >= 2 ? (reduced ? seg(T(2), 0, 0.25) : spring(T(2), 0.55, 0.86)) : 0;
  const c1H = roomy ? g.monLive + GAP + laneH - 14 : laneH;
  // Reduce Motion: the cover does not shrink into the monitor; one fades as the other appears.
  const still = reduced && roomy && pose < 1;
  const cardH = roomy ? lerp(c1H, g.monH, still ? 1 : pose) : laneH;
  const card = { w: (cardH * 9) / 16, h: cardH, y: roomy ? g.top : laneY };
  const cardX = (w - card.w) / 2;

  // ---- the rollout ----
  if (!rolled) {
    // Step 1: only the sound, growing out as it is sent.
    pen.save();
    pen.clipRect(0, waveY - 2, w, WAVE + 4);
    piece(0, s.raw_ms, 0, 0, 0, 1, 0);
    pen.restore();
  } else {
    // The real cut is drawn from step 4 on. One that arrives while the screen already shows its ready moment (an away
    // creator whose cut was still downloading) fades in over the plain strip.
    const arrive = reveal && s.step >= 4 ? clamp((s.now - s.reveal_at) / 250) : 0;
    if (arrive < 1) {
    const dealt = T(2) - 0.1;
    if (!reduced && dealt < 1.3) {
      // The frames deal out from behind the cover to both edges, centre first.
      for (let i = 0; i < TILES; i++) {
        const delay = (Math.abs(i - (TILES - 1) / 2) / ((TILES - 1) / 2)) * 0.3;
        const q = spring(dealt - delay, 0.5, 0.86);
        const fromY = roomy ? card.y + card.h - laneH - 6 : laneY;
        picture(s.frames[i], lerp((w - tileW) / 2, i * tileW + 0.5, q), lerp(fromY, laneY, q), tileW - 1, laneH, 3, seg(dealt - delay, 0, 0.12) * tone(i));
      }
      pen.save();
      pen.clipRect(0, waveY - 2, w, WAVE + 4);
      piece(0, s.raw_ms, 0, 0, 0, 1, 0);
      pen.restore();
    } else piece(0, s.raw_ms, 0, 0, 0, (reduced ? seg(T(2), 0, 0.3) : 1) * (1 - arrive), 0);
    }
    if (reveal && arrive > 0) {
    const layer = arrive < 1;
    if (layer) pen.beginLayer(arrive);
    // The real cut, one thing at a time. Step 4: every removed span is marked; the pieces that left fall down and
    // out; what is left closes up into one. Step 5: the check runs over it. Ready: the strip swells as the total lands.
    const nG = Math.max(1, reveal.gone.length - 1);
    const nK = Math.max(1, reveal.kept.length - 1);
    const last = reveal.kept.length > 0 ? reveal.kept[reveal.kept.length - 1] : null;
    const stitched = last ? last.to_ms - last.shift_ms : s.raw_ms;
    const cutW = X(stitched);
    const cutX0 = (w - cutW) / 2;
    /** The marking sweeps the timeline once, left to right, however many spans there are. */
    const marked = (sp) => {
      const from = st.mark + 0.4 * (sp.from_ms / Math.max(1, s.raw_ms));
      return easeOutExpo(seg(c4, from, from + 0.3));
    };
    const tossed = seg(c4, st.toss, st.toss + 0.3);
    const u = (k) => (g.clean ? 1 : reduced ? easeInOut(seg(c4, st.stitch, st.stitch + 0.35)) : spring(c4 - st.stitch - (0.12 * k) / nK, 0.6, 0.9));
    const joined = u(reveal.kept.length - 1);
    // As the total lands the strip swells once.
    const swell = !reduced && R >= at.total ? 0.03 * Math.sin(Math.PI * seg(R, at.total, at.total + 0.4)) : 0;
    pen.save();
    if (swell > 0) {
      pen.translate(w / 2, laneY + laneH / 2);
      pen.scale(1 + swell, 1 + swell);
      pen.translate(-w / 2, -(laneY + laneH / 2));
    }
    const joins = [];
    reveal.kept.forEach((p, k) => {
      const to = cutX0 - X(p.shift_ms);
      if (reduced && !g.clean) {
        piece(p.from_ms, p.to_ms, 0, 0, 0, 1 - u(k), 0);
        piece(p.from_ms, p.to_ms, to, 0, 0, u(k), 0);
      } else piece(p.from_ms, p.to_ms, to * u(k), 0, 0, 1, 0);
      if (k > 0) joins.push(lerp(X(p.from_ms), cutX0 + X(p.from_ms - p.shift_ms), u(k)));
    });
    // The slivers of frames become whole tiles of the cut: the strip the editor opens with.
    const whole = g.clean ? 0 : seg(c4, st.stitch + 0.55, st.stitch + 0.8);
    if (whole > 0.01) {
      const n = Math.max(1, Math.round(cutW / tileW));
      for (let j = 0; j < n; j++) {
        const mid = ((j + 0.5) / n) * stitched;
        let src = mid;
        for (const p of reveal.kept) {
          if (mid < p.to_ms - p.shift_ms) {
            src = mid + p.shift_ms;
            break;
          }
        }
        picture(frame(src), cutX0 + (j * cutW) / n + 0.5, laneY, cutW / n - 1, laneH, 3, whole);
      }
    }
    pen.restore();
    pen.save();
    // Falling pieces are clipped above the step's line, so nothing crosses it.
    pen.clipRect(0, laneY - 12, w, footY - 4 - (laneY - 12));
    reveal.gone.forEach((sp, i) => {
      const fallAt = st.toss + (0.25 * i) / nG;
      const fall = easeIn(seg(c4, fallAt, fallAt + 0.5));
      piece(sp.from_ms, sp.to_ms, 0, reduced ? 0 : fall * 44, reduced ? 0 : fall * (i % 2 ? 3 : -3), reduced ? 1 - tossed : 1 - seg(fall, 0.3, 0.95), marked(sp));
    });
    pen.restore();
    // A removed span too narrow to move by itself (a filler in a long video) is still marked where it really is.
    for (const sp of reveal.slivers) rect(X(sp.from_ms), laneY, Math.max(1.5, X(sp.to_ms) - X(sp.from_ms)), laneH + 6 + WAVE, C.cut, 0.55 * marked(sp) * (1 - tossed));
    // The map of what went: the red bar over each removed span stays when its piece falls. It rises, thins and is
    // joined by a hairline, so the whole raw take is still on screen above the cut, with everything removed in red.
    const rise = reduced ? tossed : spring(c4 - st.toss, 0.5, 0.9);
    const mapY = laneY - lerp(5, 24, rise);
    rect(0, mapY + 0.5, w, 1, C.third, 0.5 * seg(c4, st.toss, st.toss + 0.4));
    for (const sp of [...reveal.gone, ...reveal.slivers]) {
      const m = marked(sp);
      const x0 = X(sp.from_ms);
      rect(x0, mapY, Math.max(1.5, X(sp.to_ms) - x0) * (reduced ? 1 : m), lerp(3, 2, rise), C.cut, m * lerp(1, 0.75, rise));
    }
    // The join: a seam that welds shut as the pieces meet.
    const weld = seg(c4, st.stitch + 0.42, st.stitch + 0.57) * (1 - seg(c4, st.stitch + 0.57, st.stitch + 1.05));
    if (weld > 0.01 && joins.length <= 24) for (const x of joins) rect(x - 1, laneY - 4, 2, laneH + 8, C.label, weld);
    // Step 5, the check: a head runs the joined cut once and each join gets its tick (at most a dozen, evenly taken,
    // on a long video). The ticks only when the engine did re-check the joins.
    const hp = seg(c5, 0, CHECK);
    if (hp > 0 && joined > 0.5) {
      const hx = cutX0 + cutW * easeInOut(hp);
      const every = Math.max(1, Math.ceil(joins.length / 12));
      if (reveal.checked) {
        joins.forEach((x, i) => {
          if (i % every === 0) check(x, laneY - 13, reduced ? seg(c5, 0, 0.3) : seg(hx, x - 1, x + 6));
        });
      }
      if (!reduced) head({ x: hx, a: seg(hp, 0, 0.1) * (1 - seg(hp, 0.82, 1)) }, 1, cutX0);
    }
    if (layer) pen.endLayer();
    }
  }

  // ---- live marks: only what is true, or plainly the engine at work ----
  if (rolled && wash > 0.01) {
    // The pauses recede over the frames and the sound.
    let from = 0;
    const veil = (a, z) => rect(X(a), laneY - 1, X(z) - X(a), waveY + WAVE + 2 - laneY, C.bg, 0.6 * wash);
    for (const [a, z] of s.speech) {
      if (a > from) veil(from, a);
      from = z;
    }
    if (from < s.raw_ms) veil(from, s.raw_ms);
  }
  if (rolled) {
    // Speech the page can hear, underlined as the reading pass goes by. It gives way to the real cut in step 4.
    const a = 1 - seg(c4, st.mark - 0.3, st.mark);
    for (const [from, to] of s.speech) rect(X(from), speechY, Math.min(X(to), read * w) - X(from), 2, C.second, a);
  }
  head(h2, 1);
  if (out2 > 0) head(head2(lasted(2) - START[2]), out2);
  if (reveal && s.step >= 4) brackets();
  // The two takes being compared.
  let now = null;
  let was = null;
  let swap = 1;
  if (comparing && pairOn > 0.01) {
    now = pairOf(pairK);
    was = pairK > 0 ? pairOf(pairK - 1) : now;
    const t = pairT - pairK * PAIR;
    const m = reduced ? 1 : spring(t, 0.45, 0.86);
    const blink = reduced && pairK > 0 ? seg(t, 0, 0.2) : 1;
    swap = pairK > 0 ? seg(t, 0, 0.18) : 1;
    let chipA = 0;
    for (let j = 0; j < 2; j++) {
      // A short take is still a box a finger could cover, not a slot.
      const centre = (lerp(X(was[j][0]), X(now[j][0]), m) + lerp(X(was[j][1]), X(now[j][1]), m)) / 2;
      const half = Math.max(12, lerp(X(was[j][1]) - X(was[j][0]), X(now[j][1]) - X(now[j][0]), m) / 2);
      const [a, z] = [centre - half, centre + half];
      outline(a - 1, laneY - 4, z - a + 2, laneH + 8, 7, C.label, pairOn * blink, 2);
      // A chip stays on the screen, and B stays clear of A.
      const cx = clamp((a + z) / 2, j === 0 ? 14 : chipA + 24, w - (j === 0 ? 38 : 14));
      if (j === 0) chipA = cx;
      chip(j === 0 ? 'A' : 'B', cx, laneY - 25, pairOn * blink, false);
    }
  }
  // The ruler's ends: the raw take's length. They go as the cut closes up; the cut's length is the receipt's to say.
  const ends = s.raw_ms > 0 ? (1 - seg(c4, st.stitch - 0.3, st.stitch)) * (R < 0 ? 1 : 1 - seg(R, 0, 0.3)) : 0;
  text('0:00', 8, g.rulerY, C.second, ends);
  text(fmt(s.raw_ms), w - 8, g.rulerY, C.second, ends, 'right');

  // ---- the cover, then the monitor: whatever frame the engine is on, always a whole frame ----
  const mid = (r) => frame((r[0] + r[1]) / 2);
  const monitor = (x, image, r, alpha, mw = card.w, mh = card.h) => {
    picture(image, x, card.y, mw, mh, r, alpha);
    // A hairline in place of a shadow.
    if (mh > 8) outline(x + 0.5, card.y + 0.5, mw - 1, mh - 1, r, C.label, 0.14 * alpha, 1);
  };
  if (roomy) {
    const r = lerp(18, 12, pose);
    const alpha = seg(card.h, 4, 30);
    let image = s.frames[0];
    if (s.step === 2) image = frame((t2 > PASS || reduced ? h2.x / w : read) * s.raw_ms);
    else if (s.step === 3) image = now ? mid(now[0]) : s.frames[TILES - 1];
    // Step 4: the piece being bracketed (it changes on every second landing: a face is read, not strobed); then,
    // while the strip is cut, joined and checked, the monitor rests on the cut's first frame.
    else if (s.step >= 4 && spans.length > 0) {
      const landed = clamp(Math.floor((c4 - START[4]) / st.stagger), 0, edges.length - 1);
      image = c4 < st.mark ? mid(spans[Math.floor(landed / 2)]) : frame(spans[0][0] + 400);
    }
    // Step 3: the monitor divides into two whole cards, A and B; they rejoin when the cuts begin. Not when every
    // frame is the same picture: two of one face compare nothing.
    const sep = !now || !s.varied ? 0 : reduced ? 1 : s.step === 3 ? spring(T(3) - START[3], 0.5, 0.86) : 1 - spring(T(4), 0.4, 0.9);
    if (now && was && sep > 0.01) {
      const off = sep * (card.w / 2 + 5);
      const two = reduced ? pairOn : 1;
      if (reduced) monitor(cardX, image, r, alpha * (1 - pairOn));
      monitor(cardX + off, mid(now[1]), r, alpha * two);
      if (swap < 1) monitor(cardX + off, mid(was[1]), r, alpha * two * (1 - swap));
      monitor(cardX - off, mid(now[0]), r, alpha * two);
      if (swap < 1) monitor(cardX - off, mid(was[0]), r, alpha * two * (1 - swap));
      if (card.h >= 60) {
        chip('A', cardX - off + 16, card.y + 8, sep * alpha * two, true);
        chip('B', cardX + off + 16, card.y + 8, sep * alpha * two, true);
      }
    } else {
      monitor(cardX, image, r, alpha * (still ? pose : 1));
      if (still) monitor((w - (c1H * 9) / 16) / 2, s.frames[0], 18, 1 - pose, (c1H * 9) / 16, c1H);
    }
  } else if (s.step < 2 || T(2) < 0.5) {
    // Compact: the cover is one tile at the lane's centre, and the frames deal out from behind it.
    monitor(cardX, s.frames[0], 3, s.step < 2 ? 1 : 1 - seg(T(2), 0.15, 0.45));
  }

  // ---- the one bar for the whole cut, notched where each step ends. It bows out as the total comes in. ----
  const bar = R < 0 ? 1 : 1 - seg(R, at.total - 0.25, at.total);
  const [bx, bw, by] = [20, w - 40, footY + 29 * s.scale];
  let from = 0;
  NOTCHES.forEach((end, i) => {
    const a = bx + from * bw + (i ? 1.5 : 0);
    const z = bx + end * bw - (i < NOTCHES.length - 1 ? 1.5 : 0);
    rect(a, by, z - a, 3, C.fill, bar, 1.5);
    // Red, as the site's progress.
    rect(a, by, Math.min(z, bx + s.fraction * bw) - a, 3, C.cut, bar, 1.5);
    from = end;
  });
  pen.restore();
}

/** The real pen, on a CanvasRenderingContext2D. Every colour is a CSS colour drawn at `alpha` (0 to 1) times its own.
 *  `measure` gives a string's ink box from its origin ({ x, y, width, height }, y negative above the baseline). */
export function canvasPen(ctx, { font = '600 11px "Geist Mono", ui-monospace, monospace' } = {}) {
  const under = []; // the context and alpha of each open layer's parent
  const round = (x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      const q = Math.min(r, w / 2, h / 2);
      ctx.moveTo(x + q, y);
      ctx.arcTo(x + w, y, x + w, y + h, q);
      ctx.arcTo(x + w, y + h, x, y + h, q);
      ctx.arcTo(x, y + h, x, y, q);
      ctx.arcTo(x, y, x + w, y, q);
      ctx.closePath();
    }
  };
  const type = () => Object.assign(ctx, { font, textAlign: 'left', textBaseline: 'alphabetic' });
  return {
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    translate: (dx, dy) => ctx.translate(dx, dy),
    /** By degrees about (cx, cy), as Skia's canvas.rotate. */
    rotate(degrees, cx, cy) {
      ctx.translate(cx, cy);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    },
    scale: (sx, sy) => ctx.scale(sx, sy),
    clipRect(x, y, w, h) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    },
    /** `r`: the corner radius, 0 for none. */
    fillRect(x, y, w, h, r, color, alpha) {
      ctx.globalAlpha = clamp(alpha);
      ctx.fillStyle = color;
      if (r > 0) {
        round(x, y, w, h, r);
        ctx.fill();
      } else ctx.fillRect(x, y, w, h);
    },
    strokeRRect(x, y, w, h, r, color, alpha, width) {
      ctx.globalAlpha = clamp(alpha);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      round(x, y, w, h, r);
      ctx.stroke();
    },
    line(x0, y0, x1, y1, color, alpha, width) {
      ctx.globalAlpha = clamp(alpha);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    },
    /** The image's (sx, sy, sw, sh) into (dx, dy, dw, dh), clipped to that rectangle rounded by `r`. */
    image(img, sx, sy, sw, sh, dx, dy, dw, dh, r, alpha) {
      ctx.save();
      round(dx, dy, dw, dh, r);
      ctx.clip();
      ctx.globalAlpha = clamp(alpha);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.restore();
    },
    text(str, x, y, color, alpha) {
      type();
      ctx.globalAlpha = clamp(alpha);
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    },
    measure(str) {
      const m = type().measureText(str);
      return { x: -m.actualBoundingBoxLeft, y: -m.actualBoundingBoxAscent, width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
    },
    /** Until endLayer everything is drawn apart, then laid down as one at `alpha`, so its shapes do not show through
     *  each other (Skia's saveLayer). A new canvas each time: drawCut opens a layer only for the quarter second a
     *  late cut fades in. */
    beginLayer(alpha) {
      const layer = Object.assign(document.createElement('canvas'), { width: ctx.canvas.width, height: ctx.canvas.height }).getContext('2d');
      layer.setTransform(ctx.getTransform());
      under.push({ ctx, alpha });
      ctx = layer;
    },
    endLayer() {
      const layer = ctx.canvas;
      const parent = under.pop();
      ctx = parent.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = clamp(parent.alpha);
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    },
  };
}
