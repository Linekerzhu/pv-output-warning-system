const BASE = '/api'

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export interface StreetAggregation {
  street: string
  total_capacity_kw: number
  active_users: number
  total_users: number
  center_lat: number
  center_lon: number
}

export interface PVSummary {
  total_users: number
  active_users: number
  total_capacity_kw: number
  streets: number
  by_street: StreetAggregation[]
}

export interface PowerPrediction {
  time: string
  clearsky_ratio: number
  weather_factor: number
  predicted_power_kw: number
  weather_text: string
  weather_icon: number
}

export interface WarningRecord {
  id: string
  level: string
  label: string
  street: string
  action: string
  drop_ratio: number
  from_time: string
  to_time: string
  from_power_kw: number
  to_power_kw: number
  issued_at: string
  weather_from: string
  weather_to: string
}

export interface TotalPrediction {
  time: string
  predicted_power_kw: number
  clearsky_power_kw: number
  total_capacity_kw: number
}

export const api = {
  getSummary: () => fetchJSON<PVSummary>('/pv-users/summary'),
  getAggregations: () => fetchJSON<StreetAggregation[]>('/pv-users/aggregation'),
  getStreetPower: (street: string) =>
    fetchJSON<{ street: string; predictions: PowerPrediction[] }>(`/forecast/power/${encodeURIComponent(street)}`),
  getTotalPower: () => fetchJSON<TotalPrediction[]>('/forecast/total'),
  evaluateWarnings: () => fetchJSON<{ total_warnings: number; warnings: WarningRecord[] }>('/warning/evaluate'),
  getCurrentWarnings: () => fetchJSON<WarningRecord[]>('/warning/current'),
  getClearskyCurve: () => fetchJSON<{ date: string; curve: Record<string, number> }>('/forecast/curve'),
}
