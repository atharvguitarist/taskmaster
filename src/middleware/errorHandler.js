/**
 * Global error handling.
 *
 * - notFound: runs when no route matched -> 404 JSON.
 * - errorHandler: Express recognises a 4-argument function as the error handler.
 *   Every error thrown (or passed to next()) in the app ends up here and becomes
 *   a consistent JSON body: { error: { message, details? } }.
 */
const multer = require('multer');
const ApiError = require('../utils/ApiError');

function notFound(req, res) {
  res.status(404).json({ error: { message: `Route ${req.method} ${req.originalUrl} not found` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Errors we threw on purpose.
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  // Multer (file upload) errors, e.g. file too large.
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: { message: `Upload error: ${err.message}` } });
  }

  // Malformed JSON body.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON in request body' } });
  }

  // SQLite constraint errors (e.g. duplicate email) that slipped through validation.
  if (/constraint failed/i.test(err.message || '')) {
    return res.status(409).json({ error: { message: 'Database constraint violated', details: err.message } });
  }

  // Anything else is a genuine bug -> log it, hide internals from the client.
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { message: 'Internal server error' } });
}

module.exports = { notFound, errorHandler };
