'use strict';
// Directory authentication: General / LDAP / Active Directory / Role Mapping tabs.
// Bind passwords are write-only. Includes a per-provider Test connection button.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Directory authentication', 'LDAP / Active Directory sign-in with group→role/unit mapping.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; try { d = (await VMTL.api('/admin/directory-auth')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }

  const fieldInput = (f) => {
    if (f.type === 'boolean') return `<div class="field"><label class="checkbox"><input type="checkbox" data-field="${f.key}" ${f.value ? 'checked' : ''}> ${VMTL.esc(f.label)}</label></div>`;
    if (f.type === 'select') return `<div class="field"><label>${VMTL.esc(f.label)}</label><select data-field="${f.key}">${Object.entries(f.options || {}).map(([v, l]) => `<option value="${v}" ${f.value === v ? 'selected' : ''}>${VMTL.esc(l)}</option>`).join('')}</select></div>`;
    return `<div class="field"><label>${VMTL.esc(f.label)}</label><input data-field="${f.key}" value="${VMTL.esc(f.value || '')}"></div>`;
  };
  const roleOpts = (sel) => (VMTL.meta.roles || []).map((r) => `<option value="${r.slug}" ${sel === r.slug ? 'selected' : ''}>${VMTL.esc(r.name)}</option>`).join('');
  const ruleRow = (r) => `<div class="row gap-sm rule" style="margin-bottom:6px"><input class="r-group" placeholder="Group DN" value="${VMTL.esc(r.group || '')}" style="flex:2"><select class="r-role" style="flex:1">${roleOpts(r.role)}</select><select class="r-org" style="flex:1"><option value="">— unit —</option>${VMTL.orgUnitOptions(r.org_unit_id)}</select><button class="btn btn-sm btn-ghost r-del" type="button">✕</button></div>`;

  view.querySelector('#b').innerHTML = `
    <div class="tabs" id="tabs"><button data-t="general" class="active">General</button><button data-t="ldap">LDAP</button><button data-t="ad">Active Directory</button><button data-t="mapping">Role Mapping</button></div>
    <div class="pane" data-p="general"><div class="card pad"><div class="form-grid">${d.general.fields.map(fieldInput).join('')}</div></div></div>
    <div class="pane hidden" data-p="ldap"><div class="card pad"><div class="form-grid">${d.ldap.fields.map(fieldInput).join('')}</div><div class="field"><label>Bind password ${d.ldap.has_bind_password ? '(set — blank keeps it)' : ''}</label><input id="ldapPw" type="password"></div><button class="btn" id="testLdap" type="button">Test connection</button></div></div>
    <div class="pane hidden" data-p="ad"><div class="card pad"><div class="form-grid">${d.ad.fields.map(fieldInput).join('')}</div><div class="field"><label>Bind password ${d.ad.has_bind_password ? '(set — blank keeps it)' : ''}</label><input id="adPw" type="password"></div><button class="btn" id="testAd" type="button">Test connection</button></div></div>
    <div class="pane hidden" data-p="mapping"><div class="card pad"><div class="form-grid"><div class="field"><label>Default role</label><select id="defRole">${roleOpts(d.mapping.default_role)}</select></div><div class="field"><label>Default org unit</label><select id="defOrg"><option value="">— none —</option>${VMTL.orgUnitOptions(d.mapping.default_org_unit)}</select></div></div><h3 class="mt">Group → role / unit rules</h3><div id="rules">${(d.mapping.rules || []).map(ruleRow).join('')}</div><button class="btn btn-sm mt" id="addRule" type="button">${VMTL.icon('plus')} Add rule</button></div></div>
    <div class="mt"><button class="btn btn-primary" id="save">Save directory settings</button></div>`;

  view.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { view.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); view.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t)); });
  const rules = view.querySelector('#rules');
  view.querySelector('#addRule').onclick = () => { rules.insertAdjacentHTML('beforeend', ruleRow({})); wireRules(); };
  const wireRules = () => rules.querySelectorAll('.r-del').forEach((b) => b.onclick = () => b.closest('.rule').remove());
  wireRules();
  const testBtn = async (provider, pwId) => { try { const r = (await VMTL.api('/admin/directory-auth/test', { method: 'POST', body: { provider } })).data; VMTL.toast(r.message, r.ok ? 'success' : 'err'); } catch (e) { VMTL.showErrors(e); } };
  view.querySelector('#testLdap').onclick = () => testBtn('ldap');
  view.querySelector('#testAd').onclick = () => testBtn('ad');

  view.querySelector('#save').onclick = async () => {
    const fields = [...view.querySelectorAll('[data-field]')].map((i) => ({ key: i.dataset.field, value: i.type === 'checkbox' ? i.checked : i.value }));
    const body = { fields, default_role: view.querySelector('#defRole').value, default_org_unit: view.querySelector('#defOrg').value || null,
      role_map: [...rules.querySelectorAll('.rule')].map((r) => ({ group: r.querySelector('.r-group').value.trim(), role: r.querySelector('.r-role').value, org_unit_id: r.querySelector('.r-org').value || null })).filter((r) => r.group) };
    if (view.querySelector('#ldapPw').value) body.ldap_bind_password = view.querySelector('#ldapPw').value;
    if (view.querySelector('#adPw').value) body.ad_bind_password = view.querySelector('#adPw').value;
    try { await VMTL.api('/admin/directory-auth', { method: 'PUT', body }); VMTL.toast('Directory settings saved.', 'success'); } catch (e) { VMTL.showErrors(e); }
  };
};
