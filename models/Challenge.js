const { Schema, model } = require('mongoose');

/**
 * A challenge runs for `totalDays` starting on `startDate`. Every day the same list of tasks (each worth `points`) is offered.
 * A day PASSES when earned points / possible points >= passPercent.
 * `logs` holds one entry per day the user touched; earned/possible are a snapshot so editing the task list later
 * never rewrites the score of days that are already over.
 */
const taskSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 80 },
  points: { type: Number, required: true, min: 1, max: 1000, default: 1 },
});
const logSchema = new Schema({
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  done: { type: [String], default: [] },
  earned: { type: Number, default: 0, min: 0 },
  possible: { type: Number, default: 0, min: 0 },
}, { _id: false });

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: [true, 'Challenge name is required.'], trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    totalDays: { type: Number, required: true, min: 1, max: 365 },
    passPercent: { type: Number, required: true, min: 1, max: 100, default: 100 },
    tasks: { type: [taskSchema], default: [] },
    logs: { type: [logSchema], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, deletedAt: 1, startDate: -1 });
module.exports = model('Challenge', schema);
