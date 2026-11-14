'use strict';
const db = require('./db_ref');
const settings = require('./settings');
const roles = require('./roleRepository');
const { isRequesterOnly } = require('./roles');
  const OPS = ['staff', 'approver', 'transport_admin', 'supervisor', 'administrator'];
const catalogue = [
    { label: 'Workspace', items: [
      { key: 'dashboard', to: '/dashboard.html', label: 'Dashboard', icon: 'dashboard', mobile: true },
      { key: 'requests', anyCaps: ['requests.create', 'requests.view_all', 'requests.approve', 'requests.assign', 'system.admin'], to: '/requests.html', label: 'Requests', icon: 'requests', roles: OPS, mobile: true },
      { key: 'approvals', anyCaps: ['requests.approve', 'system.admin'], to: '/approvals.html', label: 'Approvals', icon: 'approvals', roles: ['approver', 'supervisor', 'administrator'], mobile: true },
      { key: 'goodwill', to: '/goodwill.html', label: 'Goodwill', icon: 'gift', cap: 'requests.create_goodwill' },
      { key: 'external', to: '/external-travel.html', label: 'External Travel', icon: 'plane', cap: 'requests.create_external' },
      { key: 'trips', anyCaps:['trips.operate','requests.assign','requests.view_all'], roles:['driver','transport_admin','approver','administrator','supervisor'], to: '/trips.html', label: 'Trips', icon: 'trips', mobile: true },
    ] },
    { label: 'Fleet', items: [
      { key: 'vehicles', anyCaps: ['vehicles.manage', 'requests.assign', 'requests.view_all', 'system.admin'], to: '/vehicles.html', label: 'Vehicles', icon: 'vehicles', roles: OPS, mobile: true },
      { key: 'tracking', anyCaps: ['trips.operate', 'requests.assign', 'requests.view_all', 'system.admin'], to: '/tracking.html', label: 'Live map', icon: 'map', roles: ['approver', 'transport_admin', 'supervisor', 'administrator'], mobile: true },
      {key:'event-schedules',to:'/event-schedules.html',label:'IDL event scheduling',icon:'calendar',cap:'schedule.events'},
      { key: 'schedule', anyCaps: ['trips.operate', 'requests.assign', 'requests.view_all', 'system.admin'], to: '/schedule.html', label: 'Schedule', icon: 'calendar', roles: ['approver', 'transport_admin', 'supervisor', 'administrator'] },
      { key: 'drivers', anyCaps: ['drivers.manage', 'requests.assign', 'requests.view_all', 'system.admin'], to: '/drivers.html', label: 'Drivers', icon: 'drivers', roles: OPS },
      { key: 'maintenance', anyCaps: ['maintenance.manage', 'system.admin'], to: '/maintenance.html', label: 'Maintenance', icon: 'wrench', roles: ['transport_admin', 'supervisor', 'administrator'] },
      { key: 'fuel', to: '/fuel.html', label: 'Fuel', icon: 'fuel', cap: 'fuel.log' },
    ] },
    { label: 'Insights', items: [
      { key: 'analytics', to: '/analytics.html', label: 'Analytics', icon: 'analytics', cap: 'analytics.view' },
      { key: 'reports', to: '/reports.html', label: 'Reports', icon: 'reports', cap: 'reports.export' },
    ] },
    { label: 'Administration', items: [
      { key: 'users', to: '/users.html', label: 'Users', icon: 'users', cap: 'users.manage' },
      { key: 'clients', to: '/clients.html', label: 'Clients', icon: 'contacts', cap: 'users.manage' },
      { key: 'org-units', to: '/org-units.html', label: 'Organisation', icon: 'org', cap: 'departments.manage' },
      { key: 'audit', to: '/audit.html', label: 'Audit Logs', icon: 'audit', cap: 'audit.view' },
    ] },
    { label: 'System', items: [
      {key:'app-overview',to:'/app-overview.html',label:'App overview',icon:'compass',superOnly:true},
      {key:'owner-access',to:'/owner-access.html',label:'Owner page access',icon:'key',superOnly:true},
      {key:'dropdowns',to:'/dropdowns.html',label:'Dropdowns',icon:'sliders',superOnly:true},
      {key:'file-server',to:'/file-server.html',label:'File Server',icon:'database',superOnly:true},
      { key: 'app-health', to: '/app-health.html', label: 'App Health', icon: 'health', systemAdmin: true },
      { key: 'rbac', to: '/rbac.html', label: 'RBAC', icon: 'shield', systemAdmin: true },
      { key: 'system-controls', to: '/system-controls.html', label: 'System controls', icon: 'sliders', systemAdmin: true },
      { key: 'directory-auth', to: '/directory-auth.html', label: 'Directory authentication', icon: 'key', systemAdmin: true },
      { key: 'maps-config', to: '/maps-config.html', label: 'Maps configuration', icon: 'map', systemAdmin: true },
      { key: 'sms', to: '/sms.html', label: 'SMS', icon: 'message', systemAdmin: true },
      { key: 'email', to: '/email.html', label: 'Email', icon: 'mail', systemAdmin: true },
      { key: 'broadcasts', to: '/broadcasts.html', label: 'Broadcasts', icon: 'megaphone', superOnly: true },
      { key: 'backup-cleanup', to: '/backup-cleanup.html', label: 'Backup & cleanup', icon: 'database', superOnly: true },
      { key: 'database', to: '/database-connections.html', label: 'Database connections', icon: 'database', systemAdmin: true },
      { key: 'unified-api', to: '/unified-api.html', label: 'Unified API', icon: 'code', systemAdmin: true },
      { key: 'report-config', to: '/report-configuration.html', label: 'Report configuration', icon: 'reports', systemAdmin: true },
      { key: 'navigation', to: '/navigation-settings.html', label: 'Navigation menu', icon: 'layout', systemAdmin: true },
      { key: 'documentation', to: '/documentation.html', label: 'Documentation', icon: 'book', systemAdmin: true },
      { key: 'codebase-guide', to: '/codebase-guide.html', label: 'Codebase guide', icon: 'terminal', systemAdmin: true },
    ] },
    { label: 'Help', items: [
      { key: 'how-it-works', to: '/how-it-works.html', label: 'How it works', icon: 'book' },
      { key: 'faqs', to: '/faqs.html', label: 'FAQs', icon: 'help' },
    ] },
  ];

