'use strict';
// Reports: Vehicle Usage or Fuel Log, with filters, totals and CSV/XLSX/PDF export.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  let type = 'trips';
  view.innerHTML = VMTL.pageHead('Reports', 'Run and export vehicle-usage or fuel reports.') +
    `<div class="tabs" id="tabs"><button data-t="trips" class="active">Vehicle Usage</button><button data-t="fuel">Fuel Log</button></div>
     <div class="card pad mb"><div class="row wrap gap-sm"><label class="dim">From <input id="from" type="date"></label><label class="dim">To <input id="to" type="date"></label><button class="btn" id="go">Apply</button>
       <span style="flex:1"></span><button class="btn" data-fmt="csv">CSV</button><button class="btn" data-fmt="xlsx">Excel</button><button class="btn" data-fmt="pdf">PDF</button></div></div>
     <div class="card"><div id="totals" class="card-body" style="border-bottom:1px solid var(--border)"></div><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const qsParams = () => { const qs = new URLSearchParams(); qs.set('type', type); if (view.querySelector('#from').value) qs.set('date_from', view.querySelector('#from').value); if (view.querySelector('#to').value) qs.set('date_to', view.querySelector('#to').value); return qs; };
  const load = async () => {
    const list = view.querySelector('#list'); const totals = view.querySelector('#totals');
    try {
      const d = (await VMTL.api(`/reports?${qsParams()}`)).data;
      if (d.type === 'fuel') {
        totals.innerHTML = `<div class="row wrap" style="gap:18px"><b>Fills:</b> ${d.totals.fills} <b>Litres:</b> ${VMTL.fmtDecimal(d.totals.litres)} <b>Cost:</b> ${VMTL.fmtCedis(d.totals.cost)} <b>Distance:</b> ${VMTL.fmtNumber(d.totals.distance)} km <b>Economy:</b> ${d.totals.km_per_litre != null ? d.totals.km_per_litre + ' km/L' : '—'}</div>`;
        list.innerHTML = d.rows.length ? `<table class="data"><thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Odo</th><th>Litres</th><th>₵/L</th><th>Total</th><th>km/L</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${VMTL.esc(r.date)}</td><td>${VMTL.esc(r.vehicle)}</td><td>${VMTL.esc(r.driver)}</td><td>${VMTL.fmtNumber(r.odometer)}</td><td>${VMTL.fmtDecimal(r.litres)}</td><td>${VMTL.fmtCedis(r.price_per_litre)}</td><td>${VMTL.fmtCedis(r.total_cost)}</td><td>${r.km_per_litre}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No rows.</div>';
      } else {
        totals.innerHTML = `<div class="row wrap" style="gap:18px"><b>Total trips:</b> ${d.totals.trips} <b>Completed:</b> ${d.totals.completed} <b>Distance:</b> ${VMTL.fmtNumber(d.totals.distance)} km</div>`;
        list.innerHTML = d.rows.length ? `<table class="data"><thead><tr><th>Trip</th><th>Date</th><th>Vehicle</th><th>Driver</th><th>Requester</th><th>Dept</th><th>Destination</th><th>Distance</th><th>Status</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${VMTL.esc(r.trip_number)}</td><td>${VMTL.esc(r.date)}</td><td>${VMTL.esc(r.vehicle)}</td><td>${VMTL.esc(r.driver)}</td><td>${VMTL.esc(r.requester)}</td><td>${VMTL.esc(r.department || '—')}</td><td>${VMTL.esc(r.destination)}</td><td>${r.distance != null ? r.distance + ' km' : '—'}</td><td>${VMTL.esc(r.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No rows.</div>';
      }
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { view.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); type = b.dataset.t; load(); });
  view.querySelector('#go').onclick = load;
  view.querySelectorAll('[data-fmt]').forEach((b) => b.onclick = () => { const qs = qsParams(); qs.set('format', b.dataset.fmt); const a = document.createElement('a'); a.href = `/api/reports/export?${qs}`; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); });
  load();
};
