const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../utils/dates');

let ctx, c, cats;
const T = () => H.today();
const bal = async (id) => (await c.get('/accounts')).data.accounts.find((a) => a.id === id)?.balance;
const cat = (type, name) => cats.find((x) => x.type === type && x.name === name).id;
const mkAcc = async (name, type = 'bank', openingBalance = 0) => (await c.post('/accounts', { name, type, openingBalance })).data.account.id;
const tx = (body) => c.post('/transactions', { date: T(), ...body });
const expense = (account, amount, extra = {}) => tx({ type: 'expense', title: 'Spend', amount, account, category: cat('expense', 'Food'), ...extra });
const income = (account, amount, extra = {}) => tx({ type: 'income', title: 'Pay', amount, account, category: cat('income', 'Coding'), ...extra });
const transfer = (account, toAccount, amount, extra = {}) => tx({ type: 'transfer', amount, account, toAccount, ...extra });

test.before(async () => {
  ctx = await H.boot('growmore_t_ledger');
  await H.createOwner('1234');
  c = await H.signedIn(ctx.base, '1234');
  cats = (await c.get('/categories')).data.categories;
});
test.after(() => ctx.stop());

test('default categories are seeded', () => {
  assert.deepEqual(cats.filter((x) => x.type === 'expense').map((x) => x.name).sort(), ['Bills', 'Food', 'Internet', 'Marketing', 'Other', 'Personal', 'Shopping', 'Transport']);
  assert.ok(cats.some((x) => x.type === 'income' && x.name === 'Coding'));
});

test('account CRUD + validation + unique names', async () => {
  assert.equal((await c.post('/accounts', { name: '', type: 'bank' })).status, 400);
  assert.equal((await c.post('/accounts', { name: 'X', type: 'nope' })).status, 400);
  assert.equal((await c.post('/accounts', { name: 'X', type: 'bank', openingBalance: 'abc' })).status, 400);
  assert.equal((await c.post('/accounts', { name: 'X', type: 'bank', openingBalance: 1.234 })).status, 400);
  assert.equal((await c.post('/accounts', { name: 'X', type: 'bank', logoData: '<script>alert(1)</script>' })).status, 400);
  const id = await mkAcc('Meezan Bank', 'bank', 10000);
  assert.equal((await c.post('/accounts', { name: 'meezan bank', type: 'bank' })).status, 409, 'names are unique case-insensitively');
  assert.equal(await bal(id), 10000);
  const up = await c.put(`/accounts/${id}`, { name: 'Meezan', type: 'bank', openingBalance: 12000, description: 'Main' });
  assert.equal(up.data.account.balance, 12000);
  assert.equal((await c.del(`/accounts/${id}`)).status, 409, 'cannot delete with a balance');
  assert.equal((await c.put(`/accounts/${id}`, { name: 'Meezan', type: 'bank', openingBalance: 0 })).data.account.balance, 0);
  assert.deepEqual((await c.del(`/accounts/${id}`)).data, { deleted: true, archived: false });
});

test('income adds, expense deducts, only on the chosen account', async () => {
  const meezan = await mkAcc('Meezan', 'bank', 5000);
  const jazz = await mkAcc('JazzCash', 'mobile_wallet', 1000);
  assert.equal((await income(meezan, 20000, { title: 'Client payment' })).status, 201);
  assert.equal(await bal(meezan), 25000);
  assert.equal(await bal(jazz), 1000);
  assert.equal((await expense(jazz, 350.5)).status, 201);
  assert.equal(await bal(jazz), 649.5);
  assert.equal(await bal(meezan), 25000);
});

test('transfers move money between accounts and are NOT income or expense', async () => {
  const a = await mkAcc('T-from', 'bank', 1000);
  const b = await mkAcc('T-to', 'cash', 0);
  const before = (await c.get(`/analytics?range=today`)).data.summary;
  assert.equal((await transfer(a, b, 400)).status, 201);
  assert.equal(await bal(a), 600);
  assert.equal(await bal(b), 400);
  const after = (await c.get(`/analytics?range=today`)).data.summary;
  assert.equal(after.income, before.income);
  assert.equal(after.expense, before.expense);
  const dash = (await c.get('/dashboard')).data;
  assert.equal(dash.month.income, before.income);
  assert.equal((await transfer(a, a, 10)).status, 400, 'same account rejected');
  const list = (await c.get('/transactions?type=transfer')).data;
  assert.ok(list.items.length >= 1);
  assert.equal(list.summary.income, 0);
});

