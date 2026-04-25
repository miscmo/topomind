import { memo, useEffect } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useGraphContext } from '../../contexts/GraphContext'
import { useStorage } from '../../hooks/useStorage'
import styles from './DetailPanel.module.css'

const COLOR_PRESETS = ['#7f8c8d', '#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6']

export default memo(function StyleSection() {
  const storage = useStorage()
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId)
  const defaultEdgeStyle = useAppStore((s) => s.defaultEdgeStyle)
  const setDefaultEdgeStyle = useAppStore((s) => s.setDefaultEdgeStyle)
  const replaceDefaultEdgeStyle = useAppStore((s) => s.replaceDefaultEdgeStyle)
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab)
  const graph = useGraphContext()

  const selectedEdge = selectedEdgeId ? graph.edgesMapRef.current.get(selectedEdgeId) : null
  const currentStyle = selectedEdge?.data
    ? {
        lineMode: selectedEdge.data.lineMode ?? 'smoothstep',
        lineStyle: selectedEdge.data.lineStyle ?? 'solid',
        color: selectedEdge.data.color ?? '#7f8c8d',
        arrow: selectedEdge.data.arrow ?? true,
      }
    : defaultEdgeStyle

  useEffect(() => {
    storage.readConfig().then((config) => {
      if (config.defaultEdgeStyle) {
        replaceDefaultEdgeStyle({
          lineMode: config.defaultEdgeStyle.lineMode ?? 'smoothstep',
          lineStyle: config.defaultEdgeStyle.lineStyle ?? 'solid',
          color: config.defaultEdgeStyle.color ?? '#7f8c8d',
          arrow: config.defaultEdgeStyle.arrow ?? true,
        })
      }
    })
  }, [storage, replaceDefaultEdgeStyle])

  useEffect(() => {
    storage.writeConfig({ defaultEdgeStyle })
  }, [storage, defaultEdgeStyle])

  const updateDefaultStyle = (patch: Partial<typeof defaultEdgeStyle>) => {
    const next = { ...defaultEdgeStyle, ...patch }
    setDefaultEdgeStyle(patch)
    storage.writeConfig({ defaultEdgeStyle: next })
  }

  const applyToSelectedEdge = (patch: Partial<typeof defaultEdgeStyle>) => {
    if (!selectedEdgeId) return
    graph.updateEdgeStyle(selectedEdgeId, patch)
  }

  return (
    <div className={styles.styleSection}>
      <div className={styles.styleBlock}>
        <div className={styles.styleTitle}>全局默认连线样式</div>
        <div className={styles.styleHint}>新建连线会继承这里的默认样式</div>
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

      <div className={styles.styleBlock}>
        <div className={styles.styleTitle}>当前连线样式</div>
        {selectedEdge ? (
          <>
            <div className={styles.styleHint}>{selectedEdge.source} → {selectedEdge.target}</div>
            <div className={styles.styleRow}>
              <label>线型</label>
              <select
                value={currentStyle.lineMode}
                onChange={(e) => applyToSelectedEdge({ lineMode: e.target.value as 'smoothstep' | 'straight' })}
              >
                <option value="smoothstep">弯折</option>
                <option value="straight">直线</option>
              </select>
            </div>
            <div className={styles.styleRow}>
              <label>线条</label>
              <select
                value={currentStyle.lineStyle}
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
                checked={currentStyle.arrow}
                onChange={(e) => applyToSelectedEdge({ arrow: e.target.checked })}
              />
            </div>
            <div className={styles.colorGrid}>
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  className={styles.colorSwatch}
                  style={{ background: color, outline: currentStyle.color === color ? '2px solid #1a3a5c' : 'none' }}
                  onClick={() => applyToSelectedEdge({ color })}
                  title={color}
                />
              ))}
            </div>
          </>
        ) : (
          <div className={styles.emptyStyleState}>
            选中一条连线后，可在这里编辑它的样式。
            <button className={styles.styleLinkBtn} onClick={() => setRightPanelTab('detail')}>
              返回详情
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
