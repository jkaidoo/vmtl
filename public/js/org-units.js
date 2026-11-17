'use strict';
// Organisation: a KNUST-downwards org chart (collapsible tree) with counts and
// CRUD, plus "Import Departments" which seeds the full tree from the bundled
// UITS register. A flat table view is kept as a secondary view.
window.VMTL_PAGE = async function () {
  injectCss();
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Organisation', 'The university org-unit tree, KNUST downwards. Scoping flows from here.',
    `<button class="btn btn-primary" id="import">${VMTL.icon('plus')} Import Departments</button><button class="btn" id="add">${VMTL.icon('plus')} Add unit</button>`) +
    `<div class="oc-toolbar">
       <div class="seg">
         <button class="on" data-view="chart">Org chart</button>
         <button data-view="table">Table</button>
       </div>
       <div class="oc-search"><input id="ocq" placeholder="Search any unit or department…"></div>
       <div class="oc-tools"><button class="ghost" id="expandAll">Expand all</button><button class="ghost" id="collapseAll">Collapse all</button></div>
     </div>
     <div class="card" id="chartView"><div id="chart"><div class="loading"><span class="spinner"></span></div></div></div>
     <div class="card hidden" id="tableView"><div id="tree"></div></div>`;

  let types = [];
  let rows = [];

  const load = async () => {
    try {
      const r = await VMTL.api('/org-units/tree');
      types = r.types || [];
      rows = r.data || [];
      renderChart();
      renderTable();
    } catch (e) {
      document.getElementById('chart').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`;
    }
  };

  // ---- build hierarchy from the flat, path-ordered rows ----
  function buildTree() {
    const byId = new Map(rows.map((u) => [u.id, { ...u, children: [] }]));
    const roots = [];
    for (const n of byId.values()) {
      const p = n.parent_id && byId.get(n.parent_id);
      if (p) p.children.push(n); else roots.push(n);
    }
    return roots;
  }
  const typeCount = (node, t, acc = { n: 0 }) => { if (node.type === t) acc.n++; node.children.forEach((c) => typeCount(c, t, acc)); return acc.n; };
  const countDesc = (nodes, t) => nodes.reduce((s, n) => s + typeCount(n, t), 0);

  // ---- chart ----
  function renderChart() {
    const roots = buildTree();
    const chart = document.getElementById('chart');
    if (!rows.length) { chart.innerHTML = emptyState(); wireEmpty(); return; }

    // The institution is the single root when present; otherwise everything is top-level.
    const inst = roots.find((r) => r.type === 'institution');
    const tops = inst ? inst.children : roots;
    const colleges = countDesc(roots, 'college');
    const faculties = countDesc(roots, 'faculty');
    const departments = countDesc(roots, 'department');

    const groups = {
      college: tops.filter((t) => t.type === 'college'),
      directorate: tops.filter((t) => t.type === 'directorate'),
      other: tops.filter((t) => !['college', 'directorate'].includes(t.type)),
    };
    const section = (label, list) => list.length ? `<div class="oc-section-label">${label}</div><div class="toprow">${list.map(card).join('')}</div>` : '';

    chart.innerHTML = `
      <div class="root-wrap">
        <div class="root-node">
          <div class="k">${VMTL.esc(inst?.code || 'KNUST')}</div>
          <h2>${VMTL.esc(inst?.name || 'Kwame Nkrumah University of Science & Technology')}</h2>
          <div class="rn-stats"><div><b>${colleges}</b><span>colleges</span></div><div><b>${faculties}</b><span>faculties & schools</span></div><div><b>${departments}</b><span>departments</span></div></div>
        </div>
        <div class="trunk"></div>
      </div>
      ${section('Colleges', groups.college)}
      ${section('Directorates', groups.directorate)}
      ${section('Central & standalone units', groups.other)}
      <div class="oc-detail" id="ocDetail"></div>`;

    chart.querySelectorAll('.gcard').forEach((c) => c.onclick = () => selectTop(Number(c.dataset.id)));
    const first = (groups.college[0] || groups.directorate[0] || groups.other[0]);
    if (first) selectTop(first.id);

    function card(n) {
      const fac = typeCount(n, 'faculty');
      const dep = typeCount(n, 'department');
      return `<button class="gcard" data-id="${n.id}">
        <span class="badge b-${n.type}">${VMTL.esc(n.type_label || n.type)}</span>
        <h3>${VMTL.esc(n.name)}</h3>
        <div class="gmeta">${fac ? `<span><b>${fac}</b> fac.</span>` : ''}<span><b>${dep || n.children.length}</b> depts</span></div>
      </button>`;
    }
  }

  let topIndex = {};
  function selectTop(id) {
    const roots = buildTree();
    const flat = [];
    (function walk(ns) { ns.forEach((n) => { flat.push(n); walk(n.children); }); })(roots);
    const node = flat.find((n) => n.id === id);
    document.querySelectorAll('.gcard').forEach((c) => c.classList.toggle('sel', Number(c.dataset.id) === id));
    const detail = document.getElementById('ocDetail');
    if (!node) { detail.innerHTML = ''; return; }
    const dep = typeCount(node, 'department');
    detail.innerHTML = `<div class="oc-detail-head"><span class="badge b-${node.type}">${VMTL.esc(node.type_label || node.type)}</span><h3>${VMTL.esc(node.name)}</h3><span class="oc-cnt">${dep} departments</span></div>${treeHtml(node.children, 0)}`;
    wireTree(detail);
    const q = document.getElementById('ocq').value.trim();
    if (q) runSearch(q);
  }

  function treeHtml(nodes, depth) {
    if (!nodes.length) return '';
    return `<ul class="oc-tree">${nodes.map((n) => {
      const kids = n.children.length;
      const stats = statBits(n);
      return `<li class="oc-node">
        <div class="oc-row" style="--pad:${10 + depth * 20}px">
          <span class="oc-tw ${kids ? 'open' : 'leaf'}" ${kids ? 'data-tw' : ''}>${kids ? caret() : ''}</span>
          <span class="badge b-${n.type}">${VMTL.esc(n.type_label || n.type)}</span>
          <span class="oc-nm" data-name="${VMTL.esc((n.name || '').toLowerCase())}">${VMTL.esc(n.name)}</span>
          ${stats}
          <span class="oc-act"><button class="ia" data-edit='${encodeURIComponent(JSON.stringify(stripKids(n)))}'>Edit</button><button class="ia" data-del="${n.id}" data-name="${VMTL.esc(n.name)}">Remove</button></span>
        </div>
        ${kids ? treeHtml(n.children, depth + 1) : ''}
      </li>`;
    }).join('')}</ul>`;
  }
  const stripKids = (n) => { const { children, ...rest } = n; return rest; };
  function statBits(n) {
    const bits = [];
    if (n.users_count) bits.push(`<b>${n.users_count}</b> staff`);
    if (n.vehicles_count) bits.push(`<b>${n.vehicles_count}</b> veh.`);
    if (n.drivers_count) bits.push(`<b>${n.drivers_count}</b> drv.`);
    return bits.length ? `<span class="oc-stat">${bits.join('<span class="dot">·</span>')}</span>` : '';
  }

  function wireTree(scope) {
    scope.querySelectorAll('[data-tw]').forEach((tw) => tw.onclick = () => {
      const li = tw.closest('.oc-node'); const kids = li.querySelector('.oc-tree');
      if (!kids) return;
      const open = tw.classList.toggle('open'); kids.classList.toggle('hide', !open);
    });
    scope.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => unitModal(JSON.parse(decodeURIComponent(b.dataset.edit)), types, load));
    scope.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (await VMTL.confirm(`Remove "${b.dataset.name}"?`, { danger: true, confirmLabel: 'Remove' })) {
        try { await VMTL.api(`/org-units/${b.dataset.del}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); load(); } catch (e) { VMTL.showErrors(e); }
      }
    });
  }

  // ---- table (secondary) ----
  function renderTable() {
    const tree = document.getElementById('tree');
    tree.innerHTML = `<table class="data"><thead><tr><th>Unit</th><th>Type</th><th>Vehicles</th><th>Drivers</th><th>Staff</th><th></th></tr></thead><tbody>${rows.map((u) => `<tr><td data-label="Unit"><span style="padding-left:${(u.depth || 0) * 18}px">${u.depth ? '└ ' : ''}${VMTL.esc(u.name)}</span></td><td data-label="Type">${VMTL.esc(u.type_label)}</td><td data-label="Vehicles">${u.vehicles_count}</td><td data-label="Drivers">${u.drivers_count}</td><td data-label="Staff">${u.users_count}</td><td data-label=""><div class="btn-row"><button class="btn btn-sm" data-edit='${encodeURIComponent(JSON.stringify(u))}'>Edit</button><button class="btn btn-sm" data-del="${u.id}" data-name="${VMTL.esc(u.name)}">Remove</button></div></td></tr>`).join('')}</tbody></table>`;
    tree.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => unitModal(JSON.parse(decodeURIComponent(b.dataset.edit)), types, load));
    tree.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await VMTL.confirm(`Remove "${b.dataset.name}"?`, { danger: true, confirmLabel: 'Remove' })) { try { await VMTL.api(`/org-units/${b.dataset.del}`, { method: 'DELETE' }); VMTL.toast('Removed.', 'success'); load(); } catch (e) { VMTL.showErrors(e); } } });
  }

  // ---- search ----
  function runSearch(q) {
    const detail = document.getElementById('ocDetail');
    const ql = q.toLowerCase();
    // jump to the first top group that contains a match
    if (ql) {
      const roots = buildTree();
      const inst = roots.find((r) => r.type === 'institution');
      const tops = inst ? inst.children : roots;
      const sel = document.querySelector('.gcard.sel');
      const selHas = sel && JSON.stringify(buildTree().flatMap(function f(n){return [n,...n.children.flatMap(f)];}).find((n)=>n.id===Number(sel.dataset.id))).toLowerCase().includes(ql);
      if (!selHas) { const hit = tops.find((t) => JSON.stringify(t).toLowerCase().includes(ql)); if (hit) { selectTop(hit.id); return; } }
    }
    detail.querySelectorAll('.oc-nm').forEach((nm) => {
      const hit = ql && nm.dataset.name.includes(ql);
      nm.classList.toggle('hit', !!hit);
      if (hit) { let li = nm.closest('.oc-node'); while (li) { const ch = li.querySelector(':scope > .oc-tree'); if (ch) { ch.classList.remove('hide'); const tw = li.querySelector(':scope > .oc-row .oc-tw'); if (tw) tw.classList.add('open'); } li = li.parentElement && li.parentElement.closest('.oc-node'); } }
    });
  }

  // ---- wiring ----
  view.querySelector('#add').onclick = () => unitModal(null, types, load);
  view.querySelector('#import').onclick = () => importModal(load);
  view.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
    view.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    const chart = b.dataset.view === 'chart';
    document.getElementById('chartView').classList.toggle('hidden', !chart);
    document.getElementById('tableView').classList.toggle('hidden', chart);
  });
  const q = view.querySelector('#ocq');
  q.oninput = () => runSearch(q.value.trim());
  view.querySelector('#expandAll').onclick = () => { const d = document.getElementById('ocDetail'); d.querySelectorAll('.oc-tw[data-tw]').forEach((t) => t.classList.add('open')); d.querySelectorAll('.oc-tree').forEach((c) => c.classList.remove('hide')); };
  view.querySelector('#collapseAll').onclick = () => { const d = document.getElementById('ocDetail'); d.querySelectorAll('.oc-tw[data-tw]').forEach((t) => t.classList.remove('open')); d.querySelectorAll('.oc-node .oc-tree').forEach((c) => c.classList.add('hide')); };

  function emptyState() {
    return `<div class="oc-empty"><h3>No organisation units yet</h3><p>Import the full KNUST structure — colleges, faculties and all departments — from the university register. You can edit anything afterwards.</p><button class="btn btn-primary" id="emptyImport">${VMTL.icon('plus')} Import Departments</button></div>`;
  }
  function wireEmpty() { const b = document.getElementById('emptyImport'); if (b) b.onclick = () => importModal(load); }

  load();
};

