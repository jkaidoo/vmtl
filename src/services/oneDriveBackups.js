'use strict';
// OneDrive (Microsoft 365) backup destinations. Each destination is a OneDrive
// account connected once by the App Owner; the app stores only an encrypted
// refresh token and uploads the latest database snapshot on a schedule, keeping
// a fixed number of copies in a "VMTL Backups" folder. The Entra app registration
// is shared with ./microsoft365.
const crypto = require('crypto');
const fs = require('fs');
const microsoft = require('./microsoft365');
const backups = require('./backups');
const db = require('../db/runtime');
const settings = require('./settings');
const log = require('../util/log');

const KEY = 'onedrive_backup_config';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'openid profile offline_access User.Read Files.ReadWrite';
const FOLDER = 'VMTL Backups';
const PREFIX = 'vmtl-cloud-';
const REMOTE_RE = /^vmtl-cloud-.+\.json$/;
const LOCAL_KEEP = 3; // transient local copies of cloud backups
let fetchImpl = (...args) => fetch(...args);
let running = false;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

const read = async () => {
  const raw = await settings.get(KEY, null);
  let obj = {};
  if (raw != null) { if (typeof raw === 'object') obj = raw; else { try { obj = JSON.parse(raw) || {}; } catch (_) { obj = {}; } } }
  return { accounts: [], interval_hours: 24, retention: 30, ...obj };
};
const save = value => settings.set(KEY, JSON.stringify(value));

// Web requests and the scheduler may update the same destination concurrently;
// serialize config mutations in-process so one never clobbers another.
let mutation = Promise.resolve();
function mutate(change) {
  const apply = async () => { const c = await read(); change(c); await save(c); };
  const result = mutation.then(apply); mutation = result.catch(() => {}); return result;
}
const redirect = cfg => microsoft.redirectUri(cfg);
const ACTIVE_PHASES = new Set(['queued', 'preparing', 'verifying', 'uploading', 'finalizing']);
function publicProgress(a) {
  const p = a.progress || null;
  if (p && ACTIVE_PHASES.has(p.phase) && p.phase !== 'queued' && Number(a.lease_until || 0) <= Date.now()) {
    return { ...p, phase: 'failed', error: 'Backup was interrupted. Retry the upload.', updated_at: new Date().toISOString() };
  }
  return p;
}

async function isOwner(userId) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  return Boolean(user && user.active && user.is_super_admin);
}

