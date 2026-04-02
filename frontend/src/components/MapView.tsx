import { MapContainer, TileLayer, CircleMarker, Polygon, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useEffect } from 'react'
import type { StreetAggregation, WarningRecord, WeatherSummaryItem } from '../api'
import { JINSHAN_BOUNDARY } from '../data/jinshan-boundary'

interface Props {
  aggregations: StreetAggregation[]
  warnings: WarningRecord[]
  weatherSummary: WeatherSummaryItem[]
  onStreetClick: (street: string) => void
  selectedStreet: string | null
}

const LEVEL_COLORS: Record<string, string> = {
  red: '#ff1744',
  orange: '#ff9100',
  yellow: '#ffea00',
  blue: '#00e5ff',
}

function getStreetWarningLevel(street: string, warnings: WarningRecord[]): string | null {
  const sw = warnings.filter(w => w.street === street)
  if (!sw.length) return null
  for (const l of ['red', 'orange', 'yellow', 'blue']) {
    if (sw.some(w => w.level === l)) return l
  }
  return null
}

// Weather icon mapping (simplified)
function weatherEmoji(icon: number): string {
  if (icon === 100 || icon === 150) return '\u2600\uFE0F'     // sunny
  if (icon === 101 || icon === 151) return '\u26C5'            // few clouds
  if (icon >= 102 && icon <= 103) return '\u2601\uFE0F'        // cloudy
  if (icon === 104) return '\u2601\uFE0F'                      // overcast
  if (icon >= 300 && icon <= 318) return '\uD83C\uDF27\uFE0F'  // rain
  if (icon >= 400 && icon <= 410) return '\u2744\uFE0F'        // snow
  if (icon >= 500 && icon <= 515) return '\uD83C\uDF2B\uFE0F'  // fog
  return '\u2601\uFE0F'
}

// Current time display component
function TimeOverlay() {
  const map = useMap()
  useEffect(() => {
    const control = new L.Control({ position: 'topright' })
    control.onAdd = () => {
      const div = L.DomUtil.create('div')
      const now = new Date()
      const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })
      const dateStr = now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' })
      div.innerHTML = `
        <div style="
          background: rgba(12,14,24,0.9);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          padding: 6px 12px;
          color: #f0f0f5;
          font-family: Inter, sans-serif;
          font-size: 11px;
          text-align: center;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        ">
          <div style="font-size: 16px; font-weight: 600; letter-spacing: 1px;">${timeStr}</div>
          <div style="color: #8b8fa3; font-size: 10px; margin-top: 1px;">UTC+8 ${dateStr}</div>
        </div>
      `
      return div
    }
    control.addTo(map)
    return () => { control.remove() }
  }, [map])
  return null
}

