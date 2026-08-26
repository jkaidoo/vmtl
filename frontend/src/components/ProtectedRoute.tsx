import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { RoleSlug } from '../lib/types'
import { Spinner } from './ui'

export function ProtectedRoute({
  children,
  roles,
  cap,
  superOnly,
}: {
  children: ReactNode
  roles?: RoleSlug[]
  cap?: string
  superOnly?: boolean
}) {
  const { user, loading, can, isSuperAdmin } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  const allowed =
    (superOnly ? isSuperAdmin : true) &&
    (cap ? can(cap) : true) &&
    (roles ? !!user.role_slug && roles.includes(user.role_slug) : true)

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-semibold text-text">Access denied</p>
        <p className="text-sm text-text-2">You do not have permission to view this page.</p>
      </div>
    )
  }

  return <>{children}</>
}
