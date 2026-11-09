'use strict';
// Email delivery. Uses nodemailer with the SMTP settings saved in system_settings
// when it is installed and configured; otherwise logs the message (the dev
// "log mailer" equivalent), so the app runs without an SMTP dependency.
const settings = require('./settings');
const log = require('../util/log');

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

async function send(to, subject, body) {
  if (!to) return { ok: false, message: 'No recipient.' };
  const prefix = await settings.get('notif_email_subject_prefix', '[UITS VMTL] ');
  const fromAddress = await settings.get('mail_from_address', 'uits@knust.edu.gh');
  const fromName = await settings.get('mail_from_name', 'UITS VMTL');
  const t = await transport();
  if (!t) { log.info('email_logged', { to, subject: `${prefix}${subject}` }); return { ok: true, message: `Logged (no SMTP transport): ${to}` }; }
  try {
    await t.sendMail({ from: `"${fromName}" <${fromAddress}>`, to, subject: `${prefix}${subject}`, text: body });
    return { ok: true, message: `Sent to ${to}.` };
  } catch (err) { log.warn('email_failed', { message: err.message }); return { ok: false, message: `Failed: ${err.message}` }; }
}

module.exports = { send };
