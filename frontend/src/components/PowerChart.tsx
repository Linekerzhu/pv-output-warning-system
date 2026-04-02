import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { TotalPrediction, PowerPrediction } from '../api'

interface Props {
  totalPower: TotalPrediction[]
  streetPower: PowerPrediction[]
  selectedStreet: string | null
}

export default function PowerChart({ totalPower, streetPower, selectedStreet }: Props) {
  const showStreet = selectedStreet && streetPower.length > 0

  const chartData = showStreet
    ? streetPower.map(p => ({
        time: p.time.split(' ')[1] || p.time,
        predicted: Math.round(p.predicted_power_kw),
        clearsky: Math.round(p.clearsky_ratio * p.predicted_power_kw / Math.max(p.weather_factor, 0.01)),
        weather: p.weather_text,
      }))
    : totalPower.map(p => ({
        time: p.time.split(' ')[1] || p.time,
        predicted: Math.round(p.predicted_power_kw),
        clearsky: Math.round(p.clearsky_power_kw),
      }))

  return (
    <div
      className="rounded-xl p-5 border"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {showStreet ? `${selectedStreet} 出力预测` : '全区出力预测曲线'}
        </h3>
        <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          kW
        </span>
      </div>

      {chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
          <p>暂无预测数据，请先配置天气API并刷新</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorClearsky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorPredicted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2558" />
            <XAxis dataKey="time" stroke="#8892b0" fontSize={12} />
            <YAxis stroke="#8892b0" fontSize={12} />
            <Tooltip
              contentStyle={{ background: '#111638', border: '1px solid #1e2558', borderRadius: 8, color: '#e0e6ff' }}
              labelStyle={{ color: '#8892b0' }}
            />
            <Legend wrapperStyle={{ color: '#8892b0', fontSize: 12 }} />
            <Area
              type="monotone" dataKey="clearsky" name="晴空理论出力"
              stroke="#00d4ff" fill="url(#colorClearsky)" strokeWidth={2}
            />
            <Area
              type="monotone" dataKey="predicted" name="天气预测出力"
              stroke="#00ff88" fill="url(#colorPredicted)" strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
