const { Schema, model } = require('mongoose');

/**
 * buy  : money leaves `account` (quantity × price + fee) — or no account = a holding you already own
 * sell : money arrives in `account` (quantity × price − fee) — or no account = not credited anywhere
 * Both post ONE ledger transaction (module 'trading') when an account is chosen.
 */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    asset: { type: Schema.Types.ObjectId, ref: 'TradingAsset', required: true },
    type: { type: String, enum: ['buy', 'sell'], required: true },
    quantity: { type: Number, required: true, min: [0.00000001, 'Quantity must be greater than zero.'] },
    price: { type: Number, required: true, min: 0 },
    fee: { type: Number, min: 0, default: 0 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    account: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, asset: 1, deletedAt: 1, date: 1 });
schema.index({ user: 1, deletedAt: 1, date: -1 });
module.exports = model('TradingTransaction', schema);
