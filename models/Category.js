const { Schema, model } = require('mongoose');

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    type: { type: String, enum: ['expense', 'income'], required: true },
    icon: { type: String, default: 'tag', maxlength: 40 },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: '#94A3B8' },
    isDefault: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

schema.index({ user: 1, type: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = model('Category', schema);
