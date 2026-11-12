'use strict';
// Maps configuration (System Administrator). Set up the Google Maps integration
// that powers the Live map: the Maps JavaScript API key, the default map centre
// and zoom. Includes a live "test map" that renders with the saved key so the
// admin can confirm it works before relying on it, plus a setup checklist.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Maps configuration', 'Connect Google Maps so the Live map can plot your fleet.') +
    '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';

  let cfg;
  try { cfg = await VMTL.api('/tracking/config'); }
  catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }

  const center = cfg.default_center || { lat: 6.6745, lng: -1.5716 };
  const statusPill = (ok) => ok
    ? '<span class="badge green">Connected</span>'
    : '<span class="badge amber">Not configured</span>';

  view.querySelector('#b').innerHTML = `
    <div class="card pad mb">
      <div class="row between center wrap gap-sm">
        <div>
          <div class="row center gap-sm"><strong style="font-size:15px">Google Maps integration</strong> <span id="mcStatus">${statusPill(cfg.has_key)}</span></div>
          <p class="dim" style="margin:4px 0 0;font-size:13px">The Maps JavaScript API renders the map; vehicle positions come from driver devices.</p>
        </div>
        <a class="btn" href="/tracking.html">${VMTL.icon('map')} Open Live map</a>
      </div>
    </div>

    <div class="card pad mb">
      <h3 style="margin:0 0 12px">API key</h3>
      <div class="field">
        <label>Google Maps JavaScript API key</label>
        <div class="row gap-sm center">
          <input id="mcKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${VMTL.esc(cfg.key || '')}" style="flex:1;min-width:220px">
          <button type="button" class="btn btn-sm" id="mcReveal">Show</button>
        </div>
        <p class="dim" style="margin:6px 0 0;font-size:12px">Stored on the server and served only to signed-in users who can view the map. Restrict the key by HTTP referrer in Google Cloud.</p>
      </div>
      <div class="form-grid mt">
        <div class="field"><label>Default centre — latitude</label><input id="mcLat" type="number" step="0.0001" min="-90" max="90" value="${center.lat}"></div>
        <div class="field"><label>Default centre — longitude</label><input id="mcLng" type="number" step="0.0001" min="-180" max="180" value="${center.lng}"></div>
        <div class="field"><label>Default zoom (3–20)</label><input id="mcZoom" type="number" min="3" max="20" value="${cfg.default_zoom || 13}"></div>
      </div>
      <div class="row gap-sm wrap" style="margin-top:4px">
        <button type="button" class="btn btn-sm" id="mcHere">${VMTL.icon('map')} Use my location</button>
        <button type="button" class="btn btn-sm btn-ghost" id="mcReset">Reset centre to KNUST</button>
      </div>
      <div class="mt"><button class="btn btn-primary" id="mcSave">Save configuration</button></div>
    </div>

    <div class="card pad mb">
      <div class="row between center wrap gap-sm">
        <h3 style="margin:0">Test map</h3>
        <button type="button" class="btn btn-sm" id="mcTest">Load test map</button>
      </div>
      <p class="dim" style="margin:6px 0 10px;font-size:13px">Renders a live Google Map with the saved key and centre. If it loads, the Live map will work.</p>
      <div id="mcTestMap" class="track-map" style="height:300px"><div class="track-map-empty"><p>Save a key, then load the test map.</p></div></div>
    </div>

    <div class="card pad">
      <h3 style="margin:0 0 10px">How to get a key</h3>
      <ol class="mc-steps">
        <li>Open the <strong>Google Cloud Console</strong> and create (or pick) a project.</li>
        <li>In <strong>APIs &amp; Services → Library</strong>, enable the <strong>Maps JavaScript API</strong>.</li>
        <li>In <strong>APIs &amp; Services → Credentials</strong>, choose <strong>Create credentials → API key</strong>.</li>
        <li>Edit the key → <strong>Application restrictions → HTTP referrers</strong> and add this site (e.g. <code id="mcReferrer"></code>).</li>
        <li>Under <strong>API restrictions</strong>, limit it to the <strong>Maps JavaScript API</strong>.</li>
        <li>Copy the key, paste it above, and <strong>Save</strong>. Billing must be enabled on the Google Cloud project.</li>
      </ol>
    </div>`;

  // Referrer hint for the restriction step.
  const ref = view.querySelector('#mcReferrer');
  if (ref) ref.textContent = `${location.origin}/*`;

  // ---- reveal / helpers ----------------------------------------------------
  const keyEl = view.querySelector('#mcKey');
  view.querySelector('#mcReveal').onclick = (e) => {
    const show = keyEl.type === 'password';
    keyEl.type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Hide' : 'Show';
  };
  view.querySelector('#mcReset').onclick = () => { view.querySelector('#mcLat').value = 6.6745; view.querySelector('#mcLng').value = -1.5716; };
  view.querySelector('#mcHere').onclick = () => {
    if (!('geolocation' in navigator)) return VMTL.toast('Geolocation is not available here.', 'err');
    navigator.geolocation.getCurrentPosition(
      (p) => { view.querySelector('#mcLat').value = p.coords.latitude.toFixed(5); view.querySelector('#mcLng').value = p.coords.longitude.toFixed(5); VMTL.toast('Centre set to your location.', 'success'); },
      () => VMTL.toast('Could not get your location.', 'err'), { enableHighAccuracy: true, timeout: 12000 });
  };

  const readForm = () => ({
    key: keyEl.value.trim(),
    default_center: `${Number(view.querySelector('#mcLat').value)},${Number(view.querySelector('#mcLng').value)}`,
    default_zoom: Number(view.querySelector('#mcZoom').value),
  });

  // ---- save ----------------------------------------------------------------
  view.querySelector('#mcSave').onclick = async () => {
    const btn = view.querySelector('#mcSave'); btn.disabled = true;
    try {
      cfg = await VMTL.api('/tracking/config', { method: 'PUT', body: readForm() });
      view.querySelector('#mcStatus').innerHTML = statusPill(cfg.has_key);
      VMTL.toast('Maps configuration saved.', 'success');
    } catch (e) { VMTL.showErrors(e); }
    finally { btn.disabled = false; }
  };

  // ---- test map ------------------------------------------------------------
  view.querySelector('#mcTest').onclick = async () => {
    const box = view.querySelector('#mcTestMap');
    const key = keyEl.value.trim();
    if (!key) { box.innerHTML = '<div class="track-map-empty"><p>Enter and save a key first.</p></div>'; return; }
    box.innerHTML = '<div class="track-map-empty"><span class="spinner"></span><p>Loading test map…</p></div>';
    try {
      await loadMaps(key);
      const g = window.google;
      box.innerHTML = '';
      const map = new g.maps.Map(box, { center: { lat: Number(view.querySelector('#mcLat').value), lng: Number(view.querySelector('#mcLng').value) }, zoom: Number(view.querySelector('#mcZoom').value) || 13, mapTypeControl: false, streetViewControl: false });
      new g.maps.Marker({ map, position: map.getCenter(), title: 'Default centre' });
      VMTL.toast('Test map loaded — the key works.', 'success');
    } catch (err) {
      const why = err && err.message === 'auth'
        ? 'The key was rejected. Check that the Maps JavaScript API is enabled, billing is on, and the referrer restriction allows this site.'
        : err && err.message === 'reload'
          ? 'Google Maps was already loaded with a different key on this page. Reload the page, then test again.'
          : 'Google Maps could not load. Check the key and your connection.';
      box.innerHTML = `<div class="track-map-empty"><p>${VMTL.esc(why)}</p></div>`;
      VMTL.toast('Test map failed.', 'err');
    }
  };

  // Loads the Maps JS once. A page can only load one key, so a second, different
  // key on the same page is reported as needing a reload.
  function loadMaps(key) {
    if (window.google && window.google.maps) {
      if (window.__vmtlMapsKey && window.__vmtlMapsKey !== key) return Promise.reject(new Error('reload'));
      return Promise.resolve();
    }
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
};
