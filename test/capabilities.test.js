'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { CAP, defaultsByRole, all } = require('../src/services/capabilities');

test('role capabilities match the defined hierarchy', () => {
  const d = defaultsByRole();

  // Supervisor: OU oversight + audit, no editing.
  assert.deepStrictEqual(new Set(d.supervisor), new Set([CAP.REQUESTS_VIEW_ALL, CAP.ANALYTICS_VIEW, CAP.AUDIT_VIEW]));

  // Transport Officer: all operations, nothing administrative or system-level.
  assert.ok(d.transport_admin.includes(CAP.TRIPS_OPERATE));
  assert.ok(d.transport_admin.includes(CAP.REQUESTS_ASSIGN));
  for (const forbidden of [CAP.USERS_MANAGE, CAP.ROLES_MANAGE, CAP.DEPARTMENTS_MANAGE, CAP.AUDIT_VIEW, CAP.REQUESTS_APPROVE, CAP.SYSTEM_ADMIN]) {
    assert.ok(!d.transport_admin.includes(forbidden), `transport_admin must not have ${forbidden}`);
  }

  // Approver = everything a Transport Officer does, plus approvals.
  assert.ok(d.approver.includes(CAP.REQUESTS_APPROVE));
  for (const cap of d.transport_admin) assert.ok(d.approver.includes(cap), `approver should include ${cap}`);

  // Driver: operate trips, raise goodwill, log fuel.
  assert.deepStrictEqual(new Set(d.driver), new Set([CAP.TRIPS_OPERATE, CAP.REQUESTS_CREATE_GOODWILL, CAP.FUEL_LOG]));

  // System Administrator (administrator role) holds every capability incl. system.admin.
  assert.deepStrictEqual(new Set(d.administrator), new Set(all()));
  assert.ok(d.administrator.includes(CAP.SYSTEM_ADMIN));
});

test('settings.manage capability was removed', () => {
  assert.ok(!all().includes('settings.manage'));
  assert.strictEqual(CAP.SETTINGS_MANAGE, undefined);
});
