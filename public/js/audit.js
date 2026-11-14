'use strict';
// Audit ledger — walkin-style: domain tabs, a filter bar (search + date range),
// a controls row (entry count, rows-per-page, pager, Export CSV), and a table
// with an action chip and a record column.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const esc = VMTL.esc;
  const current = window.WalkinUI?.captureView() || (() => view.isConnected);
  if (!window.VMTL_MOUNT_APPLICATION_LOGS) {
    window.__logToolsLoad ||= new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/js/application-logs.js';
      script.onload = resolve; script.onerror = () => { window.__logToolsLoad = null; reject(new Error('Could not load log viewer.')); }; document.head.appendChild(script);
    });
    await window.__logToolsLoad;
  }
  if (!current()) return;
  let application = false, applicationViewer = null, version = 0;
  VMTL.onLeave(() => { ++version; applicationViewer?.setActive(false); });
  const TABS = [
    { label: 'All activity', entity: '' },
    { label: 'Requests', entity: 'vehicle_request' },
    { label: 'Trips', entity: 'trip' },
    { label: 'Vehicles', entity: 'vehicle' },
    { label: 'Drivers', entity: 'driver' },
    { label: 'Users', entity: 'user' },
  ];
  // The server runtime log is visible only to the app owner (System Administrator).
  if (VMTL.ownerPage('app-health')) TABS.push({ label: 'Application logs', appLogs: true });

  const state = { entity: '', search: '', from: '', to: '', page: 1, perPage: 10, sort: 'desc', total: 0, lastPage: 1 };

  const prettyAction = (a) => String(a || '').replace(/[._]/g, ' ').toUpperCase();
  const prettyType = (t) => String(t || '').replace(/_/g, ' ');

  view.innerHTML = VMTL.pageHead('Audit logs', 'Every action — who, what, when and from where.') +
    `<div class="tabs" id="tabs">${TABS.map((t, i) => `<button data-entity="${t.entity || ''}" ${t.appLogs ? 'data-applogs="1"' : ''} class="${i === 0 ? 'active' : ''}">${esc(t.label)}</button>`).join('')}</div>
     <div class="card pad mb"><div class="filter-row">
       <div class="field" style="flex:1;min-width:220px"><label>Search activity</label><input id="fSearch" placeholder="Person, action or detail"></div>
       <div class="field"><label>From</label><input id="fFrom" type="date"></div>
       <div class="field"><label>To</label><input id="fTo" type="date"></div>
       <button class="btn" id="fClear">Clear</button>
     </div></div>
     <div class="audit-bar">
       <div class="dim" id="count">—</div>
       <div class="right">
         <span class="dim" style="font-size:13px">Rows per page</span>
         <select id="pp" class="pp">${[5, 10, 25, 50, 100].map((n) => `<option value="${n}" ${n === state.perPage ? 'selected' : ''}>${n}</option>`).join('')}</select>
         <button class="btn btn-sm" id="prev">‹ Prev</button>
         <button class="btn btn-sm" id="next">Next ›</button>
         <button class="btn btn-sm btn-primary" id="export">Export CSV</button>
       </div>
     </div>
     <div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;

  const qs = (extra = {}) => {
    const p = new URLSearchParams();
    if (state.entity) p.set('entity_type', state.entity);
    if (state.search) p.set('search', state.search);
    if (state.from) p.set('date_from', state.from);
    if (state.to) p.set('date_to', state.to);
    p.set('sort', state.sort);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p;
  };

  const load = async () => {
    const request = ++version;
    const list = view.querySelector('#list');
    list.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
      const r = await VMTL.api(`/audit-logs?${qs({ page: state.page, per_page: state.perPage })}`);
      if (!current() || application || request !== version) return;
      state.total = r.meta.total; state.lastPage = r.meta.last_page;
      view.querySelector('#count').textContent = `${r.meta.total.toLocaleString()} ${r.meta.total === 1 ? 'entry' : 'entries'} · page ${r.meta.current_page} of ${r.meta.last_page}`;
      view.querySelector('#prev').disabled = state.page <= 1;
      view.querySelector('#next').disabled = state.page >= state.lastPage;
      const arrow = state.sort === 'asc' ? '↑' : '↓';
      const rows = r.data.map((a) => `<tr>
        <td data-label="When">${VMTL.fmtDateTime(a.created_at)}</td>
        <td data-label="Action"><span class="audit-chip">${esc(prettyAction(a.action))}</span></td>
        <td data-label="By">${esc(a.actor || '—')}</td>
        <td data-label="Record">${a.entity_type ? `<strong>${esc(prettyType(a.entity_type))}</strong>${a.entity_id ? `<span class="rec-id">#${esc(a.entity_id)}</span>` : ''}` : '—'}</td>
        <td data-label="Detail">${esc(a.description || '')}</td><td><button class="btn btn-sm" data-audit-detail="${a.id}">Details</button></td></tr>`).join('');
      list.innerHTML = r.data.length
        ? `<table class="data"><thead><tr><th class="sortable" id="sortWhen">When<span class="sort-ind">${arrow}</span></th><th>Action</th><th>By</th><th>Record</th><th>Detail</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty">No entries.</div>';
      list.querySelectorAll('[data-audit-detail]').forEach(button => button.onclick = async () => {
        button.disabled = true;
        try {
          const entry = (await VMTL.api(`/audit-logs/${button.dataset.auditDetail}`)).data;
          if (current() && !application) window.VMTL_LOG_DETAIL('Audit entry details', entry, 'audit');
        } catch (error) { if (current()) VMTL.showErrors(error); } finally { button.disabled = false; }
      });
      const sw = view.querySelector('#sortWhen');
      if (sw) sw.onclick = () => { state.sort = state.sort === 'asc' ? 'desc' : 'asc'; state.page = 1; load(); };
    } catch (e) { if (!current() || application || request !== version) return; list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };

  // Tabs
  const filterCard = view.querySelector('.filter-row').closest('.card');
  const bar = view.querySelector('.audit-bar');
  view.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => {
    view.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    application = !!b.dataset.applogs; ++version; applicationViewer?.setActive(false);
    if (b.dataset.applogs) { filterCard.classList.add('hidden'); bar.classList.add('hidden'); renderAppLogs(); return; }
    filterCard.classList.remove('hidden'); bar.classList.remove('hidden');
    state.entity = b.dataset.entity; state.page = 1; load();
  });
  // Filters
  const applyFilters = () => { state.search = view.querySelector('#fSearch').value.trim(); state.from = view.querySelector('#fFrom').value; state.to = view.querySelector('#fTo').value; state.page = 1; load(); };
  view.querySelector('#fSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
  view.querySelector('#fFrom').addEventListener('change', applyFilters);
  view.querySelector('#fTo').addEventListener('change', applyFilters);
  view.querySelector('#fClear').onclick = () => { view.querySelector('#fSearch').value = ''; view.querySelector('#fFrom').value = ''; view.querySelector('#fTo').value = ''; applyFilters(); };
  // Pager + rows-per-page
  view.querySelector('#pp').onchange = (e) => { state.perPage = Number(e.target.value); state.page = 1; load(); };
  view.querySelector('#prev').onclick = () => { if (state.page > 1) { state.page -= 1; load(); } };
  view.querySelector('#next').onclick = () => { if (state.page < state.lastPage) { state.page += 1; load(); } };
  // Export
  view.querySelector('#export').onclick = async () => {
    try {
      const res = await fetch(`/api/audit-logs/export?${qs()}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `audit-log_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      VMTL.toast('Audit log exported.', 'success');
    } catch (e) { VMTL.toast(e.message || 'Export failed.', 'err'); }
  };

  async function renderAppLogs() {
    const list = view.querySelector('#list');
    if (!applicationViewer || !list.querySelector('[data-application-viewer]')) applicationViewer = window.VMTL_MOUNT_APPLICATION_LOGS(list);
    applicationViewer.setActive(true);
  }

  if (location.hash === '#application' && view.querySelector('[data-applogs]')) view.querySelector('[data-applogs]').click();
  else await load();
};
