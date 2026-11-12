'use strict';
// Messaging: SMTP email + SMS provider configuration, with test send.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Messaging', 'Email (SMTP) and SMS provider settings. Secrets are write-only.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; try { d = (await VMTL.api('/admin/messaging')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  const providerFields = (prov) => (d.sms.providers[prov] ? d.sms.providers[prov].fields : []);
  const renderProviderFields = (prov) => providerFields(prov).map((f) => `<div class="field"><label>${VMTL.esc(f.label)} ${f.secret && f.has_value ? '(set — blank keeps it)' : ''}</label><input data-sms-field="${f.key}" type="${f.secret ? 'password' : 'text'}" value="${VMTL.esc(f.value || '')}"></div>`).join('');

  view.querySelector('#b').innerHTML = `
    <div class="card pad mb"><h3>Email (SMTP)</h3><div class="form-grid mt">
      <div class="field"><label class="checkbox"><input type="checkbox" id="mEnabled" ${d.email.enabled ? 'checked' : ''}> Enable email</label></div><div></div>
      <div class="field"><label>Host</label><input id="mHost" value="${VMTL.esc(d.email.host)}"></div>
      <div class="field"><label>Port</label><input id="mPort" value="${VMTL.esc(d.email.port)}"></div>
      <div class="field"><label>Username</label><input id="mUser" value="${VMTL.esc(d.email.username)}"></div>
      <div class="field"><label>Password ${d.email.has_password ? '(set — blank keeps it)' : ''}</label><input id="mPass" type="password"></div>
      <div class="field"><label>Encryption</label><select id="mEnc">${['tls', 'ssl', 'none'].map((e) => `<option ${d.email.encryption === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>From name</label><input id="mFromName" value="${VMTL.esc(d.email.from_name)}"></div>
      <div class="field"><label>From address</label><input id="mFrom" value="${VMTL.esc(d.email.from_address)}"></div>
    </div><div class="btn-row mt"><input id="testTo" placeholder="test@example.com" style="max-width:240px"><button class="btn" id="testEmail">Send test email</button></div></div>
    <div class="card pad"><h3>SMS</h3><div class="form-grid mt">
      <div class="field"><label class="checkbox"><input type="checkbox" id="sEnabled" ${d.sms.enabled ? 'checked' : ''}> Enable SMS</label></div><div></div>
      <div class="field"><label>Provider</label><select id="sProvider">${Object.entries(d.sms.providers).map(([k, v]) => `<option value="${k}" ${d.sms.provider === k ? 'selected' : ''}>${VMTL.esc(v.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Sender ID</label><input id="sSender" value="${VMTL.esc(d.sms.sender_id)}"></div>
    </div><div id="smsFields" class="form-grid">${renderProviderFields(d.sms.provider)}</div><div class="btn-row mt"><input id="testSms" placeholder="0244000000" style="max-width:200px"><button class="btn" id="testSmsBtn">Send test SMS</button></div></div>
    <div class="mt"><button class="btn btn-primary" id="save">Save messaging settings</button></div>`;

  view.querySelector('#sProvider').onchange = (e) => { view.querySelector('#smsFields').innerHTML = renderProviderFields(e.target.value); };
  view.querySelector('#testEmail').onclick = async () => { try { const r = (await VMTL.api('/admin/messaging/test-email', { method: 'POST', body: { to: view.querySelector('#testTo').value } })).data; VMTL.toast(r.message, r.ok ? 'success' : 'err'); } catch (e) { VMTL.showErrors(e); } };
  view.querySelector('#testSmsBtn').onclick = async () => { try { const r = (await VMTL.api('/admin/messaging/test-sms', { method: 'POST', body: { to: view.querySelector('#testSms').value } })).data; VMTL.toast(r.message, r.ok ? 'success' : 'err'); } catch (e) { VMTL.showErrors(e); } };
  view.querySelector('#save').onclick = async () => {
    const email = { enabled: view.querySelector('#mEnabled').checked, host: view.querySelector('#mHost').value, port: view.querySelector('#mPort').value, username: view.querySelector('#mUser').value, encryption: view.querySelector('#mEnc').value, from_name: view.querySelector('#mFromName').value, from_address: view.querySelector('#mFrom').value };
    if (view.querySelector('#mPass').value) email.password = view.querySelector('#mPass').value;
    const fields = {}; view.querySelectorAll('[data-sms-field]').forEach((i) => { if (i.value) fields[i.dataset.smsField] = i.value; });
    const sms = { enabled: view.querySelector('#sEnabled').checked, provider: view.querySelector('#sProvider').value, sender_id: view.querySelector('#sSender').value, fields };
    try { await VMTL.api('/admin/messaging', { method: 'PUT', body: { email, sms } }); VMTL.toast('Messaging settings saved.', 'success'); } catch (e) { VMTL.showErrors(e); }
  };
};
