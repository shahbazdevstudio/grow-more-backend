const { Schema, model } = require('mongoose');
const C = require('../config/constants');

/**
 * The single ledger.
 *   income   : +amount on `account`
 *   expense  : -amount on `account`
 *   transfer : -amount on `account`, +amount on `toAccount`  (NEVER income or expense)
 * `date` is a calendar day 'YYYY-MM-DD' in the owner's timezone. Deleted rows are soft-deleted (deletedAt)
 * and ignored by every balance/report query, so balances can never drift.
 */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: C.TX_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: [0.01, 'Amount must be greater than zero.'] },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    account: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    toAccount: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    category: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    source: { type: String, trim: true, maxlength: 60, default: '' }, // free-text origin of a transfer, e.g. "Daraz profit"
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    // Set when a Coding / Daraz record owns this transaction. Managed rows can only be changed from their module.
    module: { type: String, enum: ['coding', 'daraz', 'trading'], default: null },
    moduleRef: { type: Schema.Types.ObjectId, default: null },
    clientRequestId: { type: String, maxlength: 64 }, // makes "save" idempotent (double-tap / retry safe)
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.index({ user: 1, deletedAt: 1, date: -1, createdAt: -1 });
schema.index({ user: 1, account: 1, deletedAt: 1 });
schema.index({ user: 1, toAccount: 1, deletedAt: 1 });
schema.index({ user: 1, type: 1, deletedAt: 1, date: -1 });
schema.index({ user: 1, category: 1, deletedAt: 1 });
schema.index({ user: 1, module: 1, deletedAt: 1, date: -1 });
schema.index({ user: 1, moduleRef: 1 });
schema.index({ user: 1, clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } });

module.exports = model('Transaction', schema);
