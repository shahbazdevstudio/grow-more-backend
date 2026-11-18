const { Schema, model } = require('mongoose');
const C = require('../config/constants');
const env = require('../config/env');

const schema = new Schema(
  {
    displayName: { type: String, trim: true, maxlength: 60, default: 'Owner' },
    pinHash: { type: String, required: true, select: false },
    tokenVersion: { type: Number, default: 0 }, // bump to invalidate every issued session
    seedKey: { type: String, unique: true, sparse: true, select: false }, // guards first-run seeding against two instances racing
    // Brute-force protection (enforced server-side, shared across all devices/IPs)
    failedAttempts: { type: Number, default: 0 },
    lockLevel: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastFailedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    pinChangedAt: { type: Date, default: null },
    settings: {
      theme: { type: String, enum: C.THEMES, default: 'dark' },
      currency: { type: String, enum: C.CURRENCIES, default: 'PKR' },
      timezone: { type: String, default: () => env.defaultTimezone },
      autoLockMinutes: { type: Number, enum: C.AUTO_LOCK_OPTIONS, default: 5 },
    },
  },
  { timestamps: true }
);

schema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.pinHash;
    delete ret.tokenVersion;
    return ret;
  },
});

module.exports = model('User', schema);
