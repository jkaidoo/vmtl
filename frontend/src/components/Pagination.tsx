import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './ui'

export function Pagination({
  page,
  lastPage,
  total,
  onChange,
}: {
  page: number
  lastPage: number
  total: number
  onChange: (page: number) => void
}) {
  if (lastPage <= 1) {
    return <div className="px-4 py-3 text-xs text-slate-400">{total} record{total === 1 ? '' : 's'}</div>
  }

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-slate-500">
        Page {page} of {lastPage} · {total} records
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
          Prev
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
