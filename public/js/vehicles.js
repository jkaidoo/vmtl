'use strict';
// Vehicles: list, detail (with fuel spend & economy + trip history), CRUD modal,
// and (de)activate. Scoped by the API to the user's org units.
window.VMTL_PAGE = async function () {
  const id = new URLSearchParams(location.search).get('id');
  if (id) return renderDetail(id);
  return renderList();
};
const canManage = () => VMTL.can('vehicles.manage');

async function renderList() {
  const view = VMTL.view;
  const actions = canManage() ? `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Add vehicle</button>` : '';
  view.innerHTML = VMTL.pageHead('Vehicles', 'The fleet in your scope.', actions) +
    `<div class="card pad mb"><div class="row wrap gap-sm"><select id="fStatus" style="max-width:200px"><option value="">All statuses</option>${VMTL.enumOptions('vehicle_status')}</select><input id="fSearch" placeholder="Search number, reg, make…" style="max-width:260px"><button class="btn" id="fGo">Filter</button></div></div>
     <div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const initialFilters = new URLSearchParams(location.search);
  view.querySelector('#fStatus').value = initialFilters.get('status') || '';
  const load = async () => {
    const list = view.querySelector('#list'); const qs = new URLSearchParams(); qs.set('all', '1');
    if (view.querySelector('#fStatus').value) qs.set('status', view.querySelector('#fStatus').value);
    if (view.querySelector('#fSearch').value) qs.set('search', view.querySelector('#fSearch').value);
    try { const r = await VMTL.pagedApi(`/vehicles?${qs}`, list, load); list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Number</th><th>Reg</th><th>Type</th><th>Make/Model</th><th>Odometer</th><th>Status</th></tr></thead><tbody>${r.data.map((v) => `<tr class="click" data-id="${v.id}"><td data-label="Number"><img src="${VMTL.esc(v.photo_url)}" alt="Vehicle" class="fleet-thumb" loading="lazy">${VMTL.esc(v.vehicle_number)}</td><td data-label="Reg">${VMTL.esc(v.registration_number)}</td><td data-label="Type">${VMTL.esc(v.vehicle_type_label || '—')}</td><td data-label="Make/Model">${VMTL.esc([v.make, v.model].filter(Boolean).join(' '))}</td><td data-label="Odometer">${VMTL.fmtNumber(v.current_odometer)} km</td><td data-label="Status">${VMTL.statusBadge(v)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No vehicles.</div>'; list.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => location.href = `/vehicles.html?id=${tr.dataset.id}`); }
    catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#fGo').onclick = load;
  if (view.querySelector('#add')) view.querySelector('#add').onclick = () => vehicleModal(null, load);
  load();
}

async function renderDetail(id) {
  const view = VMTL.view;
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  let v; try { v = (await VMTL.api(`/vehicles/${id}`)).data; } catch (e) { view.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  const reload = () => renderDetail(id);
  const info = (l, x) => `<div><div class="dim" style="font-size:11.5px;text-transform:uppercase">${l}</div><div>${x}</div></div>`;
  const actions = [];
  if (canManage()) {
    actions.push(`<button class="btn" id="edit">Edit</button>`);
    actions.push(`<button class="btn" id="toggle">${v.active ? 'Deactivate' : 'Reactivate'}</button>`);
    actions.push(`<button class="btn btn-ghost" id="del">Remove</button>`);
  }
  view.innerHTML = `
    <div class="page-head"><div><a class="dim" href="/vehicles.html">← Vehicles</a><h1>${VMTL.esc(v.vehicle_number)} ${VMTL.statusBadge(v)}</h1><div class="sub">${VMTL.esc(v.registration_number)} · ${VMTL.esc(v.vehicle_type_label || '')}</div></div><div class="btn-row">${actions.join('')}</div></div>
    <div class="grid cols-2">
      <div class="card pad"><h3>Details</h3><div class="grid cols-2" style="gap:12px;margin-top:8px">
        ${info('Make / Model', VMTL.esc([v.make, v.model].filter(Boolean).join(' ') || '—'))}${info('Year', v.year || '—')}${info('Colour', VMTL.esc(v.colour || '—'))}${info('Capacity', v.capacity)}
        ${info('Odometer', VMTL.fmtNumber(v.current_odometer) + ' km')}${info('Org unit', VMTL.esc(v.org_unit ? v.org_unit.name : '—'))}
        ${info('Insurance', VMTL.fmtDate(v.insurance_expiry))}${info('Roadworthy', VMTL.fmtDate(v.roadworthy_expiry))}
        ${info('Service interval', v.service_interval_km ? v.service_interval_km + ' km' : '—')}${info('Last service', VMTL.fmtDate(v.last_service_date))}
      </div>${v.notes ? `<p class="dim mt">${VMTL.esc(v.notes)}</p>` : ''}</div>
      <div class="card pad" id="fuelCard"><h3>Fuel spend & economy</h3><div class="loading"><span class="spinner"></span></div></div>
    </div>
    <div class="card mt"><div class="card-head"><h3>Trip history</h3></div><div id="trips"><div class="loading"><span class="spinner"></span></div></div></div>`;

  if (view.querySelector('#edit')) view.querySelector('#edit').onclick = () => vehicleModal(v, reload);
  if (view.querySelector('#toggle')) view.querySelector('#toggle').onclick = async () => { try { await VMTL.api(`/vehicles/${v.id}/active`, { method: 'POST', body: { active: !v.active } }); VMTL.toast('Updated.', 'success'); reload(); } catch (e) { VMTL.showErrors(e); } };
  if (view.querySelector('#del')) view.querySelector('#del').onclick = async () => { if (await VMTL.confirm('Remove this vehicle?', { danger: true, confirmLabel: 'Remove' })) { try { await VMTL.api(`/vehicles/${v.id}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); location.href = '/vehicles.html'; } catch (e) { VMTL.showErrors(e); } } };

  try { const f = await VMTL.api(`/vehicles/${v.id}/fuel`); const s = f.summary; view.querySelector('#fuelCard').innerHTML = `<h3>Fuel spend & economy</h3><div class="grid cols-2" style="gap:12px;margin-top:8px"><div class="kpi"><div class="label">Total spend</div><div class="value metric" style="font-size:22px">${VMTL.fmtCedis(s.total_cost)}</div></div><div class="kpi"><div class="label">Litres</div><div class="value metric" style="font-size:22px">${VMTL.fmtDecimal(s.total_litres)}</div></div><div class="kpi"><div class="label">Economy</div><div class="value metric" style="font-size:22px">${s.km_per_litre != null ? s.km_per_litre + ' km/L' : '—'}</div></div><div class="kpi"><div class="label">Cost / km</div><div class="value metric" style="font-size:22px">${s.cost_per_km != null ? VMTL.fmtCedis(s.cost_per_km) : '—'}</div></div></div>${f.recent.length ? `<table class="data mt"><thead><tr><th>Date</th><th>Odo</th><th>Litres</th><th>km/L</th><th>Cost</th></tr></thead><tbody>${f.recent.map((x) => `<tr><td>${VMTL.fmtDate(x.purchase_date)}</td><td>${VMTL.fmtNumber(x.odometer)}</td><td>${VMTL.fmtDecimal(x.litres)}</td><td>${x.km_per_litre != null ? x.km_per_litre : '—'}</td><td>${VMTL.fmtCedis(x.total_cost)}</td></tr>`).join('')}</tbody></table>` : '<div class="dim mt">No fuel purchases recorded.</div>'}`; } catch (_) { view.querySelector('#fuelCard').innerHTML = '<h3>Fuel spend & economy</h3><div class="dim">Unavailable.</div>'; }
  try { const tr = await VMTL.api(`/vehicles/${v.id}/trips`); const list = view.querySelector('#trips'); list.innerHTML = tr.data.length ? `<table class="data"><thead><tr><th>Trip</th><th>Driver</th><th>When</th><th>Distance</th><th>Status</th></tr></thead><tbody>${tr.data.map((t) => `<tr class="click" data-id="${t.id}"><td>${VMTL.esc(t.trip_number)}</td><td>${VMTL.esc(t.driver ? t.driver.name : '')}</td><td>${VMTL.fmtDate(t.scheduled_start)}</td><td>${t.distance != null ? VMTL.fmtKm(t.distance) : '—'}</td><td>${VMTL.statusBadge(t)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No trips yet.</div>'; list.querySelectorAll('tr.click').forEach((x) => x.onclick = () => location.href = `/trips.html?id=${x.dataset.id}`); } catch (_) {}
}

function vehicleModal(v, done) {
  const e = v || {};
  let savedRecord=null;
  const typeGroups = new Map();
  for (const option of VMTL.meta.enums.vehicle_type || []) { if (!typeGroups.has(option.group)) typeGroups.set(option.group, []); typeGroups.get(option.group).push(option); }
  const typeOpts = [...typeGroups].map(([group, options]) => `<optgroup label="${VMTL.esc(group)}">${options.map(o => `<option value="${o.value}" ${e.vehicle_type === o.value ? 'selected' : ''}>${VMTL.esc(o.label)}</option>`).join('')}</optgroup>`).join('');
  const m = VMTL.openModal(`<div class="modal-head"><h3>${v ? 'Edit vehicle' : 'Add vehicle'}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="vf"><div class="form-grid">${VMTL.uploadFields('vehicle')}
    <div class="field"><label>Vehicle number</label><input name="vehicle_number" value="${VMTL.esc(e.vehicle_number || '')}" required></div>
    <div class="field"><label>Registration</label><input name="registration_number" value="${VMTL.esc(e.registration_number || '')}" required></div>
    <div class="field"><label>Make</label><input name="make" value="${VMTL.esc(e.make || '')}"></div>
    <div class="field"><label>Model</label><input name="model" value="${VMTL.esc(e.model || '')}"></div>
    <div class="field"><label>Year</label><input name="year" type="number" value="${e.year || ''}"></div>
    <div class="field"><label>Type</label><select name="vehicle_type"><option value="">—</option>${typeOpts}</select></div>
    <div class="field"><label>Colour</label><input name="colour" value="${VMTL.esc(e.colour || '')}"></div>
    <div class="field"><label>Capacity</label><input name="capacity" type="number" min="0" value="${e.capacity ?? 1}" required></div>
    <div class="field"><label>Current odometer</label><input name="current_odometer" type="number" value="${e.current_odometer || 0}"></div>
    <div class="field"><label>Org unit</label><select name="org_unit_id"><option value="">— default —</option>${VMTL.orgUnitOptions(e.org_unit_id)}</select></div>
    <div class="field"><label>Insurance expiry</label><input name="insurance_expiry" type="date" value="${e.insurance_expiry || ''}"></div>
    <div class="field"><label>Roadworthy expiry</label><input name="roadworthy_expiry" type="date" value="${e.roadworthy_expiry || ''}"></div>
    <div class="field"><label>Service interval (km)</label><input name="service_interval_km" type="number" value="${e.service_interval_km || ''}"></div>
    <div class="field"><label>Last service date</label><input name="last_service_date" type="date" value="${e.last_service_date || ''}"></div>
  </div><div class="field"><label>Notes</label><textarea name="notes">${VMTL.esc(e.notes || '')}</textarea></div></form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
  m.el.querySelector('[name=vehicle_type]').onchange = event => { const type = VMTL.meta.enums.vehicle_type.find(option => option.value === event.target.value); if (type) m.el.querySelector('[name=capacity]').value = type.seats; };
  m.el.querySelector('#save').onclick = async () => {
    const form = m.el.querySelector('#vf'); const body = {};
    if(!form.reportValidity()) return;
    new FormData(form).forEach((val, k) => { if (val !== '') body[k] = val; });
    ['year', 'capacity', 'current_odometer', 'service_interval_km', 'org_unit_id'].forEach((k) => { if (body[k] != null) body[k] = Number(body[k]); });
    try { const saved = (savedRecord || v) ? await VMTL.api(`/vehicles/${savedRecord?.data.id || v.id}`, { method: 'PUT', body }) : await VMTL.api('/vehicles', { method: 'POST', body }); savedRecord=saved; await VMTL.uploadFiles(form,'vehicle',saved.data.id); m.close(); VMTL.toast('Saved.', 'success'); done(); }
    catch (err) { if(savedRecord) VMTL.toast('The record was saved. Fix the file issue and Save again to retry the upload.','error'); VMTL.showErrors(err, form); }
  };
}
