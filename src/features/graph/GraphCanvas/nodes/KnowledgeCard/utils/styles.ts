import type { CSSProperties } from 'react'
import type { KnowledgeNodeStyle } from '../../../../../../types'

export function getKnowledgeCardStyles(
  nodeStyle: KnowledgeNodeStyle,
  nodeBadgeSize: number
) {
  const borderRadius = `${nodeStyle.borderRadius}px`
  const compactDocIconSize = Math.max(8, Math.round(nodeBadgeSize * 0.72))
  
  const badgeStyle: CSSProperties = {
    minWidth: nodeBadgeSize,
    height: nodeBadgeSize,
    borderRadius: nodeBadgeSize / 2,
    fontSize: Math.max(8, Math.round(nodeBadgeSize * 0.64)),
    lineHeight: 1,
  }
  
  const docIconStyle: CSSProperties = {
    width: compactDocIconSize,
    height: nodeBadgeSize,
  }
  const docIconSvgStyle: CSSProperties = {
    width: compactDocIconSize,
    height: compactDocIconSize,
  }
  const headerStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius,
    ...(nodeStyle.headerBackgroundColor ? { backgroundColor: nodeStyle.headerBackgroundColor } : {}),
    ...(nodeStyle.headerColor ? { color: nodeStyle.headerColor } : {}),
  }
  const titleFieldStyle: CSSProperties = {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    lineHeight: 1.3,
    ...(nodeStyle.headerFontSize ? { fontSize: nodeStyle.headerFontSize } : {}),
    ...(nodeStyle.headerColor ? { color: nodeStyle.headerColor } : {}),
    ...(nodeStyle.headerFontWeight ? { fontWeight: nodeStyle.headerFontWeight } : {}),
    ...(nodeStyle.headerFontStyle ? { fontStyle: nodeStyle.headerFontStyle } : {}),
  }

  return {
    borderRadius,
    badgeStyle,
    docIconStyle,
    docIconSvgStyle,
    headerStyle,
    titleFieldStyle
  }
}
