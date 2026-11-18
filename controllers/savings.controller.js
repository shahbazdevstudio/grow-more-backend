const svc = require('../services/savingsService');
const { parseGoal } = require('../validators/savings.validator');
const { objectId } = require('../validators/common');

exports.overview = async (req, res) => res.json(await svc.overview(req.user.id, req.user.settings.timezone));
exports.createGoal = async (req, res) => res.status(201).json({ goal: await svc.createGoal(req.user.id, parseGoal(req.body)) });
exports.updateGoal = async (req, res) => res.json({ goal: await svc.updateGoal(req.user.id, objectId(req.params.id, 'id'), parseGoal(req.body)) });
exports.removeGoal = async (req, res) => res.json(await svc.removeGoal(req.user.id, objectId(req.params.id, 'id')));

const { parseModuleRange } = require('../validators/range');
const V = require('../validators/common');
exports.sources = async (req, res) => res.json(await svc.sources(req.user.id, parseModuleRange(req.query, req.user.settings.timezone)));
exports.trend = async (req, res) => res.json(await svc.trend(req.user.id, req.user.settings.timezone));
exports.history = async (req, res) => {
  const q = req.query; const s = (x) => (typeof x === 'string' ? x : undefined);
  const f = { source: V.str(s(q.source), 'Source', { max: 60 }), from: V.dateStr(s(q.from), 'From', { required: false }), to: V.dateStr(s(q.to), 'To', { required: false }), page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)) };
  if (f.from && f.to && f.from > f.to) throw V.bad('"From" date must be before "To" date.');
  res.json(await svc.history(req.user.id, f));
};
