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

/** listKBs 返回的知识库信息 */
export interface FSBKBInfo {
  path: string
  name: string
}

/** listCards 返回的卡片信息 */
export interface FSBCardInfo {
  path: string
  name: string
}

export interface FSBGraphMeta {
  children?: Record<string, FSBKBInfo> | undefined
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
  listKBs: (rootDir: string) => Promise<FSBKBInfo[]>
  listCards: (rootDir: string, parentPath: string) => Promise<FSBCardInfo[]>
  createKB: (rootDir: string, name: string) => Promise<string>
  deleteKB: (rootDir: string, kbPath: string) => Promise<unknown>
  renameKB: (rootDir: string, kbPath: string, newName: string) => Promise<string>
  createCard: (rootDir: string, parentPath: string, name: string) => Promise<string>
  deleteCard: (rootDir: string, cardPath: string) => Promise<unknown>
  readGraphMeta: (rootDir: string, dirPath: string) => Promise<FSBGraphMeta>
  writeGraphMeta: (rootDir: string, dirPath: string, meta: FSBGraphMeta) => Promise<unknown>
  getDir: (rootDir: string, dirPath: string) => Promise<unknown>
  updateCardMeta: (rootDir: string, cardPath: string, newName: string) => Promise<string>
  readFile: (rootDir: string, filePath: string) => Promise<string>
  readAppConfig: (rootDir: string) => Promise<unknown>
  writeAppConfig: (rootDir: string, content: unknown) => Promise<unknown>
  writeFile: (rootDir: string, filePath: string, content: string) => Promise<unknown>
  deleteFile: (rootDir: string, filePath: string) => Promise<unknown>
  isValidWorkDir: (dirPath: string) => Promise<FSBResult>
  selectDirectory: () => Promise<FSBResult>
  createWorkDir: (dirPath: string) => Promise<FSBResult>
  importKB: (rootDir: string, sourcePath: string) => Promise<string>
  countChildren: (rootDir: string, p: string) => Promise<number>
}

// ===== FSB 实现 =====

const FSBImpl: FSB = {
  listKBs: (rootDir) => _call('fs:listKBs', rootDir) as Promise<FSBKBInfo[]>,
  listCards: (rootDir, parentPath) => _call('fs:listCards', rootDir, parentPath) as Promise<FSBCardInfo[]>,
  createKB: (rootDir, name) => _call('fs:createKB', rootDir, name) as Promise<string>,
  deleteKB: (rootDir, kbPath) => _call('fs:deleteKB', rootDir, kbPath),
  renameKB: (rootDir, kbPath, newName) => _call('fs:renameKB', rootDir, kbPath, newName) as Promise<string>,
  createCard: (rootDir, parentPath, name) => _call('fs:createCard', rootDir, parentPath, name) as Promise<string>,
  deleteCard: (rootDir, cardPath) => _call('fs:deleteCard', rootDir, cardPath),
  readGraphMeta: (rootDir, dirPath) => _call('fs:readGraphMeta', rootDir, dirPath) as Promise<FSBGraphMeta>,
  writeGraphMeta: (rootDir, dirPath, meta) => _call('fs:writeGraphMeta', rootDir, dirPath, meta),
  getDir: (rootDir, dirPath) => _call('fs:getDir', rootDir, dirPath),
  updateCardMeta: (rootDir, cardPath, newName) => _call('fs:updateCardMeta', rootDir, cardPath, newName) as Promise<string>,

  readFile: (rootDir, filePath) => _call('fs:readFile', rootDir, filePath) as Promise<string>,
  readAppConfig: (rootDir) => _call('fs:readAppConfig', rootDir),
  writeAppConfig: (rootDir, content) => _call('fs:writeAppConfig', rootDir, content),
  writeFile: (rootDir, filePath, content) => _call('fs:writeFile', rootDir, filePath, content),
  deleteFile: (rootDir, filePath) => _call('fs:deleteFile', rootDir, filePath),

  isValidWorkDir: (dirPath) => _call('fs:isValidWorkDir', dirPath) as Promise<FSBResult>,
  selectDirectory: () => _call('fs:selectDirectory') as Promise<FSBResult>,
  createWorkDir: (dirPath) => _call('fs:createWorkDir', dirPath) as Promise<FSBResult>,
  importKB: (rootDir, sourcePath) => _call('fs:importKB', rootDir, sourcePath) as Promise<string>,
  countChildren: (rootDir, p) => _call('fs:countChildren', rootDir, p) as Promise<number>,
}

export { FSBImpl as FSB }
