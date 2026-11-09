'use strict';
// External travel: a vehicle requested by another arm of the university.
window.VMTL_PAGE = function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('External travel request', 'A vehicle requested by another university unit for an extended trip.') + `
    <form id="f" class="card pad" style="max-width:760px">
      <div class="form-grid">
        <div class="field"><label>Requesting unit / org</label><input name="external_org" required></div>
        <div class="field"><label>Expected duration (days)</label><input name="expected_duration_days" type="number" min="1" max="365"></div>
        <div class="field"><label>Travel date</label><input name="travel_date" type="date" required></div>
        <div class="field"><label>Passengers</label><input name="passenger_count" type="number" min="1" max="100" value="1" required></div>
        <div class="field"><label>Departure</label><input name="requested_start_time" type="datetime-local" required></div>
        <div class="field"><label>Expected return</label><input name="expected_end_time" type="datetime-local" required></div>
        <div class="field"><label>Start odometer (optional)</label><input name="start_odometer" type="number" min="0"></div>
        <div class="field"><label>Serving unit (optional)</label><select name="org_unit_id"><option value="">— default —</option>${VMTL.orgUnitOptions()}</select></div>
      </div>
      <div class="field"><label>Destination</label><input name="destination" required></div>
      <div class="field"><label>Purpose</label><textarea name="purpose" required></textarea></div>
      <div class="field"><label>Remarks (optional)</label><input name="remarks"></div>
      <button class="btn btn-primary" type="submit">Log external travel</button>
    </form>`;
  const form = view.querySelector('#f');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {}; new FormData(form).forEach((val, k) => { if (val) body[k] = val; });
    body.passenger_count = Number(body.passenger_count);
    if (body.expected_duration_days) body.expected_duration_days = Number(body.expected_duration_days);
    if (body.start_odometer) body.start_odometer = Number(body.start_odometer);
    if (body.org_unit_id) body.org_unit_id = Number(body.org_unit_id);
    try { const r = await VMTL.api('/vehicle-requests/external', { method: 'POST', body }); VMTL.toast('External travel logged.', 'success'); location.href = `/requests.html?id=${r.data.id}`; }
    catch (err) { VMTL.showErrors(err, form); }
  };
};
