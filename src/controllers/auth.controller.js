/**
 * Authentication: register, login, logout.
 *
 * Passwords are hashed with bcrypt (never stored in plain text).
 * Sessions are stateless JWTs; logout works by recording the token's
 * unique id (jti) in a revoked_tokens table until it would have expired anyway.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const BCRYPT_ROUNDS = 10;

const insertUser = db.prepare(
  'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
);
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const revokeToken = db.prepare(
  'INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)',
);
const purgeExpired = db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?');

/** Shape of a user object returned to clients (no password hash!). */
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    bio: row.bio,
    createdAt: row.created_at,
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, jwtid: crypto.randomUUID() },
  );
}

// POST /api/auth/register
async function register(req, res) {
  const { name, email, password } = req.body;

  if (findByEmail.get(email)) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const info = insertUser.run(name.trim(), email.toLowerCase(), passwordHash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  res.status(201).json({ user: publicUser(user), token: signToken(user) });
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;
  const user = findByEmail.get(email);

  // Same message for "no such user" and "wrong password" so attackers
  // can't discover which emails are registered.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  res.json({ user: publicUser(user), token: signToken(user) });
}

// POST /api/auth/logout  (requires auth)
function logout(req, res) {
  revokeToken.run(req.tokenId, req.tokenExp);
  purgeExpired.run(Math.floor(Date.now() / 1000)); // housekeeping
  res.json({ message: 'Logged out successfully' });
}

module.exports = { register, login, logout, publicUser };
