'use strict';
// Dashboard: KPI tiles, today's schedule, vehicle board, maintenance alerts, and
// a role-appropriate feed (pending approvals / my requests / my trips).
window.VMTL_PAGE = async function () {
  if (VMTL.requesterOnly()) return renderClientDashboard();
  const view = VMTL.view;
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  let data;
  try { data = (await VMTL.api('/dashboard')).data; }
  catch (e) { view.innerHTML = `<div class="empty">${VMTL.esc(e.message || 'Could not load the dashboard.')}</div>`; return; }

  const c = data.cards;
  const kpi = (label, value, sub, href) => `<a href="${href}" class="kpi"><div class="label">${label}</div><div class="value metric">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</a>`;
  const statusBadge = (s, label, color) => VMTL.badge(label || s, color || 'grey');

  const alerts = data.maintenance_alerts || { total: 0 };
  const alertRow = (title, items, fmt, color) => (items && items.length) ? `<div class="alert-accent ${color}" style="margin-bottom:8px"><strong>${title}</strong><div class="dim" style="font-size:12.5px">${items.slice(0, 4).map(fmt).join(' · ')}${items.length > 4 ? ` +${items.length - 4} more` : ''}</div></div>` : '';

  const scheduleRows = (data.todays_schedule || []).map((t) => `<tr class="click" data-href="/trips.html?id=${t.id}"><td data-label="Trip">${VMTL.esc(t.trip_number)}</td><td data-label="Vehicle">${VMTL.esc(t.vehicle ? t.vehicle.vehicle_number : '—')}</td><td data-label="Driver">${VMTL.esc(t.driver ? t.driver.name : '—')}</td><td data-label="When">${VMTL.fmtTime(t.scheduled_start)}–${VMTL.fmtTime(t.scheduled_end)}</td><td data-label="Status">${statusBadge(t.status, t.status_label, t.status_color)}</td></tr>`).join('');

  const feed = () => {
    if (data.my_trips) return card('My trips', tripList(data.my_trips));
    if (data.pending_approvals) return card('Pending approvals', requestList(data.pending_approvals));
    if (data.my_recent_requests) return card('My recent requests', requestList(data.my_recent_requests));
    return '';
  };
  function tripList(trips) { return trips.length ? `<table class="data"><tbody>${trips.map((t) => `<tr class="click" data-href="/trips.html?id=${t.id}"><td>${VMTL.esc(t.trip_number)}</td><td>${VMTL.esc(t.vehicle ? t.vehicle.vehicle_number : '')}</td><td>${VMTL.fmtDateTime(t.scheduled_start)}</td><td>${statusBadge(t.status, t.status_label, t.status_color)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet.</div>'; }
  function requestList(reqs) { return reqs.length ? `<table class="data"><tbody>${reqs.map((r) => `<tr class="click" data-href="/requests.html?id=${r.id}"><td>${VMTL.esc(r.request_number)}</td><td>${VMTL.esc(r.destination)}</td><td>${VMTL.esc(r.requester ? r.requester.name : '')}</td><td>${statusBadge(r.status, r.status_label, r.status_color)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet.</div>'; }
  function card(title, body) { return `<div class="card mt"><div class="card-head"><h3>${title}</h3></div><div class="card-body" style="padding:0">${body}</div></div>`; }

  const board = (data.vehicle_board || []).map((v) => `<a href="/vehicles.html?id=${v.id}" class="card pad fleet-link"><div class="between"><strong>${VMTL.esc(v.vehicle_number)}</strong>${statusBadge(v.status, v.status_label, v.status_color)}</div><div class="dim" style="font-size:12.5px;margin-top:4px">${VMTL.esc([v.make, v.model].filter(Boolean).join(' '))} · ${VMTL.fmtNumber(v.current_odometer)} km</div>${v.active_trip ? `<div class="pill mt">On: ${VMTL.esc(v.active_trip.trip_number)}</div>` : ''}</a>`).join('');

  view.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><div class="sub">Welcome back, ${VMTL.esc(VMTL.user.name)}.</div></div><div class="btn-row"><a class="btn" href="/schedule.html">Calendar</a>${VMTL.can('vehicles.manage') || VMTL.can('analytics.view') ? '<a class="btn btn-primary" href="/tracking.html">Live fleet map</a>' : ''}<button class="btn" id="refreshDashboard">Refresh</button></div></div>
    <div class="grid cols-4 mb">
      ${kpi('Pending requests', c.pending_requests, 'View requests →', '/requests.html?status=pending')}
      ${kpi("Today's trips", c.todays_trips, 'View trips →', '/trips.html?date_from=' + new Date().toISOString().slice(0,10) + '&date_to=' + new Date().toISOString().slice(0,10))}
      ${kpi('Vehicles available', c.vehicles_available, 'View fleet →', '/vehicles.html?status=available')}
      ${kpi('Distance this month', VMTL.fmtNumber(c.total_distance_month) + ' km', 'View analytics →', VMTL.can('analytics.view') ? '/analytics.html' : '/trips.html')}
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Today's schedule</h3></div><div class="card-body" style="padding:0">${scheduleRows ? `<table class="data"><thead><tr><th>Trip</th><th>Vehicle</th><th>Driver</th><th>When</th><th>Status</th></tr></thead><tbody>${scheduleRows}</tbody></table>` : '<div class="empty">No trips scheduled today.</div>'}</div></div>
      <div class="card pad"><div class="card-head" style="padding:0 0 12px"><h3>Maintenance alerts</h3><span class="pill">${alerts.total || 0}</span></div>${alerts.total ? `${alertRow('Insurance expiring', alerts.insurance_expiring, (x) => `${VMTL.esc(x.vehicle_number)} (${x.days_left}d)`, 'amber')}${alertRow('Roadworthy expiring', alerts.roadworthy_expiring, (x) => `${VMTL.esc(x.vehicle_number)} (${x.days_left}d)`, 'amber')}${alertRow('Service due', alerts.service_due, (x) => `${VMTL.esc(x.vehicle_number)}`, 'red')}${alertRow('Licence expiring', alerts.licence_expiring, (x) => `${VMTL.esc(x.name)} (${x.days_left}d)`, 'amber')}` : '<div class="empty">All clear — no alerts.</div>'}</div>
    </div>
    ${feed()}
    ${board ? `<h3 class="mt">Fleet board</h3><div class="grid cols-4">${board}</div>` : ''}
  `;

  view.querySelector('#refreshDashboard').onclick = () => window.VMTL_PAGE();
  view.querySelectorAll('tr.click[data-href]').forEach((tr) => { tr.onclick = () => { location.href = tr.getAttribute('data-href'); }; });
};

async function renderClientDashboard() {
  const view = VMTL.view;
  const esc = VMTL.esc;
  const awaiting = !VMTL.user.role || !VMTL.user.org_unit;
  const actions = !awaiting && VMTL.can('requests.create') ? '<a class="btn btn-primary" href="/request-create.html">New ride request</a>' : '';
  view.innerHTML = VMTL.pageHead('My dashboard', 'Your ride requests and travel history.', actions) +
    (awaiting ? '<div class="alert-accent amber mb"><h3>Welcome to UITS VMTL</h3><p>Kindly contact your IT Manager to assign you to the appropriate group.</p></div>' : '') +
    '<div class="card pad mb"><h3>Your rides</h3><p class="dim">Open a request to see its status and assigned ride.</p><a href="/how-it-works.html">How to request and wait for a ride</a></div><div class="card"><div id="clientRides"></div></div><div class="audit-bar"><span class="dim" id="rideCount"></span><div class="right"><button class="btn btn-sm" id="ridePrev">Previous</button><button class="btn btn-sm" id="rideNext">Next</button></div></div>';
  let page = 1;
  const load = async () => {
    const host = view.querySelector('#clientRides');
    host.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
      const r = await VMTL.api(`/vehicle-requests?page=${page}&per_page=10`);
      host.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Request</th><th>Destination</th><th>Travel date</th><th>Status</th></tr></thead><tbody>${r.data.map(x => `<tr><td><a href="/requests.html?id=${encodeURIComponent(x.id)}">${esc(x.request_number)}</a></td><td>${esc(x.destination)}</td><td>${VMTL.fmtDate(x.travel_date)}</td><td>${VMTL.statusBadge(x)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">You have not requested any rides yet.</div>';
      view.querySelector('#rideCount').textContent = `${r.meta.total} requests · Page ${page} of ${r.meta.last_page}`;
      view.querySelector('#ridePrev').disabled = page <= 1;
      view.querySelector('#rideNext').disabled = page >= r.meta.last_page;
    } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  view.querySelector('#ridePrev').onclick = () => { page -= 1; load(); };
  view.querySelector('#rideNext').onclick = () => { page += 1; load(); };
  await load();
}
