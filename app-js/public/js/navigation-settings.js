'use strict';
// Navigation menu settings — show or hide navigation items across the app.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  const SECTIONS = [
    ['Workspace', [['dashboard', 'Dashboard'], ['requests', 'Requests'], ['approvals', 'Approvals'], ['goodwill', 'Goodwill'], ['external', 'External Travel'], ['trips', 'Trips']]],
    ['Fleet', [['vehicles', 'Vehicles'], ['drivers', 'Drivers'], ['maintenance', 'Maintenance'], ['fuel', 'Fuel']]],
    ['Insights', [['analytics', 'Analytics'], ['reports', 'Reports']]],
    ['Administration', [['users', 'Users'], ['org-units', 'Organisation'], ['settings', 'Settings'], ['audit', 'Audit Logs']]],
    ['System', [['app-health', 'App Health'], ['rbac', 'RBAC'], ['system-controls', 'System controls'], ['directory-auth', 'Directory authentication'], ['sms', 'SMS'], ['email', 'Email'], ['broadcasts', 'Broadcasts'], ['unified-api', 'Unified API'], ['report-config', 'Report configuration'], ['database', 'Database connections'], ['documentation', 'Documentation'], ['codebase-guide', 'Codebase guide']]],
    ['Help', [['how-it-works', 'How it works'], ['faqs', 'FAQs']]],
  ];
  view.innerHTML = VMTL.pageHead('Navigation menu', 'Show or hide items in the navigation. Hidden items stay reachable by URL.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let hidden = [];
  try { hidden = (await VMTL.api('/admin/navigation')).data.hidden || []; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const isHidden = (k) => hidden.includes(k);

  view.querySelector('#b').innerHTML = SECTIONS.map(([label, items]) => `
    <div class="card mb"><div class="card-head"><h3 style="margin:0">${esc(label)}</h3></div>
    <div class="card-body" style="padding-top:4px">${items.map(([k, l]) => `<div class="sc-row"><span class="sc-label">${esc(l)}</span><button type="button" class="switch" role="switch" data-key="${k}" aria-checked="${isHidden(k) ? 'false' : 'true'}"><span class="switch-knob"></span></button></div>`).join('')}</div></div>`).join('') +
    '<div class="btn-row"><button class="btn btn-primary" id="save">Save navigation</button></div>';

  view.querySelectorAll('.switch').forEach((b) => b.onclick = () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
  view.querySelector('#save').onclick = async () => {
    const nowHidden = [...view.querySelectorAll('.switch')].filter((b) => b.getAttribute('aria-checked') !== 'true').map((b) => b.dataset.key);
    try { await VMTL.api('/admin/navigation', { method: 'PUT', body: { hidden: nowHidden } }); VMTL.toast('Navigation saved. Reload to see changes.', 'success'); } catch (e) { VMTL.showErrors(e); }
  };
};
