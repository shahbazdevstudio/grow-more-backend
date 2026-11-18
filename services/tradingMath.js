const { r2 } = require('../utils/money');

/**
 * Trading position engine (pure — no database). Average-cost method, matching your formulas exactly:
 *   Profit/Loss    = Selling value − Purchase cost − Applicable fees
 *   Percent return = Net profit ÷ Purchase cost × 100
 * where, for the units sold:  purchase cost = units × average buy price (fees excluded),
 *                             applicable fees = the buy fees attached to those units + the sell fee.
 * Quantities support up to 8 decimals (e.g. 0.00012345 BTC).
 */
const q8 = (n) => Math.round(n * 1e8) / 1e8;
const EPS = 1e-9;
const RANK = { buy: 0, sell: 1 };

const sortTrades = (ts) => [...ts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  || RANK[a.type] - RANK[b.type]
  || new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  || String(a._id).localeCompare(String(b._id)));

function walk(trades) {
  let qty = 0; let cost = 0; let fees = 0; let negativeAt = null;
  const rows = new Map();
  for (const t of sortTrades(trades)) {
    const q = t.quantity; const row = { id: String(t._id), type: t.type, date: t.date, qtyBefore: q8(qty), value: r2(q * t.price), fee: r2(t.fee || 0), purchaseCost: 0, buyFees: 0, net: null, returnPct: null };
    if (t.type === 'buy') { qty = q8(qty + q); cost += q * t.price; fees += t.fee || 0; }
    else {
      const avgPrice = qty > EPS ? cost / qty : 0; const avgFee = qty > EPS ? fees / qty : 0;
      row.purchaseCost = r2(q * avgPrice); row.buyFees = r2(q * avgFee);
      row.net = r2(q * t.price - row.purchaseCost - row.buyFees - (t.fee || 0));
      row.returnPct = row.purchaseCost > 0 ? Math.round((row.net / row.purchaseCost) * 10000) / 100 : null;
      cost -= q * avgPrice; fees -= q * avgFee; qty = q8(qty - q);
      if (qty < -EPS && !negativeAt) negativeAt = { ...row, qtyAfter: qty };
    }
    if (qty <= EPS) { cost = 0; fees = 0; if (qty > -EPS) qty = 0; }
    row.qtyAfter = qty;
    rows.set(row.id, row);
  }
  return { qty, costPure: r2(cost), feePool: r2(fees), avgPrice: qty > EPS ? cost / qty : 0, rows, negativeAt };
}

/** Position summary for one asset. */
function position(trades, currentPrice = null) {
  const w = walk(trades);
  let boughtQty = 0; let bought = 0; let soldQty = 0; let proceeds = 0; let realized = 0; let feesPaid = 0; let purchaseCostSold = 0;
  for (const t of trades) {
    const r = w.rows.get(String(t._id));
    feesPaid += t.fee || 0;
    if (t.type === 'buy') { boughtQty += t.quantity; bought += t.quantity * t.price; } else { soldQty += t.quantity; proceeds += t.quantity * t.price; realized += r.net; purchaseCostSold += r.purchaseCost; }
  }
  const costBasis = r2(w.costPure + w.feePool);
  const value = currentPrice != null ? r2(w.qty * currentPrice) : null;
  return {
    qty: w.qty, avgPrice: r2(w.avgPrice * 1e6) / 1e6, costBasis, costPure: w.costPure, feePool: w.feePool,
    currentPrice, value, valueOrCost: value != null ? value : costBasis,
    unrealized: value != null ? r2(value - costBasis) : null, unrealizedPct: value != null && costBasis > 0 ? Math.round(((value - costBasis) / costBasis) * 10000) / 100 : null,
    boughtQty: q8(boughtQty), bought: r2(bought), soldQty: q8(soldQty), proceeds: r2(proceeds), realized: r2(realized), realizedPct: purchaseCostSold > 0 ? Math.round((realized / purchaseCostSold) * 10000) / 100 : null, feesPaid: r2(feesPaid),
    rows: w.rows, negativeAt: w.negativeAt,
  };
}

module.exports = { walk, position, sortTrades, q8 };
