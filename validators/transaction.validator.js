const C = require('../config/constants');
const v = require('./common');
const { addDays, todayIn } = require('../utils/dates');

exports.parseTransaction = (b = {}, tz) => {
  const type = v.oneOf(b.type, C.TX_TYPES, 'Type');
  const date = v.dateStr(b.date, 'Date');
  if (date > addDays(todayIn(tz), 366)) throw v.bad('Date is too far in the future.');
  const out = {
    type,
    amount: v.money(b.amount, 'Amount'),
    date,
    account: v.objectId(b.account, type === 'transfer' ? 'From account' : 'Account'),
    toAccount: null,
    category: null,
    source: '',
    notes: v.str(b.notes, 'Description', { max: 1000 }),
    clientRequestId: v.str(b.clientRequestId, 'Request id', { max: 64, def: undefined }) || undefined,
  };
  if (type === 'transfer') {
    out.title = v.str(b.title, 'Title', { max: 120 }) || 'Transfer';
    out.toAccount = v.objectId(b.toAccount, 'To account');
    if (out.toAccount === out.account) throw v.bad('Choose two different accounts for a transfer.');
    out.source = v.str(b.source, 'Source', { max: 60 });
  } else {
    out.title = v.str(b.title, 'Title', { required: true, max: 120 });
    out.category = v.objectId(b.category, type === 'income' ? 'Source' : 'Category');
  }
  return out;
};

exports.parseListQuery = (q = {}) => {
  const str = (x) => (typeof x === 'string' ? x : undefined);
  const out = {
    q: v.str(str(q.q), 'Search', { max: 80 }),
    type: v.oneOf(str(q.type), C.TX_TYPES, 'Type', { required: false }),
    category: v.objectId(str(q.category), 'Category', { required: false }),
    account: v.objectId(str(q.account), 'Account', { required: false }),
    scope: v.oneOf(str(q.scope), ['personal', 'business', 'trading'], 'Scope', { required: false }),
    from: v.dateStr(str(q.from), 'From', { required: false }),
    to: v.dateStr(str(q.to), 'To', { required: false }),
    page: Math.max(1, parseInt(q.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)),
  };
  if (out.from && out.to && out.from > out.to) throw v.bad('"From" date must be before "To" date.');
  return out;
};
