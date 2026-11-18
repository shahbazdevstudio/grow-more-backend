const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defence for cookie auth: state-changing calls need our custom header (forces a CORS preflight) and an allowed Origin. */
function csrfGuard(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.get('X-Requested-With') !== 'GrowMore') throw new ApiError(403, 'Request blocked.', 'FORBIDDEN');
  const origin = req.get('Origin');
  if (origin && !env.clientOrigins.includes(origin)) throw new ApiError(403, 'Request blocked.', 'FORBIDDEN');
  next();
}

/** MongoDB operator-injection guard: reject any key that starts with "$" or contains "." in body or query. */
function hasBadKey(value, depth = 0) {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((v) => hasBadKey(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => k.startsWith('$') || k.includes('.') || hasBadKey(v, depth + 1));
  }
  return false;
}
function rejectOperators(req, _res, next) {
  if (hasBadKey(req.body) || hasBadKey(req.query)) throw new ApiError(400, 'Invalid request.', 'VALIDATION');
  next();
}

const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

module.exports = { csrfGuard, rejectOperators, noStore, hasBadKey };
