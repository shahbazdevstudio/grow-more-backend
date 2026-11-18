const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function required(key, { minLength = 0 } = {}) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`);
  if (v.length < minLength) throw new Error(`${key} must be at least ${minLength} characters long.`);
  return v;
}

const env = {
  isProd,
  isTest,
  port: Number(process.env.PORT) || 5000,
  mongoUri: required('MONGODB_URI'),
  mongoDb: process.env.MONGODB_DB || 'growmore_v2',
  jwtSecret: required('JWT_SECRET', { minLength: 32 }),
  pinPepper: required('PIN_PEPPER', { minLength: 32 }),
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  cookieSameSite: (process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax')).toLowerCase(),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  trustProxy: process.env.TRUST_PROXY || '0',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Karachi',
  bcryptRounds: isTest ? 4 : 12,
  // First-run PIN: used ONLY when no owner exists yet (see config/boot.js). Remove it from .env afterwards.
  initialPin: (process.env.INITIAL_PIN || '').trim(),
  // Image storage. Optional at start-up; an upload without these set answers with a clear 503.
  cloudinary: {
    cloudName: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    apiKey: (process.env.CLOUDINARY_API_KEY || '').trim(),
    apiSecret: (process.env.CLOUDINARY_API_SECRET || '').trim(),
    folder: (process.env.CLOUDINARY_FOLDER || 'growmore').trim().replace(/^\/+|\/+$/g, ''),
    apiBase: (process.env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com/v1_1').replace(/\/+$/, ''), // only overridden by tests
  },
};

if (env.cookieSameSite === 'none' && !env.cookieSecure) {
  throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (HTTPS).');
}
module.exports = env;
