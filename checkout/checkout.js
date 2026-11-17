/* Web checkout (spec 007, T7), for /checkout/ and /checkout/done/. The interface is
   contracts/checkout-api.md; the App shell builds the functions. */

// The Supabase functions base, for example "https://<project-ref>.supabase.co/functions/v1". One setting for both pages.
// Empty: /checkout/ shows "opens soon" instead of the button and never posts; /checkout/done/ shows only the generic steps.
const CHECKOUT_BASE = "https://beoxhscgtofgsizqzixz.supabase.co/functions/v1";
const CHECKOUT_ENDPOINT = CHECKOUT_BASE && CHECKOUT_BASE + "/create-checkout";
const STATUS_ENDPOINT = CHECKOUT_BASE && CHECKOUT_BASE + "/checkout-status";
// Until 1.0.0 is on the App Store, the fallback goes to the beta page (M-84); at release: "https://apps.apple.com/app/id6833252992".
const APP_STORE = "/beta/";
// Black Friday 2026 (spec 012, contract v4): while the server's SALE_BF2026 is on, inside these times, a yearly checkout
// is priced at the sale with no trial. `on` turns true only with the server's switch (the founder's go, Tue 24 Nov).
const SALE = { on: false, start: Date.parse("2026-11-27T04:00:00Z"), end: Date.parse("2026-12-01T04:00:00Z"),
  price: { starter: "$79.99", pro: "$199.99", ultimate: "$359.99" } };
const saleNow = () => SALE.on && Date.now() >= SALE.start && Date.now() < SALE.end;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// The success page's session_id must never reach the ad pixels (contract section 3). On that page this
// script runs before site.js, so the URL is clean before any pixel reads it.
if (params.has("session_id")) history.replaceState(null, "", location.pathname);

if ($("checkout")) checkoutPage();
if ($("redeem")) donePage();

function checkoutPage() {
  const form = $("checkout"), start = $("start"), msg = $("msg"), code = $("code");
  // ?trial=0 is the reused-trial email's link (contract section 5): the plan without a trial.
  let busy = false, noTrial = params.get("trial") === "0", shown = "";

  // ?plan= and ?period= preselect; a value matching no radio leaves the default checked.
  for (const name of ["plan", "period"]) if (params.get(name)) form.elements[name].value = params.get(name);
  if (params.get("code")) { code.value = params.get("code").trim(); $("code-box").open = true; }
  const sale = saleNow();
  if (sale) startSale(form);
  // Tolt's script (loaded by site.js) sets window.tolt_referral from ?ref=; the raw ?ref= covers a blocked script.
  const referral = () => window.tolt_referral || params.get("ref") || "";
  const pick = (name) => form.elements[name].value;

  function render() {
    const row = form.querySelector(`[name="plan"][value="${pick("plan")}"]`).closest("label");
    const yearly = pick("period") === "yearly";
    const price = row.querySelector(yearly ? ".y b" : ".m b").textContent;
    const per = yearly ? "a year" : "a month";
    const typed = code.value.trim();
    const saleYearly = sale && yearly;
    let days, now = "$0 today.", then;
    if (saleYearly) { // the sale price wins over a code's or link's trial (decision 12)
      days = "50% off your first year";
      now = `${price} today for your first year.`;
      then = `Then ${row.querySelector(".y").dataset.regular} a year plus any tax from ${dateIn(365)}, renewing until you cancel.`;
    } else if (noTrial) {
      document.querySelector("h1").textContent = document.title = "Subscribe to TakesAI";
      days = "Already used";
      now = `${price} today.`;
      then = `Renews at ${price} ${per} plus any tax until you cancel.`;
    } else if (typed) {
      days = "Set by your code";
      then = `Your code's trial (7, 14 or 30 days) is applied at checkout. Then ${price} ${per} plus any tax, renewing until you cancel. Cancel before the trial ends and you pay nothing.`;
    } else {
      const n = referral() ? 7 : 3;
      days = `${n} days`;
      then = `Then ${price} ${per} plus any tax from ${dateIn(n)}, renewing until you cancel. Cancel before then and you pay nothing.`;
    }
    $("trial-label").textContent = saleYearly ? "Black Friday" : "Free trial";
    if (sale) document.querySelector("h1").textContent = document.title = saleYearly || noTrial ? "Subscribe to TakesAI" : "Start your free trial";
    $("trial-days").textContent = days;
    document.body.classList.toggle("sale-y", saleYearly);
    $("due-now").textContent = now;
    $("due-then").textContent = then;
    if (!busy) start.textContent = noTrial || saleYearly ? "Subscribe" : "Start free trial";
    if (now + then !== shown) { // reprint the total only when it changed
      shown = now + then;
      const due = $("due");
      due.classList.remove("print"); void due.offsetWidth; due.classList.add("print");
    }
  }

  function setBusy(on) {
    busy = on;
    start.disabled = on;
    start.setAttribute("aria-busy", on);
    start.textContent = on ? "Opening checkout…" : noTrial || (sale && pick("period") === "yearly") ? "Subscribe" : "Start free trial";
  }

  // One message at a time: what happened, then at most one way on (a function to run, or a link).
  function say(text, label, action) {
    const p = document.createElement("p");
    p.textContent = text;
    msg.replaceChildren(p);
    if (!label) return;
    const link = typeof action === "string";
    const el = document.createElement(link ? "a" : "button");
    el.className = "btn btn-quiet";
    el.textContent = label;
    if (link) { el.href = action; el.dataset.track = "download"; } else { el.type = "button"; el.addEventListener("click", action); }
    msg.append(el);
    el.focus();
  }

  const edited = () => { msg.replaceChildren(); render(); };
  form.addEventListener("change", edited);
  code.addEventListener("input", edited);
  addEventListener("load", render); // Tolt's async script may set tolt_referral after this file runs
  addEventListener("pageshow", (e) => { if (e.persisted) setBusy(false); }); // back from Stripe: button usable again

  // Runs after the button's click has finished dispatching, so site.js has already set lastEventId.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || !CHECKOUT_ENDPOINT) return;
    const t = window.takesai;
    const body = {
      plan: pick("plan"),
      period: pick("period"),
      // false when opted out, under Global Privacy Control, or when site.js didn't load (fails safe)
      ad_consent: !!(t && typeof t.optedOut === "function" && !t.optedOut()),
      renewal_ack: form.elements.renews.checked, // contract v3 (M-72); the box is required, so this is true
      event_id: (t && t.lastEventId) || newId(),
    };
    const typed = code.value.trim(), ref = referral(); // no email: Stripe Checkout collects it
    if (typed) body.code = typed;
    if (ref) body.referral = ref;
    if (noTrial) body.trial = false; // after 409 trial_used: the plan without a trial (the App shell must accept this field)
    msg.replaceChildren();
    setBusy(true);

    let res, data;
    try {
      res = await fetch(CHECKOUT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      data = await res.json().catch(() => ({}));
    } catch {
      setBusy(false);
      return say("We couldn't reach checkout. Check your connection, then try again.");
    }
    // Only ever leave for an https page (the Stripe Checkout URL).
    if (res.ok && typeof data.url === "string" && data.url.startsWith("https://")) return location.assign(data.url);

    setBusy(false);
    const error = res.status >= 500 ? "unavailable" : res.status === 429 ? "rate_limited" : data.error;
    if (error === "bad_code") {
      say(`We don't recognize the code ${typed.toUpperCase()}. Check it, or continue without a code.`, "Continue without a code", () => {
        code.value = "";
        $("code-box").open = false;
        edited();
        form.requestSubmit();
      });
    } else if (error === "trial_used") {
      say("You've had a TakesAI plan or free trial before, so a new trial can't start. You can still subscribe without one.", "See the plan without a trial", () => {
        noTrial = true;
        edited();
        start.focus();
      });
    } else if (error === "rate_limited") {
      say("Too many tries in a row. Wait a minute, then try again.");
    } else if (error === "unavailable") {
      say("Web checkout isn't working right now. You can get the TakesAI beta and try it there.", "Get the TakesAI beta", APP_STORE);
    } else {
      say("Something went wrong with this order. Reload the page and try again.");
    }
  });

  render();
  $("order").hidden = false;
  if (CHECKOUT_ENDPOINT) { start.hidden = false; start.disabled = false; $("consent").hidden = false; } else $("soon").hidden = false;
}

