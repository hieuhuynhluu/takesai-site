/* TakesAI site script (spec 007 FR-012..014), deferred on every page but /go/ and 404. Ad pixels run only
   when their ID is set, with no opt-out and no Global Privacy Control. Empty ID = off. No test IDs here. */
(function () {
  'use strict';
  var META_PIXEL_ID = '4650942875177564'; // Meta dataset "takesai.app" in the Takesai business portfolio
  var TIKTOK_PIXEL_ID = 'DBSNPP3C77UCDH70LT8G'; // TikTok pixel "takesai.app" (TakesAI Business Center; AAM and enhanced postback off)
  var TOLT_PUBLIC_KEY = 'pk_CUrZedEBgvsoNZcikqPqnYPs';

  // Pages the app opens (?from=app) hide the ways to buy outside the app for the rest of the visit: links to /earn/
  // and /checkout/ carry class "not-app" (guideline 3.1.1(a); build decision "The app links a web plan to the cancel page").
  var fromApp = new URLSearchParams(location.search).get('from') === 'app';
  try {
    if (fromApp) sessionStorage.setItem('takesai.from', 'app');
    else fromApp = sessionStorage.getItem('takesai.from') === 'app';
  } catch (e) {} // storage blocked: only the page opened with ?from=app is covered
  if (fromApp) document.documentElement.classList.add('from-app');

  var KEY = 'takesai.optout';
  // data-track name -> Meta custom event (research R5)
  var EVENTS = { download: 'Download', affiliate_signup: 'AffiliateSignup', checkout_start: 'CheckoutStart' };
  var stopped = false; // opted out on this page, even if the browser refused to save it
  var loaded = false;

  function optedOut() {
    if (stopped || navigator.globalPrivacyControl === true) return true;
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return true; } // unreadable: fail safe to out
  }

  function addScript(src, attrs) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    for (var k in attrs) s.setAttribute(k, attrs[k]);
    document.head.appendChild(s);
  }

  function loadPixels() {
    if (loaded || optedOut() || !(META_PIXEL_ID || TIKTOK_PIXEL_ID)) return;
    loaded = true;
    if (META_PIXEL_ID) {
      // Meta's documented base code.
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('set', 'autoConfig', false, META_PIXEL_ID); // no automatic button-click or page-metadata events: only what we send
      fbq('init', META_PIXEL_ID);
      fbq('track', 'PageView');
    }
    if (TIKTOK_PIXEL_ID) {
      // TikTok's documented base code.
      !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=d.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
      ttq.load(TIKTOK_PIXEL_ID);ttq.page()}(window,document,'ttq');
    }
  }

  // Returns the event_id (null if nothing sent); a server-side report reuses it so platforms count once.
  // shortcut: a tap that leaves the page may drop its event; acceptable, as we never delay navigation.
  function track(name, props) {
    if (!Object.prototype.hasOwnProperty.call(EVENTS, name) || !loaded || optedOut()) return null;
    var id = window.crypto && crypto.randomUUID ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
    if (META_PIXEL_ID) fbq('trackCustom', EVENTS[name], props || {}, { eventID: id });
    if (TIKTOK_PIXEL_ID) ttq.track('ClickButton', Object.assign({ content_name: name }, props), { event_id: id });
    api.lastEventId = id;
    return id;
  }

  // Returns false if the browser refused to save the choice (it then lasts only while this page is open).
  function setOptOut(out) {
    stopped = !!out;
    var saved = true;
    try { if (out) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { saved = false; }
    if (out) {
      // Loaded vendor scripts can't be unloaded until reload (privacy-choices reloads); revoking stops their
      // own sends meanwhile. shortcut: opting back in on this same page then stays off until reload.
      if (window.fbq) fbq('consent', 'revoke');
      if (window.ttq) ttq.revokeConsent();
    } else {
      loadPixels(); // no reload needed; no-op while GPC is on
    }
    return saved;
  }

  var api = window.takesai = { track: track, lastEventId: null, optedOut: optedOut, setOptOut: setOptOut };

  loadPixels();

  // Tolt credits affiliate referrals (?ref=) for commission: attribution, not advertising, so deliberately NOT
  // gated on the ad opt-out or GPC (legal review). Sets tolt_referral/tolt_data cookies. Per docs.tolt.com 2026-11-13.
  if (TOLT_PUBLIC_KEY) addScript('https://files.tlt-cdn.com/v2/tlt.js', { 'data-tolt': TOLT_PUBLIC_KEY });

  // Capture phase, no preventDefault: never blocks or delays the click.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-track]');
    if (el) track(el.getAttribute('data-track'));
  }, true);

  // Say the signal was honoured on every "Your privacy choices" link (spec US4 scenario 3).
  if (navigator.globalPrivacyControl === true) {
    document.querySelectorAll('a[href$="privacy-choices/"]').forEach(function (a) { a.textContent += ' (GPC honoured)'; });
  }
})();
