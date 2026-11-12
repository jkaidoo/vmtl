'use strict';
// Goodwill request (driver/transport). Needs an explanation; checked for conflicts.
window.VMTL_PAGE = function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Goodwill request', 'A short-notice trip you are raising on goodwill — an explanation is required.') + `
    <form id="f" class="card pad" style="max-width:720px">
      <div class="form-grid">
        <div class="field"><label>Travel date</label><input name="travel_date" type="date" required></div>
        <div class="field"><label>Passengers</label><input name="passenger_count" type="number" min="1" max="100" value="1" required></div>
        <div class="field"><label>Departure</label><input name="requested_start_time" type="datetime-local" required></div>
        <div class="field"><label>Expected return</label><input name="expected_end_time" type="datetime-local" required></div>
      </div>
      <div class="field"><label>Destination</label><input name="destination" required></div>
      <div class="field"><label>Explanation / reason</label><textarea name="goodwill_reason" required></textarea></div>
      <div class="field"><label>Contact number (optional)</label><input name="contact_number"></div>
      <button class="btn btn-primary" type="submit">Submit goodwill request</button>
    </form>`;
  const form = view.querySelector('#f');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {}; new FormData(form).forEach((val, k) => { if (val) body[k] = val; });
    body.passenger_count = Number(body.passenger_count);
    try { const r = await VMTL.api('/vehicle-requests/goodwill', { method: 'POST', body }); VMTL.toast('Goodwill request submitted.', 'success'); location.href = `/requests.html?id=${r.data.id}`; }
    catch (err) { VMTL.showErrors(err, form); }
  };
};
