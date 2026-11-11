/**
 * 文档身份 / 全局索引服务（纯 ESM，IO 全部由 deps 注入）。
 *
 * 背景：docId 原先只是「卡片内局部主键」，跨节点移动文档会整棵子树重新分配 id、
 * 导入 KB 副本会原样复制 id、正文 JSON 也不自描述身份。节点关联文档与将来的文档间
 * 引用都需要一个「全库稳定」的主键，因此本模块负责：
 *   - 生成 / 校验 docId，给正文补自描述 id；
 *   - 规划「只给冲突项重新分配 id」的重映射（移动 / 导入共用）；
 *   - 按需全库扫描 _docs/tree.json 做 docId → cardPath 反查与自愈（不建常驻索引）；
 *   - 关联记录规范化（去重、字段白名单、上限）；
 *   - 文档双链的出入链查询：落盘「派生关系索引」+ 文件签名自愈。
 *
 * 不建「权威常驻索引」的理由：create/delete/move/restore/import 六处都要维护一致性，
 * 是新的 bug 源。关系索引因此只做派生缓存：每篇正文记录 stat 签名，查询时只重新
 * 解析签名变化的文档，其余直接复用索引里的出链表；索引丢了或坏了会自动重建。
 * 这样既不用在任何写入口挂钩，也不会出现「改了内容但索引没跟上」的静默错误。
 * 本模块不 import electron，回归脚本可以用内存 fs 直接真跑。
 */
import { randomUUID } from 'crypto'

export const DOCUMENT_ID_PREFIX = 'doc_'
export const DOCUMENT_ID_PATTERN = /^doc_[0-9a-f]{32}$/
export const MAX_LINKED_DOCUMENTS = 8
export const DOCUMENT_EXTENSIONS = {
  smart: '.tdoc.json',
  mindmap: '.tmind.json',
  flowchart: '.tflow.json',
}
export const TOPO_DOCUMENT_DIR = '_docs'
export const TOPO_DOCUMENT_MANIFEST = 'tree.json'
/** 文档双链的行内引用类型名，必须与渲染层 docLinkModel.ts 保持一致。 */
export const DOC_LINK_INLINE_TYPE = 'docLink'
/** 派生关系索引放在工作区根下，不进 kbs，避免被房间 / _docs 目录扫描误判。 */
export const DOCUMENT_RELATIONS_DIR = '.topomind'
export const DOCUMENT_RELATIONS_INDEX = 'doc-relations.json'
export const DOCUMENT_RELATIONS_VERSION = 1
/** 单次索引遍历的递归深度上限，与 countDocumentLinks 保持一致。 */
const LINK_SCAN_MAX_DEPTH = 64
/** 节点内文档树的上溯深度上限，与渲染层 buildDocumentTree 的环保护同口径。 */
const DOCUMENT_PATH_MAX_DEPTH = 64

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * 统计正文中指向 docId 的 docLink 行内引用数量。
 * 正文是 BlockNote 的 blocks 数组，引用可能嵌在 columnList / 表格 / 列表的任意层级，
 * 因此必须递归遍历而不是只看顶层 content。JSON 无环，仍用深度上限兜住异常档。
 */
export function countDocumentLinks(content, docId, depth = 0) {
  if (!content || depth > 64) return 0
  if (Array.isArray(content)) {
    return content.reduce((total, item) => total + countDocumentLinks(item, docId, depth + 1), 0)
  }
  if (!isPlainObject(content)) return 0
  let total = 0
  if (
    content.type === DOC_LINK_INLINE_TYPE &&
    isPlainObject(content.props) &&
    content.props.docId === docId
  ) {
    total += 1
  }
  for (const child of Object.values(content)) {
    total += countDocumentLinks(child, docId, depth + 1)
  }
  return total
}

/**
 * 一次遍历提取正文里全部 docLink 目标：{ [docId]: { count, title } }。
 * 关系索引构建用这个而不是对每个目标各跑一次 countDocumentLinks，避免 O(N*M)。
 * title 是 chip 上的显示快照，目标文档被删除后仍能显示「当时引用的是什么」。
 * 与 countDocumentLinks 一样递归到 columnList / column / 表格 / children 任意层级。
 */
