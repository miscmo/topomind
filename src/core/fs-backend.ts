/**
 * 文件系统存储后端（Electron 端）ES Module 版本
 * 通过 window.electronAPI (IPC) 调用 Node.js fs
 */
import { logger } from './logger'
import type { ElectronAPI } from '../types/electron-api'
import type { EdgeRelation, EdgeWeight } from '../types'

const getApi = (): ElectronAPI | null => {
  const w = window as Window
  return (w.electronAPI ?? null) as ElectronAPI | null
}

const _call = (channel: string, ...args: unknown[]) => {
  const api = getApi()
  if (!api) {
    logger.catch('FSB', `IPC API 未就绪，无法调用 ${channel}`, undefined)
    return Promise.reject(new Error(`IPC API 未就绪: ${channel}`))
  }
  if (typeof api.invoke !== 'function') {
    logger.catch('FSB', `IPC API.invoke 不可用，无法调用 ${channel}`, undefined)
    return Promise.reject(new Error(`IPC API.invoke 不可用: ${channel}`))
  }
  return api.invoke(channel, ...args)
}

// ===== 接口定义 =====

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
  children?: Record<string, FSBChildInfo> | undefined
  edges?: Array<{
    id: string
    source: string
    target: string
    relation: EdgeRelation
    weight: EdgeWeight
    highlighted?: boolean
    faded?: boolean
  }>
  zoom?: number | null
  pan?: { x: number; y: number } | null
  canvasBounds?: object | null
}

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
  saveKBCover: (kbPath: string, coverPath: string | null) => Promise<unknown>
  renameKB: (kbPath: string, newName: string) => Promise<string>
  readGraphMeta: (dirPath: string) => Promise<FSBGraphMeta>
  writeGraphMeta: (dirPath: string, meta: FSBGraphMeta) => Promise<unknown>
  getDir: (dirPath: string) => Promise<unknown>
  updateCardMeta: (cardPath: string, newName: string) => Promise<string>
  readFile: (filePath: string) => Promise<string>
  readAppConfig: () => Promise<unknown>
  writeAppConfig: (content: unknown) => Promise<unknown>
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

// ===== FSB 实现 =====

const FSBImpl: FSB = {
  open: () => _call('fs:init'),
  clearAll: () => _call('fs:clearAll'),
  initWorkDir: () => _call('fs:init'),

  listChildren: (parentPath) => _call('fs:listChildren', parentPath) as Promise<FSBChildInfo[]>,
  mkDir: (dirPath, meta) => _call('fs:mkDir', dirPath, meta || {}) as Promise<string>,
  rmDir: (dirPath) => _call('fs:rmDir', dirPath),
  saveKBOrder: (kbPath, order) => _call('fs:saveKBOrder', kbPath, order),
  getKBCover: (kbPath) => _call('fs:getKBCover', kbPath) as Promise<FSBKBCover | null>,
  saveKBCover: (kbPath, coverPath) => _call('fs:saveKBCover', kbPath, coverPath),
  renameKB: (kbPath, newName) => _call('fs:renameKB', kbPath, newName) as Promise<string>,
  readGraphMeta: (dirPath) => _call('fs:readGraphMeta', dirPath) as Promise<FSBGraphMeta>,
  writeGraphMeta: (dirPath, meta) => _call('fs:writeGraphMeta', dirPath, meta),
  getDir: (dirPath) => _call('fs:getDir', dirPath),
  updateCardMeta: (cardPath, newName) => _call('fs:updateCardMeta', cardPath, newName) as Promise<string>,

  readFile: (filePath) => _call('fs:readFile', filePath) as Promise<string>,
  readAppConfig: () => _call('fs:readAppConfig'),
  writeAppConfig: (content) => _call('fs:writeAppConfig', content),
  writeFile: (filePath, content) => _call('fs:writeFile', filePath, content),
  deleteFile: (filePath) => _call('fs:deleteFile', filePath),

  writeBlobFile: (filePath, buffer) => _call('fs:writeBlobFile', filePath, buffer),
  readBlobFile: (filePath) => _call('fs:readBlobFile', filePath) as Promise<ArrayBuffer | null>,

  setWorkDir: (dirPath) => _call('fs:setWorkDir', dirPath) as Promise<FSBResult>,
  ensureCardDir: (cardPath) => _call('fs:ensureCardDir', cardPath),
  selectWorkDirCandidate: () => _call('fs:selectWorkDirCandidate') as Promise<FSBResult>,
  createWorkDir: (dirPath) => _call('fs:createWorkDir', dirPath) as Promise<FSBResult>,
  importKB: (sourcePath) => _call('fs:importKB', sourcePath) as Promise<string>,
  openInFinder: (p) => _call('fs:openInFinder', p),
  countChildren: (p) => _call('fs:countChildren', p) as Promise<number>,
  getRootDir: () => _call('fs:getRootDir') as Promise<string | null>,
  getLastOpenedKB: () => _call('fs:getLastOpenedKB') as Promise<string | null>,
  setLastOpenedKB: (kbPath) => _call('fs:setLastOpenedKB', kbPath),
}

export { FSBImpl as FSB }
