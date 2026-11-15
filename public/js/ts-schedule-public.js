'use strict';
// Standalone public view of a published transport schedule (no login / app shell).
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var out = document.getElementById('out');
  var token = new URLSearchParams(location.search).get('token');
  if (!token) { out.innerHTML = '<div class="pub-msg">No schedule token provided.</div>'; return; }

  fetch('/api/ts/public/schedule/' + encodeURIComponent(token), { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (!res.ok) { out.innerHTML = '<div class="pub-msg">' + esc((res.j && res.j.error) || 'This schedule is not available.') + '</div>'; return; }
      var d = res.j.data, e = d.event;
      document.title = e.title + ' · Transport Schedule';
      var html = '<div style="margin-bottom:16px"><h2 style="margin:0;font-size:18px">' + esc(e.title) + '</h2>'
        + '<div class="sub" style="color:var(--text-2,#666);font-size:13px;margin-top:3px">' + [e.type_name, e.date_range, (e.start_time && e.end_time ? e.start_time + '–' + e.end_time : ''), e.code].filter(Boolean).map(esc).join('  ·  ') + '</div></div>';
      if (!d.centres.length && !d.supervisors.length) html += '<div class="pub-msg">No published assignments.</div>';
      d.centres.forEach(function (c) {
        html += '<div class="pub-centre"><h2>' + esc(c.name) + (c.region ? ' <span class="region">· ' + esc(c.region) + '</span>' : '') + '</h2>'
          + '<table><thead><tr><th>Driver</th><th>Role</th></tr></thead><tbody>'
          + c.drivers.map(function (p) { return '<tr><td>' + esc(p.name) + (p.lead ? '<span class="lead">' + esc(p.role) + '</span>' : '') + '</td><td>' + esc(p.lead ? '' : p.role) + '</td></tr>'; }).join('')
          + '</tbody></table></div>';
      });
      if (d.supervisors.length) {
        html += '<div class="pub-centre"><h2>Event supervisors</h2><table><thead><tr><th>Name</th></tr></thead><tbody>'
          + d.supervisors.map(function (s) { return '<tr><td>' + esc(s.name) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
      out.innerHTML = html;
    })
    .catch(function () { out.innerHTML = '<div class="pub-msg">Could not load the schedule. Please try again.</div>'; });
})();
