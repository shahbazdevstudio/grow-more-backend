const { Account, Transaction, Budget, TradingTransaction } = require('../models');
const { position } = require('./tradingMath');
const D = require('../utils/dates');
const { r2 } = require('../utils/money');
const { dto } = require('../utils/dto');
const A = require('./analyticsService');
const { oid } = require('./balanceService');

/**
 * Net worth at the end of each of the last 12 months = account balances + investments held.
 * Investments are valued at COST (what you put in, incl. fees), because past market prices are not stored — so moving money
 * from a bank account into Bitcoin never looks like losing it. Daraz stock is not included.
 */
async function netWorth(userId, tz) {
  const accounts = await Account.find({ user: userId, archived: false }).select('openingBalance').lean();
  const active = new Set(accounts.map((a) => String(a._id)));
  const opening = accounts.reduce((s, a) => s + (a.openingBalance || 0), 0);
  const [rows, trades] = await Promise.all([
    Transaction.aggregate([{ $match: { user: oid(userId), deletedAt: null } }, { $group: { _id: { d: '$date', t: '$type', a: '$account', b: '$toAccount' }, amount: { $sum: '$amount' } } }]),
    TradingTransaction.find({ user: userId, deletedAt: null }).lean(),
  ]);
  const flows = new Map();
  for (const r of rows) {
    const { d, t, a, b } = r._id; let n = 0;
    if (t === 'income' && active.has(String(a))) n += r.amount;
    if (t === 'expense' && active.has(String(a))) n -= r.amount;
    if (t === 'transfer') { if (active.has(String(a))) n -= r.amount; if (active.has(String(b))) n += r.amount; }
    if (n) flows.set(d, (flows.get(d) || 0) + n);
  }
  const byAsset = new Map(); trades.forEach((t) => { const k = String(t.asset); if (!byAsset.has(k)) byAsset.set(k, []); byAsset.get(k).push(t); });
  const today = D.todayIn(tz); const entries = [...flows.entries()];
  const series = [];
  for (let m = D.addMonths(D.startOfMonth(today), -11); m <= today; m = D.addMonths(m, 1)) {
    const end = D.endOfMonth(m) < today ? D.endOfMonth(m) : today;
    const balance = r2(opening + entries.reduce((s, [d, n]) => (d <= end ? s + n : s), 0));
    let investments = 0; for (const ts of byAsset.values()) investments += position(ts.filter((t) => t.date <= end)).costBasis;
    investments = r2(investments);
    series.push({ key: D.monthKey(m), balance, investments, total: r2(balance + investments) });
  }
  const cur = series.at(-1);
  return { series, current: { balance: cur.balance, investments: cur.investments, total: cur.total }, change: r2(cur.total - series[0].total), basis: 'Account balances + investments at cost (Daraz stock not included).' };
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
async function weekday(userId, { from, to }, scope) {
  const per = await A.dailyTotals(userId, from, to, scope);
  const total = Array(7).fill(0); const days = Array(7).fill(0);
  for (let d = from; d <= to; d = D.addDays(d, 1)) { const i = (D.fromDow(d)); days[i] += 1; total[i] += per.get(d)?.expense || 0; }
  return DOW.map((label, i) => ({ dow: i, label, total: r2(total[i]), avg: days[i] ? r2(total[i] / days[i]) : 0, days: days[i] }));
}

async function topExpenses(userId, { from, to }, scope, limit = 8) {
  const rows = await Transaction.find({ user: userId, deletedAt: null, type: 'expense', date: { $gte: from, $lte: to }, ...A.scopeMatch(scope) }).sort({ amount: -1 }).limit(limit).select('title amount date category account module').lean();
  return rows.map(dto);
}

/** Where this month's personal spending is heading, based on the daily pace so far. */
async function forecast(userId, tz) {
  const today = D.todayIn(tz); const start = D.startOfMonth(today); const dim = D.diffDays(start, D.endOfMonth(today)) + 1; const elapsed = D.diffDays(start, today) + 1;
  const [t, b] = await Promise.all([A.totals(userId, start, today, 'personal'), Budget.findOne({ user: userId }).lean()]);
  const projected = r2((t.expense / elapsed) * dim); const limit = b?.monthlyLimit ?? null;
  return { spent: t.expense, dailyAverage: r2(t.expense / elapsed), daysElapsed: elapsed, daysInMonth: dim, projected, monthlyLimit: limit, status: limit == null ? 'unset' : projected > limit ? 'over' : projected > limit * 0.9 ? 'close' : 'ok', difference: limit == null ? null : r2(projected - limit) };
}

async function monthly(userId, tz, scope) {
  const today = D.todayIn(tz); const from = D.addMonths(D.startOfMonth(today), -11);
  const s = await A.series(userId, { from, to: today }, 'month', scope);
  return s.buckets.map((b) => ({ key: b.key, income: b.income, expense: b.expense, net: r2(b.income - b.expense), savingsRate: b.income > 0 ? Math.round(((b.income - b.expense) / b.income) * 1000) / 10 : null }));
}

module.exports = { netWorth, weekday, topExpenses, forecast, monthly };
