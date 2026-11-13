'use strict';

// Branded HTML wrapper for every outgoing email, styled after the PDF reports
// (KNUST green, gold accent rule, small spaced capitals for labels).
//
// Email clients ignore most CSS, so everything is table-based with inline
// styles, and every gradient has a solid bgcolor fallback for Outlook.
//
// render({ subject, text, kicker, title, details, action, status })
//   text     the message body (the admin-editable template, already filled in)
//   details  [[label, value], ...] shown as a small summary table
//   action   { label, url } shown as a button; if omitted, a URL that sits on
//            its own line in the text becomes the button instead
//   status   { label, tone: 'ok' | 'warn' | 'info' } shown as a pill by the title
//   note     { label, text } a highlighted box for the staff member's own words
//   replyNote contact instructions shown in place of the no-reply notice
//            (for emails that ask the client to write back)
//   image    { src, alt, label, caption } a framed picture, e.g. a client's
//            signature (src: a public https address; a PNG data URL
//            only for in-app previews)

//   unit     the UITS unit in the header and footer (default IT Support
//            Center; hardware emails say Hardware Center)
//   appUrl   the app address set on the Email and SMS pages (for the crest)

const DEFAULT_APP_URL = String(process.env.APP_URL || 'http://localhost:8000').replace(/\/+$/, '');
// The crest must load in Gmail and Outlook, so it comes from the app address
// (ussd.knust.edu.gh has a publicly trusted certificate). EMAIL_LOGO_URL
// overrides it.
const logoUrl = (appUrl) => String(process.env.EMAIL_LOGO_URL || `${appUrl}/email-logo.png`).trim();

const C = {
  green: '#007b39', greenDark: '#005b2b', greenDeep: '#004b27', greenText: '#006e34',
  gold: '#f3bf32', goldText: '#f5d367', ink: '#17221a', body: '#2a352d', muted: '#68736b',
  faint: '#8a948c', line: '#dfe8e1', soft: '#eff6f0', page: '#eef2ef',
};
// Single quotes: this sits inside double-quoted style="" attributes.
const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";
const TONES = { ok: ['#e5f4ea', '#006e34'], warn: ['#fdf3d7', '#8a5a00'], info: ['#e6f0f8', '#1f5f8f'] };

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = (html) => html.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:${C.green};text-decoration:underline;word-break:break-all">${u}</a>`);

// Splits the plain-text body into paragraphs. A URL alone on a line is lifted
// out as the call-to-action (when no explicit action was given).
function parseBody(text, action) {
  let cta = action || null;
  const paras = [];
  for (const block of String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const kept = [];
    let lifted = false;
    for (const line of block.split('\n').filter((l) => l.trim())) {
      const url = line.trim();
      if (/^https?:\/\/\S+$/.test(url) && (!cta || cta.url === url)) { if (!cta) cta = { label: 'Open link', url }; lifted = true; continue; }
      kept.push(line);
    }
    // "Track it here:" reads oddly once its link became a button below.
    let html = kept.map((l) => linkify(esc(l))).join('<br>');
    if (lifted) html = html.replace(/:\s*$/, '.');
    if (kept.length) paras.push(html);
  }
  return { paras, cta };
}

