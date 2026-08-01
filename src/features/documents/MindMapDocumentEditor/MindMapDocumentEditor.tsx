import { memo, useCallback, useEffect, useRef, useState } from 'react'
import MindMap from 'simple-mind-map'
import Export from 'simple-mind-map/src/plugins/Export.js'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import RichText from 'simple-mind-map/src/plugins/RichText.js'
import LogicalStructure from 'simple-mind-map/src/layouts/LogicalStructure.js'
import MindMapLayout from 'simple-mind-map/src/layouts/MindMap.js'
import OrganizationStructure from 'simple-mind-map/src/layouts/OrganizationStructure.js'
import CatalogOrganization from 'simple-mind-map/src/layouts/CatalogOrganization.js'
import Timeline from 'simple-mind-map/src/layouts/Timeline.js'
import Fishbone from 'simple-mind-map/src/layouts/Fishbone.js'
import { useThemeStore, isDarkTheme } from '../../../stores/themeStore'
import {
  MIND_MAP_LAYOUTS,
  MIND_MAP_THEMES,
  normalizeMindMapLayout,
  normalizeMindMapTheme,
  type MindMapDocumentContent,
  withMindMapUpdatedAt,
} from './mindMapDocumentTypes'

// Register plugins and layouts
MindMap.usePlugin(Export)
MindMap.usePlugin(Drag)
MindMap.usePlugin(KeyboardNavigation)
MindMap.usePlugin(Select)
MindMap.usePlugin(RichText)
MindMap.usePlugin(LogicalStructure)
MindMap.usePlugin(MindMapLayout)
MindMap.usePlugin(OrganizationStructure)
MindMap.usePlugin(CatalogOrganization)
MindMap.usePlugin(Timeline)
MindMap.usePlugin(Fishbone)

interface MindMapDocumentEditorProps {
  value: MindMapDocumentContent
  onChange: (value: MindMapDocumentContent) => void
  readOnly?: boolean
}

interface AppliedMindMapValue {
  root: string
  layout: string
  theme: string
}

function getAppliedValue(value: MindMapDocumentContent): AppliedMindMapValue {
  return {
    root: JSON.stringify(value.root),
    layout: normalizeMindMapLayout(value.layout),
    theme: normalizeMindMapTheme(value.theme),
  }
}

