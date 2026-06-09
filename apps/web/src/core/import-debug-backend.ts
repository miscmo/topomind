import type { ImportDebugHealthResponse, LocalImportJobRecord } from '../types/debug-runtime'

function unsupported(): never {
  throw new Error('后端暂未提供调试导入能力，请在首页使用 ZIP 导入入口')
}

export async function getImportDebugHealth(): Promise<ImportDebugHealthResponse> {
  return {
    ready: false,
    stage: 'web-runtime',
    currentImportJobId: null,
    processing: false,
    supportedChannels: [],
    lastError: '后端暂未提供调试数据',
  }
}

export async function startImportJob(): Promise<LocalImportJobRecord> {
  unsupported()
}

export async function getImportJob(importJobId: string): Promise<LocalImportJobRecord | null> {
  void importJobId
  unsupported()
}
