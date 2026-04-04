import { memo, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { SolarRadiation } from '../api'

interface Props {
  data: SolarRadiation[]
}

export default memo(function RadiationChart({ data }: Props) {
  const chartData = useMemo(() => {
    // Only keep today + tomorrow (first 2 dates)
    const dates = new Set<string>()
    data.forEach(r => dates.add(r.time.split(' ')[0]))
    const allowedDates = [...dates].slice(0, 2)

    const filtered = data.filter(r => {
      const date = r.time.split(' ')[0]
      return allowedDates.includes(date)
    })

    // Only daytime (GHI > 0 with 1h padding)
    const withLabel = filtered.map(r => {
      const hour = r.time.split(' ')[1]?.slice(0, 5) || ''
      return {
        label: hour,
        fullTime: r.time,
        GHI: Math.round(r.ghi),
        DNI: Math.round(r.dni),
        DHI: Math.round(r.dhi),
      }
    })
    const hasRad = withLabel.map(d => d.GHI > 0)
    return withLabel.filter((_, i) =>
      hasRad[i] || (i > 0 && hasRad[i - 1]) || (i < hasRad.length - 1 && hasRad[i + 1])
    )
  }, [data])

  // Find midnight boundary for reference line
  const midnightLabel = useMemo(() => {
    const item = chartData.find(d => d.label === '00:00' || d.label === '05:00' || d.label === '06:00')
    return item?.label || ''
  }, [chartData])

  // Stats per day
  const stats = useMemo(() => {
    const dates = new Set<string>()
    data.forEach(r => dates.add(r.time.split(' ')[0]))
    const allowedDates = [...dates].slice(0, 2)

    return allowedDates.map((date, i) => {
      const dayData = data.filter(r => r.time.split(' ')[0] === date && r.ghi > 0)
      const peak = dayData.length > 0 ? Math.round(Math.max(...dayData.map(r => r.ghi))) : 0
      return { label: i === 0 ? '今天' : '明天', date: date.slice(5).replace('-', '/'), peak }
    })
  }, [data])

  if (chartData.length === 0) return null

  return (
    <div>
      {/* Stats row */}
      <div className="flex items-center justify-between px-3 pb-1" style={{ fontFamily: 'var(--font-data)', fontSize: 9 }}>
        {stats.map(s => (
          <span key={s.date} style={{ color: 'var(--text-muted)' }}>
            {s.label} <span style={{ color: 'var(--solar-gold)', fontWeight: 600 }}>{s.peak}</span> W/m²
          </span>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={chartData} margin={{ top: 2, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gGhi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f5c252" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#f5c252" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 8" />
          <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={8} tickLine={false} axisLine={false}
            fontFamily="var(--font-data)" interval={2} />
          <YAxis stroke="var(--text-muted)" fontSize={7} tickLine={false} axisLine={false} width={28}
            fontFamily="var(--font-data)" domain={[0, 'auto']} />
          <Tooltip
            contentStyle={{
              background: 'rgba(14,15,21,0.95)', border: '1px solid var(--border-warm)',
              borderRadius: 6, fontFamily: 'var(--font-data)', fontSize: 10,
              color: 'var(--text-primary)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              padding: '4px 8px',
            }}
            labelStyle={{ color: 'var(--text-secondary)', fontSize: 9 }}
            formatter={(v) => v != null ? [`${Number(v)} W/m²`] : ['-']}
          />
          {midnightLabel && (
            <ReferenceLine x={midnightLabel} stroke="var(--text-muted)" strokeDasharray="4 4" strokeWidth={0.5}
              label={{ value: '明天', position: 'top', fill: 'var(--text-muted)', fontSize: 8, fontFamily: 'var(--font-data)' }} />
          )}
          <Area type="monotone" dataKey="DHI" name="DHI散射"
            stroke="#52c4b8" fill="none" strokeWidth={0.8} strokeDasharray="3 3" dot={false} opacity={0.4} />
          <Area type="monotone" dataKey="DNI" name="DNI直射"
            stroke="#e06456" fill="none" strokeWidth={1} dot={false} opacity={0.5} />
          <Area type="monotone" dataKey="GHI" name="GHI总辐照"
            stroke="#f5c252" fill="url(#gGhi)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>

      <div style={{
        padding: '1px 10px 3px', fontFamily: 'var(--font-body)', fontSize: 8,
        color: 'var(--text-muted)',
      }}>
        GHI为光伏核心指标（W/m²），越高发电越多
      </div>
    </div>
  )
})
