import { memo, useCallback, useMemo } from 'react'
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { syntaxHighlighting, defaultHighlightStyle, foldGutter } from '@codemirror/language'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import { useStorage } from '../../core/storage'
import { useThemeStore } from '../../stores/themeStore'
import { handleMarkdownPaste, handleMarkdownDrop } from './AttachmentPipeline'
import { slashCommandCompletion } from './slashCommandPlugin'
import { markdownKeymap } from './markdownShortcuts'

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
  const theme = useThemeStore((s) => s.theme)

  const handleCreate = useCallback((view: EditorView) => {
    if (onEditorCreate) onEditorCreate(view)
  }, [onEditorCreate])

  const saveCommand = useCallback(() => {
    if (onSave) onSave()
    return true
  }, [onSave])

  const customKeymap = useMemo(() => {
    return keymap.of([
      ...markdownKeymap,
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
    autocompletion({ override: [slashCommandCompletion] }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    customKeymap,
    eventHandlers,
    EditorView.lineWrapping,
    EditorView.theme({
      ".cm-tooltip.cm-tooltip-autocomplete": {
        backgroundColor: "var(--titlebar-menu-bg, var(--color-surface))",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-popover, 0 4px 12px rgba(0,0,0,0.1))",
        borderRadius: "8px",
        padding: "4px",
      },
      ".cm-tooltip-autocomplete > ul": {
        fontFamily: "inherit",
        maxHeight: "250px",
      },
      ".cm-tooltip-autocomplete > ul > li": {
        padding: "6px 8px",
        borderRadius: "6px",
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        cursor: "pointer",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--color-hover-bg, rgba(0,0,0,0.05))",
        color: "var(--color-primary)",
      },
      ".cm-completionLabel": {
        fontWeight: "500",
      },
      ".cm-completionDetail": {
        color: "var(--color-text-muted, #888)",
        fontSize: "12px",
        fontStyle: "normal",
      }
    })
  ], [customKeymap, eventHandlers, attachmentCardPath, storage])

  return (
    <div className="h-full overflow-hidden bg-white !bg-[var(--color-surface)] [&_.cm-editor]:h-full [&_.cm-editor]:bg-white [&_.cm-editor]:!bg-[var(--color-surface)] [&_.cm-scroller]:[&::-webkit-scrollbar]:w-2.5 [&_.cm-scroller]:[&::-webkit-scrollbar]:h-2.5 [&_.cm-scroller]:[&::-webkit-scrollbar-track]:bg-transparent [&_.cm-scroller]:[&::-webkit-scrollbar-thumb]:bg-transparent [&_.cm-scroller]:[&::-webkit-scrollbar-thumb]:border-[3px] [&_.cm-scroller]:[&::-webkit-scrollbar-thumb]:border-transparent [&_.cm-scroller]:[&::-webkit-scrollbar-thumb]:rounded-full [&_.cm-scroller]:[&::-webkit-scrollbar-thumb]:bg-clip-content [&_.cm-scroller]:[&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_0_10px_rgba(148,163,184,0.34)] hover:[&_.cm-scroller]:[&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_0_10px_rgba(100,116,139,0.5)] [&_.cm-gutters]:[&::-webkit-scrollbar]:w-2.5 [&_.cm-gutters]:[&::-webkit-scrollbar]:h-2.5 [&_.cm-gutters]:[&::-webkit-scrollbar-track]:bg-transparent [&_.cm-gutters]:[&::-webkit-scrollbar-thumb]:bg-transparent [&_.cm-gutters]:[&::-webkit-scrollbar-thumb]:border-[3px] [&_.cm-gutters]:[&::-webkit-scrollbar-thumb]:border-transparent [&_.cm-gutters]:[&::-webkit-scrollbar-thumb]:rounded-full [&_.cm-gutters]:[&::-webkit-scrollbar-thumb]:bg-clip-content [&_.cm-gutters]:[&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_0_10px_rgba(148,163,184,0.34)] hover:[&_.cm-gutters]:[&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_0_10px_rgba(100,116,139,0.5)] [&_.cm-activeLine]:bg-blue-500/5 [&_.cm-activeLineGutter]:bg-blue-500/5 [&_.cm-gutters]:border-r [&_.cm-gutters]:border-[#eef2f7] [&_.cm-gutters]:!border-[var(--color-border-subtle)] [&_.cm-gutters]:bg-[#fbfcfe] [&_.cm-gutters]:!bg-[var(--color-bg)] [&_.cm-content]:caret-[var(--color-accent)] [&_.cm-line]:caret-[var(--color-accent)]">
      <ReactCodeMirror
        value={value || ''}
        onChange={onChange}
        theme={theme === 'dark' ? githubDark : githubLight}
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
