'use strict';
// A small in-memory fixed-window rate limiter (single-process). Keyed per user
// when signed in, otherwise per IP, with a high per-IP backstop against floods.
const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 1000, key, message } = {}) {
  const resolveMax = typeof max === 'function' ? max : () => max;
  const resolveKey = key || ((req) => req.ip);
  return function limiter(req, res, next) {
    const limit = Number(resolveMax(req)) || 0;
    if (!limit) return next();
    const id = `${resolveKey(req)}`;
    const now = Date.now();
    let b = buckets.get(id);
    if (!b || now >= b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(id, b); }
    b.count += 1;
    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(Math.max(0, limit - b.count)));
    if (b.count > limit) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many requests. Please slow down and try again shortly.' });
    }
    next();
  };
}
// Periodically drop expired buckets so the map does not grow without bound.
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now >= b.reset) buckets.delete(k); }, 5 * 60_000).unref?.();

rateLimit.ip = (req) => req.ip;
rateLimit.userOrIp = (req) => (req.session && req.session.user ? `u:${req.session.user.id}` : `ip:${req.ip}`);

module.exports = rateLimit;
