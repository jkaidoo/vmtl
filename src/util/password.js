'use strict';
const bcrypt = require('bcryptjs');
// Password hashing for local accounts. Directory (LDAP/AD) accounts never store
// a usable hash — they authenticate against the directory on each sign-in.
function hashPassword(plain) { return bcrypt.hashSync(String(plain), 10); }
function verifyPassword(plain, hash) {
  if (!hash) return false;
  try { return bcrypt.compareSync(String(plain), String(hash)); } catch (_) { return false; }
}

// Password policy: at least PASSWORD_MIN characters, with an uppercase letter, a
// lowercase letter, a digit and a non-alphanumeric character. Returns an array of
// problems (empty when compliant) so callers can surface per-field error messages.
const PASSWORD_MIN = 8;
function passwordProblems(plain) {
  const s = String(plain == null ? '' : plain);
  const problems = [];
  if (s.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (!/[A-Z]/.test(s)) problems.push('Add an uppercase letter.');
  if (!/[a-z]/.test(s)) problems.push('Add a lowercase letter.');
  if (!/[0-9]/.test(s)) problems.push('Add a digit.');
  if (!/[^A-Za-z0-9]/.test(s)) problems.push('Add a symbol (a non-letter, non-digit character).');
  return problems;
}
function isStrongPassword(plain) { return passwordProblems(plain).length === 0; }

module.exports = { hashPassword, verifyPassword, passwordProblems, isStrongPassword, PASSWORD_MIN };
