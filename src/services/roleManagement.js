'use strict';
const db = require('../db/runtime');
const capabilities = require('./capabilities');
const { ApiError } = require('../middleware/errorHandler');
function fields(input, creating = false) {
  if (typeof input?.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new ApiError(422, 'Enter a role name of 1–100 characters.');
  if (input.description != null && (typeof input.description !== 'string' || input.description.length > 1000)) throw new ApiError(422, 'Description must be at most 1,000 characters.');
  const out = { name: input.name.trim(), description: (input.description || '').trim() };
  if (creating) {
    out.slug = String(input.slug || out.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(out.slug)) throw new ApiError(422, 'Use a role key starting with a letter, with lowercase letters, numbers and underscores (up to 64 characters).');
  }
  return out;
}
function caps(input) {
  if (!Array.isArray(input) || input.some(c => !capabilities.all().includes(c))) throw new ApiError(422, 'Choose valid capabilities.');
  return [...new Set(input)];
}
async function create(input) {
  const role = fields(input, true); const desired = caps(input.capabilities || []);
  try {
    return await db.transaction(async tx => {
      if (await tx.get('SELECT id FROM roles WHERE slug=?', [role.slug])) throw new ApiError(409, 'A role with that key already exists.');
      const row = await tx.run('INSERT INTO roles(slug,name,description) VALUES(?,?,?)', [role.slug, role.name, role.description]);
      const id = row.lastInsertRowid;
      for (const cap of desired) await tx.run('INSERT INTO role_capabilities(role_id,capability) VALUES(?,?)', [id, cap]);
      return { ...role, id, capabilities: desired };
    });
  } catch (error) { if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ApiError(409, 'A role with that key already exists.'); throw error; }
}
async function update(id, input) {
  const role = fields(input);
  const before = await db.get('SELECT * FROM roles WHERE id=?', [id]);
  if (!before) throw new ApiError(404, 'Role not found.');
  if ('slug' in input && input.slug !== before.slug) throw new ApiError(422, 'The role key cannot be changed. Edit the name and description instead.');
  await db.run(`UPDATE roles SET name=?,description=?,updated_at=${db.now()} WHERE id=?`, [role.name, role.description, id]);
  return { before, after: { ...before, ...role } };
}
async function remove(id, replacementId, actor) {
  id = Number(id);
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(404, 'Role not found.');
  const replacement = replacementId == null || replacementId === '' ? null : Number(replacementId);
  if (replacement !== null && (!Number.isSafeInteger(replacement) || replacement < 1 || replacement === id)) throw new ApiError(422, 'Choose a different replacement role.');
  return db.transaction(async tx => {
    const role = await tx.get(`SELECT * FROM roles WHERE id=?${db.isPostgres() ? ' FOR UPDATE' : ''}`, [id]);
    if (!role) throw new ApiError(404, 'Role not found.');
    if (replacement && !await tx.get('SELECT id FROM roles WHERE id=?', [replacement])) throw new ApiError(422, 'Replacement role not found.');
    const count = Number((await tx.get('SELECT COUNT(*) AS n FROM users WHERE role_id=?', [id])).n);
    if (count && !replacement) throw new ApiError(409, 'Choose a replacement role for the accounts assigned to this role.');
    const currentUser = await tx.get('SELECT role_id FROM users WHERE id=?', [actor.id]);
    if (!actor.is_super_admin && Number(currentUser?.role_id) === id) {
      const admin = replacement && await tx.get("SELECT id FROM role_capabilities WHERE role_id=? AND capability='system.admin'", [replacement]);
      if (!admin) throw new ApiError(409, 'Choose a replacement with System administration access to keep your RBAC access.');
    }
    const granted = replacement ? (await tx.all('SELECT capability FROM role_capabilities WHERE role_id=?', [replacement])).map(c => c.capability) : [];
    const oldCaps = (await tx.all('SELECT capability FROM role_capabilities WHERE role_id=?', [id])).map(c => c.capability);
    if (count) await tx.run(`UPDATE users SET role_id=?,updated_at=${db.now()} WHERE role_id=?`, [replacement, id]);
    await tx.run('DELETE FROM system_settings WHERE key=?', [`navigation_layout:${role.slug}`]);
    await tx.run('DELETE FROM roles WHERE id=?', [id]);
    return { role, replacement_id: replacement, reassigned_count: count, old_capabilities: oldCaps, new_capabilities: granted };
  });
}
module.exports = { create, update, remove, caps };
