import { KeyBinding, EditorView } from '@codemirror/view'
import { toggleBold, toggleItalic } from './markdownCommands'

export const continueList = (view: EditorView) => {
  const selection = view.state.selection.main
  const line = view.state.doc.lineAt(selection.from)
  
  // Match common list bullet formats: "- [ ] ", "- ", "* ", "1. ", "> "
  const match = line.text.match(/^(\s*)(-\s\[[ x]\]\s|-\s|\*\s|\d+\.\s|>\s)/)
  
  if (match) {
    const bullet = match[1] + match[2]
    
    // If the line only contains the bullet (empty item), clear it instead of creating a new empty one
    if (line.text.trim() === bullet.trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" }
      })
      return true
    }
    
    let nextBullet = bullet
    
    // Auto increment ordered lists
    const numMatch = bullet.match(/^(\s*)(\d+)(\.\s)/)
    if (numMatch) {
      const nextNum = parseInt(numMatch[2], 10) + 1
      nextBullet = numMatch[1] + nextNum + numMatch[3]
    }
    
    // Handle checkbox lists - always create an empty checkbox for the next line
    const todoMatch = bullet.match(/^(\s*)(-\s)\[[ x]\](\s)/)
    if (todoMatch) {
      nextBullet = todoMatch[1] + todoMatch[2] + '[ ]' + todoMatch[3]
    }

    view.dispatch({
      changes: { from: selection.from, insert: "\n" + nextBullet },
      selection: { anchor: selection.from + nextBullet.length + 1 },
      scrollIntoView: true
    })
    return true
  }
  
  return false // Return false to let the default Enter behavior happen
}

export const markdownKeymap: KeyBinding[] = [
  { 
    key: "Mod-b", 
    run: (view) => { toggleBold(view); return true; },
    preventDefault: true
  },
  { 
    key: "Mod-i", 
    run: (view) => { toggleItalic(view); return true; },
    preventDefault: true
  },
  {
    key: "Enter",
    run: continueList
  }
]
