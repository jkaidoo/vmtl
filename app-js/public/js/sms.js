'use strict';
// SMS provider configuration + test send. Secrets are write-only.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  view.innerHTML = VMTL.pageHead('SMS', 'Text-message provider settings and a test send.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; try { d = (await VMTL.api('/admin/messaging')).data.sms; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const providerFields = (prov) => (d.providers[prov] ? d.providers[prov].fields : []);
  const fieldsHtml = (prov) => providerFields(prov).map((f) => `<div class="field"><label>${esc(f.label)} ${f.secret && f.has_value ? '<span class="dim">(set — blank keeps it)</span>' : ''}</label><input data-sms-field="${f.key}" type="${f.secret ? 'password' : 'text'}" value="${esc(f.value || '')}"></div>`).join('');

  view.querySelector('#b').innerHTML = `
    <div class="card">
      <div class="card-head"><h3 style="margin:0">SMS gateway</h3><label class="checkbox"><input type="checkbox" id="sEnabled" ${d.enabled ? 'checked' : ''}> Enabled</label></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label>Provider</label><select id="sProvider">${Object.entries(d.providers).map(([k, v]) => `<option value="${k}" ${d.provider === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
          <div class="field"><label>Sender ID</label><input id="sSender" value="${esc(d.sender_id)}" maxlength="11"></div>
        </div>
        <div class="form-grid" id="smsFields">${fieldsHtml(d.provider)}</div>
        <div class="btn-row mt"><input id="testSms" placeholder="0244000000" style="max-width:200px"><button class="btn" id="testBtn">Send test SMS</button><button class="btn btn-primary" id="save">Save</button></div>
      </div>
    </div>`;

  view.querySelector('#sProvider').onchange = (e) => { view.querySelector('#smsFields').innerHTML = fieldsHtml(e.target.value); };
  view.querySelector('#testBtn').onclick = async () => { const to = view.querySelector('#testSms').value.trim(); if (!to) return VMTL.toast('Enter a number to test.', 'err'); try { const r = (await VMTL.api('/admin/messaging/test-sms', { method: 'POST', body: { to } })).data; VMTL.toast(r.message || (r.ok ? 'Sent.' : 'Failed.'), r.ok ? 'success' : 'err'); } catch (e) { VMTL.showErrors(e); } };
  view.querySelector('#save').onclick = async () => {
    const fields = {}; view.querySelectorAll('[data-sms-field]').forEach((i) => { if (i.value) fields[i.dataset.smsField] = i.value; });
    const sms = { enabled: view.querySelector('#sEnabled').checked, provider: view.querySelector('#sProvider').value, sender_id: view.querySelector('#sSender').value, fields };
    try { await VMTL.api('/admin/messaging', { method: 'PUT', body: { sms } }); VMTL.toast('SMS settings saved.', 'success'); } catch (e) { VMTL.showErrors(e); }
  };
};
