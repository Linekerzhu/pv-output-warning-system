import { useEffect, useState, useCallback } from 'react'
import { api, PVSummary, TotalPrediction, WarningRecord, StreetAggregation, PowerPrediction, WeatherSummaryItem } from './api'
import MapView from './components/MapView'
import TopBar from './components/TopBar'
import StatsBar from './components/StatsBar'
import PowerChart from './components/PowerChart'
import WarningPanel from './components/WarningPanel'
import StreetPanel from './components/StreetPanel'

export default function App() {
  const [summary, setSummary] = useState<PVSummary | null>(null)
  const [totalPower, setTotalPower] = useState<TotalPrediction[]>([])
  const [warnings, setWarnings] = useState<WarningRecord[]>([])
  const [aggregations, setAggregations] = useState<StreetAggregation[]>([])
  const [selectedStreet, setSelectedStreet] = useState<string | null>(null)
  const [streetPower, setStreetPower] = useState<PowerPrediction[]>([])
  const [weatherSummary, setWeatherSummary] = useState<WeatherSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showChart, setShowChart] = useState(true)
  const [showWarnings, setShowWarnings] = useState(true)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [summaryData, aggData] = await Promise.all([
        api.getSummary(),
        api.getAggregations(),
      ])
      setSummary(summaryData)
      setAggregations(aggData)

      try {
        const [powerData, warningData, weatherData] = await Promise.all([
          api.getTotalPower(),
          api.evaluateWarnings(),
          api.getWeatherSummary(),
        ])
        setTotalPower(powerData)
        setWarnings(warningData.warnings)
        setWeatherSummary(weatherData)
      } catch (e) {
        console.error('天气数据加载失败:', e)
      }
    } catch (e) {
      console.error('数据加载失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleStreetClick = async (street: string) => {
    setSelectedStreet(prev => prev === street ? null : street)
    try {
      const data = await api.getStreetPower(street)
      setStreetPower(data.predictions)
      setShowChart(true)
    } catch {
      setStreetPower([])
    }
  }

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Full-screen map as background */}
      <MapView
        aggregations={aggregations}
        warnings={warnings}
        weatherSummary={weatherSummary}
        onStreetClick={handleStreetClick}
        selectedStreet={selectedStreet}
      />

      {/* Top bar - floating */}
      <TopBar loading={loading} onRefresh={loadData} />

      {/* Stats bar - bottom left */}
      <StatsBar summary={summary} warnings={warnings} />

      {/* Power chart - bottom center */}
      {showChart && (
        <PowerChart
          totalPower={totalPower}
          streetPower={streetPower}
          selectedStreet={selectedStreet}
          onClose={() => setShowChart(false)}
        />
      )}

      {/* Warning panel - right side */}
      {showWarnings && warnings.length > 0 && (
        <WarningPanel
          warnings={warnings}
          onClose={() => setShowWarnings(false)}
          onStreetClick={handleStreetClick}
        />
      )}

      {/* Street detail panel - left side */}
      {selectedStreet && (
        <StreetPanel
          street={selectedStreet}
          aggregations={aggregations}
          warnings={warnings}
          streetPower={streetPower}
          onClose={() => setSelectedStreet(null)}
        />
      )}

      {/* Toggle buttons */}
      <div className="absolute bottom-5 right-5 flex gap-2 z-20">
        {!showChart && (
          <button onClick={() => setShowChart(true)} className="glass-panel px-3 py-2 text-xs cursor-pointer" style={{ color: 'var(--accent-cyan)' }}>
            出力曲线
          </button>
        )}
        {!showWarnings && warnings.length > 0 && (
          <button onClick={() => setShowWarnings(true)} className="glass-panel px-3 py-2 text-xs cursor-pointer" style={{ color: 'var(--accent-orange)' }}>
            预警 ({warnings.length})
          </button>
        )}
      </div>
    </div>
  )
}
