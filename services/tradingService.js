const { TradingAsset, TradingTransaction } = require('../models');
const C = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const { r2 } = require('../utils/money');
const D = require('../utils/dates');
const { oid } = require('./balanceService');
const ledger = require('./moduleLedger');
const { position, q8 } = require('./tradingMath');

const dupName = (e) => e && e.code === 11000 && new ApiError(409, 'You already track an asset with this name.', 'DUPLICATE');

async function getAsset(userId, id, { allowArchived = false } = {}) {
  const a = await TradingAsset.findOne({ _id: id, user: userId });
  if (!a || (a.archived && !allowArchived)) throw new ApiError(404, 'Asset not found.', 'NOT_FOUND');
  return a;
}
const liveTrades = (userId, assetId) => TradingTransaction.find({ user: userId, asset: assetId, deletedAt: null }).lean();

function assertOk(asset, trades) {
  const p = position(trades, asset.currentPrice);
  if (p.negativeAt) throw new ApiError(409, `You cannot sell more ${asset.symbol || asset.name} than you hold: this would leave ${q8(p.negativeAt.qtyAfter)} on ${p.negativeAt.date} (only ${p.negativeAt.qtyBefore} held then). Reduce the quantity, or fix the related buys/sells first.`, 'INSUFFICIENT_HOLDING', { available: p.negativeAt.qtyBefore, date: p.negativeAt.date });
  return p;
}

const publicStats = ({ rows, negativeAt, ...rest }) => rest;
async function withStats(userId, assets) {
  const trades = await TradingTransaction.find({ user: userId, deletedAt: null, asset: { $in: assets.map((a) => a._id) } }).lean();
  const by = new Map(); trades.forEach((t) => { const k = String(t.asset); if (!by.has(k)) by.set(k, []); by.get(k).push(t); });
  return assets.map((a) => ({ ...dto(a), stats: publicStats(position(by.get(String(a._id)) || [], a.currentPrice)), tradeCount: (by.get(String(a._id)) || []).length }));
}

async function listAssets(userId, { archived = false } = {}) {
  return withStats(userId, await TradingAsset.find({ user: userId, archived }).sort({ name: 1 }).collation({ locale: 'en' }).lean());
}
async function createAsset(userId, data) {
  try { const a = await TradingAsset.create({ ...data, user: userId, priceUpdatedAt: data.currentPrice != null ? new Date() : null }); return (await withStats(userId, [a]))[0]; } catch (e) { throw dupName(e) || e; }
}
async function updateAsset(userId, id, data) {
  const a = await getAsset(userId, id);
  if (data.currentPrice !== a.currentPrice) a.priceUpdatedAt = data.currentPrice != null ? new Date() : null;
  a.set(data);
  try { await a.save(); } catch (e) { throw dupName(e) || e; }
  return (await withStats(userId, [a]))[0];
}
async function setPrice(userId, id, { price }) {
  const a = await getAsset(userId, id); a.currentPrice = price; a.priceUpdatedAt = new Date(); await a.save();
  return (await withStats(userId, [a]))[0];
}
async function removeAsset(userId, id) {
  const a = await getAsset(userId, id);
  const used = await TradingTransaction.exists({ user: userId, asset: id });
  if (!used) { await a.deleteOne(); return { deleted: true, archived: false }; }
  const held = position(await liveTrades(userId, id)).qty;
  if (held > 0) throw new ApiError(409, `You still hold ${held} ${a.symbol || a.name}. Sell it (or delete the buys) before archiving this asset.`, 'HAS_HOLDING');
  a.archived = true; await a.save(); return { deleted: false, archived: true };
}
async function restoreAsset(userId, id) {
  const a = await getAsset(userId, id, { allowArchived: true }); a.archived = false;
  try { await a.save(); } catch (e) { throw dupName(e) || e; }
  return (await withStats(userId, [a]))[0];
}

