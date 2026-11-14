'use strict';
// Email delivery. Uses nodemailer with the SMTP settings saved in system_settings
// when it is installed and configured; otherwise logs the message (the dev
// "log mailer" equivalent), so the app runs without an SMTP dependency.
const settings = require('./settings');
const log = require('../util/log');
const DEFAULT_API_URL = 'https://tekmail-hub.knust.edu.gh/api/v1/email/send';
async function config() {
  const savedKey = String(await settings.get('mail_api_key', '')).trim();
  return {
    api_url: String(await settings.get('mail_api_url', '') || process.env.MAIL_API_URL || DEFAULT_API_URL).trim(),
    api_key: savedKey || String(process.env.MAIL_API_KEY || '').trim(),
    app_id: String(await settings.get('mail_app_id', '') || process.env.MAIL_APP_ID || 'UITS VMTL').trim(),
    channel: String(await settings.get('mail_channel', '') || process.env.MAIL_CHANNEL || 'VMTL').trim(),
    key_source: savedKey ? 'saved' : process.env.MAIL_API_KEY ? 'env' : '',
    enabled: [true, 1, '1', 'true'].includes(await settings.get('mail_enabled', false)),
  };
}

async function transport() {
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch (_) { return null; }
  const host = await settings.get('mail_host', '');
  if (!host) return null;
  const encryption = await settings.get('mail_encryption', 'tls');
  return nodemailer.createTransport({
    host, port: Number(await settings.get('mail_port', 587)),
    secure: encryption === 'ssl',
    auth: (await settings.get('mail_username', '')) ? { user: await settings.get('mail_username', ''), pass: await settings.get('mail_password', '') } : undefined,
  });
}

async function send(to, subject, body, { html, force = false, hub = false } = {}) {
  if (!to) return { ok: false, message: 'No recipient.' };
  const prefix = await settings.get('notif_email_subject_prefix', '[UITS VMTL] ');
  const cfg = await config();
  // Existing SMTP installations keep their transport until a hub key is saved.
  if (hub || cfg.api_key || !(await settings.get('mail_host', ''))) {
    if ((!cfg.enabled && !force) || !cfg.api_key) return { ok: false, message: cfg.api_key ? 'Email is switched off.' : 'Set the Tekmail API key first.' };
    const recipients = [...new Set(String(to).split(/[,;\s]+/).filter(Boolean))];
    if (!recipients.length || recipients.some(value => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))) return { ok: false, message: 'Enter valid recipient email addresses.' };
    try {
      const content = html || require('./emailLayout').render({ subject: `${prefix}${subject}`, title: subject, text: body, appUrl: process.env.APP_URL });
      const response = await fetch(cfg.api_url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': cfg.api_key },
        body: JSON.stringify({ appId: cfg.app_id, channel: cfg.channel, recipients, body: { contentType: 'html', content }, subject: `${prefix}${subject}`.slice(0, 300) }), signal: AbortSignal.timeout(15000) });
      const data = await response.json().catch(() => ({}));
      const ok = response.ok && data?.success !== false && data?.isSuccess !== false && !['error', 'failed', 'failure', 'fail'].includes(String(data?.status || '').toLowerCase());
      return { ok, message: ok ? `Sent via Tekmail to ${recipients.join(', ')}.` : `Tekmail rejected the message (HTTP ${response.status}). Check the connection and API key.` };
    } catch (err) { log.warn('email_failed', { message: err.name }); return { ok: false, message: 'Tekmail delivery failed. Check the connection and try again.' }; }
  }
  const fromAddress = await settings.get('mail_from_address', 'uits@knust.edu.gh');
  const fromName = await settings.get('mail_from_name', 'UITS VMTL');
  const t = await transport();
  if (!t) { log.info('email_logged', { to, subject: `${prefix}${subject}` }); return { ok: true, message: `Logged (no SMTP transport): ${to}` }; }
  try {
    const layout = require('./emailLayout');
    const designed = (html || layout.render({ subject: `${prefix}${subject}`, title: subject, text: body, unit: 'Vehicle Management & Trip Logging', kicker: 'Vehicle Management & Trip Logging', appUrl: process.env.APP_URL }))
      .replace(/src="[^"]*"(?= width="46" alt="KNUST")/, 'src="cid:knust-logo"');
    await t.sendMail({ from: `"${fromName}" <${fromAddress}>`, to, subject: `${prefix}${subject}`, text: body, html: designed, attachments: [{ filename: 'knust-logo.png', path: require('path').join(__dirname, '../../public/knust-logo.png'), cid: 'knust-logo' }] });
    return { ok: true, message: `Sent to ${to}.` };
  } catch (err) { log.warn('email_failed', { message: err.message }); return { ok: false, message: `Failed: ${err.message}` }; }
}

module.exports = { send, config, DEFAULT_API_URL };
