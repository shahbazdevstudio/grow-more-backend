const { CodingRecord } = require('../models');
const C = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');
const { r2 } = require('../utils/money');
const { escapeRegex } = require('../utils/text');
const D = require('../utils/dates');
const { oid } = require('./balanceService');
const ledger = require('./moduleLedger');

const LABEL = { ...C.CODING_INCOME, ...C.CODING_EXPENSE };

const txSpec = (rec) => (rec.status !== 'paid' ? null : {
  type: rec.kind, title: rec.kind === 'income' ? `${rec.client ? `${rec.client} – ` : ''}${rec.title}` : rec.title,
  amount: rec.amount, date: rec.date, account: rec.account, categoryName: C.CODING_LEDGER[rec.category],
  notes: [rec.project && `Project: ${rec.project}`, rec.notes].filter(Boolean).join('\n'), module: 'coding', moduleRef: rec._id,
});

async function getLive(userId, id) {
  const rec = await CodingRecord.findOne({ _id: id, user: userId, deletedAt: null });
  if (!rec) throw new ApiError(404, 'Record not found.', 'NOT_FOUND');
  return rec;
}

async function create(userId, data) {
  const _id = ledger.newId();
  const rec = new CodingRecord({ ...data, _id, user: userId });
  rec.transaction = await ledger.sync(userId, null, txSpec(rec));
  try { await rec.save(); } catch (e) { await ledger.hardDelete(rec.transaction); throw e; }
  return dto(rec);
}

async function update(userId, id, data) {
  const rec = await getLive(userId, id);
  rec.set({ ...data, dueDate: data.dueDate || null });
  rec.transaction = await ledger.sync(userId, rec.transaction, txSpec(rec));
  if (rec.status === 'pending') rec.account = null;
  await rec.save();
  return dto(rec);
}

async function remove(userId, id) {
  const rec = await getLive(userId, id);
  rec.deletedAt = new Date(); await rec.save();
  await ledger.remove(userId, rec.transaction);
  return dto(rec);
}

async function restore(userId, id) {
  const rec = await CodingRecord.findOne({ _id: id, user: userId, deletedAt: { $ne: null } });
  if (!rec) throw new ApiError(404, 'Nothing to restore.', 'NOT_FOUND');
  await ledger.restore(userId, rec.transaction);
  rec.deletedAt = null; await rec.save();
  return dto(rec);
}

/** A pending invoice was paid: choose the account that received the money → becomes a paid income record + ledger entry. */
async function receive(userId, id, { account, date }) {
  const rec = await getLive(userId, id);
  if (rec.kind !== 'income' || rec.status !== 'pending') throw new ApiError(400, 'This record is not a pending payment.', 'VALIDATION');
  Object.assign(rec, { status: 'paid', account, date });
  rec.transaction = await ledger.sync(userId, null, txSpec(rec));
  try { await rec.save(); } catch (e) { await ledger.hardDelete(rec.transaction); throw e; }
  return dto(rec);
}

async function list(userId, f) {
  const match = { user: oid(userId), deletedAt: null };
  if (f.kind) match.kind = f.kind;
  if (f.status) match.status = f.status;
  if (f.category) match.category = f.category;
  if (f.from || f.to) match.date = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  if (f.q) { const re = new RegExp(escapeRegex(f.q), 'i'); match.$or = [{ title: re }, { client: re }, { project: re }, { notes: re }]; }
  const [items, total] = await Promise.all([
    CodingRecord.find(match).sort({ date: -1, createdAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    CodingRecord.countDocuments(match),
  ]);
  return { items: items.map(dto), pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) } };
}

const sumBy = (rows, key) => rows.map((r) => ({ key: r._id, amount: r2(r.amount), count: r.count }));

