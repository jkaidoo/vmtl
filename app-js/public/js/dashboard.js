'use strict';
// Dashboard: KPI tiles, today's schedule, vehicle board, maintenance alerts, and
// a role-appropriate feed (pending approvals / my requests / my trips).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  let data;
  try { data = (await VMTL.api('/dashboard')).data; }
  catch (e) { view.innerHTML = `<div class="empty">${VMTL.esc(e.message || 'Could not load the dashboard.')}</div>`; return; }

  const c = data.cards;
  const kpi = (label, value, sub) => `<div class="kpi"><div class="label">${label}</div><div class="value metric">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const statusBadge = (s, label, color) => VMTL.badge(label || s, color || 'grey');

  const alerts = data.maintenance_alerts || { total: 0 };
  const alertRow = (title, items, fmt, color) => (items && items.length) ? `<div class="alert-accent ${color}" style="margin-bottom:8px"><strong>${title}</strong><div class="dim" style="font-size:12.5px">${items.slice(0, 4).map(fmt).join(' · ')}${items.length > 4 ? ` +${items.length - 4} more` : ''}</div></div>` : '';

  const scheduleRows = (data.todays_schedule || []).map((t) => `<tr><td data-label="Trip">${VMTL.esc(t.trip_number)}</td><td data-label="Vehicle">${VMTL.esc(t.vehicle ? t.vehicle.vehicle_number : '—')}</td><td data-label="Driver">${VMTL.esc(t.driver ? t.driver.name : '—')}</td><td data-label="When">${VMTL.fmtTime(t.scheduled_start)}–${VMTL.fmtTime(t.scheduled_end)}</td><td data-label="Status">${statusBadge(t.status, t.status_label, t.status_color)}</td></tr>`).join('');

  const feed = () => {
    if (data.my_trips) return card('My trips', tripList(data.my_trips));
    if (data.pending_approvals) return card('Pending approvals', requestList(data.pending_approvals));
    if (data.my_recent_requests) return card('My recent requests', requestList(data.my_recent_requests));
    return '';
  };
  function tripList(trips) { return trips.length ? `<table class="data"><tbody>${trips.map((t) => `<tr class="click" data-href="/trips.html?id=${t.id}"><td>${VMTL.esc(t.trip_number)}</td><td>${VMTL.esc(t.vehicle ? t.vehicle.vehicle_number : '')}</td><td>${VMTL.fmtDateTime(t.scheduled_start)}</td><td>${statusBadge(t.status, t.status_label, t.status_color)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet.</div>'; }
  function requestList(reqs) { return reqs.length ? `<table class="data"><tbody>${reqs.map((r) => `<tr class="click" data-href="/requests.html?id=${r.id}"><td>${VMTL.esc(r.request_number)}</td><td>${VMTL.esc(r.destination)}</td><td>${VMTL.esc(r.requester ? r.requester.name : '')}</td><td>${statusBadge(r.status, r.status_label, r.status_color)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet.</div>'; }
  function card(title, body) { return `<div class="card mt"><div class="card-head"><h3>${title}</h3></div><div class="card-body" style="padding:0">${body}</div></div>`; }

  const board = (data.vehicle_board || []).map((v) => `<div class="card pad"><div class="between"><strong>${VMTL.esc(v.vehicle_number)}</strong>${statusBadge(v.status, v.status_label, v.status_color)}</div><div class="dim" style="font-size:12.5px;margin-top:4px">${VMTL.esc([v.make, v.model].filter(Boolean).join(' '))} · ${VMTL.fmtNumber(v.current_odometer)} km</div>${v.active_trip ? `<div class="pill mt">On: ${VMTL.esc(v.active_trip.trip_number)}</div>` : ''}</div>`).join('');

  view.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><div class="sub">Welcome back, ${VMTL.esc(VMTL.user.name)}.</div></div></div>
    <div class="grid cols-4 mb">
      ${kpi('Pending requests', c.pending_requests)}
      ${kpi("Today's trips", c.todays_trips)}
      ${kpi('Vehicles available', c.vehicles_available)}
      ${kpi('Distance this month', VMTL.fmtNumber(c.total_distance_month) + ' km')}
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Today's schedule</h3></div><div class="card-body" style="padding:0">${scheduleRows ? `<table class="data"><thead><tr><th>Trip</th><th>Vehicle</th><th>Driver</th><th>When</th><th>Status</th></tr></thead><tbody>${scheduleRows}</tbody></table>` : '<div class="empty">No trips scheduled today.</div>'}</div></div>
      <div class="card pad"><div class="card-head" style="padding:0 0 12px"><h3>Maintenance alerts</h3><span class="pill">${alerts.total || 0}</span></div>${alerts.total ? `${alertRow('Insurance expiring', alerts.insurance_expiring, (x) => `${VMTL.esc(x.vehicle_number)} (${x.days_left}d)`, 'amber')}${alertRow('Roadworthy expiring', alerts.roadworthy_expiring, (x) => `${VMTL.esc(x.vehicle_number)} (${x.days_left}d)`, 'amber')}${alertRow('Service due', alerts.service_due, (x) => `${VMTL.esc(x.vehicle_number)}`, 'red')}${alertRow('Licence expiring', alerts.licence_expiring, (x) => `${VMTL.esc(x.name)} (${x.days_left}d)`, 'amber')}` : '<div class="empty">All clear — no alerts.</div>'}</div>
    </div>
    ${feed()}
    ${board ? `<h3 class="mt">Fleet board</h3><div class="grid cols-4">${board}</div>` : ''}
  `;

  view.querySelectorAll('tr.click[data-href]').forEach((tr) => { tr.onclick = () => { location.href = tr.getAttribute('data-href'); }; });
};
