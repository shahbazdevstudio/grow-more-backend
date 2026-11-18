const mongoose = require('mongoose');
const { Account, Transaction } = require('../models');
const { r2 } = require('../utils/money');

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

module.exports = { accountsWithBalances, balanceOf, ledgerByAccount, oid };
