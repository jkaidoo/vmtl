'use strict';
// Organisation tree management: indented hierarchy with counts + CRUD.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Organisation', 'The university org-unit tree. Scoping flows from here.', `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Add unit</button>`) +
    `<div class="card"><div id="tree"><div class="loading"><span class="spinner"></span></div></div></div>`;
  let types = [];
  const load = async () => {
    const tree = view.querySelector('#tree');
    try { const r = await VMTL.api('/org-units/tree'); types = r.types || [];
      tree.innerHTML = `<table class="data"><thead><tr><th>Unit</th><th>Type</th><th>Vehicles</th><th>Drivers</th><th>Staff</th><th></th></tr></thead><tbody>${r.data.map((u) => `<tr><td data-label="Unit"><span style="padding-left:${(u.depth || 0) * 18}px">${u.depth ? '└ ' : ''}${VMTL.esc(u.name)}</span></td><td data-label="Type">${VMTL.esc(u.type_label)}</td><td data-label="Vehicles">${u.vehicles_count}</td><td data-label="Drivers">${u.drivers_count}</td><td data-label="Staff">${u.users_count}</td><td data-label=""><div class="btn-row"><button class="btn btn-sm" data-edit='${encodeURIComponent(JSON.stringify(u))}'>Edit</button><button class="btn btn-sm" data-del="${u.id}" data-name="${VMTL.esc(u.name)}">Remove</button></div></td></tr>`).join('')}</tbody></table>`;
      tree.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => unitModal(JSON.parse(decodeURIComponent(b.dataset.edit)), types, load));
      tree.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await VMTL.confirm(`Remove "${b.dataset.name}"?`, { danger: true, confirmLabel: 'Remove' })) { try { await VMTL.api(`/org-units/${b.dataset.del}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } } });
    } catch (e) { tree.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#add').onclick = () => unitModal(null, types, load);
  load();
};

function unitModal(u, types, done) {
  const e = u || {};
  const typeOpts = (types.length ? types : VMTL.meta.enums.org_unit_type || []).map((t) => `<option value="${t.value}" ${e.type === t.value ? 'selected' : ''}>${VMTL.esc(t.label)}</option>`).join('');
  const m = VMTL.openModal(`<div class="modal-head"><h3>${u ? 'Edit unit' : 'Add unit'}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="of">
    <div class="field"><label>Name</label><input name="name" value="${VMTL.esc(e.name || '')}" required></div>
    <div class="form-grid"><div class="field"><label>Code</label><input name="code" value="${VMTL.esc(e.code || '')}"></div><div class="field"><label>Type</label><select name="type" required>${typeOpts}</select></div></div>
    <div class="field"><label>Parent unit</label><select name="parent_id"><option value="">— none (root) —</option>${VMTL.orgUnitOptions(e.parent_id)}</select></div>
  </form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`);
  m.el.querySelector('#save').onclick = async () => {
    const form = m.el.querySelector('#of'); const body = { name: form.name.value, type: form.type.value };
    if (form.code.value) body.code = form.code.value;
    if (form.parent_id.value) body.parent_id = Number(form.parent_id.value);
    try { if (u) await VMTL.api(`/org-units/${u.id}`, { method: 'PUT', body }); else await VMTL.api('/org-units', { method: 'POST', body }); m.close(); VMTL.toast('Saved.', 'success'); done(); }
    catch (err) { VMTL.showErrors(err, form); }
  };
}
