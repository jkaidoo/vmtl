'use strict';
// Preventive-maintenance work orders: plan, track and complete jobs on vehicles.
// Completing a work order with a date records it in the vehicle's maintenance
// history automatically.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Work orders', 'Plan and track preventive maintenance.',
    `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} New work order</button>`) +
    `<div id="stats" class="grid cols-3 mb"></div>
     <div class="card">
       <div class="toolbar"><select id="f-status" class="input"><option value="">All statuses</option>${VMTL.enumOptions('work_order_status')}</select></div>
       <div id="list"><div class="loading"><span class="spinner"></span></div></div>
     </div>`;
  const kpi = (label, value) => `<div class="kpi"><div class="label">${VMTL.esc(label)}</div><div class="value metric">${value}</div></div>`;

  const loadStats = async () => {
    try { const { data } = await VMTL.api('/work-orders/stats');
      view.querySelector('#stats').innerHTML = kpi('Open', data.open) + kpi('Overdue', data.overdue) + kpi('Awaiting parts', data.awaiting_parts);
    } catch (_) {}
  };

  const load = async () => {
    const list = view.querySelector('#list');
    const st = view.querySelector('#f-status').value;
    try {
      const r = await VMTL.pagedApi(`/work-orders${st ? `?status=${st}` : ''}`, list, load);
      list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Number</th><th>Vehicle</th><th>Title</th><th>Priority</th><th>Status</th><th>Due</th><th>Cost</th></tr></thead><tbody>${r.data.map((w) => `
        <tr data-id="${w.id}" class="click">
          <td data-label="Number">${VMTL.esc(w.work_order_number)}</td>
          <td data-label="Vehicle">${VMTL.esc(w.vehicle ? w.vehicle.vehicle_number : '—')}</td>
          <td data-label="Title">${VMTL.esc(w.title)}</td>
          <td data-label="Priority">${VMTL.badge(w.priority_label, w.priority_color)}</td>
          <td data-label="Status">${VMTL.badge(w.status_label, w.status_color)}</td>
          <td data-label="Due">${w.due_date ? VMTL.fmtDate(w.due_date) + (w.is_overdue ? ' ' + VMTL.badge('overdue', 'red') : '') : '—'}</td>
          <td data-label="Cost">${VMTL.fmtCedis(w.total_cost)}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">No work orders.</div>';
      list.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => openForm(Number(tr.dataset.id)); });
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  const fields = (vehicles, w = {}) => `<div class="form-grid">
      <div class="field"><label>Vehicle</label><select name="vehicle_id" required>${vehicles.map((v) => `<option value="${v.id}" ${w.vehicle_id === v.id ? 'selected' : ''}>${VMTL.esc(v.vehicle_number)}</option>`).join('')}</select></div>
      <div class="field"><label>Priority</label><select name="priority">${VMTL.enumOptions('work_order_priority', w.priority || 'normal')}</select></div>
      <div class="field"><label>Type</label><select name="maintenance_type"><option value="">—</option>${VMTL.enumOptions('maintenance_type', w.maintenance_type)}</select></div>
      <div class="field"><label>Status</label><select name="status">${VMTL.enumOptions('work_order_status', w.status || 'open')}</select></div>
      <div class="field"><label>Scheduled date</label><input name="scheduled_date" type="date" value="${w.scheduled_date || ''}"></div>
      <div class="field"><label>Due date</label><input name="due_date" type="date" value="${w.due_date || ''}"></div>
      <div class="field"><label>Completed date</label><input name="completed_date" type="date" value="${w.completed_date || ''}"></div>
      <div class="field"><label>Odometer</label><input name="odometer" type="number" min="0" value="${w.odometer != null ? w.odometer : ''}"></div>
      <div class="field"><label>Labour cost (₵)</label><input name="labour_cost" type="number" step="0.01" min="0" value="${w.labour_cost != null ? w.labour_cost : ''}"></div>
      <div class="field"><label>Parts cost (₵)</label><input name="parts_cost" type="number" step="0.01" min="0" value="${w.parts_cost != null ? w.parts_cost : ''}"></div>
      <div class="field"><label>Provider</label><input name="service_provider" maxlength="255" value="${VMTL.esc(w.service_provider || '')}"></div>
      <div class="field"><label>Assigned to</label><input name="assigned_to" maxlength="200" value="${VMTL.esc(w.assigned_to || '')}"></div>
    </div>
    <div class="field"><label>Title</label><input name="title" required maxlength="200" value="${VMTL.esc(w.title || '')}"></div>
    <div class="field"><label>Description</label><textarea name="description" maxlength="5000">${VMTL.esc(w.description || '')}</textarea></div>
    <div class="field"><label>Remarks</label><input name="remarks" maxlength="2000" value="${VMTL.esc(w.remarks || '')}"></div>
    <div class="dim" style="font-size:12px">Setting status to Completed with a completed date records this in the vehicle's maintenance history.</div>`;

  async function openForm(id = null) {
    const vehicles = (await VMTL.api('/vehicles?all=1')).data;
    let w = {};
    if (id) { const list = await VMTL.api(`/work-orders?per_page=100`); w = list.data.find((x) => x.id === id) || {}; }
    const m = VMTL.openModal(`<div class="modal-head"><h3>${id ? VMTL.esc(w.work_order_number || 'Work order') : 'New work order'}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><form id="wf">${fields(vehicles, w)}</form></div>
      <div class="modal-foot">${id ? '<button class="btn btn-danger" id="del">Delete</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    if (id) m.el.querySelector('#del').onclick = async () => { if (!await VMTL.confirm(`Remove ${w.work_order_number}?`, { danger: true, confirmLabel: 'Delete' })) return; await VMTL.api(`/work-orders/${id}`, { method: 'DELETE' }); m.close(); VMTL.toast('Removed.', 'success'); loadStats(); load(); };
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#wf'); if (!form.reportValidity()) return;
      const body = {}; new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
      ['vehicle_id', 'odometer'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      ['labour_cost', 'parts_cost'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      try { await VMTL.api(id ? `/work-orders/${id}` : '/work-orders', { method: id ? 'PUT' : 'POST', body }); m.close(); VMTL.toast('Saved.', 'success'); loadStats(); load(); }
      catch (err) { VMTL.showErrors(err, form); }
    };
  }

  view.querySelector('#add').onclick = () => openForm();
  view.querySelector('#f-status').onchange = load;
  loadStats(); load();
};
