'use strict';
const crypto = require('node:crypto');
const settings = require('./settings');
const db = require('./db_ref');
const email = require('./email');
const { ApiError } = require('../middleware/errorHandler');
const DEFAULT_SMS_URL = 'https://api.mnotify.com/api/sms/quick';
function checkChannel(channel) { if (!['email', 'sms'].includes(channel)) throw new ApiError(400, 'Choose email or SMS.'); }
async function config(channel) {
  checkChannel(channel);
  if (channel === 'email') return email.config();
  const savedKey = String(await settings.get('sms_api_key', '') || await settings.get('mnotify_api_key', '')).trim();
  return { enabled: [true, 1, '1', 'true'].includes(await settings.get('sms_enabled', false)), provider: await settings.get('sms_provider', 'mnotify'),
    sender_id: await settings.get('sms_sender_id', 'UITS'), api_url: await settings.get('sms_api_url', '') || process.env.SMS_API_URL || DEFAULT_SMS_URL,
    api_key: savedKey || String(process.env.SMS_API_KEY || '').trim(), key_source: savedKey ? 'saved' : process.env.SMS_API_KEY ? 'env' : '' };
}
function signature(c) {
  const { enabled, key_source, ...connection } = c;
  return crypto.createHash('sha256').update(JSON.stringify(connection)).digest('hex');
}
async function status(channel) {
  const cfg = await config(channel); const last = await settings.get(`${channel}_connection_test`, '');
  let test = null; try { test = JSON.parse(last); } catch (_) {}
  const configured = !!(cfg.api_key && cfg.api_url && (channel === 'email' ? cfg.app_id && cfg.channel : cfg.sender_id && cfg.provider === 'mnotify'));
  const verified = configured && !!test?.ok && test.signature === signature(cfg);
  const { api_key, ...safe } = cfg;
  return { settings: { ...safe, key_configured: !!api_key, default_api_url: channel === 'email' ? email.DEFAULT_API_URL : DEFAULT_SMS_URL },
    status: { enabled: cfg.enabled, configured, verified, state: cfg.enabled ? verified ? 'active' : 'untested' : !configured ? 'not_set_up' : verified ? 'ready' : 'needs_test',
      last_test: test ? { ok: test.ok, at: test.at, to: test.to, message: test.message } : null } };
}
async function save(channel, input) {
  checkChannel(channel);
  if (!input || typeof input !== 'object') throw new ApiError(400, 'Provide connection settings.');
  const fields = channel === 'email' ? ['api_url', 'api_key', 'app_id', 'channel'] : ['api_url', 'api_key', 'sender_id'];
  const clean = {};
  for (const field of fields) if (field in input) {
    if (typeof input[field] !== 'string' || input[field].length > (field === 'api_key' ? 4096 : 500)) throw new ApiError(400, 'Invalid connection settings.');
    clean[field] = input[field].trim();
  }
  if (clean.api_url) {
    let url; try { url = new URL(clean.api_url); } catch (_) { throw new ApiError(400, 'Enter a valid API address.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new ApiError(400, 'Use an HTTPS API address without credentials or query parameters.');
    if (channel === 'sms' && (url.hostname !== 'api.mnotify.com' || !['/api/sms/quick', '/api/sms/bulk'].includes(url.pathname))) throw new ApiError(400, 'Use the mNotify quick or bulk SMS API address.');
  }
  if (clean.sender_id !== undefined && (!clean.sender_id || clean.sender_id.length > 11)) throw new ApiError(400, 'Sender ID must be 1–11 characters.');
  for (const key of ['app_id', 'channel']) if (key in clean && (!clean[key] || /[\r\n]/.test(clean[key]))) throw new ApiError(400, 'App ID and channel are required.');
  if (clean.api_key && /[\r\n\x00]/.test(clean.api_key)) throw new ApiError(400, 'API keys must be a single line.');
  for (const [key, value] of Object.entries(clean)) if (key !== 'api_key' || value) await settings.set(`${channel === 'email' ? 'mail' : 'sms'}_${key}`, value);
  if (input.clear_key === true) {
    await settings.set(`${channel === 'email' ? 'mail' : 'sms'}_api_key`, '');
    if (channel === 'sms') await settings.set('mnotify_api_key', '');
  }
  if (channel === 'sms') await settings.set('sms_provider', 'mnotify');
  return status(channel);
}
async function activate(channel, enabled) {
  if (typeof enabled !== 'boolean') throw new ApiError(400, 'Enabled must be on or off.');
  const current = await status(channel);
  if (enabled && !current.status.verified) throw new ApiError(400, 'Send a successful test with the saved connection before switching on.');
  const key = channel === 'email' ? 'mail_enabled' : 'sms_enabled';
  await db.run(`INSERT INTO system_settings (key, value, type, "group") VALUES (?, ?, 'boolean', 'messaging') ON CONFLICT (key) DO UPDATE SET value=excluded.value, type='boolean', updated_at=${db.now()}`, [key, enabled ? '1' : '0']);
  return status(channel);
}
async function recordTest(channel, cfg, to, result) {
  await settings.set(`${channel}_connection_test`, JSON.stringify({ ...result, to, at: new Date().toISOString(), signature: signature(cfg) }));
}
module.exports = { config, status, save, activate, recordTest };
