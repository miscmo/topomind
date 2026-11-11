import { useCallback, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Check, Copy, Sigma } from 'lucide-react'
import {
  BasicTextStyleButton,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  useComponentsContext,
  useEditorState,
} from '@blocknote/react'
import { useSmartBlockNoteEditor } from '../smartDocumentEditorTypes'
import { TextSelection } from '@tiptap/pm/state'

import {
  getSmartDocumentSelectedTextState,
  type SmartDocumentSelectedTextState,
} from '../smartDocumentUtils'

function useSelectedTextState(): SmartDocumentSelectedTextState | undefined {
  const editor = useSmartBlockNoteEditor()
  return useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return undefined

      const selection = editor.prosemirrorState.selection
      if (selection.empty) return undefined
      // 只认真正的文字选区。整块选区（NodeSelection）的范围是整个块容器，
      // 拿它去做 replaceWith 会把整块换成一行公式 —— 内容就这么没了。
      if (!(selection instanceof TextSelection)) return undefined
      if (!selection.$from.parent.eq(selection.$to.parent)) return undefined

      const rawText = editor.prosemirrorState.doc.textBetween(selection.from, selection.to, '\n')
      const selectedBlocks = editor.getSelection()?.blocks || [editor.getTextCursorPosition().block]
      return getSmartDocumentSelectedTextState(rawText, selectedBlocks)
    },
  })
}

// 当前所选块的对齐方式（图片 / 文件 / 段落 / 标题等支持 textAlignment 的块都返回，
// 不含该属性的自定义块如 codeBlock/mermaid/math 返回 null）。用于恢复「选中图片后
// 在图片上方弹出对齐工具条」这一能力：原本由 BlockNote 默认格式化工具条提供，
// 项目改用自定义工具条（formattingToolbar={false}）后丢失了对齐按钮。
function useCurrentTextAlignment(): 'left' | 'center' | 'right' | null {
  const editor = useSmartBlockNoteEditor()
  return useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return null
      const selection = editor.prosemirrorState.selection
      if (selection.empty) return null
      const blocks = editor.getSelection()?.blocks
      if (!blocks || blocks.length === 0) return null
      const props = (blocks[0].props ?? {}) as Record<string, unknown>
      if (!('textAlignment' in props)) return null
      const value = props.textAlignment
      return value === 'center' || value === 'right' ? value : 'left'
    },
  })
}

function CopySelectionButton({ state }: { state: SmartDocumentSelectedTextState }) {
  const Components = useComponentsContext()
  const editor = useSmartBlockNoteEditor()
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  const handleClick = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyStatus('failed')
      return
    }
    try {
      await navigator.clipboard.writeText(state.rawText)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    } finally {
      editor.focus()
    }
  }, [editor, state.rawText])

  if (!Components) {
    return null
  }

  const label = copyStatus === 'copied'
    ? '已复制'
    : copyStatus === 'failed'
      ? '复制失败'
      : '复制'

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      onClick={() => void handleClick()}
      isSelected={copyStatus === 'copied'}
      label={label}
      mainTooltip={copyStatus === 'failed' ? '剪贴板写入失败' : '复制选中的文字'}
      icon={copyStatus === 'copied' ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={2} />}
    />
  )
}

function SelectionMathButton({ state }: { state: SmartDocumentSelectedTextState }) {
  const Components = useComponentsContext()
  const editor = useSmartBlockNoteEditor()
  const canConvert = state.canConvertInlineMath

  const handleClick = useCallback(() => {
    if (!canConvert) return

    editor.focus()
    const insertAt = editor.prosemirrorState?.selection?.from
    editor.insertInlineContent([
      {
        type: 'inlineMath',
        props: {
          latex: state.latex,
        },
      },
    ])

    // 插入后必须显式把光标放到公式之后：replaceWith 只是映射了原选区，映射
    // 结果仍然是「覆盖刚插入公式」的一段选区，此时用户继续打字就会把公式
    // （甚至更多文字）替换掉，看起来像内容凭空消失。
    if (typeof insertAt !== 'number') return
    const view = editor._tiptapEditor?.view
    if (!view) return
    const after = Math.min(insertAt + 1, view.state.doc.content.size)
    const selection = TextSelection.create(view.state.doc, after)
    view.dispatch(view.state.tr.setSelection(selection))
  }, [canConvert, editor, state.latex])

  if (!Components) {
    return null
  }

  const label = '转为行内公式'
  const tooltip = canConvert
    ? '将选中文字替换为行内 LaTeX 公式'
    : '行内公式仅支持单个文本块内的单行选择'

  return (
    <Components.FormattingToolbar.Button
      className="bn-button tm-formatting-toolbar__secondary"
      onClick={handleClick}
      isSelected={false}
      isDisabled={!canConvert}
      label={label}
      mainTooltip={tooltip}
      icon={<Sigma size={16} strokeWidth={2} />}
    />
  )
}

function TextAlignmentButton({
  value,
  active,
  onSelect,
}: {
  value: 'left' | 'center' | 'right'
  active: boolean
  onSelect: (value: 'left' | 'center' | 'right') => void
}) {
  const Components = useComponentsContext()
  if (!Components) return null

  const icon = value === 'left'
    ? <AlignLeft size={16} strokeWidth={2} />
    : value === 'center'
      ? <AlignCenter size={16} strokeWidth={2} />
      : <AlignRight size={16} strokeWidth={2} />
  const label = value === 'left' ? '左对齐' : value === 'center' ? '居中' : '右对齐'

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      isSelected={active}
      label={label}
      mainTooltip={label}
      icon={icon}
      onClick={() => onSelect(value)}
    />
  )
}

export function SmartDocumentFormattingToolbar() {
  const selectionState = useSelectedTextState()
  const alignment = useCurrentTextAlignment()
  const editor = useSmartBlockNoteEditor()

  const handleAlign = useCallback((value: 'left' | 'center' | 'right') => {
    const blocks = editor.getSelection()?.blocks
    if (!blocks) return
    for (const block of blocks) {
      const props = (block.props ?? {}) as Record<string, unknown>
      if ('textAlignment' in props) {
        editor.updateBlock(block, { props: { textAlignment: value } })
      }
    }
  }, [editor])

  return (
    <FormattingToolbar>
      {selectionState ? (
        <>
          <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
          <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
          <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
          <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
          <ColorStyleButton key="colorStyleButton" />
          <CopySelectionButton key="copySelectionButton" state={selectionState} />
          <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />
          <SelectionMathButton key="inlineMathButton" state={selectionState} />
          <CreateLinkButton key="createLinkButton" />
        </>
      ) : null}
      {alignment ? (
        <>
          <TextAlignmentButton value="left" active={alignment === 'left'} onSelect={handleAlign} />
          <TextAlignmentButton value="center" active={alignment === 'center'} onSelect={handleAlign} />
          <TextAlignmentButton value="right" active={alignment === 'right'} onSelect={handleAlign} />
        </>
      ) : null}
    </FormattingToolbar>
  )
}
