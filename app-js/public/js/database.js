'use strict';
// Database connections — walkin-style: active store + table counts, encrypted
// connection profiles (add/test/edit/select/remove), and a migration console
// that copies the live data into a tested PostgreSQL target.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  let d = null;
  view.innerHTML = VMTL.pageHead('Database connections', 'The active data store, saved connection profiles, and migration.') +
    `<div class="tabs" id="tabs"><button data-t="profiles" class="active">Profiles</button><button data-t="migration">Migration</button></div><div id="tb"><div class="loading"><span class="spinner"></span></div></div>`;

  const stateBadge = (p) => p.last_test ? (p.last_test.ok ? VMTL.badge('Connected', 'green') : VMTL.badge('Needs attention', 'amber')) : VMTL.badge('Not tested', 'grey');

  const load = async () => { d = (await VMTL.api('/admin/database')).data; renderTab(); };
  let tab = 'profiles';
  const renderTab = () => { if (tab === 'profiles') renderProfiles(); else renderMigration(); };

  function renderProfiles() {
    const tb = view.querySelector('#tb');
    const profiles = d.profiles || [];
    tb.innerHTML = `
      ${d.encryption_configured ? '' : '<div class="alert-accent amber mb"><strong>Secure profile storage not configured</strong><div class="dim" style="font-size:12.5px">Set <code>DATABASE_PROFILE_ENCRYPTION_KEY</code> (or SESSION_SECRET) so connection passwords are encrypted at rest.</div></div>'}
      <div class="grid cols-2 mb">
        <div class="kpi"><div class="label">Live data store</div><div class="value" style="font-size:1.1rem">${esc(d.active.data.provider)}</div><div class="sub">${esc(d.active.data.detail)}</div></div>
        <div class="kpi"><div class="label">Session store</div><div class="value" style="font-size:1.1rem">${esc(d.active.sessions.provider)}</div><div class="sub">Current runtime: ${esc(d.active.runtime)}</div></div>
      </div>
      <div class="card mb">
        <div class="card-head"><h3 style="margin:0">Saved connection profiles</h3><button class="btn btn-primary btn-sm" id="addP">${VMTL.icon('plus')} Add connection</button></div>
        <div class="card-body" style="padding-top:8px"><div class="table-wrap"><table class="data"><thead><tr><th>NAME</th><th>SERVICE</th><th>ENDPOINT</th><th>STATE</th><th></th></tr></thead><tbody>
          <tr><td><strong>${esc(d.active.data.provider)}</strong><div class="rec-id">Active data store</div></td><td>${esc(d.active.runtime)}</td><td class="dim">${esc(d.active.data.detail)}</td><td>${VMTL.badge('Active', 'green')}</td><td class="dim">Current</td></tr>
          ${profiles.length ? profiles.map((p) => `<tr>
            <td><strong>${esc(p.name)}</strong>${p.selected ? ' ' + VMTL.badge('Migration target', 'blue') : ''}</td>
            <td>${esc(p.provider_label)}</td>
            <td><span class="rec-id" style="font-family:var(--mono)">${esc(p.host)}:${esc(p.port)}</span><div class="dim" style="font-size:12px">${esc(p.database)}</div></td>
            <td>${stateBadge(p)}${p.last_test && p.last_test.reason ? `<div class="dim" style="font-size:11.5px;color:var(--danger);max-width:240px">${esc(p.last_test.reason)}</div>` : ''}</td>
            <td><div class="btn-row"><button class="btn btn-sm" data-test="${p.id}">Test</button><button class="btn btn-sm" data-edit="${p.id}">Edit</button><button class="btn btn-sm" data-select="${p.id}">Target</button><button class="btn btn-sm" data-del="${p.id}">Remove</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="dim">No external database profiles saved.</td></tr>'}
        </tbody></table></div></div>
      </div>
      <div class="card"><div class="card-head"><h3 style="margin:0">Tables</h3></div><div class="card-body" style="padding-top:8px"><div class="table-wrap"><table class="data"><thead><tr><th>TABLE</th><th>ROWS</th></tr></thead><tbody>${d.tables.map((t) => `<tr><td>${esc(t.table)}</td><td>${t.rows == null ? '—' : t.rows.toLocaleString()}</td></tr>`).join('')}</tbody></table></div></div></div>`;

    tb.querySelector('#addP').onclick = () => editor();
    tb.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editor(profiles.find((p) => p.id === b.dataset.edit)));
    tb.querySelectorAll('[data-test]').forEach((b) => b.onclick = async () => { b.disabled = true; try { const r = (await VMTL.api(`/admin/database/profiles/${b.dataset.test}/test`, { method: 'POST' })).data; VMTL.toast(r.ok ? `Connected to ${r.database}.` : r.reason, r.ok ? 'success' : 'err'); load(); } catch (e) { VMTL.showErrors(e); } finally { b.disabled = false; } });
    tb.querySelectorAll('[data-select]').forEach((b) => b.onclick = async () => { try { await VMTL.api(`/admin/database/profiles/${b.dataset.select}/select`, { method: 'POST' }); VMTL.toast('Migration target set.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } });
    tb.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await VMTL.confirm('Remove this profile? It only deletes the saved connection, not the database.', { danger: true, confirmLabel: 'Remove' })) { try { await VMTL.api(`/admin/database/profiles/${b.dataset.del}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } } });
  }

  function editor(p) {
    const e = p || {};
    const provs = Object.entries(d.providers).map(([k, v]) => `<option value="${k}" ${e.provider === k ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const m = VMTL.openModal(`<div class="modal-head"><h3>${p ? 'Edit connection' : 'Add database connection'}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><p class="dim" style="font-size:13px;margin-top:0">Use the individual fields or a full connection URL. Passwords are write-only and stored encrypted.</p><form id="pf"><div class="form-grid">
      <div class="field"><label>Profile name</label><input name="name" value="${esc(e.name || '')}" required placeholder="e.g. Supabase production"></div>
      <div class="field"><label>Service</label><select name="provider">${provs}</select></div>
      <div class="field"><label>Host</label><input name="host" value="${esc(e.host || '')}" placeholder="db.example.com"></div>
      <div class="field"><label>Port</label><input name="port" value="${esc(e.port || '5432')}"></div>
      <div class="field"><label>Database</label><input name="database" value="${esc(e.database || 'postgres')}"></div>
      <div class="field"><label>Username</label><input name="username" value="${esc(e.username || '')}" autocomplete="off"></div>
      <div class="field"><label>Password ${p ? '(blank keeps it)' : ''}</label><input name="password" type="password" autocomplete="new-password"></div>
      <div class="field"><label>SSL mode</label><select name="ssl_mode"><option value="require" ${e.ssl_mode === 'require' ? 'selected' : ''}>Require TLS</option><option value="verify-full" ${e.ssl_mode === 'verify-full' ? 'selected' : ''}>Verify certificate</option><option value="disable" ${e.ssl_mode === 'disable' ? 'selected' : ''}>No encryption</option></select></div>
    </div><div class="field"><label>Connection URL ${p ? '(blank keeps saved URL)' : '(optional — overrides the fields above)'}</label><textarea name="connection" rows="2" style="font-family:var(--mono)" placeholder="postgresql://user:pass@host:5432/db?sslmode=require"></textarea></div></form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save securely</button></div>`, { large: true });
    m.el.querySelector('#save').onclick = async () => {
      const f = m.el.querySelector('#pf'); const body = Object.fromEntries(new FormData(f));
      Object.keys(body).forEach((k) => { if (body[k] === '') delete body[k]; });
      try { await VMTL.api(p ? `/admin/database/profiles/${p.id}` : '/admin/database/profiles', { method: p ? 'PUT' : 'POST', body }); m.close(); VMTL.toast('Profile saved.', 'success'); load(); } catch (err) { VMTL.showErrors(err, f); }
    };
  }

  function renderMigration() {
    const tb = view.querySelector('#tb');
    const target = (d.profiles || []).find((p) => p.selected);
    const ready = target && target.last_test && target.last_test.ok;
    tb.innerHTML = `
      <div class="grid cols-3 mb">
        <div class="kpi"><div class="label">Current runtime</div><div class="value" style="font-size:1.1rem">${esc(d.active.runtime)}</div><div class="sub">Live source</div></div>
        <div class="kpi"><div class="label">Selected target</div><div class="value" style="font-size:1.05rem">${esc(target ? target.name : 'None')}</div><div class="sub">${target ? esc(target.host) : 'Pick a target on the Profiles tab'}</div></div>
        <div class="kpi"><div class="label">Connection</div><div class="value" style="font-size:1.05rem">${target ? (ready ? 'Ready' : 'Test required') : 'Not selected'}</div><div class="sub">Test the target first</div></div>
      </div>
      <div class="card"><div class="card-head"><h3 style="margin:0">Copy data into PostgreSQL</h3></div><div class="card-body">
        <p class="muted" style="margin-top:0">Copies every record from the live store into the selected PostgreSQL target. It creates any missing tables, keeps records already there (ON CONFLICT DO NOTHING) and resets ID sequences. The live runtime is not switched automatically.</p>
        <button class="btn btn-primary" id="runMig" ${ready ? '' : 'disabled'}>Copy data to ${esc(target ? target.name : 'the target')}</button>
        ${!target ? '<p class="dim" style="font-size:12.5px">Select a profile as the migration target on the Profiles tab.</p>' : !ready ? '<p class="dim" style="font-size:12.5px">Test the selected profile successfully first.</p>' : ''}
        <div id="migResult" class="mt"></div>
      </div></div>`;
    const run = tb.querySelector('#runMig');
    if (run) run.onclick = async () => {
      const ok = await VMTL.confirm(`Copy all data from the live store into ${target.name}? Records already there are kept.`, { danger: true, confirmLabel: 'Copy data' });
      if (!ok) return;
      run.disabled = true; run.textContent = 'Copying…';
      try {
        const out = (await VMTL.api('/admin/database/migrate', { method: 'POST', body: { profile_id: target.id, confirmation: 'MIGRATE' } })).data;
        tb.querySelector('#migResult').innerHTML = `<div class="alert-accent green mb"><strong>Migration complete</strong></div><div class="table-wrap"><table class="data"><thead><tr><th>TABLE</th><th>SOURCE ROWS</th><th>INSERTED</th></tr></thead><tbody>${out.copied.map((c) => `<tr><td>${esc(c.table)}</td><td>${c.source.toLocaleString()}</td><td>${c.inserted.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`;
        VMTL.toast('Data copied to PostgreSQL.', 'success');
      } catch (e) { VMTL.toast(e.message || 'Migration failed.', 'err'); }
      finally { run.disabled = false; run.textContent = `Copy data to ${target.name}`; }
    };
  }

  view.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { view.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b)); tab = b.dataset.t; renderTab(); });
  try { await load(); } catch (e) { view.querySelector('#tb').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
};
