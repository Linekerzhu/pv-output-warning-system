import { useState, useEffect } from 'react'

interface Props {
  loading: boolean
  onRefresh: () => void
}

function getShanghaiTime() {
  const now = new Date()
  const hh = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Shanghai' })
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' })
  return { hh, dateStr }
}

export default function TopBar({ loading, onRefresh }: Props) {
  const [time, setTime] = useState(getShanghaiTime)

  useEffect(() => {
    const id = setInterval(() => setTime(getShanghaiTime()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="absolute top-0 left-0 right-0 z-30 pointer-events-none"
      style={{ padding: 'max(8px, env(safe-area-inset-top)) 10px 0' }}
      role="banner">
      <div className="flex items-center justify-between">

        {/* Logo & Title */}
        <div className="glass-panel glass-panel-blur px-3 py-2 md:px-4 md:py-2.5 flex items-center gap-2.5 pointer-events-auto animate-in">
          {/* Sun icon */}
          <div className="relative shrink-0">
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(219,161,74,0.2), rgba(245,194,82,0.08))',
                border: '1px solid rgba(219,161,74,0.25)',
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--solar-amber)" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </div>
            {loading && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full pulse-warm"
                style={{ background: 'var(--solar-amber)', color: 'var(--solar-amber)' }} />
            )}
          </div>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text-bright)',
              letterSpacing: '0.5px',
              lineHeight: 1.2,
            }}>
              HELIO<span style={{ color: 'var(--solar-amber)' }}>GRAPH</span>
            </div>
            <h1 className="sr-only">HELIOGRAPH 光伏出力预警系统</h1>
            <div className="tag-label hidden md:block" style={{ fontSize: 8, marginTop: 2 }}>
              光伏出力预警 · 上海金山
            </div>
          </div>
        </div>

        {/* Right: Time + Sync */}
        <div className="flex items-center gap-1.5 pointer-events-auto animate-in" style={{ animationDelay: '0.08s' }}>
          <div className="glass-panel glass-panel-blur px-2.5 py-1.5 md:px-3 md:py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full hidden md:block"
              style={{ background: 'var(--solar-green)', boxShadow: 'var(--glow-green)', animation: 'breathe 3s ease-in-out infinite' }} />
            <div style={{
              fontFamily: 'var(--font-data)',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-bright)',
              letterSpacing: '0.5px',
            }}>
              {time.hh}
            </div>
            <div className="hidden md:block" style={{
              fontFamily: 'var(--font-data)',
              fontSize: 9,
              color: 'var(--text-muted)',
            }}>
              {time.dateStr}
            </div>
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            aria-label={loading ? '数据加载中' : '刷新数据'}
            className="glass-panel glass-panel-blur px-2.5 py-1.5 md:px-3 md:py-2 cursor-pointer transition-all active:scale-95"
            style={{
              color: loading ? 'var(--text-muted)' : 'var(--solar-amber)',
              fontFamily: 'var(--font-display)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.5px',
              cursor: loading ? 'wait' : 'pointer',
              borderColor: loading ? 'var(--border-dim)' : 'var(--border-warm)',
            }}
          >
            {loading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