test('editing a transaction recalculates the affected balances (amount, account, type)', async () => {
  const a = await mkAcc('E-a', 'bank', 1000);
  const b = await mkAcc('E-b', 'bank', 1000);
  const t = (await expense(a, 100)).data.transaction;
  assert.equal(await bal(a), 900);
  const put = (patch) => c.put(`/transactions/${t.id}`, { type: 'expense', title: 'Spend', amount: 100, date: T(), account: a, category: cat('expense', 'Food'), ...patch });
  assert.equal((await put({ amount: 250 })).status, 200); assert.equal(await bal(a), 750);
  assert.equal((await put({ amount: 250, account: b })).status, 200); assert.equal(await bal(a), 1000); assert.equal(await bal(b), 750);
  assert.equal((await put({ type: 'income', amount: 50, account: b, category: cat('income', 'Gift') })).status, 200); assert.equal(await bal(b), 1050);
  assert.equal((await put({ type: 'transfer', amount: 300, account: b, toAccount: a, category: null })).status, 200);
  assert.equal(await bal(b), 700); assert.equal(await bal(a), 1300);
  const got = (await c.get(`/transactions/${t.id}`)).data.transaction;
  assert.equal(got.category, null); assert.equal(got.type, 'transfer');
});

test('deleting reverses the effect; restore re-applies it; deleting twice is harmless', async () => {
  const a = await mkAcc('D-a', 'bank', 500);
  const b = await mkAcc('D-b', 'bank', 0);
  const e = (await expense(a, 120)).data.transaction;
  const tr = (await transfer(a, b, 200)).data.transaction;
  assert.equal(await bal(a), 180); assert.equal(await bal(b), 200);
  assert.equal((await c.del(`/transactions/${tr.id}`)).status, 200);
  assert.equal(await bal(a), 380); assert.equal(await bal(b), 0);
  assert.equal((await c.del(`/transactions/${tr.id}`)).status, 404);
  assert.equal(await bal(a), 380);
  assert.equal((await c.post(`/transactions/${tr.id}/restore`)).status, 200);
  assert.equal(await bal(a), 180); assert.equal(await bal(b), 200);
  assert.equal((await c.post(`/transactions/${tr.id}/restore`)).status, 404, 'restoring a live tx does nothing');
  assert.equal(await bal(a), 180);
  assert.equal((await c.del(`/transactions/${e.id}`)).status, 200);
  assert.equal((await c.get(`/transactions/${e.id}`)).status, 404);
  assert.equal(await bal(a), 300);
});

test('idempotent save: the same clientRequestId never double-applies (double tap / retry)', async () => {
  const a = await mkAcc('Idem', 'cash', 1000);
  const body = { clientRequestId: 'req-123', title: 'Lunch', amount: 100, account: a };
  const r1 = await expense(a, 100, body);
  const r2 = await expense(a, 100, body);
  const [r3, r4] = await Promise.all([expense(a, 100, { ...body, clientRequestId: 'req-par' }), expense(a, 100, { ...body, clientRequestId: 'req-par' })]);
  assert.equal(r1.status, 201); assert.equal(r2.status, 200); assert.equal(r2.data.duplicate, true);
  assert.equal(r1.data.transaction.id, r2.data.transaction.id);
  assert.equal(r3.data.transaction.id, r4.data.transaction.id);
  assert.equal(await bal(a), 800, 'only two real expenses were recorded');
});

