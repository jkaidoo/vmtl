'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(fetch) {
  const values = { unified_api_url: 'http://staff.test', unified_api_key: 'test-key' };
  const context = {
    module: { exports: {} }, __dirname: path.join(__dirname, '../src/services'),
    process: { env: {} }, AbortSignal, fetch, Buffer,
    require: (name) => name === './settings'
      ? { get: async (key, fallback) => values[key] ?? fallback, set: async (key, value) => { values[key] = value; } }
      : name === './staffPhoto' ? require('../src/services/staffPhoto') : require(name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/unifiedApi.js'), 'utf8'), context);
  return context.module.exports;
}

test('default diagnostics reaches staff search with a valid query, even with zero matches', async () => {
  let requested;
  const api = client(async (url) => {
    requested = new URL(url);
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  });
  const report = await api.status();
  assert.equal(requested.pathname, '/staff/search');
  assert.ok(requested.searchParams.get('q').length >= 2);
  assert.equal(report.checks[0].ok, true);
});

test('short diagnostic queries explain validation failure without contacting the API', async () => {
  const api = client(async () => { assert.fail('Invalid search must not make a request'); });
  const report = await api.status('a');
  assert.equal(report.checks[0].ok, false);
  assert.match(report.checks[0].detail, /at least two characters/);
});

test('diagnostics reports upstream authentication failure', async () => {
  const api = client(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Invalid API key' }) }));
  const report = await api.status();
  assert.equal(report.checks[0].ok, false);
  assert.equal(report.checks[0].detail, 'Invalid API key');
});

test('saved field switches filter manual search and profiles on the server', async () => {
  const api = client(async (url) => ({ ok: true, status: 200, json: async () => url.includes('/search?')
    ? { results: [{ id_number: '123', full_name: '<Staff>', email: 'staff@test', designation_group: 'Officer', unexpected: 'hidden' }] }
    : { found: true, id_number: '123', fields: { rank: 'Senior', department: 'IT', unexpected: 'hidden' } } }));
  await api.saveFields({ email: false, rank: false, org_unit: false, unexpected: true });
  const search = await api.manualSearch('staff');
  assert.equal(search.results[0].fields.full_name, '<Staff>');
  assert.equal(search.results[0].fields.designation, 'Officer');
  assert.equal(search.results[0].fields.email, undefined);
  assert.equal(search.results[0].fields.unexpected, undefined);
  const profile = await api.manualProfile('123');
  assert.equal(profile.fields.rank, undefined);
  assert.equal(profile.fields.department, 'IT');
  assert.equal((await api.fieldSettings()).find((f) => f.key === 'org_unit').enabled, false);
  await api.saveFields({ email: true });
  assert.equal((await api.fieldSettings()).find((f) => f.key === 'rank').enabled, false);
  assert.equal((await api.manualSearch('staff')).results[0].fields.email, 'staff@test');
});

test('staff photo endpoint supplies a validated avatar and respects the field switch', async () => {
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
  let calls = 0;
  const api = client(async (url, options) => {
    calls++;
    assert.equal(url, 'http://staff.test/staff/42/photo');
    assert.equal(options.headers['x-api-key'], 'test-key');
    return { ok: true, json: async () => ({ found: true, photo_url: photo }) };
  });
  assert.equal(await api.staffPhoto('42'), photo);
  await api.saveFields({ photo_url: false });
  assert.equal(await api.staffPhoto('42'), null);
  assert.equal(calls, 1);
});

test('photo failures are optional and do not fail staff profiles', async () => {
  const api = client(async (url) => {
    if (url.endsWith('/photo')) throw new Error('Photo service unavailable');
    return { ok: true, status: 200, json: async () => ({ found: true, id_number: '42', fields: { department: 'IT' } }) };
  });
  const out = await api.manualProfile('42');
  assert.equal(out.status, 'found');
  assert.equal(out.fields.department, 'IT');
  assert.equal(out.fields.photo_url, null);
});

test('manual staff search forwards usernames and email addresses without changing them', async () => {
  const queries = [];
  const api = client(async (url) => {
    queries.push(new URL(url).searchParams.get('q'));
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  });
  await api.manualSearch('jdoe');
  await api.manualSearch('jdoe@knust.edu.gh');
  assert.deepEqual(queries, ['jdoe', 'jdoe@knust.edu.gh']);
});
