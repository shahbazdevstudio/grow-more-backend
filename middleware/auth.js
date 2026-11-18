const ApiError = require('../utils/ApiError');
const { resolveSession } = require('../services/tokenService');

/** Every private route sits behind this. Attaches req.user = { id, settings } (the ONLY source of user identity). */
async function requireAuth(req, res, next) {
  const user = await resolveSession(req, res);
  if (!user) throw new ApiError(401, 'Please enter your PIN to continue.', 'LOCKED');
  req.user = { id: String(user._id), displayName: user.displayName, settings: user.settings };
  next();
}
module.exports = { requireAuth };
