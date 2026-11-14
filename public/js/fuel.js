'use strict';
// Fuel purchase log: list + add (auto previous-odometer + economy on the server).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const scheduleId=new URLSearchParams(location.search).get('schedule_id');
  const schedule=scheduleId?(await VMTL.api('/event-schedules/'+encodeURIComponent(scheduleId))).data:null;
  view.innerHTML = VMTL.pageHead('Fuel purchases', 'Fill-ups with derived distance-per-tank and economy.', `${schedule?'<a class="btn" href="/event-schedules.html">Back to IDL events</a>':''}<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Log purchase</button>`) +
    `<div class="card"><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>`;
  const load = async () => {
    const list = view.querySelector('#list');
    try { const r = await VMTL.pagedApi('/fuel-logs'+(scheduleId?'?schedule_id='+encodeURIComponent(scheduleId):''), list, load); list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Odo</th><th>Since last</th><th>Station / type</th><th>Litres</th><th>km/L</th><th>₵/L</th><th>Total</th><th>Actions</th></tr></thead><tbody>${r.data.map((f) => `<tr><td data-label="Date">${VMTL.fmtDate(f.purchase_date)}</td><td data-label="Vehicle">${VMTL.esc(f.vehicle ? f.vehicle.vehicle_number : '')}</td><td data-label="Driver">${VMTL.esc(f.driver ? f.driver.name : '—')}</td><td data-label="Odo">${VMTL.fmtNumber(f.odometer)}</td><td data-label="Since last">${f.distance_since_last != null ? f.distance_since_last + ' km' : '—'}</td><td data-label="Station / type">${VMTL.esc(f.station||'—')}<div class="dim">${VMTL.esc(f.fuel_type||'—')}</div></td><td data-label="Litres">${VMTL.fmtDecimal(f.litres)}</td><td data-label="km/L">${f.km_per_litre != null ? f.km_per_litre : '—'}</td><td data-label="₵/L">${VMTL.fmtCedis(f.price_per_litre)}</td><td data-label="Total">${VMTL.fmtCedis(f.total_cost)}</td><td data-label="Actions"><div class="btn-row"><button class="btn btn-sm" data-edit="${f.id}">Edit</button><button class="btn btn-sm" data-remove="${f.id}">Remove</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No fuel purchases yet.</div>';
      list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openPurchase(r.data.find(f=>String(f.id)===b.dataset.edit)));
      list.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{
        if(!await VMTL.confirm('Remove this fuel purchase? Its cost will also be removed from the schedule total.',{danger:true,confirmLabel:'Remove'})) return;
        try{await VMTL.api('/fuel-logs/'+b.dataset.remove,{method:'DELETE'});VMTL.toast('Purchase removed.','success');load();}catch(e){VMTL.showErrors(e);}
      });
    }
    catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  const openPurchase = async (purchase=null) => {
    const context=purchase ? (purchase.schedule_id?{vehicle_id:purchase.vehicle_id,driver_id:purchase.driver_id}:null) : schedule;
    const vehicles = (await VMTL.api('/vehicles?all=1')).data;
    let drivers = []; try { drivers = (await VMTL.api('/drivers?all=1')).data; } catch (_) {}
    const m = VMTL.openModal(`<div class="modal-head"><h3>${purchase?'Edit fuel purchase':'Log fuel purchase'}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="ff"><div class="form-grid">
      <div class="field"><label>Vehicle</label><select name="vehicle_id" required>${vehicles.map((v) => `<option value="${v.id}">${VMTL.esc(v.vehicle_number)}</option>`).join('')}</select></div>
      <div class="field"><label>Driver (optional)</label><select name="driver_id"><option value="">—</option>${drivers.map((d) => `<option value="${d.id}">${VMTL.esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Purchase date</label><input name="purchase_date" type="datetime-local" required></div>
      <div class="field"><label>Odometer</label><input name="odometer" type="number" min="0" required></div>
      <div class="field"><label>Litres</label><input name="litres" type="number" step="0.01" min="0.01" required></div>
      <div class="field"><label>Price / litre (₵)</label><input name="price_per_litre" type="number" step="0.01" min="0" required></div>
      <div class="field"><label>Fuel type</label><select name="fuel_type" required>${VMTL.enumOptions('fuel_type')}</select></div>
      <div class="field"><label>Station</label>${VMTL.otherField('station')}</div>
    </div><div class="field"><label>Notes</label><input name="notes"></div></form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    const form=m.el.querySelector('#ff');
    if(purchase){
      for(const name of ['vehicle_id','driver_id','odometer','litres','price_per_litre','fuel_type','notes'])form.elements[name].value=purchase[name]??'';
      form.elements.purchase_date.value=String(purchase.purchase_date).replace(' ','T').slice(0,16);
      const station=form.elements.station;
      station.value=Array.from(station.options).some(o=>o.value===purchase.station)?purchase.station:'other';
      if(station.value==='other')form.elements.station_other.value=purchase.station||'';
    }
    VMTL.bindOther(m.el,'station');
    if(context){ m.el.querySelector('[name=vehicle_id]').value=context.vehicle_id; m.el.querySelector('[name=vehicle_id]').disabled=true; m.el.querySelector('[name=driver_id]').value=context.driver_id; m.el.querySelector('[name=driver_id]').disabled=true; }
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#ff'); const body = {}; if(!form.reportValidity()) return; new FormData(form).forEach((val, k) => { if (val !== '') body[k] = val; });
      if(context) Object.assign(body,{schedule_id:Number(purchase?.schedule_id||scheduleId),vehicle_id:context.vehicle_id,driver_id:context.driver_id});
      ['vehicle_id', 'driver_id', 'odometer'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      ['litres', 'price_per_litre'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      const button=m.el.querySelector('#save');button.disabled=true;
      try { await VMTL.api(purchase?'/fuel-logs/'+purchase.id:'/fuel-logs', { method: purchase?'PUT':'POST', body }); m.close(); VMTL.toast('Logged.', 'success'); load(); } catch (err) { VMTL.showErrors(err, form); } finally {button.disabled=false;}
    };
  };
  view.querySelector('#add').onclick=()=>openPurchase();
  load();
  if(schedule) view.querySelector('#add').click();
};
