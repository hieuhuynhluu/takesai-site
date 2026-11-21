// Step 8, the web first cut (spec 018): read the visitor's video on their device, send only its sound and frame times
// along the phone's job path (contracts/job-api.md), and play the cut from their own file.
// The video is never uploaded and never stored (FR-010). Every state has its own words and a way on (FR-019).
import config from './config.js';
import { rewardLead, rewardTerms, finishedTitle } from './maths.js';
import { mount } from './player.js';
import { extract } from './media/extract.js';

const $ = (id) => document.getElementById(id);
const section = document.querySelector('.s-step[data-step="cut"]'), input = $('cut-file');
const SESSION = 'takesai.start.session', CUT = 'takesai.start.cut'; // data-model.md sections 3 and 4
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* blocked: this visit only */ } },
};
/** Empty server settings mean the web first cut is off and the step shows the example (research.md R12). */
const enabled = Boolean(config.supabaseUrl && config.supabaseKey);
const canRead = Boolean(globalThis.CompressionStream && globalThis.crypto?.subtle && (globalThis.AudioDecoder || globalThis.OfflineAudioContext));
/** A free cut of the visitor's own video can be offered here. Screen 1 names the reward only when it can (flow.js). */
export const offered = enabled && canRead;
const MAX_MS = 61500, POLL_MS = 2500, CUT_LIMIT_MS = 5 * 60000;

// The web's own words for each code: contracts/error-codes.json says "phone", and a browser is not one.
const COPY = {
  first_cut_too_long: ['Your free cut is for videos up to 1 minute', 'Choose a shorter one. Longer videos need a plan.'],
  no_speech: ['We couldn’t hear anyone talking', 'There isn’t enough speech in this video to make a cut. Choose another one.'],
  unsupported_codec: ['This browser can’t read that video format', 'Choose a different video, or save this one as a standard MP4 or MOV first.'],
  media_unreadable: ['We couldn’t read this video', 'The file looks damaged or incomplete. Choose another one.'],
  first_cut_unavailable: ['Your free cut isn’t available right now', 'Watch the example, or choose a plan to cut now.'],
  offline: ['You’re offline', 'Your video is still here. Check your connection and try again.'],
  upload_failed: ['The upload didn’t finish', 'Your video is still on this device. Check your connection and try again.'],
  stt_unavailable: ['We couldn’t transcribe this right now', 'The problem is on our side. Try again in a minute.'],
  timeout: ['This cut took too long', 'We stopped it instead of leaving you waiting. Try again.'],
  intake_paused: ['We’ve paused new cuts for a moment', 'We’re fixing a problem on our side. Try again in a few minutes.'],
  daily_limit: ['Sending is paused for now', 'Too many cuts stopped or failed in the last 24 hours. Try again within a day.'],
  language_mismatch: ['This doesn’t sound like English', 'The free cut on the web is for English videos for now. Choose another one.'],
  cancelled: ['You stopped this cut', 'Your video is still on this device.'],
  other_video: ['That’s a different video', 'Choose the one you sent, or go on to the plans.'],
  come_back: ['Your cut is ready', 'Choose the same video to watch it. It never left this device, so we don’t have it.'],
  internal: ['Something went wrong on our side', 'Try again. If it keeps happening, tell us at Support.'],
};
/** Failures the same video can be sent again after; the others need another video. */
const RETRY = new Set(['offline', 'upload_failed', 'stt_unavailable', 'timeout', 'intake_paused', 'cancelled', 'internal']);
const STAGES = ['Uploading your take', 'Writing out every word', 'Picking your best takes', 'Making the cuts', 'Checking every cut']; // the app's (stage-label.ts)
const STAGE_END = [0.25, 0.6, 0.8, 0.9, 0.99];
const RUNNING = { checking_audio: 2, transcribing: 2, choosing_takes: 3, placing_cuts: 4, checking_cuts: 5 };

class Stop extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
let ctx = null, run = 0, phase = 'idle', player = null, take = null, job = null, pending = null, access = null, startedAt = 0, step = 0;
let choosable = false; // the view on screen offers a way to choose a video, so a dropped one is taken too

