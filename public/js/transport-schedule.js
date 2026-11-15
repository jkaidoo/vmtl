'use strict';
// Transport Schedule — events list. Create events, set centre requirements,
// build the driver pool, then open the roster builder.
window.VMTL_PAGE = async function () {
  const view = VMTL.view, esc = VMTL.esc;
  const canManage = VMTL.can('schedule.manage');

  const WF = { draft: ['Draft', 'grey'], review: ['In review', 'amber'], published: ['Published', 'green'] };

  async function load() {
    const [events, types] = await Promise.all([VMTL.api('/ts/events'), VMTL.api('/ts/event-types')]);
    render(events.data, types.data);
  }

  function render(events, types) {
    const activeTypes = types.filter((t) => t.active);
    view.innerHTML = VMTL.pageHead('Transport Schedule', 'Build driver rosters: define centres, pull in a pool of drivers, then assign them to centres.',
      canManage ? '<button class="btn btn-primary" id="newEvent">Create event</button>' : '') +
      (!events.length ? `<div class="card pad"><p>No events yet. ${canManage ? (activeTypes.length ? 'Create an event to start scheduling.' : 'Add an event type under <a href="/ts-config.html">Reference data</a> first.') : ''}</p></div>` : '') +
      events.map((e) => {
        const wf = WF[e.workflow] || WF.draft;
        return `<div class="card pad mb">
          <div class="row wrap" style="align-items:center;gap:12px">
            <div>
              <h3 style="margin:0">${esc(e.title)} <span class="badge blue">${esc(e.type_name)}</span> ${VMTL.badge(wf[0], wf[1])}</h3>
              <div class="dim">${[e.code, dateRange(e), `${e.centre_count} centre${e.centre_count === 1 ? '' : 's'}`, `${e.drivers_assigned}/${e.drivers_needed || '—'} drivers`].filter(Boolean).join(' · ')}</div>
            </div>
            <span class="spacer"></span>
            <div class="btn-row">
              <a class="btn btn-primary" href="/ts-builder.html?event=${e.id}">Open builder</a>
              ${canManage ? `<button class="btn" data-centres="${e.id}">Centres</button><button class="btn" data-pool="${e.id}">Pool</button><button class="btn" data-edit="${e.id}">Edit</button><button class="btn btn-danger" data-del="${e.id}">Delete</button>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');
    if (!canManage) return;

    const modal = (title, inner, opts) => VMTL.openModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>✕</button></div>${inner}`, opts);
    const formModal = (title, fields, save, large) => {
      const m = modal(title, `<form><div class="modal-body"><div class="form-grid">${fields}</div></div><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></form>`, { large });
      m.el.querySelector('form').onsubmit = async (ev) => { ev.preventDefault(); const form = ev.target; if (!form.reportValidity()) return; try { await save(Object.fromEntries(new FormData(form)), m); m.close(); await load(); } catch (err) { VMTL.showErrors(err, form); } };
      return m;
    };
    const f = (label, name, type = 'text', extra = '') => `<div class="field"><label>${label}</label><input name="${name}" type="${type}" ${extra}></div>`;
    const typeOptions = (sel) => activeTypes.map((t) => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const eventFields = (e) => `<div class="field"><label>Event type</label><select name="event_type_id" required>${typeOptions(e && e.event_type_id)}</select></div>`
      + f('Title', 'title', 'text', 'required') + f('Code (optional)', 'code')
      + f('Start date', 'start_date', 'date') + f('End date', 'end_date', 'date')
      + f('Session start time', 'start_time', 'time') + f('Session end time', 'end_time', 'time');

    view.querySelector('#newEvent')?.addEventListener('click', () => {
      if (!activeTypes.length) return VMTL.toast('Add an event type under Reference data first.', 'err');
      formModal('Create event', eventFields(), (b) => VMTL.api('/ts/events', { method: 'POST', body: cleanEvent(b) }), true);
    });
    view.querySelectorAll('[data-edit]').forEach((btn) => btn.onclick = async () => {
      const e = (await VMTL.api('/ts/events/' + btn.dataset.edit)).data;
      const m = formModal('Edit event', eventFields(e), (b) => VMTL.api('/ts/events/' + e.id, { method: 'PUT', body: cleanEvent(b) }), true);
      ['title', 'code', 'start_date', 'end_date', 'start_time', 'end_time'].forEach((k) => { if (m.el.querySelector(`[name=${k}]`)) m.el.querySelector(`[name=${k}]`).value = e[k] || ''; });
    });
    view.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = async () => {
      if (!await VMTL.confirm('Delete this event and its roster? This cannot be undone.', { danger: true, confirmLabel: 'Delete' })) return;
      try { await VMTL.api('/ts/events/' + btn.dataset.del, { method: 'DELETE' }); await load(); } catch (e) { VMTL.showErrors(e); }
    });
    view.querySelectorAll('[data-centres]').forEach((btn) => btn.onclick = () => manageCentres(btn.dataset.centres));
    view.querySelectorAll('[data-pool]').forEach((btn) => btn.onclick = () => managePool(btn.dataset.pool));
  }

  function cleanEvent(b) {
    return { event_type_id: Number(b.event_type_id), title: b.title, code: b.code || null,
      start_date: b.start_date || null, end_date: b.end_date || null, start_time: b.start_time || null, end_time: b.end_time || null };
  }
  function dateRange(e) {
    if (!e.start_date) return 'Undated';
    return e.end_date && e.end_date !== e.start_date ? `${VMTL.fmtDate(e.start_date)} – ${VMTL.fmtDate(e.end_date)}` : VMTL.fmtDate(e.start_date);
  }

  async function manageCentres(eventId) {
    const [board, centres] = await Promise.all([VMTL.api('/ts/events/' + eventId + '/board'), VMTL.api('/ts/centres')]);
    const b = board.data;
    const all = centres.data.filter((c) => c.active);
    const m = VMTL.openModal(`<div class="modal-head"><h3>Centres — ${esc(b.event.title)}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body" id="cbody"></div><div class="modal-foot"><button class="btn" data-close>Done</button></div>`, { large: true });
    const body = m.el.querySelector('#cbody');
    function draw(list) {
      const used = new Set(list.map((c) => c.centre_id));
      const avail = all.filter((c) => !used.has(c.id));
      body.innerHTML = `${list.length ? `<table class="data"><thead><tr><th>Centre</th><th>Drivers needed</th><th>Assigned</th><th></th></tr></thead><tbody>${list.map((c) => `<tr><td><strong>${esc(c.centre_name)}</strong></td><td><input type="number" min="0" value="${c.drivers_needed}" data-need="${c.id}" style="width:5rem"></td><td>${b.assignments.filter((a) => a.centre_id === c.centre_id).length}</td><td class="right"><button class="btn btn-sm btn-danger" data-rm="${c.id}">Remove</button></td></tr>`).join('')}</tbody></table>` : '<p class="dim">No centres on this event yet.</p>'}
        <div class="row mt" style="gap:8px;align-items:flex-end">
          <div class="field" style="flex:1"><label>Add a centre</label><select id="addCentreSel">${avail.length ? avail.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') : '<option value="">All centres added</option>'}</select></div>
          <div class="field"><label>Drivers needed</label><input type="number" id="addNeed" min="0" value="1" style="width:6rem"></div>
          <button class="btn btn-primary" id="addCentreBtn" ${avail.length ? '' : 'disabled'}>Add</button>
        </div>`;
      body.querySelectorAll('[data-need]').forEach((inp) => inp.onchange = async () => { try { await VMTL.api('/ts/events/' + eventId + '/centres', { method: 'POST', body: { centre_id: Number(inp.dataset.need), drivers_needed: Number(inp.value) } }); } catch (e) { VMTL.showErrors(e); } });
      body.querySelectorAll('[data-rm]').forEach((btn) => btn.onclick = async () => {
        const ec = (await VMTL.api('/ts/events/' + eventId + '/board')).data.centres.find((c) => c.centre_id === Number(btn.dataset.rm));
        try { await VMTL.api('/ts/event-centres/' + ec.event_centre_id, { method: 'DELETE' }); reload(); } catch (e) { VMTL.showErrors(e); }
      });
      body.querySelector('#addCentreBtn').onclick = async () => {
        const sel = body.querySelector('#addCentreSel'); if (!sel.value) return;
        try { await VMTL.api('/ts/events/' + eventId + '/centres', { method: 'POST', body: { centre_id: Number(sel.value), drivers_needed: Number(body.querySelector('#addNeed').value) || 0 } }); reload(); } catch (e) { VMTL.showErrors(e); }
      };
    }
    async function reload() { const fresh = (await VMTL.api('/ts/events/' + eventId + '/board')).data; b.assignments = fresh.assignments; draw(fresh.centres); }
    draw(b.centres);
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) load(); });
  }

  async function managePool(eventId) {
    const [board, groups] = await Promise.all([VMTL.api('/ts/events/' + eventId + '/board'), VMTL.api('/ts/driver-groups')]);
    const b = board.data;
    const m = VMTL.openModal(`<div class="modal-head"><h3>Driver pool — ${esc(b.event.title)}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body">
      <p class="dim">The pool is the set of drivers available to assign on this event.</p>
      <div class="row" style="gap:8px;align-items:flex-end">
        <div class="field" style="flex:1"><label>Add drivers</label><select id="src"><option value="all">All active drivers</option>${groups.data.filter((g) => g.active).map((g) => `<option value="g${g.id}">Group: ${esc(g.name)} (${g.member_count})</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="imp">Add to pool</button>
      </div>
      <div id="poolList" class="mt"></div></div><div class="modal-foot"><button class="btn" data-close>Done</button></div>`, { large: true });
    function drawPool(pool) {
      m.el.querySelector('#poolList').innerHTML = pool.length
        ? `<p class="dim">${pool.length} driver(s) in the pool.</p><table class="data"><thead><tr><th>Driver</th><th>Org unit</th><th></th></tr></thead><tbody>${pool.map((d) => `<tr><td><strong>${esc(d.name)}</strong>${d.phone ? ` · ${esc(d.phone)}` : ''}</td><td>${esc(d.org_unit_name || '—')}</td><td class="right"><button class="btn btn-sm btn-danger" data-rm="${d.id}">Remove</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="dim">No drivers in the pool yet.</p>';
      m.el.querySelectorAll('[data-rm]').forEach((btn) => btn.onclick = async () => { try { await VMTL.api('/ts/events/' + eventId + '/pool/' + btn.dataset.rm, { method: 'DELETE' }); refresh(); } catch (e) { VMTL.showErrors(e); } });
    }
    async function refresh() { drawPool((await VMTL.api('/ts/events/' + eventId + '/board')).data.pool); }
    m.el.querySelector('#imp').onclick = async () => {
      const v = m.el.querySelector('#src').value;
      const body = v === 'all' ? {} : { group_id: Number(v.slice(1)) };
      try { const r = await VMTL.api('/ts/events/' + eventId + '/import-drivers', { method: 'POST', body }); VMTL.toast(`${r.data.imported} driver(s) added.`); refresh(); } catch (e) { VMTL.showErrors(e); }
    };
    drawPool(b.pool);
  }

  await load();
};
