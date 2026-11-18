const crypto = require('crypto');
const { Transaction, Category } = require('../models');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const { oid } = require('./balanceService');
const { getOwned } = require('./accountService');
const { r2 } = require('../utils/money');
const { escapeRegex } = require('../utils/text');

/** Make sure every referenced account/category belongs to this user (and is usable). */
async function checkRefs(userId, data, existing = null) {
  const usable = async (id, label) => {
    const acc = await getOwned(userId, id).catch(() => { throw new ApiError(400, `${label} not found.`, 'VALIDATION'); });
    const unchanged = existing && [String(existing.account), String(existing.toAccount)].includes(String(id));
    if (acc.archived && !unchanged) throw new ApiError(400, `"${acc.name}" is archived. Choose another account.`, 'VALIDATION');
    return acc;
  };
  await usable(data.account, data.type === 'transfer' ? 'From account' : 'Account');
  if (data.type === 'transfer') await usable(data.toAccount, 'To account');
  if (data.type !== 'transfer') {
    const cat = await Category.findOne({ _id: data.category, user: userId }).lean();
    if (!cat || cat.type !== data.type) throw new ApiError(400, `${data.type === 'income' ? 'Source' : 'Category'} not found.`, 'VALIDATION');
    if (cat.archived && !(existing && String(existing.category) === String(data.category))) throw new ApiError(400, `"${cat.name}" is no longer available. Choose another.`, 'VALIDATION');
  }
}

async function create(userId, data) {
  if (data.clientRequestId) {
    const dup = await Transaction.findOne({ user: userId, clientRequestId: data.clientRequestId }).lean();
    if (dup) return { transaction: dto(dup), duplicate: true };
  }
  await checkRefs(userId, data);
  try {
    const tx = await Transaction.create({ ...data, user: userId });
    return { transaction: dto(tx), duplicate: false };
  } catch (e) {
    if (e.code === 11000 && data.clientRequestId) {
      const dup = await Transaction.findOne({ user: userId, clientRequestId: data.clientRequestId }).lean();
      if (dup) return { transaction: dto(dup), duplicate: true };
    }
    throw e;
  }
}

async function getLive(userId, id) {
  const tx = await Transaction.findOne({ _id: id, user: userId, deletedAt: null });
  if (!tx) throw new ApiError(404, 'Transaction not found.', 'NOT_FOUND');
  return tx;
}

const managed = (tx) => new ApiError(409, `This transaction is managed by the ${{ coding: 'Coding', daraz: 'Daraz', trading: 'Trading' }[tx.module]} module. Edit or delete it there so your records stay in sync.`, 'MANAGED', { module: tx.module });

async function update(userId, id, data) {
  const tx = await getLive(userId, id);
  if (tx.module) throw managed(tx);
  await checkRefs(userId, data, tx);
  delete data.clientRequestId;
  tx.set({ ...data, toAccount: data.toAccount || null, category: data.category || null });
  await tx.save();
  return dto(tx);
}

async function remove(userId, id) {
  const tx = await getLive(userId, id);
  if (tx.module) throw managed(tx);
  tx.deletedAt = new Date();
  await tx.save();
  return dto(tx);
}

async function restore(userId, id) {
  const tx = await Transaction.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!tx) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  if (tx.module) throw managed(tx);
  await getOwned(userId, tx.account).catch(() => { throw new ApiError(409, 'The account for this transaction no longer exists.', 'CONFLICT'); });
  if (tx.toAccount) await getOwned(userId, tx.toAccount).catch(() => { throw new ApiError(409, 'The destination account no longer exists.', 'CONFLICT'); });
  tx.deletedAt = null;
  await tx.save();
  return dto(tx);
}

const getOne = async (userId, id) => dto(await getLive(userId, id));

function buildMatch(userId, f) {
  const match = { user: oid(userId), deletedAt: null };
  const and = [];
  if (f.type) match.type = f.type;
  if (f.scope === 'personal') match.module = null;
  if (f.scope === 'business') match.module = { $in: ['coding', 'daraz'] };
  if (f.scope === 'trading') match.module = 'trading';
  if (f.category) match.category = oid(f.category);
  if (f.account) and.push({ $or: [{ account: oid(f.account) }, { toAccount: oid(f.account) }] });
  if (f.from || f.to) match.date = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  if (f.q) { const re = new RegExp(escapeRegex(f.q), 'i'); and.push({ $or: [{ title: re }, { notes: re }, { source: re }] }); }
  if (and.length) match.$and = and;
  return match;
}

async function list(userId, f) {
  const match = buildMatch(userId, f);
  const [items, total, sums] = await Promise.all([
    Transaction.find(match).sort({ date: -1, createdAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    Transaction.countDocuments(match),
    Transaction.aggregate([{ $match: match }, { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
  ]);
  const s = Object.fromEntries(sums.map((x) => [x._id, x]));
  const income = r2(s.income?.amount || 0);
  const expense = r2(s.expense?.amount || 0);
  return {
    items: items.map(dto),
    pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) },
    summary: { income, expense, net: r2(income - expense), transferTotal: r2(s.transfer?.amount || 0), transfers: s.transfer?.count || 0 },
  };
}

module.exports = { create, update, remove, restore, getOne, list, newRequestId: () => crypto.randomUUID() };
