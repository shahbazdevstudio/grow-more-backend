const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../services/challengeMath');
const V = require('../validators/challenge.validator');
const T = require('../validators/timetable.validator');

const tasks = [{ _id: 'a', title: 'Gym', points: 50 }, { _id: 'b', title: 'Read', points: 30 }, { _id: 'c', title: 'Code', points: 20 }];
const mk = (extra = {}) => ({ _id: 'c1', name: '30 day grind', startDate: '2026-11-10', totalDays: 5, passPercent: 70, tasks, logs: [], ...extra });
const log = (date, done) => ({ date, ...M.snapshot(tasks, done) });

test('snapshot: score is the sum of the ticked tasks; unknown task ids are ignored', () => {
  assert.deepEqual(M.snapshot(tasks, ['a', 'c', 'zzz', 'a']), { done: ['a', 'c'], earned: 70, possible: 100 });
});

test('a day passes at exactly the required percentage (no rounding games)', () => {
  assert.equal(M.meets(70, 100, 70), true);
  assert.equal(M.meets(69, 100, 70), false);
  assert.equal(M.meets(1, 3, 33), true); // 33.33% >= 33%
  assert.equal(M.meets(0, 0, 50), false); // no tasks can never pass
});

test('summary: gone days, remaining days, pass/fail counts on day 4 of 5', () => {
  const c = mk({ logs: [log('2026-11-10', ['a', 'b']), log('2026-11-11', ['c']), log('2026-11-12', ['a', 'c']) /* day 4 (13th) untouched */] });
  const s = M.summarize(c, '2026-11-13');
  assert.equal(s.state, 'active'); assert.equal(s.dayNumber, 4);
  assert.equal(s.stats.elapsed, 3); assert.equal(s.stats.remaining, 2); assert.equal(s.stats.total, 5);
  assert.deepEqual(s.days.map((d) => d.status), ['pass', 'fail', 'pass', 'pending', 'upcoming']);
  assert.equal(s.stats.passed, 2); assert.equal(s.stats.failed, 1);
  assert.equal(s.today.status, 'pending'); assert.equal(s.today.percent, 0);
  assert.equal(s.endDate, '2026-11-14');
});

test('today turns into PASS as soon as the bar is reached, and never counts as FAIL while the day is open', () => {
  const c = mk({ logs: [log('2026-11-10', ['a', 'b'])] });
  assert.equal(M.summarize(c, '2026-11-10').today.status, 'pass');
  assert.equal(M.summarize(mk(), '2026-11-10').stats.failed, 0);
});

test('untouched past days fail; a challenge that has not started has nothing gone', () => {
  const s = M.summarize(mk(), '2026-11-12');
  assert.equal(s.stats.failed, 2);
  const up = M.summarize(mk(), '2026-11-01');
  assert.equal(up.state, 'upcoming'); assert.equal(up.stats.elapsed, 0); assert.equal(up.stats.remaining, 5); assert.equal(up.today, null);
});

test('finished challenge: result uses the same pass percentage on the days', () => {
  const all = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
  const good = M.summarize(mk({ logs: all.slice(0, 4).map((d) => log(d, ['a', 'b'])) }), '2026-11-20'); // 4/5 = 80% >= 70
  assert.equal(good.state, 'completed'); assert.equal(good.result, 'passed'); assert.equal(good.stats.remaining, 0); assert.equal(good.stats.elapsed, 5);
  const bad = M.summarize(mk({ logs: all.slice(0, 3).map((d) => log(d, ['a', 'b'])) }), '2026-11-20'); // 3/5 = 60% < 70
  assert.equal(bad.result, 'failed'); assert.equal(bad.stats.passed, 3); assert.equal(bad.stats.failed, 2);
});

test('adding a task later does not rewrite finished days (their snapshot is kept)', () => {
  const c = mk({ logs: [{ date: '2026-11-10', done: ['a', 'b'], earned: 80, possible: 100 }], tasks: [...tasks, { _id: 'd', title: 'New', points: 100 }] });
  const s = M.summarize(c, '2026-11-11');
  assert.equal(s.days[0].status, 'pass'); assert.equal(s.days[0].possible, 100);
  assert.equal(s.days[1].possible, 200); // a day without a snapshot uses today's task list
});

test('validator: needs tasks, sane days/percent/points', () => {
  const ok = { name: 'X', totalDays: '30', passPercent: 80, tasks: [{ title: 'Gym', points: 10 }] };
  assert.equal(V.parseChallenge(ok).totalDays, 30);
  assert.throws(() => V.parseChallenge({ ...ok, tasks: [] }), /at least one task/);
  assert.throws(() => V.parseChallenge({ ...ok, totalDays: 0 }), /between 1 and 365/);
  assert.throws(() => V.parseChallenge({ ...ok, totalDays: 2.5 }), /whole number/);
  assert.throws(() => V.parseChallenge({ ...ok, passPercent: 101 }), /between 1 and 100/);
  assert.throws(() => V.parseChallenge({ ...ok, tasks: [{ title: 'a', points: 0 }] }), /between 1 and 1000/);
  assert.throws(() => V.parseChallenge({ ...ok, tasks: [{ title: ' ', points: 5 }] }), /required/);
});

test('timetable validator: end must be after start, days are Monday–Sunday', () => {
  assert.deepEqual(T.parseEntry({ title: 'Study', startTime: '09:00', endTime: '10:30', days: [2, 0, 2] }).days, [0, 2]);
  assert.equal(T.parseEntry({ title: 'Study', startTime: '09:00', endTime: '10:30' }).days.length, 7);
  assert.throws(() => T.parseEntry({ title: 'x', startTime: '10:00', endTime: '10:00' }), /after the start/);
  assert.throws(() => T.parseEntry({ title: 'x', startTime: '25:00', endTime: '26:00' }), /valid time/);
  assert.throws(() => T.parseEntry({ title: 'x', startTime: '09:00', endTime: '10:00', days: [7] }), /Monday and Sunday/);
});
