'use strict';
// Analytics + reports (ports AnalyticsController + ReportController).
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const analytics = require('../../services/analytics');
const reports = require('../../services/reports');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { forbidden } = require('../../middleware/errorHandler');

const FILTER_KEYS = ['date_from', 'date_to', 'vehicle_id', 'driver_id', 'org_unit_id', 'requester_id', 'destination', 'status'];
async function filtersFor(req) {
  const f = {};
  for (const k of FILTER_KEYS) if (req.query[k] != null && req.query[k] !== '') f[k] = req.query[k];
  const scope = await orgScope.visibleOrgUnitIds(req.session.user);
  if (scope !== null) f.org_unit_ids = scope.length ? scope : [0];
  return f;
}

function writeCsv(res, headings, rows, filename) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [headings.map(esc).join(',')];
  for (const row of rows) lines.push(Object.values(row).map(esc).join(','));
  res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(lines.join('\r\n'));
}

async function writeXlsx(res, headings, rows, sheetName, filename) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headings); ws.getRow(1).font = { bold: true };
  for (const row of rows) ws.addRow(Object.values(row));
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}

function writePdf(res, title, headings, rows, totalsPairs, filename) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
  res.set('Content-Type', 'application/pdf'); res.set('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).text(`UITS VMTL — ${title}`, { align: 'left' });
  doc.moveDown(0.3).fontSize(8).fillColor('#555').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  doc.moveDown(0.2).fillColor('#000').fontSize(9).text(totalsPairs.map((p) => `${p.label}: ${p.value}`).join('    '));
  doc.moveDown(0.5);
  const pageWidth = doc.page.width - 56;
  const colW = pageWidth / headings.length;
  const drawRow = (cells, bold) => {
    const y = doc.y; doc.fontSize(7).font(bold ? 'Helvetica-Bold' : 'Helvetica');
    cells.forEach((c, i) => doc.text(String(c == null ? '' : c), 28 + i * colW, y, { width: colW - 4, ellipsis: true }));
    doc.moveDown(0.1); doc.moveTo(28, doc.y).lineTo(28 + pageWidth, doc.y).strokeColor('#eee').stroke();
  };
  drawRow(headings, true);
  for (const row of rows) { if (doc.y > doc.page.height - 40) doc.addPage(); drawRow(Object.values(row), false); }
  doc.end();
}

module.exports = function register(router) {
  router.get('/analytics', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.ANALYTICS_VIEW))) throw forbidden('You do not have access to analytics.');
    res.json({ data: await analytics.build(await filtersFor(req)) });
  });

  router.get('/reports', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.REPORTS_EXPORT))) throw forbidden('You do not have access to reports.');
    const filters = await filtersFor(req);
    if (String(req.query.type) === 'fuel') return res.json({ data: { type: 'fuel', rows: await reports.fuelRows(filters), totals: await reports.fuelTotals(filters), filters } });
    res.json({ data: { type: 'trips', rows: await reports.tripRows(filters), totals: await reports.tripTotals(filters), filters } });
  });

  router.get('/reports/export', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.REPORTS_EXPORT))) throw forbidden('You do not have access to reports.');
    const filters = await filtersFor(req);
    const format = String(req.query.format || 'csv');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '').slice(0, 15);
    const isFuel = String(req.query.type) === 'fuel';
    const rows = isFuel ? await reports.fuelRows(filters) : await reports.tripRows(filters);
    const headings = isFuel ? reports.FUEL_HEADINGS : reports.TRIP_HEADINGS;
    const filename = (isFuel ? 'fuel-report_' : 'vehicle-usage-report_') + stamp;
    const title = isFuel ? 'Fuel Report' : 'Vehicle Usage Report';
    const totals = isFuel ? await reports.fuelTotals(filters) : await reports.tripTotals(filters);
    const totalsPairs = isFuel
      ? [{ label: 'Fills', value: totals.fills }, { label: 'Litres', value: totals.litres }, { label: 'Cost', value: `GHS ${totals.cost}` }, { label: 'Distance', value: `${totals.distance} km` }, { label: 'Economy', value: totals.km_per_litre != null ? `${totals.km_per_litre} km/L` : '—' }]
      : [{ label: 'Total trips', value: totals.trips }, { label: 'Completed', value: totals.completed }, { label: 'Total distance', value: `${totals.distance} km` }];
    await audit.from(req, { action: 'report.exported', description: `${req.session.user.name} exported the ${title} (${format})` });
    if (format === 'xlsx' || format === 'excel') return writeXlsx(res, headings, rows, isFuel ? 'Fuel' : 'Vehicle Usage', filename);
    if (format === 'pdf') return writePdf(res, title, headings, rows, totalsPairs, filename);
    return writeCsv(res, headings, rows, filename);
  });
};
