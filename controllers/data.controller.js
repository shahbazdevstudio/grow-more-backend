const svc = require('../services/exportService');
const { todayIn } = require('../utils/dates');

exports.exportJson = async (req, res) => {
  const data = await svc.fullExport(req.user.id);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="grow-more-backup-${todayIn(req.user.settings.timezone)}.json"` });
  res.send(JSON.stringify(data, null, 2));
};
exports.exportCsv = async (req, res) => {
  const csv = await svc.transactionsCsv(req.user.id);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="grow-more-transactions-${todayIn(req.user.settings.timezone)}.csv"` });
  res.send(csv);
};
