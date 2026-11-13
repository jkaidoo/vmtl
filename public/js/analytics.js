'use strict';
// Analytics dashboard with lightweight inline SVG charts (no external library).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Analytics', 'Fleet utilisation, distance, approvals and fuel.') +
    `<div class="card pad mb"><div class="row wrap gap-sm"><label class="dim">From <input id="from" type="date"></label><label class="dim">To <input id="to" type="date"></label><button class="btn" id="go">Apply</button></div></div><div id="body"><div class="loading"><span class="spinner"></span></div></div>`;
  const load = async () => {
    const body = view.querySelector('#body');
    const qs = new URLSearchParams(); if (view.querySelector('#from').value) qs.set('date_from', view.querySelector('#from').value); if (view.querySelector('#to').value) qs.set('date_to', view.querySelector('#to').value);
    try { render(body, (await VMTL.api(`/analytics?${qs}`)).data); } catch (e) { body.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#go').onclick = load;
  load();
};

function barChart(rows, labelKey, valueKey, color) {
  if (!rows || !rows.length) return '<div class="empty">No data.</div>';
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  return `<div class="stack" style="gap:7px">${rows.slice(0, 12).map((r) => { const w = Math.round((Number(r[valueKey]) || 0) / max * 100); return `<div><div class="between" style="font-size:12.5px"><span>${VMTL.esc(r[labelKey])}</span><span class="tnum">${VMTL.fmtNumber(r[valueKey])}</span></div><div style="height:8px;background:var(--surface-2);border-radius:999px;overflow:hidden"><div style="height:100%;width:${w}%;background:${color || 'var(--primary)'}"></div></div></div>`; }).join('')}</div>`;
}
function card(title, inner) { return `<div class="card pad"><h3>${title}</h3><div class="mt">${inner}</div></div>`; }

function render(body, d) {
  const s = d.summary; const kpi = (l, v) => `<div class="kpi"><div class="label">${l}</div><div class="value metric">${v}</div></div>`;
  const ap = d.approval_statistics;
  body.innerHTML = `
    <div class="grid cols-4 mb">${kpi('Total trips', s.total_trips)}${kpi('Completed', s.completed_trips)}${kpi('Total distance', VMTL.fmtNumber(s.total_distance) + ' km')}${kpi('Avg distance', VMTL.fmtDecimal(s.avg_distance, 1) + ' km')}</div>
    <div class="grid cols-2">
      ${card('Trips by vehicle', barChart(d.trips_by_vehicle, 'label', 'trips'))}
      ${card('Monthly utilisation', barChart(d.monthly_utilisation, 'period', 'trips', 'var(--info)'))}
      ${card('Trips by department', barChart(d.trips_by_department, 'label', 'trips', 'var(--violet)'))}
      ${card('Top destinations', barChart(d.trips_by_destination, 'label', 'trips', 'var(--warning)'))}
    </div>
    <div class="grid cols-2 mt">
      ${card('Approvals', `<div class="row wrap" style="gap:14px">${['submitted', 'approved', 'rejected', 'cancelled', 'pending'].map((k) => `<div><div class="dim" style="font-size:11.5px;text-transform:uppercase">${k}</div><div class="metric" style="font-size:22px">${ap[k]}</div></div>`).join('')}</div>`)}
      ${card('Trip duration', `<div class="row wrap" style="gap:14px"><div><div class="dim" style="font-size:11.5px">Average</div><div class="metric">${VMTL.fmtDuration(d.trip_duration.average_minutes)}</div></div><div><div class="dim" style="font-size:11.5px">Longest</div><div class="metric">${VMTL.fmtDuration(d.trip_duration.max_minutes)}</div></div></div>`)}
    </div>
    <h3 class="mt">Fuel spend &amp; economy</h3>
    <div class="grid cols-4 mb">${kpi('Total spend', VMTL.fmtCedis(d.fuel.summary.total_cost))}${kpi('Litres', VMTL.fmtDecimal(d.fuel.summary.total_litres))}${kpi('Economy', d.fuel.summary.km_per_litre != null ? d.fuel.summary.km_per_litre + ' km/L' : '—')}${kpi('Cost / km', d.fuel.summary.cost_per_km != null ? VMTL.fmtCedis(d.fuel.summary.cost_per_km) : '—')}</div>
    <div class="grid cols-2">${card('Fuel cost by vehicle', barChart(d.fuel.by_vehicle, 'label', 'cost', 'var(--danger)'))}${card('Monthly fuel spend', barChart(d.fuel.by_month, 'period', 'cost', 'var(--danger)'))}</div>
    <h3 class="mt">Maintenance spend</h3>
    <div class="grid cols-4 mb">${kpi('Maintenance cost', VMTL.fmtCedis(d.maintenance.summary.total_cost))}${kpi('Service records', d.maintenance.summary.records)}${kpi('Running cost', VMTL.fmtCedis((Number(d.fuel.summary.total_cost) || 0) + (Number(d.maintenance.summary.total_cost) || 0)))}${kpi('Fuel share', (function(){const f=Number(d.fuel.summary.total_cost)||0;const t=f+(Number(d.maintenance.summary.total_cost)||0);return t>0?Math.round(f/t*100)+'%':'—';})())}</div>
    <div class="grid cols-2">${card('Maintenance cost by vehicle', barChart(d.maintenance.by_vehicle, 'label', 'cost', 'var(--warning)'))}${card('Monthly maintenance spend', barChart(d.maintenance.by_month, 'period', 'cost', 'var(--warning)'))}</div>`;
}
