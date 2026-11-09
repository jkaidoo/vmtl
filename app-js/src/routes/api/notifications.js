'use strict';
// In-app notifications for the bell.
const notifications = require('../../services/notifications');
const { requireAuth } = require('../../middleware/auth');

module.exports = function register(router) {
  router.get('/notifications', requireAuth, async (req, res) => {
    const items = await notifications.listForUser(req.session.user.id, { limit: Math.min(100, Number(req.query.limit) || 50) });
    res.json({ data: items, unread_count: await notifications.unreadCount(req.session.user.id) });
  });
  router.post('/notifications/:id/read', requireAuth, async (req, res) => {
    await notifications.markRead(req.session.user.id, req.params.id);
    res.json({ ok: true, unread_count: await notifications.unreadCount(req.session.user.id) });
  });
  router.post('/notifications/read-all', requireAuth, async (req, res) => {
    await notifications.markAllRead(req.session.user.id);
    res.json({ ok: true, unread_count: 0 });
  });
};
