import { memo, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polygon, Marker, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import type { PVUser, StreetAggregation, WarningRecord, WeatherSummaryItem } from '../api'
import { TOWN_BOUNDARIES } from '../data/jinshan-boundary'
import { LEVEL_COLORS_RAW } from '../tokens'
import GhiGridOverlay from './GhiGridOverlay'

interface Props {
  pvUsers: PVUser[]
  aggregations: StreetAggregation[]
  warnings: WarningRecord[]
  weatherSummary: WeatherSummaryItem[]
  onStreetClick: (street: string) => void
  selectedStreet: string | null
  outputRatio: number
  showGhiGrid?: boolean
}

const T = {
  bgPanel: 'rgba(14,15,21,0.85)',
  bgPanelSelected: 'rgba(14,15,21,0.92)',
  textBright: '#f0ede6',
  textSecondary: '#706c62',
  textMuted: '#78746b',
  textDim: '#4a4740',
  solarAmber: '#dba14a',
  solarGreen: '#6ec472',
  solarCoral: '#e06456',
} as const

function weatherIcon(code: number): string {
  if (code === 100 || code === 150) return '\u2600\uFE0F'
  if (code === 101 || code === 151) return '\u26C5'
  if (code >= 102 && code <= 104) return '\u2601\uFE0F'
  if (code >= 300 && code <= 318) return '\uD83C\uDF27\uFE0F'
  if (code >= 400 && code <= 410) return '\u2744\uFE0F'
  if (code >= 500 && code <= 515) return '\uD83C\uDF2B\uFE0F'
  return '\u2601\uFE0F'
}

/* Pre-compute town polygon positions (static data, never changes) */
const TOWN_POSITIONS = TOWN_BOUNDARIES.map(town => ({
  name: town.name,
  center: town.center,
  rings: town.type === 'Polygon'
    ? town.coordinates as [number, number][][]
    : (town.coordinates as [number, number][][][]).map(poly => poly[0]),
}))

function createCenteredLabel(
  street: string,
  weather: WeatherSummaryItem | undefined,
  wLevel: string | null,
  agg: StreetAggregation | undefined,
  isSelected: boolean,
): L.DivIcon {
  const accent = wLevel ? (LEVEL_COLORS_RAW[wLevel] || T.solarGreen) : T.solarGreen
  const currentE = weather ? weatherIcon(weather.current_icon) : ''
  const currentText = weather?.current_text || ''
  const nextE = weather?.next_hour_icon ? weatherIcon(weather.next_hour_icon) : ''
  const nextText = weather?.next_hour_text || ''
  const changed = weather?.weather_change
  const capacity = agg ? `${agg.total_capacity_kw.toFixed(0)}kW` : ''
  const bg = isSelected ? T.bgPanelSelected : T.bgPanel
  const dotPulse = wLevel ? 'animation: pulse-warm 2.5s ease-in-out infinite;' : ''

  const weatherLine = currentText ? `
    <div style="display:flex; align-items:center; justify-content:center; gap:3px; font-family:'Fira Code',monospace; font-size:9px; color:${T.textMuted};">
      <span>${currentE} ${currentText}</span>
      ${nextText && nextText !== currentText ? `
        <span style="font-size:7px; opacity:0.4;">›</span>
        <span style="${changed ? `color:${T.solarAmber};` : `color:${T.textSecondary};`}">${nextE} ${nextText}</span>
      ` : ''}
    </div>
  ` : ''

  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `
      <div style="
        transform: translate(-50%, -50%);
        white-space: nowrap;
        pointer-events: auto;
        cursor: pointer;
        text-align: center;
      ">
        <div style="
          background: ${bg};
          border: 1px solid ${accent}20;
          border-radius: 8px;
          padding: 5px 10px;
          font-family: 'Outfit', sans-serif;
          display: inline-block;
          ${isSelected ? `box-shadow: 0 0 20px ${accent}15;` : ''}
        ">
          <div style="display:flex; align-items:center; justify-content:center; gap:5px; margin-bottom:${weatherLine ? '3px' : '0'};">
            <span style="
              width:4px; height:4px; border-radius:50%;
              background:${accent};
              box-shadow: 0 0 6px ${accent}50;
              display:inline-block;
              ${dotPulse}
              color:${accent};
            "></span>
            <span style="font-family:'Unbounded',sans-serif; font-size:${isSelected ? '11px' : '10px'}; font-weight:${isSelected ? '700' : '600'}; color:${T.textBright}; letter-spacing:0.3px;">
              ${street}
            </span>
            ${capacity ? `<span style="font-family:'Fira Code',monospace; font-size:8px; color:${T.textMuted}; margin-left:2px;">${capacity}</span>` : ''}
          </div>
          ${weatherLine}
        </div>
      </div>
    `,
  })
}

