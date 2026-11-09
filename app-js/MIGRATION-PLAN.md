# VMTL → JavaScript rewrite (walkin-parity)

Converts the UITS Vehicle Management & Trip Logging app from **Laravel (PHP) + React/TS SPA**
to the **walkin architecture**: Node.js + Express, plain JavaScript (CommonJS), static
multi-page frontend (`public/*.html` + vanilla `public/js/*.js` + `public/css`),
`better-sqlite3` (dev) / PostgreSQL (prod). Same UI/UX, same security model, same features.

New project root: `vmtl/app-js/` (original `backend/` + `frontend/` left intact as the spec source).

## Target architecture (mirrors walkin)

```
app-js/
  server.js                 # process lifecycle: listen, migrate, graceful shutdown
  package.json
  .env.example
  data/                     # sqlite file (dev)
  src/
    app.js                  # express factory: helmet CSP, session, idle policy, routes, static, page guards
    config/
      env.js                # env normalisation
      sessionPolicy.js      # idle timeouts (web 30m, pwa exempt on mobile)
    db/
      runtime.js            # get/all/run/transaction over sqlite|pg (copied pattern)
      sqlite.js             # connection + schema (CREATE TABLE IF NOT EXISTS + ensureColumn)
      postgres.js           # pg pool + health + tx
      postgresSchema.js     # runMigrations() for pg
      seed.js               # roles, capabilities, org tree, demo users/fleet/drivers
    middleware/
      auth.js               # requireAuth, requireCap, requireAnyCap, requireSuper (break-glass)
      errorHandler.js, asyncSafe.js, requestId.js, rateLimit.js, idle.js
    services/               # one module per domain (async, use runtime)
      roleRepository.js capabilities.js availability.js assignment.js trips.js
      analytics.js reports.js directoryAuth.js maintenanceAlerts.js
      notifications.js webPush.js sms.js audit.js orgUnits.js settings.js
    routes/
      api.js                # mounts routes/api/<domain>.js
      api/ auth.js meta.js dashboard.js vehicle-requests.js trips.js vehicles.js
           drivers.js maintenance.js fuel.js analytics.js reports.js availability.js
           users.js departments.js org-units.js notifications.js push.js audit.js
           settings.js rbac.js admin.js (app-health, system-controls, directory-auth, messaging, database, docs)
  public/
    *.html (login, dashboard, requests, trips, vehicles, drivers, fuel, maintenance,
            analytics, reports, approvals, goodwill, external-travel, availability,
            users, org-units, settings, audit, faqs, admin/*), 404/500/offline
    js/common.js (api helper, theme, pwa, toast), js/<page>.js per page
    css/styles.css (KNUST design tokens: light/dark, elevation)
    sw.js, manifest.webmanifest, icons/, knust-logo.png
```

## Security model (ported 1:1 from walkin + vmtl)

- **Sessions** via `express-session` (sqlite/pg store), httpOnly, sameSite=strict, secure in prod.
  `SESSION_SECRET` required in prod. Replaces Sanctum tokens.
- **Idle logout**: vmtl rule — 30 min inactivity on web + desktop PWA; **mobile PWA exempt**
  (`mode` stamped at login from client; sliding expiry middleware in `src/app.js`).
- **Capability RBAC**: `role_capabilities` table, runtime-editable. Guards: `requireAuth`,
  `requireCap(cap)`, `requireAnyCap(...)`, `requireSuper` (break-glass `users.is_super_admin`).
- **Break-glass System Administrator** implicitly holds every capability; sole principal for
  App Health, RBAC, System Controls, Directory Auth, Database, Documentation.
- **Org-unit scoping**: `visibleOrgUnitIds()` (subtree) + `servingOrgUnitIds()` (ancestors),
  enforced in services, not the UI.
- **helmet CSP** with first-party inline-script hashing (copied), rate limits per user/IP,
  requester-only lockdown (Staff → requests area only), audit trail of every action.
- **LDAP/AD** via `ldapts` (walkin uses it): local-first login, directory fallback, group→role/unit mapping.

## Capability catalog (from backend/app/Support/Capabilities.php)

requests.create, requests.view_all, requests.approve, requests.assign,
requests.create_goodwill, requests.create_external, trips.operate, trips.correct,
vehicles.manage, drivers.manage, maintenance.manage, fuel.log, analytics.view,
reports.export, users.manage, departments.manage, roles.manage, settings.manage, audit.view.

Roles: administrator (all), supervisor (all minus audit/settings/departments/roles, OU-scoped),
approver, transport_admin, staff (requests.create only), driver (goodwill + fuel).

## Endpoint surface (from backend/routes/api.php) — ported verbatim to /api/*

Auth: POST /login, POST /logout, GET /me, POST /me/avatar. GET /meta, GET /dashboard.
Notifications (3), push (3), availability (2), vehicle-requests (12 incl. goodwill/external/
approve/reject/request-changes/assign), trips (10), vehicles (8), drivers (8), maintenance (5),
fuel-logs (5), analytics (1), reports (2, cap:reports.export), audit-logs (cap:audit.view),
settings (3, cap:settings.manage), users (5, cap:users.manage), departments (1 open + 3 manage),
org-units (5), and the super-only admin tier: rbac (2), app-health, system-controls (2),
directory-auth (3), messaging (4), database, documentation (2).

## Phased build order

1. Scaffold skeleton (package.json, server.js, app.js, config, runtime, logging, middleware).
2. DB schema (sqlite.js) + pg schema — port all 27 migrations' tables/columns.
3. Seeders — roles, capabilities, KNUST org tree, demo users/fleet/drivers.
4. Auth (sessions + LDAP + idle + break-glass) + RBAC guards.
5. Domain services + routes, feature by feature, each verified.
6. Analytics + reports (CSV/XLSX/PDF via exceljs + pdfkit, as walkin does).
7. Notifications (db + email + SMS + Web Push) + audit ledger.
8. Frontend: KNUST-token CSS, static pages + vanilla JS per page, PWA, trip-progress animation.
9. Integrate, `node --test`, verify in the built-in browser.

## Fidelity notes

- Figures round to 3 dp; durations render HH:MM:SS:mmm (port from frontend/src/lib/format.ts).
- Trip-progress graphic = pure time-based (scheduled_start→scheduled_end, elapsed from actual_start);
  vehicle silhouette chosen by VehicleType motif (port from frontend/src/lib/trip.ts + TripProgress.tsx).
- Idle logout mobile-PWA exemption honoured client AND server side.
- `departments` table is vestigial in the source; org_units is the live hierarchy — carry org_units,
  keep a thin departments listing for compatibility.
