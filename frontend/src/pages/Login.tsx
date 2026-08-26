import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiError } from '../lib/api'
import { Button, Field, Input } from '../components/ui'
import { AnimatedHero } from '../components/AnimatedHero'

const DEMO = [
  { role: 'Administrator', email: 'admin@uits.test' },
  { role: 'Approver', email: 'approver@uits.test' },
  { role: 'Transport Officer', email: 'transport@uits.test' },
  { role: 'Staff', email: 'staff@uits.test' },
  { role: 'Driver', email: 'driver1@uits.test' },
]

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@uits.test')
  const [password, setPassword] = useState('password')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(apiError(err, 'Unable to sign in.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:grid-cols-2">
        {/* Animated hero */}
        <div className="p-3 sm:p-4 lg:p-0">
          <AnimatedHero />
        </div>

        {/* Form */}
        <div className="p-6 sm:p-8">
          <div className="mb-5 lg:hidden">
            <h1 className="text-lg font-semibold text-text">UITS Vehicle Management</h1>
            <p className="text-sm text-text-2">Kwame Nkrumah University of Science and Technology</p>
          </div>

          <h2 className="mb-1 text-lg font-semibold text-text">Sign in</h2>
          <p className="mb-5 text-sm text-text-2">Use your institutional account.</p>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign in
            </Button>
          </form>

          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium text-text-3">Demo accounts (password: password)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => {
                    setEmail(d.email)
                    setPassword('password')
                  }}
                  className="rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:border-primary hover:bg-primary-tint"
                  type="button"
                >
                  <span className="block font-medium text-text">{d.role}</span>
                  <span className="block truncate text-text-3">{d.email}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-text-3">
            University Information Technology Services
          </p>
        </div>
      </div>
    </div>
  )
}
