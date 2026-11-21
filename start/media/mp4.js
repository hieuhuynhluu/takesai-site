// The part of ISO BMFF / QuickTime a phone video needs: find moov by walking box headers with File.slice,
// then read the sample tables. Nothing here reads mdat. Works on a File or any Blob (Node: fs.openAsBlob).

export class ExtractError extends Error {
  /** code: too_long | no_speech | unsupported_codec | media_unreadable (contracts/error-codes.json). */
  constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; this.detail = detail; }
}
export const fail = (code, detail) => { throw new ExtractError(code, detail); };

const MAX_MOOV = 64 * 2 ** 20; // a 2-hour 60 fps take has about 6 MB of tables
const FIRST_BOXES = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

const fourcc = (v, at) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
const u64 = (v, at) => v.getUint32(at) * 2 ** 32 + v.getUint32(at + 4);
const i64 = (v, at) => v.getInt32(at) * 2 ** 32 + v.getUint32(at + 4);

/** One box header at `at`; `end` is where the parent ends (a size of 0 means "to the end"). */
function header(v, at, end) {
  let size = v.getUint32(at), head = 8;
  if (size === 1) { size = u64(v, at + 8); head = 16; } else if (size === 0) size = end - at;
  return { type: fourcc(v, at + 4), body: at + head, next: at + size, ok: size >= head };
}

/** The body of the moov box. Reads 16 bytes per top-level box, then moov itself. */
export async function readMoov(file) {
  for (let at = 0; at + 8 <= file.size;) {
    const b = header(new DataView(await file.slice(at, at + 16).arrayBuffer()), 0, file.size - at);
    if (at === 0 && !FIRST_BOXES.has(b.type)) fail('unsupported_codec', 'not an MP4 or MOV file');
    if (b.type === 'moof') fail('unsupported_codec', 'fragmented MP4');
    if (!b.ok || at + b.next > file.size) fail('media_unreadable', `box ${b.type} at ${at} has a bad size`);
    if (b.type === 'moov') {
      if (b.next > MAX_MOOV) fail('media_unreadable', 'the index is too large');
      return new DataView(await file.slice(at + b.body, at + b.next).arrayBuffer());
    }
    at += b.next;
  }
  fail('media_unreadable', 'no moov box (the file may be cut short)');
}

function* children(v, start, end) {
  for (let at = start; at + 8 <= end;) {
    const b = header(v, at, end);
    if (!b.ok) return; // QuickTime ends some containers with four zero bytes
    if (b.next > end) fail('media_unreadable', `box ${b.type} runs past its parent`);
    yield b;
    at = b.next;
  }
}
const child = (v, box, type) => { for (const b of children(v, box.body, box.next)) if (b.type === type) return b; return null; };
const need = (v, box, type) => child(v, box, type) ?? fail('media_unreadable', `no ${type} box`);

/** A full box's table: `count` entries of `width` bytes after `skip` bytes of fixed fields. */
function table(v, box, skip = 0) {
  const count = v.getUint32(box.body + 4 + skip), at = box.body + 8 + skip;
  if (at + count > box.next) fail('media_unreadable', 'a table runs past its box');
  return { count, at };
}

/** moov → { timescale, tracks }. Throws ExtractError; a RangeError from a short box is media_unreadable. */
export function parseMoov(v) {
  try {
    const moov = { body: 0, next: v.byteLength };
    if (child(v, moov, 'mvex')) fail('unsupported_codec', 'fragmented MP4');
    const mvhd = need(v, moov, 'mvhd');
    const timescale = v.getUint32(mvhd.body + (v.getUint8(mvhd.body) === 1 ? 20 : 12));
    const tracks = [...children(v, 0, v.byteLength)].filter((b) => b.type === 'trak').map((b) => parseTrack(v, b));
    return { timescale, tracks };
  } catch (e) {
    if (e instanceof RangeError) fail('media_unreadable', 'the index is damaged');
    throw e;
  }
}

