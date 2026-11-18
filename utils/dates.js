/**
 * All calendar logic works on 'YYYY-MM-DD' strings in the OWNER's timezone, so "today" and
 * "this month" are always correct for the user (not for the server's clock).
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isDateStr = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function todayIn(tz, now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  }
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

const fromStr = (s) => new Date(`${s}T00:00:00Z`);
const toStr = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = fromStr(s); d.setUTCDate(d.getUTCDate() + n); return toStr(d); };
const diffDays = (a, b) => Math.round((fromStr(b) - fromStr(a)) / 86400000); // b - a
const startOfMonth = (s) => `${s.slice(0, 7)}-01`;
const endOfMonth = (s) => { const d = fromStr(startOfMonth(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return toStr(d); };
const addMonths = (s, n) => { const d = fromStr(startOfMonth(s)); d.setUTCMonth(d.getUTCMonth() + n); return toStr(d); };
const weekStart = (s) => addDays(s, -((fromStr(s).getUTCDay() + 6) % 7)); // Monday
const monthKey = (s) => s.slice(0, 7);

const RANGES = ['today', '7d', '30d', 'this_month', 'last_month', 'custom'];

/** Resolve a named range (or custom from/to) to { from, to } date strings. */
function resolveRange({ range = '30d', from, to }, tz) {
  const today = todayIn(tz);
  switch (range) {
    case 'today': return { from: today, to: today, range };
    case '7d': return { from: addDays(today, -6), to: today, range };
    case '30d': return { from: addDays(today, -29), to: today, range };
    case 'this_month': return { from: startOfMonth(today), to: today, range };
    case 'last_month': { const prev = addMonths(today, -1); return { from: startOfMonth(prev), to: endOfMonth(prev), range }; }
    case 'custom': return { from, to, range };
    default: return null;
  }
}

module.exports = { isDateStr, todayIn, addDays, diffDays, startOfMonth, endOfMonth, addMonths, weekStart, monthKey, resolveRange, RANGES };

/* ---- timezone-aware day bounds (for filtering timestamps by the owner's calendar day) ---- */
function tzOffsetMs(tz, ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}
/** The instant a calendar day starts in `tz`. */
function zonedStart(dateStr, tz) {
  const guess = Date.parse(`${dateStr}T00:00:00Z`);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t);
  return new Date(t);
}
module.exports.zonedStart = zonedStart;
/** 0 = Monday … 6 = Sunday */
module.exports.fromDow = (s) => (fromStr(s).getUTCDay() + 6) % 7;
