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
