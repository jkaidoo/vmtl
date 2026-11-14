'use strict';
// Keep diagnostic structure while withholding credentials from log viewers.
module.exports = function redact(value, depth = 0) {
  if (depth > 12) return '[truncated]';
  if (Array.isArray(value)) return value.map(v => module.exports(v, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = /password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key/i.test(key) ? '[redacted]' : module.exports(item, depth + 1);
  return out;
};
