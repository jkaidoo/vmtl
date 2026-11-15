'use strict';
// Transport Schedule — reports. Pick an event to preview its roster by centre and
// export to PDF / Excel; plus a driver event-count (fairness) report.
window.VMTL_PAGE = async function () {
  const view = VMTL.view, esc = VMTL.esc;
  let events = [];
  let tab = 'roster';

  async function load() {
    events = (await VMTL.api('/ts/events')).data;
    render();
  }

  function render() {
    view.innerHTML = VMTL.pageHead('Schedule reports', 'Preview and export transport rosters and driver workload.') +
      `<div class="tabs"><button class="${tab === 'roster' ? 'active' : ''}" data-tab="roster">Event roster</button><button class="${tab === 'counts' ? 'active' : ''}" data-tab="counts">Driver workload</button></div>
       <div id="rbody"></div>`;
    view.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
    if (tab === 'roster') renderRoster(); else renderCounts();
  }

  function renderRoster() {
    const body = view.querySelector('#rbody');
    if (!events.length) { body.innerHTML = '<div class="card pad">No events yet.</div>'; return; }
    body.innerHTML = `<div class="card pad mb"><div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="min-width:260px;flex:1"><label>Event</label><select id="ev">${events.map((e) => `<option value="${e.id}">${esc(e.title)} · ${esc(e.type_name)}</option>`).join('')}</select></div>
        <a class="btn" id="pdf" target="_blank" rel="noopener">Export PDF</a>
        <a class="btn" id="xlsx">Export Excel</a>
      </div></div><div id="preview"><div class="loading"><span class="spinner"></span></div></div>`;
    const sel = body.querySelector('#ev');
    const setLinks = () => { body.querySelector('#pdf').href = `/api/ts/events/${sel.value}/report.pdf`; body.querySelector('#xlsx').href = `/api/ts/events/${sel.value}/report.xlsx`; };
    sel.onchange = () => { setLinks(); preview(sel.value); };
    setLinks(); preview(sel.value);
  }

  async function preview(eventId) {
    const host = view.querySelector('#preview'); if (!host) return;
    let d; try { d = (await VMTL.api('/ts/events/' + eventId + '/report')).data; } catch (e) { host.innerHTML = `<div class="card pad">${esc(e.message)}</div>`; return; }
    const s = d.summary;
    host.innerHTML = `<div class="card pad mb"><div class="row wrap" style="gap:18px">
        ${statTile('Centres', s.centres)}${statTile('Assigned', `${s.assigned}/${s.needed || '—'}`)}${statTile('Available', s.available)}${statTile('Unavailable', s.unavailable)}${statTile('Contacted', s.contacted)}${statTile('Supervisors', s.supervisors)}
      </div></div>` +
      d.centres.map((c) => `<div class="card pad mb"><div class="row" style="justify-content:space-between"><h3>${esc(c.centre_name)}${c.region ? ` <span class="dim">· ${esc(c.region)}</span>` : ''}</h3><span class="badge ${c.drivers.length >= c.drivers_needed ? 'green' : 'amber'}">${c.drivers.length}/${c.drivers_needed || '—'}</span></div>
        ${c.drivers.length ? `<table class="data mt"><thead><tr><th>Driver</th><th>Role</th><th>Phone</th><th>Org unit</th><th>Availability</th></tr></thead><tbody>${c.drivers.map((x) => `<tr><td>${esc(x.driver_name)}</td><td>${x.role === 'team_lead' ? `<span class="badge green">${esc(x.role_label)}</span>` : esc(x.role_label)}</td><td>${esc(x.phone || '—')}</td><td>${esc(x.org_unit_name || '—')}</td><td>${VMTL.badge(cap(x.availability_status || 'unconfirmed'), x.availability_status === 'available' ? 'green' : x.availability_status === 'unavailable' ? 'red' : 'grey')}</td></tr>`).join('')}</tbody></table>` : '<p class="dim">No drivers assigned.</p>'}
      </div>`).join('') +
      (d.supervisors.length ? `<div class="card pad mb"><h3>Event supervisors</h3><table class="data mt"><thead><tr><th>Name</th><th>Phone</th><th>Org unit</th></tr></thead><tbody>${d.supervisors.map((x) => `<tr><td>${esc(x.driver_name)}</td><td>${esc(x.phone || '—')}</td><td>${esc(x.org_unit_name || '—')}</td></tr>`).join('')}</tbody></table></div>` : '');
  }

  async function renderCounts() {
    const body = view.querySelector('#rbody');
    body.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    const rows = (await VMTL.api('/ts/reports/driver-counts')).data;
    body.innerHTML = `<div class="card pad"><p class="dim">Lifetime assignment counts per active driver — use this to spread work fairly.</p>
      <table class="data mt"><thead><tr><th>Driver</th><th>Org unit</th><th>Events</th><th>Team-lead</th><th>Travelled</th></tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${esc(r.name)}</strong>${r.phone ? ` · ${esc(r.phone)}` : ''}</td><td>${esc(r.org_unit_name || '—')}</td><td>${r.total_events}</td><td>${r.lead_count}</td><td>${r.travel_count}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const statTile = (label, value) => `<div><div class="dim" style="font-size:12px;text-transform:uppercase;letter-spacing:.03em">${label}</div><div style="font-size:22px;font-weight:700">${value}</div></div>`;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  await load();
};
