/**
 * Normalizes fenced code blocks that are indented inside list items
 * (e.g. "1. item\n    ```python\n    code\n    ```").
 *
 * Markdown fences allow at most 3 leading spaces, so a fence nested under a
 * list item (4+ spaces) is NOT parsed as a fence by markdown-it: the opening
 * fence is swallowed as plain text, the code lines become normal paragraphs,
 * and the closing fence is misread as a new unclosed fence (empty code block).
 *
 * This detects fence lines at ANY indentation, collects the block's common
 * indent, and dedents the whole fence (fence lines + code content), so it
 * becomes a proper top-level fenced code block.
 */
export function containsMarkdownFence(markdown: string): boolean {
  if (!markdown) return false
  return /(^|\n)[ \t]*(`{3,}|~{3,})/.test(markdown)
}

export function normalizeFenceIndentation(markdown: string): string {
  if (!markdown) return markdown

  const lines = markdown.split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    // Indented fence opener: any leading whitespace followed by a fence marker.
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    if (!fenceMatch) {
      output.push(line)
      index += 1
      continue
    }

    const fenceIndent = fenceMatch[1]
    const openingFence = fenceMatch[2]
    const fenceMarker = openingFence[0]
    const openingFenceLength = openingFence.length
    // Only touch fences that are indented beyond the plain 0-3 space case.
    if (fenceIndent.length <= 3) {
      output.push(line)
      index += 1
      continue
    }

    // Collect the block: find the closing fence with the same marker char at
    // ANY indentation (real-world pastes often keep the closing fence at
    // column 0 while the opening is indented under a list item).
    const blockStart = index
    let closingIndex = -1
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor].match(/^(\s*)(`{3,}|~{3,})([ \t]*)$/)
      if (
        candidate
        && candidate[2][0] === fenceMarker
        && candidate[2].length >= openingFenceLength
      ) {
        closingIndex = cursor
        break
      }
    }
    if (closingIndex < 0) {
      // No closing fence: leave as-is rather than guess.
      output.push(line)
      index += 1
      continue
    }

    const blockLines = lines.slice(blockStart, closingIndex + 1)
    const contentLines = blockLines.slice(1, -1)
    // Always strip the opening fence's indentation from the whole block so the
    // fence becomes a top-level block. Lines with less indentation are kept
    // as-is (no-op), so column-0 code inside an indented fence stays valid.
    const strip = (value: string) =>
      value.startsWith(fenceIndent) ? value.slice(fenceIndent.length) : value

    output.push(
      strip(blockLines[0]),
      ...contentLines.map(strip),
      strip(blockLines[blockLines.length - 1]),
    )
    index = closingIndex + 1
  }

  return output.join('\n')
}