test('transaction validation', async () => {
  const a = await mkAcc('Val', 'cash', 0);
  const base = { type: 'expense', title: 'x', amount: 10, date: T(), account: a, category: cat('expense', 'Food') };
  const bad = async (patch, why) => assert.equal((await c.post('/transactions', { ...base, ...patch })).status, 400, why);
  await bad({ amount: 0 }, 'zero'); await bad({ amount: -5 }, 'negative'); await bad({ amount: 'ten' }, 'text');
  await bad({ amount: 1.005 }, '3 decimals'); await bad({ amount: 1e15 }, 'huge'); await bad({ title: '' }, 'no title');
  await bad({ date: '2026-02-30' }, 'impossible date'); await bad({ date: 'yesterday' }, 'bad date'); await bad({ date: '2040-01-01' }, 'far future');
  await bad({ category: undefined }, 'no category'); await bad({ category: cat('income', 'Coding') }, 'income category on expense');
  await bad({ account: '64b000000000000000000000' }, 'unknown account'); await bad({ type: 'refund' }, 'unknown type');
  await bad({ title: 'x'.repeat(200) }, 'title too long');
  assert.equal(await bal(a), 0, 'nothing was saved');
});

test('archived accounts: need zero balance, keep history, hidden from balances, cannot receive new money', async () => {
  const a = await mkAcc('Arch', 'bank', 100);
  await expense(a, 100);
  assert.equal(await bal(a), 0);
  const r = await c.del(`/accounts/${a}`);
  assert.equal(r.data.archived, true);
  assert.equal(await bal(a), undefined, 'not in active list');
  assert.equal((await expense(a, 1)).status, 400);
  const arch = (await c.get('/accounts?archived=true')).data.accounts;
  assert.ok(arch.find((x) => x.id === a));
  assert.equal((await c.post(`/accounts/${a}/restore`)).status, 200);
  assert.equal(await bal(a), 0);
});

test('RANDOMISED consistency: balances always equal an independent model after many create/edit/delete/restore ops', async () => {
  const ids = [await mkAcc('F1', 'bank', 1000), await mkAcc('F2', 'mobile_wallet', 250.75), await mkAcc('F3', 'cash', 0), await mkAcc('F4', 'savings', 5000)];
  const open = { [ids[0]]: 1000, [ids[1]]: 250.75, [ids[2]]: 0, [ids[3]]: 5000 };
  const model = new Map(); // id -> {type, amount, account, toAccount, deleted}
  const expected = () => {
    const b = { ...open };
    for (const t of model.values()) {
      if (t.deleted) continue;
      if (t.type === 'income') b[t.account] += t.amount;
      if (t.type === 'expense') b[t.account] -= t.amount;
      if (t.type === 'transfer') { b[t.account] -= t.amount; b[t.toAccount] += t.amount; }
    }
    return b;
  };
  let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const amt = () => Math.round((rnd() * 5000 + 0.01) * 100) / 100;
  const body = (type, account, toAccount, amount) => ({ type, title: 'f', amount, date: T(), account, toAccount: type === 'transfer' ? toAccount : undefined, category: type === 'expense' ? cat('expense', 'Bills') : type === 'income' ? cat('income', 'Daraz') : undefined });
  for (let i = 0; i < 120; i++) {
    const live = [...model.entries()].filter(([, t]) => !t.deleted);
    const dead = [...model.entries()].filter(([, t]) => t.deleted);
    const op = rnd();
    if (op < 0.5 || !live.length) {
      const type = pick(['income', 'expense', 'transfer']); const account = pick(ids); const toAccount = pick(ids.filter((x) => x !== account)); const amount = amt();
      const r = await c.post('/transactions', body(type, account, toAccount, amount));
      assert.equal(r.status, 201); model.set(r.data.transaction.id, { type, amount, account, toAccount: type === 'transfer' ? toAccount : null, deleted: false });
    } else if (op < 0.75) {
      const [id] = pick(live); const type = pick(['income', 'expense', 'transfer']); const account = pick(ids); const toAccount = pick(ids.filter((x) => x !== account)); const amount = amt();
      const r = await c.put(`/transactions/${id}`, body(type, account, toAccount, amount));
      assert.equal(r.status, 200); model.set(id, { type, amount, account, toAccount: type === 'transfer' ? toAccount : null, deleted: false });
    } else if (op < 0.92) {
      const [id, t] = pick(live); assert.equal((await c.del(`/transactions/${id}`)).status, 200); t.deleted = true;
    } else if (dead.length) {
      const [id, t] = pick(dead); assert.equal((await c.post(`/transactions/${id}/restore`)).status, 200); t.deleted = false;
    }
  }
  const exp = expected();
  const accounts = (await c.get('/accounts')).data.accounts;
  for (const id of ids) assert.equal(accounts.find((a) => a.id === id).balance, Math.round(exp[id] * 100) / 100, `balance of ${id}`);
});

