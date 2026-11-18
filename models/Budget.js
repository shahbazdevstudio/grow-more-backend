const { Schema, model } = require('mongoose');

// null = "not set". Later phases add investment / Daraz / marketing / coding budgets here.
const amount = { type: Number, min: 0, max: 1e12, default: null };

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    dailyLimit: amount,
    monthlyLimit: amount,
    savingsTarget: amount, // monthly amount to move into savings
  },
  { timestamps: true }
);

module.exports = model('Budget', schema);
