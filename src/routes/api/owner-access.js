'use strict';
// Owner page access — the App Owner shares selected owner pages with roles or
// named people. Access is explicitly delegated by the App Owner.
const { requireAuth } = require('../../middleware/auth');
const ownerAccess = require('../../services/ownerAccess');
const audit = require('../../services/audit');

module.exports = function register(router) {
  router.get('/admin/owner-access', requireAuth, ownerAccess.requirePage('owner-access'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await ownerAccess.overview() });
  });
  router.put('/admin/owner-access', requireAuth, ownerAccess.requirePage('owner-access'), async (req, res) => {
    const { before, after } = await ownerAccess.save(req.body);
    const summary = Object.entries(after).map(([key, g]) => `${ownerAccess.DELEGABLE[key].label}: ${g.roles.length} role(s), ${g.users.length} person(s)`).join('; ');
    await audit.from(req, { action: 'owner_access.updated', description: `Updated owner page access — ${summary}`, oldValues: before, newValues: after });
    res.json({ data: await ownerAccess.overview() });
  });
};
