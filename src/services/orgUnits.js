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

module.exports = { create, update, pathFor };
