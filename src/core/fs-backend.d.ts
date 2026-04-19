// FSB - File System Backend
import type { EdgeRelation, EdgeWeight } from '../types'

export interface FSBChildInfo {
  path: string
  name: string
  isDir: boolean
  order?: number
}

export interface FSBKBCover {
  coverPath?: string | null
  coverUrl?: string | null
}

export interface FSBGraphMeta {
  children?: Record<string, FSBChildInfo>
  edges?: Array<{
    id: string
    source: string
    target: string
    relation: EdgeRelation
    weight: EdgeWeight
  }>
  zoom?: number | null
  pan?: { x: number; y: number } | null
  canvasBounds?: object | null
}

/** Result from selectWorkDirCandidate / setWorkDir / createWorkDir */
export interface FSBResult {
  valid: boolean
  nodePath: string | null
  path?: string
  error?: string
}

export interface FSB {
  open: () => Promise<unknown>
  clearAll: () => Promise<unknown>
  initWorkDir: () => Promise<unknown>
  listChildren: (parentPath: string) => Promise<FSBChildInfo[]>
  mkDir: (dirPath: string, meta?: object | null) => Promise<string>
  rmDir: (dirPath: string) => Promise<unknown>
  saveKBOrder: (kbPath: string, order: number) => Promise<unknown>
  getKBCover: (kbPath: string) => Promise<FSBKBCover | null>
  saveKBCover: (kbPath: string, coverPath: string) => Promise<unknown>
  renameKB: (kbPath: string, newName: string) => Promise<string>
  readGraphMeta: (dirPath: string) => Promise<FSBGraphMeta>
  writeGraphMeta: (dirPath: string, meta: FSBGraphMeta) => Promise<unknown>
  getDir: (dirPath: string) => Promise<unknown>
  updateCardMeta: (cardPath: string, newName: string) => Promise<string>
  readFile: (filePath: string) => Promise<string>
  writeFile: (filePath: string, content: string) => Promise<unknown>
  deleteFile: (filePath: string) => Promise<unknown>
  writeBlobFile: (filePath: string, buffer: ArrayBuffer) => Promise<unknown>
  readBlobFile: (filePath: string) => Promise<ArrayBuffer | null>
  setWorkDir: (dirPath: string) => Promise<FSBResult>
  ensureCardDir: (cardPath: string) => Promise<unknown>
  selectWorkDirCandidate: () => Promise<FSBResult>
  createWorkDir: (dirPath: string) => Promise<FSBResult>
  importKB: (sourcePath: string) => Promise<string>
  openInFinder: (p: string) => Promise<unknown>
  countChildren: (p: string) => Promise<number>
  getRootDir: () => Promise<string | null>
  getLastOpenedKB: () => Promise<string | null>
  setLastOpenedKB: (kbPath: string | null) => Promise<unknown>
}

export const FSB: FSB
