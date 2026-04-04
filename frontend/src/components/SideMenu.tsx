import { memo, type ReactNode } from 'react'

export type PanelType = 'weather' | 'warnings' | 'history' | null

interface Props {
  activePanel: PanelType
  onPanelChange: (panel: PanelType) => void
  warningCount: number
}

const ITEMS: { id: PanelType; label: string; icon: ReactNode }[] = [
  {
    id: 'weather',
    label: '天气预报',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2m-10-10h2m16 0h2m-3.6-6.4-1.4 1.4M6.4 17.6 5 19m0-14 1.4 1.4m11.2 11.2 1.4 1.4" />
      </svg>
    ),
  },
  {
    id: 'warnings',
    label: '预警信息',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
    ),
  },
  {
    id: 'history' as PanelType,
    label: '历史回测',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
]

export default memo(function SideMenu({ activePanel, onPanelChange, warningCount }: Props) {
  return (
    <aside className="absolute left-0 top-0 bottom-0 z-30 flex flex-col items-center py-16 gap-1"
      style={{ width: 52, background: 'var(--bg-deep)' }}>
      {ITEMS.map(item => {
        const isActive = activePanel === item.id
        return (
          <button
            key={item.id}
            onClick={() => onPanelChange(isActive ? null : item.id)}
            aria-label={item.label}
            aria-pressed={isActive}
            className="relative flex flex-col items-center gap-0.5 transition-all active:scale-95"
            style={{
              width: 44,
              padding: '10px 0 8px',
              borderRadius: 10,
              border: 'none',
              background: isActive ? 'rgba(219,161,74,0.1)' : 'transparent',
              color: isActive ? 'var(--solar-amber)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 20, height: 20, display: 'block' }}>{item.icon}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: isActive ? 600 : 400 }}>
              {item.label.slice(0, 2)}
            </span>
            {item.id === 'warnings' && warningCount > 0 && (
              <span style={{
                position: 'absolute', top: 6, right: 4,
                background: 'var(--solar-coral)',
                color: 'var(--text-bright)',
                fontSize: 8, fontFamily: 'var(--font-data)', fontWeight: 600,
                minWidth: 14, height: 14, borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px',
              }}>
                {warningCount}
              </span>
            )}
          </button>
        )
      })}
    </aside>
  )
})
