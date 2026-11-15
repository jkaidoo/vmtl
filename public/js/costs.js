'use strict';
// Fleet costs & department chargeback. Running costs (fuel, maintenance, work
// orders, incidents) attributed to the owning org unit and divided by completed
// distance for cost-per-km. No budgets — actuals only.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const C = VMTL.charts;
  const today = new Date().toISOString().slice(0, 10);
  view.innerHTML = VMTL.pageHead('Costs', 'Running fleet costs and per-department chargeback.') +
    `<div class="card pad mb"><div class="toolbar">
       <label>From <input type="date" id="from" class="input"></label>
       <label>To <input type="date" id="to" class="input" value="${today}"></label>
       <button class="btn btn-sm" id="apply">Apply</button>
       <button class="btn btn-sm" id="clear">All time</button>
     </div></div>
     <div id="kpis" class="grid cols-4 mb"></div>
     <div class="grid cols-2">
       <div class="card pad"><div class="ch-card-head"><h3>By category</h3></div><div id="cat" class="mt"></div></div>
       <div class="card pad"><div class="ch-card-head"><h3>Monthly cost</h3></div><div id="trend" class="mt"></div></div>
     </div>
     <div class="card mt"><h3 class="pad-h">Department chargeback</h3><div id="dept"></div></div>
     <div class="card pad mt"><div class="ch-card-head"><h3>Top vehicles by cost</h3></div><div id="veh" class="mt"></div></div>`;

  const kpi = (label, value, sub) => `<div class="kpi"><div class="label">${label}</div><div class="value metric">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  const load = async () => {
    const qs = new URLSearchParams();
    const from = view.querySelector('#from').value; const to = view.querySelector('#to').value;
    if (from) qs.set('date_from', from); if (to) qs.set('date_to', to);
    let data;
    try { data = (await VMTL.api(`/costs${qs.toString() ? `?${qs}` : ''}`)).data; }
    catch (e) { view.querySelector('#kpis').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }

    view.querySelector('#kpis').innerHTML =
      kpi('Total cost', VMTL.fmtCedis(data.total)) +
      kpi('Cost per km', data.cost_per_km != null ? VMTL.fmtCedis(data.cost_per_km) : '—') +
      kpi('Distance', VMTL.fmtNumber(data.total_distance) + ' km') +
      kpi('Departments', data.by_department.length);

    const PAL = C.PALETTE || ['#1f5fd0', '#009540', '#d99400', '#c0392b', '#7b4fd0'];
    const segs = data.by_category.filter((c) => c.cost > 0).map((c, i) => ({ label: c.label, value: c.cost, color: PAL[i % PAL.length] }));
    view.querySelector('#cat').innerHTML = segs.length ? C.donut(segs, { kind: 'currency', centerLabel: 'Total' }) : '<div class="empty">No costs in range.</div>';
    view.querySelector('#trend').innerHTML = data.monthly.length ? C.areaLine(data.monthly, { valueKey: 'cost', kind: 'currency', color: 'var(--primary)' }) : '<div class="empty">No costs in range.</div>';
    view.querySelector('#veh').innerHTML = data.by_vehicle.length ? C.hbars(data.by_vehicle.map((v) => ({ label: v.label, value: v.cost })), { kind: 'currency', color: 'var(--violet, #7b4fd0)', clickable: false }) : '<div class="empty">No vehicle costs.</div>';

    view.querySelector('#dept').innerHTML = data.by_department.length ? `<table class="data"><thead><tr><th>Department</th><th>Cost</th><th>Distance</th><th>Cost / km</th></tr></thead><tbody>${data.by_department.map((d) => `
      <tr><td data-label="Department">${VMTL.esc(d.label)}</td><td data-label="Cost">${VMTL.fmtCedis(d.cost)}</td><td data-label="Distance">${VMTL.fmtNumber(d.distance)} km</td><td data-label="Cost / km">${d.cost_per_km != null ? VMTL.fmtCedis(d.cost_per_km) : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No department costs in range.</div>';
    C.bind(view);
  };

  view.querySelector('#apply').onclick = load;
  view.querySelector('#clear').onclick = () => { view.querySelector('#from').value = ''; view.querySelector('#to').value = ''; load(); };
  load();
};
