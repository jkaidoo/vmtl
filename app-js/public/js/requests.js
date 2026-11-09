'use strict';
// Requests: list (scoped by the API) and detail with the full lifecycle. The
// detail view is the surface a locked-down Staff user reaches, so it also shows
// the live trip-progress graphic and lets the requester add a mid-trip stop.
window.VMTL_PAGE = async function () {
  const id = new URLSearchParams(location.search).get('id');
  if (id) return renderDetail(id);
  return renderList();
};

async function renderList() {
  const view = VMTL.view;
  const canCreate = VMTL.can('requests.create');
  const actions = canCreate ? `<a class="btn btn-primary" href="/request-create.html">${VMTL.icon('plus')} New request</a> <a class="btn" href="/availability.html">Availability</a>` : '<a class="btn" href="/availability.html">Availability</a>';
  view.innerHTML = VMTL.pageHead('Vehicle requests', VMTL.requesterOnly() ? 'Your requests.' : 'All requests across your scope.', actions) +
    `<div class="card pad mb"><div class="row wrap gap-sm">
       <select id="fStatus" style="max-width:200px"><option value="">All statuses</option>${VMTL.enumOptions('request_status')}</select>
       <input id="fSearch" placeholder="Search number, destination…" style="max-width:260px">
       <button class="btn" id="fGo">Filter</button></div></div>
     <div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const load = async () => {
    const list = view.querySelector('#list');
    const qs = new URLSearchParams();
    if (view.querySelector('#fStatus').value) qs.set('status', view.querySelector('#fStatus').value);
    if (view.querySelector('#fSearch').value) qs.set('search', view.querySelector('#fSearch').value);
    qs.set('per_page', '50');
    try {
      const r = await VMTL.api(`/vehicle-requests?${qs}`);
      list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Number</th><th>Destination</th><th>Requester</th><th>Travel date</th><th>Dept</th><th>Status</th></tr></thead><tbody>${r.data.map(rowFor).join('')}</tbody></table>` : '<div class="empty">No requests found.</div>';
      list.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => location.href = `/requests.html?id=${tr.dataset.id}`);
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#fGo').onclick = load;
  view.querySelector('#fSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  load();
}
function rowFor(r) {
  return `<tr class="click" data-id="${r.id}"><td data-label="Number">${VMTL.esc(r.request_number)}${r.is_goodwill ? ' <span class="pill">Goodwill</span>' : ''}${r.is_external ? ' <span class="pill">External</span>' : ''}</td><td data-label="Destination">${VMTL.esc(r.destination)}</td><td data-label="Requester">${VMTL.esc(r.requester ? r.requester.name : '')}</td><td data-label="Travel date">${VMTL.fmtDate(r.travel_date)}</td><td data-label="Dept">${VMTL.esc(r.department_label || '—')}</td><td data-label="Status">${VMTL.statusBadge(r)}</td></tr>`;
}

