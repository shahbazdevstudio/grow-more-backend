const { Schema, model } = require('mongoose');

/**
 * Every change in stock. quantity is always a positive whole number; `type` decides the direction.
 *  purchase   +stock at unitCost          (money out of `account` → linked expense transaction)
 *  sale       −stock at unitPrice         (money in to `account`, net of platform `fees` → linked income transaction)
 *             a sale with no account is a PENDING PAYOUT: revenue is recorded, no balance changes until you receive it.
 *  adjust_in  +stock found/corrected at the current average cost (no money)
 *  writeoff   −stock lost/damaged/own use at the current average cost (counted as a loss, no money)
 * With no account on a purchase, it is existing stock being recorded (no balance changes).
 */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'DarazProduct', required: true },
    type: { type: String, enum: ['purchase', 'sale', 'adjust_in', 'writeoff'], required: true },
    quantity: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'Quantity must be a whole number.' } },
    unitCost: { type: Number, min: 0, default: 0 },
    unitPrice: { type: Number, min: 0, default: 0 },
    fees: { type: Number, min: 0, default: 0 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    account: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    receivedOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null }, // day the sale money reached `account`
    supplier: { type: String, trim: true, maxlength: 80, default: '' },
    orderRef: { type: String, trim: true, maxlength: 60, default: '' }, // Daraz order number
    reason: { type: String, trim: true, maxlength: 80, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, product: 1, deletedAt: 1, date: 1 });
schema.index({ user: 1, deletedAt: 1, date: -1 });
schema.index({ user: 1, type: 1, deletedAt: 1 });
module.exports = model('DarazStockMovement', schema);
