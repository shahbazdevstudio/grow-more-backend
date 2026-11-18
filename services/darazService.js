const { DarazProduct, DarazStockMovement, DarazExpense, Transaction } = require('../models');
const images = require('./imageService');
const C = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const { r2 } = require('../utils/money');
const { escapeRegex } = require('../utils/text');
const D = require('../utils/dates');
const { oid } = require('./balanceService');
const ledger = require('./moduleLedger');
const { walk, totalsInRange } = require('./darazMath');

const dupSku = (e) => e && e.code === 11000 && new ApiError(409, 'You already have a product with this SKU.', 'DUPLICATE');

/* ------------------------------------------------------------------ products */
async function getProduct(userId, id, { allowArchived = false } = {}) {
  const p = await DarazProduct.findOne({ _id: id, user: userId });
  if (!p || (p.archived && !allowArchived)) throw new ApiError(404, 'Product not found.', 'NOT_FOUND');
  return p;
}
const liveMovements = (userId, productId) => DarazStockMovement.find({ user: userId, product: productId, deletedAt: null }).lean();

/** Refuse any change that would make stock negative at any point in time. */
function assertStockOk(product, movements) {
  const r = walk(movements, product.purchasePrice);
  if (r.negativeAt) {
    throw new ApiError(409, `Not enough stock of "${product.name}": this would leave ${r.negativeAt.qtyAfter} on ${r.negativeAt.date} (only ${r.negativeAt.qtyBefore} available then). Reduce the quantity, or fix the related purchases/sales first.`, 'INSUFFICIENT_STOCK', { available: r.negativeAt.qtyBefore, date: r.negativeAt.date });
  }
  return r;
}

function productStats(product, movs, linkedExpenses = 0) {
  const w = walk(movs, product.purchasePrice);
  let purchased = 0, sold = 0, lost = 0, invested = 0, revenue = 0, cogs = 0, fees = 0, loss = 0, lastSale = null, lastPurchase = null;
  for (const m of movs) {
    const row = w.rows.get(String(m._id));
    if (m.type === 'purchase') { purchased += m.quantity; invested += row.cost; if (!lastPurchase || m.date > lastPurchase) lastPurchase = m.date; }
    if (m.type === 'adjust_in') purchased += m.quantity;
    if (m.type === 'sale') { sold += m.quantity; revenue += row.revenue; cogs += row.cogs; fees += row.fees; if (!lastSale || m.date > lastSale) lastSale = m.date; }
    if (m.type === 'writeoff') { lost += m.quantity; loss += row.loss; }
  }
  const gross = r2(revenue - cogs);
  const net = r2(gross - fees - loss - linkedExpenses);
  return {
    stock: w.qty, avgCost: w.avgCost, stockValue: w.value, purchased, sold, lost, invested: r2(invested),
    revenue: r2(revenue), cogs: r2(cogs), grossProfit: gross, fees: r2(fees), writeoffLoss: r2(loss), linkedExpenses: r2(linkedExpenses), netProfit: net,
    marginPct: revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : null,
    status: w.qty <= 0 ? 'out' : w.qty <= product.lowStockAt ? 'low' : 'ok', lastSale, lastPurchase,
  };
}

