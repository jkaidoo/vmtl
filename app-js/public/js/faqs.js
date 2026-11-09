'use strict';
// Static help / FAQs.
window.VMTL_PAGE = function () {
  const faqs = [
    ['How do I request a vehicle?', 'Open Requests → New request, choose your travel window, destination and passengers, then submit. Fully-booked windows are rejected, so use "Check availability" first.'],
    ['Who approves requests?', 'Approvers and administrators review pending requests and approve or reject them. A reason is required to reject, and they can also send a request back for changes.'],
    ['How is a vehicle assigned?', 'A transport officer assigns a free vehicle + driver to an approved request, which creates the trip. Only vehicles and drivers with no scheduling conflict in the window are offered.'],
    ['What is the trip-progress graphic?', 'Once a trip starts it shows how far it is through its expected duration (the planned window), ticking live. It is visible to everyone who can see the trip.'],
    ['Why can I only see some vehicles?', 'The fleet, drivers and users are scoped to your organisational unit and its sub-units. A central (directorate) unit serves all of its sub-units.'],
    ['How do drivers use the system?', 'Drivers sign in to a focused view of their own assigned trips and operate them — start, complete, signal ready, and accept or decline added destinations.'],
    ['Will I be signed out automatically?', 'Yes — after 30 minutes of inactivity on the web and the installed desktop app. The installed mobile app is treated like a native app and is exempt.'],
  ];
  VMTL.view.innerHTML = VMTL.pageHead('FAQs', 'Common questions about the system.') +
    `<div class="stack">${faqs.map(([q, a]) => `<div class="card pad"><h3>${VMTL.esc(q)}</h3><p class="muted" style="margin:0">${VMTL.esc(a)}</p></div>`).join('')}</div>`;
};
