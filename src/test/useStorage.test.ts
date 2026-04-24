/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Store module before importing useStorage
vi.mock('../core/storage', () => ({
  Store: {
    init: vi.fn(() => Promise.resolve()),
    setWorkDir: vi.fn(() => Promise.resolve()),
    selectWorkDirCandidate: vi.fn(() => Promise.resolve()),
    createWorkDir: vi.fn(() => Promise.resolve()),
    getRootDir: vi.fn(() => Promise.resolve()),
    listKBs: vi.fn(() => Promise.resolve([])),
    createKB: vi.fn(() => Promise.resolve()),
    deleteKB: vi.fn(() => Promise.resolve()),
    renameKB: vi.fn(() => Promise.resolve()),
    saveKBCover: vi.fn(() => Promise.resolve()),
    countChildren: vi.fn(() => Promise.resolve(0)),
    importKB: vi.fn(() => Promise.resolve()),
    getLastOpenedKB: vi.fn(() => Promise.resolve(null)),
    setLastOpenedKB: vi.fn(() => Promise.resolve()),
    openInFinder: vi.fn(() => Promise.resolve()),
    listCards: vi.fn(() => Promise.resolve([])),
    createCard: vi.fn(() => Promise.resolve()),
    deleteCard: vi.fn(() => Promise.resolve()),
    renameCard: vi.fn(() => Promise.resolve()),
    readMarkdown: vi.fn(() => Promise.resolve('')),
    writeMarkdown: vi.fn(() => Promise.resolve()),
    readLayout: vi.fn(() => Promise.resolve({ children: {}, edges: [] })),
    saveLayout: vi.fn(() => Promise.resolve()),
    saveGraphDebounced: vi.fn(),
    flushGraphSave: vi.fn(),
    saveImage: vi.fn(() => Promise.resolve()),
    loadImage: vi.fn(() => Promise.resolve(new Blob())),
    revokeAllImageUrls: vi.fn(),
    clearAll: vi.fn(() => Promise.resolve()),
    ensureCardDir: vi.fn(() => Promise.resolve()),
  },
}))

import { useStorage } from '../hooks/useStorage'
import { Store } from '../core/storage'

