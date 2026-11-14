'use strict';
// Drivers: scoped list + CRUD modal (with optional self-service login) + (de)activate.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const canManage = VMTL.can('drivers.manage');
  view.innerHTML = VMTL.pageHead('Drivers', 'Drivers in your scope.', canManage ? `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Add driver</button>` : '') +
    `<div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const load = async () => {
    const list = view.querySelector('#list');
    try {
      const r = await VMTL.pagedApi('/drivers?all=1', list, load);
      list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Name</th><th>Staff ID</th><th>Phone</th><th>Licence</th><th>Status</th><th>Account</th>${canManage ? '<th></th>' : ''}</tr></thead><tbody>${r.data.map((d) => `<tr><td data-label="Name"><img src="${VMTL.esc(d.photo_url)}" alt="Driver photo" class="fleet-thumb" loading="lazy">${VMTL.esc(d.name)}</td><td data-label="Staff ID">${VMTL.esc(d.employee_id || '—')}</td><td data-label="Phone">${VMTL.esc(d.phone || '—')}</td><td data-label="Licence">${VMTL.esc(d.licence_number || '—')} ${d.licence_url && (VMTL.can('drivers.manage') || Number(d.user_id)===Number(VMTL.user.id)) ? `<a href="${VMTL.esc(d.licence_url)}" target="_blank" rel="noopener">Licence photo</a>` : ''}${d.licence_expiry ? ` <span class="dim">(${VMTL.fmtDate(d.licence_expiry)})</span>` : ''}</td><td data-label="Status">${VMTL.statusBadge(d)}</td><td data-label="Account">${d.has_account ? VMTL.esc(d.account_email || 'yes') : '—'}</td>${canManage ? `<td data-label=""><div class="btn-row"><button class="btn btn-sm" data-edit='${encodeURIComponent(JSON.stringify(d))}'>Edit</button><button class="btn btn-sm" data-active="${d.id}" data-to="${d.active ? 0 : 1}">${d.active ? 'Deactivate' : 'Reactivate'}</button></div></td>` : ''}</tr>`).join('')}</tbody></table>` : '<div class="empty">No drivers.</div>';
      list.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => driverModal(JSON.parse(decodeURIComponent(b.dataset.edit)), load));
      list.querySelectorAll('[data-active]').forEach((b) => b.onclick = async () => { try { await VMTL.api(`/drivers/${b.dataset.active}/active`, { method: 'POST', body: { active: b.dataset.to === '1' } }); VMTL.toast('Updated.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } });
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  if (view.querySelector('#add')) view.querySelector('#add').onclick = () => driverModal(null, load);
  load();
};

function driverModal(d, done) {
  const e = d || {};
  let savedRecord=null;
  const m = VMTL.openModal(`<div class="modal-head"><h3>${d ? 'Edit driver' : 'Add driver'}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="df"><div class="form-grid">${VMTL.uploadFields('driver')}
    <div class="field"><label>Name</label><input name="name" value="${VMTL.esc(e.name || '')}" required></div>
    <div class="field"><label>Staff ID</label><input name="employee_id" value="${VMTL.esc(e.employee_id || '')}"></div>
    <div class="field"><label>Phone</label><input name="phone" value="${VMTL.esc(e.phone || '')}"></div>
    <div class="field"><label>Licence number</label><input name="licence_number" value="${VMTL.esc(e.licence_number || '')}"></div>
    <div class="field"><label>Licence expiry</label><input name="licence_expiry" type="date" value="${e.licence_expiry || ''}"></div>
    <div class="field"><label>Org unit</label><select name="org_unit_id"><option value="">— default —</option>${VMTL.orgUnitOptions(e.org_unit_id)}</select></div>
  </div><div class="field"><label>Notes</label><textarea name="notes">${VMTL.esc(e.notes || '')}</textarea></div>
  <hr><label class="checkbox"><input type="checkbox" id="cl"> Provision / update a self-service login account</label>
  <div id="loginFields" class="hidden mt"><div class="form-grid"><div class="field"><label>Login email</label><input name="login_email" value="${VMTL.esc(e.account_email || '')}"></div><div class="field"><label>Password ${d && e.has_account ? '(blank = keep)' : ''}</label><input name="login_password" type="password"></div></div></div>
  </form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
  const cl = m.el.querySelector('#cl');
  if(!VMTL.can('users.manage')){cl.closest('label').hidden=true;}
  cl.onchange = () => m.el.querySelector('#loginFields').classList.toggle('hidden', !cl.checked);
  m.el.querySelector('#save').onclick = async () => {
    const form = m.el.querySelector('#df'); const body = {};
    if(!form.reportValidity()) return;
    new FormData(form).forEach((val, k) => { if (val !== '') body[k] = val; });
    if (body.org_unit_id) body.org_unit_id = Number(body.org_unit_id);
    body.create_login = cl.checked;
    try { const saved = (savedRecord || d) ? await VMTL.api(`/drivers/${savedRecord?.data.id || d.id}`, { method: 'PUT', body }) : await VMTL.api('/drivers', { method: 'POST', body }); savedRecord=saved; await VMTL.uploadFiles(form,'driver',saved.data.id); m.close(); VMTL.toast('Saved.', 'success'); done(); }
    catch (err) { if(savedRecord) VMTL.toast('The record was saved. Fix the file issue and Save again to retry the upload.','error'); VMTL.showErrors(err, form); }
  };
}
