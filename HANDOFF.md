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

**Directory (LDAP) test users** — sign in with the bare username or the email;
password `password`. Provisioned on first login via the live `ldap.forumsys.com`
config (see `directory-auth-live` memory): `einstein` (→ transport_admin @ College
of Science by group mapping), `newton`, `tesla`, `euler` (→ staff @ UITS default).

**Org tree = the real KNUST structure.** `KnustOrgStructureSeeder` (runs last in
`DatabaseSeeder`) builds the full university org chart from
`backend/database/data/knust_org_structure.php` (generated from `col_fac_dep.xlsx`):
**265 nodes** — KNUST → 6 colleges → 20 faculties/schools → 151 departments, plus
4 directorates (Main Administration, Finance Office, UITS, Institute of Distance
Learning) and 83 units (incl. 59 *standalone* units that belong to no college and
hang directly off the root). The seeder is idempotent and re-maps the demo
accounts/fleet by email/plate.

**Org placement of the demo accounts:** admin → KNUST (root), approver/transport →
UITS directorate (central — see the whole UITS fleet), staff/ama/kofi → *User
Support Services* (under UITS), drivers → UITS. The central fleet lives on the
**UITS** directorate node; two vans (`CS-VAN-1/2`) sit under *Computer Science*
(College of Science → Faculty of Physical and Computational Sciences) to
demonstrate cross-branch scoping.

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

# Token idle timeout (minutes). A Sanctum token unused for this long is rejected
# and revoked on its next request — backstops the client-side idle logout. 0 = off.
SANCTUM_IDLE_TIMEOUT_MINUTES=30

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

## 7. Feature inventory (all implemented; see §9 for the test-suite caveat)

- **Request lifecycle**: create → approve/reject (reason required) → assign
  (vehicle + driver, conflict-checked, transaction + row locks) → start → end
  (odometer validated, distance/duration computed) → **No Show** state.
- **Request changes ("allow edit")**: an approver or transport officer can send a
  pending/approved request back with an explanation (`POST …/request-changes`) →
  status **`changes_requested`**. The requester sees the explanation, **edits**
  the booking (time, etc.) and saving **resubmits** it to `pending` (`PUT` on the
  request; re-checks availability and notifies approvers). Explanation is stored as
  a `changes_requested` approval-log entry. The **Approvals** queue has tabs —
  *Pending*, *Changes Requested* (with a live count badge), *All open* —
  deep-linkable via `?tab=`; the list `status` filter accepts a comma-separated
  list (e.g. `pending,changes_requested`) for the open queue.
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
- **Org hierarchy & scoping**: a single `org_units` tree (College → Faculty →
  Department → Unit → Office, plus Directorates) with a materialised `path`.
  `users`/`vehicles`/`drivers` carry `org_unit_id`; each user sees/manages only
  their **unit + all sub-units** (`User::visibleOrgUnitIds()`; super admin = all,
  a user at the root unit = all → the "central transport" pattern). Scopes vehicle
  & driver lists, assignment options, and create/update/delete policies. Admin
  manages the tree at **/org-units** (`OrgUnitController`); `OrgUnitSelect` (from
  scoped `/meta` `org_units`) sits on the vehicle/driver/user forms.
  **Request serving** = the requester's unit **+ ancestors** (`servingOrgUnitIds()`),
  so a parent/central pool serves sub-units (the demo fleet lives at the UITS
  directorate node). **Directory login** can place a user in a unit via the
  Role-Mapping tab (group → role + org unit). **Departments are unified into the
  tree**: requests carry `org_unit_id`, analytics/reports group by unit, and the
  request forms use org units (the old `departments` table is vestigial, kept but
  unused; its nav/settings entry was removed). See the `org-hierarchy-scoping` memory.
- **Maintenance** records + dashboard alerts (insurance/roadworthy/licence/service).
- **Analytics** (Recharts) and **Reports** with CSV / Excel / PDF export (filters respected).
  Analytics includes a **Fuel Spend & Economy** section (total cost, litres, fleet
  km/L, cost/km, monthly spend, per-vehicle cost & economy). Reports has a **report-type
  switch** — *Vehicle Usage* or *Fuel Log* — each with its own totals, table and exports.
