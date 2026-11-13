'use strict';

// After a directory (LDAP/AD) sign-in, enrich the local account from the Unified
// API: resolve the staff by the email/username they signed in with, pull their
// organisational unit (college -> department) and staff attributes, auto-create
// the org-unit tree, and set the user's org_unit_id. Staff data only.
//
// First sync (no org unit yet) sets the org unit directly. A later sync that
// finds a DIFFERENT org unit records it as a *pending* change (pending_org_unit_id)
// rather than moving the person silently — the OU-change workflow (notify admins,
// auto-move after a grace period) acts on that. Everyone stays a "client" (no
// role) until an administrator assigns one.
const db = require('./db_ref');
const unifiedApi = require('./unifiedApi');
const orgUnits = require('./orgUnits');
const settings = require('./settings');
const notifications = require('./notifications');
const log = require('../util/log');

const DAY_MS = 86_400_000;

// Days a person's organisational unit may differ from the source before it is
// applied automatically (0 = apply at once). Admins are notified either way.
async function graceDays() {
  const raw = await settings.get('ou_change_grace_days', '7');
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}
function tsMs(s) { return s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ+]/.test(String(s)) ? '' : 'Z')) : 0; }
function olderThan(since, ms) { const t = tsMs(since); return t > 0 && Date.now() - t > ms; }
async function orgName(id) { if (!id) return 'Unassigned'; const r = await db.get('SELECT name FROM org_units WHERE id = ?', [id]); return r ? r.name : `unit ${id}`; }
async function notifyPending(user, fromId, toId) {
  try { await notifications.toRoles(['administrator'], 'ou_change_pending', { user_id: user.id, name: user.name, from: await orgName(fromId), to: await orgName(toId) }); } catch (_) { /* best-effort */ }
}
async function notifyAutoMoved(user, toId) {
  try { await notifications.toRoles(['administrator'], 'ou_auto_moved', { user_id: user.id, name: user.name, to: await orgName(toId) }); } catch (_) { /* best-effort */ }
}

// A Unified API field value can be a string, a one-element list, or {value}.
function textField(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  if (typeof v === 'object') return String(v.value ?? v.text ?? v.name ?? '').trim();
  return String(v).trim();
}

// Find-or-create an org unit by (name, type) under parentId.
async function ensureUnit(name, type, parentId) {
  const nm = String(name || '').trim();
  if (!nm) return parentId || null;
  const where = parentId ? 'parent_id = ?' : 'parent_id IS NULL';
  const params = parentId ? [nm, type, parentId] : [nm, type];
  const existing = await db.get(`SELECT id FROM org_units WHERE lower(name) = lower(?) AND type = ? AND ${where} AND deleted_at IS NULL`, params);
  if (existing) return existing.id;
  return orgUnits.create({ name: nm, type, parent_id: parentId || null });
}

async function rootInstitutionId() {
  const r = await db.get("SELECT id FROM org_units WHERE type = 'institution' AND deleted_at IS NULL ORDER BY id LIMIT 1");
  return r ? r.id : null;
}

// Resolve (creating as needed) the org unit for a staff profile's college/department.
async function orgUnitForProfile(fields) {
  const college = textField(fields.college);
  const department = textField(fields.department);
  if (!college && !department) return null;
  let parent = await rootInstitutionId();
  if (college) parent = await ensureUnit(college, 'college', parent);
  if (department) return ensureUnit(department, 'department', parent);
  return parent;
}

// Pick the Unified API search result that best matches the login identity.
function bestMatch(results, identity) {
  const id = String(identity || '').trim().toLowerCase();
  const local = id.includes('@') ? id.split('@')[0] : id;
  const eq = (a) => String(a || '').trim().toLowerCase();
  return results.find((r) => eq(r.email) === id || eq(r.username) === local || eq(r.email).split('@')[0] === local)
    || (results.length === 1 ? results[0] : null)
    || results[0] || null;
}

