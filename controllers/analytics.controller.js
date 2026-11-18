const A = require('../services/analyticsService');
const D = require('../utils/dates');
const { bad, oneOf, dateStr } = require('../validators/common');

const MAX_SPAN_DAYS = 1830;

function parseRange(req) {
  const q = req.query;
  const range = oneOf(typeof q.range === 'string' ? q.range : undefined, D.RANGES, 'Range', { required: false, def: '30d' });
  const r = D.resolveRange({ range, from: dateStr(q.from, 'From', { required: false }), to: dateStr(q.to, 'To', { required: false }) }, req.user.settings.timezone);
  if (!r.from || !r.to) throw bad('Choose both a start and an end date.');
  if (r.from > r.to) throw bad('The start date must be before the end date.');
  if (D.diffDays(r.from, r.to) > MAX_SPAN_DAYS) throw bad('Date range is too long (max 5 years).');
  return r;
}

exports.overview = async (req, res) => {
  const r = parseRange(req);
  const id = req.user.id;
  const scope = oneOf(typeof req.query.scope === 'string' ? req.query.scope : undefined, ['all', 'personal', 'business'], 'Scope', { required: false, def: 'all' });
  const [summary, daily, weekly, monthly, categories, accounts] = await Promise.all([
    A.summary(id, r, scope), A.series(id, r, 'day', scope), A.series(id, r, 'week', scope), A.series(id, r, 'month', scope),
    A.categoryBreakdown(id, r.from, r.to, 'expense', scope), A.accountDistribution(id),
  ]);
  res.json({ range: r, scope, summary, daily, weekly, monthly, categories, accounts });
};

const I = require('../services/insightsService');
exports.insights = async (req, res) => {
  const r = parseRange(req); const id = req.user.id; const tz = req.user.settings.timezone;
  const scope = oneOf(typeof req.query.scope === 'string' ? req.query.scope : undefined, ['all', 'personal', 'business'], 'Scope', { required: false, def: 'all' });
  const [netWorth, monthly, weekday, topExpenses, forecast] = await Promise.all([I.netWorth(id, tz), I.monthly(id, tz, scope), I.weekday(id, r, scope), I.topExpenses(id, r, scope), I.forecast(id, tz)]);
  res.json({ range: r, scope, netWorth, monthly, weekday, topExpenses, forecast });
};
