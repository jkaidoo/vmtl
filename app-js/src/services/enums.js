'use strict';
// Enum metadata ported from backend/app/Enums/*. Each enum exposes value→label,
// value→colour (semantic token, resolved to styles on the frontend) and an
// options() array for selectors. Helpers mirror the PHP methods used in logic.

function optionsFrom(labels, colors) {
  return Object.keys(labels).map((value) => ({ value, label: labels[value], ...(colors ? { color: colors[value] } : {}) }));
}

const requestStatus = {
  labels: { pending: 'Pending', changes_requested: 'Changes Requested', approved: 'Approved', rejected: 'Rejected', scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No Show' },
  colors: { pending: 'amber', changes_requested: 'purple', approved: 'blue', rejected: 'red', scheduled: 'purple', in_progress: 'green', completed: 'green', cancelled: 'grey', no_show: 'grey' },
  isCancellable: (s) => ['pending', 'changes_requested', 'approved', 'scheduled'].includes(s),
  isEditableByRequester: (s) => ['pending', 'changes_requested'].includes(s),
};
const tripStatus = {
  labels: { scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No Show' },
  colors: { scheduled: 'purple', in_progress: 'green', completed: 'green', cancelled: 'grey', no_show: 'grey' },
};
const vehicleStatus = {
  labels: { available: 'Available', scheduled: 'Scheduled', on_trip: 'On Trip', under_maintenance: 'Under Maintenance', unavailable: 'Unavailable', inactive: 'Inactive' },
  colors: { available: 'green', scheduled: 'purple', on_trip: 'blue', under_maintenance: 'amber', unavailable: 'grey', inactive: 'grey' },
  isAssignable: (s) => ['available', 'scheduled'].includes(s),
};
const driverStatus = {
  labels: { available: 'Available', on_trip: 'On Trip', unavailable: 'Unavailable', on_leave: 'On Leave', inactive: 'Inactive' },
  colors: { available: 'green', on_trip: 'blue', unavailable: 'grey', on_leave: 'amber', inactive: 'grey' },
  isAssignable: (s) => s === 'available',
};
const maintenanceType = {
  labels: { oil_change: 'Oil Change', tyres: 'Tyres', brake_service: 'Brake Service', general_service: 'General Service', engine_repair: 'Engine Repair', electrical_repair: 'Electrical Repair', other: 'Other' },
};
const orgUnitType = {
  labels: { institution: 'Institution', college: 'College', faculty: 'Faculty', directorate: 'Directorate', department: 'Department', unit: 'Unit', office: 'Office' },
};
const roleType = {
  labels: { staff: 'Staff', approver: 'Approver', transport_admin: 'Transport / Admin Officer', supervisor: 'Supervisor', administrator: 'System Administrator', driver: 'Driver' },
};
const approvalAction = { labels: { approved: 'Approved', rejected: 'Rejected', changes_requested: 'Changes Requested' } };

// Vehicle types carry a UI group, typical seats and an animation "motif".
const VEHICLE_TYPES = {
  pickup: { label: 'Pickup', group: 'Pickup', motif: 'pickup', seats: 5 },
  suv_midsize: { label: 'Mid-size SUV', group: 'SUV', motif: 'suv', seats: 5 },
  suv_fullsize: { label: 'Full-size SUV', group: 'SUV', motif: 'suv', seats: 7 },
  saloon: { label: 'Saloon / Sedan', group: 'Car', motif: 'car', seats: 5 },
  van: { label: 'Van', group: 'Bus & Van', motif: 'bus', seats: 15 },
  bus_hiace: { label: 'Hiace Bus (mini)', group: 'Bus & Van', motif: 'bus', seats: 15 },
  bus_coaster: { label: 'Coaster Bus', group: 'Bus & Van', motif: 'bus', seats: 30 },
  bus_large: { label: 'Large Bus / Coach', group: 'Bus & Van', motif: 'bus', seats: 45 },
};
const vehicleType = {
  labelFor: (v) => (v == null || v === '' ? null : (VEHICLE_TYPES[v] ? VEHICLE_TYPES[v].label : v)),
  motifFor: (v) => (VEHICLE_TYPES[v] ? VEHICLE_TYPES[v].motif : 'car'),
  options: () => Object.entries(VEHICLE_TYPES).map(([value, m]) => ({ value, label: m.label, group: m.group, seats: m.seats })),
};

module.exports = {
  requestStatus, tripStatus, vehicleStatus, driverStatus, maintenanceType, orgUnitType, roleType, approvalAction, vehicleType,
  // options() bundle for the /meta endpoint
  options: {
    request_status: optionsFrom(requestStatus.labels, requestStatus.colors),
    trip_status: optionsFrom(tripStatus.labels, tripStatus.colors),
    vehicle_status: optionsFrom(vehicleStatus.labels, vehicleStatus.colors),
    vehicle_type: vehicleType.options(),
    driver_status: optionsFrom(driverStatus.labels, driverStatus.colors),
    role_type: optionsFrom(roleType.labels),
    maintenance_type: optionsFrom(maintenanceType.labels),
    org_unit_type: optionsFrom(orgUnitType.labels),
  },
};
