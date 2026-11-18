const { Schema, model } = require('mongoose');

/** `body` is sanitised HTML (whitelist: p, br, strong, em, u, ul, ol, li); `text` is the plain version used for search/preview. */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    body: { type: String, default: '', maxlength: 60000 },
    text: { type: String, default: '', maxlength: 30000 },
    category: { type: String, trim: true, maxlength: 30, default: '' },
    pinned: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, deletedAt: 1, pinned: -1, updatedAt: -1 });
schema.index({ user: 1, category: 1, deletedAt: 1 });
module.exports = model('Note', schema);