// ---- views ----
function view(name) {
  for (const v of section.querySelectorAll('.s-view')) v.hidden = v.dataset.view !== name;
  choosable = name === 'start'; // the problem and player views say for themselves, below
  $('skip').hidden = name !== 'start'; // the bar's Skip, in place of the count, while the free cut is only on offer
  $('count').hidden = name === 'start';
  scrollTo(0, 0);
  section.querySelector(`[data-view="${name}"] h1`).focus({ preventScroll: true });
}
function closePlayer() { player?.destroy(); player = null; }
function busy(title, lead, stop, stages) {
  phase = stages ? 'cutting' : 'reading';
  closePlayer();
  $('busy-h').textContent = title;
  $('busy-lead').textContent = lead;
  $('busy-stages').hidden = !stages;
  section.querySelector('[data-act="stop"]').textContent = stop;
  step = 0;
  progress(stages ? 1 : 0);
  view('busy');
}
/** The bar creeps toward each step's end and reaches it only with the next real stage; it never goes back. */
function progress(to) {
  if (to < step) return;
  step = to;
  const from = to > 1 ? STAGE_END[to - 2] : 0, end = to ? STAGE_END[to - 1] : 0.5, p = Math.round((from + (end - from) * 0.9) * 100);
  $('busy-prog').style.setProperty('--p', `${p}%`);
  $('busy-prog').setAttribute('aria-valuenow', p);
  $('busy-step').textContent = to ? STAGES[to - 1] : '';
  [...$('busy-stages').children].forEach((li, i) => { li.className = i + 1 < to ? 'done' : i + 1 === to ? 'now' : ''; });
}
/** A state that is not the happy path: its own words, and always at least one way on. */
function problem(code, kind) {
  phase = 'problem';
  closePlayer();
  const [title, body] = COPY[code] ?? COPY.internal;
  $('problem-h').textContent = title;
  $('problem-body').textContent = body;
  // One red action, at most one quiet one, and the other ways on as plain links under them.
  const button = (label, act, main) => Object.assign(document.createElement('button'), { type: 'button', className: `btn btn-lg ${main ? 'btn-red' : 'btn-quiet'}`, textContent: label, onclick: act });
  const choose = (label, main) => button(label, () => input.click(), main), example = () => showExample(kind);
  const plans = Object.assign(document.createElement('a'), { className: 'not-app', href: ctx.checkoutUrl(), textContent: 'See the plans' });
  plans.dataset.checkout = kind === 'refused' ? 'refused' : 'failed';
  const links = Object.assign(document.createElement('p'), { className: 's-links' });
  if (kind !== 'refused' && kind !== 'return') links.append(Object.assign(document.createElement('button'), { type: 'button', textContent: 'Watch the example', onclick: example }));
  links.append(plans);
  const acts = kind === 'refused' ? [button('Watch the example', example, true)]
    : kind === 'return' ? [choose(code === 'other_video' ? 'Choose the video I sent' : 'Choose the video', true)]
      : take && RETRY.has(code) ? [button('Try again', () => send(), true), choose('Choose another video')]
        : [choose('Choose another video', true)];
  $('problem-acts').replaceChildren(...acts, links);
  view('problem');
  choosable = kind !== 'refused';
}
function showPlayer({ title, note, own, from, ...media }) {
  closePlayer();
  $('player-h').textContent = title;
  $('player-note').textContent = note;
  $('player-plan').textContent = ctx.planLine;
  $('player-own').hidden = !own;
  section.querySelector('[data-view="player"] [data-checkout]').dataset.checkout = from;
  view('player');
  choosable = Boolean(own);
  player = mount($('player'), { ...media, onRestore: (p) => ctx.track('start_part_restored', p) });
  player.start();
}
async function showExample(from) {
  phase = 'example';
  pending = null;
  try {
    const demo = await (await fetch('../assets/demo/demo.json')).json();
    if (phase !== 'example') return;
    const data = { duration: demo.duration, wave: demo.wave, waveStep: demo.waveStep, words: demo.words,
      segments: demo.segments.map((sg) => ({ s: sg.s, e: sg.e, ...(sg.cut ? { reason: /take/i.test(sg.cut) ? 'retake' : 'dead_air' } : {}) })) };
    showPlayer({ src: '../assets/demo/raw.mp4', poster: '../assets/demo/poster.jpg', data, title: 'Here’s one we cut.', from: 'example',
      note: 'A real take and its real cut. TakesAI does this to every video you send.', own: enabled && canRead && store.get(CUT)?.state !== 'ready' });
    ctx.track('start_example_opened', { from });
  } catch { problem('internal', 'refused'); }
}