describe('useStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a stable storeApi reference', () => {
    const api1 = useStorage()
    const api2 = useStorage()
    expect(api1).toBe(api2) // Same reference returned every time
  })

  it('init calls Store.init', async () => {
    const api = useStorage()
    await api.init()
    expect(Store.init).toHaveBeenCalledTimes(1)
  })

  it('setWorkDir calls Store.setWorkDir with dirPath', async () => {
    const api = useStorage()
    await api.setWorkDir('/path/to/dir')
    expect(Store.setWorkDir).toHaveBeenCalledWith('/path/to/dir')
  })

  it('listKBs maps DirEntry[] to KBListItem[] with default order 0', async () => {
    vi.mocked(Store.listKBs).mockResolvedValue([
      { path: 'kb/a', name: 'A', order: 2 },
      { path: 'kb/b', name: 'B' }, // missing order
    ] as any)
    const api = useStorage()
    const result = await api.listKBs()
    expect(result).toEqual([
      { path: 'kb/a', name: 'A', order: 2 },
      { path: 'kb/b', name: 'B', order: 0 },
    ])
  })

  it('countChildren delegates to Store.countChildren', async () => {
    vi.mocked(Store.countChildren).mockResolvedValue(5)
    const api = useStorage()
    const result = await api.countChildren('some/path')
    expect(result).toBe(5)
    expect(Store.countChildren).toHaveBeenCalledWith('some/path')
  })

  it('readLayout delegates to Store.readLayout', async () => {
    const fakeMeta = { children: { node1: { name: 'Node1' } }, edges: [] }
    vi.mocked(Store.readLayout).mockResolvedValue(fakeMeta as any)
    const api = useStorage()
    const result = await api.readLayout('some/path')
    expect(result).toEqual(fakeMeta)
    expect(Store.readLayout).toHaveBeenCalledWith('some/path')
  })

  it('saveLayout delegates to Store.saveLayout', async () => {
    const api = useStorage()
    await api.saveLayout('some/path', { children: {}, edges: [] })
    expect(Store.saveLayout).toHaveBeenCalledWith('some/path', { children: {}, edges: [] })
  })

  it('saveGraphDebounced delegates to Store.saveGraphDebounced', () => {
    const api = useStorage()
    const fn = () => ({})
    api.saveGraphDebounced('some/path', fn)
    expect(Store.saveGraphDebounced).toHaveBeenCalledWith('some/path', fn, undefined)
  })

  it('flushGraphSave delegates to Store.flushGraphSave', () => {
    const api = useStorage()
    const fn = () => ({})
    api.flushGraphSave('some/path', fn, undefined)
    expect(Store.flushGraphSave).toHaveBeenCalledWith('some/path', fn, undefined)
  })

  it('createKB delegates to Store.createKB', async () => {
    const api = useStorage()
    await api.createKB('MyKB', { desc: 'test' })
    expect(Store.createKB).toHaveBeenCalledWith('MyKB', { desc: 'test' })
  })

  it('deleteKB delegates to Store.deleteKB', async () => {
    const api = useStorage()
    await api.deleteKB('MyKB')
    expect(Store.deleteKB).toHaveBeenCalledWith('MyKB')
  })

  it('readMarkdown delegates to Store.readMarkdown', async () => {
    vi.mocked(Store.readMarkdown).mockResolvedValue('# Hello')
    const api = useStorage()
    const result = await api.readMarkdown('some/card')
    expect(result).toBe('# Hello')
    expect(Store.readMarkdown).toHaveBeenCalledWith('some/card')
  })

  it('writeMarkdown delegates to Store.writeMarkdown', async () => {
    const api = useStorage()
    await api.writeMarkdown('some/card', '# New content')
    expect(Store.writeMarkdown).toHaveBeenCalledWith('some/card', '# New content')
  })

  it('revokeAllImageUrls delegates to Store.revokeAllImageUrls', () => {
    const api = useStorage()
    api.revokeAllImageUrls()
    expect(Store.revokeAllImageUrls).toHaveBeenCalled()
  })

  it('openInFinder delegates to Store.openInFinder', async () => {
    const api = useStorage()
    await api.openInFinder('some/path')
    expect(Store.openInFinder).toHaveBeenCalledWith('some/path')
  })

  it('importKB delegates to Store.importKB', async () => {
    const api = useStorage()
    await api.importKB('/source/path')
    expect(Store.importKB).toHaveBeenCalledWith('/source/path')
  })

  it('setLastOpenedKB delegates to Store.setLastOpenedKB', async () => {
    const api = useStorage()
    await api.setLastOpenedKB('kb/mykb')
    expect(Store.setLastOpenedKB).toHaveBeenCalledWith('kb/mykb')
  })

  it('getLastOpenedKB delegates to Store.getLastOpenedKB', async () => {
    vi.mocked(Store.getLastOpenedKB).mockResolvedValue('kb/lastkb')
    const api = useStorage()
    const result = await api.getLastOpenedKB()
    expect(result).toBe('kb/lastkb')
    expect(Store.getLastOpenedKB).toHaveBeenCalled()
  })

  it('saveImage delegates to Store.saveImage', async () => {
    const blob = new Blob(['test'], { type: 'image/png' })
    vi.mocked(Store.saveImage).mockResolvedValueOnce({ path: 'img.png', markdownRef: '![](img.png)' })
    const api = useStorage()
    await api.saveImage('some/card', blob, 'img.png')
    expect(Store.saveImage).toHaveBeenCalledWith('some/card', blob, 'img.png')
  })

  it('loadImage delegates to Store.loadImage', async () => {
    vi.mocked(Store.loadImage).mockResolvedValue('blob:http://localhost/mock-url')
    const api = useStorage()
    const result = await api.loadImage('/path/to/img.png')
    expect(result).toBe('blob:http://localhost/mock-url')
    expect(Store.loadImage).toHaveBeenCalledWith('/path/to/img.png')
  })

  it('ensureCardDir delegates to Store.ensureCardDir', async () => {
    const api = useStorage()
    await api.ensureCardDir('some/card')
    expect(Store.ensureCardDir).toHaveBeenCalledWith('some/card')
  })

  it('clearAll delegates to Store.clearAll', async () => {
    const api = useStorage()
    await api.clearAll()
    expect(Store.clearAll).toHaveBeenCalled()
  })
})