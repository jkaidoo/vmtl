'use strict';
// Wrap an Express app/router so a rejected async handler becomes an error passed
// to next() (a 500), never an unhandled rejection that could crash the process.
function wrapLayer(stack) {
  for (const layer of stack) {
    if (layer.route) { wrapLayer(layer.route.stack); continue; }
    const handler = layer.handle;
    if (typeof handler !== 'function' || handler.length >= 4 || handler.__asyncSafe) continue;
    if (handler.name === 'router' || handler.stack) continue; // sub-routers wrapped on use
  }
}

function asyncSafe(appOrRouter) {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];
  for (const method of methods) {
    const original = appOrRouter[method];
    if (typeof original !== 'function') continue;
    appOrRouter[method] = function patched(...args) {
      const wrapped = args.map((arg) => {
        if (typeof arg !== 'function' || arg.length >= 4) return arg;
        const fn = function asyncSafeHandler(req, res, next) {
          try { const out = arg(req, res, next); if (out && typeof out.then === 'function') out.catch(next); return out; }
          catch (err) { return next(err); }
        };
        fn.__asyncSafe = true;
        return fn;
      });
      return original.apply(this, wrapped);
    };
  }
  return appOrRouter;
}

module.exports = { asyncSafe, wrapLayer };
