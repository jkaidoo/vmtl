# Security measures implemented and their limits (VMTL)

### Scope and trust boundaries

This chapter is a code-based implementation inventory of the UITS Vehicle Management & Trip Logging
(VMTL) app — not a penetration-test certification, compliance claim or verification of production
configuration. A control labelled **Implemented** has an identifiable code path; its stated limitations
are part of the same record. VMTL follows the walk-in reference security model; the places where VMTL
**goes beyond** that reference are called out as **VMTL-specific** so they can be ported back to walk-in.

The principal boundaries are browser versus server, one user versus another's records, ordinary roles
versus the System Administrator (break-glass), external integrations versus the application, and offline
device state versus authoritative database state. Client-side visibility is not authorization: the
server decides access and accepted state changes.

---

### 1. Password hashing and password policy

**Implemented — `src/util/password.js`:** local-account passwords are hashed with bcrypt (cost 10);
verification uses `bcrypt.compareSync`. Directory (LDAP/AD) accounts store no usable hash — they
authenticate against the directory on each sign-in (`password_hash IS NULL`).

**Complexity policy — `passwordProblems()` in `src/util/password.js`:** every password-setting path
requires at least 8 characters including an uppercase letter, a lowercase letter, a digit and a
non-alphanumeric character. The helper returns a list of problems so callers surface them as per-field
errors. It is enforced server-side wherever a password is written:
- `POST /api/users` and `PUT /api/users/:id` (`src/routes/api/users.js`, via `assertPasswordStrength`).
- Driver login provisioning (`src/routes/api/drivers.js`, `syncLogin`).
- Self-service change (`POST /api/auth/me/password`).

**Self-service change — `POST /api/auth/me/password` (`src/routes/api/auth.js`):** requires the current
password, an active local account, a new password that meets the complexity policy, and a new password
that differs from the current one; it writes an `auth.password_changed` audit event. Directory accounts
are told to change their password in the directory.

**Limits:** this is not MFA, passkeys, breached-password screening or passwordless auth. bcrypt's cost is
a fixed default (10) rather than a versioned, tunable policy. Development bootstrap credentials
(`scripts/seed.js`) must never be used in production. A password change does not globally revoke the
user's other existing sessions.

### 2. Server sessions and cookies

**Implemented — `src/app.js`, `src/config/sessionPolicy.js`:** Express stores session state server-side
(SQLite or PostgreSQL). Cookies are `HttpOnly`, `SameSite=Strict`, and `secure` in production. Logout
destroys the session. A sliding idle timeout expires web sessions after 30 idle minutes and installed-PWA
sessions after 30 idle days (`IDLE_TIMEOUT_MINUTES`, `PWA_IDLE_TIMEOUT_DAYS`); the clock resets on API
activity. APIs receive 401 on expiry; page requests redirect to sign-in. `GET /api/auth/me` re-reads the
active identity and destroys the session if the account is gone.

**VMTL-specific — session-ID regeneration on login:** `src/routes/api/auth.js` calls
`req.session.regenerate()` before stamping the new identity, so a pre-auth session ID cannot be fixed and
reused across the privilege change. (The walk-in reference documents this as a gap; VMTL closes it.)

**VMTL-specific — active-session management:** `GET /api/auth/me/sessions` lists the user's signed-in
devices and `DELETE /api/auth/me/sessions/:sid` revokes another device (audited as
`auth.session_revoked`). A user cannot revoke the session they are currently on (they use Sign out).

**Limits:** the client-provided PWA flag selects the longer idle policy; it is not installation
attestation. `requireAuth` checks session presence rather than re-reading active-account status on every
endpoint (capability checks, `/me`, and page guards do re-read). A password/account change is not
immediate universal session revocation. With sessions in SQLite, scale-out requires `SESSION_STORE=postgres`.

### 3. Capabilities, protected administration and record access

**Implemented — `src/middleware/auth.js`, `src/services/authz.js`, `src/services/orgScope.js`:** routes
use authenticated-user, capability, any-capability and system-admin checks. **Capabilities are resolved
fresh from the database on every check** (`roleRepository.capsForUser`), so RBAC edits take effect
immediately rather than from a stale session snapshot. API denials use 401/403 as appropriate. The
break-glass System Administrator (`is_super_admin`) implicitly holds every capability.

**Scoping:** managers are limited to their organisational-unit subtree plus unassigned accounts
(`orgScope.visibleOrgUnitIds`); a scoped manager cannot assign the administrator/system-admin role or
place a user outside their subtree (`guardAssignment`). The System Administrator account is protected:
lesser administrators cannot edit, delete, or assign its role, and no one may delete their own account.
Page access is guarded server-side in `src/app.js` (App-Owner pages, System pages, requester-only pages),
not only in the UI.

