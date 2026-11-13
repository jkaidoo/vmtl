'use strict';
// Unified API — manage Bearer access tokens for the read API, with an endpoint
// reference. Tokens are shown once at creation; only their hash is stored.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  view.innerHTML = VMTL.pageHead('Unified API', 'Programmatic read access for external integrations.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; const load = async () => { d = (await VMTL.api('/admin/api-tokens')).data; render(); };

  const ENDPOINTS = [
    ['GET', '/v1/vehicles', 'vehicles.read', 'Active fleet vehicles'],
    ['GET', '/v1/trips', 'trips.read', 'Recent trips'],
    ['GET', '/v1/requests', 'requests.read', 'Recent vehicle requests'],
    ['GET', '/v1/analytics/summary', 'analytics.read', 'Fleet counts summary'],
  ];

  function render() {
    view.querySelector('#b').innerHTML = `
      <div id="inbound"></div>
      <div class="card pad mb"><div class="between"><div><h3 style="margin:0">Base URL</h3><code class="rec-id" style="font-family:var(--mono);font-size:13px">${esc(d.base_url)}</code></div><div class="dim" style="font-size:13px;max-width:360px;text-align:right">Authenticate with <code>Authorization: Bearer &lt;token&gt;</code>. Read-only, scope-gated.</div></div></div>
      <div class="card mb"><div class="card-head"><h3 style="margin:0">Access tokens</h3><button class="btn btn-primary btn-sm" id="newTok">${VMTL.icon('plus')} New token</button></div>
        <div class="card-body" style="padding-top:8px"><div class="table-wrap"><table class="data"><thead><tr><th>LABEL</th><th>TOKEN</th><th>SCOPES</th><th>CREATED</th><th>LAST USED</th><th></th></tr></thead><tbody>
          ${d.tokens.length ? d.tokens.map((t) => `<tr><td><strong>${esc(t.label)}</strong></td><td><code class="rec-id" style="font-family:var(--mono)">${esc(t.prefix)}…</code></td><td>${(t.scopes || []).map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')}</td><td class="dim">${VMTL.fmtDate(t.created_at)}</td><td class="dim">${t.last_used_at ? VMTL.fmtDateTime(t.last_used_at) : 'Never'}</td><td><button class="btn btn-sm" data-revoke="${t.id}">Revoke</button></td></tr>`).join('') : '<tr><td colspan="6" class="dim">No tokens yet.</td></tr>'}
        </tbody></table></div></div></div>
      <div class="card"><div class="card-head"><h3 style="margin:0">Endpoints</h3></div><div class="card-body" style="padding-top:8px"><div class="table-wrap"><table class="data"><thead><tr><th>METHOD</th><th>PATH</th><th>SCOPE</th><th>DESCRIPTION</th></tr></thead><tbody>
        ${ENDPOINTS.map(([m, p, s, desc]) => `<tr><td><span class="chip">${m}</span></td><td><code style="font-family:var(--mono)">${esc(p)}</code></td><td><span class="audit-chip">${esc(s)}</span></td><td>${esc(desc)}</td></tr>`).join('')}
      </tbody></table></div></div></div>`;
    view.querySelector('#newTok').onclick = () => createToken();
    view.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => { if (await VMTL.confirm('Revoke this token? Integrations using it will stop working.', { danger: true, confirmLabel: 'Revoke' })) { try { await VMTL.api(`/admin/api-tokens/${b.dataset.revoke}`, { method: 'DELETE' }); VMTL.toast('Token revoked.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } } });
    renderInbound();
  }

  // Inbound connection: pull live staff data from the KNUST Unified API to learn
  // each person's organisational unit after they sign in.
  async function renderInbound() {
    const host = view.querySelector('#inbound'); if (!host) return;
    let c = {};
    try { c = (await VMTL.api('/admin/unified-api-client')).data; } catch (_) { c = {}; }
    host.innerHTML = `
      <div class="card pad mb" style="border-left:3px solid var(--info)">
        <div class="between" style="flex-wrap:wrap;gap:8px"><div><h3 style="margin:0">Staff data source (inbound)</h3><div class="dim" style="font-size:12.5px;margin-top:2px">Pull each signed-in staff member's department, college, rank and designation from the KNUST Unified API. Used only to set their organisational unit — never vehicle data.</div></div>
          <span class="chip" style="color:${c.enabled ? 'var(--success)' : 'var(--text-2)'}">${c.enabled ? 'Configured' : (c.switched_on ? 'Not configured' : 'Off')}</span></div>
        <div class="form-grid" style="margin-top:12px">
          <div class="field col-2"><label>Unified API base URL</label><input id="uUrl" value="${esc(c.url || '')}" placeholder="https://unified-api.cloud.knust.edu.gh"></div>
          <div class="field col-2"><label>API key ${c.has_key ? '(set — blank keeps it)' : ''}</label><input id="uKey" type="password" autocomplete="new-password" placeholder="X-Api-Key"></div>
          <div class="field"><label>Enabled</label><button type="button" class="switch" role="switch" id="uOn" aria-checked="${c.switched_on ? 'true' : 'false'}"><span class="switch-knob"></span></button></div>
        </div>
        <div class="row gap-sm" style="margin-top:12px;flex-wrap:wrap"><button class="btn btn-primary" id="uSave">Save connection</button><button class="btn" id="uTest">Test</button><span id="uResult" class="dim" style="font-size:12.5px"></span></div>
      </div>
      <div class="card pad mb">
        <h3>Staff data fields</h3>
        <p class="dim">Choose fields shown in manual searches and imported during staff sync. Turning a field off preserves existing stored values. Name, email and username are for preview only; account identity comes from directory sign-in. Organisational-unit updates use the enabled college, faculty and department fields.</p>
        <div class="form-grid">${(c.fields || []).map((f) => `<div class="field"><label for="uf-${esc(f.key)}">${esc(f.label)}</label><button type="button" id="uf-${esc(f.key)}" class="switch" role="switch" aria-label="${esc(f.label)}" data-staff-field="${esc(f.key)}" aria-checked="${f.enabled ? 'true' : 'false'}"><span class="switch-knob"></span></button></div>`).join('')}</div>
        <div class="row gap-sm" style="margin-top:12px"><button class="btn btn-primary" id="uFieldsSave">Save data fields</button><span id="uFieldsStatus" role="status"></span></div>
      </div>
      <div class="card pad mb">
        <h3>Manual staff search</h3>
        <p class="dim">Search by name, staff ID or official email. Open a result to view its profile. Searching does not create or update an account. Save connection and field changes before searching.</p>
        <form id="uSearchForm" class="row gap-sm"><div class="field" style="flex:1"><label for="uQuery">Name, staff ID or email</label><input id="uQuery" minlength="2" maxlength="100" required autocomplete="off" placeholder="Enter at least two characters"></div><button class="btn" type="submit">Search</button></form>
        <div id="uSearchStatus" role="status" style="margin-top:12px"></div><div id="uSearchResults"></div>
      </div>`;
    host.querySelectorAll('[data-staff-field]').forEach((b) => b.onclick = () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')));
    let searchSequence = 0;
    host.querySelector('#uFieldsSave').onclick = async () => {
      const button = host.querySelector('#uFieldsSave'); button.disabled = true;
      try {
        const fields = Object.fromEntries([...host.querySelectorAll('[data-staff-field]')].map((b) => [b.dataset.staffField, b.getAttribute('aria-checked') === 'true']));
        const r = (await VMTL.api('/admin/unified-api-client/fields', { method: 'PUT', body: { fields } })).data;
        c.fields = r.fields; ++searchSequence;
        host.querySelector('#uSearchResults').innerHTML = ''; host.querySelector('#uSearchStatus').textContent = '';
        host.querySelector('#uFieldsStatus').textContent = 'Data fields saved.';
      } catch (e) { host.querySelector('#uFieldsStatus').textContent = e.message; }
      finally { button.disabled = false; }
    };
    const displayValue = (v) => {
      if (v == null) return '—';
      if (Array.isArray(v)) return v.map(displayValue).join(', ');
      if (typeof v === 'object') return displayValue(v.value ?? v.text ?? v.name ?? JSON.stringify(v));
      return String(v);
    };
    const showFields = (fields) => Object.entries(fields || {}).map(([key, value]) => `<div style="padding:4px 0"><strong>${esc((c.fields || []).find((f) => f.key === key)?.label || key)}:</strong> ${esc(displayValue(value))}</div>`).join('') || '<p class="dim">All preview fields are switched off.</p>';
    host.querySelector('#uSearchForm').onsubmit = async (event) => {
      event.preventDefault();
      const q = host.querySelector('#uQuery').value.trim(); const mine = ++searchSequence;
      const status = host.querySelector('#uSearchStatus'); const results = host.querySelector('#uSearchResults');
      results.innerHTML = '';
      if (q.length < 2) { status.textContent = 'Enter at least two characters.'; return; }
      status.textContent = 'Searching…';
      try {
        const r = (await VMTL.api(`/admin/unified-api-client/search?q=${encodeURIComponent(q)}`)).data;
        if (mine !== searchSequence) return;
        if (r.status !== 'ok') { status.textContent = r.reason || 'Staff search is unavailable.'; return; }
        status.textContent = r.results.length ? `${r.results.length} match(es)${r.results.length === 20 ? ' — refine your search for more precise results' : ''}.` : 'No staff found.';
        results.innerHTML = r.results.map((person, i) => `<article class="card pad" style="margin-top:12px">${showFields(person.fields)}<button type="button" class="btn btn-sm" data-profile="${i}">View profile</button><div data-profile-details="${i}"></div></article>`).join('');
        results.querySelectorAll('[data-profile]').forEach((button) => button.onclick = async () => {
          const person = r.results[Number(button.dataset.profile)];
          const details = results.querySelector(`[data-profile-details="${button.dataset.profile}"]`);
          button.disabled = true; details.textContent = 'Loading profile…';
          try {
            const profile = (await VMTL.api(`/admin/unified-api-client/profile/${encodeURIComponent(person.id_number)}`)).data;
            if (mine !== searchSequence) return;
            details.innerHTML = profile.status === 'found' ? showFields(profile.fields) : esc(profile.reason || 'Staff profile not found.');
          } catch (e) { details.textContent = e.message; }
          finally { button.disabled = false; }
        });
      } catch (e) { if (mine === searchSequence) status.textContent = e.message; }
    };
    host.querySelector('#uOn').onclick = (e) => { const b = e.currentTarget; b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); };
    host.querySelector('#uSave').onclick = async () => {
      const body = { url: host.querySelector('#uUrl').value.trim(), enabled: host.querySelector('#uOn').getAttribute('aria-checked') === 'true' };
      const key = host.querySelector('#uKey').value; if (key) body.key = key;
      try { await VMTL.api('/admin/unified-api-client', { method: 'PUT', body }); VMTL.toast('Connection saved.', 'success'); renderInbound(); } catch (e) { VMTL.showErrors(e); }
    };
    host.querySelector('#uTest').onclick = async () => {
      const out = host.querySelector('#uResult'); out.textContent = 'Testing…';
      try { const r = (await VMTL.api('/admin/unified-api-client/test', { method: 'POST', body: {} })).data; const chk = (r.checks || [])[0] || {}; out.innerHTML = r.enabled && chk.ok ? `<span style="color:var(--success)">✓ Reached the Unified API (${esc(chk.detail || '')})</span>` : `<span style="color:var(--danger)">✕ ${esc(chk.detail || chk.code || 'Not configured')}</span>`; }
      catch (e) { out.innerHTML = `<span style="color:var(--danger)">✕ ${esc(e.message)}</span>`; }
    };
  }

  function createToken() {
    const scopes = d.scopes || [];
    const m = VMTL.openModal(`<div class="modal-head"><h3>New API token</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="field"><label>Label</label><input id="tLabel" placeholder="e.g. Analytics dashboard" required></div><div class="field"><label>Scopes</label><div class="row wrap" style="gap:12px;padding-top:4px">${scopes.map((s) => `<label class="checkbox"><input type="checkbox" class="tScope" value="${s}" checked> ${esc(s)}</label>`).join('')}</div></div></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="gen">Generate token</button></div>`);
    m.el.querySelector('#gen').onclick = async () => {
      const label = m.el.querySelector('#tLabel').value.trim(); if (!label) return VMTL.toast('Add a label.', 'err');
      const sel = [...m.el.querySelectorAll('.tScope:checked')].map((i) => i.value);
      try {
        const r = (await VMTL.api('/admin/api-tokens', { method: 'POST', body: { label, scopes: sel } })).data;
        m.close();
        const m2 = VMTL.openModal(`<div class="modal-head"><h3>Token created</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><div class="alert-accent amber mb"><strong>Copy this token now.</strong> It is shown only once.</div><div class="field"><label>${esc(label)}</label><input value="${esc(r.token)}" readonly onclick="this.select()" style="font-family:var(--mono)"></div><div class="btn-row"><button class="btn" id="copyTok">Copy token</button></div></div><div class="modal-foot"><button class="btn btn-primary" data-close>Done</button></div>`);
        m2.el.querySelector('#copyTok').onclick = async () => { try { await navigator.clipboard.writeText(r.token); VMTL.toast('Copied.', 'success'); } catch (_) { m2.el.querySelector('input').select(); } };
        load();
      } catch (e) { VMTL.showErrors(e); }
    };
  }

  try { await load(); } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
};
