'use strict';
// SMS delivery (ports SmsService). Supports several Ghanaian providers; credentials
// live in system_settings (group 'messaging'). Sends only when SMS is enabled and
// the active provider is configured. Returns { ok, message } for test endpoints.
const settings = require('./settings');
const log = require('../util/log');

// Normalise a Ghana number to E.164 (+233XXXXXXXXX) from 0XXXXXXXXX / 233… / +233…
function toE164(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('233')) return `+${d}`;
  if (d.startsWith('0')) return `+233${d.slice(1)}`;
  if (d.length === 9) return `+233${d}`;
  return `+${d}`;
}

async function enabled() { return [true, 1, '1', 'true'].includes(await settings.get('sms_enabled', false)); }
async function activeProvider() { return (await settings.get('sms_provider', 'mnotify')) || 'mnotify'; }

async function send(to, message, { force = false } = {}) {
  if (!force && !(await enabled())) return { ok: false, message: 'SMS is not enabled.' };
  const provider = await activeProvider();
  const sender = (await settings.get('sms_sender_id', 'UITS')) || 'UITS';
  const number = toE164(to);
  try {
    if (provider === 'arkesel') {
      const key = await settings.get('arkesel_api_key', '');
      if (!key) return { ok: false, message: 'Arkesel API key is not set.' };
      const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', { method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ sender, message, recipients: [number.replace('+', '')] }) });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, message: res.ok ? `Sent via Arkesel to ${number}.` : `Arkesel error: ${JSON.stringify(body)}` };
    }
    if (provider === 'mnotify') {
      const key = await settings.get('sms_api_key', '') || await settings.get('mnotify_api_key', '') || process.env.SMS_API_KEY || '';
      if (!key) return { ok: false, message: 'mNotify API key is not set.' };
      const url = new URL(await settings.get('sms_api_url', '') || process.env.SMS_API_URL || 'https://api.mnotify.com/api/sms/quick'); url.searchParams.set('key', key);
      const res = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: [number.replace('+', '')], sender, message, is_schedule: 'false', schedule_date: '' }), signal: AbortSignal.timeout(10000) });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && (data.status === 'success' || String(data.code) === '2000');
      return { ok, message: ok ? `Sent via mNotify to ${number}.` : `mNotify rejected the message (HTTP ${res.status}). Check the API key and approved sender ID.` };
    }
    if (provider === 'hubtel') {
      const id = await settings.get('hubtel_client_id', ''); const secret = await settings.get('hubtel_client_secret', '');
      if (!id || !secret) return { ok: false, message: 'Hubtel credentials are not set.' };
      const url = `https://smsc.hubtel.com/v1/messages/send?clientid=${encodeURIComponent(id)}&clientsecret=${encodeURIComponent(secret)}&from=${encodeURIComponent(sender)}&to=${encodeURIComponent(number)}&content=${encodeURIComponent(message)}`;
      const res = await fetch(url);
      return { ok: res.ok, message: res.ok ? `Sent via Hubtel to ${number}.` : `Hubtel error (${res.status}).` };
    }
    if (provider === 'wigal') {
      const username = await settings.get('wigal_username', ''); const key = await settings.get('wigal_api_key', '');
      if (!username || !key) return { ok: false, message: 'Wigal credentials are not set.' };
      const res = await fetch('https://frogapi.wigal.com.gh/api/v3/sms/send', { method: 'POST', headers: { 'API-KEY': key, USERNAME: username, 'Content-Type': 'application/json' }, body: JSON.stringify({ senderid: sender, destinations: [{ destination: number.replace('+', ''), msgid: Date.now().toString() }], message }) });
      return { ok: res.ok, message: res.ok ? `Sent via Wigal to ${number}.` : `Wigal error (${res.status}).` };
    }
    return { ok: false, message: `Unknown SMS provider: ${provider}.` };
  } catch (err) { log.warn('sms_failed', { provider, message: err.message }); return { ok: false, message: `Failed: ${err.message}` }; }
}

module.exports = { send, enabled, activeProvider, toE164 };
