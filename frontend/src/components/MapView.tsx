import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import type { StreetAggregation, WarningRecord } from '../api'

interface Props {
  aggregations: StreetAggregation[]
  warnings: WarningRecord[]
  onStreetClick: (street: string) => void
  selectedStreet: string | null
}

function getStreetWarningLevel(street: string, warnings: WarningRecord[]): string | null {
  const streetWarnings = warnings.filter(w => w.street === street)
  if (streetWarnings.length === 0) return null
  const order = ['red', 'orange', 'yellow', 'blue']
  for (const level of order) {
    if (streetWarnings.some(w => w.level === level)) return level
  }
  return null
}

const levelColors: Record<string, string> = {
  red: '#ff3b30',
  orange: '#ff8c00',
  yellow: '#ffd700',
  blue: '#00d4ff',
}

export default function MapView({ aggregations, warnings, onStreetClick, selectedStreet }: Props) {
  return (
    <div
      className="rounded-xl p-5 border"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        金山区光伏分布
      </h3>
      <div className="rounded-lg overflow-hidden" style={{ height: 350 }}>
        <MapContainer
          center={[30.80, 121.20]}
          zoom={11}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {aggregations.map(agg => {
            const wLevel = getStreetWarningLevel(agg.street, warnings)
            const color = wLevel ? levelColors[wLevel] : '#00ff88'
            const isSelected = agg.street === selectedStreet
            const radius = Math.max(8, Math.sqrt(agg.total_capacity_kw / 10))

            return (
              <CircleMarker
                key={agg.street}
                center={[agg.center_lat, agg.center_lon]}
                radius={Math.min(radius, 25)}
                pathOptions={{
                  color: isSelected ? '#ffffff' : color,
                  fillColor: color,
                  fillOpacity: 0.6,
                  weight: isSelected ? 3 : 1,
                }}
                eventHandlers={{ click: () => onStreetClick(agg.street) }}
              >
                <Popup>
                  <div style={{ color: '#333', fontSize: 12 }}>
                    <strong>{agg.street}</strong><br />
                    装机: {agg.total_capacity_kw.toFixed(0)} kW<br />
                    用户: {agg.active_users}/{agg.total_users}<br />
                    {wLevel && <span style={{ color: levelColors[wLevel] }}>预警: {wLevel.toUpperCase()}</span>}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
