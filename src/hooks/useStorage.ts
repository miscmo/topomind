/**
 * useStorage — React hook wrapper around the Store module
 */
import { Store } from '../core/storage'
import type { KBListItem } from '../types'

export function useStorage() {
  return {
    // Initialization
    init: () => Store.init(),
    setWorkDir: (dirPath: string) => Store.setWorkDir(dirPath),
    selectWorkDirCandidate: () => Store.selectWorkDirCandidate(),
    createWorkDir: (dirPath: string) => Store.createWorkDir(dirPath),
    getRootDir: () => Store.getRootDir(),

    // Knowledge bases
    listKBs: (): Promise<KBListItem[]> => Store.listKBs() as Promise<KBListItem[]>,
    createKB: (name: string, meta?: object) => Store.createKB(name, meta),
    deleteKB: (name: string) => Store.deleteKB(name),
    renameKB: (kbPath: string, newName: string) => Store.renameKB(kbPath, newName),
    saveKBCover: (kbPath: string, coverPath: string | null) => Store.saveKBCover(kbPath, coverPath),
    countChildren: (p: string) => Store.countChildren(p),
    importKB: (sourcePath: string) => Store.importKB(sourcePath),
    getLastOpenedKB: () => Store.getLastOpenedKB(),
    setLastOpenedKB: (kbPath: string) => Store.setLastOpenedKB(kbPath),
    openInFinder: (p: string) => Store.openInFinder(p),

    // Cards
    listCards: (parentPath: string) => Store.listCards(parentPath),
    createCard: (parentPath: string, cardName: string) => Store.createCard(parentPath, cardName),
    deleteCard: (cardPath: string) => Store.deleteCard(cardPath),
    renameCard: (cardPath: string, newName: string) => Store.renameCard(cardPath, newName),

    // Markdown
    readMarkdown: (cardPath: string) => Store.readMarkdown(cardPath),
    writeMarkdown: (cardPath: string, content: string) => Store.writeMarkdown(cardPath, content),

    // Layout
    readLayout: (dirPath: string) => Store.readLayout(dirPath),
    saveLayout: (dirPath: string, meta: object) => Store.saveLayout(dirPath, meta),
    saveGraphDebounced: (dirPath: string, buildMetaFn: () => object, onSaved?: () => void) =>
      Store.saveGraphDebounced(dirPath, buildMetaFn, onSaved),
    flushGraphSave: (dirPath: string, buildMetaFn: () => object, onSaved?: () => void) =>
      Store.flushGraphSave(dirPath, buildMetaFn, onSaved),

    // Images
    saveImage: (cardPath: string, blob: Blob, filename: string) =>
      Store.saveImage(cardPath, blob, filename),
    loadImage: (imgPath: string) => Store.loadImage(imgPath),
    revokeAllImageUrls: () => Store.revokeAllImageUrls(),

    // Utility
    clearAll: () => Store.clearAll(),
    ensureCardDir: (cardPath: string) => Store.ensureCardDir(cardPath),
  }
}
