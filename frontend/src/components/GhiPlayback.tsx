import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { fetchJSON, type PVUser } from '../api'
import { SUBSTATIONS } from '../data/substations'

interface Frame {
  time: string
  grids: { grid_id: string; ghi: number; is_valid: boolean }[]
}

interface FrameData {
  date: string
  frames: Frame[]
}

interface SubstationPower {
  id: string
  name: string
  power_kw: number
  capacity_kw: number
  ratio: number // power / capacity
  userCount: number
}

const PR = 0.80

interface Props {
  onFrameChange: (ghiMap: Map<string, number>, label: string) => void
  onClose: () => void
  pvUsers: PVUser[]
}

/** Shift a date string by N days */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Compute avg GHI per frame */
function frameAvg(f: Frame): number {
  if (f.grids.length === 0) return 0
  return f.grids.reduce((s, g) => s + g.ghi, 0) / f.grids.length
}

/** Catmull-Rom spline interpolation for smooth curve */
function smoothPoints(raw: { x: number; y: number }[]): string {
  if (raw.length < 3) return raw.map(p => `${p.x},${p.y}`).join(' ')

  const pts: string[] = []
  for (let i = 0; i < raw.length; i++) {
    pts.push(`${raw[i].x},${raw[i].y}`)
  }

  // Build SVG cubic bezier path for smooth curve
  let d = `M${raw[0].x},${raw[0].y}`
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[Math.max(0, i - 1)]
    const p1 = raw[i]
    const p2 = raw[i + 1]
    const p3 = raw[Math.min(raw.length - 1, i + 2)]

    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}

