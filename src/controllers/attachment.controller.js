/**
 * File attachments on a task.  Nested under /api/tasks/:taskId/attachments
 *
 * Files are stored on disk in the `uploads/` folder with a random name
 * (so two people uploading "report.pdf" never collide), and the original
 * file name is kept in the database for display and download.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { requireTaskAccess } = require('../services/task.service');
const { notify } = require('../services/notification.service');

// ---- multer configuration (how uploaded files are received) ----
const storage = multer.diskStorage({
  destination: env.uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10); // keep extension, cap length
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

// Express middleware: expects a multipart/form-data body with a field called "file".
const upload = multer({ storage, limits: { fileSize: env.maxUploadBytes } }).single('file');

const selectAttachment = db.prepare('SELECT * FROM attachments WHERE id = ? AND task_id = ?');

function format(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    fileName: row.original_name,
    mimeType: row.mime_type,
    size: row.size_bytes,
    uploadedBy: row.user_id,
    createdAt: row.created_at,
    downloadUrl: `/api/tasks/${row.task_id}/attachments/${row.id}/download`,
  };
}

// GET /api/tasks/:taskId/attachments
function list(req, res) {
  const task = requireTaskAccess(req.params.taskId, req.user.id);
  const rows = db.prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at').all(task.id);
  res.json({ attachments: rows.map(format) });
}

// POST /api/tasks/:taskId/attachments   (multipart, field "file")
function create(req, res) {
  const task = requireTaskAccess(req.params.taskId, req.user.id);
  if (!req.file) throw ApiError.badRequest('No file uploaded. Send multipart/form-data with a "file" field.');

  const info = db
    .prepare(
      `INSERT INTO attachments (task_id, user_id, stored_name, original_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(task.id, req.user.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size);

  for (const uid of new Set([task.creator_id, task.assignee_id])) {
    notify({ userId: uid, actorId: req.user.id, type: 'task_attachment',
      message: `${req.user.name} attached "${req.file.originalname}" to "${task.title}"`, taskId: task.id });
  }

  res.status(201).json({ attachment: format(selectAttachment.get(info.lastInsertRowid, task.id)) });
}

// GET /api/tasks/:taskId/attachments/:id/download
function download(req, res) {
  requireTaskAccess(req.params.taskId, req.user.id);
  const row = selectAttachment.get(req.params.id, req.params.taskId);
  if (!row) throw ApiError.notFound('Attachment not found');
  res.download(path.join(env.uploadDir, row.stored_name), row.original_name);
}

// DELETE /api/tasks/:taskId/attachments/:id   (uploader only)
function remove(req, res) {
  requireTaskAccess(req.params.taskId, req.user.id);
  const row = selectAttachment.get(req.params.id, req.params.taskId);
  if (!row) throw ApiError.notFound('Attachment not found');
  if (row.user_id !== req.user.id) throw ApiError.forbidden('You can only delete attachments you uploaded');

  db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
  fs.rm(path.join(env.uploadDir, row.stored_name), { force: true }, () => {});
  res.status(204).send();
}

module.exports = { upload, list, create, download, remove };
