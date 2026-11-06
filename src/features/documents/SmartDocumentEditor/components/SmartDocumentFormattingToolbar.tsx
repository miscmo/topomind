import { useCallback, useState } from 'react'
import { Check, Copy, Sigma } from 'lucide-react'
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

export function SmartDocumentFormattingToolbar() {
  const selectionState = useSelectedTextState()

  return (
    <FormattingToolbar>
      <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
      <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
      <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
      <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
      <ColorStyleButton key="colorStyleButton" />
      {selectionState ? <CopySelectionButton key="copySelectionButton" state={selectionState} /> : null}
      <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />
      {selectionState ? <SelectionMathButton key="inlineMathButton" state={selectionState} /> : null}
      <CreateLinkButton key="createLinkButton" />
    </FormattingToolbar>
  )
}