export default function GhiPlayback({ onFrameChange, onClose, pvUsers }: Props) {
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [frames, setFrames] = useState<Frame[]>([])
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<number>(0)
  const today = new Date().toISOString().slice(0, 10)

  const loadDate = useCallback(async (d: string) => {
    setLoading(true)
    setPlaying(false)
    try {
      const data = await fetchJSON<FrameData>(`/satellite/ghi/frames?date=${d}`)
      setFrames(data.frames)
      setFrameIdx(0)
      if (data.frames.length > 0) {
        const m = new Map<string, number>()
        for (const g of data.frames[0].grids) m.set(g.grid_id, g.ghi)
        onFrameChange(m, `${d} ${data.frames[0].time}`)
      }
    } catch {
      setFrames([])
    }
    setLoading(false)
  }, [onFrameChange])

  useEffect(() => { loadDate(date) }, [date, loadDate])

  useEffect(() => {
    if (frames.length === 0) return
    const frame = frames[frameIdx]
    const m = new Map<string, number>()
    for (const g of frame.grids) m.set(g.grid_id, g.ghi)
    onFrameChange(m, `${date} ${frame.time}`)
  }, [frameIdx, frames, date, onFrameChange])

  useEffect(() => {
    if (!playing || frames.length === 0) return
    timerRef.current = window.setInterval(() => {
      setFrameIdx(i => {
        if (i >= frames.length - 1) { setPlaying(false); return i }
        return i + 1
      })
    }, 600)
    return () => clearInterval(timerRef.current)
  }, [playing, frames.length])

  // Smooth curve data points
  const curveData = useMemo(() =>
    frames.map((f, i) => ({
      x: (i / Math.max(1, frames.length - 1)) * 320,
      y: 95 - (frameAvg(f) / 1000) * 90,
    })),
    [frames]
  )

  const curvePath = useMemo(() => smoothPoints(curveData), [curveData])

  // Fill path for area under curve
  const fillPath = useMemo(() => {
    if (curveData.length < 2) return ''
    return curvePath + ` L${curveData[curveData.length - 1].x},95 L${curveData[0].x},95 Z`
  }, [curvePath, curveData])

  const frame = frames[frameIdx]
  const canPrev = date > '2026-04-01'
  const canNext = date < today

  // Compute power per substation from current frame's GHI
  const substationPower = useMemo((): SubstationPower[] => {
    if (!frame || pvUsers.length === 0) return []

    const ghiMap = new Map(frame.grids.map(g => [g.grid_id, g.ghi]))
    const ssMap = new Map<string, { power: number; capacity: number; count: number }>()

    // Init all substations
    for (const ss of SUBSTATIONS) {
      ssMap.set(ss.id, { power: 0, capacity: 0, count: 0 })
    }

    // Aggregate per user
    for (const u of pvUsers) {
      if (!u.substation_id || !u.grid_id || u.status !== '运行') continue
      const ghi = ghiMap.get(u.grid_id) ?? 0
      const power = u.capacity_kw * ghi / 1000 * PR
      const ss = ssMap.get(u.substation_id)
      if (ss) {
        ss.power += power
        ss.capacity += u.capacity_kw
        ss.count++
      }
    }

    return SUBSTATIONS
      .map(ss => {
        const d = ssMap.get(ss.id) || { power: 0, capacity: 0, count: 0 }
        return {
          id: ss.id,
          name: ss.name,
          power_kw: Math.round(d.power),
          capacity_kw: Math.round(d.capacity),
          ratio: d.capacity > 0 ? d.power / d.capacity : 0,
          userCount: d.count,
        }
      })
      .filter(s => s.capacity_kw > 0)
      .sort((a, b) => b.power_kw - a.power_kw)
  }, [frame, pvUsers])

  const districtTotal = useMemo(() => {
    const power = substationPower.reduce((s, ss) => s + ss.power_kw, 0)
    const capacity = substationPower.reduce((s, ss) => s + ss.capacity_kw, 0)
    return { power, capacity, ratio: capacity > 0 ? power / capacity : 0 }
  }, [substationPower])

  const btnStyle = {
    background: 'var(--bg-surface)', border: 'none', color: 'var(--text-bright)',
    borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
    fontFamily: 'var(--font-data)', fontSize: 12,
  }

  return (
    <section className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-amber)', boxShadow: 'var(--glow-amber)' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
            负荷观测
          </h2>
          <span className="tag-label" style={{ fontSize: 8 }}>HIMAWARI-9</span>
        </div>
        <button onClick={onClose} className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg active:scale-95 -mr-2"
          style={{ color: 'var(--text-muted)', fontSize: 16, background: 'none', border: 'none' }}>
          <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
        </button>
      </div>

      <div className="px-4 pb-4 flex flex-col gap-3">
        {/* Date picker with prev/next */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => canPrev && setDate(shiftDate(date, -1))}
            disabled={!canPrev}
            style={{ ...btnStyle, opacity: canPrev ? 1 : 0.3, padding: '4px 8px', fontSize: 14 }}
          >◀</button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={today}
            min="2026-04-01"
            style={{
              flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
              borderRadius: 6, padding: '4px 8px', color: 'var(--text-bright)',
              fontFamily: 'var(--font-data)', fontSize: 11, textAlign: 'center',
            }}
          />
          <button
            onClick={() => canNext && setDate(shiftDate(date, 1))}
            disabled={!canNext}
            style={{ ...btnStyle, opacity: canNext ? 1 : 0.3, padding: '4px 8px', fontSize: 14 }}
          >▶</button>
        </div>

        {loading && (
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            加载中...
          </div>
        )}

        {!loading && frames.length === 0 && (
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            该日期无卫星数据
          </div>
        )}

        {frames.length > 0 && (
          <>
            {/* Time display */}
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 20, fontWeight: 600, color: 'var(--text-bright)', textAlign: 'center' }}>
              {frame?.time || '--:--'}
            </div>

            {/* Slider */}
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={frameIdx}
              onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)) }}
              style={{ width: '100%', accentColor: 'var(--solar-amber)' }}
            />

            {/* Play controls */}
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setFrameIdx(Math.max(0, frameIdx - 1))} style={btnStyle}>◀</button>
              <button
                onClick={() => setPlaying(!playing)}
                style={{ ...btnStyle, background: playing ? 'var(--solar-coral)' : 'var(--solar-amber)', color: '#000', padding: '6px 16px', fontWeight: 600 }}
              >{playing ? '⏸' : '▶ 播放'}</button>
              <button onClick={() => setFrameIdx(Math.min(frames.length - 1, frameIdx + 1))} style={btnStyle}>▶</button>
            </div>

            {/* Stats */}
            {frame && (
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
                {frame.grids.length} 格 | 均值 {Math.round(frameAvg(frame))} W/m²
                | 峰值 {Math.max(0, ...frame.grids.map(g => g.ghi))} W/m²
              </div>
            )}

            {/* GHI Day Curve — smooth Catmull-Rom spline */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>
                日 GHI 曲线 (区均值 W/m²)
              </div>
              <svg width="100%" height="100" viewBox="0 0 320 100" preserveAspectRatio="none">
                {/* Grid */}
                {[25, 50, 75].map(y => (
                  <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="rgba(255,255,255,0.06)" />
                ))}
                <text x="2" y="28" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="Fira Code">750</text>
                <text x="2" y="53" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="Fira Code">500</text>
                <text x="2" y="78" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="Fira Code">250</text>

                {/* Smooth fill */}
                {fillPath && <path d={fillPath} fill="rgba(219,161,74,0.12)" />}

                {/* Smooth curve */}
                <path d={curvePath} fill="none" stroke="#dba14a" strokeWidth="1.5" />

                {/* Current position */}
                {curveData.length > 0 && (
                  <>
                    <line
                      x1={curveData[frameIdx]?.x ?? 0} y1="0"
                      x2={curveData[frameIdx]?.x ?? 0} y2="95"
                      stroke="#dba14a" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.6"
                    />
                    <circle
                      cx={curveData[frameIdx]?.x ?? 0}
                      cy={curveData[frameIdx]?.y ?? 95}
                      r="3" fill="#dba14a"
                    />
                  </>
                )}

                {/* X labels — evenly spaced */}
                {frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 8)) === 0).map((f) => {
                  const idx = frames.indexOf(f)
                  const x = (idx / Math.max(1, frames.length - 1)) * 320
                  return <text key={f.time} x={x} y="100" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="Fira Code" textAnchor="middle">{f.time}</text>
                })}
              </svg>
            </div>
            {/* Substation Power Topology */}
            {substationPower.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {/* District total */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 8, paddingBottom: 6,
                  borderBottom: '1px solid var(--border-subtle)',
                }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>
                    金山区总出力
                  </span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 700, color: 'var(--solar-amber)' }}>
                    {districtTotal.power >= 1000
                      ? `${(districtTotal.power / 1000).toFixed(1)} MW`
                      : `${districtTotal.power} kW`}
                    <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
                      / {(districtTotal.capacity / 1000).toFixed(1)} MW
                    </span>
                  </span>
                </div>

                {/* Substation list */}
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>
                  变电站出力构成
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {substationPower.map(ss => (
                    <div key={ss.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {/* Name */}
                      <span style={{
                        fontFamily: 'var(--font-data)', fontSize: 10,
                        color: 'var(--text-secondary)', width: 58, flexShrink: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ss.name.replace('变电站', '')}
                      </span>
                      {/* Bar */}
                      <div style={{
                        flex: 1, height: 10, borderRadius: 3,
                        background: 'var(--bg-surface)', overflow: 'hidden',
                        position: 'relative',
                      }}>
                        <div style={{
                          width: `${Math.min(100, ss.ratio * 100)}%`,
                          height: '100%', borderRadius: 3,
                          background: ss.ratio > 0.6 ? '#6ec472'
                            : ss.ratio > 0.3 ? '#dba14a'
                            : ss.ratio > 0 ? '#e06456'
                            : 'transparent',
                          opacity: 0.7,
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                      {/* Power value */}
                      <span style={{
                        fontFamily: 'var(--font-data)', fontSize: 9,
                        color: ss.power_kw > 0 ? 'var(--text-bright)' : 'var(--text-muted)',
                        width: 48, textAlign: 'right', flexShrink: 0,
                      }}>
                        {ss.power_kw >= 1000
                          ? `${(ss.power_kw / 1000).toFixed(1)}MW`
                          : `${ss.power_kw}kW`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
