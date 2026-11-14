'use strict';
const log = require('../util/log');
module.exports = (req, res, next) => {
  const start = process.hrtime.bigint();
  const requestPath = req.path;
  res.once('finish', () => {
    // Polling the viewer must not fill its own ring buffer.
    if (!requestPath.startsWith('/api/') || requestPath.startsWith('/api/admin/application-logs')) return;
    const status = res.statusCode;
    log[status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info']('http_request', {
      category: 'request', message: `${req.method} ${requestPath} · ${status}`, request_id: req.id,
      method: req.method, path: requestPath, status, duration_ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6), ip: req.ip,
      user_id: req.session?.user?.id || null,
    });
  });
  next();
};
