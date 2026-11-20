const v = require('./common');

const int = (x, name, min, max, def) => {
  if (x === undefined || x === null || x === '') { if (def !== undefined) return def; throw v.bad(`${name} is required.`); }
  const n = Number(x);
  if (typeof x === 'boolean' || !Number.isInteger(n)) throw v.bad(`${name} must be a whole number.`);
  if (n < min || n > max) throw v.bad(`${name} must be between ${min} and ${max}.`);
  return n;
};

exports.parseChallenge = (b = {}) => {
  if (!Array.isArray(b.tasks) || !b.tasks.length) throw v.bad('Add at least one task.');
  if (b.tasks.length > 30) throw v.bad('A challenge can have at most 30 tasks.');
  const tasks = b.tasks.map((t, i) => {
    if (!t || typeof t !== 'object') throw v.bad(`Task ${i + 1} is invalid.`);
    return {
      id: t.id ? v.objectId(t.id, `Task ${i + 1} id`) : null,
      title: v.str(t.title, `Task ${i + 1} name`, { required: true, max: 80 }),
      points: int(t.points, `Task ${i + 1} score`, 1, 1000, 1),
    };
  });
  return {
    name: v.str(b.name, 'Challenge name', { required: true, max: 60 }),
    description: v.str(b.description, 'Description', { max: 300 }),
    startDate: v.dateStr(b.startDate, 'Start date', { required: false, def: null }),
    totalDays: int(b.totalDays, 'Number of days', 1, 365),
    passPercent: int(b.passPercent, 'Pass percentage', 1, 100),
    tasks,
  };
};

exports.parseDayToggle = (b = {}) => ({
  taskId: v.objectId(b.taskId, 'Task'),
  done: b.done === true,
});
exports.parseDate = (d) => v.dateStr(d, 'Date');
