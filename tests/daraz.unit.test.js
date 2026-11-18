require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { walk, totalsInRange } = require('../services/darazMath');

let n = 0;
const m = (type, quantity, extra = {}, date = '2026-11-01') => ({ _id: `m${++n}`, type, quantity, date, createdAt: new Date(2026, 10, 1, 0, 0, n), ...extra });

test('weighted average cost: 10@100 + 10@200 → avg 150, sale of 5 costs 750', () => {
  const r = walk([m('purchase', 10, { unitCost: 100 }), m('purchase', 10, { unitCost: 200 }, '2026-11-02'), m('sale', 5, { unitPrice: 400, fees: 0 }, '2026-11-03')]);
  assert.equal(r.qty, 15); assert.equal(r.value, 2250); assert.equal(r.avgCost, 150);
  const sale = [...r.rows.values()].find((x) => x.type === 'sale');
  assert.equal(sale.cogs, 750); assert.equal(sale.revenue, 2000); assert.equal(sale.gross, 1250);
});

test('same-day purchase is processed before the sale; selling more than owned is flagged', () => {
  assert.equal(walk([m('sale', 3, { unitPrice: 10 }), m('purchase', 5, { unitCost: 4 })]).negativeAt, null);
  const bad = walk([m('purchase', 2, { unitCost: 4 }), m('sale', 3, { unitPrice: 10 })]);
  assert.equal(bad.negativeAt.qtyAfter, -1); assert.equal(bad.negativeAt.qtyBefore, 2);
});

test('a sale before its purchase date is impossible; editing a past cost re-prices later sales', () => {
  assert.ok(walk([m('sale', 1, { unitPrice: 9 }, '2026-11-01'), m('purchase', 5, { unitCost: 4 }, '2026-11-05')]).negativeAt);
  const at = (cost) => [...walk([m('purchase', 10, { unitCost: cost }), m('sale', 4, { unitPrice: 50 }, '2026-11-09')]).rows.values()].find((r) => r.type === 'sale').cogs;
  assert.equal(at(10), 40); assert.equal(at(12.5), 50);
});

test('write-off removes stock at average cost and is a loss; adjust_in adds at average cost', () => {
  const r = walk([m('purchase', 10, { unitCost: 30 }), m('writeoff', 2, {}, '2026-11-02'), m('adjust_in', 1, {}, '2026-11-03')]);
  assert.equal(r.qty, 9); assert.equal(r.value, 270); assert.equal([...r.rows.values()][1].loss, 60);
});

test('emptying stock resets value to zero (no residual rounding)', () => {
  const r = walk([m('purchase', 3, { unitCost: 33.33 }), m('sale', 1, { unitPrice: 50 }, '2026-11-02'), m('sale', 1, { unitPrice: 50 }, '2026-11-03'), m('sale', 1, { unitPrice: 50 }, '2026-11-04')]);
  assert.equal(r.qty, 0); assert.equal(r.value, 0);
});

test('range totals only count rows inside the date range', () => {
  const r = walk([m('purchase', 10, { unitCost: 10 }, '2026-10-01'), m('sale', 2, { unitPrice: 30 }, '2026-10-15'), m('sale', 3, { unitPrice: 30 }, '2026-11-15')]);
  const t = totalsInRange(r.rows, '2026-11-01', '2026-11-30');
  assert.equal(t.revenue, 90); assert.equal(t.cogs, 30); assert.equal(t.purchaseCost, 0);
});
