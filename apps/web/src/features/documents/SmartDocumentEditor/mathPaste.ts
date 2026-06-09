import { markdownToHTML } from '@blocknote/core'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function createInlineMathHtml(latex: string): string {
  return `<span data-inline-content-type="inlineMath" data-latex="${escapeHtml(latex)}"></span>`
}

export function createBlockMathHtml(expression: string): string {
  return `<div data-content-type="math" data-expression="${escapeHtml(expression)}"></div>`
}

function createTemplateFragment(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function replaceInlineMathInText(text: string): string {
  return text.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g, (_match, prefix: string, latex: string) => {
    return `${prefix}${createInlineMathHtml(latex)}`
  })
}

function replaceInlineMathInMarkdownLine(line: string): string {
  const segments = line.split(/(`+[^`]*?`+)/g)
  return segments.map((segment) => {
    if (/^`+[^`]*?`+$/.test(segment)) {
      return segment
    }
    return replaceInlineMathInText(segment)
  }).join('')
}

export function containsMathDelimiters(text: string): boolean {
  if (!text) return false
  return /(^|\n)\s*\$\$[\s\S]*?\$\$\s*($|\n)/m.test(text) || /(^|[^\\])\$[^$\n]+\$(?!\$)/m.test(text)
}

export function containsMarkdownDelimiters(text: string): boolean {
  if (!text) return false
  return (
    // Bold / Italic (e.g. **bold** or __bold__)
    /(\*\*|__)(?!\s)[\s\S]+?(?<!\s)\1/.test(text) ||
    // Headings
    /(^|\n)#{1,6}\s/.test(text) ||
    // Lists
    /(^|\n)\s*([*+-]|\d+\.)\s/.test(text) ||
    // Blockquote
    /(^|\n)>\s/.test(text) ||
    // Code block or inline code
    /`{1,3}[^`]+`{1,3}/.test(text) ||
    // Links
    /\[[^\]]+\]\([^)]+\)/.test(text)
  )
}

export function containsStrictMarkdownDelimiters(text: string): boolean {
  if (!text) return false
  return (
    // Bold / Italic (e.g. **bold** or __bold__)
    /(\*\*|__)(?!\s)[\s\S]+?(?<!\s)\1/.test(text) ||
    // Code block or inline code
    /`{1,3}[^`]+`{1,3}/.test(text) ||
    // Links
    /\[[^\]]+\]\([^)]+\)/.test(text)
  )
}

export function convertMarkdownWithMathToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const convertedLines: string[] = []
  let inCodeFence = false
  let activeFence = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      const fence = fenceMatch[1]
      if (!inCodeFence) {
        inCodeFence = true
        activeFence = fence[0]
      } else if (fence[0] === activeFence) {
        inCodeFence = false
        activeFence = ''
      }
      convertedLines.push(line)
      continue
    }

    if (inCodeFence) {
      convertedLines.push(line)
      continue
    }

    const trimmed = line.trim()
    const singleLineBlockMatch = trimmed.match(/^\$\$\s*([\s\S]*?)\s*\$\$$/)
    if (singleLineBlockMatch) {
      convertedLines.push('')
      convertedLines.push(createBlockMathHtml(singleLineBlockMatch[1] || ''))
      convertedLines.push('')
      continue
    }

    if (trimmed === '$$') {
      const expressionLines: string[] = []
      let cursor = index + 1
      while (cursor < lines.length && lines[cursor].trim() !== '$$') {
        expressionLines.push(lines[cursor])
        cursor += 1
      }

      if (cursor < lines.length) {
        convertedLines.push('')
        convertedLines.push(createBlockMathHtml(expressionLines.join('\n').trim()))
        convertedLines.push('')
        index = cursor
        continue
      }
    }

    convertedLines.push(replaceInlineMathInMarkdownLine(line))
  }

  return markdownToHTML(convertedLines.join('\n'))
}

