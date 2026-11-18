const svc = require('../services/codingService');
const { parseCoding, parseReceive, parseCodingList } = require('../validators/coding.validator');
const { parseModuleRange } = require('../validators/range');
const { objectId, oneOf } = require('../validators/common');

const id = (req) => objectId(req.params.id, 'id');
exports.list = async (req, res) => res.json(await svc.list(req.user.id, parseCodingList(req.query)));
exports.create = async (req, res) => res.status(201).json({ record: await svc.create(req.user.id, parseCoding(req.body, req.user.settings.timezone)) });
exports.update = async (req, res) => res.json({ record: await svc.update(req.user.id, id(req), parseCoding(req.body, req.user.settings.timezone)) });
exports.remove = async (req, res) => res.json({ record: await svc.remove(req.user.id, id(req)) });
exports.restore = async (req, res) => res.json({ record: await svc.restore(req.user.id, id(req)) });
exports.receive = async (req, res) => res.json({ record: await svc.receive(req.user.id, id(req), parseReceive(req.body)) });
exports.summary = async (req, res) => res.json(await svc.summary(req.user.id, req.user.settings.timezone, parseModuleRange(req.query, req.user.settings.timezone)));
exports.report = async (req, res) => res.json(await svc.report(req.user.id, req.user.settings.timezone, oneOf(req.query.period, ['month', 'year'], 'Period', { required: false, def: 'month' })));
