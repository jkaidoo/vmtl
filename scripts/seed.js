'use strict';
/* Idempotent database seeder. Ported from backend/database/seeders/*.
 * Run: node scripts/seed.js   (honours DB_RUNTIME; defaults to sqlite dev file)
 *
 * Seeds roles + capabilities, departments, the KNUST org-unit tree (with
 * materialised paths), the demo sign-in accounts, the fleet + drivers, system
 * settings, and a few months of demo trips so analytics/reports have data.
 * Password for every seeded account: "password".
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db/runtime');
const capabilities = require('../src/services/capabilities');
const { hashPassword } = require('../src/util/password');

// ISO text matching the datetime('now') storage format ("YYYY-MM-DD HH:MM:SS").
const fmt = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const addMinutes = (d, n) => new Date(new Date(d).getTime() + n * 60000);
const dateStr = (d) => new Date(d).toISOString().slice(0, 10);
const rint = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = (arr, i) => arr[i % arr.length];

async function upsert(table, uniqueCol, uniqueVal, fields) {
  const existing = await db.get(`SELECT id FROM ${table} WHERE ${uniqueCol} = ?`, [uniqueVal]);
  const now = fmt(new Date());
  if (existing) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
    await db.run(`UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`, [...Object.values(fields), now, existing.id]);
    return existing.id;
  }
  const cols = [uniqueCol, ...Object.keys(fields), 'created_at', 'updated_at'];
  const vals = [uniqueVal, ...Object.values(fields), now, now];
  const res = await db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  return res.lastInsertRowid;
}

async function seedRoles() {
  const roles = {
    it_admin: ['IT Admin', 'Administers only the assigned OU and its descendants.'],
    staff: ['Staff', 'Can create and track their own vehicle requests.'],
    approver: ['Approver', 'Reviews and approves or rejects vehicle requests.'],
    transport_admin: ['Transport / Admin Officer', 'Assigns vehicles and drivers, runs trips.'],
    supervisor: ['Supervisor', 'Manages users and operations within their organisational unit and its sub-units.'],
    administrator: ['System Administrator', 'Full system access.'],
    driver: ['Driver', 'Views and operates their own assigned trips.'],
  };
  const ids = {};
  for (const [slug, [name, description]] of Object.entries(roles)) {
    ids[slug] = await upsert('roles', 'slug', slug, { name, description });
  }
  return ids;
}

// Reset each role to its canonical capability set so the spec'd role hierarchy
// is authoritative (re-running the seed re-applies it exactly).
async function seedCapabilities(roleIds) {
  for (const [slug, caps] of Object.entries(capabilities.defaultsByRole())) {
    const roleId = roleIds[slug];
    if (!roleId) continue;
    await db.run('DELETE FROM role_capabilities WHERE role_id = ?', [roleId]);
    for (const cap of caps) {
      await db.run(`INSERT INTO role_capabilities (role_id, capability, created_at, updated_at) VALUES (?, ?, ${db.now()}, ${db.now()})`, [roleId, cap]);
    }
  }
}

async function seedDepartments() {
  const depts = [
    ['UITS Support Centre', 'UITS-SC'], ['Network Operations', 'UITS-NET'],
    ['Systems & Infrastructure', 'UITS-INF'], ['Administration', 'UITS-ADM'],
  ];
  const ids = {};
  for (const [name, code] of depts) ids[code] = await upsert('departments', 'code', code, { name, active: 1 });
  return ids;
}

// Create one org node, materialising its path from the parent. Idempotent by (name,parent).
async function orgNode(name, code, type, parentId) {
  // Null-safe parent match that works on both SQLite and PostgreSQL.
  const existing = parentId == null
    ? await db.get('SELECT id FROM org_units WHERE name = ? AND parent_id IS NULL', [name])
    : await db.get('SELECT id FROM org_units WHERE name = ? AND parent_id = ?', [name, parentId]);
  const now = fmt(new Date());
  let id;
  if (existing) { id = existing.id; await db.run('UPDATE org_units SET code = ?, type = ?, updated_at = ? WHERE id = ?', [code, type, now, id]); }
  else { const res = await db.run('INSERT INTO org_units (name, code, type, parent_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [name, code, type, parentId ?? null, now, now]); id = res.lastInsertRowid; }
  const parent = parentId ? await db.get('SELECT path FROM org_units WHERE id = ?', [parentId]) : null;
  const path = `${parent && parent.path ? parent.path : '/'}${id}/`;
  await db.run('UPDATE org_units SET path = ? WHERE id = ?', [path, id]);
  return id;
}

async function seedOrgTree(deptIds) {
  const knust = await orgNode('KNUST', 'KNUST', 'institution', null);
  const uits = await orgNode('University Information Technology Services', 'UITS', 'directorate', knust);
  const deptNodes = {};
  for (const [code, name] of [['UITS-SC', 'UITS Support Centre'], ['UITS-NET', 'Network Operations'], ['UITS-INF', 'Systems & Infrastructure'], ['UITS-ADM', 'Administration']]) {
    deptNodes[code] = await orgNode(name, code, 'unit', uits);
  }
  const cos = await orgNode('College of Science', 'COS', 'college', knust);
  const fpcs = await orgNode('Faculty of Physical & Computational Sciences', 'FPCS', 'faculty', cos);
  const cs = await orgNode('Department of Computer Science', 'CS', 'department', fpcs);
  return { knust, uits, deptNodes, cos, fpcs, cs };
}

async function seedUsers(roleIds, org) {
  const pw = hashPassword('password');
  // [name, email, roleSlug, orgUnitId, isSuper, deptCode-for-node]
  const users = [
    ['System Administrator', 'admin@uits.test', 'administrator', org.knust, 1],
    ['Approving Officer', 'approver@uits.test', 'approver', org.uits, 0],
    ['Transport Officer', 'transport@uits.test', 'transport_admin', org.uits, 0],
    ['Supervisor (College of Science)', 'supervisor@uits.test', 'supervisor', org.cos, 0],
    ['Staff Member', 'staff@uits.test', 'staff', org.deptNodes['UITS-SC'], 0],
    ['Ama Mensah', 'ama@uits.test', 'staff', org.deptNodes['UITS-SC'], 0],
    ['Kofi Boateng', 'kofi@uits.test', 'staff', org.deptNodes['UITS-SC'], 0],
    ['Gated Staff (no dept)', 'gatedstaff@uits.test', 'staff', null, 0],
  ];
  const ids = {};
  for (const [name, email, slug, orgUnitId, isSuper] of users) {
    ids[email] = await upsert('users', 'email', email, {
      name, password_hash: pw, role_id: roleIds[slug], org_unit_id: orgUnitId,
      active: 1, is_super_admin: isSuper,
    });
  }
  return ids;
}

async function seedVehicles(org) {
  const base = [
    { vehicle_number: 'UITS-01', registration_number: 'GR-1234-24', make: 'Toyota', model: 'Hilux', year: 2022, vehicle_type: 'pickup', colour: 'White', capacity: 5, current_odometer: 42310, org_unit_id: org.uits, insurance_expiry: dateStr(addDays(today(), 45)), roadworthy_expiry: dateStr(addDays(today(), 20)), service_interval_km: 10000, last_service_date: dateStr(addMonths(today(), -2)), last_service_odometer: 38000 },
    { vehicle_number: 'UITS-02', registration_number: 'GR-5678-24', make: 'Nissan', model: 'Navara', year: 2021, vehicle_type: 'pickup', colour: 'Silver', capacity: 5, current_odometer: 61540, org_unit_id: org.uits, insurance_expiry: dateStr(addMonths(today(), 6)), roadworthy_expiry: dateStr(addMonths(today(), 4)), service_interval_km: 10000, last_service_date: dateStr(addMonths(today(), -1)), last_service_odometer: 60000 },
    // Cross-branch demo vans under Computer Science.
    { vehicle_number: 'CS-VAN-1', registration_number: 'GR-9001-24', make: 'Toyota', model: 'Hiace', year: 2020, vehicle_type: 'bus_hiace', colour: 'White', capacity: 15, current_odometer: 88000, org_unit_id: org.cs, insurance_expiry: dateStr(addMonths(today(), 3)), roadworthy_expiry: dateStr(addMonths(today(), 2)), service_interval_km: 15000 },
    { vehicle_number: 'CS-VAN-2', registration_number: 'GR-9002-24', make: 'Mercedes', model: 'Sprinter', year: 2019, vehicle_type: 'van', colour: 'Blue', capacity: 18, current_odometer: 120500, org_unit_id: org.cs, insurance_expiry: dateStr(addMonths(today(), 5)), roadworthy_expiry: dateStr(addMonths(today(), 1)), service_interval_km: 15000 },
  ];
  const ids = [];
  for (const v of base) {
    const { vehicle_number, ...rest } = v;
    ids.push(await upsert('vehicles', 'vehicle_number', vehicle_number, { ...rest, status: 'available', active: 1 }));
  }
  return ids;
}

async function seedDrivers(roleIds, userIds, org) {
  const pw = hashPassword('password');
  const drivers = [
    { name: 'Driver A — Yaw Owusu', employee_id: 'DRV-001', phone: '0240000001', licence_number: 'GHA-DL-11111', licence_expiry: dateStr(addMonths(today(), 8)), email: 'driver1@uits.test' },
    { name: 'Driver B — Kwabena Asare', employee_id: 'DRV-002', phone: '0240000002', licence_number: 'GHA-DL-22222', licence_expiry: dateStr(addDays(today(), 25)), email: 'driver2@uits.test' },
  ];
  const ids = [];
  for (const d of drivers) {
    const userId = await upsert('users', 'email', d.email, { name: d.name, password_hash: pw, role_id: roleIds.driver, phone: d.phone, org_unit_id: org.uits, active: 1, is_super_admin: 0 });
    const { email, employee_id, ...rest } = d;
    ids.push(await upsert('drivers', 'employee_id', employee_id, { ...rest, status: 'available', org_unit_id: org.uits, active: 1, user_id: userId }));
  }
  return ids;
}

async function seedSettings() {
  const settings = [
    ['alert_insurance_days', '30', 'integer', 'alerts', 'Insurance expiry warning (days)'],
    ['alert_roadworthy_days', '30', 'integer', 'alerts', 'Roadworthy expiry warning (days)'],
    ['alert_licence_days', '30', 'integer', 'alerts', 'Licence expiry warning (days)'],
    ['alert_service_days', '30', 'integer', 'alerts', 'Service due warning (days)'],
    ['organisation_name', 'University Information Technology Services', 'string', 'general', 'Organisation name'],
    ['feature_email_notifications', '1', 'boolean', 'features', 'Email notifications'],
    ['feature_push_notifications', '1', 'boolean', 'features', 'Push notifications'],
    ['feature_sms_notifications', '0', 'boolean', 'features', 'SMS notifications'],
    ['notif_email_subject_prefix', '[UITS VMTL] ', 'string', 'notifications', 'Email subject prefix'],
    ['notif_sms_sender_prefix', 'UITS', 'string', 'notifications', 'SMS sender prefix'],
    ['notif_allow_email', '1', 'boolean', 'notifications', 'Allow email'],
    ['notif_allow_sms', '0', 'boolean', 'notifications', 'Allow SMS'],
    ['retain_audit_days', '0', 'integer', 'retention', 'Audit log retention (days)'],
    ['retain_notification_days', '90', 'integer', 'retention', 'Notification retention (days)'],
    ['maintenance_mode', '0', 'boolean', 'maintenance', 'Maintenance mode'],
    ['maintenance_message', 'The system is undergoing scheduled maintenance.', 'string', 'maintenance', 'Maintenance announcement'],
  ];
  for (const [key, value, type, group, label] of settings) {
    await upsert('system_settings', 'key', key, { value, type, '"group"': group, label });
  }
}

async function seedDemoTrips(userIds, vehicleIds, driverIds) {
  const existing = await db.get('SELECT COUNT(*) AS n FROM trips');
  if (existing && existing.n > 0) return; // only when empty

  const staff = [userIds['staff@uits.test'], userIds['ama@uits.test'], userIds['kofi@uits.test']];
  const approver = userIds['approver@uits.test'];
  const transport = userIds['transport@uits.test'];
  const destinations = ['KNUST Hospital', 'Kumasi City Centre', 'Airport Roundabout', 'Tech Junction', 'Ejisu District Office', 'Ashanti Regional Office', 'Data Centre - Campus', 'Central Library'];
  const purposes = ['Equipment delivery', 'Staff transport for official duty', 'Network site inspection', 'Document delivery', 'Vendor meeting', 'Campus support visit'];

  let reqSeq = 0; let tripSeq = 0;
  const reqNo = () => `REQ-${String(++reqSeq).padStart(5, '0')}`;
  const tripNo = () => `TRIP-${String(++tripSeq).padStart(5, '0')}`;
  const odo = {}; for (const vid of vehicleIds) { const v = await db.get('SELECT current_odometer FROM vehicles WHERE id = ?', [vid]); odo[vid] = Math.max(0, (v.current_odometer || 4000) - 4000); }

  async function makeRequest(requesterId, start, end, destination, purpose, status) {
    const u = await db.get('SELECT department_id, org_unit_id FROM users WHERE id = ?', [requesterId]);
    const res = await db.run(
      `INSERT INTO vehicle_requests (request_number, requester_id, department_id, org_unit_id, travel_date, requested_start_time, expected_end_time, destination, purpose, passenger_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reqNo(), requesterId, u?.department_id || null, u?.org_unit_id || null, dateStr(start), fmt(start), fmt(end), destination, purpose, rint(1, 4), status, fmt(addDays(start, -rint(1, 3))), fmt(start)]
    );
    return res.lastInsertRowid;
  }

  // ~36 completed trips across the last ~4 months.
  for (let i = 0; i < 36; i++) {
    const vehicleId = pick(vehicleIds, i);
    const driverId = pick(driverIds, i);
    const requesterId = pick(staff, i);
    const day = addMinutes(addDays(today(), -rint(3, 118)), rint(7, 15) * 60 + [0, 15, 30, 45][rint(0, 3)]);
    const durationMin = rint(45, 300);
    const end = addMinutes(day, durationMin);
    const distance = rint(8, 140);
    const reqId = await makeRequest(requesterId, day, end, pick(destinations, i), pick(purposes, i), 'completed');
    if (approver) await db.run(`INSERT INTO request_approvals (vehicle_request_id, approver_id, action, comment, approved_at, created_at, updated_at) VALUES (?, ?, 'approved', 'Approved.', ?, ${db.now()}, ${db.now()})`, [reqId, approver, fmt(addMinutes(day, -rint(120, 1800)))]);
    const start = odo[vehicleId]; const finish = start + distance; odo[vehicleId] = finish;
    const tripRes = await db.run(
      `INSERT INTO trips (trip_number, vehicle_request_id, vehicle_id, driver_id, scheduled_start, scheduled_end, actual_start, actual_end, starting_odometer, ending_odometer, distance, duration_minutes, status, assigned_by, started_by, ended_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
      [tripNo(), reqId, vehicleId, driverId, fmt(day), fmt(end), fmt(day), fmt(end), start, finish, distance, durationMin, transport, transport, transport, fmt(addDays(day, -1)), fmt(end)]
    );
    const tripId = tripRes.lastInsertRowid;
    await db.run(`INSERT INTO odometer_readings (vehicle_id, trip_id, reading, source, recorded_by, created_at, updated_at) VALUES (?, ?, ?, 'trip_start', ?, ?, ?)`, [vehicleId, tripId, start, transport, fmt(day), fmt(day)]);
    await db.run(`INSERT INTO odometer_readings (vehicle_id, trip_id, reading, source, recorded_by, created_at, updated_at) VALUES (?, ?, ?, 'trip_end', ?, ?, ?)`, [vehicleId, tripId, finish, transport, fmt(end), fmt(end)]);
  }
  for (const vid of vehicleIds) await db.run('UPDATE vehicles SET current_odometer = ? WHERE id = ? AND current_odometer < ?', [odo[vid], vid, odo[vid]]);

  // A few pending requests awaiting approval.
  for (let n = 1; n <= 4; n++) {
    const day = addMinutes(addDays(today(), rint(1, 6)), rint(8, 14) * 60);
    await makeRequest(pick(staff, n), day, addMinutes(day, 180), pick(destinations, n), pick(purposes, n), 'pending');
  }

  // One approved request scheduled for today.
  const start = addMinutes(today(), 11 * 60);
  const reqId = await makeRequest(staff[0], start, addMinutes(start, 120), 'KNUST Hospital', 'Official campus support visit', 'scheduled');
  if (approver) await db.run(`INSERT INTO request_approvals (vehicle_request_id, approver_id, action, comment, approved_at, created_at, updated_at) VALUES (?, ?, 'approved', 'Approved.', ?, ${db.now()}, ${db.now()})`, [reqId, approver, fmt(addMinutes(new Date(), -240))]);
  await db.run(`INSERT INTO trips (trip_number, vehicle_request_id, vehicle_id, driver_id, scheduled_start, scheduled_end, status, assigned_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ${db.now()}, ${db.now()})`, [tripNo(), reqId, vehicleIds[0], driverIds[0], fmt(start), fmt(addMinutes(start, 120)), transport]);
  await db.run("UPDATE vehicles SET status = 'scheduled' WHERE id = ?", [vehicleIds[0]]);
}

async function main() {
  console.log('[seed] runtime =', db.mode());
  await db.ensureSchema(); // create PostgreSQL schema on a fresh database (no-op on SQLite)
  const roleIds = await seedRoles();
  await seedCapabilities(roleIds);
  const deptIds = await seedDepartments();
  const org = await seedOrgTree(deptIds);
  const userIds = await seedUsers(roleIds, org);
  const vehicleIds = await seedVehicles(org);
  const driverIds = await seedDrivers(roleIds, userIds, org);
  await seedSettings();
  await seedDemoTrips(userIds, vehicleIds, driverIds);
  console.log('[seed] done. Accounts: admin@uits.test / approver@ / transport@ / supervisor@ / staff@ / driver1@ / driver2@ / gatedstaff@  (password: "password")');
}

main().then(() => process.exit(0)).catch((err) => { console.error('[seed] failed:', err); process.exit(1); });
