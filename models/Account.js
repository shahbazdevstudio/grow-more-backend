const { Schema, model } = require('mongoose');
const C = require('../config/constants');

/**
 * An account never stores its balance. Balance = openingBalance + ledger (see services/balanceService).
 */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: [true, 'Account name is required.'], trim: true, maxlength: 60 },
    type: { type: String, enum: C.ACCOUNT_TYPES, required: true },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    openingBalance: { type: Number, default: 0 },
    logoKey: { type: String, trim: true, maxlength: 40, default: '' }, // file in Frontend/assets/logos/<key>.(svg|webp|png)
    logoData: { type: String, default: '', maxlength: 600 }, // https URL of the uploaded logo on Cloudinary
    logoPublicId: { type: String, default: '', maxlength: 200 }, // Cloudinary id (server-side only) so the file can be removed
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: '#34D399' },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

schema.index({ user: 1, archived: 1, name: 1 });
schema.index(
  { user: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { archived: false } }
);

module.exports = model('Account', schema);
