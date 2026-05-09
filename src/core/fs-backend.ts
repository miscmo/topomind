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
  initWorkDir: () => Promise<unknown>
  listChildren: (parentPath: string) => Promise<FSBChildInfo[]>
  mkDir: (dirPath: string, meta?: object | null) => Promise<string>
  rmDir: (dirPath: string) => Promise<unknown>
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
  setWorkDir: (dirPath: string) => Promise<FSBResult>
  selectWorkDirCandidate: () => Promise<FSBResult>
  createWorkDir: (dirPath: string) => Promise<FSBResult>
  importKB: (sourcePath: string) => Promise<string>
  countChildren: (p: string) => Promise<number>
}

// ===== FSB 实现 =====

const FSBImpl: FSB = {
  open: () => _call('fs:init'),
  initWorkDir: () => _call('fs:init'),

  listChildren: (parentPath) => _call('fs:listChildren', parentPath) as Promise<FSBChildInfo[]>,
  mkDir: (dirPath, meta) => _call('fs:mkDir', dirPath, meta || {}) as Promise<string>,
  rmDir: (dirPath) => _call('fs:rmDir', dirPath),
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

  setWorkDir: (dirPath) => _call('fs:setWorkDir', dirPath) as Promise<FSBResult>,
  selectWorkDirCandidate: () => _call('fs:selectWorkDirCandidate') as Promise<FSBResult>,
  createWorkDir: (dirPath) => _call('fs:createWorkDir', dirPath) as Promise<FSBResult>,
  importKB: (sourcePath) => _call('fs:importKB', sourcePath) as Promise<string>,
  countChildren: (p) => _call('fs:countChildren', p) as Promise<number>,
}

export { FSBImpl as FSB }
