'use strict';
// Idempotency for offline sync. A mutation carrying X-Op-Id is processed at most
// once: the first successful (2xx) result is stored and returned on any replay,
// so re-sending a queued operation never double-applies it. Non-2xx responses
// are not stored, so a transient failure can still be retried.
const db = require('../db/runtime');

module.exports = async function idempotency(req, res, next) {
  const opId = req.headers['x-op-id'];
  if (!opId || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const id = String(opId).slice(0, 80);
  try {
    const existing = await db.get('SELECT status, result FROM sync_ops WHERE op_id = ?', [id]);
    if (existing) { res.set('X-Idempotent-Replay', '1'); res.status(existing.status || 200); return res.json(existing.result ? JSON.parse(existing.result) : null); }
  } catch (_) { /* fall through and process normally */ }
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      db.run(`INSERT INTO sync_ops (op_id, status, result, created_at) VALUES (?, ?, ?, ${db.now()}) ON CONFLICT DO NOTHING`, [id, res.statusCode, JSON.stringify(body)]).catch(() => {});
    }
    return origJson(body);
  };
  return next();
};
