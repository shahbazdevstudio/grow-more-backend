const { Schema, model } = require('mongoose');
const C = require('../config/constants');

/** Day-to-day Daraz costs: flyer bags, packaging, shipping, other. (Stock purchases are stock movements, not expenses.) */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, enum: Object.keys(C.DARAZ_EXPENSE), required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: [0.01, 'Amount must be greater than zero.'] },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    product: { type: Schema.Types.ObjectId, ref: 'DarazProduct', default: null }, // optional: attribute the cost to one product
    account: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, deletedAt: 1, date: -1 });
schema.index({ user: 1, category: 1, deletedAt: 1 });
module.exports = model('DarazExpense', schema);
