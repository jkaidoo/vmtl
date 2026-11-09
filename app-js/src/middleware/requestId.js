'use strict';
const crypto = require('crypto');
// Attach a short request id for log correlation and echo it back.
module.exports = function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomBytes(6).toString('hex');
  res.set('X-Request-Id', req.id);
  next();
};
