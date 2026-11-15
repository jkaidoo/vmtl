'use strict';
// Emissions & fuel efficiency. CO₂ from litres × fuel-type factor; efficiency
// (L/100km, km/L) from odometer deltas between fuel logs.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const C = VMTL.charts;
  const today = new Date().toISOString().slice(0, 10);
  view.innerHTML = VMTL.pageHead('Emissions', 'CO₂ and fuel efficiency across the fleet.') +
    `<div class="card pad mb"><div class="toolbar">
       <label>From <input type="date" id="from" class="input"></label>
       <label>To <input type="date" id="to" class="input" value="${today}"></label>
       <button class="btn btn-sm" id="apply">Apply</button>
       <button class="btn btn-sm" id="clear">All time</button>
     </div></div>
     <div id="kpis" class="grid cols-4 mb"></div>
     <div class="grid cols-2">
       <div class="card pad"><div class="ch-card-head"><h3>CO₂ by fuel type</h3></div><div id="fuel" class="mt"></div></div>
       <div class="card pad"><div class="ch-card-head"><h3>Monthly CO₂ (kg)</h3></div><div id="trend" class="mt"></div></div>
     </div>
     <div class="card mt"><h3 class="pad-h">By vehicle</h3><div id="veh"></div></div>`;

  const kpi = (label, value, sub) => `<div class="kpi"><div class="label">${label}</div><div class="value metric">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const kg = (n) => n == null ? '—' : `${VMTL.fmtNumber(Math.round(n))} kg`;

  const load = async () => {
    const qs = new URLSearchParams();
    const from = view.querySelector('#from').value; const to = view.querySelector('#to').value;
    if (from) qs.set('date_from', from); if (to) qs.set('date_to', to);
    let data;
    try { data = (await VMTL.api(`/emissions${qs.toString() ? `?${qs}` : ''}`)).data; }
    catch (e) { view.querySelector('#kpis').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }

    view.querySelector('#kpis').innerHTML =
      kpi('Total CO₂', data.total_co2_kg >= 1000 ? `${(data.total_co2_kg / 1000).toFixed(1)} t` : kg(data.total_co2_kg)) +
      kpi('Fuel used', `${VMTL.fmtNumber(Math.round(data.total_litres))} L`) +
      kpi('Avg efficiency', data.avg_l_per_100km != null ? `${data.avg_l_per_100km} L/100km` : '—') +
      kpi('CO₂ per km', data.co2_per_km != null ? `${data.co2_per_km} kg` : '—');

    const PAL = C.PALETTE || ['#1f5fd0', '#009540', '#d99400', '#c0392b', '#7b4fd0'];
    const segs = data.by_fuel_type.filter((f) => f.co2_kg > 0).map((f, i) => ({ label: f.label, value: f.co2_kg, color: PAL[i % PAL.length] }));
    view.querySelector('#fuel').innerHTML = segs.length ? C.donut(segs, { kind: 'number', centerLabel: 'kg CO₂' }) : '<div class="empty">No fuel records in range.</div>';
    view.querySelector('#trend').innerHTML = data.monthly.length ? C.areaLine(data.monthly, { valueKey: 'co2_kg', kind: 'number', color: 'var(--primary)' }) : '<div class="empty">No fuel records in range.</div>';

    view.querySelector('#veh').innerHTML = data.by_vehicle.length ? `<table class="data"><thead><tr><th>Vehicle</th><th>Fuel (L)</th><th>CO₂ (kg)</th><th>L/100km</th><th>km/L</th></tr></thead><tbody>${data.by_vehicle.map((v) => `
      <tr><td data-label="Vehicle">${VMTL.esc(v.label || '—')}</td><td data-label="Fuel (L)">${VMTL.fmtNumber(v.litres)}</td><td data-label="CO₂ (kg)">${VMTL.fmtNumber(v.co2_kg)}</td><td data-label="L/100km">${v.l_per_100km ?? '—'}</td><td data-label="km/L">${v.km_per_litre ?? '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No fuel records in range.</div>';
    C.bind(view);
  };

  view.querySelector('#apply').onclick = load;
  view.querySelector('#clear').onclick = () => { view.querySelector('#from').value = ''; view.querySelector('#to').value = ''; load(); };
  load();
};
