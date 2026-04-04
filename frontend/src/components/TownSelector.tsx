import { memo } from 'react'
import { TOWN_BOUNDARIES } from '../data/jinshan-boundary'
import type { WarningRecord } from '../api'
import { LEVEL_COLORS } from '../tokens'

interface Props {
  selectedStreet: string | null
  warnings: WarningRecord[]
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

export default memo(function TownSelector({ selectedStreet, warnings, onStreetClick }: Props) {
  return (
    <nav aria-label="街镇选择" className="absolute top-14 left-1/2 -translate-x-1/2 z-20 animate-in"
      style={{ animationDelay: '0.2s' }}>
      <div className="glass-panel px-2 py-1.5 flex items-center gap-1 flex-wrap justify-center"
        style={{ maxWidth: 'calc(100vw - 340px)' }}>
        {TOWN_BOUNDARIES.map(town => {
          const isActive = town.name === selectedStreet
          const wLevel = getWarningLevel(town.name, warnings)
          const accentColor = wLevel ? LEVEL_COLORS[wLevel] : undefined

          return (
            <button
              key={town.name}
              onClick={() => onStreetClick(town.name)}
              aria-pressed={isActive}
              className="transition-all active:scale-95"
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: isActive ? 600 : 400,
                padding: '4px 10px',
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
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: accentColor,
                  marginRight: 4,
                  verticalAlign: 'middle',
                }} />
              )}
              {town.name}
            </button>
          )
        })}
      </div>
    </nav>
  )
})
