'use strict';
// Audit ledger: filterable, paginated append-only trail.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  let page = 1;
  view.innerHTML = VMTL.pageHead('Audit logs', 'Every action — who, what, when and from where.') +
    `<div class="card pad mb"><div class="row wrap gap-sm"><input id="fAction" placeholder="Action (e.g. request.approved)" style="max-width:240px"><input id="fSearch" placeholder="Search description…" style="max-width:240px"><button class="btn" id="go">Filter</button></div></div>
     <div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div><div class="center mt"><button class="btn" id="more">Load more</button></div>`;
  const load = async (reset) => {
    if (reset) page = 1;
    const list = view.querySelector('#list'); const qs = new URLSearchParams(); qs.set('page', page); qs.set('per_page', '30');
    if (view.querySelector('#fAction').value) qs.set('action', view.querySelector('#fAction').value);
    if (view.querySelector('#fSearch').value) qs.set('search', view.querySelector('#fSearch').value);
    try {
      const r = await VMTL.api(`/audit-logs?${qs}`);
      const rows = r.data.map((a) => `<tr><td data-label="When">${VMTL.fmtDateTime(a.created_at)}</td><td data-label="Action"><code>${VMTL.esc(a.action)}</code></td><td data-label="By">${VMTL.esc(a.user ? a.user.name : '—')}</td><td data-label="Description">${VMTL.esc(a.description || '')}</td><td data-label="IP">${VMTL.esc(a.ip_address || '')}</td></tr>`).join('');
      if (reset) list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>When</th><th>Action</th><th>By</th><th>Description</th><th>IP</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No entries.</div>';
      else list.querySelector('tbody').insertAdjacentHTML('beforeend', rows);
      view.querySelector('#more').classList.toggle('hidden', page >= r.meta.last_page);
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#go').onclick = () => load(true);
  view.querySelector('#more').onclick = () => { page += 1; load(false); };
  load(true);
};
