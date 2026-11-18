const { User, Account, Category, Transaction, Budget, SavingsGoal, CodingRecord, DarazProduct, DarazStockMovement, DarazExpense, TradingAsset, TradingTransaction, Note, Todo } = require('../models');
const { dto } = require('../utils/dto');
const C = require('../config/constants');

async function fullExport(userId) {
  const [user, accounts, categories, transactions, budget, goals, coding, dProducts, dMoves, dExpenses, tAssets, tTrades, notes, todos] = await Promise.all([
    User.findById(userId).lean(),
    Account.find({ user: userId }).lean(),
    Category.find({ user: userId }).lean(),
    Transaction.find({ user: userId }).sort({ date: 1, createdAt: 1 }).lean(),
    Budget.findOne({ user: userId }).lean(),
    SavingsGoal.find({ user: userId }).lean(),
    CodingRecord.find({ user: userId }).lean(), DarazProduct.find({ user: userId }).lean(), DarazStockMovement.find({ user: userId }).lean(), DarazExpense.find({ user: userId }).lean(),
    TradingAsset.find({ user: userId }).lean(), TradingTransaction.find({ user: userId }).lean(), Note.find({ user: userId }).lean(), Todo.find({ user: userId }).lean(),
  ]);
  return {
    app: 'Grow More', schemaVersion: 3, appVersion: C.APP_VERSION, exportedAt: new Date().toISOString(),
    settings: user.settings,
    accounts: accounts.map(dto), categories: categories.map(dto), transactions: transactions.map(dto),
    budget: budget ? dto(budget) : null, savingsGoals: goals.map(dto),
    codingRecords: coding.map(dto), darazProducts: dProducts.map(dto), darazStockMovements: dMoves.map(dto), darazExpenses: dExpenses.map(dto),
    tradingAssets: tAssets.map(dto), tradingTrades: tTrades.map(dto), notes: notes.map(dto), todos: todos.map(dto),
  };
}

// Spreadsheet apps execute cells starting with = + - @ — neutralise them.
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function transactionsCsv(userId) {
  const [accounts, cats, txs] = await Promise.all([
    Account.find({ user: userId }).lean(), Category.find({ user: userId }).lean(),
    Transaction.find({ user: userId, deletedAt: null }).sort({ date: -1, createdAt: -1 }).lean(),
  ]);
  const an = new Map(accounts.map((a) => [String(a._id), a.name]));
  const cn = new Map(cats.map((c) => [String(c._id), c.name]));
  const rows = [['Date', 'Type', 'Title', 'Amount', 'Category / Source', 'Account', 'To account', 'Transfer source', 'Description']];
  for (const t of txs) rows.push([t.date, t.type, t.title, t.amount, cn.get(String(t.category)) || '', an.get(String(t.account)) || '', t.toAccount ? an.get(String(t.toAccount)) || '' : '', t.source, t.notes]);
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

module.exports = { fullExport, transactionsCsv };
