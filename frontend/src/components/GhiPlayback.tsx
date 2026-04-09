import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { fetchJSON, type PVUser } from '../api'
import { SUBSTATIONS } from '../data/substations'
import PanelHeader from './ui/PanelHeader'
import IconButton from './ui/IconButton'
import PrimaryButton from './ui/PrimaryButton'

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

export default memo(function GhiPlayback({ onFrameChange, onClose, pvUsers }: Props) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
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

  // Chart layout: viewBox 320×120, plot area 0-95 (Y), labels 105-118 (X-axis)
  const PLOT_W = 320
  const PLOT_H = 95
  const VIEW_H = 120

  const curveData = useMemo(() =>
    frames.map((f, i) => ({
      x: (i / Math.max(1, frames.length - 1)) * PLOT_W,
      y: PLOT_H - (frameAvg(f) / 1000) * (PLOT_H - 5),
    })), [frames])

  const curvePath = useMemo(() => smoothPoints(curveData), [curveData])
  const fillPath = useMemo(() => {
    if (curveData.length < 2) return ''
    return curvePath + ` L${curveData[curveData.length - 1].x},${PLOT_H} L${curveData[0].x},${PLOT_H} Z`
  }, [curvePath, curveData])

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

    const hasOutput = result.some(s => s.power_kw > 0)
    if (hasOutput) {
      result.sort((a, b) => b.power_kw - a.power_kw)
    } else {
      result.sort((a, b) => b.capacity_kw - a.capacity_kw)
    }

    return result
  }, [frameIdx, frames, pvUsers])

  // Auto-compute dot unit based on max capacity
  const dotUnit = useMemo(() => {
    if (substationPower.length === 0) return 500
    const maxCap = Math.max(...substationPower.map(s => s.capacity_kw))
    if (maxCap > 20000) return 1000
    if (maxCap > 10000) return 500
    return 250
  }, [substationPower])

  const rankChanges = useMemo(() => {
    const changes = new Map<string, number>()
    const currentRanks = new Map(substationPower.map((ss, i) => [ss.id, i]))

    if (prevRanksRef.current.size > 0) {
      for (const [id, newRank] of currentRanks) {
        const oldRank = prevRanksRef.current.get(id)
        if (oldRank !== undefined && oldRank !== newRank) {
          changes.set(id, oldRank - newRank)
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

  // Time tick labels (8 evenly spaced)
  const timeTicks = useMemo(() => {
    if (frames.length === 0) return []
    const step = Math.max(1, Math.floor(frames.length / 7))
    return frames
      .map((f, i) => ({ time: f.time, idx: i }))
      .filter((_, i) => i % step === 0)
  }, [frames])

  return (
    <section className="h-full flex flex-col" style={{ overflow: 'hidden' }}>
      <PanelHeader
        title="出力观测"
        accent="var(--solar-amber)"
        glow="var(--glow-amber)"
        badge={<span className="tag-label" style={{ fontSize: 8 }}>HIMAWARI-9</span>}
        onClose={onClose}
        closeAriaLabel="关闭出力观测面板"
      />

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-3">
          {/* Date picker row */}
          <div className="flex items-center gap-2">
            <IconButton
              ariaLabel="前一天"
              onClick={() => canPrev && setDate(shiftDate(date, -1))}
              disabled={!canPrev}
            >
              ◀
            </IconButton>
            <label htmlFor="ghi-date" className="sr-only">观测日期</label>
            <input
              id="ghi-date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={today}
              min="2026-04-01"
              aria-label="选择观测日期"
              style={{
                flex: 1,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: '8px 10px',
                color: 'var(--text-bright)',
                fontFamily: 'var(--font-data)',
                fontSize: 11,
                textAlign: 'center',
                minHeight: 36,
              }}
            />
            <IconButton
              ariaLabel="后一天"
              onClick={() => canNext && setDate(shiftDate(date, 1))}
              disabled={!canNext}
            >
              ▶
            </IconButton>
          </div>

          {loading && (
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
              加载中...
            </div>
          )}

          {!loading && frames.length === 0 && (
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
              该日期无卫星数据
            </div>
          )}

          {frames.length > 0 && (
            <>
              {/* Current frame time display */}
              <div style={{
                fontFamily: 'var(--font-data)',
                fontSize: 22,
                fontWeight: 600,
                color: 'var(--text-bright)',
                textAlign: 'center',
                letterSpacing: '1px',
              }}>
                {frame?.time || '--:--'}
              </div>

              {/* Slider */}
              <input
                type="range"
                min={0}
                max={frames.length - 1}
                value={frameIdx}
                aria-label="时间帧"
                onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)) }}
                style={{ width: '100%', accentColor: 'var(--solar-amber)' }}
              />

              {/* Playback controls */}
              <div className="flex items-center justify-center gap-2">
                <IconButton ariaLabel="上一帧" onClick={() => setFrameIdx(Math.max(0, frameIdx - 1))}>◀</IconButton>
                <PrimaryButton
                  ariaLabel={playing ? '暂停' : '播放'}
                  onClick={() => setPlaying(!playing)}
                  variant={playing ? 'danger' : 'primary'}
                  style={{ minWidth: 90 }}
                >
                  {playing ? '⏸ 暂停' : '▶ 播放'}
                </PrimaryButton>
                <IconButton ariaLabel="下一帧" onClick={() => setFrameIdx(Math.min(frames.length - 1, frameIdx + 1))}>▶</IconButton>
              </div>

              {/* Stats */}
              {frame && (
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {frame.grids.length} 格 · 均值 {Math.round(frameAvg(frame))} W/m² · 峰值 {Math.max(0, ...frame.grids.map(g => g.ghi))} W/m²
                </div>
              )}

              {/* GHI Curve — X axis below the chart */}
              <div style={{ marginTop: 4 }}>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>
                  日 GHI 曲线（区均值 W/m²）
                </div>
                <svg width="100%" height={VIEW_H} viewBox={`0 0 ${PLOT_W} ${VIEW_H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
                  {/* Y grid lines */}
                  {[25, 50, 75].map(y => <line key={y} x1="0" y1={y} x2={PLOT_W} y2={y} stroke="var(--border-subtle)" />)}
                  {/* Y labels */}
                  <text x="2" y="28" fill="var(--text-muted)" fontSize="7" fontFamily="var(--font-data)">750</text>
                  <text x="2" y="53" fill="var(--text-muted)" fontSize="7" fontFamily="var(--font-data)">500</text>
                  <text x="2" y="78" fill="var(--text-muted)" fontSize="7" fontFamily="var(--font-data)">250</text>
                  {/* Plot area baseline */}
                  <line x1="0" y1={PLOT_H} x2={PLOT_W} y2={PLOT_H} stroke="var(--border-subtle)" strokeWidth="0.5" />
                  {/* Curves */}
                  {fillPath && <path d={fillPath} fill="rgba(219,161,74,0.12)" />}
                  <path d={curvePath} fill="none" stroke="var(--solar-amber)" strokeWidth="1.5" />
                  {curveData[frameIdx] && (
                    <>
                      <line x1={curveData[frameIdx].x} y1="0" x2={curveData[frameIdx].x} y2={PLOT_H} stroke="var(--solar-amber)" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.6" />
                      <circle cx={curveData[frameIdx].x} cy={curveData[frameIdx].y} r="3" fill="var(--solar-amber)" />
                    </>
                  )}
                  {/* X-axis time labels — placed BELOW the plot area, not on it */}
                  {timeTicks.map(t => {
                    const x = (t.idx / Math.max(1, frames.length - 1)) * PLOT_W
                    return (
                      <text key={t.time} x={x} y={113} fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-data)" textAnchor="middle">
                        {t.time}
                      </text>
                    )
                  })}
                </svg>
              </div>

              {/* Substation Dot Matrix */}
              {substationPower.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>
                      金山区总出力
                    </span>
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 700, color: 'var(--solar-amber)' }}>
                      {(districtTotal.power / 1000).toFixed(1)}
                      <span style={{ fontSize: 10, fontWeight: 400 }}> MW</span>
                      <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
                        / {(districtTotal.capacity / 1000).toFixed(1)} MW
                      </span>
                    </span>
                  </div>

                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
                    出力构成 · 1 格 = {dotUnit} kW
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {substationPower.map(ss => {
                      const totalDots = Math.max(1, Math.round(ss.capacity_kw / dotUnit))
                      const litDots = Math.round(ss.power_kw / dotUnit)
                      const dc = ratioColor(ss.ratio)
                      const rankDelta = rankChanges.get(ss.id) || 0

                      return (
                        <div key={ss.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-muted)', width: 32, flexShrink: 0, textAlign: 'right' }}>
                            {ss.name.replace('变电站', '')}
                          </span>
                          <span style={{ width: 10, fontSize: 8, textAlign: 'center', flexShrink: 0 }}>
                            {rankDelta > 0 && <span style={{ color: 'var(--solar-coral)' }}>▲</span>}
                            {rankDelta < 0 && <span style={{ color: 'var(--solar-green)' }}>▼</span>}
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
})
