/**
 * 把全库连线关系**物理迁移**成两值（`related` / `subordinate`），并把从属边
 * 整理成合规树（唯一父 / 无环 / 深度 ≤100）。
 *
 * 【用户决策 2026-11-08】
 *   1. 彻底做磁盘迁移：磁盘上只剩两值，`_config.json` 定义同步收成 2 项；
 *   2. 方向钉死 source=父 → target=子；
 *   3. 深度自动推导，手动指定改为 pin（P2 的 LOD，本脚本不涉及）；
 *   4. 存量违规边**降级为 related 而不是删除**，边数 / 节点数严格不变。
 *
 * 用法（默认 dry-run，只读、不写任何知识库文件）：
 *   node --experimental-strip-types --experimental-specifier-resolution=node scripts/migrate-edge-relations.mts
 * 真正落盘（**必须先完全退出应用**，否则 close-guard 的 flush 会用内存旧值写回）：
 *   node --experimental-strip-types --experimental-specifier-resolution=node scripts/migrate-edge-relations.mts --apply --ack-app-closed
 * 用备份校验迁移结果：
 *   node --experimental-strip-types --experimental-specifier-resolution=node scripts/migrate-edge-relations.mts --verify <backupDir>
 *
 * 可选参数：
 *   --root <path>        知识库根目录，默认 D:/Document/NoteBook/kbs
 *   --config <path>      全局 _config.json，默认 <root>/../_config.json
 *   --backup-dir <path>  指定备份目录（分批执行时共用）
 *   --report <path>      把完整清单写成 JSON
 *
 * 安全约定（与 migrate-graph-shards.mts 同一套范式）：
 *   - 读写**只经** createGraphMetaService（唯一格式边界），不解析 children 索引、
 *     也不经 normalizeGraphMeta（后者会把旧值读时映射掉，报告就看不到原值了）；
 *   - 只改 edges[].relation **一个字段**，边 id / 两端 / weight / 全部样式字段原样，
 *     因此 v2 分片桶不变；索引最后写，崩溃时仍是完整旧档；
 *   - 备份 `_graph.json` + `_graph/*.json` 分片 + `_config.json`，逐文件 sha256
 *     + TOCTOU 复核 + 写后往返校验（graphMetaComparisonKey，边顺序无关）；
 *   - 每批 10 个逐批验证，失败房间立即从备份回滚。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  createGraphMetaService,
  graphMetaComparisonKey,
} from '../electron/services/graph-meta-service.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const ackAppClosed = args.includes('--ack-app-closed')
const verifyArg = args.indexOf('--verify') >= 0 ? (args[args.indexOf('--verify') + 1] ?? null) : null
const argValue = (flag: string): string | null => {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? null) : null
}
const kbRoot = path.resolve(argValue('--root') || process.env.TOPOMIND_KB_ROOT || 'D:/Document/NoteBook/kbs')
const configPath = path.resolve(argValue('--config') || path.join(path.dirname(kbRoot), '_config.json'))
const reportPath = argValue('--report')
const customBackupDir = argValue('--backup-dir')
const backupDir = verifyArg
  ? path.resolve(verifyArg)
  : (customBackupDir
    ? path.resolve(customBackupDir)
    : path.join(path.dirname(kbRoot), `_topomind_backup_edge_relations_${new Date().toISOString().replace(/[:.]/g, '-')}`))

if (!fs.existsSync(kbRoot) || !fs.statSync(kbRoot).isDirectory()) {
  console.error(`知识库根目录不存在: ${kbRoot}`)
  process.exit(1)
}
if (apply && verifyArg) {
  console.error('--apply 与 --verify 不能同时使用')
  process.exit(1)
}
if (apply && !ackAppClosed) {
  console.error('必须先完全退出 TopoMind 应用再迁移（close-guard 的 flush 会覆盖迁移结果）。')
  console.error('确认已退出后追加 --ack-app-closed 重新执行。')
  process.exit(1)
}

interface RelationModules {
  readEdgeRelationId: (value: unknown) => string
  normalizeEdgeRelationDefinitions: (raw: unknown) => Array<Record<string, unknown>>
  BUILTIN_EDGE_RELATIONS: Array<Record<string, unknown>>
  EDGE_RELATION_IDS: readonly string[]
  LEGACY_EDGE_RELATION_MAP: Readonly<Record<string, string>>
  SUBORDINATE_EDGE_DIRECTION: string
  MAX_HIERARCHY_DEPTH: number
  planEdgeRelationMigration: (
    nodeIds: readonly string[],
    edges: Array<Record<string, unknown>>,
  ) => {
    edges: Array<Record<string, unknown>>
    changes: Array<{ edgeId: string; from: string; to: string }>
    downgrades: Array<{ edgeId: string; source: string; target: string; reason: string }>
    hierarchy: { roots: string[]; free: string[]; depth: Map<string, number> }
  }
  toHierarchyEdge: (raw: Record<string, unknown>) => Record<string, unknown>
}

/**
 * 规则源只有一份：`src/domain/graph/edgeRelations.ts` / `graphHierarchy.ts`。
 * 用 esbuild 打包成单个 ESM 再 data-URL 导入，避免脚本里抄第二份映射表
 * （抄表是这类迁移最常见的事故来源）。
 */
