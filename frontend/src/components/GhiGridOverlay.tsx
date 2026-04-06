import { memo, useEffect, useRef, useMemo, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { GHI_GRID, HEX_S_LAT, HEX_S_LON } from '../data/ghi-grid'
import { SUBSTATIONS } from '../data/substations'
import type { PVUser } from '../api'

interface Props {
  visible: boolean
  pvUsers: PVUser[]
}

const HALF_W = HEX_S_LON * Math.sqrt(3) / 2

function hexVertices(lat: number, lon: number): L.LatLngExpression[] {
  return [
    [lat + HEX_S_LAT, lon],
    [lat + HEX_S_LAT / 2, lon + HALF_W],
    [lat - HEX_S_LAT / 2, lon + HALF_W],
    [lat - HEX_S_LAT, lon],
    [lat - HEX_S_LAT / 2, lon - HALF_W],
    [lat + HEX_S_LAT / 2, lon - HALF_W],
  ]
}

function ghiColor(ghi: number): string {
  if (ghi <= 0) return 'rgb(25,35,80)'
  const t = Math.min(1, ghi / 1000)
  if (t < 0.4) {
    const s = t / 0.4
    return `rgb(${Math.round(25 + 60 * s)}, ${Math.round(50 + 120 * s)}, ${Math.round(130 - 30 * s)})`
  }
  if (t < 0.7) {
    const s = (t - 0.4) / 0.3
    return `rgb(${Math.round(85 + 130 * s)}, ${Math.round(170 + 30 * s)}, ${Math.round(100 - 60 * s)})`
  }
  const s = (t - 0.7) / 0.3
  return `rgb(${Math.round(215 + 40 * s)}, ${Math.round(200 - 100 * s)}, ${Math.round(40 - 20 * s)})`
}

/** Fetch real satellite GHI from backend API, fallback to mock */
async function fetchSatelliteGhi(): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  try {
    const base = `${import.meta.env.BASE_URL}api`
    const res = await fetch(`${base}/satellite/ghi/latest`)
    if (res.ok) {
      const data = await res.json()
      if (data.grids && data.grids.length > 0) {
        for (const g of data.grids) {
          m.set(g.grid_id, g.is_valid ? (g.ghi ?? 0) : 0)
        }
        return m
      }
    }
  } catch { /* fallback to mock */ }

  // Fallback: mock data when satellite unavailable
  const now = new Date()
  const hour = now.getHours() + now.getMinutes() / 60
  for (const cell of GHI_GRID) {
    let ghi = 0
    if (hour >= 5.5 && hour <= 19.5) {
      const hourFactor = Math.max(0, Math.sin((hour - 5.5) / 14 * Math.PI))
      const spatial = Math.sin(cell.lat * 137.5) * 60 + Math.cos(cell.lon * 89.3) * 40
      ghi = Math.round(Math.max(0, (820 + spatial) * hourFactor))
    }
    m.set(cell.id, ghi)
  }
  return m
}

// Precompute hex vertices (static, never changes)
const HEX_VERTICES = GHI_GRID.map(cell => ({
  id: cell.id,
  lat: cell.lat,
  lon: cell.lon,
  vertices: hexVertices(cell.lat, cell.lon),
}))