async function withStats(userId, products) {
  const ids = products.map((p) => p._id);
  const [movs, exps] = await Promise.all([
    DarazStockMovement.find({ user: userId, deletedAt: null, product: { $in: ids } }).lean(),
    DarazExpense.aggregate([{ $match: { user: oid(userId), deletedAt: null, product: { $in: ids } } }, { $group: { _id: '$product', amount: { $sum: '$amount' } } }]),
  ]);
  const by = new Map(); movs.forEach((m) => { const k = String(m.product); if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  const ex = new Map(exps.map((e) => [String(e._id), e.amount]));
  return products.map((p) => ({ ...dto(p), stats: productStats(p, by.get(String(p._id)) || [], ex.get(String(p._id)) || 0) }));
}

async function listProducts(userId, { archived = false, q = '' } = {}) {
  const match = { user: userId, archived };
  if (q) { const re = new RegExp(escapeRegex(q), 'i'); match.$or = [{ name: re }, { sku: re }, { category: re }, { supplierName: re }]; }
  const products = await DarazProduct.find(match).sort({ name: 1 }).collation({ locale: 'en' }).lean();
  return withStats(userId, products);
}
async function getProductDetail(userId, id) {
  const p = await getProduct(userId, id, { allowArchived: true });
  const [full] = await withStats(userId, [p]);
  return full;
}
async function createProduct(userId, data) {
  const img = await images.prepare(data.image, { sub: 'products' }); // uploads to Cloudinary (if a new photo was sent)
  try { const p = await DarazProduct.create({ ...data, image: img.url, imagePublicId: img.publicId, user: userId }); return (await withStats(userId, [p]))[0]; } catch (e) { await img.rollback(); throw dupSku(e) || e; }
}
async function updateProduct(userId, id, data) {
  const p = await getProduct(userId, id);
  const img = await images.prepare(data.image, { sub: 'products', current: { url: p.image, publicId: p.imagePublicId } });
  p.set({ ...data, image: img.url, imagePublicId: img.publicId });
  try { await p.save(); } catch (e) { await img.rollback(); throw dupSku(e) || e; }
  await img.commit(); // removes the previous photo from Cloudinary if it was replaced or removed
  return (await withStats(userId, [p]))[0];
}
async function removeProduct(userId, id) {
  const p = await getProduct(userId, id);
  const [m, e] = await Promise.all([DarazStockMovement.exists({ user: userId, product: id }), DarazExpense.exists({ user: userId, product: id })]);
  if (!m && !e) { await p.deleteOne(); await images.destroy(p.imagePublicId); return { deleted: true, archived: false }; }
  const stats = (await withStats(userId, [p]))[0].stats;
  if (stats.stock > 0) throw new ApiError(409, `This product still has ${stats.stock} in stock. Sell or write off the stock first, then archive it.`, 'HAS_STOCK');
  p.archived = true; await p.save();
  return { deleted: false, archived: true };
}
async function restoreProduct(userId, id) {
  const p = await getProduct(userId, id, { allowArchived: true });
  p.archived = false;
  try { await p.save(); } catch (e) { throw dupSku(e) || e; }
  return (await withStats(userId, [p]))[0];
}

/* ------------------------------------------------------------------ stock movements */
function moveSpec(m, product) {
  if (m.type === 'purchase' && m.account) {
    const amount = r2(m.quantity * m.unitCost);
    if (amount <= 0) throw new ApiError(400, 'The cost must be greater than zero when paying from an account.', 'VALIDATION');
    return { type: 'expense', title: `Stock: ${product.name} ×${m.quantity}`, amount, date: m.date, account: m.account, categoryName: C.DARAZ_LEDGER.inventory, notes: [m.supplier && `Supplier: ${m.supplier}`, m.notes].filter(Boolean).join('\n'), module: 'daraz', moduleRef: m._id };
  }
  if (m.type === 'sale' && m.account) {
    return { type: 'income', title: `Sale: ${product.name} ×${m.quantity}`, amount: r2(m.quantity * m.unitPrice - (m.fees || 0)), date: m.receivedOn || m.date, account: m.account, categoryName: C.DARAZ_LEDGER.sales, notes: [m.orderRef && `Order ${m.orderRef}`, m.fees ? `Platform fees: ${m.fees}` : '', m.notes].filter(Boolean).join('\n'), module: 'daraz', moduleRef: m._id };
  }
  return null;
}

async function createMovement(userId, data) {
  const product = await getProduct(userId, data.product);
  const _id = ledger.newId();
  const doc = new DarazStockMovement({ ...data, _id, user: userId });
  assertStockOk(product, [...(await liveMovements(userId, product._id)), { ...doc.toObject(), createdAt: new Date() }]);
  doc.transaction = await ledger.sync(userId, null, moveSpec(doc, product));
  try { await doc.save(); } catch (e) { await ledger.hardDelete(doc.transaction); throw e; }
  return dto(doc);
}

async function getLiveMovement(userId, id) {
  const m = await DarazStockMovement.findOne({ _id: id, user: userId, deletedAt: null });
  if (!m) throw new ApiError(404, 'Stock entry not found.', 'NOT_FOUND');
  return m;
}

async function updateMovement(userId, id, data) {
  const m = await getLiveMovement(userId, id);
  if (String(m.product) !== String(data.product)) throw new ApiError(400, 'A stock entry cannot be moved to another product. Delete it and add it again.', 'VALIDATION');
  const product = await getProduct(userId, m.product, { allowArchived: true });
  const existing = await liveMovements(userId, m.product);
  m.set({ ...data, receivedOn: data.account ? data.receivedOn : null });
  assertStockOk(product, existing.map((x) => (String(x._id) === String(id) ? { ...m.toObject(), createdAt: x.createdAt } : x)));
  m.transaction = await ledger.sync(userId, m.transaction, moveSpec(m, product));
  await m.save();
  return dto(m);
}

async function removeMovement(userId, id) {
  const m = await getLiveMovement(userId, id);
  const product = await getProduct(userId, m.product, { allowArchived: true });
  assertStockOk(product, (await liveMovements(userId, m.product)).filter((x) => String(x._id) !== String(id)));
  m.deletedAt = new Date(); await m.save();
  await ledger.remove(userId, m.transaction);
  return dto(m);
}

async function restoreMovement(userId, id) {
  const m = await DarazStockMovement.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!m) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  const product = await getProduct(userId, m.product, { allowArchived: true });
  assertStockOk(product, [...(await liveMovements(userId, m.product)), m.toObject()]);
  await ledger.restore(userId, m.transaction);
  m.deletedAt = null; await m.save();
  return dto(m);
}

/** Daraz paid you for a sale that was waiting for its payout → money lands in the chosen account. */
async function receivePayout(userId, id, { account, date }) {
  const m = await getLiveMovement(userId, id);
  if (m.type !== 'sale' || m.account) throw new ApiError(400, 'This sale is not waiting for a payout.', 'VALIDATION');
  const product = await getProduct(userId, m.product, { allowArchived: true });
  Object.assign(m, { account, receivedOn: date });
  m.transaction = await ledger.sync(userId, null, moveSpec(m, product));
  try { await m.save(); } catch (e) { await ledger.hardDelete(m.transaction); throw e; }
  return dto(m);
}

async function listMovements(userId, f) {
  const match = { user: oid(userId), deletedAt: null };
  if (f.product) match.product = oid(f.product);
  if (f.type) match.type = f.type;
  if (f.payout === 'pending') { match.type = 'sale'; match.account = null; }
  if (f.from || f.to) match.date = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  const [items, total] = await Promise.all([
    DarazStockMovement.find(match).sort({ date: -1, createdAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    DarazStockMovement.countDocuments(match),
  ]);
  const pids = [...new Set(items.map((i) => String(i.product)))];
  const [prods, all] = await Promise.all([
    DarazProduct.find({ user: userId, _id: { $in: pids } }).select('purchasePrice').lean(),
    DarazStockMovement.find({ user: userId, deletedAt: null, product: { $in: pids } }).lean(),
  ]);
  const fb = new Map(prods.map((p) => [String(p._id), p.purchasePrice]));
  const by = new Map(); all.forEach((m) => { const k = String(m.product); if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  const walks = new Map(pids.map((k) => [k, walk(by.get(k) || [], fb.get(k) || 0)]));
  return {
    items: items.map((i) => { const row = walks.get(String(i.product)).rows.get(String(i._id)); return { ...dto(i), calc: { qtyAfter: row.qtyAfter, cogs: row.cogs, revenue: row.revenue, gross: row.gross ?? null, loss: row.loss, cost: row.cost, avgCostAfter: row.avgCostAfter } }; }),
    pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) },
  };
}

/* ------------------------------------------------------------------ business expenses */
async function checkProductRef(userId, id) { if (id) await getProduct(userId, id, { allowArchived: true }); }
const expenseSpec = (e) => (e.account ? { type: 'expense', title: e.title, amount: e.amount, date: e.date, account: e.account, categoryName: C.DARAZ_LEDGER[e.category], notes: e.notes, module: 'daraz', moduleRef: e._id } : null);

async function createExpense(userId, data) {
  await checkProductRef(userId, data.product);
  const doc = new DarazExpense({ ...data, _id: ledger.newId(), user: userId });
  doc.transaction = await ledger.sync(userId, null, expenseSpec(doc));
  try { await doc.save(); } catch (e) { await ledger.hardDelete(doc.transaction); throw e; }
  return dto(doc);
}
async function getLiveExpense(userId, id) {
  const e = await DarazExpense.findOne({ _id: id, user: userId, deletedAt: null });
  if (!e) throw new ApiError(404, 'Expense not found.', 'NOT_FOUND');
  return e;
}
async function updateExpense(userId, id, data) {
  const e = await getLiveExpense(userId, id);
  await checkProductRef(userId, data.product);
  e.set(data);
  e.transaction = await ledger.sync(userId, e.transaction, expenseSpec(e));
  await e.save();
  return dto(e);
}
async function removeExpense(userId, id) { const e = await getLiveExpense(userId, id); e.deletedAt = new Date(); await e.save(); await ledger.remove(userId, e.transaction); return dto(e); }
async function restoreExpense(userId, id) {
  const e = await DarazExpense.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!e) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  await ledger.restore(userId, e.transaction); e.deletedAt = null; await e.save(); return dto(e);
}
async function listExpenses(userId, f) {
  const match = { user: oid(userId), deletedAt: null };
  if (f.category) match.category = f.category;
  if (f.product) match.product = oid(f.product);
  if (f.from || f.to) match.date = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  if (f.q) { const re = new RegExp(escapeRegex(f.q), 'i'); match.$or = [{ title: re }, { notes: re }]; }
  const [items, total, sums] = await Promise.all([
    DarazExpense.find(match).sort({ date: -1, createdAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    DarazExpense.countDocuments(match),
    DarazExpense.aggregate([{ $match: match }, { $group: { _id: '$category', amount: { $sum: '$amount' } } }]),
  ]);
  return { items: items.map(dto), pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) },
    summary: { total: r2(sums.reduce((s, x) => s + x.amount, 0)), byCategory: sums.map((x) => ({ key: x._id, label: C.DARAZ_EXPENSE[x._id], amount: r2(x.amount) })) } };
}

/* ------------------------------------------------------------------ summary */
async function businessBalance(userId) {
  const [t, pend] = await Promise.all([
    Transaction.aggregate([{ $match: { user: oid(userId), deletedAt: null, module: 'daraz' } }, { $group: { _id: '$type', amount: { $sum: '$amount' } } }]),
    DarazStockMovement.aggregate([{ $match: { user: oid(userId), deletedAt: null, type: 'sale', account: null } }, { $group: { _id: null, amount: { $sum: { $subtract: [{ $multiply: ['$quantity', '$unitPrice'] }, '$fees'] } }, count: { $sum: 1 } } }]),
  ]);
  const k = Object.fromEntries(t.map((x) => [x._id, x.amount]));
  return { balance: r2((k.income || 0) - (k.expense || 0)), received: r2(k.income || 0), spent: r2(k.expense || 0), pendingPayouts: r2(pend[0]?.amount || 0), pendingCount: pend[0]?.count || 0 };
}

async function summary(userId, tz, { from, to, all }) {
  const products = await DarazProduct.find({ user: userId }).lean();
  const [movs, expRange, expAll, expByProduct, bal] = await Promise.all([
    DarazStockMovement.find({ user: userId, deletedAt: null }).lean(),
    DarazExpense.aggregate([{ $match: { user: oid(userId), deletedAt: null, date: { $gte: from, $lte: to } } }, { $group: { _id: '$category', amount: { $sum: '$amount' } } }]),
    DarazExpense.aggregate([{ $match: { user: oid(userId), deletedAt: null } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    DarazExpense.aggregate([{ $match: { user: oid(userId), deletedAt: null, product: { $ne: null }, date: { $gte: from, $lte: to } } }, { $group: { _id: '$product', amount: { $sum: '$amount' } } }]),
    businessBalance(userId),
  ]);
  const by = new Map(); movs.forEach((m) => { const k = String(m.product); if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  const pe = new Map(expByProduct.map((e) => [String(e._id), e.amount]));
  const T = { purchaseCost: 0, revenue: 0, cogs: 0, fees: 0, writeoffLoss: 0 }; const allT = { purchaseCost: 0, revenue: 0 };
  let units = 0, value = 0; const low = []; const ranked = [];
  for (const p of products) {
    const w = walk(by.get(String(p._id)) || [], p.purchasePrice);
    const t = totalsInRange(w.rows, from, to); const ta = totalsInRange(w.rows, '0000-01-01', '9999-12-31');
    for (const k of Object.keys(T)) T[k] += t[k];
    allT.purchaseCost += ta.purchaseCost; allT.revenue += ta.revenue;
    if (!p.archived) {
      units += w.qty; value += w.value;
      if (w.qty <= p.lowStockAt) low.push({ id: String(p._id), name: p.name, stock: w.qty, lowStockAt: p.lowStockAt, status: w.qty <= 0 ? 'out' : 'low' });
    }
    const net = t.revenue - t.cogs - t.fees - t.writeoffLoss - (pe.get(String(p._id)) || 0);
    if (t.revenue > 0 || t.cogs > 0) ranked.push({ id: String(p._id), name: p.name, revenue: r2(t.revenue), net: r2(net), sold: [...w.rows.values()].filter((r) => r.type === 'sale' && r.date >= from && r.date <= to).length });
  }
  const expenses = r2(expRange.reduce((s, x) => s + x.amount, 0));
  const fees = r2(T.fees);
  const grossProfit = r2(T.revenue - T.cogs);
  const net = r2(grossProfit - fees - T.writeoffLoss - expenses);
  const investedAll = r2(allT.purchaseCost + (expAll[0]?.amount || 0));
  return {
    range: { from: all ? null : from, to: all ? null : to },
    purchases: r2(T.purchaseCost), expenses, totalInvestment: r2(T.purchaseCost + expenses),
    revenue: r2(T.revenue), cogs: r2(T.cogs), grossProfit, platformFees: fees, writeoffLoss: r2(T.writeoffLoss), netProfit: net,
    marginPct: T.revenue > 0 ? Math.round((net / T.revenue) * 1000) / 10 : null,
    expenseBreakdown: [...expRange.map((x) => ({ key: x._id, label: C.DARAZ_EXPENSE[x._id], amount: r2(x.amount) })), ...(fees ? [{ key: 'fees', label: 'Platform fees', amount: fees }] : [])].sort((a, b) => b.amount - a.amount),
    stock: { units, value: r2(value), products: products.filter((p) => !p.archived).length, low: low.sort((a, b) => a.stock - b.stock) },
    allTime: { invested: investedAll, revenue: r2(allT.revenue), recoveredPct: investedAll > 0 ? Math.min(100, Math.round((allT.revenue / investedAll) * 1000) / 10) : null },
    balance: bal,
    topProducts: ranked.sort((a, b) => b.net - a.net).slice(0, 5),
  };
}

module.exports = { listProducts, getProductDetail, createProduct, updateProduct, removeProduct, restoreProduct, createMovement, updateMovement, removeMovement, restoreMovement, receivePayout, listMovements, createExpense, updateExpense, removeExpense, restoreExpense, listExpenses, summary, businessBalance };
