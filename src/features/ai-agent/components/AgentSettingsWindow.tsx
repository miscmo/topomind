/**
 * 画布页覆盖式「AI 设置」窗口。
 *
 * 几何契约（见 useWorkspaceGeometry / workspaceGeometry）：
 *   left = --tm-workspace-left-boundary（导航栏 + 左栏对话页的右缘 B）、right = 0、
 *   inset-y = 0。因此窗口贴住应用右边界，铺满左侧对话页之外的整个知识库画布区；
 *   画布与右栏文档面板都留在原位、只是被盖住，画布宽度 / React Flow viewport 不变。
 *   层级 --z-ai-settings-window 高于右栏 z-30 与画布浮层，低于 fixed 右键菜单 /
 *   全局模态；与 NavRail 零重叠靠同一个边界变量保证，不靠 z-index 互相遮挡。
 *
 * 交互：左栏对话面板完全可见且可输入，设置改动立即生效，可边调边聊。
 * 根上的 data-tm-keep-right-panel 让右栏的失焦自动折叠把本窗口当作「浮层」：
 * 焦点移进设置窗口不会把正在编辑的文档面板卸掉，关掉窗口即可继续看文档。
 *
 * 视觉类一律取 TM_UI / controls.css，组件里只放布局类；不写字面色值与 z-index。
 */
import { useEffect } from 'react'
import { Bot, Sparkles, X } from 'lucide-react'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import AiSettingsSection from '@/features/settings/AiSettingsSection'
import AgentSettingsSection from '@/features/settings/AgentSettingsSection'
import {
  AI_SETTINGS_TABS,
  useAgentSettingsWindowStore,
  type AiSettingsTabId,
} from '../model/agentSettingsWindowStore'

const TAB_ICONS: Record<AiSettingsTabId, typeof Sparkles> = {
  assistant: Sparkles,
  agents: Bot,
}

export default function AgentSettingsWindow() {
  const open = useAgentSettingsWindowStore((state) => state.open)
  const activeTab = useAgentSettingsWindowStore((state) => state.activeTab)
  const setActiveTab = useAgentSettingsWindowStore((state) => state.setActiveTab)
  const closeWindow = useAgentSettingsWindowStore((state) => state.closeWindow)

  // Esc 关闭；全局模态 / 菜单打开期间不抢 Esc（它们的取消语义优先）。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      event.preventDefault()
      useAgentSettingsWindowStore.getState().closeWindow()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return (
    <aside
      role="region"
      aria-label="AI 设置"
      data-tm-ai-settings-window=""
      data-tm-ai-settings-active-tab={activeTab}
      data-tm-keep-right-panel=""
      className={tmUI(TM_UI.aiSettingsWindow, 'absolute inset-y-0 right-0 tm-fade-enter')}
      style={{ left: 'var(--tm-workspace-left-boundary, 0px)' }}
    >
      <div className={TM_UI.aiSettingsHeader} data-tm-ai-settings-header="">
        <span className={TM_UI.aiSettingsTitle}>
          <Sparkles className={TM_UI.iconLg} />
          AI 设置
        </span>

        <div
          role="tablist"
          aria-label="AI 设置分区"
          className={TM_UI.aiSettingsTabs}
          data-tm-ai-settings-tabs=""
        >
          {AI_SETTINGS_TABS.map((tab) => {
            const Icon = TAB_ICONS[tab.id]
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-tm-ai-settings-tab={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={active ? TM_UI.aiSettingsTabActive : TM_UI.aiSettingsTab}
              >
                <Icon className={TM_UI.aiSettingsTabIcon} />
                {tab.label}
              </button>
            )
          })}
        </div>

        <span className={tmUI(TM_UI.hint, 'shrink-0')}>Esc 关闭</span>

        <button
          type="button"
          title="关闭 AI 设置"
          aria-label="关闭 AI 设置"
          onClick={closeWindow}
          className={tmUI(TM_UI.iconButton, TM_UI.aiSettingsClose)}
          data-tm-ai-settings-close=""
        >
          <X className={TM_UI.icon} />
        </button>
      </div>

      {/* 两个分区常驻挂载、只切显隐：切 tab 不清空已填一半的表单 / 已展开的
          工具目录 / 已加载的 Agent 草稿，符合「边调边测」的连续工作流。 */}
      <div className={TM_UI.aiSettingsBody} data-tm-ai-settings-body="">
        <div className={TM_UI.aiSettingsContent}>
          <div hidden={activeTab !== 'assistant'} data-tm-ai-settings-pane="assistant">
            <AiSettingsSection />
          </div>
          <div hidden={activeTab !== 'agents'} data-tm-ai-settings-pane="agents">
            <AgentSettingsSection />
          </div>
        </div>
      </div>

      <div className={TM_UI.aiSettingsFooter} data-tm-ai-settings-footer="">
        <span className={TM_UI.aiSessionOpenDot} aria-hidden="true" />
        左侧对话保持可用 · 修改立即生效并自动保存 · 可边调整边测试对话
      </div>
    </aside>
  )
}