async function renderDetail(id) {
  const view = VMTL.view;
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  let r;
  try { r = (await VMTL.api(`/vehicle-requests/${id}`)).data; }
  catch (e) { view.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }

  const info = (label, value) => `<div><div class="dim" style="font-size:11.5px;text-transform:uppercase;letter-spacing:.04em">${label}</div><div>${value}</div></div>`;
  const trip = r.trip;
  view.innerHTML = `
    <div class="page-head"><div><a class="dim" href="/requests.html">← Requests</a><h1>${VMTL.esc(r.request_number)} ${VMTL.statusBadge(r)}</h1><div class="sub">${VMTL.esc(r.destination)} · ${VMTL.fmtDate(r.travel_date)}</div></div><div class="btn-row" id="actions"></div></div>
    <div class="grid cols-2">
      <div class="card pad"><h3>Details</h3><div class="grid cols-2" style="gap:12px;margin-top:8px">
        ${info('Requester', VMTL.esc(r.requester ? r.requester.name : '—'))}
        ${info('Department', VMTL.esc(r.department_label || '—'))}
        ${info('Window', `${VMTL.fmtDateTime(r.requested_start_time)} → ${VMTL.fmtTime(r.expected_end_time)}`)}
        ${info('Passengers', r.passenger_count)}
        ${info('Destination', VMTL.esc(r.destination))}
        ${r.additional_destination ? info('Additional', VMTL.esc(r.additional_destination)) : ''}
        ${info('Purpose', VMTL.esc(r.purpose))}
        ${r.contact_number ? info('Contact', VMTL.esc(r.contact_number)) : ''}
        ${r.is_external ? info('External org', VMTL.esc(r.external_org)) : ''}
        ${r.is_external && r.expected_duration_days ? info('Duration (days)', r.expected_duration_days) : ''}
        ${r.goodwill_reason ? info('Goodwill reason', VMTL.esc(r.goodwill_reason)) : ''}
      </div></div>
      <div class="stack"><div id="tripCard"></div>
        <div class="card pad"><h3>Approvals</h3><div id="approvals" class="stack" style="margin-top:8px">${(r.approvals || []).length ? r.approvals.map(approvalRow).join('') : '<div class="dim">No decisions yet.</div>'}</div></div>
      </div>
    </div>`;

  if (trip) { const tp = VMTL.tripProgress(trip, trip.vehicle ? trip.vehicle.vehicle_type_motif : 'car'); const host = view.querySelector('#tripCard'); host.innerHTML = `<div class="card pad"><div class="between"><h3>Trip ${VMTL.esc(trip.trip_number)}</h3>${VMTL.statusBadge(trip)}</div><div class="dim" style="font-size:13px;margin-top:4px">${VMTL.esc(trip.vehicle ? trip.vehicle.vehicle_number : '')} · ${VMTL.esc(trip.driver ? trip.driver.name : '')}</div></div>`; if (tp) host.appendChild(tp); }

  renderActions(view.querySelector('#actions'), r);
}
function approvalRow(a) { return `<div class="alert-accent ${a.action === 'approved' ? 'green' : a.action === 'rejected' ? 'red' : 'amber'}"><div class="between"><strong>${VMTL.esc(a.action_label)}</strong><span class="dim" style="font-size:12px">${VMTL.fmtDateTime(a.approved_at || a.created_at)}</span></div><div class="dim" style="font-size:12.5px">${VMTL.esc(a.approver ? a.approver.name : '')}${a.comment ? ' — ' + VMTL.esc(a.comment) : ''}</div></div>`; }

function renderActions(host, r) {
  const u = VMTL.user; const own = r.requester && r.requester.id === u.id;
  const btns = [];
  const reload = () => renderDetail(r.id);
  if (VMTL.can('requests.approve') && (r.status === 'pending' || r.status === 'changes_requested')) {
    btns.push(['Approve', 'btn-primary', async () => { const c = await promptText('Approve request', 'Comment (optional)', false); if (c === null) return; await act(`/vehicle-requests/${r.id}/approve`, { comment: c }, reload); }]);
    btns.push(['Reject', 'btn-danger', async () => { const c = await promptText('Reject request', 'Reason', true); if (!c) return; await act(`/vehicle-requests/${r.id}/reject`, { reason: c }, reload); }]);
    btns.push(['Request changes', 'btn', async () => { const c = await promptText('Request changes', 'What should change?', true); if (!c) return; await act(`/vehicle-requests/${r.id}/request-changes`, { reason: c }, reload); }]);
  }
  if (VMTL.can('requests.assign') && r.status === 'approved') btns.push(['Assign vehicle + driver', 'btn-primary', () => assignModal(r, reload)]);
  if (own && (r.status === 'changes_requested' || r.status === 'pending')) btns.push(['Edit', 'btn', () => location.href = `/request-create.html?edit=${r.id}`]);
  if (r.is_cancellable && (own || VMTL.can('requests.approve') || VMTL.can('requests.assign'))) btns.push(['Cancel', 'btn-ghost', async () => { if (await VMTL.confirm('Cancel this request?', { danger: true, confirmLabel: 'Cancel request' })) await act(`/vehicle-requests/${r.id}/cancel`, {}, reload); }]);
  if (r.trip && r.trip.status === 'in_progress' && (own || VMTL.can('trips.operate'))) btns.push(['Add destination', 'btn', () => addStopModal(r.trip, reload)]);
  host.innerHTML = '';
  btns.forEach(([label, cls, fn]) => { const b = VMTL.el(`<button class="btn ${cls}">${VMTL.esc(label)}</button>`); b.onclick = fn; host.appendChild(b); });
}

