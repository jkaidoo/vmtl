'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const db = require('../src/db/sqlite');
const settings = require('../src/services/settings');
const controls = require('../src/services/systemControls');
const unified = require('../src/services/unifiedApi');
const templates = require('../src/services/messageTemplates');

test('controls have typed defaults without seed rows and preserve policies without pruning records', async () => {
  const initial = await controls.config();
  assert.equal(initial.notifications.emailEnabled, true);
  assert.equal(initial.notifications.smsEnabled, false);
  assert.equal(initial.retention.notificationDays, 90);
  assert.equal(initial.retention.automatedPruning, false);
  await controls.save('retention', { auditDays: 365, notificationDays: 30 });
  await controls.save('maintenance', { enabled: true, message: 'Planned maintenance\nPlease save your work.' });
  const out = await controls.config();
  assert.equal(out.retention.auditDays, 365);
  assert.equal(out.maintenance.enabled, true);
  assert.match(out.maintenance.message, /Please save/);
  assert.equal(db.prepare("SELECT type FROM system_settings WHERE key='maintenance_mode'").get().type, 'boolean');
});

test('feature switches update the actual staff connection and photo-import policy without exposing credentials', async () => {
  await unified.saveConfig({ url: 'https://staff.example.test', key: 'private-fixture-key' });
  await controls.save('flags', { liveDirectory: false, staffPhotos: false, pushNotifications: false });
  assert.equal((await unified.config()).switchedOn, false);
  assert.equal((await unified.fieldSettings()).find(f => f.key === 'photo_url').enabled, false);
  const out = await controls.config();
  assert.equal(out.directoryConfigured, true);
  assert.doesNotMatch(JSON.stringify(out), /private-fixture-key/);
  await controls.save('flags', { liveDirectory: true });
  assert.equal((await unified.config()).enabled, true);
  assert.equal((await unified.fieldSettings()).find(f => f.key === 'photo_url').enabled, false);
});

test('invalid controls are rejected before any values are saved', async () => {
  const before = (await controls.config()).notifications.emailSubject;
  await assert.rejects(controls.save('notifications', { emailSubject: 'Must not save', emailEnabled: 'false' }), /on or off/);
  assert.equal((await controls.config()).notifications.emailSubject, before);
  await assert.rejects(controls.save('retention', { auditDays: -1 }), /whole number/);
  await assert.rejects(controls.save('retention', { notificationDays: 1.5 }), /whole number/);
  await assert.rejects(controls.save('notifications', { emailSubject: 'Bad\nHeader' }), /Invalid/);
  await assert.rejects(controls.save('constructor', {}), /Unknown/);
  await assert.rejects(controls.saveLegacy([{ key: 'toString', value: 'Bad' }]), /Unknown/);
});

test('notification permissions gate automated transports and SMS prefix matches the preview count', async () => {
  await controls.save('flags', { emailNotifications: true, smsNotifications: true, pushNotifications: false });
  await settings.set('mail_enabled', true); await settings.set('sms_enabled', true);
  await controls.save('notifications', { emailEnabled: false, smsEnabled: false, smsPrefix: 'CAMPUS' });
  const sent = [];
  const mocks = {
    './settings': settings, './db_ref': { get: async () => ({ name: 'Actual Staff', email: 'staff@test', phone: '0244000000' }) },
    './webPush': { sendToUser: () => assert.fail('Push switch is off') },
    './sms': { send: async (to, text) => sent.push(text) }, './email': { send: async (to, subject, text) => sent.push(text) },
    './messageTemplates': templates, '../util/log': { warn: (event, data) => assert.fail(data.message) },
  };
  const context = { module: { exports: {} }, require: name => mocks[name] };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/transports'), 'utf8'), context);
  await context.module.exports.fanout(1, 'new_request', { request_number: 'REQ-1', requester: 'Requester' });
  assert.equal(sent.length, 0);
  await controls.save('notifications', { emailEnabled: true, smsEnabled: true });
  await context.module.exports.fanout(1, 'new_request', { request_number: 'REQ-1', requester: 'Requester' });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /^CAMPUS: /);
  const preview = await templates.render('sms', 'test', templates.SAMPLE);
  assert.match(preview.text, /^CAMPUS: /);
  assert.deepEqual({ characters: preview.characters, encoding: preview.encoding, segments: preview.segments }, templates.smsCount(preview.text));
});

test('section routes enforce system-admin access and return the persisted controls', async () => {
  db.exec("INSERT INTO users(id,name,email,password_hash,is_super_admin) VALUES(1,'Owner','owner@test','x',1),(2,'Staff','staff@test','x',0)");
  const express = require('express'); const app = require('../src/middleware/asyncSafe').asyncSafe(express());
  app.use(express.json()); app.use((req, res, next) => { req.session = { user: db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.headers['x-test-user'] || 0)) }; next(); });
  require('../src/routes/api/admin')(app); app.use(require('../src/middleware/errorHandler'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/admin/system-controls`;
  const put = (user, section, body) => fetch(url + '/' + section, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(url + '/config')).status, 401);
    assert.equal((await put(2, 'flags', { pushNotifications: true })).status, 403);
    assert.equal((await put(1, 'flags', { pushNotifications: 'true' })).status, 400);
    const result = await put(1, 'flags', { pushNotifications: true });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).data.flags.pushNotifications, true);
    assert.equal((await put(1, 'backups', {})).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
