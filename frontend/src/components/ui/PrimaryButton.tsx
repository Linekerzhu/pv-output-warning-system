import { memo, type ReactNode, type CSSProperties } from 'react'

interface Props {
  ariaLabel?: string
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'danger'
  children: ReactNode
  style?: CSSProperties
}

/**
 * Primary CTA button: 44px min height, accessible, consistent.
 */
export default memo(function PrimaryButton({
  ariaLabel,
  onClick,
  disabled = false,
  variant = 'primary',
  children,
  style,
}: Props) {
  const bg = variant === 'danger' ? 'var(--solar-coral)' : 'var(--solar-amber)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="transition-all active:scale-95"
      style={{
        minHeight: 36,
        padding: '8px 18px',
        borderRadius: 8,
        border: 'none',
        background: bg,
        color: 'var(--bg-deep)',
        fontFamily: 'var(--font-display)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.3px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  )
})