/* Tooltip SVG — only computed when tooltip is actually rendered by Leaflet */
function StationTooltip({ user, color, currentOutput }: {
  user: PVUser; color: string; currentOutput: number
}) {
  const isRunning = user.status === '运行'
  const maxR = 28
  const rCap = Math.max(8, maxR * Math.sqrt(user.capacity_kw / 5000))
  const rOut = currentOutput > 0 ? Math.max(4, maxR * Math.sqrt(currentOutput / 5000)) : 0
  const svgW = rCap * 2 + 12
  const svgH = rCap * 2 + 6
  const baseline = svgH - 2
  const cx = svgW / 2

  return (
    <div style={{
      fontFamily: 'Outfit, sans-serif', color: T.textBright,
      background: 'rgba(14,15,21,0.94)', padding: '8px 12px', borderRadius: 8,
      border: `1px solid ${color}30`, whiteSpace: 'nowrap', minWidth: 140,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{user.name}</div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginBottom: 6 }}>
        <svg width={svgW} height={svgH} style={{ display: 'block' }}>
          <circle cx={cx} cy={baseline - rCap} r={rCap}
            fill={`${color}15`} stroke={color} strokeWidth="1" opacity="0.6" />
          {rOut > 0 && (
            <circle cx={cx} cy={baseline - rOut} r={rOut}
              fill={color} fillOpacity="0.5" stroke={color} strokeWidth="1" opacity="0.9" />
          )}
          <line x1={cx - rCap} y1={baseline} x2={cx + rCap} y2={baseline}
            stroke={T.textMuted} strokeWidth="0.5" opacity="0.3" />
        </svg>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: 'Fira Code, monospace' }}>
        <div>
          <div style={{ color: T.textMuted, marginBottom: 1 }}>装机</div>
          <div style={{ color: T.textBright }}>
            {user.capacity_kw >= 1000 ? `${(user.capacity_kw / 1000).toFixed(1)}MW` : `${user.capacity_kw}kW`}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: T.textMuted, marginBottom: 1 }}>出力</div>
          <div style={{ color: currentOutput > 0 ? T.solarGreen : T.textMuted }}>
            {currentOutput > 0 ? (currentOutput >= 1000 ? `${(currentOutput / 1000).toFixed(1)}MW` : `${currentOutput.toFixed(0)}kW`) : '--'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: T.textMuted, marginBottom: 1 }}>状态</div>
          <div style={{ color: isRunning ? T.solarGreen : T.solarCoral }}>{user.status}</div>
        </div>
      </div>
    </div>
  )
}

