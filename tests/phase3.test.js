const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../utils/dates');

let ctx, c, b, bank, wallet, btc;
const T = () => H.today();
const bal = async (id) => (await c.get('/accounts')).data.accounts.find((a) => a.id === id)?.balance;
const mkAcc = async (name, type = 'bank', openingBalance = 0) => (await c.post('/accounts', { name, type, openingBalance })).data.account.id;
const trade = (body) => c.post('/trading/trades', { date: T(), ...body });
const buy = (asset, quantity, price, account, extra = {}) => trade({ type: 'buy', asset, quantity, price, account, ...extra });
const sell = (asset, quantity, price, account, extra = {}) => trade({ type: 'sell', asset, quantity, price, account, ...extra });
const asset = async (name, extra = {}) => (await c.post('/trading/assets', { name, symbol: name.slice(0, 3), type: 'crypto', ...extra })).data.asset;
const tsum = async (qs = '') => (await c.get(`/trading/summary${qs}`)).data;

test.before(async () => {
  ctx = await H.boot('growmore_t_phase3');
  await H.createOwner('1234'); c = await H.signedIn(ctx.base, '1234');
  const { User } = ctx.models; const jwt = require('jsonwebtoken'); const env = require('../config/env');
  const u2 = await User.create({ pinHash: 'x', displayName: 'Other' });
  b = new H.Client(ctx.base); b.cookie = 'gm_token=' + jwt.sign({ sub: String(u2._id), tv: 0, st: Math.floor(Date.now() / 1000) }, env.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
  bank = await mkAcc('Meezan', 'bank', 10_000_000); wallet = await mkAcc('Easypaisa', 'mobile_wallet', 0);
});
test.after(() => ctx.stop());

/* ================================ TRADING ================================ */
test('trading: buy 0.5 BTC for Rs 10M (fee 500), sell 0.2 at Rs 12M (fee 300) → balances, P/L 399,500 and 19.98% return', async () => {
  btc = await asset('Bitcoin', { symbol: 'btc' });
  assert.equal(btc.symbol, 'BTC');
  assert.equal((await buy(btc.id, 0.5, 10_000_000, bank, { fee: 500 })).status, 201);
  assert.equal(await bal(bank), 10_000_000 - 5_000_500);
  const s = await sell(btc.id, 0.2, 12_000_000, wallet, { fee: 300, date: T() });
  assert.equal(s.status, 201); assert.equal(await bal(wallet), 2_399_700, 'proceeds minus the sell fee land in the receiving account');
  const list = (await c.get(`/trading/trades?asset=${btc.id}`)).data.items; const sale = list.find((x) => x.type === 'sell');
  assert.equal(sale.calc.net, 399_500); assert.equal(sale.calc.returnPct, 19.98); assert.equal(sale.calc.purchaseCost, 2_000_000);
  const a = (await c.get('/trading/assets')).data.assets[0].stats;
  assert.equal(a.qty, 0.3); assert.equal(a.costBasis, 3_000_300); assert.equal(a.realized, 399_500);
});

test('trading: manual price drives portfolio value and unrealised P/L; unpriced holdings are valued at cost', async () => {
  let s = await tsum(); assert.equal(s.portfolio.value, 3_000_300); assert.equal(s.portfolio.unpriced, 1); assert.equal(s.portfolio.unrealized, 0);
  const r = await c.put(`/trading/assets/${btc.id}/price`, { price: 11_000_000 }); assert.equal(r.status, 200);
  s = await tsum(); assert.equal(s.portfolio.value, 3_300_000); assert.equal(s.portfolio.unrealized, 299_700); assert.equal(s.portfolio.unpriced, 0);
  assert.equal(s.realized, 399_500); assert.equal(s.fees, 800); assert.equal(s.wins, 1); assert.equal(s.winRate, 100);
  assert.equal(s.allocation[0].pct, 100); assert.equal(s.realizedByMonth.length, 12); assert.equal(s.realizedByMonth.at(-1).net, 399_500);
  assert.equal((await c.get('/dashboard')).data.portfolio.value, 3_300_000);
  assert.equal((await c.put(`/trading/assets/${btc.id}/price`, { price: -5 })).status, 400);
});

test('trading money is a capital movement: it never counts as income, expense, or personal budget', async () => {
  const sc = async (scope) => (await c.get(`/analytics?range=today&scope=${scope}`)).data.summary;
  const all = await sc('all'); assert.equal(all.expense, 0); assert.equal(all.income, 0, 'neither the buy nor the sale is income/expense');
  const d = (await c.get('/dashboard')).data; assert.equal(d.month.expense, 0); assert.equal(d.month.income, 0);
  assert.equal((await c.get('/budget')).data.daily.spent, 0);
  const tx = (await c.get('/transactions?scope=trading')).data.items; assert.equal(tx.length, 2); assert.ok(tx.every((x) => x.module === 'trading'));
  assert.equal((await c.get('/transactions?scope=business')).data.items.filter((x) => x.module === 'trading').length, 0);
  const put = await c.put(`/transactions/${tx[0].id}`, { type: tx[0].type, title: 'x', amount: 1, date: T(), account: tx[0].account, category: tx[0].category });
  assert.equal(put.status, 409); assert.equal(put.data.module, 'trading'); assert.match(put.data.error, /Trading/);
  assert.equal((await c.del(`/transactions/${tx[0].id}`)).status, 409);
});

test('trading: you cannot sell more than you hold; failed attempts change nothing', async () => {
  const before = [await bal(wallet), (await c.get('/trading/assets')).data.assets[0].stats.qty];
  const r = await sell(btc.id, 1, 12_000_000, wallet); assert.equal(r.status, 409); assert.equal(r.data.code, 'INSUFFICIENT_HOLDING'); assert.equal(r.data.available, 0.3);
  assert.deepEqual([await bal(wallet), (await c.get('/trading/assets')).data.assets[0].stats.qty], before);
  assert.equal((await sell(btc.id, 0.1, 12_000_000, wallet, { date: D.addDays(T(), -30) })).status, 409, 'cannot sell before you bought');
  const buyTrade = (await c.get(`/trading/trades?asset=${btc.id}&type=buy`)).data.items[0];
  assert.equal((await c.del(`/trading/trades/${buyTrade.id}`)).status, 409, 'cannot delete a buy that a sale depends on');
  assert.equal((await c.put(`/trading/trades/${buyTrade.id}`, { type: 'buy', asset: btc.id, quantity: 0.1, price: 1, date: buyTrade.date, account: bank })).status, 409);
});

test('trading: edit re-prices profit and fixes balances; delete reverses; restore re-applies; no-account trades touch no balance', async () => {
  const eth = await asset('Ethereum', { symbol: 'ETH' });
  const b1 = (await buy(eth.id, 2, 500_000, bank, { date: D.addDays(T(), -5) })).data.trade; const bb = await bal(bank);
  const s1 = (await sell(eth.id, 1, 600_000, wallet, { fee: 100, date: D.addDays(T(), -2) })).data.trade; const wb = await bal(wallet);
  const edit = await c.put(`/trading/trades/${s1.id}`, { type: 'sell', asset: eth.id, quantity: 1, price: 700_000, fee: 100, date: s1.date, account: wallet });
  assert.equal(edit.status, 200); assert.equal(await bal(wallet), wb + 100_000);
  assert.equal((await c.get(`/trading/trades?asset=${eth.id}&type=sell`)).data.items[0].calc.net, 200_000 - 100);
  assert.equal((await c.del(`/trading/trades/${s1.id}`)).status, 200); assert.equal(await bal(wallet), wb - 599_900);
  assert.equal((await c.get('/trading/assets')).data.assets.find((a) => a.id === eth.id).stats.qty, 2);
  assert.equal((await c.post(`/trading/trades/${s1.id}/restore`)).status, 200); assert.equal(await bal(wallet), wb + 100_000);
  const sol = await asset('Solana', { symbol: 'SOL' }); const bb2 = await bal(bank);
  assert.equal((await buy(sol.id, 5, 30_000, null)).status, 201); assert.equal(await bal(bank), bb2, 'existing holding: no account, no balance change');
  assert.equal((await sell(sol.id, 1, 40_000, null)).status, 201); assert.equal(await bal(bank), bb2);
  void b1; void bb;
});

test('trading: validation and asset rules', async () => {
  const bad = async (body, why) => assert.equal((await trade({ asset: btc.id, type: 'buy', quantity: 1, price: 1, ...body })).status, 400, why);
  await bad({ quantity: 0 }, 'zero qty'); await bad({ quantity: -1 }, 'negative'); await bad({ quantity: 0.123456789 }, '9 decimals'); await bad({ price: -5 }, 'negative price');
  await bad({ fee: 1.234 }, 'fee decimals'); await bad({ date: D.addDays(T(), 30) }, 'future date'); await bad({ asset: 'nope' }, 'bad id'); await bad({ type: 'swap' }, 'type');
  assert.equal((await trade({ type: 'buy', asset: btc.id, quantity: 0.00000001, price: 1_000_000, account: bank })).status, 201, '1 satoshi is fine');
  assert.equal((await c.post('/trading/assets', { name: 'bitcoin' })).status, 409, 'unique name');
  assert.equal((await c.post('/trading/assets', { name: '' })).status, 400); assert.equal((await c.post('/trading/assets', { name: 'X', type: 'forex' })).status, 400);
  const unused = await asset('Unused'); assert.deepEqual((await c.del(`/trading/assets/${unused.id}`)).data, { deleted: true, archived: false });
  const r = await c.del(`/trading/assets/${btc.id}`); assert.equal(r.status, 409); assert.equal(r.data.code, 'HAS_HOLDING');
  const doge = await asset('Dogecoin'); await buy(doge.id, 100, 50, null); await sell(doge.id, 100, 60, null);
  assert.deepEqual((await c.del(`/trading/assets/${doge.id}`)).data, { deleted: false, archived: true });
  assert.equal((await buy(doge.id, 1, 1, null)).status, 404, 'archived asset takes no new trades');
  assert.equal((await c.post(`/trading/assets/${doge.id}/restore`)).status, 200);
  assert.equal((await c.get('/trading/summary?range=custom&from=2026-05-01')).status, 400);
});

test('trading: LEDGER INTEGRITY — every account-linked trade has exactly one matching ledger transaction', async () => {
  const { Transaction, TradingTransaction } = ctx.models; const owner = (await ctx.models.User.findOne().sort({ createdAt: 1 }))._id;
  const [tr, tx] = await Promise.all([TradingTransaction.find({ user: owner, deletedAt: null, account: { $ne: null } }).lean(), Transaction.find({ user: owner, deletedAt: null, module: 'trading' }).lean()]);
  assert.equal(tx.length, tr.length);
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const t of tr) { const x = tx.find((y) => String(y.moduleRef) === String(t._id)); assert.ok(x); assert.equal(x.type, t.type === 'buy' ? 'expense' : 'income'); assert.equal(x.amount, r2(t.type === 'buy' ? t.quantity * t.price + t.fee : t.quantity * t.price - t.fee)); }
});

