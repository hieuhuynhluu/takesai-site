// Makes the two upload files of contracts/media-upload.md (audio.wav, frames.bin) and a manifest/1 from a phone
// video, in the browser. The video is never uploaded and never read whole: the index (moov), the audio track's
// packets and the first and last MiB (content_hash) are the only bytes read.
//
//   const { wav, frames, manifest, diag } = await extract(file)            // file: a File from <input type=file>
//   extract(file, { path: 'webcodecs' | 'adts', maxMs: 61500 })            // throws ExtractError with .code
import { ExtractError, fail, readMoov, parseMoov, sampleRuns } from './mp4.js';
import { PROBE } from './probe.js';

export { ExtractError };
const RATE = 16000, MAX_FRAMES = 500000;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---- frames.bin (media-upload.md section 3) ----

/** frame_ms of section 3.4, in whole numbers (seconds and the rest apart, so nothing leaves the exact range of a double). */
export const frameMs = (ticks, timescale) =>
  Math.floor(ticks / timescale) * 1000 + Math.floor(((ticks % timescale) * 1000 + Math.floor(timescale / 2)) / timescale);

/** Presentation time of every presented video frame, edits applied. The same rule as the app's FrameTimes.present:
 *  a frame is on screen until the next one; it is presented when that time overlaps an edit, from the edit's start at the earliest. */
export function frameTimes(moov, track) {
  // One timescale that holds media times and edit durations (movie ticks) exactly: times must not be rounded (3.2).
  const timescale = track.edits.length ? (moov.timescale / gcd(moov.timescale, track.timescale)) * track.timescale : track.timescale;
  if (timescale > 0xffffffff) fail('unsupported_codec', 'frame times need a timescale over 2^32');
  const km = timescale / track.timescale, kv = timescale / moov.timescale;
  const order = Array.from({ length: track.count }, (_, i) => i).sort((a, b) => track.cts[a] - track.cts[b]);
  const edits = track.edits.length ? track.edits : [{ duration: Infinity, mediaTime: 0, rate: 1 }];
  const pts = [];
  let endPts = 0, target = 0;
  for (const e of edits) {
    if (e.mediaTime >= 0) {
      // shortcut: refused; map times by the edit's rate if real sources have such edits (the app refuses them too).
      if (e.rate !== 1) fail('unsupported_codec', 'the video track has an edit that changes speed');
      const editStart = e.mediaTime * km, editEnd = editStart + e.duration * kv, offset = target - editStart;
      order.forEach((s, k) => {
        const start = track.cts[s] * km;
        const end = k + 1 < order.length ? track.cts[order[k + 1]] * km : track.dur[s] > 0 ? start + track.dur[s] * km : editEnd;
        if (end <= editStart || start >= editEnd) return;
        pts.push(Math.max(start, editStart) + offset);
        endPts = Math.min(end, editEnd) + offset;
      });
    }
    target += e.duration * kv;
  }
  if (!pts.length || pts[0] < 0 || !Number.isFinite(endPts)) fail('media_unreadable', 'no presented video frames');
  if (pts.length > MAX_FRAMES) fail('media_unreadable', `${pts.length} frames`);
  for (let k = 1; k < pts.length; k++) {
    if (frameMs(pts[k], timescale) <= frameMs(pts[k - 1], timescale) || pts[k] - pts[k - 1] > 0xffffffff) {
      fail('unsupported_codec', `frames ${k - 1} and ${k} cannot be told apart in milliseconds`);
    }
  }
  return { timescale, pts, durationMs: frameMs(endPts, timescale) };
}

/** The TKFT payload of section 3.2, before gzip. */
export function encodeFrames({ timescale, pts }) {
  const out = new Uint8Array(22 + 5 * (pts.length - 1)), v = new DataView(out.buffer);
  out.set([0x54, 0x4b, 0x46, 0x54]); // TKFT
  v.setUint16(4, 1, true); v.setUint32(6, timescale, true); v.setUint32(10, pts.length, true); v.setBigUint64(14, BigInt(pts[0]), true);
  let at = 22;
  for (let k = 1; k < pts.length; k++) {
    let d = pts[k] - pts[k - 1];
    for (; d >= 0x80; d = Math.floor(d / 128)) out[at++] = (d % 128) | 0x80;
    out[at++] = d;
  }
  return out.subarray(0, at);
}

const gzip = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

// ---- audio: read, decode ----

