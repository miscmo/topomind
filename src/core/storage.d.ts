import type { FSBGraphMeta } from './fs-backend'

// Store - Unified Storage Adapter

/** Result of a directory picker dialog */
export interface DirDialogResult {
  valid: boolean
  nodePath?: string
  error?: string
}

/** A child entry returned by listKBs / listCards */
export interface DirEntry {
  path: string
  name: string
  isDir: boolean
}

export interface SaveImageResult {
  path: string
  markdownRef: string
}

export interface Store {
  init: () => Promise<unknown>
  setWorkDir: (dirPath: string) => Promise<DirDialogResult>
  selectWorkDirCandidate: () => Promise<DirDialogResult>
  createWorkDir: (dirPath: string) => Promise<DirDialogResult>
  listKBs: () => Promise<DirEntry[]>
  createKB: (name: string, meta?: object) => Promise<string>
  deleteKB: (name: string) => Promise<unknown>
  renameKB: (kbPath: string, newName: string) => Promise<string>
  saveKBCover: (kbPath: string, coverPath: string | null) => Promise<unknown>
  listCards: (parentPath: string) => Promise<DirEntry[]>
  createCard: (parentPath: string, cardName: string) => Promise<string>
  deleteCard: (cardPath: string) => Promise<unknown>
  renameCard: (cardPath: string, newName: string) => Promise<string>
  readMarkdown: (cardPath: string) => Promise<string>
  writeMarkdown: (cardPath: string, content: string) => Promise<unknown>
  readLayout: (dirPath: string) => Promise<FSBGraphMeta>
  saveLayout: (dirPath: string, meta: FSBGraphMeta) => Promise<unknown>
  saveGraphDebounced: (dirPath: string, buildMetaFn: () => FSBGraphMeta, onSaved?: () => void) => Promise<void>
  flushGraphSave: (dirPath: string, buildMetaFn: () => FSBGraphMeta, onSaved?: () => void) => Promise<void>
  saveImage: (cardPath: string, blob: Blob, filename: string) => Promise<SaveImageResult>
  loadImage: (imgPath: string) => Promise<string>
  revokeAllImageUrls: () => void
  clearAll: () => Promise<unknown>
  importKB: (sourcePath: string) => Promise<string>
  openInFinder: (p: string) => Promise<unknown>
  countChildren: (p: string) => Promise<number>
  getRootDir: () => Promise<string | null>
  getLastOpenedKB: () => Promise<string | null>
  setLastOpenedKB: (kbPath: string | null) => Promise<unknown>
  ensureCardDir: (cardPath: string) => Promise<unknown>
}

export const Store: Store
