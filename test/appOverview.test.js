'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../src/db/runtime');
const capabilities = require('../src/services/capabilities');

test('app overview is App-Owner only and reports live figures, roles and catalogue sizes', async (t) => {
  await db.run("INSERT INTO roles(id,slug,name) VALUES(1,'administrator','Administrator'),(2,'university_transport_officer','UTO')");
  await db.run("INSERT INTO role_capabilities(role_id,capability) VALUES(1,'system.admin'),(2,'vehicles.manage'),(2,'drivers.manage')");
  await db.run("INSERT INTO users(id,name,email,password_hash,role_id,is_super_admin,active) VALUES(1,'Owner','owner@test','x',1,1,1),(2,'Admin','admin@test','x',1,0,1),(3,'Gone','gone@test','x',2,0,0)");
  await db.run("INSERT INTO vehicles(vehicle_number,registration_number,active) VALUES('V-1','GR-1',1),('V-2','GR-2',0)");
  await db.run("INSERT INTO vehicles(vehicle_number,registration_number,active,deleted_at) VALUES('V-3','GR-3',1,'2026-01-01 00:00:00')");
  await db.run("INSERT INTO drivers(name) VALUES('Driver A')");

  const { asyncSafe } = require('../src/middleware/asyncSafe');
  const app = express();
  // x-user: 1 = App Owner, 2 = System Administrator (not the owner), absent = signed out.
  app.use((req, res, next) => { const id = Number(req.headers['x-user']); req.session = id ? { user: { id, is_super_admin: id === 1 } } : {}; next(); });
  const router = asyncSafe(express.Router()); require('../src/routes/api/app-overview')(router); app.use('/api', router); app.use(require('../src/middleware/errorHandler'));
  const server = app.listen(0); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/admin/app-overview`;

  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-user': '2' } })).status, 403, 'a System Administrator is not the App Owner');

  const res = await fetch(url, { headers: { 'x-user': '1' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { data } = await res.json();
  assert.equal(data.usage.vehicles, 2, 'soft-deleted vehicles are excluded');
  assert.equal(data.usage.vehicles_active, 1);
  assert.equal(data.usage.drivers, 1);
  assert.equal(data.usage.users, 2, 'inactive users are excluded');
  assert.equal(data.usage.km_travelled, 0);
  assert.equal(data.catalogue.capabilities, capabilities.all().length);
  assert.ok(data.catalogue.notification_templates > 0 && data.catalogue.dropdown_lists > 0 && data.catalogue.pages > 0);
  assert.ok(data.catalogue.migrations >= 8);
  assert.equal(data.platform.engine, 'SQLite');
  const uto = data.roles.find((r) => r.slug === 'university_transport_officer');
  assert.deepEqual(uto, { slug: 'university_transport_officer', label: 'University Transport Officer', capabilities: 2, users: 0 });
});