export default memo(function GhiGridOverlay({ visible, pvUsers }: Props) {
  const map = useMap()
  const groupRef = useRef<L.LayerGroup | null>(null)
  const polysRef = useRef<Map<string, L.Polygon>>(new Map())
  const tooltipRef = useRef<L.Tooltip | null>(null)
  const ghiRef = useRef<Map<string, number>>(new Map())
  const builtRef = useRef(false)
  const linesGroupRef = useRef<L.LayerGroup | null>(null)
  const [tick, setTick] = useState(0)

  // Fetch satellite GHI every 60 seconds
  useEffect(() => {
    if (!visible) return
    let cancelled = false

    const fetchData = async () => {
      const data = await fetchSatelliteGhi()
      if (!cancelled) {
        ghiRef.current = data
        setTick(t => t + 1) // trigger color update
      }
    }

    fetchData() // immediate first fetch
    const timer = setInterval(fetchData, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [visible])

  const ghiValues = ghiRef.current

  // Build layer group ONCE, then show/hide — never destroy/recreate
  useEffect(() => {
    if (builtRef.current) return // already built

    const group = L.layerGroup()
    groupRef.current = group
    const polys = new Map<string, L.Polygon>()

    for (const hex of HEX_VERTICES) {
      const ghi = ghiRef.current.get(hex.id) ?? 0
      const poly = L.polygon(hex.vertices, {
        color: 'rgba(219,161,74,0.15)',
        weight: 0.5,
        fillColor: ghiColor(ghi),
        fillOpacity: 0.35,
        bubblingMouseEvents: false,
      })

      poly.on('mouseover', () => {
        poly.setStyle({ color: '#dba14a', weight: 1.5, fillOpacity: 0.55 })
        if (tooltipRef.current) map.closeTooltip(tooltipRef.current)

        const currentGhi = ghiRef.current.get(hex.id) ?? 0
        const colorStr = currentGhi > 500 ? '#dba14a' : currentGhi > 0 ? '#6ec472' : '#78746b'
        tooltipRef.current = L.tooltip({ direction: 'top', offset: [0, -10], className: 'ghi-tooltip' })
          .setLatLng([hex.lat, hex.lon])
          .setContent(
            `<div style="font-family:Fira Code,monospace;font-size:11px;color:#f0ede6;background:rgba(14,15,21,0.92);padding:6px 10px;border-radius:6px;border:1px solid rgba(219,161,74,0.2)">` +
            `<div style="font-size:10px;color:#78746b;margin-bottom:2px">${hex.id}</div>` +
            `<div style="font-size:13px;font-weight:600">GHI <span style="color:${colorStr}">${currentGhi}</span> W/m²</div>` +
            `</div>`
          )
          .addTo(map)
      })

      poly.on('mouseout', () => {
        const g = ghiRef.current.get(hex.id) ?? 0
        poly.setStyle({ color: 'rgba(219,161,74,0.15)', weight: 0.5, fillColor: ghiColor(g), fillOpacity: 0.35 })
        if (tooltipRef.current) {
          map.closeTooltip(tooltipRef.current)
          tooltipRef.current = null
        }
      })

      poly.addTo(group)
      polys.set(hex.id, poly)
    }

    // Substation markers
    for (const ss of SUBSTATIONS) {
      const icon = L.divIcon({
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        html: `
          <div style="
            transform: translate(-50%, -50%);
            white-space: nowrap;
            pointer-events: none;
            text-align: center;
          ">
            <div style="
              width: 10px; height: 10px;
              background: #FF9800;
              border: 1.5px solid rgba(255,255,255,0.6);
              border-radius: 2px;
              transform: rotate(45deg);
              margin: 0 auto 4px;
              box-shadow: 0 0 8px rgba(255,152,0,0.5);
            "></div>
            <div style="
              font-family: 'Fira Code', monospace;
              font-size: 9px;
              color: #FF9800;
              text-shadow: 0 0 4px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.9);
              font-weight: 600;
              letter-spacing: 0.3px;
            ">${ss.name.replace('变电站', '')}</div>
          </div>
        `,
      })
      L.marker([ss.lat, ss.lon], { icon, interactive: false }).addTo(group)
    }

    polysRef.current = polys
    builtRef.current = true

    return () => {
      if (tooltipRef.current) { map.closeTooltip(tooltipRef.current); tooltipRef.current = null }
      map.removeLayer(group)
      groupRef.current = null
      polysRef.current.clear()
      builtRef.current = false
    }
  }, [map])

  // Power lines: PV user → substation (simple polylines)
  useEffect(() => {
    if (linesGroupRef.current) {
      if (map.hasLayer(linesGroupRef.current)) map.removeLayer(linesGroupRef.current)
      linesGroupRef.current = null
    }

    if (!visible || pvUsers.length === 0) return

    const ssMap = new Map(SUBSTATIONS.map(s => [s.id, s]))
    // Use SVG renderer so CSS dash animation works (Canvas doesn't support it)
    const svgRenderer = L.svg({ padding: 0.1 })
    const group = L.layerGroup()

    for (const u of pvUsers) {
      if (!u.substation_id) continue
      const ss = ssMap.get(u.substation_id)
      if (!ss) continue

      const line = L.polyline(
        [[u.lat, u.lon], [ss.lat, ss.lon]],
        {
          color: '#6ec472',
          weight: 1,
          opacity: 0.4,
          dashArray: '4 8',
          interactive: false,
          renderer: svgRenderer,
          className: 'power-flow-line',
        }
      )
      line.addTo(group)
    }

    group.addTo(map)
    linesGroupRef.current = group

    return () => {
      if (linesGroupRef.current) {
        if (map.hasLayer(linesGroupRef.current)) map.removeLayer(linesGroupRef.current)
        linesGroupRef.current = null
      }
    }
  }, [visible, pvUsers, map])

  // Show/hide hex grid group
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    if (visible) {
      if (!map.hasLayer(group)) group.addTo(map)
    } else {
      if (map.hasLayer(group)) map.removeLayer(group)
      if (tooltipRef.current) { map.closeTooltip(tooltipRef.current); tooltipRef.current = null }
    }
  }, [visible, map])

  // Update fill colors when GHI values change (tick refresh)
  useEffect(() => {
    if (!visible) return
    for (const [id, poly] of polysRef.current) {
      const ghi = ghiValues.get(id) ?? 0
      poly.setStyle({ fillColor: ghiColor(ghi) })
    }
  }, [ghiValues, visible])

  return null
})