/* ================================ NOTES ================================ */
test('notes: create/edit/get; hostile HTML is sanitised before it is stored; lists send previews only', async () => {
  const hostile = '<p onclick="steal()">Plan <b>big</b></p><script>alert(1)</script><img src=x onerror=alert(2)><ul><li>one</li><li>two</li></ul>';
  const r = await c.post('/notes', { title: 'Ideas', body: hostile, category: 'Work' });
  assert.equal(r.status, 201); assert.equal(r.data.note.body, '<p>Plan <strong>big</strong></p><ul><li>one</li><li>two</li></ul>');
  assert.ok(!/script|onerror|onclick/.test(JSON.stringify(r.data.note)));
  const id = r.data.note.id;
  assert.equal((await c.get(`/notes/${id}`)).data.note.body, r.data.note.body);
  const list = (await c.get('/notes')).data; assert.ok(!('body' in list.items[0])); assert.match(list.items[0].preview, /Plan big one two/);
  const up = await c.put(`/notes/${id}`, { title: 'Ideas v2', body: '<p>New</p>', category: 'Work' }); assert.equal(up.data.note.title, 'Ideas v2'); assert.equal(up.data.note.text, 'New');
  assert.equal((await c.post('/notes', { title: '', body: '<p>  </p>' })).status, 400, 'empty note rejected');
  assert.equal((await c.post('/notes', { title: 'x', body: { a: 1 } })).status, 400);
  assert.equal((await c.post('/notes', { title: 'x'.repeat(200) })).status, 400);
});

