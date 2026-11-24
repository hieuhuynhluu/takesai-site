// The quiz's figures and words: a port of the app's maths.ts and target.ts (app/src/features/onboarding/), plus the
// first cut's three lines from first-cut.ts. Same names, same order, so the two can be read side by side.
// site/tools/start/test-maths.mjs runs both on every slider stop and fails on any difference: change the app's file
// and this one together.

export const TIERS = {
  starter: { monthly_edits: 100, monthly_price: 19.99 },
  pro: { monthly_edits: 300, monthly_price: 49.99 },
  ultimate: { monthly_edits: Infinity, monthly_price: 89.99 },
};

export const EDITOR_PER_VIDEO = 6; // dollars an editor charges a video
export const APP_MINUTES_PER_VIDEO = 1;
const DAYS_PER_MONTH = (7 * 52) / 12;

const weekly = [1, 2, 3, 4, 5, 6].map((n) => ({ value: n / 7, number: String(n), unit: 'a week' }));
const daily = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, number: String(n), unit: 'a day' }));
/** Videos a day. */
export const VIDEO_STOPS = [...weekly, ...daily, { value: 10, number: '10+', spoken: '10 or more', unit: 'a day' }];
export const DEFAULT_VIDEOS_PER_DAY = 1;

const minutes = [5, 10, 15, 20, 30, 45].map((value) => ({ value, number: String(value), unit: 'minutes a video' }));
const hours = [60, 90, 120, 180].map((value) => ({ value, number: String(value / 60), unit: value === 60 ? 'hour a video' : 'hours a video' }));
/** Minutes of editing a video. */
export const EDIT_STOPS = [...minutes, ...hours, { value: 240, number: '4+', spoken: '4 or more', unit: 'hours a video' }];
export const DEFAULT_EDIT_MINUTES = 60;
/** A waking day, the most editing a day can hold: 10 or more a day at 4 hours a video would be 40 hours. */
export const WAKING_MINUTES = 16 * 60;

/** The minutes a video the quiz's figures count: the answer, or less where a day's editing would pass a waking day. */
export const countedEdit = (videosPerDay, editMinutes) => Math.min(editMinutes, WAKING_MINUTES / videosPerDay);

/** The stop nearest a saved value, so any stored number lands on the track. */
export function stopIndex(stops, value) {
  let best = 0;
  stops.forEach((s, i) => {
    if (Math.abs(s.value - value) < Math.abs(stops[best].value - value)) best = i;
  });
  return best;
}

/** Smallest tier whose monthly edits cover twice the videos; Pro when there is no answer. */
export function recommendedTier(videosPerMonth) {
  if (videosPerMonth == null) return 'pro';
  return ['starter', 'pro'].find((t) => TIERS[t].monthly_edits >= 2 * videosPerMonth) ?? 'ultimate';
}

export function savings(videosPerDay, editMinutes) {
  const videosPerMonth = Math.round(videosPerDay * DAYS_PER_MONTH);
  const tier = recommendedTier(videosPerMonth);
  const savedPerVideo = editMinutes - APP_MINUTES_PER_VIDEO;
  const backDay = videosPerDay * savedPerVideo;
  const backMonth = videosPerMonth * savedPerVideo;
  const spentYear = videosPerMonth * editMinutes * 12, appYear = videosPerMonth * APP_MINUTES_PER_VIDEO * 12;
  const daysSpent = Math.min(365, Math.floor(spentYear / 60 / 24));
  return {
    videosPerMonth,
    tier,
    spentMinutesDay: videosPerDay * editMinutes,
    timeBack: [backDay, backDay * 7, backMonth, backMonth * 12],
    spentMinutesYear: spentYear,
    appMinutesYear: appYear,
    fullDaysSpent: daysSpent,
    fullDaysBack: Math.max(0, daysSpent - Math.round(appYear / 60 / 24)),
    perDay: TIERS[tier].monthly_price / DAYS_PER_MONTH,
  };
}

export function receiptMonth(videosPerMonth, editMinutes) {
  const handMin = videosPerMonth * editMinutes;
  const appMin = videosPerMonth * APP_MINUTES_PER_VIDEO;
  const whole = handMin >= 100 * 60;
  const backMin = whole ? (Math.round(handMin / 60) - Math.round(appMin / 60)) * 60 : handMin - appMin;
  return { handMin, appMin, whole, backMin };
}

export const keepUnits = (s) => s.replace(/ × /g, ' × ').replace(/(\d) /g, '$1 ');

const grouped = (n) => Math.round(n).toLocaleString('en-US');

