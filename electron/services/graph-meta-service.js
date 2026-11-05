/**
 * 房间图元数据读写（P1：固定分片 + version）。
 *
 * v1（历史单文件格式）：
 *   _graph.json = { children: { [id]: child }, edges: [ ... ], zoom, pan, ... }
 *
 * v2（分片格式）：
 *   _graph.json            = { version: 2, zoom, pan, ...非节点顶层字段 }
 *   _graph/nodes-<i>.json  = { [id]: child }   i ∈ [0, GRAPH_SHARD_COUNT)
 *   _graph/edges-<i>.json  = [ edge ]          i ∈ [0, GRAPH_SHARD_COUNT)
 *
 * 分片数固定：不随节点规模增长、无需 rebalance，节点/边按 id 稳定 hash 取模自动均摊。
 * 写侧只覆盖「内容真的变了」的分片 —— 拖动一个节点时写盘量约为全量写的 1/16。
 * 渲染层依旧收发完整 meta（children/edges/zoom/pan），IPC、file.ts、close-guard 全部无需感知格式。
 *
 * 兼容策略（旧库零风险，格式不自动改写）：
 *   - 读侧 v1/v2 都组装成完整 meta；
 *   - 写侧「跟随现有格式」：v2 继续分片；v1 且已有 children/edges 的旧档继续单文件；
 *     只有空房间 / 新房间才默认写 v2；
 *   - 显式升级走 scripts/migrate-graph-shards.mts（默认 dry-run，--apply 才写）。
 *   - 遇到未知 version 读写一律抛错，防止旧程序把新格式静默当空图或降级覆盖。
 *
 * 崩溃一致性：v1→v2 时「索引最后写」。索引是唯一的格式开关，写分片途中崩溃时
 * 索引仍是完整的 v1 单文件，重开走 v1，半成品分片不会被读到。每个分片自身由
 * writeJsonFile 的 temp+fsync+rename 保证原子。
 *
 * 本模块不 import electron / node 内置模块，路径与 IO 全部由 deps 注入：
 * 主进程 file-service.js 与迁移脚本复用同一份格式实现，避免两套逻辑漂移。
 */
export const GRAPH_FORMAT_VERSION = 2
export const GRAPH_SHARD_COUNT = 16

const isPlainObject = (value) => (
  !!value && typeof value === 'object' && !Array.isArray(value)
)

/** FNV-1a 32 位：纯函数、无依赖、跨进程稳定。 */
export function graphShardIndexOf(key) {
  let hash = 0x811c9dc5
  const text = String(key ?? '')
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  }
  return hash % GRAPH_SHARD_COUNT
}

/** 递归排序对象键：让序列化结果与 React Flow 传来的遍历顺序无关，脏判定才不会误判。 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (isPlainObject(value)) {
    const sorted = {}
    Object.keys(value).sort().forEach((key) => { sorted[key] = sortKeys(value[key]) })
    return sorted
  }
  return value
}

const stringify = (value) => JSON.stringify(value, null, 2)

/**
 * 迁移往返 / --verify 专用的比较键：递归排序对象键 + 按 id 排序边数组。
 *
 * v2 读回时 edges 按分片桶序（0..K-1）拼接，与 v1 原始数组顺序不同是必然结果；
 * 边顺序没有业务语义（React Flow 按 id 索引，浮层层级用固定 zIndex）。
 * 用严格数组顺序做往返校验会让「所有多边房间」100% 误报失败：真实知识库首轮
 * 26 个房间里有 6 个因此迁移失败（数据其实一条没丢）。
 *
 * 除顺序外，任何字段增删改 / 丢边 / 错桶都必须被这个键检出，不能退化成「忽略边」。
 */
export function graphMetaComparisonKey(meta) {
  const normalized = sortKeys(meta)
  if (isPlainObject(normalized) && Array.isArray(normalized.edges)) {
    normalized.edges = normalized.edges.slice().sort((a, b) => {
      const ai = String((a && a.id) ?? '')
      const bi = String((b && b.id) ?? '')
      return ai < bi ? -1 : ai > bi ? 1 : 0
    })
  }
  return JSON.stringify(normalized)
}

