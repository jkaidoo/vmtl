'use strict';
// Fuel purchase log: list + add (auto previous-odometer + economy on the server).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Fuel purchases', 'Fill-ups with derived distance-per-tank and economy.', `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Log purchase</button>`) +
    `<div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const load = async () => {
    const list = view.querySelector('#list');
    try { const r = await VMTL.api('/fuel-logs?per_page=100'); list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Odo</th><th>Since last</th><th>Litres</th><th>km/L</th><th>₵/L</th><th>Total</th></tr></thead><tbody>${r.data.map((f) => `<tr><td data-label="Date">${VMTL.fmtDate(f.purchase_date)}</td><td data-label="Vehicle">${VMTL.esc(f.vehicle ? f.vehicle.vehicle_number : '')}</td><td data-label="Driver">${VMTL.esc(f.driver ? f.driver.name : '—')}</td><td data-label="Odo">${VMTL.fmtNumber(f.odometer)}</td><td data-label="Since last">${f.distance_since_last != null ? f.distance_since_last + ' km' : '—'}</td><td data-label="Litres">${VMTL.fmtDecimal(f.litres)}</td><td data-label="km/L">${f.km_per_litre != null ? f.km_per_litre : '—'}</td><td data-label="₵/L">${VMTL.fmtCedis(f.price_per_litre)}</td><td data-label="Total">${VMTL.fmtCedis(f.total_cost)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No fuel purchases yet.</div>'; }
    catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelector('#add').onclick = async () => {
    const vehicles = (await VMTL.api('/vehicles?all=1')).data;
    let drivers = []; try { drivers = (await VMTL.api('/drivers?all=1')).data; } catch (_) {}
    const m = VMTL.openModal(`<div class="modal-head"><h3>Log fuel purchase</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="ff"><div class="form-grid">
      <div class="field"><label>Vehicle</label><select name="vehicle_id" required>${vehicles.map((v) => `<option value="${v.id}">${VMTL.esc(v.vehicle_number)}</option>`).join('')}</select></div>
      <div class="field"><label>Driver (optional)</label><select name="driver_id"><option value="">—</option>${drivers.map((d) => `<option value="${d.id}">${VMTL.esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Purchase date</label><input name="purchase_date" type="datetime-local" required></div>
      <div class="field"><label>Odometer</label><input name="odometer" type="number" min="0" required></div>
      <div class="field"><label>Litres</label><input name="litres" type="number" step="0.01" min="0.01" required></div>
      <div class="field"><label>Price / litre (₵)</label><input name="price_per_litre" type="number" step="0.01" min="0" required></div>
      <div class="field"><label>Fuel type</label><input name="fuel_type" placeholder="petrol / diesel"></div>
      <div class="field"><label>Station</label><input name="station"></div>
    </div><div class="field"><label>Notes</label><input name="notes"></div></form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#ff'); const body = {}; new FormData(form).forEach((val, k) => { if (val !== '') body[k] = val; });
      ['vehicle_id', 'driver_id', 'odometer'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      ['litres', 'price_per_litre'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      try { await VMTL.api('/fuel-logs', { method: 'POST', body }); m.close(); VMTL.toast('Logged.', 'success'); load(); } catch (err) { VMTL.showErrors(err, form); }
    };
  };
  load();
};
