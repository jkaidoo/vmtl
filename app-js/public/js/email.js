'use strict';
// Email (SMTP) configuration + test send. Password is write-only.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  view.innerHTML = VMTL.pageHead('Email', 'Outgoing mail (SMTP) settings and a test send.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; try { d = (await VMTL.api('/admin/messaging')).data.email; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  view.querySelector('#b').innerHTML = `
    <div class="card">
      <div class="card-head"><h3 style="margin:0">SMTP server</h3><label class="checkbox"><input type="checkbox" id="mEnabled" ${d.enabled ? 'checked' : ''}> Enabled</label></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label>Host</label><input id="mHost" value="${esc(d.host)}" placeholder="smtp.example.com"></div>
          <div class="field"><label>Port</label><input id="mPort" value="${esc(d.port)}" placeholder="587"></div>
          <div class="field"><label>Username</label><input id="mUser" value="${esc(d.username)}" autocomplete="off"></div>
          <div class="field"><label>Password ${d.has_password ? '<span class="dim">(set — blank keeps it)</span>' : ''}</label><input id="mPass" type="password" autocomplete="new-password"></div>
          <div class="field"><label>Encryption</label><select id="mEnc">${['tls', 'ssl', 'none'].map((e) => `<option ${d.encryption === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
          <div class="field"></div>
          <div class="field"><label>From name</label><input id="mFromName" value="${esc(d.from_name)}"></div>
          <div class="field"><label>From address</label><input id="mFrom" type="email" value="${esc(d.from_address)}" placeholder="vmtl@knust.edu.gh"></div>
        </div>
        <div class="btn-row mt"><input id="testTo" type="email" placeholder="you@example.com" style="max-width:260px"><button class="btn" id="testBtn">Send test email</button><button class="btn btn-primary" id="save">Save</button></div>
      </div>
    </div>`;

  view.querySelector('#testBtn').onclick = async () => { try { const r = (await VMTL.api('/admin/messaging/test-email', { method: 'POST', body: { to: view.querySelector('#testTo').value } })).data; VMTL.toast(r.message || (r.ok ? 'Sent.' : 'Failed.'), r.ok ? 'success' : 'err'); } catch (e) { VMTL.showErrors(e); } };
  view.querySelector('#save').onclick = async () => {
    const email = { enabled: view.querySelector('#mEnabled').checked, host: view.querySelector('#mHost').value, port: view.querySelector('#mPort').value, username: view.querySelector('#mUser').value, encryption: view.querySelector('#mEnc').value, from_name: view.querySelector('#mFromName').value, from_address: view.querySelector('#mFrom').value };
    if (view.querySelector('#mPass').value) email.password = view.querySelector('#mPass').value;
    try { await VMTL.api('/admin/messaging', { method: 'PUT', body: { email } }); VMTL.toast('Email settings saved.', 'success'); } catch (e) { VMTL.showErrors(e); }
  };
};