/** The audio track's packets: only their bytes are read from the file, one slice per run of touching packets. */
async function readPackets(file, track) {
  const { runs, size } = sampleRuns(track);
  const sizes = Array.from({ length: track.count }, (_, i) => size(i));
  const data = new Uint8Array(sizes.reduce((a, b) => a + b, 0));
  let at = 0;
  for (const [offset, length] of runs) {
    const part = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    if (part.length !== length) fail('media_unreadable', 'the file ends inside the audio');
    data.set(part, at); at += length;
  }
  return { data, sizes };
}

/** path name → decoder. Each returns the PCM it got: { frames, channels: Float32Array[] }. Exported so tests can add simulated decoders. */
export const DECODERS = {
  /** Every browser: the packets framed as ADTS, decoded by decodeAudioData at the track's own rate (so the browser does not resample). */
  async adts(asc, { data, sizes }) {
    // shortcut: HE-AAC that is not declared in the track's config (implicit SBR) is not noticed on this path and would
    // come out about 10 ms late; the webcodecs path refuses it by its output rate. Parse the bitstream if such files turn up.
    const out = new Uint8Array(data.length + 7 * sizes.length);
    let o = 0, i = 0;
    for (const n of sizes) {
      const len = n + 7;
      out.set([0xff, 0xf1, ((asc.objectType - 1) << 6) | (asc.rateIndex << 2) | (asc.channels >> 2),
        ((asc.channels & 3) << 6) | (len >> 11), (len >> 3) & 0xff, ((len & 7) << 5) | 0x1f, 0xfc], o);
      out.set(data.subarray(i, i + n), o + 7); o += len; i += n;
    }
    const buffer = await new OfflineAudioContext(1, 1, asc.rate).decodeAudioData(out.buffer);
    if (buffer.sampleRate !== asc.rate) fail('unsupported_codec', `decoded at ${buffer.sampleRate} Hz, not ${asc.rate}`);
    return { frames: buffer.length, channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)) };
  },

  /** WebCodecs (Chrome, Firefox, Safari 26+): one packet in, one buffer out, each with a timestamp. */
  async webcodecs(asc, { data, sizes }) {
    const cap = sizes.length * asc.frameLength, channels = Array.from({ length: asc.channels }, () => new Float32Array(cap));
    let frames = 0, error = null, first = null;
    const decoder = new AudioDecoder({
      output(d) {
        try {
          first ??= { timestamp: d.timestamp, frames: d.numberOfFrames };
          if (d.sampleRate !== asc.rate || d.numberOfChannels !== asc.channels || frames + d.numberOfFrames > cap) {
            throw new ExtractError('unsupported_codec', `decoder output is ${d.sampleRate} Hz, ${d.numberOfChannels} channels (HE-AAC?)`);
          }
          channels.forEach((c, i) => d.copyTo(c.subarray(frames, frames + d.numberOfFrames), { planeIndex: i, format: 'f32-planar' }));
          frames += d.numberOfFrames;
        } catch (e) { error ??= e; } finally { d.close(); }
      },
      error(e) { error ??= e; },
    });
    decoder.configure({ codec: 'mp4a.40.2', sampleRate: asc.rate, numberOfChannels: asc.channels, description: asc.bytes });
    let at = 0;
    sizes.forEach((n, i) => {
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((i * asc.frameLength * 1e6) / asc.rate), data: data.subarray(at, at + n) }));
      at += n;
    });
    await decoder.flush().catch((e) => { error ??= e; });
    if (decoder.state !== 'closed') decoder.close();
    if (error) throw error;
    return { frames, channels: channels.map((c) => c.subarray(0, frames)), first };
  },
};

/** The decode path this browser gets by default: WebCodecs where it decodes AAC, else decodeAudioData. */
export async function defaultPath() {
  const config = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1, description: new Uint8Array([0x11, 0x88]) };
  const ok = typeof AudioDecoder === 'function' && (await AudioDecoder.isConfigSupported(config).catch(() => null))?.supported;
  return ok ? 'webcodecs' : 'adts';
}

