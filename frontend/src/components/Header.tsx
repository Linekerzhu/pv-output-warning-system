interface Props {
  onRefresh: () => void
  loading: boolean
}

export default function Header({ onRefresh, loading }: Props) {
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { hour12: false })

  return (
    <header
      className="px-6 py-4 flex items-center justify-between border-b"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center gap-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
          style={{ background: 'linear-gradient(135deg, #00d4ff, #0066ff)' }}
        >
          PV
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            光伏出力预警系统
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            上海金山区 | {timeStr}
          </p>
        </div>
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
        style={{
          background: loading ? 'var(--border-color)' : 'linear-gradient(135deg, #00d4ff, #0066ff)',
          color: 'white',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? '加载中...' : '刷新数据'}
      </button>
    </header>
  )
}
