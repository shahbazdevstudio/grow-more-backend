/**
 * Vercel serverless entry: every request is rewritten here (see ../vercel.json) and handled by the
 * same Express app that `server.js` runs locally. The MongoDB connection is cached between requests.
 */
let app;
let ready;

module.exports = async (req, res) => {
  try {
    if (!ready) {
      const { boot } = require('../config/boot'); // loads + validates the environment variables
      ready = boot().catch((e) => { ready = null; throw e; });
    }
    await ready;
    if (!app) app = require('../app')();
  } catch (e) {
    console.error('[grow-more] start-up failed:', e && e.message);
    const missingEnv = e && /environment variable|must be at least/i.test(e.message || '');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({
      error: missingEnv ? 'The server is not configured yet (an environment variable is missing).' : 'The database is not reachable right now. Please try again in a moment.',
      code: missingEnv ? 'NOT_CONFIGURED' : 'DB_UNAVAILABLE',
    }));
    return;
  }

  // Vercel may already have parsed the JSON body; tell express.json() so it does not wait for a stream that was consumed.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { const b = req.body; if (b && typeof b === 'object' && !Buffer.isBuffer(b)) req._body = true; } catch { /* express reports invalid JSON */ }
  }
  return app(req, res);
};
