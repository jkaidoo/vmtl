'use strict';
// Org-unit creation/update with materialised-path maintenance (ports OrgUnit's
// booted() path logic). A unit's path is its parent's path + its own id + '/'.
const db = require('./db_ref');

async function pathFor(id, parentId) {
  const parent = parentId ? await db.get('SELECT path FROM org_units WHERE id = ?', [parentId]) : null;
  return `${parent && parent.path ? parent.path : '/'}${id}/`;
}

async function create({ name, code, type, parent_id, active = 1 }) {
  const r = await db.run(`INSERT INTO org_units (name, code, type, parent_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`, [name, code || null, type, parent_id || null, active ? 1 : 0]);
  const id = r.lastInsertRowid;
  await db.run('UPDATE org_units SET path = ? WHERE id = ?', [await pathFor(id, parent_id), id]);
  return id;
}

// Update a unit; if its parent changed, recompute its path and cascade to descendants.
async function update(id, fields) {
  const before = await db.get('SELECT * FROM org_units WHERE id = ?', [id]);
  const sets = []; const params = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); params.push(v); }
  if (sets.length) await db.run(`UPDATE org_units SET ${sets.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, id]);
  if ('parent_id' in fields && Number(fields.parent_id || 0) !== Number(before.parent_id || 0)) {
    const oldPath = before.path || `/${id}/`;
    const newPath = await pathFor(id, fields.parent_id);
    if (newPath !== oldPath) {
      await db.run('UPDATE org_units SET path = ? WHERE id = ?', [newPath, id]);
      // Rewrite every descendant's path prefix.
      const descendants = await db.all('SELECT id, path FROM org_units WHERE path LIKE ?', [`${oldPath}%`]);
      for (const d of descendants) if (d.id !== id) await db.run('UPDATE org_units SET path = ? WHERE id = ?', [newPath + d.path.slice(oldPath.length), d.id]);
    }
  }
}

// --- Idempotent resolvers, shared by the Unified-API staff sync and the
// "Import Departments" seed. Both must land a given college/faculty/department
// on the SAME node so a later sync never duplicates what the import created.
//
// The reconciliation rules follow what the Unified API actually returns per
// staff (a college and a department string; faculty is usually absent):
//   * a college/directorate is matched by NAME across both bucket types,
//     regardless of its parent, so "Finance Office" resolves whether it was
//     seeded as a directorate or arrives from a staff record as a college;
//   * a department is matched by name anywhere inside the college's subtree
//     (then globally), so a staff record carrying only college + department
//     still finds a department the import placed under a faculty.

async function institutionId() {
  const r = await db.get("SELECT id FROM org_units WHERE type = 'institution' AND deleted_at IS NULL ORDER BY id LIMIT 1");
  return r ? r.id : null;
}

async function ensureInstitution(name = 'Kwame Nkrumah University of Science and Technology', code = 'KNUST') {
  const existing = await institutionId();
  if (existing) return existing;
  return create({ name, code, type: 'institution', parent_id: null });
}

async function pathOf(id) {
  if (!id) return null;
  const r = await db.get('SELECT path FROM org_units WHERE id = ?', [id]);
  return r ? r.path : null;
}

// A college or directorate: matched by name across both types (so the live feed
// and the seed converge), created under the institution when absent.
async function resolveBucket(name, parentId, { createType = 'college' } = {}) {
  const nm = String(name || '').trim();
  if (!nm) return null;
  const ex = await db.get("SELECT id FROM org_units WHERE lower(name) = lower(?) AND type IN ('college','directorate') AND deleted_at IS NULL ORDER BY id LIMIT 1", [nm]);
  if (ex) return ex.id;
  return create({ name: nm, type: createType, parent_id: parentId || null });
}

// A faculty, matched inside the ancestor's subtree (else globally), created
// under the ancestor when absent.
async function resolveFaculty(name, ancestorId) {
  const nm = String(name || '').trim();
  if (!nm) return ancestorId || null;
  const ap = await pathOf(ancestorId);
  const ex = ap
    ? await db.get("SELECT id FROM org_units WHERE lower(name) = lower(?) AND type = 'faculty' AND path LIKE ? AND deleted_at IS NULL ORDER BY path LIMIT 1", [nm, `${ap}%`])
    : await db.get("SELECT id FROM org_units WHERE lower(name) = lower(?) AND type = 'faculty' AND deleted_at IS NULL ORDER BY id LIMIT 1", [nm]);
  if (ex) return ex.id;
  return create({ name: nm, type: 'faculty', parent_id: ancestorId || null });
}

// A department, matched by name inside the ancestor's subtree first, then
// globally, so the faculty tier the seed adds never splits a department off
// from where a staff sign-in (college + department only) would look for it.
async function resolveDepartment(name, { ancestorId = null, parentId = null } = {}) {
  const nm = String(name || '').trim();
  if (!nm) return parentId || ancestorId || null;
  const ap = await pathOf(ancestorId);
  let ex = ap
    ? await db.get("SELECT id FROM org_units WHERE lower(name) = lower(?) AND type = 'department' AND path LIKE ? AND deleted_at IS NULL ORDER BY path LIMIT 1", [nm, `${ap}%`])
    : null;
  if (!ex) ex = await db.get("SELECT id FROM org_units WHERE lower(name) = lower(?) AND type = 'department' AND deleted_at IS NULL ORDER BY id LIMIT 1", [nm]);
  if (ex) return ex.id;
  return create({ name: nm, type: 'department', parent_id: parentId || ancestorId || null });
}

module.exports = { create, update, pathFor, institutionId, ensureInstitution, resolveBucket, resolveFaculty, resolveDepartment };
