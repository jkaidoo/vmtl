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
const log = require('../util/log');

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

    let changedOrg = false;
    let pendingOrgUnitId = user.pending_org_unit_id || null;
    let setOrg = null;
    if (resolvedOrg) {
      if (!user.org_unit_id) {
        setOrg = resolvedOrg;                       // first assignment — apply directly
      } else if (Number(resolvedOrg) !== Number(user.org_unit_id)) {
        changedOrg = true;                          // source OU moved — record as pending
        pendingOrgUnitId = resolvedOrg;
      } else {
        pendingOrgUnitId = null;                    // back in sync — clear any pending
      }
    }

    const sets = Object.entries(fields).map(([k]) => `${k} = ?`);
    const params = Object.values(fields);
    sets.push(`unified_synced_at = ${db.now()}`);
    if (setOrg) { sets.push('org_unit_id = ?'); params.push(setOrg); }
    sets.push('pending_org_unit_id = ?'); params.push(pendingOrgUnitId);
    if (changedOrg && !user.pending_org_since) sets.push(`pending_org_since = ${db.now()}`);
    if (!pendingOrgUnitId) sets.push('pending_org_since = NULL');
    params.push(userId);
    await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);

    return { synced: true, staffId: prof.id_number, orgUnitId: setOrg || user.org_unit_id, pendingOrgUnitId, changedOrg };
  } catch (err) {
    log.warn('staff_sync_error', { userId, message: err.message });
    return { synced: false, reason: err.message };
  }
}

module.exports = { syncUser, orgUnitForProfile, ensureUnit, textField };
