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
import type { MindMapDocumentContent } from './mindMapDocumentTypes'
import { withMindMapUpdatedAt } from './mindMapDocumentTypes'

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

export const MindMapDocumentEditor = memo(function MindMapDocumentEditor({ value, onChange, readOnly = false }: MindMapDocumentEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mindMapRef = useRef<MindMap | null>(null)
  const [isReady, setIsReady] = useState(false)
  const valueRef = useRef(value)
  
  const globalTheme = useThemeStore((s: any) => s.theme)
  const isDark = isDarkTheme(globalTheme)
  const effectiveTheme = (!value.theme || value.theme === 'default') 
    ? (isDark ? 'dark2' : 'default') 
    : value.theme

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const updateDocument = useCallback((nextValue: MindMapDocumentContent) => {
    onChange(withMindMapUpdatedAt(nextValue))
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
        backgroundColor: 'transparent' // 强制覆盖其自带背景色，以便透出外部全局 CSS 变量背景
      },
      layout: value.layout || 'logicalStructure',
      mousewheelAction: 'zoom', // Zoom with mouse wheel
    } as any)

    mindMapRef.current = mindMap

    // Listen for data changes
    mindMap.on('data_change', (data: any) => {
      if (readOnly) return
      
      onChange({
        ...valueRef.current,
        root: data,
        metadata: {
          ...valueRef.current.metadata,
          editor: 'simple-mind-map',
          updatedAt: Date.now(),
        }
      })
    })

    mindMap.on('view_theme_change', (theme: string) => {
      if (readOnly) return
      onChange({
        ...valueRef.current,
        theme,
        metadata: {
          ...valueRef.current.metadata,
          updatedAt: Date.now(),
        }
      })
    })

    mindMap.on('layout_change', (layout: string) => {
      if (readOnly) return
      onChange({
        ...valueRef.current,
        layout,
        metadata: {
          ...valueRef.current.metadata,
          updatedAt: Date.now(),
        }
      })
    })

    setIsReady(true)

    return () => {
      if (mindMapRef.current) {
        mindMapRef.current.destroy()
        mindMapRef.current = null
      }
    }
  // We intentionally only run this once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // Update readOnly state if it changes
  useEffect(() => {
    if (mindMapRef.current && isReady) {
      mindMapRef.current.updateConfig({ readonly: readOnly })
    }
  }, [readOnly, isReady])

  // Update theme if effectiveTheme changes
  useEffect(() => {
    if (mindMapRef.current && isReady) {
      mindMapRef.current.setTheme(effectiveTheme)
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
              value={value.layout || 'logicalStructure'}
              onChange={(e) => mindMapRef.current?.setLayout(e.target.value)}
            >
              <option value="logicalStructure">逻辑结构图</option>
              <option value="mindMap">思维导图</option>
              <option value="organizationStructure">组织架构图</option>
              <option value="catalogOrganization">目录组织图</option>
              <option value="timeline">时间轴</option>
              <option value="fishbone">鱼骨图</option>
            </select>
            <select 
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] outline-none"
              value={value.theme || 'default'}
              onChange={(e) => mindMapRef.current?.setTheme(e.target.value)}
            >
              <option value="default">默认主题</option>
              <option value="classic">经典</option>
              <option value="minions">小黄人</option>
              <option value="pinkGrapefruit">粉红葡萄柚</option>
              <option value="mint">薄荷</option>
              <option value="gold">鎏金</option>
              <option value="vitalityOrange">活力橙</option>
              <option value="greenLeaf">绿叶</option>
              <option value="dark2">暗色</option>
            </select>
            <button 
              type="button" 
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] disabled:opacity-40" 
              onClick={() => {
                const map = mindMapRef.current as any
                if (map?.execCommand) map.execCommand('BACK')
              }}
            >
              撤销
            </button>
            <button 
              type="button" 
              className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] disabled:opacity-40" 
              onClick={() => {
                const map = mindMapRef.current as any
                if (map?.execCommand) map.execCommand('FORWARD')
              }}
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