async function loadRelationModules(): Promise<RelationModules> {
  const { build } = await import('esbuild')
  const result = await build({
    stdin: {
      contents: [
        "export { readEdgeRelationId, normalizeEdgeRelationDefinitions, BUILTIN_EDGE_RELATIONS, EDGE_RELATION_IDS, LEGACY_EDGE_RELATION_MAP } from './src/domain/graph/edgeRelations.ts';",
        "export { SUBORDINATE_EDGE_DIRECTION, MAX_HIERARCHY_DEPTH, planEdgeRelationMigration, toHierarchyEdge } from './src/domain/graph/graphHierarchy.ts';",
      ].join('\n'),
      resolveDir: projectRoot,
      sourcefile: 'migrate-edge-relations-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    banner: { js: 'globalThis.window = globalThis.window || {};' },
  })
  const code = Buffer.from(result.outputFiles[0].text).toString('base64')
  return await import(`data:text/javascript;base64,${code}`) as unknown as RelationModules
}

const mods = await loadRelationModules()

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fd = fs.openSync(tempPath, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(data ?? {}, null, 2), 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tempPath, filePath)
}

function makeStore(root: string) {
  const resolveKbsPath = (_rootDir: string, relPath: string): string => {
    const result = path.resolve(root, relPath || '')
    const rel = path.relative(root, result)
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error('路径越界: ' + String(relPath))
    }
    return result
  }
  const readJsonFile = (filePath: string): unknown => {
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  }
  return createGraphMetaService({
    ensureDir: (d: string) => fs.mkdirSync(d, { recursive: true }),
    graphFilePath: (dir: string) => path.join(dir, '_graph.json'),
    joinPath: (...parts: string[]) => path.join(...parts),
    readJsonFile,
    requireValidWorkDir: (d: string) => d,
    resolveKbsPath,
    writeJsonFile: writeJsonAtomic,
  })
}

const store = makeStore(kbRoot)
const backupStore = makeStore(backupDir)

interface RoomPlan {
  rel: string
  graphFile: string
  shardDir: string
  version: number
  meta: Record<string, unknown>
  originalEdges: Array<Record<string, unknown>>
  finalEdges: Array<Record<string, unknown>>
  nodeCount: number
  mapping: Record<string, number>
  downgrades: Array<{ edgeId: string; source: string; target: string; reason: string }>
  changed: boolean
  roots: number
  free: number
  maxDepth: number
  hashes: Record<string, string>
}

function roomFiles(graphFile: string, shardDir: string): string[] {
  const files = [graphFile]
  if (fs.existsSync(shardDir)) {
    for (const name of fs.readdirSync(shardDir)) {
      if (/^(nodes|edges)-\d+\.json$/.test(name)) files.push(path.join(shardDir, name))
    }
  }
  return files
}

