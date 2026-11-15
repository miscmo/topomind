/**
 * 房间节点摘要：只读、IO 注入的纯服务（无 electron / 无全局 fs，供门禁内存文件系统真跑）。
 *
 * 【为什么单独一层】`readRoomNodeSummaries` 的旧实现为了算 childCount / hasDetail
 * 两个轻量字段，对 N 个节点逐个 existsSync，再对每个已物化目录跑完整
 * `readGraphMeta`（1 索引 + 32 分片）与 `listTopoDocuments`（扫描 _docs 全部文件
 * 并对每个文件取一次 stat，甚至可能回写 tree.json）。1469 节点房间里实测 1287 次分片探测
 * + 1813 次文件 stat，全部同步阻塞 Electron 主进程。
 *
 * 本层只做三件必要的事：
 *   1. 每个父目录一次 readdir 得到子项名集合，替代 N 次 existsSync；
 *   2. v2 只读 nodes 分片数 key（不读边分片、不合并成完整 meta），
 *      v1 直接读索引里的 children；position 只读索引的 pan；
 *   3. hasDetail 用一次 _docs readdir 判断是否存在文档扩展名文件，
 *      不做清单对账、不 stat 每个文件、绝不回写。
 *
 * 返回形状与旧实现严格一致：{ position?, childCount, hasDetail }。
 * 未知 _graph.json 版本与旧 `readGraphMeta` 一样降级为空摘要。
 */
export function createRoomSummaryService(deps) {
  const {
    readdirNames,
    readJson,
    joinPath,
    dirname,
    basename,
    resolveKbsPath,
    documentExtensions,
    shardCount = 16,
    graphDirName = '_graph',
    docsDirName = '_docs',
    indexFileName = '_graph.json',
  } = deps

  const emptySummary = () => ({ childCount: 0, hasDetail: false })

  function readRoomNodeSummaries(rootDir, roomPaths) {
    const summaries = {}
    // 同一父目录只列一次：加载 1469 节点的房间通常只有 1 个父目录。
    const namesCache = new Map()
    const listNames = (absDir) => {
      if (namesCache.has(absDir)) return namesCache.get(absDir)
      let names
      try {
        names = new Set(readdirNames(absDir))
      } catch {
        names = new Set()
      }
      namesCache.set(absDir, names)
      return names
    }

    const uniquePaths = new Set(roomPaths.map((roomPath) => String(roomPath || '')))
    for (const roomPath of uniquePaths) {
      if (!roomPath) continue
      try {
        const childDir = resolveKbsPath(rootDir, roomPath)
        // 等价旧实现的 existsSync，但一个父目录只付一次 IO。
        if (!listNames(dirname(childDir)).has(basename(childDir))) {
          summaries[roomPath] = emptySummary()
          continue
        }

        const index = readJson(joinPath(childDir, indexFileName))
        const version = index && index.version
        if (version != null && version !== 2) {
          // 未知版本：旧 readGraphMeta 会抛错并被 catch，这里保持同样的空摘要。
          summaries[roomPath] = emptySummary()
          continue
        }

        let childCount = 0
        if (version === 2) {
          for (let i = 0; i < shardCount; i += 1) {
            const part = readJson(joinPath(childDir, graphDirName, `nodes-${i}.json`))
            if (part && typeof part === 'object' && !Array.isArray(part)) {
              childCount += Object.keys(part).length
            }
          }
        } else {
          const children = index && index.children
          childCount = children && typeof children === 'object' && !Array.isArray(children)
            ? Object.keys(children).length
            : 0
        }

        const pan = index && index.pan
        const position = pan && Number.isFinite(pan.x) && Number.isFinite(pan.y)
          ? { x: pan.x, y: pan.y }
          : undefined

        let hasDetail = false
        try {
          hasDetail = readdirNames(joinPath(childDir, docsDirName)).some((name) => (
            documentExtensions.some((extension) => String(name).endsWith(extension))
          ))
        } catch {
          hasDetail = false
        }

        summaries[roomPath] = { position, childCount, hasDetail }
      } catch {
        summaries[roomPath] = emptySummary()
      }
    }
    return summaries
  }

  return { readRoomNodeSummaries }
}
