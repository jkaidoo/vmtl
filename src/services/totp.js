'use strict';

// Time-based one-time passwords (RFC 6238 / HOTP RFC 4226) for two-factor
// sign-in, implemented with Node's crypto so no extra dependency is needed.
// Compatible with Google Authenticator, Authy, 1Password, etc.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0; let value = 0; const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const idx = B32.indexOf(c); if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

// The current 6-digit code for a secret (used in tests; TOTP step = 30 s).
function generate(secret, t = Date.now()) { return hotp(secret, Math.floor(t / 1000 / 30)); }

// Verify a 6-digit token within a +/- 1 step (30 s) window.
function verify(secret, token, t = Date.now()) {
  const tok = String(token || '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(tok)) return false;
  const step = Math.floor(t / 1000 / 30);
  for (let w = -1; w <= 1; w += 1) if (hotp(secret, step + w) === tok) return true;
  return false;
}

function otpauthUrl(secret, label, issuer = 'UITS VMTL') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Recovery codes: 10 short codes; only their hashes are stored.
function generateRecoveryCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i += 1) codes.push(crypto.randomBytes(5).toString('hex').replace(/(.{5})(.{5})/, '$1-$2'));
  return codes;
}
const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toLowerCase()).digest('hex');

module.exports = { generateSecret, generate, verify, otpauthUrl, generateRecoveryCodes, hashCode };
