'use strict';
// New vehicle request (and edit/resubmit when ?edit=<id>). Live-checks the chosen
// window against the fleet before submitting.
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  const editId = new URLSearchParams(location.search).get('edit');
  let existing = null;
  if (editId) { try { existing = (await VMTL.api(`/vehicle-requests/${editId}`)).data; } catch (e) { view.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; } }
  const v = existing || {};
  const dt = (s) => (s ? String(s).slice(0, 16).replace(' ', 'T') : '');

  view.innerHTML = VMTL.pageHead(editId ? `Edit ${VMTL.esc(v.request_number)}` : 'New vehicle request', 'Fully-booked windows are rejected — check availability first.') + `
    <form id="f" class="card pad" style="max-width:760px">
      <div class="form-grid">
        <div class="field"><label>Travel date</label><input name="travel_date" type="date" value="${v.travel_date || ''}" required></div>
        <div class="field"><label>Passengers</label><input name="passenger_count" type="number" min="1" max="100" value="${v.passenger_count || 1}" required></div>
        <div class="field"><label>Departure</label><input name="requested_start_time" type="datetime-local" value="${dt(v.requested_start_time)}" required></div>
        <div class="field"><label>Expected return</label><input name="expected_end_time" type="datetime-local" value="${dt(v.expected_end_time)}" required></div>
      </div>
      <div class="field"><label>Destination</label><input name="destination" value="${VMTL.esc(v.destination || '')}" required></div>
      <div class="field"><label>Additional destination (optional)</label><input name="additional_destination" value="${VMTL.esc(v.additional_destination || '')}"></div>
      <div class="field"><label>Purpose</label><textarea name="purpose" required>${VMTL.esc(v.purpose || '')}</textarea></div>
      <div class="form-grid">
        <div class="field"><label>Contact number (optional)</label><input name="contact_number" value="${VMTL.esc(v.contact_number || '')}"></div>
        <div class="field"><label>Special requirements (optional)</label><input name="special_requirements" value="${VMTL.esc(v.special_requirements || '')}"></div>
      </div>
      <div id="availHint" class="mb"></div>
      <div class="btn-row"><button type="button" class="btn" id="check">Check availability</button><button type="submit" class="btn btn-primary">${editId ? 'Save & resubmit' : 'Submit request'}</button></div>
    </form>`;

  const form = view.querySelector('#f');
  const val = (n) => form.querySelector(`[name="${n}"]`).value;
  view.querySelector('#check').onclick = async () => {
    const hint = view.querySelector('#availHint');
    try {
      const r = (await VMTL.api(`/availability/check?start=${encodeURIComponent(val('requested_start_time'))}&end=${encodeURIComponent(val('expected_end_time'))}&passengers=${val('passenger_count')}`)).data;
      hint.innerHTML = `<div class="alert-accent ${r.is_bookable ? 'green' : 'red'}">${r.is_bookable ? `Bookable — ${r.available_vehicles} vehicle(s), ${r.available_drivers} driver(s) free.` : 'Fully booked for that window. Choose another time.'}</div>`;
    } catch (e) { hint.innerHTML = `<div class="alert-accent red">${VMTL.esc(e.message)}</div>`; }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    ['travel_date', 'requested_start_time', 'expected_end_time', 'destination', 'additional_destination', 'purpose', 'contact_number', 'special_requirements'].forEach((n) => { if (val(n)) body[n] = val(n); });
    body.passenger_count = Number(val('passenger_count'));
    try {
      if (editId) { await VMTL.api(`/vehicle-requests/${editId}`, { method: 'PUT', body }); VMTL.toast('Saved & resubmitted.', 'success'); location.href = `/requests.html?id=${editId}`; }
      else { const r = await VMTL.api('/vehicle-requests', { method: 'POST', body }); VMTL.toast('Request submitted.', 'success'); location.href = `/requests.html?id=${r.data.id}`; }
    } catch (err) { VMTL.showErrors(err, form); }
  };
};
