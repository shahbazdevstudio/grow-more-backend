const { r2 } = require('../utils/money');

/**
 * Stock & cost engine (pure — no database). Weighted-average costing:
 *   purchase   adds stock at its unit cost
 *   sale       removes stock at the CURRENT average cost  → that is the cost of goods sold (COGS)
 *   writeoff   removes lost/damaged stock at the current average cost → a loss
 *   adjust_in  adds found stock at the current average cost
 * Movements are processed in date order (same day: purchases first, then sales), so results are deterministic
 * and editing/deleting any past movement correctly re-prices everything after it.
 */
const RANK = { purchase: 0, adjust_in: 1, sale: 2, writeoff: 3 };

function sortMovements(ms) {
  return [...ms].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || RANK[a.type] - RANK[b.type]
    || new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
    || String(a._id).localeCompare(String(b._id)));
}

function walk(movements, fallbackCost = 0) {
  let qty = 0; let value = 0; let lastAvg = fallbackCost; let negativeAt = null;
  const rows = new Map();
  for (const m of sortMovements(movements)) {
    const q = m.quantity;
    const avg = qty > 0 ? value / qty : lastAvg;
    const row = { id: String(m._id), type: m.type, date: m.date, qtyBefore: qty, cogs: 0, revenue: 0, fees: 0, loss: 0, cost: 0 };
    if (m.type === 'purchase') { row.cost = r2(q * m.unitCost); value = r2(value + row.cost); qty += q; }
    else if (m.type === 'adjust_in') { row.cost = r2(q * avg); value = r2(value + row.cost); qty += q; }
    else if (m.type === 'sale') { row.cogs = r2(q * avg); row.revenue = r2(q * m.unitPrice); row.fees = r2(m.fees || 0); row.gross = r2(row.revenue - row.cogs); value = r2(value - row.cogs); qty -= q; }
    else if (m.type === 'writeoff') { row.loss = r2(q * avg); value = r2(value - row.loss); qty -= q; }
    if (qty < 0 && !negativeAt) negativeAt = { ...row, qtyAfter: qty };
    if (qty === 0) value = 0;
    if (qty > 0) lastAvg = value / qty;
    row.qtyAfter = qty;
    row.avgCostAfter = qty > 0 ? r2(value / qty) : 0;
    rows.set(row.id, row);
  }
  return { qty, value: r2(value), avgCost: qty > 0 ? r2(value / qty) : r2(lastAvg), rows, negativeAt };
}

/** Totals of the rows that fall inside [from, to]. */
function totalsInRange(rows, from, to) {
  const t = { purchasedQty: 0, purchaseCost: 0, soldQty: 0, revenue: 0, cogs: 0, fees: 0, writeoffLoss: 0, writeoffQty: 0 };
  for (const r of rows.values()) {
    if (r.date < from || r.date > to) continue;
    if (r.type === 'purchase') t.purchaseCost += r.cost;
    if (r.type === 'sale') { t.revenue += r.revenue; t.cogs += r.cogs; t.fees += r.fees; }
    if (r.type === 'writeoff') t.writeoffLoss += r.loss;
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)]));
}

module.exports = { walk, sortMovements, totalsInRange, RANK };
