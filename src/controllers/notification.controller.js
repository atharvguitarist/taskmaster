const db = require('../config/db');
const notifications = require('../services/notification.service');

// GET /api/notifications?unread=true
function list(req, res) {
  const onlyUnread = req.query.unread === 'true';
  const rows = db
    .prepare(
      `SELECT * FROM notifications
       WHERE user_id = ? ${onlyUnread ? 'AND is_read = 0' : ''}
       ORDER BY created_at DESC LIMIT 100`,
    )
    .all(req.user.id);
  res.json({ notifications: rows });
}

// PATCH /api/notifications/:id/read
function markRead(req, res) {
  const info = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: { message: 'Notification not found' } });
  res.json({ message: 'Marked as read' });
}

// PATCH /api/notifications/read-all
function markAllRead(req, res) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All notifications marked as read' });
}

/**
 * GET /api/notifications/stream  -- Server-Sent Events.
 *
 * Try it in a browser console (replace TOKEN):
 *   fetch('/api/notifications/stream', { headers: { Authorization: 'Bearer TOKEN' } })
 * or with curl:  curl -N -H "Authorization: Bearer TOKEN" http://localhost:3000/api/notifications/stream
 */
function stream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('event: connected\ndata: {"message":"Listening for notifications"}\n\n');

  notifications.subscribe(req.user.id, res);

  // Keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    notifications.unsubscribe(req.user.id, res);
  });
}

module.exports = { list, markRead, markAllRead, stream };
