import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import type { StorageService } from '../../../core/storage'

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly attachmentCardPath: string | null | undefined,
    readonly storage: StorageService
  ) {
    super()
  }

  eq(other: ImageWidget) {
    return other.url === this.url && other.title === this.title
  }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-inline-image-wrap'
    wrap.style.display = 'block'
    wrap.style.margin = '8px 0'
    wrap.style.maxWidth = '100%'
    
    const img = document.createElement('img')
    img.style.maxWidth = '100%'
    img.style.maxHeight = '400px'
    img.style.borderRadius = '6px'
    img.style.cursor = 'pointer'
    img.alt = this.title
    img.title = this.title
    
    if (this.url.startsWith('_attach/') && this.attachmentCardPath) {
      this.storage.resolveAttachmentUrl(this.attachmentCardPath, this.url).then(resolvedUrl => {
        if (resolvedUrl) {
          img.src = resolvedUrl
        }
      }).catch(err => {
        console.error('Failed to resolve attachment URL for inline preview', err)
      })
    } else {
      img.src = this.url
    }

    wrap.appendChild(img)
    return wrap
  }
}

export function inlineImagePlugin(attachmentCardPath: string | null | undefined, storage: StorageService) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: any) {
        this.decorations = this.buildDecorations(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view)
        }
      }

      buildDecorations(view: any) {
        const builder = new RangeSetBuilder<Decoration>()
        const text = view.state.doc.toString()
        const imageRegex = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"\r\n]*)")?\)/g
        
        let match
        while ((match = imageRegex.exec(text)) !== null) {
          const from = match.index
          const to = from + match[0].length
          const title = match[1]
          const url = match[2]
          
          builder.add(
            to,
            to,
            Decoration.widget({
              widget: new ImageWidget(url, title, attachmentCardPath, storage),
              side: 1,
              block: true
            })
          )
        }
        
        return builder.finish()
      }
    },
    {
      decorations: v => v.decorations
    }
  )
}
