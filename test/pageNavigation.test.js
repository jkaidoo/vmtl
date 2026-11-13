'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Unified API navigation loads its renderer before any page helper', () => {
  const publicDir = path.join(__dirname, '../public');
  const html = fs.readFileSync(path.join(publicDir, 'unified-api.html'), 'utf8');
  // Match the SPA loader: shared shell scripts are excluded; the first remaining
  // script must register this page, rather than leave the previous renderer active.
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
  const entry = scripts.find(src => !/\/js\/(common|ui-system|vehicle-map)\.js(\?|$)/.test(src));
  assert.equal(entry, '/js/unified-api.js');
  assert.match(fs.readFileSync(path.join(publicDir, entry), 'utf8'), /window\.VMTL_PAGE\s*=\s*async function/);
});