function replaceInlineMathInHtmlDocument(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []

  while (walker.nextNode()) {
    const current = walker.currentNode
    if (!(current instanceof Text)) continue
    const parentElement = current.parentElement
    if (!parentElement) continue
    if (parentElement.closest('code, pre, [data-inline-content-type], [data-content-type="math"]')) continue
    textNodes.push(current)
  }

  for (const textNode of textNodes) {
    const originalText = textNode.textContent || ''
    if (!containsMathDelimiters(originalText)) continue

    const html = replaceInlineMathInText(originalText)
    if (html === originalText) continue

    textNode.replaceWith(createTemplateFragment(html))
  }
}

function isMathMarkerElement(element: Element): boolean {
  if (element.closest('code, pre, [data-content-type="math"]')) return false
  return (element.textContent || '').replace(/\r\n?/g, '\n').trim() === '$$'
}

function isIgnorableMathGap(node: ChildNode): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return !(node.textContent || '').trim()
  }
  if (!(node instanceof HTMLElement)) return false
  if (node.closest('code, pre, [data-content-type="math"]')) return false
  return !(node.textContent || '').trim()
}

function collectContainerText(elements: HTMLElement[]): string {
  return elements
    .map((element) => (element.textContent || '').replace(/\r\n?/g, '\n').trim())
    .filter(Boolean)
    .join('\n')
}

function replaceSplitBlockMathSequences(container: ParentNode) {
  const childNodes = Array.from(container.childNodes)
  for (let index = 0; index < childNodes.length; index += 1) {
    const startNode = childNodes[index]
    if (!(startNode instanceof HTMLElement) || !isMathMarkerElement(startNode)) continue

    const expressionNodes: HTMLElement[] = []
    let cursor = index + 1
    let closingNode: HTMLElement | null = null

    while (cursor < childNodes.length) {
      const currentNode = childNodes[cursor]
      if (currentNode instanceof HTMLElement && isMathMarkerElement(currentNode)) {
        closingNode = currentNode
        break
      }

      if (isIgnorableMathGap(currentNode)) {
        cursor += 1
        continue
      }

      if (!(currentNode instanceof HTMLElement)) {
        expressionNodes.length = 0
        break
      }

      if (currentNode.querySelector('[data-content-type="math"]')) {
        expressionNodes.length = 0
        break
      }

      expressionNodes.push(currentNode)
      cursor += 1
    }

    if (!closingNode || expressionNodes.length === 0) continue

    const expression = collectContainerText(expressionNodes)
    if (!expression) continue

    const fragment = createTemplateFragment(createBlockMathHtml(expression))
    const insertionAnchor = closingNode.nextSibling

    for (let removeIndex = index; removeIndex <= cursor; removeIndex += 1) {
      childNodes[removeIndex]?.parentNode?.removeChild(childNodes[removeIndex])
    }

    container.insertBefore(fragment, insertionAnchor)
    return replaceSplitBlockMathSequences(container)
  }
}

function replaceSingleElementBlockMath(root: ParentNode) {
  const candidates = Array.from(root.querySelectorAll('p, div, li, blockquote'))
  for (const candidate of candidates) {
    if (candidate.closest('code, pre, [data-content-type="math"]')) continue
    if (candidate.querySelector('p, div, li, blockquote')) continue

    const text = (candidate.textContent || '').replace(/\r\n?/g, '\n').trim()
    const blockMatch = text.match(/^\$\$\s*([\s\S]*?)\s*\$\$$/)
    if (!blockMatch) continue

    candidate.replaceWith(createTemplateFragment(createBlockMathHtml(blockMatch[1] || '')))
  }
}

function replaceBlockMathInHtmlDocument(root: ParentNode) {
  replaceSplitBlockMathSequences(root)
  if (root instanceof Element) {
    for (const container of root.querySelectorAll('blockquote, li')) {
      replaceSplitBlockMathSequences(container)
    }
  }
  replaceSingleElementBlockMath(root)
}

