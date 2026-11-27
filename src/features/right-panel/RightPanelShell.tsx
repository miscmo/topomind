import { memo } from 'react'
import { Palette } from 'lucide-react'
import DetailPanel from './components/DetailTab/DetailPanel'
import { ReferencePreviewPanel } from './components/DetailTab/ReferencePreviewPanel'
import { useReferencePreviewStore } from './model/referencePreviewStore'
import { useNodeTreePanelStore } from '@/stores/nodeTreePanelStore'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import type { RightPanelTab } from '../../types/uiStoreTypes'

interface RightPanelShellProps {
  tabId: string
  rightPanelTab: RightPanelTab
  width: number | string
  onTabChange: (tab: RightPanelTab) => void
  onCollapse: () => void
  isActive?: boolean
}

/**
 * 右栏外壳：详情常驻挂载；样式分区已迁到左栏「画布设置」页，这里只留一条引导。
 * 两个分区都用 CSS hidden 常驻（不能卸载，否则会丢面板内部状态），
 * 外壳 overflow-clip 而非 hidden —— 程序化滚动会带动编辑器正文整体上移、底部露白。
 */
export default memo(function RightPanelShell({ tabId, rightPanelTab, width, isActive = true }: RightPanelShellProps) {
  const hasReferencePreview = useReferencePreviewStore((state) => state.target !== null)
  const showReferencePreview = hasReferencePreview && isActive && rightPanelTab === 'detail'
  const openStyleSettings = () => {
    // 样式面板已迁入左栏「画布设置」页：这里只把左栏切过去并展开，
    // 不再打开二级设置视图（那里只剩一条引导说明）。
    // 已经在该页且展开时不重复点击，否则 setActivePanel 会反向折叠。
    const state = useNodeTreePanelStore.getState()
    if (state.activePanelId !== 'canvasSettings' || state.collapsed) {
      state.setActivePanel('canvasSettings')
    }
  }

  return (
    <div className="h-full bg-[var(--titlebar-menu-bg)] shrink-0 overflow-clip border-l border-[var(--color-border)] shadow-[-4px_0_24px_rgba(0,0,0,0.06)] flex flex-col transform-gpu" style={{ width }}>
      <div className={rightPanelTab === 'detail' ? 'relative flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'} aria-hidden={rightPanelTab !== 'detail'}>
        {/* 预览层是绝对覆盖：DetailPanel 保持挂载，关闭后草稿 / 滚动位置原样恢复。 */}
        <DetailPanel tabId={tabId} isActive={isActive && rightPanelTab === 'detail'} />
        {showReferencePreview && <ReferencePreviewPanel />}
      </div>
      <div className={rightPanelTab === 'style' ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'} aria-hidden={rightPanelTab !== 'style'}>
        <div data-tm-settings-style-entry="" className="m-auto flex max-w-[320px] flex-col items-center gap-3 px-6 text-center">
          <span className={tmUI(TM_UI.badgeAccent, 'h-10 w-10')}>
            <Palette className={TM_UI.iconLg} aria-hidden="true" />
          </span>
          <div className={TM_UI.label}>样式设置已迁移到左栏「画布设置」</div>
          <p className={TM_UI.hint}>
            节点卡片、连线样式与连线关系的全局默认值现在统一在画布页左栏配置，修改后对所有知识库生效。
          </p>
          <button
            type="button"
            onClick={openStyleSettings}
            className={TM_UI.buttonPrimary}
          >
            打开画布设置
          </button>
        </div>
      </div>
    </div>
  )
})
