'use strict';
// Broadcasts: compose an announcement and fan it out to an audience over the
// in-app, email and SMS channels, with a sent-history list.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  const roles = VMTL.meta.roles || [];
  view.innerHTML = VMTL.pageHead('Broadcasts', 'Send an announcement to staff across in-app, email and SMS.') + `
    <div class="grid cols-2" style="grid-template-columns:1.2fr 1fr;align-items:start">
      <div class="card">
        <div class="card-head"><h3 style="margin:0">New broadcast</h3></div>
        <div class="card-body">
          <div class="field"><label>Title</label><input id="bTitle" maxlength="160" placeholder="e.g. Fleet servicing this weekend"></div>
          <div class="field"><label>Message</label><textarea id="bMessage" maxlength="2000" rows="5" placeholder="Write your announcement…"></textarea></div>
          <div class="form-grid">
            <div class="field"><label>Audience</label><select id="bAudience"><option value="all">Everyone</option>${roles.map((r) => `<option value="${esc(r.slug)}">${esc(r.name)}s</option>`).join('')}</select></div>
            <div class="field"><label>Channels</label><div class="row wrap" style="gap:14px;padding-top:6px">
              <label class="checkbox"><input type="checkbox" id="chIn" checked disabled> In-app</label>
              <label class="checkbox"><input type="checkbox" id="chEmail"> Email</label>
              <label class="checkbox"><input type="checkbox" id="chSms"> SMS</label>
            </div></div>
          </div>
          <div class="btn-row mt"><button class="btn btn-primary" id="send">Send broadcast</button></div>
          <div class="dim" style="font-size:12.5px;margin-top:8px">In-app notifications are always delivered. Email and SMS require those channels to be configured and recipients to have an address/number.</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3 style="margin:0">Recent broadcasts</h3></div>
        <div class="card-body" style="padding-top:8px"><div id="history"><div class="loading"><span class="spinner"></span></div></div></div>
      </div>
    </div>`;

  const loadHistory = async () => {
    const h = view.querySelector('#history');
    try {
      const r = await VMTL.api('/admin/broadcasts');
      h.innerHTML = r.data.length ? `<div class="log-list">${r.data.map((b) => `<div class="log-item" style="display:block"><div class="between"><strong>${esc(b.meta ? b.meta.title : b.description)}</strong><span class="when">${VMTL.fmtDateTime(b.created_at)}</span></div><div class="dim" style="font-size:12.5px;margin-top:2px">${esc(b.by || 'System')}${b.meta ? ` · ${b.meta.recipients} recipient${b.meta.recipients === 1 ? '' : 's'} · ${b.meta.in_app} in-app${b.meta.emailed ? `, ${b.meta.emailed} email` : ''}${b.meta.texted ? `, ${b.meta.texted} SMS` : ''}` : ''}</div></div>`).join('')}</div>` : '<div class="dim">No broadcasts yet.</div>';
    } catch (e) { h.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };

  view.querySelector('#send').onclick = async () => {
    const title = view.querySelector('#bTitle').value.trim();
    const message = view.querySelector('#bMessage').value.trim();
    if (!title || !message) return VMTL.toast('Add a title and message.', 'err');
    const body = { title, message, audience: view.querySelector('#bAudience').value, channels: { in_app: true, email: view.querySelector('#chEmail').checked, sms: view.querySelector('#chSms').checked } };
    const btn = view.querySelector('#send'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = (await VMTL.api('/admin/broadcasts', { method: 'POST', body })).data;
      VMTL.toast(`Sent to ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}.`, 'success');
      view.querySelector('#bTitle').value = ''; view.querySelector('#bMessage').value = '';
      loadHistory();
    } catch (e) { VMTL.showErrors(e); }
    finally { btn.disabled = false; btn.textContent = 'Send broadcast'; }
  };
  loadHistory();
};