async function summary(userId, tz, { from, to, all }) {
  const base = { user: oid(userId), deletedAt: null };
  const inRange = { ...base, status: 'paid', date: { $gte: from, $lte: to } };
  const today = D.todayIn(tz);
  const [byKind, byCat, byClient, pending, lifetime] = await Promise.all([
    CodingRecord.aggregate([{ $match: inRange }, { $group: { _id: '$kind', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    CodingRecord.aggregate([{ $match: inRange }, { $group: { _id: { k: '$kind', c: '$category' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    CodingRecord.aggregate([{ $match: { ...inRange, kind: 'income', client: { $ne: '' } } }, { $group: { _id: '$client', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }, { $limit: 5 }]),
    CodingRecord.find({ ...base, status: 'pending' }).select('amount dueDate').lean(),
    CodingRecord.aggregate([{ $match: { ...base, status: 'paid' } }, { $group: { _id: '$kind', amount: { $sum: '$amount' } } }]),
  ]);
  const k = Object.fromEntries(byKind.map((x) => [x._id, x]));
  const life = Object.fromEntries(lifetime.map((x) => [x._id, x.amount]));
  const income = r2(k.income?.amount || 0), expenses = r2(k.expense?.amount || 0);
  const overdue = pending.filter((p) => p.dueDate && p.dueDate < today);
  return {
    range: { from: all ? null : from, to: all ? null : to },
    income, expenses, net: r2(income - expenses), margin: income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : null,
    incomeCount: k.income?.count || 0, expenseCount: k.expense?.count || 0,
    pending: { total: r2(pending.reduce((s, p) => s + p.amount, 0)), count: pending.length, overdueTotal: r2(overdue.reduce((s, p) => s + p.amount, 0)), overdueCount: overdue.length },
    availableCash: r2((life.income || 0) - (life.expense || 0)), // all-time money received from coding minus coding costs paid
    incomeByCategory: sumBy(byCat.filter((x) => x._id.k === 'income').map((x) => ({ ...x, _id: x._id.c })), 'c').map((x) => ({ ...x, label: LABEL[x.key] })),
    expenseByCategory: sumBy(byCat.filter((x) => x._id.k === 'expense').map((x) => ({ ...x, _id: x._id.c })), 'c').map((x) => ({ ...x, label: LABEL[x.key] })),
    topClients: byClient.map((x) => ({ client: x._id, amount: r2(x.amount), count: x.count })),
  };
}

/** Monthly (last 12 months) or yearly (every year with data) income / expense / profit. */
async function report(userId, tz, period) {
  const today = D.todayIn(tz);
  const monthly = period === 'month';
  const from = monthly ? D.addMonths(D.startOfMonth(today), -11) : '0000-01-01';
  const rows = await CodingRecord.aggregate([
    { $match: { user: oid(userId), deletedAt: null, status: 'paid', date: { $gte: from, $lte: today } } },
    { $group: { _id: { k: { $substr: ['$date', 0, monthly ? 7 : 4] }, t: '$kind' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const map = new Map();
  for (const r of rows) { const e = map.get(r._id.k) || { key: r._id.k, income: 0, expense: 0, count: 0 }; e[r._id.t] += r.amount; e.count += r.count; map.set(r._id.k, e); }
  let keys = [];
  if (monthly) for (let d = from; d <= today; d = D.addMonths(d, 1)) keys.push(D.monthKey(d));
  else { const ys = [...map.keys()].sort(); const y0 = ys.length ? Number(ys[0]) : Number(today.slice(0, 4)); for (let y = y0; y <= Number(today.slice(0, 4)); y++) keys.push(String(y)); }
  const buckets = keys.map((k) => { const e = map.get(k) || { key: k, income: 0, expense: 0, count: 0 }; return { key: k, income: r2(e.income), expense: r2(e.expense), net: r2(e.income - e.expense), count: e.count }; });
  const tot = buckets.reduce((s, b) => ({ income: s.income + b.income, expense: s.expense + b.expense }), { income: 0, expense: 0 });
  return { period, buckets, totals: { income: r2(tot.income), expense: r2(tot.expense), net: r2(tot.income - tot.expense) } };
}

async function incomeBetween(userId, from, to) {
  const r = await CodingRecord.aggregate([{ $match: { user: oid(userId), deletedAt: null, status: 'paid', kind: 'income', date: { $gte: from, $lte: to } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]);
  return r2(r[0]?.amount || 0);
}

module.exports = { incomeBetween, create, update, remove, restore, receive, list, summary, report };
