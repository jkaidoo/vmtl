'use strict';
// Role labels and page-routing helpers. VMTL users hold a single role; Staff are
// "requester-only" and are locked to the Requests area.
const { CAP } = require('./capabilities');

const LABELS = {
  staff: 'Staff',
  approver: 'Approver',
  transport_admin: 'Transport / Admin Officer',
  supervisor: 'Supervisor',
  administrator: 'System Administrator',
  driver: 'Driver',
};

function roleOptions() { return Object.entries(LABELS).map(([value, label]) => ({ value, label })); }

// A requester-only user (Staff) may only reach the Requests area.
function isRequesterOnly(caps) {
  const set = new Set(caps);
  if (set.has(CAP.REQUESTS_VIEW_ALL) || set.has(CAP.ANALYTICS_VIEW) || set.has(CAP.TRIPS_OPERATE) || set.has(CAP.VEHICLES_MANAGE) || set.has(CAP.USERS_MANAGE)) return false;
  return set.has(CAP.REQUESTS_CREATE) || set.size === 0;
}

// Landing page for a given capability set.
function homePage(caps) {
  if (isRequesterOnly(caps)) return '/dashboard.html';
  return '/dashboard.html';
}

module.exports = { LABELS, roleOptions, isRequesterOnly, homePage };
