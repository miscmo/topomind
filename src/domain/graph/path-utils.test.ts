import { describe, expect, it } from 'vitest'
import { basenameRef, joinRefs, normalizeRef, parentRef, resolveRoomChildRef } from './path-utils'

describe('graph path utils', () => {
  it('normalizes slashes and trims leading/trailing separators', () => {
    expect(normalizeRef('\\KB\\Parent//Child/')).toBe('KB/Parent/Child')
  })

  it('joins normalized refs without empty segments', () => {
    expect(joinRefs('KB/', '/Parent', '', 'Child')).toBe('KB/Parent/Child')
  })

  it('extracts basename and parent refs', () => {
    expect(basenameRef('KB/Parent/Child')).toBe('Child')
    expect(parentRef('KB/Parent/Child')).toBe('KB/Parent')
    expect(parentRef('KB')).toBe('')
  })

  it('resolves child refs within a room without double-prefixing absolute child refs', () => {
    expect(resolveRoomChildRef('KB', 'Child')).toBe('KB/Child')
    expect(resolveRoomChildRef('KB', 'KB/Child')).toBe('KB/Child')
    expect(resolveRoomChildRef('', 'KB/Child')).toBe('KB/Child')
  })
})
