module.exports = {
  User: require('./User'),
  Account: require('./Account'),
  Category: require('./Category'),
  Transaction: require('./Transaction'),
  Budget: require('./Budget'),
  SavingsGoal: require('./SavingsGoal'),
  CodingRecord: require('./CodingRecord'),
  DarazProduct: require('./DarazProduct'),
  DarazStockMovement: require('./DarazStockMovement'),
  DarazExpense: require('./DarazExpense'),
};
Object.assign(module.exports, {
  TradingAsset: require('./TradingAsset'),
  TradingTransaction: require('./TradingTransaction'),
  Note: require('./Note'),
  Todo: require('./Todo'),
});
