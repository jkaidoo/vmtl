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
    { q: 'How do I export reports?', a: 'Open Reports, set the date range and type, then export to CSV, Excel or PDF. Analytics summarises trips, distance, utilisation and fuel economy.', when: () => can('reports.export') || can('analytics.view') },
    { q: 'What is the trip-progress graphic?', a: 'Once a trip starts it shows how far it is through its expected duration (the planned window), ticking live. It is visible to everyone who can see the trip.' },
    { q: 'Why can I only see some vehicles?', a: 'The fleet, drivers and users are scoped to your organisational unit and its sub-units. A central (directorate) unit serves all of its sub-units.' },
    { q: 'Will I be signed out automatically?', a: 'Yes — after 30 minutes of inactivity on the web and the installed desktop app. The installed mobile app is treated like a native app and is exempt.' },
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