/** '45 min', '2 h 57 min' (under 10 hours), '1,074 h'. `exact` keeps the minutes at any size. */
export function formatTime(minutes, { exact = false } = {}) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  if (m < 600 || exact) return m % 60 ? `${grouped(Math.floor(m / 60))} h ${m % 60} min` : `${grouped(m / 60)} h`;
  return `${grouped(minutes / 60)} h`;
}

/** The clock step's year: 365 day marks in rows of YEAR_COLS, 7 units square on a 10-unit pitch, as SVG paths. The
 *  first `spent` are the days editing takes by hand; the first `back` of them are the days TakesAI gives back; `kept` are
 *  the rest of the spent days, `days` the year's other days. `rows` are the rows given back, in order, each with its
 *  days, its strike (from 2 units before the row to 2 after its last day) and the strike's length: the cut runs row by row. */
export const YEAR_COLS = 20;
export function yearMarks(spent, back) {
  const mark = (i) => `M${(i % YEAR_COLS) * 10} ${Math.floor(i / YEAR_COLS) * 10}h7v7h-7z`;
  const run = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, k) => mark(from + k)).join('');
  const rows = [];
  for (let first = 0; first < back; first += YEAR_COLS) {
    const last = Math.min(back, first + YEAR_COLS) - 1, end = (last % YEAR_COLS) * 10 + 9;
    rows.push({ back: run(first, last + 1), strike: `M-2 ${Math.floor(first / YEAR_COLS) * 10 + 3.5}H${end}`, length: end + 2 });
  }
  return { width: YEAR_COLS * 10 - 3, height: Math.ceil(365 / YEAR_COLS) * 10 - 3, back: run(0, back), kept: run(back, spent), days: run(spent, 365), rows };
}

/** The year receipt's motion in ms, the same on the site and in the app: its head prints, the year feeds down out of the
 *  rule like paper, its foot prints, then a pen strikes the rows given back one after another (a second at most however
 *  many rows), each row's red emptying as the pen crosses it, and then what comes back rises in. */
export function yearMotion(rows) {
  const row = Math.min(260, 1100 / Math.max(1, rows));
  return { feed: 150, feedFor: 700, foot: 800, cut: 1000, row, payoff: 1100 + rows * row };
}

/** Step 4's line once the answers pass a waking day: the figures after it count a waking day, and say so. */
export const capNote = (videosPerDay, editMinutes) =>
  videosPerDay * editMinutes > WAKING_MINUTES ? `That’s more than a waking day, so we’ll count ${WAKING_MINUTES / 60} hours a day.` : '';

/** What the clock step says, from the counted answers: the year in whole days and what TakesAI gives back of it, the
 *  year's receipt (its marks, its head and foot lines), and the plan for these answers at its price a day. Under a whole
 *  day of editing a year, the year is told in hours and drawn as one day. */
export function clockScreen(videosPerDay, editMinutes) {
  const f = savings(videosPerDay, editMinutes), whole = f.fullDaysSpent >= 1, n = f.fullDaysSpent, b = f.fullDaysBack;
  const days = (d) => `${d} ${d === 1 ? 'day' : 'days'}`, kept = n - b;
  const stop = VIDEO_STOPS[stopIndex(VIDEO_STOPS, videosPerDay)], plan = f.tier[0].toUpperCase() + f.tier.slice(1);
  return {
    // A time never breaks from its unit ("4 / h" at 402 px).
    title: whole ? `Editing takes ${n} full ${n === 1 ? 'day' : 'days'} of your year.` : `Editing takes ${keepUnits(formatTime(f.spentMinutesYear))} of your year.`,
    // [before, the figure, after]: the figure is set bold.
    keep: !whole ? ['TakesAI gives you ', keepUnits(formatTime(f.timeBack[3])), ' of it back.'] : n === 1 ? ['TakesAI gives you ', 'that day', ' back.'] : ['TakesAI gives you ', `${b} of them`, ' back.'],
    price: `${plan} covers ${stop.number} ${stop.unit}: $${TIERS[f.tier].monthly_price} a month, about $${f.perDay.toFixed(2)} a day.`,
    head: ['Your year', '365 days'],
    foot: [`In TakesAI, ${APP_MINUTES_PER_VIDEO} min a video`, whole && kept >= 1 ? days(kept) : keepUnits(formatTime(f.appMinutesYear))],
    marks: yearMarks(whole ? n : 1, whole ? b : 1),
    label: whole
      ? `Your year, 365 days: ${days(n)} editing by hand, ${b} of them given back by TakesAI.`
      : `Your year, 365 days: ${formatTime(f.spentMinutesYear)} editing by hand, ${formatTime(f.timeBack[3])} of it given back by TakesAI.`,
  };
}

// ---- The target ----

export function targetStops(videosPerDay) {
  return VIDEO_STOPS.slice(stopIndex(VIDEO_STOPS, videosPerDay));
}

