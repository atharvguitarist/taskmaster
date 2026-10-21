/**
 * Central place for all environment configuration.
 * Values come from the .env file (loaded by dotenv) with safe defaults for local dev.
 */
require('dotenv').config({ quiet: true });

const path = require('path');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  // SQLite database file. ':memory:' is handy for tests.
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'taskmaster.db'),
  // Where uploaded attachments are stored on disk.
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
  // Optional: set to enable the generative-AI task description endpoint.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
};
