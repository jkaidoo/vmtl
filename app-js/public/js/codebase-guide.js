'use strict';
// Codebase guide — a structured tour of the app's modules for the admin.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  view.innerHTML = VMTL.pageHead('Codebase guide', 'How this application is put together, module by module.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let groups; try { groups = (await VMTL.api('/admin/codebase-guide')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  view.querySelector('#b').innerHTML = groups.map((g) => `
    <div class="card mb">
      <div class="card-head"><h3 style="margin:0;color:var(--primary)">${esc(g.group)}</h3></div>
      <div class="card-body">
        ${g.blurb ? `<p class="muted" style="margin:0 0 12px">${esc(g.blurb)}</p>` : ''}
        <div class="cg-list">${g.items.map((it) => `<div class="cg-item"><code class="cg-path">${esc(it.path)}</code><div class="cg-desc">${esc(it.desc)}</div></div>`).join('')}</div>
      </div>
    </div>`).join('');
};