// Create a DivIcon for weather label on map
function createWeatherLabel(
  street: string,
  weather: WeatherSummaryItem | undefined,
  wLevel: string | null,
  capacityKw: number,
  isSelected: boolean,
): L.DivIcon {
  const color = wLevel ? LEVEL_COLORS[wLevel] : '#00e676'
  const borderColor = isSelected ? '#ffffff' : color
  const currentEmoji = weather ? weatherEmoji(weather.current_icon) : ''
  const currentText = weather?.current_text || '--'
  const nextText = weather?.next_hour_text || '--'
  const nextEmoji = weather?.next_hour_icon ? weatherEmoji(weather.next_hour_icon) : ''
  const changed = weather?.weather_change
  const arrow = changed ? `<span style="color:${LEVEL_COLORS.orange}">→</span>` : '→'

  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 20],
    html: `
      <div style="
        position: relative;
        transform: translate(-50%, -100%);
        white-space: nowrap;
        pointer-events: auto;
        cursor: pointer;
      ">
        <div style="
          background: rgba(12,14,24,0.92);
          backdrop-filter: blur(12px);
          border: 1px solid ${borderColor}40;
          border-left: 3px solid ${borderColor};
          border-radius: 8px;
          padding: 6px 10px;
          font-family: Inter, sans-serif;
          box-shadow: 0 4px 20px ${color}15;
          min-width: 120px;
        ">
          <div style="display:flex; align-items:center; gap:4px; margin-bottom:3px;">
            <span style="
              width:6px; height:6px; border-radius:50%;
              background:${color};
              box-shadow: 0 0 6px ${color};
              display:inline-block;
              ${wLevel ? 'animation: pulse-dot 2s ease-in-out infinite;' : ''}
            "></span>
            <span style="font-size:12px; font-weight:600; color:#f0f0f5;">${street}</span>
            <span style="font-size:10px; color:#555770; margin-left:auto;">${capacityKw.toFixed(0)}kW</span>
          </div>
          <div style="font-size:11px; color:#c0c4d8; display:flex; align-items:center; gap:3px;">
            <span>${currentEmoji} ${currentText}</span>
            <span style="color:#555770; font-size:10px;">${arrow}</span>
            <span style="${changed ? `color:${LEVEL_COLORS.orange}; font-weight:500;` : ''}">${nextEmoji} ${nextText}</span>
          </div>
        </div>
        <div style="
          position:absolute; bottom:-5px; left:50%;
          transform:translateX(-50%);
          width:8px; height:8px; rotate:45deg;
          background:rgba(12,14,24,0.92);
          border-right:1px solid ${borderColor}40;
          border-bottom:1px solid ${borderColor}40;
        "></div>
      </div>
    `,
  })
}

export default function MapView({ aggregations, warnings, weatherSummary, onStreetClick, selectedStreet }: Props) {
  const weatherMap = new Map(weatherSummary.map(w => [w.street, w]))

  return (
    <div className="absolute inset-0 z-0">
      <MapContainer
        center={[30.82, 121.20]}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        {/* Dark basemap - CartoDB dark matter (no labels for cleaner look) */}
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png" />
        {/* Labels layer on top */}
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png" />

        {/* Time display */}
        <TimeOverlay />

        {/* District boundary */}
        <Polygon
          positions={JINSHAN_BOUNDARY}
          pathOptions={{
            color: '#00e5ff',
            weight: 2,
            opacity: 0.4,
            fillColor: '#00e5ff',
            fillOpacity: 0.03,
            dashArray: '8 4',
          }}
        />

        {/* Street area circles (soft glow background) */}
        {aggregations.map(agg => {
          const wLevel = getStreetWarningLevel(agg.street, warnings)
          const color = wLevel ? LEVEL_COLORS[wLevel] : '#00e676'
          const isSelected = agg.street === selectedStreet
          const r = Math.max(12, Math.min(35, Math.sqrt(agg.total_capacity_kw / 4)))

          return (
            <CircleMarker
              key={`circle-${agg.street}`}
              center={[agg.center_lat, agg.center_lon]}
              radius={r}
              pathOptions={{
                color: isSelected ? '#ffffff' : color,
                fillColor: color,
                fillOpacity: isSelected ? 0.25 : 0.12,
                weight: isSelected ? 2 : 0.5,
              }}
              eventHandlers={{ click: () => onStreetClick(agg.street) }}
            />
          )
        })}

        {/* Street weather labels */}
        {aggregations.map(agg => {
          const wLevel = getStreetWarningLevel(agg.street, warnings)
          const weather = weatherMap.get(agg.street)
          const isSelected = agg.street === selectedStreet
          const icon = createWeatherLabel(agg.street, weather, wLevel, agg.total_capacity_kw, isSelected)

          return (
            <Marker
              key={`label-${agg.street}`}
              position={[agg.center_lat, agg.center_lon]}
              icon={icon}
              eventHandlers={{ click: () => onStreetClick(agg.street) }}
            />
          )
        })}
      </MapContainer>
    </div>
  )
}
