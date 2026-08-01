import { type ReactNode, useState } from 'react'
import { useBlockNoteEditor, useComponentsContext, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SMART_DOCUMENT_TEXT_ACTIONS, SMART_DOCUMENT_MEDIA_ACTIONS } from '../constants'
import type { SmartDocumentBlockMenuAction, SmartDocumentBlockMenuMode } from '../types'
import {
  cloneSmartDocumentBlockWithoutIds,
  getSmartDocumentBlocksClipboardText,
  getSmartDocumentMenuTargetBlockIds,
  getSmartDocumentBlockPlainText,
  writeClipboardBeforeMutation,
} from '../smartDocumentUtils'

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
  const [feedback, setFeedback] = useState<string | null>(null)

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
    const hasTextContent = getSmartDocumentBlockPlainText(block).length > 0
    if (action.type === 'divider' && hasTextContent) {
      insertBelow(action)
      return
    }
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
  const getTargetBlockIds = () => getSmartDocumentMenuTargetBlockIds(
    block.id,
    editor.getSelection()?.blocks,
  )
  const getTargetBlocks = () => getTargetBlockIds()
    .map((id: string) => editor.getBlock(id))
    .filter((item): item is NonNullable<ReturnType<typeof editor.getBlock>> => Boolean(item))
  const removeBlock = () => {
    editor.removeBlocks(getTargetBlockIds())
  }
  const runOnTargetBlock = (operation: () => void) => {
    editor.setTextCursorPosition(block.id, 'start')
    operation()
    editor.focus()
  }
  const canNestTargetBlock = Boolean(editor.getPrevBlock(block.id))
  const canUnnestTargetBlock = Boolean(editor.getParentBlock(block.id))
  const supportsTextAlignment = Boolean(block.props && 'textAlignment' in block.props)
  const supportsTextColor = Boolean(block.props && 'textColor' in block.props)
  const supportsBackgroundColor = Boolean(block.props && 'backgroundColor' in block.props)
  const disabledItemProps = (disabled: boolean) => ({
    disabled,
    'aria-disabled': disabled,
  })
  const duplicateBlock = () => {
    const nextBlock = cloneSmartDocumentBlockWithoutIds(block)
    editor.insertBlocks([nextBlock as any], block, 'after')
  }
  const writeClipboard = async (text: string, successMessage: string) => {
    if (!navigator.clipboard?.writeText) {
      setFeedback('当前环境不支持剪贴板')
      return false
    }
    try {
      await navigator.clipboard.writeText(text)
      setFeedback(successMessage)
      return true
    } catch {
      setFeedback('剪贴板写入失败')
      return false
    }
  }
  const copyBlockText = () => writeClipboard(
    getSmartDocumentBlocksClipboardText(getTargetBlocks(), block.type),
    '已复制',
  )
  const cutBlock = async () => {
    const targetIds = getTargetBlockIds()
    const text = getSmartDocumentBlocksClipboardText(getTargetBlocks(), block.type)
    const clipboard = navigator.clipboard?.writeText
    if (!clipboard) {
      setFeedback('当前环境不支持剪贴板')
      return
    }
    const didCut = await writeClipboardBeforeMutation(
      text,
      (value) => clipboard.call(navigator.clipboard, value),
      () => editor.removeBlocks(targetIds),
    )
    setFeedback(didCut ? '已剪切' : '剪贴板写入失败')
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
              <Components.Generic.Menu.Item
                className="tm-smart-block-menu__subitem"
                {...disabledItemProps(!canUnnestTargetBlock)}
                onClick={() => canUnnestTargetBlock && runOnTargetBlock(() => editor.unnestBlock())}
              ><span>减少缩进</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item
                className="tm-smart-block-menu__subitem"
                {...disabledItemProps(!canNestTargetBlock)}
                onClick={() => canNestTargetBlock && runOnTargetBlock(() => editor.nestBlock())}
              ><span>增加缩进</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextAlignment)} checked={block.props?.textAlignment === 'left'} onClick={() => supportsTextAlignment && setAlignment('left')}><span>左对齐</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextAlignment)} checked={block.props?.textAlignment === 'center'} onClick={() => supportsTextAlignment && setAlignment('center')}><span>居中</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextAlignment)} checked={block.props?.textAlignment === 'right'} onClick={() => supportsTextAlignment && setAlignment('right')}><span>右对齐</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Dropdown>
          </Components.Generic.Menu.Root>
          <Components.Generic.Menu.Root position="right" sub>
            <Components.Generic.Menu.Trigger sub>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__row" subTrigger><span>颜色</span><span>›</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Trigger>
            <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown tm-smart-block-menu__sub">
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextColor)} checked={block.props?.textColor === 'default'} onClick={() => supportsTextColor && setTextColor('default')}><span>默认文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextColor)} checked={block.props?.textColor === 'red'} onClick={() => supportsTextColor && setTextColor('red')}><span>红色文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextColor)} checked={block.props?.textColor === 'blue'} onClick={() => supportsTextColor && setTextColor('blue')}><span>蓝色文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsBackgroundColor)} checked={block.props?.backgroundColor === 'yellow'} onClick={() => supportsBackgroundColor && setBackgroundColor('yellow')}><span>黄色背景</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsBackgroundColor)} checked={block.props?.backgroundColor === 'default'} onClick={() => supportsBackgroundColor && setBackgroundColor('default')}><span>清除背景</span></Components.Generic.Menu.Item>
            </Components.Generic.Menu.Dropdown>
          </Components.Generic.Menu.Root>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <div className="tm-smart-block-menu__section">
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={() => void copyBlockText()}><span>复制</span><kbd>Ctrl+C</kbd></Components.Generic.Menu.Item>
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={() => void cutBlock()}><span>剪切</span><kbd>Ctrl+X</kbd></Components.Generic.Menu.Item>
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={removeBlock}><span>删除</span><kbd>Delete</kbd></Components.Generic.Menu.Item>
          <Components.Generic.Menu.Item className="tm-smart-block-menu__row" onClick={duplicateBlock}><span>创建副本</span><kbd>Ctrl+D</kbd></Components.Generic.Menu.Item>
          {feedback ? <div className="tm-smart-block-menu__feedback" role="status" aria-live="polite">{feedback}</div> : null}
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
