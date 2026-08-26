# UITS Vehicle Management & Trip Logging — Handoff

This document is the fast on-ramp for anyone taking over the project. It covers
how to run it, how it's built, what's implemented, credentials, and the sharp
edges to watch for. Pair it with **[README.md](README.md)** (feature-level
detail) and the in-app **Documentation** and **Codebase Guide** pages (visible to
the System Administrator).

---

## 1. What this is

An internal web app for **KNUST UITS** to manage official vehicles and the full
trip lifecycle:

```
Request → Approval → Vehicle/Driver Assignment → Trip Start → Completion → Reporting → Analytics
```

It follows the **KNUST UITS Application Standard** (design tokens, capability
RBAC, break-glass admin tier, PWA). Built as a Laravel API + React SPA.

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Backend | Laravel 13, PHP 8.3, MySQL 9 (8+ compatible), Sanctum token auth |
| Backend libs | `barryvdh/laravel-dompdf`, `maatwebsite/excel`, `minishlink/web-push` |
| Frontend | React 19 + TypeScript + Vite, Tailwind CSS v4, React Router, Recharts |
| Frontend libs | axios, react-hook-form + zod, lucide-react, date-fns, clsx |
| PWA | service worker (network-first), Web Push (VAPID), installable manifest |

**Repo layout**

```
vmtl/
├─ start.bat            # one-click launcher (Windows) — starts both servers
├─ README.md            # feature documentation
├─ HANDOFF.md           # this file
├─ knust-logo.png       # brand logo (also copied to frontend/public/)
├─ backend/             # Laravel API
└─ frontend/            # React SPA (Vite)
```

---

## 3. Running it locally

### Prerequisites (already installed on the original dev machine)
- PHP 8.3 (`C:\tools\php83`), Composer, MySQL (`C:\tools\mysql`), Node 20+.
- MySQL running with a database named **`uits_vmtl`** (root, no password by default).

### Quick start (Windows)
Double-click **`start.bat`** in the repo root. It puts PHP/MySQL/Node on PATH,
ensures MySQL is up, launches the Laravel API (`:8000`) and Vite (`:5173`) in
their own windows, and opens the browser.

### Manual
```bash
# Backend
cd backend
composer install
cp .env.example .env   # then set DB + the VAPID/OPENSSL keys (see §6)
php artisan key:generate
php artisan migrate:fresh --seed
php artisan serve --host=127.0.0.1 --port=8000

# Frontend (second terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api → :8000)
```

The Vite dev server proxies `/api` to the backend, so there are no CORS issues
in development. In production, build the frontend (`npm run build`) and serve
`frontend/dist` behind the same origin as the API (or configure `config/cors.php`).

---

## 4. Test credentials (seeded)

Password for all: **`password`**

| Role | Email | Notes |
|---|---|---|
| System Administrator | `admin@uits.test` | **break-glass super admin** — sees the deep admin tier |
| Approver | `approver@uits.test` | approves; can also manage fleet |
| Transport Officer | `transport@uits.test` | assigns, runs trips, goodwill |
| Staff | `staff@uits.test` | requests only (locked to Requests area) |
| Driver | `driver1@uits.test`, `driver2@uits.test` | self-service; own trips + goodwill |

Additional staff: `ama@uits.test`, `kofi@uits.test`.

---

## 5. Roles & capability RBAC

Authorization is **capability-based**, enforced server-side (policies +
`cap:`/`super` route middleware — the UI is never the boundary).

- 19 granular capabilities live in `backend/app/Support/Capabilities.php`
  (incl. `requests.create_external` and `fuel.log`).
- Roles → capabilities are stored in the `role_capabilities` table and are
  **editable at runtime** via the RBAC screen (super admin only).
- The **break-glass System Administrator** is `users.is_super_admin` (seeded on
  `admin@uits.test`); they implicitly hold every capability and are the only
  principal for App Health, RBAC, System Controls, Directory Auth, Database
  Connections, Documentation, and the Codebase Guide.
