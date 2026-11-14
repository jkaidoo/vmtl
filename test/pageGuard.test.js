'use strict';
// HTML page guard (src/app.js) for App Owner and System pages: the page itself must
// follow the same Owner page access grants as the APIs behind it.
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const db = require('../src/db/runtime');
const { hashPassword } = require('../src/util/password');
const ownerAccess = require('../src/services/ownerAccess');
const { createApp } = require('../src/app');

test('shared System and owner pages open for the people they are shared with, and only them', async (t) => {
  const pw = hashPassword('Fixture#Pass1');
  await db.run("INSERT INTO roles(id,slug,name) VALUES(1,'administrator','Administrator'),(2,'approver','Approver'),(3,'staff','Staff')");
  await db.run("INSERT INTO role_capabilities(role_id,capability) VALUES(1,'system.admin'),(1,'users.manage'),(2,'requests.approve'),(2,'requests.view_all'),(3,'requests.create')");
  await db.run(`INSERT INTO users(id,name,email,password_hash,role_id,is_super_admin,active) VALUES
    (1,'Owner','owner@test',?,1,1,1),(2,'Sys Admin','sysadmin@test',?,1,0,1),(3,'Approver','approver@test',?,2,0,1),(4,'Staff','staff@test',?,3,0,1)`, [pw, pw, pw, pw]);

  const app = createApp({ sessionStore: new session.MemoryStore() });
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const signIn = async (email) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Fixture#Pass1' }) });
    assert.equal(res.status, 200, `sign in ${email}`);
    return res.headers.get('set-cookie').split(';')[0];
  };
  // 200 = page served; otherwise where it redirected to.
  const page = async (cookie, path) => { const r = await fetch(base + path, { headers: { cookie }, redirect: 'manual' }); return r.status === 200 ? 200 : new URL(r.headers.get('location'), base).pathname; };

  const owner = await signIn('owner@test'); const sysadmin = await signIn('sysadmin@test');
  const approver = await signIn('approver@test'); const staff = await signIn('staff@test');

  // Nothing shared: only the App Owner reaches System and owner pages — including a
  // System Administrator, whose APIs for these pages would answer 403.
  for (const path of ['/rbac.html', '/app-health.html', '/backup-cleanup.html', '/owner-access.html', '/dropdowns.html']) {
    assert.equal(await page(owner, path), 200, `owner ${path}`);
    assert.equal(await page(sysadmin, path), '/dashboard.html', `system administrator without a grant ${path}`);
    assert.equal(await page(approver, path), '/dashboard.html', `approver ${path}`);
  }

  // Share RBAC with the approver role, and App Health + Dropdowns with one staff member.
  await ownerAccess.save({ pages: { rbac: { roles: ['approver'], users: [] }, 'app-health': { roles: [], users: [4] }, dropdowns: { roles: [], users: [4] } } });
  assert.equal(await page(approver, '/rbac.html'), 200, 'System page shared with the role');
  assert.equal((await fetch(`${base}/api/rbac`, { headers: { cookie: approver } })).status, 200, 'and its API');
  assert.equal(await page(approver, '/app-health.html'), '/dashboard.html', 'only the shared page');
  assert.equal(await page(staff, '/app-health.html'), 200, 'shared with a person, despite a requester-only role');
  assert.equal(await page(staff, '/dropdowns.html'), 200, 'owner page shared with a person');
  assert.equal(await page(staff, '/rbac.html'), '/dashboard.html');
  assert.equal(await page(sysadmin, '/rbac.html'), '/dashboard.html', 'grants are per role/person, not by System administration');
  assert.equal(await page(approver, '/messaging.html'), '/dashboard.html', 'legacy messaging page is never shareable');

  // Revoking closes the page on the next request.
  await ownerAccess.save({ pages: {} });
  assert.equal(await page(approver, '/rbac.html'), '/dashboard.html');
  assert.equal(await page(staff, '/dropdowns.html'), '/dashboard.html');
});