test('notes: search, category (case-insensitive), pin ordering without touching the edit date, date filters, delete/restore', async () => {
  const mk = (title, body, category = '') => c.post('/notes', { title, body, category }).then((r) => r.data.note);
  const n1 = await mk('Groceries', '<p>milk eggs</p>', 'Home'); const n2 = await mk('Daraz restock', '<p>order cables</p>', 'Business'); await mk('Random', '<p>zzz</p>');
  const q = async (qs) => (await c.get(`/notes?${qs}`)).data;
  assert.equal((await q('q=eggs')).items.length, 1); assert.equal((await q('q=CABLES')).items[0].title, 'Daraz restock'); assert.equal((await q(`q=${encodeURIComponent('.*')}`)).items.length, 0);
  assert.equal((await q('category=home')).items.length, 1); assert.ok((await q('')).categories.includes('Business'));
  const before = (await c.get(`/notes/${n1.id}`)).data.note.updatedAt;
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await c.put(`/notes/${n1.id}/pin`, { pinned: true })).data.note.pinned, true);
  assert.equal((await c.get(`/notes/${n1.id}`)).data.note.updatedAt, before, 'pinning is not an edit');
  assert.equal((await q('')).items[0].id, n1.id, 'pinned notes come first'); assert.equal((await q('pinned=true')).items.length, 1);
  assert.equal((await q(`from=${T()}&to=${T()}`)).items.length >= 3, true, 'notes edited today match today');
  assert.equal((await q(`from=${D.addDays(T(), 2)}`)).items.length, 0);
  assert.equal((await c.get('/notes?from=2026-05-10&to=2026-05-01')).status, 400);
  assert.equal((await c.del(`/notes/${n2.id}`)).status, 200); assert.equal((await q('q=cables')).items.length, 0); assert.equal((await c.get(`/notes/${n2.id}`)).status, 404);
  assert.equal((await c.post(`/notes/${n2.id}/restore`)).status, 200); assert.equal((await q('q=cables')).items.length, 1);
});

