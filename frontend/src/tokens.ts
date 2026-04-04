/**
 * Design tokens shared across components.
 * Values mirror CSS custom properties in index.css — keep in sync.
 */

/* ── Warning level colors ── */
export const LEVEL_COLORS: Record<string, string> = {
  red: 'var(--solar-coral)',
  orange: 'var(--solar-amber)',
  yellow: 'var(--solar-yellow)',
  blue: 'var(--solar-teal)',
}

/* Raw hex values for contexts that can't resolve CSS vars (Leaflet DivIcon HTML) */
export const LEVEL_COLORS_RAW: Record<string, string> = {
  red: '#e06456',
  orange: '#dba14a',
  yellow: '#e8c84a',
  blue: '#52c4b8',
}

export const LEVEL_ORDER: Record<string, number> = {
  red: 0, orange: 1, yellow: 2, blue: 3,
}

/* ── Chart day palette ── */
export const DAY_COLORS = [
  { clearsky: 'var(--solar-amber)', predicted: 'var(--solar-green)', fill: 'rgba(110,196,114,0.1)', bg: 'rgba(219,161,74,0.02)' },
  { clearsky: 'var(--solar-lavender)', predicted: 'var(--solar-teal)', fill: 'rgba(82,196,184,0.1)', bg: 'rgba(155,142,196,0.02)' },
]

/* Raw hex for Recharts (which needs raw values for gradients) */
export const DAY_COLORS_RAW = [
  { clearsky: '#dba14a', predicted: '#6ec472', fill: 'rgba(110,196,114,0.1)' },
  { clearsky: '#9b8ec4', predicted: '#52c4b8', fill: 'rgba(82,196,184,0.1)' },
]
