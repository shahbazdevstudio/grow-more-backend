const { Schema, model } = require('mongoose');

/** Catalogue entry. Stock, average cost and profit are NEVER stored — they are derived from stock movements. */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: [true, 'Product name is required.'], trim: true, maxlength: 120 },
    sku: { type: String, trim: true, maxlength: 40, default: '' },
    category: { type: String, trim: true, maxlength: 40, default: '' },
    image: { type: String, default: '', maxlength: 600 }, // https URL of the product photo on Cloudinary
    imagePublicId: { type: String, default: '', maxlength: 200 }, // Cloudinary id (server-side only)
    purchasePrice: { type: Number, min: 0, default: 0 }, // default unit cost pre-filled when buying stock
    sellingPrice: { type: Number, min: 0, default: 0 }, // default unit price pre-filled when selling
    lowStockAt: { type: Number, min: 0, default: 3 },
    supplierName: { type: String, trim: true, maxlength: 80, default: '' },
    supplierContact: { type: String, trim: true, maxlength: 120, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);
schema.index({ user: 1, archived: 1, name: 1 });
schema.index({ user: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $gt: '' }, archived: false }, collation: { locale: 'en', strength: 2 } });
module.exports = model('DarazProduct', schema);
