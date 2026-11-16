'use strict';
window.VMTL_PAGE = async function () {
  const { view, esc } = VMTL;
  if (!VMTL.ownerPage('backup-cleanup')) { view.innerHTML = '<div class="empty">App Owner access only.</div>'; return; }
  let tab = 'backup', rows = [], page = 1, query = '';
  const selected = new Set();
  const api = async (url = '', options) => (await VMTL.api('/admin/backups' + url, options)).data;
  view.innerHTML = VMTL.pageHead('Backup & cleanup', 'Protect your data and remove selected records. App Owner only.') + '<div class="tabs" id="backupTabs"><button class="active" data-tab="backup">Backup & restore</button><button data-tab="auto">Automatic & cloud</button><button data-tab="cleanup">Cleanup</button></div><div id="backupBody"></div>';
  const host = view.querySelector('#backupBody');
  const report = e => VMTL.showErrors(e);
  async function loadBackups() {
    const data = await api();
    host.innerHTML = `<div class="alert-accent amber mb"><strong>Keep a copy outside the app</strong><div class="dim">Backups contain application records, account hashes and saved settings. Store downloads securely. Server copies need persistent storage and do not include uploaded files, environment secrets or sign-in sessions.</div></div>
      <div class="card mb"><div class="card-head"><h3>Create a backup</h3>${VMTL.badge(data.runtime, 'blue')}</div><form class="card-body" id="createBackup"><div class="field"><label for="backupLabel">Label (optional)</label><input id="backupLabel" maxlength="120" placeholder="e.g. Before end-of-term cleanup"></div><button class="btn btn-primary" type="submit">Create backup</button></form></div>
      <div class="card"><div class="card-head"><h3>Saved backups</h3><button class="btn btn-sm" id="refreshBackups">Refresh</button></div><div class="card-body"><div class="table-wrap"><table class="data"><thead><tr><th>BACKUP</th><th>CREATED</th><th>SIZE</th><th>ACTIONS</th></tr></thead><tbody>${data.backups.length ? data.backups.map(b => `<tr><td><strong>${esc(b.label || 'Manual backup')}</strong><div class="rec-id">${esc(b.name)}</div></td><td>${esc(VMTL.fmtDateTime(b.created_at))}</td><td>${b.bytes ? (b.bytes / 1024).toFixed(1) + ' KB' : '—'}</td><td><div class="btn-row">${b.invalid ? VMTL.badge('Invalid', 'amber') : `<a class="btn btn-sm" href="/api/admin/backups/${encodeURIComponent(b.name)}/download" download>Download</a><button class="btn btn-sm" data-verify="${esc(b.name)}">Verify</button><button class="btn btn-sm" data-restore="${esc(b.name)}">Restore</button>`}<button class="btn btn-sm" data-remove="${esc(b.name)}">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="4" class="dim">No backups yet. Create your first backup above.</td></tr>'}</tbody></table></div></div></div>`;
    host.querySelector('#refreshBackups').onclick = () => loadBackups().catch(report);
    host.querySelector('#createBackup').onsubmit = async e => {
      e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true;
      try { await api('', { method: 'POST', body: { label: host.querySelector('#backupLabel').value } }); VMTL.toast('Backup created.', 'success'); await loadBackups(); } catch (err) { report(err); } finally { b.disabled = false; }
    };
    host.querySelectorAll('[data-verify]').forEach(b => b.onclick = async () => {
      b.disabled = true; try { await api('/' + b.dataset.verify + '/verify', { method: 'POST' }); VMTL.toast('Backup verified.', 'success'); } catch (err) { report(err); } finally { b.disabled = false; }
    });
    host.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
      if (!await VMTL.confirm('Permanently delete this saved backup?', { danger: true, confirmLabel: 'Delete backup' })) return;
      try { await api('/' + b.dataset.remove, { method: 'DELETE' }); await loadBackups(); } catch (err) { report(err); }
    });
    host.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => confirmAction('Restore backup', 'Replaces all application records and settings with this backup. A safety backup is created first. Other users should stop work during restoration.', async body => {
      await api('/' + b.dataset.restore + '/restore', { method: 'POST', body }); location.href = '/login.html';
    }, true));
  }
  function confirmAction(title, message, action, restore = false) {
    const m = VMTL.openModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div><form id="confirmAction"><div class="modal-body"><p>${esc(message)}</p>${restore ? '<div class="field"><label for="confirmWord">Type RESTORE</label><input id="confirmWord" name="confirmation" required pattern="RESTORE" autocomplete="off"></div>' : '<div class="field"><label for="cleanupReason">Deletion reason</label><textarea id="cleanupReason" name="reason" required minlength="5" maxlength="1000"></textarea></div>'}<div class="field"><label for="ownerPassword">App Owner password</label><input id="ownerPassword" name="password" type="password" required autocomplete="current-password"></div><div class="dim" role="alert" id="actionError"></div></div><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">${esc(title)}</button></div></form>`);
    m.el.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const b = e.target.querySelector('[type=submit]'); b.disabled = true;
      try { await action(Object.fromEntries(new FormData(e.target))); m.close(); } catch (err) { m.el.querySelector('#actionError').textContent = err.message; } finally { b.disabled = false; }
    };
  }
  async function loadCleanup() {
    rows = (await api('/cleanup/entries')).entries; page = 1; query = ''; selected.clear();
    host.innerHTML = '<div class="alert-accent amber mb"><strong>Permanent record cleanup</strong><div class="dim">Delete selected requests and their linked approvals, trips and stops. Linked odometer readings and live positions remain, with the trip reference cleared. A safety backup is required before deletion.</div></div><div class="card"><div class="card-head"><h3>Request entries</h3><button class="btn" id="deleteEntries" disabled>Delete selected entries</button></div><div class="card-body"><div class="field"><label for="cleanupSearch">Search entries</label><input type="search" id="cleanupSearch" placeholder="Request, destination, requester or status"></div><div id="cleanupList"></div></div></div>';
    host.querySelector('#cleanupSearch').oninput = e => { query = e.target.value.toLowerCase(); page = 1; selected.clear(); renderRows(); };
    host.querySelector('#deleteEntries').onclick = () => confirmAction('Delete selected entries', `Permanently delete ${selected.size} selected requests across pages, including linked trips and approvals? A safety backup will be created first.`, async body => {
      const out = await api('/cleanup/delete', { method: 'POST', body: { ...body, entries: [...selected] } });
      VMTL.toast(`${out.deleted} requests deleted. Safety backup saved.`, 'success'); await loadCleanup();
    });
    renderRows();
  }
  function renderRows() {
    const matches = rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(query)));
    const pages = Math.max(1, Math.ceil(matches.length / 10)); page = Math.min(page, pages);
    const list = host.querySelector('#cleanupList');
    list.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>SELECT</th><th>REQUEST</th><th>DESTINATION</th><th>ADDED BY</th><th>STATUS</th></tr></thead><tbody>${matches.slice((page - 1) * 10, page * 10).map(r => `<tr><td><input type="checkbox" data-id="${r.id}" aria-label="Select ${esc(r.request_number)}" ${selected.has(r.id) ? 'checked' : ''}></td><td><strong>${esc(r.request_number)}</strong><div class="rec-id">${esc(VMTL.fmtDateTime(r.created_at))}</div></td><td>${esc(r.destination)}<div class="dim">${esc(r.purpose)}</div></td><td>${esc(r.created_by || '—')}</td><td>${esc(r.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">No entries found.</td></tr>'}</tbody></table></div><div class="btn-row mt"><span class="dim">${matches.length} entries · Page ${page} of ${pages}</span><button class="btn btn-sm" id="prevEntries" ${page === 1 ? 'disabled' : ''}>Previous</button><button class="btn btn-sm" id="nextEntries" ${page === pages ? 'disabled' : ''}>Next</button></div>`;
    const update = () => { const b = host.querySelector('#deleteEntries'); b.disabled = !selected.size; b.textContent = `Delete selected entries${selected.size ? ` (${selected.size})` : ''}`; };
    list.querySelectorAll('[data-id]').forEach(c => c.onchange = () => { if (c.checked) selected.add(Number(c.dataset.id)); else selected.delete(Number(c.dataset.id)); update(); });
    list.querySelector('#prevEntries').onclick = () => { page--; renderRows(); };
    list.querySelector('#nextEntries').onclick = () => { page++; renderRows(); }; update();
  }
  // ---- Automatic (timed) local backups + Microsoft 365 / OneDrive cloud -----
  const PHASE_LABEL = { queued: 'Queued', preparing: 'Preparing', verifying: 'Verifying', uploading: 'Uploading', finalizing: 'Finalising', completed: 'Completed', failed: 'Failed' };
  let autoPoll = null;
  function stopPoll() { if (autoPoll) { clearTimeout(autoPoll); autoPoll = null; } }
  async function loadAuto() {
    stopPoll();
    const [root, ms, od] = await Promise.all([api(), api('/microsoft365'), api('/onedrive')]);
    const a = root.auto || {};
    host.innerHTML = `
      <div class="card mb"><div class="card-head"><h3>Automatic local backups</h3>${a.enabled ? VMTL.badge('On', 'green') : VMTL.badge('Off', 'grey')}</div>
        <form class="card-body" id="autoForm">
          <p class="dim">Create a server backup on a fixed schedule and keep only the most recent copies. Stored on this server's disk — keep cloud copies below for off-site safety.</p>
          <label class="checkbox"><input type="checkbox" id="autoEnabled" ${a.enabled ? 'checked' : ''}> Enable automatic backups</label>
          <div class="grid cols-2 mt">
            <div class="field"><label for="autoInterval">Every (hours)</label><input id="autoInterval" type="number" min="1" max="720" value="${a.interval_hours || 24}" required></div>
            <div class="field"><label for="autoRetention">Keep most recent (count)</label><input id="autoRetention" type="number" min="1" max="100" value="${a.retention || 14}" required></div>
          </div>
          <p class="dim">Last automatic backup: ${a.last_run ? esc(VMTL.fmtDateTime(a.last_run)) : 'never'}.</p>
          <button class="btn btn-primary" type="submit">Save schedule</button>
        </form></div>

      <div class="card mb"><div class="card-head"><h3>Microsoft 365 app</h3>${ms.configured ? VMTL.badge('Configured', 'green') : VMTL.badge('Not configured', 'amber')}</div>
        <form class="card-body" id="msForm">
          <p class="dim">OneDrive backups sign in through your organisation's Microsoft Entra (Azure AD) app registration. Register a <strong>web</strong> redirect URI below, grant delegated <code>Files.ReadWrite</code> and <code>offline_access</code>, then enter the app details.</p>
          <div class="field"><label>Redirect URI (add this to the Entra app)</label><input id="msRedirectShown" value="${esc(ms.redirect_uri || ms.default_redirect)}" readonly></div>
          <div class="field"><label for="msTenant">Tenant ID or domain</label><input id="msTenant" value="${esc(ms.tenant_id || '')}" placeholder="knust.edu.gh or a GUID" autocomplete="off"></div>
          <div class="field"><label for="msClient">Application (client) ID</label><input id="msClient" value="${esc(ms.client_id || '')}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off"></div>
          <div class="field"><label for="msSecret">Client secret ${ms.has_secret ? '(saved — leave blank to keep)' : ''}</label><input id="msSecret" type="password" placeholder="${ms.has_secret ? '••••••••' : 'Client secret value'}" autocomplete="new-password"></div>
          <div class="field"><label for="msRedirect">Redirect URI override (optional)</label><input id="msRedirect" value="${esc(ms.sources && ms.sources.redirect_uri === 'app' ? ms.redirect_uri : '')}" placeholder="${esc(ms.default_redirect)}" autocomplete="off"></div>
          ${ms.secret_unreadable ? '<p class="dim" style="color:var(--danger)">The saved secret can no longer be decrypted (the encryption key changed). Re-enter it.</p>' : ''}
          <button class="btn btn-primary" type="submit">Save Microsoft 365 app</button>
        </form></div>

      <div class="card"><div class="card-head"><h3>OneDrive backup destinations</h3><button class="btn btn-sm" id="odRefresh">Refresh</button></div>
        <div class="card-body" id="odBody"></div></div>`;

    host.querySelector('#autoForm').onsubmit = async e => {
      e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true;
      try {
        await api('/automatic', { method: 'PATCH', body: { enabled: host.querySelector('#autoEnabled').checked, interval_hours: Number(host.querySelector('#autoInterval').value), retention: Number(host.querySelector('#autoRetention').value) } });
        VMTL.toast('Automatic backup schedule saved.', 'success'); await loadAuto();
      } catch (err) { report(err); b.disabled = false; }
    };
    host.querySelector('#msForm').onsubmit = async e => {
      e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true;
      try {
        await api('/microsoft365', { method: 'PATCH', body: { tenant_id: host.querySelector('#msTenant').value, client_id: host.querySelector('#msClient').value, secret: host.querySelector('#msSecret').value, redirect_uri: host.querySelector('#msRedirect').value } });
        VMTL.toast('Microsoft 365 app saved.', 'success'); await loadAuto();
      } catch (err) { report(err); b.disabled = false; }
    };
    host.querySelector('#msRedirectShown').onclick = e => e.target.select();
    host.querySelector('#odRefresh').onclick = () => loadAuto().catch(report);
    renderOneDrive(od, ms.configured);
  }
  function renderOneDrive(od, msConfigured) {
    const body = host.querySelector('#odBody');
    if (!msConfigured) { body.innerHTML = '<p class="dim">Configure the Microsoft 365 app above before connecting a OneDrive destination.</p>'; return; }
    const active = (od.accounts || []).some(acc => acc.progress && ['queued', 'preparing', 'verifying', 'uploading', 'finalizing'].includes(acc.progress.phase));
    body.innerHTML = `
      <form id="odSchedule" class="grid cols-2"><div class="field"><label for="odInterval">Upload every (hours)</label><input id="odInterval" type="number" min="1" max="720" value="${od.interval_hours || 24}" required></div><div class="field"><label for="odRetention">Keep copies in OneDrive</label><input id="odRetention" type="number" min="1" max="100" value="${od.retention || 30}" required></div><div style="grid-column:1/-1"><button class="btn btn-sm btn-primary" type="submit">Save cloud schedule</button></div></form>
      <hr>
      <form id="odConnect" class="toolbar"><div class="field" style="flex:1 1 220px;margin:0"><label for="odEmail">Connect a OneDrive account</label><input id="odEmail" type="email" placeholder="backups@knust.edu.gh" autocomplete="off" required></div><button class="btn" type="submit">Connect</button></form>
      <div class="mt">${(od.accounts || []).length ? (od.accounts || []).map(acc => {
        const p = acc.progress;
        const pct = p && typeof p.percent === 'number' ? Math.max(0, Math.min(100, p.percent)) : 0;
        const phase = p ? (PHASE_LABEL[p.phase] || p.phase) : null;
        const statusBadge = !acc.connected ? VMTL.badge('Reconnect needed', 'amber') : acc.enabled ? VMTL.badge('Enabled', 'green') : VMTL.badge('Disabled', 'grey');
        return `<div class="od-acct" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:10px">
          <div class="between"><div><strong>${esc(acc.email)}</strong> ${statusBadge}</div><div class="btn-row">
            <button class="btn btn-sm" data-od-test="${esc(acc.id)}" ${!acc.connected || active ? 'disabled' : ''}>Back up now</button>
            <button class="btn btn-sm" data-od-toggle="${esc(acc.id)}" data-enabled="${acc.enabled ? '1' : '0'}" ${!acc.connected ? 'disabled' : ''}>${acc.enabled ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-sm btn-danger" data-od-remove="${esc(acc.id)}">Remove</button></div></div>
          <div class="dim" style="font-size:12px;margin-top:4px">${acc.last_success ? 'Last backup ' + esc(VMTL.fmtDateTime(acc.last_success)) : 'No successful backup yet'}${acc.last_error ? ' · <span style="color:var(--danger)">' + esc(acc.last_error) + '</span>' : ''}</div>
          ${p && ['queued', 'preparing', 'verifying', 'uploading', 'finalizing'].includes(p.phase) ? `<div style="margin-top:8px"><div style="height:6px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--primary);transition:width .3s"></div></div><div class="dim" style="font-size:12px;margin-top:3px">${esc(phase)} · ${pct}%</div></div>` : ''}
          ${p && p.phase === 'completed' ? `<div class="dim" style="font-size:12px;margin-top:4px;color:var(--success)">Completed${p.warning ? ' — ' + esc(p.warning) : ''}</div>` : ''}
          ${p && p.phase === 'failed' ? `<div class="dim" style="font-size:12px;margin-top:4px;color:var(--danger)">${esc(p.error || 'Upload failed.')}</div>` : ''}
        </div>`;
      }).join('') : '<p class="dim">No OneDrive destinations connected yet.</p>'}</div>`;

    body.querySelector('#odSchedule').onsubmit = async e => {
      e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true;
      try { await api('/onedrive', { method: 'PATCH', body: { interval_hours: Number(body.querySelector('#odInterval').value), retention: Number(body.querySelector('#odRetention').value) } }); VMTL.toast('Cloud backup schedule saved.', 'success'); await loadAuto(); } catch (err) { report(err); b.disabled = false; }
    };
    body.querySelector('#odConnect').onsubmit = async e => {
      e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true;
      try {
        const { url } = await api('/onedrive/connect', { method: 'POST', body: { email: body.querySelector('#odEmail').value } });
        const popup = window.open(url, 'onedrive-connect', 'width=520,height=680');
        if (!popup) { VMTL.toast('Allow pop-ups, then try Connect again.', 'err'); b.disabled = false; return; }
        VMTL.toast('Complete the Microsoft sign-in in the new window.', '');
        const onMsg = ev => { if (ev.data && ev.data.type === 'onedrive-backup') { window.removeEventListener('message', onMsg); loadAuto().catch(report); } };
        window.addEventListener('message', onMsg);
        pollStatus(14); // also refresh in case postMessage is blocked
      } catch (err) { report(err); b.disabled = false; }
    };
    body.querySelectorAll('[data-od-test]').forEach(btn => btn.onclick = async () => {
      btn.disabled = true; try { await api('/onedrive/' + btn.dataset.odTest + '/test', { method: 'POST' }); VMTL.toast('Backup upload started.', 'success'); await loadAuto(); } catch (err) { report(err); btn.disabled = false; }
    });
    body.querySelectorAll('[data-od-toggle]').forEach(btn => btn.onclick = async () => {
      btn.disabled = true; try { await api('/onedrive/' + btn.dataset.odToggle, { method: 'PATCH', body: { enabled: btn.dataset.enabled !== '1' } }); await loadAuto(); } catch (err) { report(err); btn.disabled = false; }
    });
    body.querySelectorAll('[data-od-remove]').forEach(btn => btn.onclick = async () => {
      if (!await VMTL.confirm('Remove this OneDrive backup destination? Copies already in OneDrive are kept.', { danger: true, confirmLabel: 'Remove destination' })) return;
      try { await api('/onedrive/' + btn.dataset.odRemove, { method: 'PATCH', body: { remove: true } }); await loadAuto(); } catch (err) { report(err); }
    });
    // Keep progress bars live while an upload is running.
    if (active && tab === 'auto') autoPoll = setTimeout(() => pollStatus(0), 2500);
  }
  async function pollStatus(retries) {
    stopPoll();
    if (tab !== 'auto') return;
    try {
      const od = await api('/onedrive');
      const ms = await api('/microsoft365');
      if (tab === 'auto') renderOneDrive(od, ms.configured);
      const active = (od.accounts || []).some(acc => acc.progress && ['queued', 'preparing', 'verifying', 'uploading', 'finalizing'].includes(acc.progress.phase));
      if ((active || retries > 0) && tab === 'auto') autoPoll = setTimeout(() => pollStatus(retries > 0 ? retries - 1 : 0), 2500);
    } catch (_) { /* transient */ }
  }
  async function load() {
    stopPoll();
    host.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try { if (tab === 'backup') await loadBackups(); else if (tab === 'auto') await loadAuto(); else await loadCleanup(); }
    catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  view.querySelectorAll('[data-tab]').forEach(b => b.onclick = async () => {
    if (window.WalkinUI?.hasPendingActions()) return;
    tab = b.dataset.tab; view.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === b)); await load();
  });
  await load();
};
