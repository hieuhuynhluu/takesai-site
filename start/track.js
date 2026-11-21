// Funnel events (specs/018-web-onboarding/contracts/start-page.md section 4): PostHog's capture API by fetch, no SDK.
// Anonymous by construction: the id below lives in memory for this page load only, nothing is stored, no cookie is
// sent, and no event carries a URL, a file name or a transcript word. Runs for every visitor (founder, 2026-11-20);
// the ad pixels are assets/site.js's and keep following the opt-out. Nothing is sent while posthogKey is empty.
import config from './config.js';

const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
let step = null;

/** Where the visitor came from, as one of a fixed list of words (contracts/start-page.md section 1): the link's ?src=,
 *  else "creator" for a link that carries a creator's ?ref=, else "direct". Only a word from the list is ever sent,
 *  so nothing typed into a URL can reach an event. */
const SOURCES = ['ad', 'meta', 'tiktok', 'creator', 'dm', 'home', 'beta', 'bio'];
export function sourceOf(search) {
  const q = new URLSearchParams(search), src = (q.get('src') ?? '').toLowerCase();
  return SOURCES.includes(src) ? src : q.get('ref') ? 'creator' : 'direct';
}
const src = sourceOf(location.search);

export const setStep = (name) => { step = name; };

export function track(event, props = {}) {
  if (!config.posthogKey) return;
  const body = JSON.stringify({
    api_key: config.posthogKey, event, distinct_id: id, timestamp: new Date().toISOString(),
    properties: { ...props, flow: 'web_onboarding', step, src, $process_person_profile: false, $geoip_disable: true },
  });
  // keepalive: an event sent on the tap that leaves for the checkout still goes out. A failed send is dropped.
  try {
    fetch(config.posthogHost + '/i/v0/e/', { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  } catch { /* a browser without keepalive: the funnel loses an event, the visitor loses nothing */ }
}
