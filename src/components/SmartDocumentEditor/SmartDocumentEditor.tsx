import { memo, useCallback, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { DragHandleButton, SideMenu, SideMenuController, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useExtension, useExtensionState } from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import { AiOutlinePlus } from 'react-icons/ai'
import { useThemeStore } from '../../stores/themeStore'
import { useGraphUiStore } from '../../stores/graphUiStore'
import type { SmartDocumentContent } from './smartDocumentTypes'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from './smartDocumentTypes'
import type { TocItem } from '../DocumentWorkspaceLayout/workspaceTypes'
import '@blocknote/mantine/style.css'

interface SmartDocumentEditorProps {
  value: SmartDocumentContent
  onChange: (value: SmartDocumentContent) => void
  onTocChange?: (items: TocItem[]) => void
  onTocItemClickReady?: (handler: ((item: TocItem) => void) | null) => void
  readOnly?: boolean
}

type SmartDocumentBlockMenuMode = 'edit' | 'insert'

interface SmartDocumentBlockMenuAction {
  key: string
  icon: string
  suffix?: string
  label: string
  type: string
  props?: Record<string, unknown>
}

const SMART_DOCUMENT_TEXT_ACTIONS: SmartDocumentBlockMenuAction[] = [
  { key: 'paragraph', icon: 'T', label: '正文', type: 'paragraph' },
  { key: 'heading-1', icon: 'H', suffix: '1', label: '标题 1', type: 'heading', props: { level: 1 } },
  { key: 'heading-2', icon: 'H', suffix: '2', label: '标题 2', type: 'heading', props: { level: 2 } },
  { key: 'heading-3', icon: 'H', suffix: '3', label: '标题 3', type: 'heading', props: { level: 3 } },
  { key: 'heading-4', icon: 'H', suffix: '4', label: '标题 4', type: 'heading', props: { level: 4 } },
  { key: 'heading-5', icon: 'H', suffix: '5', label: '标题 5', type: 'heading', props: { level: 5 } },
  { key: 'heading-6', icon: 'H', suffix: '6', label: '标题 6', type: 'heading', props: { level: 6 } },
  { key: 'bullet-list', icon: '☷', label: '项目列表', type: 'bulletListItem' },
  { key: 'numbered-list', icon: '☰', label: '编号列表', type: 'numberedListItem' },
  { key: 'check-list', icon: '☑', label: '待办', type: 'checkListItem' },
  { key: 'quote', icon: '❝', label: '引用', type: 'quote' },
  { key: 'divider', icon: '━', label: '分割线', type: 'divider' },
  { key: 'code-block', icon: '</>', label: '代码块', type: 'codeBlock' },
]

const SMART_DOCUMENT_MEDIA_ACTIONS: SmartDocumentBlockMenuAction[] = [
  { key: 'image', icon: '▧', label: '图片', type: 'image' },
  { key: 'file', icon: '□', label: '文件', type: 'file' },
  { key: 'table', icon: '▦', label: '表格', type: 'table' },
]

function SmartDocumentBlockMenu({ mode, children }: { mode: SmartDocumentBlockMenuMode, children?: ReactNode }) {
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
    if (forInsert && action.type !== 'image' && action.type !== 'file') {
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

      {mode === 'edit' ? (
        <div className="tm-smart-block-menu__footer">
          <div>最近修改：当前用户</div>
          <div>块 ID：{String(block.id).slice(0, 8)}</div>
        </div>
      ) : null}
      {children}
    </Components.Generic.Menu.Dropdown>
  )
}

function SmartDocumentDragHandleMenu({ children }: { children?: ReactNode }) {
  return <SmartDocumentBlockMenu mode="edit">{children}</SmartDocumentBlockMenu>
}

function SmartDocumentAddBlockButton() {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const sideMenu = useExtension(SideMenuExtension)
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })

  if (!Components || !block) return null

  return (
    <Components.Generic.Menu.Root
      onOpenChange={(open: boolean) => {
        if (open) {
          sideMenu.freezeMenu()
        } else {
          sideMenu.unfreezeMenu()
        }
      }}
      position="left"
    >
      <Components.Generic.Menu.Trigger>
        <Components.SideMenu.Button
          className="bn-button"
          label="添加块"
          icon={<AiOutlinePlus size={24} data-test="dragHandleAdd" />}
        />
      </Components.Generic.Menu.Trigger>
      <SmartDocumentBlockMenu mode="insert" />
    </Components.Generic.Menu.Root>
  )
}

