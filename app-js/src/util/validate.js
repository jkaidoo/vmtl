'use strict';
// A compact request-body validator. Rules are declared per field; on any failure
// it throws a 422 ApiError carrying a { field: [messages] } map (Laravel-shaped),
// so the frontend can surface field errors the same way it did before.
const { badRequest } = require('../middleware/errorHandler');

const isBlank = (v) => v === undefined || v === null || v === '';
const isIsoDateLike = (v) => !Number.isNaN(Date.parse(String(v)));

// rules: { field: { required, type:'string|integer|number|boolean|date', min, max,
//   maxLength, in:[...], after:'otherField', messages:{rule:msg} } }
function validate(body, rules) {
  const errors = {};
  const out = {};
  for (const [field, rule] of Object.entries(rules)) {
    let value = body[field];
    const add = (msg) => { (errors[field] = errors[field] || []).push(msg); };
    const custom = (rule.messages || {});

    if (isBlank(value)) {
      if (rule.required) add(custom.required || `${field} is required.`);
      if (!rule.required) out[field] = rule.default !== undefined ? rule.default : (value === '' ? null : value);
      continue;
    }

    switch (rule.type) {
      case 'integer': case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n) || (rule.type === 'integer' && !Number.isInteger(n))) { add(custom.type || `${field} must be a number.`); continue; }
        if (rule.min !== undefined && n < rule.min) add(custom.min || `${field} must be at least ${rule.min}.`);
        if (rule.max !== undefined && n > rule.max) add(custom.max || `${field} must be at most ${rule.max}.`);
        value = n; break;
      }
      case 'boolean': value = value === true || value === 1 || value === '1' || value === 'true'; break;
      case 'date':
        if (!isIsoDateLike(value)) { add(custom.type || `${field} must be a valid date.`); continue; }
        break;
      case 'string': default:
        value = String(value);
        if (rule.maxLength && value.length > rule.maxLength) add(custom.maxLength || `${field} must not exceed ${rule.maxLength} characters.`);
        break;
    }
    if (rule.in && !rule.in.includes(value)) add(custom.in || `${field} is invalid.`);
    if (rule.after && !isBlank(body[rule.after]) && Date.parse(String(value)) <= Date.parse(String(body[rule.after]))) add(custom.after || `${field} must be after ${rule.after}.`);
    out[field] = value;
  }
  if (Object.keys(errors).length) throw badRequest('The given data was invalid.', errors);
  return out;
}

module.exports = { validate };
