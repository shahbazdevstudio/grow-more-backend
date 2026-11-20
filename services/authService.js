const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const { hashPin, verifyPin } = require('./pinService');
const { registerFailure, isLocked, secondsLeft } = require('./lockoutService');

// PIN checks run one-at-a-time so a burst of parallel guesses cannot sneak past the lockout counter.
let chain = Promise.resolve();
const serialize = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

const lockedError = (user, now = new Date()) =>
  new ApiError(423, 'Too many incorrect attempts.', 'LOCKED', {
    lockedUntil: new Date(user.lockedUntil).toISOString(),
    retryAfterSeconds: secondsLeft(user, now),
    serverTime: now.toISOString(),
  });

/** Core PIN check with lockout bookkeeping. Throws on wrong PIN / lock. Returns the user (with pinHash) on success. */
async function checkPin(user, pin) {
  const now = new Date();
  if (isLocked(user, now)) throw lockedError(user, now);
  if (await verifyPin(pin, user.pinHash)) {
    await User.updateOne({ _id: user._id }, { $set: { failedAttempts: 0, lockLevel: 0, lockedUntil: null, lastFailedAt: null } });
    return user;
  }
  const f = registerFailure(user, now);
  await User.updateOne({ _id: user._id }, { $set: { failedAttempts: f.failedAttempts, lockLevel: f.lockLevel, lockedUntil: f.lockedUntil, lastFailedAt: f.lastFailedAt } });
  if (f.locked) throw lockedError({ lockedUntil: f.lockedUntil }, now);
  throw new ApiError(401, 'Incorrect PIN.', 'BAD_PIN', { attemptsLeft: f.attemptsLeft });
}

const ownerQuery = () => User.findOne().sort({ createdAt: 1 }).select('+pinHash');

function login(pin) {
  return serialize(async () => {
    const user = await ownerQuery();
    if (!user) throw new ApiError(503, 'Grow More has not been set up yet. Run "npm run setup" on the server.', 'NOT_SETUP');
    await checkPin(user, pin);
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    return user;
  });
}

function changePin(userId, currentPin, newPin) {
  return serialize(async () => {
    const user = await User.findById(userId).select('+pinHash');
    if (!user) throw new ApiError(401, 'Please enter your PIN.', 'LOCKED');
    await checkPin(user, currentPin);
    if (currentPin === newPin) throw new ApiError(400, 'Your new PIN must be different from the current one.', 'VALIDATION');
    user.pinHash = await hashPin(newPin);
    user.pinChangedAt = new Date();
    user.tokenVersion += 1; // every other signed-in device is signed out
    await user.save();
    return user;
  });
}

/** Re-checks the PIN for a dangerous action (counts toward the lockout like any other wrong PIN). Runs `then` only if the PIN is right. */
function confirmPin(userId, pin, then) {
  return serialize(async () => {
    const user = await User.findById(userId).select('+pinHash');
    if (!user) throw new ApiError(401, 'Please enter your PIN.', 'LOCKED');
    await checkPin(user, pin);
    return then(user);
  });
}

/** Public lock state for the PIN screen (never reveals anything about the PIN). */
async function lockStatus() {
  const user = await User.findOne().sort({ createdAt: 1 }).select('lockedUntil failedAttempts').lean();
  if (!user) return { setupRequired: true, locked: false };
  const now = new Date();
  if (isLocked(user, now)) return { setupRequired: false, locked: true, lockedUntil: new Date(user.lockedUntil).toISOString(), retryAfterSeconds: secondsLeft(user, now), serverTime: now.toISOString() };
  return { setupRequired: false, locked: false };
}

async function revokeAllSessions(userId) {
  return User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } }, { new: true });
}

module.exports = { login, changePin, confirmPin, lockStatus, revokeAllSessions };
