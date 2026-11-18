const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const { isDateStr } = require('../utils/dates');

const bad = (msg) => new ApiError(400, msg, 'VALIDATION');
const isEmpty = (v) => v === undefined || v === null || v === '';

exports.str = (v, name, { required = false, max = 200, def = '' } = {}) => {
  if (isEmpty(v)) { if (required) throw bad(`${name} is required.`); return def; }
  if (typeof v !== 'string') throw bad(`${name} must be text.`);
  const s = v.trim();
  if (required && !s) throw bad(`${name} is required.`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return s;
};

/** Positive/zero money with at most 2 decimals. */
exports.money = (v, name, { required = true, allowZero = false, allowNegative = false, max = 1e12, def = null } = {}) => {
  if (isEmpty(v)) { if (required) throw bad(`${name} is required.`); return def; }
  if (typeof v === 'boolean' || typeof v === 'object') throw bad(`${name} must be a number.`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} must be a valid number.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw bad(`${name} can have at most 2 decimal places.`);
  if (!allowNegative && n < 0) throw bad(`${name} cannot be negative.`);
  if (!allowZero && n === 0 && !allowNegative) throw bad(`${name} must be greater than zero.`);
  if (Math.abs(n) > max) throw bad(`${name} is too large.`);
  return Math.round(n * 100) / 100;
};

exports.dateStr = (v, name, { required = true, def = null } = {}) => {
  if (isEmpty(v)) { if (required) throw bad(`${name} is required.`); return def; }
  if (!isDateStr(v)) throw bad(`${name} must be a valid date (YYYY-MM-DD).`);
  return v;
};

exports.oneOf = (v, list, name, { required = true, def = null } = {}) => {
  if (isEmpty(v)) { if (required) throw bad(`${name} is required.`); return def; }
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}.`);
  return v;
};

exports.objectId = (v, name, { required = true } = {}) => {
  if (isEmpty(v)) { if (required) throw bad(`${name} is required.`); return null; }
  if (typeof v !== 'string' || !mongoose.isValidObjectId(v) || String(new mongoose.Types.ObjectId(v)) !== v.toLowerCase()) throw bad(`${name} is invalid.`);
  return v;
};

exports.hexColor = (v, name, def = undefined) => {
  if (isEmpty(v)) return def;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad(`${name} must be a hex colour like #34D399.`);
  return v;
};

exports.bad = bad;
