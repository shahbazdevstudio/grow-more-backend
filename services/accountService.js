const { Account, Transaction, SavingsGoal } = require('../models');
const ApiError = require('../utils/ApiError');
const { accountsWithBalances, balanceOf } = require('./balanceService');
const { dto } = require('../utils/dto');
const images = require('./imageService');

const dupName = (e) => e && e.code === 11000 && new ApiError(409, 'You already have an account with this name.', 'DUPLICATE');

async function getOwned(userId, id, { allowArchived = true } = {}) {
  const acc = await Account.findOne({ _id: id, user: userId });
  if (!acc || (!allowArchived && acc.archived)) throw new ApiError(404, 'Account not found.', 'NOT_FOUND');
  return acc;
}

const list = async (userId, opts) => (await accountsWithBalances(userId, opts)).map(dto);

async function create(userId, data) {
  const img = await images.prepare(data.logoData, { sub: 'accounts' }); // uploads to Cloudinary (if a new image was sent)
  try {
    const acc = await Account.create({ ...data, logoData: img.url, logoPublicId: img.publicId, user: userId });
    return { ...dto(acc), balance: data.openingBalance, transactionCount: 0 };
  } catch (e) { await img.rollback(); throw dupName(e) || e; }
}

async function update(userId, id, data) {
  const acc = await getOwned(userId, id);
  if (acc.archived) throw new ApiError(400, 'Restore this account before editing it.', 'ARCHIVED');
  const img = await images.prepare(data.logoData, { sub: 'accounts', current: { url: acc.logoData, publicId: acc.logoPublicId } });
  acc.set({ ...data, logoData: img.url, logoPublicId: img.publicId });
  try { await acc.save(); } catch (e) { await img.rollback(); throw dupName(e) || e; }
  await img.commit(); // removes the previous picture from Cloudinary if it was replaced or removed
  const balance = await balanceOf(userId, id);
  return { ...dto(acc), balance };
}

/**
 * "Delete": removes the account if it has never been used; otherwise archives it so history stays intact.
 * The balance must be zero first, so deleting/archiving can never silently change your total balance.
 */
async function remove(userId, id) {
  const acc = await getOwned(userId, id);
  if (acc.archived) throw new ApiError(400, 'This account is already archived.', 'ARCHIVED');
  const balance = await balanceOf(userId, id);
  if (Math.abs(balance) >= 0.005) throw new ApiError(409, 'This account still has a balance. Transfer or spend it first (or edit the opening balance), then delete it.', 'BALANCE_NOT_ZERO', { balance });
  const used = await Transaction.countDocuments({ user: userId, $or: [{ account: id }, { toAccount: id }] });
  await SavingsGoal.updateMany({ user: userId, account: id }, { $set: { account: null } });
  if (!used) {
    await acc.deleteOne();
    await images.destroy(acc.logoPublicId);
    return { deleted: true, archived: false };
  }
  acc.archived = true;
  await acc.save();
  return { deleted: false, archived: true, transactionCount: used };
}

async function restore(userId, id) {
  const acc = await getOwned(userId, id);
  acc.archived = false;
  try { await acc.save(); } catch (e) { throw (e && e.code === 11000 && new ApiError(409, 'Another account already uses this name. Rename it first.', 'DUPLICATE')) || e; }
  return { ...dto(acc), balance: await balanceOf(userId, id) };
}

module.exports = { list, create, update, remove, restore, getOwned };
