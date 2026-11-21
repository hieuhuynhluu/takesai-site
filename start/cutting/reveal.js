// What the reveal shows of a stored cut (contracts/job-api.md section 2.4, "Your cut is ready"): its real figures as
// receipt lines, and its removed ranges as pieces a page can draw and move. A port of the app's reveal.ts
// (app/src/features/cutting/progress/), checked by site/tools/start/test-cutting.mjs: change the two together. Pure.

// The receipt's lines, in print order; every reason is in exactly one, so raw minus the lines is the cut.
const FAMILIES = [
  { reasons: ['lead_in', 'tail', 'dead_air', 'pause_shortened'], one: 'Dead air', many: 'Dead air', counted: false },
  { reasons: ['retake'], one: 'Retake', many: 'Retakes', counted: true },
  { reasons: ['filler', 'stutter'], one: 'Filler', many: 'Fillers', counted: true },
  { reasons: ['false_start', 'meta', 'off_topic'], one: 'Other mistake', many: 'Other mistakes', counted: true },
];

/** The default pace's cut, as the reveal shows it: { raw_ms, cut_ms, lines: [{ label, ms }], removed: [{ from_ms,
 *  to_ms }] }. A line whose family removed nothing is not printed. */
export function revealOf(cutlist) {
  const pace = cutlist.paces[cutlist.default_pace];
  const lines = [];
  for (const family of FAMILIES) {
    const spans = pace.removals.filter((r) => family.reasons.includes(r.reason));
    if (spans.length === 0) continue;
    const label = !family.counted ? family.one : spans.length === 1 ? family.one : `${family.many} ×${spans.length}`;
    lines.push({ label, ms: spans.reduce((ms, r) => ms + r.src_out_ms - r.src_in_ms, 0) });
  }
  return {
    raw_ms: cutlist.sources[0].duration_ms,
    cut_ms: pace.metrics.output_ms,
    lines,
    removed: pace.removals.map((r) => ({ from_ms: r.src_in_ms, to_ms: r.src_out_ms })).sort((a, b) => a.from_ms - b.from_ms),
  };
}

/** The timeline as pieces that move: the removals wide enough to see leave (`gone`), at most `max` of them, and what
 *  lies between them closes up (`kept`: { from_ms, to_ms, shift_ms }, where shift_ms is how far left it moves). A
 *  removal under a point wide on a `width`-point timeline is still marked, but its neighbours stay one piece: a
 *  three-minute video has fillers a third of a point wide. `gone` holds the same objects as `removed`. */
export function pieces(removed, raw_ms, width, max = 24) {
  const points = (s) => ((s.to_ms - s.from_ms) / raw_ms) * width;
  let gone = removed.filter((s) => points(s) >= 1);
  if (gone.length > max) {
    const widest = [...gone].sort((a, b) => points(b) - points(a)).slice(0, max);
    gone = gone.filter((s) => widest.includes(s));
  }
  const kept = [];
  let at = 0;
  let shift_ms = 0;
  for (const s of gone) {
    if (s.from_ms > at) kept.push({ from_ms: at, to_ms: s.from_ms, shift_ms });
    shift_ms += s.to_ms - s.from_ms;
    at = s.to_ms;
  }
  if (at < raw_ms) kept.push({ from_ms: at, to_ms: raw_ms, shift_ms });
  return { kept, gone };
}

/** The removals too narrow to move (`slivers`, in time order), as the marks the picture draws for them. A mark is at
 *  least `min` points wide, so on a long video hundreds land on the same points: marks that touch become one, up to
 *  `max` points wide so the marking still sweeps left to right; the next starts where it ends. The same points are
 *  red, with at most width / min marks to draw. */
export function marks(slivers, raw_ms, width, min = 1.5, max = 4) {
  const [min_ms, max_ms] = [(min / width) * raw_ms, (max / width) * raw_ms];
  const out = [];
  for (const s of slivers) {
    const last = out[out.length - 1];
    // Where its mark ends as drawn: its own end, or `min` points after its start.
    const end = Math.max(s.to_ms, s.from_ms + min_ms);
    if (!last || s.from_ms > last.to_ms) out.push({ from_ms: s.from_ms, to_ms: end });
    else if (end <= last.to_ms) continue; // already under the last mark
    else if (end - last.from_ms <= max_ms) last.to_ms = end;
    else out.push({ from_ms: last.to_ms, to_ms: Math.max(end, last.to_ms + min_ms) });
  }
  return out;
}

/** The cut's own opening words, for the line that prints under the stitched strip at the check: the first `max` kept
 *  words, in order. A word is kept when its middle lies in a kept piece. Empty when the transcript has none. */
export function keptText(transcript, kept, max = 24) {
  const words = [];
  for (const token of transcript.tokens) {
    if (token.type !== 'word') continue;
    const mid = (token.start_ms + token.end_ms) / 2;
    if (kept.some((p) => mid >= p.from_ms && mid < p.to_ms)) words.push(token.text);
    if (words.length === max) break;
  }
  return words.join(' ');
}
