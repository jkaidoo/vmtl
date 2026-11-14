'use strict';
// Owner page access (App Owner only) — share selected App-Owner pages with
// roles or specific people. Changes are drafted locally and saved together.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc; const icon = VMTL.icon;
  if (!document.querySelector('link[href^="/css/owner-access.css"]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/owner-access.css'; document.head.appendChild(link);
  }
  if (!VMTL.isSuper()) { view.innerHTML = VMTL.pageHead('Owner page access', '') + '<div class="empty">App Owner access only.</div>'; return; }
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  const ICONS = { 'app-overview': 'compass', dropdowns: 'sliders', 'file-server': 'database', broadcasts: 'megaphone' };
  const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  let roles = []; let pages = []; let draft = {}; let savedJson = ''; let serverData = null;
  const unload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', unload);
  VMTL.onLeave(() => window.removeEventListener('beforeunload', unload));

  const load = (data) => {
    serverData = data; roles = data.roles; pages = data.pages;
    draft = Object.fromEntries(pages.map((p) => [p.key, { roles: new Set(p.roles), users: new Map(p.users.map((u) => [u.id, u])) }]));
    savedJson = snapshot();
  };
  const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(draft).map(([k, g]) => [k, { roles: [...g.roles].sort(), users: [...g.users.keys()].sort((a, b) => a - b) }])));
  const dirty = () => snapshot() !== savedJson;
  const summary = (g) => {
    const r = g.roles.size; const u = g.users.size;
    if (!r && !u) return ['Only you', false];
    return [[r && `${r} ${r === 1 ? 'role' : 'roles'}`, u && `${u} ${u === 1 ? 'person' : 'people'}`].filter(Boolean).join(' · '), true];
  };

  try { load((await VMTL.api('/admin/owner-access')).data); }
  catch (e) { view.innerHTML = VMTL.pageHead('Owner page access', '') + `<div class="empty">${esc(e.message)}</div>`; return; }

  const personRow = (key, p) => `<li class="oa-person"><div class="who"><strong>${esc(p.name)}</strong><span>${esc(p.email || '')}${p.active === false ? ' · <span class="inactive">inactive</span>' : ''}</span></div>
    <button type="button" class="oa-remove" data-remove="${key}:${p.id}" aria-label="Remove ${esc(p.name)} from ${esc(pages.find((x) => x.key === key).label)}">${X}</button></li>`;
  const peopleList = (key) => { const list = [...draft[key].users.values()]; return list.length ? `<ul class="oa-people">${list.map((p) => personRow(key, p)).join('')}</ul>` : '<p class="oa-empty">No individual people yet.</p>'; };
  const pageCard = (p) => {
    const g = draft[p.key]; const [text, on] = summary(g);
    return `<section class="oa-page" data-page="${p.key}" aria-labelledby="oa-h-${p.key}">
      <div class="oa-top"><div class="oa-ic">${icon(ICONS[p.key] || 'key')}</div>
        <div><h2 id="oa-h-${p.key}"><a href="${p.path}">${esc(p.label)}</a></h2><p>${esc(p.description)}</p></div>
        <span class="oa-summary ${on ? 'on' : ''}" data-summary="${p.key}">${esc(text)}</span></div>
      <div><p class="oa-label" id="oa-r-${p.key}">Roles</p>
        <div class="oa-roles" role="group" aria-labelledby="oa-r-${p.key}">${roles.map((r) => `<button type="button" class="oa-role" data-role="${p.key}:${esc(r.slug)}" aria-pressed="${g.roles.has(r.slug)}">${g.roles.has(r.slug) ? TICK : ''}${esc(r.name)}</button>`).join('')}</div></div>
      <div><p class="oa-label">People</p><div data-people="${p.key}">${peopleList(p.key)}</div>
        <div class="oa-search"><label class="oa-sr" for="oa-s-${p.key}">Add a person to ${esc(p.label)}</label>
          <input id="oa-s-${p.key}" type="search" data-search="${p.key}" placeholder="Add a person by name or email…" autocomplete="off" aria-controls="oa-l-${p.key}" aria-expanded="false">
          <ul class="oa-results" id="oa-l-${p.key}" hidden></ul></div></div>
    </section>`;
  };
  const locked = (ic, title, text) => `<section class="oa-page locked"><div class="oa-top"><div class="oa-ic">${icon(ic)}</div><div><h2>${title}</h2><p>${text}</p></div><span class="oa-summary">Always only you</span></div></section>`;

  const render = () => {
  view.innerHTML = VMTL.pageHead('Owner page access', 'Share selected App Owner pages with roles or specific people. Only you can change these settings.') + `<div class="oa">
    <div class="oa-note">${icon('shield')}<p>People you share a page with can do everything you can on that page — for example, send broadcasts to every user or change where uploaded files are stored. Shared pages appear in their menu straight away. Every change here is recorded in the audit log.</p></div>
    <div class="oa-bar"><span class="status" id="oaStatus" role="status">All changes saved.</span><div class="btn-row"><button type="button" class="btn" id="oaDiscard" disabled>Discard changes</button><button type="button" class="btn btn-primary" id="oaSave" disabled>Save access</button></div></div>
    <div class="oa-pages" id="oaPages">${pages.map(pageCard).join('')}
      ${locked('database', 'Backup &amp; cleanup', 'Full database snapshots hold password hashes and saved secrets, and restore and cleanup permanently change data, so this page cannot be shared.')}
      ${locked('key', 'Owner page access', 'This page. It cannot be shared, so nobody else can widen their own access.')}
    </div></div>`;

  const status = view.querySelector('#oaStatus'); const saveBtn = view.querySelector('#oaSave'); const discardBtn = view.querySelector('#oaDiscard');
  const refreshState = () => {
    const d = dirty(); saveBtn.disabled = !d; discardBtn.disabled = !d;
    status.textContent = d ? 'Unsaved changes.' : 'All changes saved.'; status.classList.toggle('dirty', d);
    for (const p of pages) { const [text, on] = summary(draft[p.key]); const el = view.querySelector(`[data-summary="${p.key}"]`); el.textContent = text; el.classList.toggle('on', on); }
  };
  const redrawPeople = (key) => { view.querySelector(`[data-people="${key}"]`).innerHTML = peopleList(key); };

  // Roles and removals (event delegation).
  view.querySelector('#oaPages').addEventListener('click', (e) => {
    const role = e.target.closest('[data-role]');
    if (role) {
      const [key, slug] = role.dataset.role.split(':'); const set = draft[key].roles;
      if (set.has(slug)) set.delete(slug); else set.add(slug);
      role.setAttribute('aria-pressed', String(set.has(slug))); role.innerHTML = (set.has(slug) ? TICK : '') + esc(roles.find((r) => r.slug === slug).name);
      refreshState(); return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const [key, id] = remove.dataset.remove.split(':'); draft[key].users.delete(Number(id)); redrawPeople(key); refreshState();
      view.querySelector(`[data-search="${key}"]`).focus();
    }
  });

  // Person search: debounced lookup, keyboard navigation, click or Enter to add.
  const timers = {};
  const close = (key) => { const list = view.querySelector(`#oa-l-${key}`); list.hidden = true; list.innerHTML = ''; view.querySelector(`[data-search="${key}"]`).setAttribute('aria-expanded', 'false'); };
  const choose = (key, person) => {
    draft[key].users.set(person.id, person); redrawPeople(key); refreshState();
    const input = view.querySelector(`[data-search="${key}"]`); input.value = ''; close(key); input.focus();
  };
  view.querySelectorAll('[data-search]').forEach((input) => {
    const key = input.dataset.search; const list = view.querySelector(`#oa-l-${key}`);
    let results = [];
    input.addEventListener('input', () => {
      clearTimeout(timers[key]); const q = input.value.trim();
      if (q.length < 2) { close(key); return; }
      timers[key] = setTimeout(async () => {
        try {
          results = (await VMTL.api(`/users?search=${encodeURIComponent(q)}&per_page=8`)).data || [];
          if (input.value.trim() !== q) return;
          list.innerHTML = results.length ? results.map((u, i) => {
            const reason = u.is_super_admin ? 'App Owner — always has access' : draft[key].users.has(u.id) ? 'Already added' : !u.active ? 'Inactive account' : '';
            return `<li><button type="button" data-pick="${i}" ${reason ? 'disabled' : ''}>${esc(u.name)}<small>${esc(u.email || '')}${u.role ? ' · ' + esc(u.role.name) : ''}${reason ? ' · ' + reason : ''}</small></button></li>`;
          }).join('') : '<li class="none">No matching people.</li>';
          list.hidden = false; input.setAttribute('aria-expanded', 'true');
        } catch (err) { VMTL.showErrors(err); }
      }, 250);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(key); return; }
      if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); list.querySelector('button:not(:disabled)')?.focus(); }
      if (e.key === 'Enter') { e.preventDefault(); const first = list.querySelector('button:not(:disabled)'); if (first) first.click(); }
    });
    list.addEventListener('keydown', (e) => {
      const buttons = [...list.querySelectorAll('button:not(:disabled)')]; const i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[Math.min(buttons.length - 1, i + 1)]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.focus(); else buttons[i - 1].focus(); }
      if (e.key === 'Escape') { close(key); input.focus(); }
    });
    list.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]'); if (!pick || pick.disabled) return;
      const u = results[Number(pick.dataset.pick)]; choose(key, { id: u.id, name: u.name, email: u.email, active: u.active });
    });
    input.addEventListener('blur', () => setTimeout(() => { if (!list.contains(document.activeElement)) close(key); }, 150));
  });

  discardBtn.addEventListener('click', () => { load(serverData); render(); view.querySelector('#oaSave').focus(); });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; status.textContent = 'Saving…';
    const body = { pages: Object.fromEntries(Object.entries(draft).map(([k, g]) => [k, { roles: [...g.roles], users: [...g.users.keys()] }])) };
    try {
      load((await VMTL.api('/admin/owner-access', { method: 'PUT', body })).data);
      refreshState(); VMTL.toast('Page access saved.', 'success');
    } catch (err) { refreshState(); VMTL.showErrors(err); }
  });
  };
  render();
};
