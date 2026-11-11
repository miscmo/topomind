/**
 * 统一资源树服务（纯 ESM，IO 全部由 deps 注入，不 import electron）。
 *
 * 背景：节点关联文档 / 编辑器内文档引用这类「全库挑选」控件，原先每次打开都调
 * listDocumentCandidates —— 递归遍历整库目录、读每份 _docs/tree.json、对每篇文档
 * 上溯 parentId、对每个节点读 _graph.json，再把所有文档平铺回渲染层。文档一多，
 * 打开就卡，而且层级信息在平铺过程中全丢了。
 *
 * 本模块把「笔记内的节点树」与「节点内的文档树」合成一棵树，按层提供：
 *   root              → 顶层知识库 + 工作区根节点 + 「离散节点」虚拟分组
 *   kb:<cardPath>     → 连线子节点 + 房间子节点 + 该节点文档树的根文档
 *   doc:<path>:<id>   → 该文档的直接子文档
 *   group:orphans     → 物理存在但未被父房间登记、且挂有文档的节点
 *
 * 【节点层级：房间 vs 从属连线】两种关系都在同一份 graph meta 里，必须区分：
 *   - **房间**：父房间 children 登记的子卡片，或本节点自己房间的画布节点；
 *   - **从属连线**：当前房间 edges 里 relation=subordinate 的边，source=父、target=子。
 * 展开一层时只读父房间与自身两份 meta，按从属森林给出**第一层**（树根 + 游离），
 * 子节点留到下一层；同一层里用 origin=room / subordinate 标明这一行来自哪种关系。
 *
 * 关键设计（面向后续更多「整合查看」入口）：
 *   1. **key 对渲染层不透明**：节点 key 只由本模块编解码，UI 只按 kind / hasChildren
 *      递归，以后加「最近打开」「回收站」等分组或换层级规则都不用改组件。
 *   2. **严格按需**：每层最多 2 份 graph meta（父房间 + 自身）+ 1 份 tree.json +
 *      1 次 readdir，绝不递归子孙；card 节点乐观可展开，展开到空层由 hook 回填箭头。
 *   3. **只列有文档的节点**：展开房间层时做一次缓存的目录级探测，只读各房间的
 *      tree.json 清单（不读文档正文、不写索引），按 cardPath 前缀剪掉「自身和后代
 *      都没有文档」的节点；只剩路径用途的空父节点保留但标 origin=path。
 *   4. **搜索 / 定位走派生索引**：.topomind/document-tree-index.json 按 tree.json 的
 *      stat 签名增量重建，索引丢了或损坏自动自愈；写库入口一律不挂钩（与双链索引
 *      同一套路）。默认树视图完全不碰索引，用户第一次搜索才建。
 *   5. **坏档隔离**：任何单项读取失败都按「空」处理，不拖死整层。
 */
import {
  TOPO_DOCUMENT_DIR,
  TOPO_DOCUMENT_MANIFEST,
  DOCUMENT_RELATIONS_DIR,
  collectDocsDirs,
  formatDocumentInNodePath,
  formatDocumentSource,
  normalizeCardPath,
} from './document-id-service.js'

export const UNIFIED_TREE_ROOT_KEY = 'root'
export const UNIFIED_TREE_ORPHANS_KEY = 'group:orphans'
export const UNIFIED_TREE_INDEX = 'document-tree-index.json'
export const UNIFIED_TREE_INDEX_VERSION = 1

const TREE_SCAN_MAX_DEPTH = 32
const DOCUMENT_PATH_MAX_DEPTH = 64
const ORPHAN_CACHE_TTL_MS = 5000
const PRESENCE_CACHE_TTL_MS = 5000
const MAX_HIERARCHY_DEPTH = 100
/** 与 edgeRelations.ts / graphHierarchy.ts 同源：旧值一律只读兼容，未知值当关联边。 */
const SUBORDINATE_RELATIONS = new Set([
  'subordinate', '依赖', '演进', '从属', '组成', '推导', 'is-a', 'part-of', 'inference',
])
/** 节点目录里的保留目录，不能当成子节点 / 离散节点。 */
const SKIP_DIRS = new Set([
  '.trash', '.topomind', '_graph', '_attach', '_docs', 'node_modules', '.git', 'images',
])

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const safeRead = (fn, fallback) => { try { return fn() } catch { return fallback } }
const compareLabel = (a, b) => String(a).localeCompare(String(b), 'zh-CN')

