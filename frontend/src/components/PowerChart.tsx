import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { TotalPrediction, PowerPrediction } from '../api'

interface Props {
  totalPower: TotalPrediction[]
  streetPower: PowerPrediction[]
  selectedStreet: string | null
  onClose: () => void
}

export default function PowerChart({ totalPower, streetPower, selectedStreet, onClose }: Props) {
  const showStreet = selectedStreet && streetPower.length > 0

  const chartData = showStreet
    ? streetPower.map(p => ({
        time: p.time.split(' ')[1]?.slice(0, 5) || p.time,
        predicted: Math.round(p.predicted_power_kw),
        clearsky: Math.round(p.clearsky_ratio * p.predicted_power_kw / Math.max(p.weather_factor, 0.01)),
        weather: p.weather_text,
      }))
    : totalPower.map(p => ({
        time: p.time.split(' ')[1]?.slice(0, 5) || p.time,
        predicted: Math.round(p.predicted_power_kw),
        clearsky: Math.round(p.clearsky_power_kw),
      }))

  const isEmpty = chartData.length === 0

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 glass-panel"
      style={{ width: 'min(600px, calc(100vw - 400px))' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full" style={{ background: 'var(--accent-cyan)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {showStreet ? `${selectedStreet}` : '全区'} 出力预测
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 rounded" style={{ background: '#00e5ff' }} />
              晴空理论
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 rounded" style={{ background: '#00e676' }} />
              天气预测
            </span>
          </div>
          <button onClick={onClose} className="text-sm cursor-pointer px-1" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 pb-3" style={{ height: 160 }}>
        {isEmpty ? (
          <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
            加载中...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="gClearsky" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#00e5ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gPredicted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00e676" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#00e676" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#555770" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#555770" fontSize={10} tickLine={false} axisLine={false} width={40}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
              <Tooltip
                contentStyle={{
                  background: 'rgba(12,14,24,0.95)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, fontSize: 11, color: '#f0f0f5', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}
                labelStyle={{ color: '#8b8fa3', fontSize: 10 }}
                formatter={(v) => [`${Number(v).toLocaleString()} kW`]}
              />
              <Area type="monotone" dataKey="clearsky" name="晴空理论"
                stroke="#00e5ff" fill="url(#gClearsky)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="predicted" name="天气预测"
                stroke="#00e676" fill="url(#gPredicted)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
