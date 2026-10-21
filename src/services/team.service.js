/**
 * Shared team helpers used by several controllers (teams, tasks).
 */
const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const findTeam = db.prepare('SELECT * FROM teams WHERE id = ?');
const findMembership = db.prepare(
  'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
);

/** Returns the membership row or null. */
function getMembership(teamId, userId) {
  return findMembership.get(teamId, userId) || null;
}

/** Throws 404 if the team doesn't exist, 403 if the user isn't a member. Returns the team. */
function requireMember(teamId, userId) {
  const team = findTeam.get(teamId);
  if (!team) throw ApiError.notFound('Team not found');
  if (!getMembership(teamId, userId)) throw ApiError.forbidden('You are not a member of this team');
  return team;
}

/** Like requireMember but the user must be the owner or an admin. */
function requireAdmin(teamId, userId) {
  const team = requireMember(teamId, userId);
  const { role } = getMembership(teamId, userId);
  if (role !== 'owner' && role !== 'admin') {
    throw ApiError.forbidden('Only team owners/admins can do that');
  }
  return team;
}

module.exports = { findTeam, getMembership, requireMember, requireAdmin };
