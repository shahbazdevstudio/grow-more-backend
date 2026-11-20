const { Challenge } = require('../models');
const ApiError = require('../utils/ApiError');
const D = require('../utils/dates');
const M = require('./challengeMath');

const notFound = () => new ApiError(404, 'Challenge not found.', 'NOT_FOUND');
async function getLive(userId, id) {
  const c = await Challenge.findOne({ _id: id, user: userId, deletedAt: null });
  if (!c) throw notFound();
  return c;
}

async function list(userId, tz) {
  const today = D.todayIn(tz);
  const rows = await Challenge.find({ user: userId, deletedAt: null }).sort({ startDate: -1, createdAt: -1 });
  const items = rows.map((c) => M.summarize(c, today, { withDays: false }));
  // running first, then upcoming, then finished
  const order = { active: 0, upcoming: 1, completed: 2 };
  items.sort((a, b) => order[a.state] - order[b.state]);
  return { items, today };
}

async function get(userId, tz, id) {
  const c = await getLive(userId, id);
  return M.summarize(c, D.todayIn(tz));
}

async function create(userId, tz, data) {
  const today = D.todayIn(tz);
  const c = await Challenge.create({
    user: userId, name: data.name, description: data.description, startDate: data.startDate || today,
    totalDays: data.totalDays, passPercent: data.passPercent, tasks: data.tasks.map((t) => ({ title: t.title, points: t.points })),
  });
  return M.summarize(c, today);
}

async function update(userId, tz, id, data) {
  const c = await getLive(userId, id);
  const today = D.todayIn(tz);
  const started = c.startDate <= today;
  if (started && data.startDate && data.startDate !== c.startDate) throw new ApiError(400, 'The start date cannot be changed once the challenge has started.', 'VALIDATION');
  const startDate = started ? c.startDate : data.startDate || c.startDate;
  const daysGone = startDate <= today ? D.diffDays(startDate, today) + 1 : 0; // days already lived, today included
  const minDays = Math.min(c.totalDays, daysGone); // never shorter than the days already lived (a finished challenge may keep its length)
  if (data.totalDays < minDays) throw new ApiError(400, `This challenge is already on day ${minDays}, so it cannot be shorter than ${minDays} days.`, 'VALIDATION');

  // keep the ids of tasks that already exist (so their ticks stay), add new ones, drop removed ones
  const have = new Map(c.tasks.map((t) => [String(t._id), t]));
  const next = data.tasks.map((t) => {
    const old = t.id && have.get(t.id);
    if (t.id && !old) throw new ApiError(400, 'One of the tasks no longer exists. Reload and try again.', 'VALIDATION');
    return old ? { _id: old._id, title: t.title, points: t.points } : { title: t.title, points: t.points };
  });
  c.set({ name: data.name, description: data.description, startDate, totalDays: data.totalDays, passPercent: data.passPercent, tasks: next });
  await c.save();
  return M.summarize(c, today);
}

/** Tick / untick one task on one day. Only days from the start up to today (and inside the challenge) can be changed. */
async function setTask(userId, tz, id, date, taskId, done) {
  const today = D.todayIn(tz);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const c = await getLive(userId, id);
    const end = D.addDays(c.startDate, c.totalDays - 1);
    if (date < c.startDate || date > end) throw new ApiError(400, 'That day is outside this challenge.', 'VALIDATION');
    if (date > today) throw new ApiError(400, 'You cannot tick tasks for a day that has not come yet.', 'VALIDATION');
    if (!c.tasks.some((t) => String(t._id) === taskId)) throw new ApiError(404, 'Task not found.', 'NOT_FOUND');
    const log = c.logs.find((l) => l.date === date);
    const current = log ? log.done : [];
    const doneIds = done ? [...current, taskId] : current.filter((x) => x !== taskId);
    const snap = M.snapshot(c.tasks, doneIds);
    if (log) log.set(snap); else c.logs.push({ date, ...snap });
    try { await c.save(); return M.summarize(c, today); } catch (e) { if (e.name !== 'VersionError' || attempt === 2) throw e; }
  }
  return null; // unreachable
}

async function remove(userId, id) { const c = await getLive(userId, id); c.deletedAt = new Date(); await c.save(); return { id: String(c._id) }; }
async function restore(userId, tz, id) {
  const c = await Challenge.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!c) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  c.deletedAt = null; await c.save(); return M.summarize(c, D.todayIn(tz));
}

module.exports = { list, get, create, update, setTask, remove, restore };
