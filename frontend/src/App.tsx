import { Navigate, Route, Routes, useLocation, type Location } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { IdleLogout } from './components/IdleLogout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PwaManager } from './components/PwaManager'
import { RouteModal } from './components/RouteModal'
import { Spinner } from './components/ui'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { RequestList } from './pages/requests/RequestList'
import { RequestCreate } from './pages/requests/RequestCreate'
import { RequestDetail } from './pages/requests/RequestDetail'
import { RequestAvailability } from './pages/requests/RequestAvailability'
import { GoodwillRequest } from './pages/requests/GoodwillRequest'
import { ExternalTravel } from './pages/requests/ExternalTravel'
import { Approvals } from './pages/Approvals'
import { TripList } from './pages/trips/TripList'
import { TripDetail } from './pages/trips/TripDetail'
import { VehicleList } from './pages/vehicles/VehicleList'
import { VehicleDetail } from './pages/vehicles/VehicleDetail'
import { Drivers } from './pages/Drivers'
import { Maintenance } from './pages/Maintenance'
import { Fuel } from './pages/Fuel'
import { Analytics } from './pages/Analytics'
import { Reports } from './pages/Reports'
import { AuditLogs } from './pages/AuditLogs'
import { Users } from './pages/Users'
import { Departments } from './pages/Departments'
import { OrgUnits } from './pages/admin/OrgUnits'
import { Settings } from './pages/Settings'
import { Faqs } from './pages/Faqs'
import { AppHealth } from './pages/admin/AppHealth'
import { Rbac } from './pages/admin/Rbac'
import { SystemControls } from './pages/admin/SystemControls'
import { DirectoryAuth } from './pages/admin/DirectoryAuth'
import { DatabaseConnections } from './pages/admin/DatabaseConnections'
import { Documentation } from './pages/admin/Documentation'
import { CodebaseGuide } from './pages/admin/CodebaseGuide'

/**
 * The /login route. Redirects an already-authenticated user to the app instead
 * of showing the form again — otherwise any reload that lands back on /login
 * after a sign-in (SW update, HMR, or a token from a prior session) makes it
 * look like the first click "bounced" and needs a second click.
 */
function LoginRoute() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    )
  }
  if (user) return <Navigate to="/dashboard" replace />
  return <Login />
}

export default function App() {
  const location = useLocation()
  // When a list opens a detail as a modal, it stashes the list's location here.
  const state = location.state as { background?: Location } | null
  const background = state?.background

  return (
    <>
      <PwaManager />
      <IdleLogout />
      <Routes location={background ?? location}>
      <Route path="/login" element={<LoginRoute />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/requests" element={<RequestList />} />
        <Route path="/requests/availability" element={<RequestAvailability />} />
        <Route path="/requests/create" element={<RequestCreate />} />
        <Route path="/requests/:id" element={<RequestDetail />} />
        <Route path="/goodwill" element={<ProtectedRoute cap="requests.create_goodwill"><GoodwillRequest /></ProtectedRoute>} />
        <Route path="/external-travel" element={<ProtectedRoute cap="requests.create_external"><ExternalTravel /></ProtectedRoute>} />

        <Route
          path="/approvals"
          element={
            <ProtectedRoute roles={['approver', 'administrator']}>
              <Approvals />
            </ProtectedRoute>
          }
        />

        <Route path="/trips" element={<TripList />} />
        <Route path="/trips/:id" element={<TripDetail />} />

        <Route path="/vehicles" element={<VehicleList />} />
        <Route path="/vehicles/:id" element={<VehicleDetail />} />

        <Route path="/drivers" element={<Drivers />} />

        <Route path="/maintenance" element={<ProtectedRoute cap="maintenance.manage"><Maintenance /></ProtectedRoute>} />
        <Route path="/fuel" element={<ProtectedRoute cap="fuel.log"><Fuel /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute cap="analytics.view"><Analytics /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute cap="reports.export"><Reports /></ProtectedRoute>} />

        <Route path="/audit-logs" element={<ProtectedRoute cap="audit.view"><AuditLogs /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute cap="users.manage"><Users /></ProtectedRoute>} />
        <Route path="/departments" element={<ProtectedRoute cap="departments.manage"><Departments /></ProtectedRoute>} />
        <Route path="/org-units" element={<ProtectedRoute cap="departments.manage"><OrgUnits /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute cap="settings.manage"><Settings /></ProtectedRoute>} />

        <Route path="/faqs" element={<Faqs />} />

        {/* Break-glass tier — System Administrator only */}
        <Route path="/admin/app-health" element={<ProtectedRoute superOnly><AppHealth /></ProtectedRoute>} />
        <Route path="/admin/rbac" element={<ProtectedRoute superOnly><Rbac /></ProtectedRoute>} />
        <Route path="/admin/system-controls" element={<ProtectedRoute superOnly><SystemControls /></ProtectedRoute>} />
        <Route path="/admin/directory-auth" element={<ProtectedRoute superOnly><DirectoryAuth /></ProtectedRoute>} />
        <Route path="/admin/database" element={<ProtectedRoute superOnly><DatabaseConnections /></ProtectedRoute>} />
        <Route path="/admin/documentation" element={<ProtectedRoute superOnly><Documentation /></ProtectedRoute>} />
        <Route path="/admin/codebase-guide" element={<ProtectedRoute superOnly><CodebaseGuide /></ProtectedRoute>} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

      {/* Detail overlays: when opened from a list, render the detail as a modal
          over the background list. Deep-links (no background) fall through to the
          full-page routes above. */}
      {background && (
        <Routes>
          <Route path="/requests/:id" element={<ProtectedRoute><RouteModal><RequestDetail /></RouteModal></ProtectedRoute>} />
          <Route path="/vehicles/:id" element={<ProtectedRoute><RouteModal><VehicleDetail /></RouteModal></ProtectedRoute>} />
          <Route path="/trips/:id" element={<ProtectedRoute><RouteModal><TripDetail /></RouteModal></ProtectedRoute>} />
        </Routes>
      )}
    </>
  )
}
