'use strict';
// Live map — an Uber-style view of every vehicle in the user's org scope. The
// map shows each vehicle's latest GPS fix (reported by the driver's device while
// on a trip) and the viewer's own location; the side panel lists vehicles sorted
// by how far they are from the viewer, live-updating every few seconds. Works
// across multiple departments at once (the API returns the whole visible subtree).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Live map', 'Where your fleet is right now, closest to you first.') +
    `<div class="track-wrap">
       <div class="track-map-col">
         <div id="trackBanner"></div>
         <div id="trackMap" class="track-map"><div class="track-map-empty"><span class="spinner"></span><p>Loading map…</p></div></div>
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
    gmap: null, markers: new Map(), you: null, youMarker: null, youCircle: null,
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
  const COLORS = { live: '#009540', stale: '#9aa0a6', idle: '#1a73e8' };
  function colorFor(v) { if (v.stale) return COLORS.stale; return v.on_trip ? COLORS.live : COLORS.idle; }

  // ---- Google Maps loader --------------------------------------------------
  function loadMaps(key) {
    if (window.google && window.google.maps) return Promise.resolve();
    if (window.__vmtlMapsPromise) return window.__vmtlMapsPromise;
    window.__vmtlMapsKey = key;
    window.__vmtlMapsPromise = new Promise((resolve, reject) => {
      window.gm_authFailure = () => reject(new Error('auth'));
      const cb = '__vmtlMapsReady';
      window[cb] = () => resolve();
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry&loading=async&callback=${cb}`;
      s.async = true; s.defer = true;
      s.onerror = () => reject(new Error('load'));
      document.head.appendChild(s);
    });
    return window.__vmtlMapsPromise;
  }

  function markerIcon(v) {
    return VMTL.vehicleMapIcon(v);
  }

  // ---- map init ------------------------------------------------------------
  async function initMap() {
    const center = (state.config && state.config.default_center) || { lat: 6.6745, lng: -1.5716 };
    try {
      await loadMaps(state.config.key);
    } catch (err) {
      const why = err && err.message === 'auth'
        ? 'The Google Maps key was rejected. Check that the Maps JavaScript API is enabled and the key allows this site.'
        : 'Google Maps could not be loaded. Check the API key and your connection.';
      document.getElementById('trackMap').innerHTML = `<div class="track-map-empty"><p>${VMTL.esc(why)}</p></div>`;
      showBanner(VMTL.esc(why), 'warn');
      return false;
    }
    if (state.destroyed) return false;
    const g = window.google;
    state.gmap = new g.maps.Map(document.getElementById('trackMap'), {
      center, zoom: (state.config && state.config.default_zoom) || 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
      styles: document.documentElement.getAttribute('data-theme') === 'dark' ? DARK_STYLE : undefined,
    });
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
      const dotColor = colorFor(v);
      const status = v.stale ? 'Last seen' : (v.on_trip ? 'On trip' : 'Idle');
      const sub = [v.driver_name, v.destination && `→ ${v.destination}`].filter(Boolean).join(' · ') || v.registration_number;
      return `<button class="track-row ${state.selected === v.vehicle_id ? 'sel' : ''}" data-id="${v.vehicle_id}">
        <span class="track-row-dot" style="background:${dotColor}"></span>
        <span class="track-row-main">
          <span class="track-row-top"><strong>${VMTL.esc(v.vehicle_number)}</strong><span class="track-dist">${fmtDist(v._dist)}</span></span>
          <span class="track-row-sub">${VMTL.esc(sub)}</span>
          <span class="track-row-meta"><span class="track-chip ${v.stale ? 'stale' : (v.on_trip ? 'live' : 'idle')}">${status}</span><span class="dim">${VMTL.esc(v.org_unit_name || '')}</span><span class="dim">${fmtAge(v.age_seconds)}</span></span>
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
    if (state.gmap && v) { state.gmap.panTo({ lat: v.lat, lng: v.lng }); if (state.gmap.getZoom() < 14) state.gmap.setZoom(15); }
    if (entry && entry.info && state.gmap) { state.markers.forEach((e) => e.info && e.info.close()); entry.info.open(state.gmap, entry.marker); }
    renderList();
  }

  function infoHtml(v) {
    const rows = [
      v.driver_name && `<div><span class="dim">Driver</span> ${VMTL.esc(v.driver_name)}</div>`,
      v.trip_number && `<div><span class="dim">Trip</span> ${VMTL.esc(v.trip_number)}</div>`,
      v.destination && `<div><span class="dim">Destination</span> ${VMTL.esc(v.destination)}</div>`,
      v.org_unit_name && `<div><span class="dim">Unit</span> ${VMTL.esc(v.org_unit_name)}</div>`,
      typeof v.speed === 'number' && v.speed >= 0 && `<div><span class="dim">Speed</span> ${Math.round((v.speed || 0) * 3.6)} km/h</div>`,
      `<div><span class="dim">Updated</span> ${fmtAge(v.age_seconds)}</div>`,
    ].filter(Boolean).join('');
    return `<div class="track-info"><strong>${VMTL.esc(v.vehicle_number)}</strong><div class="track-info-sub">${VMTL.esc([v.make, v.model].filter(Boolean).join(' ') || v.registration_number)}</div>${rows}</div>`;
  }

  // ---- markers -------------------------------------------------------------
  function syncMarkers() {
    if (!state.gmap || !window.google) return;
    const g = window.google, seen = new Set();
    for (const v of state.vehicles) {
      seen.add(v.vehicle_id);
      const pos = { lat: v.lat, lng: v.lng };
      let entry = state.markers.get(v.vehicle_id);
      if (!entry) {
        const marker = new g.maps.Marker({ map: state.gmap, position: pos, icon: markerIcon(v), label: { text: v.vehicle_number, color: '#1b1b1b', fontSize: '11px', fontWeight: '600', className: 'track-mk-label' }, title: v.vehicle_number });
        const info = new g.maps.InfoWindow();
        marker.addListener('click', () => focusVehicle(v.vehicle_id));
        entry = { marker, info };
        state.markers.set(v.vehicle_id, entry);
      } else {
        entry.marker.setPosition(pos);
        entry.marker.setIcon(markerIcon(v));
      }
      entry.info.setContent(infoHtml(v));
    }
    for (const [id, entry] of state.markers) {
      if (!seen.has(id)) { entry.marker.setMap(null); state.markers.delete(id); }
    }
  }

  // ---- your location -------------------------------------------------------
  function startGeo() {
    const youEl = document.getElementById('trackYou');
    if (!('geolocation' in navigator) || !window.isSecureContext) { if (youEl) youEl.textContent = 'Location unavailable — distances are hidden.'; return; }
    state.geoWatch = navigator.geolocation.watchPosition((pos) => {
      state.you = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (youEl) youEl.textContent = 'Showing distance from your location.';
      if (state.gmap && window.google) {
        const g = window.google;
        if (!state.youMarker) {
          state.youMarker = new g.maps.Marker({ map: state.gmap, position: state.you, zIndex: 999,
            icon: { path: g.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }, title: 'You' });
        } else state.youMarker.setPosition(state.you);
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

  if (!state.config.has_key) {
    const cta = state.config.can_configure
      ? '<a class="btn btn-primary" href="/maps-config.html">Set up Google Maps</a><p class="dim" style="margin-top:8px">The live list below works without the map.</p>'
      : '<p class="dim">Ask your System Administrator to set up Google Maps on the Maps configuration page. The live list below still works.</p>';
    document.getElementById('trackMap').innerHTML = `<div class="track-map-empty"><p>The map needs a Google Maps API key.</p>${cta}</div>`;
  } else {
    await initMap();
    startGeo();
  }
  poll();
};

// Muted dark map styling to match the app's dark theme.
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1f2733' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1f2733' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa7b8' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3747' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#b7c2d0' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17202b' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];