/* ================================ TO-DO ================================ */
test('to-do: create, order (overdue → soonest → undated), counts, complete/uncomplete, filters, edit, delete/restore', async () => {
  const mk = (title, dueDate, description = '') => c.post('/todos', { title, dueDate, description }).then((r) => r.data.todo);
  const none = await mk('Someday'); const later = await mk('Next week', D.addDays(T(), 7)); const today = await mk('Today task', T()); const over = await mk('Overdue task', D.addDays(T(), -2), 'late!');
  let l = (await c.get('/todos')).data;
  assert.deepEqual(l.items.map((x) => x.title), ['Overdue task', 'Today task', 'Next week', 'Someday']);
  assert.equal(l.items[0].overdue, true); assert.equal(l.items[1].dueToday, true);
  assert.deepEqual(l.counts, { pending: 4, completed: 0, overdue: 1, dueToday: 1 });
  const done = await c.put(`/todos/${over.id}/complete`, { completed: true }); assert.equal(done.data.todo.completed, true); assert.ok(done.data.todo.completedAt);
  l = (await c.get('/todos?status=completed')).data; assert.deepEqual(l.items.map((x) => x.title), ['Overdue task']); assert.equal(l.items[0].overdue, false);
  assert.equal((await c.get('/todos')).data.counts.overdue, 0); assert.equal((await c.get('/todos?status=all')).data.items.length, 4);
  assert.equal((await c.put(`/todos/${over.id}/complete`, { completed: false })).data.todo.completedAt, null);
  assert.equal((await c.get('/todos?q=week')).data.items[0].id, later.id);
  assert.equal((await c.put(`/todos/${none.id}`, { title: 'Someday soon', dueDate: D.addDays(T(), 1) })).data.todo.dueDate, D.addDays(T(), 1));
  assert.equal((await c.del(`/todos/${today.id}`)).status, 200); assert.equal((await c.get('/todos')).data.counts.pending, 3);
  assert.equal((await c.post(`/todos/${today.id}/restore`)).status, 200); assert.equal((await c.get('/todos')).data.counts.pending, 4);
  assert.equal((await c.post('/todos', { title: '' })).status, 400); assert.equal((await c.post('/todos', { title: 'x', dueDate: '2026-02-30' })).status, 400);
  assert.equal((await c.get('/todos?status=bogus')).status, 400); assert.equal((await c.get('/dashboard')).data.tasks.pending, 4);
});

