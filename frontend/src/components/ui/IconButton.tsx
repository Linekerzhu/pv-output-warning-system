import { memo, type ReactNode, type CSSProperties } from 'react'

interface Props {
  ariaLabel: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
  style?: CSSProperties
}

/**
 * Standard icon button: 36×36 hit area, accessible, consistent across panels.
 */
export default memo(function IconButton({
  ariaLabel,
  onClick,
  disabled = false,
  active = false,
  children,
  style,
}: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      className="transition-all active:scale-95"
      style={{
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        border: `1px solid ${active ? 'var(--solar-amber)' : 'var(--border-subtle)'}`,
        background: active ? 'rgba(219,161,74,0.12)' : 'var(--bg-surface)',
        color: active ? 'var(--solar-amber)' : 'var(--text-bright)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        fontFamily: 'var(--font-data)',
        fontSize: 13,
        ...style,
      }}
    >
      {children}
    </button>
  )
})