export function createGraphMetaService(deps) {
  const {
    ensureDir,
    graphFilePath,
    joinPath,
    readJsonFile,
    requireValidWorkDir,
    resolveKbsPath,
    writeJsonFile,
  } = deps

  const shardDir = (dir) => joinPath(dir, '_graph')
  const shardFilePath = (dir, kind, index) => joinPath(shardDir(dir), `${kind}-${index}.json`)

  function readVersion(index) {
    const version = index && index.version
    if (version == null) return 1
    if (version === GRAPH_FORMAT_VERSION) return 2
    throw new Error(
      `不支持的 _graph.json 版本: ${String(version)}（本程序最高支持 ${GRAPH_FORMAT_VERSION}）`
    )
  }

  /** 只按磁盘上的索引判定格式，不组装分片 —— 写侧不需要读全量数据。 */
  function detectWriteVersion(dir) {
    const raw = readJsonFile(graphFilePath(dir))
    const version = raw && raw.version
    if (version === GRAPH_FORMAT_VERSION) return 2
    if (version != null) {
      throw new Error(
        `不支持的 _graph.json 版本: ${String(version)}（本程序最高支持 ${GRAPH_FORMAT_VERSION}）`
      )
    }
    // 有 v1 数据的旧档一律保持单文件，绝不自动改写；空房间 / 无文件才启用分片。
    if (isPlainObject(raw && raw.children) || Array.isArray(raw && raw.edges)) return 1
    return 2
  }

  /** v2：把逻辑 meta 拆成固定分片，只写内容变化的桶。 */
  function writeAsV2(dir, meta) {
    ensureDir(dir)
    ensureDir(shardDir(dir))

    const nodeBuckets = Array.from({ length: GRAPH_SHARD_COUNT }, () => ({}))
    const edgeBuckets = Array.from({ length: GRAPH_SHARD_COUNT }, () => [])
    const children = isPlainObject(meta.children) ? meta.children : {}
    const edges = Array.isArray(meta.edges) ? meta.edges : []

    Object.keys(children).forEach((id) => {
      nodeBuckets[graphShardIndexOf(id)][id] = children[id]
    })
    edges.forEach((edge) => {
      edgeBuckets[graphShardIndexOf(edge && edge.id)].push(edge)
    })

    for (let i = 0; i < GRAPH_SHARD_COUNT; i += 1) {
      const nextNodes = sortKeys(nodeBuckets[i])
      const nodesPath = shardFilePath(dir, 'nodes', i)
      const prevNodesRaw = readJsonFile(nodesPath)
      const prevNodes = isPlainObject(prevNodesRaw) ? prevNodesRaw : {}
      // 空桶且文件不存在时两侧都是 {}，自然跳过 → 首次写不会产生 32 个空文件。
      if (stringify(prevNodes) !== stringify(nextNodes)) writeJsonFile(nodesPath, nextNodes)

      const nextEdges = edgeBuckets[i]
      const edgesPath = shardFilePath(dir, 'edges', i)
      const prevEdgesRaw = readJsonFile(edgesPath)
      const prevEdges = Array.isArray(prevEdgesRaw) ? prevEdgesRaw : []
      if (stringify(prevEdges) !== stringify(nextEdges)) writeJsonFile(edgesPath, nextEdges)
    }

    // 索引是格式开关，最后写。除 children/edges/version 外的顶层字段（zoom/pan/未来扩展）都留这里。
    const nextIndex = {}
    Object.keys(meta).forEach((key) => {
      if (key !== 'children' && key !== 'edges' && key !== 'version') nextIndex[key] = meta[key]
    })
    nextIndex.version = GRAPH_FORMAT_VERSION
    const indexPath = graphFilePath(dir)
    const prevIndex = readJsonFile(indexPath)
    if (stringify(prevIndex) !== stringify(nextIndex)) writeJsonFile(indexPath, nextIndex)
  }

  /** 读侧统一组装完整逻辑 meta（v1 原样、v2 合并分片）。 */
  function readGraphMeta(rootDir, roomPath) {
    rootDir = requireValidWorkDir(rootDir)
    const dir = resolveKbsPath(rootDir, roomPath)
    const index = readJsonFile(graphFilePath(dir))
    const version = readVersion(index)
    if (version === 1) return index

    const children = {}
    let edges = []
    for (let i = 0; i < GRAPH_SHARD_COUNT; i += 1) {
      const nodePart = readJsonFile(shardFilePath(dir, 'nodes', i))
      if (isPlainObject(nodePart)) Object.assign(children, nodePart)
      const edgePart = readJsonFile(shardFilePath(dir, 'edges', i))
      if (Array.isArray(edgePart)) edges = edges.concat(edgePart)
    }
    // 不把 version 透给渲染层：convertFSBToGraph 只认 children/edges/zoom/pan，
    // 写回时格式由磁盘索引决定，避免出现「渲染层携带版本号」这条隐式契约。
    const meta = {}
    Object.keys(index).forEach((key) => {
      if (key !== 'version') meta[key] = index[key]
    })
    meta.children = children
    meta.edges = edges
    return meta
  }

  return {
    readGraphMeta,

    writeGraphMeta(rootDir, roomPath, meta) {
      rootDir = requireValidWorkDir(rootDir)
      const dir = resolveKbsPath(rootDir, roomPath)
      ensureDir(dir)
      if (!isPlainObject(meta)) throw new Error('writeGraphMeta: meta 必须是普通对象')

      const version = detectWriteVersion(dir)
      if (version === 1) {
        writeJsonFile(graphFilePath(dir), meta)
        return
      }
      writeAsV2(dir, meta)
    },

    /** 显式 v1→v2 迁移（迁移脚本调用）。已是 v2 返回 false；备份由调用方负责。 */
    migrateRoom(rootDir, roomPath) {
      rootDir = requireValidWorkDir(rootDir)
      const dir = resolveKbsPath(rootDir, roomPath)
      const raw = readJsonFile(graphFilePath(dir))
      if (readVersion(raw) === 2) return false

      const expected = Object.assign({}, raw, {
        children: isPlainObject(raw.children) ? raw.children : {},
        edges: Array.isArray(raw.edges) ? raw.edges : [],
      })
      writeAsV2(dir, expected)

      // 真跑往返校验：任何字段丢失/丢边/分片错桶都会在这里炸掉，而不是等用户重开知识库才发现。
      // 比较用 graphMetaComparisonKey（边顺序无关）——v2 读回按分片桶序拼接，
      // 用严格数组顺序会把每个多边房间误判为失败。
      const roundTrip = readGraphMeta(rootDir, roomPath)
      if (graphMetaComparisonKey(expected) !== graphMetaComparisonKey(roundTrip)) {
        throw new Error('分片迁移往返校验失败: ' + String(roomPath))
      }
      return true
    },

    /** 供迁移脚本 / 回归只读探测，不组装分片。 */
    detectVersion(rootDir, roomPath) {
      rootDir = requireValidWorkDir(rootDir)
      const dir = resolveKbsPath(rootDir, roomPath)
      const raw = readJsonFile(graphFilePath(dir))
      if (raw && raw.version != null) return readVersion(raw)
      if (isPlainObject(raw && raw.children) || Array.isArray(raw && raw.edges)) return 1
      return 0 // 空房间 / 文件不存在
    },
  }
}
