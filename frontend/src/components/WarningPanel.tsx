import type { WarningRecord } from '../api'

interface Props {
  warnings: WarningRecord[]
}

const levelStyle: Record<string, { bg: string; border: string; dot: string }> = {
  red:    { bg: 'rgba(255,59,48,0.1)',  border: '#ff3b30', dot: '#ff3b30' },
  orange: { bg: 'rgba(255,140,0,0.1)',  border: '#ff8c00', dot: '#ff8c00' },
  yellow: { bg: 'rgba(255,215,0,0.1)',  border: '#ffd700', dot: '#ffd700' },
  blue:   { bg: 'rgba(0,212,255,0.1)',  border: '#00d4ff', dot: '#00d4ff' },
}

export default function WarningPanel({ warnings }: Props) {
  const sorted = [...warnings].sort((a, b) => {
    const order = { red: 0, orange: 1, yellow: 2, blue: 3 }
    return (order[a.level as keyof typeof order] ?? 4) - (order[b.level as keyof typeof order] ?? 4)
  })

  return (
    <div
      className="rounded-xl p-5 border h-full"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        预警信息
        {warnings.length > 0 && (
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,59,48,0.2)', color: 'var(--accent-red)' }}>
            {warnings.length}
          </span>
        )}
      </h3>

      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {sorted.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
            <div className="text-3xl mb-2">&#10003;</div>
            <p>当前无预警</p>
          </div>
        ) : sorted.map((w) => {
          const style = levelStyle[w.level] || levelStyle.blue
          return (
            <div
              key={w.id}
              className="rounded-lg p-3 border-l-4"
              style={{ background: style.bg, borderLeftColor: style.border }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: style.dot }} />
                  <span className="text-sm font-medium" style={{ color: style.border }}>{w.label}</span>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{w.street}</span>
              </div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                {w.from_time} ~ {w.to_time} | 出力下降 {(w.drop_ratio * 100).toFixed(0)}%
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {w.weather_from} → {w.weather_to} | {w.action}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
