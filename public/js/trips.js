'use strict';
// Trips: list (scoped) and detail with the operate lifecycle (start / complete /
// no-show / correct odometer), driver-ready, mid-trip stop decisions, and the
// live trip-progress graphic.
window.VMTL_PAGE = async function () {
  const id = new URLSearchParams(location.search).get('id');
  if (id) return renderDetail(id);
  return renderList();
};

async function renderList() {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Trips', 'Scheduled, in-progress and completed trips.') +
    `<div class="card pad mb"><div class="row wrap gap-sm"><select id="fStatus" style="max-width:200px"><option value="">All statuses</option>${VMTL.enumOptions('trip_status')}</select><input id="fSearch" placeholder="Search trip #, destination…" style="max-width:260px"><button class="btn" id="fGo">Filter</button></div></div>
     <div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const load = async () => {
    const list = view.querySelector('#list'); const qs = new URLSearchParams();
    if (view.querySelector('#fStatus').value) qs.set('status', view.querySelector('#fStatus').value);
    if (view.querySelector('#fSearch').value) qs.set('search', view.querySelector('#fSearch').value);
    qs.set('per_page', '50');
    try {
      const r = await VMTL.api(`/trips?${qs}`);
      list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Trip</th><th>Vehicle</th><th>Driver</th><th>Destination</th><th>When</th><th>Distance</th><th>Status</th></tr></thead><tbody>${r.data.map((t) => `<tr class="click" data-id="${t.id}"><td data-label="Trip">${VMTL.esc(t.trip_number)}</td><td data-label="Vehicle">${VMTL.esc(t.vehicle ? t.vehicle.vehicle_number : '')}</td><td data-label="Driver">${VMTL.esc(t.driver ? t.driver.name : '')}</td><td data-label="Destination">${VMTL.esc(t.request ? t.request.destination : '')}</td><td data-label="When">${VMTL.fmtDateTime(t.scheduled_start)}</td><td data-label="Distance">${t.distance != null ? VMTL.fmtKm(t.distance) : '—'}</td><td data-label="Status">${VMTL.statusBadge(t)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No trips found.</div>';
      list.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => location.href = `/trips.html?id=${tr.dataset.id}`);
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#fGo').onclick = load;
  load();
}

