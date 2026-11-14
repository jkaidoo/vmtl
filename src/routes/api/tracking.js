'use strict';
// Live tracking API.
//   POST /tracking/location  — a driver device reports a GPS fix (attached to
//                              their in-progress trip's vehicle; ignored otherwise).
//   GET  /tracking/vehicles  — scoped live positions for the map.
//   GET  /tracking/config    — the Live map's default centre/zoom (keyless basemap).
//   PUT  /tracking/config    — set the default centre/zoom (App Owner, or whoever Maps configuration is shared with).
const tracking = require('../../services/tracking');
const beaconToken = require('../../services/beaconToken');
const settings = require('../../services/settings');
const { CAP } = require('../../services/capabilities');
const { requireAuth, requireAnyCap, requireSystemAdmin } = require('../../middleware/auth');
// Owner and System pages: App Owner only, plus the roles/people the App Owner shares each page with (Owner page access).
const { requirePage: sharedPage, requireChannelPage: sharedChannel } = require('../../services/ownerAccess');

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
  // Driver device → scoped location-reporting token. Issued only while the driver
  // is on an in-progress trip; { active:false } tells the device to stand down.
  // This lets the frequent location beacon authenticate with a narrow, expiring
  // token instead of the full login session.
  router.post('/tracking/beacon-token', requireAuth, async (req, res) => {
    res.json(await tracking.issueBeacon(req.session.user));
  });

  // Driver device → latest fix. Authenticated by a scoped beacon token (the
  // normal path) or, as a fallback, the login session. Either way the fix only
  // sticks when the actor is a driver on an in-progress trip; { tracked:false }
  // (or { retoken:true } on an expired token) tells the device to stand down.
  router.post('/tracking/location', async (req, res, next) => {
    try {
      let actor = null;
      const raw = beaconToken.fromRequest(req);
      if (raw) {
        const claims = beaconToken.verify(raw);
        if (!claims) return res.status(401).json({ error: 'Tracking token expired.', retoken: true });
        actor = { id: claims.userId };
      } else if (req.session && req.session.user) {
        actor = req.session.user;
      } else {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      res.json(await tracking.recordDriverFix(actor, req.body || {}));
    } catch (err) { next(err); }
  });

  router.get('/tracking/vehicles', requireAuth, canView, async (req, res) => {
    const vehicles = await tracking.visibleVehicles(req.session.user);
    res.json({ data: vehicles, server_time: new Date().toISOString(), stale_after_seconds: tracking.STALE_AFTER_SECONDS });
  });

  // Readable by live-map viewers and by anyone who may open Maps configuration (incl. shared access).
  router.get('/tracking/config', requireAuth, async (req, res, next) => {
    if (await require('../../services/ownerAccess').can(req.session.user, 'maps-config')) return next();
    return canView(req, res, next);
  }, async (req, res) => {
    res.json({
      can_configure: await require('../../services/ownerAccess').can(req.session.user, 'maps-config'),
      default_center: parseCenter(await settings.get(MAP_CENTER, '')),
      default_zoom: parseZoom(await settings.get(MAP_ZOOM, '')),
    });
  });

  router.put('/tracking/config', requireAuth, sharedPage('maps-config'), async (req, res) => {
    if (typeof req.body.default_center === 'string') await settings.set(MAP_CENTER, req.body.default_center.trim());
    if (req.body.default_zoom !== undefined && req.body.default_zoom !== null && req.body.default_zoom !== '') {
      await settings.set(MAP_ZOOM, String(parseZoom(req.body.default_zoom)));
    }
    res.json({ default_center: parseCenter(await settings.get(MAP_CENTER, '')), default_zoom: parseZoom(await settings.get(MAP_ZOOM, '')) });
  });
};
