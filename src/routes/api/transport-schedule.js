'use strict';
// Transport Schedule — a walkin-scheduler-style roster builder with drivers as
// the pool. Reference config (event types, centres, driver groups), events and
// centre requirements, the builder board (assign drivers to centres), driver
// availability, event supervisors, and the draft→review→publish workflow with
// revision history. Reports and notifications live in sibling route files.
const crypto = require('crypto');
const db = require('../../db/runtime');
const { requireAuth } = require('../../middleware/auth');
const { has } = require('../../services/authz');
const { forbidden, notFound, badRequest, conflict } = require('../../middleware/errorHandler');
const audit = require('../../services/audit');
const notifications = require('../../services/notifications');
const sched = require('../../services/transportSchedule');
const { moduleEnabled } = require('../../services/systemControls');

module.exports = (router) => {
  // Transport Scheduling is an optional module, off by default. Every route is
  // refused until an administrator turns it on in System controls → Feature flags.
  const cap = (name) => async (req, res, next) => {
    if (!await moduleEnabled('transportSchedule')) throw forbidden('Transport Scheduling is turned off.');
    if (!await has(req, name)) throw forbidden();
    next();
  };
  const view = cap('schedule.view');
  const manage = cap('schedule.manage');
  const config = cap('schedule.config');
  const publish = cap('schedule.publish');
  const ok = (res, data) => res.json({ data });
  const token = () => crypto.randomBytes(18).toString('base64url');
  const ar = (req, fields) => audit.from(req, fields).catch(() => {});
  const getEvent = async (req, id) => { const e = await db.get('SELECT * FROM ts_events WHERE id=?', [id]); if (!e) throw notFound('Event not found.'); await sched.assertScope(req.session.user, e); return e; };

  // ---- Reference: event types -------------------------------------------
  router.get('/ts/event-types', requireAuth, view, async (req, res) =>
    ok(res, await db.all('SELECT * FROM ts_event_types ORDER BY active DESC, name')));
  router.post('/ts/event-types', requireAuth, config, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw badRequest('A name is required.', { name: ['A name is required.'] });
    if (await db.get('SELECT 1 FROM ts_event_types WHERE lower(name)=lower(?)', [name])) throw conflict('An event type with that name already exists.');
    const r = await db.run('INSERT INTO ts_event_types(name,description) VALUES(?,?)', [name, req.body.description || null]);
    await ar(req, { action: 'ts.event_type.create', description: name, entityType: 'ts_event_type', entityId: r.lastInsertRowid });
    ok(res, await db.get('SELECT * FROM ts_event_types WHERE id=?', [r.lastInsertRowid]));
  });
  router.put('/ts/event-types/:id', requireAuth, config, async (req, res) => {
    const row = await db.get('SELECT * FROM ts_event_types WHERE id=?', [req.params.id]); if (!row) throw notFound();
    const name = req.body.name != null ? String(req.body.name).trim() : row.name;
    await db.run('UPDATE ts_event_types SET name=?, description=?, active=? WHERE id=?',
      [name, req.body.description ?? row.description, req.body.active != null ? (req.body.active ? 1 : 0) : row.active, row.id]);
    ok(res, await db.get('SELECT * FROM ts_event_types WHERE id=?', [row.id]));
  });
  router.delete('/ts/event-types/:id', requireAuth, config, async (req, res) => {
    if (await db.get('SELECT 1 FROM ts_events WHERE event_type_id=?', [req.params.id])) throw conflict('This event type is used by events; deactivate it instead.');
    await db.run('DELETE FROM ts_event_types WHERE id=?', [req.params.id]);
    res.json({ data: { deleted: true } });
  });

  // ---- Reference: centres -----------------------------------------------
  router.get('/ts/centres', requireAuth, view, async (req, res) =>
    ok(res, await db.all('SELECT * FROM ts_centres ORDER BY active DESC, name')));
  router.post('/ts/centres', requireAuth, config, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw badRequest('A name is required.', { name: ['A name is required.'] });
    if (await db.get('SELECT 1 FROM ts_centres WHERE lower(name)=lower(?)', [name])) throw conflict('A centre with that name already exists.');
    const r = await db.run('INSERT INTO ts_centres(name,region,is_kumasi,max_cap) VALUES(?,?,?,?)',
      [name, req.body.region || null, req.body.is_kumasi ? 1 : 0, Number(req.body.max_cap) || 0]);
    await ar(req, { action: 'ts.centre.create', description: name, entityType: 'ts_centre', entityId: r.lastInsertRowid });
    ok(res, await db.get('SELECT * FROM ts_centres WHERE id=?', [r.lastInsertRowid]));
  });
  router.put('/ts/centres/:id', requireAuth, config, async (req, res) => {
    const row = await db.get('SELECT * FROM ts_centres WHERE id=?', [req.params.id]); if (!row) throw notFound();
    await db.run('UPDATE ts_centres SET name=?, region=?, is_kumasi=?, max_cap=?, active=? WHERE id=?',
      [req.body.name != null ? String(req.body.name).trim() : row.name, req.body.region ?? row.region,
        req.body.is_kumasi != null ? (req.body.is_kumasi ? 1 : 0) : row.is_kumasi,
        req.body.max_cap != null ? Number(req.body.max_cap) : row.max_cap,
        req.body.active != null ? (req.body.active ? 1 : 0) : row.active, row.id]);
    ok(res, await db.get('SELECT * FROM ts_centres WHERE id=?', [row.id]));
  });
  router.delete('/ts/centres/:id', requireAuth, config, async (req, res) => {
    if (await db.get('SELECT 1 FROM ts_event_centres WHERE centre_id=?', [req.params.id])) throw conflict('This centre is used by events; deactivate it instead.');
    await db.run('DELETE FROM ts_centres WHERE id=?', [req.params.id]);
    res.json({ data: { deleted: true } });
  });

  // ---- Reference: driver groups -----------------------------------------
  router.get('/ts/driver-groups', requireAuth, view, async (req, res) => {
    const groups = await db.all('SELECT * FROM ts_driver_groups ORDER BY active DESC, name');
    for (const g of groups) g.member_count = (await db.get('SELECT COUNT(*) n FROM ts_driver_group_members WHERE group_id=?', [g.id])).n;
    ok(res, groups);
  });
  router.post('/ts/driver-groups', requireAuth, config, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw badRequest('A name is required.', { name: ['A name is required.'] });
    if (await db.get('SELECT 1 FROM ts_driver_groups WHERE lower(name)=lower(?)', [name])) throw conflict('A group with that name already exists.');
    const r = await db.run('INSERT INTO ts_driver_groups(name,description) VALUES(?,?)', [name, req.body.description || null]);
    ok(res, await db.get('SELECT * FROM ts_driver_groups WHERE id=?', [r.lastInsertRowid]));
  });
  router.put('/ts/driver-groups/:id', requireAuth, config, async (req, res) => {
    const row = await db.get('SELECT * FROM ts_driver_groups WHERE id=?', [req.params.id]); if (!row) throw notFound();
    await db.run('UPDATE ts_driver_groups SET name=?, description=?, active=? WHERE id=?',
      [req.body.name != null ? String(req.body.name).trim() : row.name, req.body.description ?? row.description,
        req.body.active != null ? (req.body.active ? 1 : 0) : row.active, row.id]);
    ok(res, await db.get('SELECT * FROM ts_driver_groups WHERE id=?', [row.id]));
  });
  router.delete('/ts/driver-groups/:id', requireAuth, config, async (req, res) => {
    await db.run('DELETE FROM ts_driver_groups WHERE id=?', [req.params.id]);
    res.json({ data: { deleted: true } });
  });
  router.get('/ts/driver-groups/:id/members', requireAuth, view, async (req, res) =>
    ok(res, await db.all('SELECT d.* FROM ts_driver_group_members m JOIN drivers d ON d.id=m.driver_id WHERE m.group_id=? ORDER BY d.name', [req.params.id])));
  router.post('/ts/driver-groups/:id/members', requireAuth, config, async (req, res) => {
    const ids = Array.isArray(req.body.driver_ids) ? req.body.driver_ids : [req.body.driver_id];
    for (const id of ids.filter(Boolean)) await db.run('INSERT INTO ts_driver_group_members(group_id,driver_id) VALUES(?,?) ON CONFLICT(group_id,driver_id) DO NOTHING', [req.params.id, Number(id)]);
    res.json({ data: { added: ids.length } });
  });
  router.delete('/ts/driver-groups/:id/members/:driverId', requireAuth, config, async (req, res) => {
    await db.run('DELETE FROM ts_driver_group_members WHERE group_id=? AND driver_id=?', [req.params.id, req.params.driverId]);
    res.json({ data: { deleted: true } });
  });

  // ---- Events -----------------------------------------------------------
  router.get('/ts/events', requireAuth, view, async (req, res) => {
    let rows = await db.all(`SELECT e.*, t.name AS type_name,
      (SELECT COUNT(*) FROM ts_event_centres c WHERE c.event_id=e.id) AS centre_count,
      (SELECT COALESCE(SUM(drivers_needed),0) FROM ts_event_centres c WHERE c.event_id=e.id) AS drivers_needed,
      (SELECT COUNT(*) FROM ts_assignments a WHERE a.event_id=e.id) AS drivers_assigned
      FROM ts_events e JOIN ts_event_types t ON t.id=e.event_type_id ORDER BY e.id DESC`);
    const scope = await sched.eventScope(req.session.user);
    if (!scope.all) rows = rows.filter((e) => e.org_unit_id != null && scope.ids.includes(e.org_unit_id));
    ok(res, rows);
  });
  router.get('/ts/events/:id', requireAuth, view, async (req, res) => {
    const e = await getEvent(req, req.params.id);
    e.type_name = (await db.get('SELECT name FROM ts_event_types WHERE id=?', [e.event_type_id]))?.name;
    ok(res, e);
  });
  router.post('/ts/events', requireAuth, manage, async (req, res) => {
    const title = String(req.body.title || '').trim();
    const typeId = Number(req.body.event_type_id);
    if (!title) throw badRequest('A title is required.', { title: ['A title is required.'] });
    if (!await db.get('SELECT 1 FROM ts_event_types WHERE id=?', [typeId])) throw badRequest('Choose an event type.', { event_type_id: ['Choose an event type.'] });
    const ev = { start_date: req.body.start_date || null, end_date: req.body.end_date || null, start_time: req.body.start_time || null, end_time: req.body.end_time || null };
    sched.dates(ev);
    const r = await db.run(`INSERT INTO ts_events(event_type_id,code,title,start_date,end_date,start_time,end_time,org_unit_id,created_by)
      VALUES(?,?,?,?,?,?,?,?,?)`, [typeId, req.body.code || null, title, ev.start_date, ev.end_date, ev.start_time, ev.end_time,
      req.session.user.org_unit_id || null, req.session.user.id]);
    // Seed centre requirements from the event type's defaults, if any.
    const defaults = await db.all('SELECT centre_id, default_drivers_needed FROM ts_event_type_centres WHERE event_type_id=?', [typeId]);
    for (const d of defaults) await db.run('INSERT INTO ts_event_centres(event_id,centre_id,drivers_needed) VALUES(?,?,?)', [r.lastInsertRowid, d.centre_id, d.default_drivers_needed]);
    await ar(req, { action: 'ts.event.create', description: title, entityType: 'ts_event', entityId: r.lastInsertRowid });
    // Prompt drivers, approvers and transport officers to confirm vehicle and
    // driver availability for the new event (best-effort; never blocks setup).
    await notifications.toRoles(['driver', 'approver', 'transport_admin', 'schedule_transport_officer', 'university_transport_officer'],
      'event_availability_check', { event_id: r.lastInsertRowid, event_name: title });
    ok(res, await db.get('SELECT * FROM ts_events WHERE id=?', [r.lastInsertRowid]));
  });
  router.put('/ts/events/:id', requireAuth, manage, async (req, res) => {
    const e = await getEvent(req, req.params.id);
    const next = {
      title: req.body.title != null ? String(req.body.title).trim() : e.title,
      code: req.body.code !== undefined ? (req.body.code || null) : e.code,
      start_date: req.body.start_date !== undefined ? (req.body.start_date || null) : e.start_date,
      end_date: req.body.end_date !== undefined ? (req.body.end_date || null) : e.end_date,
      start_time: req.body.start_time !== undefined ? (req.body.start_time || null) : e.start_time,
      end_time: req.body.end_time !== undefined ? (req.body.end_time || null) : e.end_time,
      status: req.body.status || e.status,
    };
    sched.dates(next);
    await db.run('UPDATE ts_events SET title=?, code=?, start_date=?, end_date=?, start_time=?, end_time=?, status=? WHERE id=?',
      [next.title, next.code, next.start_date, next.end_date, next.start_time, next.end_time, next.status, e.id]);
    ok(res, await db.get('SELECT * FROM ts_events WHERE id=?', [e.id]));
  });
  router.delete('/ts/events/:id', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    await db.run('DELETE FROM ts_events WHERE id=?', [req.params.id]);
    await ar(req, { action: 'ts.event.delete', entityType: 'ts_event', entityId: Number(req.params.id) });
    res.json({ data: { deleted: true } });
  });
  router.put('/ts/events/:id/role-labels', requireAuth, manage, async (req, res) => {
    const e = await getEvent(req, req.params.id);
    await db.run('UPDATE ts_events SET lead_role_label=?, driver_role_label=?, extra_role_labels=? WHERE id=?',
      [req.body.lead_role_label || null, req.body.driver_role_label || null,
        req.body.extra_role_labels ? JSON.stringify(req.body.extra_role_labels) : null, e.id]);
    ok(res, await db.get('SELECT * FROM ts_events WHERE id=?', [e.id]));
  });

  // ---- Event centres (requirements) -------------------------------------
  router.post('/ts/events/:id/centres', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    const centreId = Number(req.body.centre_id);
    if (!await db.get('SELECT 1 FROM ts_centres WHERE id=?', [centreId])) throw badRequest('Choose a centre.', { centre_id: ['Choose a centre.'] });
    const needed = Math.max(0, Number(req.body.drivers_needed) || 0);
    const existing = await db.get('SELECT id FROM ts_event_centres WHERE event_id=? AND centre_id=?', [req.params.id, centreId]);
    if (existing) await db.run('UPDATE ts_event_centres SET drivers_needed=?, notes=? WHERE id=?', [needed, req.body.notes || null, existing.id]);
    else await db.run('INSERT INTO ts_event_centres(event_id,centre_id,drivers_needed,notes) VALUES(?,?,?,?)', [req.params.id, centreId, needed, req.body.notes || null]);
    res.json({ data: { saved: true } });
  });
  router.put('/ts/event-centres/:id', requireAuth, manage, async (req, res) => {
    const row = await db.get('SELECT * FROM ts_event_centres WHERE id=?', [req.params.id]); if (!row) throw notFound();
    await db.run('UPDATE ts_event_centres SET drivers_needed=?, notes=? WHERE id=?',
      [req.body.drivers_needed != null ? Math.max(0, Number(req.body.drivers_needed)) : row.drivers_needed, req.body.notes ?? row.notes, row.id]);
    res.json({ data: { saved: true } });
  });
  router.delete('/ts/event-centres/:id', requireAuth, manage, async (req, res) => {
    const row = await db.get('SELECT * FROM ts_event_centres WHERE id=?', [req.params.id]); if (!row) throw notFound();
    if (await db.get('SELECT 1 FROM ts_assignments WHERE event_id=? AND centre_id=?', [row.event_id, row.centre_id])) throw conflict('Remove its driver assignments first.');
    await db.run('DELETE FROM ts_event_centres WHERE id=?', [row.id]);
    res.json({ data: { deleted: true } });
  });

  // ---- Driver pool ------------------------------------------------------
  // Import drivers into the event pool: by group, by org unit, or all active.
  router.post('/ts/events/:id/import-drivers', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    let drivers;
    if (req.body.group_id) drivers = await db.all('SELECT driver_id AS id FROM ts_driver_group_members WHERE group_id=?', [Number(req.body.group_id)]);
    else if (req.body.org_unit_id) drivers = await db.all('SELECT id FROM drivers WHERE active=1 AND deleted_at IS NULL AND org_unit_id=?', [Number(req.body.org_unit_id)]);
    else if (Array.isArray(req.body.driver_ids) && req.body.driver_ids.length) drivers = req.body.driver_ids.map((id) => ({ id: Number(id) }));
    else drivers = await db.all('SELECT id FROM drivers WHERE active=1 AND deleted_at IS NULL');
    let imported = 0;
    for (const d of drivers) { const r = await db.run('INSERT INTO ts_event_pool(event_id,driver_id) VALUES(?,?) ON CONFLICT(event_id,driver_id) DO NOTHING', [req.params.id, d.id]); if (r.changes) imported += 1; }
    if (req.body.group_id) await db.run('INSERT INTO ts_event_driver_groups(event_id,group_id) VALUES(?,?) ON CONFLICT(event_id,group_id) DO NOTHING', [req.params.id, Number(req.body.group_id)]);
    res.json({ data: { imported } });
  });
  router.delete('/ts/events/:id/pool/:driverId', requireAuth, manage, async (req, res) => {
    if (await db.get('SELECT 1 FROM ts_assignments WHERE event_id=? AND driver_id=?', [req.params.id, req.params.driverId])) throw conflict('Remove the driver from their centre first.');
    await db.run('DELETE FROM ts_event_pool WHERE event_id=? AND driver_id=?', [req.params.id, req.params.driverId]);
    res.json({ data: { deleted: true } });
  });

  // ---- Builder board ----------------------------------------------------
  router.get('/ts/events/:id/board', requireAuth, view, async (req, res) => {
    const e = await getEvent(req, req.params.id);
    e.type_name = (await db.get('SELECT name FROM ts_event_types WHERE id=?', [e.event_type_id]))?.name;
    const centres = await db.all(`SELECT ec.id AS event_centre_id, ec.centre_id, ec.drivers_needed, ec.notes,
      c.name AS centre_name, c.region, c.is_kumasi FROM ts_event_centres ec JOIN ts_centres c ON c.id=ec.centre_id
      WHERE ec.event_id=? ORDER BY c.name`, [req.params.id]);
    const assignments = await db.all(`SELECT a.*, d.name AS driver_name, d.phone, d.status AS driver_status,
      o.name AS org_unit_name, av.status AS availability_status, av.notes AS availability_notes
      FROM ts_assignments a JOIN drivers d ON d.id=a.driver_id
      LEFT JOIN org_units o ON o.id=d.org_unit_id
      LEFT JOIN ts_availability av ON av.event_id=a.event_id AND av.driver_id=a.driver_id
      WHERE a.event_id=? ORDER BY a.id`, [req.params.id]);
    const supervisors = await db.all(`SELECT s.driver_id, d.name AS driver_name, d.phone, o.name AS org_unit_name,
      av.status AS availability_status FROM ts_event_supervisors s JOIN drivers d ON d.id=s.driver_id
      LEFT JOIN org_units o ON o.id=d.org_unit_id
      LEFT JOIN ts_availability av ON av.event_id=s.event_id AND av.driver_id=s.driver_id
      WHERE s.event_id=? ORDER BY d.name`, [req.params.id]);
    // Pool = imported drivers ∪ linked group members, with lifetime counts.
    const pool = await db.all(`SELECT d.id, d.name, d.phone, d.status, d.active, d.org_unit_id, o.name AS org_unit_name,
      (SELECT COUNT(DISTINCT a2.event_id) FROM ts_assignments a2 WHERE a2.driver_id=d.id) AS total_events,
      (SELECT COUNT(*) FROM ts_assignments a3 WHERE a3.driver_id=d.id AND a3.traveled=1) AS travel_count,
      (SELECT COUNT(*) FROM ts_availability av2 WHERE av2.driver_id=d.id AND av2.event_id=? AND av2.status='unavailable') AS unavailable_here
      FROM drivers d LEFT JOIN org_units o ON o.id=d.org_unit_id
      WHERE d.id IN (
        SELECT driver_id FROM ts_event_pool WHERE event_id=?
        UNION SELECT gm.driver_id FROM ts_event_driver_groups eg JOIN ts_driver_group_members gm ON gm.group_id=eg.group_id WHERE eg.event_id=?
      ) ORDER BY d.name`, [req.params.id, req.params.id, req.params.id]);
    ok(res, { event: e, centres, assignments, supervisors, pool });
  });

  // ---- Assignments ------------------------------------------------------
  router.post('/ts/assignments', requireAuth, manage, async (req, res) => {
    const eventId = Number(req.body.event_id);
    const centreId = Number(req.body.centre_id);
    const driverId = Number(req.body.driver_id);
    const event = await getEvent(req, eventId);
    if (await db.get('SELECT 1 FROM ts_assignments WHERE event_id=? AND driver_id=?', [eventId, driverId])) throw conflict('Driver is already assigned on this event.');
    await sched.validate(eventId, driverId, { event, requirePool: true, locationId: centreId, role: req.body.role || null });
    const r = await db.run('INSERT INTO ts_assignments(event_id,centre_id,driver_id,role,traveled) VALUES(?,?,?,?,?)',
      [eventId, centreId, driverId, req.body.role || null, req.body.traveled ? 1 : 0]);
    await sched.checkpoint(eventId, req.session.user.id, 'Driver assigned');
    await ar(req, { action: 'ts.assignment.create', entityType: 'ts_event', entityId: eventId });
    ok(res, await db.get('SELECT * FROM ts_assignments WHERE id=?', [r.lastInsertRowid]));
  });
  router.put('/ts/assignments/:id', requireAuth, manage, async (req, res) => {
    const a = await db.get('SELECT * FROM ts_assignments WHERE id=?', [req.params.id]); if (!a) throw notFound();
    if (req.body.role !== undefined) {
      const role = req.body.role || null;
      if (role === 'team_lead') await sched.validate(a.event_id, a.driver_id, { locationId: a.centre_id, excludeId: a.id, role: 'team_lead' });
      await db.run('UPDATE ts_assignments SET role=? WHERE id=?', [role, a.id]);
    }
    if (req.body.role_name !== undefined) await db.run('UPDATE ts_assignments SET role_name=? WHERE id=?', [req.body.role_name || null, a.id]);
    if (req.body.contacted !== undefined) await db.run('UPDATE ts_assignments SET contacted=? WHERE id=?', [req.body.contacted ? 1 : 0, a.id]);
    if (req.body.traveled !== undefined) await db.run('UPDATE ts_assignments SET traveled=? WHERE id=?', [req.body.traveled ? 1 : 0, a.id]);
    if (req.body.centre_id !== undefined && Number(req.body.centre_id) !== a.centre_id) {
      await sched.validate(a.event_id, a.driver_id, { locationId: Number(req.body.centre_id), excludeId: a.id, role: a.role });
      await db.run('UPDATE ts_assignments SET centre_id=? WHERE id=?', [Number(req.body.centre_id), a.id]);
    }
    ok(res, await db.get('SELECT * FROM ts_assignments WHERE id=?', [a.id]));
  });
  router.delete('/ts/assignments/:id', requireAuth, manage, async (req, res) => {
    const a = await db.get('SELECT * FROM ts_assignments WHERE id=?', [req.params.id]); if (!a) throw notFound();
    await db.run('DELETE FROM ts_assignments WHERE id=?', [a.id]);
    await sched.checkpoint(a.event_id, req.session.user.id, req.body.deletion_reason || 'Driver removed');
    await ar(req, { action: 'ts.assignment.delete', entityType: 'ts_event', entityId: a.event_id, description: req.body.deletion_reason || null });
    res.json({ data: { deleted: true } });
  });
  router.delete('/ts/events/:id/roster', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    await db.run('DELETE FROM ts_assignments WHERE event_id=?', [req.params.id]);
    await db.run('DELETE FROM ts_event_supervisors WHERE event_id=?', [req.params.id]);
    await sched.checkpoint(req.params.id, req.session.user.id, 'Roster cleared');
    res.json({ data: { cleared: true } });
  });
  router.delete('/ts/events/:id/unavailable-assignments', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    const rows = await db.all("SELECT a.id FROM ts_assignments a JOIN ts_availability av ON av.event_id=a.event_id AND av.driver_id=a.driver_id WHERE a.event_id=? AND av.status='unavailable'", [req.params.id]);
    for (const r of rows) await db.run('DELETE FROM ts_assignments WHERE id=?', [r.id]);
    if (rows.length) await sched.checkpoint(req.params.id, req.session.user.id, 'Removed unavailable drivers');
    res.json({ data: { removed: rows.length } });
  });

  // ---- Supervisors ------------------------------------------------------
  router.get('/ts/events/:id/supervisors', requireAuth, view, async (req, res) =>
    ok(res, await db.all(`SELECT s.driver_id, d.name AS driver_name, d.phone, o.name AS org_unit_name,
      av.status AS availability_status FROM ts_event_supervisors s JOIN drivers d ON d.id=s.driver_id
      LEFT JOIN org_units o ON o.id=d.org_unit_id LEFT JOIN ts_availability av ON av.event_id=s.event_id AND av.driver_id=s.driver_id
      WHERE s.event_id=? ORDER BY d.name`, [req.params.id])));
  router.post('/ts/events/:id/supervisors', requireAuth, manage, async (req, res) => {
    const event = await getEvent(req, req.params.id);
    const driverId = Number(req.body.driver_id);
    if (await db.get('SELECT 1 FROM ts_assignments WHERE event_id=? AND driver_id=?', [req.params.id, driverId])) throw conflict('Driver is assigned to a centre; remove them first.');
    await sched.validate(req.params.id, driverId, { event });
    await db.run('INSERT INTO ts_event_supervisors(event_id,driver_id) VALUES(?,?) ON CONFLICT(event_id,driver_id) DO NOTHING', [req.params.id, driverId]);
    res.json({ data: { added: true } });
  });
  router.delete('/ts/events/:id/supervisors/:driverId', requireAuth, manage, async (req, res) => {
    await db.run('DELETE FROM ts_event_supervisors WHERE event_id=? AND driver_id=?', [req.params.id, req.params.driverId]);
    res.json({ data: { deleted: true } });
  });

  // ---- Availability -----------------------------------------------------
  router.get('/ts/events/:id/availability', requireAuth, view, async (req, res) =>
    ok(res, await db.all('SELECT * FROM ts_availability WHERE event_id=?', [req.params.id])));
  router.put('/ts/events/:id/availability/:driverId', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    const status = req.body.status;
    const driverId = Number(req.params.driverId);
    if (status === 'unconfirmed' || status == null) {
      await db.run('DELETE FROM ts_availability WHERE event_id=? AND driver_id=?', [req.params.id, driverId]);
    } else if (status === 'available' || status === 'unavailable') {
      const existing = await db.get('SELECT id FROM ts_availability WHERE event_id=? AND driver_id=?', [req.params.id, driverId]);
      if (existing) await db.run(`UPDATE ts_availability SET status=?, notes=?, contacted_by=?, contacted_at=${db.now()} WHERE id=?`, [status, req.body.notes || null, req.session.user.id, existing.id]);
      else await db.run('INSERT INTO ts_availability(event_id,driver_id,status,notes,contacted_by) VALUES(?,?,?,?,?)', [req.params.id, driverId, status, req.body.notes || null, req.session.user.id]);
    } else throw badRequest('Invalid status.');
    await db.run('INSERT INTO ts_availability_history(event_id,driver_id,status,changed_by,reason) VALUES(?,?,?,?,?)',
      [req.params.id, driverId, status || 'unconfirmed', req.session.user.id, req.body.notes || null]);
    res.json({ data: { status: status || 'unconfirmed' } });
  });
  router.post('/ts/events/:id/reset-availability', requireAuth, manage, async (req, res) => {
    await getEvent(req, req.params.id);
    const contacted = (await db.run('UPDATE ts_assignments SET contacted=0 WHERE event_id=? AND contacted=1', [req.params.id])).changes || 0;
    const confirmed = (await db.run("DELETE FROM ts_availability WHERE event_id=? AND status='available'", [req.params.id])).changes || 0;
    let unavailable = 0;
    if (req.body.include_unavailable) unavailable = (await db.run("DELETE FROM ts_availability WHERE event_id=? AND status='unavailable'", [req.params.id])).changes || 0;
    res.json({ data: { contacted, confirmed, unavailable } });
  });

  // ---- Workflow ---------------------------------------------------------
  router.post('/ts/events/:id/workflow', requireAuth, publish, async (req, res) => {
    const e = await getEvent(req, req.params.id);
    const action = req.body.action;
    if (action === 'review') {
      await db.run("UPDATE ts_events SET workflow='review', reviewed_revision=revision WHERE id=?", [e.id]);
    } else if (action === 'publish') {
      await sched.validateRoster(e.id, e);
      const snap = await sched.snapshot(e.id);
      const publishOptions = { exclude_centre_ids: (req.body.exclude_centre_ids || []).map(Number), include_supervisors: req.body.include_supervisors !== false };
      await db.run("UPDATE ts_events SET workflow='published', status='published', published_snapshot=?, publish_options=?, public_token=COALESCE(public_token,?) WHERE id=?",
        [JSON.stringify(snap), JSON.stringify(publishOptions), token(), e.id]);
      await ar(req, { action: 'ts.event.publish', entityType: 'ts_event', entityId: e.id });
    } else if (action === 'revoke') {
      await db.run("UPDATE ts_events SET workflow='draft', published_snapshot=NULL, public_token=NULL WHERE id=?", [e.id]);
    } else throw badRequest('Unknown workflow action.');
    ok(res, await db.get('SELECT * FROM ts_events WHERE id=?', [e.id]));
  });
  router.get('/ts/events/:id/versions', requireAuth, view, async (req, res) =>
    ok(res, await db.all('SELECT id, revision, reason, actor_id, created_at FROM ts_schedule_versions WHERE event_id=? ORDER BY id DESC', [req.params.id])));
  router.post('/ts/events/:id/restore', requireAuth, manage, async (req, res) => {
    const e = await getEvent(req, req.params.id);
    const version = await db.get('SELECT * FROM ts_schedule_versions WHERE id=? AND event_id=?', [Number(req.body.version_id), e.id]);
    if (!version) throw notFound('Revision not found.');
    const snap = JSON.parse(version.snapshot);
    await sched.checkpoint(e.id, req.session.user.id, 'Before restore to revision ' + version.revision);
    await db.run('DELETE FROM ts_assignments WHERE event_id=?', [e.id]);
    await db.run('DELETE FROM ts_event_supervisors WHERE event_id=?', [e.id]);
    await db.run('DELETE FROM ts_event_centres WHERE event_id=?', [e.id]);
    for (const c of snap.centres || []) await db.run('INSERT INTO ts_event_centres(event_id,centre_id,drivers_needed,notes) VALUES(?,?,?,?)', [e.id, c.centre_id, c.drivers_needed, c.notes || null]);
    for (const a of snap.assignments || []) { try { await sched.validate(e.id, a.driver_id, { locationId: a.centre_id, role: a.role }); await db.run('INSERT INTO ts_assignments(event_id,centre_id,driver_id,role,role_name,traveled) VALUES(?,?,?,?,?,?)', [e.id, a.centre_id, a.driver_id, a.role || null, a.role_name || null, a.traveled || 0]); } catch (_) { /* skip ineligible */ } }
    for (const s of snap.supervisors || []) { try { await db.run('INSERT INTO ts_event_supervisors(event_id,driver_id) VALUES(?,?) ON CONFLICT(event_id,driver_id) DO NOTHING', [e.id, s.driver_id]); } catch (_) { /* ignore */ } }
    res.json({ data: { restored: true } });
  });

  // ---- Copy a previous schedule ----------------------------------------
  router.post('/ts/events/:id/copy-schedule', requireAuth, manage, async (req, res) => {
    const target = await getEvent(req, req.params.id);
    const source = await getEvent(req, req.body.source_event_id);
    const skipped = [];
    let assignments = 0, supervisors = 0;
    for (const c of await db.all('SELECT * FROM ts_event_centres WHERE event_id=?', [source.id])) {
      await db.run('INSERT INTO ts_event_centres(event_id,centre_id,drivers_needed,notes) VALUES(?,?,?,?) ON CONFLICT(event_id,centre_id) DO NOTHING', [target.id, c.centre_id, c.drivers_needed, c.notes || null]);
    }
    for (const a of await db.all('SELECT * FROM ts_assignments WHERE event_id=? ORDER BY id', [source.id])) {
      await db.run('INSERT INTO ts_event_pool(event_id,driver_id) VALUES(?,?) ON CONFLICT(event_id,driver_id) DO NOTHING', [target.id, a.driver_id]);
      try { await sched.validate(target.id, a.driver_id, { event: target, locationId: a.centre_id, role: a.role }); await db.run('INSERT INTO ts_assignments(event_id,centre_id,driver_id,role) VALUES(?,?,?,?)', [target.id, a.centre_id, a.driver_id, a.role || null]); assignments += 1; }
      catch (err) { const d = await db.get('SELECT name FROM drivers WHERE id=?', [a.driver_id]); skipped.push({ name: d?.name || 'Driver', reason: err.message }); }
    }
    for (const s of await db.all('SELECT * FROM ts_event_supervisors WHERE event_id=?', [source.id])) {
      try { await db.run('INSERT INTO ts_event_supervisors(event_id,driver_id) VALUES(?,?) ON CONFLICT(event_id,driver_id) DO NOTHING', [target.id, s.driver_id]); supervisors += 1; } catch (_) { /* ignore */ }
    }
    await sched.checkpoint(target.id, req.session.user.id, 'Copied schedule from ' + source.title);
    ok(res, { assignments, supervisors, skipped });
  });

  // ---- Driver pool source (all active drivers, for pickers) -------------
  router.get('/ts/drivers', requireAuth, view, async (req, res) =>
    ok(res, await db.all(`SELECT d.id, d.name, d.phone, d.status, d.org_unit_id, o.name AS org_unit_name
      FROM drivers d LEFT JOIN org_units o ON o.id=d.org_unit_id WHERE d.active=1 AND d.deleted_at IS NULL ORDER BY d.name`)));
};
