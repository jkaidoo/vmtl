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
  // System tier — the System section (except Broadcasts, which stays App-Owner only).
  SYSTEM_ADMIN: 'system.admin',
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
  [CAP.SYSTEM_ADMIN]: { label: 'System administration', group: 'System', description: 'Access the System section (App Health, RBAC, Directory Auth, Database, etc.) — everything except Broadcasts.' },
};

function all() { return Object.keys(CATALOG); }

// Default capabilities granted to each role at seed time (mirrors defaultsByRole()).
function defaultsByRole() {
  // A Transport / Admin Officer does everything operational, but nothing under
  // the Administration or System sections.
  const transport = [CAP.REQUESTS_CREATE, CAP.REQUESTS_VIEW_ALL, CAP.REQUESTS_ASSIGN, CAP.REQUESTS_CREATE_GOODWILL, CAP.REQUESTS_CREATE_EXTERNAL,
    CAP.TRIPS_OPERATE, CAP.TRIPS_CORRECT, CAP.VEHICLES_MANAGE, CAP.DRIVERS_MANAGE, CAP.MAINTENANCE_MANAGE, CAP.FUEL_LOG, CAP.ANALYTICS_VIEW, CAP.REPORTS_EXPORT];
  return {
    // System Administrator — every capability (incl. the System tier). The App
    // Owner (is_super_admin) additionally holds the App-Owner-only parts (Broadcasts).
    administrator: all(),
    // Supervisor — oversight of their org unit: view requests, analytics and the
    // audit log, but no editing.
    supervisor: [CAP.REQUESTS_VIEW_ALL, CAP.ANALYTICS_VIEW, CAP.AUDIT_VIEW],
    // Approver — everything a Transport Officer can do, plus approving requests.
    approver: [...transport, CAP.REQUESTS_APPROVE],
    transport_admin: transport,
    staff: [CAP.REQUESTS_CREATE],
    // Driver — operate trips, raise goodwill requests, log fuel.
    driver: [CAP.TRIPS_OPERATE, CAP.REQUESTS_CREATE_GOODWILL, CAP.FUEL_LOG],
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
