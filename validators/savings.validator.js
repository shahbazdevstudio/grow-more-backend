const v = require('./common');

exports.parseGoal = (b = {}) => ({
  title: v.str(b.title, 'Goal name', { required: true, max: 80 }),
  targetAmount: v.money(b.targetAmount, 'Target amount'),
  targetDate: v.dateStr(b.targetDate, 'Target date', { required: false, def: null }),
  account: v.objectId(b.account, 'Savings account', { required: false }),
  notes: v.str(b.notes, 'Notes', { max: 300 }),
});
