const C = require('../config/constants');
const v = require('./common');
const { addDays, todayIn } = require('../utils/dates');

exports.parseCoding = (b = {}, tz) => {
  const kind = v.oneOf(b.kind, ['income', 'expense'], 'Type');
  const cats = Object.keys(kind === 'income' ? C.CODING_INCOME : C.CODING_EXPENSE);
  const status = kind === 'income' ? v.oneOf(b.status, ['paid', 'pending'], 'Status', { required: false, def: 'paid' }) : 'paid';
  const date = v.dateStr(b.date, 'Date');
  if (date > addDays(todayIn(tz), 366)) throw v.bad('Date is too far in the future.');
  const out = {
    kind, status, date,
    category: v.oneOf(b.category, cats, kind === 'income' ? 'Income type' : 'Expense type'),
    title: v.str(b.title, 'Title', { required: true, max: 120 }),
    client: v.str(b.client, 'Client', { max: 80 }),
    project: v.str(b.project, 'Project', { max: 80 }),
    amount: v.money(b.amount, 'Amount'),
    notes: v.str(b.notes, 'Notes', { max: 1000 }),
    dueDate: status === 'pending' ? v.dateStr(b.dueDate, 'Due date', { required: false, def: null }) : null,
    account: null,
  };
  if (status === 'paid') out.account = v.objectId(b.account, kind === 'income' ? 'Receiving account' : 'Paid from account');
  return out;
};

exports.parseReceive = (b = {}) => ({ account: v.objectId(b.account, 'Receiving account'), date: v.dateStr(b.date, 'Date received') });

exports.parseCodingList = (q = {}) => {
  const s = (x) => (typeof x === 'string' ? x : undefined);
  const out = {
    q: v.str(s(q.q), 'Search', { max: 80 }),
    kind: v.oneOf(s(q.kind), ['income', 'expense'], 'Type', { required: false }),
    status: v.oneOf(s(q.status), ['paid', 'pending'], 'Status', { required: false }),
    category: v.oneOf(s(q.category), [...Object.keys(C.CODING_INCOME), ...Object.keys(C.CODING_EXPENSE)], 'Category', { required: false }),
    from: v.dateStr(s(q.from), 'From', { required: false }), to: v.dateStr(s(q.to), 'To', { required: false }),
    page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)),
  };
  if (out.from && out.to && out.from > out.to) throw v.bad('"From" date must be before "To" date.');
  return out;
};
