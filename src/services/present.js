'use strict';
// Row → client DTO mappers (port the Laravel API Resources). Mappers accept a
// plain row; rows may carry joined alias columns (e.g. requester_name,
// org_unit_name) which are folded into nested objects when present.
const enums = require('./enums');

const bool = (v) => !!v;
const label = (map, v) => (v == null ? null : (map[v] || v));
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

function orgUnitMini(row, prefix = 'org_unit') {
  const id = row[`${prefix}_id`];
  if (!id || !row[`${prefix}_name`]) return id ? { id } : null;
  return { id, name: row[`${prefix}_name`], type: row[`${prefix}_type`] || null };
}

function vehicle(v) {
  if (!v) return null;
  return {
    id: v.id, vehicle_number: v.vehicle_number, registration_number: v.registration_number,
    make: v.make, model: v.model, year: v.year,
    vehicle_type: v.vehicle_type,
    vehicle_type_label: enums.vehicleType.labelFor(v.vehicle_type),
    vehicle_type_motif: enums.vehicleType.motifFor(v.vehicle_type),
    colour: v.colour, capacity: v.capacity, current_odometer: v.current_odometer,
    status: v.status, status_label: label(enums.vehicleStatus.labels, v.status), status_color: enums.vehicleStatus.colors[v.status] || 'grey',
    acquisition_date: dateOnly(v.acquisition_date), insurance_expiry: dateOnly(v.insurance_expiry),
    roadworthy_expiry: dateOnly(v.roadworthy_expiry), service_interval_km: v.service_interval_km,
    last_service_date: dateOnly(v.last_service_date), last_service_odometer: v.last_service_odometer,
    notes: v.notes, active: bool(v.active), org_unit_id: v.org_unit_id, org_unit: orgUnitMini(v),
    active_trip: v.active_trip || undefined, created_at: v.created_at,
  };
}

function driver(d) {
  if (!d) return null;
  return {
    id: d.id, user_id: d.user_id, name: d.name, employee_id: d.employee_id, phone: d.phone,
    licence_number: d.licence_number, licence_expiry: dateOnly(d.licence_expiry),
    status: d.status, status_label: label(enums.driverStatus.labels, d.status), status_color: enums.driverStatus.colors[d.status] || 'grey',
    notes: d.notes, active: bool(d.active), org_unit_id: d.org_unit_id, org_unit: orgUnitMini(d),
    has_account: d.user_id != null, account_email: d.account_email, created_at: d.created_at,
  };
}

function approval(a) {
  if (!a) return null;
  return {
    id: a.id, action: a.action, action_label: label(enums.approvalAction.labels, a.action),
    comment: a.comment, approved_at: a.approved_at,
    approver: a.approver_name ? { id: a.approver_id, name: a.approver_name } : (a.approver_id ? { id: a.approver_id } : null),
    created_at: a.created_at,
  };
}

function requesterMini(row) {
  if (!row.requester_id) return null;
  return { id: row.requester_id, name: row.requester_name || null, email: row.requester_email || null, role: row.requester_role ? { slug: row.requester_role } : null };
}

function request(r, { approvals, trip } = {}) {
  if (!r) return null;
  return {
    id: r.id, request_number: r.request_number,
    requester: requesterMini(r), requester_id: r.requester_id,
    org_unit_id: r.org_unit_id, org_unit: orgUnitMini(r),
    department_label: r.is_goodwill ? 'Goodwill' : (r.org_unit_name || null),
    travel_date: dateOnly(r.travel_date), requested_start_time: r.requested_start_time, expected_end_time: r.expected_end_time,
    destination: r.destination, additional_destination: r.additional_destination, purpose: r.purpose,
    passenger_count: r.passenger_count, contact_number: r.contact_number,
    special_requirements: r.special_requirements, remarks: r.remarks,
    status: r.status, status_label: label(enums.requestStatus.labels, r.status), status_color: enums.requestStatus.colors[r.status] || 'grey',
    is_cancellable: enums.requestStatus.isCancellable(r.status),
    is_goodwill: bool(r.is_goodwill), goodwill_reason: r.goodwill_reason,
    is_external: bool(r.is_external), external_org: r.external_org,
    expected_duration_days: r.expected_duration_days, start_odometer: r.start_odometer,
    approvals: approvals ? approvals.map(approval) : undefined,
    trip: trip || undefined,
    created_at: r.created_at,
  };
}

