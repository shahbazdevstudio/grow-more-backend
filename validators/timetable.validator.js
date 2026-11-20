const v = require('./common');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (x, name) => {
  if (typeof x !== 'string' || !TIME.test(x)) throw v.bad(`${name} must be a valid time (HH:MM).`);
  return x;
};

exports.parseEntry = (b = {}) => {
  const startTime = time(b.startTime, 'Start time');
  const endTime = time(b.endTime, 'End time');
  if (endTime <= startTime) throw v.bad('End time must be after the start time.');
  let days = [0, 1, 2, 3, 4, 5, 6];
  if (b.days !== undefined) {
    if (!Array.isArray(b.days) || !b.days.length) throw v.bad('Pick at least one day.');
    days = [...new Set(b.days.map(Number))];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw v.bad('Days must be between Monday and Sunday.');
    days.sort((x, y) => x - y);
  }
  return { title: v.str(b.title, 'Task', { required: true, max: 100 }), note: v.str(b.note, 'Note', { max: 300 }), startTime, endTime, days };
};
