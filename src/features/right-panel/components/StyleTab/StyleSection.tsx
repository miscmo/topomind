import { memo } from 'react'
import { NodeStylePanel } from './NodeStylePanel'
import { EdgeStylePanel } from './EdgeStylePanel'
import { EdgeRelationPanel } from './EdgeRelationPanel'
import { useStyleSettingsModel } from '../../model/useStyleSettingsModel'
import { useActiveCanvasReadOnly } from '../../../../stores/canvasReadOnlyStore'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'

export default memo(function StyleSection({ active = true }: { active?: boolean }) {
  const { state, actions } = useStyleSettingsModel(active)
  // 样式面板写的是画布上的节点 / 连线数据，同样过 useGraph 只读闸门；
  // 这里给一条明确提示，避免用户以为「点了没反应」是应用坏了。
  const canvasReadOnly = useActiveCanvasReadOnly()

  const {
    activeTab,
    expandedBlocks,
    saveError,
    selectedNode,
    selectedNodes,
    isMultiSelection,
    selectedEdge,
    selectedEdgeSourceLabel,
    selectedEdgeTargetLabel,
    defaultNodeStyle,
    defaultNodeSize,
    nodeSizeLimits,
    nodeBadgeSize,
    defaultEdgeStyle,
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
    updateNodeSizeLimits,
    updateNodeBadgeSize,
    applyToSelectedEdge,
    applyToSelectedNode,
    resetDefaultNodeAppearance,
    applyNodePreset,
    applyEdgePreset,
    clearSelectedNodesStyle,
    applyNumberToDefaultNode,
    applyNumberToSelectedNode,
    applySizeToSelectedNode,
    selectedNodeNumberStyleValue,
    selectedNodeColorStyleValue,
  } = actions

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      <div className="px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0">
        <SegmentedControl
          ariaLabel="样式面板分区"
          options={[
            { label: '节点卡片', value: 'nodes' },
            { label: '连线样式', value: 'edges' },
            { label: '连线关系', value: 'relations' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
        {canvasReadOnly && (
          <div
            data-tm-style-panel-readonly=""
            className="mt-2 rounded-md bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] text-[var(--color-accent)]"
          >
            画布只读中 · 恢复到 100% 后可修改节点 / 连线样式
          </div>
        )}
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
            sourceLabel={selectedEdgeSourceLabel}
            targetLabel={selectedEdgeTargetLabel}
            expandedBlocks={expandedBlocks}
            onToggleBlock={toggleBlock}
            onApplyEdgePreset={applyEdgePreset}
            onUpdateDefaultStyle={updateDefaultStyle}
            onApplyToSelectedEdge={applyToSelectedEdge}
          />
        )}

        {activeTab === 'relations' && (
          <EdgeRelationPanel />
        )}
      </div>
    </div>
  )
})