export const MindMapDocumentEditor = memo(function MindMapDocumentEditor({ value, onChange, readOnly = false }: MindMapDocumentEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mindMapRef = useRef<MindMap | null>(null)
  const valueRef = useRef(value)
  const isApplyingExternalValueRef = useRef(false)
  const lastAppliedValueRef = useRef<AppliedMindMapValue>(getAppliedValue(value))
  const pendingLocalValueRef = useRef<AppliedMindMapValue | null>(null)
  const [isReady, setIsReady] = useState(false)

  const globalTheme = useThemeStore((s: any) => s.theme)
  const isDark = isDarkTheme(globalTheme)
  const documentTheme = normalizeMindMapTheme(value.theme)
  const documentLayout = normalizeMindMapLayout(value.layout)
  const effectiveTheme = documentTheme === 'default'
    ? (isDark ? 'dark2' : 'default')
    : documentTheme

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const updateDocument = useCallback((nextValue: MindMapDocumentContent) => {
    const updatedValue = withMindMapUpdatedAt(nextValue)
    pendingLocalValueRef.current = getAppliedValue(updatedValue)
    valueRef.current = updatedValue
    onChange(updatedValue)
  }, [onChange])

  const handleTitleChange = useCallback((title: string) => {
    updateDocument({ ...value, title })
  }, [updateDocument, value])

  // Initialize MindMap
  useEffect(() => {
    if (!containerRef.current || mindMapRef.current) return

    const mindMap = new MindMap({
      el: containerRef.current,
      data: value.root,
      readonly: readOnly,
      theme: effectiveTheme,
      themeConfig: {
        backgroundColor: 'transparent',
      },
      layout: documentLayout,
      mousewheelAction: 'zoom',
    } as any)

    mindMapRef.current = mindMap
    lastAppliedValueRef.current = getAppliedValue(value)

    let dataChangeTimer: number | null = null
    let pendingRoot: any = null

    const flushDataChange = () => {
      dataChangeTimer = null
      if (readOnly || isApplyingExternalValueRef.current || pendingRoot === null) return
      const root = pendingRoot
      pendingRoot = null
      const updatedValue: MindMapDocumentContent = {
        ...valueRef.current,
        root,
        metadata: {
          ...valueRef.current.metadata,
          editor: 'simple-mind-map',
          updatedAt: Date.now(),
        },
      }
      pendingLocalValueRef.current = getAppliedValue(updatedValue)
      lastAppliedValueRef.current = pendingLocalValueRef.current
      valueRef.current = updatedValue
      onChange(updatedValue)
    }

    const scheduleDataChange = (data: any) => {
      if (readOnly || isApplyingExternalValueRef.current) return
      pendingRoot = data
      if (dataChangeTimer !== null) return
      dataChangeTimer = window.setTimeout(flushDataChange, 80)
    }

    mindMap.on('data_change', scheduleDataChange)

    mindMap.on('view_theme_change', (theme: string) => {
      if (readOnly || isApplyingExternalValueRef.current) return
      const updatedValue: MindMapDocumentContent = {
        ...valueRef.current,
        theme: normalizeMindMapTheme(theme),
        metadata: {
          ...valueRef.current.metadata,
          updatedAt: Date.now(),
        },
      }
      pendingLocalValueRef.current = getAppliedValue(updatedValue)
      lastAppliedValueRef.current = pendingLocalValueRef.current
      valueRef.current = updatedValue
      onChange(updatedValue)
    })

    mindMap.on('layout_change', (layout: string) => {
      if (readOnly || isApplyingExternalValueRef.current) return
      const updatedValue: MindMapDocumentContent = {
        ...valueRef.current,
        layout: normalizeMindMapLayout(layout),
        metadata: {
          ...valueRef.current.metadata,
          updatedAt: Date.now(),
        },
      }
      pendingLocalValueRef.current = getAppliedValue(updatedValue)
      lastAppliedValueRef.current = pendingLocalValueRef.current
      valueRef.current = updatedValue
      onChange(updatedValue)
    })

    setIsReady(true)

    return () => {
      if (dataChangeTimer !== null) window.clearTimeout(dataChangeTimer)
      if (pendingRoot !== null && !readOnly && !isApplyingExternalValueRef.current) {
        flushDataChange()
      }
      dataChangeTimer = null
      pendingRoot = null
      mindMap.destroy()
      mindMapRef.current = null
    }
  // The editor instance is intentionally created once and updated through controlled effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply external content changes without treating them as local edits.
  useEffect(() => {
    const mindMap = mindMapRef.current
    if (!mindMap || !isReady) return

    const nextAppliedValue = getAppliedValue(value)
    const pendingLocalValue = pendingLocalValueRef.current
    if (
      pendingLocalValue
      && pendingLocalValue.root === nextAppliedValue.root
      && pendingLocalValue.layout === nextAppliedValue.layout
      && pendingLocalValue.theme === nextAppliedValue.theme
    ) {
      pendingLocalValueRef.current = null
      lastAppliedValueRef.current = nextAppliedValue
      return
    }

    const previousAppliedValue = lastAppliedValueRef.current
    const rootChanged = nextAppliedValue.root !== previousAppliedValue.root
    const layoutChanged = nextAppliedValue.layout !== previousAppliedValue.layout
    const themeChanged = nextAppliedValue.theme !== previousAppliedValue.theme
    if (!rootChanged && !layoutChanged && !themeChanged) return

    pendingLocalValueRef.current = null
    isApplyingExternalValueRef.current = true
    try {
      if (rootChanged) {
        mindMap.command.pause()
        try {
          mindMap.updateData(value.root)
        } finally {
          mindMap.command.clearHistory()
          mindMap.command.recovery()
          mindMap.command.originAddHistory()
        }
      }
      if (layoutChanged) mindMap.setLayout(documentLayout)
      if (themeChanged) mindMap.setTheme(effectiveTheme)
      lastAppliedValueRef.current = nextAppliedValue
    } finally {
      isApplyingExternalValueRef.current = false
    }
  }, [value, documentLayout, effectiveTheme, isReady])

  // Update readOnly state if it changes
  useEffect(() => {
    if (mindMapRef.current && isReady) {
      mindMapRef.current.updateConfig({ readonly: readOnly })
    }
  }, [readOnly, isReady])

  // Global theme changes should affect the view but must not be persisted as a document theme.
  useEffect(() => {
    if (!mindMapRef.current || !isReady) return

    isApplyingExternalValueRef.current = true
    try {
      mindMapRef.current.setTheme(effectiveTheme)
    } finally {
      isApplyingExternalValueRef.current = false
    }
  }, [effectiveTheme, isReady])

  return (
    <div
      className="h-full min-h-0 flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] outline-none"
      data-shortcut-scope="mindmap"
      tabIndex={-1}
    >
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border-light)] bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)]">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">思维导图</div>
          <input
            className="w-full border-none outline-none bg-transparent text-[22px] font-bold text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            value={value.title}
            onChange={(event) => handleTitleChange(event.target.value)}
            placeholder="未命名思维导图"
            readOnly={readOnly}
          />
        </div>
        {!readOnly && isReady && (
          <div className="flex gap-2">
            <select
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] outline-none"
              value={documentLayout}
              onChange={(event) => mindMapRef.current?.setLayout(event.target.value)}
              aria-label="思维导图布局"
            >
              <option value={MIND_MAP_LAYOUTS[0]}>逻辑结构图</option>
              <option value={MIND_MAP_LAYOUTS[1]}>思维导图</option>
              <option value={MIND_MAP_LAYOUTS[2]}>组织架构图</option>
              <option value={MIND_MAP_LAYOUTS[3]}>目录组织图</option>
              <option value={MIND_MAP_LAYOUTS[4]}>时间轴</option>
              <option value={MIND_MAP_LAYOUTS[5]}>鱼骨图</option>
            </select>
            <select
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] outline-none"
              value={documentTheme}
              onChange={(event) => mindMapRef.current?.setTheme(event.target.value)}
              aria-label="思维导图主题"
            >
              <option value={MIND_MAP_THEMES[0]}>默认主题</option>
              <option value={MIND_MAP_THEMES[1]}>经典</option>
              <option value={MIND_MAP_THEMES[2]}>小黄人</option>
              <option value={MIND_MAP_THEMES[3]}>粉红葡萄柚</option>
              <option value={MIND_MAP_THEMES[4]}>薄荷</option>
              <option value={MIND_MAP_THEMES[5]}>鎏金</option>
              <option value={MIND_MAP_THEMES[6]}>活力橙</option>
              <option value={MIND_MAP_THEMES[7]}>绿叶</option>
              <option value={MIND_MAP_THEMES[8]}>暗色</option>
            </select>
            <button
              type="button"
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] disabled:opacity-40"
              onClick={() => mindMapRef.current?.execCommand('BACK')}
              aria-label="撤销思维导图操作"
            >
              撤销
            </button>
            <button
              type="button"
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] disabled:opacity-40"
              onClick={() => mindMapRef.current?.execCommand('FORWARD')}
              aria-label="重做思维导图操作"
            >
              重做
            </button>
            <button
              type="button"
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] disabled:opacity-40"
              onClick={() => {
                const map = mindMapRef.current as any
                if (map?.view?.fit) map.view.fit()
                else if (map?.fit) map.fit()
              }}
            >
              自适应
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="w-full h-full absolute inset-0" />
      </div>
    </div>
  )
})