export default memo(function MapView({ pvUsers, aggregations, warnings, weatherSummary, onStreetClick, selectedStreet, outputRatio, showGhiGrid }: Props) {
  const weatherMap = useMemo(() => new Map(weatherSummary.map(w => [w.street, w])), [weatherSummary])
  const aggMap = useMemo(() => new Map(aggregations.map(a => [a.street, a])), [aggregations])

  // Pre-compute warning level per street — O(1) lookup instead of O(warnings) per use
  const warningLevelMap = useMemo(() => {
    const m = new Map<string, string>()
    const priority = ['red', 'orange', 'yellow', 'blue']
    for (const w of warnings) {
      const existing = m.get(w.street)
      if (!existing || priority.indexOf(w.level) < priority.indexOf(existing)) {
        m.set(w.street, w.level)
      }
    }
    return m
  }, [warnings])

  // Memoize town label icons — only recompute when inputs change
  const townIcons = useMemo(() => {
    return TOWN_POSITIONS.map(town => ({
      ...town,
      icon: createCenteredLabel(
        town.name,
        weatherMap.get(town.name),
        warningLevelMap.get(town.name) || null,
        aggMap.get(town.name),
        town.name === selectedStreet,
      ),
    }))
  }, [weatherMap, aggMap, warningLevelMap, selectedStreet])

  return (
    <div className="absolute inset-0 z-0">
      <MapContainer
        center={[30.82, 121.20]}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
        preferCanvas
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png" />

        {/* GHI Grid overlay */}
        <GhiGridOverlay visible={!!showGhiGrid} pvUsers={pvUsers} />

        {/* Town boundaries — in GHI grid mode show outline only, no fill, no interaction */}
        {TOWN_POSITIONS.map(town => {
          const wLevel = warningLevelMap.get(town.name) || null
          const isSelected = town.name === selectedStreet
          const color = wLevel ? (LEVEL_COLORS_RAW[wLevel] || T.solarAmber) : T.solarAmber

          return town.rings.map((ring, i) => (
            <Polygon
              key={`town-${town.name}-${i}`}
              positions={ring}
              pathOptions={showGhiGrid ? {
                color: T.solarAmber,
                weight: 1.5,
                opacity: 0.6,
                fillOpacity: 0,
              } : {
                color,
                weight: isSelected ? 2 : 1,
                opacity: isSelected ? 0.8 : 0.35,
                fillColor: color,
                fillOpacity: isSelected ? 0.15 : 0.06,
              }}
              interactive={!showGhiGrid}
              {...(!showGhiGrid ? { eventHandlers: { click: () => onStreetClick(town.name) } } : {})}
            />
          ))
        })}

        {/* PV station dots — simplified in GHI grid mode (no click, muted style) */}
        {pvUsers.map(user => {
          const isRunning = user.status === '运行'
          const wLevel = warningLevelMap.get(user.street) || null
          const isInSelected = !showGhiGrid && user.street === selectedStreet
          const color = showGhiGrid
            ? (isRunning ? 'rgba(240,237,230,0.5)' : T.textDim)
            : (!isRunning ? T.textDim
              : wLevel ? (LEVEL_COLORS_RAW[wLevel] || T.solarGreen) : T.solarGreen)
          const currentOutput = isRunning ? user.capacity_kw * outputRatio : 0
          const rDot = Math.max(3, Math.min(14, Math.sqrt(user.capacity_kw / 10)))

          return (
            <CircleMarker
              key={user.id}
              center={[user.lat, user.lon]}
              radius={showGhiGrid ? Math.max(2, rDot * 0.7) : rDot}
              pathOptions={{
                color: showGhiGrid ? 'rgba(240,237,230,0.3)' : (isInSelected ? T.textBright : color),
                fillColor: color,
                fillOpacity: showGhiGrid ? 0.3 : (isRunning ? (isInSelected ? 0.9 : 0.6) : 0.15),
                weight: showGhiGrid ? 0.3 : (isInSelected ? 1.5 : 0.5),
              }}
              interactive={!showGhiGrid}
              {...(!showGhiGrid ? { eventHandlers: { click: () => onStreetClick(user.street) } } : {})}
            >
              {!showGhiGrid && (
                <Tooltip direction="top" offset={[0, -rDot]} pane="tooltipPane">
                  <StationTooltip user={user} color={color} currentOutput={currentOutput} />
                </Tooltip>
              )}
            </CircleMarker>
          )
        })}

        {/* Centered town labels — hidden in GHI grid mode */}
        {!showGhiGrid && townIcons.map(town => (
          <Marker
            key={`label-${town.name}`}
            position={town.center}
            icon={town.icon}
            eventHandlers={{ click: () => onStreetClick(town.name) }}
          />
        ))}
      </MapContainer>
    </div>
  )
})
