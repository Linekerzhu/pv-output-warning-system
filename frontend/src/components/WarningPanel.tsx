import type { WarningRecord } from '../api'

interface Props {
  warnings: WarningRecord[]
  onClose: () => void
  onStreetClick: (street: string) => void
}

const levelStyle: Record<string, { color: string; bg: string }> = {
  red:    { color: '#ff1744', bg: 'rgba(255,23,68,0.08)' },
  orange: { color: '#ff9100', bg: 'rgba(255,145,0,0.08)' },
  yellow: { color: '#ffea00', bg: 'rgba(255,234,0,0.08)' },
  blue:   { color: '#00e5ff', bg: 'rgba(0,229,255,0.08)' },
}

export default function WarningPanel({ warnings, onClose, onStreetClick }: Props) {
  const sorted = [...warnings].sort((a, b) => {
    const order: Record<string, number> = { red: 0, orange: 1, yellow: 2, blue: 3 }
    return (order[a.level] ?? 4) - (order[b.level] ?? 4)
  })

  const counts = { red: 0, orange: 0, yellow: 0, blue: 0 }
  warnings.forEach(w => { if (w.level in counts) counts[w.level as keyof typeof counts]++ })

  return (
    <div className="absolute top-16 right-4 z-20 glass-panel" style={{ width: 300 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full" style={{ background: 'var(--accent-orange)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            预警信息
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Warning count badges */}
          <div className="flex gap-1">
            {Object.entries(counts).map(([level, count]) => count > 0 && (
              <span key={level} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: levelStyle[level].bg, color: levelStyle[level].color }}>
                {count}
              </span>
            ))}
          </div>
          <button onClick={onClose} className="text-sm cursor-pointer px-1" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>
      </div>

      {/* Warning list */}
      <div className="px-3 pb-3 space-y-1.5 max-h-[calc(100vh-180px)] overflow-y-auto">
        {sorted.map(w => {
          const s = levelStyle[w.level] || levelStyle.blue
          return (
            <div
              key={w.id}
              onClick={() => onStreetClick(w.street)}
              className="rounded-lg p-2.5 cursor-pointer transition-all"
              style={{ background: s.bg, borderLeft: `2px solid ${s.color}` }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold" style={{ color: s.color }}>
                  {w.label}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {w.street}
                </span>
              </div>
              <div className="text-[11px] mb-0.5" style={{ color: 'var(--text-primary)' }}>
                {w.from_time.split(' ')[1]} → {w.to_time.split(' ')[1]}&ensp;
                <span style={{ color: s.color }}>&#x25BC; {(w.drop_ratio * 100).toFixed(0)}%</span>
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {w.weather_from} → {w.weather_to}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
