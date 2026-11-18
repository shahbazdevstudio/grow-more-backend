const C = require('../config/constants');
const v = require('./common');
const { addDays, todayIn } = require('../utils/dates');

const { imageField } = require('./image');
const int = (x, name, { min = 0, required = true, def = 0 } = {}) => {
  if (x === undefined || x === null || x === '') { if (required) throw v.bad(`${name} is required.`); return def; }
  const n = Number(x);
  if (!Number.isInteger(n) || n < min || n > 1e7) throw v.bad(`${name} must be a whole number${min ? ` of at least ${min}` : ''}.`);
  return n;
};

exports.parseProduct = (b = {}) => {
  const image = imageField(b.image, 'Product image'); // '' | new image (data URI) | existing Cloudinary URL
  return {
    name: v.str(b.name, 'Product name', { required: true, max: 120 }),
    sku: v.str(b.sku, 'SKU', { max: 40 }),
    category: v.str(b.category, 'Category', { max: 40 }),
    image,
    purchasePrice: v.money(b.purchasePrice, 'Purchase price', { required: false, allowZero: true, def: 0 }),
    sellingPrice: v.money(b.sellingPrice, 'Selling price', { required: false, allowZero: true, def: 0 }),
    lowStockAt: int(b.lowStockAt, 'Low-stock level', { required: false, def: 3 }),
    supplierName: v.str(b.supplierName, 'Supplier', { max: 80 }),
    supplierContact: v.str(b.supplierContact, 'Supplier contact', { max: 120 }),
    notes: v.str(b.notes, 'Notes', { max: 500 }),
  };
};

const MOVE_TYPES = ['purchase', 'sale', 'adjust_in', 'writeoff'];
exports.parseMovement = (b = {}, tz) => {
  const type = v.oneOf(b.type, MOVE_TYPES, 'Type');
  const date = v.dateStr(b.date, 'Date');
  if (date > addDays(todayIn(tz), 366)) throw v.bad('Date is too far in the future.');
  const out = {
    type, date,
    product: v.objectId(b.product, 'Product'),
    quantity: int(b.quantity, 'Quantity', { min: 1 }),
    unitCost: 0, unitPrice: 0, fees: 0, account: null, receivedOn: null,
    supplier: v.str(b.supplier, 'Supplier', { max: 80 }), orderRef: v.str(b.orderRef, 'Order reference', { max: 60 }),
    reason: v.str(b.reason, 'Reason', { max: 80 }), notes: v.str(b.notes, 'Notes', { max: 500 }),
  };
  if (type === 'purchase') out.unitCost = v.money(b.unitCost, 'Unit cost', { allowZero: true });
  if (type === 'sale') {
    out.unitPrice = v.money(b.unitPrice, 'Selling price');
    out.fees = v.money(b.fees, 'Platform fees', { required: false, allowZero: true, def: 0 });
    if (out.fees >= Math.round(out.unitPrice * out.quantity * 100) / 100) throw v.bad('Platform fees must be less than the sale amount.');
  }
  if (type === 'purchase' || type === 'sale') out.account = v.objectId(b.account, 'Account', { required: false });
  if (type === 'sale' && out.account) out.receivedOn = v.dateStr(b.receivedOn, 'Date received', { required: false, def: date });
  return out;
};

exports.parseDarazExpense = (b = {}, tz) => {
  const date = v.dateStr(b.date, 'Date');
  if (date > addDays(todayIn(tz), 366)) throw v.bad('Date is too far in the future.');
  return {
    category: v.oneOf(b.category, Object.keys(C.DARAZ_EXPENSE), 'Expense type'),
    title: v.str(b.title, 'Title', { required: true, max: 120 }),
    amount: v.money(b.amount, 'Amount'), date,
    product: v.objectId(b.product, 'Product', { required: false }),
    account: v.objectId(b.account, 'Account', { required: false }),
    notes: v.str(b.notes, 'Notes', { max: 500 }),
  };
};

exports.parsePayout = (b = {}) => ({ account: v.objectId(b.account, 'Receiving account'), date: v.dateStr(b.date, 'Date received') });

exports.parseMovementList = (q = {}) => {
  const s = (x) => (typeof x === 'string' ? x : undefined);
  const out = {
    product: v.objectId(s(q.product), 'Product', { required: false }),
    type: v.oneOf(s(q.type), MOVE_TYPES, 'Type', { required: false }),
    payout: v.oneOf(s(q.payout), ['pending'], 'Payout', { required: false }),
    from: v.dateStr(s(q.from), 'From', { required: false }), to: v.dateStr(s(q.to), 'To', { required: false }),
    page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)),
  };
  if (out.from && out.to && out.from > out.to) throw v.bad('"From" date must be before "To" date.');
  return out;
};
exports.parseExpenseList = (q = {}) => {
  const s = (x) => (typeof x === 'string' ? x : undefined);
  const out = {
    q: v.str(s(q.q), 'Search', { max: 80 }),
    category: v.oneOf(s(q.category), Object.keys(C.DARAZ_EXPENSE), 'Category', { required: false }),
    product: v.objectId(s(q.product), 'Product', { required: false }),
    from: v.dateStr(s(q.from), 'From', { required: false }), to: v.dateStr(s(q.to), 'To', { required: false }),
    page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)),
  };
  if (out.from && out.to && out.from > out.to) throw v.bad('"From" date must be before "To" date.');
  return out;
};
