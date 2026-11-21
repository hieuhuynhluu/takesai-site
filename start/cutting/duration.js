// The receipt's times: a port of the app's duration.ts (app/src/ui/), checked by site/tools/start/test-cutting.mjs:
// change the two together.

/** 'm:ss' from whole rounded seconds; minutes are unbounded, negatives clamp to 0. */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Whole seconds for a receipt that always adds up: cutS sums exactly to rawS - keptS (largest-remainder method).
 *  drift_ms says how far the inputs themselves disagree. Returns { rawS, cutS, keptS, drift_ms }. */
export function reconcileReceipt(rawMs, cutMs, keptMs) {
  const rawS = Math.max(0, Math.round(rawMs / 1000));
  // kept above raw is a caller error (drift_ms reports it); clamp so the receipt still adds up.
  const keptS = Math.min(rawS, Math.max(0, Math.round(keptMs / 1000)));
  const drift_ms = Math.abs(rawMs - cutMs.reduce((a, b) => a + b, 0) - keptMs);
  const target = rawS - keptS;

  const lengths = cutMs.map((ms) => Math.max(0, ms));
  const sum = lengths.reduce((a, b) => a + b, 0);
  // All-zero lines share the target equally.
  const exact = lengths.map((ms) => (sum > 0 ? (ms * target) / sum : target / lengths.length));
  const cutS = exact.map(Math.floor);
  const order = exact.map((_, i) => i).sort((a, b) => exact[b] - cutS[b] - (exact[a] - cutS[a]) || a - b);
  let left = target - cutS.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0 && order.length > 0; k++, left--) cutS[order[k % order.length]]++;

  return { rawS, cutS, keptS, drift_ms };
}