const pages = catalogue.flatMap(section => section.items.map(item => ({ ...item, section: section.label })));
const keys = new Set(pages.map(page => page.key));
const error = message => Object.assign(new Error(message), { status: 400 });
async function contexts() {
  return [{ key: '__all__', name: 'Default for all roles' }, { key: '__owner__', name: 'App Owner' }, { key: '__client__', name: 'Clients (no assigned role)' },
    ...(await db.all('SELECT slug, name FROM roles ORDER BY name')).map(r => ({ key: r.slug, name: r.name }))];
}
async function checkScope(scope) {
  if (!(await contexts()).some(role => role.key === scope)) throw error('Choose a valid role.');
}
async function defaults(scope = '__all__') {
  let caps = []; let requester = false;
  const unrestricted = ['__all__', '__owner__'].includes(scope);
  if (!unrestricted) {
    if (scope === '__client__') requester = true;
    else {
      const role = await db.get('SELECT id FROM roles WHERE slug = ?', [scope]);
      caps = role ? await roles.capsForRole(role.id) : [];
      requester = isRequesterOnly(caps);
    }
  }
  const hidden = await settings.get('nav_hidden', []);
  // Owner pages the App Owner has shared with this role (Owner page access).
  const shared = unrestricted || scope === '__client__' ? [] : await require('./ownerAccess').pagesForRole(scope);
  const available = item => {
    if (unrestricted) return true;
    if (requester) return ['dashboard', 'requests', 'how-it-works', 'faqs'].includes(item.key) || shared.includes(item.key);
    if (item.superOnly) return shared.includes(item.key);
    if (item.systemAdmin) return caps.includes('system.admin');
    if (item.cap) return caps.includes(item.cap);
    if (item.roles) return item.roles.includes(scope) || (item.anyCaps || []).some(cap => caps.includes(cap));
    return true;
  };
  return { sections: catalogue.map(section => ({ id: section.label.toLowerCase(), title: section.label,
    items: section.items.filter(available).map(item => ({ key: item.key, label: item.label, visible: item.key === 'navigation' || !Array.isArray(hidden) || !hidden.includes(item.key) })) })).filter(section => section.items.length) };
}
function clean(input) {
  if (!Array.isArray(input?.sections) || input.sections.length > 30) throw error('Provide at most 30 sections.');
  const seen = new Set(); const ids = new Set();
  return { sections: input.sections.map(section => {
    const id = String(section?.id || '').trim(); const title = String(section?.title || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id) || !title || title.length > 80 || !Array.isArray(section.items)) throw error('Each section needs a unique ID, heading and page list.');
    ids.add(id);
    return { id, title, items: section.items.map(item => {
      const key = String(item?.key || ''); const label = String(item?.label || '').trim();
      if (!keys.has(key) || seen.has(key) || !label || label.length > 80) throw error('Pages must be known, listed once, and have a label of at most 80 characters.');
      if (item.visible !== undefined && typeof item.visible !== 'boolean') throw error('Page visibility must be on or off.');
      seen.add(key); return { key, label, visible: key === 'navigation' || item.visible !== false };
    }) };
  }) };
}
function withNewPages(layout, base) {
  if (!layout?.sections) return structuredClone(base);
  const allowed = new Set(base.sections.flatMap(s => s.items.map(item => item.key)));
  const sections = layout.sections.map(section => ({ ...section, items: section.items.filter(item => allowed.has(item.key)).map(item => ({ ...item })) }));
  const listed = new Set(sections.flatMap(s => s.items.map(item => item.key)));
  for (const section of base.sections) for (const item of section.items) {
    if (listed.has(item.key)) continue;
    let target = sections.find(s => s.id === section.id || s.title === section.title);
    if (!target) {
      let id = section.id; while (sections.some(s => s.id === id)) id += '-default';
      target = { id, title: section.title, items: [] }; sections.push(target);
    }
    target.items.push({ ...item }); listed.add(item.key);
  }
  return { sections };
}
async function saved(scope) {
  let value = await settings.get(`navigation_layout:${scope}`, null);
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return null; } }
  try { return value ? clean(value) : null; } catch (_) { return null; }
}
async function layoutFor(scope) {
  const layout = await saved(scope) || (scope !== '__all__' ? await saved('__all__') : null);
  return withNewPages(layout, await defaults(scope));
}
async function editor(scope) { await checkScope(scope); return { layout: await layoutFor(scope), defaults: await defaults(scope) }; }
async function save(scope, body) {
  await checkScope(scope);
  const layout = body?.reset ? null : clean(body);
  await settings.set(`navigation_layout:${scope}`, layout ? JSON.stringify(layout) : '');
  return { layout: await layoutFor(scope) };
}
async function effective(user) {
  const scope = user.is_super_admin ? '__owner__' : await roles.roleSlugForUser(user.id) || '__client__';
  return layoutFor(scope);
}
module.exports = { catalogue, pages, contexts, defaults, clean, withNewPages, editor, save, effective };