/* ------------------------------------------------------------- trades */
function spec(t, asset) {
  if (!t.account) return null;
  const label = asset.symbol || asset.name;
  if (t.type === 'buy') return { type: 'expense', title: `Buy ${label} ×${t.quantity}`, amount: r2(t.quantity * t.price + (t.fee || 0)), date: t.date, account: t.account, categoryName: 'Investments', notes: t.notes, module: 'trading', moduleRef: t._id };
  const amount = r2(t.quantity * t.price - (t.fee || 0));
  if (amount <= 0) throw new ApiError(400, 'The sale proceeds after fees must be greater than zero to credit an account.', 'VALIDATION');
  return { type: 'income', title: `Sell ${label} ×${t.quantity}`, amount, date: t.date, account: t.account, categoryName: 'Trading proceeds', notes: t.notes, module: 'trading', moduleRef: t._id };
}
const checkSpec = (s) => { if (s && s.amount <= 0) throw new ApiError(400, 'The amount to post to the account must be greater than zero.', 'VALIDATION'); return s; };

async function createTrade(userId, data) {
  const asset = await getAsset(userId, data.asset);
  const doc = new TradingTransaction({ ...data, _id: ledger.newId(), user: userId });
  assertOk(asset, [...(await liveTrades(userId, asset._id)), { ...doc.toObject(), createdAt: new Date() }]);
  doc.transaction = await ledger.sync(userId, null, checkSpec(spec(doc, asset)));
  try { await doc.save(); } catch (e) { await ledger.hardDelete(doc.transaction); throw e; }
  return dto(doc);
}
async function getLiveTrade(userId, id) {
  const t = await TradingTransaction.findOne({ _id: id, user: userId, deletedAt: null });
  if (!t) throw new ApiError(404, 'Trade not found.', 'NOT_FOUND');
  return t;
}
async function updateTrade(userId, id, data) {
  const t = await getLiveTrade(userId, id);
  if (String(t.asset) !== String(data.asset)) throw new ApiError(400, 'A trade cannot be moved to another asset. Delete it and add it again.', 'VALIDATION');
  const asset = await getAsset(userId, t.asset, { allowArchived: true });
  const existing = await liveTrades(userId, t.asset);
  t.set(data);
  assertOk(asset, existing.map((x) => (String(x._id) === String(id) ? { ...t.toObject(), createdAt: x.createdAt } : x)));
  t.transaction = await ledger.sync(userId, t.transaction, checkSpec(spec(t, asset)));
  await t.save();
  return dto(t);
}
async function removeTrade(userId, id) {
  const t = await getLiveTrade(userId, id);
  const asset = await getAsset(userId, t.asset, { allowArchived: true });
  assertOk(asset, (await liveTrades(userId, t.asset)).filter((x) => String(x._id) !== String(id)));
  t.deletedAt = new Date(); await t.save(); await ledger.remove(userId, t.transaction);
  return dto(t);
}
async function restoreTrade(userId, id) {
  const t = await TradingTransaction.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!t) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  const asset = await getAsset(userId, t.asset, { allowArchived: true });
  assertOk(asset, [...(await liveTrades(userId, t.asset)), t.toObject()]);
  await ledger.restore(userId, t.transaction); t.deletedAt = null; await t.save();
  return dto(t);
}

async function listTrades(userId, f) {
  const match = { user: oid(userId), deletedAt: null };
  if (f.asset) match.asset = oid(f.asset);
  if (f.type) match.type = f.type;
  if (f.from || f.to) match.date = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  const [items, total] = await Promise.all([
    TradingTransaction.find(match).sort({ date: -1, createdAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    TradingTransaction.countDocuments(match),
  ]);
  const ids = [...new Set(items.map((i) => String(i.asset)))];
  const all = await TradingTransaction.find({ user: userId, deletedAt: null, asset: { $in: ids } }).lean();
  const by = new Map(); all.forEach((t) => { const k = String(t.asset); if (!by.has(k)) by.set(k, []); by.get(k).push(t); });
  const pos = new Map(ids.map((k) => [k, position(by.get(k) || [])]));
  return {
    items: items.map((i) => { const r = pos.get(String(i.asset)).rows.get(String(i._id)); return { ...dto(i), calc: { value: r.value, purchaseCost: r.purchaseCost, buyFees: r.buyFees, net: r.net, returnPct: r.returnPct, qtyAfter: r.qtyAfter } }; }),
    pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) },
  };
}

