const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

// A 4-digit PIN has only 10,000 combinations, so hashing alone cannot protect it — the server-side
// lockout (lockoutService) is the real defence. We still never store it in plain text: the PIN is
// keyed with a secret pepper (HMAC-SHA256) and then hashed with bcrypt (salted, slow).
const peppered = (pin) => crypto.createHmac('sha256', env.pinPepper).update(String(pin)).digest('base64');

const hashPin = (pin) => bcrypt.hash(peppered(pin), env.bcryptRounds);
const verifyPin = (pin, hash) => bcrypt.compare(peppered(pin), hash);

module.exports = { hashPin, verifyPin };
