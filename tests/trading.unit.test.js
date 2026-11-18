require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { position, walk } = require('../services/tradingMath');
const { sanitizeHtml, htmlToText } = require('../utils/sanitizeHtml');

let n = 0;
const t = (type, quantity, price, fee = 0, date = '2026-11-01') => ({ _id: `t${++n}`, type, quantity, price, fee, date, createdAt: new Date(2026, 10, 1, 0, 0, n) });
const sellRow = (p, tr) => p.rows.get(String(tr._id));

test('YOUR formulas: Profit/Loss = Selling value − Purchase cost − Fees; Return = Net ÷ Purchase cost × 100', () => {
  const buy = t('buy', 0.5, 10_000_000, 500); const sell = t('sell', 0.2, 12_000_000, 300, '2026-11-05');
  const p = position([buy, sell], 11_000_000); const r = sellRow(p, sell);
  assert.equal(r.value, 2_400_000); assert.equal(r.purchaseCost, 2_000_000); assert.equal(r.buyFees, 200);
  assert.equal(r.net, 399_500); assert.equal(r.returnPct, 19.98);
  assert.equal(p.qty, 0.3); assert.equal(p.costBasis, 3_000_300); assert.equal(p.value, 3_300_000); assert.equal(p.unrealized, 299_700);
  assert.equal(p.realized, 399_500); assert.equal(p.feesPaid, 800);
});

test('average buy price across several buys; a loss shows as negative with a negative return', () => {
  const a = t('buy', 1, 100, 0); const b = t('buy', 1, 200, 0, '2026-11-02'); const s = t('sell', 1, 120, 0, '2026-11-03');
  const p = position([a, b, s]); const r = sellRow(p, s);
  assert.equal(r.purchaseCost, 150); assert.equal(r.net, -30); assert.equal(r.returnPct, -20); assert.equal(p.qty, 1); assert.equal(p.avgPrice, 150);
});

test('selling more than you hold is flagged; same-day buy is processed before the sell', () => {
  assert.equal(walk([t('sell', 1, 10), t('buy', 1, 5)]).negativeAt, null);
  const bad = walk([t('buy', 1, 5), t('sell', 2, 10, 0, '2026-11-02')]);
  assert.equal(bad.negativeAt.qtyBefore, 1); assert.equal(bad.negativeAt.qtyAfter, -1);
  assert.ok(walk([t('sell', 1, 10, 0, '2026-10-01'), t('buy', 1, 5, 0, '2026-11-01')]).negativeAt, 'cannot sell before buying');
});

test('8-decimal quantities do not drift (0.1 + 0.2 style errors)', () => {
  let ts = []; for (let i = 0; i < 10; i++) ts.push(t('buy', 0.1, 100, 0, '2026-11-01'));
  ts.push(t('sell', 1, 150, 0, '2026-11-02'));
  const p = position(ts); assert.equal(p.qty, 0); assert.equal(p.costBasis, 0);
  const tiny = position([t('buy', 0.00012345, 50_000_000), t('sell', 0.00012345, 55_000_000, 0, '2026-11-02')]);
  assert.equal(tiny.qty, 0); assert.ok(tiny.realized > 0);
});

test('free coins (price 0) have no percent return instead of dividing by zero; emptying a position resets cost', () => {
  const air = t('buy', 10, 0); const s = t('sell', 4, 5, 0, '2026-11-02'); const p = position([air, s]);
  assert.equal(sellRow(p, s).returnPct, null); assert.equal(sellRow(p, s).net, 20);
  const done = position([t('buy', 2, 10, 1), t('sell', 2, 12, 1, '2026-11-02')]); assert.equal(done.costBasis, 0); assert.equal(done.qty, 0);
});

test('note sanitiser: formatting survives, scripts/attributes/handlers do not', () => {
  assert.equal(sanitizeHtml('<p onclick="x()">Hi <b>there</b></p><script>alert(1)</script>'), '<p>Hi <strong>there</strong></p>');
  assert.equal(sanitizeHtml('<ul><li>a</li><li>b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(sanitizeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>ok'), 'ok');
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), 'x');
  assert.equal(sanitizeHtml('<div>one</div><div>two</div>'), '<p>one</p><p>two</p>');
  for (const h of ['<<script>script>alert(1)//<</script>/script>', '<svg/onload=alert(1)>', '<scr<script>ipt>alert(1)</scr</script>ipt>', '<iframe src=javascript:alert(1)>', '<img src=x onerror=alert(1)//'])
    assert.ok(!/<(?!\/?(p|br|strong|em|u|ul|ol|li)>)/.test(sanitizeHtml(h)), h);
  assert.equal(htmlToText('<p>Hello <strong>world</strong></p><ul><li>a</li></ul>'), 'Hello world a');
});
