/**
 * Notifications + real-time delivery via Server-Sent Events (SSE).
 *
 * How it works:
 *  1. Something happens (task assigned, comment added...) -> notify(userId, ...)
 *  2. The notification is saved in the DB (so it survives if the user is offline).
 *  3. If that user currently has an open SSE connection (GET /api/notifications/stream),
 *     the notification is pushed to them instantly.
 *
 * SSE was chosen over WebSockets because it needs no extra library, works over
 * plain HTTP, and one-way server->client push is all notifications need.
 */
const db = require('../config/db');

const insert = db.prepare(
  'INSERT INTO notifications (user_id, type, message, task_id) VALUES (?, ?, ?, ?)',
);
const selectOne = db.prepare('SELECT * FROM notifications WHERE id = ?');

// userId -> Set of open response objects (a user may have several tabs open)
const clients = new Map();

function subscribe(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

function unsubscribe(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

function push(userId, event, data) {
  const set = clients.get(userId);
  if (!set) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(frame);
}

/**
 * Create a notification for a user and push it live if they're connected.
 * Skips when the actor is notifying themselves (no point telling you what you just did).
 */
function notify({ userId, actorId, type, message, taskId = null }) {
  if (!userId || userId === actorId) return null;
  const info = insert.run(userId, type, message, taskId);
  const notification = selectOne.get(info.lastInsertRowid);
  push(userId, 'notification', notification);
  return notification;
}

module.exports = { subscribe, unsubscribe, notify, push };
