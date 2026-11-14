# VMTL Security Audit

**Scope:** `C:\Users\JOSH\Desktop\vmtl` (UITS Vehicle Management & Trip Logging), audited against the
walk-in security standard in `../walkin/Doc/SECURITY.md` (the 14-section "Security measures implemented
and their limits" chapter).

**Method:** code-based review of the request stack, auth, RBAC, data access, outbound integrations and
rendering paths. This is a source inventory, not a penetration test. Date: 2026-11-14.

**Bottom line:** VMTL is a faithful, in places *stronger*, reproduction of the walk-in security model.
RBAC, injection defence, file-upload validation, CSP, rate limiting and session handling all meet the
standard — and session-ID regeneration on login (a documented walk-in *gap*) is actually implemented
here. The findings below are a short list of real deviations, led by the password policy.

---

## Findings (ranked)

### 1. No password complexity policy — MEDIUM · deviates from walk-in §4.2
Walk-in enforces a minimum-eight-character rule with upper/lower/digit/non-alphanumeric classes on every
password-setting path. VMTL has **no complexity check anywhere**. In `src/routes/api/users.js` and
`drivers.js` the validation rule is simply `password: { required: true, type: 'string' }` — a one-character
password is accepted, then `hashPassword()` (bcrypt cost 10) stores it.
- `src/routes/api/users.js:104` (create), `:164` / `:176` (update)
- `src/routes/api/drivers.js:34`
- No shared helper equivalent to walk-in's complexity validator exists in `src/util/`.

**Fix:** add a `passwordPolicy(plain)` helper in `src/util/password.js` (min length + the four character
classes) and call it wherever a password is set.

### 2. No self-service password change — MEDIUM · deviates from walk-in §4.2
Walk-in requires current-password verification + an audit event for a self-change. VMTL has **no
`/me/password` (or equivalent) route** — `src/routes/api/auth.js` exposes only `/me`, `/me/avatar`,
`/me/sessions`. Passwords can only be reset by an administrator through `PUT /users/:id`, which does not
verify the target's current password. Local, non-directory users therefore cannot rotate their own
credentials, and there is no current-password gate.

**Fix:** add an authenticated `POST /me/password` that checks the current password, applies the new
complexity policy, rejects reuse, and writes an audit record.

### 3. PostgreSQL / connection-profile TLS does not verify the server certificate — MEDIUM · matches a walk-in *limit*, with one regression
Transport is encrypted but the server identity is **not** verified:
- `src/db/postgres.js:36` — `ssl: PG_SSL === '1' ? { rejectUnauthorized: false } : undefined`
- `src/services/dbProfiles.js:77` and `:90` — `ssl: p.ssl_mode === 'disable' ? false : { rejectUnauthorized: false }`

Walk-in documents the same `rejectUnauthorized:false` limitation (§4.7), so the main pool is consistent
with the standard. **Regression:** `dbProfiles.js` collapses *every* non-`disable` SSL mode to
`rejectUnauthorized:false`, so a profile explicitly set to `verify-ca` / `verify-full` is silently
**not** verified — the stricter choice is ignored. By contrast the Unified API client does it correctly:
`src/services/unifiedApi.js:35` adds the KNUST CA to `tls.rootCertificates` and keeps verification on.

**Fix:** in `dbProfiles.js`, honour the mode — `verify-ca`/`verify-full` → `rejectUnauthorized:true`
(with an optional `tls_ca`), only `require`/`prefer` → relaxed.

### 4. In-app "Security Assessment" text overstates backup secret handling — LOW / informational
`src/routes/api/admin.js:35` returns documentation claiming *"Secrets … redacted from exports."* The full
backup is **not** redacted: `src/services/backups.js:37` does `SELECT * FROM <table>` over a table list
that includes `users` (with `password_hash`) and `system_settings` (API keys, directory bind passwords,
VAPID private key), writing them verbatim to the JSON snapshot. This is consistent with walk-in's own
**documented limit** (§4.9: "Snapshot backups may retain credentials and personal information"), and the
file is written `mode 0o600`, is App-Owner-only, and create/download requires password re-auth
(`src/routes/api/backups.js:10`) — so the *control* is sound. Only the *claim* is too broad.

**Fix:** reword the admin.js security blurb to say snapshots retain credentials and require operational
custody (as walk-in states), or add key-name redaction to the snapshot for non-restore exports.

### 5. API-token lookup is not constant-time — LOW
`src/middleware/apiToken.js:13` finds a token with `tokens.find((x) => x.hash === hash)` — a plain string
compare of SHA-256 hex. Low risk (the compared value is already a hash of a high-entropy `vmtl_…` token),
but walk-in's pattern is `timingSafeEqual`. Optional hardening.

---

## Controls verified as meeting the standard

| Walk-in §| Area | VMTL status |
|---|---|---|
| 4.2 | Password hashing | bcrypt cost 10, `bcrypt.compareSync`; directory accounts store no hash (`src/util/password.js`). Deviates from scrypt but sound. |
| 4.4 | Sessions & cookies | Server-side store (SQLite/PG), `HttpOnly`, `SameSite=Strict`, `secure` in prod, idle expiry (30 min web / 30 day PWA), logout destroys session. **`req.session.regenerate()` on login** (`auth.js:68`) — closes walk-in's documented gap. Active-session list + remote device revoke. |
| 4.5 | RBAC / record access | Capabilities resolved **fresh per request** from the DB (`middleware/auth.js`, `services/authz`); break-glass `is_super_admin`; OU-subtree scoping (`services/orgScope`); the super-admin account is protected from edit/delete/role-assignment by lesser admins (`users.js:160,190,241`). Page guards + API guards both enforced (`src/app.js:156`). |
| 4.6 | Rate limiting | Per-user / per-IP / per-IP flood backstop (`src/app.js:140`, `middleware/rateLimit.js`) + per-identity login lockout, 8 fails / 15 min, with admin-lockout security alerts (`auth.js:28`). `429` + `Retry-After`. In-memory single-process (same documented limit). |
| 4.7 | Headers / CSP | Helmet CSP `useDefaults:false`, `default-src 'self'`, inline-script **hashes** generated at startup, `object-src 'none'`, `frame-ancestors 'none'`, HSTS in prod, `x-powered-by` off (`src/app.js:95`). Google Maps origins explicitly allow-listed. `style-src 'unsafe-inline'` and no CSRF token (SameSite=Strict only) — identical to walk-in's stated limits. |
| 4.8 | Injection / rendering | SQL values parameterised throughout; every dynamic `ORDER BY` / column is allow-listed (`audit.js:53`, `vehicle-requests.js:47`, `availability.js` uses literals); backup import validates column names by regex against a fixed table list (`backups.js:70`). Frontend escapes all interpolated data via `VMTL.esc()` (`public/js/common.js:11`), used consistently in the `innerHTML` templates checked. |
| 4.9 | Secrets | Settings secrets are write-only (`has_password` pattern, blank preserves); `src/util/redact.js` redacts `password|secret|token|authorization|cookie|api_key|credential|private_key` keys in logs/exports; VAPID + bind passwords server-side. Connection profiles AES-256-GCM (`services/dbProfiles`). |
| 4.10 | Attachment validation | `src/services/fleetFiles.js`: strict base64 regex, **type from file signature** (`sniff()`) with client MIME ignored, JPEG/PNG/WebP/PDF-receipt-only, size cap + daily allowance, capability + org-scope gated, random-UUID storage key written `flag:'wx'`, `path.basename()` on the display name. No path traversal reachable from user input. |
| 4.11 | Public endpoints | **Stronger than walk-in:** no unauthenticated bearer tracking links. Live tracking is fully `requireAuth` + capability gated (`routes/api/tracking.js`); the public read API `/api/v1/*` is `requireApiToken(<scope>)` with per-scope checks and SHA-256-hashed tokens (`middleware/apiToken.js`, `routes/api/v1.js`). |
| 4.13 | Auditing / errors | Append-only `audit_logs` with actor/action/IP/UA; login success & failure recorded; admin role/lock changes raise security alerts; `errorHandler` returns a generic 500 while logging; request log omits bodies and never logs secrets (`middleware/requestLog.js`). |

---

## Operational notes (not code defects)

- **Bootstrap secrets are dev-only and guarded.** `scripts/seed.js` creates `admin@uits.test` / `password`
  and `.env.example` ships `SESSION_SECRET=dev-secret-change-me`, but `sessionSecret()`
  (`src/app.js:62`) **throws on startup in production** if the secret is unset or still the default, and
  warns if < 32 chars. Ensure the seed is never run against production and a strong `SESSION_SECRET` is set.
- **Directory (LDAP/AD) TLS verification** defaults **on** (`directoryAuth.js:76,92` set `tls_verify:true`)
  and is a per-directory admin toggle — matching walk-in's per-directory cert-control model. If the KNUST
  AD connector is run with verification off, treat that as an accepted, documented risk, not a code bug.
- **No account-recovery (`/forgot`,`/reset`) flow exists.** This removes the enumeration/token-race surface
  walk-in spends §4.3 mitigating, but means recovery is admin-reset only. A functional gap, not a weakness.

---

## Recommended order of work
1. Password complexity helper + wire into all set-password paths (finding 1).
2. Self-service `POST /me/password` with current-password + reuse checks (finding 2).
3. Honour `verify-ca`/`verify-full` in `dbProfiles.js` TLS (finding 3).
4. Reword the admin.js security blurb re: backups (finding 4).
5. Optional: `timingSafeEqual` for API-token compare (finding 5).
