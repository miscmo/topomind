import type { DefaultNodeSize, DefaultNodeStyle } from '../../../types/uiStoreTypes'
import type { KnowledgeNode, KnowledgeNodeStyle } from '../../../types'

export type NodeStyleNumberKey = keyof Pick<KnowledgeNodeStyle, 'headerFontSize' | 'bodyFontSize' | 'borderWidth' | 'borderRadius'>
export type NodeColorStyleKey = 'headerColor' | 'headerBackgroundColor' | 'borderColor'

export function getNodeWidth(node: KnowledgeNode, defaultNodeSize: DefaultNodeSize): number {
  return node.width ?? node.initialWidth ?? node.measured?.width ?? defaultNodeSize.width
}

export function getNodeHeight(node: KnowledgeNode, defaultNodeSize: DefaultNodeSize): number {
  return node.height ?? node.initialHeight ?? node.measured?.height ?? defaultNodeSize.height
}

export function mixedValue<T>(values: T[], fallback: T): T | '' {
  return values.length > 1 && !values.every(value => value === values[0]) ? '' : fallback
}

export function getEffectiveNodeStyle(node: KnowledgeNode, defaultNodeStyle: DefaultNodeStyle): KnowledgeNodeStyle {
  return { ...defaultNodeStyle, ...(node.data.nodeStyle ?? {}) }
}

export function getSelectedNodeStyleValue(
  selectedNodes: KnowledgeNode[],
  defaultNodeStyle: DefaultNodeStyle,
  currentNodeStyle: KnowledgeNodeStyle,
  key: keyof KnowledgeNodeStyle
): KnowledgeNodeStyle[keyof KnowledgeNodeStyle] | '' {
  const fallback = currentNodeStyle[key]
  if (selectedNodes.length <= 1) return fallback ?? ''
  const values = selectedNodes.map(node => getEffectiveNodeStyle(node, defaultNodeStyle)[key])
  return values.every(value => value === values[0]) ? (fallback ?? '') : ''
}

export function getSelectedNodeNumberStyleValue(
  selectedNodes: KnowledgeNode[],
  defaultNodeStyle: DefaultNodeStyle,
  currentNodeStyle: KnowledgeNodeStyle,
  key: NodeStyleNumberKey
): number | '' {
  const value = getSelectedNodeStyleValue(selectedNodes, defaultNodeStyle, currentNodeStyle, key)
  return typeof value === 'number' ? value : ''
}

export function getSelectedNodeColorStyleValue(
  selectedNodes: KnowledgeNode[],
  defaultNodeStyle: DefaultNodeStyle,
  currentNodeStyle: KnowledgeNodeStyle,
  key: NodeColorStyleKey
): string {
  const value = getSelectedNodeStyleValue(selectedNodes, defaultNodeStyle, currentNodeStyle, key)
  return typeof value === 'string' ? value : ''
}
