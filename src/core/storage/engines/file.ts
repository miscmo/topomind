import { FSB } from '../../fs-backend'
import type { StorageAdapter, StorageChildInfo } from '../adapter'

const toStorageChildInfo = (child: {
  path: string
  name: string
  isDir: boolean
  order?: number
}): StorageChildInfo => ({
  ref: child.path,
  path: child.path,
  name: child.name,
  isDir: child.isDir,
  order: child.order,
})

const toKBInfo = (child: StorageChildInfo) => ({
  ref: child.ref,
  path: child.path,
  name: child.name,
  order: child.order ?? 0,
})

const toCardInfo = (child: StorageChildInfo) => ({
  ref: child.ref,
  path: child.path,
  name: child.name,
  parentRef: child.path.includes('/') ? child.path.slice(0, child.path.lastIndexOf('/')) : null,
  order: child.order,
  hasChildren: child.isDir,
  childCount: undefined,
  isDir: child.isDir,
})

export const fileStorageAdapter: StorageAdapter = {
  initVault: () => FSB.initWorkDir(),
  setVault: (rootRef) => FSB.setWorkDir(rootRef),
  selectVaultCandidate: () => FSB.selectWorkDirCandidate(),
  createVault: (rootRef) => FSB.createWorkDir(rootRef),
  getVaultRoot: () => FSB.getRootDir(),
  clearVault: () => FSB.clearAll(),

  listKnowledgeBases: async () => (await FSB.listChildren('')).map(toStorageChildInfo).map(toKBInfo),
  createKnowledgeBase: (name, meta) => FSB.mkDir(name, meta),
  deleteKnowledgeBase: (kbRef) => FSB.rmDir(kbRef),
  renameKnowledgeBase: (kbRef, newName) => FSB.renameKB(kbRef, newName),
  setKnowledgeBaseOrder: (kbRef, order) => FSB.saveKBOrder(kbRef, order),
  saveKnowledgeBaseCover: (kbRef, coverRef) => FSB.saveKBCover(kbRef, coverRef),
  importKnowledgeBase: (sourceRef) => FSB.importKB(sourceRef),
  getLastOpenedKnowledgeBase: () => FSB.getLastOpenedKB(),
  setLastOpenedKnowledgeBase: (kbRef) => FSB.setLastOpenedKB(kbRef),

  listCards: async (parentCardRef) => (await FSB.listChildren(parentCardRef)).map(toStorageChildInfo).map(toCardInfo),
  createCard: (cardRef, meta) => FSB.mkDir(cardRef, meta),
  deleteCard: (cardRef) => FSB.rmDir(cardRef),
  renameCard: (cardRef, newName) => FSB.updateCardMeta(cardRef, newName),
  ensureCard: (cardRef) => FSB.ensureCardDir(cardRef),
  countCards: (parentCardRef) => FSB.countChildren(parentCardRef),
  openCardLocation: (cardRef) => FSB.openInFinder(cardRef),

  readCardMarkdown: (cardRef) => FSB.readFile(`${cardRef}/README.md`),
  writeCardMarkdown: async (cardRef, content) => {
    await FSB.ensureCardDir(cardRef)
    return FSB.writeFile(`${cardRef}/README.md`, content)
  },

  readCardLayout: (cardRef) => FSB.readGraphMeta(cardRef),
  writeCardLayout: (cardRef, meta) => FSB.writeGraphMeta(cardRef, meta),

  writeCardAsset: (assetRef, buffer) => FSB.writeBlobFile(assetRef, buffer),
  readCardAsset: (assetRef) => FSB.readBlobFile(assetRef),

  readAppConfig: () => FSB.readAppConfig(),
  writeAppConfig: (content) => FSB.writeAppConfig(content),
}
