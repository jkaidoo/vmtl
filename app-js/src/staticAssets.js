'use strict';

// Fingerprinted static assets. At boot every file under public/js and public/css
// gets a short content hash, and HTML pages are served with their script/stylesheet
// URLs rewritten to "/js/app.js?v=<hash>". Versioned URLs cache for a year
// (immutable); the HTML itself always revalidates, so a deploy is picked up on the
// next page load. Inline scripts are untouched so the CSP hashes still match.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashFiles(publicDir) {
  const versions = new Map();
  for (const dir of ['js', 'css']) {
    const abs = path.join(publicDir, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      const file = path.join(abs, name);
      if (!fs.statSync(file).isFile()) continue;
      versions.set(`/${dir}/${name}`, crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10));
    }
  }
  return versions;
}

function build(publicDir) {
  const versions = hashFiles(publicDir);
  const pages = new Map();
  if (fs.existsSync(publicDir)) {
    for (const name of fs.readdirSync(publicDir)) {
      if (!name.endsWith('.html')) continue;
      const html = fs.readFileSync(path.join(publicDir, name), 'utf8');
      pages.set(name, html.replace(/\b(src|href)="(\/(?:js|css)\/[^"?#]+)"/g, (m, attr, p) => (versions.has(p) ? `${attr}="${p}?v=${versions.get(p)}"` : m)));
    }
  }

  function sendPage(res, name, status = 200) {
    const html = pages.get(name);
    if (html == null) return res.status(status).sendFile(path.join(publicDir, name));
    res.set('Cache-Control', 'no-cache');
    return res.status(status).type('html').send(html);
  }
  function cacheHeaders(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const current = versions.get(req.path);
    if (current && req.query.v === current) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (!req.path.startsWith('/api')) res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    next();
  }
  function htmlPages(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const name = req.path === '/' ? null : req.path.replace(/^\//, '');
    if (name && pages.has(name)) return sendPage(res, name);
    next();
  }
  return { versions, pages, sendPage, cacheHeaders, htmlPages };
}

module.exports = { build };
