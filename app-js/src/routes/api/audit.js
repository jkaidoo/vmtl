'use strict';
// Audit ledger (ports AuditLogController) — requires audit.view.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const { requireAuth } = require('../../middleware/auth');
const { forbidden } = require('../../middleware/errorHandler');

module.exports = function register(router) {
  router.get('/audit-logs', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.AUDIT_VIEW))) throw forbidden('You may not view the audit log.');
    const where = ['1=1']; const params = [];
    if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)); }
    if (req.query.entity_type) { where.push('a.entity_type = ?'); params.push(String(req.query.entity_type)); }
    if (req.query.user_id) { where.push('a.user_id = ?'); params.push(Number(req.query.user_id)); }
    if (req.query.date_from) { where.push('substr(a.created_at,1,10) >= substr(?,1,10)'); params.push(req.query.date_from); }
    if (req.query.date_to) { where.push('substr(a.created_at,1,10) <= substr(?,1,10)'); params.push(req.query.date_to); }
    if (req.query.search) { where.push('a.description LIKE ?'); params.push(`%${req.query.search}%`); }
    const whereSql = where.join(' AND ');
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 25));
    const page = Math.max(1, Number(req.query.page) || 1);
    const total = (await db.get(`SELECT COUNT(*) AS n FROM audit_logs a WHERE ${whereSql}`, params)).n;
    const rows = await db.all(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`, [...params, perPage, (page - 1) * perPage]);
    const data = rows.map((a) => ({ id: a.id, action: a.action, description: a.description, entity_type: a.entity_type, entity_id: a.entity_id, user: a.user_name ? { id: a.user_id, name: a.user_name } : null, ip_address: a.ip_address, old_values: a.old_values ? JSON.parse(a.old_values) : null, new_values: a.new_values ? JSON.parse(a.new_values) : null, created_at: a.created_at }));
    res.json({ data, meta: { current_page: page, per_page: perPage, total, last_page: Math.max(1, Math.ceil(total / perPage)) } });
  });
};
