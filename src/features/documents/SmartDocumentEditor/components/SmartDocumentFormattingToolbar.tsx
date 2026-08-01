import { useCallback, useState } from 'react'
import { Check, Copy, Sigma, SquareSigma } from 'lucide-react'
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  NestBlockButton,
  TextAlignButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
} from '@blocknote/react'

import { createBlockMathHtml } from '../mathPaste'
import {
  getSmartDocumentSelectedTextState,
  type SmartDocumentSelectedTextState,
} from '../smartDocumentUtils'

type MathButtonMode = 'inline' | 'block'

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

function SelectionMathButton({ mode, state }: { mode: MathButtonMode, state: SmartDocumentSelectedTextState }) {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const canConvert = mode === 'inline' ? state.canConvertInlineMath : state.canConvertBlockMath

  const handleClick = useCallback(() => {
    if (!canConvert) return

    editor.focus()

    if (mode === 'inline') {
      editor.insertInlineContent([
        {
          type: 'inlineMath',
          props: {
            latex: state.latex,
          },
        },
      ] as any)
      return
    }

    editor.pasteHTML(createBlockMathHtml(state.latex))
  }, [canConvert, editor, mode, state.latex])

  if (!Components) {
    return null
  }

  const isInline = mode === 'inline'
  const label = isInline ? '转为行内公式' : '转为行间公式'
  const tooltip = canConvert
    ? isInline
      ? '将选中文字替换为行内 LaTeX 公式'
      : '将选中文字替换为块级 LaTeX 公式'
    : isInline
      ? '行内公式仅支持单个文本块内的单行选择'
      : '所选内容包含不能转换为公式的块'

  return (
    <Components.FormattingToolbar.Button
      className="bn-button tm-formatting-toolbar__secondary"
      onClick={handleClick}
      isSelected={false}
      isDisabled={!canConvert}
      label={label}
      mainTooltip={tooltip}
      icon={isInline ? <Sigma size={16} strokeWidth={2} /> : <SquareSigma size={16} strokeWidth={2} />}
    />
  )
}

export function SmartDocumentFormattingToolbar() {
  const selectionState = useSelectedTextState()

  return (
    <FormattingToolbar>
      <BlockTypeSelect key="blockTypeSelect" />
      <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
      <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
      <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
      <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
      {selectionState ? <CopySelectionButton key="copySelectionButton" state={selectionState} /> : null}
      {selectionState ? <SelectionMathButton key="inlineMathButton" mode="inline" state={selectionState} /> : null}
      {selectionState ? <SelectionMathButton key="blockMathButton" mode="block" state={selectionState} /> : null}
      <TextAlignButton textAlignment="left" key="textAlignLeftButton" />
      <TextAlignButton textAlignment="center" key="textAlignCenterButton" />
      <TextAlignButton textAlignment="right" key="textAlignRightButton" />
      <ColorStyleButton key="colorStyleButton" />
      <NestBlockButton key="nestBlockButton" />
      <UnnestBlockButton key="unnestBlockButton" />
      <CreateLinkButton key="createLinkButton" />
    </FormattingToolbar>
  )
}
