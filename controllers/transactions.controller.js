const svc = require('../services/transactionService');
const { parseTransaction, parseListQuery } = require('../validators/transaction.validator');
const { objectId } = require('../validators/common');

exports.list = async (req, res) => res.json(await svc.list(req.user.id, parseListQuery(req.query)));
exports.get = async (req, res) => res.json({ transaction: await svc.getOne(req.user.id, objectId(req.params.id, 'id')) });
exports.create = async (req, res) => {
  const { transaction, duplicate } = await svc.create(req.user.id, parseTransaction(req.body, req.user.settings.timezone));
  res.status(duplicate ? 200 : 201).json({ transaction, duplicate });
};
exports.update = async (req, res) => res.json({ transaction: await svc.update(req.user.id, objectId(req.params.id, 'id'), parseTransaction(req.body, req.user.settings.timezone)) });
exports.remove = async (req, res) => res.json({ transaction: await svc.remove(req.user.id, objectId(req.params.id, 'id')) });
exports.restore = async (req, res) => res.json({ transaction: await svc.restore(req.user.id, objectId(req.params.id, 'id')) });
