'use strict';
const db = require('./db_ref');
const settings = require('./settings');
const unifiedApi = require('./unifiedApi');
const webPush = require('./webPush');

const FIELDS = {
  notif_email_subject_prefix: ['string', 'notifications', 'Email subject prefix', '[UITS VMTL] '],
  notif_sms_sender_prefix: ['string', 'notifications', 'SMS sender prefix', 'UITS'],
  notif_allow_email: ['boolean', 'notifications', 'Allow email', true],
  notif_allow_sms: ['boolean', 'notifications', 'Allow SMS', false],
  retain_audit_days: ['integer', 'retention', 'Audit log retention (days)', 0],
  retain_notification_days: ['integer', 'retention', 'Notification retention (days)', 90],
  maintenance_mode: ['boolean', 'maintenance', 'Maintenance mode', false],
  maintenance_message: ['string', 'maintenance', 'Maintenance announcement', 'The system is undergoing scheduled maintenance.'],
  feature_email_notifications: ['boolean', 'features', 'Email notifications', true],
  feature_sms_notifications: ['boolean', 'features', 'SMS notifications', false],
  feature_push_notifications: ['boolean', 'features', 'Push notifications', true],
};
const MAP = {
  notifications: { emailSubject: 'notif_email_subject_prefix', smsPrefix: 'notif_sms_sender_prefix', emailEnabled: 'notif_allow_email', smsEnabled: 'notif_allow_sms' },
  retention: { auditDays: 'retain_audit_days', notificationDays: 'retain_notification_days' },
  maintenance: { enabled: 'maintenance_mode', message: 'maintenance_message' },
  flags: { emailNotifications: 'feature_email_notifications', smsNotifications: 'feature_sms_notifications', pushNotifications: 'feature_push_notifications' },
};
const bad = message => Object.assign(new Error(message), { status: 400 });
const on = value => value === true || value === 1 || value === '1' || value === 'true';
async function value(key) {
  const field = FIELDS[key]; const raw = await settings.get(key, field[3]);
  return field[0] === 'boolean' ? on(raw) : field[0] === 'integer' ? Number(raw) : String(raw ?? '');
}
function validate(key, value) {
  if (!Object.hasOwn(FIELDS, key)) throw bad('Unknown system control.');
  const field = FIELDS[key];
  if (!field) throw bad('Unknown system control.');
  if (field[0] === 'boolean' && typeof value !== 'boolean') throw bad(`${field[2]} must be on or off.`);
  if (field[0] === 'integer' && (!Number.isInteger(value) || value < 0 || value > 36500)) throw bad(`${field[2]} must be a whole number between 0 and 36500.`);
  if (field[0] === 'string' && (typeof value !== 'string' || value.length > (key === 'maintenance_message' ? 2000 : 120) || (key !== 'maintenance_message' && /[\r\n]/.test(value)))) throw bad(`Invalid ${field[2].toLowerCase()}.`);
}
async function write(key, value) {
  validate(key, value);
  const [type, group, label] = FIELDS[key];
  await settings.set(key, type === 'boolean' ? (value ? '1' : '0') : value);
  await db.run('UPDATE system_settings SET type = ?, "group" = ?, label = ? WHERE key = ?', [type, group, label, key]);
}
async function list() {
  return Promise.all(Object.entries(FIELDS).map(async ([key, [type, group, label]]) => ({ key, type, group, label, value: await value(key) })));
}
async function config() {
  const result = {};
  for (const [section, fields] of Object.entries(MAP)) result[section] = Object.fromEntries(await Promise.all(Object.entries(fields).map(async ([name, key]) => [name, await value(key)])));
  const directory = await unifiedApi.config();
  result.flags.liveDirectory = directory.switchedOn;
  result.flags.staffPhotos = (await unifiedApi.fieldSettings()).find(field => field.key === 'photo_url').enabled;
  result.directoryConfigured = Boolean(directory.url && directory.key);
  result.push = { configured: webPush.configured() };
  result.retention.automatedPruning = false;
  return result;
}
async function save(section, input) {
  if (!Object.hasOwn(MAP, section)) throw bad('Unknown system-control section.');
  const map = MAP[section];
  if (!map) throw bad('Unknown system-control section.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Provide system-control values.');
  for (const [name, value] of Object.entries(input)) {
    if (section === 'flags' && ['liveDirectory', 'staffPhotos'].includes(name)) {
      if (typeof value !== 'boolean') throw bad(`${name} must be on or off.`);
    } else {
      if (!Object.hasOwn(map, name)) throw bad('Unknown system control.');
      validate(map[name], value);
    }
  }
  for (const [name, value] of Object.entries(input)) {
    if (name === 'liveDirectory' && section === 'flags') await unifiedApi.saveConfig({ enabled: value });
    else if (name === 'staffPhotos' && section === 'flags') await unifiedApi.saveFields({ photo_url: value });
    else await write(map[name], value);
  }
  return config();
}
async function saveLegacy(items) {
  if (!Array.isArray(items)) throw bad('Provide system controls as a list.');
  for (const item of items) validate(item?.key, item?.value);
  for (const item of items) await write(item.key, item.value);
  return list();
}
module.exports = { config, save, list, saveLegacy };
