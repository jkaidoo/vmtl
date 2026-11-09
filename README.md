# UITS Vehicle Management & Trip Logging System

A secure, responsive internal web application for University Information
Technology Services (UITS) to manage official vehicles and log trips across the
full lifecycle:

> **Request → Approval → Vehicle/Driver Assignment → Trip Start → Trip Completion → Reporting → Analytics**

Built as a **Node.js + Express** application in plain JavaScript, with a static
multi-page front-end (vanilla JS + HTML + CSS, PWA) served by the same process,
backed by **PostgreSQL**. It mirrors the *walkin* reference architecture, design
language and security model.

> This project was migrated from its original Laravel (PHP) + React/TypeScript
> stack. All PHP code and setup have been removed; the application now lives
> entirely in [`app-js/`](app-js/).

---

## Architecture

```
vmtl/
└── app-js/
    ├── server.js              Process lifecycle: run migrations, listen, graceful shutdown
    ├── scripts/seed.js        Idempotent seeder (roles, caps, org tree, fleet, demo data)
    ├── src/
    │   ├── app.js             Express factory: helmet CSP, sessions, idle policy, RBAC guards
    │   ├── config/            env normalisation, session/idle policy
    │   ├── db/
    │   │   ├── runtime.js         One async get/all/run/transaction API over both engines
    │   │   ├── postgres.js        PostgreSQL gateway (pglite embedded, or `pg` for a server)
    │   │   ├── postgresSchema.js  Migration runner (migrations/postgres/NNN_*.sql)
    │   │   └── sqlite.js          Optional SQLite engine for quick local dev
    │   ├── middleware/        auth/RBAC, idle logout, rate limit, request id, session store
    │   ├── services/          Domain logic (assignment, trips, analytics, reports, directory …)
    │   └── routes/api/        REST endpoints, one module per domain
    └── public/                Static front-end: *.html, js/*.js, css/styles.css, sw.js, manifest
```

### Data store

PostgreSQL is the target database. By default (no `DATABASE_URL`) the app runs on
an **embedded PostgreSQL** (`@electric-sql/pglite`, a WASM build of Postgres)
persisted under `app-js/data/pg` — so it runs with zero external services. Point
`DATABASE_URL` at a managed PostgreSQL server for production. The schema is
created and upgraded automatically on boot by the migration runner.

### Security model (ported from the walkin reference)

- **Sessions** via `express-session` with a PostgreSQL-backed store; cookies are
  `httpOnly`, `sameSite=strict`, and `secure` in production. `SESSION_SECRET` is
  required in production.
- **Idle logout**: 30 minutes of inactivity on web + desktop PWA; mobile PWA is
  exempt (enforced both client- and server-side).
- **Capability RBAC**: runtime-editable `role_capabilities`; guards `requireAuth`,
  `requireCap`, `requireAnyCap`, and a break-glass System Administrator.
- **Org-unit scoping** enforced in services (subtree visibility), not the UI.
- **helmet CSP** with first-party inline-script hashing, per-user/IP rate limits,
  requester-only lockdown, and an append-only audit ledger of every action.
- **LDAP/AD** directory sign-in via `ldapts` (local-first, directory fallback).

---

## Requirements

- Node.js 18+ (uses `node --test`, `--watch`, `crypto.randomUUID`).
- No database server needed for local dev (embedded PostgreSQL). For production,
  a PostgreSQL 13+ instance reachable via `DATABASE_URL`.

---

## Running the application

```bash
cd app-js
npm install
cp .env.example .env      # defaults to embedded PostgreSQL
npm run seed              # creates schema + demo data (idempotent)
npm start                 # http://127.0.0.1:8000
```

`npm run dev` runs the server with `--watch`. On Windows, `start.bat` at the repo
root installs, seeds and launches the app, then opens the browser.

To use a managed PostgreSQL instead of the embedded engine, set in `.env`:

```
DB_RUNTIME=postgres
DATABASE_URL=postgres://user:pass@host:5432/uits_vmtl
# PG_SSL=1
```

---

## Test credentials

Seeded accounts (password `password` for all):

| Email | Role |
|-------|------|
| `admin@uits.test` | System Administrator (break-glass, all capabilities) |
| `approver@uits.test` | Approver |
| `transport@uits.test` | Transport / Admin Officer |
| `supervisor@uits.test` | Supervisor (org-unit scoped) |
| `staff@uits.test` | Staff (requester) |
| `driver1@uits.test`, `driver2@uits.test` | Driver |

---

## Automated tests

```bash
cd app-js
npm test        # node --test
```

---

## Feature map

Requests (standard / goodwill / external travel), approvals with
request-changes, vehicle & driver assignment with conflict detection, trip
operation (start/stop, mid-trip stops, odometer capture), vehicles, drivers,
fuel logs, maintenance records with expiry alerts, analytics, CSV/XLSX/PDF
report exports, in-app + email + SMS + Web Push notifications, audit trail,
runtime RBAC, organisational unit hierarchy, directory (LDAP/AD) sign-in, and a
PWA with offline support.