export function target(nowPerDay, targetPerDay, editMinutes) {
  const nowWeek = Math.round(nowPerDay * 7);
  const targetWeek = Math.max(nowWeek, Math.round(targetPerDay * 7));
  return {
    nowWeek,
    moreWeek: targetWeek - nowWeek,
    targetWeek,
    handMinWeek: nowWeek * editMinutes,
    appMinWeek: targetWeek * APP_MINUTES_PER_VIDEO,
  };
}

export function planFor(nowPerDay, targetPerDay) {
  const order = ['starter', 'pro', 'ultimate'];
  const today = savings(nowPerDay, DEFAULT_EDIT_MINUTES).tier;
  const { videosPerMonth } = savings(Math.max(nowPerDay, targetPerDay ?? 0), DEFAULT_EDIT_MINUTES);
  const covers = order.find((t) => TIERS[t].monthly_edits >= videosPerMonth) ?? 'ultimate';
  return { videosPerMonth, tier: order[Math.max(order.indexOf(today), order.indexOf(covers))] };
}

// ---- The target screen's words (target.ts). Content rule: no line promises income, reach or any result. ----

export const PERSONAS = ['tiktok_shop', 'ugc', 'influencer', 'just_me'];
export const GOALS = ['post_more', 'save_time', 'freedom', 'fire_editor'];
const TOP = VIDEO_STOPS[VIDEO_STOPS.length - 1].value;

const READY = {
  tiktok_shop: 'Ready to post more on TikTok Shop?',
  ugc: 'Ready to deliver more videos?',
  influencer: 'Ready to post more often?',
  just_me: 'Ready to post more?',
};
const WHY = {
  tiktok_shop: 'Every video is another chance at a commission.',
  ugc: 'Every video is one more delivered.',
  influencer: 'Every post is another chance to be found.',
  just_me: 'The time to make more comes out of editing.',
};

const exact = (minutes) => keepUnits(formatTime(minutes, { exact: true }));
/** "35 a week"; the top stop is "10 or more a day", so its week reads "70+ a week". */
export const aWeek = (videos, orMore = false) => `${videos}${orMore ? '+' : ''} a week`;

export function targetScreen(i) {
  const persona = PERSONAS.find((p) => p === i.persona) ?? 'just_me';
  const goal = GOALS.find((g) => g === i.goal) ?? 'post_more';
  const t = target(i.nowPerDay, i.targetPerDay, i.editMinutes);
  const atTop = i.nowPerDay >= TOP;
  const goalWeek = aWeek(t.targetWeek, Math.max(i.nowPerDay, i.targetPerDay) >= TOP);
  const own = goal === 'fire_editor';

  const title = own ? 'Ready to edit your own videos?' : atTop ? `Ready to keep up ${goalWeek}?` : goal === 'post_more' ? READY[persona] : 'How many will you post a week?';
  const lead = own
    ? 'In TakesAI, editing one takes you about a minute.'
    : atTop
      ? 'That’s the top of the scale. Keep your pace and take the time back.'
      : goal === 'post_more'
        ? WHY[persona]
        : 'Keep your pace and take the time back, or post more and still keep most of it.';

  const back = t.handMinWeek - t.appMinWeek;
  const receipt = {
    rows: [
      { label: 'A video', was: exact(i.editMinutes), now: exact(APP_MINUTES_PER_VIDEO) },
      { label: 'A week', was: exact(t.handMinWeek), now: exact(t.appMinWeek) },
    ],
    total: back >= 0 ? { label: 'Time back a week', value: exact(back) } : { label: 'More editing a week', value: exact(-back) },
  };

  const button = own ? `I’ll edit my own ${goalWeek}` : `I’ll post ${goalWeek}`;
  return { title, lead, receipt, button, moreWeek: t.moreWeek, goalWeek };
}

export const openingStop = (goal, stops) => (goal === 'post_more' && stops > 1 ? 1 : 0);

export function weekStops(stops) {
  return stops.map((s) => ({
    value: s.value,
    number: `${Math.round(s.value * 7)}${s.value >= TOP ? '+' : ''}`,
    unit: 'a week',
    caption: s.unit === 'a week' ? undefined : `${s.spoken ?? s.number} ${s.unit}`,
  }));
}

// ---- The first cut's lines (first-cut.ts) ----

export const rewardLead = (target) => (target ? `You said ${target}. Make the first one now, from a take of your own.` : 'Make it now, from a take of your own.');
export const rewardTerms = (account) => (account ? 'No card needed.' : 'No account, no card.');
export const finishedTitle = (target) => (target ? `That’s the first of your ${target}.` : 'That’s your first cut.');
