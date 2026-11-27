/**
 * 全局设置页（宿主视图 host.settings）
 * 把原先散落在 localStorage / 各 store 的布局与样式偏好收口到一个可见入口。
 * 所有控件都是真实可用的，不再有 disabled 占位。
 *
 * 2026-11-21：导航栏显隐收敛为标题栏单一全局按钮，这里不再提供第二套三态控件。
 * 2026-11-25：原「样式」分区又随画布编辑一起迁出到左栏画布设置页（见第 10 行），
 * 本页不再渲染 StyleSection；样式 model 的 optional 降级能力仍保留给其它二级视图。
 * 2026-11-23：外观分区新增「应用主题色」。UI 只负责选色，色阶派生 / 调和 / 注入
 * 全部由 src/domain/theme/ 统一管理，本页不保存第二份色值定义。
 * 2026-11-25：画布编辑、节点与连线样式两块迁入画布页左栏「画布设置」页；
 * 本页只保留一条可发现性引导，不再渲染第二份控件（避免两处入口各自演化）。
 * 2026-11-26：AI 助手 / AI 智能体两块整体迁入画布页的覆盖式「AI 设置」窗口
 * （AI Agent 左栏标题栏齿轮按钮），这样能边改配置边试对话；本页只留一条入口引导。
 */
import { memo, useEffect, useState } from 'react'
import { Book, Check, ExternalLink, FolderOpen, Layers3, SlidersHorizontal, Sparkles, SunMoon } from 'lucide-react'
import { openAgentSettingsWindow } from '@/features/ai-agent/model/agentSettingsWindowStore'
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
import { useTabStore } from '@/stores/tabs/tabStore'
import { HOST_VIEW_IDS } from '@/features/layout/NavRail/navModel'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'

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
  const currentWorkDir = useWorkspaceStore((state) => state.currentWorkDir)
  const hasKbTab = useTabStore((state) => state.tabs.some((tab) => tab.type === 'kb'))

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-app)] px-8 py-10">
      <div className="mx-auto w-full max-w-[720px]">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">设置</h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">导航、外观与工作区偏好 · 修改后立即生效并自动保存</p>
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

        {/* 画布相关配置已集中到画布页左栏：这里只留可发现性说明，不渲染第二份控件。 */}
        <div className={`${SECTION} mt-4`} data-tm-settings-canvas-entry="">
          <h2 className={SECTION_TITLE}><SlidersHorizontal className="h-4 w-4 text-[var(--color-accent)]" />画布设置</h2>
          <p className={SECTION_HINT}>
            画布视图、智能参考线与节点 / 连线样式已统一迁入画布页左栏的「画布设置」页，
            可在画布就地调整，修改后立即生效。
          </p>
          <div className={ROW}>
            <div>
              <div className={LABEL}>入口位置</div>
              <div className={DESC}>打开任意知识库 → 左侧竖排页面按钮 → 节点结构下方的「画布设置」</div>
            </div>
            <span className={tmUI(TM_UI.hint, 'shrink-0')}>画布页左栏</span>
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

        {/* AI 相关配置已整体迁出全局设置页：入口在画布页左栏 AI Agent 页顶部齿轮按钮。
            与「画布设置」同口径，这里只提供可发现性 + 一键跳回，不渲染第二份控件。 */}
        <div className={`${SECTION} mt-4`} data-tm-settings-ai-entry="">
          <h2 className={SECTION_TITLE}><Sparkles className="h-4 w-4 text-[var(--color-accent)]" />AI 设置</h2>
          <p className={SECTION_HINT}>
            模型服务与 API Key、对话字号、智能体模板与提示词已统一迁入画布页的覆盖式「AI 设置」窗口，
            可贴着对话面板边调整边测试，修改后立即生效并自动保存。
          </p>
          <div className={ROW}>
            <div>
              <div className={LABEL}>入口位置</div>
              <div className={DESC}>
                {hasKbTab
                  ? '打开任意知识库 → 左栏「AI Agent」页 → 顶部标题栏第二个齿轮按钮'
                  : '请先打开一个知识库，再从左栏「AI Agent」页顶部的齿轮按钮进入'}
              </div>
            </div>
            <button
              type="button"
              disabled={!hasKbTab}
              data-tm-settings-ai-open=""
              onClick={() => openAgentSettingsWindow('assistant')}
              className={`${BTN} disabled:opacity-50`}
            >
              打开 AI 设置
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