// ---- reading the video, on the device ----
/** The browser must also be able to show the video, or the visitor would spend their free cut on a black frame (research.md R6). */
function playable(url) {
  return new Promise((ok, no) => {
    const v = document.createElement('video'), done = (fn, value) => { clearTimeout(timer); v.onerror = v.onloadedmetadata = null; v.removeAttribute('src'); v.load(); fn(value); };
    const timer = setTimeout(() => done(no, new Stop('media_unreadable')), 15000);
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.onloadedmetadata = () => (v.videoWidth > 0 ? done(ok) : done(no, new Stop('unsupported_codec')));
    v.onerror = () => done(no, new Stop('unsupported_codec'));
    v.src = url;
  });
}
/** Loudness for the timeline: the peak of each tenth of a second of the 16 kHz sound, scaled to the take's loudest. */
function waveOf(wav) {
  const v = new DataView(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44), n = v.byteLength >> 1, out = [];
  for (let i = 0; i < n; i += 1600) { let peak = 0; for (let k = i; k < Math.min(n, i + 1600); k += 8) peak = Math.max(peak, Math.abs(v.getInt16(2 * k, true))); out.push(peak); }
  const top = Math.max(1, ...out);
  return out.map((p) => Math.round((p / top) * 1000) / 1000);
}
async function chosen(file, via = 'picker') {
  const mine = ++run, resume = pending;
  ctx.track('start_video_chosen', { size_mb: Math.round(file.size / 1e6), via });
  busy('Reading your video', 'It stays on this device. Only its sound is sent.', 'Cancel', false);
  const url = URL.createObjectURL(file);
  try {
    const limit = new Promise((_, no) => setTimeout(() => no(new Stop('media_unreadable')), 60000));
    // Both run at once; the read's own reason wins (a file that is no video at all fails both).
    const [read, shown] = await Promise.allSettled([Promise.race([extract(file, { maxMs: MAX_MS }), limit]), playable(url)]);
    if (read.status === 'rejected') throw read.reason;
    if (shown.status === 'rejected') throw shown.reason;
    const made = read.value;
    if (mine !== run) return URL.revokeObjectURL(url);
    if (resume && made.manifest.content_hash !== resume.content_hash) { URL.revokeObjectURL(url); return problem('other_video', 'return'); }
    if (take) URL.revokeObjectURL(take.url);
    take = { url, made, wave: waveOf(made.wav) };
  } catch (e) {
    URL.revokeObjectURL(url);
    if (mine !== run) return;
    const code = e?.code === 'too_long' ? 'first_cut_too_long' : COPY[e?.code] ? e.code : 'media_unreadable';
    ctx.track('start_read_failed', { code });
    return problem(code, resume ? 'return' : 'read');
  }
  if (!resume) return send();
  // Back for a cut made earlier: the same video is here again, so fetch the cut and play it.
  pending = null;
  job = resume.job_id;
  session().then(() => watch(mine, resume.job_id), (e) => { if (mine === run) failed(COPY[e.code] ? e.code : 'internal'); });
}

