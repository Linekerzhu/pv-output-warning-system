import { memo, useMemo } from 'react'
import { Polygon, Tooltip } from 'react-leaflet'
import { GHI_GRID, HEX_S_LAT, HEX_S_LON } from '../data/ghi-grid'

interface Props {
  visible: boolean
}

// Precompute half-width (used in every vertex calc)
const HALF_W = HEX_S_LON * Math.sqrt(3) / 2  // ≈ col_spacing / 2

/**
 * Pointy-top hexagon vertices — tessellates perfectly with the grid layout.
 *
 *       /\
 *      /  \
 *     /    \
 *     \    /
 *      \  /
 *       \/
 */
function hexVertices(lat: number, lon: number): [number, number][] {
  return [
    [lat + HEX_S_LAT, lon],                 // top
    [lat + HEX_S_LAT / 2, lon + HALF_W],    // upper-right
    [lat - HEX_S_LAT / 2, lon + HALF_W],    // lower-right
    [lat - HEX_S_LAT, lon],                 // bottom
    [lat - HEX_S_LAT / 2, lon - HALF_W],    // lower-left
    [lat + HEX_S_LAT / 2, lon - HALF_W],    // upper-left
  ]
}

/** GHI → color: 0=cool blue → 500=green-yellow → 1000=warm orange */
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

/** Mock GHI with time-of-day and spatial variation */
function mockGhi(lat: number, lon: number): number {
  const now = new Date()
  const hour = now.getHours() + now.getMinutes() / 60
  if (hour < 5.5 || hour > 19.5) return 0
  const hourFactor = Math.max(0, Math.sin((hour - 5.5) / 14 * Math.PI))
  const spatial = Math.sin(lat * 137.5) * 60 + Math.cos(lon * 89.3) * 40
  return Math.round(Math.max(0, (820 + spatial) * hourFactor))
}

export default memo(function GhiGridOverlay({ visible }: Props) {
  const cells = useMemo(() => {
    if (!visible) return []
    return GHI_GRID.map(cell => ({
      ...cell,
      vertices: hexVertices(cell.lat, cell.lon),
      ghi: mockGhi(cell.lat, cell.lon),
    }))
  }, [visible])

  if (!visible) return null

  return (
    <>
      {cells.map(cell => (
        <Polygon
          key={cell.id}
          positions={cell.vertices}
          pathOptions={{
            color: 'rgba(219,161,74,0.15)',
            weight: 0.5,
            fillColor: ghiColor(cell.ghi),
            fillOpacity: 0.35,
          }}
          interactive={true}
          bubblingMouseEvents={false}
        >
          <Tooltip direction="top" sticky>
            <div style={{
              fontFamily: 'Fira Code, monospace',
              fontSize: 11,
              color: '#f0ede6',
              background: 'rgba(14,15,21,0.92)',
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid rgba(219,161,74,0.2)',
            }}>
              <div style={{ fontSize: 10, color: '#78746b', marginBottom: 2 }}>{cell.id}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                GHI{' '}
                <span style={{ color: cell.ghi > 500 ? '#dba14a' : cell.ghi > 0 ? '#6ec472' : '#78746b' }}>
                  {cell.ghi}
                </span>{' '}
                W/m²
              </div>
            </div>
          </Tooltip>
        </Polygon>
      ))}
    </>
  )
})
