'use strict';
const db = require('../../db/runtime');
const backups = require('../../services/backups');
const audit = require('../../services/audit');
const { requireSuper } = require('../../middleware/auth');
const { ApiError } = require('../../middleware/errorHandler');
const { verifyPassword } = require('../../util/password');
async function confirmOwner(req) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  if (!user?.active || !user.is_super_admin || !verifyPassword(req.body.password, user.password_hash)) throw new ApiError(403, 'Enter your current App Owner password.');
}
module.exports = router => {
  router.use('/admin/backups', requireSuper, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/admin/backups', async (req, res) => res.json({ data: { backups: await backups.list(), runtime: db.mode() } }));
  router.post('/admin/backups', async (req, res) => {
    const out = await backups.exclusive(() => backups.create(req.body.label));
    await audit.from(req, { action: 'BACKUP_CREATED', description: out.name });
    res.status(201).json({ data: out });
  });
  router.get('/admin/backups/:name/download', async (req, res) => { await backups.read(req.params.name); res.download(backups.file(req.params.name), req.params.name); });
  router.post('/admin/backups/:name/verify', async (req, res) => { await backups.read(req.params.name); res.json({ data: { ok: true } }); });
  router.delete('/admin/backups/:name', async (req, res) => {
    await backups.exclusive(() => backups.remove(req.params.name));
    await audit.from(req, { action: 'BACKUP_DELETED', description: req.params.name }); res.json({ data: { ok: true } });
  });
  router.post('/admin/backups/:name/restore', async (req, res) => {
    await confirmOwner(req);
    if (req.body.confirmation !== 'RESTORE') throw new ApiError(400, 'Type RESTORE to confirm.');
    await backups.exclusive(() => backups.restore(req.params.name));
    await audit.from(req, { action: 'BACKUP_RESTORED', description: req.params.name });
    if (db.isPostgres()) await db.run('DELETE FROM app_sessions');
    else if (db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()) db.raw.prepare('DELETE FROM sessions').run();
    if (req.session.destroy) await new Promise((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
    res.json({ data: { ok: true } });
  });
  router.get('/admin/backups/cleanup/entries', async (req, res) => {
    const q = String(req.query.q || '').slice(0, 200).toLowerCase();
    const entries = await db.all(`SELECT r.id, r.request_number, r.destination, r.purpose, r.status, r.created_at, u.name AS created_by FROM vehicle_requests r LEFT JOIN users u ON u.id=r.requester_id ORDER BY r.created_at DESC, r.id DESC`);
    res.json({ data: { entries: entries.filter(r => !q || Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))) } });
  });
  router.post('/admin/backups/cleanup/delete', async (req, res) => {
    await confirmOwner(req);
    const { entries, reason } = req.body;
    if (!Array.isArray(entries) || !entries.length || entries.length > 500 || entries.some(id => !Number.isSafeInteger(id) || id < 1)) throw new ApiError(400, 'Select between 1 and 500 valid requests.');
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 1000) throw new ApiError(400, 'Enter a deletion reason (5–1000 characters).');
    const ids = [...new Set(entries)];
    const out = await backups.exclusive(async () => {
      const backup = await backups.create('Before cleanup');
      const deleted = await db.transaction(async tx => {
        const marks=ids.map(()=>'?').join(',');
        const resources=await tx.all(`SELECT vehicle_id,driver_id FROM trips WHERE vehicle_request_id IN (${marks})`,ids);
        const schedules=`SELECT s.id FROM event_schedules s JOIN trips t ON t.id=s.trip_id WHERE t.vehicle_request_id IN (${marks})`;
        await tx.run(`DELETE FROM schedule_expenses WHERE schedule_id IN (${schedules})`,ids);
        await tx.run(`DELETE FROM event_schedules WHERE id IN (${schedules})`,ids);
        const count=(await tx.run(`DELETE FROM vehicle_requests WHERE id IN (${marks})`,ids)).changes;
        for(const vehicleId of new Set(resources.map(r=>r.vehicle_id))){
          if(!await tx.get("SELECT id FROM trips WHERE vehicle_id=? AND status IN ('scheduled','in_progress') LIMIT 1",[vehicleId])) await tx.run("UPDATE vehicles SET status='available' WHERE id=? AND status IN ('scheduled','on_trip')",[vehicleId]);
        }
        for(const driverId of new Set(resources.map(r=>r.driver_id))){
          if(!await tx.get("SELECT id FROM trips WHERE driver_id=? AND status='in_progress' LIMIT 1",[driverId])) await tx.run("UPDATE drivers SET status='available' WHERE id=? AND status='on_trip'",[driverId]);
        }
        return count;
      });
      return { deleted, backup: backup.name };
    });
    await audit.from(req, { action: 'CLEANUP_DELETED', description: reason.trim(), oldValues: { request_ids: ids }, newValues: out });
    res.json({ data: out });
  });
};
