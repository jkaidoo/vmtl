'use strict';
(() => {
  if (!document.querySelector('link[href="/css/audit-logs.css"]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/audit-logs.css'; document.head.appendChild(link);
  }
  const esc = VMTL.esc;
  const badge = level => VMTL.badge(String(level).toUpperCase(), { error: 'red', warn: 'amber', info: 'blue', success: 'green' }[level] || 'grey');
  const pretty = value => JSON.stringify(value, null, 2);
  const time = value => value ? new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { timeZone: 'UTC' }) : 'Not recorded';
  window.VMTL_LOG_DETAIL = (title, entry, type = 'application') => {
    const audit = type === 'audit';
    const { id, level, event, at, category, message, ...fields } = entry;
    const metadata = audit ? [['Time (GMT)', time(entry.created_at)], ['Action', entry.action], ['Actor', entry.actor], ['Record', [entry.entity_type, entry.entity_id ? '#' + entry.entity_id : ''].filter(Boolean).join(' ')], ['Client IP address', entry.ip_address], ['User agent', entry.user_agent]] : [['Time (GMT)', time(at)], ['Event', event], ['Source', category === 'request' ? 'Request' : 'Application'], ['Client IP address', fields.ip], ['Request ID', fields.request_id], ['Duration', fields.duration_ms == null ? '' : `${fields.duration_ms} ms`]];
    const technical = audit ? { before: entry.old_values, after: entry.new_values } : fields;
    const modal = VMTL.openModal(`<div class="modal-head"><div><div class="log-kicker">${audit ? 'AUDIT ENTRY' : 'APPLICATION LOG'} · #${esc(id)}</div><h3>${esc(title)}</h3></div><button class="icon-btn" data-close aria-label="Close">×</button></div><div class="modal-body"><div class="mb">${audit ? `<span class="audit-chip">${esc(entry.action)}</span>` : badge(level)}</div><p class="log-detail-message">${esc(audit ? entry.description || 'No description recorded.' : message || event)}</p><dl class="log-metadata">${metadata.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || 'Not recorded')}</dd></div>`).join('')}</dl><details class="log-technical" open><summary>${audit ? 'Recorded changes' : 'Technical details'}</summary><pre>${esc(pretty(technical))}</pre></details></div><div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn btn-primary" id="copyLog">Copy ${audit ? 'entry' : 'log'}</button></div>`, { large: true });
    modal.el.querySelector('#copyLog').onclick = async () => { try { await navigator.clipboard.writeText(pretty(entry)); VMTL.toast('Copied.', 'success'); } catch (_) { VMTL.toast('Could not copy to clipboard.', 'err'); } };
    return modal;
  };
  window.VMTL_MOUNT_APPLICATION_LOGS = root => {
    root.innerHTML = `<div data-application-viewer class="application-log-viewer"><section class="log-alert-settings"><h3>Suspicious activity alerts</h3><p class="dim">Receive email alerts through VMTL’s configured email sender.</p><form id="alertSettings"><fieldset disabled><div class="field"><label for="alertRecipients">Recipient emails (comma-separated)</label><input id="alertRecipients" name="recipient" type="email" multiple maxlength="2500" placeholder="security@knust.edu.gh, it@knust.edu.gh"></div><label class="log-live"><input type="checkbox" name="enabled"> Enable email alerts</label><button class="btn btn-primary" type="submit">Save alert settings</button></fieldset><p class="dim" role="status" id="alertStatus">Loading alert settings…</p></form><details class="log-alert-help"><summary>What triggers an alert?</summary><ul><li>One IP fails sign-in for five different accounts within ten minutes.</li><li>One account fails sign-in from five different IP addresses within ten minutes.</li><li>A successful sign-in follows two or more failures within ten minutes.</li><li>An administrator account is temporarily locked after repeated failures.</li><li>System Administrator access is granted or removed.</li></ul><p class="dim">Repeated alerts for the same pattern are limited to one per ten minutes. Sign-in patterns are tracked on this server and reset when it restarts.</p></details></section>
      <section class="log-toolbar"><div class="btn-row" role="group" aria-label="Filter by level">${[['all', 'All'], ['success', 'Success'], ['info', 'Info'], ['warn', 'Warnings'], ['error', 'Errors']].map(([key, label]) => `<button class="btn btn-sm ${key === 'all' ? 'btn-primary' : ''}" data-log-level="${key}">${label} <span data-count="${key}"></span></button>`).join('')}</div><div class="log-filters"><div class="field"><label for="logSource">Source</label><select id="logSource"><option value="">All sources</option><option value="request">Requests</option><option value="app">Application</option></select></div><div class="field log-search"><label for="logSearch">Search logs</label><input type="search" id="logSearch" placeholder="Event, message, IP or request ID"></div><label class="log-live"><input type="checkbox" id="logLive" checked> Live</label><button class="btn btn-sm" id="logRefresh">Refresh</button></div><p class="dim log-retention" id="logNote"></p></section><div class="table-wrap"><table class="data"><thead><tr><th>Time (GMT)</th><th>Level</th><th>Source</th><th>Message</th><th></th></tr></thead><tbody id="logRows"></tbody></table></div><div class="log-pager"><span class="dim" id="logCount"></span><label>Rows <select id="logSize">${[10, 25, 50, 100].map(n => `<option>${n}</option>`).join('')}</select></label><button class="btn btn-sm" id="logPrev">Previous</button><button class="btn btn-sm" id="logNext">Next</button></div></div>`;
    let active = false, version = 0, timer, searchTimer, page = 1, perPage = 10, level = 'all', totalPages = 1, alertLoaded = false, modal;
    const connected = () => active && root.isConnected && !!root.querySelector('[data-application-viewer]');
    const api = async (path, options) => (await VMTL.api(path, options));
    async function load() {
      if (!connected()) return; const request = ++version;
      const params = new URLSearchParams({ level, page, per_page: perPage, category: root.querySelector('#logSource').value, search: root.querySelector('#logSearch').value.trim() });
      try {
        const result = await api('/admin/application-logs?' + params);
        if (!connected() || request !== version) return;
        page = result.meta.current_page; totalPages = result.meta.last_page;
        root.querySelector('#logRows').innerHTML = result.data.map(e => `<tr data-log-id="${e.id}" tabindex="0" class="log-row"><td class="log-time">${esc(time(e.timestamp))}</td><td>${badge(e.level)}</td><td>${e.category === 'request' ? 'Request' : 'Application'}</td><td class="log-message">${esc(e.message)}<small>${esc(e.event)}</small></td><td><button class="btn btn-sm" data-log-detail="${e.id}">Details</button></td></tr>`).join('') || '<tr><td colspan="5" class="dim">No entries match these filters.</td></tr>';
        root.querySelectorAll('[data-count]').forEach(el => { el.textContent = el.dataset.count === 'all' ? result.store.stored : result.counts[el.dataset.count] || 0; });
        root.querySelector('#logNote').textContent = `Latest ${result.store.capacity} events kept in memory on server ${result.store.machine} since ${time(result.store.started_at)} GMT. Entries clear when the server restarts.`;
        root.querySelector('#logCount').textContent = `${result.meta.total} ${result.meta.total === 1 ? 'entry' : 'entries'} · Page ${page} of ${totalPages}`;
        root.querySelector('#logPrev').disabled = page <= 1; root.querySelector('#logNext').disabled = page >= totalPages;
      } catch (error) { if (connected() && request === version) root.querySelector('#logNote').textContent = error.message; }
    }
    async function loadAlerts() {
      if (alertLoaded) return;
      try { const result = await api('/admin/security-alerts'); if (!connected()) return; showAlerts(result.data); alertLoaded = true; }
      catch (error) { if (connected()) root.querySelector('#alertStatus').textContent = error.message; }
    }
    function showAlerts(data, message = '') {
      const form = root.querySelector('#alertSettings'); form.elements.recipient.value = data.recipient; form.elements.enabled.checked = data.enabled; form.querySelector('fieldset').disabled = false;
      root.querySelector('#alertStatus').textContent = [message, !data.mail_ready ? 'Enable and configure Tekmail on the Email page to deliver alert emails. Alerts are still recorded in the logs.' : 'Email delivery is configured.'].filter(Boolean).join(' ');
    }
    root.querySelector('#alertSettings').onsubmit = async e => {
      e.preventDefault(); const form = e.target; const body = { enabled: form.elements.enabled.checked, recipient: form.elements.recipient.value }; form.querySelector('fieldset').disabled = true;
      try { const result = await api('/admin/security-alerts', { method: 'PUT', body }); if (connected()) showAlerts(result.data, 'Alert settings saved.'); }
      catch (error) { if (connected()) root.querySelector('#alertStatus').textContent = error.message; }
      finally { if (connected()) form.querySelector('fieldset').disabled = false; }
    };
    async function detail(id) {
      try { const result = await api('/admin/application-logs/' + id); if (connected()) { modal?.close(); modal = window.VMTL_LOG_DETAIL('Application log details', result.data); } }
      catch (error) { if (connected()) VMTL.showErrors(error); }
    }
    root.querySelector('#logRows').onclick = e => { const row = e.target.closest('[data-log-id]'); if (row) detail(row.dataset.logId); };
    root.querySelector('#logRows').onkeydown = e => { if (e.target.matches('tr[data-log-id]') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); detail(e.target.dataset.logId); } };
    root.querySelectorAll('[data-log-level]').forEach(b => b.onclick = () => { level = b.dataset.logLevel; page = 1; root.querySelectorAll('[data-log-level]').forEach(x => x.classList.toggle('btn-primary', x === b)); load(); });
    root.querySelector('#logSource').onchange = () => { page = 1; load(); };
    root.querySelector('#logSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; load(); }, 300); };
    root.querySelector('#logRefresh').onclick = load;
    root.querySelector('#logSize').onchange = e => { perPage = Number(e.target.value); page = 1; load(); };
    root.querySelector('#logPrev').onclick = () => { if (page > 1) { page--; load(); } };
    root.querySelector('#logNext').onclick = () => { if (page < totalPages) { page++; load(); } };
    function polling() { clearInterval(timer); if (active && root.querySelector('#logLive')?.checked) timer = setInterval(() => { if (!document.hidden && !root.querySelector('#logRows')?.contains(document.activeElement)) load(); }, 5000); }
    root.querySelector('#logLive').onchange = polling;
    const setActive = value => { active = value; ++version; clearTimeout(searchTimer); if (value) { load(); loadAlerts(); } else modal?.close(); polling(); };
    VMTL.onLeave(() => setActive(false));
    return { setActive };
  };
})();
