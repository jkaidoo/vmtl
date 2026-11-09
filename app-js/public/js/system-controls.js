'use strict';
// System controls: feature flags, notifications, retention and maintenance mode.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('System controls', 'Feature flags, notifications, retention and maintenance mode.') + '<form id="sf"><div id="b"><div class="loading"><span class="spinner"></span></div></div><div class="mt"><button class="btn btn-primary" type="submit">Save</button></div></form>';
  let items = [];
  try { items = (await VMTL.api('/admin/system-controls')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  const groups = {}; items.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });
  view.querySelector('#b').innerHTML = Object.entries(groups).map(([g, list]) => `<div class="card pad mb"><h3 style="text-transform:capitalize">${VMTL.esc(g)}</h3><div class="form-grid mt">${list.map((s) => s.type === 'boolean' ? `<div class="field"><label class="checkbox"><input type="checkbox" data-key="${s.key}" ${s.value ? 'checked' : ''}> ${VMTL.esc(s.label)}</label></div>` : `<div class="field"><label>${VMTL.esc(s.label)}</label><input data-key="${s.key}" type="${s.type === 'integer' ? 'number' : 'text'}" value="${VMTL.esc(s.value == null ? '' : s.value)}"></div>`).join('')}</div></div>`).join('');
  view.querySelector('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const payload = items.map((s) => { const input = view.querySelector(`[data-key="${s.key}"]`); return { key: s.key, value: s.type === 'boolean' ? input.checked : input.value }; });
    try { await VMTL.api('/admin/system-controls', { method: 'PUT', body: { settings: payload } }); VMTL.toast('Saved.', 'success'); } catch (err) { VMTL.showErrors(err); }
  };
};
