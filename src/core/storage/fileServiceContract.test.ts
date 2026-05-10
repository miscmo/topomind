import nodeFs from 'fs'
import nodeOs from 'os'
import nodePath from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

type FileService = {
  createKB: (rootDir: string, name: string) => string
  createCard: (rootDir: string, parentPath: string, name: string) => string
  writeGraphMeta: (rootDir: string, dirPath: string, meta: object) => void
  listKBs: (rootDir: string) => Array<{ path: string; name: string }>
  listCards: (rootDir: string, parentPath: string) => Array<{ path: string; name: string }>
  updateCardMeta: (rootDir: string, cardPath: string, newName: string) => string
}

const tempRoots: string[] = []
let fileService: FileService

function createRoot(): string {
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'topomind-file-service-'))
  tempRoots.push(root)
  nodeFs.mkdirSync(nodePath.join(root, 'kbs'), { recursive: true })
  nodeFs.mkdirSync(nodePath.join(root, 'logs'), { recursive: true })
  nodeFs.writeFileSync(nodePath.join(root, '_config.json'), '{}', 'utf-8')
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    nodeFs.rmSync(root, { recursive: true, force: true })
  }
})

beforeAll(async () => {
  const moduleUrl = pathToFileURL(nodePath.resolve(process.cwd(), 'electron/file-service.js')).href
  const mod = await import(moduleUrl)
  fileService = mod.fileService as FileService
})

describe('electron fileService graph path contract', () => {
  it('returns KB-relative refs from createCard instead of absolute filesystem paths', () => {
    const root = createRoot()

    fileService.createKB(root, 'KB')
    fileService.createCard(root, 'KB', 'Parent')
    const ref = fileService.createCard(root, 'KB/Parent', 'Child')

    expect(ref).toBe('KB/Parent/Child')
    expect(nodePath.isAbsolute(ref)).toBe(false)
  })

  it('reads display names from KB-relative _graph children keys', () => {
    const root = createRoot()
    fileService.createKB(root, 'KB')
    fileService.createCard(root, 'KB', 'Child')
    fileService.writeGraphMeta(root, 'KB', {
      children: {
        Child: { path: 'Child', name: 'Display Child' },
      },
      edges: [],
      zoom: null,
      pan: null,
    })

    const children = fileService.listCards(root, 'KB')

    expect(children).toContainEqual(expect.objectContaining({
      path: 'KB/Child',
      name: 'Display Child',
    }))
  })

  it('updates display names by KB-relative _graph children keys', () => {
    const root = createRoot()
    fileService.createKB(root, 'KB')
    fileService.createCard(root, 'KB', 'Child')
    fileService.writeGraphMeta(root, 'KB', {
      children: {
        Child: { path: 'Child', name: 'Old Name' },
      },
      edges: [],
      zoom: null,
      pan: null,
    })

    fileService.updateCardMeta(root, 'KB/Child', 'New Name')

    const graphPath = nodePath.join(root, 'kbs', 'KB', '_graph.json')
    const graph = JSON.parse(nodeFs.readFileSync(graphPath, 'utf-8'))
    expect(graph.children.Child).toMatchObject({ path: 'Child', name: 'New Name' })
  })
})