/** key 编码：分段 URI 编码，cardPath 里的 '/' 与中文都不会破坏 ':' 分隔。 */
export const cardTreeKey = (cardPath) => `kb:${encodeURIComponent(normalizeCardPath(cardPath))}`
export const documentTreeKey = (cardPath, docId) =>
  `doc:${encodeURIComponent(normalizeCardPath(cardPath))}:${encodeURIComponent(String(docId ?? ''))}`

const decodeSegment = (raw) => {
  try { return decodeURIComponent(String(raw ?? '')) } catch { return '' }
}
const safeCardPath = (raw) => {
  const value = normalizeCardPath(decodeSegment(raw))
  if (!value || /[\x00-\x1F\x7F]/.test(value)) return ''
  if (value === '__ROOT__') return value
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return ''
  return value
}
const safeDocId = (raw) => {
  const value = decodeSegment(raw)
  if (!value || value.length > 256 || /[\x00-\x1F\x7F/\\]/.test(value)) return ''
  return value
}

/** 唯一的 key 解析器：渲染层不需要知道结构，但回归脚本可直接真跑本函数。 */
export function parseUnifiedTreeKey(key) {
  const raw = String(key ?? '')
  if (raw === UNIFIED_TREE_ROOT_KEY) return { kind: 'root', key: raw }
  if (raw === UNIFIED_TREE_ORPHANS_KEY) return { kind: 'orphans', key: raw }
  const sep = raw.indexOf(':')
  if (sep < 0) return { kind: 'unknown', key: raw }
  const type = raw.slice(0, sep)
  const rest = raw.slice(sep + 1)
  if (type === 'kb') {
    const cardPath = safeCardPath(rest)
    return cardPath ? { kind: 'card', key: raw, cardPath } : { kind: 'unknown', key: raw }
  }
  if (type === 'doc') {
    const parts = rest.split(':')
    const cardPath = safeCardPath(parts[0])
    const docId = safeDocId(parts.slice(1).join(':'))
    return cardPath && docId
      ? { kind: 'document', key: raw, cardPath, docId }
      : { kind: 'unknown', key: raw }
  }
  if (type === 'group') return { kind: 'group', key: raw, group: rest }
  return { kind: 'unknown', key: raw }
}

/**
 * 从属连线森林（纯函数，只读一份 graph meta，回归脚本可独立真跑）。
 * 方向与 graphHierarchy.ts 一致：source=父 → target=子。
 * 多父 / 成环 / 超深的边一律降级为游离，不改盘、不删边；related 边从不入树。
 */
export function buildSubordinateForest(meta) {
  const nodes = Object.keys(isPlainObject(meta?.children) ? meta.children : {})
  const known = new Set(nodes)
  const edges = Array.isArray(meta?.edges) ? meta.edges : []
  const parentOf = new Map()
  for (const edge of edges) {
    if (!isPlainObject(edge)) continue
    const relation = String(edge.relation ?? '').trim() || String(edge.data?.relation ?? '').trim()
    if (!SUBORDINATE_RELATIONS.has(relation)) continue
    const source = String(edge.source ?? '')
    const target = String(edge.target ?? '')
    if (!source || !target || source === target || !known.has(source) || !known.has(target)) continue
    if (parentOf.has(target)) continue
    let cursor = source
    const visited = new Set()
    let valid = true
    for (let depth = 1; depth <= MAX_HIERARCHY_DEPTH; depth += 1) {
      if (cursor === target || visited.has(cursor)) { valid = false; break }
      visited.add(cursor)
      const next = parentOf.get(cursor)
      if (!next) break
      cursor = next
      if (depth === MAX_HIERARCHY_DEPTH) valid = false
    }
    if (valid) parentOf.set(target, source)
  }
  const childrenOf = new Map()
  for (const [child, parent] of parentOf) {
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(child)
  }
  return {
    nodes,
    topLevel: nodes.filter((id) => !parentOf.has(id)),
    parentOf: (id) => parentOf.get(id) ?? '',
    childrenOf: (id) => childrenOf.get(id) ?? [],
    hasSubordinateChildren: (id) => (childrenOf.get(id) ?? []).length > 0,
  }
}

