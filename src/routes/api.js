'use strict';
// API router. Domain routes live in ./api/<domain>.js and register onto this router.
const express = require('express');
const { asyncSafe } = require('../middleware/asyncSafe');

const router = asyncSafe(express.Router());

require('./api/auth')(router);
require('./api/meta')(router);
require('./api/fleet-operations')(router);
require('./api/event-schedules')(router);
require('./api/dashboard')(router);
require('./api/notifications')(router);
require('./api/push')(router);
require('./api/availability')(router);
require('./api/vehicle-requests')(router);
require('./api/trips')(router);
require('./api/vehicles')(router);
require('./api/drivers')(router);
require('./api/fuel')(router);
require('./api/tracking')(router);
require('./api/maintenance')(router);
require('./api/org-units')(router);
require('./api/users')(router);
require('./api/departments')(router);
require('./api/analytics')(router); // analytics + reports
require('./api/rbac')(router);
require('./api/audit')(router);
require('./api/backups')(router);
require('./api/admin')(router); // super-admin tier: app-health, system-controls, directory-auth, messaging, database, docs
require('./api/v1')(router); // public read API (Bearer token auth)

module.exports = router;
