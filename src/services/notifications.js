'use strict';
// In-app notifications (database channel) + fan-out to email/SMS/Web Push, gated
// by feature flags in system_settings. Email/SMS/Push transports are wired in a
// later step; this records the durable in-app notification now and is safe to
// call from any lifecycle event. Never throws into the caller.
const crypto = require('crypto');
const db = require('./db_ref');
const log = require('../util/log');

// Record one in-app notification for a user.
async function toUser(userId, type, data) {
  if (!userId) return;
  try {
    await db.run(
      `INSERT INTO notifications (id, user_id, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [crypto.randomUUID(), userId, type, JSON.stringify(data || {})]
    );
    // Best-effort external transports (configured later).
    try { await require('./transports').fanout(userId, type, data); } catch (_) { /* transports optional */ }
  } catch (err) { log.warn('notify_failed', { type, userId, message: err.message }); }
}

// Record the same notification for every active user holding one of the roles.
async function toRoles(roleSlugs, type, data) {
  try {
    const placeholders = roleSlugs.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 AND u.deleted_at IS NULL AND r.slug IN (${placeholders})`,
      roleSlugs
    );
    for (const r of rows) await toUser(r.id, type, data);
  } catch (err) { log.warn('notify_roles_failed', { type, message: err.message }); }
}

// Approvers + administrators — the standard "new request" audience.
async function toApprovers(type, data) { return toRoles(['approver', 'administrator'], type, data); }

async function listForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  const rows = await db.all(
    `SELECT id, type, data, read_at, created_at FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map((r) => ({ id: r.id, type: r.type, data: JSON.parse(r.data || '{}'), read_at: r.read_at, created_at: r.created_at }));
}
async function unreadCount(userId) {
  const row = await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
  return row ? row.n : 0;
}
async function markRead(userId, id) { await db.run(`UPDATE notifications SET read_at = ${db.now()} WHERE id = ? AND user_id = ? AND read_at IS NULL`, [id, userId]); }
async function markAllRead(userId) { await db.run(`UPDATE notifications SET read_at = ${db.now()} WHERE user_id = ? AND read_at IS NULL`, [userId]); }

module.exports = { toUser, toRoles, toApprovers, listForUser, unreadCount, markRead, markAllRead };
