'use strict';
// Web Push (VAPID) delivery (ports WebPushService). No-ops unless VAPID keys are
// configured. Prunes subscriptions the push service has permanently rejected.
const db = require('./db_ref');
const log = require('../util/log');

function configured() { return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY); }
function publicKey() { return process.env.VAPID_PUBLIC_KEY || null; }

let lib = null;
function webpush() {
  if (lib) return lib;
  lib = require('web-push');
  if (configured()) lib.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:uits@knust.edu.gh', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return lib;
}

async function sendToUser(userId, payload) {
  if (!configured()) return;
  const subs = await db.all('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
  const wp = webpush();
  for (const sub of subs) {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.public_key, auth: sub.auth_token } };
    try { await wp.sendNotification(subscription, JSON.stringify(payload)); }
    catch (err) { if (err.statusCode === 404 || err.statusCode === 410) await db.run('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]); else log.warn('webpush_failed', { message: err.message }); }
  }
}

module.exports = { configured, publicKey, sendToUser };
