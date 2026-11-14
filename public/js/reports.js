'use strict';
// Reports: Vehicle Usage or Fuel Log, with filters, an interactive chart summary,
// totals and CSV/XLSX/PDF export. Charts are built client-side from the result
// rows; clicking a chart filters the table below it.
window.VMTL_PAGE = async function () {
  const view = VMTL.view, esc = VMTL.esc, C = VMTL.charts;
  let type = 'trips';
  const cache = { rows: [], type: 'trips' };
  let rowFilter = null; // { key, value, label }

  view.innerHTML = VMTL.pageHead('Reports', 'Run, visualise and export vehicle-usage or fuel reports. Click a chart to filter the table.') +
    `<div class="tabs" id="tabs"><button data-t="trips" class="active">Vehicle Usage</button><button data-t="fuel">Fuel Log</button></div>
     <div class="card pad mb"><div class="row wrap gap-sm"><label class="dim">From <input id="from" type="date"></label><label class="dim">To <input id="to" type="date"></label><button class="btn" id="go">Apply</button>
       <span style="flex:1"></span><button class="btn" data-fmt="csv">CSV</button><button class="btn" data-fmt="xlsx">Excel</button><button class="btn" data-fmt="pdf">PDF</button></div></div>
     <div id="summary"></div>
     <div id="filterChip"></div>
     <div class="card"><div id="totals" class="card-body" style="border-bottom:1px solid var(--border)"></div><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;

  const $ = (s) => view.querySelector(s);
  const STATUS_COLOR = (s) => {
    s = String(s || '').toLowerCase();
    if (s.includes('complet')) return 'var(--success)';
    if (s.includes('progress') || s.includes('schedul') || s.includes('approv')) return 'var(--info)';
    if (s.includes('pend')) return 'var(--warning)';
    if (s.includes('reject')) return 'var(--danger)';
    if (s.includes('cancel')) return 'var(--text-3)';
    return 'var(--violet)';
  };
  const groupCount = (rows, keyFn) => { const m = new Map(); rows.forEach((r) => { const k = keyFn(r); if (k == null || k === '') return; m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].map(([label, value]) => ({ label, value })); };
  const groupSum = (rows, keyFn, valFn) => { const m = new Map(); rows.forEach((r) => { const k = keyFn(r); if (k == null || k === '') return; m.set(k, (m.get(k) || 0) + (Number(valFn(r)) || 0)); }); return [...m.entries()].map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })); };

  const qsParams = () => { const qs = new URLSearchParams(); qs.set('type', type); if ($('#from').value) qs.set('date_from', $('#from').value); if ($('#to').value) qs.set('date_to', $('#to').value); return qs; };

  const load = async () => {
    $('#list').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    $('#summary').innerHTML = ''; $('#filterChip').innerHTML = '';
    try {
      const d = (await VMTL.api(`/reports?${qsParams()}`)).data;
      cache.rows = d.rows || []; cache.type = d.type; rowFilter = null;
      renderTotals(d);
      renderSummary(d);
      renderList();
    } catch (e) { $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; $('#totals').innerHTML = ''; }
  };

  function renderTotals(d) {
    if (d.type === 'fuel') {
      $('#totals').innerHTML = `<div class="row wrap" style="gap:18px"><b>Fills:</b> ${d.totals.fills} <b>Litres:</b> ${VMTL.fmtDecimal(d.totals.litres)} <b>Cost:</b> ${VMTL.fmtCedis(d.totals.cost)} <b>Distance:</b> ${VMTL.fmtNumber(d.totals.distance)} km <b>Economy:</b> ${d.totals.km_per_litre != null ? d.totals.km_per_litre + ' km/L' : '—'}</div>`;
    } else {
      $('#totals').innerHTML = `<div class="row wrap" style="gap:18px"><b>Total trips:</b> ${d.totals.trips} <b>Completed:</b> ${d.totals.completed} <b>Distance:</b> ${VMTL.fmtNumber(d.totals.distance)} km</div>`;
    }
  }

  function renderSummary(d) {
    if (!C || !cache.rows.length) { $('#summary').innerHTML = ''; return; }
    C.reset();
    const card = (title, inner, hint) => `<div class="card pad"><div class="ch-card-head"><h3>${title}</h3>${hint ? `<span class="ch-hint">${hint}</span>` : ''}</div><div class="mt">${inner}</div></div>`;
    let html = '';
    if (d.type === 'fuel') {
      const byVeh = groupSum(cache.rows, (r) => r.vehicle, (r) => r.total_cost);
      const byMonth = groupSum(cache.rows, (r) => String(r.date || '').slice(0, 7), (r) => r.total_cost).sort((a, b) => a.label.localeCompare(b.label));
      html = `<div class="grid cols-2 mb">
        ${card('Monthly fuel spend', C.areaLine(byMonth, { kind: 'currency', color: 'var(--danger)' }), '₵ / month')}
        ${card('Fuel cost by vehicle', C.hbars(byVeh, { kind: 'currency', color: 'var(--danger)', category: 'vehicle' }), 'click to filter')}
      </div>`;
    } else {
      const byVeh = groupCount(cache.rows, (r) => r.vehicle);
      const byDest = groupCount(cache.rows, (r) => r.destination);
      const byStatus = groupCount(cache.rows, (r) => r.status).map((s) => ({ ...s, color: STATUS_COLOR(s.label) }));
      html = `<div class="grid cols-3 mb">
        ${card('Trips by status', C.donut(byStatus, { kind: 'number', centerLabel: 'Trips', category: 'status' }), 'click a slice')}
        ${card('Top vehicles', C.hbars(byVeh, { kind: 'number', category: 'vehicle', limit: 8 }), 'click to filter')}
        ${card('Top destinations', C.hbars(byDest, { kind: 'number', color: 'var(--warning)', category: 'destination', limit: 8 }), 'click to filter')}
      </div>`;
    }
    $('#summary').innerHTML = html;
    C.bind($('#summary'));
  }

  function renderList() {
    const list = $('#list');
    let rows = cache.rows;
    if (rowFilter) rows = rows.filter((r) => String(r[rowFilter.key] ?? '') === String(rowFilter.value));
    renderChip();
    if (!rows.length) { list.innerHTML = '<div class="empty">No rows.</div>'; return; }
    if (cache.type === 'fuel') {
      list.innerHTML = `<table class="data"><thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Odo</th><th>Litres</th><th>₵/L</th><th>Total</th><th>km/L</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.vehicle)}</td><td>${esc(r.driver)}</td><td>${VMTL.fmtNumber(r.odometer)}</td><td>${VMTL.fmtDecimal(r.litres)}</td><td>${VMTL.fmtCedis(r.price_per_litre)}</td><td>${VMTL.fmtCedis(r.total_cost)}</td><td>${r.km_per_litre}</td></tr>`).join('')}</tbody></table>`;
    } else {
      list.innerHTML = `<table class="data"><thead><tr><th>Trip</th><th>Date</th><th>Vehicle</th><th>Driver</th><th>Requester</th><th>Dept</th><th>Destination</th><th>Distance</th><th>Status</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.trip_number)}</td><td>${esc(r.date)}</td><td>${esc(r.vehicle)}</td><td>${esc(r.driver)}</td><td>${esc(r.requester)}</td><td>${esc(r.department || '—')}</td><td>${esc(r.destination)}</td><td>${r.distance != null ? r.distance + ' km' : '—'}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody></table>`;
    }
  }

  function renderChip() {
    const host = $('#filterChip');
    if (!rowFilter) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="alert-accent mb an-chip"><span>Showing <strong>${esc(rowFilter.label)}</strong> rows only</span><button class="btn btn-sm" id="clearRf" style="margin-left:auto">Clear filter</button></div>`;
    host.querySelector('#clearRf').onclick = () => { rowFilter = null; renderList(); };
  }

  $('#summary').addEventListener('chartselect', (e) => {
    const { category, item } = e.detail;
    const key = category === 'vehicle' ? 'vehicle' : category === 'destination' ? 'destination' : category === 'status' ? 'status' : null;
    if (!key) return;
    rowFilter = { key, value: item.label, label: `${cap(category)}: ${item.label}` };
    renderList();
    $('#list').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  view.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { view.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); type = b.dataset.t; load(); });
  $('#go').onclick = load;
  view.querySelectorAll('[data-fmt]').forEach((b) => b.onclick = () => { const qs = qsParams(); qs.set('format', b.dataset.fmt); const a = document.createElement('a'); a.href = `/api/reports/export?${qs}`; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); });
  load();
};
