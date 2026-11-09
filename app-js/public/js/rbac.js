'use strict';
// RBAC editor: per-role capability checkboxes grouped by capability group.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('RBAC', 'Edit each role’s capabilities. The System Administrator always holds every capability.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  const load = async () => {
    let d; try { d = (await VMTL.api('/rbac')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
    const groups = {}; d.capabilities.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
    view.querySelector('#b').innerHTML = d.roles.map((role) => `<div class="card pad mb" data-role="${role.id}"><div class="between"><h3>${VMTL.esc(role.name)}</h3><button class="btn btn-primary btn-sm" data-save="${role.id}">Save</button></div><div class="grid cols-3 mt">${Object.entries(groups).map(([g, caps]) => `<div><div class="dim" style="font-size:11.5px;text-transform:uppercase;font-weight:700">${VMTL.esc(g)}</div>${caps.map((c) => `<label class="checkbox" style="margin:4px 0"><input type="checkbox" data-cap="${c.key}" ${role.capabilities.includes(c.key) ? 'checked' : ''}> ${VMTL.esc(c.label)}</label>`).join('')}</div>`).join('')}</div></div>`).join('');
    view.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
      const card = b.closest('[data-role]'); const caps = [...card.querySelectorAll('[data-cap]:checked')].map((i) => i.dataset.cap);
      try { await VMTL.api(`/rbac/roles/${b.dataset.save}/capabilities`, { method: 'PUT', body: { capabilities: caps } }); VMTL.toast('Capabilities saved.', 'success'); } catch (e) { VMTL.showErrors(e); }
    });
  };
  load();
};
