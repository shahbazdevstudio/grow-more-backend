const { Schema, model } = require('mongoose');
const C = require('../config/constants');

/** Something you hold: Bitcoin, a stock, … Quantity, cost and profit are derived from trades; the price is entered by hand. */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: [true, 'Asset name is required.'], trim: true, maxlength: 60 },
    symbol: { type: String, trim: true, uppercase: true, maxlength: 12, default: '' },
    type: { type: String, enum: C.ASSET_TYPES, default: 'crypto' },
    currentPrice: { type: Number, min: 0, default: null }, // manual price per unit (no live feeds)
    priceUpdatedAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);
schema.index({ user: 1, archived: 1, name: 1 });
schema.index({ user: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { archived: false } });
module.exports = model('TradingAsset', schema);
