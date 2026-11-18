const { User } = require('../models');
const authService = require('../services/authService');
const accountService = require('../services/accountService');
const categoryService = require('../services/categoryService');
const budgetService = require('../services/budgetService');
const { setCookie } = require('../services/tokenService');
const { parseSettings, parsePin } = require('../validators/settings.validator');
const { todayIn } = require('../utils/dates');
const C = require('../config/constants');

/** One call after unlock: everything the app shell needs. */
exports.bootstrap = async (req, res) => {
  const { id, settings, displayName } = req.user;
  const [accounts, categories, budget] = await Promise.all([accountService.list(id), categoryService.list(id), budgetService.get(id)]);
  res.json({ user: { displayName, settings }, accounts, categories, budget, today: todayIn(settings.timezone), serverTime: new Date().toISOString() });
};

exports.updateSettings = async (req, res) => {
  const data = parseSettings(req.body);
  const set = Object.fromEntries(Object.entries(data).map(([k, v]) => [`settings.${k}`, v]));
  const user = await User.findByIdAndUpdate(req.user.id, { $set: set }, { new: true }).lean();
  res.json({ settings: user.settings });
};

exports.changePin = async (req, res) => {
  const b = req.body || {};
  const current = parsePin(b.currentPin, 'Current PIN');
  const next = parsePin(b.newPin, 'New PIN');
  const user = await authService.changePin(req.user.id, current, next);
  setCookie(res, user); // keep THIS device signed in with a fresh token
  res.json({ changed: true });
};

exports.revokeSessions = async (req, res) => {
  const user = await authService.revokeAllSessions(req.user.id);
  setCookie(res, user);
  res.json({ revoked: true });
};

exports.info = (_req, res) => res.json({
  name: 'Grow More', version: C.APP_VERSION, phase: C.PHASE,
  modules: { available: ['Dashboard', 'Transactions', 'Accounts', 'Analytics', 'Savings', 'Coding', 'Daraz', 'Trading', 'Notes', 'To-Do', 'Settings'], planned: [] },
});
