const v = require('./common');
const { sanitizeHtml, htmlToText } = require('../utils/sanitizeHtml');

exports.parseNote = (b = {}) => {
  if (b.body !== undefined && typeof b.body !== 'string') throw v.bad('Note body must be text.');
  const body = sanitizeHtml(b.body || '');
  const text = htmlToText(body);
  const title = v.str(b.title, 'Title', { max: 120 });
  if (!title && !text) throw v.bad('Write a title or some text first.');
  return { title, body, text: text.slice(0, 30000), category: v.str(b.category, 'Category', { max: 30 }), pinned: b.pinned === true };
};
exports.parseNoteList = (q = {}) => {
  const s = (x) => (typeof x === 'string' ? x : undefined);
  const out = {
    q: v.str(s(q.q), 'Search', { max: 80 }), category: v.str(s(q.category), 'Category', { max: 30 }),
    pinned: s(q.pinned) === 'true', from: v.dateStr(s(q.from), 'From', { required: false }), to: v.dateStr(s(q.to), 'To', { required: false }),
    page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(60, Math.max(1, parseInt(q.limit, 10) || 24)),
  };
  if (out.from && out.to && out.from > out.to) throw v.bad('"From" date must be before "To" date.');
  return out;
};
exports.parseTodo = (b = {}) => ({
  title: v.str(b.title, 'Task title', { required: true, max: 140 }),
  description: v.str(b.description, 'Description', { max: 1000 }),
  dueDate: v.dateStr(b.dueDate, 'Due date', { required: false, def: null }),
});
exports.parseTodoList = (q = {}) => {
  const s = (x) => (typeof x === 'string' ? x : undefined);
  return {
    status: v.oneOf(s(q.status), ['pending', 'completed', 'all'], 'Status', { required: false, def: 'pending' }),
    q: v.str(s(q.q), 'Search', { max: 80 }),
    page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50)),
  };
};
