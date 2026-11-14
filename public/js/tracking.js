'use strict';
// Live map — an Uber-style view of every vehicle in the user's org scope. The
// map shows each vehicle's latest GPS fix (reported by the driver's device while
// on a trip) and the viewer's own location; the side panel lists vehicles sorted
// by how far they are from the viewer, live-updating every few seconds. Works
// across multiple departments at once (the API returns the whole visible subtree).
// Basemap: MapLibre GL JS with free, keyless tiles (no API key required).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Live map', 'Where your fleet is right now, closest to you first.') +
    `<div class="track-wrap">
       <div class="track-map-col">
         <div id="trackBanner"></div>
         <div class="track-map-stage"><div id="trackMap" class="track-map"><div class="track-map-empty"><span class="spinner"></span><p>Loading map…</p></div></div><div class="track-map-heading" hidden><strong>Fleet activity</strong><span>Latest reported position per vehicle</span></div><div class="track-map-legend" hidden><span><i class="live"></i>On trip</span><span><i class="idle"></i>Idle</span><span><i class="stale"></i>Last seen</span></div></div>
       </div>
       <aside class="track-side">
         <div class="track-side-head">
           <div class="row between center">
             <strong id="trackCount">Vehicles</strong>
             <span class="track-live" id="trackLive"><span class="dot"></span>Live</span>
           </div>
           <div class="dim" style="font-size:12px" id="trackYou">Finding your location…</div>
         </div>
         <div id="trackList" class="track-list"><div class="loading"><span class="spinner"></span></div></div>
       </aside>
     </div>`;

  const state = {
    map: null, markers: new Map(), you: null, youMarker: null,
    pollTimer: null, geoWatch: null, selected: null, config: null, vehicles: [], destroyed: false,
  };

  // Keep the display awake while the live map is open (dropped automatically on leave).
  const releaseWake = VMTL.keepAwake ? VMTL.keepAwake() : null;
  // Refresh immediately when the service worker (periodic background sync) asks.
  const onSwRefresh = (e) => { if (e.detail && e.detail.type === 'tracking-refresh' && !state.destroyed) poll(); };
  window.addEventListener('vmtl:sw', onSwRefresh);
  if (VMTL.registerPeriodicSync) VMTL.registerPeriodicSync('vmtl-tracking', 15 * 60 * 1000);

  // ---- cleanup on SPA leave ------------------------------------------------
  VMTL.onLeave(() => {
    state.destroyed = true;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    if (state.geoWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(state.geoWatch);
    if (state.stopTheme) state.stopTheme();
    if (state.map) state.map.remove();
    if (releaseWake) releaseWake();
    window.removeEventListener('vmtl:sw', onSwRefresh);
  });

  function setLive(mode) {
    const live = document.getElementById('trackLive'); if (!live) return;
    live.classList.toggle('off', mode !== 'live');
    const label = mode === 'live' ? 'Live' : mode === 'offline' ? 'Offline · last known' : 'Reconnecting…';
    live.innerHTML = `<span class="dot"></span>${label}`;
  }

  const banner = () => document.getElementById('trackBanner');
  function showBanner(html, kind) {
    const b = banner(); if (!b) return;
    b.innerHTML = html ? `<div class="track-note ${kind || ''}">${html}</div>` : '';
  }

  // ---- geometry ------------------------------------------------------------
  function haversineKm(a, b) {
    if (!a || !b) return null;
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fmtDist(km) {
    if (km == null) return '—';
    if (km < 1) return `${Math.round(km * 1000)} m away`;
    if (km < 10) return `${km.toFixed(1)} km away`;
    return `${Math.round(km)} km away`;
  }
  function fmtAge(sec) {
    if (sec == null) return '';
    if (sec < 15) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
    return `${Math.round(sec / 3600)} h ago`;
  }

  // ---- map init ------------------------------------------------------------
  async function initMap() {
    const c = (state.config && state.config.default_center) || { lat: 6.6745, lng: -1.5716 };
    try {
      await VMTL.loadMapLibre();
    } catch (err) {
      const why = (err && err.message) || 'The map could not be loaded. Check your connection.';
      const el = document.getElementById('trackMap'); if (el) el.innerHTML = `<div class="track-map-empty"><p>${VMTL.esc(why)}</p></div>`;
      showBanner(VMTL.esc(why), 'warn');
      return false;
    }
    if (state.destroyed) return false;
    const host = document.getElementById('trackMap');
    host.innerHTML = '';
    state.map = new maplibregl.Map({
      container: host, style: VMTL.mapStyleForTheme(),
      center: [c.lng, c.lat], zoom: (state.config && state.config.default_zoom) || 13,
      attributionControl: false,
    });
    VMTL.compactAttribution(state.map);
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    state.map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    state.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    view.querySelectorAll('.track-map-heading,.track-map-legend').forEach((overlay) => (overlay.hidden = false));
    state.stopTheme = VMTL.watchMapTheme(state.map);
    return true;
  }

  // ---- render the side list ------------------------------------------------
  function renderList() {
    const list = document.getElementById('trackList'); if (!list) return;
    const items = state.vehicles.slice().map((v) => {
      v._dist = state.you ? haversineKm(state.you, { lat: v.lat, lng: v.lng }) : null;
      return v;
    }).sort((a, b) => {
      if (a._dist == null && b._dist == null) return a.age_seconds - b.age_seconds;
      if (a._dist == null) return 1; if (b._dist == null) return -1;
      return a._dist - b._dist;
    });
    document.getElementById('trackCount').textContent = `${items.length} vehicle${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      list.innerHTML = `<div class="empty" style="padding:28px 16px">No vehicles are reporting a location yet. A vehicle appears here once its driver starts a trip with location sharing on.</div>`;
      return;
    }
    list.innerHTML = items.map((v) => {
      // Live = on an in-progress trip with a fresh fix. Anything else is a
      // last-known position, labelled with when it was actually taken so a stale
      // or off-trip vehicle never reads as if it were moving right now.
      const live = v.on_trip && !v.stale;
      const status = v.stale ? 'Last seen' : (v.on_trip ? 'On trip' : 'Idle');
      const when = live ? fmtAge(v.age_seconds) : `Last known · ${VMTL.fmtDateTime(v.recorded_at)}`;
      const sub = [v.driver_name, v.destination && `→ ${v.destination}`].filter(Boolean).join(' · ') || v.registration_number;
      return `<button class="track-row ${state.selected === v.vehicle_id ? 'sel' : ''}" data-id="${v.vehicle_id}">
        <span class="track-row-marker" aria-hidden="true">${VMTL.carArtHtml(v)}</span>
        <span class="track-row-main">
          <span class="track-row-top"><strong>${VMTL.esc(v.vehicle_number)}</strong><span class="track-dist">${fmtDist(v._dist)}</span></span>
          <span class="track-row-sub">${VMTL.esc(sub)}</span>
          <span class="track-row-meta"><span class="track-chip ${v.stale ? 'stale' : (v.on_trip ? 'live' : 'idle')}">${status}</span><span class="dim">${VMTL.esc(v.org_unit_name || '')}</span><span class="dim">${VMTL.esc(when)}</span></span>
        </span>
      </button>`;
    }).join('');
    list.querySelectorAll('.track-row').forEach((r) => {
      r.onclick = () => focusVehicle(Number(r.dataset.id));
    });
  }

  function focusVehicle(id) {
    state.selected = id;
    const v = state.vehicles.find((x) => x.vehicle_id === id);
    const entry = state.markers.get(id);
    if (state.map && v) state.map.flyTo({ center: [v.lng, v.lat], zoom: Math.max(state.map.getZoom(), 15), speed: 0.8 });
    if (entry && state.map) { state.markers.forEach((e) => e.popup && e.popup.isOpen() && e.popup.remove()); entry.marker.togglePopup(); }
    renderList();
  }

  function infoHtml(v) {
    const rows = [
      v.driver_name && `<div><span class="dim">Driver</span> ${VMTL.esc(v.driver_name)}</div>`,
      v.trip_number && `<div><span class="dim">Trip</span> ${VMTL.esc(v.trip_number)}</div>`,
      v.destination && `<div><span class="dim">Destination</span> ${VMTL.esc(v.destination)}</div>`,
      v.org_unit_name && `<div><span class="dim">Unit</span> ${VMTL.esc(v.org_unit_name)}</div>`,
      typeof v.speed === 'number' && v.speed >= 0 && `<div><span class="dim">Speed</span> ${Math.round((v.speed || 0) * 3.6)} km/h</div>`,
      (v.on_trip && !v.stale)
        ? `<div><span class="dim">Updated</span> ${fmtAge(v.age_seconds)}</div>`
        : `<div><span class="dim">Last known</span> ${VMTL.esc(VMTL.fmtDateTime(v.recorded_at))}</div>`,
    ].filter(Boolean).join('');
    return `<div class="track-info"><strong>${VMTL.esc(v.vehicle_number)}</strong><div class="track-info-sub">${VMTL.esc([v.make, v.model].filter(Boolean).join(' ') || v.registration_number)}</div>${rows}</div>`;
  }

  // ---- markers -------------------------------------------------------------
  function syncMarkers() {
    if (!state.map || !window.maplibregl) return;
    const seen = new Set();
    for (const v of state.vehicles) {
      seen.add(v.vehicle_id);
      const pos = [v.lng, v.lat];
      let entry = state.markers.get(v.vehicle_id);
      if (!entry) {
        const el = VMTL.carMarkerEl(v, { label: v.vehicle_number });
        const popup = new maplibregl.Popup({ offset: 22, closeButton: false }).setHTML(infoHtml(v));
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(pos).setPopup(popup).addTo(state.map);
        el.addEventListener('click', () => focusVehicle(v.vehicle_id));
        entry = { marker, popup, el };
        state.markers.set(v.vehicle_id, entry);
      } else {
        entry.marker.setLngLat(pos);
        const dot = entry.el.querySelector('.vm-dot'); if (dot) dot.style.background = VMTL.vehicleStatusColor(v);
        entry.popup.setHTML(infoHtml(v));
      }
    }
    for (const [id, entry] of state.markers) {
      if (!seen.has(id)) { entry.marker.remove(); state.markers.delete(id); }
    }
  }

  // ---- your location -------------------------------------------------------
  function startGeo() {
    const youEl = document.getElementById('trackYou');
    if (!('geolocation' in navigator) || !window.isSecureContext) { if (youEl) youEl.textContent = 'Location unavailable — distances are hidden.'; return; }
    state.geoWatch = navigator.geolocation.watchPosition((pos) => {
      state.you = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (youEl) youEl.textContent = 'Showing distance from your location.';
      if (state.map && window.maplibregl) {
        if (!state.youMarker) {
          const dot = document.createElement('div');
          dot.className = 'track-you-dot'; dot.title = 'You';
          state.youMarker = new maplibregl.Marker({ element: dot, anchor: 'center' }).setLngLat([state.you.lng, state.you.lat]).addTo(state.map);
        } else state.youMarker.setLngLat([state.you.lng, state.you.lat]);
      }
      renderList();
    }, (err) => {
      if (youEl) youEl.textContent = err && err.code === 1 ? 'Location permission off — distances are hidden.' : 'Could not get your location.';
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  }

  // ---- polling -------------------------------------------------------------
  async function poll() {
    if (state.destroyed) return;
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; } // avoid overlapping cycles
    try {
      const r = await VMTL.api('/tracking/vehicles');
      state.vehicles = r.data || [];
      if (r._stale || navigator.onLine === false) { setLive('offline'); showBanner('You are offline — showing the last known positions.', 'warn'); }
      else { setLive('live'); showBanner('', ''); }
      syncMarkers();
      renderList();
    } catch (e) {
      setLive(navigator.onLine === false ? 'offline' : 'down');
    }
    if (!state.destroyed) state.pollTimer = setTimeout(poll, 5000);
  }

  // ---- boot ----------------------------------------------------------------
  try {
    state.config = await VMTL.api('/tracking/config');
  } catch (e) {
    document.getElementById('trackMap').innerHTML = `<div class="track-map-empty"><p>${VMTL.esc(e.message || 'Tracking is unavailable.')}</p></div>`;
    return;
  }
  if (state.destroyed) return;

  // MapLibre + OpenFreeMap needs no API key, so the map always loads.
  await initMap();
  startGeo();
  poll();
};