/** 计算一个房间的迁移计划（纯计算，不写盘）。 */
function planRoom(rel: string, graphFile: string, meta: Record<string, unknown>): RoomPlan {
  const shardDir = path.join(path.dirname(graphFile), '_graph')
  const children = (meta.children && typeof meta.children === 'object' && !Array.isArray(meta.children))
    ? meta.children as Record<string, unknown>
    : {}
  const originalEdges = Array.isArray(meta.edges) ? meta.edges as Array<Record<string, unknown>> : []
  const nodeIds = Object.keys(children)

  // 映射 + 整理合规树共用一个纯函数（回归脚本跑的是同一份）。
  const migration = mods.planEdgeRelationMigration(nodeIds, originalEdges)
  const mapping: Record<string, number> = {}
  for (const change of migration.changes) {
    const key = `${change.from} → ${change.to}`
    mapping[key] = (mapping[key] ?? 0) + 1
  }
  const finalEdges = migration.edges
  const changed = originalEdges.some((edge, i) => (
    String(edge.relation ?? '') !== String(finalEdges[i]?.relation ?? '')
  ))
  const depths = [...migration.hierarchy.depth.values()]
  const hashes: Record<string, string> = {}
  for (const file of roomFiles(graphFile, shardDir)) {
    if (fs.existsSync(file)) hashes[file] = sha256(file)
  }
  return {
    rel,
    graphFile,
    shardDir,
    version: Number(store.detectVersion(kbRoot, rel)),
    meta,
    originalEdges,
    finalEdges,
    nodeCount: nodeIds.length,
    mapping,
    downgrades: migration.downgrades,
    changed,
    roots: migration.hierarchy.roots.length,
    free: migration.hierarchy.free.length,
    maxDepth: depths.length ? Math.max(...depths) : 0,
    hashes,
  }
}

function scanRooms(dir: string, rel = ''): RoomPlan[] {
  const out: RoomPlan[] = []
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  const graphFile = path.join(dir, '_graph.json')
  if (fs.existsSync(graphFile)) {
    const meta = store.readGraphMeta(kbRoot, rel) as Record<string, unknown>
    out.push(planRoom(rel, graphFile, meta))
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    // _graph/ 里只有分片文件；_docs / _attach 不含 _graph.json，但不主动跳过，
    // 避免误漏用户恰好同名命名的卡片目录。
    if (entry.name === '_graph') continue
    out.push(...scanRooms(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name))
  }
  return out
}

/** 备份房间的索引 + 全部分片（v2 的真实数据都在分片里，只备索引不够）。 */
function backupRoom(plan: RoomPlan): void {
  const destDir = path.join(backupDir, plan.rel)
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(plan.graphFile, path.join(destDir, '_graph.json'))
  if (fs.existsSync(plan.shardDir)) {
    const destShards = path.join(destDir, '_graph')
    fs.mkdirSync(destShards, { recursive: true })
    for (const name of fs.readdirSync(plan.shardDir)) {
      if (/^(nodes|edges)-\d+\.json$/.test(name)) {
        fs.copyFileSync(path.join(plan.shardDir, name), path.join(destShards, name))
      }
    }
  }
}

function restoreRoom(plan: RoomPlan): void {
  const srcDir = path.join(backupDir, plan.rel)
  fs.copyFileSync(path.join(srcDir, '_graph.json'), plan.graphFile)
  const srcShards = path.join(srcDir, '_graph')
  if (fs.existsSync(srcShards)) {
    fs.mkdirSync(plan.shardDir, { recursive: true })
    for (const name of fs.readdirSync(srcShards)) {
      if (/^(nodes|edges)-\d+\.json$/.test(name)) {
        fs.copyFileSync(path.join(srcShards, name), path.join(plan.shardDir, name))
      }
    }
  }
}

function readConfig(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {}
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>
}

/** 配置迁移：保留 related 与「旧从属类」关系的用户自定义 name/style，其余丢弃。 */
function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const defs = Array.isArray(raw.edgeRelations) ? raw.edgeRelations as Array<Record<string, unknown>> : []
  const overrides: Array<Record<string, unknown>> = []
  const related = defs.find((item) => item && item.id === 'related')
  if (related) overrides.push(related)
  const legacySubordinate = defs.find((item) => (
    item && item.id !== 'related'
    && mods.LEGACY_EDGE_RELATION_MAP[String(item.id)] === 'subordinate'
  ))
  if (legacySubordinate) overrides.push({ ...legacySubordinate, id: 'subordinate' })
  return { ...raw, edgeRelations: mods.normalizeEdgeRelationDefinitions(overrides) }
}

const rooms = scanRooms(kbRoot)
const pending = rooms.filter((room) => room.changed)
const rawConfig = readConfig(configPath)
const nextConfig = migrateConfig(rawConfig)
const configChanged = JSON.stringify(rawConfig.edgeRelations ?? null) !== JSON.stringify(nextConfig.edgeRelations)
const totalEdges = rooms.reduce((a, r) => a + r.originalEdges.length, 0)
const globalMapping: Record<string, number> = {}
for (const room of rooms) {
  for (const [key, count] of Object.entries(room.mapping)) {
    globalMapping[key] = (globalMapping[key] ?? 0) + count
  }
}
const allDowngrades = rooms.flatMap((room) => room.downgrades.map((d) => ({ room: room.rel, ...d })))
const totalSubordinate = rooms.reduce(
  (a, r) => a + r.finalEdges.filter((e) => e.relation === 'subordinate').length,
  0,
)

