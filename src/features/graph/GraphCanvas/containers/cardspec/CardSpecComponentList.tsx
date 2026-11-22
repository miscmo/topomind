/**
 * CardSpec 组件列表渲染：按 layout 排布组件树。
 * 节点内预览与全屏编辑器的实时预览面板共用，保证所见即所得。
 */
import { memo } from 'react'
import type { CardSpecContent } from '../../../../documents/CardSpecDocument/cardSpecTypes'
import { CardComponentView } from './CardComponentView'

export interface CardSpecComponentListProps {
  content: CardSpecContent
  cardPath: string
  cardTitle: string
  visible: boolean
}

export const CardSpecComponentList = memo(function CardSpecComponentList({
  content, cardPath, cardTitle, visible,
}: CardSpecComponentListProps) {
  const isGrid = content.layout === 'grid'
  return (
    <div
      className={
        isGrid
          ? 'grid h-full grid-cols-2 content-start gap-2 overflow-hidden p-3'
          : 'flex h-full flex-col gap-2 overflow-hidden p-3'
      }
      data-tm-cardspec-layout={content.layout}
    >
      {content.components.map((component) => (
        <CardComponentView
          key={component.id}
          component={component}
          cardPath={cardPath}
          cardTitle={cardTitle}
          visible={visible}
        />
      ))}
    </div>
  )
})
