'use strict';
// Approvals queue with tabs: Pending, Changes Requested (live count), All open.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const tab = new URLSearchParams(location.search).get('tab') || 'pending';
  view.innerHTML = VMTL.pageHead('Approvals', 'Review and decide on vehicle requests.') +
    `<div class="tabs" id="tabs">
       <button data-tab="pending" class="${tab === 'pending' ? 'active' : ''}">Pending</button>
       <button data-tab="changes_requested" class="${tab === 'changes_requested' ? 'active' : ''}">Changes Requested <span id="cr" class="pill"></span></button>
       <button data-tab="open" class="${tab === 'open' ? 'active' : ''}">All open</button>
     </div><div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const statusFor = (t) => t === 'open' ? 'pending,changes_requested,approved' : t;
  async function load(t) {
    const list = view.querySelector('#list');
    try {
      const r = await VMTL.api(`/vehicle-requests?status=${statusFor(t)}&per_page=100`);
      list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Number</th><th>Destination</th><th>Requester</th><th>Window</th><th>Status</th></tr></thead><tbody>${r.data.map((x) => `<tr class="click" data-id="${x.id}"><td data-label="Number">${VMTL.esc(x.request_number)}</td><td data-label="Destination">${VMTL.esc(x.destination)}</td><td data-label="Requester">${VMTL.esc(x.requester ? x.requester.name : '')}</td><td data-label="Window">${VMTL.fmtDateTime(x.requested_start_time)}</td><td data-label="Status">${VMTL.statusBadge(x)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing here.</div>';
      list.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => location.href = `/requests.html?id=${tr.dataset.id}`);
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  }
  view.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { view.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); history.replaceState(null, '', `?tab=${b.dataset.tab}`); load(b.dataset.tab); });
  // live changes-requested count
  try { const cr = await VMTL.api('/vehicle-requests?status=changes_requested&per_page=1'); const el = view.querySelector('#cr'); if (cr.meta.total) el.textContent = cr.meta.total; else el.remove(); } catch (_) {}
  load(tab);
};
