const C = require('../config/constants');
const v = require('./common');
const ApiError = require('../utils/ApiError');

const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

exports.parseSettings = (b = {}) => {
  const out = {};
  if (b.theme !== undefined) out.theme = v.oneOf(b.theme, C.THEMES, 'Theme');
  if (b.currency !== undefined) out.currency = v.oneOf(b.currency, C.CURRENCIES, 'Currency');
  if (b.autoLockMinutes !== undefined) out.autoLockMinutes = v.oneOf(Number(b.autoLockMinutes), C.AUTO_LOCK_OPTIONS, 'Auto-lock');
  if (b.timezone !== undefined) {
    if (typeof b.timezone !== 'string' || !validTz(b.timezone)) throw new ApiError(400, 'Timezone is not valid.', 'VALIDATION');
    out.timezone = b.timezone;
  }
  return out;
};

exports.parsePin = (x, label = 'PIN') => {
  if (typeof x !== 'string' || !new RegExp(`^\\d{${C.PIN_LENGTH}}$`).test(x)) throw new ApiError(400, `${label} must be exactly ${C.PIN_LENGTH} digits.`, 'VALIDATION');
  return x;
};

exports.parseCategory = (b = {}) => ({
  name: v.str(b.name, 'Name', { required: true, max: 40 }),
  type: v.oneOf(b.type, ['expense', 'income'], 'Type'),
  icon: v.str(b.icon, 'Icon', { max: 40, def: 'tag' }) || 'tag',
  color: v.hexColor(b.color, 'Colour', '#94A3B8'),
});
