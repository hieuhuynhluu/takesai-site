// What the cutting screen says and how far its bar goes (contracts/job-api.md section 2.4): one bar from Send to the
// cut being ready, over five steps, that never goes back and is full only at ready. No ETA. A port of the app's
// stage-label.ts, progress/step-times.ts and live-activity.ts's cutEstimateMs (app/src/features/cutting/), checked by
// site/tools/start/test-cutting.mjs: change them together. The web's own: stepLabel (no failure copy) and forget.

/** The five steps (section 2.4) and where each ends on the bar; each starts where the one before ends. */
export const STEPS = [
  { label: 'Uploading your take', end: 0.25 },
  { label: 'Writing out every word', end: 0.6 },
  { label: 'Picking your best takes', end: 0.8 },
  { label: 'Making the cuts', end: 0.9 },
  { label: 'Checking every cut', end: 0.99 },
];
const READY_LABEL = 'Your cut is ready';
/** The step after the last: the cut is stored on the page. */
export const READY_STEP = STEPS.length + 1;

// The worker's stages by step. Running with a null stage (just picked up) is step 2.
const RUNNING_STEP = {
  checking_audio: 2,
  transcribing: 2,
  choosing_takes: 3,
  placing_cuts: 4,
  checking_cuts: 5,
};
/** Every step creeps toward this share of its width and never past it: only the next real stage takes the bar to the
 *  step's end. */
const EASE_SHARE = 0.9;
/** Step 1's real signals (the upload's bytes; a queued job has sent them all) carry the bar to at least this share of
 *  the step; from there it keeps creeping while the job waits for the worker. */
const UPLOAD_SHARE = 0.5;
/** The shortest time a step is shown. A stage shorter than the poll (section 2.4, "A step may be skipped") is still
 *  walked through, one step at a time, never jumped over. Each step is also held for one full cycle of its picture
 *  (`least_ms`, from the animation), so the whole flow plays every time. */
export const STEP_MIN_MS = 1200;
/** Steps 4 and 5 draw the real cut (its kept pieces bracketed, then checked), so they are shown only once the cut is
 *  stored; until then the screen stays on step 3. */
const BEFORE_THE_CUT = 3;
/** A cut first heard of as done this soon after the screen came back into view finished while the creator was away:
 *  no walk and no replay. Its ready moment shows at once, already over, also while its cut still downloads. */
const RETURN_MS = 10_000;
/** How long ago an away creator's ready moment is drawn as having begun: past the receipt, the total and the haptic. */
const READY_OVER_MS = 5000;

// Per key, not per screen, so a redraw of the page starts where the bar was.
const held = new Map();

/** The step (1 to 5, or READY_STEP) the input says; null when it says nothing we can place (a failed or cancelled
 *  job before the status records it, or a state or stage this version does not know): the bar holds. */
function stepOf({ status, job, cut_duration_ms }) {
  // Ready on the server but not yet stored (or checked) here: not 100% yet.
  if (status === 'ready' || status === 'exported') return cut_duration_ms === null ? STEPS.length : READY_STEP;
  if (!job) return 1; // on the device: audio prep
  switch (job.state) {
    case 'awaiting_audio':
    case 'queued':
      return 1;
    case 'running':
      return RUNNING_STEP[job.stage ?? 'checking_audio'] ?? null;
    case 'ready':
      return STEPS.length; // a polled row ahead of the status
    default:
      return null;
  }
}

/** Where the bar is for this key now, and never lower than it was: { step, fraction, since, at, behind, until, least,
 *  away }. `input` is { status, failure_code, job: { state, stage, failure_code } | null, cut_duration_ms }; `upload`
 *  the send's own upload fraction, `estimate_ms` the whole cut's estimate (cutEstimateMs), `least_ms` each step's full
 *  cycle (draw.js cycleMs), `settled` false while a job on the server has not been polled yet, `returned_at` when the
 *  screen last came back into view on a job already on the server (0: watched from Send). */