function promptText(title, label, required) {
  return new Promise((resolve) => {
    const m = VMTL.openModal(`<div class="modal-head"><h3>${VMTL.esc(title)}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="field"><label>${VMTL.esc(label)}</label><textarea id="pt"></textarea></div></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ok">Submit</button></div>`);
    m.el.querySelector('#ok').onclick = () => { const v = m.el.querySelector('#pt').value.trim(); if (required && !v) { VMTL.toast('This is required.', 'err'); return; } m.close(); resolve(v); };
    m.el.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => { m.close(); resolve(null); });
  });
}
async function act(path, body, done) { try { await VMTL.api(path, { method: 'POST', body }); VMTL.toast('Done.', 'success'); done(); } catch (e) { VMTL.showErrors(e); } }

async function assignModal(r, done) {
  const m = VMTL.openModal('<div class="modal-head"><h3>Assign vehicle + driver</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body" id="b"><div class="loading">Loading options…</div></div>');
  try {
    const opt = await VMTL.api(`/vehicle-requests/${r.id}/assignment-options`);
    m.el.querySelector('#b').innerHTML = `<div class="field"><label>Vehicle</label><select id="veh">${opt.vehicles.map((v) => `<option value="${v.id}">${VMTL.esc(v.vehicle_number)} — ${VMTL.esc(v.vehicle_type_label || '')} (cap ${v.capacity})</option>`).join('') || '<option value="">None free</option>'}</select></div><div class="field"><label>Driver</label><select id="drv">${opt.drivers.map((d) => `<option value="${d.id}">${VMTL.esc(d.name)}</option>`).join('') || '<option value="">None free</option>'}</select></div><div class="right"><button class="btn btn-primary" id="go">Assign</button></div>`;
    m.el.querySelector('#go').onclick = async () => { const vehicle_id = Number(m.el.querySelector('#veh').value); const driver_id = Number(m.el.querySelector('#drv').value); if (!vehicle_id || !driver_id) { VMTL.toast('Pick a free vehicle and driver.', 'err'); return; } try { await VMTL.api(`/vehicle-requests/${r.id}/assign`, { method: 'POST', body: { vehicle_id, driver_id } }); m.close(); VMTL.toast('Assigned.', 'success'); done(); } catch (e) { VMTL.showErrors(e); } };
  } catch (e) { m.el.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
}

async function addStopModal(trip, done) {
  const m = VMTL.openModal('<div class="modal-head"><h3>Add a destination</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="field"><label>Destination</label><input id="dest"></div><div class="field"><label>Note (optional)</label><input id="note"></div></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="go">Request</button></div>');
  m.el.querySelector('#go').onclick = async () => { const destination = m.el.querySelector('#dest').value.trim(); if (!destination) { VMTL.toast('Enter a destination.', 'err'); return; } try { await VMTL.api(`/trips/${trip.id}/stops`, { method: 'POST', body: { destination, note: m.el.querySelector('#note').value.trim() } }); m.close(); VMTL.toast('Requested — the driver will accept or decline.', 'success'); done(); } catch (e) { VMTL.showErrors(e); } };
}
