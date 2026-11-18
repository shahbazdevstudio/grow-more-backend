// No account (bank, JazzCash, Easypaisa, cash, savings...) may ever go below zero.
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { effect, combine } = require('../services/balanceService');

let ctx, c, cats;
const T = () => H.today();
const bal = async (id) => (await c.get('/accounts')).data.accounts.find((a) => a.id === id)?.balance;
const cat = (type, name) => cats.find((x) => x.type === type && x.name === name).id;
const mkAcc = async (name, type = 'mobile_wallet', openingBalance = 0) => (await c.post('/accounts', { name, type, openingBalance })).data.account.id;
const tx = (body) => c.post('/transactions', { date: T(), ...body });
const expense = (account, amount) => tx({ type: 'expense', title: 'Spend', amount, account, category: cat('expense', 'Food') });
const income = (account, amount) => tx({ type: 'income', title: 'Pay', amount, account, category: cat('income', 'Coding') });
const transfer = (account, toAccount, amount) => tx({ type: 'transfer', amount, account, toAccount });

test('effect/combine maths', () => {
  assert.deepEqual(effect({ type: 'income', account: 'a', amount: 5 }), { a: 5 });
  assert.deepEqual(effect({ type: 'expense', account: 'a', amount: 5 }), { a: -5 });
  assert.deepEqual(effect({ type: 'transfer', account: 'a', toAccount: 'b', amount: 5 }), { a: -5, b: 5 });
  assert.deepEqual(combine([{ a: -8 }, 1], [{ a: -5 }, -1]), { a: -3 });
});

test.before(async () => {
  ctx = await H.boot('growmore_t_overdraft');
  await H.createOwner('1234');
  c = await H.signedIn(ctx.base, '1234');
  cats = (await c.get('/categories')).data.categories;
});
test.after(() => ctx.stop());

test('a new account cannot start with a negative balance', async () => {
  assert.equal((await c.post('/accounts', { name: 'Neg', type: 'cash', openingBalance: -1 })).status, 400);
});

test('expenses and transfers that exceed the balance are refused', async () => {
  const jazz = await mkAcc('JazzCash', 'mobile_wallet', 1000);
  const easy = await mkAcc('Easypaisa', 'mobile_wallet', 0);
  assert.equal((await expense(jazz, 1000.01)).status, 409);
  assert.equal((await expense(jazz, 1000)).status, 201); // exactly zero is fine
  assert.equal(await bal(jazz), 0);
  const r = await expense(jazz, 1);
  assert.equal(r.status, 409); assert.equal(r.data.code, 'INSUFFICIENT_FUNDS');
  assert.equal((await transfer(jazz, easy, 1)).status, 409);
  assert.equal(await bal(easy), 0);
});

test('editing an expense up, deleting income and restoring are all guarded', async () => {
  const a = await mkAcc('Wallet', 'cash', 500);
  const e = (await expense(a, 100)).data.transaction;
  assert.equal((await c.put(`/transactions/${e.id}`, { ...e, amount: 600, category: e.category, account: a })).status, 409);
  assert.equal(await bal(a), 400);
  const inc = (await income(a, 300)).data.transaction; // 700
  assert.equal((await expense(a, 650)).status, 201); // 50 left
  assert.equal((await c.del(`/transactions/${inc.id}`)).status, 409, 'removing that income would leave -250');
  assert.equal(await bal(a), 50);
});

test('lowering the opening balance below what was spent is refused', async () => {
  const a = await mkAcc('Savings pot', 'savings', 1000);
  await expense(a, 900);
  assert.equal((await c.put(`/accounts/${a}`, { name: 'Savings pot', type: 'savings', openingBalance: 500 })).status, 409);
  assert.equal((await c.put(`/accounts/${a}`, { name: 'Savings pot', type: 'savings', openingBalance: 900 })).status, 200);
  assert.equal(await bal(a), 0);
});

test('business modules cannot overdraw an account either', async () => {
  const a = await mkAcc('Biz wallet', 'mobile_wallet', 100);
  const r = await c.post('/coding/records', { kind: 'expense', category: 'hosting', title: 'VPS', amount: 500, date: T(), account: a });
  assert.ok([400, 409].includes(r.status), `got ${r.status}`);
  assert.equal(await bal(a), 100);
});
