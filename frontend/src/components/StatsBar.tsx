import { memo } from 'react'
import type { PVSummary, WarningRecord } from '../api'
import { TOWN_BOUNDARIES } from '../data/jinshan-boundary'
import { LEVEL_COLORS } from '../tokens'

interface Props {
  summary: PVSummary | null
  warnings: WarningRecord[]
  selectedStreet: string | null
  onStreetClick: (street: string) => void
}

function getWarningLevel(street: string, warnings: WarningRecord[]): string | null {
  const sw = warnings.filter(w => w.street === street)
  if (!sw.length) return null
  for (const l of ['red', 'orange', 'yellow', 'blue']) {
    if (sw.some(w => w.level === l)) return l
  }
  return null
}

function Stat({ label, value, unit, accent, glow }: {
  label: string; value: string; unit: string; accent: string; glow?: boolean
}) {
  return (
    <div className="flex flex-col items-center px-2 md:px-3 py-1.5">
      <div className="tag-label mb-0.5" style={{ fontSize: 8 }}>{label}</div>
      <div className="flex items-baseline gap-0.5">
        <span className="data-value text-lg md:text-xl" style={{
          color: accent,
          textShadow: glow ? `0 0 16px ${accent}50` : 'none',
        }}>
          {value}
        </span>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)' }}>{unit}</span>
      </div>
    </div>
  )
}

export default memo(function StatsBar({ summary, warnings, selectedStreet, onStreetClick }: Props) {
  const capacity = summary ? (summary.total_capacity_kw / 1000).toFixed(1) : '--'
  const users = summary ? `${summary.active_users}` : '--'
  const warnCount = warnings.length
  const hasWarning = warnCount > 0

  return (
    <div className="absolute z-20 animate-in md:bottom-4 md:left-4 bottom-14 left-2 right-2 md:right-auto"
      style={{ animationDelay: '0.15s' }}>
      <div className="glass-panel">
        {/* Stats row */}
        <div className="flex items-center justify-around md:justify-start">
          <Stat label="装机容量" value={capacity} unit="MW" accent="var(--solar-amber)" glow />
          <div className="w-px h-8 self-center hidden md:block" style={{ background: 'linear-gradient(to bottom, transparent, var(--border-subtle), transparent)' }} />
          <Stat label="在线" value={users} unit="户" accent="var(--text-bright)" />
          <div className="w-px h-8 self-center hidden md:block" style={{ background: 'linear-gradient(to bottom, transparent, var(--border-subtle), transparent)' }} />
          <Stat
            label="预警"
            value={`${warnCount}`}
            unit="条"
            accent={hasWarning ? 'var(--solar-coral)' : 'var(--solar-green)'}
            glow={hasWarning}
          />
        </div>

        {/* Town selector row */}
        <nav aria-label="街镇选择" className="flex items-center gap-1 px-2 pb-2 pt-0.5 flex-wrap md:flex-nowrap overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}>
          {TOWN_BOUNDARIES.map(town => {
            const isActive = town.name === selectedStreet
            const wLevel = getWarningLevel(town.name, warnings)
            const accentColor = wLevel ? LEVEL_COLORS[wLevel] : undefined

            return (
              <button
                key={town.name}
                onClick={() => onStreetClick(town.name)}
                aria-pressed={isActive}
                className="transition-all active:scale-95 shrink-0"
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 9,
                  fontWeight: isActive ? 600 : 400,
                  padding: '3px 8px',
                  borderRadius: 100,
                  border: `1px solid ${isActive ? 'var(--solar-amber)' : 'var(--border-subtle)'}`,
                  background: isActive ? 'rgba(219,161,74,0.12)' : 'transparent',
                  color: isActive ? 'var(--solar-amber)' : accentColor || 'var(--text-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {wLevel && !isActive && (
                  <span style={{
                    display: 'inline-block',
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: accentColor,
                    marginRight: 3,
                    verticalAlign: 'middle',
                  }} />
                )}
                {town.name}
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
})
