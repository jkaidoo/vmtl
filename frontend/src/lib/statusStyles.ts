// Central status styling (spec §30). The backend emits a semantic colour token
// (amber/blue/red/purple/green/grey) with each status; we map it to Tailwind
// classes here in ONE place so colours are never hard-coded across the app.

export type StatusColor = 'amber' | 'blue' | 'red' | 'purple' | 'green' | 'grey'

const BADGE: Record<StatusColor, string> = {
  amber: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  blue: 'bg-blue-100 text-blue-800 ring-blue-600/20',
  red: 'bg-red-100 text-red-800 ring-red-600/20',
  purple: 'bg-purple-100 text-purple-800 ring-purple-600/20',
  green: 'bg-green-100 text-green-800 ring-green-600/20',
  grey: 'bg-slate-100 text-slate-700 ring-slate-600/20',
}

const DOT: Record<StatusColor, string> = {
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
  green: 'bg-green-500',
  grey: 'bg-slate-400',
}

function normalise(color?: string): StatusColor {
  if (color && color in BADGE) return color as StatusColor
  return 'grey'
}

export function badgeClasses(color?: string): string {
  return BADGE[normalise(color)]
}

export function dotClasses(color?: string): string {
  return DOT[normalise(color)]
}
