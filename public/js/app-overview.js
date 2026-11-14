'use strict';
// App overview (App Owner) — an animated tour of how VMTL works, everything it
// does, who uses it and what sets it apart, with live figures from
// GET /api/admin/app-overview. Motion: a hero vehicle drives the request-to-report
// route (paused off-screen); sections reveal once on scroll; figures count up.
// Under prefers-reduced-motion everything is shown in its final state.
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc; const icon = VMTL.icon;
  // Prefix match: the server serves page links with a ?v= cache-busting suffix.
  if (!document.querySelector('link[href^="/css/app-overview.css"]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/app-overview.css'; document.head.appendChild(link);
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  let d;
  try { d = (await VMTL.api('/admin/app-overview')).data; }
  catch (e) { view.innerHTML = VMTL.pageHead('App overview', 'How the application works.') + `<div class="empty">${esc(e.message || 'Could not load the overview.')}</div>`; return; }

  const u = d.usage; const c = d.catalogue; const p = d.platform;
  const fmt = (n) => Number(n || 0).toLocaleString();
  const bytes = (b) => { const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = Number(b || 0); while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; } return `${v.toFixed(i ? 1 : 0)} ${units[i]}`; };
  const uptime = (s) => { const dd = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const mm = Math.floor((s % 3600) / 60); return dd ? `${dd}d ${hh}h` : hh ? `${hh}h ${mm}m` : `${mm}m`; };
  const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  // ---- Content ---------------------------------------------------------------
  const STATS = [
    { key: 'vehicles', label: 'Vehicles', icon: 'vehicles', sub: `${fmt(u.vehicles_active)} active` },
    { key: 'drivers', label: 'Drivers', icon: 'drivers', sub: 'in the driver register' },
    { key: 'users', label: 'Active users', icon: 'users', sub: `${fmt(u.org_units)} organisational units` },
    { key: 'trips_completed', label: 'Trips completed', icon: 'trips', sub: `${fmt(u.trips)} trips · ${fmt(u.requests)} requests` },
    { key: 'km_travelled', label: 'Distance driven', icon: 'map', suffix: ' km', sub: 'on completed trips' },
    { key: 'fuel_litres', label: 'Fuel logged', icon: 'fuel', suffix: ' L', sub: `${VMTL.fmtCedis(u.fuel_cost)} spent` },
    { key: 'idl_schedules', label: 'IDL schedules', icon: 'calendar', sub: `${fmt(u.idl_events)} IDL events` },
    { key: 'files', label: 'Files stored', icon: 'database', sub: bytes(u.file_bytes) },
  ];
  const JOURNEY = [
    ['requests', 'Request', 'Staff choose a travel window, destinations, purpose and passengers — after checking availability.'],
    ['approvals', 'Approve', 'An approver approves, rejects with a reason, or sends it back for changes.'],
    ['vehicles', 'Assign', 'A free vehicle and driver are paired in one transaction, so nothing is ever double-booked.'],
    ['trips', 'Drive', 'The driver completes a pre-trip checklist and starts the trip; the progress graphic and live map follow it.'],
    ['wrench', 'Maintain', 'Fuel, servicing, receipts and odometer readings keep running costs and service schedules current.'],
    ['analytics', 'Report', 'Analytics and CSV, Excel or PDF reports summarise distance, utilisation and fuel economy.'],
  ];
  const GROUPS = { requests: 'Requests & trips', fleet: 'Fleet', idl: 'IDL scheduling', insights: 'Insights', messaging: 'Notifications', access: 'Access & security', owner: 'Owner tools' };
  const FEATURES = [
    ['requests', 'requests', 'Vehicle requests', 'Travel window, several destinations, purpose and passengers, with an availability check before submitting and live status afterwards.', '/requests.html'],
    ['requests', 'gift', 'Goodwill & external travel', 'Dedicated forms for goodwill trips (with an explanation) and extended travel for other university arms, through the same approvals.', '/goodwill.html'],
    ['requests', 'approvals', 'Approvals', 'Approve, reject with a reason, or request changes — the requester is notified at every step.', '/approvals.html'],
    ['requests', 'vehicles', 'Conflict-free assignment', 'Only vehicles and drivers free for the whole window are offered, and row locks stop two officers booking the same one.', '/requests.html'],
    ['requests', 'trips', 'Trip operation', 'Pre-trip inspection checklist, odometer-validated start and finish, no-shows, and a live progress graphic shaped like the vehicle type.', '/trips.html'],
    ['requests', 'map', 'Live map & added stops', 'Vehicles on a live map; requesters add destinations mid-trip, drivers accept or decline, and the next booking gets a delay warning.', '/tracking.html'],
    ['requests', 'calendar', 'Schedule calendar', 'Every booking on one calendar, so officers see the fleet\'s week at a glance.', '/schedule.html'],
    ['fleet', 'vehicles', 'Vehicle register', 'Type, capacity, compliance dates and service interval, with a photo shown in the list.', '/vehicles.html'],
    ['fleet', 'drivers', 'Driver register', 'Staff ID, licence number and expiry, photo and licence photo, and optional self-service sign-in.', '/drivers.html'],
    ['fleet', 'fuel', 'Fuel log', 'Station and fuel type from managed lists, automatic distance and km/L, and an odometer history that rebuilds itself after any edit.', '/fuel.html'],
    ['fleet', 'wrench', 'Maintenance', 'Provider from a list (or Other), cost, next-service targets and an image or PDF receipt.', '/maintenance.html'],
    ['fleet', 'health', 'Compliance alerts', 'Insurance, roadworthiness and licence expiry warnings, plus distance-based service-due alerts on the dashboard.', '/dashboard.html'],
    ['idl', 'calendar', 'IDL events', 'Group the external travel for an IDL activity under one event with its own running cost.', '/event-schedules.html'],
    ['idl', 'vehicles', 'University-wide pairing', 'Find fleet free for a time window across every unit and pair a driver with a vehicle, with capacity and clashes checked.', '/event-schedules.html'],
    ['idl', 'fuel', 'Costs per schedule', 'Fuel purchases and allowances, tolls, repairs or accommodation tracked per schedule and per event.', '/event-schedules.html'],
    ['idl', 'bell', 'Driver notifications', 'Drivers hear when they are assigned, rescheduled, moved to another trip or cancelled.', '/event-schedules.html'],
    ['insights', 'analytics', 'Analytics', 'Trips, distance, utilisation and fuel economy, charted for each user\'s scope.', '/analytics.html'],
    ['insights', 'reports', 'Reports & exports', 'CSV, Excel and PDF exports, with report layouts administrators can configure.', '/reports.html'],
    ['insights', 'code', 'Read API', 'A token-protected, scope-limited read API so other university systems can use fleet data.', '/unified-api.html'],
    ['messaging', 'bell', 'In-app & push', 'A notification centre in the app, plus Web Push to installed devices.', '/dashboard.html'],
    ['messaging', 'mail', 'Email', `Branded email through the Tekmail connection, with ${c.notification_templates} editable templates and live previews.`, '/email.html'],
    ['messaging', 'message', 'SMS', 'mNotify, Hubtel, Arkesel or Wigal, with editable templates and segment counts before sending.', '/sms.html'],
    ['messaging', 'megaphone', 'Broadcasts', 'Owner announcements to everyone or one role, in the app, by email and by SMS.', '/broadcasts.html'],
    ['access', 'shield', 'Capability RBAC', `${c.capabilities} granular capabilities grouped into roles you can edit or create, enforced on every API route.`, '/rbac.html'],
    ['access', 'org', 'Organisational scoping', 'People see their unit and its sub-units; university-wide fleet roles see everything.', '/org-units.html'],
    ['access', 'key', 'Directory sign-in', 'KNUST directory (LDAP/AD) accounts sign in alongside local accounts.', '/directory-auth.html'],
    ['access', 'users', 'Staff directory sync', 'Unified API staff profiles and photos, with a review step before anyone changes unit.', '/unified-api.html'],
    ['access', 'audit', 'Audit trail', 'An append-only record of who did what, when and from where.', '/audit.html'],
    ['access', 'key', 'Sign-in protection', 'Password policy, lockout after repeated failures, idle sign-out and alerts on suspicious sign-ins.', '/system-controls.html'],
    ['owner', 'compass', 'App overview', 'This page: live figures and a tour of the whole application.', '/app-overview.html'],
    ['owner', 'key', 'Owner page access', 'Share App overview, Dropdowns, File Server or Broadcasts with chosen roles or specific people — checked on every request.', '/owner-access.html'],
    ['owner', 'sliders', 'Dropdowns', `${c.dropdown_lists} business choice lists editable without code; workflow keys stay protected.`, '/dropdowns.html'],
    ['owner', 'database', 'File Server', 'Keep uploads in the database, a server folder, S3 or Supabase, with tested connections and upload limits.', '/file-server.html'],
    ['owner', 'layout', 'Navigation menu', 'Rename, reorder, group and hide menu items, per role.', '/navigation-settings.html'],
    ['owner', 'database', 'Backups & cleanup', 'Verified snapshots, restore and safe data cleanup.', '/backup-cleanup.html'],
    ['owner', 'health', 'App Health & logs', 'Server starts, sign-in trends, database checks and the live application log.', '/app-health.html'],
    ['owner', 'database', 'Database connections', 'Copy the data store into a managed PostgreSQL server when you outgrow the embedded one.', '/database-connections.html'],
  ];
  const ROLE_TEXT = {
    staff: 'Requests rides and follows them through to the trip.',
    approver: 'Approves, rejects or returns requests, and can do everything a Transport Officer does.',
    transport_admin: 'Assigns vehicles and drivers, runs trips, and logs fuel and maintenance.',
    supervisor: 'Oversees a unit: requests, analytics and the audit log, read-only.',
    administrator: 'Every capability, including the System section.',
    driver: 'Operates assigned trips from a phone, raises goodwill trips and logs fuel.',
    university_transport_officer: 'Maintains every vehicle and driver across the university — and nothing else.',
    schedule_transport_officer: 'A Transport Officer with university-wide fleet and IDL event scheduling.',
  };
  const STANDOUT = [
    ['Double-booking is impossible', 'Assignment and IDL scheduling run in database transactions with row locks, and availability is checked on the server for the whole time window.'],
    ['Security lives on the server', 'Every API route checks capabilities and organisational scope. Hiding a button is never the only guard.'],
    ['Works on patchy connections', 'An installable app that keeps working offline: actions queue on the device and replay exactly once when the connection returns.'],
    ['Configured, not coded', 'Dropdowns, menus, message templates, roles, report layouts and file storage are all changed from the app — no developer needed.'],
    ['Numbers you can trust', 'Odometer readings are validated and their history rebuilt after edits, deletions keep history, and an append-only audit records every change.'],
    ['Built for KNUST', 'Directory sign-in, Unified API staff sync, the college–faculty–department hierarchy, Tekmail and Ghanaian SMS gateways, cedi amounts and the KNUST brand.'],
    ['One code path, any database', 'SQLite, embedded PostgreSQL or a managed PostgreSQL server — with a built-in tool to copy your data across.'],
    ['Your files, your storage', 'Photos and receipts in the database, a folder, S3 or Supabase; credentials encrypted, files served only to people allowed to see them.'],
  ];
  const SECURITY = [
    'Capability and organisational-scope checks on every API route',
    'Transactions and row locks for bookings and odometer history',
    'bcrypt passwords, a complexity policy, lockout and suspicious sign-in alerts',
    'Sliding idle sign-out — by default 30 minutes in a browser, 30 days in the installed app',
    'Uploads checked by file signature and served only through scoped routes',
    'Write-only, encrypted secrets; redacted logs; an append-only audit ledger',
  ];
  const groupCounts = FEATURES.reduce((m, f) => { m[f[0]] = (m[f[0]] || 0) + 1; return m; }, {});
  const totalCaps = Math.max(1, c.capabilities);

  // ---- Markup ----------------------------------------------------------------
  const head = (id, eyebrow, title, sub) => `<div class="ao-head"><div><p class="ao-eyebrow">${eyebrow}</p><h2 id="${id}" tabindex="-1">${title}</h2>${sub ? `<p class="ao-sub">${sub}</p>` : ''}</div></div>`;
  const jumps = [['ao-figures', 'Live figures'], ['ao-journey', 'How it works'], ['ao-features', 'Features'], ['ao-roles', 'Roles'], ['ao-why', 'What sets it apart'], ['ao-hood', 'Under the hood']];
  // Cards stagger in only after a filter change; on first load the grid reveals on scroll.
  const featureCard = (f, i, enter = false) => `<article class="ao-feature${enter ? ' ao-enter' : ''}" style="--i:${i}"><div class="ao-fi">${icon(f[1])}</div><span class="tag">${esc(GROUPS[f[0]])}</span><h3>${esc(f[2])}</h3><p>${esc(f[3])}</p><a href="${f[4]}" aria-label="Open ${esc(f[2])}">Open →</a></article>`;

  view.innerHTML = `<div class="ao">
    <section class="ao-hero" aria-labelledby="ao-title">
      <div class="ao-hero-copy">
        <span class="ao-kicker" style="--i:0">${icon('compass')} ${VMTL.isSuper() ? 'App Owner · ' : ''}Application overview</span>
        <h1 id="ao-title" style="--i:1">UITS Vehicle Management <em>&amp; Trip Logging</em></h1>
        <p class="ao-lead" style="--i:2">One system for every official journey at KNUST — from a staff member's request, through approval and conflict-free assignment, to the driver's trip, the fuel and maintenance behind it, and the reports that come out the other end.</p>
        <div class="ao-meta" style="--i:3">
          <span class="ao-chip"><span class="ao-live" aria-hidden="true"></span>Live figures</span>
          <span class="ao-chip">Version <strong>${esc(p.version)}</strong></span>
          <span class="ao-chip">Database <strong>${esc(p.engine)}</strong></span>
          <span class="ao-chip">Up <strong>${esc(uptime(p.uptime_seconds))}</strong></span>
        </div>
        <nav class="ao-jump" aria-label="Jump to a section" style="--i:4">${jumps.map(([id, label]) => `<button type="button" class="ao-pill" data-jump="${id}">${label}</button>`).join('')}</nav>
      </div>
      <div class="ao-route" aria-hidden="true">
        <svg viewBox="0 0 520 300" focusable="false">
          <path class="ao-road" d="M34 248 C 120 250, 112 172, 200 168 S 300 92, 382 108 S 468 64, 492 42"/>
          <path class="ao-lane" d="M34 248 C 120 250, 112 172, 200 168 S 300 92, 382 108 S 468 64, 492 42"/>
          <path class="ao-progress" pathLength="1" d="M34 248 C 120 250, 112 172, 200 168 S 300 92, 382 108 S 468 64, 492 42"/>
          <g class="ao-stops"></g>
          <g class="ao-car"><g transform="scale(1.3)">
            <circle class="ao-car-halo" r="20"/>
            <rect class="ao-car-body" x="-15" y="-8" width="30" height="16" rx="5"/>
            <rect class="ao-car-cabin" x="1" y="-5.5" width="9" height="11" rx="2.5"/>
            <circle class="ao-car-wheel" cx="-8" cy="-9" r="2.6"/><circle class="ao-car-wheel" cx="8" cy="-9" r="2.6"/>
            <circle class="ao-car-wheel" cx="-8" cy="9" r="2.6"/><circle class="ao-car-wheel" cx="8" cy="9" r="2.6"/>
          </g></g>
        </svg>
      </div>
    </section>

    <section aria-labelledby="ao-figures">
      ${head('ao-figures', 'Right now', 'Live figures', `Counted from your data at ${esc(new Date(d.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}.`)}
      <div class="ao-stats">${STATS.map((s, i) => `<div class="ao-stat" data-reveal data-count="${Number(u[s.key] || 0)}" data-suffix="${s.suffix || ''}" style="--i:${i}">
        <div class="ao-stat-top"><span class="label">${s.label}</span><span class="ao-stat-ic">${icon(s.icon)}</span></div>
        <div class="value metric"><span aria-hidden="true" class="ao-num">0${s.suffix || ''}</span><span class="ao-sr">${fmt(u[s.key])}${s.suffix || ''}</span></div>
        <div class="sub">${esc(s.sub)}</div></div>`).join('')}</div>
    </section>

    <section aria-labelledby="ao-journey">
      ${head('ao-journey', 'The journey', 'How it works', 'Every official vehicle moves through the same request-to-report journey. Each step is handled by the role that owns it, and each hand-off notifies the next person.')}
      <ol class="ao-journey" data-reveal-group>${JOURNEY.map(([ic, title, text], i) => `<li class="ao-jstep" style="--i:${i}"><div class="ao-node">${icon(ic)}</div><div><span class="n">STEP ${i + 1}</span><h3>${title}</h3><p>${text}</p></div></li>`).join('')}</ol>
      <div class="ao-branch" data-reveal><div class="ao-fi">${icon('calendar')}</div><div><h3>Alongside it: IDL external travel</h3><p>For IDL activities the Schedule Transport Officer skips the request queue: create an event, find fleet that is free across the university, pair drivers with vehicles, and track fuel and every extra cost per schedule. Drivers are notified at each change.</p></div></div>
    </section>

    <section aria-labelledby="ao-features">
      ${head('ao-features', 'Everything it does', 'Feature catalogue', `${FEATURES.length} features across ${Object.keys(GROUPS).length} areas. Filter by area, then open any feature to go straight to it.`)}
      <div class="ao-filters" role="group" aria-label="Filter features by area">
        <button type="button" class="ao-filter" data-group="all" aria-pressed="true">All <span class="c">${FEATURES.length}</span></button>
        ${Object.entries(GROUPS).map(([k, label]) => `<button type="button" class="ao-filter" data-group="${k}" aria-pressed="false">${label} <span class="c">${groupCounts[k] || 0}</span></button>`).join('')}
      </div>
      <p class="ao-sr" aria-live="polite" id="aoFeatureStatus"></p>
      <div class="ao-features" id="aoFeatures" data-reveal>${FEATURES.map((f, i) => featureCard(f, i)).join('')}</div>
    </section>

    <section aria-labelledby="ao-roles">
      ${head('ao-roles', 'Who uses it', 'Roles', `${d.roles.length} roles, each a set of capabilities you can change on RBAC. The bar shows how much of the ${c.capabilities}-capability catalogue each role holds.`)}
      <div class="ao-roles">${d.roles.map((r, i) => `<article class="ao-role" data-reveal style="--i:${i}">
        <div class="ao-role-top"><h3>${esc(r.label)}</h3><span class="users">${fmt(r.users)} ${r.users === 1 ? 'user' : 'users'}</span></div>
        <p>${esc(ROLE_TEXT[r.slug] || 'A custom role created on RBAC.')}</p>
        <div class="ao-meter" role="img" aria-label="${r.capabilities} of ${c.capabilities} capabilities"><span style="--v:${Math.min(1, r.capabilities / totalCaps).toFixed(3)}"></span></div>
        <span class="caps">${r.capabilities} of ${c.capabilities} capabilities</span></article>`).join('')}</div>
    </section>

    <section aria-labelledby="ao-why">
      ${head('ao-why', 'Why VMTL', 'What sets it apart', 'The design decisions that make it dependable for a whole university, not just a booking form.')}
      <div class="ao-stand">${STANDOUT.map(([title, text], i) => `<article class="ao-standout" data-reveal style="--i:${i % 2}"><span class="num">${String(i + 1).padStart(2, '0')}</span><div><h3>${title}</h3><p>${text}</p></div></article>`).join('')}</div>
    </section>

    <section aria-labelledby="ao-hood">
      ${head('ao-hood', 'Under the hood', 'Platform & security', 'A Node.js and Express server with a static, installable front-end, running on the database shown below.')}
      <div class="ao-hood">
        <div class="ao-panel" data-reveal style="--i:0"><h3>${icon('terminal')} Platform</h3><dl class="ao-specs">
          <dt>Version</dt><dd>${esc(p.version)}</dd>
          <dt>Runtime</dt><dd>Node.js ${esc(p.node.replace(/^v/, ''))}</dd>
          <dt>Database</dt><dd>${esc(p.engine)}</dd>
          <dt>Uptime</dt><dd>${esc(uptime(p.uptime_seconds))}</dd>
          <dt>API modules · migrations</dt><dd>${c.api_modules} · ${c.migrations}</dd>
          <dt>Menu pages</dt><dd>${c.pages}</dd>
          <dt>Capabilities · templates</dt><dd>${c.capabilities} · ${c.notification_templates}</dd>
          <dt>Audit entries</dt><dd>${fmt(u.audit_entries)}</dd>
        </dl></div>
        <div class="ao-panel" data-reveal style="--i:1"><h3>${icon('shield')} Security built in</h3><ul class="ao-checks">${SECURITY.map((s) => `<li>${check}<span>${s}</span></li>`).join('')}</ul></div>
      </div>
    </section>

    <section class="ao-cta" data-reveal aria-labelledby="ao-more">
      <div><h2 id="ao-more">Go deeper</h2><p>Technical documentation, the module-by-module codebase guide, and the role-by-role walkthrough.</p></div>
      <div class="btn-row"><a class="btn btn-primary" href="/documentation.html">Documentation</a><a class="btn" href="/codebase-guide.html">Codebase guide</a><a class="btn" href="/how-it-works.html">How it works</a><a class="btn" href="/app-health.html">App Health</a></div>
    </section>
  </div>`;

  // ---- Behaviour ---------------------------------------------------------------
  const frames = new Set(); const observers = [];
  VMTL.onLeave(() => { observers.forEach((o) => o.disconnect()); frames.forEach((id) => cancelAnimationFrame(id)); frames.clear(); });

  // Count a figure up from zero once it scrolls into view.
  const countUp = (el) => {
    const target = Number(el.dataset.count || 0); const suffix = el.dataset.suffix || ''; const out = el.querySelector('.ao-num');
    if (reduce || target === 0) { out.textContent = fmt(target) + suffix; return; }
    const start = performance.now(); const duration = 1200;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration); const eased = 1 - Math.pow(1 - t, 3);
      out.textContent = fmt(Math.round(target * eased)) + suffix;
      if (t < 1) { const id = requestAnimationFrame(step); frames.add(id); }
    };
    frames.add(requestAnimationFrame(step));
  };
  const reveal = (el) => { el.classList.add('in'); if (el.dataset.count != null) countUp(el); };
  const targets = [...view.querySelectorAll('[data-reveal], [data-reveal-group]')];
  if (reduce || !('IntersectionObserver' in window)) targets.forEach(reveal);
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    targets.forEach((el) => io.observe(el)); observers.push(io);
  }

  // Hero route: place the five stops along the road, then drive the vehicle
  // between them (pausing at each). Parked at the last stop under reduced motion.
  const svg = view.querySelector('.ao-route svg'); const road = svg.querySelector('.ao-progress');
  const total = road.getTotalLength(); const STOPS = ['Request', 'Approve', 'Assign', 'Drive', 'Report'];
  svg.querySelector('.ao-stops').innerHTML = STOPS.map((label, i) => {
    const pt = road.getPointAtLength(total * (i / (STOPS.length - 1))); const above = i % 2 === 1;
    return `<g class="ao-stop" style="--i:${i}"><circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="9"/><text x="${pt.x.toFixed(1)}" y="${(pt.y + (above ? -24 : 36)).toFixed(1)}" text-anchor="middle">${label}</text></g>`;
  }).join('');
  const car = svg.querySelector('.ao-car');
  if (reduce) {
    const end = road.getPointAtLength(total); const before = road.getPointAtLength(total - 1);
    car.setAttribute('transform', `translate(${end.x} ${end.y}) rotate(${Math.atan2(end.y - before.y, end.x - before.x) * 180 / Math.PI})`);
  } else {
    // Dwell at each stop, ease between them; keyPoints are fractions of the road length.
    const NS = 'http://www.w3.org/2000/svg'; const motion = document.createElementNS(NS, 'animateMotion');
    // Starts at once: the first keyframe holds it at "Request" while the road draws in.
    const attrs = { dur: '9s', repeatCount: 'indefinite', rotate: 'auto', calcMode: 'spline', begin: '0s',
      keyPoints: '0;0;0.25;0.25;0.5;0.5;0.75;0.75;1;1', keyTimes: '0;0.08;0.23;0.31;0.46;0.54;0.69;0.77;0.92;1',
      keySplines: Array(9).fill(0).map((_, i) => (i % 2 ? '0.45 0 0.55 1' : '0 0 1 1')).join(';') };
    Object.entries(attrs).forEach(([k, v]) => motion.setAttribute(k, v));
    const mpath = document.createElementNS(NS, 'mpath'); road.id = 'aoRoad';
    mpath.setAttribute('href', '#aoRoad'); mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#aoRoad');
    motion.appendChild(mpath); car.appendChild(motion);
    // Only animate while the hero is visible (saves battery on long pages).
    if ('IntersectionObserver' in window && svg.pauseAnimations) {
      const heroIo = new IntersectionObserver(([e]) => (e.isIntersecting ? svg.unpauseAnimations() : svg.pauseAnimations()), { threshold: 0.05 });
      heroIo.observe(svg); observers.push(heroIo);
    }
  }

  // Section jumps: scroll, then move keyboard focus to the section heading.
  view.querySelectorAll('[data-jump]').forEach((btn) => btn.addEventListener('click', () => {
    const target = view.querySelector('#' + btn.dataset.jump);
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }));

  // Feature filter: re-render the matching cards with a short stagger.
  const grid = view.querySelector('#aoFeatures'); const status = view.querySelector('#aoFeatureStatus');
  view.querySelectorAll('.ao-filter').forEach((btn) => btn.addEventListener('click', () => {
    view.querySelectorAll('.ao-filter').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const g = btn.dataset.group; const list = g === 'all' ? FEATURES : FEATURES.filter((f) => f[0] === g);
    grid.innerHTML = list.map((f, i) => featureCard(f, i, !reduce)).join('');
    status.textContent = `Showing ${list.length} ${g === 'all' ? '' : GROUPS[g] + ' '}features.`;
  }));
};
