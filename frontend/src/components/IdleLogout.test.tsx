import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_LOGOUT_FLAG, IDLE_TIMEOUT_MS, markActivity } from '../lib/idle'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

let authValue: { user: unknown; logout: () => Promise<void> }
vi.mock('../context/AuthContext', () => ({ useAuth: () => authValue }))

let enabled = true
vi.mock('../lib/idle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/idle')>()
  return { ...actual, idleLogoutEnabled: () => enabled }
})

// Imported after the mocks are declared so the component picks them up.
const { IdleLogout } = await import('./IdleLogout')

const expired = () => Date.now() - IDLE_TIMEOUT_MS - 1000
const flush = () => new Promise((r) => setTimeout(r, 20))

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  enabled = true
})

describe('IdleLogout', () => {
  it('signs out when the last activity is older than the window', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    authValue = { user: { id: 1 }, logout }
    markActivity(expired())

    render(<IdleLogout />)

    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true })
    expect(sessionStorage.getItem(IDLE_LOGOUT_FLAG)).toBe('1')
  })

  it('does NOT sign out on the mobile PWA (disabled)', async () => {
    enabled = false
    const logout = vi.fn().mockResolvedValue(undefined)
    authValue = { user: { id: 1 }, logout }
    markActivity(expired())

    render(<IdleLogout />)
    await flush()

    expect(logout).not.toHaveBeenCalled()
  })

  it('does nothing when not authenticated', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    authValue = { user: null, logout }
    markActivity(expired())

    render(<IdleLogout />)
    await flush()

    expect(logout).not.toHaveBeenCalled()
  })

  it('stays signed in while activity is recent', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    authValue = { user: { id: 1 }, logout }
    markActivity(Date.now())

    render(<IdleLogout />)
    await flush()

    expect(logout).not.toHaveBeenCalled()
  })
})
