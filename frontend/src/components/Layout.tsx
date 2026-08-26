import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, FileText, CheckSquare, Route as RouteIcon, Car, Users as UsersIcon,
  Wrench, BarChart3, FileSpreadsheet, ScrollText, Settings, Building2, LogOut, Menu, Sun, Moon, Monitor,
  Activity, ShieldCheck, SlidersHorizontal, KeyRound, Database, BookOpen, Code2, HelpCircle, Gift, Plane, Fuel,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../context/AuthContext'
import type { RoleSlug } from '../lib/types'
import { NotificationBell } from './NotificationBell'
import { applyTheme, getThemeChoice, type ThemeChoice } from '../lib/theme'

// Operational roles = everyone except a self-service driver.
const OPS: RoleSlug[] = ['staff', 'approver', 'transport_admin', 'administrator']

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  roles?: RoleSlug[]
  cap?: string
  superOnly?: boolean
  mobile?: boolean
}
interface NavSection {
  label: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, mobile: true },
      { to: '/requests', label: 'Requests', icon: FileText, roles: OPS, mobile: true },
      { to: '/approvals', label: 'Approvals', icon: CheckSquare, roles: ['approver', 'administrator'], mobile: true },
      { to: '/goodwill', label: 'Goodwill', icon: Gift, cap: 'requests.create_goodwill' },
      { to: '/external-travel', label: 'External Travel', icon: Plane, cap: 'requests.create_external' },
      { to: '/trips', label: 'Trips', icon: RouteIcon, mobile: true },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { to: '/vehicles', label: 'Vehicles', icon: Car, roles: OPS, mobile: true },
      { to: '/drivers', label: 'Drivers', icon: UsersIcon, roles: OPS },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench, roles: ['transport_admin', 'administrator'] },
      { to: '/fuel', label: 'Fuel', icon: Fuel, cap: 'fuel.log' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3, cap: 'analytics.view' },
      { to: '/reports', label: 'Reports', icon: FileSpreadsheet, cap: 'reports.export' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: UsersIcon, cap: 'users.manage' },
      { to: '/departments', label: 'Departments', icon: Building2, cap: 'departments.manage' },
      { to: '/settings', label: 'Settings', icon: Settings, cap: 'settings.manage' },
      { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText, cap: 'audit.view' },
    ],
  },
  {
    // Break-glass tier — System Administrator only (spec Part II §6–§12).
    label: 'System',
    items: [
      { to: '/admin/app-health', label: 'App Health', icon: Activity, superOnly: true },
      { to: '/admin/rbac', label: 'RBAC', icon: ShieldCheck, superOnly: true },
      { to: '/admin/system-controls', label: 'System controls', icon: SlidersHorizontal, superOnly: true },
      { to: '/admin/directory-auth', label: 'Directory authentication', icon: KeyRound, superOnly: true },
      { to: '/admin/database', label: 'Database connections', icon: Database, superOnly: true },
      { to: '/admin/documentation', label: 'Documentation', icon: BookOpen, superOnly: true },
      { to: '/admin/codebase-guide', label: 'Codebase guide', icon: Code2, superOnly: true },
    ],
  },
  {
    label: 'Help',
    items: [{ to: '/faqs', label: 'FAQs', icon: HelpCircle }],
  },
]

function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice())
  const cycle = () => {
    const next: ThemeChoice = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light'
    setChoice(next)
    applyTheme(next)
  }
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor
  return (
    <button onClick={cycle} className="rounded-lg p-2 text-text-2 hover:bg-surface-2" title={`Theme: ${choice}`} aria-label="Toggle theme">
      <Icon className="h-5 w-5" />
    </button>
  )
}

export function Layout() {
  const { user, logout, can, isSuperAdmin, requesterOnly } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isVisible = (n: NavItem): boolean => {
    // A pure requester (Staff) only ever sees the Requests area.
    if (requesterOnly) return n.to.startsWith('/requests')
    if (n.superOnly) return isSuperAdmin
    if (n.cap) return can(n.cap)
    if (n.roles) return !!user?.role_slug && n.roles.includes(user.role_slug)
    return true
  }

  // Requesters cannot reach any other page — send them back to Requests.
  const outletBlocked = requesterOnly && !location.pathname.startsWith('/requests')

  const visibleSections = SECTIONS
    .map((s) => ({ ...s, items: s.items.filter(isVisible) }))
    .filter((s) => s.items.length > 0)
  const allVisible = visibleSections.flatMap((s) => s.items)
  const mobileItems = allVisible.filter((n) => n.mobile).slice(0, 5)

  useEffect(() => setMobileOpen(false), [location.pathname])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const currentLabel = allVisible.find((n) => location.pathname.startsWith(n.to))?.label ?? 'UITS VMTL'
  const home = requesterOnly ? '/requests' : '/dashboard'

  const SidebarContent = (
    <>
      <Link to={home} className="flex items-center gap-2.5 border-b border-border px-5 py-4 hover:bg-surface-2" title="Home">
        <img src="/knust-logo.png" alt="KNUST" className="h-8 w-8 object-contain" />
        <div>
          <p className="text-sm font-semibold leading-tight text-text">UITS VMTL</p>
          <p className="text-[11px] leading-tight text-text-3">Vehicle Management</p>
        </div>
      </Link>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {visibleSections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-3">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-[14.5px] font-medium transition-colors',
                      isActive ? 'bg-primary-tint text-primary' : 'text-text-2 hover:bg-surface-2 hover:text-text',
                    )
                  }
                >
                  <item.icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  )

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-[220px] flex-col border-r border-border bg-surface lg:flex">{SidebarContent}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[252px] flex-col border-r border-border bg-surface">{SidebarContent}</aside>
        </div>
      )}

      <div className="flex flex-1 flex-col lg:pl-[220px]">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/85 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-text-2 hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <Link to={home} className="lg:hidden" title="Home">
              <img src="/knust-logo.png" alt="KNUST" className="h-7 w-7 object-contain" />
            </Link>
            <span className="text-sm font-semibold text-text sm:text-base">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationBell />
            <ThemeToggle />
            <div className="ml-1 hidden text-right sm:block">
              <p className="text-sm font-medium text-text">{user?.name}</p>
              <p className="text-xs text-text-3">{user?.role?.name ?? user?.role_slug}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-sm font-semibold text-text-2">
              {user?.name?.charAt(0) ?? '?'}
            </div>
            <button onClick={handleLogout} className="rounded-lg p-2 text-text-2 hover:bg-surface-2" title="Log out" aria-label="Log out">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-7 pb-24 sm:px-6 lg:pb-10">
          {outletBlocked ? <Navigate to="/requests" replace /> : <Outlet />}
        </main>

        <footer className="hidden border-t border-border px-6 py-3 text-center text-xs text-text-3 lg:block">
          KNUST · University Information Technology Services — Vehicle Management &amp; Trip Logging
        </footer>
      </div>

      {/* Mobile bottom nav — quick links + a Menu button (hamburger stays in the top bar) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {mobileItems.slice(0, 4).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-primary' : 'text-text-3')
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMobileOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-text-3"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
          Menu
        </button>
      </nav>
    </div>
  )
}
