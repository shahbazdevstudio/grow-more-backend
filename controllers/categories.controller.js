const svc = require('../services/categoryService');
const { parseCategory } = require('../validators/settings.validator');
const { objectId } = require('../validators/common');

exports.list = async (req, res) => res.json({ categories: await svc.list(req.user.id) });
exports.create = async (req, res) => res.status(201).json({ category: await svc.create(req.user.id, parseCategory(req.body)) });
exports.remove = async (req, res) => res.json(await svc.remove(req.user.id, objectId(req.params.id, 'id')));