**Owner page access — `src/services/ownerAccess.js`:** the App Owner may share App overview, Dropdowns,
File Server and Broadcasts with chosen roles and/or named people. Each shared page's HTML guard and every
API route behind it check the grant (`requirePage`), resolved fresh from the database on each request
against the user's current role and active status, so revoking takes effect immediately. A delegate gets
exactly the owner's power on that page and nothing else. Backup & cleanup (full snapshots containing
password hashes and secrets, restore, permanent deletion) and the Owner page access settings themselves
can never be shared, so no delegate can widen their own access; only the App Owner can read or change
grants, and every change is audited with before/after values.

**Limits:** OWN/TEAM/ALL capability catalogue entries do not by themselves prove complete scope
enforcement in every handler. UI hiding never substitutes for protecting the data API.

### 4. Rate limiting and bounded processing

**Implemented — `src/middleware/rateLimit.js`, `src/app.js`:** an in-memory fixed-window limiter keyed
per signed-in user (1,200/min default), per IP for anonymous traffic (2,000/min), and a per-IP flood
backstop (12,000/min) — all configurable. Exceeding a limit returns 429 with `Retry-After`. Expired
counters are cleaned up periodically.

**Login lockout — `src/routes/api/auth.js`:** after 8 failed attempts for an identity within 15 minutes
(`LOGIN_LOCK_THRESHOLD`, `LOGIN_LOCK_WINDOW_MIN`) sign-in is refused with 429; locking an administrator
account raises a security alert. JSON bodies are capped (12 MB). Every async route handler is wrapped so
a rejected promise becomes a 500 rather than crashing the process (`src/middleware/asyncSafe.js`).

**Limits:** limiter and lockout state live in memory, reset on restart, and are per machine (limits
multiply by machine count). Anonymous traffic behind a shared campus IP shares the per-IP budget. This is
not a distributed denial-of-service system.

### 5. HTTP headers, HTTPS and cross-site defenses

**Implemented — Helmet in `src/app.js`:** CSP uses `useDefaults:false` with `default-src 'self'`;
script sources are same-origin plus startup-generated hashes for first-party inline scripts and the
Google Maps JS API; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors
'none'`. `X-Powered-By` is disabled. HSTS (15,552,000s, includeSubDomains) and
`upgrade-insecure-requests` are set in production, where cookies are secure and one proxy hop is trusted.

**Limits:** `style-src` allows `'unsafe-inline'` to support the existing UI. There is no dedicated
anti-CSRF token; `SameSite=Strict` and same-origin behaviour are the current cross-site controls. Correct
proxy trust depends on hosting topology.

### 6. Transport security for backend connections

**Implemented — `src/services/unifiedApi.js`:** HTTPS calls to the KNUST Unified API add the UITS CA
(`certs/knust-cloud.pem` or `UNIFIED_API_CA_FILE`) to the trusted roots **with certificate verification
left on**, and cap the response size. The saved API URL is validated (http/https only, no embedded
credentials, query or fragment). Directory (LDAP/AD) connections default to `rejectUnauthorized:true`
with `minVersion TLSv1.2` and a per-directory "verify certificate" toggle plus optional pasted CA
(`src/services/directoryAuth.js`).

**Limits:** the main PostgreSQL pool encrypts transport but does not verify the server certificate when
`PG_SSL=1` (`src/db/postgres.js`, `rejectUnauthorized:false`), and connection-profile tests behave the
same (`src/services/dbProfiles.js`). Turning a directory's certificate verification off is an available
admin choice and should be treated as an accepted risk, not a default.

### 7. Injection, rendering and filesystem controls

**Implemented:** SQL values are parameterised throughout the data services; every dynamic `ORDER BY` /
column selection is chosen from an allow-list (e.g. `src/routes/api/audit.js`,
`src/routes/api/vehicle-requests.js`), never taken raw from the request. Backup import validates column
names against a regex and a fixed table list before building inserts (`src/services/backups.js`). The
shared frontend escaping helper `VMTL.esc()` (`public/js/common.js`) escapes `& < > " '` and is used on
interpolated values in the `innerHTML` rendering paths. Documentation is served from a fixed slug
registry, not arbitrary filesystem paths (`src/routes/api/admin.js`).

**Limits:** parameterised values do not validate every interpolated SQL identifier; a comprehensive
sink/export review across every rendering path remains separate work.

### 8. Attachment and document validation

**Implemented — `src/services/fleetFiles.js`:** attachment entity types are allow-listed
(vehicle/driver/maintenance), the entity must exist and the operator must hold the matching capability and
be in scope. The stored type comes from the **file signature** (JPEG/PNG/WebP/PDF); the client-declared
MIME type is ignored and anything else is rejected. Base64 is strictly validated; empty payloads and
payloads above the configured size cap are rejected, and a per-user daily upload allowance is enforced.
Files are written under a random UUID key with `flag:'wx'` (no overwrite, no path traversal from user
input); the display filename is reduced with `path.basename` and truncated.

Reads go through `GET /api/fleet-files/...` only (never a public or bucket URL). Each read re-checks
organisational scope against the owning record; driver licence photos additionally require
`drivers.manage` or the driver's own account, and maintenance receipts require `maintenance.manage`.
Responses carry the stored signature type, `X-Content-Type-Options: nosniff`, `Cache-Control: private,
no-store` and an encoded `inline` filename. PDFs are accepted only as maintenance receipts.

