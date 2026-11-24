'use strict';
// Transport Schedule — the roster builder board. Centres on the left (each with
// its assigned drivers, a staffing count, team-lead, contacted, availability and
// travelled controls); the driver pool on the right (search + filter, drag or
// click to assign to a targeted centre). Ported from walkin's scheduler builder.
window.VMTL_PAGE = async function () {
  const view = VMTL.view, esc = VMTL.esc;
  const eventId = new URLSearchParams(location.search).get('event');
  const canWrite = VMTL.can('schedule.manage');
  const canPublish = VMTL.can('schedule.publish');
  if (!eventId) { view.innerHTML = '<div class="card pad">No event selected. <a href="/transport-schedule.html">Back to Transport Schedule</a>.</div>'; return; }

  injectStyles();
  let board = null, targetCentreId = null;
  const filter = { q: '', org_unit_id: '', hideAssigned: false, hideUnavailable: false, activeOnly: true };

  async function reload() {
    const scroll = { x: scrollX, y: scrollY };
    try { board = (await VMTL.api('/ts/events/' + eventId + '/board')).data; } catch (e) { view.innerHTML = `<div class="card pad">${esc(e.message)}</div>`; return; }
    render(); scrollTo(scroll.x, scroll.y);
  }

  const roleLabels = () => ({ lead: board.event.lead_role_label || 'Team lead', driver: board.event.driver_role_label || 'Driver' });
  const availSym = (s) => s === 'available' ? '✓' : s === 'unavailable' ? '!' : '?';
  const availLabel = (s) => s === 'available' ? 'Available' : s === 'unavailable' ? 'Unavailable' : 'Unconfirmed';

  function render() {
    const e = board.event, roles = roleLabels();
    const totalNeed = board.centres.reduce((a, c) => a + (c.drivers_needed || 0), 0);
    const wf = { draft: ['Draft', 'grey'], review: ['In review', 'amber'], published: ['Published', 'green'] }[e.workflow] || ['Draft', 'grey'];
    view.innerHTML = `
      <div class="row wrap tsb-top" style="align-items:flex-start;gap:12px">
        <div><h2 style="margin:0">${esc(e.title)} <span class="badge blue">${esc(e.type_name)}</span> ${VMTL.badge(wf[0], wf[1])}</h2>
          <div class="dim">${[dateRange(e), `${board.assignments.length}/${totalNeed || '—'} drivers assigned`, 'Revision ' + e.revision].filter(Boolean).join(' · ')}</div></div>
        <span class="spacer"></span>
        <div class="btn-row">
          <a class="btn" href="/transport-schedule.html">← Events</a>
          <button class="btn" id="refresh">↻ Refresh</button>
          ${canWrite ? '<button class="btn" id="supers">Supervisors' + (board.supervisors.length ? ' (' + board.supervisors.length + ')' : '') + '</button>' : ''}
          ${canWrite ? '<button class="btn" id="roleNames">Role names</button>' : ''}
          ${canWrite ? '<button class="btn" id="importSch">Import</button>' : ''}
          ${canWrite ? '<button class="btn" id="requests">Change requests</button>' : ''}
          ${canWrite ? '<button class="btn" id="history">History</button>' : ''}
          ${canWrite ? '<button class="btn btn-danger" id="removeUnavail">Remove unavailable</button>' : ''}
          ${canWrite ? '<button class="btn btn-danger" id="clearAll">Clear all</button>' : ''}
        </div>
      </div>
      ${workflowBar(e, wf)}
      ${!board.centres.length ? '<div class="card pad mt">No centres on this event yet. Add centres from the <a href="/transport-schedule.html">Transport Schedule</a> page → “Centres”.</div>' : `
      <div class="tsb-layout mt">
        <div class="tsb-canvas" id="canvas">${board.centres.map((c) => centreCard(c, roles)).join('')}</div>
        ${poolPanel(roles)}
      </div>`}`;

    view.querySelector('#refresh').onclick = reload;
    view.querySelector('#supers')?.addEventListener('click', manageSupervisors);
    view.querySelector('#roleNames')?.addEventListener('click', roleNamesDialog);
    view.querySelector('#importSch')?.addEventListener('click', importSchedule);
    view.querySelector('#requests')?.addEventListener('click', manageRequests);
    view.querySelector('#history')?.addEventListener('click', revisionHistory);
    view.querySelector('#clearAll')?.addEventListener('click', clearAll);
    view.querySelector('#removeUnavail')?.addEventListener('click', removeUnavailable);
    wireWorkflow(e);
    if (board.centres.length) { wireCentres(); wirePool(); }
  }

  function workflowBar(e, wf) {
    if (!canPublish && !e.public_token) return '';
    return `<div class="card pad mt"><div class="row wrap" style="align-items:center;gap:10px">
      <strong>Review & publish</strong><span class="dim">Revision ${e.revision} · ${wf[0]}${e.published_snapshot ? ' · a published copy exists' : ''}</span><span class="spacer"></span>
      ${canPublish ? `<button class="btn" data-wf="review">Submit for review</button>
        <button class="btn btn-primary" data-wf="publish" ${e.workflow !== 'review' ? 'disabled title="Submit for review first"' : ''}>Approve & publish</button>
        ${e.public_token ? '<button class="btn btn-danger" data-wf="revoke">Revoke public link</button>' : ''}` : ''}
      ${e.public_token && e.published_snapshot ? `<a class="btn" href="/ts-schedule-public.html?token=${encodeURIComponent(e.public_token)}" target="_blank" rel="noopener">Open published schedule</a>` : ''}
    </div></div>`;
  }
  function wireWorkflow(e) {
    view.querySelectorAll('[data-wf]').forEach((btn) => btn.onclick = async () => {
      const action = btn.dataset.wf;
      if (action === 'publish') return publishDialog();
      if (!await VMTL.confirm((action === 'revoke' ? 'Revoke the public link' : 'Submit this roster for review') + '?', { danger: action === 'revoke' })) return;
      try { await VMTL.api('/ts/events/' + eventId + '/workflow', { method: 'POST', body: { action } }); await reload(); } catch (err) { VMTL.showErrors(err); }
    });
  }
  function publishDialog() {
    const list = board.centres.map((c) => `<label class="checkbox"><input type="checkbox" class="pubc" value="${c.centre_id}" checked> ${esc(c.centre_name)} (${board.assignments.filter((a) => a.centre_id === c.centre_id).length})</label>`).join('')
      + (board.supervisors.length ? '<label class="checkbox"><input type="checkbox" class="pubs" checked> Supervisors (' + board.supervisors.length + ')</label>' : '');
    const m = VMTL.openModal(`<div class="modal-head"><h3>Approve & publish</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><p class="dim">Anyone with the public link sees the name and role of everyone in the sections left on (phone numbers are not shown publicly).</p>${list}</div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="doPub">Publish</button></div>`, { large: true });
    m.el.querySelector('#doPub').onclick = async () => {
      const exclude = [...m.el.querySelectorAll('.pubc')].filter((i) => !i.checked).map((i) => Number(i.value));
      const inc = m.el.querySelector('.pubs') ? m.el.querySelector('.pubs').checked : true;
      try { await VMTL.api('/ts/events/' + eventId + '/workflow', { method: 'POST', body: { action: 'publish', exclude_centre_ids: exclude, include_supervisors: inc } }); m.close(); await reload(); } catch (err) { VMTL.showErrors(err); }
    };
  }

  function centreCard(c, roles) {
    const assigned = board.assignments.filter((a) => a.centre_id === c.centre_id);
    const need = c.drivers_needed || 0;
    let cls = 'under'; if (need && assigned.length === need) cls = 'full'; else if (need && assigned.length > need) cls = 'over'; else if (!need) cls = 'full';
    return `<div class="tsb-centre ${targetCentreId === c.centre_id ? 'target' : ''}" data-centre="${c.centre_id}">
      <div class="tsb-centre-head" data-centre-head="${c.centre_id}">
        <div><span class="tsb-centre-name">${esc(c.centre_name)}</span>${c.is_kumasi ? ' <span class="badge blue">Kumasi</span>' : ''}${c.region ? `<div class="dim" style="font-size:12px">${esc(c.region)}</div>` : ''}</div>
        <span class="tsb-count ${cls}">${assigned.length}/${need || '—'}</span>
      </div>
      <div class="tsb-centre-body">${assigned.map((a) => assignedRow(a, assigned, roles)).join('') || '<div class="dim" style="padding:6px 0">No drivers yet.</div>'}</div>
      ${canWrite ? `<button class="btn btn-sm tsb-add" data-add="${c.centre_id}">+ Assign here</button>` : ''}
    </div>`;
  }
  function assignedRow(a, assigned, roles) {
    const isLead = a.role === 'team_lead';
    return `<div class="tsb-assigned">
      <div class="tsb-assigned-main">
        <div class="tsb-assigned-name">${esc(a.driver_name)}${isLead ? ` <span class="badge green">${esc(roles.lead)}</span>` : ''}</div>
        <div class="dim" style="font-size:12px">${[a.org_unit_name, a.phone].filter(Boolean).join(' · ')}</div>
        ${a.availability_status === 'unavailable' && a.availability_notes ? `<div style="color:var(--danger);font-size:12px">${esc(a.availability_notes)}</div>` : ''}
      </div>
      <div class="tsb-assigned-actions">
        ${canWrite && assigned.length > 1 ? `<button class="tsb-ic ${isLead ? 'on' : ''}" title="${isLead ? 'Remove team lead' : 'Make team lead'}" data-lead="${a.id}">★</button>` : ''}
        ${canWrite ? `<button class="tsb-ic ${a.contacted ? 'on' : ''}" title="${a.contacted ? 'Contacted' : 'Mark contacted'}" data-contact="${a.id}">☎</button>` : ''}
        ${canWrite ? `<button class="tsb-ic av-${a.availability_status || 'pending'}" title="Availability: ${availLabel(a.availability_status)}" data-avail="${a.id}">${availSym(a.availability_status)}</button>` : `<span class="tsb-ic av-${a.availability_status || 'pending'}">${availSym(a.availability_status)}</span>`}
        ${canWrite ? `<button class="tsb-ic ${a.traveled ? 'on' : ''}" title="Travelled" data-travel="${a.id}">✈</button>` : ''}
        ${canWrite ? `<button class="tsb-ic danger" title="Remove" data-remove="${a.id}">✕</button>` : ''}
      </div>
    </div>`;
  }

  function poolPanel(roles) {
    const orgUnits = [...new Map(board.pool.filter((d) => d.org_unit_id).map((d) => [d.org_unit_id, d.org_unit_name])).entries()];
    return `<div class="tsb-pool">
      <div class="tsb-pool-head">
        <div class="row" style="justify-content:space-between;align-items:center"><strong>Driver pool</strong>${targetCentreId ? `<span class="badge green">Target: ${esc(board.centres.find((c) => c.centre_id === targetCentreId)?.centre_name || '')}</span>` : '<span class="dim" style="font-size:12px">Click a centre to target</span>'}</div>
        <input class="tsb-search" id="poolSearch" placeholder="Search name…" value="${esc(filter.q)}">
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px">
          <select id="poolOrg"><option value="">All org units</option>${orgUnits.map(([id, name]) => `<option value="${id}" ${String(filter.org_unit_id) === String(id) ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
        </div>
        <div class="row" style="gap:12px;margin-top:6px;flex-wrap:wrap">
          <label class="checkbox"><input type="checkbox" id="fHideAssigned" ${filter.hideAssigned ? 'checked' : ''}> Hide assigned</label>
          <label class="checkbox"><input type="checkbox" id="fHideUnavail" ${filter.hideUnavailable ? 'checked' : ''}> Hide unavailable</label>
        </div>
      </div>
      <div class="tsb-pool-list" id="poolList"></div>
    </div>`;
  }
  function drawPool() {
    const list = view.querySelector('#poolList'); if (!list) return;
    const assignedIds = new Set(board.assignments.map((a) => a.driver_id));
    const superIds = new Set(board.supervisors.map((s) => s.driver_id));
    const centreOf = new Map(board.centres.map((c) => [c.centre_id, c.centre_name]));
    const assignedCentre = new Map(board.assignments.map((a) => [a.driver_id, centreOf.get(a.centre_id)]));
    let items = board.pool.filter((d) => {
      if (filter.activeOnly && !d.active) return false;
      if (filter.org_unit_id && String(d.org_unit_id) !== String(filter.org_unit_id)) return false;
      if (filter.q && !d.name.toLowerCase().includes(filter.q.toLowerCase())) return false;
      if (filter.hideAssigned && (assignedIds.has(d.id) || superIds.has(d.id))) return false;
      if (filter.hideUnavailable && d.unavailable_here) return false;
      return true;
    });
    if (!items.length) { list.innerHTML = '<div class="dim" style="padding:12px">No drivers match. Add drivers via the “Pool” button on the Transport Schedule page.</div>'; return; }
    list.innerHTML = items.map((d) => {
      const here = assignedIds.has(d.id), sup = superIds.has(d.id), busy = here || sup;
      return `<div class="tsb-chip ${busy ? 'busy' : ''}" ${canWrite && !busy ? `draggable="true" data-chip="${d.id}" tabindex="0" role="button"` : ''}>
        <div class="row" style="justify-content:space-between"><span class="tsb-chip-name">${esc(d.name)}</span><span class="badge grey">${esc(d.status || '')}</span></div>
        <div class="dim" style="font-size:12px">${[d.org_unit_name, 'Events ' + d.total_events, '✈ ' + d.travel_count].filter(Boolean).join(' · ')}</div>
        ${here ? `<div class="tsb-chip-tag">✓ on this event${assignedCentre.get(d.id) ? ' @ ' + esc(assignedCentre.get(d.id)) : ''}</div>` : ''}
        ${sup ? '<div class="tsb-chip-tag">◉ supervising</div>' : ''}
        ${d.unavailable_here ? '<div class="tsb-chip-tag" style="color:var(--danger)">Unavailable</div>' : ''}
      </div>`;
    }).join('');
    if (!canWrite) return;
    list.querySelectorAll('[data-chip]').forEach((chip) => {
      const id = Number(chip.dataset.chip);
      chip.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(id)));
      chip.addEventListener('click', () => { if (!targetCentreId) return VMTL.toast('Click a centre header to target it first.', 'err'); assign(id, targetCentreId); });
      chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } });
    });
  }

  function wirePool() {
    view.querySelector('#poolSearch').oninput = (e) => { filter.q = e.target.value; drawPool(); };
    view.querySelector('#poolOrg').onchange = (e) => { filter.org_unit_id = e.target.value; drawPool(); };
    view.querySelector('#fHideAssigned').onchange = (e) => { filter.hideAssigned = e.target.checked; drawPool(); };
    view.querySelector('#fHideUnavail').onchange = (e) => { filter.hideUnavailable = e.target.checked; drawPool(); };
    drawPool();
  }
  function wireCentres() {
    view.querySelectorAll('[data-centre-head]').forEach((head) => head.onclick = () => { const id = Number(head.dataset.centreHead); targetCentreId = targetCentreId === id ? null : id; render(); });
    if (!canWrite) return;
    view.querySelectorAll('.tsb-centre').forEach((card) => {
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('drag-over'); const id = e.dataTransfer.getData('text/plain'); if (id) assign(Number(id), Number(card.dataset.centre)); });
    });
    view.querySelectorAll('[data-add]').forEach((btn) => btn.onclick = () => { targetCentreId = Number(btn.dataset.add); render(); VMTL.toast('Now click a driver in the pool.'); });
    view.querySelectorAll('[data-lead]').forEach((btn) => btn.onclick = () => toggleLead(Number(btn.dataset.lead)));
    view.querySelectorAll('[data-contact]').forEach((btn) => btn.onclick = () => put(btn.dataset.contact, { contacted: current(btn.dataset.contact).contacted ? 0 : 1 }));
    view.querySelectorAll('[data-travel]').forEach((btn) => btn.onclick = () => put(btn.dataset.travel, { traveled: current(btn.dataset.travel).traveled ? 0 : 1 }));
    view.querySelectorAll('[data-avail]').forEach((btn) => btn.onclick = () => cycleAvail(Number(btn.dataset.avail)));
    view.querySelectorAll('[data-remove]').forEach((btn) => btn.onclick = () => removeAssignment(Number(btn.dataset.remove)));
  }

  const current = (id) => board.assignments.find((a) => String(a.id) === String(id)) || {};
  const pending = new Set();
  async function assign(driverId, centreId) {
    if (pending.has(driverId)) return; pending.add(driverId);
    try { await VMTL.api('/ts/assignments', { method: 'POST', body: { event_id: Number(eventId), centre_id: centreId, driver_id: driverId } }); await reload(); }
    catch (e) { VMTL.showErrors(e); } finally { pending.delete(driverId); }
  }
  async function put(id, body) { try { await VMTL.api('/ts/assignments/' + id, { method: 'PUT', body }); await reload(); } catch (e) { VMTL.showErrors(e); } }
  async function toggleLead(id) {
    const a = current(id);
    try {
      if (a.role === 'team_lead') { await VMTL.api('/ts/assignments/' + id, { method: 'PUT', body: { role: null } }); }
      else { const lead = board.assignments.find((x) => x.centre_id === a.centre_id && x.role === 'team_lead'); if (lead) await VMTL.api('/ts/assignments/' + lead.id, { method: 'PUT', body: { role: null } }); await VMTL.api('/ts/assignments/' + id, { method: 'PUT', body: { role: 'team_lead' } }); }
      await reload();
    } catch (e) { VMTL.showErrors(e); }
  }
  async function cycleAvail(id) {
    const a = current(id);
    const next = a.availability_status === 'available' ? 'unavailable' : a.availability_status === 'unavailable' ? 'unconfirmed' : 'available';
    try { await VMTL.api('/ts/events/' + eventId + '/availability/' + a.driver_id, { method: 'PUT', body: { status: next } }); await reload(); } catch (e) { VMTL.showErrors(e); }
  }
  async function removeAssignment(id) {
    const a = current(id);
    if (!await VMTL.confirm(`Remove ${a.driver_name} from this event?`, { danger: true, confirmLabel: 'Remove' })) return;
    try { await VMTL.api('/ts/assignments/' + id, { method: 'DELETE' }); await reload(); } catch (e) { VMTL.showErrors(e); }
  }
  async function clearAll() {
    if (!board.assignments.length && !board.supervisors.length) return VMTL.toast('Nothing to clear.', 'err');
    if (!await VMTL.confirm('Clear all assignments and supervisors on this event?', { danger: true, confirmLabel: 'Clear all' })) return;
    try { await VMTL.api('/ts/events/' + eventId + '/roster', { method: 'DELETE' }); await reload(); } catch (e) { VMTL.showErrors(e); }
  }
  async function removeUnavailable() {
    const n = board.assignments.filter((a) => a.availability_status === 'unavailable').length;
    if (!n) return VMTL.toast('No unavailable drivers assigned.', 'err');
    if (!await VMTL.confirm(`Remove ${n} unavailable driver(s) from this event?`, { danger: true, confirmLabel: 'Remove' })) return;
    try { const r = await VMTL.api('/ts/events/' + eventId + '/unavailable-assignments', { method: 'DELETE' }); VMTL.toast(`${r.data.removed} removed.`); await reload(); } catch (e) { VMTL.showErrors(e); }
  }

  function manageSupervisors() {
    const avail = () => board.pool.filter((d) => !board.assignments.some((a) => a.driver_id === d.id) && !board.supervisors.some((s) => s.driver_id === d.id));
    const m = VMTL.openModal(`<div class="modal-head"><h3>Event supervisors</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><p class="dim">Supervisors oversee the whole event and are kept separate from centre assignments.</p><div class="row" style="gap:8px;align-items:flex-end"><div class="field" style="flex:1"><label>Add supervisor</label><select id="supSel"></select></div><button class="btn btn-primary" id="supAdd">+ Add</button></div><div id="supList" class="mt"></div></div><div class="modal-foot"><button class="btn" data-close>Done</button></div>`, { large: true });
    function drawSel() { m.el.querySelector('#supSel').innerHTML = avail().map((d) => `<option value="${d.id}">${esc(d.name)}${d.org_unit_name ? ' · ' + esc(d.org_unit_name) : ''}</option>`).join('') || '<option value="">No eligible drivers</option>'; }
    function drawList() { m.el.querySelector('#supList').innerHTML = board.supervisors.length ? board.supervisors.map((s) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span><strong>${esc(s.driver_name)}</strong>${s.org_unit_name ? ' · ' + esc(s.org_unit_name) : ''}</span><button class="btn btn-sm btn-danger" data-rms="${s.driver_id}">Remove</button></div>`).join('') : '<p class="dim">No supervisors yet.</p>'; m.el.querySelectorAll('[data-rms]').forEach((b) => b.onclick = async () => { try { await VMTL.api('/ts/events/' + eventId + '/supervisors/' + b.dataset.rms, { method: 'DELETE' }); board.supervisors = (await VMTL.api('/ts/events/' + eventId + '/supervisors')).data; drawSel(); drawList(); } catch (e) { VMTL.showErrors(e); } }); }
    m.el.querySelector('#supAdd').onclick = async () => { const sel = m.el.querySelector('#supSel'); if (!sel.value) return; try { await VMTL.api('/ts/events/' + eventId + '/supervisors', { method: 'POST', body: { driver_id: Number(sel.value) } }); board.supervisors = (await VMTL.api('/ts/events/' + eventId + '/supervisors')).data; drawSel(); drawList(); } catch (e) { VMTL.showErrors(e); } };
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) reload(); });
    drawSel(); drawList();
  }
  function roleNamesDialog() {
    const r = roleLabels();
    const m = VMTL.openModal(`<div class="modal-head"><h3>Role names</h3><button class="icon-btn" data-close>✕</button></div><form><div class="modal-body"><div class="form-grid"><div class="field"><label>Team-lead label</label><input name="lead" value="${esc(r.lead)}"></div><div class="field"><label>Driver label</label><input name="driver" value="${esc(r.driver)}"></div></div></div><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></form>`);
    m.el.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); try { await VMTL.api('/ts/events/' + eventId + '/role-labels', { method: 'PUT', body: { lead_role_label: b.lead || null, driver_role_label: b.driver || null } }); m.close(); await reload(); } catch (err) { VMTL.showErrors(err); } };
  }

  async function revisionHistory() {
    const versions = (await VMTL.api('/ts/events/' + eventId + '/versions')).data;
    const m = VMTL.openModal(`<div class="modal-head"><h3>Revision history</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><p class="dim">Restore the assignments and centre requirements from a saved revision. Current availability is kept and conflicts are re-checked; the published copy is unchanged.</p>${versions.length ? `<table class="data"><thead><tr><th>Rev</th><th>Reason</th><th>When</th><th></th></tr></thead><tbody>${versions.map((v) => `<tr><td>${v.revision}</td><td>${esc(v.reason)}</td><td>${VMTL.fmtDateTime(v.created_at)}</td><td class="right">${canWrite ? `<button class="btn btn-sm" data-restore="${v.id}">Restore</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="dim">No saved revisions yet.</p>'}</div><div class="modal-foot"><button class="btn" data-close>Close</button></div>`, { large: true });
    m.el.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
      if (!await VMTL.confirm('Restore this revision? Current assignments will be replaced.', { danger: true, confirmLabel: 'Restore' })) return;
      try { await VMTL.api('/ts/events/' + eventId + '/restore', { method: 'POST', body: { version_id: Number(b.dataset.restore) } }); m.close(); await reload(); VMTL.toast('Roster restored.'); } catch (e) { VMTL.showErrors(e); }
    });
  }

  async function manageRequests() {
    const assigned = board.assignments;
    const m = VMTL.openModal(`<div class="modal-head"><h3>Roster change requests</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body">
      <div class="card pad mb"><h4 style="margin-top:0">Raise a request</h4>
        <div class="form-grid">
          <div class="field"><label>Driver</label><select id="rqDriver">${assigned.map((a) => `<option value="${a.driver_id}">${esc(a.driver_name)}</option>`).join('') || '<option value="">No assigned drivers</option>'}</select></div>
          <div class="field"><label>Type</label><select id="rqKind"><option value="remove">Remove from event</option><option value="swap">Swap with another driver</option><option value="leave">Remove (driver on leave)</option></select></div>
          <div class="field" id="rqRepWrap" style="display:none"><label>Replacement</label><select id="rqRep">${board.pool.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
          <div class="field" style="grid-column:1/-1"><label>Reason</label><input id="rqReason" placeholder="Why is this change needed?"></div>
        </div>
        <button class="btn btn-primary mt" id="rqSubmit">Submit request</button>
      </div>
      <h4>Requests</h4><div id="rqList"><div class="loading"><span class="spinner"></span></div></div>
    </div><div class="modal-foot"><button class="btn" data-close>Done</button></div>`, { large: true });
    const kind = m.el.querySelector('#rqKind');
    kind.onchange = () => { m.el.querySelector('#rqRepWrap').style.display = kind.value === 'swap' ? '' : 'none'; };
    async function drawList() {
      const rows = (await VMTL.api('/ts/events/' + eventId + '/roster-requests')).data;
      m.el.querySelector('#rqList').innerHTML = rows.length ? `<table class="data"><thead><tr><th>Driver</th><th>Type</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.driver_name)}${r.replacement_name ? ' → ' + esc(r.replacement_name) : ''}</td><td>${esc(r.kind)}</td><td class="dim">${esc(r.reason)}</td><td>${VMTL.badge(r.status, r.status === 'pending' ? 'amber' : r.status === 'approved' ? 'green' : 'grey')}</td><td class="right">${r.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-ap="${r.id}">Approve</button> <button class="btn btn-sm btn-danger" data-rj="${r.id}">Reject</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="dim">No requests yet.</p>';
      m.el.querySelectorAll('[data-ap]').forEach((b) => b.onclick = () => decide(b.dataset.ap, 'approved'));
      m.el.querySelectorAll('[data-rj]').forEach((b) => b.onclick = () => decide(b.dataset.rj, 'rejected'));
    }
    async function decide(id, decision) { try { await VMTL.api('/ts/roster-requests/' + id + '/decision', { method: 'POST', body: { decision } }); await drawList(); if (decision === 'approved') board = (await VMTL.api('/ts/events/' + eventId + '/board')).data; } catch (e) { VMTL.showErrors(e); } }
    m.el.querySelector('#rqSubmit').onclick = async () => {
      const body = { driver_id: Number(m.el.querySelector('#rqDriver').value), kind: kind.value, reason: m.el.querySelector('#rqReason').value, replacement_id: kind.value === 'swap' ? Number(m.el.querySelector('#rqRep').value) : null };
      try { await VMTL.api('/ts/events/' + eventId + '/roster-requests', { method: 'POST', body }); m.el.querySelector('#rqReason').value = ''; await drawList(); VMTL.toast('Request submitted.'); } catch (e) { VMTL.showErrors(e); }
    };
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) reload(); });
    drawList();
  }

  function importSchedule() {
    const m = VMTL.openModal(`<div class="modal-head"><h3>Import schedule (CSV)</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body">
      <p class="dim">Upload or paste CSV with a <b>Name</b> column and a <b>Centre</b> column. Only drivers already in the pool and centres already on this event are assigned.</p>
      <div data-upload-host class="field"><label>Schedule CSV<input type="file" id="csvFile" accept=".csv,text/csv"></label>
        ${VMTL.uploadStatus()}<button type="button" class="btn btn-sm" id="csvRemove" hidden>Remove file</button></div>
      <textarea id="csvText" rows="8" placeholder="Name,Centre&#10;Yaw Owusu,Kumasi Centre" style="width:100%;box-sizing:border-box;font-family:monospace"></textarea>
      <div id="impResult" class="mt"></div>
    </div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="impGo">Import</button></div>`, { large: true });
    const ta = m.el.querySelector('#csvText');
    const input = m.el.querySelector('#csvFile');
    const host = input.closest('[data-upload-host]');
    const remove = m.el.querySelector('#csvRemove');
    const go = m.el.querySelector('#impGo');
    const result = m.el.querySelector('#impResult');
    let entry, draft = ta.value;
    function clearSelection() {
      input.value = '';
      entry = undefined;
      remove.hidden = true;
      VMTL.clearUpload(host);
      result.textContent = '';
    }
    remove.onclick = () => { ta.value = draft; clearSelection(); input.focus(); };
    input.onchange = () => {
      if (!input.files[0]) { ta.value = draft; return clearSelection(); }
      if (!entry) draft = ta.value;
      const file = input.files[0];
      remove.hidden = false;
      result.textContent = '';
      entry = VMTL.uploadEntry(host, file.name, async (checks, state) => {
        if (!/\.csv$/i.test(file.name)) checks.fail('FILE_EXTENSION', 'Choose a .csv file.');
        checks.size(file.size, checks.csvLimit);
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
        catch (_) { checks.fail('FILE_CONTENT', 'Choose a UTF-8 CSV file.'); }
        checks.parseScheduleCsv(text);
        if (state.current()) ta.value = text;
        return file;
      });
    };
    ta.oninput = () => { draft = ta.value; clearSelection(); };
    go.onclick = async () => {
      if (!entry && !ta.value.trim()) return VMTL.toast('Paste or choose a CSV first.', 'err');
      if (go.disabled || entry?.complete) return;
      if (!entry) {
        const pastedText = ta.value;
        entry = VMTL.uploadEntry(host, 'Pasted CSV', checks => {
          checks.parseScheduleCsv(pastedText);
          return new Blob([pastedText]);
        });
      }
      const selected = entry;
      go.disabled = true;
      try {
        const file = await selected.checked;
        if (!file || !selected.current()) return;
        const headers = { 'Content-Type': 'application/octet-stream' };
        if (file instanceof File) headers['X-File-Name'] = encodeURIComponent(file.name);
        const r = await selected.send('/ts/events/' + eventId + '/import-schedule', file, headers);
        if (!selected.current()) return;
        result.innerHTML = `<div class="card pad"><strong>${r.imported} assignment(s) imported.</strong>${r.skipped.length ? `<ul class="dim">${r.skipped.slice(0, 40).map(s => `<li>${esc(s.name)}: ${esc(s.reason)}</li>`).join('')}</ul>` : ''}</div>`;
        await reload();
      } catch (_) {
        // File errors are shown inline by the upload entry.
      } finally {
        go.disabled = false;
      }
    };
  }

  function dateRange(e) { if (!e.start_date) return 'Undated'; return e.end_date && e.end_date !== e.start_date ? `${VMTL.fmtDate(e.start_date)} – ${VMTL.fmtDate(e.end_date)}` : VMTL.fmtDate(e.start_date); }

  function injectStyles() {
    if (document.getElementById('tsb-styles')) return;
    const s = document.createElement('style'); s.id = 'tsb-styles';
    s.textContent = `
      .tsb-layout{display:grid;grid-template-columns:1fr 340px;gap:16px;align-items:start}
      @media(max-width:900px){.tsb-layout{grid-template-columns:1fr}.tsb-pool{position:static;max-height:none}.tsb-pool-list{max-height:none}}
      .tsb-canvas{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;align-content:start}
      .tsb-centre{background:var(--surface-1,var(--surface));border:1px solid var(--border);border-radius:12px;padding:10px;transition:border-color .15s}
      .tsb-centre.target{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-tint)}
      .tsb-centre.drag-over{border-color:var(--primary);background:var(--primary-tint)}
      .tsb-centre-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;cursor:pointer}
      .tsb-centre-name{font-weight:600}
      .tsb-count{font-weight:700;font-size:13px;padding:2px 8px;border-radius:999px}
      .tsb-count.under{background:var(--warning-tint);color:var(--warning)}
      .tsb-count.full{background:var(--primary-tint);color:var(--primary)}
      .tsb-count.over{background:var(--danger-tint);color:var(--danger)}
      .tsb-centre-body{margin-top:8px;display:flex;flex-direction:column;gap:6px}
      .tsb-assigned{display:flex;justify-content:space-between;gap:6px;align-items:center;background:var(--surface-2,var(--bg));border-radius:8px;padding:6px 8px}
      .tsb-assigned-name{font-weight:600;font-size:13.5px}
      .tsb-assigned-actions{display:flex;gap:2px;flex-wrap:wrap}
      .tsb-ic{border:none;background:transparent;cursor:pointer;width:24px;height:24px;border-radius:6px;font-size:13px;color:var(--text-2,#888);display:inline-flex;align-items:center;justify-content:center}
      .tsb-ic:hover{background:var(--surface-1,var(--surface))}
      .tsb-ic.on{color:var(--primary)}
      .tsb-ic.danger:hover{color:var(--danger)}
      .tsb-ic.av-available{color:var(--primary)}.tsb-ic.av-unavailable{color:var(--danger)}.tsb-ic.av-pending{color:var(--warning)}
      .tsb-add{width:100%;margin-top:8px}
      .tsb-pool{position:sticky;top:12px;border:1px solid var(--border);border-radius:12px;max-height:calc(100vh - 100px);display:flex;flex-direction:column;overflow:hidden}
      .tsb-pool-head{padding:10px;border-bottom:1px solid var(--border)}
      .tsb-search{width:100%;margin-top:6px}
      .tsb-pool-list{overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px}
      .tsb-chip{border:1px solid var(--border);border-radius:9px;padding:7px 9px;cursor:grab}
      .tsb-chip:hover{border-color:var(--primary)}
      .tsb-chip.busy{opacity:.55;cursor:default}
      .tsb-chip-name{font-weight:600;font-size:13.5px}
      .tsb-chip-tag{font-size:11.5px;color:var(--primary);margin-top:3px}`;
    document.head.appendChild(s);
  }

  await reload();
};
