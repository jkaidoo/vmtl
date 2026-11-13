'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert');
const staffSync = require('../src/services/staffSync');
const db = require('../src/db/sqlite');

test('textField normalises Unified API field shapes', () => {
  assert.strictEqual(staffSync.textField('  Hi '), 'Hi');
  assert.strictEqual(staffSync.textField(['A', 'B']), 'A');
  assert.strictEqual(staffSync.textField({ value: 'X' }), 'X');
  assert.strictEqual(staffSync.textField({ name: 'Y' }), 'Y');
  assert.strictEqual(staffSync.textField(null), '');
  assert.strictEqual(staffSync.textField(undefined), '');
});

test('orgUnitForProfile auto-creates college -> faculty -> department, idempotently', async () => {
  const id = await staffSync.orgUnitForProfile({ college: 'College of Science', faculty: 'Faculty of Physical Sciences', department: 'Computer Science' });
  const row = db.prepare('SELECT name, type, parent_id FROM org_units WHERE id = ?').get(id);
  assert.strictEqual(row.type, 'department');
  assert.strictEqual(row.name, 'Computer Science');

  // The full chain exists with the right types.
  const types = db.prepare("SELECT type, COUNT(*) AS n FROM org_units GROUP BY type").all().reduce((a, r) => (a[r.type] = r.n, a), {});
  assert.strictEqual(types.college, 1);
  assert.strictEqual(types.faculty, 1);
  assert.strictEqual(types.department, 1);

  // Same profile resolves to the same unit (no duplicates).
  const again = await staffSync.orgUnitForProfile({ college: 'College of Science', faculty: 'Faculty of Physical Sciences', department: 'Computer Science' });
  assert.strictEqual(id, again);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM org_units WHERE type = 'department'").get().n, 1);
});

test('orgUnitForProfile returns null when no OU fields are present', async () => {
  assert.strictEqual(await staffSync.orgUnitForProfile({}), null);
});

test('disabled import fields preserve stored values and pause pending organisational moves', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  let update;
  let photoEnabled = false;
  let photoValue = null;
  let photoCalls = 0;
  const api = {
    enabled: async () => true,
    fieldSettings: async () => ['id_number', 'rank', 'designation', 'staff_category', 'staff_type', 'college', 'faculty', 'department', 'org_unit', 'photo_url'].map((key) => ({ key, enabled: key === 'designation' || (key === 'photo_url' && photoEnabled) })),
    staffPhoto: async () => { photoCalls++; return photoValue; },
    searchStaff: async () => ({ status: 'ok', results: [{ id_number: '42', email: 'person@test' }] }),
    staffProfile: async () => ({ status: 'found', id_number: '42', fields: { rank: 'New rank', designation: 'Officer', department: 'New department' } }),
  };
  const mocks = {
    './db_ref': {
      get: async () => ({ id: 1, email: 'person@test', org_unit_id: 2, pending_org_unit_id: 3 }),
      run: async (sql, params) => { update = { sql, params }; }, now: () => 'CURRENT_TIMESTAMP',
      all: async () => assert.fail('Pending moves must not be queried when organisational updates are off'),
    },
    './unifiedApi': api, './orgUnits': { create: async () => assert.fail('Must not create organisational units') },
    './settings': { get: async (key, fallback) => fallback }, './notifications': {}, '../util/log': { warn: () => {} },
  };
  const context = { module: { exports: {} }, require: (name) => mocks[name] };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/staffSync'), 'utf8'), context);
  const result = await context.module.exports.syncUser(1, 'person@test', { force: true });
  assert.strictEqual(result.synced, true);
  assert.match(update.sql, /designation = \?/);
  assert.doesNotMatch(update.sql, /staff_rank =|staff_id =|department_name =|college_name =|(?:^|, )org_unit_id =/);
  assert.strictEqual(result.pendingOrgUnitId, 3);
  assert.strictEqual(await context.module.exports.sweepAgedPendingMoves(), 0);
  assert.strictEqual(photoCalls, 0);
  photoEnabled = true;
  await context.module.exports.syncUser(1, 'person@test', { force: true });
  assert.doesNotMatch(update.sql, /avatar =/);
  photoValue = 'data:image/png;base64,example';
  await context.module.exports.syncUser(1, 'person@test', { force: true });
  assert.match(update.sql, /avatar = \?/);
  assert.ok(update.params.includes(photoValue));
});