// ---- what the browser's decoder does with the start of an AAC stream ----
//
// An AAC track starts with "priming" packets (2112 samples from Apple's encoder, 1024 from ffmpeg's); the track's
// edit list says where real sound begins, in samples of the decoder's FULL output. A decoder may hand back that full
// output, or may already have cut samples off the front. So it is measured, once per path: a 10-packet stream with one
// pulse whose position in the full output is known (probe.js). What the decoder cut is known pulse position minus found position.
const calibrations = {};
export function calibrate(path) {
  return (calibrations[path] ??= (async () => {
    const bytes = Uint8Array.from(atob(PROBE.adts), (c) => c.charCodeAt(0)), sizes = [], parts = [];
    for (let at = 0; at + 7 <= bytes.length;) {
      const len = ((bytes[at + 3] & 3) << 11) | (bytes[at + 4] << 3) | (bytes[at + 5] >> 5);
      sizes.push(len - 7); parts.push(bytes.subarray(at + 7, at + len)); at += len;
    }
    const data = new Uint8Array(await new Blob(parts).arrayBuffer());
    const asc = { objectType: 2, rateIndex: 3, rate: 48000, channels: 1, frameLength: 1024, bytes: new Uint8Array([0x11, 0x88]) };
    const { frames, channels: [x] } = await DECODERS[path](asc, { data, sizes });
    let peak = 0;
    for (let i = 1; i < frames; i++) if (Math.abs(x[i]) > Math.abs(x[peak])) peak = i;
    const headTrim = PROBE.peak - peak, tailLost = PROBE.frames * 1024 - headTrim - frames;
    if (!(Math.abs(x[peak]) > 0.3) || headTrim < 0 || headTrim > 4096 || Math.abs(tailLost) > 4096) { // tailLost < 0: extra samples at the end
      fail('unsupported_codec', `this browser's AAC decoder could not be measured (peak ${peak}, ${frames} samples)`);
    }
    return { headTrim, tailLost, frames, peak };
  })());
}

// ---- audio.wav (media-upload.md section 2) ----

/** Section 2.3: every buffer at its own presentation time. buffers: [{ t (seconds), x (Float32Array) }] in order.
 *  Returns `total` samples with `pad` zeros on both sides (room for the resampler's filter). */
export function place(buffers, rate, total, pad = 0) {
  const out = new Float32Array(total + 2 * pad), tol = Math.round(rate / 1000);
  let cursor = 0, inserted = 0, trimmed = 0;
  buffers.forEach(({ t, x }, k) => {
    const d = Math.round(t * rate) - cursor;
    let skip = 0;
    if (d > 0 && (k === 0 || d > tol)) { cursor += d; if (k) inserted += d; } // the zeros are already there
    else if (d < 0 && (k === 0 || d < -tol)) { skip = Math.min(-d, x.length); if (k) trimmed += skip; }
    const n = Math.min(x.length - skip, total - cursor); // samples from `total` on are dropped
    if (n > 0) out.set(x.subarray(skip, skip + n), pad + cursor);
    cursor += x.length - skip;
  });
  return { out, inserted, trimmed };
}

// Windowed-sinc resampler. Output k is the input at exactly k * rate / 16000, through a symmetric filter, so it has
// no delay to compensate (section 2.2). Cut-off at 88% of the lower Nyquist, 32 zero crossings, Blackman-Harris window:
// flat to about 6 kHz and over 90 dB down from 8 kHz, for a 48 kHz or 44.1 kHz track.
const ZEROS = 32, CUTOFF = 0.44;
export const resamplePad = (rate) => Math.ceil(ZEROS / (2 * CUTOFF * Math.min(1, RATE / rate)));

/** `x` holds the samples with resamplePad(rate) zeros on both sides (see place). Returns exactly n samples at 16 kHz. */
export function resample(x, rate, n) {
  const g = gcd(rate, RATE), p = rate / g, q = RATE / g; // output k sits at input k * p / q
  const fc = CUTOFF * Math.min(1, RATE / rate), half = resamplePad(rate), taps = new Array(q);
  const filter = (phase) => { // weights for inputs floor(pos) - half + 1 .. floor(pos) + half, pos = integer + phase / q
    const h = new Float64Array(2 * half);
    let sum = 0;
    for (let j = 0; j < 2 * half; j++) {
      const t = j - half + 1 - phase / q, w = 0.5 + t / (2 * half), a = 2 * Math.PI * w;
      const window = w <= 0 || w >= 1 ? 0 : 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a);
      sum += h[j] = window * (t === 0 ? 1 : Math.sin(2 * Math.PI * fc * t) / (2 * Math.PI * fc * t));
    }
    return h.map((v) => v / sum); // unity gain at DC for every phase
  };
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const pos = k * p, phase = pos % q, h = (taps[phase] ??= filter(phase));
    let acc = 0;
    for (let j = 0, i = (pos - phase) / q + 1; j < 2 * half; j++, i++) acc += x[i] * h[j]; // x[i] is input i - half: the pad
    out[k] = acc;
  }
  return out;
}

