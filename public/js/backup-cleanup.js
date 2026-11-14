'use strict';
window.VMTL_PAGE = async function () {
  const { view, esc } = VMTL;
  if (!VMTL.ownerPage('backup-cleanup')) { view.innerHTML = '<div class="empty">App Owner access only.</div>'; return; }
  let tab = 'backup', rows = [], page = 1, query = '';
  const selected = new Set();
  const api = async (url = '', options) => (await VMTL.api('/admin/backups' + url, options)).data;
  view.innerHTML = VMTL.pageHead('Backup & cleanup', 'Protect your data and remove selected records. App Owner only.') + '<div class="tabs" id="backupTabs"><button class="active" data-tab="backup">Backup & restore</button><button data-tab="cleanup">Cleanup</button></div><div id="backupBody"></div>';
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
  async function load() {
    host.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try { if (tab === 'backup') await loadBackups(); else await loadCleanup(); }
    catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  view.querySelectorAll('[data-tab]').forEach(b => b.onclick = async () => {
    if (window.WalkinUI?.hasPendingActions()) return;
    tab = b.dataset.tab; view.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === b)); await load();
  });
  await load();
};
