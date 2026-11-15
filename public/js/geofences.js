'use strict';
// Geofences: circular inclusion / exclusion zones drawn on a map, plus the list
// of zones and the most recent crossing/breach events. Fixes reported by a
// vehicle on an in-progress trip are checked against active zones in its scope.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Geofences', 'Inclusion and exclusion zones. Vehicles on a trip are checked against active zones in their scope.',
    `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Add geofence</button>`) +
    `<div class="grid cols-2">
       <div class="card pad"><div data-map style="height:380px;border-radius:10px;overflow:hidden"></div><div class="dim mt" style="font-size:12px">Green = inclusion (stay inside) · Red = exclusion (keep out).</div></div>
       <div class="card"><h3 class="pad-h">Zones</h3><div id="list"><div class="loading"><span class="spinner"></span></div></div></div>
     </div>
     <div class="card mt"><h3 class="pad-h">Recent crossings</h3><div id="events"><div class="loading"><span class="spinner"></span></div></div></div>`;

  let map, fences = [], orgUnits = [];

  const drawFences = () => {
    if (!map || !map.isStyleLoaded()) return;
    const fc = { type: 'FeatureCollection', features: fences.filter((f) => f.active).map((f) => ({ ...VMTL.circleGeoJSON(f.latitude, f.longitude, f.radius_m), properties: { kind: f.kind } })) };
    const src = map.getSource('fences');
    if (src) { src.setData(fc); return; }
    map.addSource('fences', { type: 'geojson', data: fc });
    map.addLayer({ id: 'fence-fill', type: 'fill', source: 'fences', paint: { 'fill-color': ['match', ['get', 'kind'], 'exclusion', '#c0392b', '#009540'], 'fill-opacity': 0.14 } });
    map.addLayer({ id: 'fence-line', type: 'line', source: 'fences', paint: { 'line-color': ['match', ['get', 'kind'], 'exclusion', '#c0392b', '#009540'], 'line-width': 2 } });
  };

  const mountMap = async () => {
    const panel = view.querySelector('[data-map]');
    try { await VMTL.loadMapLibre(); } catch (_) { panel.innerHTML = '<div class="empty">The map could not be loaded (offline or blocked). Zones are still listed on the right.</div>'; return; }
    const center = fences[0] ? [fences[0].longitude, fences[0].latitude] : [-1.5716, 6.6745];
    map = new maplibregl.Map({ container: panel, style: VMTL.mapStyleForTheme(), center, zoom: 13, attributionControl: false });
    VMTL.compactAttribution(map); map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    VMTL.watchMapTheme(map);
    map.on('load', drawFences);
    map.on('styledata', (e) => { if (!e || e.dataType === 'style') setTimeout(drawFences, 50); });
  };

  const loadList = async () => {
    const list = view.querySelector('#list');
    try {
      fences = (await VMTL.api('/geofences')).data;
      list.innerHTML = fences.length ? `<table class="data"><thead><tr><th>Name</th><th>Kind</th><th>Radius</th><th>Active</th><th></th></tr></thead><tbody>${fences.map((f) => `
        <tr>
          <td data-label="Name">${VMTL.esc(f.name)}<div class="dim" style="font-size:12px">${f.org_unit ? VMTL.esc(f.org_unit.name) : 'All units'}</div></td>
          <td data-label="Kind">${VMTL.badge(f.kind === 'exclusion' ? 'Exclusion' : 'Inclusion', f.kind === 'exclusion' ? 'red' : 'green')}</td>
          <td data-label="Radius">${VMTL.fmtNumber(f.radius_m)} m</td>
          <td data-label="Active">${f.active ? '✓' : '—'}</td>
          <td class="right"><button class="btn btn-sm" data-edit="${f.id}">Edit</button> <button class="btn btn-sm btn-danger" data-del="${f.id}">Delete</button></td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">No geofences yet.</div>';
      list.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openForm(fences.find((f) => f.id === Number(b.dataset.edit))); });
      list.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
        const f = fences.find((x) => x.id === Number(b.dataset.del));
        if (!await VMTL.confirm(`Remove geofence "${f.name}"?`, { danger: true, confirmLabel: 'Delete' })) return;
        await VMTL.api(`/geofences/${f.id}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); refresh();
      }; });
      drawFences();
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  const loadEvents = async () => {
    const host = view.querySelector('#events');
    try {
      const { data } = await VMTL.api('/geofence-events');
      host.innerHTML = data.length ? `<table class="data"><thead><tr><th>When</th><th>Zone</th><th>Vehicle</th><th>Trip</th><th>Event</th></tr></thead><tbody>${data.map((e) => `
        <tr><td data-label="When">${VMTL.fmtDateTime(e.occurred_at)}</td><td data-label="Zone">${VMTL.esc(e.geofence)}</td><td data-label="Vehicle">${VMTL.esc(e.vehicle_number || '—')}</td><td data-label="Trip">${VMTL.esc(e.trip_number || '—')}</td><td data-label="Event">${e.is_breach ? VMTL.badge(`${e.event_type} · breach`, 'red') : VMTL.badge(e.event_type, 'grey')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No crossings recorded yet.</div>';
    } catch (e) { host.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  const refresh = () => { loadList(); loadEvents(); };

  async function openForm(f = null) {
    const m = VMTL.openModal(`<div class="modal-head"><h3>${f ? 'Edit' : 'Add'} geofence</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><form id="gf"><div class="form-grid">
        <div class="field"><label>Name</label><input name="name" required maxlength="120" value="${f ? VMTL.esc(f.name) : ''}"></div>
        <div class="field"><label>Kind</label><select name="kind"><option value="inclusion" ${f && f.kind === 'inclusion' ? 'selected' : ''}>Inclusion (stay inside)</option><option value="exclusion" ${f && f.kind === 'exclusion' ? 'selected' : ''}>Exclusion (keep out)</option></select></div>
        <div class="field"><label>Latitude</label><input name="latitude" type="number" step="any" required value="${f ? f.latitude : ''}"></div>
        <div class="field"><label>Longitude <button type="button" class="btn btn-sm" id="geo">${VMTL.icon('target')} Use my location</button></label><input name="longitude" type="number" step="any" required value="${f ? f.longitude : ''}"></div>
        <div class="field"><label>Radius (m)</label><input name="radius_m" type="number" min="20" max="200000" required value="${f ? f.radius_m : 300}"></div>
        <div class="field"><label>Organisational unit</label><select name="org_unit_id"><option value="">All units</option>${VMTL.orgUnitOptions(f ? f.org_unit_id : '')}</select></div>
        <div class="field"><label><input type="checkbox" name="active" ${!f || f.active ? 'checked' : ''}> Active</label></div>
      </div><div class="field"><label>Notes</label><input name="notes" maxlength="1000" value="${f ? VMTL.esc(f.notes || '') : ''}"></div>
      <div class="dim" style="font-size:12px">Tip: click a point on the map to set the centre, then adjust the radius.</div></form></div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    const geo = m.el.querySelector('#geo');
    geo.onclick = () => { if (!navigator.geolocation) return VMTL.toast('Geolocation unavailable.', 'err'); navigator.geolocation.getCurrentPosition((p) => { m.el.querySelector('[name=latitude]').value = p.coords.latitude.toFixed(6); m.el.querySelector('[name=longitude]').value = p.coords.longitude.toFixed(6); VMTL.toast('Location captured.', 'success'); }, () => VMTL.toast('Could not get location.', 'err')); };
    // Let clicking the background map set the centre.
    const onMapClick = (e) => { m.el.querySelector('[name=latitude]').value = e.lngLat.lat.toFixed(6); m.el.querySelector('[name=longitude]').value = e.lngLat.lng.toFixed(6); VMTL.toast('Centre set from map.', 'success'); };
    if (map) map.on('click', onMapClick);
    const cleanup = () => { if (map) map.off('click', onMapClick); };
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#gf'); if (!form.reportValidity()) return;
      const body = {}; new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
      ['latitude', 'longitude', 'radius_m'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
      if (body.org_unit_id) body.org_unit_id = Number(body.org_unit_id);
      body.active = form.querySelector('[name=active]').checked;
      try { await VMTL.api(f ? `/geofences/${f.id}` : '/geofences', { method: f ? 'PUT' : 'POST', body }); cleanup(); m.close(); VMTL.toast('Saved.', 'success'); refresh(); }
      catch (err) { VMTL.showErrors(err, form); }
    };
    const origClose = m.close; m.close = () => { cleanup(); origClose(); };
  }

  view.querySelector('#add').onclick = () => openForm();
  refresh();
  mountMap();
};
