/**
 * JWT authentication middleware.
 *
 * Expects:  Authorization: Bearer <token>
 *
 * On success it sets req.user = { id, email, name } and req.tokenId (jti)
 * so the logout endpoint can revoke exactly this token.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const isRevoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?');
const findUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    return next(ApiError.unauthorized(msg));
  }

  // Token was logged out earlier.
  if (isRevoked.get(payload.jti)) {
    return next(ApiError.unauthorized('Token has been logged out'));
  }

  // User may have been deleted since the token was issued.
  const user = findUser.get(payload.sub);
  if (!user) return next(ApiError.unauthorized('User no longer exists'));

  req.user = user;
  req.tokenId = payload.jti;
  req.tokenExp = payload.exp;
  next();
}

module.exports = requireAuth;