- **Notifications**: in-app (database) + email + **Web Push** on every lifecycle event.
- **Audit trail**: append-only ledger of every action (who/what/when/IP), incl. failed sign-ins.
- **Admin suite** (super admin): App Health, RBAC editor, System Controls
  (feature flags/retention/maintenance), **Organisation** (interactive org-unit
  tree — collapsible, searchable, **drag-and-drop re-parenting**; logic in
  `frontend/src/lib/orgtree.ts`),
  Directory Auth (**General / LDAP / Active Directory / Role Mapping** tabs —
  independent per-provider config with write-only bind passwords, a **Test
  connection** button, and a **live LDAP/AD bind** on login with group→role/unit
  mapping; see §11), Database Connections, Documentation, Codebase Guide, FAQs.
  Directory settings are private to this page — they are **not** exposed in the
  generic Settings screen, and secrets are redacted from the data export.
- **Profile pictures**: users can upload an avatar (client-compressed data URL,
  `frontend/src/lib/image.ts` → `users.avatar` longtext).
- **PWA**: installable, offline app-shell (`/api/*` never cached), "new version →
  Refresh" prompt, themed boot splash, VAPID push + app badge.
- **Idle auto-logout**: signs the user out after **30 minutes of inactivity** on
  the **web** (any browser tab) and the **desktop PWA** — but **not** on the
  **mobile PWA** (an installed app on a phone/tablet is treated like a native app).
  The rule is `!(standalonePWA && mobileDevice)` (`frontend/src/lib/idle.ts`);
  `IdleLogout` (`frontend/src/components/IdleLogout.tsx`, mounted in `App`) tracks
  activity (throttled, shared across tabs via `localStorage`), re-checks on an
  interval and on tab focus/visibility, and on expiry revokes the token via the
  normal `logout()` and returns to `/login` with a "signed out due to inactivity"
  notice. A fresh login resets the clock; a reload keeps the stored timestamp so
  a session left idle past the window still expires on return. **Server-side
  backstop:** Sanctum rejects + revokes any token whose `last_used_at` is older
  than `sanctum.idle_timeout` minutes (default 30) via
  `Sanctum::authenticateAccessTokensUsing` in `AppServiceProvider` — this runs
  before Sanctum refreshes `last_used_at`, so it sees the genuine last-use time.
  It reclaims tokens orphaned by a closed/crashed tab (the client-side timer
  handles walk-away-with-tab-open). The **mobile-PWA exemption is honored on the
  server too**: the client sends `device_name: mobile-pwa` at login for that
  environment, and the callback skips idle enforcement for `mobile-pwa` tokens.
  Configure via `SANCTUM_IDLE_TIMEOUT_MINUTES`.
- **Live trip progress graphic**: a pickup truck drives from origin to
  destination flag along the trip's **expected duration** (planned window
  `scheduled_start → scheduled_end`, elapsed measured from `actual_start`). Ticks
  live client-side every second for in-progress trips (no polling), shows % done,
  elapsed/expected, remaining or "overdue", and a completed trip at 100%. Pure
  time-based logic in `frontend/src/lib/trip.ts` (`computeTripProgress`);
  component `frontend/src/components/TripProgress.tsx` (animated wheels, respects
  `prefers-reduced-motion`, `role="progressbar"`). Shown to **every access level**
  that can view the trip: on **Trip detail** (operators/drivers/admin) and on
  **Request detail** (requesters/staff — the surface a locked-down Staff user can
  reach).
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
- **Services** (`app/Services`): `AvailabilityService` (conflict detection +
  optional org-unit scoping), `AssignmentService` (locked assignment),
  `TripService` (start/end/no-show/odometer correction), `AnalyticsService`,
  `MaintenanceAlertService`, `WebPushService`, `TripQueryFilter`,
  `DirectoryAuthService` (native `ext-ldap` bind, test-connection, group→role/unit
  resolution).
