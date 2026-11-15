'use strict';
// Booking calendar: a month grid showing how busy the fleet is each day (number
// of scheduled / in-progress trips against the scoped fleet size), so a
// requester can pick a quiet day before raising a request.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  let cursor = new Date(); cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
  const canRequest = VMTL.can('requests.create');

  view.innerHTML = VMTL.pageHead('Booking calendar', 'Fleet busyness by day. Pick a quiet day, then raise a request.') +
    `<div class="card pad mb"><div class="toolbar"><button class="btn btn-sm" id="prev">‹</button><strong id="label"></strong><button class="btn btn-sm" id="next">›</button><button class="btn btn-sm" id="today">Today</button><span class="dim" id="fleet" style="margin-left:auto"></span></div></div>
     <div class="card pad"><div class="cal-grid" id="dow" style="margin-bottom:6px"></div><div id="grid"><div class="loading"><span class="spinner"></span></div></div></div>
     <div class="dim mt" style="font-size:12px">Busyness = trips using the fleet that day ÷ fleet size. Click a day to see its trips${canRequest ? ', or to raise a request' : ''}.</div>`;

  view.querySelector('#dow').innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dim" style="text-align:center;font-size:12px;font-weight:600">${d}</div>`).join('');

  const monthStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const load = async () => {
    view.querySelector('#label').textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const grid = view.querySelector('#grid');
    let data;
    try { data = (await VMTL.api(`/booking/calendar?month=${monthStr(cursor)}`)).data; }
    catch (e) { grid.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
    view.querySelector('#fleet').textContent = `Fleet: ${data.fleet_size} vehicle${data.fleet_size === 1 ? '' : 's'}`;

    // Bucket trips per day (a trip spans its scheduled days).
    const perDay = new Map();
    for (const t of data.trips) {
      const s = String(t.start).slice(0, 10), e = String(t.end).slice(0, 10);
      for (let d = new Date(s + 'T00:00:00'); iso(d) <= e; d.setDate(d.getDate() + 1)) {
        const k = iso(d); if (!perDay.has(k)) perDay.set(k, []); perDay.get(k).push(t);
        if (perDay.get(k).length > 200) break;
      }
    }

    const first = new Date(cursor); const lead = (first.getDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    const todayIso = iso(new Date());

    grid.innerHTML = `<div class="cal-grid">${cells.map((c) => {
      if (!c) return '<div class="cal-cell other"></div>';
      const k = iso(c); const trips = perDay.get(k) || [];
      const ratio = data.fleet_size ? trips.length / data.fleet_size : 0;
      const level = trips.length === 0 ? '' : ratio >= 0.75 ? 'red' : ratio >= 0.4 ? 'amber' : 'green';
      const badge = trips.length ? `<span class="cal-dot badge ${level}">${trips.length} trip${trips.length === 1 ? '' : 's'}</span>` : '<span class="dim" style="font-size:11px">free</span>';
      return `<div class="cal-cell" data-day="${k}" style="cursor:pointer${k === todayIso ? ';outline:2px solid var(--primary)' : ''}"><div class="d">${c.getDate()}</div>${badge}</div>`;
    }).join('')}</div>`;
    grid.querySelectorAll('[data-day]').forEach((el) => { el.onclick = () => openDay(el.dataset.day, perDay.get(el.dataset.day) || []); });
  };

  function openDay(day, trips) {
    const label = new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const m = VMTL.openModal(`<div class="modal-head"><h3>${VMTL.esc(label)}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body">${trips.length ? `<table class="data"><thead><tr><th>Trip</th><th>Vehicle</th><th>Destination</th><th>Window</th></tr></thead><tbody>${trips.map((t) => `<tr><td>${VMTL.esc(t.trip_number)}</td><td>${VMTL.esc(t.vehicle_number || '—')}</td><td>${VMTL.esc(t.destination || '—')}</td><td>${t.start.slice(11, 16)}–${t.end.slice(11, 16)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No trips scheduled — the fleet is free this day.</div>'}</div>
      <div class="modal-foot"><button class="btn" data-close>Close</button>${canRequest ? `<a class="btn btn-primary" href="/request-create.html?date=${day}">Request a vehicle</a>` : ''}</div>`, { large: true });
    return m;
  }

  view.querySelector('#prev').onclick = () => { cursor.setMonth(cursor.getMonth() - 1); load(); };
  view.querySelector('#next').onclick = () => { cursor.setMonth(cursor.getMonth() + 1); load(); };
  view.querySelector('#today').onclick = () => { cursor = new Date(); cursor.setDate(1); cursor.setHours(0, 0, 0, 0); load(); };
  load();
};
