'use strict';
window.VMTL_MESSAGING_PAGE = async function (channel) {
  const { view, esc } = VMTL; const email = channel === 'email'; const name = email ? 'Email' : 'SMS';
  const current = window.WalkinUI?.captureView() || (() => view.isConnected);
  const api = async (path, options) => (await VMTL.api(`/admin/messaging${path}`, options)).data;
  if (!document.querySelector('link[href="/css/messaging.css"]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/messaging.css'; document.head.appendChild(link);
  }
  view.innerHTML = VMTL.pageHead(name, `Outgoing ${email ? 'email through the KNUST Tekmail hub' : 'text messages through mNotify'}: connection, test, activation and message templates.`) +
    `<div class="msg-grid">
      <details class="card msg-fold" open><summary>Delivery status</summary><section class="card-body" id="msgStatus"><div class="loading"><span class="spinner"></span></div></section></details>
      <details class="card msg-fold"><summary>Send a test</summary><section class="card-body" id="msgTest"></section></details>
      <details class="card msg-fold msg-wide"><summary>Connection settings</summary><section class="card-body" id="msgSettings"></section></details>
      <details class="card msg-fold msg-wide"><summary>Message templates</summary><section class="card-body" id="msgTemplates"><div class="loading"><span class="spinner"></span></div></section></details>
    </div>`;
  const statusHost = view.querySelector('#msgStatus'), settingsHost = view.querySelector('#msgSettings'), testHost = view.querySelector('#msgTest'), templatesHost = view.querySelector('#msgTemplates');
  let data, templates = [], result = null;
  const fail = error => { if (current()) VMTL.showErrors(error); };
  const fields = () => data.settings;
  async function refresh() { const out = await api(`/${channel}/connection`); if (!current()) return; data = out; renderStatus(); }
  function renderStatus() {
    const s = data.status;
    const states = {
      active: ['green', 'Active', `${name} delivery is switched on with a tested connection.`],
      untested: ['amber', 'Active, connection needs a test', 'The saved connection has not passed a test. Send one to confirm delivery.'],
      ready: ['blue', 'Tested, switched off', `The last test worked. Switch ${name} on to start delivering messages.`],
      needs_test: ['amber', 'Not tested', 'Send a test with the saved connection, then switch delivery on.'],
      not_set_up: ['grey', 'Not set up', 'Add your connection and API key below to get started.'],
    };
    const [color, title, detail] = states[s.state];
    const step = (n, text, done, active) => `<li class="msg-step ${done ? 'done' : active ? 'current' : ''}"><span>${done ? '✓' : n}</span>${text}</li>`;
    statusHost.innerHTML = `<p class="dim msg-intro">Connect, test, then switch on. Automated delivery stays off until you activate it.</p><div class="msg-state" role="status"><div>${VMTL.badge(title, color)}<p class="dim">${esc(detail)}</p></div><label class="msg-switch"><input id="msgEnabled" type="checkbox" role="switch" aria-label="Deliver ${name}" ${s.enabled ? 'checked' : ''} ${!s.enabled && !s.verified ? 'disabled' : ''}><span>${s.enabled ? 'On' : 'Off'}</span></label></div><ol class="msg-steps">${step(1, 'Connect', s.configured, !s.configured)}${step(2, 'Send a test', s.verified, s.configured && !s.verified)}${step(3, 'Switch on', s.enabled && s.verified, s.verified && !s.enabled)}</ol>${!s.enabled && !s.verified ? '<p class="dim msg-hint">The switch unlocks after a test succeeds.</p>' : ''}${s.last_test ? `<p class="msg-hint ${s.last_test.ok ? 'msg-ok' : 'msg-error'}">Last test ${s.last_test.ok ? 'sent' : 'failed'} to ${esc(s.last_test.to)} · ${esc(VMTL.fmtDateTime(s.last_test.at))}${s.last_test.ok ? '' : '<br>' + esc(s.last_test.message)}</p>` : ''}`;
    statusHost.querySelector('#msgEnabled').onchange = async e => {
      const button = e.target; const enabled = button.checked; button.disabled = true;
      if (!enabled && !await VMTL.confirm(`Automated ${name} messages will stop until delivery is switched back on.`, { danger: true, confirmLabel: 'Switch off' })) { renderStatus(); return; }
      try { const out = await api(`/${channel}/activate`, { method: 'POST', body: { enabled } }); if (!current()) return; data = out; renderStatus(); VMTL.toast(`${name} switched ${enabled ? 'on' : 'off'}.`, 'success'); }
      catch (error) { fail(error); if (current()) renderStatus(); }
    };
  }
  function renderSettings() {
    const s = fields();
    const field = (key, label, value, extra = '') => `<div class="field"><label for="msg-${key}">${label}</label><input id="msg-${key}" name="${key}" value="${esc(value || '')}" ${extra}></div>`;
    settingsHost.innerHTML = `<p class="dim msg-intro">Changing the address, key${email ? ', App ID or channel' : ' or sender ID'} requires a new test.</p><form id="msgSettingsForm" autocomplete="off">
      ${email ? field('api_url', 'API address', s.api_url, 'type="url" required') + `<div class="form-grid">${field('app_id', 'App ID (appId)', s.app_id, 'required maxlength="100"')}${field('channel', 'Channel (channel)', s.channel, 'required maxlength="100"')}</div>` : `<div class="form-grid"><div class="field"><label for="msg-provider">Provider</label><input id="msg-provider" value="mNotify" readonly></div>${field('sender_id', 'Sender ID (max 11 characters)', s.sender_id, 'required maxlength="11"')}</div>${field('api_url', 'API address', s.api_url, 'type="url" required')}`}
      <div class="field"><label for="msg-api_key">API key ${email ? '(X-API-KEY)' : ''} ${VMTL.badge(s.key_configured ? 'Set' : 'Not set', s.key_configured ? 'green' : 'grey')}${s.key_source === 'env' ? ' <span class="dim">from environment variable</span>' : ''}</label><input id="msg-api_key" name="api_key" type="password" autocomplete="new-password" placeholder="${s.key_configured ? 'Leave blank to keep the current key' : 'Paste the API key'}"></div>
      <p class="dim msg-hint">${email ? 'Sends through the KNUST Tekmail hub.' : 'Messages go through the mNotify quick-send endpoint. Use a sender ID approved by mNotify.'} The key stays on the server and is never returned to the browser.</p><div class="btn-row"><button class="btn btn-primary" type="submit">Save connection</button>${s.key_source === 'saved' ? '<button class="btn" id="msgClearKey" type="button">Remove saved key</button>' : ''}</div></form>`;
    settingsHost.querySelector('form').onsubmit = async e => { e.preventDefault(); await save(Object.fromEntries(new FormData(e.target)), e.target.querySelector('[type=submit]')); };
    settingsHost.querySelector('#msgClearKey')?.addEventListener('click', async e => { if (await VMTL.confirm('Remove the saved API key? Delivery will need a valid key.', { danger: true, confirmLabel: 'Remove key' })) await save({ clear_key: true }, e.target); });
  }
  async function save(body, button) {
    button.disabled = true;
    try { const out = await api(`/${channel}/connection`, { method: 'PUT', body }); if (!current()) return; data = out; renderSettings(); renderStatus(); VMTL.toast('Connection saved.', 'success'); }
    catch (error) { fail(error); } finally { button.disabled = false; }
  }
  function renderTest() {
    const to = testHost.querySelector('#msgTestTo')?.value || '';
    const template = testHost.querySelector('#msgTestTpl')?.value || 'test';
    testHost.innerHTML = `<p class="dim msg-intro">Uses the saved connection, even while ${name} is switched off. Save changes before sending a test.</p><form id="msgTestForm"><div class="field"><label for="msgTestTo">${email ? 'Email address' : 'Phone number'}</label><input id="msgTestTo" type="${email ? 'email' : 'tel'}" ${email ? 'multiple' : ''} required value="${esc(to)}" placeholder="${email ? 'you@knust.edu.gh' : '0244000000'}"></div><div class="msg-test-row"><div class="field"><label for="msgTestTpl">Message</label><select id="msgTestTpl">${templates.map(m => `<option value="${esc(m.key)}" ${m.key === template ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></div><button class="btn btn-primary" type="submit">Send test ${email ? 'email' : 'SMS'}</button></div></form><div aria-live="polite" class="msg-hint ${result?.ok ? 'msg-ok' : 'msg-error'}">${esc(result?.message || '')}</div>`;
    testHost.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true;
      try { const out = await api(`/test-${channel}`, { method: 'POST', body: { to: testHost.querySelector('#msgTestTo').value.trim(), template: testHost.querySelector('#msgTestTpl').value } }); if (!current()) return; result = out; renderTest(); await refresh(); }
      catch (error) { fail(error); } finally { button.disabled = false; }
    };
  }
  const [connection, catalogue] = await Promise.all([api(`/${channel}/connection`), api(`/${channel}/templates`)]);
  if (!current()) return; data = connection; templates = catalogue.meta; renderStatus(); renderSettings(); renderTest();
  if (!window.VMTL_MESSAGE_TEMPLATES) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/js/message-templates.js'; script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
  if (current()) await window.VMTL_MESSAGE_TEMPLATES(channel, templatesHost, { onTest: async () => { if (current()) await refresh(); } });
};
