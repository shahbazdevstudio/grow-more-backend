const { SavingsGoal, Transaction, Account } = require('../models');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const D = require('../utils/dates');
const { r2, pct } = require('../utils/money');
const { accountsWithBalances, oid } = require('./balanceService');
const A = require('./analyticsService');
const { savingsFlow } = A;
const { getOwned } = require('./accountService');

async function checkAccount(userId, id) {
  if (!id) return null;
  const acc = await getOwned(userId, id).catch(() => { throw new ApiError(400, 'Savings account not found.', 'VALIDATION'); });
  if (acc.type !== 'savings' || acc.archived) throw new ApiError(400, 'Choose one of your active savings accounts.', 'VALIDATION');
  return acc._id;
}

function goalProgress(g, balances, totalSavings, today) {
  const current = g.account ? balances.get(String(g.account)) ?? 0 : totalSavings;
  const remaining = Math.max(0, r2(g.targetAmount - current));
  const out = { ...dto(g), current: r2(current), remaining, pct: Math.min(100, pct(Math.max(0, current), g.targetAmount)), reached: current >= g.targetAmount, daysLeft: null, monthlyNeeded: null, overdue: false };
  if (g.targetDate) {
    out.daysLeft = D.diffDays(today, g.targetDate);
    out.overdue = out.daysLeft < 0 && !out.reached;
    if (out.daysLeft > 0 && remaining > 0) out.monthlyNeeded = r2(remaining / Math.max(1, out.daysLeft / 30.4375));
  }
  return out;
}

async function overview(userId, tz) {
  const today = D.todayIn(tz);
  const monthStart = D.startOfMonth(today);
  const [accounts, goals, flow] = await Promise.all([
    accountsWithBalances(userId),
    SavingsGoal.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    savingsFlow(userId, monthStart, today),
  ]);
  const savingsAccounts = accounts.filter((a) => a.type === 'savings');
  const balances = new Map(savingsAccounts.map((a) => [String(a._id), a.balance]));
  const totalSavings = r2(savingsAccounts.reduce((s, a) => s + a.balance, 0));
  let recent = [];
  if (savingsAccounts.length) {
    const ids = savingsAccounts.map((a) => oid(a._id));
    recent = await Transaction.find({ user: userId, deletedAt: null, type: 'transfer', $or: [{ toAccount: { $in: ids } }, { account: { $in: ids } }] }).sort({ date: -1, createdAt: -1 }).limit(6).lean();
  }
  return {
    totalSavings,
    accounts: savingsAccounts.map((a) => ({ id: String(a._id), balance: a.balance })),
    month: { from: monthStart, to: today, ...flow },
    goals: goals.map((g) => goalProgress(g, balances, totalSavings, today)),
    recent: recent.map(dto),
  };
}

async function createGoal(userId, data) {
  data.account = await checkAccount(userId, data.account);
  return dto(await SavingsGoal.create({ ...data, user: userId }));
}

async function updateGoal(userId, id, data) {
  const g = await SavingsGoal.findOne({ _id: id, user: userId });
  if (!g) throw new ApiError(404, 'Goal not found.', 'NOT_FOUND');
  data.account = await checkAccount(userId, data.account);
  g.set(data);
  await g.save();
  return dto(g);
}

async function removeGoal(userId, id) {
  const r = await SavingsGoal.deleteOne({ _id: id, user: userId });
  if (!r.deletedCount) throw new ApiError(404, 'Goal not found.', 'NOT_FOUND');
  return { deleted: true };
}

/* ---------- advanced savings: where the money came from, history, monthly trend ---------- */
async function savingsSet(userId) {
  const ids = (await Account.find({ user: userId, type: 'savings' }).select('_id').lean()).map((a) => a._id);
  return { ids, oids: ids.map((i) => oid(i)), set: new Set(ids.map(String)) };
}
const UNSPEC = 'Unspecified';