export function collectDocumentLinkTargets(content, depth = 0) {
  const targets = {}
  const visit = (node, currentDepth) => {
    if (!node || currentDepth > LINK_SCAN_MAX_DEPTH) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, currentDepth + 1)
      return
    }
    if (!isPlainObject(node)) return
    if (
      node.type === DOC_LINK_INLINE_TYPE &&
      isPlainObject(node.props) &&
      typeof node.props.docId === 'string'
    ) {
      const id = node.props.docId.trim()
      if (id) {
        const previous = targets[id]
        const rawTitle = node.props.title
        const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, 200) : ''
        targets[id] = {
          count: (previous?.count ?? 0) + 1,
          title: previous?.title || title,
        }
      }
    }
    for (const child of Object.values(node)) visit(child, currentDepth + 1)
  }
  visit(content, depth)
  return targets
}

/**
 * 批量改写正文里的 docLink 目标 id（docId 因冲突被重新分配时使用）。
 * 整体展开、只改命中项，绝不按字段白名单重建正文；无改动时返回原对象引用。
 */
export function mapDocumentLinkIds(content, mapper, depth = 0) {
  if (!content || depth > 64) return content
  if (Array.isArray(content)) {
    let changed = false
    const next = content.map((item) => {
      const mapped = mapDocumentLinkIds(item, mapper, depth + 1)
      if (mapped !== item) changed = true
      return mapped
    })
    return changed ? next : content
  }
  if (!isPlainObject(content)) return content
  let changed = false
  const next = {}
  for (const [key, child] of Object.entries(content)) {
    const mapped = mapDocumentLinkIds(child, mapper, depth + 1)
    if (mapped !== child) changed = true
    next[key] = mapped
  }
  if (
    content.type === DOC_LINK_INLINE_TYPE &&
    isPlainObject(next.props) &&
    typeof next.props.docId === 'string'
  ) {
    const mappedId = mapper(next.props.docId)
    if (mappedId && mappedId !== next.props.docId) {
      next.props = { ...next.props, docId: mappedId }
      changed = true
    }
  }
  return changed ? next : content
}

export function newDocumentId() {
  return DOCUMENT_ID_PREFIX + randomUUID().replace(/-/g, '')
}

export function isDocumentId(value) {
  return DOCUMENT_ID_PATTERN.test(String(value ?? ''))
}

/** 从正文文件名反推 docId：`doc_xxx.tdoc.json` → `doc_xxx`。 */
export function documentIdFromContentPath(filePath, extensions = Object.values(DOCUMENT_EXTENSIONS)) {
  const base = String(filePath ?? '').split(/[\\/]/).pop() || ''
  for (const ext of extensions) {
    if (ext && base.endsWith(ext)) return base.slice(0, -ext.length)
  }
  return ''
}

/**
 * 给结构化正文补顶层自描述 id。已存在但不匹配时以文件名为准（自愈），
 * 读侧不依赖该字段，因此旧档零迁移、外部编辑也不会造成读取失败。
 */
export function withSelfDescribingDocumentId(content, filePath, extensions) {
  if (!isPlainObject(content)) return content
  const id = documentIdFromContentPath(filePath, extensions)
  if (!id || content.id === id) return content
  return { ...content, id }
}

/**
 * 只为「目标已存在同 id」的文档分配新 id；其余一律保留原 id。
 * 历史上跨节点移动无条件 idRemap，导致任何引用该文档的记录一次移动就全部失效。
 * @returns {{ [oldId: string]: string }} 只包含真正被改名的项
 */
export function planDocumentIdRemap(ids, existingIds, generateId = newDocumentId) {
  const used = new Set((existingIds ?? []).map(String))
  const assigned = new Set()
  const remap = {}
  for (const rawId of ids ?? []) {
    const id = String(rawId ?? '')
    if (!id) continue
    if (!used.has(id)) {
      used.add(id)
      continue
    }
    let next
    do {
      next = String(generateId())
    } while (!next || used.has(next) || assigned.has(next))
    remap[id] = next
    assigned.add(next)
    used.add(next)
  }
  return remap
}

/** 关联记录只允许 { docId, cardRef, title } 三项，按 docId 去重并限制数量。 */
export function normalizeLinkedDocuments(raw, max = MAX_LINKED_DOCUMENTS) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const result = []
  for (const item of raw) {
    if (!isPlainObject(item)) continue
    const docId = String(item.docId ?? '').trim()
    if (!docId || seen.has(docId)) continue
    seen.add(docId)
    result.push({
      docId,
      cardRef: typeof item.cardRef === 'string' ? item.cardRef.trim().replace(/\\/g, '/') : '',
      title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
    })
    if (result.length >= max) break
  }
  return result
}