// ---- Import Departments modal ----
async function importModal(done) {
  const m = VMTL.openModal(`<div class="modal-head"><h3>Import Departments</h3><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body" id="imBody"><div class="loading"><span class="spinner"></span></div></div>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="imGo" disabled>Import</button></div>`);
  try {
    const { data: p } = await VMTL.api('/org-units/import/preview');
    m.el.querySelector('#imBody').innerHTML = `
      <div class="im-src"><span class="dot"></span><div>Source: <b>${VMTL.esc(p.institution)}</b> — bundled UITS college/faculty/department register</div></div>
      <div class="im-stats"><div><b>${p.counts.colleges}</b><span>colleges</span></div><div><b>${p.counts.faculties}</b><span>faculties & schools</span></div><div><b>${p.counts.departments}</b><span>departments</span></div></div>
      <div class="im-diff">
        <div class="new"><span class="n">${p.departments_new}</span><span>new units will be created</span></div>
        <div class="link"><span class="n">${p.departments_linked}</span><span>matched to existing units — kept & linked</span></div>
        <div class="skip"><span class="n">0</span><span>removed — import never deletes</span></div>
      </div>
      <p class="im-note">Builds Institution → College → Faculty/School → Department. Names match what the Unified API returns per staff, so sign-ins reconcile with this tree instead of duplicating it. Safe to re-run.</p>`;
    const go = m.el.querySelector('#imGo');
    go.disabled = false;
    go.textContent = `Import ${p.counts.departments} departments`;
    go.onclick = async () => {
      go.disabled = true; go.textContent = 'Importing…';
      try {
        const { data: r } = await VMTL.api('/org-units/import', { method: 'POST' });
        m.close();
        VMTL.toast(`Imported — ${r.created} new unit${r.created === 1 ? '' : 's'}, ${r.departments} departments.`, 'success');
        done();
      } catch (e) { go.disabled = false; go.textContent = 'Import'; VMTL.showErrors(e); }
    };
  } catch (e) {
    m.el.querySelector('#imBody').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`;
  }
}

// ---- add / edit unit modal (unchanged behaviour) ----
function unitModal(u, types, done) {
  const e = u || {};
  const typeOpts = (types.length ? types : VMTL.meta.enums.org_unit_type || []).map((t) => `<option value="${t.value}" ${e.type === t.value ? 'selected' : ''}>${VMTL.esc(t.label)}</option>`).join('');
  const m = VMTL.openModal(`<div class="modal-head"><h3>${u ? 'Edit unit' : 'Add unit'}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><form id="of">
    <div class="field"><label>Name</label><input name="name" value="${VMTL.esc(e.name || '')}" required></div>
    <div class="form-grid"><div class="field"><label>Code</label><input name="code" value="${VMTL.esc(e.code || '')}"></div><div class="field"><label>Type</label><select name="type" required>${typeOpts}</select></div></div>
    <div class="field"><label>Parent unit</label><select name="parent_id"><option value="">— none (root) —</option>${VMTL.orgUnitOptions(e.parent_id)}</select></div>
  </form></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`);
  m.el.querySelector('#save').onclick = async () => {
    const form = m.el.querySelector('#of'); const body = { name: form.name.value, type: form.type.value };
    if (form.code.value) body.code = form.code.value;
    if (form.parent_id.value) body.parent_id = Number(form.parent_id.value);
    try { if (u) await VMTL.api(`/org-units/${u.id}`, { method: 'PUT', body }); else await VMTL.api('/org-units', { method: 'POST', body }); m.close(); VMTL.toast('Saved.', 'success'); done(); }
    catch (err) { VMTL.showErrors(err, form); }
  };
}

function caret() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'; }

function injectCss() {
  if (document.getElementById('org-chart-css')) return;
  const s = document.createElement('style');
  s.id = 'org-chart-css';
  s.textContent = `
  .oc-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px}
  .oc-toolbar .seg{display:inline-flex;background:var(--surface-2,var(--bg));border:1px solid var(--border);border-radius:var(--radius);padding:3px}
  .oc-toolbar .seg button{font:inherit;font-size:13px;font-weight:600;border:0;background:transparent;color:var(--text-2);padding:6px 14px;border-radius:7px;cursor:pointer}
  .oc-toolbar .seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--elev-1)}
  .oc-search{flex:1;min-width:170px;max-width:320px}
  .oc-search input{width:100%;font:inherit;font-size:13.5px;padding:8px 12px;border:1px solid var(--border-strong,var(--border));border-radius:var(--radius);background:var(--surface);color:var(--text)}
  .oc-tools{display:flex;gap:8px;margin-left:auto}
  .oc-tools .ghost{font:inherit;font-size:12.5px;font-weight:600;color:var(--text-2);background:transparent;border:1px solid var(--border);border-radius:var(--radius-sm,7px);padding:6px 11px;cursor:pointer}
  .oc-tools .ghost:hover{border-color:var(--border-strong,var(--border));color:var(--text)}
  .badge{display:inline-flex;align-items:center;font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:2px 7px;border-radius:999px;white-space:nowrap}
  .b-institution,.b-college{color:var(--primary);background:var(--primary-tint,rgba(0,149,64,.1))}
  .b-directorate,.b-faculty{color:var(--info,#1f5fd0);background:var(--info-tint,rgba(31,95,208,.1))}
  .b-department,.b-unit,.b-office{color:var(--text-2);background:var(--surface-2,var(--bg));border:1px solid var(--border)}
  .root-wrap{display:flex;flex-direction:column;align-items:center}
  .root-node{background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 72%,#000));color:#fff;border-radius:var(--radius-lg,14px);padding:15px 26px;text-align:center;box-shadow:var(--elev-2,var(--elev-1));max-width:520px}
  .root-node .k{font-size:11px;font-weight:700;letter-spacing:.14em;opacity:.85}
  .root-node h2{margin:3px 0 9px;font-size:17px;letter-spacing:-.01em}
  .root-node .rn-stats{display:flex;gap:18px;justify-content:center;font-size:12px}
  .root-node .rn-stats b{display:block;font-size:16px;font-weight:800}.root-node .rn-stats span{opacity:.82}
  .trunk{width:2px;height:20px;background:var(--border-strong,var(--border))}
  .oc-section-label{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-3,var(--text-2));margin:16px 2px 8px}
  .toprow{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px}
  .gcard{flex:0 0 auto;width:206px;text-align:left;background:var(--surface);border:1px solid var(--border-strong,var(--border));border-radius:var(--radius);padding:12px;cursor:pointer;transition:.15s}
  .gcard:hover{border-color:var(--primary);box-shadow:var(--elev-1);transform:translateY(-1px)}
  .gcard.sel{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-tint,rgba(0,149,64,.12)),var(--elev-1)}
  .gcard h3{margin:8px 0 0;font-size:13px;line-height:1.3}
  .gcard .gmeta{font-size:11px;color:var(--text-3,var(--text-2));margin-top:6px;display:flex;gap:9px}
  .gcard .gmeta b{color:var(--text-2);font-weight:700}
  .oc-detail{margin-top:10px;border-top:1px dashed var(--border);padding-top:14px}
  .oc-detail-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .oc-detail-head h3{margin:0;font-size:15px}.oc-cnt{font-size:12px;color:var(--text-3,var(--text-2))}
  .oc-tree{list-style:none;margin:0;padding:0}.oc-tree.hide{display:none}
  .oc-row{display:flex;align-items:center;gap:9px;padding:6px 8px 6px var(--pad,10px);border-radius:var(--radius-sm,7px)}
  .oc-row:hover{background:var(--surface-2,var(--bg))}
  .oc-tw{width:16px;height:16px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;color:var(--text-3,var(--text-2));cursor:pointer;border-radius:4px}
  .oc-tw svg{width:11px;height:11px;transition:transform .15s}.oc-tw.open svg{transform:rotate(90deg)}.oc-tw.leaf{visibility:hidden}
  .oc-nm{font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .oc-nm.hit{background:color-mix(in srgb,var(--primary) 22%,transparent);border-radius:4px;padding:0 3px}
  .oc-stat{font-size:11px;color:var(--text-3,var(--text-2));flex:0 0 auto}.oc-stat b{color:var(--text-2);font-weight:700}.oc-stat .dot{margin:0 5px;opacity:.5}
  .oc-act{opacity:0;display:flex;gap:5px;transition:.12s;flex:0 0 auto}.oc-row:hover .oc-act{opacity:1}
  .oc-act .ia{font-size:11px;color:var(--text-3,var(--text-2));border:1px solid var(--border);background:var(--surface);border-radius:5px;padding:2px 7px;cursor:pointer}
  .oc-act .ia:hover{color:var(--primary);border-color:var(--primary)}
  .oc-empty{text-align:center;padding:40px 20px}.oc-empty h3{margin:0 0 6px}.oc-empty p{color:var(--text-2);max-width:460px;margin:0 auto 16px}
  .im-src{display:flex;align-items:center;gap:10px;background:var(--surface-2,var(--bg));border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-size:13px;margin-bottom:14px}
  .im-src .dot{width:8px;height:8px;border-radius:50%;background:var(--success,#067a54);box-shadow:0 0 0 3px color-mix(in srgb,var(--success,#067a54) 25%,transparent)}
  .im-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
  .im-stats div{background:var(--surface-2,var(--bg));border:1px solid var(--border);border-radius:var(--radius);padding:11px;text-align:center}
  .im-stats b{display:block;font-size:21px;font-weight:800}.im-stats span{font-size:11px;color:var(--text-3,var(--text-2))}
  .im-diff{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:12px}
  .im-diff div{display:flex;align-items:center;gap:10px;padding:9px 12px;font-size:13px;border-bottom:1px solid var(--border)}.im-diff div:last-child{border-bottom:0}
  .im-diff .n{width:34px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
  .im-diff .new .n{color:var(--primary)}.im-diff .link .n{color:var(--info,#1f5fd0)}.im-diff .skip .n{color:var(--text-3,var(--text-2))}
  .im-note{font-size:12px;color:var(--text-3,var(--text-2));line-height:1.5;margin:0}
  .hidden{display:none}`;
  document.head.appendChild(s);
}
