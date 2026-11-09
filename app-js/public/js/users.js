'use strict';
// User management: scoped list + create/edit modal + remove.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Users', 'Accounts within your organisation scope.', `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Add user</button>`) +
    `<div class="card pad mb"><input id="fSearch" placeholder="Search name or email…" style="max-width:280px"></div><div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const load = async () => {
    const list = view.querySelector('#list'); const qs = new URLSearchParams(); if (view.querySelector('#fSearch').value) qs.set('search', view.querySelector('#fSearch').value); qs.set('per_page', '100');
    try { const r = await VMTL.api(`/users?${qs}`); list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Org unit</th><th>Status</th><th></th></tr></thead><tbody>${r.data.map((u) => `<tr><td data-label="Name">${VMTL.esc(u.name)}${u.is_super_admin ? ' <span class="pill">Super</span>' : ''}${u.directory_provider ? ` <span class="pill">${VMTL.esc(u.directory_provider)}</span>` : ''}</td><td data-label="Email">${VMTL.esc(u.email)}</td><td data-label="Role">${VMTL.esc(u.role ? u.role.name : '—')}</td><td data-label="Org unit">${VMTL.esc(u.org_unit ? u.org_unit.name : '—')}</td><td data-label="Status">${u.active ? VMTL.badge('Active', 'green') : VMTL.badge('Inactive', 'grey')}</td><td data-label=""><div class="btn-row"><button class="btn btn-sm" data-edit='${encodeURIComponent(JSON.stringify(u))}'>Edit</button><button class="btn btn-sm" data-del="${u.id}">Remove</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No users.</div>';
      list.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => userModal(JSON.parse(decodeURIComponent(b.dataset.edit)), load));
      list.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await VMTL.confirm('Remove this user?', { danger: true, confirmLabel: 'Remove' })) { try { await VMTL.api(`/users/${b.dataset.del}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } } });
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#add').onclick = () => userModal(null, load);
  view.querySelector('#fSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  load();
};

function userModal(u, done) {
  const e = u || {};
  const roles = (VMTL.meta.roles || []).map((r) => `<option value="${r.id}" ${e.role && e.role.id === r.id ? 'selected' : ''}>${VMTL.esc(r.name)}</option>`).join('');
  const depts = (VMTL.meta.departments || []).map((d) => `<option value="${d.id}" ${e.department_id === d.id ? 'selected' : ''}>${VMTL.esc(d.name)}</option>`).join('');
  const m = VMTL.openModal(`<div class="modal-head"><h3>${u ? 'Edit user' : 'Add user'}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="uf"><div class="form-grid">
    <div class="field"><label>Name</label><input name="name" value="${VMTL.esc(e.name || '')}" required></div>
    <div class="field"><label>Email</label><input name="email" type="email" value="${VMTL.esc(e.email || '')}" required></div>
    <div class="field"><label>Password ${u ? '(blank = keep)' : ''}</label><input name="password" type="password" ${u ? '' : 'required'}></div>
    <div class="field"><label>Phone</label><input name="phone" value="${VMTL.esc(e.phone || '')}"></div>
    <div class="field"><label>Role</label><select name="role_id" required>${roles}</select></div>
    <div class="field"><label>Department</label><select name="department_id"><option value="">—</option>${depts}</select></div>
    <div class="field"><label>Org unit</label><select name="org_unit_id"><option value="">—</option>${VMTL.orgUnitOptions(e.org_unit_id)}</select></div>
    <div class="field" style="display:flex;align-items:flex-end"><label class="checkbox"><input type="checkbox" name="active" ${e.active === false ? '' : 'checked'}> Active</label></div>
  </div></form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
  m.el.querySelector('#save').onclick = async () => {
    const form = m.el.querySelector('#uf'); const body = { name: form.name.value, email: form.email.value, role_id: Number(form.role_id.value), active: form.active.checked };
    if (form.password.value) body.password = form.password.value;
    if (form.phone.value) body.phone = form.phone.value;
    if (form.department_id.value) body.department_id = Number(form.department_id.value);
    if (form.org_unit_id.value) body.org_unit_id = Number(form.org_unit_id.value);
    try { if (u) await VMTL.api(`/users/${u.id}`, { method: 'PUT', body }); else await VMTL.api('/users', { method: 'POST', body }); m.close(); VMTL.toast('Saved.', 'success'); done(); }
    catch (err) { VMTL.showErrors(err, form); }
  };
}
