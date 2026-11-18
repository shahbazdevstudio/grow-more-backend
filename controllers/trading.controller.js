const svc = require('../services/tradingService');
const V = require('../validators/trading.validator');
const { parseModuleRange } = require('../validators/range');
const { objectId } = require('../validators/common');

const id = (req) => objectId(req.params.id, 'id'); const u = (req) => req.user.id; const tz = (req) => req.user.settings.timezone;
exports.summary = async (req, res) => res.json(await svc.summary(u(req), tz(req), parseModuleRange(req.query, tz(req))));
exports.listAssets = async (req, res) => res.json({ assets: await svc.listAssets(u(req), { archived: req.query.archived === 'true' }) });
exports.createAsset = async (req, res) => res.status(201).json({ asset: await svc.createAsset(u(req), V.parseAsset(req.body)) });
exports.updateAsset = async (req, res) => res.json({ asset: await svc.updateAsset(u(req), id(req), V.parseAsset(req.body)) });
exports.setPrice = async (req, res) => res.json({ asset: await svc.setPrice(u(req), id(req), V.parsePrice(req.body)) });
exports.removeAsset = async (req, res) => res.json(await svc.removeAsset(u(req), id(req)));
exports.restoreAsset = async (req, res) => res.json({ asset: await svc.restoreAsset(u(req), id(req)) });
exports.listTrades = async (req, res) => res.json(await svc.listTrades(u(req), V.parseTradeList(req.query)));
exports.createTrade = async (req, res) => res.status(201).json({ trade: await svc.createTrade(u(req), V.parseTrade(req.body, tz(req))) });
exports.updateTrade = async (req, res) => res.json({ trade: await svc.updateTrade(u(req), id(req), V.parseTrade(req.body, tz(req))) });
exports.removeTrade = async (req, res) => res.json({ trade: await svc.removeTrade(u(req), id(req)) });
exports.restoreTrade = async (req, res) => res.json({ trade: await svc.restoreTrade(u(req), id(req)) });
