'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../db/runtime');
const { ApiError } = require('../middleware/errorHandler');
const TABLES = [...require('./dbProfiles').TABLES, 'sync_ops', 'vehicle_positions'];
const directory = () => path.resolve(process.env.VMTL_BACKUP_DIR || path.join(__dirname, '../../data/backups'));
const fail = message => { throw new ApiError(400, message); };
function file(name) {
  if (!/^vmtl-[0-9a-f-]+\.json$/.test(name)) fail('Invalid backup name.');
  return path.join(directory(), name);
}
async function read(name) {
  let data;
  try { data = JSON.parse(await fs.readFile(file(name), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') throw new ApiError(404, 'Backup not found.'); throw err; }
  const digest = crypto.createHash('sha256').update(JSON.stringify(data.snapshot)).digest('hex');
  if (data.format !== 'vmtl-backup-1' || digest !== data.sha256 || !TABLES.every(t => Array.isArray(data.snapshot?.tables?.[t]))) fail('Backup verification failed.');
  return data;
}
async function list() {
  await fs.mkdir(directory(), { recursive: true });
  const rows = [];
  for (const name of await fs.readdir(directory())) {
    if (!/^vmtl-[0-9a-f-]+\.json$/.test(name)) continue;
    try { const data = await read(name); const stat = await fs.stat(file(name)); rows.push({ name, label: data.label, created_at: data.created_at, bytes: stat.size, runtime: data.runtime }); }
    catch (_) { rows.push({ name, label: 'Verification failed', invalid: true }); }
  }
  return rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
async function create(label = '') {
  if (typeof label !== 'string' || label.length > 120) fail('Use a label of at most 120 characters.');
  const tables = await db.transaction(async tx => {
    if (db.isPostgres()) await tx.run('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const out = {};
    for (const table of TABLES) out[table] = await tx.all(`SELECT * FROM ${table}`);
    return out;
  });
  const snapshot = { tables }; const name = `vmtl-${crypto.randomUUID()}.json`;
  const data = { format: 'vmtl-backup-1', runtime: db.mode(), created_at: new Date().toISOString(), label: label.trim(), snapshot,
    sha256: crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
  await fs.mkdir(directory(), { recursive: true });
  const temp = file(name) + '.tmp';
  await fs.writeFile(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
  await fs.rename(temp, file(name));
  return { name, created_at: data.created_at };
}
async function restore(name) {
  const data = await read(name);
  if (data.runtime !== db.mode()) fail('Restore requires the same database engine as the backup.');
  await create('Before restore');
  await db.transaction(async tx => {
    for (const table of [...TABLES].reverse()) await tx.run(`DELETE FROM ${table}`);
    for (const table of TABLES) {
      let rows = [...data.snapshot.tables[table]];
      // Organisation parents must exist before their children, regardless of ID order.
      if (table === 'org_units') {
        const ordered = []; const done = new Set();
        while (rows.length) {
          const ready = rows.filter(r => r.parent_id == null || done.has(r.parent_id));
          if (!ready.length) fail('Backup has an invalid organisation hierarchy.');
          for (const row of ready) { ordered.push(row); done.add(row.id); }
          rows = rows.filter(r => !done.has(r.id));
        }
        rows = ordered;
      }
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.every(c => /^[a-z_][a-z0-9_]*$/.test(c))) fail('Invalid backup columns.');
        await tx.run(`INSERT INTO ${table} (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})${table === 'sync_ops' ? ' RETURNING op_id' : ''}`, Object.values(row));
      }
      if (db.isPostgres()) {
        const seq = await tx.get(`SELECT pg_get_serial_sequence('${table}', 'id') AS name`);
        if (seq.name) await tx.get(`SELECT setval('${seq.name}', COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`);
      }
    }
  });
}
let busy = false;
async function exclusive(work) {
  if (busy) throw new ApiError(409, 'Another backup or cleanup operation is running.');
  busy = true; try { return await work(); } finally { busy = false; }
}
module.exports = { list, create, read, restore, file, exclusive, remove: name => fs.unlink(file(name)), TABLES };