/**
 * 关联记录写库：在主进程内 read-modify-write，避免渲染层「读全图 → 写回」
 * 与画布保存互相覆盖。readGraphMeta/writeGraphMeta 必须由 graphMetaService 注入，
 * 这样 v2 分片房间也不会被误读成空图。
 */
export function createLinkedDocumentWriter({ readGraphMeta, writeGraphMeta }) {
  return {
    updateNodeLinkedDocuments(rootDir, nodePath, links, max = MAX_LINKED_DOCUMENTS) {
      const normalizedPath = normalizeCardPath(nodePath)
      if (!normalizedPath || normalizedPath === '__ROOT__') throw new Error('节点路径不合法')
      const slash = normalizedPath.lastIndexOf('/')
      const parentPath = slash >= 0 ? normalizedPath.slice(0, slash) : ''
      const key = slash >= 0 ? normalizedPath.slice(slash + 1) : normalizedPath
      const meta = readGraphMeta(rootDir, parentPath)
      const children = (meta && meta.children && typeof meta.children === 'object' && !Array.isArray(meta.children))
        ? { ...meta.children }
        : {}
      if (!children[key]) throw new Error('节点不存在: ' + normalizedPath)
      const nextLinks = normalizeLinkedDocuments(links, max)
      const child = { ...children[key] }
      if (nextLinks.length) child.linkedDocuments = nextLinks
      else delete child.linkedDocuments
      children[key] = child
      writeGraphMeta(rootDir, parentPath, { ...meta, children })
      return nextLinks
    },
  }
}

function normalizeCardPath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

/**
 * 文档来源的唯一格式化规则：末段是节点 id，必须换成可读节点名。
 * 选择器候选面包屑与右栏「来源」共用本函数，避免两处各写一份 slice(0,-1) 把末段丢掉。
 */
export function formatDocumentSource(cardPath, nodeName) {
  const normalized = normalizeCardPath(cardPath)
  if (!normalized || normalized === '__ROOT__') return '根节点'
  const parts = normalized.split('/').filter(Boolean)
  const leaf = String(nodeName ?? '').trim() || parts[parts.length - 1]
  return [...parts.slice(0, -1), leaf].join(' / ') || '根节点'
}

/**
 * 节点内文档树路径的唯一格式化规则：沿 tree.json 的 parentId 上溯，
 * 返回「祖先文档标题链」（根 → 直接父级，不含自身），用 ' / ' 连接。
 *
 * 选择器是全库扫描，一份坏档不能拖死整次检索，因此和渲染层 buildDocumentTree /
 * DocumentBreadcrumb 一样做三重保护：父节点缺失、自环/互相成环、超深一律截断。
 * 顶层文档没有节点内路径，返回空串（渲染层据此不显示多余一行）。
 * 不含自身是因为标题已在候选项首行单独展示，避免同名文档再重复一遍标题。
 *
 * @param documents tree.json 的 documents 映射（键为 docId，值含 title / parentId）
 * @param docId 目标文档 id
 */
export function formatDocumentInNodePath(documents, docId) {
  if (!isPlainObject(documents)) return ''
  const startId = String(docId ?? '')
  if (!startId || !isPlainObject(documents[startId])) return ''
  const titles = []
  const visited = new Set([startId])
  let currentId = startId
  for (let depth = 0; depth < DOCUMENT_PATH_MAX_DEPTH; depth += 1) {
    const item = documents[currentId]
    const parentId = isPlainObject(item) && typeof item.parentId === 'string'
      ? item.parentId.trim() : ''
    if (!parentId || visited.has(parentId)) break
    const parent = documents[parentId]
    if (!isPlainObject(parent)) break
    visited.add(parentId)
    titles.unshift(String(parent.title || '未命名文档').trim() || '未命名文档')
    currentId = parentId
  }
  return titles.join(' / ')
}

/** 递归找出所有 _docs 目录（含 tree.json 才算有文档）。 */
function collectDocsDirs(fs, path, startDir, maxDepth = 32) {
  const found = []
  const skip = new Set(['.trash', '_graph', '_attach', 'node_modules', '.git'])
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue
      const child = path.join(dir, entry.name)
      if (entry.name === TOPO_DOCUMENT_DIR) {
        try {
          if (fs.existsSync(path.join(child, TOPO_DOCUMENT_MANIFEST))) found.push(child)
        } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
        continue
      }
      walk(child, depth + 1)
    }
  }
  walk(startDir, 0)
  return found
}

