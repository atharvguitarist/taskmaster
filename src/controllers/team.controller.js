/**
 * Teams / projects: create, list, join by invite code, invite by email, members.
 */
const crypto = require('crypto');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const teamService = require('../services/team.service');
const { notify } = require('../services/notification.service');

const insertTeam = db.prepare(
  'INSERT INTO teams (name, description, owner_id, invite_code) VALUES (?, ?, ?, ?)',
);
const insertMember = db.prepare(
  'INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)',
);
const listMembers = db.prepare(
  `SELECT u.id, u.name, u.email, tm.role, tm.joined_at
   FROM team_members tm JOIN users u ON u.id = tm.user_id
   WHERE tm.team_id = ? ORDER BY tm.joined_at`,
);

function teamWithRole(team, role) {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    ownerId: team.owner_id,
    inviteCode: team.invite_code,
    createdAt: team.created_at,
    myRole: role,
  };
}

// POST /api/teams
function create(req, res) {
  const { name, description = '' } = req.body;
  const inviteCode = crypto.randomBytes(4).toString('hex'); // e.g. "a3f9c1d2"

  // Transaction: create the team AND add the creator as owner, or neither.
  const createTeam = db.transaction(() => {
    const info = insertTeam.run(name.trim(), description, req.user.id, inviteCode);
    insertMember.run(info.lastInsertRowid, req.user.id, 'owner');
    return teamService.findTeam.get(info.lastInsertRowid);
  });

  const team = createTeam();
  res.status(201).json({ team: teamWithRole(team, 'owner') });
}

// GET /api/teams  -> teams I belong to
function listMine(req, res) {
  const rows = db
    .prepare(
      `SELECT t.*, tm.role FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ? ORDER BY t.created_at DESC`,
    )
    .all(req.user.id);
  res.json({ teams: rows.map((r) => teamWithRole(r, r.role)) });
}

// GET /api/teams/:id
function getOne(req, res) {
  const team = teamService.requireMember(req.params.id, req.user.id);
  const { role } = teamService.getMembership(team.id, req.user.id);
  res.json({ team: teamWithRole(team, role), members: listMembers.all(team.id) });
}

// PATCH /api/teams/:id   (owner/admin only)
function update(req, res) {
  const team = teamService.requireAdmin(req.params.id, req.user.id);
  const { name, description } = req.body;
  db.prepare('UPDATE teams SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?')
    .run(name?.trim() ?? null, description ?? null, team.id);
  const updated = teamService.findTeam.get(team.id);
  res.json({ team: teamWithRole(updated, teamService.getMembership(team.id, req.user.id).role) });
}

// DELETE /api/teams/:id   (owner only)
function remove(req, res) {
  const team = teamService.requireMember(req.params.id, req.user.id);
  if (team.owner_id !== req.user.id) throw ApiError.forbidden('Only the owner can delete a team');
  db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
  res.status(204).send();
}

// POST /api/teams/join  { inviteCode }
function join(req, res) {
  const team = db.prepare('SELECT * FROM teams WHERE invite_code = ?').get(req.body.inviteCode);
  if (!team) throw ApiError.notFound('Invalid invite code');

  if (teamService.getMembership(team.id, req.user.id)) {
    throw ApiError.conflict('You are already a member of this team');
  }
  insertMember.run(team.id, req.user.id, 'member');

  notify({
    userId: team.owner_id,
    actorId: req.user.id,
    type: 'team_joined',
    message: `${req.user.name} joined your team "${team.name}"`,
  });

  res.json({ team: teamWithRole(team, 'member') });
}

// POST /api/teams/:id/invite  { email }   (owner/admin) -> adds an existing user directly
function invite(req, res) {
  const team = teamService.requireAdmin(req.params.id, req.user.id);
  const invitee = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(req.body.email);
  if (!invitee) throw ApiError.notFound('No user with that email. Share the invite code instead.');

  if (teamService.getMembership(team.id, invitee.id)) {
    throw ApiError.conflict('That user is already a member');
  }
  insertMember.run(team.id, invitee.id, 'member');

  notify({
    userId: invitee.id,
    actorId: req.user.id,
    type: 'team_invite',
    message: `${req.user.name} added you to the team "${team.name}"`,
  });

  res.status(201).json({ message: `${invitee.name} added to the team`, member: invitee });
}

// GET /api/teams/:id/members
function members(req, res) {
  const team = teamService.requireMember(req.params.id, req.user.id);
  res.json({ members: listMembers.all(team.id) });
}

// DELETE /api/teams/:id/members/:userId   (owner/admin, or yourself to leave)
function removeMember(req, res) {
  const team = teamService.requireMember(req.params.id, req.user.id);
  const targetId = Number(req.params.userId);
  const leavingSelf = targetId === req.user.id;

  if (!leavingSelf) teamService.requireAdmin(team.id, req.user.id);
  if (targetId === team.owner_id) throw ApiError.badRequest('The owner cannot be removed from the team');

  const info = db
    .prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
    .run(team.id, targetId);
  if (info.changes === 0) throw ApiError.notFound('That user is not a member');

  res.status(204).send();
}

module.exports = { create, listMine, getOne, update, remove, join, invite, members, removeMember };
