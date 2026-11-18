const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
module.exports = { r2, pct };