- **Org model** (`app/Models/OrgUnit`, `app/Enums/OrgUnitType`): the university
  tree with a materialised `path`; `subtreeIds()` (visibility) and `pathIds()`
  (serving). `User::visibleOrgUnitIds()` / `servingOrgUnitIds()` drive scoping.
- **Policies** (`app/Policies`): all capability-driven; `Vehicle`/`Driver` policies
  also enforce org-unit scope on update/delete. `AuditLogger` + `SequenceNumber`
  helpers in `app/Support`.
- **Notifications** (`app/Notifications`): typed classes + a reusable
  `GenericNotification`; all fan out via `['database','mail', WebPushChannel]`.
- Routes: `backend/routes/api.php` (grouped by `auth:sanctum` + `cap:`/`super`).

### Frontend
- `src/lib/`: `api.ts` (axios + token), `theme.ts`, `format.ts` (dates; **figures
  round to 3 dp**; **durations render `HH:MM:SS:mmm`**), `image.ts`, `types.ts`.
- `src/context/`: `AuthContext` (`can`/`isSuperAdmin`/`requesterOnly`; the user's
  `org_unit`), `MetaContext` (enums incl. `org_unit_type`, roles, and the user's
  **scoped `org_units`** for selectors).
- `src/components/`: `Layout` (shell + capability nav + mobile bottom nav),
  `DataTable` (**table on desktop, cards on mobile** — used by every list page;
  pass `overlay` to open a row's detail as a **modal over the list**, or
  `onRowClick` to make rows open an edit modal),
  `RouteModal` (renders a detail route as a modal overlay via a background
  location — list click → modal; deep-link/refresh → full page; `useInRouteModal()`
  lets a detail hide its back-link/width when shown in the modal),
  `OrgUnitSelect` (indented, scoped org-unit picker used on the vehicle/driver/user
  forms), `Toast` (renders **animated** result **modals**), `Modal`, `StatusBadge`,
  `Tabs`, `PwaManager`, `NotificationBell`, `AnimatedHero`, `ui.tsx` (Button/Card/Field/…).
- `src/pages/`: feature pages; `pages/admin/*` is the break-glass tier.

---

## 9. Testing

```bash
cd backend && php artisan test        # ⚠ see caveat below
cd frontend && npm run build          # tsc typecheck + production build (the real gate today)
cd frontend && npm test               # Vitest unit/component tests (jsdom)
cd frontend && npm run test:types     # typecheck the test files (tsconfig.test.json)
```

The original PHPUnit suite (~42 tests) covers auth, the full request/trip
lifecycle, data-integrity (double-booking, odometer), driver self-service, RBAC,
staff lockdown, push subscriptions, goodwill, and trip stops + delay notification.

⚠️ **Caveat:** that suite predates the large recent feature wave (org-unit
hierarchy + scoping, unit-serving of requests, department→org-unit unification,
`changes_requested` status, live LDAP/AD auth). Some tests almost certainly need
updating (e.g. request-creation now requires a free vehicle **in the requester's
serving scope**, and analytics groups by org unit, not department). The suite was
**not re-run after these changes** because `php artisan test` uses `RefreshDatabase`
and **wipes `uits_vmtl`** — which would destroy the live demo state the app is
currently configured with (org tree, directory test users, scoped fleet). Before
relying on it: update the affected tests + factories for `org_unit_id`/serving
scope, then run against a **separate test database**. `npm run build` (tsc) is the
green gate used throughout.

**Frontend tests (new):** a **Vitest + Testing Library** suite now exists
(`npm test`). Config is in `vitest.config.ts` (kept separate from `vite.config.ts`
so the Vitest type world doesn't clash with Vite 8's rolldown plugin types);
`src/test/setup.ts` wires jest-dom + DOM cleanup; `tsconfig.test.json` typechecks
the specs (`npm run test:types`) and test files are excluded from the production
`tsc -b`. Initial coverage: `src/lib/format.ts` (duration / decimal / cedi
formatting), the `PwaManager` update-prompt component, and the SW build-hash
helper (`vite/sw-build-hash.ts`). Expand from here.

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
4b. **`ext-ldap` must be enabled** for directory auth — uncomment `extension=ldap`
   in `C:\tools\php83\php.ini` and **restart `php artisan serve`** so it loads.
