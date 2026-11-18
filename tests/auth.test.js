const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

let ctx;
test.before(async () => { ctx = await H.boot('growmore_t_auth'); await H.createOwner('4821'); });
test.after(() => ctx.stop());

test('private routes reject anonymous requests', async () => {
  const c = new H.Client(ctx.base);
  const paths = ['/bootstrap', '/dashboard', '/accounts', '/transactions', '/budget', '/savings', '/analytics', '/categories', '/data/export.json', '/data/transactions.csv'];
  for (const p of paths) assert.equal((await c.get(p)).status, 401, p);
  assert.equal((await c.post('/transactions', {})).status, 401);
  assert.equal((await c.put('/me/settings', { theme: 'light' })).status, 401);
});

test('state-changing requests without the custom header are blocked (CSRF)', async () => {
  const c = new H.Client(ctx.base);
  const r = await c.req('POST', '/auth/login', { pin: '4821' }, { headers: { 'X-Requested-With': '' } });
  assert.equal(r.status, 403);
  const r2 = await c.req('POST', '/auth/login', { pin: '4821' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
});

test('NoSQL operator injection and bad PIN formats are rejected without counting as failures', async () => {
  const c = new H.Client(ctx.base);
  assert.equal((await c.post('/auth/login', { pin: { $ne: null } })).status, 400);
  assert.equal((await c.req('POST', '/auth/login', '{"pin":"1234","$where":"1"}')).status, 400);
  assert.equal((await c.post('/auth/login', { pin: '12' })).status, 400);
  assert.equal((await c.post('/auth/login', { pin: 'abcd' })).status, 400);
  const u = await ctx.models.User.findOne();
  assert.equal(u.failedAttempts, 0);
});

test('PIN is stored hashed, never in plain text, and never returned by the API', async () => {
  const u = await ctx.models.User.findOne().select('+pinHash');
  assert.ok(u.pinHash.startsWith('$2'));
  assert.ok(!u.pinHash.includes('4821'));
  const c = await H.signedIn(ctx.base, '4821');
  const body = JSON.stringify((await c.get('/bootstrap')).data);
  assert.ok(!/pinHash|tokenVersion|\$2[aby]\$/.test(body));
});

test('login sets an httpOnly cookie and unlocks the API; logout locks it again', async () => {
  const c = new H.Client(ctx.base);
  assert.equal((await c.post('/auth/login', { pin: '4821' })).status, 200);
  assert.match(c.lastSetCookie[0], /HttpOnly/i);
  assert.match(c.lastSetCookie[0], /SameSite=Lax/i);
  assert.equal((await c.get('/auth/status')).data.authenticated, true);
  assert.equal((await c.get('/bootstrap')).status, 200);
  await c.post('/auth/logout');
  assert.equal((await c.get('/bootstrap')).status, 401);
});

test('lockout: 3 wrong tolerated, 4th locks 5 min, correct PIN refused while locked, next group = 10 min', async () => {
  const c = new H.Client(ctx.base);
  const wrong = (pin = '0000') => c.post('/auth/login', { pin });
  let r = await wrong(); assert.equal(r.status, 401); assert.equal(r.data.attemptsLeft, 3);
  r = await wrong(); assert.equal(r.data.attemptsLeft, 2);
  r = await wrong(); assert.equal(r.data.attemptsLeft, 1);
  r = await wrong();
  assert.equal(r.status, 423); assert.equal(r.data.code, 'LOCKED');
  assert.ok(r.data.retryAfterSeconds >= 299 && r.data.retryAfterSeconds <= 300);

  // Correct PIN during lockout is refused (enforced by the server, not the browser)
  r = await c.post('/auth/login', { pin: '4821' });
  assert.equal(r.status, 423);
  assert.equal((await c.get('/bootstrap')).status, 401);
  const st = (await c.get('/auth/status')).data;
  assert.equal(st.locked, true); assert.ok(st.retryAfterSeconds > 0);

  // Fast-forward: pretend the 5 minutes passed
  await ctx.models.User.updateMany({}, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  for (let i = 0; i < 3; i++) assert.equal((await wrong()).status, 401);
  r = await wrong();
  assert.equal(r.status, 423);
  assert.ok(r.data.retryAfterSeconds > 595 && r.data.retryAfterSeconds <= 600, `expected ~10 min, got ${r.data.retryAfterSeconds}s`);

  // After the lock ends, the right PIN works and resets the escalation
  await ctx.models.User.updateMany({}, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  assert.equal((await c.post('/auth/login', { pin: '4821' })).status, 200);
  const u = await ctx.models.User.findOne();
  assert.equal(u.lockLevel, 0); assert.equal(u.failedAttempts, 0);
});

test('parallel guesses cannot bypass the lockout', async () => {
  const c = new H.Client(ctx.base);
  const results = await Promise.all(Array.from({ length: 12 }, () => c.post('/auth/login', { pin: '9999' })));
  const count = (s) => results.filter((r) => r.status === s).length;
  assert.equal(count(401), 3);
  assert.equal(count(423), 9);
  await ctx.models.User.updateMany({}, { $set: { lockedUntil: null, failedAttempts: 0, lockLevel: 0 } });
});

test('change PIN: needs current PIN, validates, invalidates other devices, old PIN stops working', async () => {
  const a = await H.signedIn(ctx.base, '4821');
  const b = await H.signedIn(ctx.base, '4821'); // second device
  assert.equal((await a.post('/me/pin', { currentPin: '1111', newPin: '5555' })).status, 401);
  assert.equal((await a.post('/me/pin', { currentPin: '4821', newPin: '55' })).status, 400);
  assert.equal((await a.post('/me/pin', { currentPin: '4821', newPin: '4821' })).status, 400);
  assert.equal((await a.post('/me/pin', { currentPin: '4821', newPin: '5555' })).status, 200);
  assert.equal((await a.get('/bootstrap')).status, 200, 'device that changed the PIN stays signed in');
  assert.equal((await b.get('/bootstrap')).status, 401, 'other device is signed out');
  assert.equal((await new H.Client(ctx.base).post('/auth/login', { pin: '4821' })).status, 401);
  assert.equal((await new H.Client(ctx.base).post('/auth/login', { pin: '5555' })).status, 200);
  await ctx.models.User.updateMany({}, { $set: { failedAttempts: 0 } });
});

test('wrong current PIN during a PIN change counts toward the lockout', async () => {
  const a = await H.signedIn(ctx.base, '5555');
  for (let i = 0; i < 3; i++) assert.equal((await a.post('/me/pin', { currentPin: '0000', newPin: '7777' })).status, 401);
  assert.equal((await a.post('/me/pin', { currentPin: '0000', newPin: '7777' })).status, 423);
  assert.equal((await a.post('/me/pin', { currentPin: '5555', newPin: '7777' })).status, 423);
  await ctx.models.User.updateMany({}, { $set: { lockedUntil: null, failedAttempts: 0, lockLevel: 0 } });
});

test('a forged or tampered token is rejected', async () => {
  const c = new H.Client(ctx.base);
  c.cookie = 'gm_token=' + require('jsonwebtoken').sign({ sub: '64b000000000000000000000', tv: 0, st: 1 }, 'wrong-secret-wrong-secret-wrong-secret-12');
  assert.equal((await c.get('/bootstrap')).status, 401);
  c.cookie = 'gm_token=not.a.jwt';
  assert.equal((await c.get('/bootstrap')).status, 401);
});

test('idle sessions expire after the auto-lock time', async () => {
  const c = await H.signedIn(ctx.base, '5555');
  const jwt = require('jsonwebtoken');
  const env = require('../config/env');
  const u = await ctx.models.User.findOne();
  const old = Math.floor(Date.now() / 1000) - 6 * 60; // 6 min ago > default 5 min
  c.cookie = 'gm_token=' + jwt.sign({ sub: String(u._id), tv: u.tokenVersion, st: old, iat: old }, env.jwtSecret, { algorithm: 'HS256', expiresIn: '24h' });
  assert.equal((await c.get('/bootstrap')).status, 401);
});

test('errors never leak internals', async () => {
  const c = await H.signedIn(ctx.base, '5555');
  const r = await c.get('/accounts/zzz');
  assert.equal(r.status, 404);
  const bad = await c.req('POST', '/accounts', '{not json');
  assert.equal(bad.status, 400);
  assert.ok(!JSON.stringify(bad.data).includes('node_modules'));
});
