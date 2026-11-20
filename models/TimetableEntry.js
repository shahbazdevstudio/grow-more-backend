const { Schema, model } = require('mongoose');

/** One block of the weekly timetable: "from HH:MM to HH:MM do <title>" on the chosen weekdays (0 = Monday … 6 = Sunday). */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: [true, 'Task is required.'], trim: true, maxlength: 100 },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    days: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
schema.index({ user: 1, deletedAt: 1, startTime: 1 });
module.exports = model('TimetableEntry', schema);
