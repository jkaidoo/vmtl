'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/services/settings');
const consoleApi = require('../src/services/unifiedApiConsole');
const base = require('../src/services/unifiedApi');

test('mirrored console learns fields, saves labels/order, shows staff photos and keeps import switches consistent', async () => {
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', sources: { staff: 'ok', students: 'ok', admissions: 'ok' } }));
    assert.equal(req.headers['x-api-key'], 'fixture-key');
    if (req.url === '/staff/42/photo') return res.end(JSON.stringify({ found: true, photo_url: photo }));
    if (req.url.startsWith('/staff/search')) return res.end(JSON.stringify({ results: [{ id_number: '42', full_name: 'Example Staff' }] }));
    const type = req.url.startsWith('/students') ? 'STUDENT' : req.url.startsWith('/admissions') ? 'APPLICANT' : 'STAFF';
    res.end(JSON.stringify({ found: true, id_number: '42', type, full_name: 'Example Staff', fields: { department: 'IT', rank: 'Officer', custom_code: 'A1', courses: [{ code: 'CS1', title: 'Computing' }] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await consoleApi.saveSettings({ url: `http://127.0.0.1:${server.address().port}`, key: 'fixture-key', enabled: true, timeout_ms: 5000 });
    const publicSettings = await consoleApi.publicSettings();
    assert.equal(publicSettings.key, undefined);
    assert.equal(publicSettings.timeout_ms, 5000);
    assert.equal((await consoleApi.status()).reachable, true);
    let result = await consoleApi.testLookup('42', { source: 'STAFF' });
    assert.equal(result.photo_url, photo);
    assert.ok(result.fields.find(f => f.key === 'courses').list.rows.length);
    let catalogue = await consoleApi.fieldSettings();
    assert.ok(catalogue.STAFF.find(f => f.key === 'custom_code'));
    await consoleApi.saveFieldLabel({ type: 'STAFF', key: 'rank', label: 'Job rank' });
    await consoleApi.saveFieldOrder({ type: 'STAFF', keys: ['custom_code', 'rank'] });
    catalogue = await consoleApi.saveFieldSettings({ STAFF: { rank: false, photo_url: false, org_unit: false } });
    assert.equal(catalogue.STAFF[0].key, 'custom_code');
    assert.equal(catalogue.STAFF.find(f => f.key === 'rank').label, 'Job rank');
    assert.equal((await base.fieldSettings()).find(f => f.key === 'photo_url').enabled, false);
    result = await consoleApi.testLookup('42', { source: 'STAFF' });
    assert.equal(result.photo_url, null);
    assert.equal(result.fields.find(f => f.key === 'rank').visible, false);
    assert.equal((await consoleApi.testLookup('42', { source: 'STUDENT' })).type, 'STUDENT');
    assert.equal((await consoleApi.testLookup('42', { source: 'PROSPECTIVE' })).type, 'PROSPECTIVE');
    const report = await consoleApi.testStaffSearch('Example');
    assert.equal(report.checks[0].code, 'HEALTH_OK');
    assert.equal(report.checks[1].code, 'MATCHES_FOUND');
    assert.ok(!JSON.stringify(report).includes('fixture-key'));
    await assert.rejects(consoleApi.saveSettings({ timeout_ms: 0 }), /Timeout/);
    await assert.rejects(consoleApi.testLookup('42', { source: 'BAD' }), /Choose/);
    await store.set('unified_api_enabled', '0');
    assert.equal((await consoleApi.testLookup('42')).reason, 'switched_off');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
