import { memo, useEffect, useState, useMemo, useRef, lazy, Suspense } from 'react'
import { api, HourlyWeather, SolarRadiation, PVSummary, StreetAggregation } from '../api'

const RadiationChart = lazy(() => import('./RadiationChart'))

interface Props {
  selectedStreet: string | null
  summary: PVSummary | null
  aggregations: StreetAggregation[]
  onClose: () => void
}

const PV_START_DEFAULT = 6
const PV_END_DEFAULT = 19

function weatherEmoji(code: number): string {
  if (code === 100 || code === 150) return '\u2600\uFE0F'
  if (code === 101 || code === 151) return '\u26C5'
  if (code >= 102 && code <= 104) return '\u2601\uFE0F'
  if (code >= 300 && code <= 318) return '\uD83C\uDF27\uFE0F'
  if (code >= 400 && code <= 410) return '\u2744\uFE0F'
  if (code >= 500 && code <= 515) return '\uD83C\uDF2B\uFE0F'
  return '\u2601\uFE0F'
}

interface DayGroup {
  date: string
  label: string
  hours: HourlyWeather[]
  tempMax: number
  tempMin: number
  pvStart: number
  pvEnd: number
  avgCloud: number
}

export default memo(function WeatherPanel({ selectedStreet, summary, aggregations, onClose }: Props) {
  const [hourly, setHourly] = useState<HourlyWeather[]>([])
  const [radiation, setRadiation] = useState<SolarRadiation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [currentSource, setCurrentSource] = useState<string | null>(null)

  const prevStreetRef = useRef(selectedStreet)

  const doFetch = (street: string | null) => {
    const fetchStreet = street || '金山卫镇'
    setLoading(true)
    setError(false)
    Promise.all([
      api.getWeatherForecast(fetchStreet),
      api.getSolarRadiation(48).catch(() => null),
    ])
      .then(([weatherData, solarData]) => {
        setHourly(weatherData.hourly)
        if (solarData) setRadiation(solarData.forecasts)
        setCurrentSource(street)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { doFetch(null) }, [])

  useEffect(() => {
    if (selectedStreet !== prevStreetRef.current) {
      prevStreetRef.current = selectedStreet
      doFetch(selectedStreet)
    }
  }, [selectedStreet])

  const displayName = currentSource || '金山区'

  // Get capacity for current view
  const capacityKw = useMemo(() => {
    if (currentSource) {
      const agg = aggregations.find(a => a.street === currentSource)
      return agg?.total_capacity_kw || 0
    }
    return summary?.total_capacity_kw || 0
  }, [currentSource, aggregations, summary])

  const pvHoursSet = useMemo(() => {
    const m = new Map<string, Set<number>>()
    radiation.forEach(r => {
      if (r.ghi > 0) {
        const date = r.time.split(' ')[0]
        if (!m.has(date)) m.set(date, new Set())
        m.get(date)!.add(parseInt(r.time.split(' ')[1]?.split(':')[0] || '0'))
      }
    })
    return m
  }, [radiation])

  const days = useMemo<DayGroup[]>(() => {
    if (hourly.length === 0) return []
    const map = new Map<string, HourlyWeather[]>()
    hourly.forEach(h => {
      const date = h.time.split(' ')[0]
      if (!map.has(date)) map.set(date, [])
      map.get(date)!.push(h)
    })
    const dates = [...map.keys()].slice(0, 2)
    return dates.map((date, i) => {
      const hours = map.get(date)!
      const temps = hours.map(h => h.temp)
      const radHours = pvHoursSet.get(date)
      let pvStart = PV_START_DEFAULT, pvEnd = PV_END_DEFAULT
      if (radHours && radHours.size > 0) {
        pvStart = Math.min(...radHours)
        pvEnd = Math.max(...radHours) + 1
      }
      const pvWeatherHours = hours.filter(h => {
        const hr = parseInt(h.time.split(' ')[1]?.split(':')[0] || '0')
        return radHours ? radHours.has(hr) : (hr >= pvStart && hr < pvEnd)
      })
      return {
        date, label: i === 0 ? '今天' : '明天', hours,
        tempMax: Math.max(...temps), tempMin: Math.min(...temps),
        pvStart, pvEnd,
        avgCloud: pvWeatherHours.length > 0 ? Math.round(pvWeatherHours.reduce((s, h) => s + h.cloud, 0) / pvWeatherHours.length) : 0,
      }
    })
  }, [hourly, pvHoursSet])

  const radiationMap = useMemo(() => {
    const m = new Map<string, SolarRadiation>()
    radiation.forEach(r => m.set(r.time.slice(0, 16), r))
    return m
  }, [radiation])

  return (
    <section aria-label="天气预报" className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-gold)', boxShadow: '0 0 12px rgba(245,194,82,0.3)' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
            天气与出力
          </h2>
        </div>
        <button onClick={onClose} aria-label="关闭面板" className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg transition-colors active:scale-95 -mr-2"
          style={{ color: 'var(--text-muted)', fontSize: 16 }}>
          <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
        </button>
      </div>

      {/* Source + capacity */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '0.3px',
            color: currentSource ? 'var(--solar-teal)' : 'var(--solar-amber)',
          }}>
            {displayName}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            未来24小时预报
          </span>
          {currentSource && (
            <button onClick={() => doFetch(null)}
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
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
          装机 {capacityKw >= 1000 ? `${(capacityKw / 1000).toFixed(1)} MW` : `${capacityKw.toFixed(0)} kW`}
        </div>
      </div>

      {/* Charts area */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="h-32 flex items-center justify-center" style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)' }}>
            加载中...
          </div>
        )}

        {error && (
          <div className="h-32 flex flex-col items-center justify-center gap-2">
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--solar-coral)' }}>数据加载失败</span>
            <button onClick={() => doFetch(currentSource)}
              style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--solar-amber)', background: 'none', border: 'none', cursor: 'pointer' }}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Solar radiation chart */}
            {radiation.length > 0 && (
              <div className="pb-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between px-4 pb-1">
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, color: 'var(--text-bright)' }}>
                    太阳辐照度
                  </span>
                  <div className="flex gap-3" style={{ fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--text-muted)' }}>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3" style={{ height: 2, background: '#f5c252', borderRadius: 1 }} />
                      <span style={{ color: 'var(--solar-gold)' }}>GHI</span>
                    </span>
                    <span style={{ opacity: 0.6 }} className="flex items-center gap-1">
                      <span className="inline-block w-2" style={{ height: 1, background: '#e06456' }} />DNI
                    </span>
                    <span style={{ opacity: 0.5 }} className="flex items-center gap-1">
                      <span className="inline-block w-2" style={{ height: 0, borderTop: '1px dashed #52c4b8' }} />DHI
                    </span>
                  </div>
                </div>
                <Suspense fallback={null}>
                  <RadiationChart data={radiation} />
                </Suspense>
              </div>
            )}

            {/* Legend */}
            <div className="px-4 py-1.5 flex items-center justify-between" style={{ fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--text-muted)' }}>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'rgba(219,161,74,0.15)', border: '1px solid rgba(219,161,74,0.3)' }} />
                <span>光伏有效时段（按辐照识别）</span>
              </div>
              <span>云量: <span style={{ color: 'var(--solar-green)' }}>低</span>/<span style={{ color: 'var(--solar-amber)' }}>中</span>/<span style={{ color: 'var(--solar-coral)' }}>高</span></span>
            </div>

            {/* Hourly table */}
            {days.map(day => (
              <div key={day.date} className="mb-1">
                <div className="flex items-center justify-between px-4 py-2" style={{ background: 'var(--bg-surface)' }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>{day.label}</span>
                    <span className="data-value" style={{ fontSize: 10 }}>
                      <span style={{ color: 'var(--solar-coral)' }}>{day.tempMax}°</span>
                      <span style={{ color: 'var(--text-muted)' }}>/</span>
                      <span style={{ color: 'var(--solar-teal)' }}>{day.tempMin}°</span>
                    </span>
                    <span className="data-value" style={{ fontSize: 9, color: 'var(--text-muted)' }}>☀{day.pvStart}–{day.pvEnd}时</span>
                  </div>
                  <span className="data-value" style={{ fontSize: 9, color: 'var(--text-muted)' }}>{day.date.slice(5).replace('-', '/')}</span>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-data)', fontSize: 10, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 42 }} />
                    <col style={{ width: 52 }} />
                    <col style={{ width: 38 }} />
                    <col style={{ width: 30 }} />
                    <col style={{ width: 28 }} />
                    <col style={{ width: 28 }} />
                    <col style={{ width: 30 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                      <th style={{ fontWeight: 500, textAlign: 'left', padding: '4px 0 4px 8px' }}>时间</th>
                      <th style={{ fontWeight: 500, textAlign: 'left', padding: '4px 0' }}>天气</th>
                      <th style={{ fontWeight: 500, textAlign: 'right', padding: '4px 0' }}>辐照</th>
                      <th style={{ fontWeight: 500, textAlign: 'right', padding: '4px 0' }}>温度</th>
                      <th style={{ fontWeight: 500, textAlign: 'right', padding: '4px 0' }}>云量</th>
                      <th style={{ fontWeight: 500, textAlign: 'right', padding: '4px 0' }}>降水</th>
                      <th style={{ fontWeight: 500, textAlign: 'right', padding: '4px 4px 4px 0' }}>风速</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.hours.map(h => {
                      const hour = parseInt(h.time.split(' ')[1]?.split(':')[0] || '0')
                      const dayRadHours = pvHoursSet.get(day.date)
                      const inPV = dayRadHours ? dayRadHours.has(hour) : (hour >= day.pvStart && hour < day.pvEnd)
                      const rad = radiationMap.get(h.time)

                      return (
                        <tr key={h.time} style={{ background: inPV ? 'rgba(219,161,74,0.05)' : 'transparent' }}>
                          <td style={{ padding: '4px 0 4px 6px', borderLeft: inPV ? '2px solid rgba(219,161,74,0.25)' : '2px solid transparent', color: inPV ? 'var(--text-bright)' : 'var(--text-muted)', fontWeight: inPV ? 600 : 400 }}>
                            {h.time.split(' ')[1]?.slice(0, 5)}
                          </td>
                          <td style={{ padding: '4px 0', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            <span style={{ fontSize: 11 }}>{weatherEmoji(h.icon)}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-primary)', marginLeft: 1 }}>{h.text}</span>
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', color: rad && rad.ghi > 0 ? 'var(--solar-gold)' : 'var(--text-muted)' }}>
                            {rad && rad.ghi > 0 ? Math.round(rad.ghi) : '--'}
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', color: inPV ? 'var(--solar-amber)' : 'var(--text-secondary)' }}>
                            {h.temp}°
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', color: inPV ? (h.cloud > 70 ? 'var(--solar-coral)' : h.cloud > 40 ? 'var(--solar-amber)' : 'var(--solar-green)') : 'var(--text-muted)' }}>
                            {h.cloud}
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', color: h.pop > 50 ? 'var(--solar-teal)' : h.pop > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                            {h.pop > 0 ? h.pop : '--'}
                          </td>
                          <td style={{ padding: '4px 4px 4px 0', textAlign: 'right', color: h.wind_speed > 30 ? 'var(--solar-coral)' : 'var(--text-muted)' }}>
                            {h.wind_speed > 0 ? Math.round(h.wind_speed) : '--'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  )
})