/** Section 2.1: the canonical 44-byte header and the samples, rounded to nearest and clipped. */
export function wavBytes(samples) {
  const n = samples.length, out = new Uint8Array(44 + 2 * n), v = new DataView(out.buffer);
  const text = (at, s) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); v.setUint32(4, 36 + 2 * n, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, 2 * RATE, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, 2 * n, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + 2 * i, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), true);
  return out;
}

// ---- the manifest's video fields ----

const VIDEO_CODECS = { avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc', dvh1: 'hevc', dvhe: 'hevc', av01: 'av1' };
function videoFields(t) {
  const colr = t.config.colr, kind = colr && String.fromCharCode(...colr.subarray(0, 4));
  const transfer = kind === 'nclx' || kind === 'nclc' ? { 1: 'bt709', 16: 'smpte2084', 18: 'arib-std-b67' }[colr[6] * 256 + colr[7]] ?? null : null;
  // 8-bit for the H.264 profiles that only allow 8; HEVC states it in hvcC. Anything else is not guessed.
  const bitDepth = t.config.hvcC ? (t.config.hvcC[17] & 7) + 8 : t.config.avcC && [66, 77, 88, 100].includes(t.config.avcC[1]) ? 8 : null;
  const counts = new Map();
  for (const d of t.dur) counts.set(d, (counts.get(d) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0][0]; // the most common frame duration
  return {
    w: t.w, h: t.h, rotation: (((Math.round(Math.atan2(t.b, t.a) / (Math.PI / 2)) % 4) + 4) % 4) * 90,
    fps_nominal: usual > 0 ? t.timescale / usual : null, transfer,
    codec: VIDEO_CODECS[t.format] ?? (t.format.startsWith('ap') ? 'prores' : t.format.trim().toLowerCase()),
    bit_depth: [8, 10, 12].includes(bitDepth) ? bitDepth : null,
  };
}

// ---- the whole job ----

export async function extract(file, { path, maxMs = 61500 } = {}) {
  try {
    path ??= await defaultPath();
    const t0 = performance.now(), timings = {};
    const lap = (name, from) => { timings[name] = Math.round(performance.now() - from); return performance.now(); };

    const moov = parseMoov(await readMoov(file));
    const video = moov.tracks.find((t) => t.handler === 'vide' && t.count > 0) ?? fail('media_unreadable', 'no video track');
    const times = frameTimes(moov, video), durationMs = times.durationMs;
    if (durationMs < 1) fail('media_unreadable', 'the video has no length');
    if (durationMs > maxMs) fail('too_long', `${durationMs} ms, over ${maxMs}`);
    let t1 = lap('index_ms', t0);

    // Section 2.2: the first audio track that is enabled, decodable and not silent. Only AAC-LC is decodable here, which
    // also keeps a Spatial Audio (APAC) track from being picked.
    const audio = moov.tracks.filter((t) => t.handler === 'soun');
    if (!audio.length) fail('no_speech', 'the video has no audio track');
    const usable = audio.filter((t) => t.enabled && t.count > 0 && t.count < 1e6 && t.asc && t.asc.objectType === 2 && !t.asc.sbr
      && t.asc.frameLength === 1024 && t.asc.rateIndex < 13 && t.asc.channels >= 1 && t.asc.channels <= 6);
    if (!usable.length) fail('unsupported_codec', `no AAC-LC audio track (found ${audio.map((t) => (t.asc?.sbr ? 'HE-AAC' : t.format)).join(', ')})`);
    const calibration = await calibrate(path);
    // shortcut: the whole track is decoded into memory (about 23 MB a minute for 48 kHz stereo, several times that at the
    // peak), fine for a take of a minute; decode and resample in slices of packets if longer sources are ever allowed.
    let track, decoded, mono, sound = false;
    for (track of usable) {
      const packets = await readPackets(file, track);
      t1 = lap('read_audio_ms', t1);
      try { decoded = await DECODERS[path](track.asc, packets); } catch (e) {
        if (e instanceof ExtractError) throw e;
        fail('media_unreadable', `the audio could not be decoded (${e.message})`);
      }
      t1 = lap('decode_ms', t1);
      // A decoder that drops a damaged packet would shift everything after it; then the count is short, and we refuse.
      const expected = track.count * 1024 - calibration.headTrim - calibration.tailLost;
      if (decoded.frames !== expected) fail('media_unreadable', `the decoder returned ${decoded.frames} samples for ${track.count} packets, not ${expected}`);
      mono = decoded.channels[0];
      if (decoded.channels.length > 1) { // equal-weight mean of the channels
        mono = new Float32Array(decoded.frames);
        for (const c of decoded.channels) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / decoded.channels.length;
      }
      // Not silent: a sample that is not zero as 16-bit PCM, the app's own test (Probe.hasSound).
      if ((sound = mono.some((s) => Math.abs(s) >= 1 / 65536))) break;
    }
    if (!sound) fail('no_speech', 'the audio is silent');

    // The track's edits, as buffers with presentation times. Decoded sample j is sample j + headTrim of the track's media.
    const rate = track.asc.rate, perTick = rate / track.timescale, buffers = [];
    let start = 0; // movie ticks
    for (const e of track.edits.length ? track.edits : [{ duration: Infinity, mediaTime: 0, rate: 1 }]) {
      if (e.mediaTime >= 0) {
        if (e.rate !== 1) fail('unsupported_codec', 'the audio track has an edit that changes speed');
        const from = Math.round(e.mediaTime * perTick) - calibration.headTrim; // below 0: the decoder cut more than the edit skips
        const to = Math.min(mono.length, from + Math.round((e.duration / moov.timescale) * rate));
        buffers.push({ t: start / moov.timescale + Math.max(0, -from) / rate, x: mono.subarray(Math.max(0, from), Math.max(0, to)) });
      }
      start += e.duration;
    }
    // shortcut: packet-time gaps inside the track (stts) are ignored, so the track plays unbroken, as AVFoundation plays
    // it (media-upload.md section 1); inserted/trimmed only count gaps between edits. Android's reader may differ there.
    const pad = resamplePad(rate), placed = place(buffers, rate, Math.round((durationMs * rate) / 1000), pad);
    const wav = wavBytes(resample(placed.out, rate, durationMs * 16));
    t1 = lap('resample_ms', t1);

    const frames = await gzip(encodeFrames(times));
    const mib = 1048576, size = file.size, tailBytes = new DataView(new ArrayBuffer(16));
    tailBytes.setBigUint64(0, BigInt(size), true); tailBytes.setBigUint64(8, BigInt(durationMs), true);
    const contentHash = await hex(await new Blob(size <= 2 * mib ? [file.slice(0, size), tailBytes] : [file.slice(0, mib), file.slice(size - mib), tailBytes]).arrayBuffer());
    const at16k = (n) => Math.round((n * RATE) / rate);
    const manifest = {
      schema: 'manifest/1', source_id: 'src_01', order: 0, origin: 'import', content_hash: contentHash, bytes: size, duration_ms: durationMs,
      video: { ...videoFields(video), frame_count: times.pts.length, frames_sha256: await hex(frames), frames_bytes: frames.length },
      audio_tracks_found: audio.length,
      audio_original: { track_index: audio.indexOf(track), codec: 'aac', sample_rate: rate, channels: decoded.channels.length },
      audio_extract: { bytes: wav.length, sha256: await hex(wav), samples: durationMs * 16, inserted_samples: at16k(placed.inserted), trimmed_samples: at16k(placed.trimmed) },
      take_boundaries_ms: [],
      // platform "web": specs/018-web-onboarding/contracts/server-changes.md S4. os is the browser's own platform word.
      device: { platform: 'web', os: navigator.userAgentData?.platform || navigator.platform || 'unknown', model: 'browser', app_version: 'web' },
    };
    lap('hash_ms', t1); lap('total_ms', t0);
    const diag = {
      path, calibration, packets: track.count, decoded_frames: decoded.frames, first_buffer: decoded.first ?? null,
      audio_edits: track.edits, video_edits: video.edits, frame_timescale: times.timescale, first_frame_ms: frameMs(times.pts[0], times.timescale), timings,
    };
    return { wav, frames, manifest, diag };
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    throw new ExtractError('media_unreadable', e instanceof RangeError ? 'the index is damaged' : String(e?.message ?? e));
  }
}
