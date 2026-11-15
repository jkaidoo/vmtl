'use strict';
// Driver duty & roster: a week view of shifts, standby, leave and training, with
// a duty-hours summary for fatigue/overtime oversight. Overlapping working
// duties for a driver are rejected server-side.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  if (!VMTL.feature('driverDuty')) {
    view.innerHTML = VMTL.pageHead('Driver duty', 'Shifts, standby, leave and training.') +
      '<div class="card pad"><div class="empty">Driver duty &amp; roster is turned off. An administrator can enable it in System controls → Feature flags.</div></div>';
    return;
  }
  let drivers = [];
  try { drivers = (await VMTL.api('/drivers?all=1')).data; } catch (_) {}

  // Week anchored to Monday.
  const monday = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; };
  let weekStart = monday(new Date());
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  view.innerHTML = VMTL.pageHead('Driver duty', 'Shifts, standby, leave and training. Overlapping working duties are blocked.',
    `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Add duty</button>`) +
    `<div class="card pad mb"><div class="toolbar"><button class="btn btn-sm" id="prev">‹ Prev</button><strong id="weekLabel"></strong><button class="btn btn-sm" id="next">Next ›</button><button class="btn btn-sm" id="today">This week</button></div></div>
     <div class="card"><div id="roster"><div class="loading"><span class="spinner"></span></div></div></div>
     <div class="card mt"><h3 class="pad-h">Duty hours this week</h3><div id="hours"></div></div>`;

  const load = async () => {
    const from = iso(weekStart); const to = iso(addDays(weekStart, 6));
    view.querySelector('#weekLabel').textContent = `${VMTL.fmtDate(from)} – ${VMTL.fmtDate(to)}`;
    const roster = view.querySelector('#roster');
    try {
      const { data } = await VMTL.api(`/duty?from=${from}&to=${to}`);
      const days = Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart, i)));
      const byDay = new Map(days.map((d) => [d, []]));
      data.forEach((duty) => { const d = String(duty.start_at).slice(0, 10); if (byDay.has(d)) byDay.get(d).push(duty); });
      roster.innerHTML = `<div class="cal-grid pad">${days.map((d) => {
        const items = byDay.get(d) || [];
        const wd = new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
        return `<div class="cal-cell"><div class="d">${wd} ${Number(d.slice(8))}</div>${items.map((it) => `<span class="cal-dot badge ${it.duty_type_color}" data-edit="${it.id}" title="${VMTL.esc(it.driver_name)} ${it.start_at.slice(11, 16)}–${it.end_at.slice(11, 16)}" style="cursor:pointer">${VMTL.esc(it.driver_name.split(' ')[0])} · ${it.start_at.slice(11, 16)}</span>`).join('')}</div>`;
      }).join('')}</div>`;
      roster.querySelectorAll('[data-edit]').forEach((el) => { el.onclick = () => openForm(data.find((x) => x.id === Number(el.dataset.edit))); });
      loadHours(from, to);
    } catch (e) { roster.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  const loadHours = async (from, to) => {
    const host = view.querySelector('#hours');
    try {
      const { data } = await VMTL.api(`/duty/hours?from=${from}&to=${to}`);
      host.innerHTML = data.length ? `<table class="data"><thead><tr><th>Driver</th><th>Duties</th><th>Hours</th></tr></thead><tbody>${data.map((d) => `<tr><td data-label="Driver">${VMTL.esc(d.driver_name)}</td><td data-label="Duties">${d.duties}</td><td data-label="Hours">${d.hours}${d.hours > 60 ? ' ' + VMTL.badge('high', 'red') : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No working duties this week.</div>';
    } catch (e) { host.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  function openForm(d = null) {
    const m = VMTL.openModal(`<div class="modal-head"><h3>${d ? 'Edit' : 'Add'} duty</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><form id="df"><div class="form-grid">
        <div class="field"><label>Driver</label><select name="driver_id" required>${drivers.map((dr) => `<option value="${dr.id}" ${d && d.driver_id === dr.id ? 'selected' : ''}>${VMTL.esc(dr.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Type</label><select name="duty_type">${VMTL.enumOptions('duty_type', d ? d.duty_type : 'shift')}</select></div>
        <div class="field"><label>Status</label><select name="status">${VMTL.enumOptions('duty_status', d ? d.status : 'scheduled')}</select></div>
        <div class="field"><label>Start</label><input name="start_at" type="datetime-local" required value="${d ? d.start_at.replace(' ', 'T').slice(0, 16) : ''}"></div>
        <div class="field"><label>End</label><input name="end_at" type="datetime-local" required value="${d ? d.end_at.replace(' ', 'T').slice(0, 16) : ''}"></div>
      </div><div class="field"><label>Notes</label><input name="notes" maxlength="1000" value="${d ? VMTL.esc(d.notes || '') : ''}"></div></form></div>
      <div class="modal-foot">${d ? '<button class="btn btn-danger" id="del">Delete</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    if (d) m.el.querySelector('#del').onclick = async () => { if (!await VMTL.confirm('Remove this duty?', { danger: true, confirmLabel: 'Delete' })) return; await VMTL.api(`/duty/${d.id}`, { method: 'DELETE' }); m.close(); VMTL.toast('Removed.', 'success'); load(); };
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#df'); if (!form.reportValidity()) return;
      const body = {}; new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
      body.driver_id = Number(body.driver_id);
      try { await VMTL.api(d ? `/duty/${d.id}` : '/duty', { method: d ? 'PUT' : 'POST', body }); m.close(); VMTL.toast('Saved.', 'success'); load(); }
      catch (err) { VMTL.showErrors(err, form); }
    };
  }

  view.querySelector('#add').onclick = () => openForm();
  view.querySelector('#prev').onclick = () => { weekStart = addDays(weekStart, -7); load(); };
  view.querySelector('#next').onclick = () => { weekStart = addDays(weekStart, 7); load(); };
  view.querySelector('#today').onclick = () => { weekStart = monday(new Date()); load(); };
  load();
};
