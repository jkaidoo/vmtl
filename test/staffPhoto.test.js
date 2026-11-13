'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalise } = require('../src/services/staffPhoto');
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

test('normalises binary and base64 photos and rejects non-images or oversized pictures', async () => {
  const expected = `data:image/png;base64,${photo.toString('base64')}`;
  assert.equal(await normalise(photo.toJSON()), expected);
  assert.equal(await normalise(photo.toString('base64')), expected);
  assert.equal(await normalise('data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')), null);
  assert.equal(await normalise({ type: 'Buffer', data: Array(1_400_001).fill(0) }), null);
});

test('loads allowlisted photo URLs without forwarding the Unified API key', async () => {
  const result = await normalise('https://webapps.knust.edu.gh/photo/42', {
    baseUrl: 'https://staff.test', fetchImpl: async (url, options) => {
      assert.equal(options.headers['x-api-key'], undefined);
      assert.equal(options.redirect, 'manual');
      return { ok: true, status: 200, arrayBuffer: async () => photo };
    },
  });
  assert.ok(result.startsWith('data:image/png;base64,'));
});

test('rejects unknown hosts and redirects outside the image allowlist', async () => {
  const options = { baseUrl: 'https://staff.test', fetchImpl: async () => assert.fail('Unknown host must not be requested') };
  assert.equal(await normalise('https://unknown.test/photo', options), null);
  let calls = 0;
  options.fetchImpl = async () => { calls++; return { status: 302, headers: { get: () => 'http://127.0.0.1/private' } }; };
  assert.equal(await normalise('https://staff.test/photo', options), null);
  assert.equal(calls, 1);
});
