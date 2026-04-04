const BASE = `${import.meta.env.BASE_URL}api`

export async function fetchJSON<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export interface PVUser {
  id: string
  name: string
  address: string
  street: string
  lat: number
  lon: number
  capacity_kw: number
  status: string
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
  clearsky_power_kw: number
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

export interface HourlyWeather {
  time: string
  icon: number
  text: string
  temp: number
  humidity: number
  cloud: number
  pop: number
  wind_speed: number
  precip: number
}

export interface WeatherForecast {
  street: string
  update_time: string
  hourly: HourlyWeather[]
}

export interface SolarRadiation {
  time: string
  ghi: number
  dni: number
  dhi: number
  elevation: number
}

export interface SolarRadiationForecast {
  lat: number
  lon: number
  forecasts: SolarRadiation[]
}

export interface WeatherSummaryItem {
  street: string
  current_text: string
  current_icon: number
  next_hour_text: string | null
  next_hour_icon: number | null
  weather_change: boolean
}

export const api = {
  getPVUsers: () => fetchJSON<PVUser[]>('/pv-users/list'),
  getSummary: () => fetchJSON<PVSummary>('/pv-users/summary'),
  getAggregations: () => fetchJSON<StreetAggregation[]>('/pv-users/aggregation'),
  getStreetPower: (street: string) =>
    fetchJSON<{ street: string; predictions: PowerPrediction[] }>(`/forecast/power/${encodeURIComponent(street)}`),
  getTotalPower: () => fetchJSON<TotalPrediction[]>('/forecast/total'),
  evaluateWarnings: () => fetchJSON<{ total_warnings: number; warnings: WarningRecord[] }>('/warning/evaluate', 'POST'),
  getCurrentWarnings: () => fetchJSON<WarningRecord[]>('/warning/current'),
  getClearskyCurve: () => fetchJSON<{ date: string; curve: Record<string, number> }>('/forecast/curve'),
  getWeatherSummary: () => fetchJSON<WeatherSummaryItem[]>('/weather/summary'),
  getWeatherForecast: (street: string) =>
    fetchJSON<WeatherForecast>(`/weather/forecast/${encodeURIComponent(street)}`),
  getAllWeatherForecast: () =>
    fetchJSON<Record<string, WeatherForecast>>('/weather/forecast'),
  getSolarRadiation: (hours = 24) =>
    fetchJSON<SolarRadiationForecast>(`/weather/solar-radiation?hours=${hours}`),
}
