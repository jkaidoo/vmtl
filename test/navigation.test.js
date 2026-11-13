'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const db = require('../src/db/sqlite');
const navigation = require('../src/services/navigation');

db.exec(`INSERT INTO roles(id,slug,name) VALUES(1,'staff','Staff'),(2,'administrator','Administrator');
  INSERT INTO role_capabilities(role_id,capability) VALUES(1,'requests.create'),(2,'system.admin'),(2,'users.manage');
  INSERT INTO users(id,name,email,password_hash,role_id,is_super_admin) VALUES(1,'Owner','owner@test','x',2,1),(2,'Staff','staff@test','x',1,0);`);

test('navigation catalogue stays aligned with the shell page keys and destinations', () => {
  const source = fs.readFileSync(require.resolve('../public/js/common.js'), 'utf8').replace(/\r\n/g, '\n');
  const snippet = source.slice(source.indexOf('  const OPS ='), source.indexOf('\n\n  function visible'));
  const shell = vm.runInNewContext(snippet + '\nJSON.stringify(NAV)');
  assert.equal(JSON.stringify(navigation.catalogue), shell);
});

test('navigation layouts preserve sections, order, labels and visibility across roles and resets', async () => {
  const defaults = (await navigation.editor('__all__')).layout;
  const item = defaults.sections[0].items.shift(); item.label = 'My overview';
  const layout = { sections: [{ id: 'custom', title: 'My work', items: [item] }, ...defaults.sections] };
  layout.sections.find(s => s.id === 'help').items[0].visible = false;
  await navigation.save('__all__', layout);
  const owner = await navigation.effective({ id: 1, is_super_admin: true });
  assert.equal(owner.sections[0].title, 'My work');
  assert.equal(owner.sections[0].items[0].label, 'My overview');
  assert.equal(owner.sections.find(s => s.id === 'help').items[0].visible, false);
  const staff = await navigation.effective({ id: 2 });
  assert.equal(staff.sections[0].items[0].label, 'My overview');
  assert.ok(!staff.sections.flatMap(s => s.items).some(item => item.key === 'rbac'));
  const ownLayout = structuredClone(staff); ownLayout.sections[0].title = 'Staff space';
  await navigation.save('staff', ownLayout);
  assert.equal((await navigation.effective({ id: 2 })).sections[0].title, 'Staff space');
  assert.equal((await navigation.effective({ id: 1, is_super_admin: true })).sections[0].title, 'My work');
  await navigation.save('staff', { reset: true });
  assert.equal((await navigation.effective({ id: 2 })).sections[0].title, 'My work');
  await navigation.save('__all__', { reset: true });
  assert.equal((await navigation.editor('__all__')).layout.sections[0].title, 'Workspace');
});

test('layout validation rejects unknown pages, duplicate IDs and pages, and keeps the editor reachable', () => {
  const section = { id: 'x', title: 'Custom', items: [{ key: 'navigation', label: 'Menu', visible: false }] };
  assert.equal(navigation.clean({ sections: [section] }).sections[0].items[0].visible, true);
  assert.throws(() => navigation.clean({ sections: [section, section] }), /unique ID/);
  assert.throws(() => navigation.clean({ sections: [{ ...section, items: [...section.items, ...section.items] }] }), /listed once/);
  assert.throws(() => navigation.clean({ sections: [{ ...section, items: [{ key: 'javascript:bad', label: 'Bad' }] }] }), /known/);
  assert.throws(() => navigation.clean({ sections: [{ ...section, title: '' }] }), /heading/);
});

test('new pages are added without moving existing custom items or losing hidden state', () => {
  const layout = { sections: [{ id: 'custom', title: 'Custom', items: [{ key: 'dashboard', label: 'Overview', visible: false }] }] };
  const base = { sections: [{ id: 'workspace', title: 'Workspace', items: [{ key: 'dashboard', label: 'Dashboard' }, { key: 'trips', label: 'Trips' }] }] };
  const result = navigation.withNewPages(layout, base);
  assert.equal(result.sections[0].items[0].visible, false);
  assert.equal(result.sections[1].items[0].key, 'trips');
  assert.equal(layout.sections.length, 1);
});

test('navigation management routes require a system administrator and validate the role', async () => {
  const express = require('express');
  const app = require('../src/middleware/asyncSafe').asyncSafe(express());
  app.use(express.json());
  app.use((req, res, next) => { const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.headers['x-test-user'] || 0)); req.session = { user }; next(); });
  require('../src/routes/api/admin')(app);
  app.use(require('../src/middleware/errorHandler'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/admin/navigation`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { 'x-test-user': '2' } })).status, 403);
    assert.equal((await fetch(url + '/unknown', { headers: { 'x-test-user': '1' } })).status, 400);
    const out = await (await fetch(url, { headers: { 'x-test-user': '1' } })).json();
    assert.ok(out.data.roles.some(role => role.key === 'staff'));
    assert.equal((await fetch(url + '/__all__', { method: 'PUT', headers: { 'x-test-user': '2', 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
