import { FSB } from '../../fs-backend'
import type { CardInfo, KBInfo, StorageAdapter, StorageGraphMeta } from '../adapter'

const toKBInfo = (child: { path: string; name: string; order?: number }): KBInfo => ({
  ref: child.path,
  vaultRef: '',
  name: child.name,
  coverRef: null,
  childCount: undefined,
})

const toCardInfo = (child: { path: string; name: string }): CardInfo => ({
  ref: child.path,
  kbRef: '',
  name: child.name,
  updatedAt: undefined,
})

export const fileStorageAdapter: StorageAdapter = {
  createVault: async () => ({ valid: true }),
  isVaildVault: async () => true,
  getVaultInfo: async (vaultRef) => ({ ref: vaultRef }),
  removeVault: async () => undefined,

  listKBS: async () => (await FSB.listChildren('')).map(toKBInfo),
  createKB: async (_vaultRef, name, meta) => FSB.mkDir(name, meta),
  deleteKB: (kbRef) => FSB.rmDir(kbRef),
  renameKB: (kbRef, newName) => FSB.renameKB(kbRef, newName),
  setKBCover: (kbRef, coverRef) => FSB.saveKBCover(kbRef, coverRef),
  importKB: (_targetVaultRef, sourceKBRef) => FSB.importKB(sourceKBRef),

  listCards: async (kbRef) => (await FSB.listChildren(kbRef)).map(toCardInfo),
  GetCardInfo: async (cardRef) => ({ ref: cardRef, kbRef: '', name: '', updatedAt: undefined }),
  createCard: (cardRef, meta) => FSB.mkDir(cardRef, meta),
  deleteCard: (cardRef) => FSB.rmDir(cardRef),
  renameCard: (cardRef, newName) => FSB.updateCardMeta(cardRef, newName),
  countSubCards: (cardRef) => FSB.countChildren(cardRef),

  readCardMarkdown: (cardRef) => FSB.readFile(`${cardRef}/README.md`),
  writeCardMarkdown: async (cardRef, content) => { await FSB.ensureCardDir(cardRef); return FSB.writeFile(`${cardRef}/README.md`, content) },
  readCardLayout: (cardRef) => FSB.readGraphMeta(cardRef) as Promise<StorageGraphMeta>,
  writeCardLayout: (cardRef, meta) => FSB.writeGraphMeta(cardRef, meta),
  writeCardAsset: (assetRef, buffer) => FSB.writeBlobFile(assetRef, buffer),
  readCardAsset: (assetRef) => FSB.readBlobFile(assetRef),
  readAppConfig: () => FSB.readAppConfig(),
  writeAppConfig: (content) => FSB.writeAppConfig(content),
  readLogs: async () => [],
  writeLogs: async () => undefined,
}