/**
 * @param deps 注入：fs / path / requireValidWorkDir / resolveKbsPath /
 *             readTopoManifest(rootDir, cardPath) / readGraphMeta(rootDir, roomPath) /
 *             writeGraphMeta(rootDir, roomPath, meta) / readJsonFile(abs) /
 *             writeJsonFile(abs, value) / listTrashItems(rootDir, category) /
 *             statSync(abs)（关系索引的文件签名；缺省回落到 fs.statSync）
 */
export function createDocumentIndexService(deps) {
  const {
    fs,
    path,
    requireValidWorkDir,
    resolveKbsPath,
    readTopoManifest,
    readGraphMeta,
    writeGraphMeta,
    readJsonFile,
    writeJsonFile,
    listTrashItems,
    statSync = (filePath) => fs.statSync(filePath),
  } = deps

  const docsDirsOf = (rootDir) => {
    const validRoot = requireValidWorkDir(rootDir)
    const kbsDir = resolveKbsPath(validRoot, '')
    const dirs = collectDocsDirs(fs, path, kbsDir)
    // 工作区根节点（__ROOT__）的文档放在 rootDir/_docs，不在 kbs 下
    const rootDocs = path.join(validRoot, TOPO_DOCUMENT_DIR)
    try {
      if (fs.existsSync(path.join(rootDocs, TOPO_DOCUMENT_MANIFEST))) dirs.push(rootDocs)
    } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
    return { validRoot, kbsDir, dirs: [...new Set(dirs)] }
  }

  const cardPathOf = (kbsDir, docsDir, validRoot) => {
    if (path.dirname(docsDir) === validRoot) return '__ROOT__'
    return path.relative(kbsDir, path.dirname(docsDir)).split(path.sep).join('/')
  }

  const nodeNameOf = (validRoot, cardPath, cache) => {
    if (cardPath === '__ROOT__') return '根节点'
    if (cache.has(cardPath)) return cache.get(cardPath)
    const slash = cardPath.lastIndexOf('/')
    const parentPath = slash >= 0 ? cardPath.slice(0, slash) : ''
    const key = slash >= 0 ? cardPath.slice(slash + 1) : cardPath
    let name = key
    try {
      const meta = readGraphMeta(validRoot, parentPath)
      const child = meta && meta.children ? meta.children[key] : null
      if (child && typeof child.name === 'string' && child.name.trim()) name = child.name.trim()
    } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
    cache.set(cardPath, name)
    return name
  }

  /** 全库文档条目：{ docId, title, type, cardPath, nodeName, documentPathLabel } */
  const scanDocumentEntries = (rootDir) => {
    const { validRoot, kbsDir, dirs } = docsDirsOf(rootDir)
    const nameCache = new Map()
    const entries = []
    for (const docsDir of dirs) {
      const cardPath = normalizeCardPath(cardPathOf(kbsDir, docsDir, validRoot))
      if (!cardPath) continue
      let manifest
      try { manifest = readTopoManifest(validRoot, cardPath) } catch { continue }
      const documents = manifest && manifest.documents
      if (!isPlainObject(documents)) continue
      const nodeName = nodeNameOf(validRoot, cardPath, nameCache)
      for (const id of Object.keys(documents)) {
        const item = documents[id]
        if (!isPlainObject(item)) continue
        entries.push({
          docId: id,
          title: String(item.title || '未命名文档'),
          type: String(item.type || 'smart'),
          cardPath,
          nodeName,
          // 只在同一份 manifest 内上溯，跨节点 parentId 天然被「父节点缺失」挡掉。
          documentPathLabel: formatDocumentInNodePath(documents, id),
        })
      }
    }
    return entries
  }

  const collectDocumentIds = (rootDir) => scanDocumentEntries(rootDir).map((entry) => entry.docId)

  const listDocumentCandidates = (rootDir) => scanDocumentEntries(rootDir).map((entry) => ({
    ...entry,
    breadcrumb: formatDocumentSource(entry.cardPath, entry.nodeName),
  }))

  const okResult = (docId, item, cardPath, nodeName = '') => ({
    status: 'ok',
    docId,
    cardPath: normalizeCardPath(cardPath),
    title: String(item.title || '未命名文档'),
    type: String(item.type || 'smart'),
    nodeName: String(nodeName || '').trim(),
    sourceLabel: formatDocumentSource(cardPath, nodeName),
  })

  /**
   * docId → 当前所在 cardPath。优先按关联记录里的 cardRef 直取（O(1)），
   * 失效才全库扫描自愈，最后检查回收站（可恢复）。
   */
  const resolveDocumentById = (rootDir, docId, cardRef = '') => {
    const id = String(docId ?? '').trim()
    const nameCache = new Map()
    const missing = () => ({
      status: 'missing',
      docId: id,
      cardPath: '',
      title: '',
      type: 'smart',
      nodeName: '',
      sourceLabel: '未知位置',
    })
    if (!id) return missing()
    const hint = normalizeCardPath(cardRef)
    if (hint) {
      try {
        const manifest = readTopoManifest(rootDir, hint)
        const item = manifest && manifest.documents ? manifest.documents[id] : null
        if (item) return okResult(id, item, hint, nodeNameOf(rootDir, hint, nameCache))
      } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
    }
    const matches = scanDocumentEntries(rootDir).filter((entry) => entry.docId === id)
    if (matches.length) {
      const hintKb = hint.split('/')[0]
      const match = (hintKb && matches.find((entry) => entry.cardPath.split('/')[0] === hintKb)) || matches[0]
      return okResult(id, { title: match.title, type: match.type }, match.cardPath, match.nodeName)
    }
    let trashed = null
    try {
      trashed = (listTrashItems(rootDir, 'topo-documents') || []).find((item) => (
        item && item.meta && item.meta.topoDocumentItem && item.meta.topoDocumentItem.id === id
      ))
    } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
    if (trashed) {
      const item = trashed.meta.topoDocumentItem
      const cardPath = normalizeCardPath(trashed.meta.cardPath || '')
      const nodeName = nodeNameOf(rootDir, cardPath, nameCache)
      return {
        status: 'trashed',
        docId: id,
        cardPath,
        title: String(item.title || trashed.originalName || '未命名文档'),
        type: String(item.type || 'smart'),
        trashName: String(trashed.trashName || ''),
        nodeName,
        sourceLabel: formatDocumentSource(cardPath, nodeName),
      }
    }
    return missing()
  }

  /**
   * 导入 KB 副本时，把与现有库冲突的 docId 重新分配，副本视为独立文档。
   * 同步更新 tree.json 的 key/id/path/parentId、物理文件名与正文顶层 id。
   */
  const remapImportedDocumentIds = (rootDir, destKbPath, existingIds) => {
    const validRoot = requireValidWorkDir(rootDir)
    const kbsDir = resolveKbsPath(validRoot, '')
    const dest = resolveKbsPath(validRoot, destKbPath)
    const dirs = collectDocsDirs(fs, path, dest)
    const rootDocs = path.join(dest, TOPO_DOCUMENT_DIR)
    try {
      if (fs.existsSync(path.join(rootDocs, TOPO_DOCUMENT_MANIFEST))) dirs.push(rootDocs)
    } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
    const uniqueDirs = [...new Set(dirs)]
    const used = new Set((existingIds ?? []).map(String))
    let remappedCount = 0
    for (const docsDir of uniqueDirs) {
      const cardPath = normalizeCardPath(cardPathOf(kbsDir, docsDir, validRoot))
      if (!cardPath) continue
      let manifest
      try { manifest = readTopoManifest(validRoot, cardPath) } catch { continue }
      const documents = manifest && manifest.documents
      if (!isPlainObject(documents)) continue
      const ids = Object.keys(documents)
      // used 只含「其它位置已有」的 id；当前 manifest 自身的 id 不能在规划时
      // 被当成冲突（否则会把副本里每篇文档都误判为重复并全部改名）。
      const remap = planDocumentIdRemap(ids, [...used])
      ids.forEach((id) => used.add(remap[id] || id))
      if (!Object.keys(remap).length) continue
      const nextDocuments = {}
      for (const oldId of ids) {
        const item = { ...documents[oldId] }
        const newId = remap[oldId] || oldId
        const ext = DOCUMENT_EXTENSIONS[item.type] || DOCUMENT_EXTENSIONS.smart
        const oldFileName = String(item.path || '')
        const newFileName = newId + ext
        if (oldFileName && oldFileName !== newFileName) {
          const from = path.join(docsDir, path.basename(oldFileName))
          const to = path.join(docsDir, newFileName)
          try {
            if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to)
          } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
        }
        try {
          if (fs.existsSync(path.join(docsDir, newFileName))) {
            const body = readJsonFile(path.join(docsDir, newFileName))
            const nextBody = withSelfDescribingDocumentId(body, newFileName)
            if (nextBody !== body) writeJsonFile(path.join(docsDir, newFileName), nextBody)
          }
        } catch { /* best-effort：单项探测/修复失败按「不存在」处理，不阻断整次扫描 */ }
        item.id = newId
        item.path = newFileName
        if (item.parentId && remap[item.parentId]) item.parentId = remap[item.parentId]
        if (item.originalDocumentId && remap[item.originalDocumentId]) item.originalDocumentId = remap[item.originalDocumentId]
        nextDocuments[newId] = item
        if (newId !== oldId) remappedCount += 1
      }
      writeJsonFile(path.join(docsDir, TOPO_DOCUMENT_MANIFEST), { version: 2, documents: nextDocuments })
    }
    return { remappedCount }
  }

  // ---- 文档双链关系索引 ----------------------------------------------------
  // 派生缓存，不是权威数据：只记录每篇正文的 stat 签名与出链表。查询时逐个校验
  // 签名，命中的直接复用、只有变化的那一篇才重新读 JSON + 递归解析。索引写在
  // 工作区根下的 .topomind/，不进 kbs，房间扫描不会把它当成节点或 _docs。
  // 这样 create/delete/move/restore/import/外部改档 全部无需挂钩，不会漏维护。

  /** 文件签名：mtimeMs + size + ctimeMs；不存在 / 不可读返回空串。 */
  const signatureOf = (filePath) => {
    try {
      const stat = statSync(filePath)
      return `${Math.round(Number(stat.mtimeMs) || 0)}:${Number(stat.size) || 0}:${Math.round(Number(stat.ctimeMs) || 0)}`
    } catch { return '' }
  }

  const relationsIndexPath = (validRoot) => path.join(
    validRoot, DOCUMENT_RELATIONS_DIR, DOCUMENT_RELATIONS_INDEX,
  )

  // 进程内缓存索引对象；仍校验索引文件自身签名，外部删除/改写索引能自愈。
  const relationsCache = new Map()

  const loadRelationsIndex = (validRoot) => {
    const indexPath = relationsIndexPath(validRoot)
    const signature = signatureOf(indexPath)
    const cached = relationsCache.get(validRoot)
    if (cached && cached.signature === signature) return cached.index
    let index = { version: DOCUMENT_RELATIONS_VERSION, rooms: {} }
    try {
      const raw = readJsonFile(indexPath)
      if (
        isPlainObject(raw) &&
        raw.version === DOCUMENT_RELATIONS_VERSION &&
        isPlainObject(raw.rooms)
      ) {
        index = { version: DOCUMENT_RELATIONS_VERSION, rooms: raw.rooms }
      }
    } catch { /* 缺失 / 损坏一律按空索引重建，不阻断查询 */ }
    relationsCache.set(validRoot, { signature, index })
    return index
  }

  const saveRelationsIndex = (validRoot, index) => {
    const indexPath = relationsIndexPath(validRoot)
    try {
      writeJsonFile(indexPath, index)
      relationsCache.set(validRoot, { signature: signatureOf(indexPath), index })
    } catch {
      // 索引只是派生缓存：磁盘异常时不阻断本次查询（结果已在内存算好），
      // 丢掉内存缓存让下次自动全量重建即可。
      relationsCache.delete(validRoot)
    }
  }

  /**
   * 校验并按需增量重建关系索引。
   * @returns {{ index, parsed, indexed }} parsed = 本轮真正读正文解析的篇数，
   *          0 表示完全命中索引（不再做全文查找）；indexed = 索引覆盖的文档数。
   */
  const refreshRelationsIndex = (rootDir, options = {}) => {
    const force = Boolean(options.force)
    const { validRoot, kbsDir, dirs } = docsDirsOf(rootDir)
    const index = force
      ? { version: DOCUMENT_RELATIONS_VERSION, rooms: {} }
      : loadRelationsIndex(validRoot)
    const nextRooms = {}
    const nameCache = new Map()
    let parsed = 0
    let indexed = 0
    let changed = force

    for (const docsDir of dirs) {
      const cardPath = normalizeCardPath(cardPathOf(kbsDir, docsDir, validRoot))
      if (!cardPath) continue
      let manifest
      try { manifest = readTopoManifest(validRoot, cardPath) } catch { continue }
      const documents = manifest && manifest.documents
      if (!isPlainObject(documents)) continue

      const previousRoom = force ? null : index.rooms[cardPath]
      const previousDocuments = isPlainObject(previousRoom?.documents)
        ? previousRoom.documents : {}
      const nodeName = nodeNameOf(validRoot, cardPath, nameCache)
      const breadcrumb = formatDocumentSource(cardPath, nodeName)
      const nextDocuments = {}

      for (const sourceId of Object.keys(documents)) {
        const item = documents[sourceId]
        if (!isPlainObject(item)) continue
        const fileName = path.basename(String(item.path || ''))
        if (!fileName) continue
        const bodySignature = signatureOf(path.join(docsDir, fileName))
        if (!bodySignature) continue // 正文文件缺失：不进索引，也不展示为引用者

        const title = String(item.title || '未命名文档')
        const type = String(item.type || 'smart')
        const previous = previousDocuments[sourceId]
        const metaChanged = !previous || previous.title !== title ||
          previous.type !== type || previous.breadcrumb !== breadcrumb
        let outLinks = isPlainObject(previous?.outLinks) ? previous.outLinks : null
        if (force || !previous || previous.signature !== bodySignature || !outLinks) {
          let body
          try { body = readJsonFile(path.join(docsDir, fileName)) } catch { continue }
          outLinks = collectDocumentLinkTargets(body)
          parsed += 1
          changed = true
        }
        if (metaChanged) changed = true
        nextDocuments[sourceId] = {
          signature: bodySignature,
          title,
          type,
          cardPath,
          nodeName,
          breadcrumb,
          outLinks,
        }
        indexed += 1
      }

      if (Object.keys(nextDocuments).length !== Object.keys(previousDocuments).length) changed = true
      nextRooms[cardPath] = { documents: nextDocuments }
    }

    // 房间被删除 / 新增时裁剪索引，避免已删文档继续出现在引用列表里。
    if (Object.keys(nextRooms).length !== Object.keys(index.rooms).length) changed = true
    else if (Object.keys(nextRooms).some((key) => !index.rooms[key])) changed = true

    const nextIndex = { version: DOCUMENT_RELATIONS_VERSION, rooms: nextRooms }
    if (changed) saveRelationsIndex(validRoot, nextIndex)
    return { index: nextIndex, parsed, indexed }
  }

  /** 索引里的文档元数据展平成 docId → entry，供出入链两侧 O(1) 查。 */
  const flattenRelationsIndex = (index) => {
    const byId = new Map()
    for (const room of Object.values(index.rooms)) {
      const documents = isPlainObject(room?.documents) ? room.documents : {}
      for (const [sourceId, entry] of Object.entries(documents)) {
        if (isPlainObject(entry)) byId.set(sourceId, entry)
      }
    }
    return byId
  }

  const relationItem = (entry, docId, references, status) => ({
    docId,
    title: String(entry.title || ''),
    type: String(entry.type || 'smart'),
    cardPath: String(entry.cardPath || ''),
    nodeName: String(entry.nodeName || ''),
    breadcrumb: String(entry.breadcrumb || ''),
    references,
    status,
  })

  /**
   * 一次查询同时给出「引用了本页」和「本页引用了」，上下两栏共用一次索引校验，
   * 不再各扫一遍全库。出链只读当前文档在索引里的出链表；入链在内存里遍历出链表。
   * 目标文档已被删除时 outgoing 仍保留条目并标 status='missing'，用 chip 的标题快照兜底。
   */
  const listDocumentRelations = (rootDir, docId, options = {}) => {
    const id = String(docId ?? '').trim()
    if (!id) return { incoming: [], outgoing: [], parsed: 0, indexed: 0 }
    const { index, parsed, indexed } = refreshRelationsIndex(rootDir, options)
    const byId = flattenRelationsIndex(index)

    const incoming = []
    for (const [sourceId, entry] of byId) {
      if (sourceId === id) continue // 自引用不算「引用了本页」
      const links = isPlainObject(entry.outLinks) ? entry.outLinks : {}
      const references = Number(links[id]?.count) || 0
      if (!references) continue
      incoming.push(relationItem(entry, sourceId, references, 'ok'))
    }

    const own = byId.get(id)
    const ownLinks = own && isPlainObject(own.outLinks) ? own.outLinks : {}
    const outgoing = Object.keys(ownLinks).map((targetId) => {
      const references = Number(ownLinks[targetId]?.count) || 0
      const target = byId.get(targetId)
      if (target) return relationItem(target, targetId, references, 'ok')
      return relationItem({
        title: ownLinks[targetId]?.title || '未命名文档',
        type: 'smart',
        breadcrumb: '文档已不存在',
      }, targetId, references, 'missing')
    })

    return { incoming, outgoing, parsed, indexed }
  }

  /** 兼容入口：旧通道 / 旧调用方只关心入链。 */
  const listDocumentBacklinks = (rootDir, docId) => listDocumentRelations(rootDir, docId).incoming

  /** 递归列出所有持有 _graph.json 的房间（含 kbs 根），用于改写节点上的关联记录。 */
  const collectGraphRoomPaths = (validRoot, kbsDir) => {
    const rooms = []
    const skip = new Set(['.trash', '_graph', '_attach', '_docs', 'node_modules', '.git'])
    const walk = (dir, rel, depth) => {
      if (depth > 32) return
      try {
        if (fs.existsSync(path.join(dir, '_graph.json'))) rooms.push(rel)
      } catch { /* best-effort：单项探测失败按「不存在」处理 */ }
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (!entry.isDirectory() || skip.has(entry.name)) continue
        walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1)
      }
    }
    walk(kbsDir, '', 0)
    return [...new Set(rooms)]
  }

  /**
   * docId 因冲突被重新分配时（跨节点移动 / 导入副本），把两处引用同步改到新 id：
   *   1. 节点 child.linkedDocuments[].docId（一律经 graphMetaService 逻辑读写，兼容 v2 分片）；
   *   2. 所有正文里的 docLink inline content 的 props.docId。
   * 历史上只返回 idRemap 而不消费，引用会一次移动全部失效。
   */
  const rewriteDocumentIdReferences = (rootDir, remap) => {
    const mapping = isPlainObject(remap) ? remap : {}
    const mapper = (id) => mapping[id] || id
    if (!Object.keys(mapping).length) return { linkedDocuments: 0, documents: 0 }
    const validRoot = requireValidWorkDir(rootDir)
    const kbsDir = resolveKbsPath(validRoot, '')
    let linkedDocuments = 0
    let documents = 0

    for (const roomPath of collectGraphRoomPaths(validRoot, kbsDir)) {
      let meta
      try { meta = readGraphMeta(validRoot, roomPath) } catch { continue }
      const children = meta && meta.children
      if (!isPlainObject(children)) continue
      let changed = false
      const nextChildren = {}
      for (const [key, child] of Object.entries(children)) {
        if (!isPlainObject(child) || !Array.isArray(child.linkedDocuments)) {
          nextChildren[key] = child
          continue
        }
        let linkChanged = false
        const nextLinks = child.linkedDocuments.map((link) => {
          if (!isPlainObject(link) || typeof link.docId !== 'string') return link
          const nextId = mapper(link.docId)
          if (nextId === link.docId) return link
          linkChanged = true
          linkedDocuments += 1
          return { ...link, docId: nextId }
        })
        if (!linkChanged) {
          nextChildren[key] = child
          continue
        }
        changed = true
        nextChildren[key] = { ...child, linkedDocuments: nextLinks }
      }
      if (changed) writeGraphMeta(validRoot, roomPath, { ...meta, children: nextChildren })
    }

    const { dirs } = docsDirsOf(rootDir)
    for (const docsDir of dirs) {
      let entries
      try { entries = fs.readdirSync(docsDir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (entry.isDirectory && entry.isDirectory()) continue
        if (!/\.(tdoc|tmind|tflow)\.json$/i.test(entry.name)) continue
        const filePath = path.join(docsDir, entry.name)
        let body
        try { body = readJsonFile(filePath) } catch { continue }
        const rewritten = mapDocumentLinkIds(body, mapper)
        if (rewritten === body) continue
        try {
          writeJsonFile(filePath, rewritten)
          documents += 1
        } catch { /* best-effort：单项写回失败不阻断其余文档 */ }
      }
    }
    return { linkedDocuments, documents }
  }

  return {
    collectDocumentIds,
    listDocumentCandidates,
    resolveDocumentById,
    remapImportedDocumentIds,
    listDocumentBacklinks,
    listDocumentRelations,
    rewriteDocumentIdReferences,
  }
}
