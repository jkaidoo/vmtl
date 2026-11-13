'use strict';
// Staff accounts — walkin-style accounts table: scoped, sortable, with access
// chips, placement, status and last sign-in. Plus create/edit + add-from-directory.
function relTime(v) {
  if (!v) return 'Never signed in';
  const d = new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '—';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return s <= 5 ? 'just now' : `${s} sec ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const days = Math.floor(h / 24); if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return VMTL.fmtDate(v);
}

window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  let users = [];
  const sort = { key: 'name', dir: 'asc' };
  const COLS = [
    { key: 'name', label: 'Staff name', get: (u) => (u.name || '').toLowerCase() },
    { key: 'type', label: 'Type', get: (u) => u.directory_provider || 'local' },
    { key: 'access', label: 'Access', get: (u) => (u.role ? u.role.name : '').toLowerCase() },
    { key: 'placement', label: 'Placement', get: (u) => (u.org_unit ? u.org_unit.name : '').toLowerCase() },
    { key: 'status', label: 'Status', get: (u) => (u.active ? 1 : 0) },
    { key: 'last', label: 'Last sign-in', get: (u) => u.last_login_at || '' },
  ];
  const addBtn = `<button class="btn btn-primary" id="add">${VMTL.icon('user-plus')} New staff account</button>`;
  // Both ways to add a staff account are always offered: import from the
  // directory (LDAP/AD) or create a local account.
  const dirBtnHtml = `<button class="btn" id="dir"><span class="btn-ic" style="color:var(--info)">${VMTL.icon('contacts')}</span> Add from directory</button>`;

  view.innerHTML = VMTL.pageHead('Users', 'Staff accounts within your organisation scope.') +
    `<div class="card">
       <div class="card-head"><h3 class="accounts-title">Accounts</h3><div class="row" style="gap:8px">${dirBtnHtml}${addBtn}<span class="pill" style="display:inline-flex;align-items:center;gap:4px;color:var(--info);background:var(--info-tint)"><span class="btn-ic">${VMTL.icon('users')}</span><span id="count">—</span></span></div></div>
       <div class="card-body" style="padding-top:12px">
         <input id="fSearch" placeholder="Search name or email…" style="max-width:280px;margin-bottom:12px">
         <div id="list"><div class="loading"><span class="spinner"></span></div></div>
       </div>
     </div>`;

  const renderTable = () => {
    const list = view.querySelector('#list');
    if (!users.length) { list.innerHTML = '<div class="empty">No accounts.</div>'; return; }
    const col = COLS.find((c) => c.key === sort.key);
    const sorted = [...users].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      let r = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? r : -r;
    });
    const head = COLS.map((c) => `<th class="sortable" data-k="${c.key}">${esc(c.label.toUpperCase())}${sort.key === c.key ? ` <span class="sort-ind">${sort.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`).join('') + '<th></th>';
    const rows = sorted.map((u) => `<tr>
      <td data-label="Staff name"><div class="acct-name"><strong>${esc(u.name)}</strong>${u.is_super_admin ? '<span class="chip chip-accent">Super</span>' : ''}</div><div class="rec-id">${esc(u.email)}</div></td>
      <td data-label="Type"><span class="type-tag">${esc((u.directory_provider || 'local').toUpperCase())}</span></td>
      <td data-label="Access">${u.role ? `<span class="chip">${esc(u.role.name)}</span>` : '—'}</td>
      <td data-label="Placement">${u.org_unit ? esc(u.org_unit.name) : '—'}</td>
      <td data-label="Status">${u.active ? VMTL.badge('Active', 'green') : VMTL.badge('Inactive', 'grey')}</td>
      <td data-label="Last sign-in"><span class="dim">${esc(relTime(u.last_login_at))}</span></td>
      <td data-label=""><div class="btn-row"><button class="btn btn-sm" data-edit='${encodeURIComponent(JSON.stringify(u))}'><span class="btn-ic" style="color:var(--info)">${VMTL.icon('edit')}</span> Edit</button><button class="btn btn-sm" data-del="${u.id}"><span class="btn-ic" style="color:var(--danger)">${VMTL.icon('trash')}</span> Remove</button></div></td></tr>`).join('');
    list.innerHTML = `<table class="data accounts"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    list.querySelectorAll('th[data-k]').forEach((th) => th.onclick = () => {
      const k = th.dataset.k;
      if (sort.key === k) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.key = k; sort.dir = k === 'last' || k === 'status' ? 'desc' : 'asc'; }
      renderTable();
    });
    list.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => userModal(JSON.parse(decodeURIComponent(b.dataset.edit)), load));
    list.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await VMTL.confirm('Remove this account?', { danger: true, confirmLabel: 'Remove' })) { try { await VMTL.api(`/users/${b.dataset.del}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } } });
  };

  const load = async () => {
    const qs = new URLSearchParams(); const s = view.querySelector('#fSearch').value.trim(); if (s) qs.set('search', s); qs.set('per_page', '100'); qs.set('type', 'stakeholder');
    try { const r = await VMTL.api(`/users?${qs}`); users = r.data; view.querySelector('#count').textContent = `${r.meta.total} account${r.meta.total === 1 ? '' : 's'}`; renderTable(); }
    catch (e) { view.querySelector('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };

  view.querySelector('#add').onclick = () => userModal(null, load);
  const dirBtn = view.querySelector('#dir');
  if (dirBtn) dirBtn.onclick = () => directoryModal(load);
  view.querySelector('#fSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  load();
};

// Add staff from the directory: search LDAP/AD, then create a local account with
// an administrator-chosen role and org unit (defaults suggested from group mapping).
function directoryModal(done) {
  const roleOptions = (slug) => (VMTL.meta.roles || []).map((r) => `<option value="${r.id}" ${r.slug === slug ? 'selected' : ''}>${VMTL.esc(r.name)}</option>`).join('');
  const m = VMTL.openModal(`<div class="modal-head"><h3>Add staff from directory</h3><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body">
      <div class="row" style="gap:8px"><input id="dq" placeholder="Search name, username or email…" style="flex:1" autofocus><button class="btn btn-primary" id="dgo">Search</button></div>
      <div id="dres" class="stack" style="margin-top:14px"><div class="dim" style="font-size:13px">Search your organisation's directory to add a member of staff.</div></div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>Close</button></div>`, { large: true });
  const res = m.el.querySelector('#dres');
  const search = async () => {
    const q = m.el.querySelector('#dq').value.trim();
    if (!q) return;
    res.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
      const r = await VMTL.api(`/users/directory/search?q=${encodeURIComponent(q)}`);
      if (!r.enabled) { res.innerHTML = '<div class="empty">Directory sign-in is not enabled. Turn it on under Directory authentication.</div>'; return; }
      if (r.error) { res.innerHTML = `<div class="empty">${VMTL.esc(r.error)}</div>`; return; }
      if (!r.results.length) { res.innerHTML = '<div class="empty">No matching directory accounts.</div>'; return; }
      res.innerHTML = r.results.map((p) => `<div class="card pad" data-p='${encodeURIComponent(JSON.stringify(p))}'>
        <div class="between"><div><strong>${VMTL.esc(p.name)}</strong><div class="dim" style="font-size:12.5px">${VMTL.esc(p.email || p.username)}${p.email && p.username ? ` · ${VMTL.esc(p.username)}` : ''}</div></div><button class="btn btn-sm btn-primary" data-add>Add</button></div>
        <div class="assign hidden" style="margin-top:12px">
          <div class="form-grid">
            <div class="field"><label>Role</label><select class="aRole">${roleOptions(p.suggested_role)}</select></div>
            <div class="field"><label>Org unit</label><select class="aOrg"><option value="">—</option>${VMTL.orgUnitOptions(p.suggested_org_unit_id)}</select></div>
          </div>
          <div class="btn-row"><button class="btn btn-primary aGo">Add staff</button></div>
        </div></div>`).join('');
      res.querySelectorAll('[data-p]').forEach((row) => {
        const p = JSON.parse(decodeURIComponent(row.dataset.p));
        row.querySelector('[data-add]').onclick = () => row.querySelector('.assign').classList.toggle('hidden');
        row.querySelector('.aGo').onclick = async () => {
          const body = { username: p.username, name: p.name, role_id: Number(row.querySelector('.aRole').value) };
          if (p.email) body.email = p.email;
          const org = row.querySelector('.aOrg').value; if (org) body.org_unit_id = Number(org);
          try { await VMTL.api('/users/directory/import', { method: 'POST', body }); VMTL.toast(`${p.name} added.`, 'success'); m.close(); done(); }
          catch (err) { VMTL.showErrors(err); }
        };
      });
    } catch (e) { res.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  m.el.querySelector('#dgo').onclick = search;
  m.el.querySelector('#dq').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
}

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
    <div class="field" style="display:flex;align-items:flex-end"><label class="checkbox"><input type="checkbox" name="can_drive" ${e.can_drive ? 'checked' : ''}> Can also drive (add to the driver pool)</label></div>
  </div></form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
  m.el.querySelector('#save').onclick = async () => {
    const form = m.el.querySelector('#uf'); const body = { name: form.name.value, email: form.email.value, role_id: Number(form.role_id.value), active: form.active.checked, can_drive: form.can_drive.checked };
    if (form.password.value) body.password = form.password.value;
    if (form.phone.value) body.phone = form.phone.value;
    if (form.department_id.value) body.department_id = Number(form.department_id.value);
    if (form.org_unit_id.value) body.org_unit_id = Number(form.org_unit_id.value);
    try { if (u) await VMTL.api(`/users/${u.id}`, { method: 'PUT', body }); else await VMTL.api('/users', { method: 'POST', body }); m.close(); VMTL.toast('Saved.', 'success'); done(); }
    catch (err) { VMTL.showErrors(err, form); }
  };
}
