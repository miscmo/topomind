/**
 * Quote-block editing behavior for Smart Document:
 * - Enter inside a quote stays INSIDE the quote by inserting a line break
 *   (`\n` in the inline text, rendered as a soft line break by pre-wrap),
 *   instead of BlockNote's default which splits into a new block outside.
 * - Multi-line quotes survive save/reopen as a single quote block (the
 *   normalizer no longer splits quote text on newlines).
 */
export function shouldHandleQuoteEnter(blockType: unknown): boolean {
  return blockType === 'quote'
}

export function quoteEnterPayload(): string {
  return '\n'
}
