import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from '../lib/api'
import type { RoleSlug, User } from '../lib/types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  hasRole: (...roles: RoleSlug[]) => boolean
  can: (...capabilities: string[]) => boolean
  isSuperAdmin: boolean
  managesFleet: boolean
  /** A pure requester (e.g. Staff): can create requests but nothing else. */
  requesterOnly: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    api
      .get<{ data: User }>('/me')
      .then((res) => setUser(res.data.data))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/login', { email, password, device_name: 'web' })
    setToken(res.data.token)
    // Re-fetch the authenticated user so capabilities are included.
    const me = await api.get<{ data: User }>('/me')
    setUser(me.data.data)
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get<{ data: User }>('/me')
      setUser(me.data.data)
    } catch {
      // ignore
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/logout')
    } catch {
      // ignore network errors on logout
    }
    setToken(null)
    setUser(null)
  }, [])

  const hasRole = useCallback(
    (...roles: RoleSlug[]) => !!user?.role_slug && roles.includes(user.role_slug),
    [user],
  )

  const can = useCallback(
    (...capabilities: string[]) => {
      if (user?.is_super_admin) return true
      const held = user?.capabilities ?? []
      return capabilities.some((c) => held.includes(c))
    },
    [user],
  )

  const value = useMemo<AuthContextValue>(() => {
    // A pure requester can create requests but has no broader visibility.
    const requesterOnly =
      !user?.is_super_admin &&
      can('requests.create') &&
      !can('requests.view_all') &&
      !can('trips.operate') &&
      !can('analytics.view')

    return {
      user,
      loading,
      login,
      logout,
      refreshUser,
      hasRole,
      can,
      isSuperAdmin: !!user?.is_super_admin,
      managesFleet: hasRole('administrator', 'transport_admin'),
      requesterOnly,
    }
  }, [user, loading, login, logout, refreshUser, hasRole, can])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
