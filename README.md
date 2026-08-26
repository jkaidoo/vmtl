# UITS Vehicle Management & Trip Logging System

A secure, responsive internal web application for the University Information
Technology Services (UITS) to manage official vehicles and log trips across the
full lifecycle:

> **Request → Approval → Vehicle/Driver Assignment → Trip Start → Trip Completion → Reporting → Analytics**

Built with a **Laravel 13 (PHP 8.3) REST API** backend and a **React + TypeScript
+ Vite + Tailwind** single-page frontend, backed by **MySQL**.

---

## Table of contents

1. [Architecture](#architecture)
2. [Requirements](#requirements)
3. [Backend setup](#backend-setup)
4. [Frontend setup](#frontend-setup)
5. [Running the application](#running-the-application)
6. [Test credentials](#test-credentials)
7. [API endpoints](#api-endpoints)
8. [Automated tests](#automated-tests)
9. [Feature map](#feature-map)

---

## Architecture

```
vmtl/
├── backend/     Laravel 13 API (PHP 8.3, Sanctum, MySQL)
│   ├── app/
│   │   ├── Enums/            Status enums with labels + semantic colour tokens
│   │   ├── Models/           Eloquent models (soft deletes, casts, relations)
│   │   ├── Services/         Business logic (assignment, trips, availability, analytics)
│   │   ├── Policies/         Authorisation (never in controllers)
│   │   ├── Http/
│   │   │   ├── Controllers/Api/   Thin controllers
│   │   │   ├── Requests/          Form Request validation
│   │   │   ├── Resources/         API response shaping
│   │   │   └── Middleware/        EnsureRole (role guard)
│   │   ├── Notifications/    In-app + email notifications
│   │   └── Support/          AuditLogger, SequenceNumber
│   ├── database/migrations/  12+ tables
│   └── database/seeders/     Roles, departments, users, vehicles, drivers, demo data
│
└── frontend/    React + TypeScript SPA
    └── src/
        ├── components/   Layout, StatusBadge, Modal, Toast, Pagination, UI primitives
        ├── context/      AuthContext, MetaContext
        ├── hooks/        useList (paginated fetch)
        ├── lib/          api client, types, centralised status styling, formatters
        └── pages/        Dashboard, Requests, Trips, Vehicles, Drivers, Maintenance,
                          Analytics, Reports, Audit Logs, Users, Departments, Settings
```

**Security model:** token auth via Laravel Sanctum; every permission enforced
server-side through Policies + a role middleware (the frontend only *hides* what
a role cannot do). All state-changing actions are written to an immutable audit
log. Critical operations (assignment, trip start/complete) run inside database
transactions with row locks to prevent double-booking and race conditions.

---

## Requirements

| Tool     | Version |
|----------|---------|
| PHP      | 8.3+ (with `pdo_mysql`, `mbstring`, `openssl`, `fileinfo`, `zip`, `gd`, `intl`) |
| Composer | 2.x     |
| MySQL    | 8.0+ (9.x works) |
| Node.js  | 20+     |
| npm      | 10+     |

---

## Backend setup

```bash
cd backend

# 1. Install PHP dependencies
composer install

# 2. Environment file (already present as .env; copy from example if needed)
cp .env.example .env      # then edit DB_* values
php artisan key:generate  # only if APP_KEY is empty
```

Configure the database block in `backend/.env`:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=uits_vmtl
DB_USERNAME=root
DB_PASSWORD=
```

Create the database and run migrations + seeders:

```bash
# create the schema
mysql -u root -e "CREATE DATABASE uits_vmtl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# migrate + seed (roles, departments, users, 2 vehicles, 2 drivers, demo history)
php artisan migrate:fresh --seed
```

Alert thresholds (days before expiry) are configurable via `.env` and the
Settings page:

```dotenv
ALERT_INSURANCE_DAYS=30
ALERT_ROADWORTHY_DAYS=30
ALERT_LICENCE_DAYS=30
ALERT_SERVICE_DAYS=30
```

---

## Frontend setup

```bash
cd frontend
npm install
```

The dev server proxies `/api` to `http://127.0.0.1:8000`, so no CORS setup is
needed in development (see `frontend/vite.config.ts`).

---

## Running the application

**Windows quick start:** double-click **`start.bat`** in the project root. It puts
PHP/MySQL/Node on PATH, ensures MySQL is running, launches the Laravel API
(:8000) and the Vite dev server (:5173) in their own windows, and opens the app
in your browser. Close the two windows to stop the servers.

Or run them manually in two terminals:

```bash
# Terminal 1 — backend API on http://127.0.0.1:8000
cd backend
php artisan serve
```

```bash
# Terminal 2 — frontend on http://localhost:5173
cd frontend
npm run dev
```

Then browse to **http://localhost:5173** and sign in.

For a production build of the frontend: `npm run build` (outputs to `frontend/dist`).

---

## Test credentials

All seeded accounts use the password **`password`**.

| Role                | Email                  | Can do |
|---------------------|------------------------|--------|
| System Administrator| `admin@uits.test`      | Everything (users, roles, departments, settings, audit logs) |
| Approver            | `approver@uits.test`   | Review / approve / reject requests |
| Transport Officer   | `transport@uits.test`  | Assign vehicles & drivers, run trips, reports |
| Staff               | `staff@uits.test`      | Create & track own requests |
| Driver              | `driver1@uits.test` · `driver2@uits.test` | Self-service: view & start/end/no-show own assigned trips |

(Additional staff: `ama@uits.test`, `kofi@uits.test`.)

**Driver self-service:** a driver record can be linked to a login account. An
administrator enables it from the driver form ("Self-service login" → email +
password). Drivers get a focused UI (Dashboard + Trips) showing only their own
assigned trips, which they can start, complete, or mark as a no-show from a
phone. Server-side policies still restrict them to their own trips.

---

## API endpoints

All routes are prefixed with `/api` and (except login) require a
`Authorization: Bearer <token>` header.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/login` · `/logout` · GET `/me` | Authentication |
| GET | `/meta` | Enum options, roles, departments (dropdowns + status colours) |
| GET | `/dashboard` | KPIs, today's schedule, vehicle board, alerts |
| GET/POST | `/vehicle-requests` | List / create requests |
| GET/PUT | `/vehicle-requests/{id}` | Show / update |
| POST | `/vehicle-requests/{id}/approve` `/reject` `/cancel` | Workflow actions |
| GET | `/vehicle-requests/{id}/assignment-options` | Available vehicles/drivers for the window |
| POST | `/vehicle-requests/{id}/assign` | Assign vehicle + driver (creates trip) |
| GET | `/trips` · `/trips/{id}` | Trips |
| POST | `/trips/{id}/start` `/complete` `/no-show` `/correct-odometer` | Trip lifecycle |
| GET/POST/PUT/DELETE | `/vehicles` `/drivers` | Fleet management |
| GET | `/vehicles/{id}/trips` · `/drivers/{id}/trips` | History reports |
| GET/POST/PUT/DELETE | `/maintenance-records` | Maintenance |
| GET | `/analytics` | Aggregated analytics (filterable) |
| GET | `/reports` · `/reports/export?format=csv\|xlsx\|pdf` | Reports & exports |
| GET | `/audit-logs` | Audit trail (admin) |
| GET/POST/PUT/DELETE | `/users` `/departments` | Administration (admin) |
| GET/PUT | `/settings` | System settings (admin) |
| GET | `/notifications`, POST `/notifications/read-all` | In-app notifications |

---

## Automated tests

Tests run against a dedicated MySQL database `uits_vmtl_test`.

```bash
mysql -u root -e "CREATE DATABASE uits_vmtl_test CHARACTER SET utf8mb4;"
cd backend
php artisan test
```

Coverage (feature tests):

- **AuthTest** — login success/failure, inactive accounts, `/me`, guest rejection.
- **RequestWorkflowTest** — full lifecycle (create → approve → assign → start →
  complete), request validation, rejection-requires-reason.
- **DataIntegrityTest** — overlapping-assignment prevention, odometer validation,
  cannot-complete-unstarted-trip, monotonic odometer.
- **AuthorizationTest** — role enforcement (staff blocked from audit logs, user
  management and approvals; staff see only their own requests).

---

## Feature map

| Spec area | Where |
|-----------|-------|
| Role-based access control | `EnsureRole` middleware + `app/Policies/*` |
| Request validation (§7) | `StoreVehicleRequestRequest` |
| Approval workflow (§8) | `VehicleRequestController@approve/reject` |
| Assignment + conflict prevention (§9, §33) | `AssignmentService`, `AvailabilityService` |
| Trip start/end + odometer rules (§13–§15) | `TripService` |
| Dashboard / vehicle board (§16, §17) | `DashboardController`, `Dashboard.tsx` |
| Analytics (§18, §19) | `AnalyticsService`, `Analytics.tsx` (Recharts) |
| Reports + CSV/Excel/PDF export (§20, §21) | `ReportController`, `TripsExport`, `reports/trips.blade.php` |
| Audit trail (§22) | `AuditLogger`, `audit_logs` table |
| Notifications (§23) | `app/Notifications/*`, `NotificationBell.tsx` |
| Maintenance + alerts (§24, §25) | `MaintenanceRecordController`, `MaintenanceAlertService` |
| Centralised status colours (§30) | `Enums` colour tokens → `lib/statusStyles.ts` |
| Security (§31) / data integrity (§32) | Sanctum, policies, transactions, validation |

### KNUST UITS design language

The frontend follows the **KNUST UITS Application Standard** (`MASTER_DOC.md`):

- **Design tokens** (`src/index.css`): the KNUST palette as theme-aware CSS
  variables — brand green `#009540` (light) / `#16b85c` (dark), neutral greys,
  hairline borders, `--r-*` radii, Segoe UI stack — mapped onto Tailwind
  utilities so every surface is theme-aware.
- **Theme** (`src/lib/theme.ts`): Light / Dark / System with a no-flash
  `<head>` script and a top-bar toggle; `theme_color`/manifest for PWA.
- **Shell** (`Layout.tsx`): white side nav with capability-grouped sections and
  a green active state, translucent 56px top bar, logo, footer.
- **KNUST logo** (`public/knust-logo.png`) in the sidebar, login, favicon and
  PWA icons.
- **Settings** (`Settings.tsx`) follows the Part II admin model: deep-linkable
  tabs (`?tab=`) — General (independent per-section saves), Staff accounts,
  Departments, Roles & RBAC catalog, Backup & export (JSON snapshot with
  redacted secrets).

### Capability RBAC & Administration (spec Part II)

Authorization is **capability-based**, not just role-based. 16 granular
capabilities (`app/Support/Capabilities.php`) are granted to roles via the
`role_capabilities` table and enforced by policies + `cap:` route middleware —
the UI is never the boundary. A single **break-glass System Administrator**
(`is_super_admin`, seeded on `admin@uits.test`) implicitly holds every
capability and exclusively reaches the deep admin tier.

**Administration menus**
- **Users · Departments · Settings · Audit Logs** — regular administrators (by capability).
- **RBAC** — an editable capability × role matrix (`super`); grants/revocations take effect immediately.
- **App Health** — sign-in success/failure counts, recent events and a parsed error log.
- **System Controls** — feature flags, notification/retention settings, maintenance mode (independent saves).
- **Directory Authentication** — LDAP/AD config with a write-only bind password.
- **Database Connections** — active connection, size and per-table row counts (secrets redacted).
- **Documentation** — in-app viewer (README, technical overview, user guide, security assessment).
- **Codebase Guide** — file-by-file architecture reference.
- **FAQs** (Help) — capability-scoped, searchable.

The break-glass pages are gated by the `super` middleware and the nav by
`isSuperAdmin`. Hardware/IT-CRM-specific menus from the standard are omitted as
not applicable to a vehicle app.

### PWA & Web Push (spec §I-12)

- **Service worker** (`public/sw.js`): network-first for same-origin GETs,
  offline app-shell fallback, **`/api/*` never cached**, stale caches purged on
  activate, and **no silent update** — a "new version — Refresh" prompt
  (`PwaManager.tsx`) posts `SKIP_WAITING` and reloads.
- **Web Push (VAPID)**: `minishlink/web-push` on the backend
  (`WebPushService` + `WebPushChannel`, added to every notification's channels);
  `push_subscriptions` table; endpoints `GET /push/vapid-public-key`,
  `POST /push/subscribe` · `/push/unsubscribe`. The bell offers **Enable device
  notifications**; the SW shows the notification, focuses/opens on click, and
  updates the app-icon badge. iOS push requires a Home-Screen install (16.4+).
- **Boot splash** (`index.html`): themed, KNUST logo + name + bouncing green
  ball, removed once the app mounts.
- **Manifest** (`public/manifest.webmanifest`): standalone, `theme_color`
  `#009540`, KNUST icons — installable on Android/desktop/iOS.

**VAPID setup:** keys live in `backend/.env` (`VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Generate a fresh pair with:
`php -r "require 'vendor/autoload.php'; print_r(Minishlink\WebPush\VAPID::createVapidKeys());"`
(On Windows set `OPENSSL_CONF` to a valid `openssl.cnf` for EC signing — see `.env`.)

Out of scope for a vehicle app (documented in the standard but not applicable):
LDAP/AD directory auth, SQLite→Postgres migration tooling, in-app codebase guide.
```
