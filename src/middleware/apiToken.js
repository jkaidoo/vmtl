'use strict';
// Bearer-token authentication for the public read API (/api/v1). Tokens are
// created on the Unified API page; only their sha256 hash is stored.
const crypto = require('crypto');
const settings = require('../services/settings');

async function resolve(req) {
  const h = String(req.headers.authorization || '').trim();
  const m = /^Bearer\s+(vmtl_[a-f0-9]+)$/i.exec(h);
  if (!m) return null;
  const hash = crypto.createHash('sha256').update(m[1]).digest('hex');
  const tokens = (await settings.get('api_tokens', [])) || [];
  const t = tokens.find((x) => x.hash === hash);
  if (!t) return null;
  const now = Date.now();
  if (!t.last_used_at || now - new Date(t.last_used_at).getTime() > 60000) {
    t.last_used_at = new Date().toISOString();
    try { await settings.set('api_tokens', tokens); } catch (_) { /* best effort */ }
  }
  return t;
}

function requireApiToken(scope) {
  return async (req, res, next) => {
    try {
      const t = await resolve(req);
      if (!t) { res.set('WWW-Authenticate', 'Bearer'); return res.status(401).json({ error: 'A valid API token is required.' }); }
      if (scope && !(t.scopes || []).includes(scope)) return res.status(403).json({ error: `This token lacks the ${scope} scope.` });
      req.apiToken = t;
      return next();
    } catch (err) { return next(err); }
  };
}

module.exports = { requireApiToken };
