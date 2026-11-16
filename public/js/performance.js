'use strict';
// Driver performance: average requester ratings per driver, and the most recent
// feedback (flagged low ratings first). Built from trip_ratings.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Performance', 'Requester feedback on completed trips, summarised by driver.') +
    `<div class="grid cols-2">
       <div class="card"><h3 class="pad-h">Driver ratings</h3><div id="summary"><div class="loading"><span class="spinner"></span></div></div></div>
       <div class="card"><div class="toolbar"><strong>Recent feedback</strong><label class="checkbox dim" style="font-size:13px;margin-left:auto"><input type="checkbox" id="onlyFlagged"> Flagged only</label></div><div id="recent"><div class="loading"><span class="spinner"></span></div></div></div>
     </div>`;
  const stars = (n) => n == null ? '—' : `<span class="rating-stars">${[1,2,3,4,5].map((i) => `<span class="${i <= Math.round(n) ? '' : 'off'}">★</span>`).join('')}</span> ${n}`;

  const loadSummary = async () => {
    const host = view.querySelector('#summary');
    try {
      const { data } = await VMTL.api('/ratings/summary');
      host.innerHTML = data.length ? `<table class="data"><thead><tr><th>Driver</th><th>Avg</th><th>Trips</th><th>Punctuality</th><th>Vehicle</th><th>Flagged</th></tr></thead><tbody>${data.map((d) => `
        <tr><td data-label="Driver">${VMTL.esc(d.driver_name || '—')}</td><td data-label="Avg">${stars(d.avg_rating)}</td><td data-label="Trips">${d.trips}</td><td data-label="Punctuality">${d.avg_punctuality ?? '—'}</td><td data-label="Vehicle">${d.avg_condition ?? '—'}</td><td data-label="Flagged">${d.flagged ? VMTL.badge(d.flagged, 'red') : '0'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No ratings yet. Requesters rate trips after completion.</div>';
    } catch (e) { host.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  const loadRecent = async () => {
    const host = view.querySelector('#recent');
    const flagged = view.querySelector('#onlyFlagged').checked;
    try {
      const { data } = await VMTL.api(`/ratings${flagged ? '?flagged=1' : ''}`);
      host.innerHTML = data.length ? data.map((r) => `
        <div class="pad" style="border-bottom:1px solid var(--border)">
          <div class="between"><div>${VMTL.esc(r.driver_name || '—')} · <span class="dim">${VMTL.esc(r.trip_number || '')}</span></div><div>${'★'.repeat(r.rating)}${r.flagged ? ' ' + VMTL.badge('flagged', 'red') : ''}</div></div>
          ${r.comment ? `<div class="dim mt" style="font-size:13px">“${VMTL.esc(r.comment)}”</div>` : ''}
          <div class="dim" style="font-size:12px">${VMTL.fmtDate(r.created_at)}${r.vehicle_number ? ` · ${VMTL.esc(r.vehicle_number)}` : ''}</div>
        </div>`).join('') : '<div class="empty">No feedback yet.</div>';
    } catch (e) { host.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  view.querySelector('#onlyFlagged').onchange = loadRecent;
  loadSummary(); loadRecent();
};
