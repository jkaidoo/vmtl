import { Card, PageHeader } from '../../components/ui'

interface GuideSection {
  area: string
  entries: { path: string; note: string }[]
}

const GUIDE: GuideSection[] = [
  {
    area: 'Backend — foundation',
    entries: [
      { path: 'app/Enums/*', note: 'Status enums (Request/Trip/Vehicle/Driver) with centralised label + semantic colour.' },
      { path: 'app/Models/*', note: 'Eloquent models with relationships, casts and capability helpers on User.' },
      { path: 'database/migrations/*', note: 'Schema: users, roles, role_capabilities, departments, vehicles, drivers, requests, approvals, trips, maintenance, odometer_readings, audit_logs, system_settings, notifications, push_subscriptions.' },
      { path: 'database/seeders/*', note: 'Roles + capabilities, departments, users (admin = super), vehicles, drivers, demo data.' },
    ],
  },
  {
    area: 'Backend — domain logic',
    entries: [
      { path: 'app/Services/AvailabilityService', note: 'Vehicle/driver conflict detection (overlap queries).' },
      { path: 'app/Services/AssignmentService', note: 'Assigns vehicle + driver in a transaction with row locks (no double-booking).' },
      { path: 'app/Services/TripService', note: 'Start / end / no-show / odometer-correction with validation.' },
      { path: 'app/Services/AnalyticsService', note: 'Aggregations for the analytics dashboard.' },
      { path: 'app/Services/WebPushService', note: 'VAPID web-push delivery + subscription pruning.' },
    ],
  },
  {
    area: 'Backend — authorization',
    entries: [
      { path: 'app/Support/Capabilities', note: 'The granular capability catalog + default role mapping.' },
      { path: 'app/Policies/*', note: 'Record-level rules, all capability-driven.' },
      { path: 'app/Http/Middleware/EnsureCapability · EnsureSuperAdmin', note: 'Route-level cap gate + break-glass tier gate.' },
      { path: 'routes/api.php', note: 'All endpoints, capability/super gated.' },
    ],
  },
  {
    area: 'Frontend — shell & state',
    entries: [
      { path: 'src/index.css', note: 'KNUST design tokens (light/dark) mapped to Tailwind utilities.' },
      { path: 'src/components/Layout.tsx', note: 'Sidebar + topbar shell; capability/super-gated navigation.' },
      { path: 'src/context/AuthContext.tsx', note: 'Auth + can()/isSuperAdmin capability checks.' },
      { path: 'src/lib/pwa.ts · public/sw.js', note: 'Service worker registration, update prompt and push subscription.' },
    ],
  },
  {
    area: 'Frontend — pages',
    entries: [
      { path: 'src/pages/*', note: 'Dashboard, requests, trips, vehicles, drivers, maintenance, analytics, reports.' },
      { path: 'src/pages/admin/*', note: 'Break-glass tier: App Health, RBAC, System Controls, Directory Auth, Database Connections, Documentation.' },
    ],
  },
]

export function CodebaseGuide() {
  return (
    <div>
      <PageHeader title="Codebase Guide" subtitle="File-by-file architecture reference" />
      <div className="space-y-6">
        {GUIDE.map((section) => (
          <Card key={section.area} className="p-5">
            <h2 className="mb-3 font-semibold text-text">{section.area}</h2>
            <div className="space-y-2.5">
              {section.entries.map((e) => (
                <div key={e.path} className="grid grid-cols-1 gap-1 sm:grid-cols-3">
                  <code className="font-mono text-xs text-primary">{e.path}</code>
                  <span className="text-sm text-text-2 sm:col-span-2">{e.note}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