function SmartDocumentSideMenu() {
  const editor = useBlockNoteEditor<any, any, any>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  const isEmptyBlock = Array.isArray(block?.content) && block.content.length === 0

  if (!block) {
    return null
  }

  return (
    <SideMenu>
      {isEmptyBlock ? <SmartDocumentAddBlockButton /> : <DragHandleButton dragHandleMenu={SmartDocumentDragHandleMenu} />}
    </SideMenu>
  )
}

function inlineContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return item.text
    return ''
  }).join('').trim()
}

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

function extractSmartDocumentToc(editor: ReturnType<typeof useCreateBlockNote>): TocItem[] {
  const items: TocItem[] = []
  editor.forEachBlock((block: any) => {
    if (block?.type !== 'heading') return true
    const text = inlineContentToText(block.content)
    if (!text) return true
    const rawLevel = block.props?.level
    const level = typeof rawLevel === 'number' && Number.isFinite(rawLevel)
      ? Math.min(Math.max(rawLevel, 1), 6)
      : 1
    items.push({
      id: block.id,
      level,
      text,
      line: items.length + 1,
    })
    return true
  })
  return items
}

export const SmartDocumentEditor = memo(function SmartDocumentEditor({ value, onChange, onTocChange, onTocItemClickReady, readOnly = false }: SmartDocumentEditorProps) {
  const theme = useThemeStore((state) => state.theme)
  const defaultEditorStyle = useGraphUiStore((state) => state.defaultEditorStyle)

  const initialContent = useMemo(() => {
    // If the document has no blocks at all (new document), let BlockNote use its default empty paragraph
    // instead of forcing a heading or any other structure.
    const blocks = createDefaultBlockNoteBlocks(value.blocks)
    return blocks.length > 0 ? blocks : undefined
  }, [])
  const editor = useCreateBlockNote({
    initialContent,
  })

  const handleChange = useCallback(() => {
    const nextValue = withSmartDocumentUpdatedAt({
      ...value,
      blocks: editor.document,
    })
    onChange(nextValue)
    onTocChange?.(extractSmartDocumentToc(editor))
  }, [editor, onChange, onTocChange, value])

  const handleTocItemClick = useCallback((item: TocItem) => {
    editor.setTextCursorPosition(item.id, 'start')
    editor.prosemirrorView.dispatch(editor.prosemirrorView.state.tr.scrollIntoView())
    editor.focus()
  }, [editor])

  useEffect(() => {
    onTocChange?.(extractSmartDocumentToc(editor))
    onTocItemClickReady?.(handleTocItemClick)
    return () => {
      onTocChange?.([])
      onTocItemClickReady?.(null)
    }
  }, [editor, handleTocItemClick, onTocChange, onTocItemClickReady])

  const customTheme = useMemo(() => {
    const baseTheme = theme === 'dark' ? darkDefaultTheme : lightDefaultTheme
    return {
      ...baseTheme,
      fontFamily: defaultEditorStyle.fontFamily === 'inherit' ? baseTheme.fontFamily : defaultEditorStyle.fontFamily,
      colors: {
        ...baseTheme.colors,
        editor: {
          ...baseTheme.colors.editor,
          text: defaultEditorStyle.textColor,
          background: defaultEditorStyle.backgroundColor || 'transparent',
        }
      }
    }
  }, [theme, defaultEditorStyle])

  const blockNoteViewStyle = useMemo(() => ({
    '--topomind-smart-body-font-size': `${defaultEditorStyle.fontSize}px`,
    '--topomind-smart-line-height': String(defaultEditorStyle.lineHeight),
  }) as CSSProperties, [defaultEditorStyle.fontSize, defaultEditorStyle.lineHeight])

  return (
    <div className="h-full min-h-0 overflow-y-auto" spellCheck={false} style={{ backgroundColor: defaultEditorStyle.backgroundColor || 'var(--color-surface)' }}>
      <style>{`
        .smart-document-content .bn-default-styles {
          font-size: var(--topomind-smart-body-font-size) !important;
          line-height: var(--topomind-smart-line-height) !important;
        }
        .smart-document-content .bn-default-styles a[href] {
          color: var(--color-primary) !important;
          text-decoration-line: underline;
          text-decoration-thickness: 1px;
          text-underline-offset: 2px;
        }
        .smart-document-content .bn-default-styles a[href]:hover {
          color: var(--color-accent) !important;
        }
        .smart-document-content [data-content-type="quote"] blockquote {
          border-left-color: var(--color-border-strong);
          color: var(--color-text-secondary);
          background: color-mix(in srgb, var(--color-bg-muted) 58%, transparent);
          border-radius: 0 8px 8px 0;
          padding: 0.35em 0.75em 0.35em 1em;
        }
        .smart-document-content [data-content-type="divider"] hr,
        .smart-document-content [data-content-type="pageBreak"] > div {
          border-top-color: var(--color-border-strong);
        }
        .smart-document-content .bn-inline-content code {
          color: var(--color-primary);
          background: color-mix(in srgb, var(--color-bg-muted) 78%, transparent);
          border: 1px solid var(--color-border-subtle);
          border-radius: 5px;
          padding: 0.08em 0.35em;
          font-size: 0.92em;
        }
        .smart-document-content .bn-editor [data-content-type="table"] th,
        .smart-document-content .bn-editor [data-content-type="table"] td {
          border-color: var(--color-border);
        }
        .smart-document-content .bn-editor [data-content-type="table"] th {
          background: color-mix(in srgb, var(--color-bg-muted) 72%, transparent);
          color: var(--color-text-primary);
        }
        .smart-document-content .bn-block-content[data-content-type="checkListItem"] > div > input {
          accent-color: var(--color-primary);
        }
        .tm-smart-block-menu {
          width: 246px;
          max-height: 420px;
          padding: 0 !important;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-surface);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
          overflow-y: auto;
          color: var(--color-text-primary);
        }
        .tm-smart-block-menu__label {
          padding: 16px 18px 6px;
          color: var(--color-text-secondary);
          font-size: 14px;
          line-height: 1.3;
        }
        .tm-smart-block-menu__label--section {
          padding: 0 18px 8px;
        }
        .tm-smart-block-menu__quick {
          display: grid;
          grid-template-columns: repeat(5, 32px);
          gap: 10px 12px;
          padding: 14px 18px 12px;
        }
        .tm-smart-block-menu__tile {
          width: 32px;
          height: 28px;
          min-height: 28px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--color-text-primary);
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          padding: 0 !important;
          white-space: nowrap;
          text-align: center;
          transition: background-color 80ms ease, color 80ms ease;
        }
        .tm-smart-block-menu__tile sub,
        .tm-smart-block-menu__subitem sub {
          color: var(--color-primary);
          font-size: 0.6em;
          line-height: 1;
        }
        .tm-smart-block-menu__tile:hover,
        .tm-smart-block-menu__tile--more {
          background: var(--color-hover-bg);
        }
        .tm-smart-block-menu__section {
          padding: 8px 0;
          border-top: 1px solid var(--color-border-subtle);
        }
        .tm-smart-block-menu__row {
          width: 100%;
          min-height: 32px;
          border: none;
          background: transparent;
          color: var(--color-text-primary);
          padding: 0 18px;
          display: flex !important;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          font-size: 14px;
          line-height: 1.35;
          text-align: left;
          cursor: pointer;
          white-space: nowrap;
        }
        .tm-smart-block-menu__row > span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tm-smart-block-menu__row--icon {
          display: grid !important;
          grid-template-columns: 22px 1fr;
          justify-content: initial;
        }
        .tm-smart-block-menu__row:hover {
          background: var(--color-hover-bg);
        }
        .tm-smart-block-menu__row--muted {
          color: var(--color-text-secondary);
        }
        .tm-smart-block-menu__row kbd {
          color: var(--color-text-muted);
          font-family: inherit;
          font-size: 13px;
          font-weight: 400;
        }
        .tm-smart-block-menu__sub {
          min-width: 174px;
          padding: 8px 0 !important;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-surface);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
        }
        .tm-smart-block-menu__subitem {
          width: 100%;
          min-height: 32px;
          border: none;
          background: transparent;
          color: var(--color-text-primary);
          padding: 0 14px;
          display: flex !important;
          align-items: center;
          gap: 12px;
          font-size: 14px;
          cursor: pointer;
          text-align: left;
        }
        .tm-smart-block-menu__subitem:hover {
          background: var(--color-hover-bg);
        }
        .tm-smart-block-menu__footer {
          padding: 10px 18px 14px;
          border-top: 1px solid var(--color-border-subtle);
          color: var(--color-text-muted);
          font-size: 13px;
          line-height: 1.6;
        }
      `}</style>
      <div
        className="smart-document-content h-full [&_.bn-container]:!bg-transparent [&_.bn-container]:!pl-8 [&_.bn-container]:!pr-2 [&_.bn-container]:!py-0 [&_.bn-editor]:!min-h-0 [&_.bn-editor]:!px-0 [&_.bn-editor]:!py-2 [&_.bn-editor]:!max-w-none [&_.bn-side-menu]:!gap-0 [&_.bn-editor]:!bg-transparent"
      >
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme={customTheme}
          style={blockNoteViewStyle}
          onChange={handleChange}
          sideMenu={false}
        >
          <SideMenuController sideMenu={SmartDocumentSideMenu} />
        </BlockNoteView>
      </div>
    </div>
  )
})