function parseTrack(v, trak) {
  const tkhd = need(v, trak, 'tkhd'), mdia = need(v, trak, 'mdia');
  const mdhd = need(v, mdia, 'mdhd'), stbl = need(v, need(v, mdia, 'minf'), 'stbl');
  const matrix = tkhd.body + (v.getUint8(tkhd.body) === 1 ? 52 : 40);
  const t = {
    enabled: (v.getUint8(tkhd.body + 3) & 1) === 1,
    handler: fourcc(v, need(v, mdia, 'hdlr').body + 8), // vide, soun, meta ...
    timescale: v.getUint32(mdhd.body + (v.getUint8(mdhd.body) === 1 ? 20 : 12)),
    a: v.getInt32(matrix), b: v.getInt32(matrix + 4), // first row of the display matrix: the rotation
    edits: [], // { duration (movie ticks), mediaTime (media ticks, -1 = empty), rate }
  };
  if (t.timescale < 1) fail('media_unreadable', 'a track has no timescale');
  if (t.handler !== 'vide' && t.handler !== 'soun') return t; // metadata, timecode, text: nothing below is needed, or always there

  const edts = child(v, trak, 'edts'), elst = edts && child(v, edts, 'elst');
  if (elst) {
    const wide = v.getUint8(elst.body) === 1, { count, at } = table(v, elst);
    for (let i = 0, p = at; i < count; i++, p += wide ? 20 : 12) {
      t.edits.push(wide
        ? { duration: u64(v, p), mediaTime: i64(v, p + 8), rate: v.getInt32(p + 16) / 65536 }
        : { duration: v.getUint32(p), mediaTime: v.getInt32(p + 4), rate: v.getInt32(p + 8) / 65536 });
    }
  }

  // Sample description: the first entry only.
  // shortcut: a track with several sample descriptions is read as its first, refuse it if real sources have them.
  const entry = need(v, stbl, 'stsd').body + 8;
  t.format = fourcc(v, entry + 4);
  const entryEnd = entry + v.getUint32(entry);
  if (t.handler === 'vide') {
    t.w = v.getUint16(entry + 32); t.h = v.getUint16(entry + 34);
    t.config = {};
    for (const b of children(v, entry + 86, entryEnd)) t.config[b.type] = new Uint8Array(v.buffer, v.byteOffset + b.body, b.next - b.body);
  } else if (t.handler === 'soun') {
    // QuickTime sound description versions 0, 1 and 2 put the child boxes at different offsets; esds may sit inside 'wave'.
    const version = v.getUint16(entry + 16), kids = { type: '', body: entry + [36, 52, 72][version], next: entryEnd };
    const esds = version > 2 ? null : child(v, kids, 'esds') ?? (child(v, kids, 'wave') && child(v, child(v, kids, 'wave'), 'esds'));
    t.asc = esds && audioSpecificConfig(v, esds);
  }

  // Sample tables.
  const stts = table(v, need(v, stbl, 'stts')), ctts = child(v, stbl, 'ctts') && table(v, child(v, stbl, 'ctts'));
  const stsz = need(v, stbl, 'stsz'); // shortcut: stz2 (compact sizes) is not read, add it if a phone ever writes it.
  t.count = v.getUint32(stsz.body + 8);
  t.sizes = { fixed: v.getUint32(stsz.body + 4), at: stsz.body + 12 };
  t.stsc = table(v, need(v, stbl, 'stsc'));
  const co64 = child(v, stbl, 'co64');
  t.chunks = { ...table(v, co64 ?? need(v, stbl, 'stco')), wide: !!co64 };
  t.v = v;
  // Audio needs no time table (its packets are played unbroken), and a PCM track has one entry per sample: millions.
  if (t.handler === 'soun') return t;
  if (t.count > 1e6) fail('media_unreadable', `the video track claims ${t.count} frames`); // 30 minutes at 240 fps is 432,000

  // Decode time and duration of every frame, then the composition offset (signed in every version, as players read it).
  t.dts = new Float64Array(t.count); t.dur = new Float64Array(t.count); t.cts = new Float64Array(t.count);
  let k = 0, time = 0;
  for (let i = 0; i < stts.count && k < t.count; i++) {
    const n = v.getUint32(stts.at + i * 8), d = v.getUint32(stts.at + i * 8 + 4);
    for (let j = 0; j < n && k < t.count; j++, k++, time += d) { t.dts[k] = time; t.dur[k] = d; }
  }
  if (k < t.count) fail('media_unreadable', 'the time table is shorter than the sample table');
  t.cts.set(t.dts);
  for (let i = 0, s = 0; ctts && i < ctts.count && s < t.count; i++) {
    const n = v.getUint32(ctts.at + i * 8), off = v.getInt32(ctts.at + i * 8 + 4);
    for (let j = 0; j < n && s < t.count; j++, s++) t.cts[s] += off;
  }
  return t;
}

