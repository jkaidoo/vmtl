'use strict';
// Transport Schedule — public published-schedule viewer (no auth, by token),
// roster report preview, and PDF / Excel exports. Pairs with transport-schedule.js.
const db = require('../../db/runtime');
const { requireAuth } = require('../../middleware/auth');
const { has } = require('../../services/authz');
const { forbidden, notFound } = require('../../middleware/errorHandler');
const audit = require('../../services/audit');
const { moduleEnabled } = require('../../services/systemControls');
const sched = require('../../services/transportSchedule');

const roleLabel = (e, a) => a.role_name || (a.role === 'team_lead' ? (e.lead_role_label || 'Team lead') : (e.driver_role_label || 'Driver'));
const dateRange = (e) => !e.start_date ? 'Undated' : (e.end_date && e.end_date !== e.start_date ? `${e.start_date} – ${e.end_date}` : e.start_date);

module.exports = (router) => {
  const view = async (req, res, next) => {
    if (!await moduleEnabled('transportSchedule')) throw forbidden('Transport Scheduling is turned off.');
    if (!await has(req, 'schedule.view') && !await has(req, 'schedule.manage')) throw forbidden();
    next();
  };

  // ---- Public published schedule (no auth) ------------------------------
  router.get('/ts/public/schedule/:token', async (req, res) => {
    if (!await moduleEnabled('transportSchedule')) throw notFound('This schedule is not available.');
    const e = await db.get('SELECT * FROM ts_events WHERE public_token=? AND published_snapshot IS NOT NULL', [req.params.token]);
    if (!e) throw notFound('This schedule is not available.');
    let snap; try { snap = JSON.parse(e.published_snapshot); } catch (_) { snap = { centres: [], assignments: [], supervisors: [] }; }
    let opts = {}; try { opts = JSON.parse(e.publish_options || '{}') || {}; } catch (_) { opts = {}; }
    const exclude = new Set((opts.exclude_centre_ids || []).map(Number));
    const includeSupervisors = opts.include_supervisors !== false;
    const type = await db.get('SELECT name FROM ts_event_types WHERE id=?', [e.event_type_id]);
    const centreMeta = new Map((await db.all('SELECT id,name,region FROM ts_centres')).map((c) => [c.id, c]));
    // Public schedule shows names and roles only — driver phone numbers are kept
    // to the authenticated roster and reports, not exposed on a shareable link.
    const driverMeta = new Map((await db.all('SELECT id,name FROM drivers')).map((d) => [d.id, d]));
    const centres = (snap.centres || []).filter((c) => !exclude.has(Number(c.centre_id))).map((c) => {
      const meta = centreMeta.get(c.centre_id) || {};
      const drivers = (snap.assignments || []).filter((a) => a.centre_id === c.centre_id)
        .map((a) => ({ name: (driverMeta.get(a.driver_id) || {}).name || 'Driver', role: roleLabel(e, a), lead: a.role === 'team_lead' }))
        .sort((x, y) => (y.lead - x.lead) || x.name.localeCompare(y.name));
      return { name: meta.name || 'Centre', region: meta.region || '', drivers };
    }).filter((c) => c.drivers.length).sort((a, b) => a.name.localeCompare(b.name));
    const supervisors = includeSupervisors ? (snap.supervisors || []).map((s) => ({ name: (driverMeta.get(s.driver_id) || {}).name || 'Driver' })) : [];
    res.json({ data: { event: { title: e.title, code: e.code, type_name: type?.name, date_range: dateRange(e), start_time: e.start_time, end_time: e.end_time }, centres, supervisors } });
  });

  // ---- Live roster report (preview) -------------------------------------
  async function rosterData(req, eventId) {
    const e = await db.get('SELECT * FROM ts_events WHERE id=?', [eventId]);
    if (!e) throw notFound('Event not found.');
    await sched.assertScope(req.session.user, e);
    e.type_name = (await db.get('SELECT name FROM ts_event_types WHERE id=?', [e.event_type_id]))?.name;
    const centres = await db.all('SELECT ec.centre_id, c.name AS centre_name, c.region, ec.drivers_needed FROM ts_event_centres ec JOIN ts_centres c ON c.id=ec.centre_id WHERE ec.event_id=? ORDER BY c.name', [eventId]);
    const assignments = await db.all(`SELECT a.*, d.name AS driver_name, d.phone, o.name AS org_unit_name, av.status AS availability_status
      FROM ts_assignments a JOIN drivers d ON d.id=a.driver_id LEFT JOIN org_units o ON o.id=d.org_unit_id
      LEFT JOIN ts_availability av ON av.event_id=a.event_id AND av.driver_id=a.driver_id WHERE a.event_id=? ORDER BY a.id`, [eventId]);
    const supervisors = await db.all('SELECT d.name AS driver_name, d.phone, o.name AS org_unit_name FROM ts_event_supervisors s JOIN drivers d ON d.id=s.driver_id LEFT JOIN org_units o ON o.id=d.org_unit_id WHERE s.event_id=? ORDER BY d.name', [eventId]);
    const byCentre = centres.map((c) => ({ ...c, drivers: assignments.filter((a) => a.centre_id === c.centre_id).map((a) => ({ ...a, role_label: roleLabel(e, a) })).sort((x, y) => ((y.role === 'team_lead') - (x.role === 'team_lead')) || x.driver_name.localeCompare(y.driver_name)) }));
    const summary = { centres: centres.length, needed: centres.reduce((n, c) => n + (c.drivers_needed || 0), 0), assigned: assignments.length,
      available: assignments.filter((a) => a.availability_status === 'available').length, unavailable: assignments.filter((a) => a.availability_status === 'unavailable').length,
      contacted: assignments.filter((a) => a.contacted).length, supervisors: supervisors.length };
    return { event: e, centres: byCentre, assignments, supervisors, summary };
  }

  router.get('/ts/events/:id/report', requireAuth, view, async (req, res) => res.json({ data: await rosterData(req, req.params.id) }));

  // Flat rows for export: one line per assigned driver.
  function flatRows(data) {
    const rows = [];
    for (const c of data.centres) for (const d of c.drivers) rows.push({
      Centre: c.centre_name, Region: c.region || '', Driver: d.driver_name, Phone: d.phone || '',
      'Org unit': d.org_unit_name || '', Role: d.role_label,
      Contacted: d.contacted ? 'Yes' : 'No', Availability: d.availability_status || 'unconfirmed', Travelled: d.traveled ? 'Yes' : 'No',
    });
    for (const s of data.supervisors) rows.push({ Centre: 'Supervisors', Region: '', Driver: s.driver_name, Phone: s.phone || '', 'Org unit': s.org_unit_name || '', Role: 'Supervisor', Contacted: '', Availability: '', Travelled: '' });
    return rows;
  }
  const HEADINGS = ['Centre', 'Region', 'Driver', 'Phone', 'Org unit', 'Role', 'Contacted', 'Availability', 'Travelled'];

  router.get('/ts/events/:id/report.xlsx', requireAuth, view, async (req, res) => {
    const data = await rosterData(req, req.params.id);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Roster');
    ws.addRow([`${data.event.title} — ${data.event.type_name || ''}`]); ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([dateRange(data.event)]); ws.addRow([]);
    ws.addRow(HEADINGS); ws.getRow(4).font = { bold: true };
    for (const row of flatRows(data)) ws.addRow(HEADINGS.map((h) => row[h]));
    ws.columns.forEach((c) => { c.width = 18; });
    await audit.from(req, { action: 'ts.report.export', description: `Roster export (xlsx) — ${data.event.title}`, entityType: 'ts_event', entityId: data.event.id });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="transport-roster_${req.params.id}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  });

  router.get('/ts/events/:id/report.pdf', requireAuth, view, async (req, res) => {
    const data = await rosterData(req, req.params.id);
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="transport-roster_${req.params.id}.pdf"`);
    doc.pipe(res);
    doc.fontSize(16).fillColor('#009540').text('UITS Transport Schedule', { continued: false });
    doc.fillColor('#000').fontSize(13).text(data.event.title);
    doc.fontSize(9).fillColor('#555').text([data.event.type_name, dateRange(data.event), data.event.code].filter(Boolean).join('  ·  '));
    doc.moveDown(0.3).fontSize(8).text(`Centres ${data.summary.centres} · Assigned ${data.summary.assigned}/${data.summary.needed || '—'} · Available ${data.summary.available} · Unavailable ${data.summary.unavailable} · Supervisors ${data.summary.supervisors}`);
    doc.fillColor('#000').moveDown(0.5);
    const line = () => { doc.moveTo(36, doc.y).lineTo(doc.page.width - 36, doc.y).strokeColor('#e5e5e5').stroke(); doc.moveDown(0.2); };
    for (const c of data.centres) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#009540').text(`${c.centre_name}${c.region ? ' — ' + c.region : ''}  (${c.drivers.length}/${c.drivers_needed || '—'})`);
      doc.fillColor('#000').font('Helvetica').fontSize(9);
      if (!c.drivers.length) doc.text('  No drivers assigned.');
      for (const d of c.drivers) { if (doc.y > doc.page.height - 50) doc.addPage(); doc.text(`  • ${d.driver_name}${d.phone ? '  ·  ' + d.phone : ''}  —  ${d.role_label}${d.availability_status === 'unavailable' ? '  (unavailable)' : ''}`); }
      doc.moveDown(0.3); line();
    }
    if (data.supervisors.length) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#009540').text('Event supervisors');
      doc.fillColor('#000').font('Helvetica').fontSize(9);
      for (const s of data.supervisors) doc.text(`  • ${s.driver_name}${s.phone ? '  ·  ' + s.phone : ''}`);
    }
    await audit.from(req, { action: 'ts.report.export', description: `Roster export (pdf) — ${data.event.title}`, entityType: 'ts_event', entityId: data.event.id });
    doc.end();
  });

  // ---- Driver event counts (fairness) -----------------------------------
  router.get('/ts/reports/driver-counts', requireAuth, view, async (req, res) => {
    const rows = await db.all(`SELECT d.id, d.name, d.phone, o.name AS org_unit_name,
      (SELECT COUNT(DISTINCT a.event_id) FROM ts_assignments a WHERE a.driver_id=d.id) AS total_events,
      (SELECT COUNT(*) FROM ts_assignments a WHERE a.driver_id=d.id AND a.traveled=1) AS travel_count,
      (SELECT COUNT(*) FROM ts_assignments a WHERE a.driver_id=d.id AND a.role='team_lead') AS lead_count
      FROM drivers d LEFT JOIN org_units o ON o.id=d.org_unit_id WHERE d.active=1 AND d.deleted_at IS NULL
      ORDER BY total_events DESC, d.name`);
    res.json({ data: rows });
  });
};