/* ------------------------------------------------------------- summaries */
async function snapshot(userId) {
  const assets = await TradingAsset.find({ user: userId }).lean();
  const trades = await TradingTransaction.find({ user: userId, deletedAt: null }).lean();
  const by = new Map(); trades.forEach((t) => { const k = String(t.asset); if (!by.has(k)) by.set(k, []); by.get(k).push(t); });
  return assets.map((a) => ({ asset: a, trades: by.get(String(a._id)) || [], pos: position(by.get(String(a._id)) || [], a.currentPrice) }));
}

/** Compact portfolio figures (used by the dashboard). Holdings without a manual price are valued at cost. */
async function portfolio(userId) {
  const snap = (await snapshot(userId)).filter((s) => s.pos.qty > 0);
  const costBasis = snap.reduce((s, x) => s + x.pos.costBasis, 0);
  const value = snap.reduce((s, x) => s + x.pos.valueOrCost, 0);
  const priced = snap.filter((x) => x.pos.value != null);
  const unrealized = priced.reduce((s, x) => s + x.pos.unrealized, 0);
  const pricedCost = priced.reduce((s, x) => s + x.pos.costBasis, 0);
  return { value: r2(value), costBasis: r2(costBasis), unrealized: r2(unrealized), unrealizedPct: pricedCost > 0 ? Math.round((unrealized / pricedCost) * 10000) / 100 : null, holdings: snap.length, unpriced: snap.length - priced.length };
}

async function summary(userId, tz, { from, to, all }) {
  const snap = await snapshot(userId);
  const held = snap.filter((s) => s.pos.qty > 0);
  const pf = await portfolio(userId);
  let realized = 0; let proceeds = 0; let bought = 0; let fees = 0; let wins = 0; let losses = 0; let soldCount = 0;
  const byMonth = new Map();
  for (const s of snap) for (const t of s.trades) {
    const r = s.pos.rows.get(String(t._id));
    if (t.date < from || t.date > to) continue;
    fees += t.fee || 0;
    if (t.type === 'buy') bought += t.quantity * t.price; else { proceeds += t.quantity * t.price; realized += r.net; soldCount += 1; if (r.net >= 0) wins += 1; else losses += 1; const k = t.date.slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + r.net); }
  }
  const months = []; const end = D.todayIn(tz); for (let d = D.addMonths(D.startOfMonth(end), -11); d <= end; d = D.addMonths(d, 1)) months.push(D.monthKey(d));
  return {
    range: { from: all ? null : from, to: all ? null : to },
    portfolio: pf,
    realized: r2(realized), proceeds: r2(proceeds), bought: r2(bought), fees: r2(fees), trades: soldCount, wins, losses, winRate: soldCount ? Math.round((wins / soldCount) * 1000) / 10 : null,
    allocation: held.map((s) => ({ id: String(s.asset._id), name: s.asset.name, symbol: s.asset.symbol, value: s.pos.valueOrCost, pct: pf.value > 0 ? Math.round((s.pos.valueOrCost / pf.value) * 1000) / 10 : 0, priced: s.pos.value != null })).sort((a, b) => b.value - a.value),
    realizedByMonth: months.map((k) => ({ key: k, net: r2(byMonth.get(k) || 0) })),
    bestAsset: snap.filter((s) => s.pos.soldQty > 0).sort((a, b) => b.pos.realized - a.pos.realized).slice(0, 1).map((s) => ({ name: s.asset.name, realized: s.pos.realized }))[0] || null,
    ledger: { note: 'Buys and sells move money in your accounts but are not counted as income or expenses.' },
  };
}

module.exports = { listAssets, createAsset, updateAsset, setPrice, removeAsset, restoreAsset, createTrade, updateTrade, removeTrade, restoreTrade, listTrades, summary, portfolio, getAsset, C };
