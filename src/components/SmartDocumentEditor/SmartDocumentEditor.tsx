import { memo, useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { DragHandleButton, SideMenu, SideMenuController, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useExtension, useExtensionState, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { insertMermaid } from 'blocknote-mermaid'
import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import { AiOutlinePlus } from 'react-icons/ai'
import { useThemeStore } from '../../stores/themeStore'
import { useGraphUiStore } from '../../stores/graphUiStore'
import type { SmartDocumentContent } from './smartDocumentTypes'
import { createDefaultBlockNoteBlocks, withSmartDocumentUpdatedAt } from './smartDocumentTypes'
import { calculateSmartDocumentStats, extractSmartDocumentToc, inlineContentToText } from './smartDocumentUtils'
import { smartDocumentSchema } from './smartDocumentSchema'
import { useSmartDocumentAttachmentInsert } from './useSmartDocumentAttachmentInsert'
import type { TocItem } from '../DocumentWorkspaceLayout/workspaceTypes'
import 'katex/dist/katex.min.css'
import '@blocknote/mantine/style.css'
import './SmartDocumentEditor.css'

interface SmartDocumentEditorProps {
  value: SmartDocumentContent
  onChange: (value: SmartDocumentContent) => void
  onTocChange?: (items: TocItem[]) => void
  onTocItemClickReady?: (handler: ((item: TocItem) => void) | null) => void
  readOnly?: boolean
  uploadFile?: (file: File) => Promise<string>
  onWordCountChange?: (stats: { characters: number; words: number; blocks: number }) => void
  attachmentInsertTargetKey?: string
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
  { key: 'table', icon: '▦', label: '表格', type: 'table' },
  { key: 'mermaid', icon: '⫸', label: '流程图 (Mermaid)', type: 'mermaid' },
  { key: 'math', icon: '∑', label: '数学公式 (KaTeX)', type: 'math' },
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

function SmartDocumentSideMenuBoundary({ editorRootRef }: { editorRootRef: RefObject<HTMLDivElement | null> }) {
  const sideMenu = useExtension(SideMenuExtension)

  useEffect(() => {
    const ownerDocument = editorRootRef.current?.ownerDocument ?? document
    const handleMouseMove = (event: MouseEvent) => {
      const editorRoot = editorRootRef.current
      const target = event.target
      if (!editorRoot || !(target instanceof Node)) return
      if (editorRoot.contains(target)) return
      sideMenu.hideMenuIfNotFrozen()
    }

    ownerDocument.addEventListener('mousemove', handleMouseMove, true)
    return () => ownerDocument.removeEventListener('mousemove', handleMouseMove, true)
  }, [editorRootRef, sideMenu])

  return null
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

export const SmartDocumentEditor = memo(function SmartDocumentEditor({ value, onChange, onTocChange, onTocItemClickReady, readOnly = false, uploadFile, onWordCountChange, attachmentInsertTargetKey }: SmartDocumentEditorProps) {
  const theme = useThemeStore((state) => state.theme)
  const defaultEditorStyle = useGraphUiStore((state) => state.defaultEditorStyle)

  const initialContent = useMemo(() => {
    // If the document has no blocks at all (new document), let BlockNote use its default empty paragraph
    // instead of forcing a heading or any other structure.
    const blocks = createDefaultBlockNoteBlocks(value.blocks)
    return blocks.length > 0 ? blocks : undefined
  }, [])
  const editor = useCreateBlockNote({
    schema: smartDocumentSchema,
    initialContent,
    uploadFile,
  })

  const updateStatsAndTocRef = useRef<number | null>(null)

  const updateStatsAndToc = useCallback((isImmediate = false) => {
    if (updateStatsAndTocRef.current !== null) {
      window.clearTimeout(updateStatsAndTocRef.current)
    }

    const execute = () => {
      onTocChange?.(extractSmartDocumentToc(editor))
      onWordCountChange?.(calculateSmartDocumentStats(editor))
    }

    if (isImmediate) {
      execute()
    } else {
      updateStatsAndTocRef.current = window.setTimeout(execute, 500)
    }
  }, [editor, onTocChange, onWordCountChange])

  const handleChange = useCallback(() => {
    const nextValue = withSmartDocumentUpdatedAt({
      ...value,
      blocks: editor.document,
    })
    onChange(nextValue)
    updateStatsAndToc(false)
  }, [editor, onChange, value, updateStatsAndToc])

  const handleTocItemClick = useCallback((item: TocItem) => {
    try {
      editor.setTextCursorPosition(item.id, 'start')
      editor.prosemirrorView.dispatch(editor.prosemirrorView.state.tr.scrollIntoView())
      editor.focus()
    } catch {
      updateStatsAndToc(true)
    }
  }, [editor, updateStatsAndToc])

  useEffect(() => {
    updateStatsAndToc(true)
    onTocItemClickReady?.(handleTocItemClick)
    return () => {
      if (updateStatsAndTocRef.current !== null) {
        window.clearTimeout(updateStatsAndTocRef.current)
      }
      onTocChange?.([])
      onWordCountChange?.({ characters: 0, words: 0, blocks: 0 })
      onTocItemClickReady?.(null)
    }
  }, [editor, handleTocItemClick, onTocChange, onWordCountChange, onTocItemClickReady, updateStatsAndToc])

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

  useSmartDocumentAttachmentInsert(editor as any, attachmentInsertTargetKey)

  const blockNoteViewStyle = useMemo(() => ({
    '--topomind-smart-body-font-size': `${defaultEditorStyle.fontSize}px`,
    '--topomind-smart-line-height': String(defaultEditorStyle.lineHeight),
  }) as CSSProperties, [defaultEditorStyle.fontSize, defaultEditorStyle.lineHeight])
  const editorRootRef = useRef<HTMLDivElement>(null)

  return (
    <div className="h-full min-h-0 overflow-y-auto" spellCheck={false} style={{ backgroundColor: defaultEditorStyle.backgroundColor || 'var(--color-surface)' }}>
      <div
        ref={editorRootRef}
        className="smart-document-content h-full [&_.bn-container]:!bg-transparent [&_.bn-container]:!pl-8 [&_.bn-container]:!pr-4 [&_.bn-container]:!py-0 [&_.bn-container]:!max-w-[800px] [&_.bn-container]:!mx-auto [&_.bn-container]:!w-full [&_.bn-editor]:!min-h-0 [&_.bn-editor]:!px-0 [&_.bn-editor]:!py-4 [&_.bn-editor]:!w-full [&_.bn-side-menu]:!gap-0 [&_.bn-editor]:!bg-transparent"
      >
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme={customTheme}
          style={blockNoteViewStyle}
          onChange={handleChange}
          sideMenu={false}
          slashMenu={false}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                [
                  ...getDefaultReactSlashMenuItems(editor),
                  insertMermaid(),
                  {
                    title: '数学公式 (KaTeX)',
                    onItemClick: () => {
                      editor.insertBlocks(
                        [
                          {
                            type: 'math',
                          },
                        ],
                        editor.getTextCursorPosition().block,
                        'after'
                      )
                    },
                    aliases: ['math', 'equation', 'latex', 'katex'],
                    group: 'Media',
                    icon: <span>∑</span>,
                    subtext: '插入 LaTeX 数学公式',
                  } as any,
                ],
                query
              )
            }
          />
          <SmartDocumentSideMenuBoundary editorRootRef={editorRootRef} />
          <SideMenuController sideMenu={SmartDocumentSideMenu} />
        </BlockNoteView>
      </div>
    </div>
  )
})
