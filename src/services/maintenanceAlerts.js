'use strict';
// Expiry / service-due alerts shown on the dashboard (ports MaintenanceAlertService).
const db = require('./db_ref');
const settings = require('./settings');

const daysLeft = (expiry) => Math.floor((Date.parse(`${String(expiry).slice(0, 10)}T00:00:00`) - new Date().setHours(0, 0, 0, 0)) / 86400000);
const todayPlus = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function all() {
  const insuranceDays = await settings.get('alert_insurance_days', Number(process.env.ALERT_INSURANCE_DAYS || 30));
  const roadworthyDays = await settings.get('alert_roadworthy_days', Number(process.env.ALERT_ROADWORTHY_DAYS || 30));
  const licenceDays = await settings.get('alert_licence_days', Number(process.env.ALERT_LICENCE_DAYS || 30));

  const insurance = (await db.all('SELECT id, vehicle_number, insurance_expiry FROM vehicles WHERE active = 1 AND insurance_expiry IS NOT NULL AND substr(insurance_expiry,1,10) <= substr(?,1,10) ORDER BY insurance_expiry', [todayPlus(insuranceDays)]))
    .map((v) => ({ vehicle_id: v.id, vehicle_number: v.vehicle_number, expiry: String(v.insurance_expiry).slice(0, 10), days_left: daysLeft(v.insurance_expiry) }));
  const roadworthy = (await db.all('SELECT id, vehicle_number, roadworthy_expiry FROM vehicles WHERE active = 1 AND roadworthy_expiry IS NOT NULL AND substr(roadworthy_expiry,1,10) <= substr(?,1,10) ORDER BY roadworthy_expiry', [todayPlus(roadworthyDays)]))
    .map((v) => ({ vehicle_id: v.id, vehicle_number: v.vehicle_number, expiry: String(v.roadworthy_expiry).slice(0, 10), days_left: daysLeft(v.roadworthy_expiry) }));
  const service = (await db.all('SELECT id, vehicle_number, current_odometer, last_service_odometer, service_interval_km FROM vehicles WHERE active = 1 AND service_interval_km IS NOT NULL AND last_service_odometer IS NOT NULL'))
    .filter((v) => (v.current_odometer - v.last_service_odometer) >= (v.service_interval_km - 500))
    .map((v) => ({ vehicle_id: v.id, vehicle_number: v.vehicle_number, km_since_service: v.current_odometer - v.last_service_odometer, interval: v.service_interval_km }));
  const licences = (await db.all('SELECT id, name, licence_expiry FROM drivers WHERE active = 1 AND licence_expiry IS NOT NULL AND substr(licence_expiry,1,10) <= substr(?,1,10) ORDER BY licence_expiry', [todayPlus(licenceDays)]))
    .map((d) => ({ driver_id: d.id, name: d.name, expiry: String(d.licence_expiry).slice(0, 10), days_left: daysLeft(d.licence_expiry) }));

  return {
    insurance_expiring: insurance, roadworthy_expiring: roadworthy, service_due: service, licence_expiring: licences,
    total: insurance.length + roadworthy.length + service.length + licences.length,
  };
}

module.exports = { all };
