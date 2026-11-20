const svc = require('../services/challengeService');
const V = require('../validators/challenge.validator');
const { objectId } = require('../validators/common');

const id = (req) => objectId(req.params.id, 'id'); const u = (req) => req.user.id; const tz = (req) => req.user.settings.timezone;
exports.list = async (req, res) => res.json(await svc.list(u(req), tz(req)));
exports.get = async (req, res) => res.json({ challenge: await svc.get(u(req), tz(req), id(req)) });
exports.create = async (req, res) => res.status(201).json({ challenge: await svc.create(u(req), tz(req), V.parseChallenge(req.body)) });
exports.update = async (req, res) => res.json({ challenge: await svc.update(u(req), tz(req), id(req), V.parseChallenge(req.body)) });
exports.setTask = async (req, res) => {
  const { taskId, done } = V.parseDayToggle(req.body);
  res.json({ challenge: await svc.setTask(u(req), tz(req), id(req), V.parseDate(req.params.date), taskId, done) });
};
exports.remove = async (req, res) => res.json(await svc.remove(u(req), id(req)));
exports.restore = async (req, res) => res.json({ challenge: await svc.restore(u(req), tz(req), id(req)) });