// ---- the server: an anonymous session, the web guard, the job (contracts/start-page.md section 6) ----
//
// One rule keeps the free cut safe (data-model.md section 4). The record in this browser names the one job the server
// may still hold, and it is removed only when the server itself says that job is over: failed, cancelled, or unknown
// to it. Never on a guess. A Stop that did not arrive, a dropped connection or a reload must not leave a live job with
// no record: the server refuses a second job beside it, and the visitor would be told their free cut is gone. So the
// same video always sends the recorded job again (create-job answers a stored job in whatever state it has reached,
// job-api.md 4.1), and another video first has the recorded job ended.
const offline = (e) => (e instanceof Stop ? e : new Stop('offline')); // fetch itself failed: no connection
async function call(path, body, auth = true) {
  const res = await fetch(config.supabaseUrl + path, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${access}` } : {}) } }).catch((e) => { throw offline(e); });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Stop(data?.error?.code ?? 'internal', res.status);
  return data;
}
/** The browser's anonymous account: the stored one again, and a new one only when Auth says the stored one is gone
 *  (400 or 401). Any other failure is passing, and a new account could not see the job the old one made. */
async function session() {
  const kept = store.get(SESSION);
  let s = null;
  if (kept?.refresh_token) s = await call('/auth/v1/token?grant_type=refresh_token', { refresh_token: kept.refresh_token }, false).catch((e) => { if (e.status === 400 || e.status === 401) return null; throw e; });
  if (!s) {
    s = await call('/auth/v1/signup', { data: {} }, false);
    store.set(CUT, null); // a new account: whatever the old one made is out of reach
  }
  if (!s?.access_token) throw new Stop('first_cut_unavailable');
  access = s.access_token;
  store.set(SESSION, { refresh_token: s.refresh_token });
}
/** The human check (Cloudflare Turnstile), loaded only now, and a fresh token for every grant (Cloudflare takes a
 *  token once). No site key: no token, and the server decides. */
function humanCheck() {
  if (!config.turnstileSiteKey) return null;
  return new Promise((ok, no) => {
    const fail = () => no(new Stop('first_cut_unavailable')), timer = setTimeout(fail, 30000);
    const render = () => {
      const box = $('busy-lead').appendChild(document.createElement('span'));
      globalThis.turnstile.render(box, { sitekey: config.turnstileSiteKey, appearance: 'interaction-only',
        callback: (token) => { clearTimeout(timer); box.remove(); ok(token); }, 'error-callback': () => { clearTimeout(timer); fail(); } });
    };
    if (globalThis.turnstile) return render();
    const s = Object.assign(document.createElement('script'), { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true, onload: render, onerror: fail });
    document.head.append(s);
  });
}
function uuidv7() {
  const b = crypto.getRandomValues(new Uint8Array(16)), t = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** One file to its signed URL: up to 5 tries, backing off; a retry starts from zero (job-api.md 4.2). */
async function put(target, bytes, mine) {
  for (let i = 0; i < 5; i++) {
    if (i) await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1) * (0.75 + Math.random() / 2)));
    if (mine !== run) throw new Stop('cancelled');
    const res = await fetch(target.signed_url, { method: target.method, headers: target.headers, body: bytes }).catch(() => null);
    if (res?.ok) return;
  }
  throw new Stop(navigator.onLine === false ? 'offline' : 'upload_failed');
}
const ended = (state) => state === 'failed' || state === 'cancelled';
/** Asks the server to stop a job. The record goes only when the server answers that it has. */
function endJob(id) {
  return call('/functions/v1/cancel-job', { job_id: id }).then((r) => {
    if (r?.job?.state === 'cancelled' && store.get(CUT)?.job_id === id) store.set(CUT, null);
  }, () => { /* not stopped as far as we know: the record stays, and the next try finds out */ });
}
/** How this browser's earlier job stands once it has been asked to stop: 'over', 'ready', or 'alive' if the server
 *  would neither stop it nor call it finished. */
async function settle(id) {
  const stopped = await call('/functions/v1/cancel-job', { job_id: id }).catch((e) => { if (e.code === 'not_found' || e.code === 'invalid_state') return null; throw e; });
  if (stopped?.job?.state === 'cancelled') return 'over';
  const [row] = await call(`/rest/v1/jobs?id=eq.${id}&select=id,state`);
  return !row || ended(row.state) ? 'over' : row.state === 'ready' ? 'ready' : 'alive';
}
async function send() {
  const mine = ++run, { made } = take, hash = made.manifest.content_hash;
  busy('Cutting your video', 'About a minute. Keep this page open.', 'Stop', true);
  startedAt = performance.now();
  job = null;
  // The record is written before the request leaves, so a job whose answer is lost on the way back is still known.
  const create = (id) => {
    store.set(CUT, { job_id: id, state: 'sent', content_hash: hash, at: new Date().toISOString() });
    return call('/functions/v1/create-job', { job_id: id, sources: [made.manifest], language: 'en', pace: 'natural' });
  };
  try {
    await session();
    const kept = store.get(CUT);
    let id = kept?.job_id ?? null, created = null;
    if (id && kept.content_hash !== hash) { // another video: this browser's earlier job has to be over first
      const stands = kept.state === 'ready' ? 'ready' : await settle(id);
      if (mine !== run) return;
      if (stands === 'ready') { store.set(CUT, { ...kept, state: 'ready' }); return comeBack(); }
      if (stands !== 'over') return refused('first_cut_unavailable');
      store.set(CUT, null);
      id = null;
    }
    // The same video: its job again, as the server has it. Not there and no grant left: a new job, below.
    if (id) created = await create(id).catch((e) => { if (e.code === 'subscription_required') return null; throw e; });
    if (!created || ended(created.job?.state)) {
      const token = await humanCheck();
      const grant = await call('/functions/v1/first-cut-device', { platform: 'web', ...(token ? { token } : {}) });
      if (mine !== run) return;
      if (!grant.granted) { store.set(CUT, null); return refused(grant.reason ?? 'first_cut_unavailable'); }
      created = await create(id = uuidv7());
      ctx.track('start_cut_started', { duration_s: Math.round(made.manifest.duration_ms / 1000) });
    }
    // Stopped while create-job was on its way: the job exists now, so it is stopped too.
    if (mine !== run) return void endJob(id);
    job = id;
    if (created.job?.state === 'awaiting_audio') {
      await Promise.all((created.upload_targets ?? []).map((t) => put(t, t.kind === 'audio' ? made.wav : made.frames, mine)));
      await call('/functions/v1/confirm-upload', { job_id: id });
    }
    await watch(mine, id);
  } catch (e) {
    if (mine !== run) return;
    // Refused at create-job: no job was made under this id, so there is nothing to remember.
    if (e.code === 'subscription_required' || e.code === 'first_cut_unavailable') { store.set(CUT, null); return refused('first_cut_unavailable'); }
    failed(COPY[e.code] ? e.code : 'internal');
  }
}
function refused(reason) {
  ctx.track('start_cut_refused', { reason });
  problem(COPY[reason] ? reason : 'first_cut_unavailable', 'refused');
}
/** over: the server said this job has ended, so it is forgotten and the next try is a new job (it allows three). */
function failed(code, over = false) {
  if (over) store.set(CUT, null);
  ctx.track('start_cut_failed', { code });
  problem(code, 'failed');
}
/** Reads the job row until it ends. A dropped connection only waits; the cut is made on the server either way. */
async function watch(mine, id) {
  const until = Date.now() + CUT_LIMIT_MS;
  try {
    for (let first = true; ; first = false) {
      await new Promise((r) => setTimeout(r, first ? 600 : POLL_MS));
      if (mine !== run) return;
      const rows = await call(`/rest/v1/jobs?id=eq.${id}&select=id,state,stage,failure_code,updated_at`).catch((e) => { if (e.code === 'offline') return null; throw e; });
      if (mine !== run) return;
      if (rows && !rows.length) { store.set(CUT, null); return take ? failed('internal') : start(); } // the server does not know this job
      const row = rows?.[0];
      if (row?.state === 'ready') return await ready(mine, id);
      if (ended(row?.state)) return failed(row.failure_code ?? 'cancelled', true);
      // Back after a reload with the job still waiting for its audio: this page has no file to send. The start is the
      // way on; the record stays, so the same video sends this job again.
      if (row?.state === 'awaiting_audio' && !take) return start();
      if (row) progress(row.state === 'running' ? RUNNING[row.stage ?? 'checking_audio'] ?? step : 1);
      if (Date.now() > until) return failed(rows ? 'timeout' : 'offline');
    }
  } catch (e) { if (mine === run) failed(COPY[e.code] ? e.code : 'internal'); }
}
async function ready(mine, id) {
  store.set(CUT, { ...store.get(CUT), job_id: id, state: 'ready' });
  if (!take) return comeBack(); // the page was reloaded while it was cut: the video has to be chosen again
  const { cut } = await call('/functions/v1/get-cut', { job_id: id });
  const get = async (f) => { const r = await fetch(f.url).catch((e) => { throw offline(e); }); if (!r.ok) throw new Stop('internal'); return r.json(); };
  const [cutlist, transcript] = await Promise.all([get(cut.files.cutlist), get(cut.files.transcript)]);
  if (mine !== run) return;
  // The cut must be the one the server named, made on this very frame table (job-api.md 4.5).
  if (cutlist.cutlist_hash !== cut.cutlist_hash || cutlist.sources?.[0]?.frames_sha256 !== take.made.manifest.video.frames_sha256) throw new Stop('internal');
  const D = cutlist.sources[0].duration_ms / 1000, segments = [];
  let at = 0;
  for (const r of [...cutlist.paces[cutlist.default_pace].removals].sort((a, b) => a.src_in_ms - b.src_in_ms)) {
    const s = Math.max(at, r.src_in_ms / 1000), e = r.src_out_ms / 1000;
    if (e <= s) continue;
    if (s > at) segments.push({ s: at, e: s });
    segments.push({ s, e, reason: r.reason });
    at = e;
  }
  if (at < D) segments.push({ s: at, e: D });
  const words = (transcript.tokens ?? []).filter((t) => t.type === 'word').map((t) => [t.start_ms / 1000, t.end_ms / 1000, t.text]);
  const basic = cutlist.flags?.fallback_used === 'baseline', none = !segments.some((sg) => sg.reason);
  phase = 'ready';
  showPlayer({ src: take.url, data: { duration: D, segments, wave: take.wave, waveStep: 0.1, words }, title: finishedTitle(ctx.goalWeek), from: 'ready', own: false,
    note: (none ? 'We found nothing to cut in this one. ' : basic ? 'A basic cut: pauses only. A full cut also removes retakes and filler words, and adds captions. ' : '')
      + 'You can watch it here. Saving and exporting happen in the app.' });
  ctx.track('start_cut_ready', { raw_s: Math.round(D), cut_s: Math.round(player.cutSeconds()), removals: player.removals, wait_s: startedAt ? Math.round((performance.now() - startedAt) / 1000) : null });
}
function comeBack() {
  pending = store.get(CUT);
  problem('come_back', 'return');
}
function stop() {
  const wasCutting = phase === 'cutting', id = job ?? store.get(CUT)?.job_id;
  run++;
  if (!wasCutting) return start(); // a read was cancelled: nothing was sent
  ctx.track('start_cut_stopped');
  if (id) endJob(id);
  problem('cancelled', 'failed');
}
function start() {
  phase = 'idle';
  pending = null;
  closePlayer();
  view('start');
}

// ---- opening and leaving the step ----
/** ctx: { goalWeek, planLine, checkoutUrl(), track(event, props) } from flow.js. */
export function open(c) {
  ctx = c;
  $('cut-lead').textContent = rewardLead(ctx.goalWeek);
  $('cut-terms').textContent = rewardTerms(false);
  $('player-plan').textContent = ctx.planLine;
  if (phase !== 'idle') return; // back on the step mid-way: what was showing still is
  if (!enabled || !canRead) return showExample(enabled ? 'unreadable' : 'off');
  const kept = store.get(CUT);
  if (kept?.state === 'ready') return comeBack();
  if (!kept?.job_id) return start();
  // A job from before a reload: see how it stands. The record stays whatever happens here.
  const mine = ++run;
  busy('Cutting your video', 'About a minute. Keep this page open.', 'Stop', true);
  job = kept.job_id;
  session().then(() => watch(mine, kept.job_id), () => { if (mine === run) start(); });
}
export function leave() { player?.pause(); }

section.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'choose') input.click();
  if (act === 'example') showExample('start');
  if (act === 'stop') stop();
});
input.addEventListener('change', () => { const file = input.files[0]; input.value = ''; if (file) chosen(file); });

// ---- drag and drop (a computer): a video dropped anywhere on the step is chosen, as with the button ----
// The handlers are on the window and always cancel a file drag, on every step: left alone, the browser would open the
// dropped video in this tab and the visitor would lose the flow.
const veil = $('cut-veil');
const dragsFile = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
const takesDrop = () => choosable && !section.hidden;
let dragDepth = 0; // dragenter and dragleave fire for every element crossed, so they are counted
addEventListener('dragenter', (e) => { if (!dragsFile(e)) return; e.preventDefault(); dragDepth++; veil.hidden = !takesDrop(); });
addEventListener('dragover', (e) => { if (!dragsFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = takesDrop() ? 'copy' : 'none'; });
addEventListener('dragleave', (e) => { if (dragsFile(e) && --dragDepth <= 0) { dragDepth = 0; veil.hidden = true; } });
addEventListener('drop', (e) => {
  if (!dragsFile(e)) return;
  e.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  const file = e.dataTransfer.files[0]; // one video: the first, if several were dropped
  if (file && takesDrop()) chosen(file, 'drop');
});
