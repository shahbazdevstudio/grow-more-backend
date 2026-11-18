const mongoose = require('mongoose');
const { Transaction } = require('../models');
const ApiError = require('../utils/ApiError');
const { getOwned } = require('./accountService');
const { effect, combine, assertNoOverdraft } = require('./balanceService');
const categoryService = require('./categoryService');

/**
 * Business modules never touch balances directly. They post ONE ledger transaction per paid record
 * (tagged module + moduleRef), so account balances stay derived from a single source of truth.
 */
const newId = () => new mongoose.Types.ObjectId();

async function assertUsableAccount(userId, accountId, existingAccountId) {
  const acc = await getOwned(userId, accountId).catch(() => { throw new ApiError(400, 'Account not found.', 'VALIDATION'); });
  if (acc.archived && String(existingAccountId) !== String(accountId)) throw new ApiError(400, `"${acc.name}" is archived. Choose another account.`, 'VALIDATION');
  return acc;
}

/** spec: { type, title, amount, date, account, categoryName, notes, module, moduleRef } or null (= no money movement). */
async function sync(userId, existingTxId, spec) {
  if (!spec) { if (existingTxId) await remove(userId, existingTxId); return null; }
  let existing = null;
  if (existingTxId) existing = await Transaction.findOne({ _id: existingTxId, user: userId });
  await assertUsableAccount(userId, spec.account, existing && existing.account);
  const before = existing && !existing.deletedAt ? effect(existing) : {};
  await assertNoOverdraft(userId, combine([effect(spec), 1], [before, -1]));
  const category = await categoryService.ensure(userId, spec.type, spec.categoryName);
  const fields = { type: spec.type, title: spec.title, amount: spec.amount, date: spec.date, account: spec.account, toAccount: null, category: category._id, source: '', notes: spec.notes || '', module: spec.module, moduleRef: spec.moduleRef, deletedAt: null };
  if (existing) { existing.set(fields); await existing.save(); return existing._id; }
  return (await Transaction.create({ ...fields, user: userId }))._id;
}

async function remove(userId, txId) {
  if (!txId) return;
  const tx = await Transaction.findOne({ _id: txId, user: userId, deletedAt: null });
  if (!tx) return;
  await assertNoOverdraft(userId, combine([effect(tx), -1])); // e.g. removing a received payment that was already spent
  await Transaction.updateOne({ _id: txId, user: userId, deletedAt: null }, { $set: { deletedAt: new Date() } });
}
async function restore(userId, txId) {
  if (!txId) return;
  const tx = await Transaction.findOne({ _id: txId, user: userId });
  if (!tx) return;
  await assertUsableAccount(userId, tx.account, tx.account).catch(() => { throw new ApiError(409, 'The account for this record no longer exists.', 'CONFLICT'); });
  if (tx.deletedAt) await assertNoOverdraft(userId, effect(tx));
  tx.deletedAt = null; await tx.save();
}
/** Undo a just-created transaction when the second write fails (no multi-document transactions on a standalone MongoDB). */
const hardDelete = (txId) => txId && Transaction.deleteOne({ _id: txId }).catch(() => {});

module.exports = { newId, sync, remove, restore, hardDelete, assertUsableAccount };
