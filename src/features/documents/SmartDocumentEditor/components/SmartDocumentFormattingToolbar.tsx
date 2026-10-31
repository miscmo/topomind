import { useCallback, useState } from 'react'
import { Check, Copy, Sigma } from 'lucide-react'
import {
  BasicTextStyleButton,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
} from '@blocknote/react'

import {
  getSmartDocumentSelectedTextState,
  type SmartDocumentSelectedTextState,
} from '../smartDocumentUtils'

function useSelectedTextState(): SmartDocumentSelectedTextState | undefined {
  const editor = useBlockNoteEditor<any, any, any>()
  return useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return undefined

      const selection = editor.prosemirrorState.selection
      if (selection.empty) return undefined

      const rawText = editor.prosemirrorState.doc.textBetween(selection.from, selection.to, '\n')
      const selectedBlocks = editor.getSelection()?.blocks || [editor.getTextCursorPosition().block]
      return getSmartDocumentSelectedTextState(rawText, selectedBlocks)
    },
  })
}

function CopySelectionButton({ state }: { state: SmartDocumentSelectedTextState }) {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
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
  const editor = useBlockNoteEditor<any, any, any>()
  const canConvert = state.canConvertInlineMath

  const handleClick = useCallback(() => {
    if (!canConvert) return

    editor.focus()
    editor.insertInlineContent([
      {
        type: 'inlineMath',
        props: {
          latex: state.latex,
        },
      },
    ] as any)
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
