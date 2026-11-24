'use strict';
// Incident & accident reports: list, report, and manage the claim workflow.
// Each incident is tied to a vehicle (and optionally a driver/trip), can carry a
// location pin and photos, and moves reported → assessing → claim_filed →
// resolved → closed.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const canManage = VMTL.can('incidents.manage');
  view.innerHTML = VMTL.pageHead('Incidents', 'Accidents, breakdowns, damage and insurance claims.',
    canManage ? `<button class="btn btn-primary" id="add">${VMTL.icon('plus')} Report incident</button>` : '') +
    `<div id="stats" class="grid cols-4 mb"></div>
     <div class="card">
       <div class="toolbar">
         <select id="f-status" class="input"><option value="">All statuses</option>${VMTL.enumOptions('incident_status')}</select>
         <select id="f-type" class="input"><option value="">All types</option>${VMTL.enumOptions('incident_type')}</select>
       </div>
       <div id="list"><div class="loading"><span class="spinner"></span></div></div>
     </div>`;

  const kpi = (label, value) => `<div class="kpi"><div class="label">${VMTL.esc(label)}</div><div class="value metric">${value}</div></div>`;

  const loadStats = async () => {
    try {
      const { data } = await VMTL.api('/incidents/stats');
      const open = data.by_severity.find((s) => s.severity === 'major');
      const total = data.by_severity.find((s) => s.severity === 'total_loss');
      view.querySelector('#stats').innerHTML =
        kpi('Total incidents', data.total) + kpi('Open', data.open) +
        kpi('Major', open ? open.count : 0) + kpi('Total loss', total ? total.count : 0);
    } catch (_) { /* stats are non-critical */ }
  };

  const load = async () => {
    const list = view.querySelector('#list');
    const qs = new URLSearchParams();
    const st = view.querySelector('#f-status').value; const ty = view.querySelector('#f-type').value;
    if (st) qs.set('status', st); if (ty) qs.set('incident_type', ty);
    try {
      const r = await VMTL.pagedApi(`/incidents${qs.toString() ? `?${qs}` : ''}`, list, load);
      list.innerHTML = r.data.length ? `<table class="data"><thead><tr><th>Number</th><th>Date</th><th>Vehicle</th><th>Type</th><th>Severity</th><th>Status</th><th>Est. cost</th></tr></thead><tbody>${r.data.map((x) => `
        <tr data-id="${x.id}" class="click">
          <td data-label="Number">${VMTL.esc(x.incident_number)}</td>
          <td data-label="Date">${VMTL.fmtDate(x.occurred_at)}</td>
          <td data-label="Vehicle">${VMTL.esc(x.vehicle ? x.vehicle.vehicle_number : '—')}</td>
          <td data-label="Type">${VMTL.esc(x.incident_type_label)}</td>
          <td data-label="Severity">${VMTL.badge(x.severity_label, x.severity_color)}</td>
          <td data-label="Status">${VMTL.badge(x.status_label, x.status_color)}</td>
          <td data-label="Est. cost">${VMTL.fmtCedis(x.estimated_cost)}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">No incidents recorded.</div>';
      list.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => openDetail(Number(tr.dataset.id)); });
    } catch (e) { list.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };

  // Shared form markup for report + edit.
  const formFields = (vehicles, drivers, x = {}) => `<div class="form-grid">
      <div class="field"><label>Vehicle</label><select name="vehicle_id" required>${vehicles.map((v) => `<option value="${v.id}" ${x.vehicle_id === v.id ? 'selected' : ''}>${VMTL.esc(v.vehicle_number)}</option>`).join('')}</select></div>
      <div class="field"><label>Driver (optional)</label><select name="driver_id"><option value="">—</option>${drivers.map((d) => `<option value="${d.id}" ${x.driver_id === d.id ? 'selected' : ''}>${VMTL.esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Type</label><select name="incident_type" required>${VMTL.enumOptions('incident_type', x.incident_type)}</select></div>
      <div class="field"><label>Severity</label><select name="severity" required>${VMTL.enumOptions('incident_severity', x.severity || 'minor')}</select></div>
      <div class="field"><label>When it happened</label><input name="occurred_at" type="datetime-local" required value="${x.occurred_at ? x.occurred_at.replace(' ', 'T').slice(0, 16) : ''}"></div>
      <div class="field"><label>Injuries (count)</label><input name="injuries" type="number" min="0" value="${x.injuries != null ? x.injuries : 0}"></div>
      <div class="field"><label>Estimated cost (₵)</label><input name="estimated_cost" type="number" step="0.01" min="0" value="${x.estimated_cost != null ? x.estimated_cost : ''}"></div>
      <div class="field"><label>Location</label><input name="location_text" maxlength="500" value="${VMTL.esc(x.location_text || '')}" placeholder="e.g. Gate 2, main campus"></div>
      <div class="field"><label>Latitude</label><input name="latitude" type="number" step="any" value="${x.latitude != null ? x.latitude : ''}"></div>
      <div class="field"><label>Longitude <button type="button" class="btn btn-sm" id="geo">${VMTL.icon('target')} Use my location</button></label><input name="longitude" type="number" step="any" value="${x.longitude != null ? x.longitude : ''}"></div>
    </div>
    <div class="field"><label>What happened</label><textarea name="description" required maxlength="5000">${VMTL.esc(x.description || '')}</textarea></div>
    <div class="field"><label>Injury details (optional)</label><input name="injury_details" maxlength="2000" value="${VMTL.esc(x.injury_details || '')}"></div>
    <div class="field"><label>Third party / other vehicle (optional)</label><input name="third_party" maxlength="1000" value="${VMTL.esc(x.third_party || '')}"></div>`;

  const bindGeo = (root) => {
    const btn = root.querySelector('#geo'); if (!btn) return;
    btn.onclick = () => {
      if (!navigator.geolocation) return VMTL.toast('Geolocation is not available.', 'err');
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition((p) => {
        root.querySelector('[name=latitude]').value = p.coords.latitude.toFixed(6);
        root.querySelector('[name=longitude]').value = p.coords.longitude.toFixed(6);
        btn.disabled = false; VMTL.toast('Location captured.', 'success');
      }, () => { btn.disabled = false; VMTL.toast('Could not get your location.', 'err'); });
    };
  };

  const collect = (form) => {
    const body = {}; new FormData(form).forEach((v, k) => { if (v !== '') body[k] = v; });
    ['vehicle_id', 'driver_id', 'trip_id', 'injuries'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
    ['latitude', 'longitude', 'estimated_cost'].forEach((k) => { if (body[k]) body[k] = Number(body[k]); });
    return body;
  };

  async function openAdd() {
    const [vehicles, drivers] = await Promise.all([VMTL.api('/vehicles?all=1'), VMTL.api('/drivers?all=1')]);
    const m = VMTL.openModal(`<div class="modal-head"><h3>Report incident</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><form id="inf">${VMTL.uploadFields('incident')}${formFields(vehicles.data, drivers.data)}</form></div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Report</button></div>`, { large: true });
    bindGeo(m.el);
    let saved = null;
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#inf'); if (!form.reportValidity()) return;
      const body = collect(form);
      await VMTL.saveWithUploads(form, m.el.querySelector('#save'), 'incident', async () => {
        saved ||= await VMTL.api('/incidents', { method: 'POST', body });
        return saved;
      }, () => { m.close(); VMTL.toast('Incident reported.', 'success'); loadStats(); load(); });
    };
  }

  async function openDetail(id) {
    const { data: x } = await VMTL.api(`/incidents/${id}`);
    const photos = (x.photos || []).map((p) => `<a href="${p.url}" target="_blank" rel="noopener"><img src="${p.url}" class="thumb-lg" alt="Incident photo"></a>`).join('') || '<span class="dim">No photos.</span>';
    const mapLink = (x.latitude != null && x.longitude != null) ? `<a href="https://www.openstreetmap.org/?mlat=${x.latitude}&mlon=${x.longitude}#map=17/${x.latitude}/${x.longitude}" target="_blank" rel="noopener">${VMTL.icon('map')} View on map</a>` : '';
    const ro = !canManage;
    const m = VMTL.openModal(`<div class="modal-head"><h3>${VMTL.esc(x.incident_number)} ${VMTL.badge(x.status_label, x.status_color)} ${VMTL.badge(x.severity_label, x.severity_color)}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body">
        <div class="detail-grid">
          <div><span class="dim">Vehicle</span><div>${VMTL.esc(x.vehicle ? x.vehicle.vehicle_number : '—')}</div></div>
          <div><span class="dim">Driver</span><div>${VMTL.esc(x.driver ? x.driver.name : '—')}</div></div>
          <div><span class="dim">Type</span><div>${VMTL.esc(x.incident_type_label)}</div></div>
          <div><span class="dim">When</span><div>${VMTL.fmtDateTime(x.occurred_at)}</div></div>
          <div><span class="dim">Location</span><div>${VMTL.esc(x.location_text || '—')} ${mapLink}</div></div>
          <div><span class="dim">Injuries</span><div>${x.injuries || 0}${x.injury_details ? ` — ${VMTL.esc(x.injury_details)}` : ''}</div></div>
          <div><span class="dim">Third party</span><div>${VMTL.esc(x.third_party || '—')}</div></div>
          <div><span class="dim">Estimated cost</span><div>${VMTL.fmtCedis(x.estimated_cost)}</div></div>
          <div><span class="dim">Claim reference</span><div>${VMTL.esc(x.claim_reference || '—')}</div></div>
          <div><span class="dim">Reported by</span><div>${VMTL.esc(x.reported_by ? x.reported_by.name : '—')}</div></div>
        </div>
        <div class="field"><label>Description</label><div class="readout">${VMTL.esc(x.description)}</div></div>
        ${x.resolution ? `<div class="field"><label>Resolution</label><div class="readout">${VMTL.esc(x.resolution)}</div></div>` : ''}
        <div class="field"><label>Photos</label><div class="thumb-row">${photos}</div></div>
      </div>
      <div class="modal-foot">${ro ? '' : `<button class="btn btn-danger" id="del">Delete</button><span class="spacer"></span>`}<button class="btn" data-close>Close</button>${ro ? '' : '<button class="btn btn-primary" id="edit">Edit / update claim</button>'}</div>`, { large: true });
    if (ro) return;
    m.el.querySelector('#del').onclick = async () => {
      if (!await VMTL.confirm(`Remove incident ${x.incident_number}?`, { danger: true, confirmLabel: 'Delete' })) return;
      await VMTL.api(`/incidents/${id}`, { method: 'DELETE' }); m.close(); VMTL.toast('Removed.', 'success'); loadStats(); load();
    };
    m.el.querySelector('#edit').onclick = async () => { m.close(); openEdit(x); };
  }

  async function openEdit(x) {
    const [vehicles, drivers] = await Promise.all([VMTL.api('/vehicles?all=1'), VMTL.api('/drivers?all=1')]);
    const m = VMTL.openModal(`<div class="modal-head"><h3>Update ${VMTL.esc(x.incident_number)}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body"><form id="inf">${VMTL.uploadFields('incident')}${formFields(vehicles.data, drivers.data, x)}
        <div class="form-grid">
          <div class="field"><label>Status</label><select name="status">${VMTL.enumOptions('incident_status', x.status)}</select></div>
          <div class="field"><label>Claim reference</label><input name="claim_reference" maxlength="120" value="${VMTL.esc(x.claim_reference || '')}"></div>
        </div>
        <div class="field"><label>Resolution / outcome</label><textarea name="resolution" maxlength="5000">${VMTL.esc(x.resolution || '')}</textarea></div>
      </form></div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button></div>`, { large: true });
    bindGeo(m.el);
    m.el.querySelector('#save').onclick = async () => {
      const form = m.el.querySelector('#inf'); if (!form.reportValidity()) return;
      const body = collect(form);
      await VMTL.saveWithUploads(form, m.el.querySelector('#save'), 'incident', async () => {
        await VMTL.api(`/incidents/${x.id}`, { method: 'PUT', body });
        return { data: x };
      }, () => { m.close(); VMTL.toast('Updated.', 'success'); loadStats(); load(); });
    };
  }

  if (canManage) view.querySelector('#add').onclick = openAdd;
  view.querySelector('#f-status').onchange = load;
  view.querySelector('#f-type').onchange = load;
  loadStats(); load();
};
