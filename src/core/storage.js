/**
 * 统一存储适配器（Electron 桌面端专用）ES Module 版本
 * 业务层通过 useStorage() composable 调用
 */
import { FSB } from './fs-backend.js'

let _saveTimer = null

export const Store = {
  // ===== 初始化 =====
  init() {
    console.log('[Store] 初始化 FSB 后端')
    return FSB.open().then(r => {
      console.log('[Store] 初始化完成:', r)
      return r
    })
  },

  // ===== 知识库（根级目录） =====
  listKBs: () => FSB.listChildren(''),

  createKB(name, meta) {
    const fullMeta = Object.assign({ name, createdAt: Date.now(), children: {}, edges: [] }, meta || {})
    const rootDir = (meta && meta.rootDir) || ''
    const metaToSave = { ...fullMeta }
    delete metaToSave.rootDir
    return FSB.mkDir(name, metaToSave, rootDir)
  },

  deleteKB: (name) => FSB.rmDir(name),
  getKBMeta: (name) => FSB.readMeta(name),
  saveKBMeta: (name, meta) => FSB.writeMeta(name, meta),

  // ===== 卡片（子目录） =====
  listCards: (parentPath) => FSB.listChildren(parentPath),

  createCard(parentPath, cardName) {
    const cardPath = parentPath ? `${parentPath}/${cardName}` : cardName
    const fullMeta = { name: cardName, createdAt: Date.now(), children: {}, edges: [] }
    return FSB.mkDir(cardPath, fullMeta).then(() => cardPath)
  },

  deleteCard: (cardPath) => FSB.rmDir(cardPath),

  renameCard(cardPath, newName) {
    return FSB.getDir(cardPath).then(dir => {
      if (!dir) return
      dir.name = newName
      return FSB.mkDir(cardPath, dir)
    })
  },

  // ===== Markdown 文档 =====
  readMarkdown: (cardPath) => FSB.readFile(`${cardPath}/README.md`),
  writeMarkdown: (cardPath, content) => FSB.writeFile(`${cardPath}/README.md`, content),

  // ===== 关系和布局 =====
  readLayout: (dirPath) => FSB.readMeta(dirPath),
  saveLayout: (dirPath, meta) => FSB.writeMeta(dirPath, meta),

  saveGraphDebounced(dirPath, buildMetaFn, onSaved) {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => {
      const meta = buildMetaFn()
      Store.saveLayout(dirPath, meta).then(() => onSaved?.())
    }, 300)
  },

  // ===== 图片 =====
  saveImage(cardPath, blob, filename) {
    const imgPath = `${cardPath}/images/${filename}`
    return FSB.writeBlobFile(imgPath, blob).then(() => ({
      path: imgPath,
      markdownRef: `images/${filename}`,
    }))
  },

  loadImage(imgPath) {
    return FSB.readBlobFile(imgPath).then(blob =>
      blob ? URL.createObjectURL(blob) : ''
    )
  },

  // ===== 工具 =====
  clearAll: () => FSB.clearAll(),
  selectDir: () => FSB.selectDir(),
  openInFinder: (p) => FSB.openInFinder(p),
  countChildren: (p) => FSB.countChildren(p),
  getRootDir: () => FSB.getRootDir(),
}
