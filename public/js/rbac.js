'use strict';
// RBAC editor: per-role capability checkboxes grouped by capability group.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('RBAC', 'Edit each role’s capabilities. The System Administrator always holds every capability.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  const load = async () => {
    let d; try { d = (await VMTL.api('/rbac')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
    const groups = {}; d.capabilities.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
    const chev = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    const countLabel = (n) => `${n} capabilit${n === 1 ? 'y' : 'ies'}`;
    view.querySelector('#b').innerHTML = d.roles.map((role) => `<div class="card mb role-card" data-role="${role.id}">
      <button class="role-head" type="button" aria-expanded="false"><h3>${VMTL.esc(role.name)}</h3><span class="role-meta"><span class="cap-count">${countLabel(role.capabilities.length)}</span>${chev}</span></button>
      <div class="role-body"><div class="role-body-inner">
        <div class="grid cols-3">${Object.entries(groups).map(([g, caps]) => `<div><div class="dim" style="font-size:11.5px;text-transform:uppercase;font-weight:700">${VMTL.esc(g)}</div>${caps.map((c) => `<label class="checkbox" style="margin:4px 0"><input type="checkbox" data-cap="${c.key}" ${role.capabilities.includes(c.key) ? 'checked' : ''}> ${VMTL.esc(c.label)}</label>`).join('')}</div>`).join('')}</div>
        <div class="btn-row mt" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" data-save="${role.id}">Save</button></div>
      </div></div></div>`).join('');
    view.querySelectorAll('.role-head').forEach((h) => h.onclick = () => {
      const card = h.closest('.role-card'); const open = card.classList.toggle('open'); h.setAttribute('aria-expanded', String(open));
    });
    view.querySelectorAll('[data-save]').forEach((b) => b.onclick = async (ev) => {
      ev.stopPropagation();
      const card = b.closest('[data-role]'); const caps = [...card.querySelectorAll('[data-cap]:checked')].map((i) => i.dataset.cap);
      try { await VMTL.api(`/rbac/roles/${b.dataset.save}/capabilities`, { method: 'PUT', body: { capabilities: caps } }); const cc = card.querySelector('.cap-count'); if (cc) cc.textContent = countLabel(caps.length); VMTL.toast('Capabilities saved.', 'success'); } catch (e) { VMTL.showErrors(e); }
    });
  };
  load();
};
