'use strict';

// File server for uploaded files (and backup copies). Set up on the File
// Server page (see fileServer.js); one of:
//   s3        any S3-compatible server: MinIO, AWS S3, Cloudflare R2, Backblaze B2, Wasabi
//   supabase  Supabase Storage
//   folder    a folder on this machine (a Fly volume or a mounted network share)
//   database  no file server: callers keep bytes in the database, as before.
//
// Each saved key starts with where it lives ("s3:", "sb:", "fs:"), so files
// stay readable after the server is switched (as long as the old one's
// settings are kept). Keys with no prefix are older Supabase Storage keys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('../util/log');
const fileServer = {PROVIDER_NAMES:{s3:'S3-compatible',supabase:'Supabase Storage',folder:'Server folder'}};

const TIMEOUT = Number(process.env.STORAGE_TIMEOUT_MS || 60000);
const PREFIX = { s3: 's3:', supabase: 'sb:', folder: 'fs:' };
const encodeKey = (key) => String(key).split('/').map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest();

// ---- Supabase Storage ------------------------------------------------------
const supabase = (c) => {
  const headers = (extra = {}) => ({ Authorization: `Bearer ${c.serviceKey}`, apikey: c.serviceKey, ...extra });
  const base = `${c.url}/storage/v1/object`;
  return {
    ready: () => Boolean(c.url && c.serviceKey && c.bucket),
    async put(key, data, type) {
      const res = await fetch(`${base}/${c.bucket}/${encodeKey(key)}`, { method: 'POST', headers: headers({ 'Content-Type': type, 'x-upsert': 'true' }), body: data, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new Error(`Supabase Storage refused the file (HTTP ${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
    async get(key) {
      const res = await fetch(`${base}/authenticated/${c.bucket}/${encodeKey(key)}`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT) });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Supabase Storage read failed (HTTP ${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(key) { const res = await fetch(`${base}/${c.bucket}/${encodeKey(key)}`, { method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(TIMEOUT) }); return res.ok || res.status === 404; },
  };
};

// ---- S3-compatible (AWS Signature Version 4) -------------------------------
const s3 = (c) => {
  const region = c.region || 'us-east-1';
  const objectKey = (key) => (c.prefix ? `${c.prefix}/${key}` : key);
  function target(key) {
    const ep = new URL(/^https?:\/\//.test(c.endpoint) ? c.endpoint : `https://${c.endpoint}`);
    if (c.pathStyle) return new URL(`${ep.origin}/${encodeURIComponent(c.bucket)}/${encodeKey(objectKey(key))}`);
    return new URL(`${ep.protocol}//${c.bucket}.${ep.host}/${encodeKey(objectKey(key))}`);
  }
  async function send(method, key, body, type) {
    const url = target(key);
    const now = new Date(); const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); const day = amzDate.slice(0, 8);
    const payloadHash = sha256(body || '');
    const signed = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = [method, url.pathname, '', `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`, signed, payloadHash].join('\n');
    const scope = `${day}/${region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const key4 = hmac(hmac(hmac(hmac('AWS4' + c.secretAccessKey, day), region), 's3'), 'aws4_request');
    const signature = crypto.createHmac('sha256', key4).update(toSign).digest('hex');
    const headers = { 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
    if (type) headers['Content-Type'] = type;
    return fetch(url, { method, headers, body: body || undefined, signal: AbortSignal.timeout(TIMEOUT) });
  }
  const detail = async (res) => { const t = await res.text().catch(() => ''); return (t.match(/<Message>([^<]+)<\/Message>/) || [])[1] || (t.match(/<Code>([^<]+)<\/Code>/) || [])[1] || t.slice(0, 160); };
  return {
    ready: () => Boolean(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey),
    async put(key, data, type) { const res = await send('PUT', key, data, type); if (!res.ok) throw new Error(`The S3 server refused the file (HTTP ${res.status}): ${await detail(res)}`); },
    async get(key) { const res = await send('GET', key); if (res.status === 404) return null; if (!res.ok) throw new Error(`S3 read failed (HTTP ${res.status}): ${await detail(res)}`); return Buffer.from(await res.arrayBuffer()); },
    async remove(key) { const res = await send('DELETE', key); return res.ok || res.status === 404; },
  };
};

// ---- Folder on this machine ------------------------------------------------
const folder = (c) => {
  const base = path.resolve(String(c.path || ''));
  const full = (key) => { const p = path.resolve(base, ...String(key).split('/')); if (!p.startsWith(base + path.sep)) throw new Error('Invalid file key.'); return p; };
  return {
    ready: () => Boolean(c.path),
    async put(key, data) {
      const p = full(key); await fs.promises.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${crypto.randomUUID()}.part`;
      await fs.promises.writeFile(tmp, data); await fs.promises.rename(tmp, p);
    },
    async get(key) { try { return await fs.promises.readFile(full(key)); } catch (err) { if (err.code === 'ENOENT') return null; throw err; } },
    async remove(key) { try { await fs.promises.unlink(full(key)); return true; } catch (err) { return err.code === 'ENOENT'; } },
  };
};

const ADAPTERS = { s3, supabase, folder };
function adapterFor(cfg, provider) { const make = ADAPTERS[provider]; return make ? make(cfg[provider]) : null; }
function split(key) {
  const k = String(key || '');
  for (const [provider, prefix] of Object.entries(PREFIX)) if (k.startsWith(prefix)) return { provider, key: k.slice(prefix.length) };
  return { provider: 'supabase', key: k }; // older keys, written before the File Server page
}

// Write, read back and delete a small file with the given (unsaved) settings.
async function test(provider, settings) {
  const started = Date.now();
  const adapter = ADAPTERS[provider] && ADAPTERS[provider](settings || {});
  if (!adapter) return { ok: false, provider, message: 'Choose a file server type to test.' };
  if (!adapter.ready()) return { ok: false, provider, message: 'Fill in every required setting first.' };
  const key = `connection-tests/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.txt`;
  const body = Buffer.from(`UITS VMTL file server test ${new Date().toISOString()}`);
  try {
    await adapter.put(key, body, 'text/plain');
    const back = await adapter.get(key);
    if (!back || !Buffer.from(back).equals(body)) throw new Error('The test file was saved but did not read back the same.');
    const removed = await adapter.remove(key);
    return { ok: true, provider, ms: Date.now() - started, message: removed ? 'Saved, read back and deleted a test file.' : 'Saved and read back a test file, but could not delete it (check delete permission).' };
  } catch (err) {
    return { ok: false, provider, ms: Date.now() - started, message: err.name === 'TimeoutError' ? 'The file server did not answer in time.' : (err.cause && err.cause.code) ? `${err.message} (${err.cause.code})` : err.message };
  }
}

module.exports = {adapterFor,test};
