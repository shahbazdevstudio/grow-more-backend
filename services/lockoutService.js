const C = require('../config/constants');

/**
 * Pure lockout rules (no I/O) so they can be unit-tested.
 *  - 3 incorrect PINs are tolerated.
 *  - The 4th incorrect PIN locks the app for 5 minutes.
 *  - Each further group of failures (3 tolerated + 1 locking) adds another 5 minutes: 5, 10, 15 ...
 *  - A correct PIN resets everything. Failures older than 24h are forgotten.
 */
function registerFailure(state, now = new Date()) {
  let { failedAttempts = 0, lockLevel = 0, lastFailedAt = null } = state;
  if (lastFailedAt && now - new Date(lastFailedAt) > C.FAILURE_MEMORY_HOURS * 3600 * 1000) {
    failedAttempts = 0;
    lockLevel = 0;
  }
  failedAttempts += 1;
  if (failedAttempts > C.MAX_FREE_FAILURES) {
    lockLevel += 1;
    const minutes = Math.min(lockLevel * C.LOCK_STEP_MINUTES, C.MAX_LOCK_MINUTES);
    return { failedAttempts: 0, lockLevel, lockedUntil: new Date(now.getTime() + minutes * 60000), lastFailedAt: now, locked: true, lockMinutes: minutes, attemptsLeft: 0 };
  }
  return { failedAttempts, lockLevel, lockedUntil: null, lastFailedAt: now, locked: false, lockMinutes: 0, attemptsLeft: C.MAX_FREE_FAILURES + 1 - failedAttempts };
}

const isLocked = (user, now = new Date()) => !!(user.lockedUntil && new Date(user.lockedUntil) > now);
const secondsLeft = (user, now = new Date()) => Math.max(0, Math.ceil((new Date(user.lockedUntil) - now) / 1000));

module.exports = { registerFailure, isLocked, secondsLeft };
