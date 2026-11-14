'use strict';
// Help / FAQs — an animated accordion. Items reveal with a stagger; clicking a
// question smoothly expands its answer and rotates the chevron.
window.VMTL_PAGE = function () {
  const can = (c) => VMTL.can(c);
  const isDriver = () => VMTL.roleSlug() === 'driver';
  // Each FAQ carries an optional `when` predicate so the list is scoped to the
  // signed-in user's role and capabilities (RBAC). Items with no predicate show
  // to everyone.
  const all = [
    { q: 'How do I request a vehicle?', a: 'Open Requests → New request, choose your travel window, destination and passengers, then submit. Fully-booked windows are rejected, so use "Check availability" first.', when: () => can('requests.create') },
    { q: 'How do I raise a goodwill or external-travel request?', a: 'Goodwill and External Travel appear in your sidebar when you hold those capabilities. They capture the extra details (reason, external organisation, duration) and then follow the same approval flow.', when: () => can('requests.create_goodwill') || can('requests.create_external') },
    { q: 'Who approves requests, and how?', a: 'Approvers and administrators review pending requests and approve or reject them. A reason is required to reject, and they can also send a request back to the requester for changes.', when: () => can('requests.approve') },
    { q: 'How is a vehicle assigned?', a: 'A transport officer assigns a free vehicle + driver to an approved request, which creates the trip. Only vehicles and drivers with no scheduling conflict in the window are offered.', when: () => can('requests.assign') },
    { q: 'How do I operate a trip?', a: 'From Trips, start the trip (capturing the opening odometer), add mid-trip stops if needed, and complete it with the closing odometer. The live progress graphic ticks through the planned window.', when: () => can('trips.operate') },
    { q: 'How do drivers use the system?', a: 'Drivers sign in to a focused view of their own assigned trips and operate them — start, complete, signal ready, and accept or decline added destinations.', when: () => isDriver() || can('trips.operate') },
    { q: 'Where do I log fuel and maintenance?', a: 'Use the Fuel and Maintenance pages to record purchases, servicing and odometer readings against a vehicle. These keep running costs and service schedules up to date.', when: () => can('fuel.log') || can('maintenance.manage') },
    { q: 'The fuel station or service provider is not in the list — what do I do?', a: 'Choose "Other" and type the name in the box that appears. The App Owner can add regular stations and providers to the list on the Dropdowns page.', when: () => can('fuel.log') || can('maintenance.manage') },
    { q: 'How do I attach a maintenance receipt?', a: 'When recording maintenance, pick the receipt (a photo or a PDF) before you save. Open it later from the Receipt link next to the provider. If the upload fails, the record is still saved — fix the file and press Save again to retry the upload.', when: () => can('maintenance.manage') },
    { q: 'How do I add a vehicle or driver photo, or a licence photo?', a: 'Add or edit the vehicle or driver and choose the photo (and, for drivers, the licence photo) before saving. Photos are resized in your browser before upload and show as thumbnails in the Vehicles and Drivers lists. Licence photos are visible only to driver managers and to the driver.', when: () => can('vehicles.manage') || can('drivers.manage') },
    { q: 'How do I schedule drivers and vehicles for IDL external travel?', a: 'Open IDL event scheduling and create an event. For each journey choose Add schedule, enter the start and end times, destination and passengers, press "Find available fleet", then pair a free vehicle with a free driver. Only vehicles and drivers with no clash in that window are offered, and the driver is notified.', when: () => can('schedule.events') },
    { q: 'How do I record fuel and other costs for an IDL schedule?', a: 'On the schedule, use "Add fuel purchase" (opens the Fuel form locked to that vehicle and driver) or "Add expense" for allowances, tolls, repairs or accommodation. Each schedule and event shows its running total. A cancelled schedule no longer accepts new costs.', when: () => can('schedule.events') },
    { q: 'Can I change or cancel an IDL schedule?', a: 'Yes, while it is still scheduled: use Reschedule to change the time, destination, vehicle or driver, or Cancel schedule to release them. Once fuel is recorded against a schedule its vehicle and driver are fixed — cancel it and create a new schedule to change them. The affected drivers are notified either way.', when: () => can('schedule.events') },
    { q: 'How will I know I have been assigned a trip?', a: 'You receive a notification (in the app, and by push, email or SMS where enabled) when a trip is assigned to you, and again if it is rescheduled, moved to another driver or cancelled. This includes IDL external travel.', when: () => isDriver() },
    { q: 'How do I export reports?', a: 'Open Reports, set the date range and type, then export to CSV, Excel or PDF. Analytics summarises trips, distance, utilisation and fuel economy.', when: () => can('reports.export') || can('analytics.view') },
    { q: 'Is there a single overview of the whole application?', a: 'Yes — App overview (App Owner, or anyone they share it with) explains how the application works, lists every feature by area with a link to each, shows the roles in use, what sets VMTL apart and the platform it runs on, with live figures counted from your data.', when: () => VMTL.ownerPage('app-overview') },
    { q: 'How do I change the choices in dropdown lists?', a: 'Open Dropdowns (App Owner, or anyone they share it with). You can add, remove and relabel business choices such as stations, providers, fuel types and expense categories. Workflow statuses and vehicle types can be relabelled but their keys cannot be added or removed, because the application depends on them. Roles are managed on RBAC.', when: () => VMTL.ownerPage('dropdowns') },
    { q: 'Where are uploaded files stored?', a: 'In the database by default. On the File Server page (App Owner, or anyone they share it with) you can switch to a server folder or mounted share, an S3-compatible bucket or Supabase Storage; saving runs a write/read/delete test first. Existing files stay where they were saved. Files kept outside the database must be backed up with that storage provider.', when: () => VMTL.ownerPage('file-server') },
    { q: 'Can I let other people use my App Owner pages?', a: 'Yes. Every page in the System section is yours alone until you share it. On Owner page access, choose roles or search for specific people for any of those pages, then Save. The page appears in their menu straight away and they can do everything you can on it; remove them the same way. Read the warning on each page before sharing: sharing Owner page access lets someone change who can open every page (including themselves), and Backup & cleanup holds full database snapshots and can restore or delete data. Every change is recorded in the audit log.', when: () => VMTL.isSuper() },
    { q: 'Why do I see an App Owner page in my menu?', a: 'The App Owner has shared it with you or your role. You can use it fully; the App Owner can withdraw it at any time.', when: () => !VMTL.isSuper() && ((VMTL.user && VMTL.user.owner_pages) || []).length > 0 },
    { q: 'What is the trip-progress graphic?', a: 'Once a trip starts it shows how far it is through its expected duration (the planned window), ticking live. It is visible to everyone who can see the trip.' },
    { q: 'Why can I only see some vehicles?', a: 'The fleet, drivers and users are scoped to your organisational unit and its sub-units. A central (directorate) unit serves all of its sub-units.', when: () => !can('fleet.global') },
    { q: 'Why can I see vehicles and drivers from every unit?', a: 'Your role holds university-wide fleet access (as the University and Schedule Transport Officer roles do), so the fleet is not limited to your own organisational unit.', when: () => can('fleet.global') },
    { q: 'Will I be signed out automatically?', a: 'Yes — after 30 minutes of inactivity in a web browser. The installed app (desktop or mobile) keeps you signed in for up to 30 days of inactivity.' },
    { q: 'Where do I see how the whole process works?', a: 'Open "How it works" in the Help section — it walks through the request-to-report journey and highlights the steps that are yours, based on your role.' },
  ];
  const faqs = all.filter((f) => !f.when || f.when()).map((f) => [f.q, f.a]);
  const chev = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  VMTL.view.innerHTML = VMTL.pageHead('FAQs', 'Common questions about the system. Tap a question to expand.') +
    `<div class="faq-list">${faqs.map(([q, a], i) => `
      <div class="faq" style="animation-delay:${Math.min(i * 65, 390)}ms">
        <button class="faq-q" id="faq-question-${i}" type="button" aria-expanded="false" aria-controls="faq-answer-${i}">${VMTL.esc(q)}${chev}</button>
        <div class="faq-a" id="faq-answer-${i}" role="region" aria-labelledby="faq-question-${i}" aria-hidden="true"><div><p>${VMTL.esc(a)}</p></div></div>
      </div>`).join('')}</div>`;

  VMTL.view.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq');
      const open = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      item.querySelector('.faq-a').setAttribute('aria-hidden', String(!open));
    });
  });
};
