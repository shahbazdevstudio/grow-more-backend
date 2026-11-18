const svc = require('../services/darazService');
const V = require('../validators/daraz.validator');
const { parseModuleRange } = require('../validators/range');
const { objectId } = require('../validators/common');

const id = (req) => objectId(req.params.id, 'id');
const tz = (req) => req.user.settings.timezone;
const u = (req) => req.user.id;

exports.summary = async (req, res) => res.json(await svc.summary(u(req), tz(req), parseModuleRange(req.query, tz(req))));

exports.listProducts = async (req, res) => res.json({ products: await svc.listProducts(u(req), { archived: req.query.archived === 'true', q: typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '' }) });
exports.getProduct = async (req, res) => res.json({ product: await svc.getProductDetail(u(req), id(req)) });
exports.createProduct = async (req, res) => res.status(201).json({ product: await svc.createProduct(u(req), V.parseProduct(req.body)) });
exports.updateProduct = async (req, res) => res.json({ product: await svc.updateProduct(u(req), id(req), V.parseProduct(req.body)) });
exports.removeProduct = async (req, res) => res.json(await svc.removeProduct(u(req), id(req)));
exports.restoreProduct = async (req, res) => res.json({ product: await svc.restoreProduct(u(req), id(req)) });

exports.listMovements = async (req, res) => res.json(await svc.listMovements(u(req), V.parseMovementList(req.query)));
exports.createMovement = async (req, res) => res.status(201).json({ movement: await svc.createMovement(u(req), V.parseMovement(req.body, tz(req))) });
exports.updateMovement = async (req, res) => res.json({ movement: await svc.updateMovement(u(req), id(req), V.parseMovement(req.body, tz(req))) });
exports.removeMovement = async (req, res) => res.json({ movement: await svc.removeMovement(u(req), id(req)) });
exports.restoreMovement = async (req, res) => res.json({ movement: await svc.restoreMovement(u(req), id(req)) });
exports.receivePayout = async (req, res) => res.json({ movement: await svc.receivePayout(u(req), id(req), V.parsePayout(req.body)) });

exports.listExpenses = async (req, res) => res.json(await svc.listExpenses(u(req), V.parseExpenseList(req.query)));
exports.createExpense = async (req, res) => res.status(201).json({ expense: await svc.createExpense(u(req), V.parseDarazExpense(req.body, tz(req))) });
exports.updateExpense = async (req, res) => res.json({ expense: await svc.updateExpense(u(req), id(req), V.parseDarazExpense(req.body, tz(req))) });
exports.removeExpense = async (req, res) => res.json({ expense: await svc.removeExpense(u(req), id(req)) });
exports.restoreExpense = async (req, res) => res.json({ expense: await svc.restoreExpense(u(req), id(req)) });
