const v = require('./common');

// Empty / null clears a limit.
const opt = (x, name) => v.money(x, name, { required: false, allowZero: false, def: null });

exports.parseBudget = (b = {}) => ({
  dailyLimit: opt(b.dailyLimit, 'Daily limit'),
  monthlyLimit: opt(b.monthlyLimit, 'Monthly limit'),
  savingsTarget: opt(b.savingsTarget, 'Savings target'),
});
