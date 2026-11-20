const mongoose = require('mongoose');
const { Account, DarazProduct } = require('../models');
const { ensureDefaults } = require('./categoryService');
const images = require('./imageService');

/**
 * Factory reset: removes every record the owner created (accounts, transactions, budgets, goals, business modules,
 * notes, to-dos, challenges, timetable …) and puts the app back to the way a fresh install looks (default categories only).
 * The User document is NOT touched, so the PIN, the sessions and the preferences (theme, currency, time zone, auto-lock) stay.
 * Every model except User is wiped automatically, so modules added later are covered too.
 */
async function resetAll(userId) {
  // uploaded pictures live on Cloudinary: collect their ids first, delete them once the data is gone
  const [accs, prods] = await Promise.all([Account.find({ user: userId }).select('logoPublicId').lean(), DarazProduct.find({ user: userId }).select('imagePublicId').lean()]);
  const publicIds = [...accs.map((a) => a.logoPublicId), ...prods.map((p) => p.imagePublicId)].filter(Boolean);

  const removed = {};
  for (const [name, Model] of Object.entries(mongoose.models)) {
    if (name === 'User') continue;
    const r = await Model.deleteMany({ user: userId });
    if (r.deletedCount) removed[name] = r.deletedCount;
  }
  await ensureDefaults(userId);
  await Promise.all(publicIds.map((id) => images.destroy(id))); // best effort - never throws
  return { removed };
}

module.exports = { resetAll };
