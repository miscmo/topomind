/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import {
  computeRootItem,
  computeHistoryItems,
  computeCurrentItem,
  computeIsAtRoot,
  computeVisible,
  computeBreadcrumbState,
} from '../components/Breadcrumb/breadcrumb.utils'
import type { RoomHistoryItem } from '../types'

describe('breadcrumb.utils', () => {
  describe('computeIsAtRoot', () => {
    it('returns true when roomPath equals rootPath', () => {
      expect(computeIsAtRoot('/kb/notes', '/kb/notes')).toBe(true)
    })
    it('returns false when roomPath differs from rootPath', () => {
      expect(computeIsAtRoot('/kb/notes/machine-learning', '/kb/notes')).toBe(false)
    })
    it('returns false when roomPath is null', () => {
      expect(computeIsAtRoot(null, '/kb/notes')).toBe(false)
    })
    it('returns false when rootPath is null', () => {
      expect(computeIsAtRoot('/kb/notes', null)).toBe(false)
    })
    it('returns false when both are null', () => {
      expect(computeIsAtRoot(null, null)).toBe(false)
    })
  })

  describe('computeVisible', () => {
    it('returns true when both kbPath and roomPath are present', () => {
      expect(computeVisible('/kb/notes', '/kb/notes')).toBe(true)
    })
    it('returns false when kbPath is missing', () => {
      expect(computeVisible(null, '/kb/notes')).toBe(false)
    })
    it('returns false when roomPath is missing', () => {
      expect(computeVisible('/kb/notes', null)).toBe(false)
    })
    it('returns false when both are null', () => {
      expect(computeVisible(null, null)).toBe(false)
    })
  })

  describe('computeRootItem', () => {
    it('root is clickable when not at root', () => {
      const item = computeRootItem('/kb/notes', 'Notes', false)
      expect(item.clickable).toBe(true)
      expect(item.kind).toBe('root')
      expect(item.id).toBe('/kb/notes')
      expect(item.label).toBe('Notes')
    })
    it('root is not clickable when at root', () => {
      const item = computeRootItem('/kb/notes', 'Notes', true)
      expect(item.clickable).toBe(false)
    })
    it('root item has path equal to id', () => {
      const item = computeRootItem('/kb/notes', 'Notes', false)
      expect(item.path).toBe('/kb/notes')
    })
  })

  describe('computeHistoryItems', () => {
    it('maps roomHistory to history items', () => {
      const history: RoomHistoryItem[] = [
        { room: { path: '/kb/a', kbPath: '/kb', name: 'Room A' } },
        { room: { path: '/kb/a/b', kbPath: '/kb', name: 'Room B' } },
      ]
      const items = computeHistoryItems(history)
      expect(items).toHaveLength(2)
      expect(items[0].kind).toBe('history')
      expect(items[0].clickable).toBe(true)
      expect(items[0].label).toBe('Room A')
      expect(items[1].label).toBe('Room B')
    })
    it('returns empty array for empty history', () => {
      expect(computeHistoryItems([])).toHaveLength(0)
    })
  })

  describe('computeCurrentItem', () => {
    it('current item is not clickable', () => {
      const item = computeCurrentItem('/kb/notes/ml', 'Machine Learning')
      expect(item.clickable).toBe(false)
      expect(item.kind).toBe('current')
      expect(item.label).toBe('Machine Learning')
    })
  })

  describe('computeBreadcrumbState', () => {
    it('renders root + history + current correctly', () => {
      const state = computeBreadcrumbState({
        kbPath: '/kb',
        roomPath: '/kb/notes/ml',
        roomName: 'Machine Learning',
        history: [{ room: { path: '/kb/notes', kbPath: '/kb', name: 'Notes' } }],
        rootLabel: 'My KB',
      })
      expect(state.items).toHaveLength(3)
      expect(state.items[0].kind).toBe('root')
      expect(state.items[0].label).toBe('My KB')
      expect(state.items[0].clickable).toBe(true)
      expect(state.items[1].kind).toBe('history')
      expect(state.items[1].label).toBe('Notes')
      expect(state.items[1].clickable).toBe(true)
      expect(state.items[2].kind).toBe('current')
      expect(state.items[2].label).toBe('Machine Learning')
      expect(state.items[2].clickable).toBe(false)
      expect(state.isAtRoot).toBe(false)
      expect(state.visible).toBe(true)
    })

    it('renders only root when at root', () => {
      const state = computeBreadcrumbState({
        kbPath: '/kb',
        roomPath: '/kb',
        roomName: 'My KB',
        history: [],
        rootLabel: 'My KB',
      })
      expect(state.items).toHaveLength(1)
      expect(state.items[0].kind).toBe('root')
      expect(state.items[0].clickable).toBe(false)
      expect(state.isAtRoot).toBe(true)
      expect(state.visible).toBe(true)
    })

    it('renders root + history (no current) when one step from root', () => {
      const state = computeBreadcrumbState({
        kbPath: '/kb',
        roomPath: '/kb/notes',
        roomName: 'Notes',
        history: [],
        rootLabel: 'My KB',
      })
      expect(state.items).toHaveLength(2)
      expect(state.items[0].kind).toBe('root')
      expect(state.items[0].clickable).toBe(true)
      expect(state.items[1].kind).toBe('current')
      expect(state.items[1].clickable).toBe(false)
      expect(state.isAtRoot).toBe(false)
    })

    it('returns invisible when kbPath is missing', () => {
      const state = computeBreadcrumbState({
        kbPath: null,
        roomPath: '/kb/notes',
        roomName: 'Notes',
        history: [],
        rootLabel: '',
      })
      expect(state.visible).toBe(false)
      expect(state.items).toHaveLength(0)
    })

    it('returns invisible when roomPath is missing', () => {
      const state = computeBreadcrumbState({
        kbPath: '/kb',
        roomPath: null,
        roomName: '',
        history: [],
        rootLabel: 'My KB',
      })
      expect(state.visible).toBe(false)
      expect(state.items).toHaveLength(0)
    })

    it('passes through metadata fields correctly', () => {
      const state = computeBreadcrumbState({
        kbPath: '/kb',
        roomPath: '/kb/notes',
        roomName: 'Notes',
        history: [],
        rootLabel: 'My KB',
      })
      expect(state.kbPath).toBe('/kb')
      expect(state.roomPath).toBe('/kb/notes')
      expect(state.roomName).toBe('Notes')
      expect(state.rootLabel).toBe('My KB')
    })
  })
})
