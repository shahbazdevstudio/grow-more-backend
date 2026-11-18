const { Note } = require('../models');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const { escapeRegex } = require('../utils/text');
const D = require('../utils/dates');
const { oid } = require('./balanceService');

const LIST_FIELDS = '-body'; // lists send the plain-text preview only

async function getLive(userId, id) {
  const n = await Note.findOne({ _id: id, user: userId, deletedAt: null });
  if (!n) throw new ApiError(404, 'Note not found.', 'NOT_FOUND');
  return n;
}

async function list(userId, tz, f) {
  const match = { user: oid(userId), deletedAt: null };
  if (f.pinned) match.pinned = true;
  if (f.category) match.category = new RegExp(`^${escapeRegex(f.category)}$`, 'i');
  if (f.q) { const re = new RegExp(escapeRegex(f.q), 'i'); match.$or = [{ title: re }, { text: re }, { category: re }]; }
  if (f.from || f.to) match.updatedAt = { ...(f.from && { $gte: D.zonedStart(f.from, tz) }), ...(f.to && { $lt: D.zonedStart(D.addDays(f.to, 1), tz) }) };
  const [items, total, cats] = await Promise.all([
    Note.find(match).select(LIST_FIELDS).sort({ pinned: -1, updatedAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    Note.countDocuments(match),
    Note.distinct('category', { user: userId, deletedAt: null, category: { $ne: '' } }),
  ]);
  return { items: items.map((n) => ({ ...dto(n), preview: (n.text || '').slice(0, 220) , text: undefined })), pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) }, categories: cats.sort((a, b) => a.localeCompare(b)) };
}
const get = async (userId, id) => dto(await getLive(userId, id));
const create = async (userId, data) => dto(await Note.create({ ...data, user: userId }));
async function update(userId, id, data) { const n = await getLive(userId, id); n.set(data); await n.save(); return dto(n); }
async function setPinned(userId, id, pinned) {
  await getLive(userId, id);
  await Note.updateOne({ _id: id, user: userId }, { $set: { pinned } }, { timestamps: false }); // pinning is not an edit
  return dto(await getLive(userId, id));
}
async function remove(userId, id) { const n = await getLive(userId, id); n.deletedAt = new Date(); await n.save(); return dto(n); }
async function restore(userId, id) {
  const n = await Note.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!n) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  n.deletedAt = null; await n.save(); return dto(n);
}
module.exports = { list, get, create, update, setPinned, remove, restore };
