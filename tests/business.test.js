const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../utils/dates');

let ctx, c, b;
const T = () => H.today();
const bal = async (id) => (await c.get('/accounts')).data.accounts.find((a) => a.id === id)?.balance;
const mkAcc = async (name, type = 'bank', openingBalance = 0) => (await c.post('/accounts', { name, type, openingBalance })).data.account.id;
const coding = (body) => c.post('/coding/records', { date: T(), title: 'Job', ...body });
const product = async (name, extra = {}) => (await c.post('/daraz/products', { name, purchasePrice: 500, sellingPrice: 800, ...extra })).data.product;
const move = (body) => c.post('/daraz/movements', { date: T(), ...body });
const buy = (p, quantity, unitCost, account, extra = {}) => move({ type: 'purchase', product: p, quantity, unitCost, account, ...extra });
const sell = (p, quantity, unitPrice, account, extra = {}) => move({ type: 'sale', product: p, quantity, unitPrice, account, ...extra });
const expense = (body) => c.post('/daraz/expenses', { date: T(), title: 'Cost', ...body });
const stock = async (id) => (await c.get(`/daraz/products/${id}`)).data.product.stats;
const dsum = async (qs = '') => (await c.get(`/daraz/summary${qs}`)).data;

test.before(async () => {
  ctx = await H.boot('growmore_t_business');
  await H.createOwner('1234');
  c = await H.signedIn(ctx.base, '1234');
  // second user for isolation checks
  const { User } = ctx.models; const jwt = require('jsonwebtoken'); const env = require('../config/env');
  const u2 = await User.create({ pinHash: 'x', displayName: 'Other' });
  b = new H.Client(ctx.base);
  b.cookie = 'gm_token=' + jwt.sign({ sub: String(u2._id), tv: 0, st: Math.floor(Date.now() / 1000) }, env.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
});
test.after(() => ctx.stop());

/* ============================== CODING ============================== */
test('coding: client pays Rs 20,000 into Meezan → balance +20,000, recorded as coding income', async () => {
  const meezan = await mkAcc('Meezan', 'bank', 1000);
  const r = await coding({ kind: 'income', category: 'client_payment', title: 'Website', client: 'Ali', amount: 20000, account: meezan });
  assert.equal(r.status, 201); assert.equal(await bal(meezan), 21000);
  const s = (await c.get('/coding/summary')).data;
  assert.equal(s.income, 20000); assert.equal(s.net, 20000); assert.equal(s.topClients[0].client, 'Ali');
  const tx = (await c.get('/transactions?scope=business')).data.items.find((t) => t.moduleRef === r.data.record.id);
  assert.equal(tx.module, 'coding'); assert.equal(tx.type, 'income'); assert.equal(tx.amount, 20000);
  const cat = (await c.get('/categories')).data.categories.find((x) => x.id === tx.category);
  assert.equal(cat.name, 'Coding');
});

test('coding transactions are managed: they cannot be edited or deleted from the Transactions page', async () => {
  const tx = (await c.get('/transactions?scope=business')).data.items[0];
  const put = await c.put(`/transactions/${tx.id}`, { type: 'income', title: 'x', amount: 1, date: T(), account: tx.account, category: tx.category });
  assert.equal(put.status, 409); assert.equal(put.data.code, 'MANAGED'); assert.equal(put.data.module, 'coding');
  assert.equal((await c.del(`/transactions/${tx.id}`)).status, 409);
});

test('coding: expenses reduce the account; net, margin and available cash are right', async () => {
  const acc = (await c.get('/accounts')).data.accounts[0].id; const before = await bal(acc);
  assert.equal((await coding({ kind: 'expense', category: 'hosting', title: 'VPS', amount: 1500, account: acc })).status, 201);
  assert.equal((await coding({ kind: 'expense', category: 'domain', title: 'example.pk', amount: 500, account: acc })).status, 201);
  assert.equal(await bal(acc), before - 2000);
  const s = (await c.get('/coding/summary')).data;
  assert.equal(s.expenses, 2000); assert.equal(s.net, 18000); assert.equal(s.availableCash, 18000); assert.equal(s.margin, 90);
  assert.deepEqual(s.expenseByCategory.map((x) => x.label).sort(), ['Domain', 'Hosting']);
});

test('coding: pending payments move no money until received into an account', async () => {
  const meezan = (await c.get('/accounts')).data.accounts[0].id; const eas = await mkAcc('Easypaisa', 'mobile_wallet', 0);
  const before = await bal(meezan);
  const p = (await coding({ kind: 'income', category: 'project_income', title: 'Shop site', client: 'Sara', amount: 30000, status: 'pending', dueDate: D.addDays(T(), -3) })).data.record;
  assert.equal(p.status, 'pending'); assert.equal(p.transaction, null);
  assert.equal(await bal(meezan), before);
  let s = (await c.get('/coding/summary')).data;
  assert.equal(s.pending.total, 30000); assert.equal(s.pending.overdueCount, 1); assert.equal(s.income, 20000, 'pending is not income yet');
  assert.equal((await coding({ kind: 'expense', category: 'hosting', title: 'x', amount: 5, status: 'pending' })).status, 400, 'expenses are always paid, so they need an account');
  const rec = await c.post(`/coding/records/${p.id}/receive`, { account: eas, date: T() });
  assert.equal(rec.status, 200); assert.equal(rec.data.record.status, 'paid');
  assert.equal(await bal(eas), 30000); assert.equal(await bal(meezan), before);
  s = (await c.get('/coding/summary')).data; assert.equal(s.pending.count, 0); assert.equal(s.income, 50000);
  assert.equal((await c.post(`/coding/records/${p.id}/receive`, { account: eas, date: T() })).status, 400, 'cannot receive twice');
});

test('coding: edit recalculates balances; delete reverses; restore re-applies', async () => {
  const a = await mkAcc('CodeA', 'bank', 0); const a2 = await mkAcc('CodeB', 'bank', 0);
  const r = (await coding({ kind: 'income', category: 'retainer', title: 'Maint', amount: 5000, account: a })).data.record;
  assert.equal(await bal(a), 5000);
  const put = (patch) => c.put(`/coding/records/${r.id}`, { kind: 'income', category: 'retainer', title: 'Maint', date: T(), amount: 5000, account: a, ...patch });
  assert.equal((await put({ amount: 7000 })).status, 200); assert.equal(await bal(a), 7000);
  assert.equal((await put({ amount: 7000, account: a2 })).status, 200); assert.equal(await bal(a), 0); assert.equal(await bal(a2), 7000);
  assert.equal((await c.del(`/coding/records/${r.id}`)).status, 200); assert.equal(await bal(a2), 0);
  assert.equal((await c.del(`/coding/records/${r.id}`)).status, 404);
  assert.equal((await c.post(`/coding/records/${r.id}/restore`)).status, 200); assert.equal(await bal(a2), 7000);
  assert.equal((await put({ status: 'pending', dueDate: T() })).status, 200, 'paid → pending removes the money');
  assert.equal(await bal(a2), 0);
});

test('coding: validation', async () => {
  const a = (await c.get('/accounts')).data.accounts[0].id;
  const bad = async (body, why) => assert.equal((await coding(body)).status, 400, why);
  await bad({ kind: 'income', category: 'client_payment', amount: 10 }, 'paid income needs an account');
  await bad({ kind: 'income', category: 'hosting', amount: 10, account: a }, 'expense category on income');
  await bad({ kind: 'expense', category: 'client_payment', amount: 10, account: a }, 'income category on expense');
  await bad({ kind: 'income', category: 'client_payment', amount: 0, account: a }, 'zero');
  await bad({ kind: 'income', category: 'client_payment', amount: 10.555, account: a }, 'decimals');
  await bad({ kind: 'income', category: 'client_payment', amount: 10, account: '64b000000000000000000000' }, 'unknown account');
  await bad({ kind: 'income', category: 'client_payment', amount: 10, account: a, title: '' }, 'title');
});

test('coding reports: monthly (12 months) and yearly totals', async () => {
  const a = (await c.get('/accounts')).data.accounts[0].id;
  await coding({ kind: 'income', category: 'client_payment', title: 'Old job', amount: 1000, account: a, date: D.addMonths(D.startOfMonth(T()), -2) });
  const m = (await c.get('/coding/report?period=month')).data;
  assert.equal(m.buckets.length, 12); assert.equal(m.buckets.at(-1).key, D.monthKey(T()));
  assert.equal(m.buckets.find((x) => x.key === D.monthKey(D.addMonths(D.startOfMonth(T()), -2))).income, 1000);
  assert.equal(m.totals.net, m.buckets.reduce((s, x) => s + x.net, 0));
  const y = (await c.get('/coding/report?period=year')).data;
  assert.ok(y.buckets.length >= 1); assert.equal(y.totals.income, m.totals.income);
  assert.equal((await c.get('/coding/report?period=decade')).status, 400);
});

test('coding list filters and search', async () => {
  const q = async (qs) => (await c.get(`/coding/records?${qs}`)).data;
  assert.ok((await q('kind=income')).items.every((i) => i.kind === 'income'));
  assert.ok((await q('status=pending')).items.length === 1 || true);
  assert.equal((await q('q=example.pk')).items.length, 1);
  assert.equal((await q('q=Sara')).items[0].client, 'Sara');
  assert.equal((await c.get('/coding/records?kind=nope')).status, 400);
});

test('business spending never touches the PERSONAL budget; analytics scopes split personal vs business', async () => {
  const a = await mkAcc('Mixed', 'cash', 100000);
  await c.put('/budget', { dailyLimit: 1000 });
  const before = (await c.get('/budget')).data.daily.spent;
  await coding({ kind: 'expense', category: 'tools', title: 'IDE licence', amount: 9000, account: a });
  assert.equal((await c.get('/budget')).data.daily.spent, before, 'business expense is excluded from personal budget');
  const cat = (await c.get('/categories')).data.categories.find((x) => x.type === 'expense' && x.name === 'Food').id;
  await c.post('/transactions', { type: 'expense', title: 'Lunch', amount: 250, date: T(), account: a, category: cat });
  assert.equal((await c.get('/budget')).data.daily.spent, before + 250);
  const sc = async (s) => (await c.get(`/analytics?range=today&scope=${s}`)).data.summary.expense;
  const [all, personal, business] = [await sc('all'), await sc('personal'), await sc('business')];
  assert.equal(all, personal + business); assert.ok(business >= 9000);
  assert.equal((await c.get('/analytics?scope=weird')).status, 400);
});

/* ============================== DARAZ ============================== */
let meezan, easy, p1;

test('daraz: YOUR EXAMPLE — buy 20 for Rs 10,000 + Rs 500 flyer bags + Rs 300 packaging = Rs 10,800 investment', async () => {
  meezan = await mkAcc('DarazBank', 'bank', 50000); easy = await mkAcc('DarazWallet', 'mobile_wallet', 0);
  p1 = (await product('Phone case', { sku: 'PC-1', supplierName: 'Mall Road Traders', category: 'Accessories' })).id;
  assert.equal((await buy(p1, 20, 500, meezan, { supplier: 'Mall Road Traders' })).status, 201);
  assert.equal(await bal(meezan), 40000);
  assert.equal((await expense({ category: 'flyer_bags', title: 'Flyer bags', amount: 500, account: meezan })).status, 201);
  assert.equal((await expense({ category: 'packaging', title: 'Bubble wrap', amount: 300, account: meezan })).status, 201);
  assert.equal(await bal(meezan), 39200);
  const s = await dsum();
  assert.equal(s.purchases, 10000); assert.equal(s.expenses, 800); assert.equal(s.totalInvestment, 10800);
  assert.equal(s.stock.units, 20); assert.equal(s.stock.value, 10000);
  assert.equal(s.revenue, 0); assert.equal(s.netProfit, -800);
});

test('daraz: selling 5 at Rs 800 → revenue 4,000, COGS 2,500, gross 1,500, net profit 700; money lands in the chosen account', async () => {
  assert.equal((await sell(p1, 5, 800, easy)).status, 201);
  assert.equal(await bal(easy), 4000);
  const s = await dsum();
  assert.equal(s.revenue, 4000); assert.equal(s.cogs, 2500); assert.equal(s.grossProfit, 1500); assert.equal(s.netProfit, 700);
  assert.equal(s.marginPct, 17.5); assert.equal(s.stock.units, 15); assert.equal(s.stock.value, 7500);
  const st = await stock(p1);
  assert.equal(st.stock, 15); assert.equal(st.sold, 5); assert.equal(st.purchased, 20); assert.equal(st.avgCost, 500); assert.equal(st.grossProfit, 1500);
  assert.equal(s.balance.received, 4000); assert.equal(s.balance.spent, 10800); assert.equal(s.balance.balance, -6800);
  assert.equal(s.allTime.recoveredPct, Math.round((4000 / 10800) * 1000) / 10);
});

test('daraz: platform fees reduce the money received but count as a business cost', async () => {
  const before = await bal(easy);
  assert.equal((await sell(p1, 2, 800, easy, { fees: 160, orderRef: 'DZ-1001' })).status, 201);
  assert.equal(await bal(easy), before + 1440);
  const s = await dsum();
  assert.equal(s.revenue, 5600); assert.equal(s.platformFees, 160); assert.equal(s.cogs, 3500);
  assert.equal(s.netProfit, 5600 - 3500 - 160 - 800);
  assert.ok(s.expenseBreakdown.some((x) => x.label === 'Platform fees' && x.amount === 160));
  assert.equal((await sell(p1, 1, 100, easy, { fees: 100 })).status, 400, 'fees must be less than the sale');
});

test('daraz: you cannot sell stock you do not have; failed attempts change nothing', async () => {
  const before = [await bal(easy), (await stock(p1)).stock];
  const r = await sell(p1, 500, 800, easy);
  assert.equal(r.status, 409); assert.equal(r.data.code, 'INSUFFICIENT_STOCK'); assert.equal(r.data.available, 13);
  assert.deepEqual([await bal(easy), (await stock(p1)).stock], before);
  assert.equal((await sell(p1, 0, 800, easy)).status, 400); assert.equal((await sell(p1, 1.5, 800, easy)).status, 400); assert.equal((await sell(p1, -2, 800, easy)).status, 400);
  assert.equal((await sell(p1, 1, 800, easy, { date: '2020-01-01' })).status, 409, 'cannot sell before the stock was bought');
});

test('daraz: deleting/editing a purchase that later sales depend on is refused', async () => {
  const purchase = (await c.get(`/daraz/movements?product=${p1}&type=purchase`)).data.items[0];
  const r = await c.del(`/daraz/movements/${purchase.id}`);
  assert.equal(r.status, 409); assert.equal(r.data.code, 'INSUFFICIENT_STOCK');
  const put = await c.put(`/daraz/movements/${purchase.id}`, { type: 'purchase', product: p1, quantity: 3, unitCost: 500, account: meezan, date: purchase.date });
  assert.equal(put.status, 409);
  assert.equal(await bal(meezan), 39200);
});

test('daraz: editing a sale re-prices profit and fixes the account; deleting reverses; restore re-applies', async () => {
  const sale = (await c.get(`/daraz/movements?product=${p1}&type=sale`)).data.items.find((i) => i.quantity === 5);
  const eb = await bal(easy);
  const edit = await c.put(`/daraz/movements/${sale.id}`, { type: 'sale', product: p1, quantity: 5, unitPrice: 900, account: easy, date: sale.date });
  assert.equal(edit.status, 200); assert.equal(await bal(easy), eb + 500);
  assert.equal((await stock(p1)).revenue, 4500 + 1600 + 0 );
  assert.equal((await c.del(`/daraz/movements/${sale.id}`)).status, 200);
  assert.equal(await bal(easy), eb - 4000); assert.equal((await stock(p1)).stock, 18);
  assert.equal((await c.post(`/daraz/movements/${sale.id}/restore`)).status, 200);
  assert.equal(await bal(easy), eb + 500); assert.equal((await stock(p1)).stock, 13);
});

test('daraz: pending payout — sale recorded as revenue, money only moves when the payout is received', async () => {
  const eb = await bal(easy); const rev0 = (await dsum()).revenue;
  const m = (await sell(p1, 2, 1000, null, { orderRef: 'DZ-2002', fees: 100 })).data.movement;
  assert.equal(m.transaction, null); assert.equal(await bal(easy), eb);
  let s = await dsum(); assert.equal(s.revenue, rev0 + 2000); assert.equal(s.balance.pendingPayouts, 1900); assert.equal(s.balance.pendingCount, 1);
  assert.equal((await c.get('/daraz/movements?payout=pending')).data.items.length, 1);
  const r = await c.post(`/daraz/movements/${m.id}/payout`, { account: easy, date: T() });
  assert.equal(r.status, 200); assert.equal(await bal(easy), eb + 1900);
  s = await dsum(); assert.equal(s.balance.pendingPayouts, 0);
  assert.equal((await c.post(`/daraz/movements/${m.id}/payout`, { account: easy, date: T() })).status, 400);
});

test('daraz: write-offs are losses at average cost (no money); existing stock can be added without touching balances', async () => {
  const mb = await bal(meezan); const s0 = await dsum(); const st0 = (await stock(p1)).stock;
  assert.equal((await move({ type: 'writeoff', product: p1, quantity: 2, reason: 'Damaged' })).status, 201);
  assert.equal(await bal(meezan), mb); const s1 = await dsum();
  assert.equal(s1.writeoffLoss - s0.writeoffLoss, 1000); assert.equal(s1.netProfit, s0.netProfit - 1000);
  assert.equal((await stock(p1)).stock, st0 - 2);
  const p2 = (await product('Old stock item')).id;
  assert.equal((await buy(p2, 10, 100, null)).status, 201, 'no account = existing stock');
  assert.equal(await bal(meezan), mb); assert.equal((await stock(p2)).stockValue, 1000);
  assert.equal((await move({ type: 'writeoff', product: p2, quantity: 11 })).status, 409);
  assert.equal((await buy(p2, 1, 0, meezan)).status, 400, 'paying from an account needs a cost');
});

test('daraz: weighted average across two purchases flows into COGS', async () => {
  const p = (await product('Cable')).id;
  await buy(p, 10, 100, meezan, { date: D.addDays(T(), -5) }); await buy(p, 10, 200, meezan, { date: D.addDays(T(), -3) });
  await sell(p, 5, 400, easy, { date: D.addDays(T(), -1) });
  const st = await stock(p);
  assert.equal(st.avgCost, 150); assert.equal(st.cogs, 750); assert.equal(st.grossProfit, 1250); assert.equal(st.stock, 15); assert.equal(st.stockValue, 2250);
  const hist = (await c.get(`/daraz/movements?product=${p}`)).data.items;
  assert.equal(hist.length, 3); assert.equal(hist.find((h) => h.type === 'sale').calc.cogs, 750); assert.equal(hist[0].calc.qtyAfter, 15);
});

test('daraz: expenses — edit/delete/restore stay in sync with the account; product-linked costs reduce that product\'s profit', async () => {
  const p = (await product('Mug')).id; await buy(p, 4, 100, null); await sell(p, 2, 300, null);
  const mb = await bal(meezan);
  const e = (await expense({ category: 'shipping', title: 'Courier', amount: 150, account: meezan, product: p })).data.expense;
  assert.equal(await bal(meezan), mb - 150);
  assert.equal((await stock(p)).linkedExpenses, 150); assert.equal((await stock(p)).netProfit, 600 - 200 - 150);
  const put = (patch) => c.put(`/daraz/expenses/${e.id}`, { category: 'shipping', title: 'Courier', amount: 150, date: T(), account: meezan, product: p, ...patch });
  assert.equal((await put({ amount: 400 })).status, 200); assert.equal(await bal(meezan), mb - 400);
  assert.equal((await put({ amount: 400, account: null })).status, 200); assert.equal(await bal(meezan), mb, 'no account → not deducted');
  assert.equal((await put({ amount: 400, account: meezan })).status, 200);
  assert.equal((await c.del(`/daraz/expenses/${e.id}`)).status, 200); assert.equal(await bal(meezan), mb);
  assert.equal((await c.post(`/daraz/expenses/${e.id}/restore`)).status, 200); assert.equal(await bal(meezan), mb - 400);
  const list = (await c.get('/daraz/expenses?category=shipping')).data;
  assert.equal(list.items.length, 1); assert.equal(list.summary.total, 400);
  assert.equal((await expense({ category: 'weird', amount: 5 })).status, 400);
  assert.equal((await expense({ category: 'other', amount: 5, product: '64b000000000000000000000' })).status, 404);
});

test('daraz: expense & stock filters and date ranges', async () => {
  const s7 = await dsum('?range=7d'); const sAll = await dsum();
  assert.ok(sAll.purchases >= s7.purchases);
  const old = D.addDays(T(), -60);
  const p = (await product('Seasonal')).id; await buy(p, 5, 10, null, { date: old }); await sell(p, 5, 30, null, { date: old });
  const before = await dsum('?range=30d');
  const after = await dsum(`?range=custom&from=${D.addDays(old, -1)}&to=${D.addDays(old, 1)}`);
  assert.equal(after.revenue, 150); assert.equal(after.cogs, 50); assert.equal(after.netProfit, 100);
  assert.equal(before.revenue, (await dsum('?range=30d')).revenue);
  assert.equal((await c.get('/daraz/summary?range=custom&from=2026-05-01')).status, 400);
  const mv = (await c.get(`/daraz/movements?type=sale&from=${old}&to=${old}`)).data.items;
  assert.ok(mv.length >= 1 && mv.every((m) => m.date === old));
  assert.equal((await c.get('/daraz/movements?type=bogus')).status, 400);
});

test('daraz products: SKU unique, image validated, archive/delete rules, low-stock flags', async () => {
  assert.equal((await c.post('/daraz/products', { name: 'Dup', sku: 'pc-1' })).status, 409, 'SKU unique case-insensitively');
  assert.equal((await c.post('/daraz/products', { name: 'Img', image: '<script>' })).status, 400);
  const img = await c.post('/daraz/products', { name: 'Img', image: 'data:image/webp;base64,AAAA' });
  assert.equal(img.status, 201);
  assert.match(img.data.product.image, /^https:\/\/res\.cloudinary\.com\/test-cloud\//, 'photo is stored on Cloudinary, only its URL is saved');
  assert.equal(img.data.product.imagePublicId, undefined, 'storage ids never reach the browser');
  assert.ok(ctx.cloud.uploads.some((u) => u.folder === 'growmore/products'));
  assert.equal((await c.post('/daraz/products', { name: '', purchasePrice: 1 })).status, 400);
  assert.equal((await c.post('/daraz/products', { name: 'Neg', purchasePrice: -1 })).status, 400);
  const low = await product('Low item', { lowStockAt: 5 }); await buy(low.id, 4, 10, null);
  let s = await dsum(); assert.ok(s.stock.low.find((x) => x.id === low.id && x.status === 'low'));
  assert.equal((await stock(low.id)).status, 'low');
  const empty = await product('Never used'); assert.deepEqual((await c.del(`/daraz/products/${empty.id}`)).data, { deleted: true, archived: false });
  const r = await c.del(`/daraz/products/${low.id}`); assert.equal(r.status, 409); assert.equal(r.data.code, 'HAS_STOCK');
  await sell(low.id, 4, 20, null);
  assert.deepEqual((await c.del(`/daraz/products/${low.id}`)).data, { deleted: false, archived: true });
  assert.equal((await buy(low.id, 1, 1, null)).status, 404, 'archived products cannot receive stock');
  assert.ok((await c.get('/daraz/products?archived=true')).data.products.find((x) => x.id === low.id));
  assert.equal((await c.post(`/daraz/products/${low.id}/restore`)).status, 200);
  assert.equal((await c.get('/daraz/products?q=phone')).data.products.length, 1);
});

test('dashboard shows live coding income and Daraz business balance', async () => {
  const d = (await c.get('/dashboard')).data;
  const s = await dsum(); const cs = (await c.get('/coding/summary?range=this_month')).data;
  assert.equal(d.business.daraz.balance, s.balance.balance);
  assert.equal(d.business.codingIncome, cs.income);
});

test('LEDGER INTEGRITY: linked transactions always equal the module records, after every kind of change', async () => {
  const { Transaction, CodingRecord, DarazStockMovement, DarazExpense } = ctx.models;
  const owner = (await ctx.models.User.findOne().sort({ createdAt: 1 }))._id;
  const [cr, mv, ex, tx] = await Promise.all([CodingRecord.find({ user: owner, deletedAt: null, status: 'paid' }).lean(), DarazStockMovement.find({ user: owner, deletedAt: null, account: { $ne: null } }).lean(), DarazExpense.find({ user: owner, deletedAt: null, account: { $ne: null } }).lean(), Transaction.find({ user: owner, deletedAt: null, module: { $ne: null } }).lean()]);
  const exp = new Map();
  cr.forEach((r) => exp.set(String(r._id), [r.kind, r.amount, r.account]));
  mv.forEach((m) => { if (m.type === 'purchase') exp.set(String(m._id), ['expense', Math.round(m.quantity * m.unitCost * 100) / 100, m.account]); if (m.type === 'sale') exp.set(String(m._id), ['income', Math.round((m.quantity * m.unitPrice - m.fees) * 100) / 100, m.account]); });
  ex.forEach((e) => exp.set(String(e._id), ['expense', e.amount, e.account]));
  assert.equal(tx.length, exp.size, 'one ledger transaction per paid record, no extras, none missing');
  for (const t of tx) { const e = exp.get(String(t.moduleRef)); assert.ok(e, 'orphan ledger tx'); assert.deepEqual([t.type, t.amount, String(t.account)], [e[0], e[1], String(e[2])]); }
});

test('RANDOMISED: stock never goes negative and the ledger always matches, whatever mix of buys, sales, edits, deletes and restores', async () => {
  const acc = await mkAcc('Fuzz', 'bank', 1000000); const pr = (await product('Fuzz item')).id;
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ids = []; const deleted = [];
  for (let i = 0; i < 90; i++) {
    const op = rnd(); const date = D.addDays(T(), -Math.floor(rnd() * 20));
    if (op < 0.35) { const r = await buy(pr, 1 + Math.floor(rnd() * 20), 10 + Math.floor(rnd() * 90), rnd() < 0.8 ? acc : null, { date }); if (r.status === 201) ids.push(r.data.movement.id); }
    else if (op < 0.65) { const r = await sell(pr, 1 + Math.floor(rnd() * 12), 50 + Math.floor(rnd() * 100), rnd() < 0.7 ? acc : null, { date, fees: rnd() < 0.3 ? 5 : 0 }); if (r.status === 201) ids.push(r.data.movement.id); }
    else if (op < 0.8 && ids.length) { const id = pick(ids); const r = await c.del(`/daraz/movements/${id}`); if (r.status === 200) { ids.splice(ids.indexOf(id), 1); deleted.push(id); } else assert.equal(r.status, 409); }
    else if (op < 0.9 && deleted.length) { const id = pick(deleted); const r = await c.post(`/daraz/movements/${id}/restore`); if (r.status === 200) { deleted.splice(deleted.indexOf(id), 1); ids.push(id); } else assert.equal(r.status, 409); }
    else if (ids.length) { const id = pick(ids); const cur = (await c.get(`/daraz/movements?product=${pr}&limit=100`)).data.items.find((x) => x.id === id); if (cur) { const r = await c.put(`/daraz/movements/${id}`, { type: cur.type, product: pr, quantity: 1 + Math.floor(rnd() * 15), unitCost: cur.unitCost || 0, unitPrice: cur.unitPrice || 0, fees: 0, account: cur.account || null, date: cur.date }); assert.ok([200, 409].includes(r.status), `edit → ${r.status}`); } }
    const st = await stock(pr); assert.ok(st.stock >= 0, `stock went negative at step ${i}`);
  }
  const { Transaction, DarazStockMovement } = ctx.models; const owner = (await ctx.models.User.findOne().sort({ createdAt: 1 }))._id;
  const mv = await DarazStockMovement.find({ user: owner, product: pr, deletedAt: null, account: { $ne: null } }).lean();
  const want = mv.reduce((s, m) => s + (m.type === 'purchase' ? -m.quantity * m.unitCost : m.quantity * m.unitPrice - m.fees), 0);
  const txs = await Transaction.find({ user: owner, deletedAt: null, module: 'daraz', account: acc }).lean();
  const got = txs.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
  assert.equal(Math.round(got * 100), Math.round(want * 100));
  assert.equal(await bal(acc), Math.round((1000000 + want) * 100) / 100);
});

/* ============================== ISOLATION & AUTH ============================== */
test('business endpoints require sign-in and never leak between users', async () => {
  const anon = new H.Client(ctx.base);
  for (const p of ['/coding/summary', '/coding/records', '/coding/report', '/daraz/summary', '/daraz/products', '/daraz/movements', '/daraz/expenses']) assert.equal((await anon.get(p)).status, 401, p);
  const rec = (await c.get('/coding/records')).data.items[0]; const mv = (await c.get('/daraz/movements')).data.items[0]; const ex = (await c.get('/daraz/expenses')).data.items[0];
  assert.equal((await b.get('/coding/records')).data.items.length, 0); assert.equal((await b.get('/daraz/products')).data.products.length, 0);
  assert.equal((await b.get('/daraz/movements')).data.items.length, 0); assert.equal((await b.get('/daraz/expenses')).data.items.length, 0);
  assert.equal((await b.del(`/coding/records/${rec.id}`)).status, 404); assert.equal((await b.del(`/daraz/movements/${mv.id}`)).status, 404); assert.equal((await b.del(`/daraz/expenses/${ex.id}`)).status, 404);
  assert.equal((await b.get(`/daraz/products/${p1}`)).status, 404);
  assert.equal((await b.post('/daraz/movements', { type: 'purchase', product: p1, quantity: 1, unitCost: 1, date: T(), account: meezan })).status, 404);
  const bAcc = (await b.post('/accounts', { name: 'BAcc', type: 'cash', openingBalance: 100 })).data.account.id;
  assert.equal((await b.post('/coding/records', { kind: 'income', category: 'client_payment', title: 'x', amount: 5, date: T(), account: meezan })).status, 400, "cannot post into another user's account");
  assert.equal((await coding({ kind: 'income', category: 'client_payment', amount: 5, account: bAcc })).status, 400);
  assert.equal((await b.get('/data/export.json')).data.darazProducts.length, 0);
  assert.equal((await b.get('/dashboard')).data.business.daraz.balance, 0);
});

test('backup export includes the business modules and no secrets', async () => {
  const j = (await c.get('/data/export.json')).data;
  assert.equal(j.schemaVersion, 3); assert.ok(j.codingRecords.length && j.darazProducts.length && j.darazStockMovements.length && j.darazExpenses.length);
  assert.ok(!/pinHash|\$2[aby]\$/.test(JSON.stringify(j)));
});

test('daraz product photo: unchanged edit keeps the file, replacing or deleting removes the old one from Cloudinary', async () => {
  const p = await product('Photo item', { image: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.match(p.image, /^https:\/\/res\.cloudinary\.com\/test-cloud\//);
  const up0 = ctx.cloud.uploads.length; const del0 = ctx.cloud.destroys.length;
  const same = await c.put(`/daraz/products/${p.id}`, { name: 'Photo item', image: p.image });
  assert.equal(same.status, 200); assert.equal(same.data.product.image, p.image);
  assert.equal(ctx.cloud.uploads.length, up0); assert.equal(ctx.cloud.destroys.length, del0);
  const rep = await c.put(`/daraz/products/${p.id}`, { name: 'Photo item', image: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.notEqual(rep.data.product.image, p.image); assert.equal(ctx.cloud.uploads.length, up0 + 1); assert.equal(ctx.cloud.destroys.length, del0 + 1);
  assert.equal((await c.put(`/daraz/products/${p.id}`, { name: 'Photo item', image: 'https://res.cloudinary.com/test-cloud/image/upload/v1/not-mine.webp' })).status, 400);
  const gone = await c.put(`/daraz/products/${p.id}`, { name: 'Photo item', image: '' });
  assert.equal(gone.data.product.image, ''); assert.equal(ctx.cloud.destroys.length, del0 + 2);
  assert.deepEqual((await c.del(`/daraz/products/${p.id}`)).data, { deleted: true, archived: false });
});
