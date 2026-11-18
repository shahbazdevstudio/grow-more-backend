const authService = require('../services/authService');
const { setCookie, clearCookie, resolveSession } = require('../services/tokenService');
const { parsePin } = require('../validators/settings.validator');

exports.status = async (req, res) => {
  const [user, lock] = await Promise.all([resolveSession(req, res), authService.lockStatus()]);
  res.json({ authenticated: !!user, ...lock });
};

exports.login = async (req, res) => {
  const pin = parsePin(req.body && req.body.pin);
  const user = await authService.login(pin);
  setCookie(res, user);
  res.json({ authenticated: true });
};

exports.logout = (_req, res) => { clearCookie(res); res.json({ authenticated: false }); };