- **Staff / requester-only** users (`User::isRequesterOnly()`) are locked to the
  Requests area: the frontend blocks other routes and `/api/dashboard` returns
  403 for them; they only ever see their own requests.

Frontend mirrors this: `useAuth()` exposes `can(cap)`, `isSuperAdmin`,
`requesterOnly`; nav items and routes gate on those.

---

## 6. Environment variables of note (`backend/.env`)

```
DB_CONNECTION=mysql
DB_DATABASE=uits_vmtl
DB_USERNAME=root
DB_PASSWORD=

QUEUE_CONNECTION=sync           # notifications send synchronously
FRONTEND_URL=http://localhost:5173

# Expiry alert thresholds (days) — also editable in Settings
ALERT_INSURANCE_DAYS=30
ALERT_ROADWORTHY_DAYS=30
ALERT_LICENCE_DAYS=30
ALERT_SERVICE_DAYS=30

# Web Push (VAPID). Public key is exposed to the browser; private key is secret.
VAPID_SUBJECT="mailto:uits@knust.edu.gh"
VAPID_PUBLIC_KEY=...            # generate a fresh pair per environment (see below)
VAPID_PRIVATE_KEY=...
# Windows only: EC signing for VAPID needs an OpenSSL config. FORWARD SLASHES, unquoted.
OPENSSL_CONF=C:/tools/php83/extras/ssl/openssl.cnf
```

Generate VAPID keys:
```bash
php -r "require 'vendor/autoload.php'; print_r(Minishlink\WebPush\VAPID::createVapidKeys());"
```

---

## 7. Feature inventory (all implemented & tested)

- **Request lifecycle**: create → approve/reject (reason required) → assign
  (vehicle + driver, conflict-checked, transaction + row locks) → start → end
  (odometer validated, distance/duration computed) → **No Show** state.
- **Request changes ("allow edit")**: an approver or transport officer can send a
  pending/approved request back with an explanation (`POST …/request-changes`) →
  status **`changes_requested`**. The requester sees the explanation, **edits**
  the booking (time, etc.) and saving **resubmits** it to `pending` (`PUT` on the
  request; re-checks availability and notifies approvers). Explanation is stored as
  a `changes_requested` approval-log entry.
- **Goodwill requests**: raised by driver/transport (`requests.create_goodwill`),
  require an explanation, checked against existing bookings, then approved
  normally. Page: `/goodwill`. They are **not tied to a department** —
  `department_id` is null and the request reads **"Goodwill"** everywhere a
  department is shown (via `department_label` on the resource; analytics/reports
  group these trips under "Goodwill").
- **External travel** (`requests.create_external`; transport/approver/admin): a
  vehicle requested by another arm of the university for an extended trip (often
  over weekends). Captures the requesting unit, a reason, expected duration (days)
  and the odometer reading before the trip began; flows through the normal
  approval + assignment lifecycle. Page: `/external-travel`. Columns on
  `vehicle_requests`: `is_external`, `external_org`, `expected_duration_days`,
  `start_odometer`.
