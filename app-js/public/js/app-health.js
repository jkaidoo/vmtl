'use strict';
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('App Health', 'Sign-in activity, recent events and errors.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; try { d = (await VMTL.api('/admin/app-health')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  const kpi = (l, v) => `<div class="kpi"><div class="label">${l}</div><div class="value metric">${v}</div></div>`;
  const auditList = (arr) => arr.length ? arr.map((a) => `<div class="alert-accent" style="margin-bottom:6px"><div class="between"><span>${VMTL.esc(a.description || a.action)}</span><span class="dim" style="font-size:12px">${VMTL.fmtDateTime(a.created_at)}</span></div></div>`).join('') : '<div class="dim">None.</div>';
  view.querySelector('#b').innerHTML = `
    <div class="grid cols-4 mb">${kpi('Sign-ins (7d)', d.stats.successful_signins)}${kpi('Failed (7d)', d.stats.failed_signins)}${kpi('Events (7d)', d.stats.events_7d)}${kpi('Recent errors', d.stats.errors_recent)}</div>
    <div class="grid cols-2">
      <div class="card pad"><h3>Successful sign-ins</h3><div class="mt">${auditList(d.successful_signins)}</div></div>
      <div class="card pad"><h3>Failed sign-ins</h3><div class="mt">${auditList(d.failed_signins)}</div></div>
    </div>
    <div class="card pad mt"><h3>Recent events</h3><div class="mt">${auditList(d.recent_events)}</div></div>
    <div class="card pad mt"><h3>Error log</h3><div class="mt">${d.error_log.length ? d.error_log.map((e) => `<div class="alert-accent red" style="margin-bottom:6px"><div class="between"><span>${VMTL.esc(e.message)}</span><span class="dim" style="font-size:12px">${VMTL.esc(e.timestamp)}</span></div></div>`).join('') : '<div class="dim">No recent errors.</div>'}</div></div>`;
};
