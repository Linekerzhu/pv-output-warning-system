import type { PVSummary, WarningRecord } from '../api'

interface Props {
  summary: PVSummary | null
  warnings: WarningRecord[]
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="flex flex-col items-center px-3">
      <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="flex items-baseline gap-0.5">
        <span className="text-lg font-semibold tabular-nums" style={{ color }}>{value}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{unit}</span>
      </div>
    </div>
  )
}

export default function StatsBar({ summary, warnings }: Props) {
  const capacity = summary ? (summary.total_capacity_kw / 1000).toFixed(1) : '--'
  const users = summary ? `${summary.active_users}` : '--'
  const streets = summary ? `${summary.streets}` : '--'
  const warnCount = warnings.length

  return (
    <div className="absolute bottom-5 left-5 z-20 glass-panel px-2 py-3 flex items-center gap-1 divide-x" style={{ borderColor: 'var(--border)' }}>
      <Stat label="装机" value={capacity} unit="MW" color="var(--accent-cyan)" />
      <Stat label="用户" value={users} unit="户" color="var(--text-primary)" />
      <Stat label="街镇" value={streets} unit="个" color="var(--text-primary)" />
      <Stat label="预警" value={`${warnCount}`} unit="条" color={warnCount > 0 ? 'var(--accent-orange)' : 'var(--accent-green)'} />
    </div>
  )
}
