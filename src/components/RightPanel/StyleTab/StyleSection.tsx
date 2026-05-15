import { memo, useEffect, useRef } from 'react'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useGraphStore } from '../../../stores/graphStore'
import { useStorage } from '../../../core/storage'
import type { KnowledgeNodeStyle } from '../../../types'
import type { DefaultEdgeStyle, DefaultNodeStyle, NodeSizeLimits } from '../../../stores/uiStoreTypes'
import styles from './StyleTab.module.css'

const COLOR_PRESETS = ['#7f8c8d', '#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6']

type NodeStyleNumberKey = keyof Pick<KnowledgeNodeStyle, 'headerFontSize' | 'bodyFontSize' | 'borderWidth' | 'borderRadius'>
type NodeSizeLimitKey = keyof NodeSizeLimits

const NODE_STYLE_NUMBER_LIMITS: Record<NodeStyleNumberKey, { min: number; max: number }> = {
  headerFontSize: { min: 8, max: 28 },
  bodyFontSize: { min: 8, max: 24 },
  borderWidth: { min: 0, max: 8 },
  borderRadius: { min: 0, max: 32 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export default memo(function StyleSection() {
  const storage = useStorage()
  const selectedEdgeId = useGraphUiStore((s) => s.selectedEdgeId)
  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  const defaultNodeStyle = useGraphUiStore((s) => s.defaultNodeStyle)
  const nodeSizeLimits = useGraphUiStore((s) => s.nodeSizeLimits)
  const nodeBadgeSize = useGraphUiStore((s) => s.nodeBadgeSize)
  const setDefaultEdgeStyle = useGraphUiStore((s) => s.setDefaultEdgeStyle)
  const setDefaultNodeStyle = useGraphUiStore((s) => s.setDefaultNodeStyle)
  const setNodeSizeLimits = useGraphUiStore((s) => s.setNodeSizeLimits)
  const setNodeBadgeSize = useGraphUiStore((s) => s.setNodeBadgeSize)

  const graph = useGraphContext()

  const selectedEdge = useGraphStore((s) => selectedEdgeId ? s.edgesMap.get(selectedEdgeId) : null)
  const selectedNode = useGraphStore((s) => s.nodes.find((node) => node.selected) ?? null)
  const currentEdgeStyle = selectedEdge?.data
    ? {
        lineMode: selectedEdge.data.lineMode ?? 'straight',
        lineStyle: selectedEdge.data.lineStyle ?? 'solid',
        color: selectedEdge.data.color ?? '#7f8c8d',
        arrow: selectedEdge.data.arrow ?? true,
      }
    : defaultEdgeStyle
  const currentNodeStyle = {
    ...defaultNodeStyle,
    ...(selectedNode?.data.nodeStyle ?? {}),
  }

  // Load config on mount — uses requestSeq to prevent stale updates when
  // the user switches to a different node before the config read resolves
  const configRequestSeqRef = useRef(0)
  useEffect(() => {
    const requestSeq = ++configRequestSeqRef.current
    storage.readConfig().then((config) => {
      if (configRequestSeqRef.current !== requestSeq) return
      if (config.defaultEdgeStyle) setDefaultEdgeStyle(config.defaultEdgeStyle)
      if (config.defaultNodeStyle) setDefaultNodeStyle(config.defaultNodeStyle)
      if (config.nodeSizeLimits) setNodeSizeLimits(config.nodeSizeLimits)
      if (typeof config.nodeBadgeSize === 'number') setNodeBadgeSize(config.nodeBadgeSize)
    })
  }, [storage, setDefaultEdgeStyle, setDefaultNodeStyle, setNodeBadgeSize, setNodeSizeLimits])

  // Persist style changes via updateDefaultStyle (which already calls writeConfig).
  // Avoid a separate useEffect watching defaultEdgeStyle to prevent duplicate writes.
  const updateDefaultStyle = (patch: Partial<DefaultEdgeStyle>) => {
    const next = { ...defaultEdgeStyle, ...patch }
    setDefaultEdgeStyle(patch)
    void storage.writeConfig({ defaultEdgeStyle: next })
  }

  const updateDefaultNodeStyle = (patch: Partial<DefaultNodeStyle>) => {
    const next = { ...defaultNodeStyle, ...patch }
    setDefaultNodeStyle(patch)
    void storage.writeConfig({ defaultNodeStyle: next })
  }

  const updateNodeSizeLimits = (key: NodeSizeLimitKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const next = { ...nodeSizeLimits, [key]: Math.max(1, nextValue) }
    if (next.maxWidth < next.minWidth) next.maxWidth = next.minWidth
    if (next.maxHeight < next.minHeight) next.maxHeight = next.minHeight
    setNodeSizeLimits(next)
    void storage.writeConfig({ nodeSizeLimits: next })
  }

  const updateNodeBadgeSize = (value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const next = clamp(nextValue, 8, 28)
    setNodeBadgeSize(next)
    void storage.writeConfig({ nodeBadgeSize: next })
  }

  const applyToSelectedEdge = (patch: Partial<DefaultEdgeStyle>) => {
    if (!selectedEdgeId) return
    void graph.updateEdgeStyle(selectedEdgeId, patch)
  }

  const applyToSelectedNode = (patch: KnowledgeNodeStyle) => {
    if (!selectedNode) return
    void graph.updateNodeStyle(selectedNode.id, patch)
  }

  const applyNumberToDefaultNode = (key: NodeStyleNumberKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const limits = NODE_STYLE_NUMBER_LIMITS[key]
    updateDefaultNodeStyle({ [key]: clamp(nextValue, limits.min, limits.max) })
  }

  const applyNumberToSelectedNode = (key: NodeStyleNumberKey, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) return
    const limits = NODE_STYLE_NUMBER_LIMITS[key]
    applyToSelectedNode({ [key]: clamp(nextValue, limits.min, limits.max) })
  }

  return (
    <div className={styles.styleSection}>
      <div className={styles.styleBlock}>
        <div className={styles.styleCategoryTitle}>节点卡片样式</div>
        <div className={styles.styleSubBlock}>
          <div className={styles.styleTitle}>全局设置</div>
          <div className={styles.styleHint}>所有节点共享，仅限制之后的 resize 操作。</div>
          <div className={styles.styleRow}>
            <label>最小宽度(px)</label>
            <input
              type="number"
              min={1}
              value={nodeSizeLimits.minWidth}
              onChange={(e) => updateNodeSizeLimits('minWidth', e.target.value)}
            />
          </div>
          <div className={styles.styleRow}>
            <label>最小高度(px)</label>
            <input
              type="number"
              min={1}
              value={nodeSizeLimits.minHeight}
              onChange={(e) => updateNodeSizeLimits('minHeight', e.target.value)}
            />
          </div>
          <div className={styles.styleRow}>
            <label>最大宽度(px)</label>
            <input
              type="number"
              min={nodeSizeLimits.minWidth}
              value={nodeSizeLimits.maxWidth}
              onChange={(e) => updateNodeSizeLimits('maxWidth', e.target.value)}
            />
          </div>
          <div className={styles.styleRow}>
            <label>最大高度(px)</label>
            <input
              type="number"
              min={nodeSizeLimits.minHeight}
              value={nodeSizeLimits.maxHeight}
              onChange={(e) => updateNodeSizeLimits('maxHeight', e.target.value)}
            />
          </div>
          <div className={styles.styleRow}>
            <label>徽章大小(px)</label>
            <input
              type="number"
              min={8}
              max={28}
              value={nodeBadgeSize}
              onChange={(e) => updateNodeBadgeSize(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.styleSubBlock}>
          <div className={styles.styleTitle}>默认设置</div>
          <div className={styles.styleHint}>没有自有样式的节点会跟随这里变化，新建节点默认继承这里。</div>
          <div className={styles.styleRow}>
            <label>Header字体(px)</label>
            <input
              type="number"
              min={8}
              max={28}
              value={defaultNodeStyle.headerFontSize}
              onChange={(e) => applyNumberToDefaultNode('headerFontSize', e.target.value)}
            />
          </div>
          <div className={styles.styleRow}>
            <label>Body字体(px)</label>
            <input
              type="number"
              min={8}
              max={24}
              value={defaultNodeStyle.bodyFontSize}
              onChange={(e) => applyNumberToDefaultNode('bodyFontSize', e.target.value)}
            />
          </div>
          <div className={styles.styleRow}>
            <label>Header文字色</label>
            <input
              type="color"
              value={defaultNodeStyle.headerColor}
              onChange={(e) => updateDefaultNodeStyle({ headerColor: e.target.value })}
            />
          </div>
          <div className={styles.styleRow}>
            <label>Header背景色</label>
            <input
              type="color"
              value={defaultNodeStyle.headerBackgroundColor}
              onChange={(e) => updateDefaultNodeStyle({ headerBackgroundColor: e.target.value })}
            />
          </div>
          <div className={styles.styleRow}>
            <label>Header加粗</label>
            <input
              type="checkbox"
              checked={defaultNodeStyle.headerFontWeight === 'bold'}
              onChange={(e) => updateDefaultNodeStyle({ headerFontWeight: e.target.checked ? 'bold' : 'normal' })}
            />
          </div>
          <div className={styles.styleRow}>
            <label>Header斜体</label>
            <input
              type="checkbox"
              checked={defaultNodeStyle.headerFontStyle === 'italic'}
              onChange={(e) => updateDefaultNodeStyle({ headerFontStyle: e.target.checked ? 'italic' : 'normal' })}
            />
          </div>
          <div className={styles.styleRow}>
            <label>边框颜色</label>
            <input
              type="color"
              value={defaultNodeStyle.borderColor}
              onChange={(e) => updateDefaultNodeStyle({ borderColor: e.target.value })}
            />
          </div>
          <div className={styles.styleRow}>
            <label>边框粗细(px)</label>
            <input
              type="number"
              min={0}
              max={8}
              value={defaultNodeStyle.borderWidth}
              onChange={(e) => applyNumberToDefaultNode('borderWidth', e.target.value)}
            />
          </div>
          <div className={styles.styleRow}>
            <label>卡片圆角(px)</label>
            <input
              type="number"
              min={0}
              max={32}
              value={defaultNodeStyle.borderRadius}
              onChange={(e) => applyNumberToDefaultNode('borderRadius', e.target.value)}
            />
          </div>
        </div>

        {selectedNode && (
          <div className={styles.styleSubBlock}>
            <div className={styles.styleTitle}>节点自有设置</div>
            <div className={styles.styleHint}>{selectedNode.data.label}</div>
            <div className={styles.styleRow}>
              <label>Header字体(px)</label>
              <input
                type="number"
                min={8}
                max={28}
                value={currentNodeStyle.headerFontSize}
                onChange={(e) => applyNumberToSelectedNode('headerFontSize', e.target.value)}
              />
            </div>
            <div className={styles.styleRow}>
              <label>Body字体(px)</label>
              <input
                type="number"
                min={8}
                max={24}
                value={currentNodeStyle.bodyFontSize}
                onChange={(e) => applyNumberToSelectedNode('bodyFontSize', e.target.value)}
              />
            </div>
            <div className={styles.styleRow}>
              <label>Header文字色</label>
              <input
                type="color"
                value={currentNodeStyle.headerColor}
                onChange={(e) => applyToSelectedNode({ headerColor: e.target.value })}
              />
            </div>
            <div className={styles.styleRow}>
              <label>Header背景色</label>
              <input
                type="color"
                value={currentNodeStyle.headerBackgroundColor}
                onChange={(e) => applyToSelectedNode({ headerBackgroundColor: e.target.value })}
              />
            </div>
            <div className={styles.styleRow}>
              <label>Header加粗</label>
              <input
                type="checkbox"
                checked={currentNodeStyle.headerFontWeight === 'bold'}
                onChange={(e) => applyToSelectedNode({ headerFontWeight: e.target.checked ? 'bold' : 'normal' })}
              />
            </div>
            <div className={styles.styleRow}>
              <label>Header斜体</label>
              <input
                type="checkbox"
                checked={currentNodeStyle.headerFontStyle === 'italic'}
                onChange={(e) => applyToSelectedNode({ headerFontStyle: e.target.checked ? 'italic' : 'normal' })}
              />
            </div>
            <div className={styles.styleRow}>
              <label>边框颜色</label>
              <input
                type="color"
                value={currentNodeStyle.borderColor}
                onChange={(e) => applyToSelectedNode({ borderColor: e.target.value })}
              />
            </div>
            <div className={styles.styleRow}>
              <label>边框粗细(px)</label>
              <input
                type="number"
                min={0}
                max={8}
                value={currentNodeStyle.borderWidth}
                onChange={(e) => applyNumberToSelectedNode('borderWidth', e.target.value)}
              />
            </div>
            <div className={styles.styleRow}>
              <label>卡片圆角(px)</label>
              <input
                type="number"
                min={0}
                max={32}
                value={currentNodeStyle.borderRadius}
                onChange={(e) => applyNumberToSelectedNode('borderRadius', e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className={styles.styleBlock}>
        <div className={styles.styleCategoryTitle}>连线样式</div>
        <div className={styles.styleSubBlock}>
          <div className={styles.styleTitle}>默认连线样式</div>
          <div className={styles.styleHint}>新建连线会继承这里的默认样式。</div>
          <div className={styles.styleRow}>
            <label>线型</label>
            <select
              value={defaultEdgeStyle.lineMode}
              onChange={(e) => updateDefaultStyle({ lineMode: e.target.value as 'smoothstep' | 'straight' })}
            >
              <option value="smoothstep">弯折</option>
              <option value="straight">直线</option>
            </select>
          </div>
          <div className={styles.styleRow}>
            <label>线条</label>
            <select
              value={defaultEdgeStyle.lineStyle}
              onChange={(e) => updateDefaultStyle({ lineStyle: e.target.value as 'solid' | 'dashed' })}
            >
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
            </select>
          </div>
          <div className={styles.styleRow}>
            <label>箭头</label>
            <input
              type="checkbox"
              checked={defaultEdgeStyle.arrow}
              onChange={(e) => updateDefaultStyle({ arrow: e.target.checked })}
            />
          </div>
          <div className={styles.colorGrid}>
            {COLOR_PRESETS.map((color) => (
              <button
                key={color}
                className={styles.colorSwatch}
                style={{ background: color, outline: defaultEdgeStyle.color === color ? '2px solid #1a3a5c' : 'none' }}
                onClick={() => updateDefaultStyle({ color })}
                title={color}
              />
            ))}
          </div>
        </div>

        <div className={styles.styleSubBlock}>
          <div className={styles.styleTitle}>当前连线样式</div>
          {selectedEdge ? (
            <>
              <div className={styles.styleHint}>{selectedEdge.source} → {selectedEdge.target}</div>
              <div className={styles.styleRow}>
                <label>线型</label>
                <select
                  value={currentEdgeStyle.lineMode}
                  onChange={(e) => applyToSelectedEdge({ lineMode: e.target.value as 'smoothstep' | 'straight' })}
                >
                  <option value="smoothstep">弯折</option>
                  <option value="straight">直线</option>
                </select>
              </div>
              <div className={styles.styleRow}>
                <label>线条</label>
                <select
                  value={currentEdgeStyle.lineStyle}
                  onChange={(e) => applyToSelectedEdge({ lineStyle: e.target.value as 'solid' | 'dashed' })}
                >
                  <option value="solid">实线</option>
                  <option value="dashed">虚线</option>
                </select>
              </div>
              <div className={styles.styleRow}>
                <label>箭头</label>
                <input
                  type="checkbox"
                  checked={currentEdgeStyle.arrow}
                  onChange={(e) => applyToSelectedEdge({ arrow: e.target.checked })}
                />
              </div>
              <div className={styles.colorGrid}>
                {COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    className={styles.colorSwatch}
                    style={{ background: color, outline: currentEdgeStyle.color === color ? '2px solid #1a3a5c' : 'none' }}
                    onClick={() => applyToSelectedEdge({ color })}
                    title={color}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className={styles.emptyStyleState}>选中一条连线后，可在这里编辑它的样式。</div>
          )}
        </div>
      </div>
    </div>
  )
})
