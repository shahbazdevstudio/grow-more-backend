const { Transaction } = require('../models');
const { accountsWithBalances } = require('./balanceService');
const A = require('./analyticsService');
const budgetService = require('./budgetService');
const codingService = require('./codingService');
const darazService = require('./darazService');
const tradingService = require('./tradingService');
const todoService = require('./todoService');
const D = require('../utils/dates');
const { r2 } = require('../utils/money');
const { dto } = require('../utils/dto');

async function get(userId, tz) {
  const today = D.todayIn(tz);
  const monthStart = D.startOfMonth(today);
  const weekAgo = D.addDays(today, -6);
  const [accounts, month, allTime, budget, recent, week, codingMonth, daraz, portfolio, tasks] = await Promise.all([
    accountsWithBalances(userId),
    A.totals(userId, monthStart, today),
    Transaction.exists({ user: userId, deletedAt: null }),
    budgetService.progress(userId, tz),
    Transaction.find({ user: userId, deletedAt: null }).sort({ date: -1, createdAt: -1, _id: -1 }).limit(6).lean(),
    A.series(userId, { from: weekAgo, to: today }, 'day', 'personal'),
    codingService.incomeBetween(userId, monthStart, today),
    darazService.businessBalance(userId),
    tradingService.portfolio(userId),
    todoService.counts(userId, today),
  ]);
  const totalBalance = r2(accounts.reduce((s, a) => s + a.balance, 0));
  const savings = r2(accounts.filter((a) => a.type === 'savings').reduce((s, a) => s + a.balance, 0));
  return {
    today,
    month: { from: monthStart, to: today, income: month.income, expense: month.expense, net: month.net },
    totals: { totalBalance, savings, accountCount: accounts.length, income: month.income, expenses: month.expense, todaySpent: budget.daily.spent },
    budget,
    business: { codingIncome: codingMonth, daraz },
    portfolio, tasks,
    recent: recent.map(dto),
    last7: week.buckets.map((b) => ({ date: b.key, expense: b.expense, income: b.income })),
    hasTransactions: !!allTime,
  };
}

module.exports = { get };
