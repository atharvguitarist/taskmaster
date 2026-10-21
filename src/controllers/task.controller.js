/**
 * Task management: CRUD, list with filter/sort/search, assign, complete.
 */
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const { TASK_SELECT, findTask, formatTask, requireTaskAccess } = require('../services/task.service');
const { getMembership } = require('../services/team.service');
const { notify } = require('../services/notification.service');

const ALLOWED_SORT = { createdAt: 't.created_at', dueDate: 't.due_date', title: 't.title', status: 't.status', priority: 't.priority', updatedAt: 't.updated_at' };

/**
 * Make sure the assignee is allowed for this task:
 *  - if the task has a team, the assignee must be a team member
 *  - otherwise the assignee must simply exist
 */
function checkAssignee(assigneeId, teamId) {
  if (assigneeId == null) return;
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(assigneeId);
  if (!user) throw ApiError.badRequest('Assignee does not exist');
  if (teamId && !getMembership(teamId, assigneeId)) {
    throw ApiError.badRequest('Assignee must be a member of the task\'s team');
  }
  return user;
}

// POST /api/tasks
function create(req, res) {
  const { title, description = '', dueDate = null, priority = 'medium', teamId = null, assigneeId = null } = req.body;

  if (teamId && !getMembership(teamId, req.user.id)) {
    throw ApiError.forbidden('You are not a member of that team');
  }
  checkAssignee(assigneeId, teamId);

  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, due_date, priority, creator_id, assignee_id, team_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(title.trim(), description, dueDate, priority, req.user.id, assigneeId, teamId);

  const task = findTask.get(info.lastInsertRowid);

  notify({
    userId: assigneeId,
    actorId: req.user.id,
    type: 'task_assigned',
    message: `${req.user.name} assigned you the task "${task.title}"`,
    taskId: task.id,
  });

  res.status(201).json({ task: formatTask(task) });
}

/**
 * GET /api/tasks
 * Query params (all optional):
 *   status=open|in_progress|completed     filter by status
 *   priority=low|medium|high              filter by priority
 *   assignee=me|<userId>                  filter by assignee
 *   teamId=<id>                           filter by team
 *   search=<text>                         match title OR description (case-insensitive)
 *   dueBefore=YYYY-MM-DD / dueAfter=...   date range on due_date
 *   sortBy=createdAt|dueDate|title|status|priority|updatedAt   (default createdAt)
 *   order=asc|desc                        (default desc)
 *   page=1&limit=20                       pagination
 */
function list(req, res) {
  const { status, priority, assignee, teamId, search, dueBefore, dueAfter } = req.query;
  const sortBy = ALLOWED_SORT[req.query.sortBy] || 't.created_at';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const page = Math.max(Number(req.query.page) || 1, 1);

  // Base visibility: tasks I created, am assigned, or that belong to my teams.
  const where = [
    `(t.creator_id = @me OR t.assignee_id = @me
      OR t.team_id IN (SELECT team_id FROM team_members WHERE user_id = @me))`,
  ];
  const params = { me: req.user.id };

  if (status) { where.push('t.status = @status'); params.status = status; }
  if (priority) { where.push('t.priority = @priority'); params.priority = priority; }
  if (teamId) { where.push('t.team_id = @teamId'); params.teamId = Number(teamId); }
  if (assignee === 'me') { where.push('t.assignee_id = @me'); }
  else if (assignee) { where.push('t.assignee_id = @assignee'); params.assignee = Number(assignee); }
  if (search) {
    where.push('(t.title LIKE @search OR t.description LIKE @search)');
    params.search = `%${search}%`;
  }
  if (dueBefore) { where.push('t.due_date <= @dueBefore'); params.dueBefore = dueBefore; }
  if (dueAfter) { where.push('t.due_date >= @dueAfter'); params.dueAfter = dueAfter; }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM tasks t ${whereSql}`).get(params).n;
  const rows = db
    .prepare(`${TASK_SELECT} ${whereSql} ORDER BY ${sortBy} ${order}, t.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset: (page - 1) * limit });

  res.json({
    tasks: rows.map(formatTask),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// GET /api/tasks/:id
function getOne(req, res) {
  const task = requireTaskAccess(req.params.id, req.user.id);
  const comments = db
    .prepare(
      `SELECT c.id, c.content, c.created_at AS createdAt, u.id AS userId, u.name AS userName
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at`,
    )
    .all(task.id);
  const attachments = db
    .prepare(
      `SELECT id, original_name AS fileName, mime_type AS mimeType, size_bytes AS size, created_at AS createdAt
       FROM attachments WHERE task_id = ? ORDER BY created_at`,
    )
    .all(task.id);
  res.json({ task: formatTask(task), comments, attachments });
}

// PATCH /api/tasks/:id
function update(req, res) {
  const task = requireTaskAccess(req.params.id, req.user.id);
  const fields = { title: 'title', description: 'description', status: 'status', priority: 'priority', dueDate: 'due_date', assigneeId: 'assignee_id' };

  const sets = [];
  const params = [];
  for (const [bodyKey, column] of Object.entries(fields)) {
    if (req.body[bodyKey] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(bodyKey === 'title' ? req.body.title.trim() : req.body[bodyKey]);
    }
  }
  if (sets.length === 0) throw ApiError.badRequest('Nothing to update');

  const assigneeChanged = req.body.assigneeId !== undefined && req.body.assigneeId !== task.assignee_id;
  if (assigneeChanged) checkAssignee(req.body.assigneeId, task.team_id);

  sets.push("updated_at = datetime('now')");
  params.push(task.id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const updated = findTask.get(task.id);

  if (assigneeChanged) {
    notify({ userId: updated.assignee_id, actorId: req.user.id, type: 'task_assigned',
      message: `${req.user.name} assigned you the task "${updated.title}"`, taskId: updated.id });
  } else {
    // Tell the assignee (and creator) that something changed.
    for (const uid of new Set([updated.assignee_id, updated.creator_id])) {
      notify({ userId: uid, actorId: req.user.id, type: 'task_updated',
        message: `${req.user.name} updated the task "${updated.title}"`, taskId: updated.id });
    }
  }

  res.json({ task: formatTask(updated) });
}

// POST /api/tasks/:id/assign  { assigneeId }
function assign(req, res) {
  req.body = { assigneeId: req.body.assigneeId };
  return update(req, res);
}

// POST /api/tasks/:id/complete
function complete(req, res) {
  req.body = { status: 'completed' };
  return update(req, res);
}

// DELETE /api/tasks/:id
function remove(req, res) {
  const task = requireTaskAccess(req.params.id, req.user.id);
  const isTeamAdmin = task.team_id && ['owner', 'admin'].includes(getMembership(task.team_id, req.user.id)?.role);
  if (task.creator_id !== req.user.id && !isTeamAdmin) {
    throw ApiError.forbidden('Only the task creator or a team admin can delete a task');
  }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.status(204).send();
}

module.exports = { create, list, getOne, update, assign, complete, remove };
