const { Todo } = require('../models');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const { escapeRegex } = require('../utils/text');
const D = require('../utils/dates');
const { oid } = require('./balanceService');

async function getLive(userId, id) {
  const t = await Todo.findOne({ _id: id, user: userId, deletedAt: null });
  if (!t) throw new ApiError(404, 'Task not found.', 'NOT_FOUND');
  return t;
}

async function counts(userId, today) {
  const base = { user: oid(userId), deletedAt: null };
  const [pending, completed, overdue, dueToday] = await Promise.all([
    Todo.countDocuments({ ...base, completed: false }), Todo.countDocuments({ ...base, completed: true }),
    Todo.countDocuments({ ...base, completed: false, dueDate: { $ne: null, $lt: today } }), Todo.countDocuments({ ...base, completed: false, dueDate: today }),
  ]);
  return { pending, completed, overdue, dueToday };
}

async function list(userId, tz, f) {
  const today = D.todayIn(tz);
  const match = { user: oid(userId), deletedAt: null };
  if (f.status === 'pending') match.completed = false; if (f.status === 'completed') match.completed = true;
  if (f.q) { const re = new RegExp(escapeRegex(f.q), 'i'); match.$or = [{ title: re }, { description: re }]; }
  const total = await Todo.countDocuments(match);
  // pending: overdue → soonest → undated;  completed: newest first
  const rows = f.status === 'completed'
    ? await Todo.find(match).sort({ completedAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean()
    : await Todo.aggregate([{ $match: match }, { $addFields: { _noDue: { $cond: [{ $eq: ['$dueDate', null] }, 1, 0] } } }, { $sort: { completed: 1, _noDue: 1, dueDate: 1, createdAt: -1 } }, { $skip: (f.page - 1) * f.limit }, { $limit: f.limit }]);
  return { items: rows.map((r) => ({ ...dto(r), _noDue: undefined, overdue: !r.completed && !!r.dueDate && r.dueDate < today, dueToday: !r.completed && r.dueDate === today })), pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) }, counts: await counts(userId, today), today };
}
const create = async (userId, data) => dto(await Todo.create({ ...data, user: userId }));
async function update(userId, id, data) { const t = await getLive(userId, id); t.set(data); await t.save(); return dto(t); }
async function setCompleted(userId, id, completed) { const t = await getLive(userId, id); t.completed = completed; t.completedAt = completed ? new Date() : null; await t.save(); return dto(t); }
async function remove(userId, id) { const t = await getLive(userId, id); t.deletedAt = new Date(); await t.save(); return dto(t); }
async function restore(userId, id) {
  const t = await Todo.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!t) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  t.deletedAt = null; await t.save(); return dto(t);
}
module.exports = { list, create, update, setCompleted, remove, restore, counts };