function trip(t, { vehicle: v, driver: d, request: req, stops } = {}) {
  if (!t) return null;
  return {
    id: t.id, trip_number: t.trip_number, vehicle_request_id: t.vehicle_request_id,
    vehicle: v !== undefined ? vehicle(v) : undefined, vehicle_id: t.vehicle_id,
    driver: d !== undefined ? driver(d) : undefined, driver_id: t.driver_id,
    request: req !== undefined ? req : undefined,
    scheduled_start: t.scheduled_start, scheduled_end: t.scheduled_end,
    actual_start: t.actual_start, actual_end: t.actual_end,
    starting_odometer: t.starting_odometer, ending_odometer: t.ending_odometer,
    distance: t.distance, duration_minutes: t.duration_minutes,
    status: t.status, status_label: label(enums.tripStatus.labels, t.status), status_color: enums.tripStatus.colors[t.status] || 'grey',
    start_notes: t.start_notes, end_notes: t.end_notes, admin_remarks: t.admin_remarks,
    start_checklist: t.start_checklist ? (() => { try { return JSON.parse(t.start_checklist); } catch (_) { return null; } })() : null,
    started_by: t.started_by_name ? { id: t.started_by, name: t.started_by_name } : undefined,
    ended_by: t.ended_by_name ? { id: t.ended_by, name: t.ended_by_name } : undefined,
    stops: stops || undefined,
    created_at: t.created_at,
  };
}

function fuelLog(f) {
  if (!f) return null;
  const distance = f.previous_odometer == null ? null : Math.max(0, f.odometer - f.previous_odometer);
  const litres = Number(f.litres);
  const kmPerLitre = (distance == null || litres <= 0) ? null : Math.round((distance / litres) * 1000) / 1000;
  return {
    id: f.id, vehicle_id: f.vehicle_id, vehicle: f.vehicle_number ? { id: f.vehicle_id, vehicle_number: f.vehicle_number } : undefined,
    driver_id: f.driver_id, driver: f.driver_name ? { id: f.driver_id, name: f.driver_name } : undefined,
    purchase_date: f.purchase_date, odometer: f.odometer, previous_odometer: f.previous_odometer,
    distance_since_last: distance, litres: f.litres, price_per_litre: f.price_per_litre, total_cost: f.total_cost,
    km_per_litre: kmPerLitre, fuel_type: f.fuel_type, station: f.station, notes: f.notes,
    recorded_by: f.recorded_by_name ? { id: f.recorded_by, name: f.recorded_by_name } : undefined, created_at: f.created_at,
  };
}

function maintenance(m) {
  if (!m) return null;
  return {
    id: m.id, vehicle_id: m.vehicle_id, vehicle: m.vehicle_number ? { id: m.vehicle_id, vehicle_number: m.vehicle_number } : undefined,
    maintenance_type: m.maintenance_type, maintenance_type_label: require('./enums').maintenanceType.labels[m.maintenance_type] || m.maintenance_type,
    service_date: dateOnly(m.service_date), odometer: m.odometer, description: m.description, cost: m.cost,
    service_provider: m.service_provider, next_service_date: dateOnly(m.next_service_date), next_service_odometer: m.next_service_odometer,
    remarks: m.remarks, recorded_by: m.recorded_by_name ? { id: m.recorded_by, name: m.recorded_by_name } : undefined, created_at: m.created_at,
  };
}

function user(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, active: bool(u.active), avatar: u.avatar || null,
    role: u.role_slug ? { id: u.role_id, slug: u.role_slug, name: u.role_name } : null,
    role_slug: u.role_slug || null, is_super_admin: bool(u.is_super_admin),
    directory_provider: u.directory_provider, last_login_at: u.last_login_at,
    department: u.department_name ? { id: u.department_id, name: u.department_name } : null, department_id: u.department_id,
    org_unit_id: u.org_unit_id, org_unit: orgUnitMini(u), created_at: u.created_at,
    // Unified API staff enrichment (null for local accounts).
    user_type: (u.role_slug || bool(u.is_super_admin)) ? 'stakeholder' : 'client',
    staff_id: u.staff_id || null, staff_type: u.staff_type || null, staff_rank: u.staff_rank || null,
    designation: u.designation || null, unified_synced_at: u.unified_synced_at || null,
    pending_org_unit_id: u.pending_org_unit_id || null, can_drive: bool(u.can_drive),
  };
}

function orgUnit(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, code: u.code, type: u.type,
    type_label: require('./enums').orgUnitType.labels[u.type] || u.type,
    parent_id: u.parent_id, path: u.path,
    depth: u.path ? Math.max(0, (u.path.match(/\//g) || []).length - 2) : 0,
  };
}

module.exports = { vehicle, driver, approval, request, trip, fuelLog, maintenance, user, orgUnit };
