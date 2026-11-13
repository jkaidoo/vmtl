'use strict';
// Isolated in-memory database so the suite never touches the dev data.
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert');
const orgUnits = require('../src/services/orgUnits');
const orgScope = require('../src/services/orgScope');

test('subtree, path and visible/serving scoping', async () => {
  const college = await orgUnits.create({ name: 'College of Science', type: 'college', parent_id: null });
  const dept = await orgUnits.create({ name: 'Computer Science', type: 'department', parent_id: college });
  const unit = await orgUnits.create({ name: 'Systems Lab', type: 'unit', parent_id: dept });
  const sibling = await orgUnits.create({ name: 'Other College', type: 'college', parent_id: null });

  const sub = await orgScope.subtreeIds(college);
  assert.ok(sub.includes(college) && sub.includes(dept) && sub.includes(unit));
  assert.ok(!sub.includes(sibling), 'a sibling tree must not be in the subtree');

  assert.deepStrictEqual(await orgScope.pathIds(unit), [college, dept, unit]);

  // A user scoped to the college can see its whole subtree.
  const visible = await orgScope.visibleOrgUnitIds({ org_unit_id: college });
  assert.ok(visible.includes(dept) && visible.includes(unit));
  assert.ok(!visible.includes(sibling));

  // Super admin is unrestricted; a user with no unit sees only unassigned records.
  assert.strictEqual(await orgScope.visibleOrgUnitIds({ is_super_admin: true }), null);
  assert.deepStrictEqual(await orgScope.visibleOrgUnitIds({ org_unit_id: null }), []);
});