async function sources(userId, { from, to, all }) {
  const { oids } = await savingsSet(userId);
  if (!oids.length) return { total: 0, withdrawn: 0, items: [] };
  const range = { date: { $gte: from, $lte: to } };
  const base = { user: oid(userId), deletedAt: null, type: 'transfer', ...range };
  const [into, out] = await Promise.all([
    Transaction.aggregate([{ $match: { ...base, toAccount: { $in: oids }, account: { $nin: oids } } }, { $group: { _id: { $ifNull: [{ $cond: [{ $eq: ['$source', ''] }, null, '$source'] }, UNSPEC] }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    Transaction.aggregate([{ $match: { ...base, account: { $in: oids }, toAccount: { $nin: oids } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
  ]);
  const total = into.reduce((s, x) => s + x.amount, 0);
  void all;
  return { total: r2(total), withdrawn: r2(out[0]?.amount || 0), items: into.map((x) => ({ source: x._id, amount: r2(x.amount), count: x.count, pct: pct(x.amount, total) })) };
}

async function history(userId, f) {
  const { oids, set } = await savingsSet(userId);
  if (!oids.length) return { items: [], pagination: { page: 1, limit: f.limit, total: 0, pages: 1 } };
  const match = { user: oid(userId), deletedAt: null, type: 'transfer', $or: [{ toAccount: { $in: oids } }, { account: { $in: oids } }] };
  if (f.source) match.source = f.source === UNSPEC ? '' : f.source;
  if (f.from || f.to) match.date = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  const [items, total] = await Promise.all([
    Transaction.find(match).sort({ date: -1, createdAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    Transaction.countDocuments(match),
  ]);
  return { items: items.map((t) => ({ ...dto(t), direction: set.has(String(t.account)) && set.has(String(t.toAccount)) ? 'internal' : set.has(String(t.toAccount)) ? 'in' : 'out' })), pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) } };
}

/** Last 12 months: money moved into savings, taken out, and what share of income it was. */
async function trend(userId, tz) {
  const { oids, set } = await savingsSet(userId);
  const today = D.todayIn(tz); const from = D.addMonths(D.startOfMonth(today), -11);
  const keys = []; for (let d = from; d <= today; d = D.addMonths(d, 1)) keys.push(D.monthKey(d));
  const m = new Map(keys.map((k) => [k, { key: k, saved: 0, withdrawn: 0 }]));
  if (oids.length) {
    const rows = await Transaction.aggregate([{ $match: { user: oid(userId), deletedAt: null, type: 'transfer', date: { $gte: from, $lte: today }, $or: [{ toAccount: { $in: oids } }, { account: { $in: oids } }] } },
      { $group: { _id: { k: { $substr: ['$date', 0, 7] }, a: '$account', b: '$toAccount' }, amount: { $sum: '$amount' } } }]);
    for (const r of rows) { const e = m.get(r._id.k); if (!e) continue; const fs = set.has(String(r._id.a)); const ts = set.has(String(r._id.b)); if (!fs && ts) e.saved += r.amount; if (fs && !ts) e.withdrawn += r.amount; }
  }
  const inc = await A.series(userId, { from, to: today }, 'month', 'all');
  const incomeBy = new Map(inc.buckets.map((b) => [b.key, b.income]));
  const buckets = keys.map((k) => { const e = m.get(k); const income = incomeBy.get(k) || 0; return { key: k, saved: r2(e.saved), withdrawn: r2(e.withdrawn), net: r2(e.saved - e.withdrawn), income: r2(income), rate: income > 0 ? Math.round((e.saved / income) * 1000) / 10 : null }; });
  const tot = buckets.reduce((s, b) => s + b.saved, 0); const inTot = buckets.reduce((s, b) => s + b.income, 0);
  return { buckets, totalSaved: r2(tot), averageMonthly: r2(tot / buckets.length), overallRate: inTot > 0 ? Math.round((tot / inTot) * 1000) / 10 : null };
}

module.exports = { sources, history, trend, overview, createGoal, updateGoal, removeGoal };
