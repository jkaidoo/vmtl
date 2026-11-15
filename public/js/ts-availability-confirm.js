'use strict';
// Standalone public page: a driver confirms availability for an event by token.
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var card = document.getElementById('card');
  var token = new URLSearchParams(location.search).get('token');
  var head = '<div class="ac-head"><img src="/knust-logo.png" alt="KNUST"><div><h1>Confirm availability</h1><div class="sub">KNUST · UITS Transport</div></div></div>';
  if (!token) { card.innerHTML = head + '<p class="sub">No confirmation token provided.</p>'; return; }

  function load() {
    fetch('/api/ts/a/' + encodeURIComponent(token), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { card.innerHTML = head + '<p class="sub">' + esc((res.j && res.j.error) || 'This link is not valid.') + '</p>'; return; }
        render(res.j.data);
      })
      .catch(function () { card.innerHTML = head + '<p class="sub">Could not load. Please try again.</p>'; });
  }

  function render(d) {
    var when = [d.type_name, d.date_range, (d.start_time && d.end_time ? d.start_time + '–' + d.end_time : '')].filter(Boolean).map(esc).join(' · ');
    card.innerHTML = head
      + '<p class="sub">Hello <b>' + esc(d.driver_name) + '</b>, please confirm whether you are available for this assignment.</p>'
      + '<div class="ac-event"><b>' + esc(d.event_title) + '</b><div class="sub">' + when + '</div></div>'
      + (d.response ? '<div class="ac-event" style="background:#e6f6ed;color:#009540">You already responded: <b>' + esc(d.response) + '</b>. You can change it below.</div>' : '')
      + '<textarea id="notes" placeholder="Optional note (e.g. reason if unavailable)"></textarea>'
      + '<div class="ac-btns"><button class="yes" id="yes">✓ I am available</button><button class="no" id="no">✗ Not available</button></div>';
    document.getElementById('yes').onclick = function () { respond('available'); };
    document.getElementById('no').onclick = function () { respond('unavailable'); };
  }

  function respond(response) {
    var notes = (document.getElementById('notes') || {}).value || '';
    card.innerHTML = head + '<p class="sub">Saving…</p>';
    fetch('/api/ts/a/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ response: response, notes: notes }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { card.innerHTML = head + '<p class="sub">' + esc((res.j && res.j.error) || 'Could not save.') + '</p>'; return; }
        card.innerHTML = head + '<div class="ac-done"><div class="mark">' + (response === 'available' ? '✅' : '🚫') + '</div>'
          + '<p>Thank you. Your response — <b>' + esc(response) + '</b> — has been recorded.</p><p class="sub">You can close this page.</p></div>';
      })
      .catch(function () { card.innerHTML = head + '<p class="sub">Could not save. Please try again.</p>'; });
  }

  load();
})();
