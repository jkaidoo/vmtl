'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/sqlite');
const directory = require('../src/services/directoryAuth');
const roles = require('../src/services/roles');

test('directory activity searches all attempts and paginates without changing totals', async () => {
  const insert = db.prepare("INSERT INTO audit_logs(actor_name,action,description,created_at) VALUES (?, 'directory.login_success', ?, datetime('now'))");
  for (let i = 0; i < 65; i++) insert.run(`person${i}`, `[Campus] Attempt ${i}`);
  const first = await directory.activity(7, { per_page: 10 });
  const second = await directory.activity(7, { per_page: 10, page: 2 });
  assert.equal(first.meta.total, 65);
  assert.equal(first.meta.last_page, 7);
  assert.equal(first.recent.length, 10);
  assert.notEqual(first.recent[0].actor_name, second.recent[0].actor_name);
  const found = await directory.activity(7, { search: 'PERSON0', page: 99 });
  assert.equal(found.meta.total, 1);
  assert.equal(found.meta.current_page, 1);
  assert.equal(found.recent[0].actor_name, 'person0');
  assert.equal(found.totals.success, 65);
  const empty = await directory.activity(7, { search: 'missing identity' });
  assert.equal(empty.meta.total, 0);
  assert.equal(empty.meta.last_page, 1);
  assert.deepEqual(empty.recent, []);
});

test('clients and accounts awaiting assignment land on their dashboard', () => {
  assert.equal(roles.homePage([]), '/dashboard.html');
  assert.equal(roles.homePage(['requests.create']), '/dashboard.html');
});
