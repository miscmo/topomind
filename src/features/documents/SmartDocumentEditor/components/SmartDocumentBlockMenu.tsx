import { type ReactNode, useState } from 'react'
import { useComponentsContext, useExtensionState } from '@blocknote/react'
import { useSmartBlockNoteEditor, type SmartDocumentPartialBlock } from '../smartDocumentEditorTypes'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SMART_DOCUMENT_TEXT_ACTIONS, SMART_DOCUMENT_MEDIA_ACTIONS } from '../constants'
import type {
  SmartDocumentBlockMenuAction,
  SmartDocumentBlockMenuMode,
  SmartDocumentInsertPlacement,
} from '../types'
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl'
import {
  cloneSmartDocumentBlockWithoutIds,
  getSmartDocumentBlocksClipboardText,
  getSmartDocumentMenuTargetBlockIds,
  getSmartDocumentBlockPlainText,
  writeClipboardBeforeMutation,
} from '../smartDocumentUtils'
import { SmartSubMenu, SmartSubMenuDropdown, SmartSubMenuTrigger } from './SmartBlockNoteMenu'

// 菜单每次打开都是重新挂载的，方向若只存在组件内 state 会丢失。这里记在模块级，
// 让「连续在上方插入多个块」不必每次重开菜单都再切一次方向（不落盘，仅本次会话）。
let lastInsertPlacement: SmartDocumentInsertPlacement = 'after'

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
  const editor = useSmartBlockNoteEditor()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  const [feedback, setFeedback] = useState<string | null>(null)
  const [insertPlacement, setInsertPlacement] = useState<SmartDocumentInsertPlacement>(lastInsertPlacement)

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
      insertBlock(action, 'after')
      return
    }
    editor.updateBlock(block, createActionBlock(action, false) as unknown as SmartDocumentPartialBlock)
    editor.setTextCursorPosition(block.id, 'start')
    editor.focus()
  }

  const insertBlock = (action: SmartDocumentBlockMenuAction, placement: SmartDocumentInsertPlacement) => {
    const insertedBlock = editor.insertBlocks([createActionBlock(action, true) as unknown as SmartDocumentPartialBlock], block, placement)[0]
    if (insertedBlock) {
      editor.setTextCursorPosition(insertedBlock)
      editor.focus()
    }
  }

  const changeInsertPlacement = (placement: SmartDocumentInsertPlacement) => {
    lastInsertPlacement = placement
    setInsertPlacement(placement)
  }

  const renderActionIcon = (action: SmartDocumentBlockMenuAction) => (
    <>
      {action.icon}
      {action.suffix ? <sub>{action.suffix}</sub> : null}
    </>
  )

  // Highlight the quick tile that matches the current block's format, so the
  // drag-handle menu reflects which block type the block already is.
  const isBlockFormatActive = (action: SmartDocumentBlockMenuAction): boolean => {
    if (action.type !== block.type) return false
    if (action.type === 'heading') {
      return (action.props?.level ?? 1) === (block.props?.level ?? 1)
    }
    return true
  }

  const renderQuickAction = (action: SmartDocumentBlockMenuAction) => {
    const active = isBlockFormatActive(action)
    return (
      <Components.Generic.Menu.Item
        key={action.key}
        className={`tm-smart-block-menu__tile${active ? ' tm-smart-block-menu__tile--active' : ''}`}
        onClick={() => applyToCurrentBlock(action)}
      >
        <span className="tm-smart-block-menu__tile-fill">{renderActionIcon(action)}</span>
      </Components.Generic.Menu.Item>
    )
  }

  const renderInsertRow = (action: SmartDocumentBlockMenuAction) => (
    <Components.Generic.Menu.Item
      key={action.key}
      className="tm-smart-block-menu__row tm-smart-block-menu__row--icon"
      onClick={() => mode === 'insert' ? applyToCurrentBlock(action) : insertBlock(action, insertPlacement)}
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
    editor.insertBlocks([nextBlock as unknown as SmartDocumentPartialBlock], block, 'after')
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
          <SmartSubMenu position="right">
            <SmartSubMenuTrigger>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__row" subTrigger><span>缩进和对齐</span><span>›</span></Components.Generic.Menu.Item>
            </SmartSubMenuTrigger>
            <SmartSubMenuDropdown className="bn-menu-dropdown tm-smart-block-menu__sub">
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
            </SmartSubMenuDropdown>
          </SmartSubMenu>
          <SmartSubMenu position="right">
            <SmartSubMenuTrigger>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__row" subTrigger><span>颜色</span><span>›</span></Components.Generic.Menu.Item>
            </SmartSubMenuTrigger>
            <SmartSubMenuDropdown className="bn-menu-dropdown tm-smart-block-menu__sub">
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextColor)} checked={block.props?.textColor === 'default'} onClick={() => supportsTextColor && setTextColor('default')}><span>默认文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextColor)} checked={block.props?.textColor === 'red'} onClick={() => supportsTextColor && setTextColor('red')}><span>红色文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsTextColor)} checked={block.props?.textColor === 'blue'} onClick={() => supportsTextColor && setTextColor('blue')}><span>蓝色文字</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsBackgroundColor)} checked={block.props?.backgroundColor === 'yellow'} onClick={() => supportsBackgroundColor && setBackgroundColor('yellow')}><span>黄色背景</span></Components.Generic.Menu.Item>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__subitem" {...disabledItemProps(!supportsBackgroundColor)} checked={block.props?.backgroundColor === 'default'} onClick={() => supportsBackgroundColor && setBackgroundColor('default')}><span>清除背景</span></Components.Generic.Menu.Item>
            </SmartSubMenuDropdown>
          </SmartSubMenu>
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
          <SmartSubMenu position="right">
            <SmartSubMenuTrigger>
              <Components.Generic.Menu.Item className="tm-smart-block-menu__row" subTrigger>
                <span>插入块</span>
                <span className="tm-smart-block-menu__row-hint">
                  {insertPlacement === 'before' ? '上方' : '下方'} ›
                </span>
              </Components.Generic.Menu.Item>
            </SmartSubMenuTrigger>
            <SmartSubMenuDropdown className="bn-menu-dropdown tm-smart-block-menu__sub">
              {/* 方向切换放在子菜单顶部：一个入口覆盖上/下两个方向，父菜单行直接显示当前方向。
                  阻止冒泡，避免切换方向被菜单当成「选中了某项」而关掉整个菜单，
                  也让方向键不会跑到下面的块类型列表上去移动高亮。 */}
              <div
                className="tm-smart-block-menu__subheader"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <SegmentedControl
                  size="sm"
                  ariaLabel="插入位置"
                  value={insertPlacement}
                  onChange={changeInsertPlacement}
                  options={[
                    { value: 'before', label: '上方' },
                    { value: 'after', label: '下方' },
                  ]}
                />
              </div>
              {[...SMART_DOCUMENT_TEXT_ACTIONS, ...SMART_DOCUMENT_MEDIA_ACTIONS].map((action) => (
                <Components.Generic.Menu.Item key={action.key} className="tm-smart-block-menu__subitem" onClick={() => insertBlock(action, insertPlacement)}>
                  <span>{action.label}</span>
                </Components.Generic.Menu.Item>
              ))}
            </SmartSubMenuDropdown>
          </SmartSubMenu>
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
