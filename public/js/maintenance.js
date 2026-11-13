'use strict';
// Maintenance records: list + add (updates the vehicle's last-service markers).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Maintenance', 'Service and repair records.', `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Record maintenance</button>`) +
    `<div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const load = async () => {
    const list = view.querySelector('#list');
    try { const r = await VMTL.pagedApi('/maintenance-records', list, load); list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Date</th><th>Vehicle</th><th>Type</th><th>Odometer</th><th>Cost</th><th>Provider</th></tr></thead><tbody>${r.data.map((m) => `<tr><td data-label="Date">${VMTL.fmtDate(m.service_date)}</td><td data-label="Vehicle">${VMTL.esc(m.vehicle ? m.vehicle.vehicle_number : '')}</td><td data-label="Type">${VMTL.esc(m.maintenance_type_label)}</td><td data-label="Odometer">${m.odometer != null ? VMTL.fmtNumber(m.odometer) : '—'}</td><td data-label="Cost">${VMTL.fmtCedis(m.cost)}</td><td data-label="Provider">${VMTL.esc(m.service_provider || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No maintenance records.</div>'; }
    catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#add').onclick = async () => {
    const vehicles = (await VMTL.api('/vehicles?all=1')).data;
    const m = VMTL.openModal(`<div class="modal-head"><h3>Record maintenance</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="mf"><div class="form-grid">
      <div class="field"><label>Vehicle</label><select name="vehicle_id" required>${vehicles.map((v) => `<option value="${v.id}">${VMTL.esc(v.vehicle_number)}</option>`).join('')}</select></div>
      <div class="field"><label>Type</label><select name="maintenance_type" required>${VMTL.enumOptions('maintenance_type')}</select></div>
      <div class="field"><label>Service date</label><input name="service_date" type="date" required></div>
      <div class="field"><label>Odometer</label><input name="odometer" type="number" min="0"></div>
      <div class="field"><label>Cost (₵)</label><input name="cost" type="number" step="0.01" min="0"></div>
      <div class="field"><label>Provider</label><input name="service_provider"></div>
      <div class="field"><label>Next service date</label><input name="next_service_date" type="date"></div>
      <div class="field"><label>Next service odometer</label><input name="next_service_odometer" type="number" min="0"></div>
    </div><div class="field"><label>Description</label><textarea name="description"></textarea></div><div class="field"><label>Remarks</label><input name="remarks"></div></form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#mf'); const body = {}; new FormData(form).forEach((val, k) => { if (val !== '') body[k] = val; });
      ['vehicle_id', 'odometer', 'next_service_odometer'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      if (body.cost) body.cost = Number(body.cost);
      try { await VMTL.api('/maintenance-records', { method: 'POST', body }); m.close(); VMTL.toast('Recorded.', 'success'); load(); } catch (err) { VMTL.showErrors(err, form); }
    };
  };
  load();
};
