'use strict';
// Human-readable sequence numbers, e.g. REQ-00031 / TRIP-00031. Derived from the
// max existing numeric suffix for the column so numbers stay stable and unique.
const db = require('../db/runtime');

async function next(table, column, prefix) {
  const rows = await db.all(`SELECT ${column} AS n FROM ${table} WHERE ${column} LIKE ?`, [`${prefix}-%`]);
  let max = 0;
  for (const r of rows) {
    const m = String(r.n || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(5, '0')}`;
}

module.exports = { next };
