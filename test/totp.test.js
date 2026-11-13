'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const totp = require('../src/services/totp');

test('TOTP generates a base32 secret and a verifiable code', () => {
  const secret = totp.generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.ok(secret.length >= 16);
  const code = totp.generate(secret);
  assert.match(code, /^\d{6}$/);
  assert.ok(totp.verify(secret, code), 'current code should verify');
});

test('TOTP accepts the previous/next 30s window', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const prev = totp.generate(secret, now - 30000);
  const next = totp.generate(secret, now + 30000);
  assert.ok(totp.verify(secret, prev, now));
  assert.ok(totp.verify(secret, next, now));
});

test('TOTP rejects malformed or wrong codes', () => {
  const secret = totp.generateSecret();
  assert.ok(!totp.verify(secret, 'abc'));
  assert.ok(!totp.verify(secret, ''));
  assert.ok(!totp.verify(secret, null));
  assert.ok(!totp.verify('', '123456'));
  // A code far outside the window should not verify.
  assert.ok(!totp.verify(secret, totp.generate(secret, Date.now() - 5 * 60000)));
});

test('recovery code hashing is case/whitespace-insensitive and stable', () => {
  const [code] = totp.generateRecoveryCodes(1);
  assert.match(code, /^[0-9a-f]{5}-[0-9a-f]{5}$/);
  assert.strictEqual(totp.hashCode(code), totp.hashCode(` ${code.toUpperCase()} `));
  assert.notStrictEqual(totp.hashCode(code), totp.hashCode('00000-00000'));
});

test('otpauth URL carries the secret and issuer', () => {
  const url = totp.otpauthUrl('ABCDEF', 'jdoe@knust.edu.gh');
  assert.ok(url.startsWith('otpauth://totp/'));
  assert.ok(url.includes('secret=ABCDEF'));
  assert.ok(url.includes('period=30'));
});
