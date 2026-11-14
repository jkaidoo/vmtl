'use strict';
const settings = require('./settings');
const email = require('./email');
const log = require('../util/log');
const audit = require('./audit');
const { ApiError } = require('../middleware/errorHandler');
const WINDOW = 10 * 60 * 1000;
const failures = [];
const lastAlert = new Map();
async function config() {
  let value; try { value = JSON.parse(await settings.get('security_alert_email', '{}')); } catch (_) {}
  return { enabled: value?.enabled === true, recipient: typeof value?.recipient === 'string' ? value.recipient : '' };
}
async function status() {
  const cfg = await email.config();
  return { ...await config(), mail_ready: cfg.enabled && !!cfg.api_key };
}
async function save(value) {
  const { enabled, recipient } = value || {};
  if (typeof enabled !== 'boolean' || typeof recipient !== 'string' || recipient.length > 2500) throw new ApiError(400, 'Enter valid recipient emails separated by commas.');
  const addresses = recipient.trim() ? recipient.split(',').map(s => s.trim().toLowerCase()) : [];
  if (addresses.length > 10 || addresses.some(s => s.length > 254 || !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(s)) || (enabled && !addresses.length)) throw new ApiError(400, 'Enter up to 10 valid recipient emails separated by commas.');
  await settings.set('security_alert_email', JSON.stringify({ enabled, recipient: [...new Set(addresses)].join(', ') }));
  return status();
}
async function alert(kind, summary, fields = {}, dedupe = kind) {
  const now = Date.now();
  if (now - (lastAlert.get(dedupe) ?? -Infinity) < WINDOW) return;
  lastAlert.set(dedupe, now);
  for (const [key, at] of lastAlert) if (now - at >= WINDOW) lastAlert.delete(key);
  log.warn('security_alert', { kind, message: summary, ...fields });
  await audit.record({ action: 'security.alert', description: summary, newValues: { kind, ...fields }, ip: fields.ip || null });
  try {
    const cfg = await config();
    if (!cfg.enabled || !cfg.recipient) return;
    const result = await email.send(cfg.recipient, 'VMTL suspicious activity alert', `${summary}\n\n${JSON.stringify(fields, null, 2)}\n\nReview Audit logs → Application logs in VMTL.`, { hub: true });
    if (!result.ok) log.warn('security_alert_delivery_failed', { kind, message: result.message });
  } catch (_) { log.warn('security_alert_delivery_failed', { kind, message: 'Could not deliver the security alert.' }); }
}
function background(promise) { void promise.catch(() => log.warn('security_alert_failed', { message: 'Could not record security alert.' })); }
function prune(now) { while (failures.length && now - failures[0].at >= WINDOW) failures.shift(); }
function loginFailure(username, ip) {
  username = String(username || '').trim().toLowerCase(); if (!username) return;
  const now = Date.now(); prune(now); failures.push({ username, ip, at: now }); if (failures.length > 2000) failures.shift();
  const accounts = new Set(failures.filter(f => ip && f.ip === ip).map(f => f.username));
  const addresses = new Set(failures.filter(f => f.username === username && f.ip).map(f => f.ip));
  if (accounts.size >= 5) background(alert('multiple_accounts', 'One IP attempted sign-ins for at least five different accounts within ten minutes.', { ip, accounts: accounts.size }, `accounts:${ip}`));
  if (addresses.size >= 5) background(alert('multiple_addresses', 'One account had failed sign-ins from at least five IP addresses within ten minutes.', { username, addresses: addresses.size }, `addresses:${username}`));
}
function loginSuccess(username, ip) {
  username = String(username || '').trim().toLowerCase(); prune(Date.now()); let attempts = 0;
  for (let i = failures.length - 1; i >= 0; i--) if (failures[i].username === username) { failures.splice(i, 1); attempts++; }
  if (attempts >= 2) background(alert('success_after_failures', 'An account signed in after at least two failed attempts within ten minutes.', { username, ip, attempts }, `success:${username}`));
}
module.exports = { config, status, save, alert, loginFailure, loginSuccess, background };
