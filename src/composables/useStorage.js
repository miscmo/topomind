/**
 * useStorage composable
 * 封装 Store，提供响应式状态 + 保存指示器
 */
import { ref } from 'vue'
import { Store } from '@/core/storage.js'

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
    createKB: (name, meta) => Store.createKB(name, meta),
    deleteKB: (name) => Store.deleteKB(name),
    getKBMeta: (name) => Store.getKBMeta(name),
    saveKBMeta: (name, meta) => Store.saveKBMeta(name, meta),

    // 卡片
    listCards: (parentPath) => Store.listCards(parentPath),
    createCard: (parentPath, cardName) => Store.createCard(parentPath, cardName),
    deleteCard: (cardPath) => Store.deleteCard(cardPath),
    renameCard: (cardPath, newName) => Store.renameCard(cardPath, newName),

    // Markdown
    readMarkdown: (cardPath) => Store.readMarkdown(cardPath),
    writeMarkdown: (cardPath, content) => Store.writeMarkdown(cardPath, content),

    // 布局
    readLayout: (dirPath) => Store.readLayout(dirPath),
    saveLayout: (dirPath, meta) => Store.saveLayout(dirPath, meta)
      .then(() => showSaveIndicator(false))
      .catch((e) => { console.warn('[useStorage] saveLayout 失败:', dirPath, e); showSaveIndicator(true) }),
    saveLayoutSync: (dirPath, meta) => {
      // 退出前同步保存（使用 sendSync IPC）
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
    loadImage: (imgPath) => Store.loadImage(imgPath),

    // 工具
    countChildren: (p) => Store.countChildren(p),
    selectDir: () => Store.selectDir(),
    openInFinder: (p) => Store.openInFinder(p),
    getRootDir: () => Store.getRootDir(),

    // 指示器状态
    saveIndicatorVisible,
    saveFailed,
    showSaveIndicator,
  }
}
