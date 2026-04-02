import type { PVSummary } from '../api'

interface Props {
  summary: PVSummary | null
  warningCount: { red: number; orange: number; yellow: number; blue: number }
  totalPowerNow: number
}

function Card({ title, value, unit, color, sub }: {
  title: string; value: string | number; unit: string; color: string; sub?: string
}) {
  return (
    <div
      className="rounded-xl p-5 border"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold" style={{ color }}>{value}</span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{unit}</span>
      </div>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{sub}</p>}
    </div>
  )
}

export default function StatsCards({ summary, warningCount, totalPowerNow }: Props) {
  const totalWarnings = warningCount.red + warningCount.orange + warningCount.yellow + warningCount.blue
  const worstLevel = warningCount.red > 0 ? 'red' : warningCount.orange > 0 ? 'orange' : warningCount.yellow > 0 ? 'yellow' : warningCount.blue > 0 ? 'blue' : 'none'
  const warningColor = {
    red: 'var(--accent-red)', orange: 'var(--accent-orange)',
    yellow: 'var(--accent-yellow)', blue: 'var(--accent-blue)', none: 'var(--accent-green)'
  }[worstLevel]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card
        title="装机总容量"
        value={summary ? (summary.total_capacity_kw / 1000).toFixed(1) : '--'}
        unit="MW"
        color="var(--accent-blue)"
        sub={summary ? `${summary.active_users}户运行 / ${summary.total_users}户` : undefined}
      />
      <Card
        title="当前预测出力"
        value={totalPowerNow ? (totalPowerNow / 1000).toFixed(1) : '--'}
        unit="MW"
        color="var(--accent-green)"
        sub={summary && totalPowerNow ? `${((totalPowerNow / summary.total_capacity_kw) * 100).toFixed(1)}% 出力率` : undefined}
      />
      <Card
        title="活跃预警"
        value={totalWarnings}
        unit="条"
        color={warningColor}
        sub={totalWarnings > 0 ? `红${warningCount.red} 橙${warningCount.orange} 黄${warningCount.yellow} 蓝${warningCount.blue}` : '当前无预警'}
      />
      <Card
        title="覆盖街镇"
        value={summary?.streets ?? '--'}
        unit="个"
        color="var(--accent-blue)"
        sub="金山全区"
      />
    </div>
  )
}
