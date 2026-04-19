/**
 * useStorage composable
 * 封装 Store，提供响应式状态 + 保存指示器
 */
import { ref } from 'vue'
import { Store } from '@/core/storage.js'
import { loggerEnhanced as logger, Action } from '@/core/logger-enhanced.js'

// 保存指示器状态（全局单例）
export const saveIndicatorVisible = ref(false)
export const saveFailed = ref(false)
let _saveIndicatorTimer = null

export function showSaveIndicator(failed = false) {
  saveFailed.value = failed
  saveIndicatorVisible.value = true
  clearTimeout(_saveIndicatorTimer)
  _saveIndicatorTimer = setTimeout(() => {
    saveIndicatorVisible.value = false
  }, 1500)
}

export function useStorage() {
  return {
    // 初始化
    init: () => Store.init(),

    // 知识库
    listKBs: () => Store.listKBs(),
    createKB: (name, meta) => {
      logger.info('useStorage', Action.KB_CREATE, `创建知识库: ${name}`, { name })
      return Store.createKB(name, meta)
    },
    deleteKB: (name) => {
      logger.info('useStorage', Action.KB_DELETE, `删除知识库: ${name}`, { name })
      return Store.deleteKB(name)
    },
    getKBCover: (kbPath) => Store.getKBCover(kbPath),
    saveKBCover: (kbPath, coverPath) => Store.saveKBCover(kbPath, coverPath),
    renameKB: (kbPath, newName) => {
      logger.info('useStorage', Action.KB_SWITCH, `重命名知识库: ${kbPath} -> ${newName}`, { kbPath, newName })
      return Store.renameKB(kbPath, newName)
    },

    // 卡片
    listCards: (parentPath) => Store.listCards(parentPath),
    createCard: (parentPath, cardName) => {
      logger.info('useStorage', Action.NODE_ADD, `创建卡片: ${cardName}`, { parentPath, cardName })
      return Store.createCard(parentPath, cardName)
    },
    deleteCard: (cardPath) => {
      logger.info('useStorage', Action.NODE_DELETE, `删除卡片: ${cardPath}`)
      return Store.deleteCard(cardPath)
    },
    renameCard: (cardPath, newName) => {
      logger.info('useStorage', Action.NODE_RENAME, `重命名卡片: ${cardPath} -> ${newName}`, { cardPath, newName })
      return Store.renameCard(cardPath, newName)
    },

    // Markdown
    readMarkdown: (cardPath) => {
      logger.debug('useStorage', `读取 Markdown: ${cardPath}`)
      return Store.readMarkdown(cardPath)
    },
    writeMarkdown: (cardPath, content) => {
      logger.info('useStorage', Action.MARKDOWN_SAVE, `保存 Markdown: ${cardPath}`, { cardPath })
      return Store.writeMarkdown(cardPath, content)
    },

    // 布局
    readLayout: (dirPath) => Store.readLayout(dirPath),
    saveLayout: (dirPath, meta) =>
      Store.saveLayout(dirPath, meta)
        .then(() => { logger.info('useStorage', Action.LAYOUT_SAVE, `布局保存: ${dirPath}`); showSaveIndicator(false) })
        .catch((e) => { logger.catch('useStorage', `saveLayout 失败: ${dirPath}`, e); showSaveIndicator(true) }),
    saveLayoutSync: (dirPath, meta) => {
      if (window.electronAPI?.sendSync) {
        window.electronAPI.sendSync('save:layout', dirPath, meta)
      }
    },
    saveGraphDebounced: (dirPath, buildMetaFn) =>
      Store.saveGraphDebounced(dirPath, buildMetaFn, (failed) => showSaveIndicator(failed)),
    flushGraphSave: (dirPath, buildMetaFn) =>
      Store.flushGraphSave(dirPath, buildMetaFn, (failed) => showSaveIndicator(failed)),

    // 图片
    saveImage: (cardPath, blob, filename) => Store.saveImage(cardPath, blob, filename),
    saveKBImage: (kbPath, blob, filename) => Store.saveKBImage(kbPath, blob, filename),
    loadImage: (imgPath) => Store.loadImage(imgPath),
    revokeAllImageUrls: () => Store.revokeAllImageUrls(),

    // 工具
    countChildren: (p) => Store.countChildren(p),
    selectExistingWorkDir: (dirPath) => Store.selectExistingWorkDir(dirPath),
    selectWorkDirCandidate: () => Store.selectWorkDirCandidate(),
    createWorkDir: (dirPath) => Store.createWorkDir(dirPath),
    importKB: (sourcePath) => Store.importKB(sourcePath),
    openInFinder: (p) => Store.openInFinder(p),
    getRootDir: () => Store.getRootDir(),
    getLastOpenedKB: () => Store.getLastOpenedKB(),
    setLastOpenedKB: (kbPath) => Store.setLastOpenedKB(kbPath),
    ensureCardDir: (cardPath) => Store.ensureCardDir(cardPath),

    // 指示器状态
    saveIndicatorVisible,
    saveFailed,
    showSaveIndicator,
  }
}
