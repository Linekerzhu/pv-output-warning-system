import { memo, useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'
import type { WarningRecord } from '../api'

interface OutputEntry {
  time: string
  outputKw: number
  ghi: number
}

interface Props {
  data: OutputEntry[]
  capacityKw: number
  warnings: WarningRecord[]
}

function CustomDot(props: any) {
  const { cx, cy, payload } = props
  if (!payload?._warningLevel) return null
  const isRed = payload._warningLevel === 'red'
  const color = isRed ? '#e06456' : '#dba14a'
  return (
    <g>
      <circle cx={cx} cy={cy} r={isRed ? 4 : 3} fill={color} opacity={0.9}>
        {isRed && <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.5s" repeatCount="indefinite" />}
        {isRed && <animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite" />}
      </circle>
      {isRed && (
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="#e06456">
          ⚠
        </text>
      )}
    </g>
  )
}

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.[0]) return null
  const data = payload[0].payload
  const output = data.output
  const warning = data._warning as WarningRecord | undefined
  const fmtPower = (kw: number) => kw >= 1000 ? `${(kw / 1000).toFixed(1)} MW` : `${kw} kW`

  return (
    <div style={{
      background: 'rgba(14,15,21,0.95)', border: `1px solid ${warning ? (warning.level === 'red' ? '#e06456' : '#dba14a') : 'rgba(219,161,74,0.15)'}`,
      borderRadius: 6, fontFamily: 'var(--font-data)', fontSize: 10,
      color: '#f0ede6', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      padding: '6px 10px', maxWidth: 200,
    }}>
      <div style={{ color: '#78746b', fontSize: 9, marginBottom: 3 }}>{label}</div>
      <div>预测出力 <span style={{ fontWeight: 600 }}>{fmtPower(output)}</span></div>
      {warning && (
        <div style={{
          marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.1)',
          color: warning.level === 'red' ? '#e06456' : '#dba14a',
          fontSize: 9,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {warning.label} · {warning.type === 'ramp_down' ? '↓骤降' : '↑骤增'} {Math.round(warning.change_rate * 100)}%
          </div>
          <div style={{ color: '#b8b3a8' }}>
            {fmtPower(warning.from_power_kw)} → {fmtPower(warning.to_power_kw)}
          </div>
          <div style={{ color: '#78746b' }}>
            {warning.weather_from} → {warning.weather_to} · Δ{Math.round(warning.abs_change_kw)}kW
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(function OutputChart({ data, capacityKw, warnings }: Props) {
  const warningMap = useMemo(() => {
    const m = new Map<string, WarningRecord>()
    warnings.forEach(w => {
      const key = w.from_time.split(' ')[1]?.slice(0, 5) || ''
      if (!m.has(key) || (m.get(key)!.level !== 'red' && w.level === 'red')) {
        m.set(key, w)
      }
    })
    return m
  }, [warnings])

  const chartData = useMemo(() => {
    const dates = [...new Set(data.map(r => r.time.split(' ')[0]))].slice(0, 2)
    const filtered = data.filter(r => dates.includes(r.time.split(' ')[0]))

    const withLabel = filtered.map(r => {
      const hour = r.time.split(' ')[1]?.slice(0, 5) || ''
      const w = warningMap.get(hour)
      return {
        label: hour,
        output: Math.round(r.outputKw),
        _warningLevel: w?.level || null,
        _warning: w || null,
      }
    })

    const hasOutput = withLabel.map(d => d.output > 0)
    return withLabel.filter((_, i) =>
      hasOutput[i] || (i > 0 && hasOutput[i - 1]) || (i < hasOutput.length - 1 && hasOutput[i + 1])
    )
  }, [data, warningMap])

  const warningAreas = useMemo(() => {
    return warnings.map(w => ({
      from: w.from_time.split(' ')[1]?.slice(0, 5) || '',
      to: w.to_time.split(' ')[1]?.slice(0, 5) || '',
      level: w.level,
    }))
  }, [warnings])

  const peakOutput = useMemo(() => Math.max(...chartData.map(d => d.output), 0), [chartData])
  const dailyEnergy = useMemo(() => chartData.reduce((s, d) => s + d.output, 0), [chartData])

  if (chartData.length === 0) return null

  const capLabel = capacityKw >= 1000 ? `${(capacityKw / 1000).toFixed(1)}MW` : `${capacityKw}kW`
  const hasRedWarnings = warnings.some(w => w.level === 'red')
  const hasOrangeWarnings = warnings.some(w => w.level === 'orange' || w.level === 'yellow')

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, color: 'var(--text-bright)' }}>
            出力预测
          </span>
          {hasRedWarnings && (
            <span className="data-value px-1.5 py-0.5" style={{
              fontSize: 8, color: '#e06456', background: 'rgba(224,100,86,0.1)',
              borderRadius: 3, animation: 'pulse-warm 2s ease-in-out infinite',
            }}>
              ⚠ 异常波动
            </span>
          )}
          {!hasRedWarnings && hasOrangeWarnings && (
            <span className="data-value px-1.5 py-0.5" style={{
              fontSize: 8, color: '#dba14a', background: 'rgba(219,161,74,0.1)', borderRadius: 3,
            }}>
              注意波动
            </span>
          )}
        </div>
        <div className="flex gap-3" style={{ fontFamily: 'var(--font-data)', fontSize: 9 }}>
          <span style={{ color: 'var(--text-muted)' }}>
            峰值 <span style={{ color: 'var(--solar-green)', fontWeight: 600 }}>
              {peakOutput >= 1000 ? `${(peakOutput / 1000).toFixed(1)}MW` : `${peakOutput}kW`}
            </span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            日发电 <span style={{ color: 'var(--text-primary)' }}>
              {dailyEnergy >= 1000 ? `${(dailyEnergy / 1000).toFixed(1)}MWh` : `${dailyEnergy}kWh`}
            </span>
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={chartData} margin={{ top: 2, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gOutput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6ec472" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#6ec472" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 8" />
          <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={8} tickLine={false} axisLine={false}
            fontFamily="var(--font-data)" interval={2} />
          <YAxis stroke="var(--text-muted)" fontSize={7} tickLine={false} axisLine={false} width={32}
            fontFamily="var(--font-data)" domain={[0, 'auto']}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}M` : `${v}`} />

          {warningAreas.map((area, i) => (
            <ReferenceArea key={i} x1={area.from} x2={area.to}
              fill={area.level === 'red' ? 'rgba(224,100,86,0.12)' : 'rgba(219,161,74,0.08)'}
              fillOpacity={1} />
          ))}

          <ReferenceLine y={capacityKw} stroke="var(--text-muted)" strokeDasharray="4 4" strokeWidth={0.5}
            label={{ value: `装机${capLabel}`, position: 'right', fill: 'var(--text-muted)', fontSize: 7, fontFamily: 'var(--font-data)' }} />

          <Tooltip content={<CustomTooltipContent />} />

          <Area type="monotone" dataKey="output" name="预测出力"
            stroke="#6ec472" fill="url(#gOutput)" strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ r: 3, fill: '#6ec472' }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div style={{ padding: '1px 10px 3px', fontFamily: 'var(--font-body)', fontSize: 8, color: 'var(--text-muted)' }}>
        出力 = 发电面积 × GHI（基于单晶硅210W/m²面积比功率）
      </div>
    </div>
  )
})
