'use strict';

// Daily fleet-compliance digest. Once a day, if any vehicle insurance / roadworthy
// certificate or driver licence is expiring within its alert window — or a service
// is due — push a reminder to the Transport Officers and administrators, in-app and
// by email, so documents are renewed before they lapse rather than only being shown
// on the dashboard. Deduped to one send per day via the last_compliance_digest setting.
const maintenanceAlerts = require('./maintenanceAlerts');
const notifications = require('./notifications');
const settings = require('./settings');
const email = require('./email');
const db = require('./db_ref');
const log = require('../util/log');

function summaryLine(a) {
  const parts = [];
  if (a.insurance_expiring.length) parts.push(`${a.insurance_expiring.length} insurance`);
  if (a.roadworthy_expiring.length) parts.push(`${a.roadworthy_expiring.length} roadworthy`);
  if (a.licence_expiring.length) parts.push(`${a.licence_expiring.length} licence`);
  if (a.service_due.length) parts.push(`${a.service_due.length} service due`);
  return parts.join(', ');
}

async function recipientEmails() {
  const rows = await db.all(`SELECT DISTINCT u.email FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.active = 1 AND u.deleted_at IS NULL AND u.email IS NOT NULL
      AND (u.is_super_admin = 1 OR r.slug IN ('transport_admin', 'administrator'))`);
  return rows.map((r) => r.email).filter(Boolean);
}

function emailBody(a) {
  const lines = [];
  const block = (title, items, render) => { if (items.length) { lines.push(`\n${title}:`); items.slice(0, 50).forEach((i) => lines.push(` - ${render(i)}`)); } };
  block('Vehicle insurance expiring', a.insurance_expiring, (i) => `${i.vehicle_number} — expires ${i.expiry} (${i.days_left} day(s))`);
  block('Roadworthy certificates expiring', a.roadworthy_expiring, (i) => `${i.vehicle_number} — expires ${i.expiry} (${i.days_left} day(s))`);
  block('Driver licences expiring', a.licence_expiring, (i) => `${i.name} — expires ${i.expiry} (${i.days_left} day(s))`);
  block('Service due', a.service_due, (i) => `${i.vehicle_number} — ${i.km_since_service} km since last service (interval ${i.interval} km)`);
  return `The following fleet documents and services need attention:\n${lines.join('\n')}\n\n— UITS Vehicle Management & Trip Logging`;
}

// Send today's digest (once). `force` ignores the once-a-day guard.
async function sendDigest({ force = false } = {}) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (!force && (await settings.get('last_compliance_digest', '')) === today) return { sent: false, reason: 'already_today' };
    const a = await maintenanceAlerts.all();
    await settings.set('last_compliance_digest', today);
    if (!a.total) return { sent: false, reason: 'nothing_due' };
    const data = { insurance: a.insurance_expiring.length, roadworthy: a.roadworthy_expiring.length, licence: a.licence_expiring.length, service: a.service_due.length, total: a.total, summary: summaryLine(a) };
    await notifications.toRoles(['transport_admin', 'administrator'], 'compliance_digest', data);
    try { const to = await recipientEmails(); if (to.length) await email.send(to.join(', '), `Fleet compliance: ${a.total} item(s) need attention`, emailBody(a)); } catch (_) { /* email optional */ }
    log.info('compliance_digest_sent', { total: a.total });
    return { sent: true, ...data };
  } catch (err) { log.warn('compliance_digest_error', { message: err.message }); return { sent: false, reason: err.message }; }
}

module.exports = { sendDigest, summaryLine };
