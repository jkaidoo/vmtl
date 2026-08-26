import { useState } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../context/AuthContext'
import { Card, Input, PageHeader } from '../components/ui'

interface Faq { q: string; a: string }
interface FaqSection { title: string; cap?: string; items: Faq[] }

const SECTIONS: FaqSection[] = [
  {
    title: 'General',
    items: [
      { q: 'How do I sign in?', a: 'Use your institutional email and password on the login page. Your dashboard and menu adapt to your role.' },
      { q: 'How do I switch between light and dark mode?', a: 'Use the sun/moon button in the top bar. It cycles Light → Dark → System and remembers your choice.' },
      { q: 'Can I install this as an app?', a: 'Yes. On Android/desktop use “Install app” from your browser; on iOS use Share → Add to Home Screen.' },
    ],
  },
  {
    title: 'Requests',
    cap: 'requests.create',
    items: [
      { q: 'How do I request a vehicle?', a: 'Go to Requests → New Request, fill in the destination, dates, passengers and purpose, then submit. You will be notified when it is approved.' },
      { q: 'Can I cancel a request?', a: 'Yes — open the request and choose Cancel while it is still pending, approved or scheduled.' },
    ],
  },
  {
    title: 'Approvals',
    cap: 'requests.approve',
    items: [
      { q: 'How do I approve or reject a request?', a: 'Open the request from Approvals and choose Approve or Reject. A reason is required to reject.' },
    ],
  },
  {
    title: 'Trips',
    cap: 'trips.operate',
    items: [
      { q: 'How do I start a trip?', a: 'Open the scheduled trip and press START TRIP. The start time is recorded automatically; you only enter the odometer.' },
      { q: 'What is a no-show?', a: 'If a scheduled trip does not happen, mark it as a no-show to release the vehicle and close the request.' },
    ],
  },
  {
    title: 'Administration',
    cap: 'users.manage',
    items: [
      { q: 'How do I add a user?', a: 'Settings → Staff accounts → Add User. Assign a role, which grants the role’s capabilities.' },
      { q: 'How do capabilities work?', a: 'Access is capability-based and enforced on the server. The System Administrator can edit role capabilities under RBAC.' },
    ],
  },
]

export function Faqs() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [openKey, setOpenKey] = useState<string>('')

  const visible = SECTIONS
    .filter((s) => !s.cap || can(s.cap))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => !search || (i.q + i.a).toLowerCase().includes(search.toLowerCase())),
    }))
    .filter((s) => s.items.length > 0)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="FAQs" subtitle="Help & frequently asked questions" />

      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-3" />
        <Input placeholder="Search help…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="space-y-6">
        {visible.map((section) => (
          <div key={section.title}>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">{section.title}</h2>
            <Card className="divide-y divide-border">
              {section.items.map((item) => {
                const key = section.title + item.q
                const isOpen = openKey === key
                return (
                  <div key={key}>
                    <button onClick={() => setOpenKey(isOpen ? '' : key)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
                      <span className="text-sm font-medium text-text">{item.q}</span>
                      <ChevronDown className={clsx('h-4 w-4 shrink-0 text-text-3 transition-transform', isOpen && 'rotate-180')} />
                    </button>
                    {isOpen && <p className="px-5 pb-4 text-sm text-text-2">{item.a}</p>}
                  </div>
                )
              })}
            </Card>
          </div>
        ))}
        {visible.length === 0 && <p className="text-center text-sm text-text-3">No help topics match your search.</p>}
      </div>
    </div>
  )
}
