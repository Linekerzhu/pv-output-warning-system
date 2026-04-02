import type { StreetAggregation, WarningRecord } from '../api'

interface Props {
  aggregations: StreetAggregation[]
  warnings: WarningRecord[]
  onStreetClick: (street: string) => void
  selectedStreet: string | null
}

function getWorstWarning(street: string, warnings: WarningRecord[]): string | null {
  const sw = warnings.filter(w => w.street === street)
  if (sw.length === 0) return null
  for (const l of ['red', 'orange', 'yellow', 'blue']) {
    if (sw.some(w => w.level === l)) return l
  }
  return null
}

const levelBadge: Record<string, { bg: string; text: string; label: string }> = {
  red:    { bg: 'rgba(255,59,48,0.2)', text: '#ff3b30', label: '红色' },
  orange: { bg: 'rgba(255,140,0,0.2)', text: '#ff8c00', label: '橙色' },
  yellow: { bg: 'rgba(255,215,0,0.2)', text: '#ffd700', label: '黄色' },
  blue:   { bg: 'rgba(0,212,255,0.2)', text: '#00d4ff', label: '蓝色' },
}

export default function StreetTable({ aggregations, warnings, onStreetClick, selectedStreet }: Props) {
  const sorted = [...aggregations].sort((a, b) => b.total_capacity_kw - a.total_capacity_kw)

  return (
    <div
      className="rounded-xl p-5 border"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        街镇光伏概况
      </h3>
      <div className="overflow-auto max-h-[350px]">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--text-secondary)' }} className="text-xs">
              <th className="text-left py-2 px-2">街镇</th>
              <th className="text-right py-2 px-2">容量(kW)</th>
              <th className="text-right py-2 px-2">用户</th>
              <th className="text-center py-2 px-2">预警</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(agg => {
              const wl = getWorstWarning(agg.street, warnings)
              const badge = wl ? levelBadge[wl] : null
              const isSelected = agg.street === selectedStreet

              return (
                <tr
                  key={agg.street}
                  onClick={() => onStreetClick(agg.street)}
                  className="cursor-pointer transition-colors"
                  style={{
                    background: isSelected ? 'var(--bg-card-hover)' : 'transparent',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <td className="py-2.5 px-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {agg.street}
                  </td>
                  <td className="py-2.5 px-2 text-right" style={{ color: 'var(--accent-blue)' }}>
                    {agg.total_capacity_kw.toFixed(0)}
                  </td>
                  <td className="py-2.5 px-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {agg.active_users}/{agg.total_users}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    {badge ? (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: badge.bg, color: badge.text }}
                      >
                        {badge.label}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--accent-green)' }}>正常</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
