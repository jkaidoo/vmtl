'use strict';
process.env.VMTL_DB = ':memory:';
if (process.env.VMTL_TEST_OU_PG === '1') { process.env.DB_RUNTIME = 'postgres'; process.env.PGLITE_DIR = 'memory://'; delete process.env.DATABASE_URL; }
else delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/runtime');

test('IT Admin is provisioned and all reads, changes and assignments stay within its current OU subtree', async t => {
  await db.ensureSchema(); if (db.isPostgres()) t.after(() => require('../src/db/postgres').close());
  const role = await db.get("SELECT * FROM roles WHERE slug='it_admin'"); assert.ok(role);
  await require('../src/services/ouAdmin').ensureRole();
  assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM roles WHERE slug='it_admin'")).n), 1);
  await db.run("INSERT INTO roles(id,slug,name) VALUES(100,'staff','Staff'),(101,'administrator','System Administrator')");
  await db.run("INSERT INTO role_capabilities(role_id,capability) VALUES(100,'requests.create'),(101,'system.admin'),(101,'fleet.global')");
  const org = require('../src/services/orgUnits');
  const institution = await org.create({ name: 'University', type: 'institution' });
  const own = await org.create({ name: 'Own OU', type: 'department', parent_id: institution });
  const child = await org.create({ name: 'Child OU', type: 'unit', parent_id: own });
  const other = await org.create({ name: 'Sibling OU', type: 'department', parent_id: institution });
  for (const [id, name, roleId, ou, owner] of [[1, 'Owner', 101, institution, 1], [2, 'IT Admin', role.id, own, 0], [3, 'Local user', 100, child, 0], [4, 'Sibling user', 100, other, 0], [5, 'Unassigned', null, null, 0], [6, 'Global admin', 101, child, 0], [7, 'No OU admin', role.id, null, 0]]) await db.run('INSERT INTO users(id,name,email,role_id,org_unit_id,is_super_admin) VALUES(?,?,?,?,?,?)', [id, name, `user${id}@test`, roleId, ou, owner]);
  for (const [id, ou] of [[10, own], [20, child], [30, other], [40, institution]]) {
    await db.run('INSERT INTO vehicles(id,vehicle_number,registration_number,capacity,org_unit_id) VALUES(?,?,?,?,?)', [id, 'V' + id, 'R' + id, 10, ou]);
    await db.run('INSERT INTO drivers(id,name,org_unit_id) VALUES(?,?,?)', [id, 'Driver ' + id, ou]);
    await db.run('INSERT INTO vehicle_requests(id,request_number,requester_id,org_unit_id,travel_date,requested_start_time,expected_end_time,destination,purpose) VALUES(?,?,?,?,?,?,?,?,?)', [id, 'REQ' + id, id === 30 ? 4 : 3, ou, '2026-11-14', '09:00', '10:00', 'Place ' + id, 'Test']);
    await db.run("INSERT INTO trips(id,trip_number,vehicle_request_id,vehicle_id,driver_id,scheduled_start,scheduled_end,status) VALUES(?,?,?,?,?,?,?,'in_progress')", [id, 'TRP' + id, id, id, id, '2026-11-14 09:00', '2026-11-14 10:00']);
  }
  const audit = require('../src/services/audit');
  await audit.record({ userId: 3, action: 'local.fixture' }); await audit.record({ userId: 4, action: 'outside.fixture' });
  const outsideAudit = (await db.get("SELECT id FROM audit_logs WHERE action='outside.fixture'")).id;
  const express = require('express'); const app = require('../src/middleware/asyncSafe').asyncSafe(express()); app.use(express.json());
  app.use(async (req, res, next) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [Number(req.headers['x-user'] || 2)]);
    // A stale session must not widen scope after an account's OU changes.
    if (user && user.id === 2) user.org_unit_id = institution;
    req.session = { user }; next();
  });
  app.use('/api', require('../src/routes/api')); app.use(require('../src/middleware/errorHandler'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (url, method = 'GET', body, user = 2) => fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method, headers: { 'x-user': String(user), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function json(url, user = 2) { const response = await request(url, 'GET', undefined, user); assert.equal(response.status, 200, url); return response.json(); }
  assert.deepEqual((await json('/vehicles')).data.map(v => v.id), [10, 20]);
  assert.deepEqual((await json('/drivers')).data.map(v => v.id), [10, 20]);
  assert.deepEqual(new Set((await json('/vehicle-requests')).data.map(r => r.id)), new Set([10, 20]));
  assert.deepEqual(new Set((await json('/trips')).data.map(r => r.id)), new Set([10, 20]));
  assert.deepEqual(new Set((await json('/trips/in-progress')).data.map(r => r.id)), new Set([10, 20]));
  assert.deepEqual((await json('/org-units/tree')).data.map(r => r.id), [own, child]);
  const users = (await json('/users')).data; assert.ok(users.some(u => u.id === 3)); assert.ok(!users.some(u => [1, 4, 5].includes(u.id)));
  const meta = await json('/meta'); assert.ok(meta.roles.some(r => r.slug === 'it_admin')); assert.ok(!meta.roles.some(r => r.slug === 'administrator'));
  assert.deepEqual(meta.org_units.map(r => r.id), [own, child]);
  const dashboard = (await json('/dashboard')).data; assert.equal(dashboard.cards.pending_requests, 2); assert.equal(dashboard.vehicle_board.length, 2); assert.ok(!JSON.stringify(dashboard).includes('Place 30'));
  assert.deepEqual((await json('/availability/overview')).data.vehicles.map(v => v.id), [10, 20]);
  assert.equal((await json('/reports')).data.rows.length, 2);
  assert.ok(!(await json('/audit-logs')).data.some(a => a.action === 'outside.fixture'));
  for (const url of ['/vehicles/30', '/drivers/30', '/vehicle-requests/30', '/trips/30', '/users/4', '/users/5', '/users/6', '/admin/application-logs', '/admin/backups', '/rbac', '/owner-access', '/audit-logs/' + outsideAudit]) assert.ok([403, 404].includes((await request(url)).status), url);
  assert.equal((await request('/vehicle-requests/30/approve', 'POST', {})).status, 403);
  assert.equal((await request('/vehicle-requests/10', 'PUT', { destination: 'Updated local destination' })).status, 200);
  assert.equal((await request('/vehicle-requests/30', 'PUT', { destination: 'Must not update' })).status, 403);
  for (const value of ['+30', '%2B30', '30.0', '3e1']) assert.equal((await request(`/vehicle-requests/${value}/approve`, 'POST', {})).status, 404);
  assert.equal((await request('/vehicle-requests/10/assign', 'POST', { vehicle_id: 30, driver_id: 30 })).status, 403);
  assert.equal((await request('/users/3', 'PATCH', { role_id: 101 })).status, 403);
  assert.equal((await request('/users/3', 'PATCH', { org_unit_id: other })).status, 403);
  assert.equal((await request('/users/3', 'PATCH', { org_unit_id: null })).status, 403);
  assert.equal((await request('/users/2', 'PATCH', { role_id: 100 })).status, 403);
  assert.equal((await request('/users/3', 'PATCH', { active: false })).status, 200);
  assert.equal((await db.get('SELECT active FROM users WHERE id=3')).active, 0);
  assert.equal((await request('/org-units/' + child, 'PUT', { name: 'Bad move', type: 'unit', parent_id: other })).status, 403);
  assert.equal((await request('/org-units/' + own, 'DELETE')).status, 403);
  assert.equal((await request('/org-units', 'POST', { name: 'New child', type: 'unit', parent_id: own })).status, 201);
  assert.equal((await request('/vehicles', 'GET', undefined, 7)).status, 403);
  assert.equal((await request('/users/5', 'PATCH', { role_id: role.id }, 1)).status, 422);
  assert.equal((await request('/users/5', 'PATCH', { role_id: role.id, org_unit_id: own }, 1)).status, 200);
  assert.equal((await request('/users/5', 'PATCH', { org_unit_id: null }, 1)).status, 422);
  const notification = require('../src/services/notifications');
  await notification.toUser(2, 'new_request', { request_id: 30, request_number: 'REQ30' });
  assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM notifications WHERE user_id=2 AND data LIKE '%REQ30%'")).n), 0);
  // The built-in role cannot accidentally become global through added capabilities or sharing.
  await db.run("INSERT INTO role_capabilities(role_id,capability) VALUES(?,'fleet.global'),(?,'system.admin')", [role.id, role.id]);
  const effective = await require('../src/services/roleRepository').capsForUser(2); assert.ok(!effective.includes('fleet.global')); assert.ok(!effective.includes('system.admin'));
  await require('../src/services/settings').set('owner_page_access', JSON.stringify({ rbac: { roles: ['it_admin'], users: [] } }));
  assert.deepEqual(await require('../src/services/ownerAccess').pagesFor({ id: 2 }), []);
  assert.equal((await request('/rbac')).status, 403);
  assert.equal((await json('/vehicles')).data.length, 2);
  await db.run('UPDATE users SET org_unit_id=? WHERE id=2', [other]);
  assert.deepEqual((await json('/vehicles')).data.map(v => v.id), [30]);
});
