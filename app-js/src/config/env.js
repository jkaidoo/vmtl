'use strict';
// Tolerate common .env mistakes before anything reads process.env: a value
// accidentally written as `NAME=value`, surrounded by quotes, or padded with
// spaces. Returns the list of names it cleaned (for a boot warning).
function normalizeEnv(env = process.env) {
  const cleaned = [];
  for (const key of Object.keys(env)) {
    let value = env[key];
    if (typeof value !== 'string') continue;
    const original = value;
    // `NAME=NAME=value` -> `value`
    if (value.startsWith(`${key}=`)) value = value.slice(key.length + 1);
    value = value.trim();
    // Strip a single pair of surrounding quotes.
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (value !== original) { env[key] = value; cleaned.push(key); }
  }
  return cleaned;
}

module.exports = { normalizeEnv };
