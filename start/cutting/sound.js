// The sound of the video, for the cutting animation: how loud audio.wav is over time, and where there is speech. A
// port of the app's sound.ts (app/src/features/cutting/progress/), checked by site/tools/start/test-cutting.mjs:
// change the two together. Pure.

/** audio.wav is a 44-byte header, then 16 kHz mono 16-bit samples (contracts/media-upload.md section 2). */
const HEADER = 44;
const SAMPLES_PER_MS = 16;
/** Every 8th sample is enough for a peak: 200 looks per 100 ms. */
const STRIDE = 8;
/** A long file is looked at more sparsely, so the pass costs the same whatever the length. At this many it still gets
 *  14 looks per 100 ms, and a video up to two minutes is read as before. */
const MAX_LOOKS = 250_000;
/** On the curved scale below. shortcut: one fixed level, so a take over loud music reads as all speech (one region,
 *  no pauses); measure the noise floor if testers see that. */
const SPEECH = 0.3;

/** One value per `bucket_ms` of the file, 0 to 1 against its loudest moment, on a curve that lifts quiet speech
 *  (peak ^ 0.6) so the bars read as a waveform. Empty for a file with no samples. `wav` is a Uint8Array. */
export function loudness(wav, bucket_ms = 100) {
  const count = Math.floor((wav.byteLength - HEADER) / 2);
  if (count <= 0) return [];
  const at = wav.byteOffset + HEADER;
  // In place when the samples start on an even byte (they do when the file is read whole), else one copy.
  const pcm = at % 2 === 0 ? new Int16Array(wav.buffer, at, count) : new Int16Array(wav.buffer.slice(at, at + count * 2));
  const per = SAMPLES_PER_MS * bucket_ms;
  const stride = Math.max(STRIDE, Math.ceil(count / MAX_LOOKS));
  const peaks = [];
  let top = 0;
  for (let from = 0; from < count; from += per) {
    const to = Math.min(count, from + per);
    let peak = 0;
    for (let i = from; i < to; i += stride) {
      const level = pcm[i] < 0 ? -pcm[i] : pcm[i];
      if (level > peak) peak = level;
    }
    peaks.push(peak);
    top = Math.max(top, peak);
  }
  return top === 0 ? peaks : peaks.map((p) => (p / top) ** 0.6);
}

/** `count` bars across the whole file: the loudest moment in each. */
export function bars(loud, count) {
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * loud.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * loud.length) / count));
    return loud.slice(from, to).reduce((a, b) => Math.max(a, b), 0);
  });
}

/** Where there is speech, as [from_ms, to_ms] in time order: louder than the speech level, where a pause shorter than
 *  `bridge_ms` does not split a stretch and a stretch shorter than a quarter second is not one. The pauses are the
 *  gaps between them: real pauses the phone can hear, not yet cuts. */
export function speech(loud, bucket_ms = 100, bridge_ms = 500) {
  const out = [];
  let cur = null;
  loud.forEach((v, i) => {
    if (v > SPEECH) cur = cur ? [cur[0], (i + 1) * bucket_ms] : [i * bucket_ms, (i + 1) * bucket_ms];
    else if (cur && i * bucket_ms - cur[1] >= bridge_ms) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out.filter(([from, to]) => to - from >= 250);
}
