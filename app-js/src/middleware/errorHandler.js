'use strict';
const log = require('../util/log');

// Central error handler. A thrown ApiError carries its own status + message;
// a validation error (status 422) carries a field map. Everything else is a 500
// with a generic message (details go to the log, never to the client).
class ApiError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
function badRequest(message, errors) { return new ApiError(422, message || 'The given data was invalid.', { errors }); }
function forbidden(message) { return new ApiError(403, message || 'You do not have access to this.'); }
function notFound(message) { return new ApiError(404, message || 'Not found.'); }
function conflict(message) { return new ApiError(409, message); }

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = Number(err && err.status) || 500;
  if (status >= 500) log.error('request_error', { id: req.id, path: req.path, message: err && err.message, stack: err && err.stack });
  else log.warn('request_rejected', { id: req.id, path: req.path, status, message: err && err.message });
  const body = { error: status >= 500 ? 'Something went wrong. Please try again.' : (err.message || 'Request failed.') };
  if (err && err.extra && err.extra.errors) body.errors = err.extra.errors;
  res.status(status).json(body);
}

module.exports = errorHandler;
module.exports.ApiError = ApiError;
module.exports.badRequest = badRequest;
module.exports.forbidden = forbidden;
module.exports.notFound = notFound;
module.exports.conflict = conflict;
