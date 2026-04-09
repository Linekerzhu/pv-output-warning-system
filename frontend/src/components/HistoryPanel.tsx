import { memo, useState, useCallback } from 'react'
import { api, BacktestResult, WarningRecord } from '../api'
import PanelHeader from './ui/PanelHeader'
import PrimaryButton from './ui/PrimaryButton'

interface Props {
  onClose: () => void
  onStreetClick: (street: string) => void
}

const LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  red:    { color: 'var(--solar-coral)', bg: 'rgba(224,100,86,0.06)' },
  orange: { color: 'var(--solar-amber)', bg: 'rgba(219,161,74,0.06)' },
  yellow: { color: 'var(--solar-yellow)', bg: 'rgba(232,200,74,0.06)' },
  blue:   { color: 'var(--solar-teal)', bg: 'rgba(82,196,184,0.06)' },
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

export default memo(function HistoryPanel({ onClose, onStreetClick }: Props) {
  const today = new Date()
  const minDate = new Date(today)
  minDate.setDate(today.getDate() - 9)

  const [selectedDate, setSelectedDate] = useState(formatDate(new Date(today.getTime() - 86400000)))
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runBacktest = useCallback(async (dateStr: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getBacktest(dateStr)
      setResult(data)
    } catch {
      setError('回测失败，请重试')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const fmtPower = (kw: number) => kw >= 1000 ? `${(kw / 1000).toFixed(1)}MW` : `${Math.round(kw)}kW`

  return (
    <section aria-label="历史回测" className="h-full flex flex-col">
      <PanelHeader
        title="历史回测"
        accent="var(--solar-gold)"
        glow="0 0 12px rgba(245,194,82,0.3)"
        onClose={onClose}
        closeAriaLabel="关闭历史回测面板"
      />

      <div className="px-4 pb-2">
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)' }}>
          基于历史实际天气数据，使用估算GHI验证预警算法
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center gap-2">
        <label htmlFor="backtest-date" className="sr-only">回测日期</label>
        <input
          id="backtest-date"
          type="date"
          value={selectedDate}
          min={formatDate(minDate)}
          max={formatDate(new Date(today.getTime() - 86400000))}
          onChange={e => setSelectedDate(e.target.value)}
          aria-label="选择回测日期"
          className="flex-1 rounded"
          style={{
            fontFamily: 'var(--font-data)', fontSize: 11,
            background: 'var(--bg-surface)', color: 'var(--text-bright)',
            border: '1px solid var(--border-subtle)', outline: 'none',
            padding: '8px 10px', minHeight: 36, textAlign: 'center',
          }}
        />
        <PrimaryButton
          onClick={() => runBacktest(selectedDate)}
          disabled={loading}
          ariaLabel="运行回测"
        >
          {loading ? '分析中...' : '运行回测'}
        </PrimaryButton>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {error && (
          <div className="py-4 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--solar-coral)' }}>
            {error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="py-8 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>
            选择日期并运行回测
          </div>
        )}

        {result && (
          <>
            <div className="mb-3 p-3 rounded" style={{ background: 'var(--bg-surface)' }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>
                  {result.date} 回测结果
                </span>
                <span className="data-value" style={{ fontSize: 10, color: result.summary.total_warnings > 0 ? 'var(--solar-coral)' : 'var(--solar-green)' }}>
                  {result.summary.total_warnings} 条预警
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(result.summary.by_level).map(([level, count]) => {
                  if (count === 0) return null
                  const s = LEVEL_STYLE[level]
                  return (
                    <span key={level} className="data-value px-2 py-0.5 rounded"
                      style={{ fontSize: 9, background: s?.bg, color: s?.color, border: `1px solid ${s?.color}` }}>
                      {level === 'red' ? '红' : level === 'orange' ? '橙' : level === 'yellow' ? '黄' : '蓝'} {count}
                    </span>
                  )
                })}
              </div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--text-muted)', marginTop: 6 }}>
                数据源: {result.data_source}
              </div>
            </div>

            {result.weather_hourly && result.weather_hourly.length > 0 && (
              <div className="mb-3">
                <div className="tag-label mb-1.5 px-1" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  当日实际天气（发电时段）
                </div>
                <div className="flex gap-0.5 overflow-x-auto pb-1">
                  {result.weather_hourly
                    .filter(h => {
                      const hr = parseInt(h.time.split(' ')[1]?.split(':')[0] || '0')
                      return hr >= 6 && hr <= 18
                    })
                    .map(h => (
                      <div key={h.time} className="text-center px-1 py-1 rounded"
                        style={{ minWidth: 36, background: 'var(--bg-surface)', fontSize: 8 }}>
                        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{h.time.split(' ')[1]?.slice(0, 5)}</div>
                        <div style={{ fontSize: 10, lineHeight: 1.4 }}>{h.text}</div>
                        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{h.temp}°</div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {result.warnings.length === 0 ? (
              <div className="py-6 text-center">
                <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--solar-green)' }}>
                  当日无预警触发
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="tag-label mb-1 px-1" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  回测预警详情
                </div>
                {result.warnings.map((w: WarningRecord, i: number) => {
                  const s = LEVEL_STYLE[w.level] || LEVEL_STYLE.blue
                  const fromH = w.from_time.split(' ')[1]?.slice(0, 5)
                  const toH = w.to_time.split(' ')[1]?.slice(0, 5)
                  return (
                    <div key={w.id} className="px-3 py-2 animate-in cursor-pointer"
                      style={{ background: s.bg, borderLeft: `2.5px solid ${s.color}`, animationDelay: `${0.02 + i * 0.015}s` }}
                      onClick={() => onStreetClick(w.street)}>
                      <div className="flex items-center gap-2">
                        <span className="data-value" style={{ fontSize: 9, color: s.color }}>{w.label}</span>
                        <span className="data-value" style={{ fontSize: 9, color: w.type === 'ramp_down' ? 'var(--solar-coral)' : 'var(--solar-green)' }}>
                          {w.type === 'ramp_down' ? '↓ 骤降' : '↑ 骤增'} {Math.round(w.change_rate * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1" style={{ fontFamily: 'var(--font-data)', fontSize: 10 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{w.street}</span>
                        <span style={{ color: 'var(--text-bright)' }}>{fromH}→{toH}</span>
                        <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.from_power_kw)}</span>
                        <span style={{ color: s.color }}>{w.type === 'ramp_down' ? '▾' : '▴'}</span>
                        <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.to_power_kw)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5" style={{ fontFamily: 'var(--font-data)', fontSize: 9 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{w.weather_from}→{w.weather_to}</span>
                        <span style={{ color: s.color }}>
                          Δ{w.abs_change_kw >= 1000 ? `${(w.abs_change_kw / 1000).toFixed(1)}MW` : `${Math.round(w.abs_change_kw)}kW`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
})
