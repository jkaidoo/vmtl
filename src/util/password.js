'use strict';
const bcrypt = require('bcryptjs');
// Password hashing for local accounts. Directory (LDAP/AD) accounts never store
// a usable hash — they authenticate against the directory on each sign-in.
function hashPassword(plain) { return bcrypt.hashSync(String(plain), 10); }
function verifyPassword(plain, hash) {
  if (!hash) return false;
  try { return bcrypt.compareSync(String(plain), String(hash)); } catch (_) { return false; }
}
module.exports = { hashPassword, verifyPassword };
