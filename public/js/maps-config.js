'use strict';
// Maps configuration (System Administrator). The Live map now renders with
// MapLibre GL JS and free, keyless OpenStreetMap-based basemaps (OpenFreeMap for
// light, CARTO dark-matter for dark) — there is no API key to manage. This page
// sets the default map centre and zoom (used when a viewer's location is
// unavailable), with a live MapLibre preview.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Maps configuration', 'Set the default centre and zoom for the Live map.') +
    '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';

  let cfg;
  try { cfg = await VMTL.api('/tracking/config'); }
  catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }

  const center = cfg.default_center || { lat: 6.6745, lng: -1.5716 };
  view.querySelector('#b').innerHTML = `
    <div class="card pad mb">
      <div class="row between center wrap gap-sm">
        <div>
          <div class="row center gap-sm"><strong style="font-size:15px">Open-source basemap</strong> <span class="badge green">No API key needed</span></div>
          <p class="dim" style="margin:4px 0 0;font-size:13px">The Live map renders with MapLibre GL JS and free OpenStreetMap-based tiles — OpenFreeMap in light mode, CARTO in dark. Vehicle positions come from driver devices.</p>
        </div>
        <a class="btn" href="/tracking.html">${VMTL.icon('map')} Open Live map</a>
      </div>
    </div>

    <div class="card pad mb">
      <h3 style="margin:0 0 4px">Default map view</h3>
      <p class="dim" style="margin:0 0 12px;font-size:13px">Used when a viewer hasn't shared their location. Drag the green pin or pan/zoom the preview, then Save.</p>
      <div class="form-grid">
        <div class="field"><label>Centre — latitude</label><input id="mcLat" type="number" step="0.0001" min="-90" max="90" value="${center.lat}"></div>
        <div class="field"><label>Centre — longitude</label><input id="mcLng" type="number" step="0.0001" min="-180" max="180" value="${center.lng}"></div>
        <div class="field"><label>Zoom (3–20)</label><input id="mcZoom" type="number" min="3" max="20" value="${cfg.default_zoom || 13}"></div>
      </div>
      <div class="row gap-sm wrap" style="margin-top:4px">
        <button type="button" class="btn btn-sm" id="mcHere">${VMTL.icon('map')} Use my location</button>
        <button type="button" class="btn btn-sm btn-ghost" id="mcReset">Reset to KNUST</button>
      </div>
      <div id="mcPreview" class="track-map" style="height:320px;margin-top:14px"><div class="track-map-empty"><span class="spinner"></span><p>Loading preview…</p></div></div>
      <div class="mt"><button class="btn btn-primary" id="mcSave">Save configuration</button></div>
    </div>`;

  const latEl = view.querySelector('#mcLat'), lngEl = view.querySelector('#mcLng'), zoomEl = view.querySelector('#mcZoom');
  const num = (el) => Number(el.value);

  // ---- live MapLibre preview ----------------------------------------------
  let map, marker;
  (async () => {
    try {
      await VMTL.loadMapLibre();
      const box = view.querySelector('#mcPreview'); if (!box) return;
      box.innerHTML = '';
      map = new maplibregl.Map({ container: box, style: VMTL.mapStyleForTheme(), center: [num(lngEl), num(latEl)], zoom: num(zoomEl) || 13, attributionControl: false });
      VMTL.compactAttribution(map);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      VMTL.onLeave(VMTL.watchMapTheme(map));
      marker = new maplibregl.Marker({ color: '#009540', draggable: true }).setLngLat([num(lngEl), num(latEl)]).addTo(map);
      marker.on('dragend', () => { const p = marker.getLngLat(); latEl.value = p.lat.toFixed(5); lngEl.value = p.lng.toFixed(5); });
      map.on('moveend', () => { zoomEl.value = Math.round(map.getZoom()); });
    } catch (e) {
      const box = view.querySelector('#mcPreview'); if (box) box.innerHTML = `<div class="track-map-empty"><p>${VMTL.esc(e.message)}</p></div>`;
    }
  })();
  const syncPreview = () => { if (!map) return; const c = [num(lngEl), num(latEl)]; map.setCenter(c); map.setZoom(num(zoomEl) || 13); if (marker) marker.setLngLat(c); };
  [latEl, lngEl, zoomEl].forEach((el) => el.addEventListener('change', syncPreview));

  // ---- helpers -------------------------------------------------------------
  view.querySelector('#mcReset').onclick = () => { latEl.value = 6.6745; lngEl.value = -1.5716; zoomEl.value = 13; syncPreview(); };
  view.querySelector('#mcHere').onclick = () => {
    if (!('geolocation' in navigator)) return VMTL.toast('Geolocation is not available here.', 'err');
    navigator.geolocation.getCurrentPosition(
      (p) => { latEl.value = p.coords.latitude.toFixed(5); lngEl.value = p.coords.longitude.toFixed(5); syncPreview(); VMTL.toast('Centre set to your location.', 'success'); },
      () => VMTL.toast('Could not get your location.', 'err'), { enableHighAccuracy: true, timeout: 12000 });
  };

  // ---- save ----------------------------------------------------------------
  view.querySelector('#mcSave').onclick = async () => {
    const btn = view.querySelector('#mcSave'); btn.disabled = true;
    try {
      cfg = await VMTL.api('/tracking/config', { method: 'PUT', body: { default_center: `${num(latEl)},${num(lngEl)}`, default_zoom: num(zoomEl) } });
      VMTL.toast('Maps configuration saved.', 'success');
    } catch (e) { VMTL.showErrors(e); }
    finally { btn.disabled = false; }
  };
};
