'use strict';
// System controls — grouped feature flags, notifications, retention and
// maintenance mode, with walkin-style toggle switches.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  view.innerHTML = VMTL.pageHead('System controls', 'Feature flags, notifications, retention and maintenance mode.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let items = [];
  try { items = (await VMTL.api('/admin/system-controls')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const groups = {}; items.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });
  const control = (s) => s.type === 'boolean'
    ? `<button type="button" class="switch" role="switch" data-key="${s.key}" aria-checked="${s.value ? 'true' : 'false'}"><span class="switch-knob"></span></button>`
    : `<input data-key="${s.key}" type="${s.type === 'integer' ? 'number' : 'text'}" value="${esc(s.value == null ? '' : s.value)}">`;

  view.querySelector('#b').innerHTML = Object.entries(groups).map(([g, list]) => `
    <div class="card mb">
      <div class="card-head"><h3 style="margin:0;text-transform:capitalize">${esc(g)}</h3></div>
      <div class="card-body" style="padding-top:4px">${list.map((s) => `<div class="sc-row"><span class="sc-label">${esc(s.label)}</span>${control(s)}</div>`).join('')}</div>
    </div>`).join('') + '<div class="btn-row mt"><button class="btn btn-primary" id="save">Save changes</button></div>';

  view.querySelectorAll('.switch').forEach((b) => b.onclick = () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
  view.querySelector('#save').onclick = async () => {
    const payload = items.map((s) => {
      const el = view.querySelector(`[data-key="${s.key}"]`);
      return { key: s.key, value: s.type === 'boolean' ? el.getAttribute('aria-checked') === 'true' : el.value };
    });
    try { await VMTL.api('/admin/system-controls', { method: 'PUT', body: { settings: payload } }); VMTL.toast('Saved.', 'success'); } catch (err) { VMTL.showErrors(err); }
  };
};
