'use strict';
// Transport Schedule — reference data: event types, centres and driver groups.
window.VMTL_PAGE = async function () {
  const view = VMTL.view, esc = VMTL.esc;
  const canEdit = VMTL.can('schedule.config');

  let drivers = [];
  async function load() {
    const [types, centres, groups, leave, drv] = await Promise.all([
      VMTL.api('/ts/event-types'), VMTL.api('/ts/centres'), VMTL.api('/ts/driver-groups'),
      VMTL.api('/ts/leave'), VMTL.api('/ts/drivers'),
    ]);
    drivers = drv.data;
    render(types.data, centres.data, groups.data, leave.data);
  }

  const dot = (active) => VMTL.badge(active ? 'Active' : 'Inactive', active ? 'green' : 'grey');

  function render(types, centres, groups, leave) {
    const leaveBadge = (s) => VMTL.badge(s, s === 'pending' ? 'amber' : s === 'approved' ? 'green' : 'grey');
    view.innerHTML = VMTL.pageHead('Schedule reference data', 'Event types, centres, driver groups and driver leave used by the Transport Schedule builder.') +
      `<div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h3>Event types</h3>${canEdit ? '<button class="btn btn-sm btn-primary" id="addType">Add type</button>' : ''}</div>
          <div class="pad">${types.length ? `<table class="data"><thead><tr><th>Name</th><th>Status</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>${types.map((t) => `<tr><td><strong>${esc(t.name)}</strong>${t.description ? `<div class="dim">${esc(t.description)}</div>` : ''}</td><td>${dot(t.active)}</td>${canEdit ? `<td class="right"><button class="btn btn-sm" data-type="${t.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="dim">No event types yet.</p>'}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Centres</h3>${canEdit ? '<button class="btn btn-sm btn-primary" id="addCentre">Add centre</button>' : ''}</div>
          <div class="pad">${centres.length ? `<table class="data"><thead><tr><th>Name</th><th>Region</th><th>Cap</th><th>Status</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>${centres.map((c) => `<tr><td><strong>${esc(c.name)}</strong>${c.is_kumasi ? ' <span class="badge blue">Kumasi</span>' : ''}</td><td>${esc(c.region || '—')}</td><td>${c.max_cap || '—'}</td><td>${dot(c.active)}</td>${canEdit ? `<td class="right"><button class="btn btn-sm" data-centre="${c.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="dim">No centres yet.</p>'}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Driver groups</h3>${canEdit ? '<button class="btn btn-sm btn-primary" id="addGroup">Add group</button>' : ''}</div>
          <div class="pad">${groups.length ? `<table class="data"><thead><tr><th>Name</th><th>Members</th><th>Status</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>${groups.map((g) => `<tr><td><strong>${esc(g.name)}</strong></td><td>${g.member_count}</td><td>${dot(g.active)}</td>${canEdit ? `<td class="right"><button class="btn btn-sm" data-group="${g.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="dim">No driver groups yet.</p>'}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Driver leave</h3>${canEdit ? '<button class="btn btn-sm btn-primary" id="addLeave">Record leave</button>' : ''}</div>
          <div class="pad">${leave.length ? `<table class="data"><thead><tr><th>Driver</th><th>Dates</th><th>Status</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>${leave.map((l) => `<tr><td><strong>${esc(l.driver_name)}</strong>${l.reason ? `<div class="dim">${esc(l.reason)}</div>` : ''}</td><td>${VMTL.fmtDate(l.start_date)}${l.end_date && l.end_date !== l.start_date ? ' – ' + VMTL.fmtDate(l.end_date) : ''}</td><td>${leaveBadge(l.status)}</td>${canEdit ? `<td class="right">${l.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-leave-ap="${l.id}">Approve</button> <button class="btn btn-sm" data-leave-rj="${l.id}">Reject</button>` : `<button class="btn btn-sm btn-danger" data-leave-del="${l.id}">Delete</button>`}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="dim">No leave recorded. Approved leave blocks a driver from being assigned to overlapping events.</p>'}</div>
        </div>
      </div>`;
    if (!canEdit) return;
    const modal = (title, fields, save) => {
      const m = VMTL.openModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>✕</button></div><form><div class="modal-body"><div class="form-grid">${fields}</div></div><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></form>`);
      m.el.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const form = e.target; if (!form.reportValidity()) return; try { await save(Object.fromEntries(new FormData(form)), m); m.close(); await load(); } catch (err) { VMTL.showErrors(err, form); } };
      return m;
    };
    const f = (label, name, type = 'text', extra = '') => `<div class="field"><label>${label}</label><input name="${name}" type="${type}" ${extra}></div>`;
    const check = (label, name, on) => `<div class="col-2" style="margin-bottom:14px"><label class="checkbox" style="cursor:pointer;font-weight:600;color:var(--text)"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label></div>`;

    view.querySelector('#addType')?.addEventListener('click', () => modal('Add event type', f('Name', 'name', 'text', 'required') + f('Description', 'description'), (b) => VMTL.api('/ts/event-types', { method: 'POST', body: b })));
    view.querySelectorAll('[data-type]').forEach((btn) => btn.onclick = async () => {
      const t = (await VMTL.api('/ts/event-types')).data.find((x) => String(x.id) === btn.dataset.type);
      const m = modal('Edit event type', f('Name', 'name', 'text', 'required') + f('Description', 'description') + check('Active', 'active', t.active), (b) => VMTL.api('/ts/event-types/' + t.id, { method: 'PUT', body: { ...b, active: b.active === 'on' } }));
      m.el.querySelector('[name=name]').value = t.name; m.el.querySelector('[name=description]').value = t.description || '';
    });
    view.querySelector('#addCentre')?.addEventListener('click', () => modal('Add centre', f('Name', 'name', 'text', 'required') + f('Region', 'region') + f('Driver cap (0 = no cap)', 'max_cap', 'number', 'min="0" value="0"') + check('In Kumasi', 'is_kumasi'), (b) => VMTL.api('/ts/centres', { method: 'POST', body: { ...b, max_cap: Number(b.max_cap) || 0, is_kumasi: b.is_kumasi === 'on' } })));
    view.querySelectorAll('[data-centre]').forEach((btn) => btn.onclick = async () => {
      const c = (await VMTL.api('/ts/centres')).data.find((x) => String(x.id) === btn.dataset.centre);
      const m = modal('Edit centre', f('Name', 'name', 'text', 'required') + f('Region', 'region') + f('Driver cap (0 = no cap)', 'max_cap', 'number', 'min="0"') + check('In Kumasi', 'is_kumasi', c.is_kumasi) + check('Active', 'active', c.active), (b) => VMTL.api('/ts/centres/' + c.id, { method: 'PUT', body: { ...b, max_cap: Number(b.max_cap) || 0, is_kumasi: b.is_kumasi === 'on', active: b.active === 'on' } }));
      m.el.querySelector('[name=name]').value = c.name; m.el.querySelector('[name=region]').value = c.region || ''; m.el.querySelector('[name=max_cap]').value = c.max_cap;
    });
    view.querySelector('#addGroup')?.addEventListener('click', () => modal('Add driver group', f('Name', 'name', 'text', 'required') + f('Description', 'description'), (b) => VMTL.api('/ts/driver-groups', { method: 'POST', body: b })));
    view.querySelectorAll('[data-group]').forEach((btn) => btn.onclick = async () => {
      const g = (await VMTL.api('/ts/driver-groups')).data.find((x) => String(x.id) === btn.dataset.group);
      const m = modal('Edit driver group', f('Name', 'name', 'text', 'required') + f('Description', 'description') + check('Active', 'active', g.active), (b) => VMTL.api('/ts/driver-groups/' + g.id, { method: 'PUT', body: { ...b, active: b.active === 'on' } }));
      m.el.querySelector('[name=name]').value = g.name; m.el.querySelector('[name=description]').value = g.description || '';
    });
    view.querySelector('#addLeave')?.addEventListener('click', () => {
      const driverSel = `<div class="field"><label>Driver</label><select name="driver_id" required>${drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>`;
      modal('Record driver leave', driverSel + f('Start date', 'start_date', 'date', 'required') + f('End date', 'end_date', 'date') + f('Reason', 'reason') + check('Approve now', 'approve', true),
        (b) => VMTL.api('/ts/leave', { method: 'POST', body: { driver_id: Number(b.driver_id), start_date: b.start_date, end_date: b.end_date || b.start_date, reason: b.reason, approve: b.approve === 'on' } }));
    });
    view.querySelectorAll('[data-leave-ap]').forEach((b) => b.onclick = async () => { try { await VMTL.api('/ts/leave/' + b.dataset.leaveAp + '/decision', { method: 'POST', body: { decision: 'approved' } }); await load(); } catch (e) { VMTL.showErrors(e); } });
    view.querySelectorAll('[data-leave-rj]').forEach((b) => b.onclick = async () => { try { await VMTL.api('/ts/leave/' + b.dataset.leaveRj + '/decision', { method: 'POST', body: { decision: 'rejected' } }); await load(); } catch (e) { VMTL.showErrors(e); } });
    view.querySelectorAll('[data-leave-del]').forEach((b) => b.onclick = async () => { if (!await VMTL.confirm('Delete this leave record?')) return; try { await VMTL.api('/ts/leave/' + b.dataset.leaveDel, { method: 'DELETE' }); await load(); } catch (e) { VMTL.showErrors(e); } });
  }

  await load();
};
