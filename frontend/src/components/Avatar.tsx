import { clsx } from 'clsx'

/** Profile picture, or the person's initial when no image is set. */
export function Avatar({
  src,
  name,
  size = 36,
  className,
}: {
  src?: string | null
  name?: string | null
  size?: number
  className?: string
}) {
  const dim = { width: size, height: size }
  if (src) {
    return <img src={src} alt={name ?? 'Avatar'} style={dim} className={clsx('rounded-full object-cover', className)} />
  }
  return (
    <div
      style={dim}
      className={clsx('flex items-center justify-center rounded-full bg-surface-3 font-semibold text-text-2', className)}
    >
      {(name?.charAt(0) ?? '?').toUpperCase()}
    </div>
  )
}
