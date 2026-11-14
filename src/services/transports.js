'use strict';
// External notification transports (email / SMS / Web Push), fanned out from an
// in-app notification when the matching feature flag is on. Best-effort: a
// transport failure never breaks the originating action.
const db = require('./db_ref');
const settings = require('./settings');
const webPush = require('./webPush');
const sms = require('./sms');
const log = require('../util/log');

// Human-readable title/body for a notification type.
function describe(type, data) {
  const map = {
    new_request: ['New vehicle request', `Request ${data.request_number || ''} from ${data.requester || 'a requester'} needs review.`],
    request_approved: ['Request approved', `Your request ${data.request_number || ''} was approved.`],
    request_rejected: ['Request rejected', `Your request ${data.request_number || ''} was rejected.`],
    request_changes_requested: ['Changes requested', `Changes were requested on ${data.request_number || ''}.`],
    vehicle_assigned: ['Vehicle assigned', `${data.vehicle || 'A vehicle'} was assigned (trip ${data.trip_number || ''}).`],
    trip_completed: ['Trip completed', `Trip ${data.trip_number || ''} completed (${data.distance || 0} km).`],
    driver_ready: ['Driver ready', `The driver is ready for trip ${data.trip_number || ''}.`],
    trip_stop_requested: ['Added destination requested', `A destination "${data.destination || ''}" was added to ${data.trip_number || ''}.`],
    trip_stop_accepted: ['Added destination accepted', `"${data.destination || ''}" was accepted on ${data.trip_number || ''}.`],
    trip_stop_declined: ['Added destination declined', `"${data.destination || ''}" was declined on ${data.trip_number || ''}.`],
    trip_delay_warning: ['Possible delay', `Trip ${data.trip_number || ''} may be delayed.`],
    trip_rescheduled: ['Trip rescheduled', `Trip ${data.trip_number || ''} was rescheduled (${data.start || ''} to ${data.end || ''}).`],
    trip_cancelled: ['Trip cancelled', `Trip ${data.trip_number || ''} was cancelled.`],
  };
  return map[type] || [data.title || 'Notification', data.message || data.summary || ''];
}

async function fanout(userId, type, data) {
  data = data || {};
  const [title, body] = describe(type, data);
  // Web Push
  if (await settings.get('feature_push_notifications', true)) {
    try { await webPush.sendToUser(userId, { title, body, data }); } catch (err) { log.warn('push_fanout_failed', { message: err.message }); }
  }
  // Email (only when a recipient address is known and email is enabled)
  if (await settings.get('feature_email_notifications', true) && await settings.get('notif_allow_email', true) && await settings.get('mail_enabled', false)) {
    try {
      const user = await db.get('SELECT name, email FROM users WHERE id = ?', [userId]);
      const templates = require('./messageTemplates');
      const message = await templates.render('email', templates.has(type) ? type : 'notification', { ...data, recipient_name: user?.name || '', title, message: body });
      await require('./email').send(user?.email, message.subject, message.text, { html: message.html });
    } catch (err) { log.warn('email_fanout_failed', { message: err.message }); }
  }
  // SMS (opt-in; phone required)
  if (await settings.get('feature_sms_notifications', false) && await settings.get('notif_allow_sms', false) && await settings.get('sms_enabled', false)) {
    try {
      const user = await db.get('SELECT name, phone FROM users WHERE id = ?', [userId]);
      if (user?.phone) {
        const templates = require('./messageTemplates');
        const message = await templates.render('sms', templates.has(type) ? type : 'notification', { ...data, recipient_name: user.name, title, message: body });
        await sms.send(user.phone, message.text);
      }
    } catch (err) { log.warn('sms_fanout_failed', { message: err.message }); }
  }
}

module.exports = { fanout, describe };
