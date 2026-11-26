/**
 * 左栏「画布设置」页面（2026-11-25）。
 *
 * 目标：把散在全局设置页与画布状态抽屉里的画布配置收口到画布就地可调的一页，
 * 后续画布状态里的其余配置项也按同一套「可折叠分区」继续往里搬。
 *
 * 布局契约：
 *  - 页面本体由 NodeTreePanel 外壳承载（标题栏 / 可拖宽度 / 让位变量都在外壳），
 *    四页共用一个宽度，内容全部 w-full / min-w-0 自适应，不碰画布几何；
 *  - 每个分区独立折叠、DOM 常驻（折叠只改 max-height / opacity），
 *    新增配置项只需再加一个 SettingsSection，不必改外壳或导航；
 *  - 三个分区的数据源互不重叠：视图 = lodPreferences + roomProfiles，
 *    画布编辑 = graphUiStore，样式 = 工作区 _config.json（StyleSection）。
 */
import { memo, useState, type ReactNode } from 'react'
import { ChevronRight, Crosshair, Eye, Layers3, Palette, type LucideIcon } from 'lucide-react'
import { useGraphUiStore } from '@/stores/graphUiStore'
import LeftDockCollapseButton from '@/features/layout/LeftDockCollapseButton'
import StyleSection from '@/features/right-panel/components/StyleTab/StyleSection'
import CanvasViewSettings from './CanvasViewSettings'

type SectionId = 'view' | 'editing' | 'style'

interface SettingsSectionProps {
  id: SectionId
  title: string
  icon: LucideIcon
  hint: string
  open: boolean
  onToggle: () => void
  children: ReactNode
  /** 只给首个分区用：删掉外壳冗余标题行后，左栏折叠按钮落在这一行的最右边。 */
  trailing?: ReactNode
}

/** 统一分区壳：标题行即折叠开关，内容 DOM 常驻，收起后仍可被回归脚本读取。
 *  trailing 与折叠开关是兄弟节点（不是 button 套 button），保证点击互不误触。 */
function SettingsSection({ id, title, icon: Icon, hint, open, onToggle, children, trailing }: SettingsSectionProps) {
  return (
    <section
      data-tm-canvas-settings-section={id}
      data-tm-canvas-settings-section-open={open ? 'true' : 'false'}
      className="border-b border-[var(--color-border-light)] last:border-b-0"
    >
      <div className="flex items-center">
        <button
          type="button"
          data-tm-canvas-settings-section-toggle={id}
          aria-expanded={open}
          title={open ? `折叠${title}` : `展开${title}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left hover:bg-[var(--color-hover-bg)]"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
          <span className="shrink-0 font-medium text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-base)' }}>{title}</span>
          <span className="tm-hint ml-auto truncate">{hint}</span>
        </button>
        {trailing && <div className="shrink-0 pr-1.5">{trailing}</div>}
      </div>
      <div
        aria-hidden={!open}
        className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
          open ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="px-3 pb-3 pt-0.5">{children}</div>
      </div>
    </section>
  )
}

/** 智能参考线与对齐吸附：与全局设置页原本的开关共用 graphUiStore 同一字段。 */
function CanvasEditingSettings() {
  const enabled = useGraphUiStore((s) => s.smartGuidesEnabled !== false)
  const setEnabled = useGraphUiStore((s) => s.setSmartGuidesEnabled)

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-base)' }}>智能参考线与对齐吸附</div>
        <div className="tm-hint mt-0.5 leading-relaxed">
          开启时松手保持对齐；按住 Alt 拖动可临时忽略吸附，自由摆放
        </div>
      </div>
      <div data-tm-canvas-smart-guides="" className="flex shrink-0 gap-1">
        <button
          type="button"
          aria-pressed={enabled}
          onClick={() => setEnabled(true)}
          className={enabled ? 'tm-btn tm-btn--active' : 'tm-btn'}
        >开启</button>
        <button
          type="button"
          aria-pressed={!enabled}
          onClick={() => setEnabled(false)}
          className={!enabled ? 'tm-btn tm-btn--active' : 'tm-btn'}
        >关闭</button>
      </div>
    </div>
  )
}

export default memo(function CanvasSettingsPanel({ tabId }: { tabId: string }) {
  // 默认全展开：一页内能看到全部已迁入项；分区状态只在本页生命周期内有效，不落盘。
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    view: true,
    editing: true,
    style: true,
  })
  const toggle = (id: SectionId) => () => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <div data-tm-canvas-settings-panel="" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)]">
        <SettingsSection
          id="view"
          title="视图"
          icon={Eye}
          hint="镜头 / 图型 / 置顶"
          open={openSections.view}
          onToggle={toggle('view')}
          trailing={<LeftDockCollapseButton />}
        >
          <CanvasViewSettings tabId={tabId} />
        </SettingsSection>

        <SettingsSection
          id="editing"
          title="画布编辑"
          icon={Crosshair}
          hint="对齐吸附"
          open={openSections.editing}
          onToggle={toggle('editing')}
        >
          <CanvasEditingSettings />
        </SettingsSection>

        <SettingsSection
          id="style"
          title="节点与连线样式"
          icon={Palette}
          hint="全局默认"
          open={openSections.style}
          onToggle={toggle('style')}
        >
          <p className="tm-hint mb-2 leading-relaxed">
            全局默认样式、尺寸约束与连线关系保存在工作区配置中，对所有知识库生效；单个节点 / 连线的即时样式仍从画布右键菜单进入。
          </p>
          <div
            data-tm-canvas-settings-style=""
            className="h-[440px] overflow-hidden rounded-lg border border-[var(--color-border-light)]"
          >
            {/* 与全局设置页原本完全一致：active=false 只编辑工作区全局默认样式，
                不会跟随画布选中节点（单节点即时样式仍走右键菜单）。 */}
            <StyleSection active={false} showReadOnlyHint={false} />
          </div>
        </SettingsSection>

        {/* 后续画布状态里的配置项按同一分区壳继续迁入，不必再改导航与外壳。 */}
        <div
          data-tm-canvas-settings-slot=""
          className="tm-hint flex items-center gap-1.5 px-3 py-3"
        >
          <Layers3 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>其余画布状态配置项将按分区陆续迁入此页</span>
        </div>
      </div>

      <div className="tm-hint flex h-7 shrink-0 items-center border-t border-[var(--color-border-light)] px-3">
        修改后立即生效并自动保存
      </div>
    </div>
  )
})
