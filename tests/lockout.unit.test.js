require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerFailure, isLocked } = require('../services/lockoutService');

const t0 = new Date('2026-01-01T10:00:00Z');
const step = (s, now) => ({ ...s, ...registerFailure(s, now) });

test('3 wrong PINs are tolerated, the 4th locks for 5 minutes', () => {
  let s = { failedAttempts: 0, lockLevel: 0 };
  s = step(s, t0); assert.equal(s.attemptsLeft, 3); assert.equal(s.locked, false);
  s = step(s, t0); assert.equal(s.attemptsLeft, 2);
  s = step(s, t0); assert.equal(s.attemptsLeft, 1); assert.equal(s.locked, false);
  s = step(s, t0);
  assert.equal(s.locked, true);
  assert.equal(s.lockMinutes, 5);
  assert.equal(s.lockedUntil.getTime() - t0.getTime(), 5 * 60000);
  assert.equal(isLocked(s, new Date(t0.getTime() + 4 * 60000)), true);
  assert.equal(isLocked(s, new Date(t0.getTime() + 5 * 60000 + 1)), false);
});

test('every further group of failures adds 5 more minutes (5, 10, 15, 20)', () => {
  let s = { failedAttempts: 0, lockLevel: 0 };
  const minutes = [];
  let now = t0;
  for (let group = 0; group < 4; group++) {
    for (let i = 0; i < 4; i++) { s = step(s, now); }
    minutes.push(s.lockMinutes);
    now = new Date(s.lockedUntil.getTime() + 1000); // wait out the lock, then try again
  }
  assert.deepEqual(minutes, [5, 10, 15, 20]);
});

test('failures older than 24h are forgotten', () => {
  let s = { failedAttempts: 0, lockLevel: 0 };
  for (let i = 0; i < 4; i++) s = step(s, t0);
  assert.equal(s.lockLevel, 1);
  s = step(s, new Date(t0.getTime() + 25 * 3600 * 1000));
  assert.equal(s.locked, false);
  assert.equal(s.attemptsLeft, 3);
  assert.equal(s.lockLevel, 0);
});

test('lock is capped at 24 hours', () => {
  const s = registerFailure({ failedAttempts: 3, lockLevel: 500, lastFailedAt: t0 }, t0);
  assert.equal(s.lockMinutes, 1440);
});
