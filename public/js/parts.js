'use strict';
// Tyre & spare-parts inventory: on-hand stock against reorder levels, with stock
// movements (receive, fit to a vehicle, adjust) that keep a history.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  let vehicles = [];
  try { vehicles = (await VMTL.api('/vehicles?all=1')).data; } catch (_) {}
  const CATS = [['', 'All categories'], ['tyre', 'Tyres'], ['part', 'Parts'], ['fluid', 'Fluids'], ['battery', 'Batteries'], ['other', 'Other']];

  view.innerHTML = VMTL.pageHead('Parts & tyres', 'Spare-parts and tyre inventory with stock movements.',
    `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Add item</button>`) +
    `<div id="stats" class="grid cols-3 mb"></div>
     <div class="card">
       <div class="toolbar"><select id="f-cat" class="input">${CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
         <label class="dim" style="font-size:13px;margin-left:auto"><input type="checkbox" id="f-low"> Low stock only</label></div>
       <div id="list"><div class="loading"><span class="spinner"></span></div></div>
     </div>`;
  const kpi = (label, value) => `<div class="kpi"><div class="label">${label}</div><div class="value metric">${value}</div></div>`;

  const loadStats = async () => {
    try { const { data } = await VMTL.api('/parts/stats'); view.querySelector('#stats').innerHTML = kpi('Items', data.items) + kpi('Tyres', data.tyres) + kpi('Low stock', data.low_stock); } catch (_) {}
  };

  const load = async () => {
    const list = view.querySelector('#list');
    const qs = new URLSearchParams();
    const cat = view.querySelector('#f-cat').value; if (cat) qs.set('category', cat);
    if (view.querySelector('#f-low').checked) qs.set('low', '1');
    try {
      const { data } = await VMTL.api(`/parts${qs.toString() ? `?${qs}` : ''}`);
      list.innerHTML = data.length ? `<table class="data"><thead><tr><th>Item</th><th>Category</th><th>On hand</th><th>Reorder</th><th>Unit cost</th><th></th></tr></thead><tbody>${data.map((p) => `
        <tr>
          <td data-label="Item"><strong>${VMTL.esc(p.name)}</strong>${p.size ? `<div class="dim" style="font-size:12px">${VMTL.esc(p.size)}${p.brand ? ' · ' + VMTL.esc(p.brand) : ''}</div>` : ''}${p.part_number ? `<div class="dim" style="font-size:12px">#${VMTL.esc(p.part_number)}</div>` : ''}</td>
          <td data-label="Category">${VMTL.esc(p.category)}</td>
          <td data-label="On hand"><span class="qty-pill ${p.low_stock ? 'low' : ''}">${VMTL.fmtNumber(p.quantity)}${p.unit ? ' ' + VMTL.esc(p.unit) : ''}</span>${p.low_stock ? ' ' + VMTL.badge('low', 'red') : ''}</td>
          <td data-label="Reorder">${p.reorder_level != null ? VMTL.fmtNumber(p.reorder_level) : '—'}</td>
          <td data-label="Unit cost">${VMTL.fmtCedis(p.unit_cost)}</td>
          <td class="right"><button class="btn btn-sm" data-move="${p.id}">Stock</button> <button class="btn btn-sm" data-edit="${p.id}">Edit</button></td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">No inventory items.</div>';
      list.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openForm(data.find((p) => p.id === Number(b.dataset.edit))); });
      list.querySelectorAll('[data-move]').forEach((b) => { b.onclick = () => openMove(data.find((p) => p.id === Number(b.dataset.move))); });
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  function openForm(p = null) {
    const m = VMTL.openModal(`<div class="modal-head"><h3>${p ? 'Edit' : 'Add'} item</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><form id="pf"><div class="form-grid">
        <div class="field"><label>Name</label><input name="name" required maxlength="200" value="${p ? VMTL.esc(p.name) : ''}"></div>
        <div class="field"><label>Category</label><select name="category">${CATS.slice(1).map(([v, l]) => `<option value="${v}" ${p && p.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Part number</label><input name="part_number" maxlength="100" value="${p ? VMTL.esc(p.part_number || '') : ''}"></div>
        <div class="field"><label>Unit (e.g. each, L)</label><input name="unit" maxlength="30" value="${p ? VMTL.esc(p.unit || '') : ''}"></div>
        ${p ? '' : '<div class="field"><label>Opening quantity</label><input name="quantity" type="number" step="any" min="0" value="0"></div>'}
        <div class="field"><label>Reorder level</label><input name="reorder_level" type="number" step="any" min="0" value="${p && p.reorder_level != null ? p.reorder_level : ''}"></div>
        <div class="field"><label>Unit cost (₵)</label><input name="unit_cost" type="number" step="0.01" min="0" value="${p && p.unit_cost != null ? p.unit_cost : ''}"></div>
        <div class="field"><label>Location</label><input name="location" maxlength="120" value="${p ? VMTL.esc(p.location || '') : ''}"></div>
        <div class="field"><label>Tyre size</label><input name="size" maxlength="60" value="${p ? VMTL.esc(p.size || '') : ''}" placeholder="e.g. 265/65R17"></div>
        <div class="field"><label>Brand</label><input name="brand" maxlength="100" value="${p ? VMTL.esc(p.brand || '') : ''}"></div>
      </div><div class="field"><label>Notes</label><input name="notes" maxlength="1000" value="${p ? VMTL.esc(p.notes || '') : ''}"></div></form></div>
      <div class="modal-foot">${p ? '<button class="btn btn-danger" id="del">Delete</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    if (p) m.el.querySelector('#del').onclick = async () => { if (!await VMTL.confirm(`Remove "${p.name}"?`, { danger: true, confirmLabel: 'Delete' })) return; await VMTL.api(`/parts/${p.id}`, { method: 'DELETE' }); m.close(); VMTL.toast('Removed.', 'success'); loadStats(); load(); };
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#pf'); if (!form.reportValidity()) return;
      const body = {}; new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
      ['quantity', 'reorder_level', 'unit_cost'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      try { await VMTL.api(p ? `/parts/${p.id}` : '/parts', { method: p ? 'PUT' : 'POST', body }); m.close(); VMTL.toast('Saved.', 'success'); loadStats(); load(); }
      catch (err) { VMTL.showErrors(err, form); }
    };
  }

  async function openMove(p) {
    let history = [];
    try { history = (await VMTL.api(`/parts/${p.id}/movements`)).data; } catch (_) {}
    const m = VMTL.openModal(`<div class="modal-head"><h3>Stock · ${VMTL.esc(p.name)}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><div class="dim mb">On hand: <strong>${VMTL.fmtNumber(p.quantity)}${p.unit ? ' ' + VMTL.esc(p.unit) : ''}</strong></div>
      <form id="mf"><div class="form-grid">
        <div class="field"><label>Movement</label><select name="movement_type"><option value="receipt">Receive stock (+)</option><option value="fitment">Fit to vehicle (−)</option><option value="adjustment">Adjust (±)</option></select></div>
        <div class="field"><label>Quantity</label><input name="quantity" type="number" step="any" required value="1"></div>
        <div class="field" data-veh><label>Vehicle</label><select name="vehicle_id"><option value="">—</option>${vehicles.map((v) => `<option value="${v.id}">${VMTL.esc(v.vehicle_number)}</option>`).join('')}</select></div>
        <div class="field" data-pos><label>Position</label><input name="position" maxlength="60" placeholder="e.g. front-left"></div>
        <div class="field"><label>Odometer</label><input name="odometer" type="number" min="0"></div>
        <div class="field"><label>Note</label><input name="note" maxlength="500"></div>
      </div></form>
      <h3 class="mt">History</h3><div id="hist">${history.length ? `<table class="data"><tbody>${history.map((h) => `<tr><td>${VMTL.fmtDate(h.created_at)}</td><td>${VMTL.esc(h.movement_type)}</td><td>${h.quantity > 0 ? '+' : ''}${h.quantity}</td><td>${VMTL.esc(h.vehicle_number || h.position || h.note || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No movements yet.</div>'}</div></div>
      <div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn btn-primary" id="save">Record</button></div>`, { large: true });
    const sync = () => { const t = m.el.querySelector('[name=movement_type]').value; m.el.querySelector('[data-veh]').style.display = t === 'fitment' ? '' : 'none'; m.el.querySelector('[data-pos]').style.display = t === 'fitment' ? '' : 'none'; };
    m.el.querySelector('[name=movement_type]').onchange = sync; sync();
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#mf'); if (!form.reportValidity()) return;
      const body = {}; new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
      ['quantity', 'odometer', 'vehicle_id'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      try { await VMTL.api(`/parts/${p.id}/movements`, { method: 'POST', body }); m.close(); VMTL.toast('Recorded.', 'success'); loadStats(); load(); }
      catch (err) { VMTL.showErrors(err, form); }
    };
  }

  view.querySelector('#add').onclick = () => openForm();
  view.querySelector('#f-cat').onchange = load;
  view.querySelector('#f-low').onchange = load;
  loadStats(); load();
};
