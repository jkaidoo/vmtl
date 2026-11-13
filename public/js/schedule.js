'use strict';
// Scheduling calendar — a weekly gantt of vehicle bookings so conflicts are
// visible before assignment. Rows are vehicles (OU-scoped); each trip is a block
// positioned across the week; overlapping bookings on the same vehicle are flagged.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const esc = VMTL.esc;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const STATUS = { scheduled: 'var(--info)', in_progress: 'var(--primary)', completed: 'var(--text-2)', cancelled: 'var(--danger)', no_show: 'var(--warning)' };
  const startOfWeek = (d) => { d = new Date(d); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let weekStart = startOfWeek(new Date());

  view.innerHTML = VMTL.pageHead('Schedule', 'Weekly vehicle bookings — spot conflicts before they happen.') +
    `<div class="card pad mb"><div class="between" style="flex-wrap:wrap;gap:8px">
       <div class="row gap-sm"><button class="btn btn-sm" id="prev">← Prev</button><button class="btn btn-sm" id="today">This week</button><button class="btn btn-sm" id="next">Next →</button></div>
       <strong id="range"></strong>
       <div class="dim" style="font-size:11.5px">${['scheduled', 'in_progress', 'completed', 'no_show', 'cancelled'].map((s) => `<span style="color:${STATUS[s]}">■</span> ${s.replace('_', ' ')}`).join('  ')}</div>
     </div></div>
     <div id="grid"><div class="loading"><span class="spinner"></span></div></div>`;

  const dayIndex = (dateStr, from) => Math.round((Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86400000);

  async function load() {
    const from = iso(weekStart);
    const endD = new Date(weekStart); endD.setDate(endD.getDate() + 6); const to = iso(endD);
    view.querySelector('#range').textContent = `${VMTL.fmtDate(from)} – ${VMTL.fmtDate(to)}`;
    let d;
    try { d = (await VMTL.api(`/schedule?from=${from}&to=${to}`)).data; } catch (e) { view.querySelector('#grid').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    render(d, from);
  }

  function render(d, from) {
    const head = `<div class="pad" style="background:var(--surface);font-weight:600;font-size:12px">Vehicle</div>` +
      DAYS.map((dn, i) => { const dd = new Date(weekStart); dd.setDate(dd.getDate() + i); return `<div class="pad" style="background:var(--surface);font-weight:600;font-size:12px;text-align:center">${dn}<div class="dim" style="font-weight:400">${dd.getDate()}</div></div>`; }).join('');

    const rows = d.vehicles.length ? d.vehicles.map((v) => {
      const conflict = new Set();
      for (let i = 0; i < v.trips.length; i++) for (let j = i + 1; j < v.trips.length; j++) {
        const a = v.trips[i]; const b = v.trips[j];
        if (a.scheduled_start < b.scheduled_end && b.scheduled_start < a.scheduled_end) { conflict.add(a.id); conflict.add(b.id); }
      }
      const blocks = v.trips.map((t, k) => {
        const s = Math.max(0, dayIndex(t.scheduled_start, from));
        let e = Math.min(6, dayIndex(t.scheduled_end, from)); if (e < s) e = s;
        const left = (s / 7) * 100; const width = ((e - s + 1) / 7) * 100;
        const bad = conflict.has(t.id);
        return `<div title="${esc(t.trip_number)} · ${esc(t.destination || '')}${t.driver_name ? ` · ${esc(t.driver_name)}` : ''} · ${esc(t.status)}" style="position:absolute;left:${left}%;width:calc(${width}% - 4px);top:${4 + (k % 2) * 22}px;height:20px;margin:0 2px;border-radius:4px;background:${STATUS[t.status] || 'var(--info)'};color:#fff;font-size:10px;line-height:20px;padding:0 6px;overflow:hidden;white-space:nowrap;${bad ? 'outline:2px solid var(--danger);outline-offset:-1px;' : ''}">${esc(t.destination || t.trip_number)}</div>`;
      }).join('');
      const rowH = Math.max(28, 8 + Math.min(Math.max(v.trips.length, 1), 2) * 22);
      return `<div class="pad" style="background:var(--surface);font-size:12.5px"><strong>${esc(v.vehicle_number)}</strong>${conflict.size ? ' <span class="badge red" style="font-size:9px">clash</span>' : ''}<div class="dim" style="font-size:11px">${esc([v.make, v.model].filter(Boolean).join(' '))}</div></div><div style="grid-column:span 7;background:var(--surface);position:relative;min-height:${rowH}px">${blocks}</div>`;
    }).join('') : `<div style="grid-column:1/-1;background:var(--surface);text-align:center;padding:24px" class="dim">No vehicles in scope for this week.</div>`;

    view.querySelector('#grid').innerHTML = `<div style="display:grid;grid-template-columns:150px repeat(7,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;min-width:720px">${head}${rows}</div>`;
  }

  view.querySelector('#prev').onclick = () => { weekStart = new Date(weekStart.setDate(weekStart.getDate() - 7)); load(); };
  view.querySelector('#next').onclick = () => { weekStart = new Date(weekStart.setDate(weekStart.getDate() + 7)); load(); };
  view.querySelector('#today').onclick = () => { weekStart = startOfWeek(new Date()); load(); };
  await load();
};
