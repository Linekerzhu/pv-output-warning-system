import { memo, useMemo, useState } from 'react'
import type { WarningRecord } from '../api'

interface Props {
  warnings: WarningRecord[]
  selectedStreet: string | null
  onClose: () => void
  onStreetClick: (street: string) => void
  isMobile?: boolean
}

const LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  red:    { color: 'var(--solar-coral)', bg: 'rgba(224,100,86,0.06)' },
  orange: { color: 'var(--solar-amber)', bg: 'rgba(219,161,74,0.06)' },
  yellow: { color: 'var(--solar-yellow)', bg: 'rgba(232,200,74,0.06)' },
  blue:   { color: 'var(--solar-teal)', bg: 'rgba(82,196,184,0.06)' },
}

const TYPE_LABEL = { ramp_down: '↓ 骤降', ramp_up: '↑ 骤增' } as const

export default memo(function WarningPanel({ warnings, selectedStreet, onClose, onStreetClick, isMobile }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)

  // Filter by selected street if any
  const streetFiltered = useMemo(() => {
    if (!selectedStreet) return warnings
    return warnings.filter(w => w.street === selectedStreet)
  }, [warnings, selectedStreet])

  const displayName = selectedStreet || '金山区'

  // Filter
  const filtered = useMemo(() => {
    let list = streetFiltered
    if (!showDismissed) list = list.filter(w => !dismissed.has(w.id))
    if (levelFilter) list = list.filter(w => w.level === levelFilter)
    if (typeFilter) list = list.filter(w => w.type === typeFilter)
    return list
  }, [streetFiltered, dismissed, showDismissed, levelFilter, typeFilter])

  const counts = useMemo(() => {
    const c = { red: 0, orange: 0, yellow: 0, blue: 0, ramp_down: 0, ramp_up: 0 }
    streetFiltered.filter(w => !dismissed.has(w.id)).forEach(w => {
      c[w.level as keyof typeof c]++
      c[w.type as keyof typeof c]++
    })
    return c
  }, [streetFiltered, dismissed])

  const activeCount = streetFiltered.length - [...dismissed].filter(id => streetFiltered.some(w => w.id === id)).length

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
            color: selectedStreet ? 'var(--solar-teal)' : 'var(--solar-amber)',
          }}>
            {displayName}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            出力预警
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
          基于天气系数变化率与绝对出力影响的双判据预警
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 pb-2 flex flex-col gap-1.5">
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
          筛选 {filtered.length}/{streetFiltered.length}
        </div>
      )}

      {/* Warning list */}
      <div className={`px-3 pb-3 space-y-1.5 ${isDesktopSide ? 'flex-1 overflow-y-auto' : ''}`}
        style={!isDesktopSide ? { maxHeight: isMobile ? '40vh' : 'calc(100vh - 160px)', overflowY: 'auto' } : {}}>

        {warnings.length === 0 && (
          <div className="py-8 text-center">
            <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--solar-green)' }}>
              未来24小时无异常波动
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              天气变化在正常范围内
            </div>
          </div>
        )}

        {filtered.length === 0 && warnings.length > 0 && (
          <div className="py-6 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>
            暂无匹配预警
          </div>
        )}

        {filtered.map((w, i) => {
          const s = LEVEL_STYLE[w.level] || LEVEL_STYLE.blue
          const isDismissed = dismissed.has(w.id)
          const dateStr = w.from_time.split(' ')[0].slice(5).replace('-', '/')
          const fromH = w.from_time.split(' ')[1]?.slice(0, 5)
          const toH = w.to_time.split(' ')[1]?.slice(0, 5)
          const fmtPower = (kw: number) => kw >= 1000 ? `${(kw / 1000).toFixed(1)}MW` : `${Math.round(kw)}kW`
          const typeLabel = w.type === 'ramp_down' ? '↓ 骤降' : '↑ 骤增'
          const ratePercent = Math.round(w.change_rate * 100)

          return (
            <div key={w.id}
              className="px-3 py-2 animate-in"
              style={{
                background: s.bg,
                borderLeft: `2.5px solid ${s.color}`,
                animationDelay: `${0.02 + i * 0.015}s`,
                opacity: isDismissed ? 0.35 : 1,
                cursor: 'pointer',
              }}
              onClick={() => onStreetClick(w.street)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="data-value" style={{ fontSize: 9, color: s.color }}>{w.label}</span>
                  <span className="data-value" style={{
                    fontSize: 9,
                    color: w.type === 'ramp_down' ? 'var(--solar-coral)' : 'var(--solar-green)',
                  }}>
                    {typeLabel} {ratePercent}%
                  </span>
                </div>
                {!isDismissed ? (
                  <button onClick={(e) => { e.stopPropagation(); setDismissed(prev => new Set(prev).add(w.id)) }}
                    style={{ fontFamily: 'var(--font-body)', fontSize: 8, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                    忽略
                  </button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); setDismissed(prev => { const ns = new Set(prev); ns.delete(w.id); return ns }) }}
                    style={{ fontFamily: 'var(--font-body)', fontSize: 8, color: 'var(--solar-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                    恢复
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1" style={{ fontFamily: 'var(--font-data)', fontSize: 10 }}>
                <span style={{ color: 'var(--text-muted)' }}>{w.street}</span>
                <span style={{ color: 'var(--text-muted)' }}>{dateStr}</span>
                <span style={{ color: 'var(--text-bright)' }}>{fromH}→{toH}</span>
                <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.from_power_kw)}</span>
                <span style={{ color: s.color }}>{w.type === 'ramp_down' ? '▾' : '▴'}</span>
                <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.to_power_kw)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5" style={{ fontFamily: 'var(--font-data)', fontSize: 9 }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {w.weather_from}→{w.weather_to}
                </span>
                <span style={{ color: s.color }}>
                  Δ{w.abs_change_kw >= 1000 ? `${(w.abs_change_kw / 1000).toFixed(1)}MW` : `${Math.round(w.abs_change_kw)}kW`}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
})
