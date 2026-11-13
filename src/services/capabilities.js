'use strict';
// The granular capability catalog (ported from backend/app/Support/Capabilities.php).
// Capabilities are grouped for the RBAC UI and mapped to default roles at seed time.

const CAP = {
  // Request lifecycle
  REQUESTS_CREATE: 'requests.create',
  REQUESTS_VIEW_ALL: 'requests.view_all',
  REQUESTS_APPROVE: 'requests.approve',
  REQUESTS_ASSIGN: 'requests.assign',
  REQUESTS_CREATE_GOODWILL: 'requests.create_goodwill',
  REQUESTS_CREATE_EXTERNAL: 'requests.create_external',
  // Trips
  TRIPS_OPERATE: 'trips.operate',
  TRIPS_CORRECT: 'trips.correct',
  // Fleet
  VEHICLES_MANAGE: 'vehicles.manage',
  DRIVERS_MANAGE: 'drivers.manage',
  MAINTENANCE_MANAGE: 'maintenance.manage',
  FUEL_LOG: 'fuel.log',
  // Insights
  ANALYTICS_VIEW: 'analytics.view',
  REPORTS_EXPORT: 'reports.export',
  // Administration
  USERS_MANAGE: 'users.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  ROLES_MANAGE: 'roles.manage',
  AUDIT_VIEW: 'audit.view',
};

// key -> { label, group, description } (order defines RBAC-screen order).
const CATALOG = {
  [CAP.REQUESTS_CREATE]: { label: 'Create requests', group: 'Requests', description: 'Submit vehicle requests.' },
  [CAP.REQUESTS_VIEW_ALL]: { label: 'View all requests', group: 'Requests', description: 'See every request, not just their own.' },
  [CAP.REQUESTS_APPROVE]: { label: 'Approve / reject requests', group: 'Requests', description: 'Decide on pending requests.' },
  [CAP.REQUESTS_ASSIGN]: { label: 'Assign vehicle + driver', group: 'Requests', description: 'Schedule an approved request.' },
  [CAP.REQUESTS_CREATE_GOODWILL]: { label: 'Raise goodwill requests', group: 'Requests', description: 'Driver/officer goodwill trip requests (need an explanation).' },
  [CAP.REQUESTS_CREATE_EXTERNAL]: { label: 'Log external travel', group: 'Requests', description: 'Vehicle requests from other university arms for extended trips.' },
  [CAP.TRIPS_OPERATE]: { label: 'Operate trips', group: 'Trips', description: 'Start / end / no-show any trip.' },
  [CAP.TRIPS_CORRECT]: { label: 'Correct odometer', group: 'Trips', description: 'Administratively correct trip readings.' },
  [CAP.VEHICLES_MANAGE]: { label: 'Manage vehicles', group: 'Fleet', description: 'Add, edit and retire vehicles.' },
  [CAP.DRIVERS_MANAGE]: { label: 'Manage drivers', group: 'Fleet', description: 'Add, edit and retire drivers.' },
  [CAP.MAINTENANCE_MANAGE]: { label: 'Manage maintenance', group: 'Fleet', description: 'Record maintenance and service.' },
  [CAP.FUEL_LOG]: { label: 'Log fuel purchases', group: 'Fleet', description: 'Record fuel purchases (odometer, litres, price).' },
  [CAP.ANALYTICS_VIEW]: { label: 'View analytics', group: 'Insights', description: 'Access fleet analytics.' },
  [CAP.REPORTS_EXPORT]: { label: 'Reports & exports', group: 'Insights', description: 'Run and export reports.' },
  [CAP.USERS_MANAGE]: { label: 'Manage users', group: 'Administration', description: 'Create and manage accounts.' },
  [CAP.DEPARTMENTS_MANAGE]: { label: 'Manage departments', group: 'Administration', description: 'Maintain organisational units.' },
  [CAP.ROLES_MANAGE]: { label: 'Manage roles (RBAC)', group: 'Administration', description: 'Edit role capabilities.' },
  [CAP.AUDIT_VIEW]: { label: 'View audit logs', group: 'Administration', description: 'Read the audit trail.' },
};

function all() { return Object.keys(CATALOG); }

// Default capabilities granted to each role at seed time (mirrors defaultsByRole()).
function defaultsByRole() {
  const everything = all();
  return {
    administrator: everything,
    // Supervisor: everything EXCEPT the system tier (audit/departments/roles).
    supervisor: everything.filter((c) => ![CAP.AUDIT_VIEW, CAP.DEPARTMENTS_MANAGE, CAP.ROLES_MANAGE].includes(c)),
    approver: [CAP.REQUESTS_CREATE, CAP.REQUESTS_VIEW_ALL, CAP.REQUESTS_APPROVE, CAP.REQUESTS_CREATE_EXTERNAL, CAP.ANALYTICS_VIEW, CAP.VEHICLES_MANAGE, CAP.DRIVERS_MANAGE, CAP.FUEL_LOG],
    transport_admin: [CAP.REQUESTS_CREATE, CAP.REQUESTS_VIEW_ALL, CAP.REQUESTS_ASSIGN, CAP.REQUESTS_CREATE_GOODWILL, CAP.REQUESTS_CREATE_EXTERNAL, CAP.TRIPS_OPERATE, CAP.VEHICLES_MANAGE, CAP.DRIVERS_MANAGE, CAP.MAINTENANCE_MANAGE, CAP.FUEL_LOG, CAP.ANALYTICS_VIEW, CAP.REPORTS_EXPORT],
    staff: [CAP.REQUESTS_CREATE],
    driver: [CAP.REQUESTS_CREATE_GOODWILL, CAP.FUEL_LOG],
  };
}

// Grouped catalog for the RBAC UI: [{ group, caps:[{key,label,description}] }]
function grouped() {
  const groups = [];
  for (const key of all()) {
    const meta = CATALOG[key];
    let g = groups.find((x) => x.group === meta.group);
    if (!g) { g = { group: meta.group, caps: [] }; groups.push(g); }
    g.caps.push({ key, label: meta.label, description: meta.description });
  }
  return groups;
}

module.exports = { CAP, CATALOG, all, defaultsByRole, grouped };
