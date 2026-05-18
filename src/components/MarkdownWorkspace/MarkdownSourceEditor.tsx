import { memo, useCallback, useMemo } from 'react'
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { syntaxHighlighting, defaultHighlightStyle, foldGutter } from '@codemirror/language'
import { githubLight } from '@uiw/codemirror-theme-github'
import { useStorage } from '../../core/storage'
import { handleMarkdownPaste, handleMarkdownDrop } from './AttachmentPipeline'
import styles from './MarkdownWorkspace.module.css'

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

  const eventHandlers = useMemo(() => {
    return EditorView.domEventHandlers({
      paste(event, view) {
        if (!attachmentCardPath) return false
        
        // This must be synchronous to stop default paste behavior if we are handling it
        const clipboardData = 'clipboardData' in event ? (event as ClipboardEvent).clipboardData : null
        const hasFiles = clipboardData && clipboardData.files && clipboardData.files.length > 0
        
        handleMarkdownPaste({
          event,
          value: view.state.doc.toString(),
          selectionStart: view.state.selection.main.from,
          selectionEnd: view.state.selection.main.to,
          attachmentCardPath,
          storage
        }).then(({ handled, nextValue, nextCursor }) => {
          if (handled && nextValue !== undefined) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: nextValue },
              selection: nextCursor !== undefined ? { anchor: nextCursor } : undefined
            })
            // Force React re-render by calling onChange explicitly
            if (onChange) {
              onChange(nextValue)
            }
            window.dispatchEvent(new Event('markdown-attachment-uploaded'))
            view.focus()
          }
        })
        
        return !!hasFiles
      },
      drop(event, view) {
        if (!attachmentCardPath) return false
        
        // Find drop position
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false
        
        const dataTransfer = 'dataTransfer' in event ? (event as DragEvent).dataTransfer : null
        const hasFiles = dataTransfer && dataTransfer.files && dataTransfer.files.length > 0
        
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
            // Force React re-render by calling onChange explicitly
            // (otherwise external components might not catch this change)
            if (onChange) {
              onChange(nextValue)
            }
            window.dispatchEvent(new Event('markdown-attachment-uploaded'))
            view.focus()
          }
        })
        
        return !!hasFiles
      }
    })
  }, [attachmentCardPath, storage, onChange])

  const extensions = useMemo(() => [
    history(),
    highlightSelectionMatches(),
    foldGutter(),
    autocompletion(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    customKeymap,
    eventHandlers,
    EditorView.lineWrapping
  ], [customKeymap, eventHandlers])

  return (
    <div className={styles.editorSurface}>
      <ReactCodeMirror
        value={value}
        onChange={onChange}
        theme={githubLight}
        height="100%"
        extensions={extensions}
        onCreateEditor={handleCreate}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
        }}
        placeholder={placeholder}
        style={{ height: '100%', fontSize: '13px', fontFamily: '"SF Mono", "Fira Code", Consolas, monospace' }}
      />
    </div>
  )
})