const p = (html, extra = '') => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.body};${extra}">${html}</p>`;
const kickerHtml = (text, color = C.green) => `<div style="font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${color}">${esc(text)}</div>`;
const pill = (status) => {
  if (!status || !status.label) return '';
  const [bg, fg] = TONES[status.tone] || TONES.ok;
  return `<span style="display:inline-block;padding:4px 10px;border-radius:12px;background:${bg};color:${fg};font-family:${FONT};font-size:11px;font-weight:700;white-space:nowrap">${esc(status.label)}</span>`;
};
// cta.noFallback leaves out the "Or paste this link" line under the button.
const button = (cta) => !cta ? '' : `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px"><tr>
    <td bgcolor="${C.green}" style="border-radius:4px;background:${C.green}">
      <a href="${esc(cta.url)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:4px">${esc(cta.label)} &rarr;</a>
    </td></tr></table>
  ${cta.noFallback ? '' : /^mailto:/i.test(cta.url)
    ? `<div style="margin:-10px 0 20px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.faint}">Or write to <a href="${esc(cta.url)}" style="color:${C.green}">${esc(decodeURIComponent(cta.url.slice(7).split('?')[0]))}</a></div>`
    : `<div style="margin:-10px 0 20px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.faint}">Or paste this link into your browser:<br><a href="${esc(cta.url)}" style="color:${C.green};word-break:break-all">${esc(cta.url)}</a></div>`}`;

// A highlighted box for a staff member's own words (instructions, questions).
const noteBox = (note) => (!note || !String(note.text || '').trim()) ? '' : `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 20px"><tr>
    <td bgcolor="#fdf8e7" style="background:#fdf8e7;border-left:4px solid ${C.gold};padding:13px 16px">
      ${kickerHtml(note.label || 'Instructions', '#8a5a00')}
      <div style="margin-top:6px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink}">${linkify(esc(String(note.text).trim())).replace(/\r?\n/g, '<br>')}</div>
    </td></tr></table>`;

// Summary table in the client-report style: tinted label column.
// A framed picture (e.g. the client's pad signature on a handover slip).
const imageBox = (image) => (!image || !/^(https?:\/\/|data:image\/png;base64,)/i.test(String(image.src || '')) ? '' : `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 20px"><tr>
    <td style="border:1px solid ${C.line};border-radius:6px;padding:14px 16px;background:#ffffff">
      ${image.label ? kickerHtml(image.label) : ''}
      <img src="${esc(image.src)}" width="300" alt="${esc(image.alt || '')}" style="display:block;width:100%;max-width:300px;height:auto;margin:8px 0 6px;border:0">
      ${image.caption ? `<div style="font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted}">${esc(image.caption)}</div>` : ''}
    </td></tr></table>`);

