'use strict';
// Fleet & driver availability: a live snapshot plus a window checker.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Vehicle & driver availability', 'Who is free now, and whether a window is bookable.') +
    `<div class="card pad mb"><h3>Check a window</h3><div class="form-grid mt">
       <div class="field"><label>From</label><input id="s" type="datetime-local"></div>
       <div class="field"><label>To</label><input id="e" type="datetime-local"></div>
       <div class="field"><label>Passengers</label><input id="p" type="number" min="1" value="1"></div>
       <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-primary btn-block" id="chk">Check</button></div>
     </div><div id="chkOut"></div></div>
     <div class="grid cols-2"><div class="card"><div class="card-head"><h3>Vehicles</h3></div><div id="veh"><div class="loading"><span class="spinner"></span></div></div></div>
     <div class="card"><div class="card-head"><h3>Drivers</h3></div><div id="drv"></div></div></div>`;
  view.querySelector('#chk').onclick = async () => {
    const out = view.querySelector('#chkOut');
    try { const r = (await VMTL.api(`/availability/check?start=${encodeURIComponent(view.querySelector('#s').value)}&end=${encodeURIComponent(view.querySelector('#e').value)}&passengers=${view.querySelector('#p').value}`)).data;
      out.innerHTML = `<div class="alert-accent ${r.is_bookable ? 'green' : 'red'} mt">${r.is_bookable ? `Bookable — ${r.available_vehicles} vehicle(s), ${r.available_drivers} driver(s) free.` : 'Fully booked.'}${r.conflicts.length ? ` ${r.conflicts.length} overlapping booking(s).` : ''}</div>`;
    } catch (e) { out.innerHTML = `<div class="alert-accent red mt">${VMTL.esc(e.message)}</div>`; }
  };
  try {
    const d = (await VMTL.api('/availability/overview')).data;
    const rowItem = (x) => `<div class="card pad" style="margin:8px"><div class="between"><strong>${VMTL.esc(x.label)}</strong>${VMTL.badge(x.status_label, x.status_color)}</div><div class="dim" style="font-size:12.5px;margin-top:3px">${x.on_trip_now ? `On trip → ${VMTL.esc(x.current_trip ? x.current_trip.destination : '')}` : x.free_now ? 'Free now' : 'Has upcoming bookings'}</div></div>`;
    view.querySelector('#veh').innerHTML = d.vehicles.map(rowItem).join('') || '<div class="empty">No vehicles.</div>';
    view.querySelector('#drv').innerHTML = d.drivers.map(rowItem).join('') || '<div class="empty">No drivers.</div>';
  } catch (e) { view.querySelector('#veh').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
};
