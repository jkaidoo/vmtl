import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { clsx } from 'clsx'
import { api } from '../../lib/api'
import { Card, PageHeader, Spinner } from '../../components/ui'

interface Doc { slug: string; title: string; summary: string }

export function Documentation() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [active, setActive] = useState<string>('')
  const [content, setContent] = useState('')
  const [loadingDoc, setLoadingDoc] = useState(false)

  useEffect(() => {
    api.get<{ data: Doc[] }>('/admin/documentation').then((r) => {
      setDocs(r.data.data)
      if (r.data.data[0]) open(r.data.data[0].slug)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = (slug: string) => {
    setActive(slug)
    setLoadingDoc(true)
    api.get<{ data: { content: string } }>(`/admin/documentation/${slug}`)
      .then((r) => setContent(r.data.data.content))
      .finally(() => setLoadingDoc(false))
  }

  return (
    <div>
      <PageHeader title="Documentation" subtitle="Reference documents for this application" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <Card className="p-3 lg:col-span-1">
          {docs.map((d) => (
            <button
              key={d.slug}
              onClick={() => open(d.slug)}
              className={clsx('flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors', active === d.slug ? 'bg-primary-tint text-primary' : 'hover:bg-surface-2')}
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block text-sm font-medium">{d.title}</span>
                <span className="block text-xs text-text-3">{d.summary}</span>
              </span>
            </button>
          ))}
        </Card>

        <Card className="p-6 lg:col-span-3">
          {loadingDoc ? <Spinner /> : <Markdown source={content} />}
        </Card>
      </div>
    </div>
  )
}

/** Minimal, dependency-free markdown renderer for headings, lists, code and text. */
function Markdown({ source }: { source: string }) {
  const lines = source.split('\n')
  const out: React.ReactNode[] = []
  let list: string[] = []
  let code: string[] = []
  let inCode = false

  const flushList = (key: string) => {
    if (list.length) {
      out.push(<ul key={key} className="my-2 list-disc space-y-1 pl-6 text-sm text-text-2">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
      list = []
    }
  }

  lines.forEach((raw, idx) => {
    if (raw.trim().startsWith('```')) {
      if (inCode) {
        out.push(<pre key={`c${idx}`} className="my-3 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-text-2">{code.join('\n')}</pre>)
        code = []
        inCode = false
      } else {
        flushList(`l${idx}`)
        inCode = true
      }
      return
    }
    if (inCode) { code.push(raw); return }

    if (raw.startsWith('### ')) { flushList(`l${idx}`); out.push(<h3 key={idx} className="mt-4 mb-1 text-base font-semibold text-text">{raw.slice(4)}</h3>); return }
    if (raw.startsWith('## ')) { flushList(`l${idx}`); out.push(<h2 key={idx} className="mt-5 mb-2 text-lg font-semibold text-text">{raw.slice(3)}</h2>); return }
    if (raw.startsWith('# ')) { flushList(`l${idx}`); out.push(<h1 key={idx} className="mb-3 text-xl font-bold text-text">{raw.slice(2)}</h1>); return }
    if (raw.trim().startsWith('- ') || raw.trim().startsWith('* ')) { list.push(raw.trim().slice(2)); return }
    flushList(`l${idx}`)
    if (raw.trim() === '') return
    out.push(<p key={idx} className="my-2 text-sm leading-relaxed text-text-2">{inline(raw)}</p>)
  })
  flushList('lend')

  return <div className="max-w-none">{out}</div>
}

/** Inline bold + code. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold text-text">{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-text">{p.slice(1, -1)}</code>
    return p
  })
}
