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
