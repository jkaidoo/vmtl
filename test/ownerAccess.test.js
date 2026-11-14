'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../src/db/runtime');
const ownerAccess = require('../src/services/ownerAccess');
const navigation = require('../src/services/navigation');

async function fixtures() {
  await db.run("INSERT INTO roles(id,slug,name) VALUES(1,'staff','Staff'),(2,'transport_admin','Transport'),(3,'administrator','Administrator')");
  await db.run("INSERT INTO role_capabilities(role_id,capability) VALUES(1,'requests.create'),(2,'vehicles.manage'),(3,'system.admin')");
  // 1 owner · 2 staff · 3 transport officer · 4 transport officer (inactive) · 5 system administrator
  await db.run(`INSERT INTO users(id,name,email,password_hash,role_id,is_super_admin,active) VALUES
    (1,'Owner','owner@test','x',3,1,1),(2,'Staff','staff@test','x',1,0,1),(3,'Tina','tina@test','x',2,0,1),(4,'Old','old@test','x',2,0,0),(5,'Admin','admin@test','x',3,0,1)`);
}

function server(t, routes) {
  const { asyncSafe } = require('../src/middleware/asyncSafe');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { const id = Number(req.headers['x-user']); req.session = id ? { user: { id, name: 'U' + id, is_super_admin: id === 1 } } : {}; next(); });
  const router = asyncSafe(express.Router()); routes.forEach((r) => require(r)(router)); app.use('/api', router); app.use(require('../src/middleware/errorHandler'));
  const s = app.listen(0); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}/api`;
  return (path, user, init = {}) => fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': String(user) } : {}), ...(init.headers || {}) } });
}

test('owner pages open only to the App Owner until shared, and sharing follows roles and named people', async (t) => {
  await fixtures();
  const call = server(t, ['../src/routes/api/fleet-operations', '../src/routes/api/owner-access', '../src/routes/api/app-overview']);

  // Nothing shared: only the owner gets in.
  assert.equal((await call('/dropdowns', 1)).status, 200);
  for (const user of [2, 3, 5]) assert.equal((await call('/dropdowns', user)).status, 403, `user ${user} before sharing`);
  assert.deepEqual(await ownerAccess.pagesFor({ id: 3 }), []);

  // Only the owner can read or change the grants — not even a System Administrator.
  assert.equal((await call('/admin/owner-access', 5)).status, 403);
  const share = (pages, user = 1) => call('/admin/owner-access', user, { method: 'PUT', body: JSON.stringify({ pages }) });
  assert.equal((await share({ dropdowns: { roles: ['transport_admin'], users: [] } }, 5)).status, 403);

  // Every System page is available to share, but administrators need grants too.
  for (const page of navigation.catalogue.find((s) => s.label === 'System').items) {
    assert.ok(ownerAccess.DELEGABLE[page.key], page.key);
    assert.equal(await ownerAccess.can({ id: 5 }, page.key), false, page.key);
  }
  assert.equal((await share({ unknown: { roles: [], users: [] } })).status, 422);
  assert.equal((await share({ 'backup-cleanup': { roles: ['staff'], users: [] }, 'owner-access': { roles: [], users: [3] }, 'app-health': { roles: ['transport_admin'], users: [] } })).status, 200);
  assert.equal(await ownerAccess.can({ id: 2 }, 'backup-cleanup'), true);
  assert.equal((await call('/admin/owner-access', 3)).status, 200);
  assert.equal(await ownerAccess.can({ id: 3 }, 'app-health'), true);
  assert.ok((await navigation.defaults('transport_admin')).sections.flatMap((s) => s.items).some((p) => p.key === 'app-health'));

  assert.equal((await share({ dropdowns: { roles: ['no_such_role'], users: [] } })).status, 422);
  assert.equal((await share({ dropdowns: { roles: [], users: [999] } })).status, 422);

  // Share Dropdowns with a role, and App overview with one named staff member.
  const res = await share({ dropdowns: { roles: ['transport_admin'], users: [] }, 'app-overview': { roles: [], users: [2] } });
  assert.equal(res.status, 200);
  const overview = (await res.json()).data;
  assert.deepEqual(overview.pages.find((p) => p.key === 'app-overview').users.map((u) => u.name), ['Staff']);
  assert.equal((await call('/dropdowns', 3)).status, 200, 'role member');
  assert.equal((await call('/dropdowns', 2)).status, 403, 'other role');
  assert.equal((await call('/file-server', 3)).status, 403, 'only the shared page');
  assert.equal((await call('/admin/app-overview', 2)).status, 200, 'named person, even with a requester-only role');
  assert.equal((await call('/admin/app-overview', 3)).status, 403);
  assert.deepEqual(await ownerAccess.pagesFor({ id: 4 }), [], 'inactive accounts get nothing');
  assert.deepEqual(await ownerAccess.pagesFor({ id: 3 }), ['dropdowns']);
  assert.ok((await ownerAccess.pagesFor({ id: 1, is_super_admin: true })).length === Object.keys(ownerAccess.DELEGABLE).length);

  // The signed-in user payload and the role's menu reflect the grants.
  const { userForClient } = require('../src/services/serializers');
  assert.deepEqual((await userForClient(2)).owner_pages, ['app-overview']);
  const keysFor = async (scope) => (await navigation.defaults(scope)).sections.flatMap((s) => s.items.map((i) => i.key));
  assert.ok((await keysFor('transport_admin')).includes('dropdowns'));
  assert.ok(!(await keysFor('transport_admin')).includes('file-server'));
  assert.ok(!(await keysFor('staff')).includes('dropdowns'));

  // Revoking takes effect on the next request, and changes are audited.
  assert.equal((await share({ dropdowns: { roles: [], users: [] } })).status, 200);
  assert.equal((await call('/dropdowns', 3)).status, 403);
  const audit = await db.get("SELECT description FROM audit_logs WHERE action = 'owner_access.updated' ORDER BY id DESC LIMIT 1");
  assert.match(audit.description, /Dropdowns: 0 role\(s\), 0 person\(s\)/);
});
