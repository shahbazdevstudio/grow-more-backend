const { Budget } = require('../models');
const A = require('./analyticsService');
const D = require('../utils/dates');
const { r2, pct } = require('../utils/money');

const EMPTY = { dailyLimit: null, monthlyLimit: null, savingsTarget: null };

async function get(userId) {
  const b = await Budget.findOne({ user: userId }).lean();
  return b ? { dailyLimit: b.dailyLimit ?? null, monthlyLimit: b.monthlyLimit ?? null, savingsTarget: b.savingsTarget ?? null } : { ...EMPTY };
}

async function save(userId, data) {
  const b = await Budget.findOneAndUpdate({ user: userId }, { $set: data, $setOnInsert: { user: userId } }, { upsert: true, new: true, runValidators: true }).lean();
  return { dailyLimit: b.dailyLimit ?? null, monthlyLimit: b.monthlyLimit ?? null, savingsTarget: b.savingsTarget ?? null };
}

// >100% = exceeded, >=80% = warning
const status = (limit, spent) => (limit == null ? 'unset' : spent > limit ? 'exceeded' : spent >= limit * 0.8 ? 'warning' : 'ok');

/** Live budget progress — always calculated from real (non-deleted) expense rows. */
async function progress(userId, tz) {
  const budget = await get(userId);
  const today = D.todayIn(tz);
  const monthStart = D.startOfMonth(today);
  const monthEnd = D.endOfMonth(today);
  const [todayT, monthT, flow] = await Promise.all([A.totals(userId, today, today, 'personal'), A.totals(userId, monthStart, today, 'personal'), A.savingsFlow(userId, monthStart, today)]);
  const daysLeft = D.diffDays(today, monthEnd) + 1; // includes today
  const mk = (limit, spent) => ({ limit, spent, remaining: limit == null ? null : r2(limit - spent), pct: limit == null ? 0 : pct(spent, limit), status: status(limit, spent) });
  const monthly = mk(budget.monthlyLimit, monthT.expense);
  return {
    budget,
    today,
    daily: mk(budget.dailyLimit, todayT.expense),
    monthly: { ...monthly, daysLeft, safeDailySpend: budget.monthlyLimit == null ? null : Math.max(0, r2((budget.monthlyLimit - monthT.expense) / daysLeft)) },
    savings: {
      target: budget.savingsTarget,
      saved: Math.max(0, flow.net),
      pct: budget.savingsTarget ? Math.min(100, pct(Math.max(0, flow.net), budget.savingsTarget)) : 0,
      status: budget.savingsTarget == null ? 'unset' : flow.net >= budget.savingsTarget ? 'done' : 'ok',
    },
  };
}

module.exports = { get, save, progress };
