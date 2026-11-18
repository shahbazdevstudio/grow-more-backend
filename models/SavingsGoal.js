const { Schema, model } = require('mongoose');

// Progress is derived: balance of the linked savings account (or all savings accounts when not linked).
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    targetAmount: { type: Number, required: true, min: [1, 'Target must be greater than zero.'], max: 1e12 },
    targetDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    account: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

schema.index({ user: 1, createdAt: -1 });

module.exports = model('SavingsGoal', schema);
