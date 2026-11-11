'use strict';
// System settings: grouped editable values + a JSON data export.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Settings', 'Alert thresholds, feature flags and notifications.', '<a class="btn" href="/api/settings/export">Export data (JSON)</a>') +
    `<form id="sf"><div id="groups"><div class="loading"><span class="spinner"></span></div></div><div class="mt"><button class="btn btn-primary" type="submit">Save settings</button></div></form>`;
  let settings = [];
  try { settings = (await VMTL.api('/settings')).data; } catch (e) { view.querySelector('#groups').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  const groups = {};
  settings.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });
  view.querySelector('#groups').innerHTML = Object.entries(groups).map(([g, items]) => `<div class="card mb"><div class="card-head"><h3 style="margin:0;text-transform:capitalize">${VMTL.esc(g)}</h3></div><div class="card-body"><div class="form-grid">${items.map(fieldFor).join('')}</div></div></div>`).join('');
  view.querySelectorAll('.switch').forEach((b) => b.onclick = () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
  view.querySelector('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const payload = settings.map((s) => { const input = view.querySelector(`[data-key="${s.key}"]`); const value = s.type === 'boolean' ? input.getAttribute('aria-checked') === 'true' : input.value; return { key: s.key, value }; });
    try { await VMTL.api('/settings', { method: 'PUT', body: { settings: payload } }); VMTL.toast('Settings saved.', 'success'); } catch (err) { VMTL.showErrors(err); }
  };
};
function fieldFor(s) {
  const label = VMTL.esc(s.label || s.key);
  if (s.type === 'boolean') return `<div class="field"><label>${label}</label><button type="button" class="switch" role="switch" data-key="${s.key}" aria-checked="${s.value ? 'true' : 'false'}"><span class="switch-knob"></span></button></div>`;
  const type = s.type === 'integer' ? 'number' : 'text';
  return `<div class="field"><label>${label}</label><input data-key="${s.key}" type="${type}" value="${VMTL.esc(s.value == null ? '' : s.value)}"></div>`;
}
