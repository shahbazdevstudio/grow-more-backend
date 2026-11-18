const svc = require('../services/accountService');
const { parseAccount } = require('../validators/account.validator');
const { objectId } = require('../validators/common');

exports.list = async (req, res) => res.json({ accounts: await svc.list(req.user.id, { archived: req.query.archived === 'true' }) });
exports.create = async (req, res) => res.status(201).json({ account: await svc.create(req.user.id, parseAccount(req.body)) });
exports.update = async (req, res) => res.json({ account: await svc.update(req.user.id, objectId(req.params.id, 'id'), parseAccount(req.body)) });
exports.remove = async (req, res) => res.json(await svc.remove(req.user.id, objectId(req.params.id, 'id')));
exports.restore = async (req, res) => res.json({ account: await svc.restore(req.user.id, objectId(req.params.id, 'id')) });