export function createUnifiedDocumentTreeService(deps) {
  const {
    fs,
    path,
    requireValidWorkDir,
    resolveKbsPath,
    readGraphMeta,
    readJsonFile,
    writeJsonFile,
    statSync = (filePath) => fs.statSync(filePath),
  } = deps

  const indexCache = new Map()
  const orphanCache = new Map()

  const signatureOf = (filePath) => {
    try {
      const stat = statSync(filePath)
      return `${Math.round(Number(stat.mtimeMs) || 0)}:${Number(stat.size) || 0}:${Math.round(Number(stat.ctimeMs) || 0)}`
    } catch { return '' }
  }
  const cardDirOf = (validRoot, cardPath) =>
    cardPath === '__ROOT__' ? validRoot : resolveKbsPath(validRoot, cardPath)
  const docsDirOf = (validRoot, cardPath) => path.join(cardDirOf(validRoot, cardPath), TOPO_DOCUMENT_DIR)
  const manifestPathOf = (validRoot, cardPath) => path.join(docsDirOf(validRoot, cardPath), TOPO_DOCUMENT_MANIFEST)
  const readManifest = (validRoot, cardPath) => {
    const raw = safeRead(() => readJsonFile(manifestPathOf(validRoot, cardPath)), null)
    return isPlainObject(raw) && isPlainObject(raw.documents) ? raw.documents : {}
  }
  const listDirs = (dir) => safeRead(
    () => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e && e.isDirectory && e.isDirectory()),
    [],
  )
  const cardPathOfDocsDir = (validRoot, kbs, docsDir) => {
    const parent = path.dirname(docsDir)
    if (parent === validRoot) return '__ROOT__'
    return normalizeCardPath(path.relative(kbs, parent).split(path.sep).join('/'))
  }

  /**
   * 只列有文档的节点：一次缓存的目录级探测。只解析各房间的 tree.json 清单判断
   * `documents` 是否非空，**绝不读 .tdoc.json 正文、绝不写派生索引**，也不递归
   * 子孙层；prefixes 让「后代有文档」变成 O(1) 命中，用于保留必经路径容器。
   */
  const presenceCache = new Map()
  const documentPresence = (validRoot) => {
    const cached = presenceCache.get(validRoot)
    if (cached && Date.now() - cached.at < PRESENCE_CACHE_TTL_MS) return cached
    const kbs = safeRead(() => resolveKbsPath(validRoot, ''), '')
    const dirs = safeRead(() => collectDocsDirs(fs, path, kbs), [])
    const rootDocs = path.join(validRoot, TOPO_DOCUMENT_DIR)
    if (safeRead(() => fs.existsSync(path.join(rootDocs, TOPO_DOCUMENT_MANIFEST)), false)) dirs.push(rootDocs)
    const rooms = new Set()
    const prefixes = new Set()
    for (const docsDir of new Set(dirs)) {
      const raw = safeRead(() => readJsonFile(path.join(docsDir, TOPO_DOCUMENT_MANIFEST)), null)
      const documents = isPlainObject(raw) && isPlainObject(raw.documents) ? raw.documents : {}
      if (Object.keys(documents).length === 0) continue
      const cardPath = cardPathOfDocsDir(validRoot, kbs, docsDir)
      if (!cardPath) continue
      rooms.add(cardPath)
      let acc = ''
      for (const part of cardPath.split('/').filter(Boolean)) {
        acc = acc ? `${acc}/${part}` : part
        prefixes.add(acc)
      }
    }
    const result = { at: Date.now(), rooms, prefixes }
    presenceCache.set(validRoot, result)
    return result
  }

  /** 节点显示名：父房间 _graph.json.children[key].name，缺失回落到目录名。 */
  const makeNameResolver = (validRoot) => {
    const cache = new Map()
    return (cardPath) => {
      if (cardPath === '__ROOT__') return '根节点'
      if (cache.has(cardPath)) return cache.get(cardPath)
      const slash = cardPath.lastIndexOf('/')
      const parentPath = slash >= 0 ? cardPath.slice(0, slash) : ''
      const key = slash >= 0 ? cardPath.slice(slash + 1) : cardPath
      let name = key
      const meta = safeRead(() => readGraphMeta(validRoot, parentPath), null)
      const child = isPlainObject(meta?.children) ? meta.children[key] : null
      if (isPlainObject(child) && typeof child.name === 'string' && child.name.trim()) name = child.name.trim()
      cache.set(cardPath, name)
      return name
    }
  }

  const candidateOf = (validRoot, cardPath, docId, item, documents, nameOf) => {
    const nodeName = nameOf(cardPath)
    return {
      docId,
      title: String(item.title || '未命名文档').trim() || '未命名文档',
      type: String(item.type || 'smart'),
      cardPath,
      nodeName,
      breadcrumb: formatDocumentSource(cardPath, nodeName),
      documentPathLabel: formatDocumentInNodePath(documents, docId),
    }
  }

  /**
   * 文档树口径与渲染层 buildDocumentTree 一致：无效 / 成环 / 超深的 parentId
   * 一律降级为根文档，保证任何一篇文档都能在树里被找到。
   */
  const documentTreeOf = (documents) => {
    const entries = Object.keys(documents)
      .filter((id) => isPlainObject(documents[id]))
      .map((id, index) => ({
        id,
        item: documents[id],
        index,
        order: Number.isFinite(Number(documents[id].sortOrder)) ? Number(documents[id].sortOrder) : index,
      }))
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    const validParentOf = (id) => {
      const parentId = String(byId.get(id)?.item?.parentId ?? '').trim()
      if (!parentId || parentId === id || !byId.has(parentId)) return null
      const visited = new Set([id])
      let current = parentId
      for (let depth = 0; depth < DOCUMENT_PATH_MAX_DEPTH && current; depth += 1) {
        if (visited.has(current)) return null
        visited.add(current)
        current = String(byId.get(current)?.item?.parentId ?? '').trim()
      }
      return current ? null : parentId
    }
    const childrenMap = new Map()
    const roots = []
    for (const entry of entries) {
      const parentId = validParentOf(entry.id)
      if (!parentId) { roots.push(entry); continue }
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, [])
      childrenMap.get(parentId).push(entry)
    }
    const sort = (list) => list.slice().sort((a, b) =>
      a.order - b.order || a.index - b.index || a.id.localeCompare(b.id))
    return { roots: sort(roots), childrenOf: (id) => sort(childrenMap.get(id) ?? []) }
  }

  const documentNode = (validRoot, cardPath, documents, entry, tree, nameOf) => {
    const children = tree.childrenOf(entry.id)
    return {
      key: documentTreeKey(cardPath, entry.id),
      kind: 'document',
      label: String(entry.item.title || '未命名文档').trim() || '未命名文档',
      subtitle: formatDocumentSource(cardPath, nameOf(cardPath)),
      hasChildren: children.length > 0,
      childCount: children.length,
      selectable: true,
      candidate: candidateOf(validRoot, cardPath, entry.id, entry.item, documents, nameOf),
    }
  }

  const cardNode = (validRoot, cardPath, label, nameOf, options = {}) => ({
    key: cardTreeKey(cardPath),
    kind: 'card',
    label: String(label || '').trim() || nameOf(cardPath),
    subtitle: options.subtitle ?? formatDocumentSource(cardPath, nameOf(cardPath)),
    // 乐观可展开：精确判断 hasChildren 要为每个子节点再读一份 meta/tree.json，
    // 那就不是按需加载了。展开到空层由 useUnifiedTree 回填 false 并收起箭头。
    hasChildren: true,
    childCount: 0,
    selectable: false,
    orphan: Boolean(options.orphan),
    cardPath,
    ...(options.origin ? { origin: options.origin } : {}),
    ...(typeof options.hasDocuments === 'boolean' ? { hasDocuments: options.hasDocuments } : {}),
  })

  const emptyLevel = (parentKey) => ({ parentKey: String(parentKey ?? UNIFIED_TREE_ROOT_KEY), nodes: [] })

  /** 顶层：只做一次 readdir，不读任何 JSON（工作区根节点用一次 existsSync 探测）。 */
  const rootLevel = (validRoot, nameOf) => {
    const kbs = safeRead(() => resolveKbsPath(validRoot, ''), '')
    const kbNames = listDirs(kbs)
      .map((entry) => entry.name)
      .filter((name) => !SKIP_DIRS.has(name) && !name.startsWith('.'))
      .sort(compareLabel)
    const nodes = kbNames.map((name) => cardNode(validRoot, name, name, nameOf, { subtitle: '知识库' }))
    const rootManifest = safeRead(() => readJsonFile(manifestPathOf(validRoot, '__ROOT__')), null)
    const hasRootDocs = isPlainObject(rootManifest?.documents)
      && Object.keys(rootManifest.documents).length > 0
    if (hasRootDocs) {
      nodes.unshift(cardNode(validRoot, '__ROOT__', '工作区根节点', nameOf, { subtitle: '根节点' }))
    }
    nodes.push({
      key: UNIFIED_TREE_ORPHANS_KEY,
      kind: 'group',
      label: '离散节点',
      subtitle: '未登记在节点树里的节点',
      hasChildren: true,
      childCount: 0,
      selectable: false,
      group: 'orphans',
    })
    return { parentKey: UNIFIED_TREE_ROOT_KEY, nodes }
  }

  /**
   * 房间层：两类子节点合在一层，用 origin 区分来源（组件只认这个字段）。
   *   ① 从属连线：父房间 edges 里以本节点为 source 的 subordinate 子节点；
   *   ② 房间结构：本节点自己房间画布的从属森林**第一层**（树根 + 游离）。
   * 只输出第一层，深层留到下一次展开；未登记的物理目录统一归「离散节点」分组，
   * 不在这里重复。无文档、且后代也没有文档的节点一律剪掉。
   */
  const cardLevel = (validRoot, cardPath, nameOf, parentKey) => {
    const nodes = []
    const presence = documentPresence(validRoot)
    const joinCardPath = (roomPath, id) => normalizeCardPath(roomPath ? `${roomPath}/${id}` : id)
    /**
     * 只列有文档的节点。「后代」有两条路径：物理房间嵌套（cardPath 前缀）与
     * **同一房间内的连线子树**（子节点和父节点是同级目录，前缀判断覆盖不到）。
     * 后者必须沿 forest 下溯，否则「自身无文档但连线后代有文档」的容器会被误剪，
     * 深层文档就再也点不到了。
     */
    const isRelevant = (roomPath, nodeId, forest) => {
      const own = presence.rooms.has(joinCardPath(roomPath, nodeId))
        || presence.prefixes.has(joinCardPath(roomPath, nodeId))
      if (own) return true
      const stack = forest.childrenOf(nodeId).slice()
      const visited = new Set()
      while (stack.length) {
        const id = stack.pop()
        if (!id || visited.has(id)) continue
        visited.add(id)
        const descendant = joinCardPath(roomPath, id)
        if (presence.rooms.has(descendant) || presence.prefixes.has(descendant)) return true
        stack.push(...forest.childrenOf(id))
      }
      return false
    }
    const emitCard = (roomPath, nodeId, forest, origin) => {
      if (!isRelevant(roomPath, nodeId, forest)) return
      const childPath = joinCardPath(roomPath, nodeId)
      if (!childPath) return
      const ownDocs = presence.rooms.has(childPath)
      nodes.push(cardNode(validRoot, childPath, nameOf(childPath), nameOf, {
        origin: ownDocs ? origin : 'path',
        hasDocuments: ownDocs,
      }))
    }
    if (cardPath !== '__ROOT__') {
      const slash = cardPath.lastIndexOf('/')
      const parentRoomPath = slash >= 0 ? cardPath.slice(0, slash) : ''
      const nodeId = slash >= 0 ? cardPath.slice(slash + 1) : cardPath
      const parentMeta = safeRead(() => readGraphMeta(validRoot, parentRoomPath), null)
      const parentForest = buildSubordinateForest(parentMeta)
      for (const childId of parentForest.childrenOf(nodeId)) {
        emitCard(parentRoomPath, childId, parentForest, 'subordinate')
      }
      const selfMeta = safeRead(() => readGraphMeta(validRoot, cardPath), null)
      const selfForest = buildSubordinateForest(selfMeta)
      for (const childId of selfForest.topLevel) {
        emitCard(cardPath, childId, selfForest,
          selfForest.hasSubordinateChildren(childId) ? 'subordinate' : 'room')
      }
    }
    const documents = readManifest(validRoot, cardPath)
    const tree = documentTreeOf(documents)
    for (const entry of tree.roots) nodes.push(documentNode(validRoot, cardPath, documents, entry, tree, nameOf))
    return { parentKey, nodes }
  }

  /** 文档层：只读该节点的一份 tree.json，返回直接子文档。 */
  const documentLevel = (validRoot, cardPath, docId, nameOf, parentKey) => {
    const documents = readManifest(validRoot, cardPath)
    if (!isPlainObject(documents[docId])) return emptyLevel(parentKey)
    const tree = documentTreeOf(documents)
    return {
      parentKey,
      nodes: tree.childrenOf(docId).map((entry) => documentNode(validRoot, cardPath, documents, entry, tree, nameOf)),
    }
  }

  /**
   * 离散节点：物理目录存在但父房间 graph meta 没登记。全库目录扫描只在这一层
   * 被展开时发生，并带短 TTL 缓存；树内同一个节点仍按其物理父展示，不重复。
   */
  const collectOrphanCards = (validRoot) => {
    const kbs = safeRead(() => resolveKbsPath(validRoot, ''), '')
    const out = []
    const metaCache = new Map()
    const metaOf = (rel) => {
      if (metaCache.has(rel)) return metaCache.get(rel)
      const meta = safeRead(() => readGraphMeta(validRoot, rel), null)
      metaCache.set(rel, meta)
      return meta
    }
    const walk = (dir, rel, depth) => {
      if (depth > TREE_SCAN_MAX_DEPTH) return
      const meta = metaOf(rel)
      const registered = isPlainObject(meta?.children) ? meta.children : {}
      for (const entry of listDirs(dir)) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        const childRel = normalizeCardPath(`${rel}/${entry.name}`)
        if (!childRel) continue
        if (!Object.prototype.hasOwnProperty.call(registered, entry.name)) out.push(childRel)
        walk(path.join(dir, entry.name), childRel, depth + 1)
      }
    }
    for (const entry of listDirs(kbs)) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      walk(path.join(kbs, entry.name), entry.name, 1)
    }
    return out
  }

  const orphanLevel = (validRoot, nameOf, parentKey) => {
    const cached = orphanCache.get(validRoot)
    const cards = cached && Date.now() - cached.at < ORPHAN_CACHE_TTL_MS
      ? cached.cards : collectOrphanCards(validRoot)
    orphanCache.set(validRoot, { at: Date.now(), cards })
    const presence = documentPresence(validRoot)
    return {
      parentKey,
      nodes: cards
        .filter((cardPath) => presence.rooms.has(cardPath))
        .map((cardPath) => cardNode(validRoot, cardPath, nameOf(cardPath), nameOf, {
          orphan: true, hasDocuments: true,
        })),
    }
  }

  /** 按层查询：UI 唯一的树数据入口。 */
  const listTreeLevel = (rootDir, parentKey = UNIFIED_TREE_ROOT_KEY) => {
    const key = String(parentKey ?? UNIFIED_TREE_ROOT_KEY)
    const validRoot = safeRead(() => requireValidWorkDir(rootDir), '')
    if (!validRoot) return emptyLevel(key)
    const parsed = parseUnifiedTreeKey(key)
    const nameOf = makeNameResolver(validRoot)
    switch (parsed.kind) {
      case 'root': return rootLevel(validRoot, nameOf)
      case 'card': return cardLevel(validRoot, parsed.cardPath, nameOf, key)
      case 'document': return documentLevel(validRoot, parsed.cardPath, parsed.docId, nameOf, key)
      case 'orphans': return orphanLevel(validRoot, nameOf, key)
      default: return emptyLevel(key)
    }
  }

  // ===== 搜索 / 定位用的派生索引（默认树视图完全不触发） =====

  const indexPathOf = (validRoot) => path.join(validRoot, DOCUMENT_RELATIONS_DIR, UNIFIED_TREE_INDEX)
  const loadIndex = (validRoot) => {
    const indexPath = indexPathOf(validRoot)
    const signature = signatureOf(indexPath)
    const cached = indexCache.get(validRoot)
    if (cached && cached.signature === signature) return cached.index
    let index = { version: UNIFIED_TREE_INDEX_VERSION, rooms: {} }
    const raw = safeRead(() => readJsonFile(indexPath), null)
    if (isPlainObject(raw) && raw.version === UNIFIED_TREE_INDEX_VERSION && isPlainObject(raw.rooms)) {
      index = { version: UNIFIED_TREE_INDEX_VERSION, rooms: raw.rooms }
    }
    indexCache.set(validRoot, { signature, index })
    return index
  }
  const saveIndex = (validRoot, index) => {
    const indexPath = indexPathOf(validRoot)
    try {
      writeJsonFile(indexPath, index)
      indexCache.set(validRoot, { signature: signatureOf(indexPath), index })
    } catch {
      // 派生缓存写失败不阻断本次查询；丢掉内存缓存让下次按文件签名自愈。
      indexCache.delete(validRoot)
    }
  }

  const scanDocsDirs = (validRoot) => {
    const kbs = safeRead(() => resolveKbsPath(validRoot, ''), '')
    const dirs = collectDocsDirs(fs, path, kbs)
    const rootDocs = path.join(validRoot, TOPO_DOCUMENT_DIR)
    if (safeRead(() => fs.existsSync(path.join(rootDocs, TOPO_DOCUMENT_MANIFEST)), false)) dirs.push(rootDocs)
    return { kbs, dirs: [...new Set(dirs)] }
  }
  /** 只重新解析 stat 签名变化的 tree.json；房间增删自动裁剪，索引损坏自动重建。 */
  const refreshIndex = (rootDir, options = {}) => {
    const validRoot = safeRead(() => requireValidWorkDir(rootDir), '')
    if (!validRoot) return { version: UNIFIED_TREE_INDEX_VERSION, rooms: {} }
    const force = Boolean(options.force)
    const { kbs, dirs } = scanDocsDirs(validRoot)
    const index = force ? { version: UNIFIED_TREE_INDEX_VERSION, rooms: {} } : loadIndex(validRoot)
    const nameOf = makeNameResolver(validRoot)
    const nextRooms = {}
    let changed = force

    for (const docsDir of dirs) {
      const cardPath = cardPathOfDocsDir(validRoot, kbs, docsDir)
      if (!cardPath) continue
      const treePath = path.join(docsDir, TOPO_DOCUMENT_MANIFEST)
      const signature = signatureOf(treePath)
      if (!signature) continue
      const previous = isPlainObject(index.rooms[cardPath]) ? index.rooms[cardPath] : null
      if (!force && previous && previous.signature === signature && isPlainObject(previous.documents)) {
        nextRooms[cardPath] = previous
        continue
      }
      const raw = safeRead(() => readJsonFile(treePath), null)
      const documents = isPlainObject(raw) && isPlainObject(raw.documents) ? raw.documents : {}
      const nodeName = nameOf(cardPath)
      const breadcrumb = formatDocumentSource(cardPath, nodeName)
      const nextDocuments = {}
      for (const [docId, item] of Object.entries(documents)) {
        if (!isPlainObject(item)) continue
        nextDocuments[docId] = {
          title: String(item.title || '未命名文档').trim() || '未命名文档',
          type: String(item.type || 'smart'),
          parentId: String(item.parentId ?? '').trim(),
          sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 0,
          cardPath,
          nodeName,
          breadcrumb,
          documentPathLabel: formatDocumentInNodePath(documents, docId),
        }
      }
      nextRooms[cardPath] = { signature, documents: nextDocuments }
      changed = true
    }
    if (Object.keys(nextRooms).length !== Object.keys(index.rooms).length) changed = true
    else if (Object.keys(nextRooms).some((room) => !index.rooms[room])) changed = true
    const nextIndex = { version: UNIFIED_TREE_INDEX_VERSION, rooms: nextRooms }
    if (changed) saveIndex(validRoot, nextIndex)
    return nextIndex
  }

  const flattenIndex = (index) => {
    const out = []
    for (const room of Object.values(index.rooms)) {
      if (!isPlainObject(room?.documents)) continue
      for (const [docId, entry] of Object.entries(room.documents)) {
        if (isPlainObject(entry)) out.push({ docId, ...entry })
      }
    }
    return out
  }
  const toCandidate = (entry) => ({
    docId: entry.docId,
    title: entry.title,
    type: entry.type,
    cardPath: entry.cardPath,
    nodeName: entry.nodeName,
    breadcrumb: entry.breadcrumb,
    documentPathLabel: entry.documentPathLabel,
  })

  /** 空 query 直接返回，绝不触发全库扫描（默认列表是树，不是搜索结果）。 */
  const searchDocuments = (rootDir, query, options = {}) => {
    const q = String(query ?? '').trim().toLowerCase()
    if (!q) return []
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 80))
    const entries = flattenIndex(refreshIndex(rootDir, options))
    const rank = (entry) => {
      const title = String(entry.title ?? '').toLowerCase()
      if (title.startsWith(q)) return 0
      if (title.includes(q)) return 1
      return 2
    }
    const matches = entries.filter((entry) => (
      String(entry.title ?? '').toLowerCase().includes(q)
      || String(entry.breadcrumb ?? '').toLowerCase().includes(q)
      || String(entry.documentPathLabel ?? '').toLowerCase().includes(q)
    ))
    matches.sort((a, b) => rank(a) - rank(b)
      || compareLabel(a.title, b.title)
      || compareLabel(a.breadcrumb, b.breadcrumb))
    return matches.slice(0, limit).map(toCandidate)
  }

  /** docId → 从根到该文档的 key 链，供「在树中定位 / 已选回显」自动展开。 */
  const resolveDocumentPath = (rootDir, docId) => {
    const id = String(docId ?? '').trim()
    if (!id) return []
    const index = refreshIndex(rootDir)
    const room = Object.values(index.rooms).find((item) =>
      isPlainObject(item?.documents) && isPlainObject(item.documents[id]))
    if (!room) return []
    const documents = room.documents
    const cardPath = String(documents[id].cardPath ?? '')
    if (!cardPath) return []
    const keys = [UNIFIED_TREE_ROOT_KEY]
    if (cardPath === '__ROOT__') keys.push(cardTreeKey('__ROOT__'))
    else {
      const validRoot = safeRead(() => requireValidWorkDir(rootDir), '')
      let acc = ''
      for (const part of cardPath.split('/').filter(Boolean)) {
        const roomPath = acc
        acc = acc ? `${acc}/${part}` : part
        // 连线子节点和父节点是同级目录，物理路径链里没有连线祖先；按 subordinate
        // 树把祖先补进去，否则 useUnifiedTree.expandPath 展开到一半就断链。
        const forest = buildSubordinateForest(
          safeRead(() => readGraphMeta(validRoot, roomPath), null))
        const ancestors = []
        const visitedNodes = new Set([part])
        let cursor = part
        for (let depth = 0; depth < MAX_HIERARCHY_DEPTH; depth += 1) {
          const parent = forest.parentOf(cursor)
          if (!parent || visitedNodes.has(parent)) break
          visitedNodes.add(parent)
          ancestors.unshift(parent)
          cursor = parent
        }
        for (const ancestor of ancestors) {
          keys.push(cardTreeKey(roomPath ? `${roomPath}/${ancestor}` : ancestor))
        }
        keys.push(cardTreeKey(acc))
      }
    }
    const chain = []
    const visited = new Set([id])
    let current = id
    for (let depth = 0; depth < DOCUMENT_PATH_MAX_DEPTH; depth += 1) {
      const parentId = String(documents[current]?.parentId ?? '').trim()
      if (!parentId || visited.has(parentId) || !isPlainObject(documents[parentId])) break
      visited.add(parentId)
      chain.unshift(parentId)
      current = parentId
    }
    chain.push(id)
    for (const docKey of chain) keys.push(documentTreeKey(cardPath, docKey))
    return keys
  }

  const invalidate = (rootDir) => {
    if (rootDir) {
      indexCache.delete(rootDir); orphanCache.delete(rootDir); presenceCache.delete(rootDir)
    } else {
      indexCache.clear(); orphanCache.clear(); presenceCache.clear()
    }
  }

  return {
    listTreeLevel,
    searchDocuments,
    resolveDocumentPath,
    invalidate,
  }
}
