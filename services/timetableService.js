const { TimetableEntry } = require('../models');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const D = require('../utils/dates');

async function getLive(userId, id) {
  const e = await TimetableEntry.findOne({ _id: id, user: userId, deletedAt: null });
  if (!e) throw new ApiError(404, 'Timetable entry not found.', 'NOT_FOUND');
  return e;
}

async function list(userId, tz) {
  const today = D.todayIn(tz);
  const rows = await TimetableEntry.find({ user: userId, deletedAt: null }).sort({ startTime: 1, endTime: 1, createdAt: 1 }).lean();
  return { items: rows.map(dto), today, dow: D.fromDow(today) }; // dow: 0 = Monday … 6 = Sunday
}
const create = async (userId, data) => dto(await TimetableEntry.create({ ...data, user: userId }));
async function update(userId, id, data) { const e = await getLive(userId, id); e.set(data); await e.save(); return dto(e); }
async function remove(userId, id) { const e = await getLive(userId, id); e.deletedAt = new Date(); await e.save(); return dto(e); }
async function restore(userId, id) {
  const e = await TimetableEntry.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!e) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  e.deletedAt = null; await e.save(); return dto(e);
}
module.exports = { list, create, update, remove, restore };
