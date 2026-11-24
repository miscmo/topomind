/**
 * 全局设置页（宿主视图 host.settings）
 * 把原先散落在 localStorage / 各 store 的布局与样式偏好收口到一个可见入口。
 * 所有控件都是真实可用的，不再有 disabled 占位。
 *
 * 2026-11-21：导航栏显隐收敛为标题栏单一全局按钮，这里不再提供第二套三态控件；
 * 右侧「样式」分区迁入本页（StyleSection 通过 useOptionalGraphContext 降级为全局默认样式）。
 * 2026-11-23：外观分区新增「应用主题色」。UI 只负责选色，色阶派生 / 调和 / 注入
 * 全部由 src/domain/theme/ 统一管理，本页不保存第二份色值定义。
 */
import { memo, useEffect, useState } from 'react'
import { Book, Check, Crosshair, ExternalLink, FolderOpen, Layers3, Palette, SunMoon } from 'lucide-react'
import { executeCommand } from '@/application/commands'
import { ACCENT_PRESETS } from '@/domain/theme/accentPresets'
import {
  DEFAULT_ACCENT_COLOR,
  harmonizeAccentColor,
  isSameAccentColor,
  normalizeAccentColor,
} from '@/domain/theme/accentColor'
import { useLayoutStore } from '@/stores/layoutStore'
import { useThemeStore, LIGHT_THEME, DARK_THEME } from '@/stores/themeStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGraphUiStore } from '@/stores/graphUiStore'
import { useTabStore } from '@/stores/tabs/tabStore'
import { HOST_VIEW_IDS } from '@/features/layout/NavRail/navModel'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import StyleSection from '@/features/right-panel/components/StyleTab/StyleSection'

const SECTION = 'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5'
const SECTION_TITLE = 'mb-1 flex items-center gap-2 text-[14px] font-medium text-[var(--color-text-primary)]'
const SECTION_HINT = 'mb-4 text-[12px] leading-relaxed text-[var(--color-text-muted)]'
const ROW = 'flex items-center justify-between gap-4 border-b border-[var(--color-border-light)] py-3 last:border-b-0'
const LABEL = 'text-[13px] text-[var(--color-text-primary)]'
const DESC = 'mt-0.5 text-[11px] text-[var(--color-text-muted)]'
const BTN = 'h-8 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-hover-bg)]'
const SEG_BTN = (active: boolean) =>
  `h-8 rounded-md border px-3 text-[12px] cursor-pointer transition-colors ${active
    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]'}`

