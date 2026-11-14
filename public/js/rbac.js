'use strict';
window.VMTL_PAGE = async function () {
  const { view, esc } = VMTL;
  const current = window.WalkinUI?.captureView() || (() => view.isConnected);
  let data;
  const opened = new Set();
  view.innerHTML = VMTL.pageHead('RBAC', 'Add and manage roles, their descriptions and permissions. The App Owner always holds every capability.') + '<div class="btn-row mb"><button class="btn btn-primary" id="addRole">Add role</button></div><div id="rolesList"><div class="loading"><span class="spinner"></span></div></div>';
  const countLabel = n => `${n} capabilit${n === 1 ? 'y' : 'ies'}`;
  async function refreshSession() {
    const me = await VMTL.api('/me'); if (!current()) return;
    VMTL.user = me.user; VMTL.caps = me.user.capabilities || [];
    await VMTL.refreshNavigation();
  }
  function render() {
    const groups = {}; data.capabilities.forEach(c => { (groups[c.group] ||= []).push(c); });
    view.querySelector('#rolesList').innerHTML = data.roles.map(role => `<div class="card mb role-card ${opened.has(role.id) ? 'open' : ''}" data-role="${role.id}">
      <button class="role-head" type="button" aria-expanded="${opened.has(role.id)}"><h3>${esc(role.name)}</h3><span class="role-meta"><span class="cap-count">${countLabel(role.capabilities.length)}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg></span></button>
      <div class="role-body"><div class="role-body-inner"><div class="between mb" style="gap:12px;flex-wrap:wrap"><div><span class="rec-id">${esc(role.slug)}</span><p class="dim" style="margin:6px 0;font-size:13px">${esc(role.description || 'No description.')}</p><span class="dim" style="font-size:12px">${role.user_count} assigned account${Number(role.user_count) === 1 ? '' : 's'}</span></div><div class="btn-row"><button class="btn btn-sm" data-edit="${role.id}">Edit role</button><button class="btn btn-sm" data-remove="${role.id}">Remove role</button></div></div>
      <div class="grid cols-3">${Object.entries(groups).map(([group, caps]) => `<div><div class="dim" style="font-size:11.5px;text-transform:uppercase;font-weight:700">${esc(group)}</div>${caps.map(cap => `<label class="checkbox" style="margin:4px 0" title="${esc(cap.description || '')}"><input type="checkbox" data-cap="${cap.key}" ${role.capabilities.includes(cap.key) ? 'checked' : ''}> ${esc(cap.label)}</label>`).join('')}</div>`).join('')}</div>
      <div class="btn-row mt" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" data-save="${role.id}">Save permissions</button></div></div></div></div>`).join('') || '<div class="card pad empty">No roles yet. Add a role to get started.</div>';
    view.querySelectorAll('.role-head').forEach(button => button.onclick = () => {
      const card = button.closest('[data-role]'); const id = Number(card.dataset.role); const open = card.classList.toggle('open'); button.setAttribute('aria-expanded', String(open)); if (open) opened.add(id); else opened.delete(id);
    });
    view.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editor(data.roles.find(role => role.id === Number(button.dataset.edit))));
    view.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => removeRole(data.roles.find(role => role.id === Number(button.dataset.remove))));
    view.querySelectorAll('[data-save]').forEach(button => button.onclick = async () => {
      const card = button.closest('[data-role]'); const caps = [...card.querySelectorAll('[data-cap]:checked')].map(input => input.dataset.cap); button.disabled = true;
      try {
        const out = (await VMTL.api(`/rbac/roles/${button.dataset.save}/capabilities`, { method: 'PUT', body: { capabilities: caps } })).data;
        if (!current()) return; data = out; render(); await refreshSession(); VMTL.toast('Permissions saved.', 'success');
      } catch (error) { VMTL.showErrors(error); } finally { button.disabled = false; }
    });
  }
  function editor(role) {
    const m = VMTL.openModal(`<div class="modal-head"><h3>${role ? 'Edit role' : 'Add role'}</h3><button class="icon-btn" data-close aria-label="Close">×</button></div><form id="roleForm"><div class="modal-body"><div class="field"><label for="roleName">Role name</label><input id="roleName" name="name" value="${esc(role?.name || '')}" maxlength="100" required></div><div class="field"><label for="roleKey">Role key</label><input id="roleKey" name="slug" value="${esc(role?.slug || '')}" ${role ? 'readonly' : 'required pattern="[a-z][a-z0-9_]{0,63}" maxlength="64"'}><div class="dim" style="font-size:12px">${role ? 'The key stays fixed so existing references keep working.' : 'Lowercase letters, numbers and underscores. Start with a letter.'}</div></div><div class="field"><label for="roleDescription">Description</label><textarea id="roleDescription" name="description" maxlength="1000" rows="3">${esc(role?.description || '')}</textarea></div>${!role ? `<div class="field"><label for="roleCopy">Initial permissions</label><select id="roleCopy"><option value="">Start with no permissions</option>${data.roles.map(r => `<option value="${r.id}">Copy from ${esc(r.name)}</option>`).join('')}</select></div><p class="dim" style="font-size:12px">Expand the new role to review and save its permissions.</p>` : ''}<div role="alert" id="roleError" class="dim"></div></div><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">${role ? 'Save role' : 'Add role'}</button></div></form>`);
    const form = m.el.querySelector('form');
    if (!role) {
      let customKey = false; form.elements.slug.oninput = () => { customKey = true; };
      form.elements.name.oninput = () => { if (!customKey) form.elements.slug.value = form.elements.name.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64); };
    }
    form.onsubmit = async e => {
      e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
      const body = Object.fromEntries(new FormData(form));
      if (!role) body.capabilities = data.roles.find(r => r.id === Number(form.querySelector('#roleCopy').value))?.capabilities || [];
      try { const out = (await VMTL.api(role ? `/rbac/roles/${role.id}` : '/rbac/roles', { method: role ? 'PUT' : 'POST', body })).data;
        m.close(); if (!current()) return;
        if (!role) { const added = out.roles.find(r => r.slug === body.slug); if (added) opened.add(added.id); }
        data = out; render(); await refreshSession(); VMTL.toast(role ? 'Role updated.' : 'Role added.', 'success');
      } catch (error) { m.el.querySelector('#roleError').textContent = error.message; } finally { button.disabled = false; }
    };
  }
  function removeRole(role) {
    const count = Number(role.user_count);
    const m = VMTL.openModal(`<div class="modal-head"><h3>Remove role</h3><button class="icon-btn" data-close aria-label="Close">×</button></div><form id="removeRole"><div class="modal-body"><p>Remove <strong>${esc(role.name)}</strong> and its permissions?</p><p class="dim">${count ? `All ${count} assigned account${count === 1 ? '' : 's'} (including inactive accounts) must move to a replacement role. Account records and history are retained.` : 'No accounts are assigned to this role.'}</p>${count ? `<div class="field"><label for="replacementRole">Replacement role</label><select id="replacementRole" name="replacement_role_id" required><option value="">Choose a replacement</option>${data.roles.filter(r => r.id !== role.id).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>` : ''}<div class="dim" role="alert" id="removeError"></div></div><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">Remove role</button></div></form>`);
    m.el.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const button = e.target.querySelector('[type=submit]'); button.disabled = true;
      const body = count ? { replacement_role_id: Number(e.target.elements.replacement_role_id.value) } : {};
      try { const out = (await VMTL.api(`/rbac/roles/${role.id}`, { method: 'DELETE', body })).data; m.close(); if (!current()) return; data = out; opened.delete(role.id); render(); await refreshSession(); VMTL.toast('Role removed.', 'success'); }
      catch (error) { m.el.querySelector('#removeError').textContent = error.message; } finally { button.disabled = false; }
    };
  }
  view.querySelector('#addRole').onclick = () => { if (data) editor(); };
  try { data = (await VMTL.api('/rbac')).data; if (current()) render(); } catch (error) { if (current()) view.querySelector('#rolesList').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
};
