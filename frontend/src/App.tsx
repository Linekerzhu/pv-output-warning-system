import { useEffect, useState, useCallback } from 'react'
import { api, PVSummary, TotalPrediction, WarningRecord, StreetAggregation, PowerPrediction } from './api'
import Header from './components/Header'
import StatsCards from './components/StatsCards'
import PowerChart from './components/PowerChart'
import WarningPanel from './components/WarningPanel'
import StreetTable from './components/StreetTable'
import MapView from './components/MapView'

export default function App() {
  const [summary, setSummary] = useState<PVSummary | null>(null)
  const [totalPower, setTotalPower] = useState<TotalPrediction[]>([])
  const [warnings, setWarnings] = useState<WarningRecord[]>([])
  const [aggregations, setAggregations] = useState<StreetAggregation[]>([])
  const [selectedStreet, setSelectedStreet] = useState<string | null>(null)
  const [streetPower, setStreetPower] = useState<PowerPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [summaryData, aggData] = await Promise.all([
        api.getSummary(),
        api.getAggregations(),
      ])
      setSummary(summaryData)
      setAggregations(aggData)

      // These may fail if weather API is not configured yet
      try {
        const [powerData, warningData] = await Promise.all([
          api.getTotalPower(),
          api.evaluateWarnings(),
        ])
        setTotalPower(powerData)
        setWarnings(warningData.warnings)
      } catch {
        // Weather API not available, show empty
        setTotalPower([])
        setWarnings([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleStreetClick = async (street: string) => {
    setSelectedStreet(street)
    try {
      const data = await api.getStreetPower(street)
      setStreetPower(data.predictions)
    } catch {
      setStreetPower([])
    }
  }

  const warningCount = {
    red: warnings.filter(w => w.level === 'red').length,
    orange: warnings.filter(w => w.level === 'orange').length,
    yellow: warnings.filter(w => w.level === 'yellow').length,
    blue: warnings.filter(w => w.level === 'blue').length,
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Header onRefresh={loadData} loading={loading} />

      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
          {error}
        </div>
      )}

      <main className="p-6 space-y-6">
        <StatsCards
          summary={summary}
          warningCount={warningCount}
          totalPowerNow={totalPower.length > 0 ? totalPower[Math.floor(totalPower.length / 2)]?.predicted_power_kw : 0}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PowerChart
              totalPower={totalPower}
              streetPower={streetPower}
              selectedStreet={selectedStreet}
            />
          </div>
          <div>
            <WarningPanel warnings={warnings} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MapView
            aggregations={aggregations}
            warnings={warnings}
            onStreetClick={handleStreetClick}
            selectedStreet={selectedStreet}
          />
          <StreetTable
            aggregations={aggregations}
            warnings={warnings}
            onStreetClick={handleStreetClick}
            selectedStreet={selectedStreet}
          />
        </div>
      </main>
    </div>
  )
}
