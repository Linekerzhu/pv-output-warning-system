import { memo } from 'react'

type MobileTab = 'map' | 'chart' | 'alerts'

interface Props {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
  warningCount: number
  hasChartData: boolean
}

export default memo(function MobileTabBar({ activeTab, onTabChange, warningCount, hasChartData }: Props) {
  return (
    <nav aria-label="移动端导航" className="fixed bottom-0 left-0 right-0 z-30 mobile-tab-bar">
      <button
        className={`mobile-tab ${activeTab === 'map' ? 'active' : ''}`}
        onClick={() => onTabChange('map')}
        aria-label="地图视图"
        aria-current={activeTab === 'map' ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <span>地图</span>
      </button>

      <button
        className={`mobile-tab ${activeTab === 'chart' ? 'active' : ''}`}
        onClick={() => onTabChange('chart')}
        aria-label="出力图表"
        aria-current={activeTab === 'chart' ? 'page' : undefined}
        aria-disabled={!hasChartData}
        style={{ opacity: hasChartData ? 1 : 0.4 }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
        </svg>
        <span>出力</span>
      </button>

      <button
        className={`mobile-tab ${activeTab === 'alerts' ? 'active' : ''}`}
        onClick={() => onTabChange('alerts')}
        aria-label={`预警${warningCount > 0 ? `，${warningCount} 条` : ''}`}
        aria-current={activeTab === 'alerts' ? 'page' : undefined}
        style={{ position: 'relative' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span>预警</span>
        {warningCount > 0 && (
          <span style={{
            position: 'absolute',
            top: 2,
            right: 8,
            background: 'var(--solar-coral)',
            color: 'var(--text-bright)',
            fontSize: 8,
            fontFamily: 'var(--font-data)',
            fontWeight: 600,
            minWidth: 14,
            height: 14,
            borderRadius: 7,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            boxShadow: 'var(--glow-coral)',
          }}>
            {warningCount}
          </span>
        )}
      </button>
    </nav>
  )
})
