'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const templates = require('../src/services/messageTemplates');

test('all default templates render without unresolved placeholders; email uses the Walk-in design', async () => {
  for (const channel of ['email', 'sms']) {
    const catalogue = await templates.catalogue(channel);
    assert.ok(catalogue.meta.length >= 12);
    for (const meta of catalogue.meta) {
      const out = await templates.render(channel, meta.key, templates.SAMPLE, {}, { preview: true });
      assert.doesNotMatch(out.text, /\{\w+\}/);
      if (channel === 'email') {
        assert.match(out.html, /#005b2b/);
        assert.match(out.html, /#f3bf32/);
        assert.match(out.html, /data:image\/png;base64/);
        assert.match(out.html, /Vehicle Management &amp; Trip Logging/);
      }
    }
  }
});

test('previews include unsaved edits without persisting them and escape dynamic HTML', async () => {
  const before = (await templates.catalogue('email')).templates.request_approved_body;
  const out = await templates.render('email', 'request_approved', { ...templates.SAMPLE, recipient_name: '<img src=x onerror=alert(1)>' }, { request_approved_body: 'Hello {recipient_name}, request {request_number} is ready.' }, { preview: true });
  assert.match(out.text, /is ready/);
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(out.html, /<img src=x/);
  assert.equal((await templates.catalogue('email')).templates.request_approved_body, before);
  await assert.rejects(templates.render('sms', 'request_approved', {}, { test_body: 'Wrong event' }), /selected template/);
});

test('saves email and SMS independently, supports resetting defaults, and rejects invalid placeholders', async () => {
  const defaults = await templates.catalogue('email');
  await templates.save('email', { request_approved_body: 'Ready for {recipient_name}: {request_number}' });
  assert.equal((await templates.render('email', 'request_approved', { recipient_name: 'Real User', request_number: 'REQ-9' })).text, 'Ready for Real User: REQ-9');
  assert.notEqual((await templates.catalogue('sms')).templates.request_approved_body, 'Ready for {recipient_name}: {request_number}');
  await assert.rejects(templates.save('email', { request_approved_body: '{secret_password}' }), /Unknown placeholder/);
  await assert.rejects(templates.save('email', { test_subject: 'Header\nInjection' }), /Invalid template/);
  await assert.rejects(templates.save('sms', { test_body: 'x'.repeat(6001) }), /Maximum/);
  await assert.rejects(templates.catalogue('push'), /Choose/);
  await templates.save('email', { request_approved_body: defaults.defaults.request_approved_body });
});

test('SMS previews count GSM extension characters, multipart messages and Unicode', () => {
  assert.deepEqual(templates.smsCount('a'.repeat(160)), { characters: 160, encoding: 'GSM-7', segments: 1 });
  assert.equal(templates.smsCount('a'.repeat(161)).segments, 2);
  assert.equal(templates.smsCount('^'.repeat(81)).segments, 2);
  assert.equal(templates.smsCount('漢'.repeat(71)).segments, 2);
  assert.equal(templates.smsCount('').segments, 0);
});

test('notification fanout uses saved templates and actual recipient data', async () => {
  await templates.save('email', { request_approved_subject: 'Approved {request_number}', request_approved_body: 'Hello {recipient_name}, {request_number} is approved.' });
  await templates.save('sms', { request_approved_body: 'Ready: {request_number}' });
  const sent = [];
  const mocks = {
    './db_ref': { get: async () => ({ name: 'Actual Staff', email: 'actual@test', phone: '0244000000' }) },
    './settings': { get: async (key) => key !== 'feature_push_notifications' },
    './webPush': {}, './sms': { send: async (to, text) => sent.push({ channel: 'sms', to, text }) },
    './email': { send: async (to, subject, text, options) => sent.push({ channel: 'email', to, subject, text, options }) },
    './messageTemplates': templates, '../util/log': { warn: (key, err) => assert.fail(err.message) },
  };
  const context = { module: { exports: {} }, require: key => mocks[key] };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/transports'), 'utf8'), context);
  await context.module.exports.fanout(1, 'request_approved', { request_number: 'REQ-ACTUAL' });
  assert.equal(sent[0].subject, 'Approved REQ-ACTUAL');
  assert.match(sent[0].text, /Actual Staff/);
  assert.doesNotMatch(sent[0].text, /Ama Mensah/);
  assert.match(sent[0].options.html, /Actual Staff/);
  assert.equal(sent[1].text, 'UITS: Ready: REQ-ACTUAL');
});

test('SMTP receives the designed HTML, plain text alternative and embedded crest', async () => {
  let sent;
  const mocks = {
    './settings': { get: async (key, fallback) => ({ mail_host: 'fixture.test' }[key] ?? fallback) },
    '../util/log': { info() {}, warn() {} },
    nodemailer: { createTransport: () => ({ sendMail: async message => { sent = message; } }) },
    './emailLayout': require('../src/services/emailLayout'), path: require('node:path'),
  };
  const context = { module: { exports: {} }, __dirname: require('node:path').resolve(__dirname, '../src/services'), require: key => mocks[key], process: { env: {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/email'), 'utf8'), context);
  await context.module.exports.send('fixture@test', 'Subject', 'Plain body');
  assert.equal(sent.text, 'Plain body');
  assert.match(sent.html, /src="cid:knust-logo"/);
  assert.equal(sent.attachments[0].cid, 'knust-logo');
  assert.equal(sent.subject, '[UITS VMTL] Subject');
});

test('installed mail transport generates HTML and embedded-logo MIME without sending over the network', async () => {
  const mailer = require('nodemailer');
  const stream = mailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  let output;
  const context = { module: { exports: {} }, __dirname: require('node:path').resolve(__dirname, '../src/services'), process: { env: {} }, require: key => {
    if (key === './settings') return { get: async (key, fallback) => key === 'mail_host' ? 'fixture.test' : fallback };
    if (key === '../util/log') return { warn() {}, info() {} };
    if (key === 'nodemailer') return { createTransport: () => ({ sendMail: async message => { output = await stream.sendMail(message); } }) };
    if (key === './emailLayout') return require('../src/services/emailLayout');
    return require(key);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/email'), 'utf8'), context);
  const out = await context.module.exports.send('preview@example.test', 'Preview', 'Preview body');
  assert.equal(out.ok, true);
  const mime = output.message.toString();
  assert.match(mime, /Content-Type: text\/plain/);
  assert.match(mime, /Content-Type: text\/html/);
  assert.match(mime, /Content-ID: <knust-logo>/);
});

test('template preview and editing routes require a system administrator; preview does not save drafts', async () => {
  const db = require('../src/db/sqlite');
  db.exec("INSERT INTO users(id,name,email,password_hash,is_super_admin) VALUES(1,'Owner','owner@test','x',1),(2,'Staff','staff@test','x',0)");
  const express = require('express');
  const app = require('../src/middleware/asyncSafe').asyncSafe(express());
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.headers['x-test-user'] || 0)) }; next(); });
  require('../src/routes/api/admin')(app);
  app.use(require('../src/middleware/errorHandler'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/admin/messaging/email`;
  const request = (user, data) => fetch(url + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, body: JSON.stringify(data) });
  try {
    assert.equal((await fetch(url + '/templates')).status, 401);
    assert.equal((await request(2, { template: 'test' })).status, 403);
    const before = (await templates.catalogue('email')).templates.test_body;
    const response = await request(1, { template: 'test', draft: { test_body: 'Draft for {recipient_name}' } });
    assert.equal(response.status, 200);
    assert.match((await response.json()).data.html, /Draft for Ama Mensah/);
    assert.equal((await templates.catalogue('email')).templates.test_body, before);
    assert.equal((await request(1, { template: 'unknown' })).status, 400);
    const denied = await fetch(url + '/templates', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-user': '2' }, body: JSON.stringify({ templates: { test_body: 'Disallowed' } }) });
    assert.equal(denied.status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
