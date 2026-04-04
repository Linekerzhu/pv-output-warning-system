import { memo, useMemo, useState, useEffect, useRef } from 'react'
import { api, SolarRadiation, PVSummary, StreetAggregation } from '../api'
import { computeWarnings, type Warning } from '../lib/warningEngine'

interface Props {
  selectedStreet: string | null
  summary: PVSummary | null
  aggregations: StreetAggregation[]
  onClose: () => void
  onStreetClick: (street: string) => void
  isMobile?: boolean
}

const AREA_SPECIFIC_CAPACITY = 0.21 // kW/m²

const LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  red:    { color: 'var(--solar-coral)', bg: 'rgba(224,100,86,0.06)' },
  orange: { color: 'var(--solar-amber)', bg: 'rgba(219,161,74,0.06)' },
  yellow: { color: 'var(--solar-yellow)', bg: 'rgba(232,200,74,0.06)' },
  blue:   { color: 'var(--solar-teal)', bg: 'rgba(82,196,184,0.06)' },
}

const TYPE_LABEL = { ramp_down: '↓ 骤降', ramp_up: '↑ 骤增' } as const

export default memo(function WarningPanel({ selectedStreet, summary, aggregations, onClose, onStreetClick, isMobile }: Props) {
  const [radiation, setRadiation] = useState<SolarRadiation[]>([])
  const [loading, setLoading] = useState(true)
  const [currentSource, setCurrentSource] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)

  const prevStreetRef = useRef(selectedStreet)

  const doFetch = (street: string | null) => {
    setLoading(true)
    api.getSolarRadiation(48)
      .then(data => { setRadiation(data.forecasts); setCurrentSource(street) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { doFetch(null) }, [])

  useEffect(() => {
    if (selectedStreet !== prevStreetRef.current) {
      prevStreetRef.current = selectedStreet
      setCurrentSource(selectedStreet)
    }
  }, [selectedStreet])

  const displayName = currentSource || '金山区'

  const capacityKw = useMemo(() => {
    if (currentSource) {
      const agg = aggregations.find(a => a.street === currentSource)
      return agg?.total_capacity_kw || 0
    }
    return summary?.total_capacity_kw || 0
  }, [currentSource, aggregations, summary])

  const areaM2 = capacityKw / AREA_SPECIFIC_CAPACITY

  const warnings = useMemo(() =>
    computeWarnings(radiation, capacityKw, areaM2),
    [radiation, capacityKw, areaM2]
  )

  // Filter
  const filtered = useMemo(() => {
    let list = warnings
    if (!showDismissed) list = list.filter(w => !dismissed.has(w.id))
    if (levelFilter) list = list.filter(w => w.level === levelFilter)
    if (typeFilter) list = list.filter(w => w.type === typeFilter)
    return list
  }, [warnings, dismissed, showDismissed, levelFilter, typeFilter])

  const counts = useMemo(() => {
    const c = { red: 0, orange: 0, yellow: 0, blue: 0, ramp_down: 0, ramp_up: 0 }
    warnings.filter(w => !dismissed.has(w.id)).forEach(w => {
      c[w.level]++
      c[w.type]++
    })
    return c
  }, [warnings, dismissed])

  const activeCount = warnings.length - dismissed.size

  const isDesktopSide = !isMobile

  return (
    <section aria-label="预警中心" className={isDesktopSide ? 'h-full flex flex-col' : ''}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-coral)', boxShadow: 'var(--glow-coral)' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
            出力预警
          </h2>
          {activeCount > 0 && (
            <span className="data-value" style={{ fontSize: 11, color: 'var(--solar-coral)' }}>{activeCount}</span>
          )}
        </div>
        <button onClick={onClose} aria-label="关闭预警面板" className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg transition-colors active:scale-95 -mr-2"
          style={{ color: 'var(--text-muted)', fontSize: 16 }}>
          <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
        </button>
      </div>

      {/* Source */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2">
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700,
            color: currentSource ? 'var(--solar-teal)' : 'var(--solar-amber)',
          }}>
            {displayName}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            出力波动预警
          </span>
          {currentSource && (
            <button onClick={() => setCurrentSource(null)}
              className="transition-all active:scale-95"
              style={{
                fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--solar-amber)',
                padding: '2px 8px', borderRadius: 100, cursor: 'pointer',
                border: '1px solid var(--border-subtle)', background: 'transparent', marginLeft: 'auto',
              }}>
              返回全区
            </button>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
          基于GHI辐照预测，检测出力曲线异常波动（排除日出日落正常变化）
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 pb-2 flex flex-col gap-1.5">
        {/* Level + type filters */}
        <div className="flex gap-1 flex-wrap">
          {(['red', 'orange', 'yellow', 'blue'] as const).map(level => {
            const count = counts[level]
            if (count === 0) return null
            const s = LEVEL_STYLE[level]
            const active = levelFilter === level
            return (
              <button key={level} onClick={() => setLevelFilter(active ? null : level)}
                aria-pressed={active} className="data-value px-2 py-1 rounded-md transition-all active:scale-95"
                style={{ fontSize: 9, background: active ? s.bg : 'transparent', color: active ? s.color : 'var(--text-muted)', border: `1px solid ${active ? s.color : 'var(--border-subtle)'}`, cursor: 'pointer' }}>
                {level === 'red' ? '红' : level === 'orange' ? '橙' : level === 'yellow' ? '黄' : '蓝'} {count}
              </button>
            )
          })}
          <span style={{ width: 1, height: 20, background: 'var(--border-subtle)', alignSelf: 'center', margin: '0 2px' }} />
          {(['ramp_down', 'ramp_up'] as const).map(type => {
            const count = counts[type]
            if (count === 0) return null
            const active = typeFilter === type
            return (
              <button key={type} onClick={() => setTypeFilter(active ? null : type)}
                aria-pressed={active} className="px-2 py-1 rounded-md transition-all active:scale-95"
                style={{ fontSize: 9, background: active ? 'var(--bg-surface)' : 'transparent', color: active ? 'var(--text-bright)' : 'var(--text-muted)', border: `1px solid ${active ? 'var(--text-muted)' : 'var(--border-subtle)'}`, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                {TYPE_LABEL[type]} {count}
              </button>
            )
          })}
          {(levelFilter || typeFilter) && (
            <button onClick={() => { setLevelFilter(null); setTypeFilter(null) }}
              className="px-2 py-1 rounded-md transition-all active:scale-95"
              style={{ fontSize: 9, color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
              清除
            </button>
          )}
        </div>

        {/* Show dismissed toggle */}
        {dismissed.size > 0 && (
          <button onClick={() => setShowDismissed(!showDismissed)}
            style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
            {showDismissed ? '隐藏已忽略' : `显示已忽略 (${dismissed.size})`}
          </button>
        )}
      </div>

      {/* Filter count */}
      {(levelFilter || typeFilter) && (
        <div className="px-4 pb-1" style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)' }}>
          筛选 {filtered.length}/{warnings.length}
        </div>
      )}

      {/* Warning list */}
      <div className={`px-3 pb-3 space-y-1.5 ${isDesktopSide ? 'flex-1 overflow-y-auto' : ''}`}
        style={!isDesktopSide ? { maxHeight: isMobile ? '40vh' : 'calc(100vh - 160px)', overflowY: 'auto' } : {}}>

        {loading && (
          <div className="py-8 text-center" style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)' }}>
            分析出力曲线...
          </div>
        )}

        {!loading && warnings.length === 0 && (
          <div className="py-8 text-center">
            <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--solar-green)' }}>
              未来24小时无异常波动
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              出力曲线变化在正常范围内
            </div>
          </div>
        )}

        {!loading && filtered.length === 0 && warnings.length > 0 && (
          <div className="py-6 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>
            暂无匹配预警
          </div>
        )}

        {!loading && filtered.map((w, i) => {
          const s = LEVEL_STYLE[w.level]
          const isDismissed = dismissed.has(w.id)
          const dateStr = w.fromTime.split(' ')[0].slice(5).replace('-', '/')
          const fromH = w.fromTime.split(' ')[1]?.slice(0, 5)
          const toH = w.toTime.split(' ')[1]?.slice(0, 5)
          const fmtPower = (kw: number) => kw >= 1000 ? `${(kw / 1000).toFixed(1)}MW` : `${kw}kW`

          return (
            <div key={w.id}
              className="px-3 py-2 animate-in"
              style={{
                background: s.bg,
                borderLeft: `2.5px solid ${s.color}`,
                animationDelay: `${0.02 + i * 0.015}s`,
                opacity: isDismissed ? 0.35 : 1,
              }}>
              <div className="flex items-center justify-between">
                {/* Left: level + type + ramp rate */}
                <div className="flex items-center gap-2">
                  <span className="data-value" style={{ fontSize: 9, color: s.color }}>{w.label}</span>
                  <span className="data-value" style={{
                    fontSize: 9,
                    color: w.type === 'ramp_down' ? 'var(--solar-coral)' : 'var(--solar-green)',
                  }}>
                    {TYPE_LABEL[w.type]} {w.rampRatePercent}%/h
                  </span>
                </div>
                {/* Right: dismiss */}
                {!isDismissed ? (
                  <button onClick={() => setDismissed(prev => new Set(prev).add(w.id))}
                    style={{ fontFamily: 'var(--font-body)', fontSize: 8, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                    忽略
                  </button>
                ) : (
                  <button onClick={() => setDismissed(prev => { const ns = new Set(prev); ns.delete(w.id); return ns })}
                    style={{ fontFamily: 'var(--font-body)', fontSize: 8, color: 'var(--solar-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                    恢复
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1" style={{ fontFamily: 'var(--font-data)', fontSize: 10 }}>
                <span style={{ color: 'var(--text-muted)' }}>{dateStr}</span>
                <span style={{ color: 'var(--text-bright)' }}>{fromH}→{toH}</span>
                <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.fromPowerKw)}</span>
                <span style={{ color: s.color }}>{w.type === 'ramp_down' ? '▾' : '▴'}</span>
                <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.toPowerKw)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>GHI{w.ghiChange > 0 ? '+' : ''}{w.ghiChange}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
})
