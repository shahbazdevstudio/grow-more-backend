const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../utils/dates');

let ctx, a, b, cats, bCats;
const T = () => H.today();
const cat = (list, type, name) => list.find((x) => x.type === type && x.name === name).id;

test.before(async () => {
  ctx = await H.boot('growmore_t_domain');
  await H.createOwner('1234');
  a = await H.signedIn(ctx.base, '1234');
  cats = (await a.get('/categories')).data.categories;
  // A second user (the app is single-owner today, but the data model must already isolate users)
  const { User } = ctx.models;
  const { hashPin } = require('../services/pinService');
  const { ensureDefaults } = require('../services/categoryService');
  const { setCookie } = require('../services/tokenService');
  const u2 = await User.create({ pinHash: await hashPin('9876'), displayName: 'Other' });
  await ensureDefaults(u2._id);
  b = new H.Client(ctx.base);
  const jwt = require('jsonwebtoken'); const env = require('../config/env');
  b.cookie = 'gm_token=' + jwt.sign({ sub: String(u2._id), tv: 0, st: Math.floor(Date.now() / 1000) }, env.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
  bCats = (await b.get('/categories')).data.categories;
  void setCookie;
});
test.after(() => ctx.stop());

test('user isolation: nobody can read, edit, delete or reference another user\'s data', async () => {
  const acc = (await a.post('/accounts', { name: 'Private', type: 'bank', openingBalance: 777 })).data.account.id;
  const acc2 = (await a.post('/accounts', { name: 'Private2', type: 'bank', openingBalance: 0 })).data.account.id;
  const t = (await a.post('/transactions', { type: 'expense', title: 'Secret', amount: 5, date: T(), account: acc, category: cat(cats, 'expense', 'Food') })).data.transaction.id;
  const goal = (await a.post('/savings/goals', { title: 'Mine', targetAmount: 1000 })).data.goal.id;

  assert.equal((await b.get('/accounts')).data.accounts.length, 0);
  assert.equal((await b.get('/transactions')).data.items.length, 0);
  assert.equal((await b.get(`/transactions/${t}`)).status, 404);
  assert.equal((await b.put(`/transactions/${t}`, { type: 'expense', title: 'x', amount: 1, date: T(), account: acc, category: cat(bCats, 'expense', 'Food') })).status, 404);
  assert.equal((await b.del(`/transactions/${t}`)).status, 404);
  assert.equal((await b.put(`/accounts/${acc}`, { name: 'Hacked', type: 'bank' })).status, 404);
  assert.equal((await b.del(`/accounts/${acc}`)).status, 404);
  assert.equal((await b.del(`/savings/goals/${goal}`)).status, 404);
  assert.equal((await b.post('/transactions', { type: 'income', title: 'x', amount: 1, date: T(), account: acc, category: cat(bCats, 'income', 'Gift') })).status, 400, "cannot post into someone else's account");
  assert.equal((await b.post('/transactions', { type: 'transfer', amount: 1, date: T(), account: acc, toAccount: acc2 })).status, 400);
  assert.equal((await b.post('/transactions', { type: 'expense', title: 'x', amount: 1, date: T(), account: (await b.post('/accounts', { name: 'B1', type: 'cash' })).data.account.id, category: cat(cats, 'expense', 'Food') })).status, 400, "cannot use someone else's category");
  assert.equal((await b.get('/dashboard')).data.totals.totalBalance, 0);
  assert.equal((await b.get('/savings')).data.goals.length, 0);
  const exp = (await b.get('/data/export.json')).data;
  assert.equal(exp.transactions.length, 0); assert.ok(!JSON.stringify(exp).includes('Private'));
  // and A still has everything intact
  assert.equal((await a.get('/accounts')).data.accounts.find((x) => x.id === acc).balance, 772);
});

test('budget: daily/monthly progress uses real expenses and warns at 80% / exceeded at 100%+', async () => {
  const acc = (await a.post('/accounts', { name: 'BudgetAcc', type: 'cash', openingBalance: 100000 })).data.account.id;
  let p = (await a.get('/budget')).data;
  assert.equal(p.daily.status, 'unset'); assert.equal(p.daily.remaining, null);
  assert.equal((await a.put('/budget', { dailyLimit: -5 })).status, 400);
  assert.equal((await a.put('/budget', { dailyLimit: 'abc' })).status, 400);
  p = (await a.put('/budget', { dailyLimit: 1000, monthlyLimit: 30000, savingsTarget: 5000 })).data;
  const before = p.daily.spent;
  const spend = (n) => a.post('/transactions', { type: 'expense', title: 'b', amount: n, date: T(), account: acc, category: cat(cats, 'expense', 'Food') });
  await spend(500 - before + 0); // bring today's spend to exactly 500
  p = (await a.get('/budget')).data;
  assert.equal(p.daily.spent, 500); assert.equal(p.daily.remaining, 500); assert.equal(p.daily.pct, 50); assert.equal(p.daily.status, 'ok');
  await spend(350); p = (await a.get('/budget')).data;
  assert.equal(p.daily.status, 'warning'); assert.equal(p.daily.remaining, 150);
  await spend(200); p = (await a.get('/budget')).data;
  assert.equal(p.daily.status, 'exceeded'); assert.equal(p.daily.remaining, -50);
  // an old expense counts toward the month (if same month) but never toward today
  const old = D.addDays(T(), -1);
  await a.post('/transactions', { type: 'expense', title: 'old', amount: 999, date: old, account: acc, category: cat(cats, 'expense', 'Food') });
  assert.equal((await a.get('/budget')).data.daily.spent, 1050);
  // clearing a limit
  p = (await a.put('/budget', { dailyLimit: null, monthlyLimit: 30000, savingsTarget: 5000 })).data;
  assert.equal(p.daily.status, 'unset');
  // deleting an expense lowers the spend
  const t = (await spend(40)).data.transaction.id; const s1 = (await a.get('/budget')).data.monthly.spent;
  await a.del(`/transactions/${t}`);
  assert.equal(Math.round(((await a.get('/budget')).data.monthly.spent - s1) * 100) / 100, -40);
});

test('savings: transfer into a savings account is saving (not income); goals show real progress', async () => {
  const bank = (await a.post('/accounts', { name: 'SavBank', type: 'bank', openingBalance: 20000 })).data.account.id;
  const sav = (await a.post('/accounts', { name: 'My Savings', type: 'savings', openingBalance: 0 })).data.account.id;
  const incBefore = (await a.get('/dashboard')).data.month.income;
  const tr = await a.post('/transactions', { type: 'transfer', title: 'Move to savings', source: 'Daraz profit', amount: 5000, date: T(), account: bank, toAccount: sav });
  assert.equal(tr.status, 201); assert.equal(tr.data.transaction.source, 'Daraz profit');
  const s = (await a.get('/savings')).data;
  assert.equal(s.totalSavings, 5000); assert.equal(s.month.contributed, 5000); assert.equal(s.month.net, 5000);
  assert.equal((await a.get('/dashboard')).data.month.income, incBefore, 'savings transfer is not income');
  assert.equal((await a.get('/dashboard')).data.totals.savings, 5000);
  assert.equal((await a.get('/budget')).data.savings.saved, 5000);
  assert.equal((await a.get('/budget')).data.savings.status, 'done');

  assert.equal((await a.post('/savings/goals', { title: 'G', targetAmount: 0 })).status, 400);
  assert.equal((await a.post('/savings/goals', { title: 'G', targetAmount: 100, account: bank })).status, 400, 'goal must link to a savings account');
  const g = (await a.post('/savings/goals', { title: 'Laptop', targetAmount: 20000, targetDate: D.addDays(T(), 90), account: sav })).data.goal;
  const g2 = (await a.post('/savings/goals', { title: 'Reached', targetAmount: 1000 })).data.goal;
  const ov = (await a.get('/savings')).data;
  const pg = ov.goals.find((x) => x.id === g.id);
  assert.equal(pg.current, 5000); assert.equal(pg.pct, 25); assert.equal(pg.remaining, 15000); assert.equal(pg.reached, false);
  assert.ok(pg.monthlyNeeded > 0 && pg.daysLeft === 90);
  assert.equal(ov.goals.find((x) => x.id === g2.id).reached, true);
  assert.equal(ov.goals.find((x) => x.id === g2.id).pct, 100);
  // withdrawal from savings reduces net saving
  await a.post('/transactions', { type: 'transfer', amount: 1000, date: T(), account: sav, toAccount: bank });
  assert.equal((await a.get('/savings')).data.month.net, 4000);
  assert.equal((await a.put(`/savings/goals/${g.id}`, { title: 'Laptop 2', targetAmount: 40000, account: sav })).data.goal.title, 'Laptop 2');
  assert.equal((await a.del(`/savings/goals/${g2.id}`)).status, 200);
});

test('analytics: ranges, summary, series, categories, distribution — all from real data, transfers excluded', async () => {
  const { User, Transaction } = ctx.models; void User;
  await Transaction.deleteMany({}); await ctx.models.Account.deleteMany({});
  const acc = (await a.post('/accounts', { name: 'AnA', type: 'bank', openingBalance: 1000 })).data.account.id;
  const acc2 = (await a.post('/accounts', { name: 'AnB', type: 'cash', openingBalance: 500 })).data.account.id;
  const add = (type, amount, daysAgo, category, extra = {}) => a.post('/transactions', { type, title: 't', amount, date: D.addDays(T(), -daysAgo), account: acc, category, ...extra });
  await add('expense', 100, 0, cat(cats, 'expense', 'Food'));
  await add('expense', 300, 0, cat(cats, 'expense', 'Bills'));
  await add('expense', 50, 3, cat(cats, 'expense', 'Food'));
  await add('expense', 70, 20, cat(cats, 'expense', 'Transport'));
  await add('income', 1000, 2, cat(cats, 'income', 'Coding'));
  await add('expense', 999, 45, cat(cats, 'expense', 'Food')); // outside 30d
  await a.post('/transactions', { type: 'transfer', amount: 200, date: T(), account: acc, toAccount: acc2 });

  const get = async (qs) => (await a.get(`/analytics?${qs}`)).data;
  let r = await get('range=today');
  assert.equal(r.summary.expense, 400); assert.equal(r.summary.income, 0); assert.equal(r.summary.net, -400);
  assert.equal(r.categories.items[0].name, 'Bills'); assert.equal(r.categories.items[0].pct, 75);
  assert.equal(r.daily.buckets.length, 1);

  r = await get('range=7d');
  assert.equal(r.summary.expense, 450); assert.equal(r.summary.income, 1000); assert.equal(r.daily.buckets.length, 7);
  assert.equal(r.daily.buckets.reduce((s, x) => s + x.expense, 0), 450);

  r = await get('range=30d');
  assert.equal(r.summary.expense, 520); assert.equal(r.summary.avgDailyExpense, Math.round(520 / 30 * 100) / 100);
  assert.equal(r.summary.topCategory.name, 'Bills'); assert.equal(r.summary.largestExpense.amount, 300);
  assert.equal(r.daily.buckets.length, 30);
  assert.equal(r.monthly.buckets.reduce((s, x) => s + x.expense, 0), 520);
  assert.equal(r.weekly.buckets.reduce((s, x) => s + x.expense, 0), 520);
  assert.equal(r.categories.total, 520);
  assert.equal(r.summary.previous.expense, 999, 'previous 30-day window');
  assert.equal(r.summary.expenseChangePct, Math.round(((520 - 999) / 999) * 1000) / 10);

  const custom = await get(`range=custom&from=${D.addDays(T(), -50)}&to=${D.addDays(T(), -40)}`);
  assert.equal(custom.summary.expense, 999);
  r = await get('range=this_month'); assert.equal(r.range.from, D.startOfMonth(T()));
  r = await get('range=last_month'); assert.equal(r.range.to, D.endOfMonth(D.addMonths(T(), -1)));

  assert.equal((await a.get('/analytics?range=custom&from=2026-05-01')).status, 400);
  assert.equal((await a.get('/analytics?range=custom&from=2026-05-10&to=2026-05-01')).status, 400);
  assert.equal((await a.get('/analytics?range=forever')).status, 400);
  assert.equal((await a.get('/analytics?range=custom&from=2000-01-01&to=2026-01-01')).status, 400);

  const dist = r.accounts;
  assert.equal(dist.items.length, 2);
  assert.equal(dist.total, dist.items.reduce((s, x) => s + x.balance, 0));
});

test('dashboard: totals match accounts, budget and recent activity', async () => {
  const d = (await a.get('/dashboard')).data;
  const accs = (await a.get('/accounts')).data.accounts;
  assert.equal(d.totals.totalBalance, Math.round(accs.reduce((s, x) => s + x.balance, 0) * 100) / 100);
  assert.equal(d.last7.length, 7); assert.ok(d.recent.length <= 6);
  assert.equal(d.hasTransactions, true);
});

test('settings persist and are validated; categories can be added and removed', async () => {
  assert.equal((await a.put('/me/settings', { theme: 'neon' })).status, 400);
  assert.equal((await a.put('/me/settings', { currency: 'XYZ' })).status, 400);
  assert.equal((await a.put('/me/settings', { timezone: 'Mars/Base' })).status, 400);
  assert.equal((await a.put('/me/settings', { autoLockMinutes: 3 })).status, 400);
  assert.equal((await a.put('/me/settings', { theme: 'light', currency: 'USD', autoLockMinutes: 15 })).status, 200);
  const s = (await a.get('/bootstrap')).data.user.settings;
  assert.equal(s.theme, 'light'); assert.equal(s.currency, 'USD'); assert.equal(s.autoLockMinutes, 15); assert.equal(s.timezone, 'Asia/Karachi');
  await a.put('/me/settings', { theme: 'dark', currency: 'PKR', autoLockMinutes: 5 });

  const c1 = (await a.post('/categories', { name: 'Gym', type: 'expense', icon: 'dumbbell', color: '#22D3EE' })).data.category;
  assert.equal((await a.post('/categories', { name: 'gym', type: 'expense' })).status, 409);
  assert.equal((await a.del(`/categories/${c1.id}`)).data.deleted, true);
  const food = cat(cats, 'expense', 'Food');
  assert.equal((await a.del(`/categories/${food}`)).data.archived, true, 'used categories are archived, not erased');
  assert.ok(!(await a.get('/categories')).data.categories.some((x) => x.id === food));
  assert.equal((await a.post('/categories', { name: 'Food', type: 'expense' })).status, 201, 're-adding an archived name revives it');
});

test('export: JSON backup has no secrets; CSV neutralises spreadsheet formulas', async () => {
  const acc = (await a.post('/accounts', { name: 'Exp', type: 'cash', openingBalance: 10 })).data.account.id;
  await a.post('/transactions', { type: 'expense', title: '=HYPERLINK("http://evil")', amount: 5, date: T(), account: acc, category: cat((await a.get('/categories')).data.categories, 'expense', 'Other'), notes: 'a, "quoted"' });
  const j = (await a.get('/data/export.json')).data;
  assert.equal(j.app, 'Grow More'); assert.ok(j.accounts.length && j.transactions.length);
  assert.ok(!/pinHash|tokenVersion|\$2[aby]\$/.test(JSON.stringify(j)));
  const res = await a.req('GET', '/data/transactions.csv', undefined, { raw: true });
  assert.match(res.headers.get('content-type'), /text\/csv/); assert.match(res.headers.get('content-disposition'), /attachment/);
  const csv = await res.text();
  assert.ok(csv.includes(`'=HYPERLINK`) && !csv.includes(',=HYPERLINK'));
  assert.ok(csv.includes('"a, ""quoted"""'));
});