/** esds → { objectType (2 = AAC-LC), rateIndex, rate, channels, frameLength, sbr, bytes }, or null when it is not MPEG-4 audio. */
function audioSpecificConfig(v, esds) {
  let p = esds.body + 4;
  const descriptor = (tag) => { // → payload length, with p at the payload
    if (v.getUint8(p++) !== tag) fail('media_unreadable', 'esds is damaged');
    let len = 0, b;
    do { b = v.getUint8(p++); len = len * 128 + (b & 0x7f); } while (b & 0x80);
    return len;
  };
  descriptor(0x03);
  const flags = v.getUint8(p + 2);
  p += 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + v.getUint8(p + 3) : 0) + (flags & 0x20 ? 2 : 0);
  descriptor(0x04);
  if (v.getUint8(p) !== 0x40) return null; // not MPEG-4 audio (MP3 in MP4 is 0x69 / 0x6B)
  p += 13;
  const len = descriptor(0x05), bytes = new Uint8Array(v.buffer, v.byteOffset + p, len);
  let bit = 0;
  const bits = (n) => { let x = 0; for (; n > 0; n--, bit++) x = x * 2 + ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1); return x; };
  let objectType = bits(5); if (objectType === 31) objectType = 32 + bits(6);
  const index = bits(4), rate = index === 15 ? bits(24) : [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350][index];
  const channels = bits(4), frameLength = bits(1) ? 960 : 1024;
  if (bits(1)) bits(14); // dependsOnCoreCoder
  bits(1);
  // HE-AAC: its own object type, or AAC-LC followed by the 0x2b7 extension that says SBR is present (Apple writes this form).
  const sbr = objectType === 5 || objectType === 29 || (len * 8 - bit >= 17 && bits(11) === 0x2b7 && bits(5) === 5 && bits(1) === 1);
  return { objectType, rateIndex: index, rate, channels, frameLength, sbr, bytes: bytes.slice() };
}

/** Byte runs [offset, length] of a track's samples, in sample order, with touching samples joined into one run. */
export function sampleRuns(t) {
  const v = t.v, size = (i) => t.sizes.fixed || v.getUint32(t.sizes.at + i * 4), runs = [];
  let s = 0;
  for (let i = 0; i < t.stsc.count && s < t.count; i++) {
    const first = v.getUint32(t.stsc.at + i * 12), per = v.getUint32(t.stsc.at + i * 12 + 4);
    const last = i + 1 < t.stsc.count ? v.getUint32(t.stsc.at + (i + 1) * 12) - 1 : t.chunks.count;
    for (let c = first; c <= Math.min(last, t.chunks.count) && s < t.count; c++) {
      let at = t.chunks.wide ? u64(v, t.chunks.at + (c - 1) * 8) : v.getUint32(t.chunks.at + (c - 1) * 4), len = 0;
      for (let j = 0; j < per && s < t.count; j++, s++) len += size(s);
      const prev = runs[runs.length - 1];
      if (prev && prev[0] + prev[1] === at) prev[1] += len; else runs.push([at, len]);
    }
  }
  if (s < t.count) fail('media_unreadable', 'the chunk table is shorter than the sample table');
  return { runs, size };
}
