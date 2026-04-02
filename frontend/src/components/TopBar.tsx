interface Props {
  loading: boolean
  onRefresh: () => void
}

export default function TopBar({ loading, onRefresh }: Props) {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })

  return (
    <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
      {/* Logo & title */}
      <div className="glass-panel px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
        <div className="relative">
          <div className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #00e5ff, #0066ff)', color: '#fff' }}>
            PV
          </div>
          {loading && (
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
              style={{ background: 'var(--accent-cyan)' }}>
              <div className="w-full h-full rounded-full pulse-dot" style={{ background: 'var(--accent-cyan)' }} />
            </div>
          )}
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            光伏出力预警
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            上海金山区
          </div>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <div className="glass-panel px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {dateStr} {timeStr}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="glass-panel px-3 py-2 text-xs font-medium cursor-pointer transition-all"
          style={{
            color: loading ? 'var(--text-muted)' : 'var(--accent-cyan)',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '同步中...' : '刷新'}
        </button>
      </div>
    </div>
  )
}