export default memo(function SettingsPage() {
  const resetNavigation = useLayoutStore((state) => state.resetNavigation)
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const smartGuidesEnabled = useGraphUiStore((state) => state.smartGuidesEnabled !== false)
  const setSmartGuidesEnabled = useGraphUiStore((state) => state.setSmartGuidesEnabled)
  const currentWorkDir = useWorkspaceStore((state) => state.currentWorkDir)

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-app)] px-8 py-10">
      <div className="mx-auto w-full max-w-[720px]">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">设置</h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">导航、外观、样式与工作区偏好 · 修改后立即生效并自动保存</p>
        </div>

        <div className={SECTION}>
          <h2 className={SECTION_TITLE}><Layers3 className="h-4 w-4 text-[var(--color-accent)]" />导航与布局</h2>
          <p className={SECTION_HINT}>导航栏是覆盖式浮层，显示或隐藏都不会改变画布尺寸与所有画布控件坐标。</p>
          <div className={ROW}>
            <div>
              <div className={LABEL}>左侧导航栏</div>
              <div className={DESC}>由标题栏最左侧按钮全局控制，在首页、画布、系统页行为一致；此处不再重复提供开关</div>
            </div>
            <span className={tmUI(TM_UI.hint, 'shrink-0')}>标题栏按钮</span>
          </div>
          <div className={ROW}>
            <div>
              <div className={LABEL}>重置导航与布局偏好</div>
              <div className={DESC}>恢复默认显示导航栏，不影响知识库数据</div>
            </div>
            <button type="button" onClick={resetNavigation} className={BTN}>重置</button>
          </div>
        </div>

        <div className={`${SECTION} mt-4`} data-tm-settings-accent="">
          <h2 className={SECTION_TITLE}><SunMoon className="h-4 w-4 text-[var(--color-accent)]" />外观</h2>
          <p className={SECTION_HINT}>
            主题色统一管理按钮、选中态、链接、焦点环、标题栏激活态与画布高亮；切换深浅主题时会自动派生配套色阶。
          </p>
          <div className={ROW}>
            <div>
              <div className={LABEL}>主题</div>
              <div className={DESC}>当前：{theme === DARK_THEME ? '深色' : '浅色'}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button type="button" onClick={() => setTheme(LIGHT_THEME)} aria-pressed={theme === LIGHT_THEME} className={SEG_BTN(theme === LIGHT_THEME)}>浅色</button>
              <button type="button" onClick={() => setTheme(DARK_THEME)} aria-pressed={theme === DARK_THEME} className={SEG_BTN(theme === DARK_THEME)}>深色</button>
            </div>
          </div>
          <div className="py-3">
            <div className={LABEL}>应用主题色</div>
            <div className={DESC}>选择预设或自定义颜色，修改后立即生效并自动保存；过亮或过艳的颜色会自动微调，保证文字始终清晰</div>
            <AccentColorControl />
          </div>
        </div>

        <div className={`${SECTION} mt-4`}>
          <h2 className={SECTION_TITLE}><Crosshair className="h-4 w-4 text-[var(--color-accent)]" />画布编辑</h2>
          <p className={SECTION_HINT}>
            拖动节点时的对齐参考线与吸附。只在中心对齐或同侧边缘对齐时出现，不会跟视口外的节点对齐。
          </p>
          <div className={ROW}>
            <div>
              <div className={LABEL}>智能参考线与对齐吸附</div>
              <div className={DESC}>开启时松手保持对齐位置；按住 Alt 拖动可临时忽略吸附，自由摆放</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => setSmartGuidesEnabled(true)}
                aria-pressed={smartGuidesEnabled}
                className={SEG_BTN(smartGuidesEnabled)}
              >开启</button>
              <button
                type="button"
                onClick={() => setSmartGuidesEnabled(false)}
                aria-pressed={!smartGuidesEnabled}
                className={SEG_BTN(!smartGuidesEnabled)}
              >关闭</button>
            </div>
          </div>
        </div>

        {/* 样式设置从右侧「样式」分区迁入：全局默认样式与连线关系都写 _config.json。
            节点 / 连线级即时编辑仍走画布右键入口，设置页用 optional GraphContext 降级。 */}
        <div className={`${SECTION} mt-4`} data-tm-settings-style="">
          <h2 className={SECTION_TITLE}><Palette className="h-4 w-4 text-[var(--color-accent)]" />节点与连线样式</h2>
          <p className={SECTION_HINT}>
            全局默认样式、尺寸约束与连线关系定义保存在工作区配置中，对所有知识库生效；
            单个节点 / 连线的即时样式仍从画布右键菜单进入。
          </p>
          <div className="mt-4 h-[560px] overflow-hidden rounded-lg border border-[var(--color-border-light)]">
            <StyleSection active={false} showReadOnlyHint={false} />
          </div>
        </div>

        <div className={`${SECTION} mt-4`}>
          <h2 className={SECTION_TITLE}><FolderOpen className="h-4 w-4 text-[var(--color-accent)]" />工作区</h2>
          <p className={SECTION_HINT}>所有知识库、文档与画布数据都保存在本地工作目录。</p>
          <div className={ROW}>
            <div className="min-w-0">
              <div className={LABEL}>当前工作目录</div>
              <div className={`${DESC} truncate`} title={currentWorkDir ?? ''}>{currentWorkDir ?? '未选择'}</div>
            </div>
            <button
              type="button"
              onClick={() => void executeCommand('workspace.switch').catch(() => undefined)}
              className={BTN}
            >
              切换目录
            </button>
          </div>
          <div className={ROW}>
            <div>
              <div className={LABEL}>账户与工作区信息</div>
              <div className={DESC}>查看本地数据概览与后续账号能力</div>
            </div>
            <button
              type="button"
              onClick={() => useTabStore.getState().openSecondaryViewTab({ viewId: HOST_VIEW_IDS.profile, label: '账户与工作区' })}
              className={BTN}
            >
              查看
            </button>
          </div>
        </div>

        <div className={`${SECTION} mt-4`}>
          <h2 className={SECTION_TITLE}><Book className="h-4 w-4 text-[var(--color-accent)]" />快捷键</h2>
          <div className="grid grid-cols-[1fr_auto] gap-y-2 text-[12px]">
            {[
              ['Ctrl + 1 … 9', '直达导航项（首页 / 插件视图 / 设置 / 账户）'],
              ['Alt + 1 … 9', '直达第 N 个知识库标签'],
              ['Ctrl + PageUp / PageDown', '前后切换知识库标签'],
              ['Ctrl + F', '画布内搜索节点'],
              ['Ctrl + Tab', '键盘切换右侧详情面板（界面无手动按钮，仅作可达性保留）'],
              ['按住 Alt 拖动节点', '临时忽略对齐吸附，按鼠标位置自由摆放'],
            ].map(([key, desc]) => (
              <FragmentRow key={key} shortcut={key} description={desc} />
            ))}
          </div>
        </div>

        <div className={`${SECTION} mt-4`}>
          <h2 className={SECTION_TITLE}><ExternalLink className="h-4 w-4 text-[var(--color-accent)]" />关于</h2>
          <div className="flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
            <span>TopoMind · 可漫游拓扑知识大脑</span>
            <span className="tabular-nums">v5.2.1</span>
          </div>
        </div>
      </div>
    </div>
  )
})

