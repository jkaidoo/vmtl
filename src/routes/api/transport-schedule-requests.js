'use strict';
// Transport Schedule — roster-change requests, driver leave, and CSV schedule
// import. Pairs with transport-schedule.js (which owns validation + checkpoints).
const db = require('../../db/runtime');
const { requireAuth } = require('../../middleware/auth');
const { has } = require('../../services/authz');
const { forbidden, notFound, badRequest, conflict } = require('../../middleware/errorHandler');
const audit = require('../../services/audit');
const sched = require('../../services/transportSchedule');
const { moduleEnabled } = require('../../services/systemControls');

module.exports = (router) => {
  const manage = async (req, res, next) => { if (!await moduleEnabled('transportSchedule')) throw forbidden('Transport Scheduling is turned off.'); if (!await has(req, 'schedule.manage')) throw forbidden(); next(); };
  const ok = (res, data) => res.json({ data });
  const getEvent = async (req, id) => { const e = await db.get('SELECT * FROM ts_events WHERE id=?', [id]); if (!e) throw notFound('Event not found.'); await sched.assertScope(req.session.user, e); return e; };

  // ---- Roster-change requests -------------------------------------------
  router.get('/ts/events/:id/roster-requests', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    ok(res, await db.all(`SELECT r.*, d.name AS driver_name, rp.name AS replacement_name
      FROM ts_roster_requests r JOIN drivers d ON d.id=r.driver_id LEFT JOIN drivers rp ON rp.id=r.replacement_id
      WHERE r.event_id=? ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id DESC`, [req.params.id]));
  });

  router.post('/ts/events/:id/roster-requests', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    const driverId = Number(req.body.driver_id);
    const kind = req.body.kind; // remove | swap | leave
    if (!['remove', 'swap', 'leave'].includes(kind)) throw badRequest('Choose a request type.');
    if (!String(req.body.reason || '').trim()) throw badRequest('A reason is required.', { reason: ['A reason is required.'] });
    if (kind === 'swap' && !req.body.replacement_id) throw badRequest('Choose a replacement driver.', { replacement_id: ['Choose a replacement driver.'] });
    if (!await db.get('SELECT 1 FROM ts_assignments WHERE event_id=? AND driver_id=?', [req.params.id, driverId])) throw conflict('That driver is not assigned on this event.');
    const r = await db.run('INSERT INTO ts_roster_requests(event_id,driver_id,replacement_id,kind,reason,requested_by) VALUES(?,?,?,?,?,?)',
      [req.params.id, driverId, req.body.replacement_id ? Number(req.body.replacement_id) : null, kind, String(req.body.reason).trim(), req.session.user.id]);
    ok(res, await db.get('SELECT * FROM ts_roster_requests WHERE id=?', [r.lastInsertRowid]));
  });

  router.post('/ts/roster-requests/:id/decision', requireAuth, manage, async (req, res) => {
    const reqRow = await db.get('SELECT * FROM ts_roster_requests WHERE id=?', [req.params.id]); if (!reqRow) throw notFound();
    await getEvent(req, reqRow.event_id);
    if (reqRow.status !== 'pending') throw conflict('This request is already decided.');
    const decision = req.body.decision; // approved | rejected
    if (!['approved', 'rejected'].includes(decision)) throw badRequest('Choose approve or reject.');
    if (decision === 'approved') {
      const a = await db.get('SELECT * FROM ts_assignments WHERE event_id=? AND driver_id=?', [reqRow.event_id, reqRow.driver_id]);
      if (a) {
        if (reqRow.kind === 'swap' && reqRow.replacement_id) {
          await sched.validate(reqRow.event_id, reqRow.replacement_id, { locationId: a.centre_id, role: a.role, requirePool: false });
          await db.run('INSERT INTO ts_event_pool(event_id,driver_id) VALUES(?,?) ON CONFLICT(event_id,driver_id) DO NOTHING', [reqRow.event_id, reqRow.replacement_id]);
          await db.run('DELETE FROM ts_assignments WHERE id=?', [a.id]);
          await db.run('INSERT INTO ts_assignments(event_id,centre_id,driver_id,role) VALUES(?,?,?,?)', [reqRow.event_id, a.centre_id, reqRow.replacement_id, a.role]);
        } else {
          // remove or leave → take them off the roster
          await db.run('DELETE FROM ts_assignments WHERE id=?', [a.id]);
        }
      }
      if (reqRow.kind === 'leave') {
        const e = await getEvent(req, reqRow.event_id);
        if (e.start_date) await db.run('INSERT INTO ts_driver_leave(driver_id,start_date,end_date,reason,status,requested_by,reviewed_by) VALUES(?,?,?,?,?,?,?)',
          [reqRow.driver_id, e.start_date, e.end_date || e.start_date, reqRow.reason, 'approved', reqRow.requested_by, req.session.user.id]);
      }
      await sched.checkpoint(reqRow.event_id, req.session.user.id, `Roster request ${reqRow.kind} approved`);
    }
    await db.run('UPDATE ts_roster_requests SET status=?, reviewed_by=?, decision_note=? WHERE id=?', [decision, req.session.user.id, req.body.note || null, reqRow.id]);
    await audit.from(req, { action: 'ts.roster_request.' + decision, entityType: 'ts_event', entityId: reqRow.event_id }).catch(() => {});
    ok(res, await db.get('SELECT * FROM ts_roster_requests WHERE id=?', [reqRow.id]));
  });

  // ---- Driver leave ------------------------------------------------------
  router.get('/ts/leave', requireAuth, manage, async (req, res) => {
    const where = req.query.status ? ' WHERE l.status=?' : '';
    ok(res, await db.all(`SELECT l.*, d.name AS driver_name FROM ts_driver_leave l JOIN drivers d ON d.id=l.driver_id${where} ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.start_date DESC`, req.query.status ? [req.query.status] : []));
  });
  router.post('/ts/leave', requireAuth, manage, async (req, res) => {
    const driverId = Number(req.body.driver_id);
    if (!await db.get('SELECT 1 FROM drivers WHERE id=?', [driverId])) throw badRequest('Choose a driver.', { driver_id: ['Choose a driver.'] });
    const start = req.body.start_date, end = req.body.end_date || req.body.start_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end))) throw badRequest('Enter valid dates.', { start_date: ['Enter valid dates.'] });
    if (end < start) throw badRequest('End date cannot be before the start.', { end_date: ['End date cannot be before the start.'] });
    const status = req.body.approve ? 'approved' : 'pending';
    const r = await db.run('INSERT INTO ts_driver_leave(driver_id,start_date,end_date,reason,status,requested_by,reviewed_by) VALUES(?,?,?,?,?,?,?)',
      [driverId, start, end, req.body.reason || null, status, req.session.user.id, status === 'approved' ? req.session.user.id : null]);
    ok(res, await db.get('SELECT * FROM ts_driver_leave WHERE id=?', [r.lastInsertRowid]));
  });
  router.post('/ts/leave/:id/decision', requireAuth, manage, async (req, res) => {
    const row = await db.get('SELECT * FROM ts_driver_leave WHERE id=?', [req.params.id]); if (!row) throw notFound();
    const decision = req.body.decision;
    if (!['approved', 'rejected'].includes(decision)) throw badRequest('Choose approve or reject.');
    await db.run('UPDATE ts_driver_leave SET status=?, reviewed_by=? WHERE id=?', [decision, req.session.user.id, row.id]);
    ok(res, await db.get('SELECT * FROM ts_driver_leave WHERE id=?', [row.id]));
  });
  router.delete('/ts/leave/:id', requireAuth, manage, async (req, res) => {
    await db.run('DELETE FROM ts_driver_leave WHERE id=?', [req.params.id]);
    res.json({ data: { deleted: true } });
  });

  // ---- CSV schedule import ----------------------------------------------
  // Rows need a Name and a Centre column; only drivers in the pool and centres
  // already configured on the event are assigned. Returns per-row outcomes.
  router.post('/ts/events/:id/import-schedule', requireAuth, manage, async (req, res) => {
    const event = await getEvent(req, req.params.id);
    const text = String(req.body.csv || '');
    if (!text.trim()) throw badRequest('Paste or upload CSV content.');
    const rows = parseCsv(text);
    if (!rows.length) throw badRequest('No rows found.');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const nameIdx = header.findIndex((h) => /name|driver/.test(h));
    const centreIdx = header.findIndex((h) => /centre|center|location/.test(h));
    if (nameIdx < 0 || centreIdx < 0) throw badRequest('CSV needs a Name column and a Centre column.');
    const centres = await db.all('SELECT ec.centre_id, c.name FROM ts_event_centres ec JOIN ts_centres c ON c.id=ec.centre_id WHERE ec.event_id=?', [event.id]);
    const centreByName = new Map(centres.map((c) => [c.name.trim().toLowerCase(), c.centre_id]));
    const pool = await db.all(`SELECT d.id, d.name FROM drivers d WHERE d.id IN (
      SELECT driver_id FROM ts_event_pool WHERE event_id=? UNION
      SELECT gm.driver_id FROM ts_event_driver_groups eg JOIN ts_driver_group_members gm ON gm.group_id=eg.group_id WHERE eg.event_id=?)`, [event.id, event.id]);
    const driverByName = new Map(pool.map((d) => [d.name.trim().toLowerCase(), d.id]));
    let imported = 0; const skipped = [];
    for (const row of rows.slice(1)) {
      const name = (row[nameIdx] || '').trim(); const centreName = (row[centreIdx] || '').trim();
      if (!name) continue;
      const driverId = driverByName.get(name.toLowerCase());
      const centreId = centreByName.get(centreName.toLowerCase());
      if (!driverId) { skipped.push({ name, reason: 'not in pool' }); continue; }
      if (!centreId) { skipped.push({ name, reason: `centre "${centreName}" not on event` }); continue; }
      if (await db.get('SELECT 1 FROM ts_assignments WHERE event_id=? AND driver_id=?', [event.id, driverId])) { skipped.push({ name, reason: 'already assigned' }); continue; }
      try { await sched.validate(event.id, driverId, { event, locationId: centreId, requirePool: true }); await db.run('INSERT INTO ts_assignments(event_id,centre_id,driver_id) VALUES(?,?,?)', [event.id, centreId, driverId]); imported += 1; }
      catch (err) { skipped.push({ name, reason: err.message }); }
    }
    if (imported) await sched.checkpoint(event.id, req.session.user.id, 'Imported schedule (' + imported + ')');
    await audit.from(req, { action: 'ts.import_schedule', description: `${imported} imported, ${skipped.length} skipped — ${event.title}`, entityType: 'ts_event', entityId: event.id }).catch(() => {});
    ok(res, { imported, skipped });
  });

  // Minimal CSV parser (quoted fields, commas, CRLF).
  function parseCsv(text) {
    const rows = []; let row = []; let field = ''; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) rows.push(row); }
    return rows;
  }
};
