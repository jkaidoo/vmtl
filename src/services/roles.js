'use strict';
// Role labels and page-routing helpers. VMTL users hold a single role; Staff are
// "requester-only" and are locked to the Requests area.
const { CAP } = require('./capabilities');

const LABELS = {
  university_transport_officer: 'University Transport Officer',
  schedule_transport_officer: 'Schedule Transport Officer',
  it_admin: 'IT Admin',
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
  if ([...set].some(cap => cap !== CAP.REQUESTS_CREATE)) return false;
  return set.has(CAP.REQUESTS_CREATE) || set.size === 0;
}

// Landing page for a given capability set.
function homePage(caps) {
  if (isRequesterOnly(caps)) return '/dashboard.html';
  return '/dashboard.html';
}

module.exports = { LABELS, roleOptions, isRequesterOnly, homePage };
