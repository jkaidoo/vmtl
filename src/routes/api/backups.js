'use strict';
const db = require('../../db/runtime');
const backups = require('../../services/backups');
const audit = require('../../services/audit');
const microsoft365 = require('../../services/microsoft365');
const oneDrive = require('../../services/oneDriveBackups');
const requireBackupPage = require('../../services/ownerAccess').requirePage('backup-cleanup');
const { ApiError } = require('../../middleware/errorHandler');
const { verifyPassword } = require('../../util/password');
async function confirmOwner(req) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  if (!user?.active || !user.is_super_admin || !verifyPassword(req.body.password, user.password_hash)) throw new ApiError(403, 'Enter your current App Owner password.');
}
module.exports = router => {
  router.use('/admin/backups', requireBackupPage, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/admin/backups', async (req, res) => {
    // Opportunistic: viewing the page nudges any due timed/cloud backups along,
    // alongside the server-side interval. Fire-and-forget so the list loads fast.
    backups.runAutoIfDue().catch(() => {});
    oneDrive.run().catch(() => {});
    res.json({ data: { backups: await backups.list(), runtime: db.mode(), auto: await backups.autoConfig() } });
  });
  // Automatic (timed) local backups + retention count.
  router.patch('/admin/backups/automatic', async (req, res) => {
    const out = await backups.configureAuto(req.body || {});
    await audit.from(req, { action: 'BACKUP_AUTOMATION_UPDATED', description: `enabled=${out.config.enabled} interval=${out.config.interval_hours}h keep=${out.config.retention}` });
    res.json({ data: out.config });
  });
  // Microsoft 365 (Entra) app registration shared by OneDrive backups.
  router.get('/admin/backups/microsoft365', async (req, res) => res.json({ data: await microsoft365.adminView() }));
  router.patch('/admin/backups/microsoft365', async (req, res) => {
    const out = await microsoft365.saveConfig(req.body || {});
    await audit.from(req, { action: 'MICROSOFT365_CONFIGURED', description: 'Updated Microsoft 365 app registration for backups.' });
    res.json({ data: out });
  });
  // OneDrive backup destinations.
  router.get('/admin/backups/onedrive', async (req, res) => res.json({ data: await oneDrive.status() }));
  router.post('/admin/backups/onedrive/connect', async (req, res) => {
    res.json({ data: { url: await oneDrive.startConnect(req.session.user.id, req.body?.email) } });
  });
  router.patch('/admin/backups/onedrive', async (req, res) => {
    const out = await oneDrive.configure(req.body || {});
    await audit.from(req, { action: 'ONEDRIVE_BACKUP_CONFIGURED', description: 'Updated OneDrive backup schedule and retention.' });
    res.json({ data: out });
  });
  router.patch('/admin/backups/onedrive/:id', async (req, res) => {
    const out = await oneDrive.updateAccount(req.params.id, req.body || {});
    await audit.from(req, { action: 'ONEDRIVE_BACKUP_ACCOUNT_UPDATED', description: `Updated backup destination ${req.params.id}.` });
    res.json({ data: out });
  });
  router.post('/admin/backups/onedrive/:id/test', async (req, res) => {
    const state = await oneDrive.status();
    if (!state.accounts.some(a => a.id === req.params.id)) throw new ApiError(404, 'Backup account not found.');
    const out = await oneDrive.startUpload(req.params.id);
    await audit.from(req, { action: 'ONEDRIVE_BACKUP_TEST', description: `Requested backup upload for destination ${req.params.id}.` });
    res.status(202).json({ data: out });
  });
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

  // OAuth redirect target for OneDrive backup connection. Deliberately OUTSIDE the
  // owner-gated /admin/backups guard: the browser arrives here from Microsoft
  // without the strict-SameSite session cookie, so the signed state nonce (bound
  // to the App Owner's user id) authorises the connection, not the session.
  router.get('/microsoft/backup-callback', async (req, res) => {
    const page = (ok, message) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneDrive backup</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f8;color:#1f2733;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}.card{background:#fff;border:1px solid #e3e7ec;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:18px;margin:0 0 8px}p{color:#5a6472;font-size:14px;line-height:1.5;margin:0 0 16px}a{color:#0b63ce;text-decoration:none}</style></head><body><div class="card"><h1>${ok ? 'OneDrive connected' : 'Connection not completed'}</h1><p>${message}</p><p><a href="/backup-cleanup.html">Return to Backup &amp; cleanup</a></p><script>try{window.opener&&window.opener.postMessage({type:'onedrive-backup',ok:${ok ? 'true' : 'false'}},window.location.origin);setTimeout(function(){window.close();},1200);}catch(e){}</script></div></body></html>`;
    try {
      await oneDrive.finishConnect({ state: req.query.state, code: req.query.code, error: req.query.error });
      res.set('Content-Type', 'text/html; charset=utf-8').send(page(true, 'This OneDrive account is now a backup destination. You can close this window.'));
    } catch (err) {
      res.status(err.status && err.status < 500 ? err.status : 400).set('Content-Type', 'text/html; charset=utf-8').send(page(false, (err.message || 'Sign-in could not be completed.').replace(/[<>]/g, '')));
    }
  });
};
