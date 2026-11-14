'use strict';
// Audit ledger (ports AuditLogController) — requires audit.view.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const roleRepository = require('../../services/roleRepository');
const { requireAuth } = require('../../middleware/auth');
const { forbidden, notFound } = require('../../middleware/errorHandler');
const redact = require('../../util/redact');
function values(value) { if (!value) return null; try { return redact(JSON.parse(value)); } catch (_) { return value; } }

const BASE = 'FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id';

// The App Owner and System Administrators see the whole ledger; a Supervisor (or
// any OU-scoped viewer) sees only entries whose actor is within their org unit.
async function auditScope(req) {
  const user = req.session.user;
  if (user.is_super_admin) return { clause: '', params: [] };
  const caps = await roleRepository.capsForUser(user.id);
  if (caps.includes(CAP.SYSTEM_ADMIN)) return { clause: '', params: [] };
  const scope = await orgScope.visibleOrgUnitIds(user);
  if (scope === null) return { clause: '', params: [] };
  if (!scope.length) return { clause: ' AND 1 = 0', params: [] };
  return { clause: ` AND u.org_unit_id IN (${scope.map(() => '?').join(',')})`, params: scope };
}

function buildWhere(q) {
  const where = ['1=1']; const params = [];
  if (q.action) { where.push('a.action = ?'); params.push(String(q.action)); }
  if (q.entity_type) { where.push('a.entity_type = ?'); params.push(String(q.entity_type)); }
  if (q.user_id) { where.push('a.user_id = ?'); params.push(Number(q.user_id)); }
  if (q.date_from) { where.push('substr(a.created_at,1,10) >= substr(?,1,10)'); params.push(q.date_from); }
  if (q.date_to) { where.push('substr(a.created_at,1,10) <= substr(?,1,10)'); params.push(q.date_to); }
  if (q.search) { const s = `%${q.search}%`; where.push('(a.description LIKE ? OR a.action LIKE ? OR a.actor_name LIKE ? OR u.name LIKE ?)'); params.push(s, s, s, s); }
  return { whereSql: where.join(' AND '), params };
}

const toRow = (a) => ({
  id: a.id, action: a.action, description: a.description, entity_type: a.entity_type, entity_id: a.entity_id,
  actor: a.user_name || a.actor_name || null, user: a.user_name ? { id: a.user_id, name: a.user_name } : null,
  ip_address: a.ip_address, user_agent: a.user_agent, old_values: values(a.old_values),
  new_values: values(a.new_values), created_at: a.created_at,
});

function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

module.exports = function register(router) {
  router.get('/audit-logs', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.AUDIT_VIEW))) throw forbidden('You may not view the audit log.');
    const base = buildWhere(req.query); const sc = await auditScope(req);
    const whereSql = base.whereSql + sc.clause; const params = [...base.params, ...sc.params];
    const sort = String(req.query.sort || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    const total = (await db.get(`SELECT COUNT(*) AS n ${BASE} WHERE ${whereSql}`, params)).n;
    const rows = await db.all(`SELECT a.*, u.name AS user_name ${BASE} WHERE ${whereSql} ORDER BY a.created_at ${sort}, a.id ${sort} LIMIT ? OFFSET ?`, [...params, perPage, (page - 1) * perPage]);
    res.json({ data: rows.map(toRow), meta: { current_page: page, per_page: perPage, total, last_page: Math.max(1, Math.ceil(total / perPage)) } });
  });

  router.get('/audit-logs/export', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.AUDIT_VIEW))) throw forbidden('You may not view the audit log.');
    const base = buildWhere(req.query); const sc = await auditScope(req);
    const whereSql = base.whereSql + sc.clause; const params = [...base.params, ...sc.params];
    const rows = await db.all(`SELECT a.*, u.name AS user_name ${BASE} WHERE ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT 10000`, params);
    const header = ['When', 'Action', 'By', 'Record type', 'Record id', 'Detail', 'IP'];
    const lines = [header.join(',')];
    for (const a of rows) {
      lines.push([a.created_at, a.action, a.user_name || a.actor_name || '', a.entity_type || '', a.entity_id || '', a.description || '', a.ip_address || ''].map(csvCell).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '').slice(0, 15);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="audit-log_${stamp}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  });
  router.get('/audit-logs/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.AUDIT_VIEW))) throw forbidden('You may not view the audit log.');
    if (!/^\d+$/.test(req.params.id)) throw notFound('Audit entry not found.');
    const scope = await auditScope(req);
    const row = await db.get(`SELECT a.*, u.name AS user_name ${BASE} WHERE a.id = ?${scope.clause}`, [req.params.id, ...scope.params]);
    if (!row) throw notFound('Audit entry not found.');
    res.set('Cache-Control', 'no-store'); res.json({ data: toRow(row) });
  });
};
