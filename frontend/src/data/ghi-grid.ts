/**
 * 金山区 GHI 采样网格（正六边形蜂窝 pointy-top）
 *
 * 47个蜂窝格，每格 ~2.7km circumradius
 * 六边形经纬度比例校正：s_lat = s_lon × (95.5/111) 确保屏幕上是正六边形
 * 边缘覆盖：六边形只要与区界有重叠就保留
 */

export interface GridCell {
  id: string
  row: number
  col: number
  lat: number
  lon: number
}

const S_LON = 0.028
const LAT_LON_RATIO = 95.5 / 111
const S_LAT = S_LON * LAT_LON_RATIO

export const COL_SPACING = Math.sqrt(3) * S_LON
export const ROW_SPACING = 1.5 * S_LAT
export const HEX_S_LON = S_LON
export const HEX_S_LAT = S_LAT

export const GHI_GRID: GridCell[] = [
  { id: "H-0-1", row: 0, col: 1, lat: 30.955, lon: 121.0164 },
  { id: "H-1-0", row: 1, col: 0, lat: 30.9189, lon: 120.9921 },
  { id: "H-1-1", row: 1, col: 1, lat: 30.9189, lon: 121.0406 },
  { id: "H-1-2", row: 1, col: 2, lat: 30.9189, lon: 121.0891 },
  { id: "H-1-3", row: 1, col: 3, lat: 30.9189, lon: 121.1376 },
  { id: "H-1-4", row: 1, col: 4, lat: 30.9189, lon: 121.1861 },
  { id: "H-1-5", row: 1, col: 5, lat: 30.9189, lon: 121.2346 },
  { id: "H-1-6", row: 1, col: 6, lat: 30.9189, lon: 121.2831 },
  { id: "H-1-7", row: 1, col: 7, lat: 30.9189, lon: 121.3316 },
  { id: "H-2-0", row: 2, col: 0, lat: 30.8827, lon: 120.9679 },
  { id: "H-2-1", row: 2, col: 1, lat: 30.8827, lon: 121.0164 },
  { id: "H-2-2", row: 2, col: 2, lat: 30.8827, lon: 121.0649 },
  { id: "H-2-3", row: 2, col: 3, lat: 30.8827, lon: 121.1134 },
  { id: "H-2-4", row: 2, col: 4, lat: 30.8827, lon: 121.1619 },
  { id: "H-2-5", row: 2, col: 5, lat: 30.8827, lon: 121.2104 },
  { id: "H-2-6", row: 2, col: 6, lat: 30.8827, lon: 121.2589 },
  { id: "H-2-7", row: 2, col: 7, lat: 30.8827, lon: 121.3074 },
  { id: "H-2-8", row: 2, col: 8, lat: 30.8827, lon: 121.3559 },
  { id: "H-3-0", row: 3, col: 0, lat: 30.8466, lon: 120.9921 },
  { id: "H-3-1", row: 3, col: 1, lat: 30.8466, lon: 121.0406 },
  { id: "H-3-2", row: 3, col: 2, lat: 30.8466, lon: 121.0891 },
  { id: "H-3-3", row: 3, col: 3, lat: 30.8466, lon: 121.1376 },
  { id: "H-3-4", row: 3, col: 4, lat: 30.8466, lon: 121.1861 },
  { id: "H-3-5", row: 3, col: 5, lat: 30.8466, lon: 121.2346 },
  { id: "H-3-6", row: 3, col: 6, lat: 30.8466, lon: 121.2831 },
  { id: "H-3-7", row: 3, col: 7, lat: 30.8466, lon: 121.3316 },
  { id: "H-3-8", row: 3, col: 8, lat: 30.8466, lon: 121.3801 },
  { id: "H-4-1", row: 4, col: 1, lat: 30.8105, lon: 121.0164 },
  { id: "H-4-3", row: 4, col: 3, lat: 30.8105, lon: 121.1134 },
  { id: "H-4-10", row: 4, col: 10, lat: 30.8105, lon: 121.4529 },
  { id: "H-4-4", row: 4, col: 4, lat: 30.8105, lon: 121.1619 },
  { id: "H-4-5", row: 4, col: 5, lat: 30.8105, lon: 121.2104 },
  { id: "H-4-6", row: 4, col: 6, lat: 30.8105, lon: 121.2589 },
  { id: "H-4-7", row: 4, col: 7, lat: 30.8105, lon: 121.3074 },
  { id: "H-4-8", row: 4, col: 8, lat: 30.8105, lon: 121.3559 },
  { id: "H-4-9", row: 4, col: 9, lat: 30.8105, lon: 121.4044 },
  { id: "H-5-3", row: 5, col: 3, lat: 30.7743, lon: 121.1376 },
  { id: "H-5-4", row: 5, col: 4, lat: 30.7743, lon: 121.1861 },
  { id: "H-5-5", row: 5, col: 5, lat: 30.7743, lon: 121.2346 },
  { id: "H-5-6", row: 5, col: 6, lat: 30.7743, lon: 121.2831 },
  { id: "H-5-7", row: 5, col: 7, lat: 30.7743, lon: 121.3316 },
  { id: "H-5-8", row: 5, col: 8, lat: 30.7743, lon: 121.3801 },
  { id: "H-5-9", row: 5, col: 9, lat: 30.7743, lon: 121.4286 },
  { id: "H-6-6", row: 6, col: 6, lat: 30.7382, lon: 121.2589 },
  { id: "H-6-7", row: 6, col: 7, lat: 30.7382, lon: 121.3074 },
  { id: "H-6-8", row: 6, col: 8, lat: 30.7382, lon: 121.3559 },
  { id: "H-6-9", row: 6, col: 9, lat: 30.7382, lon: 121.4044 },
  { id: "H-7-6", row: 7, col: 6, lat: 30.7021, lon: 121.2831 },
  { id: "H-7-7", row: 7, col: 7, lat: 30.7021, lon: 121.3316 },
  { id: "H-7-9", row: 7, col: 9, lat: 30.7021, lon: 121.4286 },
]