**Limits:** signature checks are not antivirus scanning; there is no quarantine or content-disarm service.
Files kept on a folder, S3 or Supabase file server are not included in database backups and need the
storage provider's own backup.

### 9. Public endpoints and the read API

**Implemented:** live tracking (`src/routes/api/tracking.js`) is fully authenticated and capability
gated — there are **no unauthenticated bearer tracking links**. The public read API (`/api/v1/*`,
`src/routes/api/v1.js`) requires a bearer token whose SHA-256 hash is stored, and each route checks a
specific scope (`vehicles.read`, `trips.read`, `requests.read`, `analytics.read`) via
`src/middleware/apiToken.js`.

**Limits:** API tokens are bearer credentials; anyone holding one has the granted read scopes. Token
expiry/rotation beyond manual revocation is not established. The token hash comparison is a direct string
compare rather than constant-time (low risk given the token entropy).

### 10. Secrets, encrypted profiles and redacted exports

**Implemented:** integration secrets are write-only through the settings APIs (blank preserves the stored
value; responses expose only `has_*` flags). The VAPID private key and directory bind passwords stay
server-side. Connection profiles are encrypted with AES-256-GCM (`src/services/dbProfiles.js`). File-server
credentials (S3 secret key, Supabase service key) are encrypted with AES-256-GCM using a key derived
(scrypt) from `DATABASE_PROFILE_ENCRYPTION_KEY`, or `SESSION_SECRET` if unset; saving remote credentials is
refused when neither is set. Each remotely stored file keeps an encrypted copy of the storage settings it
was written with, so it stays readable after the File Server is changed — changing the key makes those
files unreadable, so keep it stable and back it up separately. Logs and
operational exports are redacted by key name (`src/util/redact.js`:
`password|secret|token|authorization|cookie|api_key|credential|private_key`), and the request log never
records bodies.

**Limits:** full database snapshots (`src/services/backups.js`) are **not** redacted — they contain
password hashes and settings secrets. They are written owner-only (`mode 0600`), and creating or
downloading one requires App-Owner password re-authentication, but the artifact itself needs separate
operational custody. Profile encryption does not encrypt the whole database or offline cache.

### 11. Auditing, destructive actions and recovery

**Implemented:** `audit_logs` retains actor, action, entity, IP and timestamp; sign-in success and
failure, password changes, admin role/lock changes and record mutations are recorded. Admin role grants
and account lockouts raise security alerts (`src/services/securityAlerts.js`). The central error handler
returns a generic 500 while logging the detail, and the real status for client errors. Backups provide
recovery (a safety snapshot is taken before a restore) and verify a SHA-256 digest + table shape on read.

**Limits:** append-only behaviour is not cryptographic tamper evidence. Backup existence does not prove
restore success or off-site disaster recovery.

### 12. Bootstrap and configuration guardrails

**Implemented:** `sessionSecret()` (`src/app.js`) throws on startup in production if `SESSION_SECRET` is
missing or still the development default, and warns if it is shorter than 32 characters. The seed script
(`scripts/seed.js`) and `create-admin` script exist for development/first-run only.

**Limits:** these guardrails do not stop an operator from running the seed against a production database
or leaving demo accounts active; replacing bootstrap credentials remains an operational step.

### 13. Controls that must not be claimed as completed

The source does not establish MFA/passkeys, breached-password screening, global session revocation on
password change, explicit anti-CSRF tokens, certificate-verified PostgreSQL TLS, malware scanning,
all-data/offline encryption, redacted full-database snapshots, token expiry/rotation, or proven off-site
recovery. These are gaps or hardening opportunities, not implied additions. A settings screen, dependency
or comment is not evidence of working enforcement.

### 14. Changes in this revision (2026-11-14)

- Added a server-enforced password complexity policy (`passwordProblems`) and wired it into user
  creation/update, driver login provisioning and self-service change.
- Added self-service password change (`POST /api/auth/me/password`) with current-password verification,
  complexity enforcement, reuse rejection and an audit event.
- Corrected the in-app Security Assessment text so it no longer implies full snapshots are redacted.
- Restricted driver licence photo reads to `drivers.manage` holders and the driver themselves.
- Driver login provisioning now requires `users.manage` on the server as well as in the UI.
- IDL scheduling (`src/routes/api/event-schedules.js`) enforces organisational scope on every
  endpoint, so a role granted `schedule.events` without `fleet.global` cannot see or book fleet outside
  its own units. Cancelled schedules refuse new expenses and fuel.
- Dropdown keys for workflow statuses and vehicle types are protected (relabel only), and dropdown
  input is type-checked and rejects delimiter characters.
- Added Owner page access: App overview, Dropdowns, File Server and Broadcasts can be shared with roles
  or named people (server-enforced per page); Backup & cleanup and the access settings stay App Owner only.
