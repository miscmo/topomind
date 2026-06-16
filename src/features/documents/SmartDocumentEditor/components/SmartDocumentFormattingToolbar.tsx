import { useCallback } from 'react'
import { Copy, Sigma, SquareSigma } from 'lucide-react'
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

type MathButtonMode = 'inline' | 'block'

function useSelectedTextState() {
  const editor = useBlockNoteEditor<any, any, any>()
  return useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return undefined

      const selection = editor.prosemirrorState.selection
      if (selection.empty) return undefined

      const selectedText = editor.prosemirrorState.doc.textBetween(selection.from, selection.to, '\n')
      const latex = selectedText.trim()
      if (!latex) return undefined

      const selectedBlocks = editor.getSelection()?.blocks || [editor.getTextCursorPosition().block]
      const supportsInlineContent = selectedBlocks.some((block) => block.content !== undefined)
      if (!supportsInlineContent) return undefined

      return { latex }
    },
  })
}

function CopySelectionButton() {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const state = useSelectedTextState()

  const handleClick = useCallback(() => {
    if (!state?.latex) return
    void navigator.clipboard?.writeText(state.latex)
    editor.focus()
  }, [editor, state])

  if (!Components || !state) {
    return null
  }

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      onClick={handleClick}
      isSelected={false}
      label="复制"
      mainTooltip="复制选中的文字"
      icon={<Copy size={16} strokeWidth={2} />}
    />
  )
}

function SelectionMathButton({ mode }: { mode: MathButtonMode }) {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const state = useSelectedTextState()
  const normalizedLatex =
    !state ? undefined
      : mode === 'inline'
        ? state.latex.includes('\n') ? undefined : state.latex
        : state.latex

  const handleClick = useCallback(() => {
    if (!normalizedLatex) return

    editor.focus()

    if (mode === 'inline') {
      editor.insertInlineContent([
        {
          type: 'inlineMath',
          props: {
            latex: normalizedLatex,
          },
        },
      ] as any)
      return
    }

    editor.pasteHTML(createBlockMathHtml(normalizedLatex))
  }, [editor, mode, normalizedLatex])

  if (!Components || !normalizedLatex) {
    return null
  }

  const isInline = mode === 'inline'
  const label = isInline ? '转为行内公式' : '转为行间公式'
  const tooltip = isInline ? '将选中文字替换为行内 LaTeX 公式' : '将选中文字替换为块级 LaTeX 公式'

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      onClick={handleClick}
      isSelected={false}
      label={label}
      mainTooltip={tooltip}
      icon={isInline ? <Sigma size={16} strokeWidth={2} /> : <SquareSigma size={16} strokeWidth={2} />}
    />
  )
}

export function SmartDocumentFormattingToolbar() {
  return (
    <FormattingToolbar>
      <BlockTypeSelect key="blockTypeSelect" />
      <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
      <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
      <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
      <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
      <CopySelectionButton key="copySelectionButton" />
      <SelectionMathButton key="inlineMathButton" mode="inline" />
      <SelectionMathButton key="blockMathButton" mode="block" />
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
