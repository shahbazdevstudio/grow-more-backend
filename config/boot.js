/** Start-up shared by the local server (server.js) and the Vercel function (../api/index.js). */
const env = require('./env');
const connectDB = require('./db');

/** Creates the owner account from INITIAL_PIN — only if no owner exists yet. Safe to call on every start. */
async function ensureOwner() {
  if (!env.initialPin) return;
  const { User } = require('../models');
  if (await User.exists({})) return;
  if (!/^\d{4}$/.test(env.initialPin)) { console.error('[grow-more] INITIAL_PIN must be exactly 4 digits - owner not created.'); return; }
  const { hashPin } = require('../services/pinService');
  const { ensureDefaults } = require('../services/categoryService');
  try {
    const user = await User.create({ pinHash: await hashPin(env.initialPin), displayName: 'Owner', pinChangedAt: new Date(), seedKey: 'owner' });
    await ensureDefaults(user._id);
    console.log('[grow-more] Owner account created from INITIAL_PIN. You can now remove INITIAL_PIN from the environment.');
  } catch (e) {
    if (e && e.code === 11000) return; // another instance created it a moment ago
    throw e;
  }
}

async function boot() {
  await connectDB(env);
  await ensureOwner();
}

module.exports = { boot, ensureOwner };
