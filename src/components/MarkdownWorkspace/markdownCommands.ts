import { EditorView } from '@codemirror/view'

export function insertTextAtCursor(view: EditorView, text: string, cursorOffset: number = text.length) {
  const selection = view.state.selection.main
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + cursorOffset },
    scrollIntoView: true
  })
  view.focus()
}

export function toggleBold(view: EditorView) {
  const selection = view.state.selection.main
  const text = view.state.sliceDoc(selection.from, selection.to)
  
  if (text.startsWith('**') && text.endsWith('**')) {
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text.slice(2, -2) },
      selection: { anchor: selection.from, head: selection.to - 4 }
    })
  } else {
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `**${text}**` },
      selection: { anchor: selection.from + 2, head: selection.to + 2 }
    })
  }
  view.focus()
}

export function toggleItalic(view: EditorView) {
  const selection = view.state.selection.main
  const text = view.state.sliceDoc(selection.from, selection.to)
  
  if (text.startsWith('*') && text.endsWith('*')) {
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text.slice(1, -1) },
      selection: { anchor: selection.from, head: selection.to - 2 }
    })
  } else {
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `*${text}*` },
      selection: { anchor: selection.from + 1, head: selection.to + 1 }
    })
  }
  view.focus()
}

export function insertHeading(view: EditorView, level: number) {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const prefix = '#'.repeat(level) + ' '
  const text = line.text
  
  const match = text.match(/^(#+)\s(.*)/)
  if (match) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: prefix + match[2] }
    })
  } else {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: prefix + text }
    })
  }
  view.focus()
}

export function insertLink(view: EditorView) {
  const selection = view.state.selection.main
  const text = view.state.sliceDoc(selection.from, selection.to) || 'text'
  insertTextAtCursor(view, `[${text}](url)`, text.length + 3)
}

export function insertImage(view: EditorView) {
  const selection = view.state.selection.main
  const text = view.state.sliceDoc(selection.from, selection.to) || 'alt'
  insertTextAtCursor(view, `![${text}](url)`, text.length + 4)
}

export function insertAttachmentLink(view: EditorView, attachmentPath: string, isImage: boolean, name: string) {
  const md = isImage ? `![${name}](${attachmentPath})` : `[${name}](${attachmentPath})`
  insertTextAtCursor(view, md)
}

export function insertCodeBlock(view: EditorView, language: string = '') {
  const selection = view.state.selection.main
  const text = view.state.sliceDoc(selection.from, selection.to)
  const block = `\`\`\`${language}\n${text}\n\`\`\``
  insertTextAtCursor(view, block, language.length + 4)
}

export function insertMermaidBlock(view: EditorView) {
  const template = `\`\`\`mermaid\ngraph TD\n  A-->B;\n\`\`\``
  insertTextAtCursor(view, template, template.length - 4)
}

export function insertTable(view: EditorView) {
  const table = `\n| Column 1 | Column 2 |\n| -------- | -------- |\n| Text     | Text     |\n`
  insertTextAtCursor(view, table)
}

export function insertTaskList(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({
    changes: { from: line.from, insert: '- [ ] ' },
    selection: { anchor: line.from + 6 }
  })
  view.focus()
}
