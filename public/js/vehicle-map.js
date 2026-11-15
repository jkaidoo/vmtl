'use strict';
// Shared vehicle map layer for the live fleet map and trip detail. Built on
// MapLibre GL JS with free, keyless basemaps (OpenFreeMap for light, CARTO
// dark-matter for dark). Markers use the uploaded vehicle graphic for every
// vehicle; a status dot carries the colour the fixed graphic can't.
(() => {
  const V = window.VMTL;

  // ---- vehicle marker artwork ----------------------------------------------
  // Top-down silhouette, kept for the trip-progress graphic and list rows.
  const motif = type => /motorcycle|scooter|tricycle/.test(type) ? 'motorcycle' : /truck|tractor|excavator|loader|forklift|trailer|recovery|fire_engine/.test(type) ? 'truck' : /bus|van|mpv|ambulance/.test(type) ? 'bus' : /pickup|utility/.test(type) ? 'pickup' : /suv|crossover/.test(type) ? 'suv' : 'car';
  V.vehicleMarkerSvg = (vehicle = {}) => {
    const kind = motif(vehicle.vehicle_type || '');
    const color = vehicle.stale ? '#8993a1' : vehicle.on_trip ? '#009540' : '#1f5fd0';
    const height = kind === 'bus' || kind === 'truck' ? 38 : kind === 'suv' || kind === 'pickup' ? 34 : kind === 'motorcycle' ? 29 : 31;
    const width = kind === 'motorcycle' ? 10 : kind === 'bus' || kind === 'truck' || kind === 'suv' ? 22 : 19;
    const x = 32 - width / 2, y = 32 - height / 2;
    const body = kind === 'motorcycle'
      ? `<rect x="29" y="11" width="6" height="12" rx="3" fill="#263342"/><rect x="29" y="41" width="6" height="12" rx="3" fill="#263342"/><path d="M32 18v29M22 24l10-3 10 3" stroke="${color}" stroke-width="3" fill="none"/><ellipse cx="32" cy="30" rx="6" ry="9" fill="${color}" stroke="white"/><rect x="28" y="33" width="8" height="10" rx="3" fill="#263342"/>`
      : `<rect x="${x - 3}" y="${y + 5}" width="4" height="8" rx="1" fill="#263342"/><rect x="${x + width - 1}" y="${y + 5}" width="4" height="8" rx="1" fill="#263342"/><rect x="${x - 2}" y="${y + height - 10}" width="4" height="7" rx="1" fill="#263342"/><rect x="${x + width - 2}" y="${y + height - 10}" width="4" height="7" rx="1" fill="#263342"/><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${kind === 'bus' || kind === 'truck' ? 4 : 6}" fill="${color}" stroke="white" stroke-width="1.5"/><path d="M${x + 3} ${y + 7}h${width - 6}l-2 6h-${width - 10}z" fill="#d9f1ff"/><rect x="${x + 4}" y="${y + 15}" width="${width - 8}" height="${kind === 'pickup' || kind === 'truck' ? height - 19 : height - 23}" rx="2" fill="${kind === 'pickup' || kind === 'truck' ? '#263342' : '#e9f5ff'}"/><path d="M${x + 3} ${y + 3}h3m${width - 12} 0h3" stroke="#fff8c9" stroke-width="2"/>`;
    const heading = Number.isFinite(Number(vehicle.heading)) ? Number(vehicle.heading) : 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="rotate(${heading} 32 32)">${body}</g></svg>`;
  };

  // Status colour shared by the map marker dot and the list chips.
  V.vehicleStatusColor = v => v.stale ? '#8993a1' : v.on_trip ? '#009540' : '#1f5fd0';

  // The uploaded vehicle graphic as a MapLibre DOM marker element. Optional label
  // (the vehicle number) sits under the car, matching the evaluation demo.
  V.carMarkerEl = (vehicle = {}, { label } = {}) => {
    const el = document.createElement('div');
    el.className = 'vm-marker vm-car';
    el.innerHTML = V.carArtHtml(vehicle) + (label ? `<strong>${V.esc(label)}</strong>` : '');
    return el;
  };
  V.carArtHtml = (vehicle = {}) =>
    `<span class="vm-car-art"><img src="/img/vehicle-car.png" alt="" draggable="false"><i class="vm-dot" style="background:${V.vehicleStatusColor(vehicle)}"></i></span>`;

  // ---- basemap styles (free, keyless) --------------------------------------
  V.mapStyles = {
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  };
  V.mapStyleForTheme = () => {
    const t = document.documentElement.getAttribute('data-theme');
    const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? V.mapStyles.dark : V.mapStyles.light;
  };

  // Lazily inject MapLibre GL JS + CSS once (keeps non-map pages lean).
  V.loadMapLibre = () => {
    if (window.maplibregl) return Promise.resolve();
    if (window.__vmtlMapLibre) return window.__vmtlMapLibre;
    window.__vmtlMapLibre = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-maplibre]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'; css.dataset.maplibre = '1';
        document.head.appendChild(css);
      }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('The map library could not be loaded. Check your connection.'));
      document.head.appendChild(s);
    });
    return window.__vmtlMapLibre;
  };

  // Swap the basemap style when the app theme changes. Markers are DOM elements,
  // so they survive setStyle. Returns a cleanup function.
  V.watchMapTheme = map => {
    const update = () => { try { map.setStyle(V.mapStyleForTheme()); } catch (_) { /* map gone */ } };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  };

  // Compact attribution: a single "i" button that stays collapsed by default and
  // expands only when clicked. MapLibre's compact control starts open, so we strip
  // the "show" class on each style load (initial + theme swaps), not on pan/click.
  V.compactAttribution = map => {
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    const collapse = () => { const el = map.getContainer().querySelector('.maplibregl-ctrl-attrib'); if (el) el.classList.remove('maplibregl-compact-show'); };
    collapse();
    map.on('styledata', e => { if (!e || e.dataType === 'style') collapse(); });
  };

  // ---- geometry helpers ----------------------------------------------------
  // A circle approximated as a GeoJSON polygon (for geofence rendering).
  V.circleGeoJSON = (lat, lng, radiusM, steps = 64) => {
    const coords = [];
    const R = 6371000, latR = lat * Math.PI / 180;
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * 2 * Math.PI;
      const dLat = (radiusM * Math.cos(theta)) / R * 180 / Math.PI;
      const dLng = (radiusM * Math.sin(theta)) / (R * Math.cos(latR)) * 180 / Math.PI;
      coords.push([lng + dLng, lat + dLat]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
  };

  // ---- trip route playback -------------------------------------------------
  // Draws a completed/in-progress trip's breadcrumb trail and animates a marker
  // along it. `host` must contain [data-route-map], [data-route-status] and the
  // playback controls [data-route-play], [data-route-slider].
  V.mountTripRoute = async (host, tripId) => {
    const panel = host.querySelector('[data-route-map]'), status = host.querySelector('[data-route-status]');
    const playBtn = host.querySelector('[data-route-play]'), slider = host.querySelector('[data-route-slider]');
    let map, stopTheme, raf, playing = false;
    const stop = () => { playing = false; if (raf) cancelAnimationFrame(raf); if (stopTheme) stopTheme(); if (map) map.remove(); };
    V.onLeave(stop);
    let route;
    try { route = (await V.api(`/trips/${tripId}/route`)).data; }
    catch (e) { status.textContent = e.message; return; }
    const pts = route.points || [];
    if (pts.length < 2) { status.textContent = pts.length ? 'Only one GPS point was recorded for this trip.' : 'No route was recorded for this trip. The driver must run the trip with location sharing on.'; panel.innerHTML = '<div class="empty">No route history.</div>'; return; }
    await V.loadMapLibre();
    const line = pts.map((p) => [Number(p.longitude), Number(p.latitude)]);
    const bounds = line.reduce((b, c) => [[Math.min(b[0][0], c[0]), Math.min(b[0][1], c[1])], [Math.max(b[1][0], c[0]), Math.max(b[1][1], c[1])]], [[180, 90], [-180, -90]]);
    panel.innerHTML = '';
    map = new maplibregl.Map({ container: panel, style: V.mapStyleForTheme(), bounds, fitBoundsOptions: { padding: 40 }, attributionControl: false });
    V.compactAttribution(map); map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    stopTheme = V.watchMapTheme(map);
    const marker = new maplibregl.Marker({ color: '#1f5fd0' }).setLngLat(line[0]);
    const addLayers = () => {
      if (map.getSource('route')) return;
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: line } } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#1f5fd0', 'line-width': 4, 'line-opacity': 0.85 } });
      // Geofence crossing markers.
      (route.geofence_events || []).forEach((e) => {
        if (e.latitude == null) return;
        const breach = (e.kind === 'exclusion' && e.event_type === 'enter') || (e.kind === 'inclusion' && e.event_type === 'exit');
        new maplibregl.Marker({ color: breach ? '#c0392b' : '#d99400' }).setLngLat([Number(e.longitude), Number(e.latitude)])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setText(`${e.name}: ${e.event_type}`)).addTo(map);
      });
      marker.addTo(map);
    };
    map.on('load', addLayers);
    slider.max = String(pts.length - 1); slider.value = '0';
    const at = (i) => {
      marker.setLngLat(line[i]);
      const p = pts[i];
      status.textContent = `Point ${i + 1} / ${pts.length} · ${V.fmtDateTime(p.recorded_at)}${p.speed != null ? ` · ${(Number(p.speed) * 3.6).toFixed(0)} km/h` : ''}`;
    };
    slider.oninput = () => { playing = false; playBtn.textContent = '▶'; at(Number(slider.value)); };
    at(0);
    const tick = () => {
      if (!playing) return;
      let i = Number(slider.value);
      if (i >= pts.length - 1) { playing = false; playBtn.textContent = '▶'; return; }
      i += 1; slider.value = String(i); at(i);
      raf = setTimeout(() => requestAnimationFrame(tick), 280);
    };
    playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? '❚❚' : '▶'; if (playing) { if (Number(slider.value) >= pts.length - 1) { slider.value = '0'; } tick(); } };
    status.textContent = `${pts.length} GPS points · ${V.fmtDateTime(pts[0].recorded_at)} → ${V.fmtDateTime(pts[pts.length - 1].recorded_at)}`;
  };

  // ---- trip detail live map ------------------------------------------------
  V.mountTripMap = (host, tripId) => {
    let timer, stopped = false, map, marker, stopTheme;
    const panel = host.querySelector('[data-trip-map]'), status = host.querySelector('[data-map-status]'), detail = host.querySelector('[data-map-detail]');
    const stop = () => { stopped = true; clearTimeout(timer); if (marker) marker.remove(); if (stopTheme) stopTheme(); if (map) map.remove(); };
    V.onLeave(stop);
    async function poll() {
      if (stopped || !host.isConnected) return stop();
      try {
        const result = await V.api(`/trips/${tripId}/location`);
        if (stopped || !host.isConnected) return stop();
        const position = result.data;
        status.textContent = result._stale ? 'Offline · last known' : position ? position.stale || result.trip_status !== 'in_progress' ? 'Last known location' : 'Live · updates every 5s' : 'Awaiting GPS';
        if (!position) { panel.innerHTML = '<div class="empty">No GPS fix for this trip yet. The assigned driver must start the trip and allow location sharing.</div>'; detail.textContent = 'A previous trip’s location is never shown here.'; }
        else {
          await V.loadMapLibre();
          if (stopped || !host.isConnected) return stop();
          const point = [Number(position.lng), Number(position.lat)];
          if (!map) {
            panel.innerHTML = '';
            map = new maplibregl.Map({ container: panel, style: V.mapStyleForTheme(), center: point, zoom: 15, attributionControl: false });
            V.compactAttribution(map);
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
            stopTheme = V.watchMapTheme(map);
          }
          if (!marker) marker = new maplibregl.Marker({ element: V.carMarkerEl(position, { label: position.vehicle_number }), anchor: 'center' }).setLngLat(point).addTo(map);
          else marker.setLngLat(point);
          map.easeTo({ center: point, duration: 600 });
          detail.textContent = `${position.vehicle_number} · Last reported ${V.fmtDateTime(position.recorded_at)}${position.speed != null ? ` · ${(Number(position.speed) * 3.6).toFixed(1)} km/h` : ''}${position.accuracy != null ? ` · GPS accuracy ±${Math.round(position.accuracy)} m` : ''}`;
        }
      } catch (error) { status.textContent = 'Tracking unavailable'; detail.textContent = error.message; if (!map) panel.innerHTML = '<div class="empty">Live tracking is temporarily unavailable.</div>'; }
      if (!stopped && host.isConnected) timer = setTimeout(poll, 5000);
    }
    poll();
  };
})();