5. **`php artisan test` runs against the dev DB** (RefreshDatabase) — it wipes
   `uits_vmtl`. Re-run `php artisan migrate:fresh --seed` afterwards to restore demo data.
6. **Login response doesn't include capabilities** (no auth context yet) — the
   frontend re-fetches `/me` after login. Keep that.
7. **Vite HMR can leave a stale bundle** after edits (a new button renders but its
   handler is old) — a hard refresh fixes it; production builds are unaffected.
8. The in-app **Browser preview pane** in the original tooling didn't composite
   frames (screenshots/animation clocks froze); verify visuals in a real browser.
9. **Web Push needs HTTPS on mobile.** Service workers/push only run on a secure
   origin (localhost is the only http exception), so testing on a phone over the
   LAN (`http://192.168.x.x`) silently fails. iOS also needs **16.4+ and the PWA
   installed to the Home Screen** — no push in a plain Safari tab.
10. **`migrate:fresh` rebuilds the org tree from the seed**, but the current live
   `uits_vmtl` also has **manual demo tweaks** applied at runtime (central fleet
   moved onto the UITS node, directory role/unit mapping, the `CS-VAN-1/2`
   demo vehicles, provisioned LDAP users). A fresh migrate won't reproduce those
   exactly — it seeds a clean tree + backfill. Keep this DB if you want the demo
   state; see the `org-hierarchy-scoping` and `directory-auth-live` memories.

---

## 11. Known gaps / possible next steps

- **Frontend tests** — a Vitest + Testing Library suite now exists (`npm test`,
  28 tests across `format`, `PwaManager`, and the SW build-hash helper). Coverage
  is still thin; grow it toward the request/trip flow pages and forms.
- **Directory Auth is LIVE**: real LDAP/AD bind via `DirectoryAuthService` (native
  `ext-ldap`). Login is local-first (break-glass + local accounts unaffected) then
  falls back to the directory when enabled; unknown directory users are
  provisioned with a **role _and_ org unit from group mapping** (the **Role
  Mapping** tab: ordered group-DN → role + org-unit rules, plus a default role and
  default org unit; membership resolved via AD `memberOf` or OpenLDAP
  `member`/`uniqueMember`; both re-synced on every directory login, never touching
  the super admin). Per-provider **Test connection** button
  (`POST /admin/directory-auth/test`). The login field accepts an email **or**
  username. Currently enabled against the public test server `ldap.forumsys.com`
  (users `einstein`/`newton`/`tesla`, pw `password`) — see the `directory-auth-live`
  memory. **Database Connections** remains a read-only inspection surface.
- **Vestigial `departments`**: the flat `departments` table + `*.department_id`
  columns still exist but nothing user-facing uses them (org units replaced them).
  A clean-up migration could drop them once you're confident.
- **Directory bind runs inline** during login (like the rest of the app's `sync`
  work) — fine for now; move behind a queue/timeout for scale.
- ~~**PWA update prompt is effectively inert**~~ **(fixed)**: the build now
  injects a content-derived hash into `public/sw.js` (`__BUILD_HASH__` →
  `vite/sw-build-hash.ts`, a `closeBundle` plugin). The SW bytes and `CACHE` name
  change whenever the app bundle does, so `updatefound` fires on a genuinely new
  build and the stale offline cache is purged on activate. The hash is derived
  from the emitted asset file names + the SW template, so a no-op rebuild keeps
  the same hash (no phantom "new version" prompt). Dev serves the literal
  placeholder unchanged.
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
- [ ] Build the real **org-unit tree** (/org-units) and place staff/fleet/drivers
      into their units; verify scoping with a non-admin account.
- [ ] If using directory auth: enable **`ext-ldap`** in prod PHP, replace the
      `ldap.forumsys.com` demo config with your LDAP/AD (General → provider; the
      provider tab; Role Mapping for group→role/unit), **Test connection**, and
      remove the forumsys test users.
- [ ] Serve over **HTTPS** (mandatory for service worker + Web Push, esp. mobile);
      consider a queue worker for push/notifications.
```
