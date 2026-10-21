/**
 * Shared task helpers: fetching a task with joined user names, and the
 * access rule used by every task/comment/attachment endpoint.
 *
 * Access rule: you can see/edit a task if you created it, it's assigned to you,
 * or it belongs to a team you're a member of.
 */
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const { getMembership } = require('./team.service');

const TASK_SELECT = `
  SELECT t.*,
         c.name AS creator_name,
         a.name AS assignee_name,
         tm.name AS team_name
  FROM tasks t
  JOIN users c       ON c.id = t.creator_id
  LEFT JOIN users a  ON a.id = t.assignee_id
  LEFT JOIN teams tm ON tm.id = t.team_id
`;

const findTask = db.prepare(`${TASK_SELECT} WHERE t.id = ?`);

/** Convert a DB row (snake_case) to the API shape (camelCase). */
function formatTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    creator: { id: row.creator_id, name: row.creator_name },
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null,
    team: row.team_id ? { id: row.team_id, name: row.team_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canAccess(task, userId) {
  if (task.creator_id === userId || task.assignee_id === userId) return true;
  if (task.team_id && getMembership(task.team_id, userId)) return true;
  return false;
}

/** Throws 404 / 403 as appropriate. Returns the raw task row. */
function requireTaskAccess(taskId, userId) {
  const task = findTask.get(taskId);
  if (!task) throw ApiError.notFound('Task not found');
  if (!canAccess(task, userId)) throw ApiError.forbidden('You do not have access to this task');
  return task;
}

module.exports = { TASK_SELECT, findTask, formatTask, requireTaskAccess };