// The webhook ended this trial before any charge (reused trial, M-51): say so, drop the next steps.
function trialUsed() {
  document.title = "Your trial wasn't started · TakesAI";
  $("done-h").textContent = "Your trial wasn't started";
  $("done-lede").textContent = "This email or account has had a TakesAI plan or free trial before, so we ended this trial before any charge. You haven't paid anything. We've emailed you a link to subscribe without a trial.";
  for (const section of document.querySelectorAll("main section")) section.hidden = true;
}

// The sale's yearly prices: the regular price crossed out beside the first-year price, the regular price after it, the
// note with a countdown to the real end (decision 17; it never resets), and Yearly selected unless the link chose a period.
function startSale(form) {
  if (!params.get("period")) form.elements.period.value = "yearly";
  form.classList.add("sale-on");
  for (const label of form.querySelectorAll(".plan")) {
    const y = label.querySelector(".y"), b = y.querySelector("b"), regular = b.textContent;
    y.dataset.regular = regular;
    const s = document.createElement("s");
    s.textContent = regular;
    y.prepend(s, " ");
    b.textContent = SALE.price[label.querySelector("input").value];
    y.querySelector("small").textContent = `your first year, then ${regular} a year`;
  }
  $("sale-note").hidden = false;
  (function tick() {
    const left = SALE.end - Date.now();
    if (left <= 0) return location.reload(); // the sale is over: the page comes back without it
    const t = Math.floor(left / 1000), pad = (n) => String(n).padStart(2, "0");
    $("countdown").textContent = `Ends in ${Math.floor(t / 86400)} d ${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
    setTimeout(tick, 1000 - (Date.now() % 1000));
  })();
}

// "November 16", or "January 2, 2027" when the date falls in another year.
function dateIn(days) {
  const d = new Date(Date.now() + days * 864e5);
  const opts = { month: "long", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

function newId() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Success page: poll checkout-status every 2 seconds for up to 30, then show the redeem link and code.
function donePage() {
  const id = params.get("session_id");
  if (!STATUS_ENDPOINT || !id) return; // generic steps only
  $("redeem").hidden = false;
  const url = `${STATUS_ENDPOINT}?session_id=${encodeURIComponent(id)}`;
  const until = Date.now() + 30000;

  (async function poll() {
    try {
      const data = await (await fetch(url)).json();
      if (data && data.status === "trial_used") return trialUsed();
      const r = data && data.redeem;
      if (r && typeof r.url === "string" && r.url.startsWith("https://") && typeof r.code === "string") {
        $("open").href = r.url;
        $("redeem-code").textContent = r.code;
        $("redeem-wait").hidden = true;
        $("redeem-ready").hidden = false;
        $("download").classList.remove("btn-cut"); // one red action: Open TakesAI
        return;
      }
    } catch {} // a failed poll is retried like a pending one
    if (Date.now() + 2000 > until) {
      $("redeem-wait").textContent = "We're still confirming your purchase. It can take a few minutes. The link to open TakesAI is also in your receipt email.";
    } else setTimeout(poll, 2000);
  })();
}
