const C = require('../config/constants');
const v = require('./common');
const { addDays, todayIn } = require('../utils/dates');

/** Positive number with at most `dp` decimals (quantities & unit prices of crypto need up to 8). */
const decimal = (x, name, { dp = 8, required = true, allowZero = false, def = 0 } = {}) => {
  if (x === undefined || x === null || x === '') { if (required) throw v.bad(`${name} is required.`); return def; }
  if (typeof x === 'boolean' || typeof x === 'object') throw v.bad(`${name} must be a number.`);
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) throw v.bad(`${name} must be a valid positive number.`);
  if (Math.abs(n * 10 ** dp - Math.round(n * 10 ** dp)) > 1e-4) throw v.bad(`${name} can have at most ${dp} decimal places.`);
  if (!allowZero && n === 0) throw v.bad(`${name} must be greater than zero.`);
  if (n > 1e12) throw v.bad(`${name} is too large.`);
  return n;
};

exports.parseAsset = (b = {}) => ({
  name: v.str(b.name, 'Asset name', { required: true, max: 60 }),
  symbol: v.str(b.symbol, 'Symbol', { max: 12 }).toUpperCase(),
  type: v.oneOf(b.type, C.ASSET_TYPES, 'Type', { required: false, def: 'crypto' }),
  currentPrice: decimal(b.currentPrice, 'Current price', { required: false, allowZero: true, def: null }),
  notes: v.str(b.notes, 'Notes', { max: 500 }),
});
exports.parsePrice = (b = {}) => ({ price: decimal(b.price, 'Price', { allowZero: true }) });

exports.parseTrade = (b = {}, tz) => {
  const type = v.oneOf(b.type, ['buy', 'sell'], 'Type');
  const date = v.dateStr(b.date, 'Date');
  if (date > addDays(todayIn(tz), 1)) throw v.bad('Trade date cannot be in the future.');
  return {
    type, date,
    asset: v.objectId(b.asset, 'Asset'),
    quantity: decimal(b.quantity, 'Quantity'),
    price: decimal(b.price, 'Price per unit', { allowZero: true }),
    fee: v.money(b.fee, 'Fee', { required: false, allowZero: true, def: 0 }),
    account: v.objectId(b.account, type === 'buy' ? 'Paid-from account' : 'Receiving account', { required: false }),
    notes: v.str(b.notes, 'Notes', { max: 500 }),
  };
};

exports.parseTradeList = (q = {}) => {
  const s = (x) => (typeof x === 'string' ? x : undefined);
  const out = {
    asset: v.objectId(s(q.asset), 'Asset', { required: false }), type: v.oneOf(s(q.type), ['buy', 'sell'], 'Type', { required: false }),
    from: v.dateStr(s(q.from), 'From', { required: false }), to: v.dateStr(s(q.to), 'To', { required: false }),
    page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)),
  };
  if (out.from && out.to && out.from > out.to) throw v.bad('"From" date must be before "To" date.');
  return out;
};
