const mongoose = require('mongoose');
const { Account, Transaction } = require('../models');
const { r2 } = require('../utils/money');
const ApiError = require('../utils/ApiError');

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const sumIf = (type) => ({ $sum: { $cond: [{ $eq: ['$type', type] }, '$amount', 0] } });

/**
 * Balance of an account = openingBalance + income - expense - transfersOut + transfersIn,
 * calculated from non-deleted ledger rows. It is never stored, so it can never be updated twice or drift.
 */
async function ledgerByAccount(userId) {
  const match = { user: oid(userId), deletedAt: null };
  const [own, incoming] = await Promise.all([
    Transaction.aggregate([
      { $match: match },
      { $group: { _id: '$account', income: sumIf('income'), expense: sumIf('expense'), transferOut: sumIf('transfer'), count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { ...match, type: 'transfer' } },
      { $group: { _id: '$toAccount', transferIn: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);
  const map = new Map();
  const slot = (id) => { const k = String(id); if (!map.has(k)) map.set(k, { income: 0, expense: 0, transferOut: 0, transferIn: 0, count: 0 }); return map.get(k); };
  for (const g of own) Object.assign(slot(g._id), { income: g.income, expense: g.expense, transferOut: g.transferOut, count: g.count });
  for (const g of incoming) { const s = slot(g._id); s.transferIn = g.transferIn; s.count += g.count; }
  return map;
}

const balanceFrom = (account, l) =>
  r2((account.openingBalance || 0) + (l ? l.income - l.expense - l.transferOut + l.transferIn : 0));

async function accountsWithBalances(userId, { archived = false } = {}) {
  const [accounts, ledger] = await Promise.all([
    Account.find({ user: userId, archived }).sort({ createdAt: 1 }).lean(),
    ledgerByAccount(userId),
  ]);
  return accounts.map((a) => {
    const l = ledger.get(String(a._id));
    return { ...a, balance: balanceFrom(a, l), transactionCount: l ? l.count : 0 };
  });
}

async function balanceOf(userId, accountId) {
  const [account, ledger] = await Promise.all([Account.findOne({ _id: accountId, user: userId }).lean(), ledgerByAccount(userId)]);
  return account ? balanceFrom(account, ledger.get(String(accountId))) : null;
}

/* ---------- Overdraft guard: no account (bank, JazzCash, Easypaisa, cash, savings...) may ever go below zero ---------- */

/** What one ledger row does to each account: { accountId: +/-amount }. */
function effect(t) {
  const out = {};
  const add = (id, n) => { if (id) out[String(id)] = r2((out[String(id)] || 0) + n); };
  if (!t) return out;
  if (t.type === 'income') add(t.account, t.amount);
  else if (t.type === 'expense') add(t.account, -t.amount);
  else if (t.type === 'transfer') { add(t.account, -t.amount); add(t.toAccount, t.amount); }
  return out;
}

/** Combines effects: sign = +1 adds them, -1 subtracts them (e.g. delta of an edit = new - old). */
function combine(...parts) {
  const out = {};
  for (const [eff, sign] of parts) for (const [id, n] of Object.entries(eff || {})) out[id] = r2((out[id] || 0) + sign * n);
  return out;
}

/**
 * Throws (409) if applying `delta` ({accountId: change}) would push an account below zero.
 * Only accounts that LOSE money are checked, and an account that is already negative is allowed to stay as it is
 * (it just cannot get worse), so old data never blocks harmless edits.
 */
async function assertNoOverdraft(userId, delta) {
  const ids = Object.keys(delta).filter((id) => delta[id] < -0.004);
  if (!ids.length) return;
  const [accounts, ledger] = await Promise.all([Account.find({ user: userId, _id: { $in: ids } }).lean(), ledgerByAccount(userId)]);
  for (const a of accounts) {
    const have = balanceFrom(a, ledger.get(String(a._id)));
    const after = r2(have + delta[String(a._id)]);
    if (after < -0.004) {
      throw new ApiError(409, `Not enough balance in "${a.name}". Available: Rs ${have.toLocaleString('en-US', { maximumFractionDigits: 2 })}, needed: Rs ${r2(-delta[String(a._id)]).toLocaleString('en-US', { maximumFractionDigits: 2 })}. A balance cannot go below zero.`, 'INSUFFICIENT_FUNDS', { account: String(a._id), available: have });
    }
  }
}

module.exports = { accountsWithBalances, balanceOf, ledgerByAccount, oid, effect, combine, assertNoOverdraft };
