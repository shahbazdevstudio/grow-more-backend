const env = require('./config/env');
const { boot } = require('./config/boot');
const createApp = require('./app');

(async () => {
  try {
    await boot();
    const server = createApp().listen(env.port, () => console.log(`[grow-more] API listening on :${env.port} (${env.isProd ? 'production' : 'development'})`));
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (err) {
    console.error('[grow-more] Failed to start:', err.message);
    process.exit(1);
  }
})();
