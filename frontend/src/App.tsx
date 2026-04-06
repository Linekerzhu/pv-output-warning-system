import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { api, PVUser, PVSummary, TotalPrediction, WarningRecord, StreetAggregation, PowerPrediction, WeatherSummaryItem } from './api'
import MapView from './components/MapView'
import TopBar from './components/TopBar'
import StatsBar from './components/StatsBar'
const PowerChart = lazy(() => import('./components/PowerChart'))
const WeatherPanel = lazy(() => import('./components/WeatherPanel'))
import WarningPanel from './components/WarningPanel'
import StreetPanel from './components/StreetPanel'
import MobileTabBar from './components/MobileTabBar'
import SideMenu, { type PanelType } from './components/SideMenu'
import HistoryPanel from './components/HistoryPanel'

type MobileTab = 'map' | 'chart' | 'alerts'

export default function App() {
  const [pvUsers, setPVUsers] = useState<PVUser[]>([])
  const [summary, setSummary] = useState<PVSummary | null>(null)
  const [totalPower, setTotalPower] = useState<TotalPrediction[]>([])
  const [warnings, setWarnings] = useState<WarningRecord[]>([])
  const [aggregations, setAggregations] = useState<StreetAggregation[]>([])
  const [selectedStreet, setSelectedStreet] = useState<string | null>(null)
  const [streetPower, setStreetPower] = useState<PowerPrediction[]>([])
  const [weatherSummary, setWeatherSummary] = useState<WeatherSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => !window.matchMedia('(min-width: 768px)').matches)

  // Desktop: side panel state
  const [activePanel, setActivePanel] = useState<PanelType>(null)

  // Mobile: tab + sheet state
  const [mobileTab, setMobileTab] = useState<MobileTab>('map')
  const [showChart, setShowChart] = useState(false)
  const [showWarnings, setShowWarnings] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [summaryData, aggData, usersData] = await Promise.all([
        api.getSummary(),
        api.getAggregations(),
        api.getPVUsers(),
      ])
      setSummary(summaryData)
      setAggregations(aggData)
      setPVUsers(usersData)

      try {
        const [powerData, warningData, weatherData] = await Promise.all([
          api.getTotalPower(),
          api.evaluateWarnings(),
          api.getWeatherSummary(),
        ])
        setTotalPower(powerData)
        setWarnings(warningData.warnings)
        setWeatherSummary(weatherData)
        if (warningData.warnings.length > 0) setShowWarnings(true)
      } catch (e) {
        console.error('天气数据加载失败:', e)
      }
    } catch (e) {
      console.error('数据加载失败:', e)
      setError('数据加载失败，请检查网络连接')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleStreetClick = async (street: string) => {
    const deselect = selectedStreet === street
    setSelectedStreet(deselect ? null : street)
    if (deselect) {
      setStreetPower([])
      return
    }
    try {
      const data = await api.getStreetPower(street)
      setStreetPower(data.predictions)
      if (isMobile) {
        setMobileTab('chart')
        setShowChart(true)
        setShowWarnings(false)
      } else if (!activePanel) {
        setActivePanel('weather')
      }
    } catch {
      setStreetPower([])
    }
  }

  const handleMobileTab = (tab: MobileTab) => {
    setMobileTab(tab)
    if (tab === 'chart') {
      setShowChart(true)
      setShowWarnings(false)
    } else if (tab === 'alerts') {
      setShowWarnings(true)
      setShowChart(false)
    } else {
      setShowChart(false)
      setShowWarnings(false)
    }
  }

  // Compute current output ratio from total power data
  const outputRatio = useMemo(() => {
    if (totalPower.length === 0) return 0
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    const shanghaiHour = parseInt(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }))
    const target = `${parts} ${shanghaiHour.toString().padStart(2, '0')}:00`
    const entry = totalPower.find(p => p.time === target) || totalPower.find(p => {
      const h = parseInt(p.time.split(' ')[1]?.split(':')[0] || '0')
      return h === shanghaiHour
    })
    if (!entry || entry.total_capacity_kw <= 0) return 0
    return Math.min(1, entry.predicted_power_kw / entry.total_capacity_kw)
  }, [totalPower])

  const SIDE_MENU_W = 52
  const SIDE_PANEL_W = 360

  return (
    <main className="relative w-full h-dvh overflow-hidden warm-glow-bg">
      {error && (
        <div role="alert" className="absolute top-16 left-1/2 -translate-x-1/2 z-40 glass-panel px-4 py-2.5 flex items-center gap-3 animate-in"
          style={{ borderColor: 'rgba(224,100,86,0.2)' }}>
          <span style={{ color: 'var(--solar-coral)', fontFamily: 'var(--font-body)', fontSize: 12 }}>{error}</span>
          <button onClick={loadData} aria-label="重试"
            style={{ color: 'var(--solar-amber)', fontFamily: 'var(--font-display)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
            重试
          </button>
        </div>
      )}

      {/* ══ Desktop Layout ══ */}
      {!isMobile && (
        <>
          {/* Map — fills right portion */}
          <div className="absolute inset-0" style={{ left: activePanel ? SIDE_MENU_W + SIDE_PANEL_W : SIDE_MENU_W, transition: 'left 0.3s ease' }}>
            <MapView
              pvUsers={pvUsers}
              aggregations={aggregations}
              warnings={warnings}
              weatherSummary={weatherSummary}
              onStreetClick={handleStreetClick}
              selectedStreet={selectedStreet}
              outputRatio={outputRatio}
              showGhiGrid={activePanel === 'load'}
            />
          </div>

          {/* Side menu */}
          <SideMenu activePanel={activePanel} onPanelChange={setActivePanel} warningCount={warnings.length} />

          {/* Side panel */}
          {activePanel && (
            <div className="absolute top-0 bottom-0 z-20 animate-in"
              style={{
                left: SIDE_MENU_W,
                width: SIDE_PANEL_W,
                background: 'var(--bg-panel)',
                borderRight: '1px solid var(--border-subtle)',
              }}>
              {activePanel === 'weather' && (
                <Suspense fallback={null}>
                  <WeatherPanel selectedStreet={selectedStreet} summary={summary} aggregations={aggregations} onClose={() => setActivePanel(null)} />
                </Suspense>
              )}
              {activePanel === 'warnings' && (
                <WarningPanel
                  warnings={warnings}
                  selectedStreet={selectedStreet}
                  onClose={() => setActivePanel(null)}
                  onStreetClick={handleStreetClick}
                />
              )}
              {activePanel === 'history' && (
                <HistoryPanel
                  onClose={() => setActivePanel(null)}
                  onStreetClick={handleStreetClick}
                />
              )}
              {activePanel === 'load' && (
                <section className="h-full flex flex-col">
                  <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-amber)', boxShadow: 'var(--glow-amber)' }} />
                      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
                        负荷预测
                      </h2>
                      <span className="tag-label" style={{ fontSize: 8 }}>GHI网格</span>
                    </div>
                    <button onClick={() => setActivePanel(null)} className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg transition-colors active:scale-95 -mr-2"
                      style={{ color: 'var(--text-muted)', fontSize: 16 }}>
                      <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 pb-4">
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                      <p style={{ marginBottom: 12 }}>
                        GHI空间网格：<strong style={{ color: 'var(--text-bright)' }}>51格</strong>（~2.7km精度）
                      </p>
                      <p style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                        地图上的蜂窝网格显示各区域太阳辐照度(GHI)空间分布。
                        颜色越暖表示GHI越高，光伏出力越大。
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* TopBar — offset for side menu */}
          <div style={{ position: 'absolute', top: 0, left: SIDE_MENU_W, right: 0, zIndex: 30, pointerEvents: 'none' }}>
            <TopBar loading={loading} onRefresh={loadData} />
          </div>
        </>
      )}

      {/* ══ Mobile Layout ══ */}
      {isMobile && (
        <>
          <MapView
            pvUsers={pvUsers}
            aggregations={aggregations}
            warnings={warnings}
            weatherSummary={weatherSummary}
            onStreetClick={handleStreetClick}
            selectedStreet={selectedStreet}
            outputRatio={outputRatio}
          />

          <TopBar loading={loading} onRefresh={loadData} />

          <StatsBar summary={summary} warnings={warnings} selectedStreet={selectedStreet} onStreetClick={handleStreetClick} />

          {/* Mobile bottom sheet for chart */}
          {mobileTab === 'chart' && (
            <div className="absolute bottom-12 left-0 right-0 z-20 sheet-enter"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <div className="bottom-sheet">
                <div className="sheet-handle" />
                {selectedStreet && (
                  <StreetPanel
                    street={selectedStreet}
                    aggregations={aggregations}
                    warnings={warnings}
                    streetPower={streetPower}
                    onClose={() => { setSelectedStreet(null); setMobileTab('map') }}
                    embedded
                  />
                )}
                <Suspense fallback={null}>
                  <PowerChart
                    totalPower={totalPower}
                    streetPower={streetPower}
                    selectedStreet={selectedStreet}
                    onClose={() => setMobileTab('map')}
                    isMobile
                  />
                </Suspense>
              </div>
            </div>
          )}

          {/* Mobile bottom sheet for alerts */}
          {mobileTab === 'alerts' && warnings.length > 0 && (
            <div className="absolute bottom-12 left-0 right-0 z-20 sheet-enter"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <div className="bottom-sheet">
                <div className="sheet-handle" />
                <WarningPanel
                  warnings={warnings}
                  selectedStreet={selectedStreet}
                  onClose={() => setMobileTab('map')}
                  onStreetClick={handleStreetClick}
                  isMobile
                />
              </div>
            </div>
          )}

          <MobileTabBar
            activeTab={mobileTab}
            onTabChange={handleMobileTab}
            warningCount={warnings.length}
            hasChartData={totalPower.length > 0 || streetPower.length > 0}
          />
        </>
      )}
    </main>
  )
}
