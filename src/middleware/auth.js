'use strict';
// Session-based authorisation guards. The signed-in user lives on req.session.user
// (a thin snapshot stamped at login); capabilities are resolved fresh from the DB
// on each check so RBAC edits take effect immediately. The break-glass System
// Administrator (is_super_admin) implicitly holds every capability.
const roleRepository = require('../services/roleRepository');

async function capsOf(user) {
  if (!user) return [];
  return roleRepository.capsForUser(user.id);
}
async function userHasCap(user, cap) { return (await capsOf(user)).includes(cap); }

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function requireCap(cap) {
  return async (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    try {
      if (req.session.user.is_super_admin || await userHasCap(req.session.user, cap)) return next();
      return res.status(403).json({ error: 'You do not have access to this.' });
    } catch (err) { return next(err); }
  };
}

function requireAnyCap(...caps) {
  return async (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    try {
      if (req.session.user.is_super_admin) return next();
      const held = await capsOf(req.session.user);
      if (held.some((c) => caps.includes(c))) return next();
      return res.status(403).json({ error: 'You do not have access to this.' });
    } catch (err) { return next(err); }
  };
}

// The break-glass tier: App Health, RBAC, System Controls, Directory Auth, etc.
function requireSuper(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.user.is_super_admin) return next();
  return res.status(403).json({ error: 'System Administrator access only.' });
}

module.exports = { capsOf, userHasCap, requireAuth, requireCap, requireAnyCap, requireSuper };
