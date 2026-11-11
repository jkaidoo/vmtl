'use strict';
// Report configuration — branding and defaults applied to analytics exports.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  view.innerHTML = VMTL.pageHead('Report configuration', 'Branding and defaults for exported reports (CSV / Excel / PDF).') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; try { d = (await VMTL.api('/admin/report-config')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  view.querySelector('#b').innerHTML = `
    <div class="card mb"><div class="card-head"><h3 style="margin:0">Branding</h3></div><div class="card-body"><div class="form-grid">
      <div class="field"><label>Organisation name</label><input id="org" value="${esc(d.org_name)}"></div>
      <div class="field"><label>Report title prefix</label><input id="prefix" value="${esc(d.title_prefix)}"></div>
      <div class="field" style="grid-column:1/-1"><label>Footer line</label><input id="footer" value="${esc(d.footer)}"></div>
      <div class="field"><label>Include KNUST logo on PDF</label><button type="button" class="switch" role="switch" id="logo" aria-checked="${d.include_logo ? 'true' : 'false'}"><span class="switch-knob"></span></button></div>
    </div></div></div>
    <div class="card mb"><div class="card-head"><h3 style="margin:0">Defaults</h3></div><div class="card-body"><div class="form-grid">
      <div class="field"><label>Default date range (days)</label><input id="range" type="number" min="1" max="366" value="${esc(d.default_range_days)}"></div>
      <div class="field"><label>Paper size</label><select id="paper">${['A4', 'Letter'].map((p) => `<option ${d.paper === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    </div></div></div>
    <div class="btn-row"><button class="btn btn-primary" id="save">Save configuration</button></div>`;

  view.querySelector('#logo').onclick = (e) => e.currentTarget.setAttribute('aria-checked', e.currentTarget.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  view.querySelector('#save').onclick = async () => {
    const body = { org_name: view.querySelector('#org').value, title_prefix: view.querySelector('#prefix').value, footer: view.querySelector('#footer').value, default_range_days: Number(view.querySelector('#range').value) || 30, include_logo: view.querySelector('#logo').getAttribute('aria-checked') === 'true', paper: view.querySelector('#paper').value };
    try { await VMTL.api('/admin/report-config', { method: 'PUT', body }); VMTL.toast('Report configuration saved.', 'success'); } catch (e) { VMTL.showErrors(e); }
  };
};
