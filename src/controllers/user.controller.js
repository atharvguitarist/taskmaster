/**
 * User profile management.
 */
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const { publicUser } = require('./auth.controller');

const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const findByEmail = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?');

// GET /api/users/me
function getProfile(req, res) {
  const user = findById.get(req.user.id);
  res.json({ user: publicUser(user) });
}

// PATCH /api/users/me
async function updateProfile(req, res) {
  const { name, email, bio, password } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
  if (email !== undefined) {
    if (findByEmail.get(email, req.user.id)) {
      throw ApiError.conflict('That email is already in use');
    }
    updates.push('email = ?');
    params.push(email.toLowerCase());
  }
  if (password !== undefined) {
    updates.push('password_hash = ?');
    params.push(await bcrypt.hash(password, 10));
  }

  if (updates.length === 0) {
    throw ApiError.badRequest('Nothing to update');
  }

  updates.push("updated_at = datetime('now')");
  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ user: publicUser(findById.get(req.user.id)) });
}

// GET /api/users?q=   -> simple directory lookup so you can find people to invite/assign
function searchUsers(req, res) {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = db
    .prepare('SELECT id, name, email FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 20')
    .all(q, q);
  res.json({ users: rows });
}

module.exports = { getProfile, updateProfile, searchUsers };
