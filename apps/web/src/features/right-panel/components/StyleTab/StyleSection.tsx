import { memo } from 'react'
import { NodeStylePanel } from './NodeStylePanel'
import { EdgeStylePanel } from './EdgeStylePanel'
import { EditorStylePanel } from './EditorStylePanel'
import { useStyleSettingsModel } from '../../model/useStyleSettingsModel'

export default memo(function StyleSection() {
  const { state, actions } = useStyleSettingsModel()

  const {
    activeTab,
    expandedBlocks,
    saveError,
    selectedNode,
    selectedNodes,
    isMultiSelection,
    selectedEdge,
    defaultNodeStyle,
    defaultNodeSize,
    nodeSizeLimits,
    nodeBadgeSize,
    defaultEdgeStyle,
    defaultEditorStyle,
    currentNodeStyle,
    currentNodeWidth,
    currentNodeHeight,
    selectedNodeWidthValue,
    selectedNodeHeightValue,
    currentEdgeStyle,
  } = state

  const {
    setActiveTab,
    toggleBlock,
    updateDefaultStyle,
    updateDefaultNodeStyle,
    updateDefaultNodeSize,
    updateDefaultEditorStyle,
    updateNodeSizeLimits,
    updateNodeBadgeSize,
    applyToSelectedEdge,
    applyToSelectedNode,
    resetDefaultNodeAppearance,
    applyNodePreset,
    applyEdgePreset,
    applyEditorPreset,
    clearSelectedNodesStyle,
    applyNumberToDefaultNode,
    applyNumberToSelectedNode,
    applySizeToSelectedNode,
    selectedNodeNumberStyleValue,
    selectedNodeColorStyleValue,
  } = actions

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      <div className="px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border-light)] shrink-0">
        <div className="flex bg-[var(--color-bg-muted)] rounded-lg p-1 w-full box-border shadow-inner">
          {(['nodes', 'edges', 'editor'] as const).map(tab => (
            <button
              key={tab}
              className={`flex-1 py-1.5 text-[12px] font-medium rounded-md cursor-pointer transition-all duration-200 text-center select-none border-none ${activeTab === tab ? 'bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]'}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'nodes' ? '节点卡片' : tab === 'edges' ? '连线样式' : '文档编辑器'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {saveError && (
          <div className="max-w-[380px] mx-auto w-full mb-3 rounded-lg border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-2 text-[12px] leading-[1.45] text-[var(--color-danger)]">
            保存样式设置失败：{saveError}
          </div>
        )}
        {activeTab === 'nodes' && (
          <NodeStylePanel
            currentNodeStyle={currentNodeStyle}
            currentNodeWidth={currentNodeWidth}
            currentNodeHeight={currentNodeHeight}
            nodeBadgeSize={nodeBadgeSize}
            title={selectedNode?.data.label || '节点示例'}
            nodeSizeLimits={nodeSizeLimits}
            defaultNodeSize={defaultNodeSize}
            defaultNodeStyle={defaultNodeStyle}
            selectedNodesCount={selectedNodes.length}
            isMultiSelection={isMultiSelection}
            selectedNodeHint={selectedNode?.data.label}
            selectedNodeWidthValue={selectedNodeWidthValue}
            selectedNodeHeightValue={selectedNodeHeightValue}
            expandedBlocks={expandedBlocks}
            onToggleBlock={toggleBlock}
            onUpdateNodeSizeLimits={updateNodeSizeLimits}
            onUpdateNodeBadgeSize={updateNodeBadgeSize}
            onResetDefaultNodeAppearance={resetDefaultNodeAppearance}
            onApplyNodePreset={applyNodePreset}
            onUpdateDefaultNodeSize={updateDefaultNodeSize}
            onUpdateDefaultNodeStyle={updateDefaultNodeStyle}
            onApplyNumberToDefaultNode={applyNumberToDefaultNode}
            onClearSelectedNodesStyle={clearSelectedNodesStyle}
            onApplySizeToSelectedNode={applySizeToSelectedNode}
            onApplyToSelectedNode={applyToSelectedNode}
            onApplyNumberToSelectedNode={applyNumberToSelectedNode}
            selectedNodeNumberStyleValue={selectedNodeNumberStyleValue}
            selectedNodeColorStyleValue={selectedNodeColorStyleValue}
          />
        )}

        {activeTab === 'edges' && (
          <EdgeStylePanel
            currentEdgeStyle={currentEdgeStyle}
            defaultEdgeStyle={defaultEdgeStyle}
            selectedEdge={selectedEdge ?? null}
            expandedBlocks={expandedBlocks}
            onToggleBlock={toggleBlock}
            onApplyEdgePreset={applyEdgePreset}
            onUpdateDefaultStyle={updateDefaultStyle}
            onApplyToSelectedEdge={applyToSelectedEdge}
          />
        )}

        {activeTab === 'editor' && (
          <EditorStylePanel
            defaultEditorStyle={defaultEditorStyle}
            expandedBlocks={expandedBlocks}
            onToggleBlock={toggleBlock}
            onApplyEditorPreset={applyEditorPreset}
            onUpdateDefaultEditorStyle={updateDefaultEditorStyle}
          />
        )}
      </div>
    </div>
  )
})
