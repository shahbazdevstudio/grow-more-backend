const { Schema, model } = require('mongoose');

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: [true, 'Task title is required.'], trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    dueDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, deletedAt: 1, completed: 1, dueDate: 1 });
module.exports = model('Todo', schema);
