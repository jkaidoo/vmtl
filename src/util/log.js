'use strict';
// Minimal structured logger. One JSON line per event in production, a readable
// line in development. Keeps a tiny in-memory ring buffer for App Health → Logs.
const isProd = process.env.NODE_ENV === 'production';
const buffer = [];
const MAX = 500;
const startedAt = new Date().toISOString();
const machine = require('node:os').hostname();
const redact = require('./redact');
let sequence = 0;

function emit(level, event, meta) {
  const entry = { ...redact(meta || {}), ...(meta?.id != null ? { request_id: meta.id } : {}), id: ++sequence, level, event, at: new Date().toISOString(), category: meta?.category || 'app' };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  const line = isProd ? JSON.stringify(entry) : `[${entry.at}] ${level.toUpperCase()} ${event} ${JSON.stringify(redact(meta || {}))}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  info: (event, meta) => emit('info', event, meta),
  warn: (event, meta) => emit('warn', event, meta),
  error: (event, meta) => emit('error', event, meta),
  success: (event, meta) => emit('success', event, meta),
  recent: (n = 100) => buffer.slice(-n).reverse(),
  find: id => buffer.find(entry => entry.id === Number(id)),
  infoAboutStore: () => ({ started_at: startedAt, machine, stored: buffer.length, capacity: MAX }),
};
