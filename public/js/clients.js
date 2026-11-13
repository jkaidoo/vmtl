'use strict';
// Clients — staff who have signed in through the directory but hold no role yet.
// Their department, college, rank and designation come from the Unified API.
// An administrator assigns a role (which promotes them to a stakeholder and moves
// them to Users) or adjusts their organisational unit.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const esc = VMTL.esc;
  let clients = [];

  view.innerHTML = VMTL.pageHead('Clients', 'Staff who signed in through the directory and are waiting for a role. Their placement is pulled from the Unified API.') +
    `<div class="card">
       <div class="card-head"><h3 class="accounts-title">Clients</h3><div class="row" style="gap:8px">
         <input id="cSearch" class="input" placeholder="Search name or email…" style="min-width:200px">
         <span class="pill" style="display:inline-flex;align-items:center;gap:4px;color:var(--info);background:var(--info-tint)"><span class="btn-ic">${VMTL.icon('contacts')}</span><span id="cCount">—</span></span>
       </div></div>
       <div class="card-body" style="padding-top:12px"><div id="cList"><div class="loading"><span class="spinner"></span></div></div></div>
     </div>`;

  const placement = (c) => {
    const parts = [];
    if (c.org_unit && c.org_unit.name) parts.push(esc(c.org_unit.name));
    else if (c.department_name) parts.push(esc(c.department_name));
    return parts.length ? parts.join(' · ') : '<span class="dim">Unassigned</span>';
  };
  const rel = (v) => { if (!v) return 'Never'; const m = Math.round((Date.now() - new Date(String(v).replace(' ', 'T'))) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

  function render() {
    const list = view.querySelector('#cList');
    if (!clients.length) { list.innerHTML = '<div class="empty"><h4>No clients</h4><div>When a staff member signs in through the directory without a role, they appear here.</div></div>'; return; }
    const rows = clients.map((c) => `<tr>
      <td data-label="Staff name"><strong>${esc(c.name)}</strong><div class="dim" style="font-size:12px">${esc(c.email || '')}</div></td>
      <td data-label="Staff type">${c.staff_type ? `<span class="chip">${esc(c.staff_type)}</span>` : '<span class="dim">—</span>'}${c.staff_rank ? `<div class="dim" style="font-size:12px">${esc(c.staff_rank)}</div>` : ''}</td>
      <td data-label="Designation">${c.designation ? esc(c.designation) : '<span class="dim">—</span>'}</td>
      <td data-label="Placement">${placement(c)}${c.pending_org_unit_id ? ' <span class="badge amber" title="The directory now reports a different unit">OU change pending</span>' : ''}</td>
      <td data-label="Last sign-in"><span class="dim">${rel(c.last_login_at)}</span></td>
      <td data-label=""><div class="btn-row">
        <button class="btn btn-sm btn-primary" data-assign="${c.id}"><span class="btn-ic">${VMTL.icon('user-plus')}</span> Assign role</button>
        <button class="btn btn-sm" data-ou="${c.id}"><span class="btn-ic" style="color:var(--info)">${VMTL.icon('org')}</span> Unit</button>
        <button class="btn btn-sm btn-ghost" data-del="${c.id}" style="color:var(--danger)"><span class="btn-ic">${VMTL.icon('trash')}</span></button>
      </div></td></tr>`).join('');
    list.innerHTML = `<table class="data accounts"><thead><tr><th>STAFF NAME</th><th>STAFF TYPE</th><th>DESIGNATION</th><th>PLACEMENT</th><th>LAST SIGN-IN</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    list.querySelectorAll('[data-assign]').forEach((b) => b.onclick = () => assignRole(byId(b.dataset.assign)));
    list.querySelectorAll('[data-ou]').forEach((b) => b.onclick = () => moveUnit(byId(b.dataset.ou)));
    list.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await VMTL.confirm('Remove this client account? They can sign in again through the directory.', { danger: true, confirmLabel: 'Remove' })) { try { await VMTL.api(`/users/${b.dataset.del}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } } });
  }
  const byId = (id) => clients.find((c) => String(c.id) === String(id));
  const roleOpts = (sel) => (VMTL.meta.roles || []).map((r) => `<option value="${r.id}" ${sel === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');

  function assignRole(c) {
    const m = VMTL.openModal(`<div class="modal-head"><h3>Assign a role</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><div class="dim" style="font-size:12.5px;margin-bottom:10px">Giving <strong>${esc(c.name)}</strong> a role makes them a stakeholder and moves them to Users.</div>
        <div class="form-grid">
          <div class="field col-2"><label>Role</label><select id="aRole">${roleOpts(null)}</select></div>
          <div class="field col-2"><label>Organisational unit</label><select id="aOrg"><option value="">— keep current${c.org_unit && c.org_unit.name ? ` (${esc(c.org_unit.name)})` : ''} —</option>${VMTL.orgUnitOptions(c.org_unit_id)}</select></div>
        </div></div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="aSave">Assign role</button></div>`);
    m.el.querySelector('#aSave').onclick = async () => {
      const body = { role_id: Number(m.el.querySelector('#aRole').value) };
      const ou = m.el.querySelector('#aOrg').value; if (ou) body.org_unit_id = Number(ou);
      try { await VMTL.api(`/users/${c.id}`, { method: 'PATCH', body }); m.close(); VMTL.toast(`${c.name} is now a stakeholder.`, 'success'); load(); } catch (e) { VMTL.showErrors(e); }
    };
  }

  function moveUnit(c) {
    const m = VMTL.openModal(`<div class="modal-head"><h3>Organisational unit</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body">${c.pending_org_unit_id ? '<div class="alert-accent amber mb" style="font-size:12.5px">The directory now reports a different unit for this person. Choosing it clears the pending change.</div>' : ''}
        <div class="field"><label>Unit for <strong>${esc(c.name)}</strong></label><select id="mOrg"><option value="">— Unassigned —</option>${VMTL.orgUnitOptions(c.org_unit_id)}</select></div></div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="mSave">Save unit</button></div>`);
    m.el.querySelector('#mSave').onclick = async () => {
      const ou = m.el.querySelector('#mOrg').value;
      try { await VMTL.api(`/users/${c.id}`, { method: 'PATCH', body: { org_unit_id: ou ? Number(ou) : null } }); m.close(); VMTL.toast('Unit updated.', 'success'); load(); } catch (e) { VMTL.showErrors(e); }
    };
  }

  const load = async () => {
    const qs = new URLSearchParams(); const s = view.querySelector('#cSearch').value.trim(); if (s) qs.set('search', s); qs.set('per_page', '100'); qs.set('type', 'client');
    try { const r = await VMTL.api(`/users?${qs}`); clients = r.data; view.querySelector('#cCount').textContent = `${r.meta.total}`; render(); }
    catch (e) { view.querySelector('#cList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  let t; view.querySelector('#cSearch').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  await load();
};
