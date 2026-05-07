import { FSB } from '../../fs-backend'
import type { StorageAdapter, StorageChildInfo, StorageGraphMeta } from '../adapter'

const toStorageChildInfo = (child: { path: string; name: string; isDir: boolean; order?: number }): StorageChildInfo => ({
  ref: child.path,
  path: child.path,
  name: child.name,
  isDir: child.isDir,
  order: child.order,
})

/** 当前 Electron 文件系统实现。 */
export const fileStorageAdapter: StorageAdapter = {
  initWorkspace: () => FSB.initWorkDir(),
  setWorkspace: (rootRef) => FSB.setWorkDir(rootRef),
  selectWorkspaceCandidate: () => FSB.selectWorkDirCandidate(),
  createWorkspace: (rootRef) => FSB.createWorkDir(rootRef),
  getWorkspaceRoot: () => FSB.getRootDir(),
  clearWorkspace: () => FSB.clearAll(),

  listKnowledgeBases: async () => (await FSB.listChildren('')).map(toStorageChildInfo).map((c) => ({ ...c, order: c.order ?? 0 })),
  createKnowledgeBase: (name, meta) => FSB.mkDir(name, meta),
  deleteKnowledgeBase: (kbRef) => FSB.rmDir(kbRef),
  renameKnowledgeBase: (kbRef, newName) => FSB.renameKB(kbRef, newName),
  setKnowledgeBaseOrder: (kbRef, order) => FSB.saveKBOrder(kbRef, order),
  saveKnowledgeBaseCover: (kbRef, coverRef) => FSB.saveKBCover(kbRef, coverRef),
  importKnowledgeBase: (sourceRef) => FSB.importKB(sourceRef),
  getLastOpenedKnowledgeBase: () => FSB.getLastOpenedKB(),
  setLastOpenedKnowledgeBase: (kbRef) => FSB.setLastOpenedKB(kbRef),

  listCards: async (parentCardRef) => (await FSB.listChildren(parentCardRef)).map(toStorageChildInfo).map((c) => ({ ...c, hasChildren: c.isDir } as any)),
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

  readCardLayout: (cardRef) => FSB.readGraphMeta(cardRef) as Promise<StorageGraphMeta>,
  writeCardLayout: (cardRef, meta) => FSB.writeGraphMeta(cardRef, meta),

  writeCardAsset: (assetRef, buffer) => FSB.writeBlobFile(assetRef, buffer),
  readCardAsset: (assetRef) => FSB.readBlobFile(assetRef),

  readAppConfig: () => FSB.readAppConfig(),
  writeAppConfig: (content) => FSB.writeAppConfig(content),
}