/* ================================ SAVINGS (advanced) ================================ */
test('savings: where money came from, history with direction, 12-month trend and savings rate', async () => {
  const cat = (await c.get('/categories')).data.categories.find((x) => x.type === 'income' && x.name === 'Coding').id;
  const src = await mkAcc('Daily', 'bank', 100000); const sav = await mkAcc('Rainy day', 'savings', 0); const sav2 = await mkAcc('Eid fund', 'savings', 0);
  await c.post('/transactions', { type: 'income', title: 'Job', amount: 50000, date: T(), account: src, category: cat });
  const tr = (amount, source, from, to, extra = {}) => c.post('/transactions', { type: 'transfer', amount, source, date: T(), account: from, toAccount: to, ...extra });
  await tr(5000, 'Daraz profit', src, sav); await tr(10000, 'Coding income', src, sav); await tr(2000, 'Personal income', src, sav); await tr(1500, '', src, sav2);
  await tr(500, 'x', sav, sav2); await tr(1000, 'Emergency', sav, src);
  const s = (await c.get('/savings/sources')).data;
  assert.equal(s.total, 18500); assert.equal(s.withdrawn, 1000, 'internal moves between savings accounts are neither saved nor withdrawn');
  assert.deepEqual(s.items.map((x) => [x.source, x.amount]), [['Coding income', 10000], ['Daraz profit', 5000], ['Personal income', 2000], ['Unspecified', 1500]]);
  assert.equal(s.items[0].pct, Math.round((10000 / 18500) * 1000) / 10);
  const h = (await c.get('/savings/history')).data; assert.equal(h.items.length, 6);
  assert.deepEqual(h.items.map((x) => x.direction).sort(), ['in', 'in', 'in', 'in', 'internal', 'out']);
  assert.equal((await c.get('/savings/history?source=Daraz%20profit')).data.items.length, 1); assert.equal((await c.get('/savings/history?source=Unspecified')).data.items.length, 1);
  const t = (await c.get('/savings/trend')).data; assert.equal(t.buckets.length, 12); const cur = t.buckets.at(-1);
  assert.equal(cur.saved, 18500); assert.equal(cur.withdrawn, 1000); assert.equal(cur.net, 17500); assert.ok(cur.rate > 0);
  assert.equal(t.totalSaved, 18500);
  assert.equal((await c.get('/savings/history?from=2026-05-10&to=2026-05-01')).status, 400);
});

/* ================================ INSIGHTS ================================ */
test('insights: net worth matches your real balances; weekday totals add up; top expenses sorted; forecast; monthly', async () => {
  const cats = (await c.get('/categories')).data.categories; const food = cats.find((x) => x.type === 'expense' && x.name === 'Food').id;
  const acc = (await c.get('/accounts')).data.accounts.find((a) => a.name === 'Daily').id;
  for (const [amt, ago] of [[900, 0], [4000, 3], [250, 5], [1200, 9]]) await c.post('/transactions', { type: 'expense', title: `Spend ${amt}`, amount: amt, date: D.addDays(T(), -ago), account: acc, category: food });
  const i = (await c.get('/analytics/insights?range=30d')).data;
  const total = (await c.get('/accounts')).data.accounts.reduce((s, a) => s + a.balance, 0);
  assert.equal(i.netWorth.series.length, 12); assert.equal(i.netWorth.current.balance, Math.round(total * 100) / 100, 'accounts part = sum of balances');
  const pf = (await c.get('/trading/summary')).data.portfolio; assert.equal(i.netWorth.current.investments, pf.costBasis, 'investments part = cost of what you hold');
  assert.equal(i.netWorth.current.total, Math.round((total + pf.costBasis) * 100) / 100, 'buying an asset never looks like losing the money');
  assert.ok(i.netWorth.series.every((x) => x.total === Math.round((x.balance + x.investments) * 100) / 100));
  const sum30 = (await c.get('/analytics?range=30d')).data.summary.expense;
  assert.equal(Math.round(i.weekday.reduce((s, w) => s + w.total, 0) * 100) / 100, sum30); assert.equal(i.weekday.length, 7);
  assert.ok(i.topExpenses.length >= 4); assert.deepEqual(i.topExpenses.map((x) => x.amount), [...i.topExpenses.map((x) => x.amount)].sort((a, z) => z - a)); assert.ok(i.topExpenses.every((x) => x.module !== 'trading'));
  assert.ok(i.forecast.projected >= i.forecast.spent); assert.equal(i.forecast.daysInMonth >= 28, true); assert.ok(['ok', 'close', 'over', 'unset'].includes(i.forecast.status));
  assert.equal(i.monthly.length, 12); assert.equal(i.monthly.at(-1).net, Math.round((i.monthly.at(-1).income - i.monthly.at(-1).expense) * 100) / 100);
  assert.equal((await c.get('/analytics/insights?scope=nope')).status, 400); assert.equal((await c.get('/analytics/insights?range=custom&from=2026-05-01')).status, 400);
  await c.put('/budget', { monthlyLimit: 1000 }); assert.equal((await c.get('/analytics/insights')).data.forecast.status, 'over');
});

