const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const handler = (message) => (_req, res) => res.status(429).json({ error: message, code: 'RATE_LIMITED' });
const skip = () => env.isTest;

// Broad protection for the whole API
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, skip, handler: handler('Too many requests. Please slow down.') });
// On top of the account lockout: stops one IP from hammering the PIN endpoint
const pinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, skip, handler: handler('Too many PIN requests from this device. Try again later.') });

module.exports = { apiLimiter, pinLimiter };
