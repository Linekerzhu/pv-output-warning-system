import type { StreetAggregation, WarningRecord, PowerPrediction } from '../api'

interface Props {
  street: string
  aggregations: StreetAggregation[]
  warnings: WarningRecord[]
  streetPower: PowerPrediction[]
  onClose: () => void
}

export default function StreetPanel({ street, aggregations, warnings, streetPower, onClose }: Props) {
  const agg = aggregations.find(a => a.street === street)
  const streetWarnings = warnings.filter(w => w.street === street)

  return (
    <div className="absolute top-16 left-4 z-20 glass-panel" style={{ width: 280 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full" style={{ background: 'var(--accent-green)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {street}
          </span>
        </div>
        <button onClick={onClose} className="text-sm cursor-pointer px-1" style={{ color: 'var(--text-muted)' }}>&times;</button>
      </div>

      {/* Stats */}
      {agg && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>装机容量</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--accent-cyan)' }}>
              {agg.total_capacity_kw.toFixed(0)} <span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>kW</span>
            </div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>运行用户</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {agg.active_users} <span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>/ {agg.total_users}</span>
            </div>
          </div>
        </div>
      )}

      {/* Power predictions */}
      {streetPower.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>逐小时预测</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {streetPower.map(p => {
              const barWidth = Math.round(p.weather_factor * p.clearsky_ratio * 100)
              const barColor = p.weather_factor >= 0.7 ? '#00e676'
                : p.weather_factor >= 0.4 ? '#ffea00'
                : '#ff9100'
              return (
                <div key={p.time} className="flex items-center gap-2 text-[11px]">
                  <span className="w-10 shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {p.time.split(' ')[1]?.slice(0, 5)}
                  </span>
                  <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, background: barColor, opacity: 0.7 }} />
                  </div>
                  <span className="w-12 text-right shrink-0 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {p.predicted_power_kw.toFixed(0)}
                  </span>
                  <span className="w-8 text-right shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {p.weather_text.slice(0, 2)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Warnings for this street */}
      {streetWarnings.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[10px] mb-2" style={{ color: 'var(--accent-orange)' }}>
            预警 ({streetWarnings.length})
          </div>
          {streetWarnings.map(w => (
            <div key={w.id} className="text-[11px] mb-1.5 pl-2" style={{ borderLeft: `2px solid ${w.level === 'red' ? '#ff1744' : w.level === 'orange' ? '#ff9100' : w.level === 'yellow' ? '#ffea00' : '#00e5ff'}` }}>
              <span style={{ color: 'var(--text-primary)' }}>{w.from_time.split(' ')[1]} → {w.to_time.split(' ')[1]}</span>
              <span className="ml-1" style={{ color: 'var(--text-muted)' }}>&#x25BC;{(w.drop_ratio * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
