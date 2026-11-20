const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../utils/dates');

let ctx, c, b;
const T = () => H.today();
const mkChallenge = (extra = {}) => c.post('/challenges', { name: 'Discipline', totalDays: 5, passPercent: 70, startDate: D.addDays(T(), -2), tasks: [{ title: 'Gym', points: 50 }, { title: 'Read', points: 30 }, { title: 'Code', points: 20 }], ...extra });

test.before(async () => {
  ctx = await H.boot('growmore_t_phase4');
  await H.createOwner('1234'); c = await H.signedIn(ctx.base, '1234');
  const { User } = ctx.models; const jwt = require('jsonwebtoken'); const env = require('../config/env');
  const u2 = await User.create({ pinHash: 'x', displayName: 'Other' });
  b = new H.Client(ctx.base); b.cookie = 'gm_token=' + jwt.sign({ sub: String(u2._id), tv: 0, st: Math.floor(Date.now() / 1000) }, env.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
});
test.after(() => ctx.stop());

test('challenge: create, tick tasks, day score decides pass/fail, header numbers add up', async () => {
  const r = await mkChallenge(); assert.equal(r.status, 201);
  const ch = r.data.challenge; const [gym, read] = ch.tasks;
  assert.equal(ch.stats.total, 5); assert.equal(ch.stats.elapsed, 2); assert.equal(ch.stats.remaining, 3); assert.equal(ch.stats.failed, 2); assert.equal(ch.dayNumber, 3);
  const day1 = D.addDays(T(), -2);
  let x = await c.put(`/challenges/${ch.id}/days/${day1}`, { taskId: gym.id, done: true }); assert.equal(x.status, 200);
  x = await c.put(`/challenges/${ch.id}/days/${day1}`, { taskId: read.id, done: true });
  assert.equal(x.data.challenge.days[0].status, 'pass'); assert.equal(x.data.challenge.days[0].earned, 80);
  assert.equal(x.data.challenge.stats.passed, 1); assert.equal(x.data.challenge.stats.failed, 1);
  x = await c.put(`/challenges/${ch.id}/days/${T()}`, { taskId: gym.id, done: true });
  assert.equal(x.data.challenge.today.status, 'pending'); // 50% < 70% and the day is still open
  x = await c.put(`/challenges/${ch.id}/days/${T()}`, { taskId: read.id, done: true });
  assert.equal(x.data.challenge.today.status, 'pass');
  x = await c.put(`/challenges/${ch.id}/days/${T()}`, { taskId: read.id, done: false });
  assert.equal(x.data.challenge.today.status, 'pending');
});

test('challenge: future days and days outside the challenge cannot be ticked; invalid input is rejected', async () => {
  const ch = (await c.get('/challenges')).data.items[0]; const full = (await c.get(`/challenges/${ch.id}`)).data.challenge; const t = full.tasks[0].id;
  assert.equal((await c.put(`/challenges/${ch.id}/days/${D.addDays(T(), 1)}`, { taskId: t, done: true })).status, 400);
  assert.equal((await c.put(`/challenges/${ch.id}/days/${D.addDays(T(), -30)}`, { taskId: t, done: true })).status, 400);
  assert.equal((await c.put(`/challenges/${ch.id}/days/not-a-date`, { taskId: t, done: true })).status, 400);
  assert.equal((await mkChallenge({ tasks: [] })).status, 400);
  assert.equal((await mkChallenge({ passPercent: 0 })).status, 400);
});

test('challenge: editing tasks keeps ticks of kept tasks; finished days keep their score; days cannot be cut below the days already lived', async () => {
  const ch = (await c.get('/challenges')).data.items[0]; const full = (await c.get(`/challenges/${ch.id}`)).data.challenge;
  const body = { name: full.name, totalDays: 5, passPercent: 70, startDate: full.startDate, tasks: [...full.tasks.map((t) => ({ id: t.id, title: t.title, points: t.points })), { title: 'Walk', points: 100 }] };
  const up = await c.put(`/challenges/${ch.id}`, body); assert.equal(up.status, 200);
  assert.equal(up.data.challenge.days[0].status, 'pass', 'day 1 was 80/100 when it was played');
  assert.equal(up.data.challenge.days[0].possible, 100);
  assert.equal((await c.put(`/challenges/${ch.id}`, { ...body, totalDays: 2 })).status, 400);
  assert.equal((await c.put(`/challenges/${ch.id}`, { ...body, startDate: D.addDays(T(), 3) })).status, 400, 'start date is locked once started');
});

test('challenge: delete + undo, and other users cannot see or change it', async () => {
  const id = (await mkChallenge({ name: 'Temp' })).data.challenge.id;
  assert.equal((await b.get(`/challenges/${id}`)).status, 404);
  assert.equal((await b.put(`/challenges/${id}`, { name: 'x', totalDays: 3, passPercent: 50, tasks: [{ title: 'a', points: 1 }] })).status, 404);
  assert.equal((await b.get('/challenges')).data.items.length, 0);
  assert.equal((await c.del(`/challenges/${id}`)).status, 200);
  assert.equal((await c.get(`/challenges/${id}`)).status, 404);
  assert.equal((await c.post(`/challenges/${id}/restore`)).status, 200);
  assert.equal((await c.get(`/challenges/${id}`)).status, 200);
});

test('timetable: validates times, sorts by start, per-weekday, undo, isolation', async () => {
  const mk = (o) => c.post('/timetable', { title: 'Study', startTime: '09:00', endTime: '10:00', ...o });
  assert.equal((await mk({ startTime: '10:00', endTime: '09:00' })).status, 400);
  assert.equal((await mk({ startTime: '9am' })).status, 400);
  const late = await mk({ title: 'Sleep', startTime: '22:00', endTime: '23:30', days: [0, 1, 2] }); assert.equal(late.status, 201);
  const early = await mk({ title: 'Wake up', startTime: '05:00', endTime: '05:30' });
  const list = (await c.get('/timetable')).data; assert.deepEqual(list.items.map((i) => i.title), ['Wake up', 'Sleep']); assert.ok(list.dow >= 0 && list.dow <= 6);
  assert.equal((await b.get('/timetable')).data.items.length, 0);
  assert.equal((await c.put(`/timetable/${early.data.entry.id}`, { title: 'Wake up', startTime: '05:30', endTime: '06:00' })).status, 200);
  assert.equal((await c.del(`/timetable/${early.data.entry.id}`)).status, 200);
  assert.equal((await c.get('/timetable')).data.items.length, 1);
  assert.equal((await c.post(`/timetable/${early.data.entry.id}/restore`)).status, 200);
  assert.equal((await c.get('/timetable')).data.items.length, 2);
});

test('to-do date filters: today / tomorrow / old, with counts', async () => {
  const mk = (title, dueDate) => c.post('/todos', { title, dueDate });
  await mk('old one', D.addDays(T(), -3)); await mk('today one', T()); await mk('tomorrow one', D.addDays(T(), 1)); await mk('no date', null);
  const titles = async (w) => (await c.get(`/todos?status=pending&when=${w}`)).data.items.map((i) => i.title);
  assert.deepEqual(await titles('today'), ['today one']);
  assert.deepEqual(await titles('tomorrow'), ['tomorrow one']);
  assert.deepEqual(await titles('old'), ['old one']);
  assert.equal((await titles('all')).length, 4);
  const wc = (await c.get('/todos?status=pending&when=today')).data.whenCounts; assert.deepEqual(wc, { all: 4, today: 1, tomorrow: 1, old: 1 });
  assert.equal((await c.get('/todos?when=nonsense')).status, 400);
});

test('reset: needs the right PIN and the word RESET; wipes all data but keeps the PIN, settings and default categories', async () => {
  const acc = (await c.post('/accounts', { name: 'Meezan', type: 'bank', openingBalance: 5000 })).data.account;
  await c.post('/notes', { title: 'n', body: '<p>x</p>' });
  assert.equal((await c.post('/me/reset', { pin: '1234' })).status, 400, 'confirmation word is required');
  const wrong = await c.post('/me/reset', { pin: '9999', confirm: 'RESET' }); assert.equal(wrong.status, 401); assert.equal(wrong.data.code, 'BAD_PIN');
  assert.equal((await c.get('/accounts')).data.accounts.length >= 1, true, 'nothing was deleted by the failed attempts');
  await c.put('/me/settings', { currency: 'USD' });
  const ok = await c.post('/me/reset', { pin: '1234', confirm: 'RESET' }); assert.equal(ok.status, 200); assert.equal(ok.data.reset, true);
  assert.equal((await c.get('/accounts')).data.accounts.length, 0);
  assert.equal((await c.get('/notes')).data.items.length, 0);
  assert.equal((await c.get('/challenges')).data.items.length, 0);
  assert.equal((await c.get('/timetable')).data.items.length, 0);
  assert.equal((await c.get('/todos?status=all')).data.items.length, 0);
  assert.equal((await c.get(`/accounts/${acc.id}`)).status === 200, false);
  const boot = (await c.get('/bootstrap')).data; assert.equal(boot.user.settings.currency, 'USD', 'preferences stay');
  assert.ok(boot.categories.length > 0, 'default categories are re-created like a fresh install');
  assert.equal((await H.signedIn(ctx.base, '1234')) instanceof H.Client, true, 'the PIN still works');
  assert.equal((await b.get('/challenges')).status, 200, 'another user is unaffected by the call');
});
