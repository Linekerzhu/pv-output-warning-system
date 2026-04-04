/**
 * 光伏出力预警引擎 v3
 *
 * 核心：二阶导数检测（曲线加速度突变）
 * 平滑的日出爬升/日落衰减不报警（一阶导数大但二阶小）
 * 只有天气突变导致曲线急转弯时才报警（二阶导数突增）
 *
 * 二阶导数 = Δ2 - Δ1 = [P(t+1)-P(t)] - [P(t)-P(t-1)]
 * 平滑曲线: ≈0  |  天气突变: 很大
 */

import type { SolarRadiation } from '../api'

export interface Warning {
  id: string
  type: 'ramp_down' | 'ramp_up'
  level: 'red' | 'orange' | 'yellow' | 'blue'
  label: string
  fromTime: string
  toTime: string
  fromPowerKw: number
  toPowerKw: number
  rampRatePercent: number
  ghiChange: number
}

// 阈值：二阶导数的绝对值 (占装机容量 %)
// 同时要求绝对冲击量也达标
const THRESHOLDS = {
  red:    { accel: 40, impactMin: 20, label: '红色预警' },
  orange: { accel: 28, impactMin: 12, label: '橙色预警' },
  yellow: { accel: 18, impactMin: 8,  label: '黄色预警' },
  blue:   { accel: 12, impactMin: 5,  label: '蓝色预警' },
} as const

const LEVELS_ORDER: ('red' | 'orange' | 'yellow' | 'blue')[] = ['red', 'orange', 'yellow', 'blue']

function getLevel(accelPercent: number, impactPercent: number): 'red' | 'orange' | 'yellow' | 'blue' | null {
  for (const level of LEVELS_ORDER) {
    if (accelPercent >= THRESHOLDS[level].accel && impactPercent >= THRESHOLDS[level].impactMin) return level
  }
  return null
}

export function computeWarnings(
  radiation: SolarRadiation[],
  capacityKw: number,
  areaM2: number,
): Warning[] {
  if (radiation.length < 3 || capacityKw <= 0) return []

  // Only today + tomorrow
  const dates = [...new Set(radiation.map(r => r.time.split(' ')[0]))].slice(0, 2)
  const filtered = radiation.filter(r => dates.includes(r.time.split(' ')[0]))

  // Compute output per hour
  const hourly = filtered.map(r => ({
    time: r.time,
    hour: parseInt(r.time.split(' ')[1]?.split(':')[0] || '0'),
    date: r.time.split(' ')[0],
    ghi: r.ghi,
    outputKw: areaM2 * r.ghi / 1000,
  }))

  const warnings: Warning[] = []
  let idCounter = 0

  // Need 3 consecutive points to compute second derivative
  for (let i = 1; i < hourly.length - 1; i++) {
    const prev = hourly[i - 1]
    const curr = hourly[i]
    const next = hourly[i + 1]

    // Skip cross-day (need same day for meaningful derivatives)
    if (prev.date !== curr.date || curr.date !== next.date) continue

    // Skip nighttime
    if (prev.outputKw <= 0 && curr.outputKw <= 0 && next.outputKw <= 0) continue

    // First derivatives
    const d1 = curr.outputKw - prev.outputKw  // change entering this hour
    const d2 = next.outputKw - curr.outputKw  // change leaving this hour

    // Second derivative = acceleration (change in rate of change)
    const accel = d2 - d1
    const accelPercent = Math.abs(accel / capacityKw * 100)

    // Absolute impact: the actual change at this transition
    const deltaKw = d2
    const impactPercent = Math.abs(deltaKw / capacityKw * 100)

    // Direction: determined by the actual change (d2)
    // If curve was rising and suddenly drops (d1>0, d2<0) → ramp_down
    // If curve was dropping and suddenly rises (d1<0, d2>0) → ramp_up
    // If just accelerating in same direction, less concerning
    const isDirectionChange = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)

    // Only alert on direction changes (true inflection points) or very large acceleration
    if (!isDirectionChange && accelPercent < 30) continue

    const level = getLevel(accelPercent, impactPercent)
    if (!level) continue

    warnings.push({
      id: `W-${++idCounter}-${curr.time.replace(/[\s:]/g, '')}`,
      type: d2 < 0 ? 'ramp_down' : 'ramp_up',
      level,
      label: THRESHOLDS[level].label,
      fromTime: curr.time,
      toTime: next.time,
      fromPowerKw: Math.round(curr.outputKw),
      toPowerKw: Math.round(next.outputKw),
      rampRatePercent: Math.round(Math.abs(d2 / capacityKw * 100)),
      ghiChange: Math.round(next.ghi - curr.ghi),
    })
  }

  const levelOrder = { red: 0, orange: 1, yellow: 2, blue: 3 }
  warnings.sort((a, b) => levelOrder[a.level] - levelOrder[b.level] || a.fromTime.localeCompare(b.fromTime))

  return warnings
}