// Resolve + sync one user from the Unified API. `identity` is the email/username
// they signed in with. Best-effort: any failure leaves the account unchanged.
// Returns { synced, staffId, orgUnitId, pendingOrgUnitId, changedOrg }.
async function syncUser(userId, identity) {
  try {
    if (!(await unifiedApi.enabled())) return { synced: false, reason: 'disabled' };
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user || user.is_super_admin) return { synced: false, reason: 'skipped' };
    const q = String(identity || user.email || '').trim();
    if (!q) return { synced: false, reason: 'no_identity' };

    const search = await unifiedApi.searchStaff(q);
    if (search.status !== 'ok' || !search.results.length) return { synced: false, reason: search.status === 'ok' ? 'not_found' : search.reason };
    const match = bestMatch(search.results, q);
    if (!match || !match.id_number) return { synced: false, reason: 'no_match' };

    const prof = await unifiedApi.staffProfile(match.id_number);
    if (prof.status !== 'found') return { synced: false, reason: prof.reason || prof.status };
    const f = prof.fields;

    const resolvedOrg = await orgUnitForProfile(f);
    const fields = {
      staff_id: prof.id_number,
      staff_rank: textField(f.rank) || null,
      designation: textField(f.designation) || textField(f.designation_group) || null,
      staff_category: textField(f.staff_category) || null,
      staff_type: textField(f.staff_type) || null,
      college_name: textField(f.college) || null,
      department_name: textField(f.department) || null,
    };

    const graceMs = (await graceDays()) * DAY_MS;
    let setOrg = null;
    let pendingOrgUnitId = user.pending_org_unit_id || null;
    let newlyPending = false;
    let autoMoved = false;
    if (resolvedOrg) {
      if (!user.org_unit_id) {
        setOrg = resolvedOrg; pendingOrgUnitId = null;                 // first assignment — apply directly
      } else if (Number(resolvedOrg) === Number(user.org_unit_id)) {
        pendingOrgUnitId = null;                                       // back in sync — clear any pending
      } else {
        const samePending = user.pending_org_unit_id && Number(user.pending_org_unit_id) === Number(resolvedOrg);
        if (samePending && olderThan(user.pending_org_since, graceMs)) {
          setOrg = resolvedOrg; pendingOrgUnitId = null; autoMoved = true;   // grace elapsed — apply
        } else {
          pendingOrgUnitId = resolvedOrg; newlyPending = !samePending;       // record / keep pending
        }
      }
    }

    const sets = Object.entries(fields).map(([k]) => `${k} = ?`);
    const params = Object.values(fields);
    sets.push(`unified_synced_at = ${db.now()}`);
    if (setOrg) { sets.push('org_unit_id = ?'); params.push(setOrg); }
    sets.push('pending_org_unit_id = ?'); params.push(pendingOrgUnitId);
    if (pendingOrgUnitId && newlyPending) sets.push(`pending_org_since = ${db.now()}`);
    else if (!pendingOrgUnitId) sets.push('pending_org_since = NULL');
    params.push(userId);
    await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);

    if (newlyPending) await notifyPending(user, user.org_unit_id, resolvedOrg);
    if (autoMoved) await notifyAutoMoved(user, resolvedOrg);

    return { synced: true, staffId: prof.id_number, orgUnitId: setOrg || user.org_unit_id, pendingOrgUnitId, changedOrg: newlyPending, autoMoved };
  } catch (err) {
    log.warn('staff_sync_error', { userId, message: err.message });
    return { synced: false, reason: err.message };
  }
}

// Apply any pending OU change whose grace period has elapsed, for people who have
// not signed in. Safe to run periodically. Returns how many were moved.
async function sweepAgedPendingMoves() {
  try {
    const graceMs = (await graceDays()) * DAY_MS;
    const rows = await db.all('SELECT id, name, pending_org_unit_id, pending_org_since FROM users WHERE pending_org_unit_id IS NOT NULL AND deleted_at IS NULL');
    let moved = 0;
    for (const u of rows) {
      if (!olderThan(u.pending_org_since, graceMs)) continue;
      await db.run(`UPDATE users SET org_unit_id = ?, pending_org_unit_id = NULL, pending_org_since = NULL, updated_at = ${db.now()} WHERE id = ?`, [u.pending_org_unit_id, u.id]);
      await notifyAutoMoved(u, u.pending_org_unit_id);
      moved += 1;
    }
    if (moved) log.info('ou_auto_moved', { count: moved });
    return moved;
  } catch (err) { log.warn('ou_sweep_error', { message: err.message }); return 0; }
}

module.exports = { syncUser, orgUnitForProfile, ensureUnit, textField, sweepAgedPendingMoves, graceDays };
