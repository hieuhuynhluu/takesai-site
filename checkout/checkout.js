/* Web checkout (spec 007, T7), for /checkout/ and /checkout/done/. The interface is
   contracts/checkout-api.md; the App shell builds the functions. */

// The Supabase functions base, for example "https://<project-ref>.supabase.co/functions/v1". One setting for both pages.
// Empty: /checkout/ shows "opens soon" instead of the button and never posts; /checkout/done/ shows only the generic steps.
const CHECKOUT_BASE = "https://beoxhscgtofgsizqzixz.supabase.co/functions/v1";
const CHECKOUT_ENDPOINT = CHECKOUT_BASE && CHECKOUT_BASE + "/create-checkout";
const STATUS_ENDPOINT = CHECKOUT_BASE && CHECKOUT_BASE + "/checkout-status";
// GET ?code= -> { ok: true, trial_days, trial_edits }, { ok: true, free: true, plan: "ultimate" } (a free code, M-89: TVAFREE)
// or { ok: false, error: "bad_code" | "code_used_up" }. A 404 (not deployed) or a network error leaves the code for
// create-checkout to check, as before.
const CHECK_ENDPOINT = CHECKOUT_BASE && CHECKOUT_BASE + "/check-code";
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
  const form = $("checkout"), start = $("start"), msg = $("msg"), code = $("code"), applyBtn = $("apply"), codeMsg = $("code-msg");
  // ?trial=0 is the reused-trial email's link (contract section 5): the plan without a trial.
  let busy = false, noTrial = params.get("trial") === "0", shown = "";
  const h1 = document.querySelector("h1"), h1Text = h1.textContent, title = document.title; // the page's own heading
  let applied = null; // the code as last applied: { code, days, edits }, { code, free: true }, or { code, unverified: true } when it can't be checked here

  // ?plan= and ?period= preselect; a value matching no radio leaves the default checked.
  for (const name of ["plan", "period"]) if (params.get(name)) form.elements[name].value = params.get(name);
  if (params.get("code")) code.value = params.get("code").trim();
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
    const free = !!(applied && applied.free), saleYearly = sale && yearly && !free;
    let days, now = "$0 today.", then;
    // A free code (M-89): Ultimate only, free for life, no period and no renewal box; it wins over a sale.
    form.classList.toggle("free-on", free);
    form.querySelector(".seg").hidden = free;
    for (const label of form.querySelectorAll(".plan")) label.hidden = free && label.querySelector("input").value !== "ultimate";
    form.elements.renews.required = !free;
    $("consent").hidden = free || !CHECKOUT_ENDPOINT;
    if (free) {
      days = "For life";
      now = "$0.00 today.";
      then = "Free for life. Nothing renews at a cost.";
    } else if (saleYearly) { // the sale price wins over a code's or link's trial (decision 12)
      days = "50% off your first year";
      now = `${price} today for your first year.`;
      then = `Then ${row.querySelector(".y").dataset.regular} a year plus any tax from ${dateIn(365)}, renewing until you cancel.`;
    } else if (noTrial) {
      days = "Already used";
      now = `${price} today.`;
      then = `Renews at ${price} ${per} plus any tax until you cancel.`;
    } else if (applied && applied.days) {
      days = `${applied.days} days`;
      then = `Then ${price} ${per} plus any tax from ${dateIn(applied.days)}, renewing until you cancel. Cancel before then and you pay nothing.`;
    } else if (applied) {
      days = "Set by your code";
      then = `Your code's trial (7, 14 or 30 days) is applied at checkout. Then ${price} ${per} plus any tax, renewing until you cancel. Cancel before the trial ends and you pay nothing.`;
    } else {
      const n = referral() ? 7 : 3;
      days = `${n} days`;
      then = `Then ${price} ${per} plus any tax from ${dateIn(n)}, renewing until you cancel. Cancel before then and you pay nothing.`;
    }
    $("trial-label").textContent = free ? `Ultimate · ${applied.code.toUpperCase()}` : saleYearly ? "Black Friday" : applied && applied.days ? `Free trial · ${applied.code.toUpperCase()}` : "Free trial";
    const heading = free ? "Get Ultimate free" : saleYearly || noTrial ? "Subscribe to TakesAI" : null;
    h1.textContent = heading || h1Text;
    document.title = heading || title;
    $("trial-days").textContent = days;
    document.body.classList.toggle("sale-y", saleYearly);
    document.body.classList.toggle("free-y", free);
    $("due-now").textContent = now;
    $("due-then").textContent = then;
    if (!busy) start.textContent = cta();
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
    start.textContent = on ? "Opening checkout…" : cta();
  }

  // The button says what starts: "Start 30-day free trial", or Subscribe when there's no trial.
  function cta() {
    if (applied && applied.free) return "Get Ultimate free";
    if (noTrial || (sale && pick("period") === "yearly")) return "Subscribe";
    const n = applied ? applied.days : referral() ? 7 : 3;
    return n ? `Start ${n}-day free trial` : "Start free trial";
  }

  function note(text, kind) {
    codeMsg.textContent = text;
    codeMsg.className = "code-msg" + (kind ? " " + kind : "");
  }

  // Apply: checks the code with the server and shows what it gives before anyone leaves for Stripe.
  async function applyCode() {
    const typed = code.value.trim();
    if (!typed) { applied = null; note(""); render(); return false; }
    applyBtn.disabled = true;
    applyBtn.textContent = "Checking…";
    let ok = false;
    try {
      if (!CHECK_ENDPOINT) throw new Error("no endpoint");
      const r = await fetch(`${CHECK_ENDPOINT}?code=${encodeURIComponent(typed)}`);
      if (r.status === 404 || r.status >= 500) throw new Error("unavailable");
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok && d.free) {
        applied = { code: typed, free: true };
        form.elements.plan.value = "ultimate";
        note(`${typed.toUpperCase()} applied: Ultimate, free for life.`, "ok");
        ok = true;
      } else if (r.ok && d.ok && d.trial_days > 0) {
        applied = { code: typed, days: d.trial_days, edits: d.trial_edits };
        note(`${typed.toUpperCase()} applied: ${d.trial_days} days free` + (d.trial_edits ? `, up to ${d.trial_edits} edits during the trial.` : "."), "ok");
        ok = true;
      } else if (r.status === 429) {
        applied = null;
        note("Too many tries in a row. Wait a minute, then apply it again.", "bad");
      } else if (d.error === "code_used_up") {
        applied = null;
        note(`${typed.toUpperCase()} has been fully claimed. Ask whoever gave you the code.`, "bad");
      } else {
        applied = null;
        note(`We don't recognize ${typed.toUpperCase()}. Check the code, or leave it empty.`, "bad");
      }
    } catch {
      applied = { code: typed, unverified: true }; // create-checkout still checks it
      note(`${typed.toUpperCase()} will be checked on the next page.`, "ok");
      ok = true;
    }
    applyBtn.disabled = false;
    applyBtn.textContent = "Apply";
    render();
    return ok;
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
  code.addEventListener("input", () => {
    const typed = code.value.trim();
    if (applied && typed.toLowerCase() !== applied.code.toLowerCase()) applied = null;
    if (!applied) note(typed ? "Tap Apply to use this code." : "");
    edited();
  });
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCode(); } });
  applyBtn.addEventListener("click", applyCode);
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
    if (typed && !applied) { // typed but never applied: apply it and show what it gives; the next tap goes on
      if (await applyCode()) note(codeMsg.textContent + (applied && applied.free ? " Tap the button again." : " Check your trial, then tap the button again."), "ok");
      return;
    }
    if (applied && applied.free) { body.plan = "ultimate"; body.period = "yearly"; } // the server decides anyway (v6)
    if (applied) body.code = applied.code;
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
    if (error === "code_used_up") {
      say(`${typed.toUpperCase()} has been fully claimed. Ask whoever gave you the code, or choose a plan without it.`, "Continue without a code", () => {
        code.value = "";
        applied = null;
        note("");
        edited();
        start.focus();
      });
    } else if (error === "bad_code") {
      say(`We don't recognize the code ${typed.toUpperCase()}. Check it, or continue without a code.`, "Continue without a code", () => {
        code.value = "";
        applied = null;
        note("");
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
  if (code.value) applyCode(); // a ?code= link applies itself
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

// A second use of a free code by the same email or account (M-89): the webhook cancelled it; nothing was charged.
function alreadyFree() {
  document.title = "You already have free Ultimate · TakesAI";
  $("done-h").textContent = "You already have free Ultimate";
  $("done-lede").textContent = "This email already has it, so we didn't start a second one. Sign in to TakesAI with it.";
  $("redeem").hidden = true;
  $("receipt-sec").hidden = true;
}

// A free code's success (M-89): free for life, and a note for anyone already paying in a store.
function freeDone() {
  document.title = "Ultimate is yours · TakesAI";
  $("done-h").textContent = "Ultimate is yours, free for life";
  $("done-lede").textContent = "Get the app and sign in with the email you used. Ultimate is there.";
  $("cancel-line").hidden = true;
  $("store-note").hidden = false;
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
      if (data && data.status === "already_free") return alreadyFree();
      if (data && data.free) freeDone();
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
