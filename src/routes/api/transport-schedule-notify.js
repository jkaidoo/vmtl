'use strict';
// Transport Schedule — driver availability confirmation links (public) and SMS /
// email roster notifications, reusing vmtl's sms/email services and ts_* tables.
const crypto = require('crypto');
const db = require('../../db/runtime');
const { requireAuth } = require('../../middleware/auth');
const { has } = require('../../services/authz');
const { forbidden, notFound, badRequest } = require('../../middleware/errorHandler');
const sms = require('../../services/sms');
const email = require('../../services/email');
const audit = require('../../services/audit');
const { moduleEnabled } = require('../../services/systemControls');
const sched = require('../../services/transportSchedule');
const log = require('../../util/log');

const baseUrl = (req) => String(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const token = () => crypto.randomBytes(18).toString('base64url');
const dateRange = (e) => !e.start_date ? 'Undated' : (e.end_date && e.end_date !== e.start_date ? `${e.start_date} – ${e.end_date}` : e.start_date);

module.exports = (router) => {
  const notify = async (req, res, next) => { if (!await moduleEnabled('transportSchedule')) throw forbidden('Transport Scheduling is turned off.'); if (!await has(req, 'schedule.notify')) throw forbidden(); next(); };
  const manage = async (req, res, next) => { if (!await moduleEnabled('transportSchedule')) throw forbidden('Transport Scheduling is turned off.'); if (!await has(req, 'schedule.manage') && !await has(req, 'schedule.notify')) throw forbidden(); next(); };
  const ok = (res, data) => res.json({ data });

  // Audience → assigned drivers (with centre/role), supervisors, or pool.
  async function recipients(eventId, audience) {
    const e = await db.get('SELECT * FROM ts_events WHERE id=?', [eventId]);
    if (!e) throw notFound('Event not found.');
    const label = (a) => a.role_name || (a.role === 'team_lead' ? (e.lead_role_label || 'Team lead') : (e.driver_role_label || 'Driver'));
    let rows;
    if (audience === 'supervisors') {
      rows = (await db.all(`SELECT s.driver_id, d.name, d.phone, u.email FROM ts_event_supervisors s JOIN drivers d ON d.id=s.driver_id LEFT JOIN users u ON u.id=d.user_id WHERE s.event_id=? ORDER BY d.name`, [eventId]))
        .map((r) => ({ ...r, centre_name: '', role_label: 'Supervisor' }));
    } else if (audience === 'pool') {
      rows = (await db.all(`SELECT d.id AS driver_id, d.name, d.phone, u.email FROM ts_event_pool p JOIN drivers d ON d.id=p.driver_id LEFT JOIN users u ON u.id=d.user_id WHERE p.event_id=? ORDER BY d.name`, [eventId]))
        .map((r) => ({ ...r, centre_name: '', role_label: '' }));
    } else {
      let q = `SELECT a.driver_id, a.role, a.role_name, d.name, d.phone, u.email, c.name AS centre_name, av.status AS availability
        FROM ts_assignments a JOIN drivers d ON d.id=a.driver_id LEFT JOIN users u ON u.id=d.user_id
        JOIN ts_centres c ON c.id=a.centre_id LEFT JOIN ts_availability av ON av.event_id=a.event_id AND av.driver_id=a.driver_id
        WHERE a.event_id=? ORDER BY c.name, d.name`;
      rows = (await db.all(q, [eventId])).map((r) => ({ ...r, role_label: label(r) }));
      if (audience === 'unconfirmed') rows = rows.filter((r) => r.availability !== 'available');
    }
    return { event: e, rows };
  }

  function fill(text, ctx) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? String(ctx[k]) : m));
  }
  // Reuse an unanswered link or mint a new one for this driver+event.
  async function ensureLink(eventId, driverId) {
    const existing = await db.get('SELECT token FROM ts_availability_links WHERE event_id=? AND driver_id=? AND responded_at IS NULL ORDER BY id DESC', [eventId, driverId]);
    if (existing) return existing.token;
    const t = token();
    await db.run('INSERT INTO ts_availability_links(token,event_id,driver_id) VALUES(?,?,?)', [t, eventId, driverId]);
    return t;
  }

  // ---- Message templates -------------------------------------------------
  router.get('/ts/message-templates', requireAuth, manage, async (req, res) => {
    const where = req.query.channel ? ' WHERE channel=?' : '';
    ok(res, await db.all('SELECT * FROM ts_message_templates' + where + ' ORDER BY name', req.query.channel ? [req.query.channel] : []));
  });
  router.post('/ts/message-templates', requireAuth, notify, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw badRequest('A name is required.', { name: ['A name is required.'] });
    if (!String(req.body.message || '').trim()) throw badRequest('A message is required.', { message: ['A message is required.'] });
    const r = await db.run('INSERT INTO ts_message_templates(name,channel,subject,message) VALUES(?,?,?,?)',
      [name, req.body.channel || 'sms', req.body.subject || null, req.body.message]);
    ok(res, await db.get('SELECT * FROM ts_message_templates WHERE id=?', [r.lastInsertRowid]));
  });
  router.put('/ts/message-templates/:id', requireAuth, notify, async (req, res) => {
    const t = await db.get('SELECT * FROM ts_message_templates WHERE id=?', [req.params.id]); if (!t) throw notFound();
    await db.run('UPDATE ts_message_templates SET name=?, channel=?, subject=?, message=? WHERE id=?',
      [req.body.name ?? t.name, req.body.channel ?? t.channel, req.body.subject ?? t.subject, req.body.message ?? t.message, t.id]);
    ok(res, await db.get('SELECT * FROM ts_message_templates WHERE id=?', [t.id]));
  });
  router.delete('/ts/message-templates/:id', requireAuth, notify, async (req, res) => {
    await db.run('DELETE FROM ts_message_templates WHERE id=?', [req.params.id]);
    res.json({ data: { deleted: true } });
  });

  // ---- Recipients preview ------------------------------------------------
  router.get('/ts/events/:id/recipients', requireAuth, manage, async (req, res) => {
    const { event, rows } = await recipients(req.params.id, req.query.audience || 'assigned');
    await sched.assertScope(req.session.user, event);
    ok(res, rows.map((r) => ({ driver_id: r.driver_id, name: r.name, phone: r.phone || null, email: r.email || null, centre_name: r.centre_name, role_label: r.role_label, availability: r.availability || null })));
  });

  // ---- Send roster messages ---------------------------------------------
  router.post('/ts/events/:id/notify', requireAuth, notify, async (req, res) => {
    const channel = req.body.channel || 'sms'; // sms | email | both
    const audience = req.body.audience || 'assigned';
    const message = String(req.body.message || '');
    const subject = String(req.body.subject || 'Transport schedule');
    if (!message.trim()) throw badRequest('A message is required.', { message: ['A message is required.'] });
    const includeLink = !!req.body.include_link || /\{link\}/.test(message);
    const { event, rows } = await recipients(req.params.id, audience);
    await sched.assertScope(req.session.user, event);
    if (!rows.length) throw badRequest('No recipients for this selection.');
    const base = baseUrl(req);
    const snapshot = JSON.stringify(rows.map((r) => ({ name: r.name, phone: r.phone, email: r.email })));
    // Record a job per channel up front, then deliver in the background so a large
    // roster does not block the request (each send is a slow external call).
    const jobs = {};
    for (const ch of ['sms', 'email']) {
      if (channel === ch || channel === 'both') {
        const r = await db.run('INSERT INTO ts_notifications(event_id,channel,recipient_count,status,message,detail,recipient_snapshot) VALUES(?,?,?,?,?,?,?)',
          [event.id, ch, rows.length, 'Sending…', message, audience, snapshot]);
        jobs[ch] = r.lastInsertRowid;
      }
    }
    await audit.from(req, { action: 'ts.notify', description: `Roster ${channel} to ${rows.length} (${audience}) — ${event.title}`, entityType: 'ts_event', entityId: event.id }).catch(() => {});
    ok(res, { recipients: rows.length, queued: true });
    // Fire-and-forget delivery; results land on the notification rows.
    (async () => {
      const result = { sms: { sent: 0, failed: 0 }, email: { sent: 0, failed: 0 } };
      for (const r of rows) {
        const link = includeLink ? `${base}/ts-availability-confirm.html?token=${await ensureLink(event.id, r.driver_id)}` : '';
        const ctx = { name: r.name, event: event.title, centre: r.centre_name || '', role: r.role_label || '', date: dateRange(event), link };
        const body = fill(message, ctx);
        if (jobs.sms) { if (!r.phone) result.sms.failed += 1; else { const out = await sms.send(r.phone, body); out.ok ? result.sms.sent += 1 : result.sms.failed += 1; } }
        if (jobs.email) { if (!r.email) result.email.failed += 1; else { const out = await email.send(r.email, fill(subject, ctx), body); out.ok ? result.email.sent += 1 : result.email.failed += 1; } }
      }
      if (jobs.sms) await db.run('UPDATE ts_notifications SET status=? WHERE id=?', [`${result.sms.sent} sent, ${result.sms.failed} failed`, jobs.sms]);
      if (jobs.email) await db.run('UPDATE ts_notifications SET status=? WHERE id=?', [`${result.email.sent} sent, ${result.email.failed} failed`, jobs.email]);
    })().catch((err) => log.warn('ts_notify_delivery_failed', { message: err.message }));
  });

  router.get('/ts/events/:id/notifications', requireAuth, manage, async (req, res) => {
    const e = await db.get('SELECT * FROM ts_events WHERE id=?', [req.params.id]); if (!e) throw notFound('Event not found.');
    await sched.assertScope(req.session.user, e);
    ok(res, await db.all('SELECT id, channel, recipient_count, status, detail, sent_at FROM ts_notifications WHERE event_id=? ORDER BY id DESC', [req.params.id]));
  });

  // ---- Create availability links (bulk) ---------------------------------
  router.post('/ts/events/:id/availability-links', requireAuth, manage, async (req, res) => {
    const { event, rows } = await recipients(req.params.id, req.body.audience || 'assigned');
    await sched.assertScope(req.session.user, event);
    const base = baseUrl(req);
    const links = [];
    for (const r of rows) links.push({ driver_id: r.driver_id, name: r.name, url: `${base}/ts-availability-confirm.html?token=${await ensureLink(event.id, r.driver_id)}` });
    ok(res, links);
  });

  // A confirmation link lapses a week after its event ends, and 90 days after it
  // was created at the latest, so a shared link does not live forever.
  const DAY = 86400000;
  function expired(link) {
    const now = Date.now();
    const eventEnd = link.end_date || link.start_date;
    if (eventEnd && /^\d{4}-\d{2}-\d{2}$/.test(eventEnd) && now > Date.parse(eventEnd + 'T23:59:59') + 7 * DAY) return true;
    const created = Date.parse(String(link.created_at || '').replace(' ', 'T'));
    return !Number.isNaN(created) && now > created + 90 * DAY;
  }

  // ---- Public availability confirmation (no auth) -----------------------
  router.get('/ts/a/:token', async (req, res) => {
    if (!await moduleEnabled('transportSchedule')) throw notFound('This link is not valid.');
    const link = await db.get(`SELECT l.*, e.title, e.start_date, e.end_date, e.start_time, e.end_time, d.name AS driver_name
      FROM ts_availability_links l JOIN ts_events e ON e.id=l.event_id JOIN drivers d ON d.id=l.driver_id WHERE l.token=?`, [req.params.token]);
    if (!link) throw notFound('This link is not valid.');
    if (expired(link)) throw notFound('This confirmation link has expired.');
    const type = await db.get('SELECT name FROM ts_event_types WHERE id=(SELECT event_type_id FROM ts_events WHERE id=?)', [link.event_id]);
    ok(res, { event_title: link.title, type_name: type?.name, date_range: dateRange(link), start_time: link.start_time, end_time: link.end_time, driver_name: link.driver_name, response: link.response });
  });
  router.post('/ts/a/:token', async (req, res) => {
    if (!await moduleEnabled('transportSchedule')) throw notFound('This link is not valid.');
    const link = await db.get(`SELECT l.*, e.start_date, e.end_date FROM ts_availability_links l JOIN ts_events e ON e.id=l.event_id WHERE l.token=?`, [req.params.token]);
    if (!link) throw notFound('This link is not valid.');
    if (expired(link)) throw notFound('This confirmation link has expired.');
    const response = req.body.response;
    if (!['available', 'unavailable'].includes(response)) throw badRequest('Choose available or unavailable.');
    const notes = req.body.notes ? String(req.body.notes).slice(0, 500) : null;
    const existing = await db.get('SELECT id FROM ts_availability WHERE event_id=? AND driver_id=?', [link.event_id, link.driver_id]);
    if (existing) await db.run(`UPDATE ts_availability SET status=?, notes=?, contacted_at=${db.now()} WHERE id=?`, [response, notes, existing.id]);
    else await db.run('INSERT INTO ts_availability(event_id,driver_id,status,notes) VALUES(?,?,?,?)', [link.event_id, link.driver_id, response, notes]);
    await db.run('INSERT INTO ts_availability_history(event_id,driver_id,status,reason) VALUES(?,?,?,?)', [link.event_id, link.driver_id, response, notes || 'Driver self-response']);
    await db.run(`UPDATE ts_availability_links SET response=?, responded_at=${db.now()} WHERE id=?`, [response, link.id]);
    ok(res, { response });
  });
};
