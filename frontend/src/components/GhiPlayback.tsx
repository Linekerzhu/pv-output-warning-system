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
  ratio: number
  userCount: number
}

const PR = 0.80

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function frameAvg(f: Frame): number {
  if (f.grids.length === 0) return 0
  return f.grids.reduce((s, g) => s + g.ghi, 0) / f.grids.length
}

function smoothPoints(raw: { x: number; y: number }[]): string {
  if (raw.length < 3) return `M${raw.map(p => `${p.x},${p.y}`).join(' L')}`
  let d = `M${raw[0].x},${raw[0].y}`
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[Math.max(0, i - 1)]
    const p1 = raw[i]
    const p2 = raw[i + 1]
    const p3 = raw[Math.min(raw.length - 1, i + 2)]
    d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`
  }
  return d
}

/** GHI-consistent color: low=blue, mid=green-yellow, high=warm orange */
function ratioColor(r: number): string {
  if (r <= 0) return 'rgba(255,255,255,0.06)'
  if (r < 0.3) {
    const s = r / 0.3
    return `rgb(${Math.round(25 + 60 * s)},${Math.round(50 + 120 * s)},${Math.round(130 - 30 * s)})`
  }
  if (r < 0.6) {
    const s = (r - 0.3) / 0.3
    return `rgb(${Math.round(85 + 130 * s)},${Math.round(170 + 30 * s)},${Math.round(100 - 60 * s)})`
  }
  const s = (r - 0.6) / 0.4
  return `rgb(${Math.round(215 + 40 * s)},${Math.round(200 - 100 * s)},${Math.round(40 - 20 * s)})`
}

interface Props {
  onFrameChange: (ghiMap: Map<string, number>, label: string) => void
  onClose: () => void
  pvUsers: PVUser[]
}

export default function GhiPlayback({ onFrameChange, onClose, pvUsers }: Props) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)) // default TODAY
  const [frames, setFrames] = useState<Frame[]>([])
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const prevRanksRef = useRef<Map<string, number>>(new Map())
  const timerRef = useRef<number>(0)
  const today = new Date().toISOString().slice(0, 10)

  const loadDate = useCallback(async (d: string) => {
    setLoading(true)
    setPlaying(false)
    prevRanksRef.current = new Map()
    try {
      const data = await fetchJSON<FrameData>(`/satellite/ghi/frames?date=${d}`)
      setFrames(data.frames)
      // Default to latest frame (not first)
      const startIdx = Math.max(0, data.frames.length - 1)
      setFrameIdx(startIdx)
      if (data.frames.length > 0) {
        const m = new Map<string, number>()
        for (const g of data.frames[startIdx].grids) m.set(g.grid_id, g.ghi)
        onFrameChange(m, `${d} ${data.frames[startIdx].time}`)
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

  const curveData = useMemo(() =>
    frames.map((f, i) => ({
      x: (i / Math.max(1, frames.length - 1)) * 320,
      y: 95 - (frameAvg(f) / 1000) * 90,
    })), [frames])

  const curvePath = useMemo(() => smoothPoints(curveData), [curveData])
  const fillPath = useMemo(() => {
    if (curveData.length < 2) return ''
    return curvePath + ` L${curveData[curveData.length - 1].x},95 L${curveData[0].x},95 Z`
  }, [curvePath, curveData])

  // Compute substation power
  const substationPower = useMemo((): SubstationPower[] => {
    const frame = frames[frameIdx]
    if (!frame || pvUsers.length === 0) return []

    const ghiMap = new Map(frame.grids.map(g => [g.grid_id, g.ghi]))
    const ssMap = new Map<string, { power: number; capacity: number; count: number }>()
    for (const ss of SUBSTATIONS) ssMap.set(ss.id, { power: 0, capacity: 0, count: 0 })

    for (const u of pvUsers) {
      if (!u.substation_id || !u.grid_id || u.status !== '运行') continue
      const ghi = ghiMap.get(u.grid_id) ?? 0
      const power = u.capacity_kw * ghi / 1000 * PR
      const ss = ssMap.get(u.substation_id)
      if (ss) { ss.power += power; ss.capacity += u.capacity_kw; ss.count++ }
    }

    const result = SUBSTATIONS
      .map(ss => {
        const d = ssMap.get(ss.id) || { power: 0, capacity: 0, count: 0 }
        return {
          id: ss.id, name: ss.name,
          power_kw: Math.round(d.power),
          capacity_kw: Math.round(d.capacity),
          ratio: d.capacity > 0 ? d.power / d.capacity : 0,
          userCount: d.count,
        }
      })
      .filter(s => s.capacity_kw > 0)

    // Sort: by actual power when generating, by capacity when idle
    const hasOutput = result.some(s => s.power_kw > 0)
    if (hasOutput) {
      result.sort((a, b) => b.power_kw - a.power_kw)
    } else {
      result.sort((a, b) => b.capacity_kw - a.capacity_kw)
    }

    return result
  }, [frameIdx, frames, pvUsers])

  // Compute rank changes
  const rankChanges = useMemo(() => {
    const changes = new Map<string, number>() // positive = moved up
    const currentRanks = new Map(substationPower.map((ss, i) => [ss.id, i]))

    if (prevRanksRef.current.size > 0) {
      for (const [id, newRank] of currentRanks) {
        const oldRank = prevRanksRef.current.get(id)
        if (oldRank !== undefined && oldRank !== newRank) {
          changes.set(id, oldRank - newRank) // positive = moved up (rank decreased)
        }
      }
    }

    prevRanksRef.current = currentRanks
    return changes
  }, [substationPower])

  const districtTotal = useMemo(() => {
    const power = substationPower.reduce((s, ss) => s + ss.power_kw, 0)
    const capacity = substationPower.reduce((s, ss) => s + ss.capacity_kw, 0)
    return { power, capacity, ratio: capacity > 0 ? power / capacity : 0 }
  }, [substationPower])

  const frame = frames[frameIdx]
  const canPrev = date > '2026-04-01'
  const canNext = date < today

  const btnStyle = {
    background: 'var(--bg-surface)', border: 'none', color: 'var(--text-bright)',
    borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
    fontFamily: 'var(--font-data)', fontSize: 12,
  } as const

  return (
    <section className="h-full flex flex-col" style={{ overflow: 'hidden' }}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-amber)', boxShadow: 'var(--glow-amber)' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
            出力观测
          </h2>
          <span className="tag-label" style={{ fontSize: 8 }}>HIMAWARI-9</span>
        </div>
        <button onClick={onClose} className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg active:scale-95 -mr-2"
          style={{ color: 'var(--text-muted)', fontSize: 16, background: 'none', border: 'none' }}>
          <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-3">
          {/* Date picker */}
          <div className="flex items-center gap-2">
            <button onClick={() => canPrev && setDate(shiftDate(date, -1))} disabled={!canPrev}
              style={{ ...btnStyle, opacity: canPrev ? 1 : 0.3, padding: '4px 8px', fontSize: 14 }}>◀</button>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} max={today} min="2026-04-01"
              style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-bright)', fontFamily: 'var(--font-data)', fontSize: 11, textAlign: 'center' }} />
            <button onClick={() => canNext && setDate(shiftDate(date, 1))} disabled={!canNext}
              style={{ ...btnStyle, opacity: canNext ? 1 : 0.3, padding: '4px 8px', fontSize: 14 }}>▶</button>
          </div>

          {loading && <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>加载中...</div>}

          {!loading && frames.length === 0 && <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>该日期无卫星数据</div>}

          {frames.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 20, fontWeight: 600, color: 'var(--text-bright)', textAlign: 'center' }}>
                {frame?.time || '--:--'}
              </div>

              <input type="range" min={0} max={frames.length - 1} value={frameIdx}
                onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)) }}
                style={{ width: '100%', accentColor: 'var(--solar-amber)' }} />

              <div className="flex items-center justify-center gap-3">
                <button onClick={() => setFrameIdx(Math.max(0, frameIdx - 1))} style={btnStyle}>◀</button>
                <button onClick={() => setPlaying(!playing)}
                  style={{ ...btnStyle, background: playing ? 'var(--solar-coral)' : 'var(--solar-amber)', color: '#000', padding: '6px 16px', fontWeight: 600 }}>
                  {playing ? '⏸' : '▶ 播放'}</button>
                <button onClick={() => setFrameIdx(Math.min(frames.length - 1, frameIdx + 1))} style={btnStyle}>▶</button>
              </div>

              {frame && (
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {frame.grids.length} 格 | 均值 {Math.round(frameAvg(frame))} W/m² | 峰值 {Math.max(0, ...frame.grids.map(g => g.ghi))} W/m²
                </div>
              )}

              {/* GHI Curve */}
              <div style={{ marginTop: 4 }}>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>日 GHI 曲线 (区均值 W/m²)</div>
                <svg width="100%" height="100" viewBox="0 0 320 100" preserveAspectRatio="none">
                  {[25, 50, 75].map(y => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="rgba(255,255,255,0.06)" />)}
                  <text x="2" y="28" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="Fira Code">750</text>
                  <text x="2" y="53" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="Fira Code">500</text>
                  <text x="2" y="78" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="Fira Code">250</text>
                  {fillPath && <path d={fillPath} fill="rgba(219,161,74,0.12)" />}
                  <path d={curvePath} fill="none" stroke="#dba14a" strokeWidth="1.5" />
                  {curveData[frameIdx] && <>
                    <line x1={curveData[frameIdx].x} y1="0" x2={curveData[frameIdx].x} y2="95" stroke="#dba14a" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.6" />
                    <circle cx={curveData[frameIdx].x} cy={curveData[frameIdx].y} r="3" fill="#dba14a" />
                  </>}
                  {frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 8)) === 0).map(f => {
                    const idx = frames.indexOf(f)
                    return <text key={f.time} x={(idx / Math.max(1, frames.length - 1)) * 320} y="100" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="Fira Code" textAnchor="middle">{f.time}</text>
                  })}
                </svg>
              </div>

              {/* Substation Dot Matrix */}
              {substationPower.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>金山区总出力</span>
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 700, color: 'var(--solar-amber)' }}>
                      {(districtTotal.power / 1000).toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400 }}> MW</span>
                      <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>/ {(districtTotal.capacity / 1000).toFixed(1)} MW</span>
                    </span>
                  </div>

                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>出力构成 · 1格=500kW</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {substationPower.map((ss) => {
                      const dotUnit = 500
                      const totalDots = Math.max(1, Math.round(ss.capacity_kw / dotUnit))
                      const litDots = Math.round(ss.power_kw / dotUnit)
                      const dc = ratioColor(ss.ratio)
                      const rankDelta = rankChanges.get(ss.id) || 0

                      return (
                        <div key={ss.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', width: 32, flexShrink: 0, textAlign: 'right' }}>
                            {ss.name.replace('变电站', '')}
                          </span>
                          {/* Rank change arrow */}
                          <span style={{ width: 10, fontSize: 8, textAlign: 'center', flexShrink: 0 }}>
                            {rankDelta > 0 && <span style={{ color: '#e06456' }}>▲</span>}
                            {rankDelta < 0 && <span style={{ color: '#6ec472' }}>▼</span>}
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, flex: 1 }}>
                            {Array.from({ length: totalDots }, (_, i) => (
                              <div key={i} style={{
                                width: 6, height: 6, borderRadius: 1.5,
                                background: i < litDots ? dc : 'rgba(255,255,255,0.06)',
                                transition: 'background 0.3s ease',
                              }} />
                            ))}
                          </div>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--text-muted)', width: 30, textAlign: 'right', flexShrink: 0 }}>
                            {(ss.power_kw / 1000).toFixed(1)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
