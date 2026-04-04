import { memo } from 'react'
import type { StreetAggregation, WarningRecord, PowerPrediction } from '../api'
import { LEVEL_COLORS } from '../tokens'

interface Props {
  street: string
  aggregations: StreetAggregation[]
  warnings: WarningRecord[]
  streetPower: PowerPrediction[]
  onClose: () => void
  embedded?: boolean
}

export default memo(function StreetPanel({ street, aggregations, warnings, streetPower, onClose, embedded }: Props) {
  const agg = aggregations.find(a => a.street === street)
  const streetWarnings = warnings.filter(w => w.street === street)

  const wrapper = embedded
    ? ''
    : 'absolute top-14 left-3 z-20 glass-panel animate-in'

  return (
    <section aria-label={`${street} 详情`} className={wrapper} style={embedded ? {} : { width: 280 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-teal)', boxShadow: 'var(--glow-teal)' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', letterSpacing: '0.3px', margin: 0 }}>
            {street}
          </h2>
        </div>
        <button onClick={onClose} aria-label="关闭街道详情" className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg transition-colors active:scale-95 -mr-2"
          style={{ color: 'var(--text-muted)', fontSize: 16 }}>
          <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
        </button>
      </div>

      {/* Stats */}
      {agg && (
        <div className={`px-4 pb-3 grid gap-2 relative z-10 ${embedded ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div className="rounded-xl p-2.5" style={{ background: 'var(--bg-surface)' }}>
            <div className="tag-label mb-1" style={{ fontSize: 8 }}>装机容量</div>
            <div className="data-value text-base" style={{ color: 'var(--solar-amber)', textShadow: '0 0 12px rgba(219,161,74,0.2)' }}>
              {agg.total_capacity_kw.toFixed(0)}
              <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>kW</span>
            </div>
          </div>
          <div className="rounded-xl p-2.5" style={{ background: 'var(--bg-surface)' }}>
            <div className="tag-label mb-1" style={{ fontSize: 8 }}>在线</div>
            <div className="data-value text-base" style={{ color: 'var(--text-bright)' }}>
              {agg.active_users}
              <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>/ {agg.total_users}</span>
            </div>
          </div>
          {embedded && streetWarnings.length > 0 && (
            <div className="rounded-xl p-2.5" style={{ background: 'rgba(224,100,86,0.05)' }}>
              <div className="tag-label mb-1" style={{ fontSize: 8, color: 'var(--solar-coral)' }}>预警</div>
              <div className="data-value text-base" style={{ color: 'var(--solar-coral)' }}>
                {streetWarnings.length}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hourly power bars */}
      {streetPower.length > 0 && !embedded && (
        <div className="px-4 pb-3 relative z-10">
          <div className="tag-label mb-2" style={{ fontSize: 8 }}>逐时出力</div>
          <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
            {streetPower.map((p, i) => {
              const ratio = p.power_kw / p.clearsky_power_kw
              const barWidth = Math.round(Math.min(ratio, 1) * 100)
              const barColor = p.weather_ratio >= 0.7 ? 'var(--solar-green)'
                : p.weather_ratio >= 0.4 ? 'var(--solar-amber)' : 'var(--solar-coral)'

              return (
                <div key={p.time} className="flex items-center gap-2 animate-in" style={{ animationDelay: `${i * 0.02}s` }}>
                  <span className="data-value w-10 shrink-0" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {p.time.split(' ')[1]?.slice(0, 5)}
                  </span>
                  <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${barWidth}%`,
                      background: `linear-gradient(90deg, ${barColor}60, ${barColor})`,
                      boxShadow: `0 0 10px ${barColor}20`,
                    }} />
                  </div>
                  <span className="data-value w-12 text-right shrink-0" style={{ fontSize: 10, color: 'var(--text-primary)' }}>
                    {p.power_kw.toFixed(0)}
                  </span>
                  <span className="w-6 text-right shrink-0" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {p.weather_text.slice(0, 2)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Street warnings */}
      {streetWarnings.length > 0 && !embedded && (
        <div className="px-4 pb-3 relative z-10">
          <div className="tag-label mb-2" style={{ fontSize: 8, color: 'var(--solar-coral)' }}>预警 ({streetWarnings.length})</div>
          {streetWarnings.map(w => (
            <div key={w.id} className="mb-1.5 pl-2.5 data-value rounded-sm" style={{
              fontSize: 10,
              borderLeft: `2px solid ${LEVEL_COLORS[w.level] || 'var(--solar-teal)'}`,
              paddingTop: 2,
              paddingBottom: 2,
            }}>
              <span style={{ color: 'var(--text-bright)' }}>{w.from_time.split(' ')[1]} → {w.to_time.split(' ')[1]}</span>
              <span className="ml-1.5" style={{ color: LEVEL_COLORS[w.level] || 'var(--solar-teal)', fontWeight: 600 }}>{w.type === 'ramp_down' ? '▾' : '▴'}{(w.change_rate * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
})
