'use strict';
window.VMTL_PAGE = async function () {
  if (!document.querySelector('link[href="/css/unified-api.css"]')) {
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/css/unified-api.css'; document.head.appendChild(style);
  }
  if (!window.VMTL_UNIFIED_TOKENS) await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/js/unified-api-tokens.js'; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
  });
  const esc = VMTL.esc;
  const toast = (message, kind) => VMTL.toast(message, kind === 'ok' ? 'success' : kind);
  const api = async (path, options = {}) => {
    const response = await fetch('/api' + path, { method: options.method || 'GET', credentials: 'include', headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || 'Request failed');
    return body.data;
  };
  const listModal = (title, list) => VMTL.openModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>×</button></div><div class="modal-body table-wrap"><table class="data"><thead><tr>${list.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${list.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, { large: true });
  const copyTextModal = (title, text) => VMTL.openModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>×</button></div><div class="modal-body"><textarea readonly style="width:100%;height:300px">${esc(text)}</textarea></div>`);
  VMTL.view.innerHTML = "<div class=\"ua-console controls-page\">    <div class=\"page-heading\"><h1>Unified API</h1><p class=\"muted\">Staff records from the university directory: search by username or email, view pictures and choose imported fields.</p></div>\n    <div class=\"ua-grid\">\n      <section class=\"card card-pad\" id=\"uaConnection\" aria-labelledby=\"uaConnTitle\"></section>\n      <section class=\"card card-pad\" id=\"uaSettings\" aria-labelledby=\"uaSetTitle\"></section>\n      <section class=\"card card-pad ua-wide\" id=\"uaFields\" aria-labelledby=\"uaFieldsTitle\"></section>\n      <section class=\"card card-pad ua-wide\" id=\"uaTest\" aria-labelledby=\"uaTestTitle\"></section>\n      <section class=\"card card-pad\" id=\"uaSearchDiagnostics\" aria-labelledby=\"uaSearchTitle\">\n        <div class=\"ua-head\"><div><h2 id=\"uaSearchTitle\">Search staff</h2><p class=\"muted\">Search by staff username or official email. Select a match to view their profile and picture.</p></div></div>\n        <form class=\"ua-test-form\" id=\"uaSearchForm\"><input class=\"input\" name=\"q\" aria-label=\"Staff username or email\" placeholder=\"Username or official email\" minlength=\"2\" maxlength=\"100\" required><button class=\"btn btn-primary\" type=\"submit\">Search staff</button></form>\n        <div id=\"uaSearchResult\" role=\"status\" aria-live=\"polite\"></div>\n      </section>\n    </div>\n<details class=\"card pad\" style=\"margin-top:12px\"><summary>External integration access tokens</summary><div id=\"uaTokens\" style=\"margin-top:12px\"></div></details></div>";
  const connEl = document.getElementById('uaConnection');
  const setEl = document.getElementById('uaSettings');
  const fieldsEl = document.getElementById('uaFields');
  const testEl = document.getElementById('uaTest');
  const TYPE_NAMES = { STAFF: 'Staff' };
  const sw = (on, label, attrs = '') => `<button class="switch" type="button" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${attrs}><span class="switch-knob"></span></button>`;
  let settings = {}; let fields = { STAFF: [] }; let lastTest = null;

  async function load() {
    try {
      const out = await api('/admin/unified-api-console/settings');
      settings = out.settings; fields = out.fields;
    } catch (e) { toast(e.message, 'err'); return; }
    renderSettings(); renderFields(); renderTest(); checkConnection();
  }

  // ---- Connection ---------------------------------------------------------
  function connShell(state, title, detail, extra = '') {
    connEl.innerHTML = `<div class="ua-head"><div><h2 id="uaConnTitle">Connection</h2><p class="muted">Checks the API's <code>/health</code> endpoint.</p></div><button class="btn btn-sm" id="uaCheck" type="button">Check connection</button></div>
      <div class="ua-state" role="status"><span class="ua-dot ${state}"></span><div><b>${esc(title)}</b><small>${detail}</small></div></div>${extra}`;
    connEl.querySelector('#uaCheck').onclick = checkConnection;
  }
  async function checkConnection() {
    connShell('', 'Checking…', 'Contacting the Unified API');
    connEl.querySelector('#uaCheck').disabled = true;
    let s;
    try { s = await api('/admin/unified-api-console/status'); } catch (e) { connShell('bad', 'Check failed', esc(e.message)); return; }
    if (!s.enabled) {
      const why = !s.switched_on ? 'Live lookups and automatic staff enrichment are switched off.'
        : 'Add the API URL and key to turn on live lookups and staff enrichment.';
      connShell('off', s.switched_on ? 'Not set up' : 'Switched off', why);
      return;
    }
    if (!s.reachable) {
      connShell('bad', 'Not reachable', `${esc(s.host)} · ${esc(s.reason === 'timeout' ? 'timed out' : s.reason || 'no response')}. Existing staff data is preserved.`);
      return;
    }
    const term = 'Live staff directory and profile pictures';
    const sources = Object.entries(s.sources || {}).filter(([name]) => name.toLowerCase() === 'staff');
    const healthy = String(s.status).toLowerCase() === 'ok';
    connShell(healthy ? 'ok' : 'bad', healthy ? 'Connected' : `Connected, API reports “${s.status}”`,
      `${esc(s.host)}${s.ms != null ? ` · ${s.ms} ms` : ''}<br>${term}`,
      sources.length ? `<div class="ua-sources">${sources.map(([name, v]) => { const ok = v === true || v === 'ok' || v?.ok === true || v?.status === 'ok'; return `<span class="badge ${ok ? 'resolved' : 'pending'}">${esc(name)}: ${ok ? 'up' : esc(typeof v === 'object' ? v?.status || v?.error || 'down' : String(v))}</span>`; }).join('')}</div>` : '');
  }

  // ---- Settings -----------------------------------------------------------
  const sourceTag = (src) => src === 'env' ? '<span class="ua-src-tag">from environment variable</span>' : '';
  function renderSettings() {
    const s = settings;
    setEl.innerHTML = `<div class="ua-head"><div><h2 id="uaSetTitle">Integration settings</h2><p class="muted">Saved here, these override the <code>UNIFIED_API_*</code> environment variables.</p></div></div>
      <form id="uaSettingsForm" autocomplete="off">
        <div class="ua-switch-row"><span><b>Use live lookups</b><br><small class="faint">Off: live lookups and automatic staff enrichment are paused.</small></span>${sw(s.switched_on, 'Use live lookups', 'id="uaEnabled"')}</div>
        <label class="field"><span>API URL ${sourceTag(s.source?.url)}</span><input class="input mono" name="url" type="url" value="${esc(s.url || '')}" placeholder="http://10.0.0.20:4100"></label>
        <label class="field"><span>API key ${s.key_configured ? `<span class="badge resolved" style="margin-left:6px">Set</span>${sourceTag(s.source?.key)}` : '<span class="badge pending" style="margin-left:6px">Not set</span>'}</span><input class="input" name="key" type="password" autocomplete="new-password" placeholder="${s.key_configured ? 'Leave blank to keep the current key' : 'Paste the X-Api-Key value'}"></label>
        <label class="field"><span>Timeout (ms)</span><input class="input" name="timeout_ms" type="number" min="1000" max="60000" step="500" value="${esc(s.timeout_ms || 8000)}"></label>
        <p class="hint">The key is kept on the server and never sent back to the browser.</p>
        <div class="flex" style="gap:8px;flex-wrap:wrap"><button class="btn btn-primary" type="submit">Save settings</button>${s.source?.key === 'saved' ? '<button class="btn btn-ghost" type="button" id="uaClearKey">Remove saved key</button>' : ''}</div>
      </form>`;
    const enabledBtn = setEl.querySelector('#uaEnabled');
    enabledBtn.onclick = () => enabledBtn.setAttribute('aria-checked', String(enabledBtn.getAttribute('aria-checked') !== 'true'));
    setEl.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.currentTarget));
      const body = { url: fd.url, timeout_ms: fd.timeout_ms, enabled: enabledBtn.getAttribute('aria-checked') === 'true' };
      if (fd.key) body.key = fd.key;
      await saveSettings(body, 'Settings saved.');
    };
    const clear = setEl.querySelector('#uaClearKey');
    if (clear) clear.onclick = () => saveSettings({ clear_key: true }, 'Saved key removed.');
  }
  async function saveSettings(body, message) {
    try { settings = await api('/admin/unified-api-console/settings', { method: 'PUT', body }); toast(message, 'ok'); renderSettings(); checkConnection(); }
    catch (e) { toast(e.message, 'err'); }
  }

  // ---- Lookup fields ------------------------------------------------------
  function renderFields() {
    fieldsEl.innerHTML = `<div class="ua-head"><div><h2 id="uaFieldsTitle">Fields shown on lookup</h2><p class="muted">Toggle fields to show on profiles. Drag or use arrows to reorder; click the pencil to rename. Switched-off fields move to the bottom. New API fields appear after lookup.</p></div></div>
      <div class="ua-cols">${['STAFF'].map((type) => {
        const list = fields[type] || []; const on = list.filter((f) => f.visible).length;
        return `<div class="ua-col"><h3>${TYPE_NAMES[type]} <span class="count">${on} of ${list.length} shown</span></h3>
          <div class="flex" style="gap:6px;margin:6px 0 8px"><button class="btn btn-ghost btn-sm" type="button" data-all="${type}" data-on="1">Show all</button><button class="btn btn-ghost btn-sm" type="button" data-all="${type}" data-on="0">Hide all</button></div>
          <div class="ua-field-list" data-type="${type}" tabindex="0" role="region" aria-label="${TYPE_NAMES[type]} lookup fields">${list.map((f, i) => `<div class="ua-field ${f.visible ? '' : 'off'}" data-key="${esc(f.key)}">
            <span class="ua-grip reorder-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
            <div class="name"><b>${esc(f.label)}${f.built_in ? '' : '<span class="ua-learned">from API</span>'}</b><code>${esc(f.key)}${f.custom ? ` · default: ${esc(f.default_label)}` : ''}</code></div>
            <div class="ua-tools">
              <button class="btn btn-ghost btn-sm ua-rename" type="button" data-rename title="Rename how this field is labelled" aria-label="Rename ${esc(f.label)}">✎</button>
              <button class="btn btn-ghost btn-sm ua-move" type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(f.label)} up">↑</button>
              <button class="btn btn-ghost btn-sm ua-move" type="button" data-move="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(f.label)} down">↓</button>
              ${sw(f.visible, `Show ${f.label} for ${TYPE_NAMES[type].toLowerCase()}`, `data-type="${type}" data-key="${esc(f.key)}"`)}
            </div></div>`).join('')}</div>
        </div>`;
      }).join('')}</div>`;
    fieldsEl.querySelectorAll('.switch[data-key]').forEach((b) => b.onclick = () => setVisible(b.dataset.type, { [b.dataset.key]: b.getAttribute('aria-checked') !== 'true' }));
    fieldsEl.querySelectorAll('[data-all]').forEach((b) => b.onclick = () => setVisible(b.dataset.all, Object.fromEntries((fields[b.dataset.all] || []).map((f) => [f.key, b.dataset.on === '1']))));
    fieldsEl.querySelectorAll('.ua-field-list').forEach(wireOrdering);
    fieldsEl.querySelectorAll('[data-rename]').forEach((b) => b.onclick = () => startRename(b.closest('.ua-field')));
  }

  // Rename a field's label in place: Enter or Save keeps it, Esc cancels, and
  // Reset goes back to the default label. The new label is used on every
  // profile, the client PDF and the test lookup.
  function startRename(row) {
    const type = row.closest('.ua-field-list').dataset.type; const key = row.dataset.key;
    const f = (fields[type] || []).find((x) => x.key === key); if (!f) return;
    const name = row.querySelector('.name'); const before = name.innerHTML;
    row.classList.add('renaming');
    name.innerHTML = `<form class="ua-rename-form"><input class="input" name="label" maxlength="60" value="${esc(f.label)}" aria-label="Label for ${esc(f.key)}" placeholder="${esc(f.default_label)}"><div class="flex" style="gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" type="submit">Save</button><button class="btn btn-sm" type="button" data-cancel>Cancel</button>${f.custom ? `<button class="btn btn-ghost btn-sm" type="button" data-reset>Reset to "${esc(f.default_label)}"</button>` : ''}</div><code>${esc(f.key)}</code></form>`;
    const form = name.querySelector('form'); const input = form.elements.label;
    input.focus(); input.select();
    const done = () => { row.classList.remove('renaming'); renderFields(); };
    const save = async (label) => {
      try { fields = await api('/admin/unified-api-console/field-label', { method: 'PUT', body: { type, key, label } }); toast(label ? 'Label saved' : 'Label reset', 'ok'); if (lastTest?.type === type) { const nf = fields[type].find((x) => x.key === key); for (const t of lastTest.fields) if (t.key === key) t.label = nf.label; renderTest(); } done(); }
      catch (err) { toast(err.message, 'err'); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); const label = input.value.trim(); if (label === f.label) { done(); return; } save(label === f.default_label ? '' : label); });
    form.querySelector('[data-cancel]').onclick = () => { name.innerHTML = before; row.classList.remove('renaming'); renderFields(); };
    form.querySelector('[data-reset]')?.addEventListener('click', () => save(''));
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } });
  }

  // ↑/↓ buttons and drag and drop within one type's list; each change saves the full order.
  function wireOrdering(listEl) {
    const type = listEl.dataset.type;
    const keys = () => [...listEl.querySelectorAll('.ua-field')].map((row) => row.dataset.key);
    listEl.querySelectorAll('[data-move]').forEach((b) => b.onclick = () => {
      const list = keys(); const key = b.closest('.ua-field').dataset.key;
      const i = list.indexOf(key); const j = i + Number(b.dataset.move);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      saveOrder(type, list, key, b.dataset.move);
    });
    // Drag by the grip with mouse, pen or touch (pointer events, so it also works on phones).
    let dragging = null;
    let pointerY = 0;
    let scrollFrame = null;
    let lastFrame = null;
    const moveRow = () => {
      const bounds = listEl.getBoundingClientRect();
      const top = Math.max(0, bounds.top);
      const bottom = Math.min(window.innerHeight, bounds.bottom);
      if (bottom <= top) return;
      const y = Math.max(top + 1, Math.min(bottom - 1, pointerY));
      for (const row of listEl.querySelectorAll('.ua-field')) {
        if (row === dragging) continue;
        const box = row.getBoundingClientRect();
        if (y < box.top || y > box.bottom) continue;
        const after = y > box.top + box.height / 2;
        if (after && row.nextElementSibling !== dragging) row.after(dragging);
        else if (!after && row.previousElementSibling !== dragging) row.before(dragging);
        break;
      }
    };
    const autoScroll = (time) => {
      if (!dragging || !listEl.isConnected) { scrollFrame = null; lastFrame = null; return; }
      const bounds = listEl.getBoundingClientRect();
      const top = Math.max(0, bounds.top);
      const bottom = Math.min(window.innerHeight, bounds.bottom);
      const edge = Math.min(48, Math.max(0, (bottom - top) / 3));
      let speed = 0;
      if (edge > 0 && pointerY < top + edge) speed = -Math.min(1, (top + edge - pointerY) / edge);
      else if (edge > 0 && pointerY > bottom - edge) speed = Math.min(1, (pointerY - bottom + edge) / edge);
      const elapsed = lastFrame == null ? 16 : Math.min(40, time - lastFrame);
      lastFrame = time;
      if (speed) {
        listEl.scrollTop += speed * elapsed * 0.65;
        moveRow();
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    };
    listEl.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('.ua-grip'); if (!grip || e.button > 0 || dragging) return;
      e.preventDefault();
      dragging = grip.closest('.ua-field');
      pointerY = e.clientY;
      dragging.classList.add('dragging');
      grip.setPointerCapture(e.pointerId);
      lastFrame = null;
      scrollFrame = requestAnimationFrame(autoScroll);
    });
    listEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      pointerY = e.clientY;
      moveRow();
    });
    const drop = () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      scrollFrame = null; lastFrame = null;
      if (!dragging) return;
      dragging.classList.remove('dragging'); dragging = null;
      const before = (fields[type] || []).map((f) => f.key).join(); const after = keys();
      if (after.join() !== before) saveOrder(type, after);
    };
    listEl.addEventListener('pointerup', drop);
    listEl.addEventListener('pointercancel', drop);
  }
  async function saveOrder(type, keys, focusKey, dir) {
    try {
      fields = await api('/admin/unified-api-console/field-order', { method: 'PUT', body: { type, keys } });
      const positions = [...fieldsEl.querySelectorAll('.ua-field-list')].map(el => el.scrollTop);
      renderFields();
      fieldsEl.querySelectorAll('.ua-field-list').forEach((el, i) => { el.scrollTop = positions[i] || 0; });
      // Keep keyboard focus on the moved row's arrow so it can be moved again.
      if (focusKey) {
        const row = fieldsEl.querySelector(`.ua-field-list[data-type="${type}"] .ua-field[data-key="${CSS.escape(focusKey)}"]`);
        const btn = row && (row.querySelector(`[data-move="${dir}"]:not([disabled])`) || row.querySelector('[data-move]:not([disabled])'));
        if (btn) btn.focus({ preventScroll: true });
      }
      if (lastTest?.type === type) { const rank = (k) => { const i = keys.indexOf(k); return i < 0 ? keys.length : i; }; lastTest.fields.sort((a, b) => rank(a.key) - rank(b.key)); renderTest(); }
    } catch (e) { toast(e.message, 'err'); renderFields(); }
  }
  async function setVisible(type, changes) {
    try {
      fields = await api('/admin/unified-api-console/fields', { method: 'PUT', body: { [type]: changes } });
      // Rendering replaces the lists. Restore the position the user is at when
      // the save finishes, including focus and horizontal table scrolling.
      const pagePosition = { top: window.scrollY, left: window.scrollX };
      const roots = [fieldsEl, testEl];
      const positions = roots.map(root => [...root.querySelectorAll('.ua-field-list, .table-wrap')].map(el => ({ top: el.scrollTop, left: el.scrollLeft })));
      const active = document.activeElement;
      const focusRoot = roots.findIndex(root => root.contains(active));
      const focusKey = active?.dataset.key;
      const focusType = active?.dataset.type;
      const focusAll = active?.dataset.all;
      const focusOn = active?.dataset.on;
      renderFields();
      if (lastTest?.type === type) {
        for (const f of lastTest.fields) if (f.key in changes) f.visible = changes[f.key];
        const order = new Map(fields[type].map((f, i) => [f.key, i]));
        lastTest.fields.sort((a, b) => (order.get(a.key) ?? order.size) - (order.get(b.key) ?? order.size));
        renderTest();
      }
      if (focusRoot >= 0) {
        const selector = focusKey ? `.switch[data-type="${CSS.escape(focusType)}"][data-key="${CSS.escape(focusKey)}"]`
          : focusAll ? `[data-all="${CSS.escape(focusAll)}"][data-on="${CSS.escape(focusOn)}"]` : null;
        if (selector) roots[focusRoot].querySelector(selector)?.focus({ preventScroll: true });
      }
      roots.forEach((root, i) => root.querySelectorAll('.ua-field-list, .table-wrap').forEach((el, j) => {
        if (positions[i][j]) { el.scrollTop = positions[i][j].top; el.scrollLeft = positions[i][j].left; }
      }));
      window.scrollTo({ ...pagePosition, behavior: 'instant' });
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---- Test lookup --------------------------------------------------------
  // A list of courses is counted in courses; any other list in rows.
  const listNoun = (f) => (/transaction.?history/i.test(f.key) ? ['transaction', 'transactions'] : /course/i.test(`${f.key} ${f.label}`) ? ['course', 'courses'] : ['row', 'rows']);
  function renderTest(message) {
    const r = lastTest;
    let body = message || '';
    if (!body && r) {
      const shown = r.fields.filter((f) => f.visible).length;
      const photo = r.photo_url && r.fields.find((f) => f.key === 'photo_url')?.visible !== false;
      body = `<div class="ua-person">${photo ? `<img src="${esc(r.photo_url)}" alt="">` : `<span class="ph">${esc((r.full_name || '?').trim().charAt(0))}</span>`}<div><h3>${esc(r.full_name || 'No name returned')}</h3><div class="faint">${esc(TYPE_NAMES[r.type] || r.type)} · <span class="mono">${esc(r.id_number)}</span> · ${r.ms} ms · ${shown} of ${r.fields.length} fields shown on lookup</div></div></div>
        ${r.errors?.length ? `<div class="banner" style="margin:8px 0"><b>Some fields could not be read</b><div>${r.errors.map((k) => esc(k.replace(/_/g, ' '))).join(', ')}</div></div>` : ''}
        <div class="table-wrap"><table class="data ua-result-table"><thead><tr><th>Field</th><th>Value</th><th style="width:1%;white-space:nowrap">Show on lookup</th></tr></thead><tbody>
        ${r.fields.map((f) => `<tr class="${f.visible ? '' : 'off'}"><td>${esc(f.label)}<div class="faint mono" style="font-size:11.5px">${esc(f.key)}${f.stored ? '' : ' · not stored'}</div></td><td class="v">${f.list ? `<button type="button" class="value-link ${f.value === 'Yes' ? 'status-yes' : ''}" data-list-key="${esc(f.key)}">${f.value === 'Yes' ? 'Yes' : f.list.rows.length + ' ' + listNoun(f)[f.list.rows.length === 1 ? 0 : 1] + ': view table'}</button>` : f.value === '' || f.value == null ? '<span class="faint">empty</span>' : /^(Yes|No)$/.test(String(f.value)) ? `<span class="${f.value === 'Yes' ? 'status-yes' : 'status-no'}">${esc(f.value)}</span>` : esc(f.value)}</td><td>${sw(f.visible, `Show ${f.label}`, `data-type="${r.type}" data-key="${esc(f.key)}"`)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="hint">Test lookups do not create or update accounts. Staff field switches control future staff imports; existing values are preserved.</p>`;
    }
    testEl.innerHTML = `<div class="ua-head"><div><h2 id="uaTestTitle">Staff profile</h2><p class="muted">Open a staff ID directly, or search below by username or email and select a person.</p></div></div>
      <form class="ua-test-form" id="uaTestForm"><input type="hidden" name="source" value="STAFF"><input class="input mono" name="id" placeholder="Staff ID" aria-label="Staff ID" autocomplete="off" required value="${esc(testEl.dataset.id || '')}"><button class="btn btn-primary" type="submit">Look up</button></form>
      <div id="uaTestResult">${body}</div>`;
    testEl.querySelector('form').elements.source.value = 'STAFF';
    testEl.querySelector('form').onsubmit = runTest;
    testEl.querySelectorAll('[data-list-key]').forEach((b) => b.onclick = () => {
      const f = lastTest.fields.find((x) => x.key === b.dataset.listKey);
      listModal(f.label, f.list, { subtitle: `${lastTest.full_name || ''} · ${lastTest.id_number}`, noun: listNoun(f) });
    });
    testEl.querySelectorAll('.switch[data-key]').forEach((b) => b.onclick = () => setVisible(b.dataset.type, { [b.dataset.key]: b.getAttribute('aria-checked') !== 'true' }));
  }
  async function runTest(e) {
    e.preventDefault();
    const id = new FormData(e.currentTarget).get('id').trim();
    testEl.dataset.id = id;
    testEl.dataset.source = new FormData(e.currentTarget).get('source');
    const btn = e.currentTarget.querySelector('button'); btn.disabled = true; btn.textContent = 'Looking up…';
    let r;
    try { r = await api('/admin/unified-api-console/test-lookup', { method: 'POST', body: { id, source: new FormData(e.currentTarget).get('source') } }); }
    catch (err) { lastTest = null; renderTest(`<div class="banner" style="margin-top:14px"><b>Test failed</b><div>${esc(err.message)}</div></div>`); return; }
    if (r.status === 'found') {
      lastTest = r; renderTest();
      // The lookup may have taught the server new fields; show them in the toggle list.
      try { fields = (await api('/admin/unified-api-console/settings')).fields; renderFields(); } catch (_) { /* keep the current list */ }
      return;
    }
    lastTest = null;
    const reasons = { not_configured: 'The API URL and key are not set.', switched_off: 'Live lookups are switched off in the settings.', timeout: 'The API did not answer in time.' };
    renderTest(r.status === 'not_found'
      ? `<div class="banner" style="margin-top:14px"><b>No match</b><div>The API has no staff record for <span class="mono">${esc(id)}</span> (${r.ms} ms).</div></div>`
      : `<div class="banner" style="margin-top:14px"><b>API unavailable</b><div>${esc(reasons[r.reason] || r.reason || 'No response')}</div></div>`);
  }

  const searchForm = document.getElementById('uaSearchForm');
  const searchResult = document.getElementById('uaSearchResult');
  searchForm.onsubmit = async (e) => {
    e.preventDefault();
    const query = String(new FormData(searchForm).get('q') || '').trim();
    const btn = searchForm.querySelector('button');
    btn.disabled = true; btn.textContent = 'Searching…';
    searchResult.textContent = 'Searching staff…';
    let matches = document.getElementById('uaSearchMatches');
    if (!matches) { matches = document.createElement('div'); matches.id = 'uaSearchMatches'; searchResult.after(matches); }
    matches.innerHTML = '';
    try {
      const found = await api('/admin/unified-api-client/search?q=' + encodeURIComponent(query));
      if (found.status !== 'ok') throw new Error(found.reason || 'Staff search is unavailable.');
      searchResult.textContent = found.results.length ? `${found.results.length} staff match(es). Select a person to open their profile.` : 'No staff found for that username or email.';
      const showPhotos = fields.STAFF.find(f => f.key === 'photo_url')?.visible !== false;
      matches.innerHTML = found.results.map((person, index) => `<button type="button" class="ua-search-match" data-match="${index}">${showPhotos ? `<img loading="lazy" src="/api/admin/unified-api-client/photo/${encodeURIComponent(person.id_number)}" alt="Staff picture">` : ''}<span><b>${esc(person.fields.full_name || 'Staff match')}</b><small>${esc(person.fields.username || person.fields.email || '')}</small><small>${esc(person.fields.id_number || '')}</small><small>View staff profile →</small></span></button>`).join('');
      matches.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.remove()));
      matches.querySelectorAll('[data-match]').forEach(button => button.onclick = () => {
        const person = found.results[Number(button.dataset.match)];
        const form = testEl.querySelector('form'); form.elements.id.value = person.id_number; form.requestSubmit();
        testEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err) { searchResult.textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Search staff'; }
  };
  await load();
  await window.VMTL_UNIFIED_TOKENS(document.getElementById("uaTokens"));
};
