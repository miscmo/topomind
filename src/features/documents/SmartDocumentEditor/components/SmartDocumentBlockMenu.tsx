import { type ReactNode } from 'react'
import { useBlockNoteEditor, useComponentsContext, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SMART_DOCUMENT_TEXT_ACTIONS, SMART_DOCUMENT_MEDIA_ACTIONS } from '../constants'
import type { SmartDocumentBlockMenuAction, SmartDocumentBlockMenuMode } from '../types'
import { inlineContentToText } from '../smartDocumentUtils'

function createTableBlock() {
  return {
    type: 'table',
    content: {
      type: 'tableContent',
      rows: [
        { cells: ['', ''] },
        { cells: ['', ''] },
      ],
    },
  }
}

export function SmartDocumentBlockMenu({ mode, children }: { mode: SmartDocumentBlockMenuMode, children?: ReactNode }) {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })

  if (!Components || !block) return null

  const createActionBlock = (action: SmartDocumentBlockMenuAction, forInsert: boolean) => {
    if (action.type === 'table') {
      return createTableBlock()
    }
    const nextBlock: Record<string, unknown> = {
      type: action.type,
      props: action.props ?? {},
    }
    if (forInsert && action.type !== 'image' && action.type !== 'file' && action.type !== 'mermaid' && action.type !== 'math') {
      nextBlock.content = ''
    }
    return nextBlock
  }

  const applyToCurrentBlock = (action: SmartDocumentBlockMenuAction) => {
    editor.updateBlock(block, createActionBlock(action, false) as any)
    editor.setTextCursorPosition(block.id, 'start')
    editor.focus()
  }

  const insertBelow = (action: SmartDocumentBlockMenuAction) => {
    const insertedBlock = editor.insertBlocks([createActionBlock(action, true) as any], block, 'after')[0]
    if (insertedBlock) {
      editor.setTextCursorPosition(insertedBlock)
      editor.focus()
    }
  }

  const renderActionIcon = (action: SmartDocumentBlockMenuAction) => (
    <>
      {action.icon}
      {action.suffix ? <sub>{action.suffix}</sub> : null}
    </>
  )

  const renderQuickAction = (action: SmartDocumentBlockMenuAction) => (
    <Components.Generic.Menu.Item
      key={action.key}
      className="tm-smart-block-menu__tile"
      onClick={() => applyToCurrentBlock(action)}
    >
      {renderActionIcon(action)}
    </Components.Generic.Menu.Item>
  )

  const renderInsertRow = (action: SmartDocumentBlockMenuAction) => (
    <Components.Generic.Menu.Item
      key={action.key}
      className="tm-smart-block-menu__row tm-smart-block-menu__row--icon"
      onClick={() => mode === 'insert' ? applyToCurrentBlock(action) : insertBelow(action)}
    >
      <span>{action.icon}</span>
      <span>{action.label}</span>
    </Components.Generic.Menu.Item>
  )

  const setAlignment = (textAlignment: 'left' | 'center' | 'right' | 'justify') => {
    editor.updateBlock(block, { props: { textAlignment } })
  }
  const setTextColor = (textColor: string) => {
    editor.updateBlock(block, { props: { textColor } })
  }
  const setBackgroundColor = (backgroundColor: string) => {
    editor.updateBlock(block, { props: { backgroundColor } })
  }
  const removeBlock = () => {
    const selectedBlocks = editor.getSelection()?.blocks
    const blocksToRemove = selectedBlocks && selectedBlocks.some((item: any) => item.id === block.id)
      ? selectedBlocks
      : [block]
    editor.removeBlocks(blocksToRemove)
  }
  const duplicateBlock = () => {
    const nextBlock = JSON.parse(JSON.stringify(block))
    delete nextBlock.id
    editor.insertBlocks([nextBlock], block, 'after')
  }
  const copyBlockText = () => {
    void navigator.clipboard?.writeText(inlineContentToText(block.content) || block.type)
  }
  const cutBlock = () => {
    copyBlockText()
    removeBlock()
  }
  const copyBlockLink = () => {
    void navigator.clipboard?.writeText(`#${block.id}`)
  }

  return (
    <Components.Generic.Menu.Dropdown className={`bn-menu-dropdown tm-smart-block-menu tm-smart-block-menu--${mode} ${mode === 'edit' ? 'bn-drag-handle-menu' : ''}`}>
      {mode === 'insert' ? <div className="tm-smart-block-menu__label">文字块</div> : null}
      <div className="tm-smart-block-menu__quick">
        {SMART_DOCUMENT_TEXT_ACTIONS.map(renderQuickAction)}
      </div>

      {mode === 'edit' ? (
        <div className="tm-smart-block-menu__section">
          <Components.Generic.Menu.Root position="right" sub>
            <Components.Generic.Menu.Trigger sub>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__row" subTrigger><span>缩进和对齐</span><span>›</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Trigger>
            <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown tm-smart-block-menu__sub">
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => editor.canUnnestBlock() && editor.unnestBlock()}><span>减少缩进</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => editor.canNestBlock() && editor.nestBlock()}><span>增加缩进</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setAlignment('left')}><span>左对齐</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setAlignment('center')}><span>居中</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setAlignment('right')}><span>右对齐</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Dropdown>
          </Components.Generic.Menu.Root>
          <Components.Generic.Menu.Root position="right" sub>
            <Components.Generic.Menu.Trigger sub>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__row" subTrigger><span>颜色</span><span>›</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Trigger>
            <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown tm-smart-block-menu__sub">
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setTextColor('default')}><span>默认文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setTextColor('red')}><span>红色文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setTextColor('blue')}><span>蓝色文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setBackgroundColor('yellow')}><span>黄色背景</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" onClick={() => setBackgroundColor('default')}><span>清除背景</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Dropdown>
          </Components.Generic.Menu.Root>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <div className="tm-smart-block-menu__section">
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={copyBlockText}><span>复制</span><kbd>Ctrl+C</kbd></Components.Generic.Menu.Item>
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={cutBlock}><span>剪切</span><kbd>Ctrl+X</kbd></Components.Generic.Menu.Item>
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={removeBlock}><span>删除</span><kbd>Delete</kbd></Components.Generic.Menu.Item>
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={duplicateBlock}><span>创建副本</span><kbd>Ctrl+D</kbd></Components.Generic.Menu.Item>
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={copyBlockLink}><span>复制链接</span></Components.Generic.Menu.Item>
        </div>
      ) : null}

      <div className="tm-smart-block-menu__section">
        {mode === 'edit' ? (
          <Components.Generic.Menu.Root position="right" sub>
            <Components.Generic.Menu.Trigger sub>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__row" subTrigger><span>在下方插入</span><span>›</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Trigger>
            <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown tm-smart-block-menu__sub">
              {[...SMART_DOCUMENT_TEXT_ACTIONS, ...SMART_DOCUMENT_MEDIA_ACTIONS].map((action) => (
                <Components.Generic.Menu.Item key={action.key} className="tm-smart-block-menu__subitem" onClick={() => insertBelow(action)}>
                  <span>{action.label}</span>
                </Components.Generic.Menu.Item>
              ))}
            </Components.Generic.Menu.Dropdown>
          </Components.Generic.Menu.Root>
        ) : (
          <>
            <div className="tm-smart-block-menu__label tm-smart-block-menu__label--section">常用</div>
            {SMART_DOCUMENT_MEDIA_ACTIONS.map(renderInsertRow)}
          </>
        )}
      </div>

      {children}
    </Components.Generic.Menu.Dropdown>
  )
}
