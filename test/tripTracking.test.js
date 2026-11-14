'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { asyncSafe } = require('../src/middleware/asyncSafe');
const errorHandler = require('../src/middleware/errorHandler');
const db = require('../src/db/sqlite');

test('trip tracking keeps fixes trip-specific and checks requester, driver and org scope', async () => {
  db.exec(`
    INSERT INTO roles(id,slug,name) VALUES (1,'staff','Staff'),(2,'transport_admin','Transport');
    INSERT INTO role_capabilities(role_id,capability) VALUES (2,'trips.operate');
    INSERT INTO org_units(id,name,type,path) VALUES (1,'A','unit','/1/'),(2,'B','unit','/2/');
    INSERT INTO users(id,name,email,password_hash,role_id,org_unit_id) VALUES
      (1,'Requester','requester@test','x',1,1),(2,'Driver','driver@test','x',1,1),
      (3,'Other','other@test','x',1,1),(4,'Transport B','transport@test','x',2,2);
    INSERT INTO vehicles(id,vehicle_number,registration_number,vehicle_type,org_unit_id) VALUES (1,'V1','REG1','bus_coaster',1);
    INSERT INTO drivers(id,name,user_id,org_unit_id) VALUES (1,'Driver',2,1);
    INSERT INTO vehicle_requests(id,request_number,requester_id,org_unit_id,travel_date,requested_start_time,expected_end_time,destination,purpose)
      VALUES (1,'R1',1,1,'2026-11-13','08:00','10:00','Campus','Work');
    INSERT INTO trips(id,trip_number,vehicle_request_id,vehicle_id,driver_id,scheduled_start,scheduled_end,status) VALUES
      (1,'T1',1,1,1,'2026-11-13 08:00:00','2026-11-13 10:00:00','in_progress'),
      (2,'T2',1,1,1,'2026-11-14 08:00:00','2026-11-14 10:00:00','scheduled');
    INSERT INTO vehicle_positions(vehicle_id,trip_id,lat,lng,recorded_by,recorded_at) VALUES (1,1,6.6745,-1.5716,2,datetime('now'));
  `);
  const app = asyncSafe(express());
  app.use((req, res, next) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.headers['x-test-user']));
    req.session = { user }; next();
  });
  require('../src/routes/api/trips')(app);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = (id, user) => fetch(`http://127.0.0.1:${server.address().port}/trips/${id}/location`, { headers: { 'x-test-user': String(user) } });
  try {
    assert.equal((await get(1, 0)).status, 401);
    assert.equal((await get(1, 3)).status, 403, 'unrelated staff cannot see a fix');
    assert.equal((await get(1, 4)).status, 403, 'transport from another org cannot see a fix');
    const own = await (await get(1, 1)).json();
    assert.equal(own.data.trip_id, 1);
    assert.equal(own.data.vehicle_type, 'bus_coaster');
    assert.equal(own.data.stale, false);
    assert.equal((await get(1, 2)).status, 200, 'assigned driver can view');
    assert.equal((await (await get(2, 1)).json()).data, null, 'another trip on the same vehicle must not reuse the old fix');
    db.prepare("UPDATE vehicle_positions SET recorded_at = datetime('now','-10 minutes')").run();
    assert.equal((await (await get(1, 1)).json()).data.stale, true);
    assert.equal((await get(999, 1)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('application logs allow system administrators and paginate filtered events', async () => {
  db.exec(`
    INSERT INTO roles(id,slug,name) VALUES (99,'log_admin','Log Admin');
    INSERT INTO role_capabilities(role_id,capability) VALUES (99,'system.admin');
    INSERT INTO users(id,name,email,password_hash,role_id) VALUES (99,'Log Admin','logs@test','x',99);
  `);
  await require('../src/services/settings').set('owner_page_access', JSON.stringify({ 'app-health': { roles: ['log_admin'], users: [] } }));
  const log = require('../src/util/log');
  for (let i = 0; i < 12; i++) log.info('log_pagination_fixture', { message: `Event ${i}`, data: { index: i } });
  log.warn('log_filter_fixture', { message: 'Warning fixture' });
  const app = asyncSafe(express());
  app.use((req, res, next) => {
    req.session = { user: db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.headers['x-test-user'])) }; next();
  });
  require('../src/routes/api/admin')(app);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = (query, user = 99) => fetch(`http://127.0.0.1:${server.address().port}/admin/application-logs?${query}`, { headers: { 'x-test-user': String(user) } });
  try {
    assert.equal((await get('', 1)).status, 403);
    const first = await (await get('search=log_pagination_fixture')).json();
    assert.equal(first.meta.per_page, 10);
    assert.equal(first.data.length, 10);
    assert.equal(first.meta.total, 12);
    const second = await (await get('search=log_pagination_fixture&page=2')).json();
    assert.equal(second.data.length, 2);
    assert.notEqual(first.data[0].message, second.data[0].message);
    const warning = await (await get('search=log_filter_fixture&level=warn')).json();
    assert.equal(warning.data.length, 1);
    assert.equal(warning.data[0].level, 'warn');
    assert.equal((await (await get('search=log_filter_fixture&level=error')).json()).meta.total, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
