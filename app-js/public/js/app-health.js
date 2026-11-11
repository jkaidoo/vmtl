'use strict';
// App Health — walkin-style: Overview (setup checks, date range, KPI tiles,
// time-series charts, operational events) and Logs (sign-in + error lists).
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  const state = { window: 30, tab: 'overview', detailed: false, dayFilter: null, setupOpen: false };
  let data = null;

  const fmtUptime = (ms) => { const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); return h ? `${h}h ${m}m` : `${m}m`; };
  const prettyAction = (a) => String(a || '').replace(/[._]/g, ' ').toUpperCase();
  const dLabel = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`; };

  // Compact area + line chart. Clicking a point filters the events table to that day.
  function chart(series, onPick) {
    const W = 620, H = 170, pad = { l: 38, r: 14, t: 14, b: 26 };
    const vals = series.map((s) => s.count); const n = vals.length;
    const max = Math.max(1, ...vals);
    const X = (i) => pad.l + (n <= 1 ? 0 : i * (W - pad.l - pad.r) / (n - 1));
    const Y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const pts = vals.map((v, i) => [X(i), Y(v)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = `M${X(0)},${Y(0)} ` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${X(n - 1)},${Y(0)} Z`;
    const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i && v >= 0);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const dot = (n <= 32);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'ah-chart'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = `
      <line x1="${pad.l}" y1="${Y(0)}" x2="${W - pad.r}" y2="${Y(0)}" stroke="var(--border)"/>
      <line x1="${pad.l}" y1="${pad.t}" x2="${W - pad.r}" y2="${pad.t}" stroke="var(--border)" stroke-dasharray="3 4" opacity=".5"/>
      <text x="${pad.l - 6}" y="${pad.t + 4}" text-anchor="end" font-size="10" fill="var(--text-3)">${max}</text>
      <text x="${pad.l - 6}" y="${Y(0) + 3}" text-anchor="end" font-size="10" fill="var(--text-3)">0</text>
      <path d="${area}" fill="var(--primary)" opacity=".12"/>
      <path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${ticks.map((i) => `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">${dLabel(series[i].date)}</text>`).join('')}
      ${dot ? pts.map((p, i) => `<circle class="pt" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--primary)" data-i="${i}"><title>${dLabel(series[i].date)}: ${series[i].count}</title></circle>`).join('') : ''}`;
    svg.querySelectorAll('.pt').forEach((c) => c.addEventListener('click', () => onPick(series[Number(c.dataset.i)].date)));
    return svg;
  }

  const kpi = (label, value, sub) => `<div class="kpi"><div class="label">${esc(label)}</div><div class="value metric pos">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;

  function renderOverview() {
    const host = view.querySelector('#tabbody');
    const s = data.stats; const win = `in the last ${data.window_days} days`;
    const sc = data.setup_checks;
    host.innerHTML = `
      <div class="card pad mb setup${state.setupOpen ? ' open' : ''}" id="setup">
        <button class="setup-head" type="button"><span class="tw">▸</span> <b>Setup checks</b> · ${sc.success} success · ${sc.failed} failed</button>
        <div class="setup-body"><div style="padding-top:10px">${sc.items.map((c) => `<div class="check-item ${c.ok ? 'ok' : 'bad'}"><span class="dot"></span>${esc(c.name)}</div>`).join('')}</div></div>
      </div>
      <div class="card pad mb"><div class="between"><div class="seg" id="range">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${d === state.window ? 'active' : ''}">${d} days</button>`).join('')}</div><span class="dim" id="updated">Updated ${new Date(data.generated_at).toLocaleTimeString()}</span></div></div>
      <div class="grid cols-4 mb">
        ${kpi('Current uptime', fmtUptime(data.uptime_ms), 'since the current server started')}
        ${kpi('Server starts', s.server_starts.toLocaleString(), win)}
        ${kpi('Successful sign-ins', s.successful_signins.toLocaleString(), win)}
        ${kpi('Failed sign-ins', s.failed_signins.toLocaleString(), win)}
        ${kpi('Requests', s.requests.toLocaleString(), win)}
        ${kpi('Operational events', s.events.toLocaleString(), win)}
      </div>
      <div class="grid cols-2 mb">
        <div class="card pad"><div class="between mb"><h3 style="color:var(--primary);margin:0">Successful sign-ins</h3><span class="chart-hint">Select a point to filter events</span></div><div id="c1"></div></div>
        <div class="card pad"><div class="between mb"><h3 style="color:var(--primary);margin:0">Failed sign-ins</h3><span class="chart-hint">Select a point to filter events</span></div><div id="c2"></div></div>
      </div>
      <div class="card pad mb"><div class="between mb"><h3 style="color:var(--primary);margin:0">Requests</h3><span class="chart-hint">Select a point to filter events</span></div><div id="c3"></div></div>
      <div class="card pad"><div class="between mb"><h3 style="color:var(--primary);margin:0">Recent operational events</h3><span id="dayfilter"></span></div><div id="events"></div></div>`;

    const pick = (date) => { state.dayFilter = state.dayFilter === date ? null : date; renderEvents(); };
    host.querySelector('#c1').appendChild(chart(data.series.successful_signins, pick));
    host.querySelector('#c2').appendChild(chart(data.series.failed_signins, pick));
    host.querySelector('#c3').appendChild(chart(data.series.requests, pick));
    renderEvents();

    host.querySelector('#setup .setup-head').onclick = () => { state.setupOpen = !state.setupOpen; host.querySelector('#setup').classList.toggle('open', state.setupOpen); };
    host.querySelectorAll('#range button').forEach((b) => b.onclick = () => { state.window = Number(b.dataset.d); state.dayFilter = null; load(); });
  }

  function renderEvents() {
    const host = view.querySelector('#events'); if (!host) return;
    let events = data.recent_events;
    if (!state.detailed) events = events.filter((e) => e.description || e.user);
    if (state.dayFilter) events = events.filter((e) => String(e.created_at).slice(0, 10) === state.dayFilter);
    const fdom = view.querySelector('#dayfilter');
    if (fdom) fdom.innerHTML = state.dayFilter ? `<button class="btn btn-sm" id="clearDay">× ${dLabel(state.dayFilter)}</button>` : '';
    host.innerHTML = events.length
      ? `<table class="data"><thead><tr><th>WHEN</th><th>EVENT</th><th>DETAIL</th></tr></thead><tbody>${events.map((e) => `<tr><td data-label="When">${VMTL.fmtDateTime(e.created_at)}</td><td data-label="Event"><span class="audit-chip">${esc(prettyAction(e.action))}</span></td><td data-label="Detail">${esc(e.description || e.user || '—')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No events for this selection.</div>';
    const cd = view.querySelector('#clearDay'); if (cd) cd.onclick = () => { state.dayFilter = null; renderEvents(); };
  }

  function renderLogs() {
    const host = view.querySelector('#tabbody');
    const list = (arr) => arr.length ? `<div class="log-list">${arr.map((a) => `<div class="log-item"><span>${esc(a.description || a.action)}</span><span class="when">${VMTL.fmtDateTime(a.created_at)}</span></div>`).join('')}</div>` : '<div class="dim">None.</div>';
    host.innerHTML = `
      <div class="grid cols-2 mb">
        <div class="card pad"><h3>Successful sign-ins</h3><div class="mt">${list(data.successful_signins)}</div></div>
        <div class="card pad"><h3>Failed sign-ins</h3><div class="mt">${list(data.failed_signins)}</div></div>
      </div>
      <div class="card pad"><h3>Error log</h3><div class="mt">${data.error_log.length ? `<div class="log-list">${data.error_log.map((e) => `<div class="log-item error"><span>${esc(e.message)}</span><span class="when">${esc(e.timestamp)}</span></div>`).join('')}</div>` : '<div class="dim">No recent errors.</div>'}</div></div>`;
  }

  const renderTab = () => { if (state.tab === 'overview') renderOverview(); else renderLogs(); };

  const load = async () => {
    const body = view.querySelector('#tabbody'); if (body) body.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try { data = (await VMTL.api(`/admin/app-health?window=${state.window}`)).data; renderTab(); }
    catch (e) { if (body) body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };

  const actions = `<label class="ah-check"><input type="checkbox" id="detailed" style="width:auto"> Include detailed events</label><button class="btn" id="refresh">${VMTL.icon('health')} Refresh</button><button class="btn btn-primary" id="pdf">Download PDF</button>`;
  view.innerHTML = VMTL.pageHead('App Health', 'Application reliability, authentication and operational activity.', actions) +
    `<div class="tabs" id="tabs"><button data-t="overview" class="active">Overview</button><button data-t="logs">Logs</button></div>
     <div id="tabbody"><div class="loading"><span class="spinner"></span></div></div>`;

  view.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { view.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b)); state.tab = b.dataset.t; renderTab(); });
  view.querySelector('#refresh').onclick = load;
  view.querySelector('#detailed').onchange = (e) => { state.detailed = e.target.checked; if (state.tab === 'overview') renderEvents(); };
  view.querySelector('#pdf').onclick = async () => {
    try {
      const res = await fetch(`/api/admin/app-health/export?window=${state.window}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `app-health_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      VMTL.toast('App Health PDF downloaded.', 'success');
    } catch (e) { VMTL.toast(e.message || 'Export failed.', 'err'); }
  };
  load();
};