// A row's third item highlights its value: 'red' (e.g. what to enter when
// paying) or 'green' (e.g. a confirmed payment).
const TONE_TEXT = { red: '#c62828', green: C.green };
const valueStyle = (tone) => TONE_TEXT[tone] ? `font-size:14px;font-weight:800;color:${TONE_TEXT[tone]}` : `font-size:13px;color:${C.ink}`;
function detailsTable(details) {
  const rows = (details || []).filter(([, v]) => v != null && String(v).trim() !== '');
  if (!rows.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid #d9e5dc;border-collapse:collapse">
    ${rows.map(([k, v, tone], i) => `<tr>
      <td width="36%" style="padding:9px 12px;background:${C.soft};border-bottom:1px solid #e4ece6;font-family:${FONT};font-size:12px;font-weight:700;color:#526056;vertical-align:top">${esc(k)}</td>
      <td style="padding:9px 12px;background:${i % 2 ? '#f7faf7' : '#ffffff'};border-bottom:1px solid #e4ece6;font-family:${FONT};${valueStyle(tone)};vertical-align:top">${esc(v)}</td></tr>`).join('')}
  </table>`;
}

const shell = (subject, preheader, inner) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
${inner}
</td></tr></table></body></html>`;

const footer = (note, replyNote, color = C.faint, border = C.line, unit = 'Vehicle Management & Trip Logging') => `
  <tr><td style="padding:16px 28px 22px;border-top:1px solid ${border};font-family:${FONT};font-size:11px;line-height:1.55;color:${color}">
    ${note ? `${esc(note)}<br>` : ''}KNUST UITS &bull; ${esc(unit)}<br>
    ${replyNote ? esc(replyNote) : 'This is an automated message. Please do not reply to this email.'}
  </td></tr>`;

// Green header band with the crest and a gold rule, then a single content
// column, so it reads the same on a phone as on a desktop.
function banner(m) {
  return shell(m.subject, m.preheader, `
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;border:1px solid ${C.line}">
  <tr><td bgcolor="${C.greenDark}" style="background:${C.greenDark};background-image:linear-gradient(135deg,${C.greenDark} 0%,${C.green} 60%,${C.greenDeep} 100%);padding:22px 28px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:14px;vertical-align:middle"><img src="${esc(logoUrl(m.appUrl))}" width="46" alt="KNUST" style="display:block;width:46px;height:auto;border:0"></td>
      <td style="vertical-align:middle;font-family:${FONT}">
        <div style="font-size:10px;font-weight:800;letter-spacing:.09em;line-height:1.45;color:#ffffff">KWAME NKRUMAH UNIVERSITY<br>OF SCIENCE AND TECHNOLOGY</div>
        <div style="margin-top:5px;font-size:11px;font-weight:800;letter-spacing:.12em;color:${C.goldText}">UITS &bull; ${esc(String(m.unit || 'Vehicle Management & Trip Logging').toUpperCase())}</div>
      </td></tr></table>
  </td></tr>
  <tr><td height="4" style="font-size:0;line-height:0;background:${C.gold}">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 8px">
    ${kickerHtml(m.kicker)}
    <h1 style="margin:6px 0 16px;font-family:${FONT};font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-.02em;color:${C.ink}">${esc(m.title)}</h1>
    ${m.status ? `<div style="margin:-6px 0 18px">${pill(m.status)}</div>` : ''}
    ${m.paras.map((x) => p(x)).join('')}
    ${noteBox(m.note)}
    ${detailsTable(m.details)}
    ${imageBox(m.image)}
    ${button(m.cta)}
    ${reviewBox(m.review)}
  </td></tr>
  ${footer(m.footerNote, m.replyNote, undefined, undefined, m.unit || undefined)}
</table>`);
}


// "How did we do?" box with a link to the client feedback form (only when the
// form is switched on, and only on the messages that end a piece of work).
const reviewBox = (url) => (!url || !/^https:\/\//i.test(String(url)) ? '' : `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 20px"><tr>
    <td bgcolor="${C.soft}" style="background:${C.soft};border:1px solid ${C.line};border-radius:6px;padding:16px 18px">
      ${kickerHtml('Your feedback')}
      <div style="margin:6px 0 12px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.ink}">How did we do? It takes a minute and helps us improve the service.</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:4px;border:2px solid ${C.green}">
        <a href="${esc(url)}" style="display:inline-block;padding:9px 18px;font-family:${FONT};font-size:14px;font-weight:700;color:${C.green};text-decoration:none">Give feedback &rarr;</a>
      </td></tr></table>
    </td></tr></table>`);

function render({ subject = '', text = '', kicker = 'Vehicle Management & Trip Logging', title, details, action, status, note, footerNote, replyNote, preheader, appUrl, review, image, unit } = {}) {
  const { paras, cta } = parseBody(text, action);
  return banner({
    appUrl: String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, ''),
    subject, kicker, title: title || subject, details, status, note, footerNote, replyNote, paras, cta, review, image, unit,
    preheader: preheader || String(text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
  });
}

// For in-app previews: the preview frame is sandboxed and the app's content
// policy blocks outside images, so the crest is embedded. Real emails load the
// public copy.
let logoDataUri = '';
function renderPreview(opts) {
  if (!logoDataUri) {
    const file = require('path').join(__dirname, '..', '..', 'public', 'knust-logo.png');
    logoDataUri = `data:image/png;base64,${require('fs').readFileSync(file).toString('base64')}`;
  }
  const base = String(opts.appUrl || DEFAULT_APP_URL).replace(/\/+$/, '');
  return render(opts).split(esc(logoUrl(base))).join(logoDataUri);
}

module.exports = { render, renderPreview, logoUrl };
