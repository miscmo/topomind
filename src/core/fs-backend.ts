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
  name: string
}

/** readCardChildren 返回 _graph.json.children 的原始映射表 */
export type FSBCardChildren = Record<string, unknown>

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
  readCardChildren: (rootDir: string, cardPath: string) => Promise<FSBCardChildren>
  createKbsDir: (rootDir: string, dirPath: string) => Promise<string>
  deleteKbsDir: (rootDir: string, dirPath: string) => Promise<unknown>
  renameKB: (rootDir: string, kbPath: string, newName: string) => Promise<string>
  readGraphMeta: (rootDir: string, roomPath: string) => Promise<FSBGraphMeta>
  writeGraphMeta: (rootDir: string, roomPath: string, meta: FSBGraphMeta) => Promise<unknown>
  readFile: (rootDir: string, filePath: string) => Promise<string>
  readAppConfig: (rootDir: string) => Promise<unknown>
  writeAppConfig: (rootDir: string, content: unknown) => Promise<unknown>
  writeFile: (rootDir: string, filePath: string, content: string) => Promise<unknown>
  isValidWorkDir: (dirPath: string) => Promise<FSBResult>
  selectDirectory: () => Promise<FSBResult>
  createWorkDir: (dirPath: string) => Promise<FSBResult>
  importKB: (rootDir: string, sourcePath: string) => Promise<string>
}

// ===== FSB 实现 =====

const FSBImpl: FSB = {
  listKBs: (rootDir) => _call('fs:listKBs', rootDir) as Promise<FSBKBInfo[]>,
  readCardChildren: (rootDir, cardPath) => _call('fs:readCardChildren', rootDir, cardPath) as Promise<FSBCardChildren>,
  createKbsDir: (rootDir, dirPath) => _call('fs:createKbsDir', rootDir, dirPath) as Promise<string>,
  deleteKbsDir: (rootDir, dirPath) => _call('fs:deleteKbsDir', rootDir, dirPath),
  renameKB: (rootDir, kbPath, newName) => _call('fs:renameKB', rootDir, kbPath, newName) as Promise<string>,
  readGraphMeta: (rootDir, roomPath) => _call('fs:readGraphMeta', rootDir, roomPath) as Promise<FSBGraphMeta>,
  writeGraphMeta: (rootDir, roomPath, meta) => _call('fs:writeGraphMeta', rootDir, roomPath, meta),

  readFile: (rootDir, filePath) => _call('fs:readFile', rootDir, filePath) as Promise<string>,
  readAppConfig: (rootDir) => _call('fs:readAppConfig', rootDir),
  writeAppConfig: (rootDir, content) => _call('fs:writeAppConfig', rootDir, content),
  writeFile: (rootDir, filePath, content) => _call('fs:writeFile', rootDir, filePath, content),

  isValidWorkDir: (dirPath) => _call('fs:isValidWorkDir', dirPath) as Promise<FSBResult>,
  selectDirectory: () => _call('fs:selectDirectory') as Promise<FSBResult>,
  createWorkDir: (dirPath) => _call('fs:createWorkDir', dirPath) as Promise<FSBResult>,
  importKB: (rootDir, sourcePath) => _call('fs:importKB', rootDir, sourcePath) as Promise<string>,
}

export { FSBImpl as FSB }
