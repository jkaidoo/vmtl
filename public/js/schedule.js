'use strict';
// Scheduling calendar — a real calendar for vehicle bookings. Desktop shows a
// week time-grid (hours down, days across) with events placed by time and
// overlapping bookings laid out side by side; mobile shows a day-by-day agenda.
// Styled with the KNUST design tokens; trip status sets the colour.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const esc = VMTL.esc;
  const DAY_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STATUS = {
    scheduled: { c: 'var(--info)', t: 'var(--info-tint)', label: 'Scheduled' },
    in_progress: { c: 'var(--primary)', t: 'var(--primary-tint)', label: 'In progress' },
    completed: { c: 'var(--text-2)', t: 'var(--surface-2)', label: 'Completed' },
    cancelled: { c: 'var(--danger)', t: 'var(--danger-tint)', label: 'Cancelled' },
    no_show: { c: 'var(--warning)', t: 'var(--warning-tint)', label: 'No-show' },
  };
  const st = (s) => STATUS[s] || STATUS.scheduled;
  const startOfWeek = (d) => { d = new Date(d); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const parse = (s) => new Date(String(s).replace(' ', 'T'));
  const HOUR_H = 46; // px per hour (desktop grid)
  let weekStart = startOfWeek(new Date());
  let events = [];
  let mode = 'month';
  let focusMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const mq = window.matchMedia('(max-width: 820px)');

  view.innerHTML = VMTL.pageHead('Calendar', 'Vehicle bookings across the week.') +
    `<div class="cal-top">
       <div class="row gap-sm" style="align-items:center">
         <button class="icon-btn cal-nav" id="prev" aria-label="Previous week">‹</button>
         <button class="icon-btn cal-nav" id="next" aria-label="Next week">›</button>
         <button class="btn btn-sm" id="today">Today</button>
         <select id="calendarMode" aria-label="Calendar view"><option value="month">Month</option><option value="week">Week</option><option value="agenda">Agenda</option></select><input type="month" id="jumpMonth" aria-label="Jump to month"><strong id="range" style="font-size:16px;margin-left:4px"></strong>
       </div>
       <div class="cal-legend">${Object.keys(STATUS).map((k) => `<span><i style="background:${STATUS[k].c}"></i>${STATUS[k].label}</span>`).join('')}</div>
     </div>
     <div id="calBody"><div class="loading"><span class="spinner"></span></div></div>`;

  async function load() {
    if (mode === 'month') weekStart = startOfWeek(focusMonth);
    const from = iso(weekStart);
    const endD = new Date(weekStart); endD.setDate(endD.getDate() + (mode === 'month' ? 41 : 6));
    view.querySelector('#jumpMonth').value = iso(focusMonth).slice(0,7);
    view.querySelector('#range').textContent = weekStart.getMonth() === endD.getMonth()
      ? `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}–${endD.getDate()}, ${endD.getFullYear()}`
      : `${MONTHS[weekStart.getMonth()].slice(0, 3)} ${weekStart.getDate()} – ${MONTHS[endD.getMonth()].slice(0, 3)} ${endD.getDate()}, ${endD.getFullYear()}`;
    if (mode === 'month') view.querySelector('#range').textContent = `${MONTHS[focusMonth.getMonth()]} ${focusMonth.getFullYear()}`;
    let d;
    try { d = (await VMTL.api(`/schedule?from=${from}&to=${iso(endD)}`)).data; }
    catch (e) { view.querySelector('#calBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    events = [];
    for (const v of d.vehicles) for (const t of v.trips) {
      const s = parse(t.scheduled_start); const e = parse(t.scheduled_end);
      if (isNaN(s)) continue;
      events.push({ ...t, vehicle_number: v.vehicle_number, start: s, end: isNaN(e) || e <= s ? new Date(s.getTime() + 60 * 60000) : e });
    }
    draw();
  }
  function draw() { if (mode === 'month') renderMonth(); else if (mode === 'agenda' || mq.matches) renderAgenda(); else renderWeek(); }

  function renderMonth() {
    const days = Array.from({ length: 42 }, (_, i) => { const day = new Date(weekStart); day.setDate(day.getDate() + i); return day; });
    const today = new Date();
    view.querySelector('#calBody').innerHTML = `<div class="month-calendar">${DAY_FULL.map(day => `<div class="month-weekday">${day}</div>`).join('')}${days.map(day => {
      const items = events.filter(event => iso(event.start) <= iso(day) && iso(event.end) >= iso(day));
      return `<button class="month-day ${day.getMonth() !== focusMonth.getMonth() ? 'outside' : ''} ${sameDay(day,today) ? 'today' : ''}" data-day="${iso(day)}" aria-label="${esc(day.toDateString())}, ${items.length} trips"><span class="month-number">${day.getDate()}</span>${items.slice(0,3).map(event => `<span class="month-event" style="--event-color:${st(event.status).c}">${esc(event.vehicle_number)} · ${esc(event.destination || event.trip_number)}</span>`).join('')}${items.length > 3 ? `<span class="dim">+${items.length - 3} more</span>` : ''}</button>`;
    }).join('')}</div>`;
    view.querySelectorAll('[data-day]').forEach(button => button.onclick = () => {
      const items = events.filter(event => iso(event.start) <= button.dataset.day && iso(event.end) >= button.dataset.day);
      if (items.length === 1) { location.href = `/trips.html?id=${items[0].id}`; return; }
      const modal = VMTL.openModal(`<h3>${esc(new Date(button.dataset.day + 'T00:00:00').toDateString())}</h3><p class="sub">${items.length} scheduled trips</p><div class="stack">${items.length ? items.map(event => `<a class="card pad fleet-link" href="/trips.html?id=${event.id}"><strong>${esc(event.trip_number)} · ${esc(event.vehicle_number)}</strong><div>${esc(event.destination || '')}</div><div class="dim">${VMTL.fmtDateTime(event.scheduled_start)} – ${VMTL.fmtDateTime(event.scheduled_end)}</div>${VMTL.badge(st(event.status).label, event.status === 'in_progress' ? 'green' : 'blue')}</a>`).join('') : '<p class="dim">No trips on this day.</p>'}</div><div class="modal-foot"><button class="btn" data-close>Close</button></div>`, { large: true });
    });
  }

  // ---- Desktop: week time-grid --------------------------------------------
  function dayEvents(dayDate) {
    const end = new Date(dayDate); end.setDate(end.getDate() + 1);
    return events.filter(e => e.start < end && e.end > dayDate).map((e) => {
      const startMin = sameDay(e.start, dayDate) ? e.start.getHours() * 60 + e.start.getMinutes() : 0;
      let endMin = sameDay(e.end, dayDate) ? e.end.getHours() * 60 + e.end.getMinutes() : 24 * 60;
      if (endMin <= startMin) endMin = startMin + 45;
      return { ...e, startMin, endMin };
    }).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  }
  // Lay overlapping events into side-by-side lanes (per overlap cluster).
  function pack(evs) {
    let i = 0;
    while (i < evs.length) {
      let j = i; let clusterEnd = evs[i].endMin;
      while (j + 1 < evs.length && evs[j + 1].startMin < clusterEnd) { j += 1; clusterEnd = Math.max(clusterEnd, evs[j].endMin); }
      const cluster = evs.slice(i, j + 1); const laneEnds = [];
      for (const e of cluster) { let k = 0; for (; k < laneEnds.length; k++) if (e.startMin >= laneEnds[k]) break; laneEnds[k] = e.endMin; e.lane = k; }
      const n = laneEnds.length; for (const e of cluster) e.lanes = n;
      i = j + 1;
    }
    return evs;
  }
  function renderWeek() {
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
    const all = days.flatMap((d) => dayEvents(d));
    let minH = 8; let maxH = 18;
    if (all.length) { minH = Math.min(minH, Math.floor(Math.min(...all.map((e) => e.startMin)) / 60)); maxH = Math.max(maxH, Math.ceil(Math.max(...all.map((e) => e.endMin)) / 60)); }
    minH = Math.max(0, minH); maxH = Math.min(24, Math.max(maxH, minH + 6));
    const hours = []; for (let h = minH; h <= maxH; h++) hours.push(h);
    const spanMin = (maxH - minH) * 60; const bodyH = (maxH - minH) * HOUR_H;
    const today = new Date();

    const gutter = `<div class="cal-gutter"><div class="cal-corner"></div>${hours.map((h) => `<div class="cal-hour" style="height:${HOUR_H}px"><span>${String(h).padStart(2, '0')}:00</span></div>`).join('')}</div>`;
    const cols = days.map((d) => {
      const evs = pack(dayEvents(d));
      const blocks = evs.map((e) => {
        const top = ((e.startMin - minH * 60) / spanMin) * bodyH;
        const h = Math.max(20, ((e.endMin - e.startMin) / spanMin) * bodyH - 2);
        const w = 100 / e.lanes; const left = e.lane * w;
        return `<a href="/trips.html?id=${e.id}" class="cal-ev" title="${esc(e.trip_number)} · ${esc(e.destination || '')}${e.driver_name ? ` · ${esc(e.driver_name)}` : ''}" style="top:${top}px;height:${h}px;left:calc(${left}% + 2px);width:calc(${w}% - 4px)">
          <div class="cal-ev-t">${esc(e.destination || e.trip_number)}</div><div class="cal-ev-s">${VMTL.fmtTime(e.scheduled_start)} · ${esc(e.vehicle_number || '')}</div></a>`;
      }).join('');
      const isToday = sameDay(d, today);
      return `<div class="cal-col">
        <div class="cal-dayhead${isToday ? ' is-today' : ''}"><span class="cal-dow">${DAY_FULL[(d.getDay() + 6) % 7]}</span><span class="cal-dnum">${d.getDate()}</span></div>
        <div class="cal-track" style="height:${bodyH}px;background-size:100% ${HOUR_H}px">${blocks}</div>
      </div>`;
    }).join('');

    view.querySelector('#calBody').innerHTML = `<div class="cal-wrap"><div class="cal-aside">${miniMonth()}</div>
      <div class="cal-grid-wrap"><div class="cal-grid" style="--rows:${hours.length}">${gutter}${cols}</div></div></div>`;
    wireMini();
  }

  // ---- Mobile: day agenda --------------------------------------------------
  function renderAgenda() {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
    const rows = days.map((d) => {
      const evs = events.filter((e) => sameDay(e.start, d)).sort((a, b) => a.start - b.start);
      const isToday = sameDay(d, today);
      return `<div class="agd-day">
        <div class="agd-date${isToday ? ' is-today' : ''}"><span class="agd-num">${String(d.getDate()).padStart(2, '0')}</span><span class="agd-dow">${DAY_FULL[(d.getDay() + 6) % 7].toUpperCase()}</span></div>
        <div class="agd-events">${evs.length ? evs.map((e) => { return `<a href="/trips.html?id=${e.id}" class="agd-ev"><div class="agd-ev-main"><div class="agd-ev-t">${esc(e.destination || e.trip_number)}</div><div class="agd-ev-sub">${esc(e.vehicle_number || '')}${e.driver_name ? ` · ${esc(e.driver_name)}` : ''}</div></div><div class="agd-ev-time">${VMTL.fmtTime(e.scheduled_start)}<br><span>${VMTL.fmtTime(e.scheduled_end)}</span></div></a>`; }).join('') : '<div class="agd-empty">No trips</div>'}</div>
      </div>`;
    }).join('');
    view.querySelector('#calBody').innerHTML = `<div class="agd">${rows}</div>`;
  }

  // ---- Mini month (desktop aside) -----------------------------------------
  function miniMonth() {
    const ref = new Date(weekStart); const y = ref.getFullYear(); const m = ref.getMonth();
    const first = startOfWeek(new Date(y, m, 1));
    const cells = []; const today = new Date();
    for (let i = 0; i < 42; i++) { const d = new Date(first); d.setDate(d.getDate() + i); cells.push(d); if (i >= 34 && d.getMonth() !== m && d > ref) break; }
    const inWeek = (d) => { const diff = Math.floor((d - weekStart) / 86400000); return diff >= 0 && diff < 7; };
    const grid = cells.map((d) => {
      const cls = [d.getMonth() === m ? '' : 'mini-out', sameDay(d, today) ? 'mini-today' : '', inWeek(d) ? 'mini-week' : ''].filter(Boolean).join(' ');
      return `<button class="mini-day ${cls}" data-d="${iso(d)}">${d.getDate()}</button>`;
    }).join('');
    return `<div class="mini"><div class="mini-head">${MONTHS[m]} ${y}</div><div class="mini-dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="mini-grid">${grid}</div></div>
      <div class="mini-legend">${Object.keys(STATUS).map((k) => `<div><i style="background:${STATUS[k].c}"></i>${STATUS[k].label}</div>`).join('')}</div>`;
  }
  function wireMini() { view.querySelectorAll('.mini-day').forEach((b) => b.onclick = () => { weekStart = startOfWeek(new Date(b.dataset.d + 'T00:00:00')); load(); }); }

  view.querySelector('#prev').onclick = () => { if (mode === 'month') focusMonth = new Date(focusMonth.getFullYear(), focusMonth.getMonth() - 1, 1); else weekStart.setDate(weekStart.getDate() - 7); load(); };
  view.querySelector('#next').onclick = () => { if (mode === 'month') focusMonth = new Date(focusMonth.getFullYear(), focusMonth.getMonth() + 1, 1); else weekStart.setDate(weekStart.getDate() + 7); load(); };
  view.querySelector('#today').onclick = () => { focusMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); weekStart = startOfWeek(new Date()); load(); };
  view.querySelector('#calendarMode').onchange = e => { mode = e.target.value; weekStart = startOfWeek(mode === 'month' ? focusMonth : new Date()); load(); };
  view.querySelector('#jumpMonth').onchange = e => { if (!e.target.value) return; focusMonth = new Date(e.target.value + '-01T00:00:00'); weekStart = startOfWeek(focusMonth); load(); };
  const onMq = () => draw();
  mq.addEventListener('change', onMq); VMTL.onLeave(() => mq.removeEventListener('change', onMq));
  await load();
};
