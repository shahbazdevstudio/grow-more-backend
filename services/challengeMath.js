/**
 * Pure challenge scoring (no I/O) so it can be unit-tested.
 *  - day percent = earned / possible
 *  - a day PASSES when percent >= passPercent (checked with integers, so there is no rounding error)
 *  - past day below the bar = FAIL; today below the bar = PENDING (the day is still open); future = UPCOMING
 */
const D = require('../utils/dates');

const pctOf = (earned, possible) => (possible > 0 ? Math.round((earned / possible) * 10000) / 100 : 0);
const meets = (earned, possible, passPercent) => possible > 0 && earned * 100 >= passPercent * possible;
const totalPoints = (tasks) => tasks.reduce((n, t) => n + t.points, 0);

/** Recompute a log's snapshot from the tasks that exist right now (ids of deleted tasks are dropped). */
function snapshot(tasks, doneIds) {
  const ids = new Set(tasks.map((t) => String(t._id)));
  const done = [...new Set(doneIds.map(String))].filter((id) => ids.has(id));
  const earned = tasks.filter((t) => done.includes(String(t._id))).reduce((n, t) => n + t.points, 0);
  return { done, earned, possible: totalPoints(tasks) };
}

function dayStatus({ date, today, earned, possible, passPercent }) {
  if (date > today) return 'upcoming';
  const ok = meets(earned, possible, passPercent);
  if (date === today) return ok ? 'pass' : 'pending';
  return ok ? 'pass' : 'fail';
}

/** Build the whole view of a challenge for the owner's "today". */
function summarize(c, today, { withDays = true } = {}) {
  const tasks = c.tasks.map((t) => ({ id: String(t._id), title: t.title, points: t.points }));
  const perDay = totalPoints(c.tasks);
  const endDate = D.addDays(c.startDate, c.totalDays - 1);
  const logs = new Map((c.logs || []).map((l) => [l.date, l]));

  const days = [];
  let passed = 0; let failed = 0; let earnedSum = 0; let possibleSum = 0;
  for (let i = 0; i < c.totalDays; i += 1) {
    const date = D.addDays(c.startDate, i);
    const log = logs.get(date);
    const earned = log ? log.earned : 0;
    const possible = log && log.possible > 0 ? log.possible : perDay;
    const status = dayStatus({ date, today, earned, possible, passPercent: c.passPercent });
    if (status === 'pass') passed += 1; else if (status === 'fail') failed += 1;
    if (date <= today) { earnedSum += earned; possibleSum += possible; }
    days.push({ n: i + 1, date, status, earned, possible, percent: pctOf(earned, possible), done: log ? log.done : [] });
  }

  const sinceStart = D.diffDays(c.startDate, today); // 0 on the first day, negative before it starts
  const state = today < c.startDate ? 'upcoming' : today > endDate ? 'completed' : 'active';
  const elapsed = Math.min(c.totalDays, Math.max(0, sinceStart)); // days that are completely over
  const remaining = c.totalDays - elapsed; // includes today while the challenge is running
  const dayNumber = state === 'active' ? sinceStart + 1 : state === 'completed' ? c.totalDays : 0;
  const successPct = pctOf(passed, c.totalDays);
  const result = state === 'completed' ? (meets(passed, c.totalDays, c.passPercent) ? 'passed' : 'failed') : null;
  const todayDay = days.find((d) => d.date === today) || null;

  return {
    id: String(c._id), name: c.name, description: c.description || '', startDate: c.startDate, endDate, totalDays: c.totalDays, passPercent: c.passPercent,
    tasks, pointsPerDay: perDay, state, dayNumber, result,
    stats: { total: c.totalDays, elapsed, remaining, passed, failed, scoreEarned: earnedSum, scorePossible: possibleSum, scorePct: pctOf(earnedSum, possibleSum), successPct },
    today: todayDay,
    ...(withDays ? { days } : {}),
  };
}

module.exports = { pctOf, meets, snapshot, dayStatus, summarize, totalPoints };
