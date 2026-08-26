import { clsx } from 'clsx'
import { badgeClasses, dotClasses } from '../lib/statusStyles'

export function StatusBadge({ label, color, className }: { label: string; color?: string; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        badgeClasses(color),
        className,
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', dotClasses(color))} />
      {label}
    </span>
  )
}
