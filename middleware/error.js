const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const notFound = (_req, _res, next) => next(new ApiError(404, 'Not found.', 'NOT_FOUND'));

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
  if (err.name === 'ValidationError' && err.errors) {
    return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join(' '), code: 'VALIDATION' });
  }
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid value.', code: 'VALIDATION' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.', code: 'VALIDATION' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.', code: 'TOO_LARGE' });
  if (!env.isTest) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.', code: 'SERVER_ERROR' }); // no internals leaked
}

module.exports = { notFound, errorHandler };