test('net worth: moving money into an investment does not change it (balances fall, investments rise by the same amount)', async () => {
  const nw = async () => (await c.get('/analytics/insights')).data.netWorth.current;
  const acc = (await c.get('/accounts')).data.accounts.find((a) => a.name === 'Daily').id; const a = await asset('Litecoin', { symbol: 'LTC' });
  const before = await nw();
  assert.equal((await buy(a.id, 10, 5000, acc, { fee: 50 })).status, 201);
  const after = await nw();
  assert.equal(after.total, before.total, 'total unchanged'); assert.equal(Math.round((before.balance - after.balance) * 100) / 100, 50050); assert.equal(Math.round((after.investments - before.investments) * 100) / 100, 50050);
  assert.equal((await sell(a.id, 10, 6000, acc)).status, 201);
  const sold = await nw(); assert.equal(Math.round((sold.total - before.total) * 100) / 100, 9950, 'only the real profit (60,000 − 50,050) changes net worth');
});

/* ================================ SECURITY / DATA ================================ */
test('phase-3 endpoints require sign-in and never leak between users', async () => {
  const anon = new H.Client(ctx.base);
  for (const p of ['/trading/summary', '/trading/assets', '/trading/trades', '/notes', '/todos', '/savings/sources', '/savings/history', '/savings/trend', '/analytics/insights']) assert.equal((await anon.get(p)).status, 401, p);
  const note = (await c.get('/notes')).data.items[0]; const todo = (await c.get('/todos')).data.items[0];
  assert.equal((await b.get('/notes')).data.items.length, 0); assert.equal((await b.get('/todos')).data.items.length, 0); assert.equal((await b.get('/trading/assets')).data.assets.length, 0);
  assert.equal((await b.get(`/notes/${note.id}`)).status, 404); assert.equal((await b.del(`/notes/${note.id}`)).status, 404); assert.equal((await b.put(`/notes/${note.id}/pin`, { pinned: true })).status, 404);
  assert.equal((await b.put(`/todos/${todo.id}/complete`, { completed: true })).status, 404); assert.equal((await b.del(`/todos/${todo.id}`)).status, 404);
  assert.equal((await b.put(`/trading/assets/${btc.id}/price`, { price: 1 })).status, 404);
  assert.equal((await b.post('/trading/trades', { type: 'buy', asset: btc.id, quantity: 1, price: 1, date: T(), account: bank })).status, 404);
  const bAcc = (await b.post('/accounts', { name: 'BAcc', type: 'cash' })).data.account.id; const bAsset = (await b.post('/trading/assets', { name: 'Mine' })).data.asset.id;
  assert.equal((await b.post('/trading/trades', { type: 'buy', asset: bAsset, quantity: 1, price: 1, date: T(), account: bank })).status, 400, "cannot use another user's account");
  assert.equal((await c.post('/trading/trades', { type: 'buy', asset: btc.id, quantity: 1, price: 1, date: T(), account: bAcc })).status, 400);
  assert.equal((await b.get('/savings/sources')).data.total, 0); assert.equal((await b.get('/analytics/insights')).data.netWorth.current.total, 0);
  const d = (await b.get('/dashboard')).data; assert.equal(d.portfolio.value, 0); assert.equal(d.tasks.pending, 0);
});

test('backup export now includes trading, notes and to-dos (and still no secrets)', async () => {
  const j = (await c.get('/data/export.json')).data;
  assert.equal(j.schemaVersion, 3); assert.ok(j.tradingAssets.length && j.tradingTrades.length && j.notes.length && j.todos.length);
  assert.ok(!/pinHash|\$2[aby]\$/.test(JSON.stringify(j)));
});