console.log(`扫描根目录: ${kbRoot}`)
console.log(`配置文件  : ${configPath}`)
console.log(`房间 ${rooms.length}（有边 ${rooms.filter((r) => r.originalEdges.length > 0).length}）｜边合计 ${totalEdges}｜待改写房间 ${pending.length}`)
console.log(`关系方向  : ${mods.SUBORDINATE_EDGE_DIRECTION}｜深度上限 ${mods.MAX_HIERARCHY_DEPTH}｜落盘合法值 ${mods.EDGE_RELATION_IDS.join(' / ')}`)
console.log('旧值映射命中:')
for (const [key, count] of Object.entries(globalMapping).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key}  × ${count}`)
}
console.log(`迁移后从属边 ${totalSubordinate}｜违规降级 ${allDowngrades.length}｜配置定义 ${String((rawConfig.edgeRelations as unknown[] | undefined)?.length ?? 0)} → ${mods.EDGE_RELATION_IDS.length}`)
if (allDowngrades.length > 0) {
  console.log('降级清单（边保留，relation 改为 related）:')
  for (const item of allDowngrades.slice(0, 50)) {
    console.log(`  - ${item.room} / ${item.edgeId} (${item.source} → ${item.target}): ${item.reason}`)
  }
  if (allDowngrades.length > 50) console.log(`  ... 另有 ${allDowngrades.length - 50} 条`)
}
const withTree = rooms.filter((r) => r.finalEdges.some((e) => e.relation === 'subordinate'))
console.log(`含层级树的房间 ${withTree.length}｜最大深度 ${Math.max(0, ...rooms.map((r) => r.maxDepth))}｜树根合计 ${rooms.reduce((a, r) => a + r.roots, 0)}｜游离节点合计 ${rooms.reduce((a, r) => a + r.free, 0)}`)

// 不变量：只改 relation，节点/边数量与所有其它字段必须逐字段相等。
for (const room of rooms) {
  const before = room.originalEdges
  const after = room.finalEdges
  if (before.length !== after.length) {
    console.error(`✗ 边数量不等: ${room.rel} (${before.length} → ${after.length})`)
    process.exit(1)
  }
  for (let i = 0; i < before.length; i += 1) {
    const a = { ...before[i] }
    const b = { ...after[i] }
    delete a.relation
    delete b.relation
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      console.error(`✗ 除 relation 外字段被改动: ${room.rel} / ${String(before[i].id)}`)
      process.exit(1)
    }
    if (!mods.EDGE_RELATION_IDS.includes(String(after[i].relation))) {
      console.error(`✗ 落盘值非法: ${room.rel} / ${String(before[i].id)} = ${String(after[i].relation)}`)
      process.exit(1)
    }
  }
}
console.log('不变量校验通过：节点/边数量不变、除 relation 外逐字段相等、落盘值恒为两值。')

if (verifyArg) {
  let checked = 0
  let failed = 0
  for (const room of rooms) {
    const backupIndex = path.join(backupDir, room.rel, '_graph.json')
    if (!fs.existsSync(backupIndex)) continue
    const original = backupStore.readGraphMeta(backupDir, room.rel) as Record<string, unknown>
    const expectedPlan = planRoom(room.rel, backupIndex, original)
    const expected = { ...original, edges: expectedPlan.finalEdges }
    const actual = store.readGraphMeta(kbRoot, room.rel)
    checked += 1
    if (graphMetaComparisonKey(expected) !== graphMetaComparisonKey(actual)) {
      failed += 1
      console.error(`  ✗ 往返不一致: ${room.rel}`)
    }
    const actualEdges = (actual as { edges?: unknown[] }).edges ?? []
    if (actualEdges.some((edge) => !mods.EDGE_RELATION_IDS.includes(String((edge as Record<string, unknown>).relation)))) {
      failed += 1
      console.error(`  ✗ 仍有旧关系值: ${room.rel}`)
    }
  }
  const backupCfg = readConfig(path.join(backupDir, '_config.json'))
  const actualCfg = readConfig(configPath)
  const expectedCfg = migrateConfig(backupCfg)
  if (JSON.stringify(expectedCfg.edgeRelations) !== JSON.stringify(actualCfg.edgeRelations)) {
    failed += 1
    console.error('  ✗ _config.json 关系定义与迁移预期不一致')
  }
  console.log(`校验完成: 比对 ${checked} 个房间，不一致 ${failed}`)
  if (failed > 0) process.exit(1)
} else if (!apply) {
  console.log('\n[dry-run] 只读扫描，未写任何知识库文件。')
  console.log(`将改写 ${pending.length} 个房间的边 + ${configChanged ? '1 份' : '0 份'} _config.json。`)
  for (const room of pending.slice(0, 20)) {
    console.log(`  - ${room.rel} [v${room.version}] ${room.originalEdges.length} 边 / ${room.nodeCount} 节点`)
  }
  if (pending.length > 20) console.log(`  ... 另有 ${pending.length - 20} 个房间`)
  console.log('\n⚠️ 应用必须完全退出后再执行 --apply（close-guard 的 flush 会用内存旧值覆盖迁移结果）。')
  console.log('确认后执行: --apply --ack-app-closed；随后用 --verify <backupDir> 复核。')
} else {
  fs.mkdirSync(backupDir, { recursive: true })
  if (fs.existsSync(configPath)) fs.copyFileSync(configPath, path.join(backupDir, '_config.json'))
  console.log(`\n备份目录: ${backupDir}`)
  let migrated = 0
  let failed = 0
  // 每批 10 个逐批验证。
  for (let offset = 0; offset < pending.length; offset += 10) {
    const batch = pending.slice(offset, offset + 10)
    for (const room of batch) {
      try {
        // TOCTOU：扫描后若任一相关文件被别的进程改动，绝不覆盖，直接跳过。
        for (const [file, hash] of Object.entries(room.hashes)) {
          if (!fs.existsSync(file) || sha256(file) !== hash) {
            throw new Error('扫描后文件已被其它进程改动，跳过本房间（请重新扫描）')
          }
        }
        backupRoom(room)
        const expected = { ...room.meta, edges: room.finalEdges }
        store.writeGraphMeta(kbRoot, room.rel, expected)
        const roundTrip = store.readGraphMeta(kbRoot, room.rel)
        if (graphMetaComparisonKey(expected) !== graphMetaComparisonKey(roundTrip)) {
          throw new Error('写后往返校验失败')
        }
        migrated += 1
      } catch (error) {
        failed += 1
        console.error(`  ✗ ${room.rel}: ${(error as Error).message}`)
        try { restoreRoom(room) } catch (restoreError) {
          console.error(`  ! 回滚失败，需人工从备份恢复: ${(restoreError as Error).message}`)
        }
      }
    }
    console.log(`  批次 ${Math.floor(offset / 10) + 1}: 累计成功 ${migrated}，失败 ${failed}`)
  }
  // 配置最后写（与「索引最后写」同理：房间都落定后才切换规则定义）。
  if (failed === 0 && configChanged) {
    writeJsonAtomic(configPath, nextConfig)
    const roundTrip = readConfig(configPath)
    if (JSON.stringify(roundTrip.edgeRelations) !== JSON.stringify(nextConfig.edgeRelations)) {
      failed += 1
      console.error('  ✗ _config.json 写后往返校验失败')
    }
  }
  console.log(`迁移完成: 成功 ${migrated}，失败 ${failed}。备份: ${backupDir}`)
  if (failed > 0) process.exit(1)
}

if (reportPath) {
  const report = {
    kbRoot,
    configPath,
    backupDir,
    mode: verifyArg ? 'verify' : (apply ? 'apply' : 'dry-run'),
    direction: mods.SUBORDINATE_EDGE_DIRECTION,
    edgeRelationIds: mods.EDGE_RELATION_IDS,
    rooms: rooms.map((room) => ({
      rel: room.rel,
      version: room.version,
      nodeCount: room.nodeCount,
      edgeCount: room.originalEdges.length,
      mapping: room.mapping,
      downgrades: room.downgrades,
      changed: room.changed,
      roots: room.roots,
      free: room.free,
      maxDepth: room.maxDepth,
    })),
    globalMapping,
    totalEdges,
    totalSubordinate,
    allDowngrades,
    configChanged,
  }
  writeJsonAtomic(path.resolve(reportPath), report)
  console.log(`清单已写入: ${path.resolve(reportPath)}`)
}
