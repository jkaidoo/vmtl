'use strict';
// Live tracking API.
//   POST /tracking/location  — a driver device reports a GPS fix (attached to
//                              their in-progress trip's vehicle; ignored otherwise).
//   GET  /tracking/vehicles  — scoped live positions for the map.
//   GET  /tracking/config    — Google Maps key + viewer's start position.
//   PUT  /tracking/config    — set the Google Maps key (System Administrator).
const tracking = require('../../services/tracking');
const settings = require('../../services/settings');
const { CAP } = require('../../services/capabilities');
const { requireAuth, requireAnyCap, requireSuper } = require('../../middleware/auth');

const MAP_KEY = 'google_maps_api_key';
const MAP_CENTER = 'map_default_center'; // "lat,lng" fallback when the viewer blocks geolocation
const MAP_ZOOM = 'map_default_zoom';
const DEFAULT_CENTER = { lat: 6.6745, lng: -1.5716 }; // KNUST, Kumasi
const DEFAULT_ZOOM = 13;

// Users who may watch the fleet: anyone who manages vehicles or sees analytics.
const canView = requireAnyCap(CAP.VEHICLES_MANAGE, CAP.ANALYTICS_VIEW);

function parseCenter(raw) {
  if (!raw) return DEFAULT_CENTER;
  const m = String(raw).split(',').map((n) => Number(n.trim()));
  if (m.length === 2 && Number.isFinite(m[0]) && m[0] >= -90 && m[0] <= 90 && Number.isFinite(m[1]) && m[1] >= -180 && m[1] <= 180) return { lat: m[0], lng: m[1] };
  return DEFAULT_CENTER;
}
function parseZoom(raw) { const z = parseInt(raw, 10); return Number.isFinite(z) && z >= 3 && z <= 20 ? z : DEFAULT_ZOOM; }

module.exports = function register(router) {
  // Driver device → latest fix. Any signed-in user may post; it only sticks when
  // they are the driver on an in-progress trip. { tracked:false } = stand down.
  router.post('/tracking/location', requireAuth, async (req, res) => {
    const result = await tracking.recordDriverFix(req.session.user, req.body || {});
    res.json(result);
  });

  router.get('/tracking/vehicles', requireAuth, canView, async (req, res) => {
    const vehicles = await tracking.visibleVehicles(req.session.user);
    res.json({ data: vehicles, server_time: new Date().toISOString(), stale_after_seconds: tracking.STALE_AFTER_SECONDS });
  });

  router.get('/tracking/config', requireAuth, canView, async (req, res) => {
    const key = (await settings.get(MAP_KEY, '')) || '';
    res.json({
      has_key: !!key,
      key, // a Maps JS key is a referrer-restricted client key — safe to hand the browser
      can_configure: !!req.session.user.is_super_admin,
      default_center: parseCenter(await settings.get(MAP_CENTER, '')),
      default_zoom: parseZoom(await settings.get(MAP_ZOOM, '')),
    });
  });

  router.put('/tracking/config', requireAuth, requireSuper, async (req, res) => {
    if (typeof req.body.key === 'string') await settings.set(MAP_KEY, req.body.key.trim());
    if (typeof req.body.default_center === 'string') await settings.set(MAP_CENTER, req.body.default_center.trim());
    if (req.body.default_zoom !== undefined && req.body.default_zoom !== null && req.body.default_zoom !== '') {
      await settings.set(MAP_ZOOM, String(parseZoom(req.body.default_zoom)));
    }
    const key = (await settings.get(MAP_KEY, '')) || '';
    res.json({ has_key: !!key, key, default_center: parseCenter(await settings.get(MAP_CENTER, '')), default_zoom: parseZoom(await settings.get(MAP_ZOOM, '')) });
  });
};