async function status() {
  const c = await read();
  return { configured: (await microsoft.config()).configured, interval_hours: c.interval_hours, retention: c.retention,
    folder: FOLDER, accounts: c.accounts.map(a => {
      const { token, pending_name, lease_until, lease_id, ...safe } = a;
      return { ...safe, progress: publicProgress(a), connected: Boolean(token && microsoft.decrypt(token)), pending: Boolean(pending_name) };
    }) };
}
// The request returns immediately; progress is persisted so refreshes see the
// same job and the scheduler picks up queued requests after a restart.
async function startUpload(id) {
  let busy = false;
  await mutate(c => {
    const a = c.accounts.find(x => x.id === id);
    if (!a) fail('Backup account not found.');
    if (a.progress?.phase === 'queued' || Number(a.lease_until || 0) > Date.now()) { busy = true; return; }
    a.progress = { id: crypto.randomUUID(), phase: 'queued', uploaded_bytes: 0, total_bytes: 0, percent: 0, updated_at: new Date().toISOString() };
  });
  if (!busy) setImmediate(() => run(id).catch(err => log.error('onedrive_backup_failed', { message: err.message })));
  return { accepted: true, busy, account: (await status()).accounts.find(a => a.id === id) };
}
async function configure(input) {
  const changes = {};
  for (const [key, max] of [['interval_hours', 720], ['retention', 100]]) {
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < 1 || n > max) fail(`Enter ${key.replace('_', ' ')} between 1 and ${max}.`);
    changes[key] = n;
  }
  await mutate(c => Object.assign(c, changes)); return status();
}
async function startConnect(userId, email) {
  if (!await isOwner(userId)) fail('Only the active App Owner may connect a backup account.');
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254) fail('Enter a valid backup account email.');
  const cfg = await microsoft.config();
  if (!cfg.configured) fail('Configure the Microsoft 365 app on this page first.');
  const c = await read();
  if (c.accounts.length >= 10 && !c.accounts.some(a => a.email === email)) fail('Up to ten backup accounts can be connected.');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  await settings.set(`onedrive_pending_${nonce}`, JSON.stringify({ userId, email, verifier, expires: Date.now() + 600000 }));
  return `${microsoft.AUTH_HOST}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', redirect_uri: await redirect(cfg), response_mode: 'query',
    scope: SCOPES, state: `backup.${nonce}`, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', prompt: 'select_account', login_hint: email,
  })}`;
}
async function tokens(body) {
  const cfg = await microsoft.config();
  const res = await fetchImpl(`${microsoft.AUTH_HOST}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secret, scope: SCOPES, ...body }),
  });
  const data = await res.json();
  if (!res.ok) fail(['invalid_grant', 'interaction_required', 'consent_required'].includes(data.error)
    ? 'Microsoft requires this backup account to reconnect.' : 'Microsoft token request failed. Check the Microsoft 365 app configuration.');
  return data;
}
async function graph(token, method, path, body) {
  if (!path.startsWith('/')) fail('Invalid Microsoft Graph path.');
  const res = await fetchImpl(GRAPH + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!res.ok) { const err = new Error(`OneDrive request failed (HTTP ${res.status}). Check consent, storage quota and account access.`); err.status = res.status; throw err; }
  return res.status === 204 ? null : res.json();
}
async function finishConnect({ state, code, error }) {
  if (!/^backup\.[A-Za-z0-9_-]{32}$/.test(String(state))) fail('Invalid backup sign-in response.');
  const key = `onedrive_pending_${state.slice(7)}`;
  const pendingValue = await settings.get(key, null);
  await settings.set(key, ''); // consume the one-time nonce
  const p = pendingValue ? JSON.parse(typeof pendingValue === 'object' ? JSON.stringify(pendingValue) : pendingValue) : null;
  if (!p || p.expires < Date.now()) fail('Backup sign-in expired. Connect again.');
  if (!await isOwner(p.userId)) fail('Only the active App Owner may connect a backup account.');
  if (error || !code) fail('Microsoft sign-in was cancelled or denied.');
  const cfg = await microsoft.config();
  const t = await tokens({ grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: await redirect(cfg) });
  if (!t.refresh_token || !/(^|\s)Files.ReadWrite(\s|$)/i.test(t.scope || '')) fail('Microsoft did not grant offline file access.');
  const me = await graph(t.access_token, 'GET', '/me?$select=id,mail,userPrincipalName');
  if (![me.mail, me.userPrincipalName].some(x => String(x || '').toLowerCase() === p.email)) fail(`Sign in with ${p.email} to connect this destination.`);
  const drive = await graph(t.access_token, 'GET', '/me/drive?$select=id');
  const folder = await ensureFolder(t.access_token, drive.id);
  await mutate(c => {
    const old = c.accounts.find(a => a.email === p.email);
    if (!old && c.accounts.length >= 10) fail('Up to ten backup accounts can be connected.');
    if (c.accounts.some(a => a.email !== p.email && a.drive_id === drive.id)) fail('This OneDrive is already connected under another email.');
    const account = { ...old, id: old?.id || crypto.randomUUID(), email: p.email, enabled: old?.enabled ?? false,
      token: microsoft.encrypt(t.refresh_token), drive_id: drive.id, folder_id: folder.id, connected_at: new Date().toISOString(), last_error: '' };
    c.accounts = [...c.accounts.filter(a => a.email !== p.email), account];
  });
  return { userId: p.userId, email: p.email };
}
async function ensureFolder(token, driveId) {
  const root = `/drives/${encodeURIComponent(driveId)}/root`;
  try { const f = await graph(token, 'GET', `${root}:/${encodeURIComponent(FOLDER)}`); if (!f.folder) fail(`${FOLDER} exists but is not a folder.`); return f; }
  catch (err) { if (err.status !== 404) throw err; }
  return graph(token, 'POST', `${root}/children`, { name: FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
}
async function updateAccount(id, input) {
  await mutate(c => {
    const a = c.accounts.find(a => a.id === id);
    if (!a) fail('Backup account not found.');
    if (input.remove === true) c.accounts = c.accounts.filter(a => a.id !== id);
    else if (typeof input.enabled === 'boolean') {
      if (input.enabled && !microsoft.decrypt(a.token)) fail('Reconnect this account first.');
      a.enabled = input.enabled;
    }
  });
  return status();
}
// Merge changes into the current settings so a background upload cannot undo an
// administrator disabling/removing a destination while the upload is running.
async function patchAccount(id, changes) {
  await mutate(c => { const a = c.accounts.find(a => a.id === id); if (a) Object.assign(a, changes); });
}
async function upload(token, a, file, name, report) {
  const size = fs.statSync(file).size;
  // Three equally weighted steps: prepare, verify, upload.
  await report({ phase: 'uploading', total_bytes: size, uploaded_bytes: 0, percent: 66 });
  const base = `/drives/${encodeURIComponent(a.drive_id)}/items/${encodeURIComponent(a.folder_id)}`;
  const session = await graph(token, 'POST', `${base}:/${encodeURIComponent(PREFIX + name)}:/createUploadSession`, { item: { '@microsoft.graph.conflictBehavior': 'replace' } });
  if (!session.uploadUrl?.startsWith('https://')) fail('Microsoft returned an invalid upload session.');
  const fd = fs.openSync(file, 'r'); let result;
  try {
    for (let offset = 0; offset < size;) {
      const chunk = Buffer.alloc(Math.min(10 * 327680, size - offset));
      const n = fs.readSync(fd, chunk, 0, chunk.length, offset);
      if (n !== chunk.length) fail('Backup file could not be read completely.');
      const res = await fetchImpl(session.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(n), 'Content-Range': `bytes ${offset}-${offset + n - 1}/${size}` }, body: chunk, signal: AbortSignal.timeout(120000) });
      if (![200, 201, 202].includes(res.status)) fail(`OneDrive upload failed (HTTP ${res.status}); it will retry automatically.`);
      result = await res.json(); offset += n;
      if (offset === size && ![200, 201].includes(res.status)) fail('OneDrive has not confirmed the completed upload.');
      await report({ uploaded_bytes: offset, percent: Math.min(99, Math.floor((2 + offset / size) / 3 * 100)) });
    }
  } finally { fs.closeSync(fd); }
  if (!result?.id || Number(result.size) !== size) fail('OneDrive upload size verification failed.');
  return { base, result };
}
async function prune(token, base, keep) {
  let path = `${base}/children?$select=id,name,file,createdDateTime&$top=200`; const files = [];
  while (path) {
    const page = await graph(token, 'GET', path);
    files.push(...page.value.filter(x => x.file && REMOTE_RE.test(x.name)));
    const next = page['@odata.nextLink'];
    if (next && !next.startsWith(GRAPH + '/')) fail('Invalid OneDrive pagination response.');
    path = next ? next.slice(GRAPH.length) : null;
  }
  files.sort((a, b) => b.name.localeCompare(a.name));
  for (const file of files.slice(keep)) await graph(token, 'DELETE', `${base.slice(0, base.indexOf('/items/'))}/items/${encodeURIComponent(file.id)}`);
}
async function run(forceId) {
  if (running) return { busy: true };
  running = true;
  try {
    const c = await read(); const results = [];
    const due = c.accounts.filter(a => forceId ? a.id === forceId : a.progress?.phase === 'queued' || (a.enabled && Date.now() - (Date.parse(a.last_success || '') || 0) >= c.interval_hours * 3600000));
    let fresh;
    for (const candidate of due) {
      let a;
      const lease = crypto.randomUUID();
      await mutate(current => {
        const found = current.accounts.find(x => x.id === candidate.id);
        if (!found || Number(found.lease_until || 0) > Date.now()) return;
        if (!forceId && found.progress?.phase !== 'queued' && (!found.enabled || Date.now() - (Date.parse(found.last_success || '') || 0) < current.interval_hours * 3600000)) return;
        found.lease_id = lease; found.lease_until = Date.now() + 3600000;
        found.progress = { id: found.progress?.phase === 'queued' ? found.progress.id : crypto.randomUUID(), phase: 'preparing', uploaded_bytes: 0, total_bytes: 0, percent: 0, updated_at: new Date().toISOString() };
        a = { ...found };
      });
      if (!a) continue;
      let file;
      const report = async changes => mutate(current => {
        const found = current.accounts.find(x => x.id === a.id);
        if (found?.lease_id === lease) {
          found.progress = { ...found.progress, ...changes, updated_at: new Date().toISOString() };
          found.lease_until = Date.now() + 3600000;
        }
      });
      try {
        await patchAccount(a.id, { last_attempt: new Date().toISOString() });
        const refresh = microsoft.decrypt(a.token); if (!refresh) fail('Reconnect this backup account.');
        const t = await tokens({ grant_type: 'refresh_token', refresh_token: refresh });
        if (t.refresh_token) await patchAccount(a.id, { token: microsoft.encrypt(t.refresh_token) });
        let name = a.pending_name;
        if (name) file = await backups.existingPath(name);
        if (!file) {
          if (!fresh) { fresh = await backups.exclusive(() => backups.create('OneDrive automatic backup')); }
          name = fresh.name; await patchAccount(a.id, { pending_name: name }); file = await backups.existingPath(name);
        }
        if (!file) fail('Backup file is unavailable.');
        await report({ phase: 'verifying', percent: 33 });
        try { await backups.read(name); } catch (_) { fail('Backup verification failed.'); }
        const { base, result } = await upload(t.access_token, a, file, name, report);
        await report({ phase: 'finalizing', percent: 99 });
        await patchAccount(a.id, { last_success: new Date().toISOString(), last_backup: name, last_error: '', pending_name: null, remote_item_id: result.id });
        let warning = '';
        try { await prune(t.access_token, base, c.retention); }
        catch (_) { warning = 'Backup uploaded, but old copies could not be removed. Check OneDrive access.'; }
        await report({ phase: 'completed', percent: 100, warning, finished_at: new Date().toISOString() });
        results.push({ id: a.id, ok: true });
      } catch (err) {
        await patchAccount(a.id, { last_error: err.message });
        await report({ phase: 'failed', error: err.message, finished_at: new Date().toISOString() });
        results.push({ id: a.id, ok: false, error: err.message });
      } finally {
        await mutate(current => {
          const found = current.accounts.find(x => x.id === a.id);
          if (found?.lease_id === lease) { delete found.lease_id; delete found.lease_until; }
        });
      }
    }
    // Keep only a few transient local copies; the retention count lives in OneDrive.
    if (fresh) { try { await backups.pruneByLabel('OneDrive automatic backup', LOCAL_KEEP); } catch (_) { /* best effort */ } }
    return { results, busy: due.length > 0 && results.length === 0 };
  } finally { running = false; }
}
module.exports = { status, configure, startConnect, finishConnect, updateAccount, startUpload, run, setFetch: fn => { fetchImpl = fn || ((...args) => fetch(...args)); } };