- **Fuel purchase logging** (`fuel.log`; transport/approver/admin/**driver**):
  records each fill-up (odometer, litres, price/litre → total cost, station,
  fuel type). The previous purchase's odometer is captured automatically so
  distance-per-tank and fuel economy (km/L) are derived across consecutive fills;
  the newest reading advances the vehicle odometer. Page: `/fuel`. Table:
  `fuel_logs`. A per-vehicle **Fuel Spend & Economy** card (spend, litres, km/L,
  cost/km, avg ₵/L + recent purchases) shows on the vehicle detail page
  (`GET /vehicles/{id}/fuel`).
- **Fleet availability for requesters**: any requester (incl. Staff) can open
  **Vehicle & Driver Availability** (`/requests/availability`) — a live snapshot of
  who is on a trip now and every upcoming booking (`GET /availability/overview`).
  The New Request form live-checks the chosen window (`GET /availability/check`)
  and **blocks fully-booked windows**; `store()` enforces the same rule server-side
  (a window with no free vehicle *or* driver is rejected 422).
- **In-trip added destinations**: the requester adds a destination during an
  active trip (from their Request view); the **driver accepts/declines** it (on
  the Trip view). On acceptance, the **next scheduled trip for that vehicle is
  notified of a possible delay**. Tables: `trip_stops`.
- **Driver self-service**: drivers link to a login account and operate only their
  own assigned trips from a phone.
- **Vehicles & drivers**: admin **and approver** (and transport) can add, edit,
  **deactivate/reactivate** (`POST /…/active`), and remove (soft delete).
- **Maintenance** records + dashboard alerts (insurance/roadworthy/licence/service).
- **Analytics** (Recharts) and **Reports** with CSV / Excel / PDF export (filters respected).
  Analytics includes a **Fuel Spend & Economy** section (total cost, litres, fleet
  km/L, cost/km, monthly spend, per-vehicle cost & economy). Reports has a **report-type
  switch** — *Vehicle Usage* or *Fuel Log* — each with its own totals, table and exports.
- **Notifications**: in-app (database) + email + **Web Push** on every lifecycle event.
- **Audit trail**: append-only ledger of every action (who/what/when/IP), incl. failed sign-ins.
- **Admin suite** (super admin): App Health, RBAC editor, System Controls
  (feature flags/retention/maintenance), Directory Auth (LDAP config, write-only
  secret), Database Connections, Documentation, Codebase Guide, FAQs.
- **Profile pictures**: users can upload an avatar (client-compressed data URL,
  `frontend/src/lib/image.ts` → `users.avatar` longtext).
- **PWA**: installable, offline app-shell (`/api/*` never cached), "new version →
  Refresh" prompt, themed boot splash, VAPID push + app badge.
- **Design system**: KNUST tokens (light/dark, system-aware) incl. **theme-aware
  elevation** (`--elev-1/2/3` → `shadow-card`/`shadow-elevated`/`shadow-pop`); the
  shared `Card` uses a layered soft shadow + 16px radius for depth. **Trial:** a
  WattVision-inspired dashboard treatment (KPI metric tiles, left-accent alert
  boxes, gradient **area charts** on Analytics) is applied on Dashboard/Analytics —
  it reuses the KNUST palette and Segoe UI (no colour/font change) and may be
  reverted (see the `wattvision-design-trial` memory). Responsive shell
  with sidebar + **mobile bottom nav + hamburger drawer**, **animated** result
  **modals** for every add/update/remove/status change (success/info pop in,
  error/failure shake; entrance respects `prefers-reduced-motion`), animated
  vehicle hero on login.

---

## 8. Architecture notes

### Backend
- **Enums** (`app/Enums`): every status carries a label + semantic colour token.
- **Services** (`app/Services`): `AvailabilityService` (conflict detection),
  `AssignmentService` (locked assignment), `TripService` (start/end/no-show/
  odometer correction), `AnalyticsService`, `MaintenanceAlertService`,
  `WebPushService`, `TripQueryFilter`.
- **Policies** (`app/Policies`): all capability-driven. `AuditLogger` +
  `SequenceNumber` helpers in `app/Support`.
- **Notifications** (`app/Notifications`): typed classes + a reusable
  `GenericNotification`; all fan out via `['database','mail', WebPushChannel]`.
- Routes: `backend/routes/api.php` (grouped by `auth:sanctum` + `cap:`/`super`).

### Frontend
- `src/lib/`: `api.ts` (axios + token), `theme.ts`, `format.ts` (dates; **figures
  round to 3 dp**; **durations render `HH:MM:SS:mmm`**), `image.ts`, `types.ts`.
- `src/context/`: `AuthContext` (`can`/`isSuperAdmin`/`requesterOnly`),
  `MetaContext` (enums/departments/roles).
- `src/components/`: `Layout` (shell + capability nav + mobile bottom nav),
  `DataTable` (**table on desktop, cards on mobile** — used by every list page;
  pass `overlay` to open a row's detail as a **modal over the list**),
  `RouteModal` (renders a detail route as a modal overlay via a background
  location — list click → modal; deep-link/refresh → full page; `useInRouteModal()`
  lets a detail hide its back-link/width when shown in the modal),
  `Toast` (renders result **modals**), `Modal`, `StatusBadge`, `Tabs`,
  `PwaManager`, `NotificationBell`, `AnimatedHero`, `ui.tsx` (Button/Card/Field/…).
- `src/pages/`: feature pages; `pages/admin/*` is the break-glass tier.

---

## 9. Testing

```bash
cd backend && php artisan test        # 42 tests, all passing
cd frontend && npm run build          # tsc typecheck + production build
```

Backend tests cover: auth, the full request/trip lifecycle, data-integrity
(double-booking, odometer), driver self-service, RBAC (grant/revoke takes
effect), staff lockdown, push subscriptions, goodwill, and trip stops + delay
notification. There is no automated frontend test suite — `npm run build` is the
typecheck gate.

---

## 10. Gotchas & lessons (read before editing)

1. **Two shells, two PATHs.** The Bash tool doesn't see PHP/MySQL; use PowerShell
   with `$env:Path` refreshed from Machine+User, or `start.bat`.
2. **`OPENSSL_CONF` in `.env` must use forward slashes, unquoted** — backslashes
   trip dotenv's escape parser and break the whole env file.
3. **Never write PHP files with PowerShell `Set-Content -Encoding utf8`** — it
   adds a UTF-8 BOM that breaks `<?php`/namespace. Use `Write`/`Edit` tools or
   `[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`.
4. **Guzzle is pinned to 7.x** (web-push required it; Laravel supports both).
5. **`php artisan test` runs against the dev DB** (RefreshDatabase) — it wipes
   `uits_vmtl`. Re-run `php artisan migrate:fresh --seed` afterwards to restore demo data.
6. **Login response doesn't include capabilities** (no auth context yet) — the
   frontend re-fetches `/me` after login. Keep that.
7. **Vite HMR can leave a stale bundle** after edits (a new button renders but its
   handler is old) — a hard refresh fixes it; production builds are unaffected.
8. The in-app **Browser preview pane** in the original tooling didn't composite
   frames (screenshots/animation clocks froze); verify visuals in a real browser.

---

## 11. Known gaps / possible next steps

- **No automated frontend tests** — consider Vitest + Testing Library.
- **Directory Auth & Database Connections** are configuration/inspection surfaces
  (LDAP fields persist; DB page is read-only). No live LDAP bind or SQLite→
  Postgres cutover is wired — they're intentionally informational for this app.
- **Email** uses the `log` mailer in dev; configure real SMTP (M365) for prod via
  Settings / `.env`.
- **Admin sub-tables** (RBAC matrix, DB tables) still scroll horizontally on
  mobile by design; the main list pages use the responsive card treatment.
- **Notifications** send synchronously (`QUEUE_CONNECTION=sync`); switch to a
  queue worker for production throughput.
- Consider CI to run `php artisan test` + `npm run build` on push.

---

## 12. Deployment checklist (per the standard)

- [ ] HTTPS everywhere; serve SPA and API same-origin (or set CORS).
- [ ] Fresh VAPID keys; real SMTP; `APP_ENV=production`, `APP_DEBUG=false`.
- [ ] `php artisan migrate --force` (schema is idempotent, safe on boot).
- [ ] Build the frontend (`npm run build`) and serve `dist/` (with the service
      worker at the root scope).
- [ ] Seed roles/capabilities/settings (or run the seeders once), then create the
      real System Administrator and disable the demo accounts.
- [ ] Confirm the audit log, backups (Settings → Backup & export), and push all work.
```
