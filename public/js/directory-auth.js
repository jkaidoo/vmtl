'use strict';
// Directory authentication: a list of LDAP / Active Directory directories (each
// a saved entry, tried in order at sign-in) with a per-directory step-by-step
// Test, and an Activity tab (sign-in hits, per-directory stats, live sessions,
// accounts awaiting a role). Bind passwords are write-only. New directory
// accounts get no role/unit until an administrator assigns one in Users.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const esc = VMTL.esc;
  const PROVIDER = { ACTIVE_DIRECTORY: 'Active Directory', LDAP: 'LDAP' };

  view.innerHTML = VMTL.pageHead('Directory authentication', 'Let staff sign in with their university LDAP or Active Directory account. Add one entry per directory; new accounts get a role in Users.')
    + `<div class="tabs" id="daTabs"><button data-t="dirs" class="active">Directories</button><button data-t="activity">Activity</button></div>
       <div id="daDirs"><div class="loading"><span class="spinner"></span></div></div>
       <div id="daActivity" class="hidden"></div>`;

  const dirsEl = view.querySelector('#daDirs');
  const actEl = view.querySelector('#daActivity');
  let activityTimer = null;
  VMTL.onLeave(() => clearInterval(activityTimer));

  view.querySelectorAll('#daTabs button').forEach((b) => b.onclick = () => {
    view.querySelectorAll('#daTabs button').forEach((x) => x.classList.toggle('active', x === b));
    dirsEl.classList.toggle('hidden', b.dataset.t !== 'dirs');
    actEl.classList.toggle('hidden', b.dataset.t !== 'activity');
    clearInterval(activityTimer);
    if (b.dataset.t === 'activity') { loadActivity(); activityTimer = setInterval(() => { if (!document.hidden) loadActivity(); }, 30000); }
  });

  // ---- Directory list -----------------------------------------------------
  let directories = [];
  let offlineDays = 0;
  let offlineMax = 30;

  async function loadDirs() {
    dirsEl.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    let d;
    try { d = (await VMTL.api('/admin/directory-auth')).data; }
    catch (e) { dirsEl.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    directories = d.directories || [];
    offlineDays = d.offline_days || 0;
    offlineMax = d.offline_days_max || 30;
    renderList();
  }

  function renderList() {
    const enabled = directories.filter((x) => x.enabled).length;
    const rows = directories.length ? directories.map((d, i) => `
      <div class="card pad da-entry${d.enabled ? '' : ' off'}" style="margin-bottom:10px">
        <div class="between" style="gap:12px;flex-wrap:wrap">
          <div style="min-width:0">
            <div class="row gap-sm" style="flex-wrap:wrap;align-items:center">
              <span class="badge grey">${i + 1}</span><strong>${esc(d.name)}</strong>
              <span class="badge blue">${esc(PROVIDER[d.provider] || d.provider)}</span>
              ${d.enabled ? '<span class="badge green">Enabled</span>' : '<span class="badge grey">Disabled</span>'}
              ${d.tls_verify ? '' : '<span class="badge amber" title="Certificate verification is off">Cert not verified</span>'}
            </div>
            <div class="dim" style="font-size:12.5px;margin-top:4px">${esc(d.url || 'No server URL yet')}${d.base_dn ? ` · ${esc(d.base_dn)}` : ''}</div>
          </div>
          <div class="row gap-sm" style="flex-wrap:wrap">
            <button class="switch" role="switch" data-act="toggle" data-id="${esc(d.id)}" aria-checked="${d.enabled}" title="${d.enabled ? 'Disable' : 'Enable'}"><span class="switch-knob"></span></button>
            <button class="btn btn-sm" data-act="up" data-id="${esc(d.id)}" ${i === 0 ? 'disabled' : ''} title="Try earlier">↑</button>
            <button class="btn btn-sm" data-act="down" data-id="${esc(d.id)}" ${i === directories.length - 1 ? 'disabled' : ''} title="Try later">↓</button>
            <button class="btn btn-sm" data-act="test" data-id="${esc(d.id)}">Test</button>
            <button class="btn btn-sm" data-act="edit" data-id="${esc(d.id)}">Edit</button>
            <button class="btn btn-sm btn-ghost" data-act="delete" data-id="${esc(d.id)}" style="color:var(--danger)">Delete</button>
          </div>
        </div>
      </div>`).join('')
      : '<div class="empty"><h4>No directories yet</h4><div>Use “Add directory” to connect an LDAP or Active Directory server.</div></div>';

    const offlineOpts = [0, 1, 3, 7, 14, 30].concat([offlineDays]).filter((v, i, a) => v <= offlineMax && a.indexOf(v) === i).sort((a, b) => a - b)
      .map((n) => `<option value="${n}" ${n === offlineDays ? 'selected' : ''}>${n ? `Allow, up to ${n} day${n === 1 ? '' : 's'} after the last directory sign-in` : 'Off: no sign-in until a directory is back'}</option>`).join('');

    dirsEl.innerHTML = `
      <div class="between" style="flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div class="dim" style="font-size:13px">${directories.length ? `${enabled} of ${directories.length} enabled. At sign-in, enabled directories are tried in order until one knows the person.` : 'Add the LDAP or Active Directory servers staff can sign in with.'}</div>
        <button class="btn btn-primary" id="daAdd">${VMTL.icon('plus')} Add directory</button>
      </div>
      ${rows}
      <div class="card pad" style="margin-top:14px">
        <label style="font-weight:600">When no directory can be reached</label>
        <div class="dim" style="font-size:12.5px;margin:4px 0 8px">Directory accounts can sign in with the password a directory last accepted. Someone disabled in the directory can still use the old password until the limit runs out.</div>
        <select id="daOffline" style="max-width:420px">${offlineOpts}</select>
      </div>`;

    dirsEl.querySelector('#daAdd').onclick = () => renderEditor(null);
    dirsEl.querySelector('#daOffline').onchange = async (ev) => {
      const sel = ev.target; const prev = offlineDays; sel.disabled = true;
      try { offlineDays = (await VMTL.api('/admin/directory-auth/offline', { method: 'PUT', body: { days: Number(sel.value) } })).data.offline_days; VMTL.toast(offlineDays ? `Saved sign-in allowed for ${offlineDays} day(s).` : 'Saved sign-in turned off.', 'success'); }
      catch (e) { VMTL.toast(e.message, 'err'); sel.value = String(prev); }
      finally { sel.disabled = false; }
    };
    dirsEl.querySelectorAll('[data-act]').forEach((btn) => btn.onclick = () => onAction(btn.dataset.act, btn.dataset.id, btn));
  }

  async function onAction(act, id, btn) {
    const d = directories.find((x) => x.id === id); if (!d) return;
    if (act === 'edit') return renderEditor(d);
    if (act === 'test') return openTest(d);
    if (act === 'toggle') {
      btn.disabled = true;
      try { await VMTL.api(`/admin/directory-auth/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled: !d.enabled } }); VMTL.toast(`${d.name} ${d.enabled ? 'disabled' : 'enabled'}.`, 'success'); await loadDirs(); }
      catch (e) { VMTL.toast(e.message, 'err'); btn.disabled = false; }
      return;
    }
    if (act === 'up' || act === 'down') {
      const ids = directories.map((x) => x.id); const i = ids.indexOf(id); const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { directories = (await VMTL.api('/admin/directory-auth/order', { method: 'PUT', body: { ids } })).data.directories; renderList(); }
      catch (e) { VMTL.toast(e.message, 'err'); }
      return;
    }
    if (act === 'delete') {
      if (!(await VMTL.confirm(`Delete “${d.name}”? People can no longer sign in through it. Accounts it created stay, with their roles.`, { danger: true, confirmLabel: 'Delete' }))) return;
      try { await VMTL.api(`/admin/directory-auth/${encodeURIComponent(id)}`, { method: 'DELETE', body: { deletion_reason: 'Removed from Directory authentication' } }); VMTL.toast(`${d.name} deleted.`, 'success'); await loadDirs(); }
      catch (e) { VMTL.toast(e.message, 'err'); }
    }
  }

  // ---- Add / edit a directory ---------------------------------------------
  // [key, label, type, placeholder, wide?]  — a bare [label] starts a section.
  const FIELDS = [
    ['Directory'],
    ['name', 'Name', 'text', 'e.g. Staff Active Directory', true],
    ['provider', 'Provider', 'select'],
    ['url', 'Server URL', 'text', 'ldaps://dc01.knust.edu.gh:636'],
    ['base_dn', 'Base DN', 'text', 'DC=knust,DC=local', true],
    ['bind_dn', 'Bind DN / service account', 'text', 'svc_ldap_bind@knust.local', true],
    ['bind_secret', 'Bind password', 'password', 'Leave blank to keep the saved password'],
    ['start_tls', 'Use StartTLS (for ldap:// URLs)', 'switch'],
    ['Certificate'],
    ['tls_verify', "Verify the server's certificate (recommended)", 'switch', '', true],
    ['tls_ca', 'Trusted CA certificate (PEM)', 'textarea', '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\nNeeded when the directory uses the university\'s own certificate authority.', true],
    ['Finding people'],
    ['user_filter', 'User search filter', 'text', '(sAMAccountName={{username}})', true],
    ['username_attribute', 'Username attribute', 'text', 'sAMAccountName'],
    ['email_attribute', 'Email attribute', 'text', 'mail'],
    ['display_name_attribute', 'Display-name attribute', 'text', 'displayName'],
    ['group_base_dn', 'Group base DN', 'text', 'Optional'],
    ['required_group_dn', 'Required group DN', 'text', 'Optional: only members of this group may sign in', true],
  ];
  const DEFAULTS = { enabled: true, provider: 'ACTIVE_DIRECTORY', tls_verify: true, user_filter: '(sAMAccountName={{username}})', username_attribute: 'sAMAccountName', email_attribute: 'mail', display_name_attribute: 'displayName' };

  function renderEditor(d) {
    const editing = !!d;
    const v = editing ? d : DEFAULTS;
    const fieldHtml = ([key, label, type, placeholder, wide]) => {
      if (!label) return `<div class="da-section" style="grid-column:1/-1;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-2);margin:6px 0 0">${esc(key)}</div>`;
      const cls = `field${wide ? ' col-2' : ''}`;
      const val = v[key];
      if (type === 'select') return `<div class="${cls}"><label>${esc(label)}</label><select data-f="${key}"><option value="ACTIVE_DIRECTORY"${val === 'ACTIVE_DIRECTORY' ? ' selected' : ''}>Active Directory</option><option value="LDAP"${val === 'LDAP' ? ' selected' : ''}>LDAP</option></select></div>`;
      if (type === 'switch') return `<div class="${cls}"><label>${esc(label)}</label><button type="button" class="switch" role="switch" data-f="${key}" aria-checked="${val ? 'true' : 'false'}"><span class="switch-knob"></span></button>${key === 'tls_verify' ? '<div class="dim" style="font-size:12px;margin-top:4px">Turn off only to find out whether a certificate problem is blocking sign-in.</div>' : ''}</div>`;
      if (type === 'textarea') return `<div class="${cls}"><label>${esc(label)}</label><textarea data-f="${key}" rows="4" spellcheck="false" style="font-family:var(--mono,monospace);font-size:12px" placeholder="${esc(placeholder || '')}">${esc(key === 'bind_secret' ? '' : (val || ''))}</textarea></div>`;
      if (type === 'password') return `<div class="${cls}"><label>${esc(label)}</label><input type="password" autocomplete="new-password" data-f="${key}" placeholder="${esc(placeholder || '')}"><div class="dim" style="font-size:12px;margin-top:4px">${editing && d.bind_secret_configured ? 'A password is saved.' : 'No password saved yet.'}</div></div>`;
      return `<div class="${cls}"><label>${esc(label)}${key === 'name' ? ' <span style="color:var(--danger)">*</span>' : ''}</label><input data-f="${key}" value="${esc(val || '')}" placeholder="${esc(placeholder || '')}"></div>`;
    };

    dirsEl.innerHTML = `
      <div class="between" style="flex-wrap:wrap;gap:10px;margin-bottom:8px">
        <button class="btn btn-sm btn-ghost" id="daBack">← All directories</button>
        <div class="field" style="margin:0"><label style="display:flex;align-items:center;gap:8px">Enabled <button type="button" class="switch" role="switch" data-f="enabled" aria-checked="${v.enabled ? 'true' : 'false'}"><span class="switch-knob"></span></button></label></div>
      </div>
      <div class="card pad">
        <h3 style="margin:0 0 10px">${editing ? `Edit ${esc(d.name)}` : 'Add a directory'}</h3>
        <div class="form-grid" id="daForm">${FIELDS.map(fieldHtml).join('')}</div>
        <div class="row gap-sm" style="margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary" id="daSave">${editing ? 'Save changes' : 'Save directory'}</button>
          ${editing ? '<button class="btn" id="daSaveTest">Save and test</button>' : ''}
          <button class="btn btn-ghost" id="daCancel">Cancel</button>
        </div>
      </div>`;

    dirsEl.querySelectorAll('.switch[data-f]').forEach((b) => b.onclick = () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
    dirsEl.querySelector('#daBack').onclick = loadDirs;
    dirsEl.querySelector('#daCancel').onclick = loadDirs;

    const collect = () => {
      const body = {};
      dirsEl.querySelectorAll('[data-f]').forEach((i) => {
        const k = i.dataset.f;
        if (i.getAttribute('role') === 'switch') body[k] = i.getAttribute('aria-checked') === 'true';
        else body[k] = i.value;
      });
      if (!body.bind_secret) delete body.bind_secret;
      return body;
    };
    const save = async () => {
      const body = collect();
      try {
        const out = editing
          ? await VMTL.api(`/admin/directory-auth/${encodeURIComponent(d.id)}`, { method: 'PATCH', body })
          : await VMTL.api('/admin/directory-auth', { method: 'POST', body });
        VMTL.toast(`${out.data.directory.name} saved.`, 'success');
        return out.data.directory;
      } catch (e) { VMTL.toast(e.message, 'err'); return null; }
    };
    dirsEl.querySelector('#daSave').onclick = async () => { const saved = await save(); if (saved) await loadDirs(); };
    const stBtn = dirsEl.querySelector('#daSaveTest');
    if (stBtn) stBtn.onclick = async () => { const saved = await save(); if (saved) { directories = (await VMTL.api('/admin/directory-auth')).data.directories; openTest(saved); } };
  }

  // ---- Test modal (step by step) ------------------------------------------
  function openTest(d) {
    const m = VMTL.openModal(`
      <div class="modal-head"><h3>Test ${esc(d.name)}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body">
        <div class="dim" style="font-size:12.5px;margin-bottom:10px">${esc(d.url || 'No server URL')}. Add a directory username and password to also check a person can sign in — no account is created.</div>
        <div class="form-grid">
          <div class="field"><label>Test username (optional)</label><input id="tU" autocomplete="off" placeholder="e.g. jdoe"></div>
          <div class="field"><label>Test password</label><input id="tP" type="password" autocomplete="new-password"></div>
        </div>
        <ol id="tSteps" style="margin:12px 0 0;padding-left:0;list-style:none"></ol>
      </div>
      <div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn btn-primary" id="tRun">Run test</button></div>`, { large: true });
    const steps = m.el.querySelector('#tSteps');
    const run = m.el.querySelector('#tRun');
    run.onclick = async () => {
      run.disabled = true; run.textContent = 'Testing…';
      steps.innerHTML = '<li class="dim"><span class="spinner"></span> Contacting the directory…</li>';
      try {
        const out = (await VMTL.api(`/admin/directory-auth/${encodeURIComponent(d.id)}/test`, { method: 'POST', body: { username: m.el.querySelector('#tU').value, password: m.el.querySelector('#tP').value } })).data;
        const line = (ok, label, detail) => `<li style="display:flex;gap:8px;padding:5px 0;align-items:flex-start"><span style="color:${ok ? 'var(--success)' : 'var(--danger)'};font-weight:700">${ok ? '✓' : '✕'}</span><span><strong>${esc(label)}</strong>${detail ? `<div class="dim" style="font-size:12px">${esc(detail)}</div>` : ''}</span></li>`;
        let html = (out.steps || []).map((s) => line(s.ok, s.label, s.detail)).join('');
        if (out.ok) html += line(true, out.identity ? `${out.identity.full_name || out.identity.username} can sign in` : 'Connection works', `${out.ms} ms${out.identity && out.identity.email ? ` · ${out.identity.email}` : ''}`);
        else if (!(out.steps || []).length) html += line(false, 'Test failed', out.error || '');
        steps.innerHTML = html;
      } catch (e) { steps.innerHTML = `<li style="color:var(--danger)">✕ ${esc(e.message)}</li>`; }
      finally { run.disabled = false; run.textContent = 'Run test again'; m.el.querySelector('#tP').value = ''; }
    };
    m.el.querySelector('#tU').focus();
  }

  // ---- Activity -----------------------------------------------------------
  let actDays = 7;
  const ago = (iso) => { if (!iso) return '—'; const mins = Math.round((Date.now() - new Date(iso)) / 60000); return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`; };
  const KIND = { 'directory.login_success': ['green', 'Signed in'], 'directory.login_failure': ['amber', 'Refused'], 'directory.error': ['red', 'Server error'], 'directory.test': ['grey', 'Test'] };

  async function loadActivity() {
    let a;
    try { a = (await VMTL.api(`/admin/directory-auth/activity?days=${actDays}`)).data; }
    catch (e) { actEl.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const max = Math.max(1, ...a.daily.map((x) => x.success + x.failure + x.error));
    const pct = (n) => Math.round((n / max) * 100);
    const stat = (label, value, foot) => `<div class="card pad"><div class="dim" style="font-size:12px">${esc(label)}</div><div style="font-size:26px;font-weight:700">${value}</div><div class="dim" style="font-size:11.5px">${esc(foot)}</div></div>`;

    actEl.innerHTML = `
      <div class="between" style="flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div class="row gap-sm"><span class="badge ${a.sessions.length ? 'green' : 'grey'}">${a.sessions.length} active directory session${a.sessions.length === 1 ? '' : 's'}</span></div>
        <div class="row gap-sm">
          ${[1, 7, 30].map((n) => `<button class="btn btn-sm${n === actDays ? ' btn-primary' : ''}" data-days="${n}">${n === 1 ? 'Today' : `${n} days`}</button>`).join('')}
          <button class="btn btn-sm" id="actRefresh">Refresh</button>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        ${stat('Sign-in attempts', a.totals.attempts, actDays === 1 ? 'Today' : `Last ${actDays} days`)}
        ${stat('Successful', `<span style="color:var(--success)">${a.totals.success}</span>`, `${a.totals.attempts ? Math.round((a.totals.success / a.totals.attempts) * 100) : 0}% of attempts`)}
        ${stat('Refused / errors', `${a.totals.failure} <span class="dim">/ ${a.totals.error}</span>`, 'Wrong password or not allowed / unreachable')}
        ${stat('Avg. response', a.totals.avg_ms === null ? '—' : `${a.totals.avg_ms}<span class="dim" style="font-size:14px"> ms</span>`, `${a.accounts.total} directory account${a.accounts.total === 1 ? '' : 's'}`)}
      </div>

      <div class="card pad" style="margin-top:14px">
        <h3 style="margin:0 0 10px">By directory</h3>
        ${a.directories.length ? `<div style="overflow:auto"><table class="table" style="width:100%"><thead><tr><th>Directory</th><th>In</th><th>Refused</th><th>Errors</th><th>Avg</th><th>Now</th><th>Last sign-in</th><th>Last test</th></tr></thead><tbody>${a.directories.map((d) => `<tr><td><strong>${esc(d.name)}</strong>${d.enabled ? '' : ' <span class="dim">(disabled)</span>'}<div class="dim" style="font-size:11.5px">${esc(d.url || '')}</div></td><td>${d.success}</td><td>${d.failure}</td><td>${d.error}</td><td>${d.avg_ms === null ? '—' : `${d.avg_ms} ms`}</td><td>${d.sessions}</td><td>${esc(ago(d.last_used))}</td><td>${d.last_test ? `<span class="badge ${d.last_test.ok ? 'green' : 'red'}">${d.last_test.ok ? 'Passed' : 'Failed'}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No directories yet.</div>'}
      </div>

      <div class="card pad" style="margin-top:14px">
        <div class="between"><h3 style="margin:0">Hits per day</h3><div class="dim" style="font-size:11.5px"><span style="color:var(--primary)">■</span> in <span style="color:var(--warning)">■</span> refused <span style="color:var(--danger)">■</span> error</div></div>
        <div style="display:flex;gap:3px;align-items:flex-end;height:90px;margin-top:10px">${a.daily.map((x) => `<div title="${x.date}: ${x.success} in · ${x.failure} refused · ${x.error} errors" style="flex:1;display:flex;flex-direction:column-reverse;gap:1px;min-width:0">
          <div style="height:${pct(x.success)}%;background:var(--primary)"></div><div style="height:${pct(x.failure)}%;background:var(--warning)"></div><div style="height:${pct(x.error)}%;background:var(--danger)"></div></div>`).join('')}</div>
      </div>

      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:14px">
        <div class="card pad"><h3 style="margin:0 0 10px">Active connections</h3>
          ${a.sessions.length ? a.sessions.map((s) => `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--border)"><div><strong>${esc(s.name)}</strong><div class="dim" style="font-size:11.5px">${esc(s.email || '')}${s.awaiting_role ? ' · awaiting role' : ''}</div></div><div class="dim" style="font-size:11.5px;text-align:right">${esc(s.mode)}<br>${esc(ago(s.last_seen_at))}</div></div>`).join('') : '<div class="empty">No one is signed in through a directory right now.</div>'}
        </div>
        <div class="card pad"><h3 style="margin:0 0 10px">Waiting for a role</h3>
          ${a.accounts.awaiting.length ? `<div class="dim" style="font-size:12px;margin-bottom:6px">These people signed in through a directory. Assign a role and org unit in <a href="/users.html">Users</a>.</div>${a.accounts.awaiting.map((u) => `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--border)"><div><strong>${esc(u.name)}</strong><div class="dim" style="font-size:11.5px">${esc(u.email || '')}</div></div></div>`).join('')}` : '<div class="empty">Everyone who signed in through a directory has a role.</div>'}
        </div>
      </div>

      <div class="card pad" style="margin-top:14px">
        <h3 style="margin:0 0 10px">Latest attempts</h3>
        ${a.recent.length ? `<div style="overflow:auto"><table class="table" style="width:100%"><thead><tr><th>When</th><th>Result</th><th>Directory</th><th>Username</th><th>Detail</th></tr></thead><tbody>${a.recent.map((e) => { const [color, label] = KIND[e.event_type] || ['grey', e.event_type]; return `<tr><td style="white-space:nowrap">${VMTL.fmtDateTime(e.created_at)}</td><td><span class="badge ${color}">${label}</span></td><td>${esc(e.directory || '—')}</td><td>${esc(e.actor_name || '—')}</td><td class="dim" style="font-size:12px">${esc(e.detail || '')}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No directory sign-ins in this period.</div>'}
      </div>`;

    actEl.querySelectorAll('[data-days]').forEach((b) => b.onclick = () => { actDays = Number(b.dataset.days); loadActivity(); });
    actEl.querySelector('#actRefresh').onclick = loadActivity;
  }

  await loadDirs();
};