export function cutProgress(key, input, upload, estimate_ms, now = Date.now(), least_ms = [], settled = true, returned_at = 0) {
  // A failed, stopped or unsent cut's bar is over: the next send starts a new one from zero.
  if (input.status === 'failed' || input.status === 'draft') {
    held.delete(key);
    return { step: 1, fraction: 0, since: now };
  }
  const first = !held.has(key);
  const prev = held.get(key) ?? { step: 1, fraction: 0, since: now };
  const said = stepOf(input);
  const seen = said !== null && input.cut_duration_ms === null ? Math.min(said, BEFORE_THE_CUT) : said;
  if (seen === null) {
    held.set(key, prev);
    return prev;
  }
  const cycles = least_ms.length > 0 ? least_ms : (prev.least ?? []);
  const least = (k) => Math.max(STEP_MIN_MS, cycles[k] ?? 0);
  // A first sight (a load mid-cut) goes straight to the step: the ones before it are long done.
  // Away: the job is done (ready on the server, or stored here) and the screen came back into view moments ago, or
  // was away when it was first heard of. Kept once decided, so a slow download still skips.
  const done = input.status === 'ready' || input.status === 'exported' || input.job?.state === 'ready';
  const away = done && (prev.away === true || (returned_at > 0 && now - returned_at < RETURN_MS));
  // Away and done: the ready moment at once, already over, even before the cut is here.
  const step = away
    ? READY_STEP
    : first || seen <= prev.step
      ? Math.max(prev.step, seen)
      : now - prev.since >= least(prev.step)
        ? prev.step + 1
        : prev.step;
  const since = step === prev.step ? prev.since : away && step === READY_STEP ? now - READY_OVER_MS : now;
  let fraction;
  if (step === READY_STEP) fraction = 1;
  else {
    // One rule for every step: from where the bar is, a share of the way left to the step's cap, a larger share the
    // longer since it was last worked out (time constant: the step's share of the estimate). It slows but never
    // stops, and never reaches the cap; a step's end comes only with the next one, which starts from its own start.
    const start = step === 1 ? 0 : STEPS[step - 2].end;
    const width = STEPS[step - 1].end - start;
    const cap = start + EASE_SHARE * width;
    const same = step === prev.step;
    const from = same ? prev.fraction : Math.max(prev.fraction, start);
    const elapsed = Math.max(0, now - (same ? (prev.at ?? since) : since));
    fraction = from + (cap - from) * (1 - Math.exp(-elapsed / (estimate_ms * width)));
    if (step === 1) {
      const sent = input.job?.state === 'queued' ? 1 : Math.min(1, Math.max(0, upload ?? 0));
      fraction = Math.max(fraction, start + width * UPLOAD_SHARE * sent);
    }
  }
  const next = { step, since, at: now, fraction: Math.max(prev.fraction, fraction), behind: seen > step, until: since + least(step), least: cycles, away };
  // A first sight from a stale record (before the first poll answers) is not kept: the walk would then hold every
  // step since that record, on a cut that may be done. `settled`: the input is current.
  if (first && !settled) return next;
  held.set(key, next);
  return next;
}

/** The whole percentage shown: rounded down, so a step's end shows only once the next stage is real. */
export const percentOf = (fraction) => Math.floor(fraction * 100 + 1e-9);

/** The step's words (stage-label.ts's stageLabel without the failure copy: the page has its own). */
export const stepLabel = (step) => (step >= READY_STEP ? READY_LABEL : STEPS[step - 1].label);

// ---- When each step began (step-times.ts): the animation's clock ----

const heldTimes = new Map();

/** `times[k - 1]` is when step k began (milliseconds since the epoch), for every step up to `step`. `since` is when
 *  this page first saw `step` (cutProgress's). Steps before the first one this key was seen in began "long ago" (0):
 *  they are drawn as done. The same array comes back while nothing changes. */
export function stepTimes(key, step, since) {
  const prev = heldTimes.get(key);
  if (prev && prev.length === step) return prev;
  // A lower step is a new cut (after a failure or Stop): its clock starts again.
  const next = prev && prev.length < step ? [...prev] : Array(step - 1).fill(0);
  while (next.length < step) next.push(since);
  heldTimes.set(key, next);
  return next;
}

/** Send to cut ready, for the bar (live-activity.ts). shortcut: an unmeasured formula, as the app's. */
export function cutEstimateMs(duration_ms) {
  return 15_000 + (7_000 * Math.max(0, duration_ms)) / 60_000;
}

/** Drops the key's bar and clock: the page starts a new cut under the same key. */
export function forget(key) {
  held.delete(key);
  heldTimes.delete(key);
}
