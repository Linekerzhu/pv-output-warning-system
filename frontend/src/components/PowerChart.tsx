import { memo, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { TotalPrediction, PowerPrediction } from '../api'
import { DAY_COLORS_RAW } from '../tokens'

interface Props {
  totalPower: TotalPrediction[]
  streetPower: PowerPrediction[]
  selectedStreet: string | null
  onClose: () => void
  isMobile?: boolean
  sidePanel?: boolean
}

function getShanghaiHour(): string {
  const now = new Date()
  const h = parseInt(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }))
  return `${h.toString().padStart(2, '0')}:00`
}

interface DayData {
  date: string
  dateLabel: string
  data: { hour: string; clearsky: number; predicted: number }[]
  nowHour: string
}

function buildDayCharts(
  totalPower: TotalPrediction[],
  streetPower: PowerPrediction[],
  selectedStreet: string | null,
): DayData[] {
  const showStreet = selectedStreet && streetPower.length > 0
  const raw = showStreet
    ? streetPower.map(p => ({
        date: p.time.split(' ')[0],
        hour: p.time.split(' ')[1]?.slice(0, 5) || p.time,
        predicted: Math.round(p.power_kw),
        clearsky: Math.round(p.clearsky_power_kw),
      }))
    : totalPower.map(p => ({
        date: p.time.split(' ')[0],
        hour: p.time.split(' ')[1]?.slice(0, 5) || p.time,
        predicted: Math.round(p.predicted_power_kw),
        clearsky: Math.round(p.clearsky_power_kw),
      }))

  if (raw.length === 0) return []

  const dates = [...new Set(raw.map(r => r.date))]
  const nowHour = getShanghaiHour()

  return dates.map(d => ({
    date: d,
    dateLabel: d.slice(5).replace('-', '/'),
    data: raw.filter(r => r.date === d),
    nowHour,
  }))
}

const COLORS = DAY_COLORS_RAW

function DayChart({ day, dayIndex, height, isCompact }: { day: DayData; dayIndex: number; height: number; isCompact: boolean }) {
  const c = COLORS[dayIndex] || COLORS[0]
  const isToday = dayIndex === 0

  return (
    <div>
      <div className="flex items-center justify-between px-4 pb-1">
        <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--text-bright)', fontWeight: 500 }}>{isToday ? '今天' : '明天'} {day.dateLabel}</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: c.clearsky }} />晴空
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: c.predicted }} />预测
          </span>
        </div>
      </div>
      <div className="px-1" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={day.data} margin={{ top: 4, right: 8, bottom: 0, left: isCompact ? -20 : -10 }}>
            <defs>
              <linearGradient id={`gCs${dayIndex}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.clearsky} stopOpacity={0.15} />
                <stop offset="100%" stopColor={c.clearsky} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 8" />
            <XAxis dataKey="hour" stroke="var(--text-muted)" fontSize={8} tickLine={false} axisLine={false}
              fontFamily="var(--font-data)" interval={isCompact ? 2 : 1} />
            <YAxis stroke="var(--text-muted)" fontSize={8} tickLine={false} axisLine={false} width={isCompact ? 32 : 40}
              fontFamily="var(--font-data)" tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`} />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-panel)', border: '1px solid var(--border-warm)',
                borderRadius: 8, fontFamily: 'var(--font-data)', fontSize: 10,
                color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}
              labelStyle={{ color: 'var(--text-secondary)', fontSize: 9 }}
              formatter={(v) => v != null ? [`${Number(v).toLocaleString()} kW`] : ['-']}
            />
            {isToday && (
              <ReferenceLine x={day.nowHour} stroke="#dba14a" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: '当前', position: 'top', fill: '#dba14a', fontSize: 8, fontFamily: 'var(--font-data)' }} />
            )}
            <Area type="monotone" dataKey="clearsky" name="晴空出力"
              stroke={c.clearsky} fill={`url(#gCs${dayIndex})`} strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="predicted" name="预测出力"
              stroke={c.predicted} fill="none" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default memo(function PowerChart({ totalPower, streetPower, selectedStreet, onClose, isMobile, sidePanel }: Props) {
  const days = useMemo(() => buildDayCharts(totalPower, streetPower, selectedStreet), [totalPower, streetPower, selectedStreet])
  const isEmpty = days.length === 0
  const title = selectedStreet || '全区总出力'

  // Side panel mode: stacked charts, full height
  if (sidePanel) {
    return (
      <section aria-label={`${title} 出力预测`} className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-amber)', boxShadow: 'var(--glow-amber)' }} />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
              {title}
            </h2>
            <span className="tag-label" style={{ fontSize: 8 }}>出力预测</span>
          </div>
          <button onClick={onClose} aria-label="关闭出力面板" className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg transition-colors active:scale-95 -mr-2"
            style={{ color: 'var(--text-muted)', fontSize: 16 }}>
            <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-3">
          {isEmpty ? (
            <div className="h-32 flex items-center justify-center" style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)' }}>
              等待数据...
            </div>
          ) : (
            <div className="space-y-4">
              {days.map((day, i) => (
                <DayChart key={day.date} day={day} dayIndex={i} height={180} isCompact />
              ))}
            </div>
          )}
        </div>
      </section>
    )
  }

  // Mobile / floating mode (legacy)
  return (
    <section aria-label={`${title} 出力预测`} className={isMobile ? '' : 'absolute z-20 glass-panel animate-in bottom-4 left-1/2 -translate-x-1/2'}
      style={isMobile ? {} : { width: 'min(700px, calc(100vw - 360px))', animationDelay: '0.1s' }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-amber)', boxShadow: 'var(--glow-amber)' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
            {title}
          </h2>
          <span className="tag-label" style={{ fontSize: 8 }}>出力预测</span>
        </div>
      </div>
      <div className="px-1 pb-3" style={{ height: isMobile ? 160 : 180 }}>
        {isEmpty ? (
          <div className="h-full flex items-center justify-center" style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)' }}>
            等待数据...
          </div>
        ) : days.length > 0 && (
          <DayChart day={days[0]} dayIndex={0} height={isMobile ? 150 : 170} isCompact={!!isMobile} />
        )}
      </div>
    </section>
  )
})
