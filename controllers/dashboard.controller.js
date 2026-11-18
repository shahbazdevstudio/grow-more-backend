const svc = require('../services/dashboardService');
exports.get = async (req, res) => res.json(await svc.get(req.user.id, req.user.settings.timezone));
