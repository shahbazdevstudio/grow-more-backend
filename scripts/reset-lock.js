/* Run on the server:  npm run reset-lock   — clears a lockout (needs server access, so only the owner can do it). */
const env = require('../config/env');
const connectDB = require('../config/db');
const { User } = require('../models');

(async () => {
  await connectDB(env);
  const r = await User.updateMany({}, { $set: { failedAttempts: 0, lockLevel: 0, lockedUntil: null, lastFailedAt: null } });
  console.log(r.matchedCount ? 'Lockout cleared.' : 'No account found. Run "npm run setup" first.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
