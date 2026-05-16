import { memo, useCallback, useMemo } from 'react'
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { syntaxHighlighting, defaultHighlightStyle, foldGutter } from '@codemirror/language'
import { useStorage } from '../../core/storage'
import { handleMarkdownPaste, handleMarkdownDrop } from './AttachmentPipeline'

interface MarkdownSourceEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  onEditorCreate?: (view: EditorView) => void
  attachmentCardPath?: string | null
  placeholder?: string
}

export const MarkdownSourceEditor = memo(function MarkdownSourceEditor({
  value,
  onChange,
  onSave,
  onEditorCreate,
  attachmentCardPath,
  placeholder
}: MarkdownSourceEditorProps) {
  const storage = useStorage()

  const handleCreate = useCallback((view: EditorView) => {
    if (onEditorCreate) onEditorCreate(view)
  }, [onEditorCreate])

  const saveCommand = useCallback(() => {
    if (onSave) onSave()
    return true
  }, [onSave])

  const customKeymap = useMemo(() => {
    return keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
      { key: 'Mod-s', run: saveCommand, preventDefault: true }
    ])
  }, [saveCommand])

  const domEventHandlers = useMemo(() => {
    return EditorView.domEventHandlers({
      paste(event, view) {
        if (!attachmentCardPath) return false
        const selection = view.state.selection.main
        
        handleMarkdownPaste({
          event,
          value: view.state.doc.toString(),
          selectionStart: selection.from,
          selectionEnd: selection.to,
          attachmentCardPath,
          storage
        }).then(({ handled, nextValue, nextCursor }) => {
          if (handled && nextValue !== undefined) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: nextValue },
              selection: nextCursor !== undefined ? { anchor: nextCursor } : undefined
            })
          }
        })
        return false // Let CM handle default paste if pipeline doesn't block it (prevent default is inside pipeline)
      },
      drop(event, view) {
        if (!attachmentCardPath) return false
        
        // Find drop position
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false
        
        handleMarkdownDrop({
          event,
          value: view.state.doc.toString(),
          selectionStart: pos,
          selectionEnd: pos,
          attachmentCardPath,
          storage
        }).then(({ handled, nextValue, nextCursor }) => {
          if (handled && nextValue !== undefined) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: nextValue },
              selection: nextCursor !== undefined ? { anchor: nextCursor } : undefined
            })
          }
        })
        return false
      }
    })
  }, [attachmentCardPath, storage])

  const extensions = useMemo(() => [
    history(),
    highlightSelectionMatches(),
    foldGutter(),
    autocompletion(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    customKeymap,
    domEventHandlers,
    EditorView.lineWrapping
  ], [customKeymap, domEventHandlers])

  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <ReactCodeMirror
        value={value}
        onChange={onChange}
        theme="light"
        height="100%"
        extensions={extensions}
        onCreateEditor={handleCreate}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
        }}
        placeholder={placeholder}
        style={{ height: '100%' }}
      />
    </div>
  )
})