/**
 * 全局主题色选择器。
 * 这里刻意不出现任何颜色字面量：预设色板来自 domain/theme/accentPresets.ts，
 * 实际生效色由 domain/theme/accentColor.ts 调和派生，组件只传递用户选的那个 hex。
 */
function AccentColorControl() {
  const accentColor = useThemeStore((state) => state.accentColor)
  const setAccentColor = useThemeStore((state) => state.setAccentColor)
  const resetAccentColor = useThemeStore((state) => state.resetAccentColor)
  const [draft, setDraft] = useState(accentColor)

  // 色板 / 取色器 / 命令面板都可能改 store，输入框要跟着同步。
  useEffect(() => {
    setDraft(accentColor)
  }, [accentColor])

  const harmonized = harmonizeAccentColor(accentColor)
  const isDefault = accentColor === DEFAULT_ACCENT_COLOR

  const commitDraft = () => {
    const normalized = normalizeAccentColor(draft)
    if (normalized) setAccentColor(normalized)
    else setDraft(accentColor)
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((preset) => {
          const active = isSameAccentColor(accentColor, preset.hex)
          return (
            <button
              key={preset.id}
              type="button"
              title={`${preset.name} ${preset.hex}`}
              aria-label={`主题色：${preset.name}`}
              aria-pressed={active}
              data-tm-accent-preset={preset.id}
              onClick={() => setAccentColor(preset.hex)}
              className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-strong)] cursor-pointer transition-transform hover:scale-110 ${active ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]' : ''}`}
              style={{ backgroundColor: preset.hex }}
            >
              {/* 色块是固定明度的品牌色阶，勾选标记恒用白色；不能用 --color-text-inverse，
                  它在深色主题会翻成深色墨色，落在中明度色块上会看不见。 */}
              {active && <Check className="h-3.5 w-3.5 text-white" />}
            </button>
          )
        })}
        <span className="ml-1 text-xs text-[var(--color-text-muted)]">预设</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[var(--color-border-strong)]"
          title="自定义主题色"
        >
          <input
            type="color"
            aria-label="自定义主题色"
            data-tm-accent-custom=""
            value={harmonized.hex}
            onChange={(event) => setAccentColor(event.target.value)}
            className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] cursor-pointer border-none bg-transparent p-0"
          />
        </label>
        <input
          type="text"
          aria-label="主题色十六进制值"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitDraft()
          }}
          placeholder="输入十六进制色值"
          spellCheck={false}
          className="h-8 w-[132px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        <button type="button" onClick={resetAccentColor} disabled={isDefault} className={`${BTN} disabled:opacity-50`}>
          恢复默认
        </button>
        {harmonized.adjusted && (
          <span className="text-xs text-[var(--color-text-muted)]">已自动微调为 {harmonized.hex}</span>
        )}
      </div>

      {/* 预览直接引用 --color-* 语义 token：用户看到的就是全软件实际换上的效果。 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-bg-muted)] p-3">
        <span className="text-xs text-[var(--color-text-muted)]">效果预览</span>
        <span className="inline-flex h-7 items-center rounded-md bg-[var(--color-primary)] px-3 text-xs text-[var(--color-text-inverse)]">主按钮</span>
        <span className="inline-flex h-7 items-center rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 text-xs text-[var(--color-accent)]">选中项</span>
        <span className="inline-flex h-7 items-center rounded-md px-3 text-xs text-[var(--color-accent)] underline">链接 / 焦点</span>
      </div>
    </div>
  )
}

function FragmentRow({ shortcut, description }: { shortcut: string; description: string }) {
  return (
    <>
      <span className="font-mono text-[11px] text-[var(--color-accent)]">{shortcut}</span>
      <span className="pl-4 text-[var(--color-text-secondary)]">{description}</span>
    </>
  )
}
