// Domain types mirroring the Laravel API resources.

export type RoleSlug = 'staff' | 'approver' | 'transport_admin' | 'administrator' | 'driver'

export interface Role {
  id: number
  slug: RoleSlug
  name: string
}

export interface Department {
  id: number
  name: string
  code: string | null
  active?: boolean
}

export interface OrgUnitRef {
  id: number
  name: string
  type: string
}

export interface OrgUnitOption {
  id: number
  name: string
  type: string
  type_label: string
  parent_id: number | null
  depth: number
}

export interface OrgUnit {
  id: number
  name: string
  code: string | null
  type: string
  type_label: string
  parent_id: number | null
  path: string | null
  depth: number
  active?: boolean
  vehicles_count?: number
  drivers_count?: number
  users_count?: number
}

export interface User {
  id: number
  name: string
  email: string
  phone: string | null
  active: boolean
  avatar?: string | null
  role?: Role | null
  role_slug: RoleSlug | null
  is_super_admin?: boolean
  capabilities?: string[]
  department?: Department | null
  department_id: number | null
  org_unit_id?: number | null
  org_unit?: OrgUnitRef | null
  created_at?: string
}

export interface Vehicle {
  id: number
  vehicle_number: string
  registration_number: string
  make: string | null
  model: string | null
  year: number | null
  vehicle_type: string | null
  colour: string | null
  capacity: number
  current_odometer: number
  status: string
  status_label: string
  status_color: string
  acquisition_date: string | null
  insurance_expiry: string | null
  roadworthy_expiry: string | null
  service_interval_km: number | null
  last_service_date: string | null
  last_service_odometer: number | null
  notes: string | null
  active: boolean
  org_unit_id?: number | null
  org_unit?: OrgUnitRef | null
  active_trip?: Trip | null
}

export interface Driver {
  id: number
  user_id: number | null
  name: string
  employee_id: string | null
  phone: string | null
  licence_number: string | null
  licence_expiry: string | null
  status: string
  status_label: string
  status_color: string
  notes: string | null
  active: boolean
  org_unit_id?: number | null
  org_unit?: OrgUnitRef | null
  has_account?: boolean
  account_email?: string | null
}

export interface RequestApproval {
  id: number
  action: 'approved' | 'rejected' | 'changes_requested'
  action_label: string
  comment: string | null
  approver?: User
  approved_at: string | null
  created_at: string
}

export interface VehicleRequest {
  id: number
  request_number: string
  requester?: User
  requester_id: number
  department?: Department | null
  department_id: number | null
  department_label: string | null
  org_unit_id?: number | null
  org_unit?: OrgUnitRef | null
  travel_date: string
  requested_start_time: string
  expected_end_time: string
  destination: string
  additional_destination: string | null
  purpose: string
  passenger_count: number
  contact_number: string | null
  special_requirements: string | null
  remarks: string | null
  status: string
  status_label: string
  status_color: string
  is_cancellable: boolean
  is_goodwill?: boolean
  goodwill_reason?: string | null
  is_external?: boolean
  external_org?: string | null
  expected_duration_days?: number | null
  start_odometer?: number | null
  approvals?: RequestApproval[]
  latest_approval?: RequestApproval | null
  trip?: Trip | null
  created_at: string
}

export interface Trip {
  id: number
  trip_number: string
  vehicle_request_id: number
  vehicle?: Vehicle
  vehicle_id: number
  driver?: Driver
  driver_id: number
  request?: VehicleRequest
  scheduled_start: string
  scheduled_end: string
  actual_start: string | null
  actual_end: string | null
  starting_odometer: number | null
  ending_odometer: number | null
  distance: number | null
  duration_minutes: number | null
  status: string
  status_label: string
  status_color: string
  start_notes: string | null
  end_notes: string | null
  admin_remarks: string | null
  started_by?: User | null
  ended_by?: User | null
  stops?: TripStop[]
  created_at: string
}

export interface TripStop {
  id: number
  destination: string
  note: string | null
  status: 'pending' | 'accepted' | 'declined'
  requested_by: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export interface MaintenanceRecord {
  id: number
  vehicle_id: number
  vehicle?: Vehicle
  maintenance_type: string
  maintenance_type_label: string
  service_date: string
  odometer: number | null
  description: string | null
  cost: string | null
  service_provider: string | null
  next_service_date: string | null
  next_service_odometer: number | null
  remarks: string | null
  created_at: string
}

export interface FuelLog {
  id: number
  vehicle_id: number
  vehicle?: Vehicle
  driver_id: number | null
  driver?: Driver | null
  purchase_date: string
  odometer: number
  previous_odometer: number | null
  distance_since_last: number | null
  litres: string
  price_per_litre: string
  total_cost: string
  km_per_litre: number | null
  fuel_type: string | null
  station: string | null
  notes: string | null
  recorded_by?: User | null
  created_at: string
}

export interface AvailabilityBooking {
  trip_number?: string
  destination: string | null
  start: string
  end: string
  status: string
}

export interface AvailabilityUnit {
  id: number
  label: string
  detail: string | null
  capacity?: number
  status: string
  status_label: string
  status_color: string
  on_trip_now: boolean
  current_trip: { trip_number: string; destination: string | null; until: string } | null
  free_now: boolean
  bookings: AvailabilityBooking[]
}

export interface AvailabilityOverview {
  generated_at: string
  vehicles: AvailabilityUnit[]
  drivers: AvailabilityUnit[]
}

export interface AvailabilityCheck {
  available_vehicles: number
  available_drivers: number
  is_bookable: boolean
  conflicts: {
    vehicle: string | null
    driver: string | null
    destination: string | null
    start: string
    end: string
    status: string
  }[]
}

export interface AuditLog {
  id: number
  user?: User | null
  user_id: number | null
  action: string
  description: string | null
  entity_type: string | null
  entity_id: number | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface EnumOption {
  value: string
  label: string
  color?: string
}

export interface Meta {
  roles: Role[]
  departments: Department[]
  org_units: OrgUnitOption[]
  enums: {
    request_status: EnumOption[]
    trip_status: EnumOption[]
    vehicle_status: EnumOption[]
    driver_status: EnumOption[]
    role_type: EnumOption[]
    maintenance_type: EnumOption[]
    org_unit_type: EnumOption[]
  }
}

export interface Paginated<T> {
  data: T[]
  meta?: {
    current_page: number
    last_page: number
    per_page: number
    total: number
  }
  links?: unknown
}

export interface AppNotification {
  id: string
  data: {
    type: string
    title: string
    message: string
    [key: string]: unknown
  }
  read_at: string | null
  created_at: string
}
