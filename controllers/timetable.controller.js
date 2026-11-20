const svc = require('../services/timetableService');
const V = require('../validators/timetable.validator');
const { objectId } = require('../validators/common');

const id = (req) => objectId(req.params.id, 'id'); const u = (req) => req.user.id;
exports.list = async (req, res) => res.json(await svc.list(u(req), req.user.settings.timezone));
exports.create = async (req, res) => res.status(201).json({ entry: await svc.create(u(req), V.parseEntry(req.body)) });
exports.update = async (req, res) => res.json({ entry: await svc.update(u(req), id(req), V.parseEntry(req.body)) });
exports.remove = async (req, res) => res.json({ entry: await svc.remove(u(req), id(req)) });
exports.restore = async (req, res) => res.json({ entry: await svc.restore(u(req), id(req)) });