test('list filters: search, type, category, account, dates, pagination', async () => {
  const x = await mkAcc('Filt-X', 'bank', 0); const y = await mkAcc('Filt-Y', 'bank', 0);
  const old = D.addDays(T(), -40);
  await expense(x, 10, { title: 'Pizza night', date: old, category: cat('expense', 'Food') });
  await expense(x, 20, { title: 'Bus ticket', category: cat('expense', 'Transport') });
  await income(y, 500, { title: 'Logo design', notes: 'client Ali' });
  const q = async (qs) => (await c.get(`/transactions?${qs}`)).data;
  assert.equal((await q(`q=pizza&account=${x}`)).items.length, 1);
  assert.equal((await q(`q=ali&account=${y}`)).items.length, 1, 'search matches notes');
  assert.equal((await q(`q=${encodeURIComponent('.*')}&account=${x}`)).items.length, 0, 'regex chars are escaped');
  assert.equal((await q(`account=${x}&from=${D.addDays(T(), -7)}`)).items.length, 1);
  assert.equal((await q(`account=${x}&to=${D.addDays(T(), -7)}`)).items.length, 1);
  assert.equal((await q(`account=${x}&category=${cat('expense', 'Transport')}`)).items[0].title, 'Bus ticket');
  assert.equal((await q(`account=${y}&type=income`)).summary.income, 500);
  const p = await q(`account=${x}&limit=1&page=2`);
  assert.equal(p.items.length, 1); assert.equal(p.pagination.total, 2); assert.equal(p.pagination.pages, 2);
  assert.equal((await c.get('/transactions?from=2026-05-01&to=2026-04-01')).status, 400);
  assert.equal((await c.get('/transactions?type=bogus')).status, 400);
  assert.equal((await c.get('/transactions?limit=100000')).data.pagination.limit, 100);
});

test('account logo: uploaded to Cloudinary, URL saved, old file removed on replace/delete, failed save leaves no orphan', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const a = await c.post('/accounts', { name: 'Logo Bank', type: 'bank', logoData: PNG });
  assert.equal(a.status, 201);
  assert.match(a.data.account.logoData, /^https:\/\/res\.cloudinary\.com\/test-cloud\//);
  assert.equal(a.data.account.logoPublicId, undefined);
  const id = a.data.account.id;
  assert.equal((await c.get('/accounts')).data.accounts.find((x) => x.id === id).logoData, a.data.account.logoData);
  const up = ctx.cloud.uploads.length; const del = ctx.cloud.destroys.length;
  const same = await c.put(`/accounts/${id}`, { name: 'Logo Bank', type: 'bank', logoData: a.data.account.logoData });
  assert.equal(same.data.account.logoData, a.data.account.logoData); assert.equal(ctx.cloud.uploads.length, up); assert.equal(ctx.cloud.destroys.length, del);
  const rep = await c.put(`/accounts/${id}`, { name: 'Logo Bank', type: 'bank', logoData: PNG });
  assert.notEqual(rep.data.account.logoData, a.data.account.logoData); assert.equal(ctx.cloud.destroys.length, del + 1);
  // duplicate name -> save fails -> the freshly uploaded file is removed again
  const dupUp = ctx.cloud.uploads.length; const dupDel = ctx.cloud.destroys.length;
  assert.equal((await c.post('/accounts', { name: 'logo bank', type: 'bank', logoData: PNG })).status, 409);
  assert.equal(ctx.cloud.uploads.length, dupUp + 1); assert.equal(ctx.cloud.destroys.length, dupDel + 1);
  // an unused account is deleted together with its logo
  const delBefore = ctx.cloud.destroys.length;
  assert.deepEqual((await c.del(`/accounts/${id}`)).data, { deleted: true, archived: false });
  assert.equal(ctx.cloud.destroys.length, delBefore + 1);
});
