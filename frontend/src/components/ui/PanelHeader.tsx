import { memo, type ReactNode } from 'react'

interface Props {
  title: string
  accent?: string  // CSS color, defaults to solar-amber
  glow?: string    // box-shadow value
  badge?: ReactNode
  onClose: () => void
  closeAriaLabel?: string
}

export default memo(function PanelHeader({
  title,
  accent = 'var(--solar-amber)',
  glow = 'var(--glow-amber)',
  badge,
  onClose,
  closeAriaLabel = '关闭面板',
}: Props) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      <div className="flex items-center gap-2.5">
        <div className="w-1 h-5 rounded-full" style={{ background: accent, boxShadow: glow }} />
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-bright)',
          letterSpacing: '0.3px',
          margin: 0,
        }}>
          {title}
        </h2>
        {badge}
      </div>
      <button
        onClick={onClose}
        aria-label={closeAriaLabel}
        className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg transition-colors active:scale-95 -mr-2"
        style={{ color: 'var(--text-muted)', fontSize: 16, background: 'none', border: 'none' }}
      >
        <span
          className="w-6 h-6 flex items-center justify-center rounded-lg"
          style={{ background: 'var(--bg-surface)' }}
        >
          ×
        </span>
      </button>
    </div>
  )
})
