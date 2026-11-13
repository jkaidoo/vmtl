'use strict';
const settings = require('./settings');
const layout = require('./emailLayout');
const bad = message => Object.assign(new Error(message), { status: 400 });
const EVENTS = {
  test: ['Test message', 'When sending a test from the Email or SMS page.', 'Hello {recipient_name},\n\nThis is a test message from UITS Vehicle Management & Trip Logging. Your messaging connection is working.'],
  new_request: ['New vehicle request', 'When a vehicle request is submitted for review.', 'Hello {recipient_name},\n\nRequest {request_number} from {requester} needs your review.'],
  request_approved: ['Request approved', 'When an approver approves a request.', 'Hello {recipient_name},\n\nYour request {request_number} has been approved.\n\n{comment}'],
  request_rejected: ['Request rejected', 'When an approver rejects a request.', 'Hello {recipient_name},\n\nYour request {request_number} has been rejected.\n\nReason: {reason}'],
  request_changes_requested: ['Changes requested', 'When an approver requests changes.', 'Hello {recipient_name},\n\nPlease update request {request_number}.\n\nRequested changes: {reason}'],
  vehicle_assigned: ['Vehicle assigned', 'When a vehicle and driver are assigned to a trip.', 'Hello {recipient_name},\n\nVehicle {vehicle} has been assigned to trip {trip_number}.'],
  driver_ready: ['Driver ready', 'When the driver marks a trip as ready.', 'Hello {recipient_name},\n\nYour driver is ready for trip {trip_number}.\n\n{note}'],
  trip_completed: ['Trip completed', 'When a trip is completed.', 'Hello {recipient_name},\n\nTrip {trip_number} is complete. Distance travelled: {distance} km.'],
  trip_stop_requested: ['Added destination requested', 'When a new destination is added during a trip.', 'Hello {recipient_name},\n\nPlease review the added destination {destination} for trip {trip_number}.'],
  trip_stop_accepted: ['Added destination accepted', 'When the driver accepts an added destination.', 'Hello {recipient_name},\n\nThe destination {destination} has been accepted for trip {trip_number}.'],
  trip_stop_declined: ['Added destination declined', 'When the driver declines an added destination.', 'Hello {recipient_name},\n\nThe destination {destination} has been declined for trip {trip_number}.'],
  trip_delay_warning: ['Possible trip delay', 'When a trip may be delayed.', 'Hello {recipient_name},\n\nTrip {trip_number} may be delayed. Please check the trip for updates.'],
  ou_change_pending: ['Organisational-unit change pending', 'When staff sync detects a change that needs review.', 'Hello {recipient_name},\n\n{name} has moved from {from} to {to} in the staff directory. Please review the pending change.'],
  ou_auto_moved: ['Organisational-unit updated', 'When a pending staff organisational-unit move is applied.', 'Hello {recipient_name},\n\n{name} has been moved to {to} after the organisational-unit change grace period.'],
  compliance_digest: ['Fleet compliance reminder', 'When fleet documents or services need attention.', 'Hello {recipient_name},\n\n{summary}'],
  broadcast: ['{title}', 'When an administrator sends a broadcast.', '{message}'],
  notification: ['{title}', 'Fallback for other notification types.', '{message}'],
};
const SAMPLE = { recipient_name: 'Ama Mensah', request_number: 'REQ-2026-0042', requester: 'Kwame Asante', trip_number: 'TRP-2026-0018', vehicle: 'UITS 012', distance: '42', destination: 'KNUST Main Administration', reason: 'Please update the travel date and passenger count.', comment: 'Approved for the requested travel date.', note: 'Please meet at the UITS car park.', name: 'Kwame Asante', from: 'College of Science', to: 'University Information Technology Services', summary: '2 insurance certificates and 1 vehicle service need attention.', title: 'Service update', message: 'Vehicle requests are now open for the coming week.' };
function channelCheck(channel) { if (!['email', 'sms'].includes(channel)) throw bad('Choose email or SMS.'); }
function definitions(channel) {
  channelCheck(channel);
  const defaults = {}; const meta = [];
  for (const [key, [label, when, body]] of Object.entries(EVENTS)) {
    const subject = `${key}_subject`; const textKey = `${key}_body`; const table = `${key}_table`;
    if (channel === 'email') defaults[subject] = label;
    defaults[textKey] = channel === 'email' ? body : ['broadcast', 'notification'].includes(key) ? '{title}: {message}' : body.replace(/^Hello \{recipient_name\},\n\n/, '').replace(/\n+/g, ' ').trim();
    const vars = [...new Set([...`${label} ${body}`.matchAll(/\{(\w+)\}/g)].map(match => match[1]))];
    if (channel === 'email') defaults[table] = vars.filter(key => !['recipient_name', 'comment', 'reason', 'note', 'message', 'title'].includes(key)).map(key => `${key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())} | {${key}}`).join('\n') || '-';
    meta.push({ key, label: key === 'broadcast' ? 'Broadcast' : key === 'notification' ? 'Other notifications' : label, when, vars, body: textKey, ...(channel === 'email' ? { subject, table } : {}) });
  }
  return { defaults, meta };
}
async function read(channel) {
  channelCheck(channel);
  let saved = await settings.get(`message_templates_${channel}`, {});
  if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch (_) { saved = {}; } }
  return saved && typeof saved === 'object' ? saved : {};
}
async function catalogue(channel) {
  const { defaults, meta } = definitions(channel); const saved = await read(channel);
  return { defaults, templates: Object.fromEntries(Object.keys(defaults).map(key => [key, typeof saved[key] === 'string' ? saved[key] : defaults[key]])), meta, sample: SAMPLE };
}
function validate(channel, changes) {
  const { defaults, meta } = definitions(channel);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw bad('Provide template text.');
  for (const [key, value] of Object.entries(changes)) {
    if (!Object.hasOwn(defaults, key)) throw bad('Unknown template field.');
    const max = key.endsWith('_subject') ? 200 : key.endsWith('_table') ? 3000 : 6000;
    if (typeof value !== 'string' || value.length > max || (!key.endsWith('_table') && !value.trim()) || (key.endsWith('_subject') && /[\r\n]/.test(value))) throw bad(`Invalid template text for ${key}. Maximum ${max} characters.`);
    const item = meta.find(m => [m.subject, m.body, m.table].includes(key));
    for (const match of value.matchAll(/\{(\w+)\}/g)) if (!item.vars.includes(match[1])) throw bad(`Unknown placeholder {${match[1]}} for ${item.label}.`);
  }
  return changes;
}
async function save(channel, changes) {
  validate(channel, changes);
  const saved = { ...await read(channel), ...changes };
  await settings.set(`message_templates_${channel}`, JSON.stringify(saved));
  return catalogue(channel);
}
const fill = (text, values) => String(text || '').replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? ''));
function smsCount(text) {
  const gsm = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/.test(text);
  const characters = text.length + (gsm ? (text.match(/[\^{}\\[~\]|€]/g) || []).length : 0);
  const [one, many] = gsm ? [160, 153] : [70, 67];
  return { characters, encoding: gsm ? 'GSM-7' : 'Unicode', segments: characters === 0 ? 0 : characters <= one ? 1 : Math.ceil(characters / many) };
}
async function render(channel, key, values = {}, draft = {}, { preview = false } = {}) {
  const out = await catalogue(channel); const meta = out.meta.find(m => m.key === key);
  if (!meta) throw bad('Unknown message template.');
  validate(channel, draft);
  const allowed = new Set([meta.subject, meta.body, meta.table].filter(Boolean));
  if (Object.keys(draft).some(field => !allowed.has(field))) throw bad('Draft fields must belong to the selected template.');
  const templates = { ...out.templates, ...draft };
  const data = Object.fromEntries(Object.keys(SAMPLE).map(key => [key, values[key] ?? '']));
  const text = fill(templates[meta.body], data).trim();
  if (channel === 'sms') return { text, ...smsCount(text) };
  const subject = fill(templates[meta.subject], data).replace(/[\r\n]+/g, ' ');
  const prefix = await settings.get('notif_email_subject_prefix', '[UITS VMTL] ');
  const details = templates[meta.table].trim() === '-' ? [] : templates[meta.table].split(/\r?\n/).flatMap(line => {
    const split = line.indexOf('|'); return split < 0 ? [] : [[fill(line.slice(0, split).trim(), data), fill(line.slice(split + 1).trim(), data)]];
  });
  const options = { subject: `${prefix}${subject}`, title: subject, text, details, kicker: 'Vehicle Management & Trip Logging', unit: 'Vehicle Management & Trip Logging', appUrl: process.env.APP_URL };
  return { subject, display_subject: options.subject, text, html: preview ? layout.renderPreview(options) : layout.render(options) };
}
module.exports = { catalogue, save, render, fill, smsCount, SAMPLE, has: key => Object.hasOwn(EVENTS, key) };