function replaceBlockMarkdownInHtmlDocument(root: ParentNode) {
  if (!(root instanceof Element)) return

  // 1. Fix <pre> blocks without <code> (common in many rich text editors)
  const pres = Array.from(root.querySelectorAll('pre'))
  for (const pre of pres) {
    if (!pre.querySelector('code')) {
      const code = document.createElement('code')
      code.innerHTML = pre.innerHTML
      pre.innerHTML = ''
      pre.appendChild(code)
    }
  }

  // 2. Detect literal block markdown like ``` in paragraphs and convert to <pre><code>
  const blockElements = Array.from(root.querySelectorAll('p, div'))
  for (let i = 0; i < blockElements.length; i++) {
    const startEl = blockElements[i]
    if (!startEl.parentElement) continue

    const text = (startEl.textContent || '').trim()
    const match = text.match(/^(`{3,})(\w*)$/)
    if (!match) continue

    const fence = match[1]
    const language = match[2]

    let j = i + 1
    let closingEl: Element | null = null
    const contentElements: Element[] = []

    while (j < blockElements.length) {
      const nextEl = blockElements[j]
      if (nextEl.parentElement !== startEl.parentElement) break
      const nextText = (nextEl.textContent || '').trim()
      if (nextText === fence) {
        closingEl = nextEl
        break
      }
      contentElements.push(nextEl)
      j++
    }

    if (closingEl) {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      if (language) code.setAttribute('data-language', language)

      code.textContent = contentElements.map(el => el.textContent || '').join('\n')
      pre.appendChild(code)

      startEl.replaceWith(pre)
      closingEl.remove()
      contentElements.forEach(el => el.remove())

      i = j
    }
  }
}

function replaceInlineMarkdownInHtmlDocument(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []

  while (walker.nextNode()) {
    const current = walker.currentNode
    if (!(current instanceof Text)) continue
    const parentElement = current.parentElement
    if (!parentElement) continue
    if (parentElement.closest('code, pre, [data-inline-content-type], [data-content-type]')) continue
    textNodes.push(current)
  }

  for (const textNode of textNodes) {
    const originalText = textNode.textContent || ''
    if (!originalText.trim()) continue

    let newHtml = escapeHtml(originalText)
    let changed = false

    // Inline code
    if (/`([^`\n]+)`/.test(newHtml)) {
      newHtml = newHtml.replace(/`([^`\n]+)`/g, '<code>$1</code>')
      changed = true
    }

    // Bold
    if (/\*\*([^\*\n]+)\*\*/.test(newHtml)) {
      newHtml = newHtml.replace(/\*\*([^\*\n]+)\*\*/g, '<strong>$1</strong>')
      changed = true
    }
    if (/__([^_\n]+)__/.test(newHtml)) {
      newHtml = newHtml.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      changed = true
    }

    // Italic
    if (/(?<!\*)\*([^\*\n]+)\*(?!\*)/.test(newHtml)) {
      newHtml = newHtml.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, '<em>$1</em>')
      changed = true
    }
    if (/(?<!_)_([^_\n]+)_(?!_)/.test(newHtml)) {
      newHtml = newHtml.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>')
      changed = true
    }

    if (changed) {
      const template = document.createElement('template')
      template.innerHTML = newHtml
      textNode.replaceWith(template.content)
    }
  }
}

export function convertMixedHtmlToHtml(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  
  // 1. 深度解析并转换 HTML 中的 Markdown 语法（块级与行内）
  replaceBlockMarkdownInHtmlDocument(doc.body)
  replaceInlineMarkdownInHtmlDocument(doc.body)
  
  // 2. 深度解析并转换 HTML 中的数学公式
  replaceBlockMathInHtmlDocument(doc.body)
  replaceInlineMathInHtmlDocument(doc.body)
  
  return doc.body.innerHTML
}
