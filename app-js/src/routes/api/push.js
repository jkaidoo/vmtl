'use strict';
// Web Push (VAPID) subscriptions (ports PushController).
const crypto = require('crypto');
const db = require('../../db/runtime');
const webPush = require('../../services/webPush');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');

module.exports = function register(router) {
  router.get('/push/vapid-public-key', requireAuth, (req, res) => {
    res.json({ public_key: webPush.publicKey(), configured: webPush.configured() });
  });

  router.post('/push/subscribe', requireAuth, async (req, res) => {
    const endpoint = req.body.endpoint; const keys = req.body.keys || {};
    if (!endpoint || !keys.p256dh || !keys.auth) throw require('../../middleware/errorHandler').badRequest('A valid push subscription is required.');
    const hash = crypto.createHash('sha256').update(String(endpoint)).digest('hex');
    const existing = await db.get('SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?', [req.session.user.id, hash]);
    if (existing) {
      await db.run(`UPDATE push_subscriptions SET endpoint = ?, public_key = ?, auth_token = ?, content_encoding = ?, updated_at = ${db.now()} WHERE id = ?`, [endpoint, keys.p256dh, keys.auth, req.body.contentEncoding || 'aesgcm', existing.id]);
      return res.status(201).json({ message: 'Subscribed.', id: existing.id });
    }
    const r = await db.run(`INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, public_key, auth_token, content_encoding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`, [req.session.user.id, endpoint, hash, keys.p256dh, keys.auth, req.body.contentEncoding || 'aesgcm']);
    res.status(201).json({ message: 'Subscribed.', id: r.lastInsertRowid });
  });

  router.post('/push/unsubscribe', requireAuth, async (req, res) => {
    if (!req.body.endpoint) throw require('../../middleware/errorHandler').badRequest('An endpoint is required.');
    const hash = crypto.createHash('sha256').update(String(req.body.endpoint)).digest('hex');
    await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?', [req.session.user.id, hash]);
    res.json({ message: 'Unsubscribed.' });
  });
};
