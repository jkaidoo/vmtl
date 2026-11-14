'use strict';
// Analytics dashboard — interactive SVG charts (VMTL.charts), quick ranges,
// tabbed sections and click-to-drill. No external chart library.
window.VMTL_PAGE = async function () {
  const view = VMTL.view, esc = VMTL.esc, C = VMTL.charts;
  const RANGES = [['30d', '30 days'], ['90d', '90 days'], ['mtd', 'This month'], ['ytd', 'This year'], ['all', 'All time']];
  const TABS = [['overview', 'Overview'], ['fleet', 'Fleet'], ['fuel', 'Fuel'], ['maintenance', 'Maintenance']];
  const state = { tab: 'overview', range: 'all', data: null, filters: {}, drill: null };

  view.innerHTML = VMTL.pageHead('Analytics', 'Explore fleet utilisation, approvals, fuel and maintenance. Hover any chart for detail and click to drill in.') +
    `<div class="card pad mb an-controls">
       <div class="an-ranges seg" id="ranges">${RANGES.map(([k, l]) => `<button type="button" data-range="${k}" class="${k === state.range ? 'active' : ''}">${l}</button>`).join('')}</div>
       <div class="an-dates"><label class="dim">From <input id="from" type="date"></label><label class="dim">To <input id="to" type="date"></label><button class="btn btn-sm" id="go">Apply</button></div>
     </div>
     <div id="drillNote"></div>
     <div class="tabs" id="anTabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === state.tab ? 'active' : ''}">${l}</button>`).join('')}</div>
     <div id="body"><div class="loading"><span class="spinner"></span></div></div>`;

  const $ = (sel) => view.querySelector(sel);
  const body = $('#body');

  // ---- date-range presets -------------------------------------------------
  const iso = (d) => d.toISOString().slice(0, 10);
  function presetDates(key) {
    const now = new Date();
    if (key === '30d') { const f = new Date(now); f.setDate(f.getDate() - 29); return { from: iso(f), to: iso(now) }; }
    if (key === '90d') { const f = new Date(now); f.setDate(f.getDate() - 89); return { from: iso(f), to: iso(now) }; }
    if (key === 'mtd') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    if (key === 'ytd') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    return { from: '', to: '' };
  }

  // ---- data load ----------------------------------------------------------
  async function load() {
    body.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    const qs = new URLSearchParams();
    if ($('#from').value) qs.set('date_from', $('#from').value);
    if ($('#to').value) qs.set('date_to', $('#to').value);
    Object.entries(state.filters).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, v); });
    try {
      state.data = (await VMTL.api(`/analytics?${qs}`)).data;
      renderTab();
    } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---- tab rendering ------------------------------------------------------
  const card = (title, inner, hint) => `<div class="card pad"><div class="ch-card-head"><h3>${title}</h3>${hint ? `<span class="ch-hint">${hint}</span>` : ''}</div><div class="mt">${inner}</div></div>`;
  const kpi = (l, v, sub) => `<div class="kpi"><div class="label">${l}</div><div class="value metric">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  function renderTab() {
    C.reset();
    const d = state.data;
    const html = state.tab === 'overview' ? overviewTab(d)
      : state.tab === 'fleet' ? fleetTab(d)
      : state.tab === 'fuel' ? fuelTab(d)
      : maintenanceTab(d);
    body.innerHTML = html;
    C.bind(body);
    renderDrillNote();
  }

  function overviewTab(d) {
    const s = d.summary;
    const trend = (d.monthly_utilisation || []).map((m) => m.trips);
    const ap = d.approval_statistics || {};
    const approvals = [
      { label: 'Approved', value: ap.approved, color: 'var(--primary)' },
      { label: 'Pending', value: ap.pending, color: 'var(--warning)' },
      { label: 'Rejected', value: ap.rejected, color: 'var(--danger)' },
      { label: 'Cancelled', value: ap.cancelled, color: 'var(--text-3)' },
    ];
    const hours = (d.peak_usage && d.peak_usage.most_active_hours) || [];
    const days = (d.peak_usage && d.peak_usage.most_active_days) || [];
    return `
      <div class="grid cols-4 mb">
        ${kpi('Total trips', VMTL.fmtNumber(s.total_trips), trend.length > 1 ? C.sparkline(trend) : '')}
        ${kpi('Completed', VMTL.fmtNumber(s.completed_trips), pct(s.completed_trips, s.total_trips) + ' of all trips')}
        ${kpi('Total distance', VMTL.fmtNumber(s.total_distance) + ' km')}
        ${kpi('Avg distance', VMTL.fmtDecimal(s.avg_distance, 1) + ' km', 'per completed trip')}
      </div>
      <div class="grid cols-2">
        ${card('Monthly utilisation', C.areaLine(d.monthly_utilisation, { valueKey: 'trips', kind: 'number', category: 'month', label: 'Trips per month' }), 'trips / month')}
        ${card('Approvals', C.donut(approvals, { kind: 'number', centerLabel: 'Requests', category: 'approval' }), 'click a slice')}
        ${card('Trips by department', C.hbars(d.trips_by_department, { valueKey: 'trips', kind: 'number', color: 'var(--violet)', category: 'department', clickable: false }))}
        ${card('Top destinations', C.hbars(d.trips_by_destination, { valueKey: 'trips', kind: 'number', color: 'var(--warning)', category: 'destination' }), 'click to filter')}
      </div>
      <div class="grid cols-2 mt">
        ${card('Busiest hours', C.heatStrip(hours, { valueKey: 'trips', kind: 'number', tick: (l) => l.slice(0, 2) }), 'completed trips by start hour')}
        ${card('Busiest days', C.hbars(days, { valueKey: 'trips', kind: 'number', color: 'var(--info)', sort: false, clickable: false }))}
      </div>`;
  }

  function fleetTab(d) {
    const td = d.trip_duration || {};
    return `
      <div class="grid cols-2">
        ${card('Trips by vehicle', C.hbars(d.trips_by_vehicle, { valueKey: 'trips', kind: 'number', category: 'vehicle', label: 'id' }), 'click to filter')}
        ${card('Trips by driver', C.hbars(d.trips_by_driver, { valueKey: 'trips', kind: 'number', color: 'var(--info)', category: 'driver' }), 'click to filter')}
        ${card('Distance by vehicle', C.hbars((d.distance && d.distance.by_vehicle) || [], { valueKey: 'distance', kind: 'number', color: 'var(--success)', category: 'vehicle' }), 'km')}
        ${card('Trip duration', `<div class="row wrap" style="gap:22px">
          <div><div class="dim" style="font-size:11.5px">Average</div><div class="metric" style="font-size:22px">${VMTL.fmtDuration(td.average_minutes)}</div></div>
          <div><div class="dim" style="font-size:11.5px">Longest</div><div class="metric" style="font-size:22px">${VMTL.fmtDuration(td.max_minutes)}</div></div>
          <div><div class="dim" style="font-size:11.5px">Shortest</div><div class="metric" style="font-size:22px">${VMTL.fmtDuration(td.min_minutes)}</div></div>
        </div>`)}
      </div>`;
  }

  function fuelTab(d) {
    const f = d.fuel, fs = f.summary;
    return `
      <div class="grid cols-4 mb">
        ${kpi('Total spend', VMTL.fmtCedis(fs.total_cost), VMTL.fmtNumber(fs.fills) + ' fills')}
        ${kpi('Litres', VMTL.fmtDecimal(fs.total_litres, 1) + ' L', fs.avg_price_per_litre != null ? VMTL.fmtCedis(fs.avg_price_per_litre) + '/L avg' : '')}
        ${kpi('Economy', fs.km_per_litre != null ? fs.km_per_litre + ' km/L' : '—')}
        ${kpi('Cost / km', fs.cost_per_km != null ? VMTL.fmtCedis(fs.cost_per_km) : '—')}
      </div>
      <div class="grid cols-2">
        ${card('Monthly fuel spend', C.areaLine(f.by_month, { valueKey: 'cost', kind: 'currency', color: 'var(--danger)', category: 'month', label: 'Fuel spend per month' }), '₵ / month')}
        ${card('Fuel cost by vehicle', C.hbars(f.by_vehicle, { valueKey: 'cost', kind: 'currency', color: 'var(--danger)', category: 'vehicle' }), 'click to filter')}
        ${card('Economy by vehicle', C.hbars((f.by_vehicle || []).filter((v) => v.km_per_litre != null), { valueKey: 'km_per_litre', kind: 'decimal', color: 'var(--success)', category: 'vehicle' }), 'km/L')}
        ${card('Litres by vehicle', C.hbars(f.by_vehicle, { valueKey: 'litres', kind: 'decimal', color: 'var(--info)', category: 'vehicle' }), 'litres')}
      </div>`;
  }

  function maintenanceTab(d) {
    const m = d.maintenance, ms = m.summary;
    const fuelCost = Number(d.fuel.summary.total_cost) || 0;
    const maintCost = Number(ms.total_cost) || 0;
    const split = [
      { label: 'Fuel', value: fuelCost, color: 'var(--danger)' },
      { label: 'Maintenance', value: maintCost, color: 'var(--warning)' },
    ];
    return `
      <div class="grid cols-4 mb">
        ${kpi('Maintenance cost', VMTL.fmtCedis(ms.total_cost), VMTL.fmtNumber(ms.records) + ' records')}
        ${kpi('Running cost', VMTL.fmtCedis(fuelCost + maintCost), 'fuel + maintenance')}
        ${kpi('Fuel share', pct(fuelCost, fuelCost + maintCost))}
        ${kpi('Service records', VMTL.fmtNumber(ms.records))}
      </div>
      <div class="grid cols-2">
        ${card('Monthly maintenance spend', C.areaLine(m.by_month, { valueKey: 'cost', kind: 'currency', color: 'var(--warning)', category: 'month', label: 'Maintenance spend per month' }), '₵ / month')}
        ${card('Cost by vehicle', C.hbars(m.by_vehicle, { valueKey: 'cost', kind: 'currency', color: 'var(--warning)', category: 'vehicle' }), 'click to filter')}
        ${card('Running cost split', C.donut(split, { kind: 'currency', centerLabel: 'Total' }), 'fuel vs maintenance')}
        ${card('Service count by vehicle', C.hbars(m.by_vehicle, { valueKey: 'count', kind: 'number', color: 'var(--violet)', category: 'vehicle' }), 'records')}
      </div>`;
  }

  function pct(n, total) { n = Number(n) || 0; total = Number(total) || 0; return total > 0 ? Math.round((n / total) * 100) + '%' : '—'; }

  // ---- drill-down ---------------------------------------------------------
  const DRILLABLE = { vehicle: 'vehicle_id', driver: 'driver_id', destination: 'destination', month: 'month' };
  function openDrill(detail) {
    const it = detail.item, raw = it.raw || {};
    const labels = { trips: 'Trips', distance: 'Distance (km)', cost: 'Cost (GHS)', litres: 'Litres', count: 'Service records', km_per_litre: 'Economy (km/L)', value: detail.category === 'approval' ? 'Requests' : 'Value' };
    const rows = Object.entries(raw).filter(([k]) => labels[k]).map(([k, v]) => `<tr><td>${labels[k]}</td><td class="tnum">${v == null ? '—' : (k === 'cost' ? VMTL.fmtCedis(v) : VMTL.fmtNumber(v))}</td></tr>`).join('')
      || `<tr><td>${esc(labels.value)}</td><td class="tnum">${C.fmtVal(it.value, detail.kind)}</td></tr>`;
    const canDrill = DRILLABLE[detail.category];
    const m = VMTL.openModal(`<div class="modal-head"><h3>${esc(it.label)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body"><p class="dim" style="font-size:12.5px;margin-top:0">${esc(cap(detail.category))} breakdown for the selected range.</p>
        <table class="data"><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="modal-foot"><button class="btn" data-close>Close</button>${canDrill ? '<button class="btn btn-primary" id="drillGo">Filter dashboard</button>' : ''}</div>`);
    const go = m.el.querySelector('#drillGo');
    if (go) go.onclick = () => { applyDrill(detail); m.close(); };
  }
  function applyDrill(detail) {
    const it = detail.item, raw = it.raw || {};
    state.filters = {};
    if (detail.category === 'vehicle' && raw.id != null) state.filters.vehicle_id = raw.id;
    if (detail.category === 'driver' && raw.id != null) state.filters.driver_id = raw.id;
    if (detail.category === 'destination') state.filters.destination = it.label;
    if (detail.category === 'month') {
      const p = raw.period || it.label;
      const from = p + '-01';
      const last = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0).getDate();
      $('#from').value = from; $('#to').value = `${p}-${last}`;
    }
    state.drill = { label: it.label, category: detail.category };
    load();
  }
  function clearDrill() { state.filters = {}; state.drill = null; renderDrillNote(); load(); }
  function renderDrillNote() {
    const host = $('#drillNote');
    if (!state.drill) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="alert-accent mb an-chip"><span>Filtered to <strong>${esc(state.drill.label)}</strong> · ${esc(cap(state.drill.category))}</span><button class="btn btn-sm" id="clearDrill" style="margin-left:auto">Clear filter</button></div>`;
    host.querySelector('#clearDrill').onclick = clearDrill;
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ---- events -------------------------------------------------------------
  $('#ranges').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]'); if (!b) return;
    state.range = b.dataset.range;
    $('#ranges').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    const dt = presetDates(state.range); $('#from').value = dt.from; $('#to').value = dt.to;
    load();
  });
  $('#anTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === state.tab) return;
    state.tab = b.dataset.tab;
    $('#anTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (state.data) renderTab(); else load();
  });
  $('#go').onclick = () => {
    state.range = '';
    $('#ranges').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    load();
  };
  body.addEventListener('chartselect', (e) => openDrill(e.detail));

  load();
};
