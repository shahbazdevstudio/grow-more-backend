const router = require('express').Router();
const { pinLimiter } = require('../middleware/rateLimit');
const { requireAuth } = require('../middleware/auth');
const auth = require('../controllers/auth.controller');
const me = require('../controllers/me.controller');
const accounts = require('../controllers/accounts.controller');
const categories = require('../controllers/categories.controller');
const tx = require('../controllers/transactions.controller');
const budget = require('../controllers/budget.controller');
const savings = require('../controllers/savings.controller');
const analytics = require('../controllers/analytics.controller');
const dashboard = require('../controllers/dashboard.controller');
const data = require('../controllers/data.controller');
const coding = require('../controllers/coding.controller');
const daraz = require('../controllers/daraz.controller');
const trading = require('../controllers/trading.controller');
const notes = require('../controllers/notes.controller');

// ---- public ----
router.get('/health', (_req, res) => res.json({ ok: true }));
router.get('/auth/status', auth.status);
router.post('/auth/login', pinLimiter, auth.login);
router.post('/auth/logout', auth.logout);

// ---- everything below needs an unlocked session ----
router.use(requireAuth);

router.get('/bootstrap', me.bootstrap);
router.get('/info', me.info);
router.put('/me/settings', me.updateSettings);
router.post('/me/pin', pinLimiter, me.changePin);
router.post('/me/sessions/revoke', me.revokeSessions);

router.get('/dashboard', dashboard.get);

router.get('/accounts', accounts.list);
router.post('/accounts', accounts.create);
router.put('/accounts/:id', accounts.update);
router.delete('/accounts/:id', accounts.remove);
router.post('/accounts/:id/restore', accounts.restore);

router.get('/categories', categories.list);
router.post('/categories', categories.create);
router.delete('/categories/:id', categories.remove);

router.get('/transactions', tx.list);
router.post('/transactions', tx.create);
router.get('/transactions/:id', tx.get);
router.put('/transactions/:id', tx.update);
router.delete('/transactions/:id', tx.remove);
router.post('/transactions/:id/restore', tx.restore);

router.get('/budget', budget.get);
router.put('/budget', budget.save);

router.get('/savings', savings.overview);
router.post('/savings/goals', savings.createGoal);
router.put('/savings/goals/:id', savings.updateGoal);
router.delete('/savings/goals/:id', savings.removeGoal);

router.get('/analytics', analytics.overview);
router.get('/analytics/insights', analytics.insights);
router.get('/savings/sources', savings.sources);
router.get('/savings/trend', savings.trend);
router.get('/savings/history', savings.history);

// ---- Phase 2: business modules ----
router.get('/coding/summary', coding.summary);
router.get('/coding/report', coding.report);
router.get('/coding/records', coding.list);
router.post('/coding/records', coding.create);
router.put('/coding/records/:id', coding.update);
router.delete('/coding/records/:id', coding.remove);
router.post('/coding/records/:id/restore', coding.restore);
router.post('/coding/records/:id/receive', coding.receive);

router.get('/daraz/summary', daraz.summary);
router.get('/daraz/products', daraz.listProducts);
router.post('/daraz/products', daraz.createProduct);
router.get('/daraz/products/:id', daraz.getProduct);
router.put('/daraz/products/:id', daraz.updateProduct);
router.delete('/daraz/products/:id', daraz.removeProduct);
router.post('/daraz/products/:id/restore', daraz.restoreProduct);
router.get('/daraz/movements', daraz.listMovements);
router.post('/daraz/movements', daraz.createMovement);
router.put('/daraz/movements/:id', daraz.updateMovement);
router.delete('/daraz/movements/:id', daraz.removeMovement);
router.post('/daraz/movements/:id/restore', daraz.restoreMovement);
router.post('/daraz/movements/:id/payout', daraz.receivePayout);
router.get('/daraz/expenses', daraz.listExpenses);
router.post('/daraz/expenses', daraz.createExpense);
router.put('/daraz/expenses/:id', daraz.updateExpense);
router.delete('/daraz/expenses/:id', daraz.removeExpense);
router.post('/daraz/expenses/:id/restore', daraz.restoreExpense);

// ---- Phase 3: trading, notes, to-do ----
router.get('/trading/summary', trading.summary);
router.get('/trading/assets', trading.listAssets);
router.post('/trading/assets', trading.createAsset);
router.put('/trading/assets/:id', trading.updateAsset);
router.put('/trading/assets/:id/price', trading.setPrice);
router.delete('/trading/assets/:id', trading.removeAsset);
router.post('/trading/assets/:id/restore', trading.restoreAsset);
router.get('/trading/trades', trading.listTrades);
router.post('/trading/trades', trading.createTrade);
router.put('/trading/trades/:id', trading.updateTrade);
router.delete('/trading/trades/:id', trading.removeTrade);
router.post('/trading/trades/:id/restore', trading.restoreTrade);

router.get('/notes', notes.list);
router.post('/notes', notes.create);
router.get('/notes/:id', notes.get);
router.put('/notes/:id', notes.update);
router.put('/notes/:id/pin', notes.pin);
router.delete('/notes/:id', notes.remove);
router.post('/notes/:id/restore', notes.restore);

router.get('/todos', notes.todoList);
router.post('/todos', notes.todoCreate);
router.put('/todos/:id', notes.todoUpdate);
router.put('/todos/:id/complete', notes.todoComplete);
router.delete('/todos/:id', notes.todoRemove);
router.post('/todos/:id/restore', notes.todoRestore);

router.get('/data/export.json', data.exportJson);
router.get('/data/transactions.csv', data.exportCsv);

module.exports = router;
