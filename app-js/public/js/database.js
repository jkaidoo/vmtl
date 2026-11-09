'use strict';
// Database connections — read-only inspection.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Database connections', 'The active data store and table row counts.') + '<div id="b"><div class="loading"><span class="spinner"></span></div></div>';
  let d; try { d = (await VMTL.api('/admin/database')).data; } catch (e) { view.querySelector('#b').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  const a = d.active;
  view.querySelector('#b').innerHTML = `
    <div class="card pad mb"><h3>Active connection</h3><div class="grid cols-3 mt">
      <div><div class="dim" style="font-size:11.5px">Driver</div><div>${VMTL.esc(a.driver)}</div></div>
      <div><div class="dim" style="font-size:11.5px">Database</div><div>${VMTL.esc(a.database || '—')}</div></div>
      <div><div class="dim" style="font-size:11.5px">Host</div><div>${VMTL.esc(a.host || 'local')}</div></div>
    </div><p class="dim mt" style="margin:0">${VMTL.esc(d.migration_note)}</p></div>
    <div class="card"><div class="card-head"><h3>Tables</h3></div><table class="data"><thead><tr><th>Table</th><th class="right">Rows</th></tr></thead><tbody>${d.tables.map((t) => `<tr><td>${VMTL.esc(t.table)}</td><td class="right tnum">${t.rows == null ? '—' : VMTL.fmtNumber(t.rows)}</td></tr>`).join('')}</tbody></table></div>`;
};
