const jwt = require('jsonwebtoken');
const env = require('../config/env');
const C = require('../config/constants');
const { User } = require('../models');

const COOKIE = 'gm_token';
const cookieOptions = () => ({
  httpOnly: true, // JavaScript can never read the token
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: '/',
  maxAge: C.MAX_SESSION_HOURS * 3600 * 1000,
});

const sign = (user, startedAt = Math.floor(Date.now() / 1000)) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion, st: startedAt }, env.jwtSecret, { algorithm: 'HS256', expiresIn: `${C.MAX_SESSION_HOURS}h` });

const setCookie = (res, user, startedAt) => res.cookie(COOKIE, sign(user, startedAt), cookieOptions());
const clearCookie = (res) => res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });

/**
 * Validates the session cookie. Sessions are "sliding": each request re-issues the token, and a session
 * idle for longer than the user's auto-lock time (or older than 24h in total) is rejected.
 * Returns the (lean) user or null.
 */
async function resolveSession(req, res) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  let p;
  try { p = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }); } catch { return null; }
  const user = await User.findById(p.sub).select('displayName tokenVersion settings').lean();
  if (!user || user.tokenVersion !== p.tv) return null;
  const now = Date.now();
  if (now - p.iat * 1000 > user.settings.autoLockMinutes * 60000) return null; // idle too long
  if (now - p.st * 1000 > C.MAX_SESSION_HOURS * 3600 * 1000) return null; // absolute limit
  if (res && now - p.iat * 1000 > C.TOKEN_REFRESH_SECONDS * 1000) setCookie(res, user, p.st);
  return user;
}

module.exports = { setCookie, clearCookie, resolveSession, COOKIE };
