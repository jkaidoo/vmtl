'use strict';

// express-session store backed by the runtime data layer (the app_sessions
// table), so sign-ins persist in PostgreSQL across restarts on both the embedded
// (pglite) and managed (pg) engines. SQLite keeps its own dedicated store.
const session = require('express-session');
const db = require('../db/runtime');

class RuntimeStore extends session.Store {
  constructor({ ttlMs = 86_400_000, pruneIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
    if (pruneIntervalMs) {
      this._timer = setInterval(() => this._prune().catch(() => {}), pruneIntervalMs);
      if (this._timer.unref) this._timer.unref();
    }
  }

  _expiry(sess) {
    const cookieExpires = sess && sess.cookie && sess.cookie.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + this.ttlMs;
  }

  async _prune() { await db.run('DELETE FROM app_sessions WHERE expire < ?', [Date.now()]); }

  get(sid, cb) {
    db.get('SELECT sess, expire FROM app_sessions WHERE sid = ?', [sid])
      .then((row) => {
        if (!row) return cb(null, null);
        if (Number(row.expire) < Date.now()) { this.destroy(sid, () => cb(null, null)); return; }
        let parsed = null;
        try { parsed = JSON.parse(row.sess); } catch (_) { return cb(null, null); }
        cb(null, parsed);
      })
      .catch((err) => cb(err));
  }

  set(sid, sess, cb) {
    const payload = JSON.stringify(sess);
    const expire = this._expiry(sess);
    // Upsert without engine-specific ON CONFLICT quirks: update, then insert if absent.
    db.run('UPDATE app_sessions SET sess = ?, expire = ? WHERE sid = ?', [payload, expire, sid])
      .then((r) => {
        if (r && r.changes) return;
        return db.run('INSERT INTO app_sessions (sid, sess, expire) VALUES (?, ?, ?) RETURNING sid', [sid, payload, expire])
          .catch(() => db.run('UPDATE app_sessions SET sess = ?, expire = ? WHERE sid = ?', [payload, expire, sid]));
      })
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  touch(sid, sess, cb) {
    db.run('UPDATE app_sessions SET expire = ? WHERE sid = ?', [this._expiry(sess), sid])
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  destroy(sid, cb) {
    db.run('DELETE FROM app_sessions WHERE sid = ?', [sid])
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }
}

module.exports = RuntimeStore;
