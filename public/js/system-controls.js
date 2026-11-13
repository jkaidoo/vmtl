'use strict';
// Walk-in's operational controls, adapted to VMTL's available integrations.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  if (!document.querySelector('link[href="/css/system-controls.css"]')) {
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/css/system-controls.css'; document.head.appendChild(style);
  }
  view.innerHTML = `<div class="system-controls-page controls-page">${VMTL.pageHead('System controls', 'Operational settings reserved for system administrators.')}<div class="tabs controls-tabs" role="tablist" aria-label="System controls">${[['notifications','Notifications'],['retention','Retention'],['maintenance','Maintenance'],['flags','Feature flags']].map(([key,label], i) => `<button type="button" class="${i ? '' : 'active'}" role="tab" aria-selected="${!i}" data-tab="${key}">${label}</button>`).join('')}</div><section id="controlsHost" class="card card-pad" role="tabpanel"><div class="loading"><span class="spinner"></span></div></section></div>`;
  const host = view.querySelector('#controlsHost'); let data; let tab = 'notifications'; let saving = false;
  const api = async (path, options) => { const out = await VMTL.api('/admin/system-controls' + path, options); if (out.queued) throw new Error('Connect to the server to save system controls.'); return out.data; };
  const check = (name, checked, label, help) => `<label class="toggle-row"><span class="toggle-text"><b>${esc(label)}</b><small>${esc(help)}</small></span><input class="toggle" type="checkbox" role="switch" name="${name}"${checked ? ' checked' : ''}></label>`;
  const group = (title, help, rows) => `<section class="flag-group"><h3>${esc(title)}</h3>${help ? `<p class="hint">${esc(help)}</p>` : ''}${rows}</section>`;
  const field = (name, label, value, attrs = '') => `<label class="field"><span>${esc(label)}</span><input class="input" name="${name}" value="${esc(value)}" ${attrs}></label>`;
  const saveButton = label => `<div class="grid-span-all flex" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-primary">${label}</button></div>`;
  function values(form) {
    const out = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type="checkbox"]').forEach(box => { out[box.name] = box.checked; });
    form.querySelectorAll('input[type="number"]').forEach(input => { out[input.name] = Number(input.value); });
    return out;
  }
  async function save(section, form) {
    if (saving) return; saving = true;
    const body = values(form); const controls = [...form.elements, ...view.querySelectorAll('.controls-tabs button')];
    controls.forEach(control => { control.disabled = true; });
    const status = form.querySelector('[data-flag-status]'); if (status) status.textContent = 'Saving…';
    try { data = await api('/' + section, { method: 'PUT', body }); VMTL.toast(section === 'flags' ? 'Feature setting saved.' : 'System control saved.', 'success'); render(); }
    catch (error) { VMTL.showErrors(error); if (section === 'flags') render(); }
    finally { saving = false; controls.forEach(control => { control.disabled = false; }); }
  }
  function render() {
    const n = data.notifications; const r = data.retention; const m = data.maintenance; const f = data.flags;
    if (tab === 'notifications') {
      host.innerHTML = `<h2>Notification templates &amp; delivery</h2><p class="hint">Delivery controls for the email and SMS integrations configured on their settings pages.</p><form id="controlForm">${field('emailSubject','Email subject prefix',n.emailSubject,'maxlength="120"')}${field('smsPrefix','SMS sender prefix',n.smsPrefix,'maxlength="120"')}<p class="hint">The SMS prefix is added to template messages. The provider Sender ID is configured on the SMS page.</p>${check('emailEnabled',n.emailEnabled,'Allow email notifications','Controls automated email delivery when email is configured and its feature flag is on.')}${check('smsEnabled',n.smsEnabled,'Allow SMS notifications','Controls automated SMS delivery when the provider is configured and its feature flag is on.')}${saveButton('Save notification controls')}</form><div class="template-links"><a href="/email.html">Email settings &amp; templates</a><a href="/sms.html">SMS settings &amp; templates</a></div>${group('Device notifications (Web Push)','Delivers alerts to subscribed staff devices. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server. On iPhone, install the app on the Home Screen before enabling notifications.',`<label class="field"><span>Background push status</span><div class="result ${data.push.configured ? 'ok' : 'err'}" role="status">${data.push.configured ? 'Configured: devices can receive background push.' : 'Not configured: set the VAPID_* server secrets to enable.'}</div></label>`)}`;
    }
    if (tab === 'retention') {
      host.innerHTML = `<h2>Data retention</h2><p class="hint">Set 0 to retain records indefinitely. These values document retention policy; automatic pruning is not configured in VMTL. The audit ledger is permanent, and its value is kept as policy documentation.</p><form id="controlForm" class="grid-3">${field('auditDays','Audit logs (days)',r.auditDays,'type="number" min="0" max="36500" step="1" required')}${field('notificationDays','Notifications (days)',r.notificationDays,'type="number" min="0" max="36500" step="1" required')}${saveButton('Save retention policy')}</form>`;
    }
    if (tab === 'maintenance') {
      host.innerHTML = `<h2>Maintenance mode &amp; announcement</h2><p class="hint">Prepare a maintenance notice and operational announcement. Saves the maintenance state and message for controlled rollout; this setting is an administrator notice.</p><form id="controlForm">${check('enabled',m.enabled,'Maintenance mode prepared','Saves the maintenance state and message for administrators.')}<label class="field"><span>Announcement / maintenance message</span><textarea class="input" name="message" maxlength="2000" rows="4" placeholder="e.g. Planned maintenance on Sunday, 2:00–3:00 AM.">${esc(m.message)}</textarea></label><div class="banner" role="status" data-maintenance-preview><b>Announcement preview</b><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(m.message)}</p></div>${saveButton('Save maintenance control')}</form>`;
      host.querySelector('textarea').addEventListener('input', event => { host.querySelector('[data-maintenance-preview] p').textContent = event.target.value; });
    }
    if (tab === 'flags') {
      host.innerHTML = `<h2>Feature flags</h2><p class="hint">Changes save automatically when you switch a toggle. Delivery and staff sync read the saved controls on their next operation.</p><form id="controlForm">${group('Directory and lookups','',`<div class="result ${data.directoryConfigured ? 'ok' : ''}" style="margin-bottom:10px">${data.directoryConfigured ? 'Unified API connection settings are configured.' : 'Configure the staff data connection on the Unified API page.'}</div>` + check('liveDirectory',f.liveDirectory,'Use live staff directory API','Enables live staff searches, profiles and automatic staff enrichment using the saved Unified API connection.') + check('staffPhotos',f.staffPhotos,'Import staff profile photos','Fetches photos for staff lookups and future staff syncs. Existing saved avatars are preserved.'))}${group('Messages','Delivery also requires the matching channel configuration and notification permission.',check('emailNotifications',f.emailNotifications,'Email notifications','Allows automated email notifications to be delivered.') + check('smsNotifications',f.smsNotifications,'SMS notifications','Allows automated text messages to be delivered.') + check('pushNotifications',f.pushNotifications,'Device notifications (Web Push)','Allows notification alerts to be sent to subscribed devices.'))}<p class="hint" data-flag-status role="status" aria-live="polite">Changes save automatically.</p></form>`;
      host.querySelector('form').addEventListener('change', event => save('flags', event.currentTarget));
    }
    host.querySelector('form')?.addEventListener('submit', event => { event.preventDefault(); if (tab !== 'flags') save(tab, event.currentTarget); });
  }
  view.querySelectorAll('.controls-tabs button').forEach(button => button.addEventListener('click', () => {
    if (saving || !data) return; tab = button.dataset.tab;
    view.querySelectorAll('.controls-tabs button').forEach(item => { item.classList.toggle('active',item === button); item.setAttribute('aria-selected',String(item === button)); });
    render();
  }));
  try { data = await api('/config'); render(); } catch (error) { host.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
};
