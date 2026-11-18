const { Account, Transaction, Category } = require('../models');
const { accountsWithBalances, oid } = require('./balanceService');
const D = require('../utils/dates');
const { r2, pct } = require('../utils/money');

/** Per-day income/expense. Transfers are never included, so moving money never looks like earning or spending. */
// Trading buys/sells are capital movements (not income/expense), so they are excluded from every income/expense report.
const scopeMatch = (scope) => (scope === 'personal' ? { module: null } : scope === 'business' ? { module: { $in: ['coding', 'daraz'] } } : { module: { $ne: 'trading' } });

async function dailyTotals(userId, from, to, scope = 'all') {
  const rows = await Transaction.aggregate([
    { $match: { user: oid(userId), deletedAt: null, type: { $in: ['income', 'expense'] }, date: { $gte: from, $lte: to }, ...scopeMatch(scope) } },
    { $group: { _id: { d: '$date', t: '$type' }, amount: { $sum: '$amount' }, n: { $sum: 1 } } },
  ]);
  const map = new Map();
  for (const r of rows) {
    const e = map.get(r._id.d) || { income: 0, expense: 0, count: 0 };
    e[r._id.t] += r.amount;
    e.count += r.n;
    map.set(r._id.d, e);
  }
  return map;
}

async function totals(userId, from, to, scope = 'all') {
  const m = await dailyTotals(userId, from, to, scope);
  let income = 0, expense = 0, count = 0;
  for (const v of m.values()) { income += v.income; expense += v.expense; count += v.count; }
  return { income: r2(income), expense: r2(expense), net: r2(income - expense), count };
}

async function savingsFlow(userId, from, to) {
  const ids = (await Account.find({ user: userId, type: 'savings' }).select('_id').lean()).map((a) => String(a._id));
  if (!ids.length) return { contributed: 0, withdrawn: 0, net: 0 };
  const oids = ids.map(oid);
  const set = new Set(ids);
  const rows = await Transaction.aggregate([
    { $match: { user: oid(userId), deletedAt: null, type: 'transfer', date: { $gte: from, $lte: to }, $or: [{ toAccount: { $in: oids } }, { account: { $in: oids } }] } },
    { $group: { _id: { a: '$account', b: '$toAccount' }, amount: { $sum: '$amount' } } },
  ]);
  let contributed = 0, withdrawn = 0;
  for (const r of rows) {
    const fromS = set.has(String(r._id.a)), toS = set.has(String(r._id.b));
    if (!fromS && toS) contributed += r.amount;
    if (fromS && !toS) withdrawn += r.amount;
  }
  return { contributed: r2(contributed), withdrawn: r2(withdrawn), net: r2(contributed - withdrawn) };
}

async function categoryBreakdown(userId, from, to, type = 'expense', scope = 'all') {
  const [rows, cats] = await Promise.all([
    Transaction.aggregate([
      { $match: { user: oid(userId), deletedAt: null, type, date: { $gte: from, $lte: to }, ...scopeMatch(scope) } },
      { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    Category.find({ user: userId }).lean(),
  ]);
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    total: r2(total),
    items: rows.map((r) => {
      const c = byId.get(String(r._id));
      return { categoryId: r._id ? String(r._id) : null, name: c ? c.name : 'Uncategorised', color: c ? c.color : '#94A3B8', icon: c ? c.icon : 'tag', amount: r2(r.amount), count: r.count, pct: pct(r.amount, total) };
    }),
  };
}

async function summary(userId, { from, to }, scope = 'all') {
  const days = D.diffDays(from, to) + 1;
  const prevTo = D.addDays(from, -1);
  const prevFrom = D.addDays(prevTo, -(days - 1));
  const [cur, prev, cats, flow, largest] = await Promise.all([
    totals(userId, from, to, scope),
    totals(userId, prevFrom, prevTo, scope),
    categoryBreakdown(userId, from, to, 'expense', scope),
    savingsFlow(userId, from, to),
    Transaction.findOne({ user: userId, deletedAt: null, type: 'expense', date: { $gte: from, $lte: to }, ...scopeMatch(scope) }).sort({ amount: -1 }).select('title amount date').lean(),
  ]);
  return {
    from, to, days,
    ...cur,
    avgDailyExpense: r2(cur.expense / days),
    previous: { from: prevFrom, to: prevTo, income: prev.income, expense: prev.expense },
    expenseChangePct: prev.expense > 0 ? Math.round(((cur.expense - prev.expense) / prev.expense) * 1000) / 10 : null,
    savingsRate: cur.income > 0 ? Math.round(((cur.income - cur.expense) / cur.income) * 1000) / 10 : null,
    topCategory: cats.items[0] || null,
    largestExpense: largest ? { title: largest.title, amount: largest.amount, date: largest.date } : null,
    savings: flow,
  };
}

const MAX_DAILY_BUCKETS = 120;

async function series(userId, { from, to }, granularity = 'day', scope = 'all') {
  let truncated = false;
  if (granularity === 'day' && D.diffDays(from, to) + 1 > MAX_DAILY_BUCKETS) { from = D.addDays(to, -(MAX_DAILY_BUCKETS - 1)); truncated = true; }
  const keyOf = { day: (d) => d, week: D.weekStart, month: D.monthKey }[granularity];
  const keys = [];
  if (granularity === 'day') for (let d = from; d <= to; d = D.addDays(d, 1)) keys.push(d);
  else if (granularity === 'week') for (let d = D.weekStart(from); d <= to; d = D.addDays(d, 7)) keys.push(d);
  else for (let d = D.startOfMonth(from); d <= to; d = D.addMonths(d, 1)) keys.push(D.monthKey(d));
  const buckets = new Map(keys.map((k) => [k, { key: k, income: 0, expense: 0 }]));
  for (const [date, v] of await dailyTotals(userId, from, to, scope)) {
    const b = buckets.get(keyOf(date));
    if (b) { b.income += v.income; b.expense += v.expense; }
  }
  return { granularity, from, to, truncated, buckets: [...buckets.values()].map((b) => ({ ...b, income: r2(b.income), expense: r2(b.expense) })) };
}

async function accountDistribution(userId) {
  const accounts = await accountsWithBalances(userId);
  const positive = accounts.filter((a) => a.balance > 0);
  const total = positive.reduce((s, a) => s + a.balance, 0);
  return {
    total: r2(total),
    items: positive.sort((a, b) => b.balance - a.balance).map((a) => ({ id: String(a._id), name: a.name, type: a.type, color: a.color, balance: a.balance, pct: pct(a.balance, total) })),
    negative: accounts.filter((a) => a.balance < 0).map((a) => ({ id: String(a._id), name: a.name, balance: a.balance })),
  };
}

module.exports = { scopeMatch, dailyTotals, totals, savingsFlow, categoryBreakdown, summary, series, accountDistribution };
