/**
 * Entry point: initialise the database, then start the HTTP server.
 *   npm start      -> production
 *   npm run dev    -> auto-restart on file changes (node --watch)
 */
const app = require('./app');
const db = require('./config/db');
const env = require('./config/env');

async function main() {
  if (env.jwtSecret === 'dev-only-change-me-in-production') {
    console.warn('WARNING: JWT_SECRET is not set. Copy .env.example to .env and set a real secret.');
  }

  await db.init();

  app.listen(env.port, () => {
    console.log(`TaskMaster API running at http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
