import { Car, Truck, Bus } from 'lucide-react'
import type { CSSProperties } from 'react'

interface Rider {
  Icon: typeof Car
  lane: number // 0..n from top of road
  dir: 'lr' | 'rl'
  duration: number
  delay: number
  color: string
  size: number
}

// Vehicles driving across the road at varied speeds, lanes and directions.
const RIDERS: Rider[] = [
  { Icon: Bus, lane: 0, dir: 'lr', duration: 11, delay: 0, color: '#009540', size: 30 },
  { Icon: Car, lane: 1, dir: 'rl', duration: 7, delay: 1.5, color: '#1f5fd0', size: 24 },
  { Icon: Truck, lane: 2, dir: 'lr', duration: 14, delay: 0.6, color: '#b45309', size: 30 },
  { Icon: Car, lane: 3, dir: 'rl', duration: 9, delay: 3, color: '#c0392b', size: 24 },
  { Icon: Car, lane: 1, dir: 'rl', duration: 8, delay: 5.5, color: '#6d47c9', size: 22 },
]

export function AnimatedHero() {
  return (
    <div className="relative h-44 w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-[#0b6b34] to-[#009540] sm:h-56 lg:h-full lg:min-h-[520px] lg:rounded-none lg:rounded-l-2xl">
      {/* Sky glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-20%,rgba(255,255,255,0.35),transparent_60%)]" />

      {/* Skyline silhouette */}
      <div className="absolute inset-x-0 bottom-[38%] flex items-end justify-around px-4 opacity-25">
        {[26, 40, 30, 52, 34, 46, 28, 44, 32].map((h, i) => (
          <div key={i} className="w-4 rounded-t-sm bg-white/80 sm:w-6" style={{ height: h }} />
        ))}
      </div>

      {/* Brand */}
      <div className="absolute left-4 top-4 flex items-center gap-2 text-white">
        <img src="/knust-logo.png" alt="KNUST" className="h-9 w-9 rounded-lg bg-white/90 p-1 object-contain" style={{ animation: 'hero-bob 3s ease-in-out infinite' }} />
        <div className="leading-tight">
          <p className="text-sm font-semibold">UITS Vehicle Management</p>
          <p className="text-[11px] text-white/80">KNUST · Trip Logging System</p>
        </div>
      </div>

      {/* Road */}
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[#2b3440]">
        {/* lane markers container */}
        <div className="relative h-full w-full">
          {/* dashed centre line */}
          <div
            className="road-line absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 opacity-70"
            style={{
              backgroundImage: 'repeating-linear-gradient(to right, #f7c948 0 40px, transparent 40px 80px)',
              animation: 'road-dashes 0.8s linear infinite',
            }}
          />
          {RIDERS.map((r, i) => {
            const top = 8 + r.lane * 20 // vertical lane position within the road
            const style: CSSProperties = {
              top: `${top}%`,
              animationName: r.dir === 'lr' ? 'drive-lr' : 'drive-rl',
              animationDuration: `${r.duration}s`,
              animationDelay: `${r.delay}s`,
              transform: r.dir === 'rl' ? 'scaleX(-1)' : undefined,
              color: r.color,
            }
            return (
              <span key={i} className="drive drop-shadow" style={style}>
                <r.Icon width={r.size} height={r.size} strokeWidth={2.25} />
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
