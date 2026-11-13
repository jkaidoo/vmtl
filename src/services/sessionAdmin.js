'use strict';

// Read and revoke active sign-in sessions from the session store (PostgreSQL
// app_sessions or SQLite sessions). Lets a person see and sign out their own
// devices, and an administrator revoke any session.
const db = require('./db_ref');

const parseExpire = (e) => (/^\d+$/.test(String(e || '')) ? Number(e) : Date.parse(e));

async function rawRows() {
  try {
    if (db.isPostgres()) return await db.all('SELECT sid, sess, expire FROM app_sessions');
    return db.raw.prepare('SELECT sid, sess, expire FROM sessions').all();
  } catch (_) { return []; }
}

// All live sessions as { sid, user_id, name, email, mode, created_at, last_seen_at }.
async function list() {
  const out = [];
  for (const r of await rawRows()) {
    const exp = parseExpire(r.expire);
    if (exp && exp < Date.now()) continue;
    let s = null; try { s = JSON.parse(r.sess); } catch (_) { continue; }
    if (!s || !s.user) continue;
    out.push({
      sid: r.sid, user_id: s.user.id, name: s.user.name, email: s.user.email,
      mode: s.mode || 'web', created_at: s.createdAt ? new Date(s.createdAt).toISOString() : null,
      last_seen_at: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null,
    });
  }
  return out.sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')));
}

async function forUser(userId) { return (await list()).filter((s) => s.user_id === Number(userId)); }

// Revoke a session (optionally only if it belongs to `ownerId`).
async function revoke(sid, ownerId = null) {
  if (ownerId != null) {
    const mine = (await forUser(ownerId)).some((s) => s.sid === sid);
    if (!mine) return false;
  }
  try {
    if (db.isPostgres()) await db.run('DELETE FROM app_sessions WHERE sid = ?', [sid]);
    else db.raw.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    return true;
  } catch (_) { return false; }
}

module.exports = { list, forUser, revoke };
