/* Run on the server:  npm run setup
 * Creates the owner account (first run) or resets the PIN. This is the only way an account is created —
 * there is no public sign-up endpoint. */
const readline = require('readline');
const env = require('../config/env');
const connectDB = require('../config/db');
const { User } = require('../models');
const { hashPin } = require('../services/pinService');
const { ensureDefaults } = require('../services/categoryService');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write(''); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

(async () => {
  await connectDB(env);
  let user = await User.findOne().sort({ createdAt: 1 });
  console.log(user ? '\nAn owner account already exists. You can set a NEW PIN (this also clears any lockout).' : '\nWelcome to Grow More. Let\'s create your PIN.');
  // Non-interactive:  npm run set-pin   (uses INITIAL_PIN from .env)   or   GM_SETUP_PIN=1234 npm run setup
  const preset = process.env.GM_SETUP_PIN || (process.argv.includes('--from-env') ? env.initialPin : '');
  const pin = preset || (await ask('Choose a 4-digit PIN: ', { hidden: true }));
  const again = preset || (await ask('Repeat the PIN:        ', { hidden: true }));
  if (!/^\d{4}$/.test(pin) || pin !== again) { console.error('PINs must match and be exactly 4 digits. Nothing was changed.'); process.exit(1); }
  const pinHash = await hashPin(pin);
  if (user) {
    Object.assign(user, { pinHash, pinChangedAt: new Date(), failedAttempts: 0, lockLevel: 0, lockedUntil: null, lastFailedAt: null, tokenVersion: user.tokenVersion + 1 });
    await user.save();
    console.log('PIN updated. All devices were signed out.');
  } else {
    user = await User.create({ pinHash, displayName: 'Owner', pinChangedAt: new Date() });
    await ensureDefaults(user._id);
    console.log('Done. Your owner account and default categories were created.');
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
