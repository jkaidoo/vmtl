'use strict';
// Scoped location-reporting token.
//
// A driver with an in-progress trip is handed a short-lived, trip-scoped token
// that can do exactly ONE thing: record a GPS fix via POST /tracking/location.
// It decouples the high-frequency location beacon from the full login session —
// the token auto-expires, is bound to a single trip, and grants no other access
// even if it leaks. The login session (30-day PWA window) is used only to mint a
// fresh token now and then, not to carry every location post.
//
// The token is a compact HMAC construction: `vmtlloc_<payloadB64url>.<sigB64url>`
// where the payload is { u:userId, t:tripId, e:expiryEpochMs }. The signing key
// is derived from SESSION_SECRET but kept separate from session-cookie signing,
// so a tracking token can never be used as a session and vice versa.
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000; // devices re-mint well before this elapses
const PREFIX = 'vmtlloc_';
const TOKEN_RE = new RegExp(`^${PREFIX}[A-Za-z0-9._-]+$`);

function secret() {
  const base = String(process.env.SESSION_SECRET || 'dev-secret-change-me');
  return crypto.createHmac('sha256', base).update('beacon-token-v1').digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function sign(payloadB64) {
  return b64url(crypto.createHmac('sha256', secret()).update(payloadB64).digest());
}

// Mint a token for (userId, tripId). Returns { token, expires_at }.
function issue(userId, tripId, ttlMs = TTL_MS) {
  const exp = Date.now() + ttlMs;
  const payloadB64 = b64url(JSON.stringify({ u: Number(userId), t: Number(tripId), e: exp }));
  return { token: `${PREFIX}${payloadB64}.${sign(payloadB64)}`, expires_at: new Date(exp).toISOString() };
}

// Verify a token. Returns { userId, tripId, expiresAt } or null if it is
// malformed, tampered with, or expired.
function verify(token) {
  const raw = String(token || '');
  if (!TOKEN_RE.test(raw)) return null;
  const body = raw.slice(PREFIX.length);
  const dot = body.indexOf('.');
  if (dot < 1) return null;
  const payloadB64 = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(fromB64url(payloadB64).toString('utf8')); } catch (_) { return null; }
  if (!p || !Number.isFinite(p.u) || !Number.isFinite(p.t) || !Number.isFinite(p.e)) return null;
  if (Date.now() > p.e) return null;
  return { userId: p.u, tripId: p.t, expiresAt: p.e };
}

// Pull a candidate token off a request: Authorization: Bearer <token>, or a
// `token` field in the JSON body (for navigator.sendBeacon, which can't set
// headers).
function fromRequest(req) {
  const h = String((req.headers && req.headers.authorization) || '').trim();
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (m && TOKEN_RE.test(m[1])) return m[1];
  if (req.body && typeof req.body.token === 'string' && TOKEN_RE.test(req.body.token)) return req.body.token;
  return null;
}

module.exports = { issue, verify, fromRequest, TTL_MS, PREFIX };
