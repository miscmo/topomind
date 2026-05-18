/**
 * 文件系统存储后端（Electron 端）ES Module 版本
 * 通过 window.electronAPI (IPC) 调用 Node.js fs
 */
import { logger } from './logger'
import type { ElectronAPI } from '../types/electron-api'
import type { EdgeRelation, EdgeWeight } from '../types'
import type { DetailDocumentItem } from './storage/service'

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
  children?: Record<string, FSBKBInfo & {
    x?: number
    y?: number
    width?: number
    height?: number
    expanded?: boolean
    style?: unknown
    expandedWidth?: number
    expandedHeight?: number
  }> | undefined
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
  createKbsDir: (rootDir: string, kbName: string) => Promise<void>
  createCardDir: (rootDir: string, parentPath: string, cardName: string) => Promise<string>
  deleteKbsDir: (rootDir: string, dirPath: string) => Promise<unknown>
  renameKB: (rootDir: string, kbPath: string, newName: string) => Promise<string>
  readGraphMeta: (rootDir: string, roomPath: string) => Promise<FSBGraphMeta>
  writeGraphMeta: (rootDir: string, roomPath: string, meta: FSBGraphMeta) => Promise<unknown>
  readFile: (rootDir: string, filePath: string) => Promise<string>
  listDetailDocuments: (rootDir: string, cardPath: string) => Promise<DetailDocumentItem[]>
  createDetailDocument: (rootDir: string, cardPath: string, name: string) => Promise<DetailDocumentItem>
  renameDetailDocument: (rootDir: string, cardPath: string, documentPath: string, nextName: string) => Promise<DetailDocumentItem>
  deleteDetailDocument: (rootDir: string, cardPath: string, documentPath: string) => Promise<void>
  listAttachments: (rootDir: string, cardPath: string) => Promise<Array<{ name: string, path: string, isImage: boolean, size: number, mtime: number }>>
  importAttachment: (rootDir: string, cardPath: string, sourceFilePath: string) => Promise<string>
  deleteAttachment: (rootDir: string, cardPath: string, attachmentName: string) => Promise<void>
  writeAttachmentBase64: (rootDir: string, cardPath: string, fileName: string, mimeType: string, base64: string) => Promise<string>
  downloadAttachment: (rootDir: string, cardPath: string, url: string) => Promise<string>
  readAttachmentDataUrl: (rootDir: string, cardPath: string, attachmentRef: string) => Promise<string>
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
  createKbsDir: (rootDir, kbName) => _call('fs:createKbsDir', rootDir, kbName) as Promise<void>,
  createCardDir: (rootDir, parentPath, cardName) => _call('fs:createCardDir', rootDir, parentPath, cardName) as Promise<string>,
  deleteKbsDir: (rootDir, dirPath) => _call('fs:deleteKbsDir', rootDir, dirPath),
  renameKB: (rootDir, kbPath, newName) => _call('fs:renameKB', rootDir, kbPath, newName) as Promise<string>,
  readGraphMeta: (rootDir, roomPath) => _call('fs:readGraphMeta', rootDir, roomPath) as Promise<FSBGraphMeta>,
  writeGraphMeta: (rootDir, roomPath, meta) => _call('fs:writeGraphMeta', rootDir, roomPath, meta),

  readFile: (rootDir, filePath) => _call('fs:readFile', rootDir, filePath) as Promise<string>,
  listDetailDocuments: (rootDir, cardPath) =>
    _call('fs:listDetailDocuments', rootDir, cardPath) as Promise<DetailDocumentItem[]>,
  createDetailDocument: (rootDir, cardPath, name) =>
    _call('fs:createDetailDocument', rootDir, cardPath, name) as Promise<DetailDocumentItem>,
  renameDetailDocument: (rootDir, cardPath, documentPath, nextName) =>
    _call('fs:renameDetailDocument', rootDir, cardPath, documentPath, nextName) as Promise<DetailDocumentItem>,
  deleteDetailDocument: (rootDir, cardPath, documentPath) =>
    _call('fs:deleteDetailDocument', rootDir, cardPath, documentPath) as Promise<void>,
  listAttachments: (rootDir, cardPath) =>
    _call('fs:listAttachments', rootDir, cardPath) as Promise<Array<{ name: string, path: string, isImage: boolean, size: number, mtime: number }>>,
  importAttachment: (rootDir, cardPath, sourceFilePath) =>
    _call('fs:importAttachment', rootDir, cardPath, sourceFilePath) as Promise<string>,
  deleteAttachment: (rootDir, cardPath, attachmentName) =>
    _call('fs:deleteAttachment', rootDir, cardPath, attachmentName) as Promise<void>,
  writeAttachmentBase64: (rootDir, cardPath, fileName, mimeType, base64) =>
    _call('fs:writeAttachmentBase64', rootDir, cardPath, fileName, mimeType, base64) as Promise<string>,
  downloadAttachment: (rootDir, cardPath, url) =>
    _call('fs:downloadAttachment', rootDir, cardPath, url) as Promise<string>,
  readAttachmentDataUrl: (rootDir, cardPath, attachmentRef) =>
    _call('fs:readAttachmentDataUrl', rootDir, cardPath, attachmentRef) as Promise<string>,
  readAppConfig: (rootDir) => _call('fs:readAppConfig', rootDir),
  writeAppConfig: (rootDir, content) => _call('fs:writeAppConfig', rootDir, content),
  writeFile: (rootDir, filePath, content) => _call('fs:writeFile', rootDir, filePath, content),

  isValidWorkDir: (dirPath) => _call('fs:isValidWorkDir', dirPath) as Promise<FSBResult>,
  selectDirectory: () => _call('fs:selectDirectory') as Promise<FSBResult>,
  createWorkDir: (dirPath) => _call('fs:createWorkDir', dirPath) as Promise<FSBResult>,
  importKB: (rootDir, sourcePath) => _call('fs:importKB', rootDir, sourcePath) as Promise<string>,
}

export { FSBImpl as FSB }
