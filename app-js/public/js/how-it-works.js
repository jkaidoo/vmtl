'use strict';
// How it works — an animated, role-scoped walkthrough of the vehicle journey.
// The full request-to-report lifecycle is shown to everyone, but the steps that
// are *yours* (by capability) are highlighted, pulsed, and annotated. A timeline
// spine draws itself in and the step cards reveal with a stagger.
window.VMTL_PAGE = function () {
  const can = (c) => VMTL.can(c);
  const isSuper = VMTL.isSuper();

  // Each stage of the lifecycle. `owns` = capabilities whose holder performs it;
  // `you` note is shown when the current user owns the stage.
  const stages = [
    { icon: 'requests', title: 'Submit a request', owns: ['requests.create'],
      desc: 'A staff member raises a vehicle request — travel date and window, destination(s), purpose and passenger count — and submits it for approval.',
      you: 'You raise and track your own requests, and can check availability before submitting.' },
    { icon: 'approvals', title: 'Review & decide', owns: ['requests.approve'],
      desc: 'An approver reviews each pending request and approves it, rejects it with a reason, or sends it back to the requester for changes.',
      you: 'You approve, reject or request changes on pending requests in your scope.' },
    { icon: 'vehicles', title: 'Assign vehicle & driver', owns: ['requests.assign'],
      desc: 'A transport officer assigns an available vehicle and driver to the approved request. Only conflict-free vehicles and drivers for that window are offered — which creates the trip.',
      you: 'You match a free vehicle and driver to approved requests, creating the trip.' },
    { icon: 'trips', title: 'Run the trip', owns: ['trips.operate'],
      desc: 'The driver starts the trip and the live progress graphic ticks through the planned window. Mid-trip destinations can be added, and the driver completes the trip with the closing odometer.',
      you: 'You start, track and complete your assigned trips, and accept or decline added stops.' },
    { icon: 'fuel', title: 'Log fuel & maintenance', owns: ['fuel.log', 'maintenance.manage'],
      desc: 'Fuel purchases, servicing and odometer readings are recorded against each vehicle, keeping running costs and service schedules up to date.',
      you: 'You record fuel, servicing and odometer readings for the fleet.' },
    { icon: 'analytics', title: 'Review insights', owns: ['analytics.view', 'reports.export'],
      desc: 'Analytics and reports summarise trips, distance, utilisation and fuel economy, and can be exported to CSV, Excel or PDF.',
      you: 'You review analytics and export reports for your organisational unit.' },
  ];
  if (isSuper) {
    stages.push({ icon: 'shield', title: 'Administer the system', owns: ['*'],
      desc: 'Behind the scenes, the system administrator manages users, roles and capabilities (RBAC), the organisational-unit hierarchy, directory sign-in, notifications and system settings.',
      you: 'You oversee the whole system — users, RBAC, org units, directory auth and settings.' });
  }

  const mine = (s) => isSuper || s.owns.some((c) => can(c));
  const yourCount = stages.filter(mine).length;
  const role = VMTL.user && VMTL.user.role;
  const roleName = (role && (role.label || role.name)) || (isSuper ? 'System Administrator' : 'team member');

  const yourPhrase = yourCount === 0 ? 'the steps you take part in are'
    : yourCount === 1 ? 'the step that is yours is'
    : `the ${yourCount} steps that are yours are`;
  const intro = `
    <div class="hiw-intro">
      <span class="role-chip">${VMTL.icon('shield')}${VMTL.esc(roleName)}</span>
      <h2>Your part in the journey</h2>
      <p>Every official vehicle moves through the same request-to-report journey. Below, ${yourPhrase} highlighted${isSuper ? ' — and as administrator, the whole flow is yours to oversee.' : '.'}</p>
    </div>`;

  const card = (s, i) => `
    <div class="hiw-step ${mine(s) ? 'you' : ''}" style="animation-delay:${120 + i * 110}ms">
      <div class="hiw-ic">${VMTL.icon(s.icon)}</div>
      <div class="hiw-body">
        <h3><span class="step-n">STEP ${i + 1}</span> ${VMTL.esc(s.title)} ${mine(s) ? VMTL.badge('Your step', 'green') : ''}</h3>
        <p>${VMTL.esc(s.desc)}</p>
        ${mine(s) ? `<p class="hiw-you-note">${VMTL.esc(s.you)}</p>` : ''}
      </div>
    </div>`;

  VMTL.view.innerHTML = VMTL.pageHead('How it works', 'The vehicle request-to-report journey, with your role highlighted.') +
    intro + `<div class="hiw-flow">${stages.map(card).join('')}</div>`;
};
