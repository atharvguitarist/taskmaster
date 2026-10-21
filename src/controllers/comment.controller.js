/**
 * Comments on a task.  Nested under /api/tasks/:taskId/comments
 */
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const { requireTaskAccess } = require('../services/task.service');
const { notify } = require('../services/notification.service');

const selectComment = db.prepare(
  `SELECT c.id, c.task_id AS taskId, c.content, c.created_at AS createdAt,
          u.id AS userId, u.name AS userName
   FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
);

// GET /api/tasks/:taskId/comments
function list(req, res) {
  const task = requireTaskAccess(req.params.taskId, req.user.id);
  const comments = db
    .prepare(
      `SELECT c.id, c.content, c.created_at AS createdAt, u.id AS userId, u.name AS userName
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.created_at`,
    )
    .all(task.id);
  res.json({ comments });
}

// POST /api/tasks/:taskId/comments  { content }
function create(req, res) {
  const task = requireTaskAccess(req.params.taskId, req.user.id);
  const info = db
    .prepare('INSERT INTO comments (task_id, user_id, content) VALUES (?, ?, ?)')
    .run(task.id, req.user.id, req.body.content.trim());
  const comment = selectComment.get(info.lastInsertRowid);

  // Notify everyone involved with the task except the commenter.
  for (const uid of new Set([task.creator_id, task.assignee_id])) {
    notify({ userId: uid, actorId: req.user.id, type: 'task_comment',
      message: `${req.user.name} commented on "${task.title}"`, taskId: task.id });
  }

  res.status(201).json({ comment });
}

// DELETE /api/tasks/:taskId/comments/:id   (only the author)
function remove(req, res) {
  requireTaskAccess(req.params.taskId, req.user.id);
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND task_id = ?').get(req.params.id, req.params.taskId);
  if (!comment) throw ApiError.notFound('Comment not found');
  if (comment.user_id !== req.user.id) throw ApiError.forbidden('You can only delete your own comments');

  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.status(204).send();
}

module.exports = { list, create, remove };
