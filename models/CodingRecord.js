const { Schema, model } = require('mongoose');
const C = require('../config/constants');

/**
 * One line of the coding / web-development business.
 *  status 'paid'    → money has moved: a linked ledger transaction exists and the account balance reflects it.
 *  status 'pending' → an invoice you expect to be paid (income only): NO ledger entry yet, so no balance changes.
 */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['income', 'expense'], required: true },
    category: { type: String, enum: [...Object.keys(C.CODING_INCOME), ...Object.keys(C.CODING_EXPENSE)], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    client: { type: String, trim: true, maxlength: 80, default: '' },
    project: { type: String, trim: true, maxlength: 80, default: '' },
    amount: { type: Number, required: true, min: [0.01, 'Amount must be greater than zero.'] },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // payment date (paid) or invoice date (pending)
    dueDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    status: { type: String, enum: ['paid', 'pending'], default: 'paid' },
    account: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, deletedAt: 1, date: -1 });
schema.index({ user: 1, kind: 1, status: 1, deletedAt: 1 });
schema.index({ user: 1, client: 1 });
module.exports = model('CodingRecord', schema);