async function renderDetail(id) {
  const view = VMTL.view;
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  let t;
  try { t = (await VMTL.api(`/trips/${id}`)).data; } catch (e) { view.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  const reload = () => renderDetail(id);
  const info = (l, v) => `<div><div class="dim" style="font-size:11.5px;text-transform:uppercase">${l}</div><div>${v}</div></div>`;
  const stops = t.stops || [];
  view.innerHTML = `
    <div class="page-head"><div><a class="dim" href="/trips.html">← Trips</a><h1>${VMTL.esc(t.trip_number)} ${VMTL.statusBadge(t)}</h1><div class="sub">${VMTL.esc(t.vehicle ? t.vehicle.vehicle_number : '')} · ${VMTL.esc(t.driver ? t.driver.name : '')}</div></div><div class="btn-row" id="actions"></div></div>
    <div class="grid cols-2">
      <div class="card pad"><h3>Details</h3><div class="grid cols-2" style="gap:12px;margin-top:8px">
        ${info('Request', t.request ? `<a href="/requests.html?id=${t.request.id}">${VMTL.esc(t.request.request_number)}</a>` : '—')}
        ${info('Destination', VMTL.esc(t.request ? t.request.destination : '—'))}
        ${info('Scheduled', `${VMTL.fmtDateTime(t.scheduled_start)} → ${VMTL.fmtTime(t.scheduled_end)}`)}
        ${info('Actual', t.actual_start ? `${VMTL.fmtDateTime(t.actual_start)}${t.actual_end ? ' → ' + VMTL.fmtTime(t.actual_end) : ''}` : '—')}
        ${info('Start odo', t.starting_odometer != null ? VMTL.fmtNumber(t.starting_odometer) : '—')}
        ${info('End odo', t.ending_odometer != null ? VMTL.fmtNumber(t.ending_odometer) : '—')}
        ${info('Distance', t.distance != null ? VMTL.fmtKm(t.distance) : '—')}
        ${info('Duration', VMTL.fmtDuration(t.duration_minutes))}
      </div>${t.start_checklist && t.start_checklist.length ? `<div style="margin-top:10px"><div class="dim" style="font-size:12px;margin-bottom:5px">Pre-trip inspection</div><div class="row wrap" style="gap:6px">${t.start_checklist.map((c) => `<span class="badge ${c.ok ? 'green' : 'red'}" style="font-size:10px">${c.ok ? '✓' : '✕'} ${VMTL.esc(c.label)}</span>`).join('')}</div></div>` : ''}</div>
      <div class="stack"><div id="tp"></div>
        <div class="card pad"><div class="between"><h3>Added destinations</h3></div><div id="stops" class="stack" style="margin-top:8px">${stops.length ? stops.map(stopRow).join('') : '<div class="dim">None.</div>'}</div></div>
      </div>
    </div>`;
  const tp = VMTL.tripProgress(t, t.vehicle ? t.vehicle.vehicle_type_motif : 'car'); if (tp) view.querySelector('#tp').appendChild(tp);
  renderActions(view.querySelector('#actions'), t, reload);
  // wire stop decisions
  view.querySelectorAll('[data-stop]').forEach((b) => b.onclick = async () => { try { await VMTL.api(`/trips/${t.id}/stops/${b.dataset.stop}/decide`, { method: 'POST', body: { accept: b.dataset.accept === '1' } }); VMTL.toast('Recorded.', 'success'); reload(); } catch (e) { VMTL.showErrors(e); } });
}
function stopRow(s) {
  const canDecide = VMTL.can('trips.operate') || VMTL.isSuper();
  return `<div class="alert-accent ${s.status === 'accepted' ? 'green' : s.status === 'declined' ? 'red' : 'amber'}"><div class="between"><strong>${VMTL.esc(s.destination)}</strong><span class="badge ${s.status === 'accepted' ? 'green' : s.status === 'declined' ? 'red' : 'amber'}">${s.status}</span></div>${s.note ? `<div class="dim" style="font-size:12.5px">${VMTL.esc(s.note)}</div>` : ''}${s.status === 'pending' && canDecide ? `<div class="btn-row" style="margin-top:6px"><button class="btn btn-sm btn-primary" data-stop="${s.id}" data-accept="1">Accept</button><button class="btn btn-sm" data-stop="${s.id}" data-accept="0">Decline</button></div>` : ''}</div>`;
}
function canOperate(t) { const u = VMTL.user; return VMTL.isSuper() || VMTL.can('trips.operate') || (t.driver && t.driver.user_id === u.id); }

function renderActions(host, t, reload) {
  const btns = [];
  if (canOperate(t) && t.status === 'scheduled') {
    btns.push(['Start trip', 'btn-primary', () => startTripModal(t, reload)]);
    btns.push(['No-show', 'btn', async () => { const r = await textModal('Mark no-show', 'Reason (optional)'); if (r === null) return; act(`/trips/${t.id}/no-show`, { reason: r }, reload); }]);
  }
  if (canOperate(t) && t.status === 'in_progress') {
    btns.push(['Complete trip', 'btn-primary', () => odoModal('Complete trip', 'Ending odometer', async (odo, notes) => { if (odo == null) { VMTL.toast('Ending odometer is required.', 'err'); return; } act(`/trips/${t.id}/complete`, { ending_odometer: odo, notes }, reload); }, true)]);
    btns.push(['Add destination', 'btn', () => stopModal(t, reload)]);
  }
  if ((canOperate(t) || (t.driver && t.driver.user_id === VMTL.user.id)) && (t.status === 'scheduled' || t.status === 'in_progress')) btns.push(['Notify requester (ready)', 'btn', async () => { try { await VMTL.api(`/trips/${t.id}/notify-ready`, { method: 'POST', body: {} }); VMTL.toast('The requester has been notified.', 'success'); } catch (e) { VMTL.showErrors(e); } }]);
  if ((VMTL.can('trips.correct') || VMTL.isSuper()) && t.status !== 'scheduled') btns.push(['Correct odometer', 'btn-ghost', () => correctModal(t, reload)]);
  host.innerHTML = '';
  btns.forEach(([l, c, fn]) => { const b = VMTL.el(`<button class="btn ${c}">${VMTL.esc(l)}</button>`); b.onclick = fn; host.appendChild(b); });
}
async function act(path, body, done) { try { await VMTL.api(path, { method: 'POST', body }); VMTL.toast('Done.', 'success'); done(); } catch (e) { VMTL.showErrors(e); } }
// Start a trip with a quick pre-trip inspection checklist (offline-safe payload).
function startTripModal(t, done) {
  const CHECK = [['fuel', 'Adequate fuel'], ['tyres', 'Tyres & spare OK'], ['lights', 'Lights & indicators'], ['brakes', 'Brakes responsive'], ['fluids', 'Oil & coolant levels'], ['documents', 'Documents in vehicle'], ['bodywork', 'No new damage'], ['cleanliness', 'Clean & roadworthy']];
  const m = VMTL.openModal(`<div class="modal-head"><h3>Start trip</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body">
    <div class="field"><label>Starting odometer (optional)</label><input id="odo" type="number" min="0" inputmode="numeric"></div>
    <div class="field"><label>Pre-trip inspection</label><div class="row wrap" style="gap:10px 16px;padding-top:4px">${CHECK.map(([k, l]) => `<label class="checkbox"><input type="checkbox" class="chk" data-k="${k}" data-l="${VMTL.esc(l)}" checked> ${VMTL.esc(l)}</label>`).join('')}</div></div>
    <div class="field"><label>Notes (optional)</label><textarea id="notes" placeholder="Anything to flag before setting off…"></textarea></div>
  </div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ok">Start trip</button></div>`, { large: true });
  m.el.querySelector('#ok').onclick = () => {
    const odo = m.el.querySelector('#odo').value;
    const checklist = [...m.el.querySelectorAll('.chk')].map((c) => ({ key: c.dataset.k, label: c.dataset.l, ok: c.checked }));
    const notes = m.el.querySelector('#notes').value.trim();
    m.close();
    act(`/trips/${t.id}/start`, { starting_odometer: odo === '' ? null : Number(odo), notes, checklist }, done);
  };
}
function odoModal(title, label, onOk, required) {
  const m = VMTL.openModal(`<div class="modal-head"><h3>${VMTL.esc(title)}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="field"><label>${VMTL.esc(label)}</label><input id="odo" type="number" min="0"></div><div class="field"><label>Notes (optional)</label><textarea id="notes"></textarea></div></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ok">${VMTL.esc(title)}</button></div>`);
  m.el.querySelector('#ok').onclick = () => { const v = m.el.querySelector('#odo').value; m.close(); onOk(v === '' ? null : Number(v), m.el.querySelector('#notes').value.trim()); };
}
function textModal(title, label) { return new Promise((res) => { const m = VMTL.openModal(`<div class="modal-head"><h3>${VMTL.esc(title)}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="field"><label>${VMTL.esc(label)}</label><textarea id="t"></textarea></div></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ok">Submit</button></div>`); m.el.querySelector('#ok').onclick = () => { const v = m.el.querySelector('#t').value.trim(); m.close(); res(v); }; m.el.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => { m.close(); res(null); }); }); }
function correctModal(t, done) {
  const m = VMTL.openModal(`<div class="modal-head"><h3>Correct odometer</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="field"><label>Starting odometer</label><input id="s" type="number" value="${t.starting_odometer != null ? t.starting_odometer : ''}"></div><div class="field"><label>Ending odometer</label><input id="e" type="number" value="${t.ending_odometer != null ? t.ending_odometer : ''}"></div><div class="field"><label>Reason</label><input id="r"></div></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ok">Save</button></div>`);
  m.el.querySelector('#ok').onclick = async () => { const s = m.el.querySelector('#s').value; const e = m.el.querySelector('#e').value; try { await VMTL.api(`/trips/${t.id}/correct-odometer`, { method: 'POST', body: { starting_odometer: s === '' ? null : Number(s), ending_odometer: e === '' ? null : Number(e), reason: m.el.querySelector('#r').value.trim() } }); m.close(); VMTL.toast('Corrected.', 'success'); done(); } catch (err) { VMTL.showErrors(err); } };
}
function stopModal(t, done) {
  const m = VMTL.openModal('<div class="modal-head"><h3>Add a destination</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="field"><label>Destination</label><input id="d"></div><div class="field"><label>Note (optional)</label><input id="n"></div></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ok">Add</button></div>');
  m.el.querySelector('#ok').onclick = async () => { const destination = m.el.querySelector('#d').value.trim(); if (!destination) return; try { await VMTL.api(`/trips/${t.id}/stops`, { method: 'POST', body: { destination, note: m.el.querySelector('#n').value.trim() } }); m.close(); VMTL.toast('Added.', 'success'); done(); } catch (e) { VMTL.showErrors(e); } };
}
