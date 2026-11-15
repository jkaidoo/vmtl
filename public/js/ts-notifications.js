'use strict';
// Transport Schedule — roster messages: send SMS / email to drivers (with optional
// availability-confirmation links), manage templates, and see what was sent.
window.VMTL_PAGE = async function () {
  const view = VMTL.view, esc = VMTL.esc;
  const canSend = VMTL.can('schedule.notify');
  let events = [], templates = [];
  const state = { eventId: null, channel: 'sms', audience: 'assigned', include_link: true };

  async function load() {
    [events, templates] = await Promise.all([VMTL.api('/ts/events').then((r) => r.data), VMTL.api('/ts/message-templates').then((r) => r.data)]);
    state.eventId = state.eventId || (events[0] && events[0].id);
    render();
  }

  const PLACEHOLDERS = ['name', 'event', 'centre', 'role', 'date', 'link'];

  function render() {
    view.innerHTML = VMTL.pageHead('Roster messages', 'Send SMS or email to drivers, with optional availability-confirmation links.',
      canSend ? '<button class="btn" id="tpl">Templates</button>' : '') +
      (!events.length ? '<div class="card pad">No events yet.</div>' : `
      <div class="grid cols-2">
        <div class="card pad">
          <div class="field"><label>Event</label><select id="ev">${events.map((e) => `<option value="${e.id}" ${state.eventId === e.id ? 'selected' : ''}>${esc(e.title)} · ${esc(e.type_name)}</option>`).join('')}</select></div>
          <div class="row" style="gap:10px;flex-wrap:wrap">
            <div class="field" style="flex:1;min-width:140px"><label>Channel</label><select id="ch">${opt(['sms', 'email', 'both'], ['SMS', 'Email', 'SMS + Email'], state.channel)}</select></div>
            <div class="field" style="flex:1;min-width:160px"><label>Recipients</label><select id="aud">${opt(['assigned', 'unconfirmed', 'supervisors', 'pool'], ['All assigned drivers', 'Unconfirmed only', 'Supervisors', 'Whole pool'], state.audience)}</select></div>
          </div>
          <div class="field" id="subWrap"><label>Subject (email)</label><input id="subject" value="Transport schedule — {event}"></div>
          <div class="field"><label>Message</label><textarea id="msg" rows="6">Hi {name}, you are scheduled for {event} at {centre} as {role} on {date}. Please confirm: {link}</textarea></div>
          <div class="row" style="gap:6px;flex-wrap:wrap">${PLACEHOLDERS.map((p) => `<button class="btn btn-sm" data-ph="${p}">{${p}}</button>`).join('')}</div>
          <label class="checkbox mt"><input type="checkbox" id="link" ${state.include_link ? 'checked' : ''}> Include availability-confirmation link</label>
          <div class="field mt"><label>Template</label><div class="row" style="gap:6px"><select id="tplSel"><option value="">— choose —</option>${templates.map((t) => `<option value="${t.id}">${esc(t.name)} (${esc(t.channel)})</option>`).join('')}</select><button class="btn" id="saveTpl">Save as template</button></div></div>
          ${canSend ? '<button class="btn btn-primary btn-block mt" id="send">Preview & send</button>' : '<p class="dim">You can view but not send.</p>'}
        </div>
        <div class="card pad"><h3>Recent messages</h3><div id="history"><div class="loading"><span class="spinner"></span></div></div></div>
      </div>`);
    if (!events.length) return;
    const $ = (id) => view.querySelector('#' + id);
    const syncSub = () => { $('subWrap').style.display = state.channel === 'sms' ? 'none' : ''; };
    $('ev').onchange = (e) => { state.eventId = Number(e.target.value); drawHistory(); };
    $('ch').onchange = (e) => { state.channel = e.target.value; syncSub(); };
    $('aud').onchange = (e) => { state.audience = e.target.value; };
    $('link').onchange = (e) => { state.include_link = e.target.checked; };
    view.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => insertAt($('msg'), `{${b.dataset.ph}}`));
    $('tplSel').onchange = (e) => { const t = templates.find((x) => String(x.id) === e.target.value); if (!t) return; $('msg').value = t.message; if (t.subject) $('subject').value = t.subject; state.channel = t.channel; $('ch').value = t.channel; syncSub(); };
    $('saveTpl').onclick = saveTemplate;
    $('tpl')?.addEventListener('click', manageTemplates);
    if (canSend) $('send').onclick = sendFlow;
    syncSub(); drawHistory();
  }
  const opt = (vals, labels, sel) => vals.map((v, i) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${esc(labels[i])}</option>`).join('');
  function insertAt(ta, text) { const s = ta.selectionStart || ta.value.length; ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd || s); ta.focus(); }

  async function drawHistory() {
    const host = view.querySelector('#history'); if (!host) return;
    const rows = (await VMTL.api('/ts/events/' + state.eventId + '/notifications')).data;
    host.innerHTML = rows.length ? `<table class="data"><thead><tr><th>When</th><th>Channel</th><th>To</th><th>Result</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${VMTL.fmtDateTime(r.sent_at)}</td><td>${esc(r.channel)}</td><td>${r.recipient_count} (${esc(r.detail || '')})</td><td>${esc(r.status || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="dim">No messages sent for this event yet.</p>';
  }

  async function sendFlow() {
    const msg = view.querySelector('#msg').value.trim();
    const subject = view.querySelector('#subject').value;
    if (!msg) return VMTL.toast('Enter a message.', 'err');
    let recips;
    try { recips = (await VMTL.api(`/ts/events/${state.eventId}/recipients?audience=${state.audience}`)).data; } catch (e) { return VMTL.showErrors(e); }
    if (!recips.length) return VMTL.toast('No recipients for this selection.', 'err');
    const need = state.channel === 'email' ? 'email' : state.channel === 'sms' ? 'phone' : null;
    const missing = need ? recips.filter((r) => !r[need]).length : recips.filter((r) => !r.phone && !r.email).length;
    const m = VMTL.openModal(`<div class="modal-head"><h3>Send to ${recips.length} recipient(s)</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body">
      <p class="dim">Channel: <b>${esc(state.channel.toUpperCase())}</b> · Audience: <b>${esc(state.audience)}</b>${missing ? ` · <span style="color:var(--warning)">${missing} missing ${need || 'contact'}</span>` : ''}</p>
      <div style="max-height:40vh;overflow:auto"><table class="data"><thead><tr><th>Driver</th><th>Centre</th><th>Phone</th><th>Email</th></tr></thead><tbody>${recips.map((r) => `<tr><td>${esc(r.name)}${r.role_label ? ` · ${esc(r.role_label)}` : ''}</td><td>${esc(r.centre_name || '—')}</td><td>${esc(r.phone || '—')}</td><td>${esc(r.email || '—')}</td></tr>`).join('')}</tbody></table></div>
      </div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="doSend">Send now</button></div>`, { large: true });
    m.el.querySelector('#doSend').onclick = async () => {
      const btn = m.el.querySelector('#doSend'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = (await VMTL.api(`/ts/events/${state.eventId}/notify`, { method: 'POST', body: { channel: state.channel, audience: state.audience, subject, message: msg, include_link: state.include_link } })).data;
        m.close();
        VMTL.toast(`Sending to ${r.recipients} recipient(s)… results appear under Recent messages.`);
        drawHistory();
        // Delivery runs in the background; refresh the history a few times to catch the result.
        [2500, 6000, 12000].forEach((t) => setTimeout(() => { if (view.querySelector('#history')) drawHistory(); }, t));
      } catch (e) { btn.disabled = false; btn.textContent = 'Send now'; VMTL.showErrors(e); }
    };
  }

  async function saveTemplate() {
    const name = prompt('Template name:'); if (!name) return;
    try { await VMTL.api('/ts/message-templates', { method: 'POST', body: { name, channel: state.channel, subject: view.querySelector('#subject').value, message: view.querySelector('#msg').value } });
      templates = (await VMTL.api('/ts/message-templates')).data; render(); VMTL.toast('Template saved.'); } catch (e) { VMTL.showErrors(e); }
  }
  function manageTemplates() {
    const m = VMTL.openModal(`<div class="modal-head"><h3>Message templates</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body" id="tbody"></div><div class="modal-foot"><button class="btn" data-close>Done</button></div>`, { large: true });
    const draw = () => { m.el.querySelector('#tbody').innerHTML = templates.length ? `<table class="data"><thead><tr><th>Name</th><th>Channel</th><th>Message</th><th></th></tr></thead><tbody>${templates.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.channel)}</td><td class="dim" style="max-width:280px">${esc((t.message || '').slice(0, 80))}</td><td class="right"><button class="btn btn-sm btn-danger" data-del="${t.id}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<p class="dim">No templates yet. Compose a message and use “Save as template”.</p>'; m.el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { try { await VMTL.api('/ts/message-templates/' + b.dataset.del, { method: 'DELETE' }); templates = (await VMTL.api('/ts/message-templates')).data; draw(); } catch (e) { VMTL.showErrors(e); } }); };
    draw();
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) render(); });
  }

  await load();
};
