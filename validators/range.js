const D = require('../utils/dates');
const { bad, oneOf, dateStr } = require('./common');

const MODULE_RANGES = ['all', ...D.RANGES];

/** Range for business reports: the usual presets plus "all time". */
exports.parseModuleRange = (query, tz) => {
  const range = oneOf(typeof query.range === 'string' ? query.range : undefined, MODULE_RANGES, 'Range', { required: false, def: 'all' });
  if (range === 'all') return { from: '1970-01-01', to: D.addDays(D.todayIn(tz), 366), range, all: true };
  const r = D.resolveRange({ range, from: dateStr(query.from, 'From', { required: false }), to: dateStr(query.to, 'To', { required: false }) }, tz);
  if (!r.from || !r.to) throw bad('Choose both a start and an end date.');
  if (r.from > r.to) throw bad('The start date must be before the end date.');
  return r;
};
