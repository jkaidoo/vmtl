'use strict';
// Shared vehicle artwork for the live fleet map, trip view and marker preview.
(() => {
  const V = window.VMTL;
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
  V.vehicleMapIcon = vehicle => ({ url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(V.vehicleMarkerSvg(vehicle)), scaledSize: new google.maps.Size(56, 56), anchor: new google.maps.Point(28, 28), labelOrigin: new google.maps.Point(28, 57) });
  // One palette for the fleet and trip maps, based on the marker-preview render.
  // Embedded Maps JavaScript styling: https://developers.google.com/maps/documentation/javascript/style-reference
  V.vehicleMapOptions = () => {
    const theme = document.documentElement.getAttribute('data-theme');
    const dark = theme === 'dark' || theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const palette = dark
      ? { land: '#1c2521', built: '#27312c', park: '#243d2d', road: '#3b4942', edge: '#202b25', text: '#a9b9ac', water: '#203b46' }
      : { land: '#edf1e8', built: '#e0e2dc', park: '#dbe8d3', road: '#ffffff', edge: '#d8dcd6', text: '#788276', water: '#cbdfe3' };
    return {
      mapTypeId: 'roadmap', mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
      clickableIcons: false, tilt: 0, backgroundColor: palette.land,
      styles: [
        { elementType: 'geometry', stylers: [{ color: palette.land }] },
        { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: palette.text }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: palette.land }, { weight: 3 }] },
        { featureType: 'landscape.man_made', elementType: 'geometry.fill', stylers: [{ color: palette.built }] },
        { featureType: 'poi', elementType: 'geometry.fill', stylers: [{ color: palette.built }] },
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: palette.park }] },
        { featureType: 'poi.park', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
        { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: palette.road }] },
        { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: palette.edge }, { weight: 1 }] },
        { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: palette.text }] },
        { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: palette.road }, { weight: 3 }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
        { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: palette.water }] },
      ],
    };
  };
  V.watchMapTheme = map => {
    const update = () => map.setOptions(V.vehicleMapOptions());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  };
  V.loadMaps = key => {
    if (window.google?.maps) return Promise.resolve();
    if (window.__vmtlMapsPromise) return window.__vmtlMapsPromise;
    window.__vmtlMapsPromise = new Promise((resolve, reject) => {
      window.__vmtlMapsReady = resolve;
      window.gm_authFailure = () => reject(new Error('Google Maps rejected the configured key.'));
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__vmtlMapsReady`;
      script.onerror = () => reject(new Error('Google Maps could not load. Check your connection.'));
      document.head.appendChild(script);
    });
    return window.__vmtlMapsPromise;
  };
  V.mountTripMap = (host, tripId) => {
    let timer, stopped = false, map, marker, stopTheme;
    const panel = host.querySelector('[data-trip-map]'), status = host.querySelector('[data-map-status]'), detail = host.querySelector('[data-map-detail]');
    const stop = () => { stopped = true; clearTimeout(timer); marker?.setMap(null); stopTheme?.(); };
    V.onLeave(stop);
    async function poll() {
      if (stopped || !host.isConnected) return stop();
      try {
        const result = await V.api(`/trips/${tripId}/location`);
        if (stopped || !host.isConnected) return stop();
        const position = result.data;
        status.textContent = result._stale ? 'Offline · last known' : position ? position.stale || result.trip_status !== 'in_progress' ? 'Last known location' : 'Live · updates every 5s' : 'Awaiting GPS';
        if (!position) { panel.innerHTML = '<div class="empty">No GPS fix for this trip yet. The assigned driver must start the trip and allow location sharing.</div>'; detail.textContent = 'A previous trip’s location is never shown here.'; }
        else if (!result.config.has_key) { panel.innerHTML = '<div class="empty">Configure Google Maps in System → Maps configuration to display the live map.</div>'; detail.textContent = `Last reported ${V.fmtDateTime(position.recorded_at)}`; }
        else {
          await V.loadMaps(result.config.key);
          if (stopped || !host.isConnected) return stop();
          const point = { lat: Number(position.lat), lng: Number(position.lng) };
          if (!map) { panel.innerHTML = ''; map = new google.maps.Map(panel, { ...V.vehicleMapOptions(), center: point, zoom: 16 }); stopTheme = V.watchMapTheme(map); }
          if (!marker) marker = new google.maps.Marker({ map, position: point, title: position.vehicle_number, icon: V.vehicleMapIcon(position) });
          else { marker.setPosition(point); marker.setIcon(V.vehicleMapIcon(position)); }
          map.panTo(point);
          detail.textContent = `${position.vehicle_number} · Last reported ${V.fmtDateTime(position.recorded_at)}${position.speed != null ? ` · ${(Number(position.speed) * 3.6).toFixed(1)} km/h` : ''}${position.accuracy != null ? ` · GPS accuracy ±${Math.round(position.accuracy)} m` : ''}`;
        }
      } catch (error) { status.textContent = 'Tracking unavailable'; detail.textContent = error.message; if (!map) panel.innerHTML = '<div class="empty">Live tracking is temporarily unavailable.</div>'; }
      if (!stopped && host.isConnected) timer = setTimeout(poll, 5000);
    }
    poll();
  };
})();
