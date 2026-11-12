'use strict';
// Append-only audit ledger: who did what, when, from where. Never throws into
// the caller — an audit failure must not break the action being audited.
const db = require('./db_ref');

async function record({ userId = null, actorName = null, action, description = null, entityType = null, entityId = null, oldValues = null, newValues = null, ip = null, userAgent = null } = {}) {
  try {
    await db.run(
      `INSERT INTO audit_logs (user_id, actor_name, action, description, entity_type, entity_id, old_values, new_values, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()})`,
      [userId, actorName, action, description, entityType, entityId,
        oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, ip, userAgent]
    );
  } catch (err) { require('../util/log').warn('audit_failed', { action, message: err.message }); }
}

// Convenience to pull actor + request context off an Express request.
function from(req, fields) {
  const user = req.session && req.session.user;
  return record({ userId: user ? user.id : null, actorName: user ? user.name : null, ip: req.ip, userAgent: req.headers['user-agent'], ...fields });
}

module.exports = { record, from };
