const svc = require('../services/budgetService');
const { parseBudget } = require('../validators/budget.validator');

exports.get = async (req, res) => res.json(await svc.progress(req.user.id, req.user.settings.timezone));
exports.save = async (req, res) => {
  await svc.save(req.user.id, parseBudget(req.body));
  res.json(await svc.progress(req.user.id, req.user.settings.timezone));
};
