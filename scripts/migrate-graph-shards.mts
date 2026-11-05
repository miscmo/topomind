/**
 * 把房间 _graph.json 统一升级到 v2 固定分片（P1）。
 *
 * 两类房间都会升级，目标是「全库只剩 v2 一种格式」：
 *   - version=1：v1 单文件，含 children/edges 的真实数据 → 拆成 16 分片；
 *   - version=0：磁盘上是 {} 的空档（可能有文档/附件，但无子节点）→ 写 v2 索引，
 *     空桶不产生任何分片文件。migrateRoom 已原生支持，无需另写一套格式逻辑。
 *
 * 默认 dry-run：只扫描、统计、打印，不写任何文件。
 *   node --experimental-strip-types scripts/migrate-graph-shards.mts
 * 真正落盘（写前把每个房间的原始 _graph.json 整份备份）：
 *   node --experimental-strip-types scripts/migrate-graph-shards.mts --apply
 * 用备份校验已迁移房间（读回 v2 并与原始 v1 深比较）：
 *   node --experimental-strip-types scripts/migrate-graph-shards.mts --verify <backupDir>
 *
 * 可选参数：
 *   --root <path>        知识库根目录（含各 KB 的 kbs/），默认 D:/Document/NoteBook/kbs
 *   --backup-dir <path>  指定备份目录（分批执行时共用）
 *   --limit <n>          只处理前 n 个待迁移房间
 *   --report <path>      把清单写成 JSON
 *
 * 为什么要显式迁移：写侧「跟随现有格式」——旧库保持 v1 单文件、零自动改写，
 * 新房间/空房间才默认 v2。这样即使回退程序版本或用户脚本直接读 _graph.json，
 * 历史库也不会突然变成看不懂的索引文件。
 *
 * 应用可能正在运行：扫描时记录每个 _graph.json 的 sha256，落盘前逐一复核。
 * 若期间被别的进程写动（用户下钻/保存），本房间跳过并报错，绝不覆盖新数据。
 *
 * 分片格式实现与主进程完全一致：直接 import electron/services/graph-meta-service.js，
 * 不存在第二套格式代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createGraphMetaService, graphMetaComparisonKey, GRAPH_SHARD_COUNT, GRAPH_FORMAT_VERSION } from '../electron/services/graph-meta-service.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const verifyArg = args.indexOf('--verify') >= 0 ? (args[args.indexOf('--verify') + 1] ?? null) : null
const argValue = (flag: string): string | null => {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? null) : null
}
const kbRoot = path.resolve(argValue('--root') || process.env.TOPOMIND_KB_ROOT || 'D:/Document/NoteBook/kbs')
const reportPath = argValue('--report')
const limitArg = argValue('--limit')
const limit = limitArg ? Math.max(1, Number(limitArg) || 1) : Number.POSITIVE_INFINITY
const customBackupDir = argValue('--backup-dir')
const backupDir = customBackupDir
  ? path.resolve(customBackupDir)
  : path.join(path.dirname(kbRoot), `_topomind_backup_graph_shards_${new Date().toISOString().replace(/[:.]/g, '-')}`)

if (!fs.existsSync(kbRoot) || !fs.statSync(kbRoot).isDirectory()) {
  console.error(`知识库根目录不存在: ${kbRoot}`)
  process.exit(1)
}
if (apply && verifyArg) {
  console.error('--apply 与 --verify 不能同时使用')
  process.exit(1)
}

const workDir = path.dirname(kbRoot)

const resolveKbsPath = (_rootDir: string, relPath: string): string => {
  const result = path.resolve(kbRoot, relPath || '')
  const rel = path.relative(kbRoot, result)
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('路径越界: ' + String(relPath))
  }
  return result
}

const readJsonFile = (filePath: string): unknown => {
  if (!fs.existsSync(filePath)) return {}
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

const writeJsonFile = (filePath: string, data: unknown): void => {
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

const store = createGraphMetaService({
  ensureDir: (d: string) => fs.mkdirSync(d, { recursive: true }),
  graphFilePath: (dir: string) => path.join(dir, '_graph.json'),
  joinPath: (...parts: string[]) => path.join(...parts),
  readJsonFile,
  requireValidWorkDir: (d: string) => d,
  resolveKbsPath,
  writeJsonFile,
})

interface RoomEntry {
  roomPath: string
  graphFile: string
  version: number
  bytes: number
  contentHash: string
  nodeCount: number
  edgeCount: number
}

/** 递归找出所有 _graph.json；_graph/ 子目录里只有 nodes-*.json / edges-*.json，不会被误收。 */
function scanRooms(dir: string, rel = ''): RoomEntry[] {
  const out: RoomEntry[] = []
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  const graphFile = path.join(dir, '_graph.json')
  if (fs.existsSync(graphFile)) {
    const raw = fs.readFileSync(graphFile, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const version = store.detectVersion(workDir, rel) as number
    const logical = version === 2 ? (store.readGraphMeta(workDir, rel) as Record<string, unknown>) : parsed
    out.push({
      roomPath: rel || '(root)',
      graphFile,
      version,
      bytes: Buffer.byteLength(raw, 'utf-8'),
      contentHash: crypto.createHash('sha256').update(raw).digest('hex'),
      nodeCount: Object.keys((logical.children as object) ?? {}).length,
      edgeCount: Array.isArray(logical.edges) ? logical.edges.length : 0,
    })
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    // 只跳过 _graph/（本方案的固定分片目录）；_attach、_docs 里不会有 _graph.json，
    // 但不主动跳过，避免误漏用户恰好同名命名的卡片目录。
    if (entry.name === '_graph') continue
    out.push(...scanRooms(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name))
  }
  return out
}

const rooms = scanRooms(kbRoot)
const v1 = rooms.filter((r) => r.version === 1)
const v2 = rooms.filter((r) => r.version === 2)
const empty = rooms.filter((r) => r.version === 0)
// 全库格式统一：有数据的 v1 与 {} 空档一并升级，升级完只剩 version=2。
// 顺序上先迁有数据的（万一中断，重要数据优先落定），空档随后。
const pending = [...v1, ...empty].slice(0, limit)

console.log(`扫描根目录: ${kbRoot}`)
console.log(`房间总数 ${rooms.length}｜v1 待迁移 ${v1.length}｜v1 空档待升级 ${empty.length}｜v2 已分片 ${v2.length}`)
console.log(`节点合计 ${rooms.reduce((a, r) => a + r.nodeCount, 0)}｜边合计 ${rooms.reduce((a, r) => a + r.edgeCount, 0)}｜分片数固定 ${GRAPH_SHARD_COUNT}｜目标版本 ${GRAPH_FORMAT_VERSION}`)
console.log(`v1 单文件总大小 ${(v1.reduce((a, r) => a + r.bytes, 0) / 1024 / 1024).toFixed(2)} MB`)
console.log(`最大房间: ${rooms.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((r) => `${r.roomPath}=${(r.bytes / 1024).toFixed(0)}KB/${r.nodeCount}节点`).join(', ') || '无'}`)

if (verifyArg) {
  const verifyRoot = path.resolve(verifyArg)
  let checked = 0
  let failed = 0
  for (const room of v2) {
    const backupFile = path.join(verifyRoot, room.roomPath === '(root)' ? '_graph.json' : `${room.roomPath}/_graph.json`)
    if (!fs.existsSync(backupFile)) continue
    const original = JSON.parse(fs.readFileSync(backupFile, 'utf-8')) as Record<string, unknown>
    const expected = { ...original, children: original.children ?? {}, edges: original.edges ?? [] }
    const actual = store.readGraphMeta(workDir, room.roomPath === '(root)' ? '' : room.roomPath)
    checked += 1
    if (graphMetaComparisonKey(expected) !== graphMetaComparisonKey(actual)) {
      failed += 1
      console.error(`  ✗ 往返不一致: ${room.roomPath}`)
    }
  }
  console.log(`校验完成: 比对 ${checked} 个房间，不一致 ${failed}`)
  if (failed > 0) process.exit(1)
} else if (!apply) {
  console.log(`\n[dry-run] 将升级 ${pending.length} 个房间（有数据 v1 ${Math.min(v1.length, limit)}，空档 ${pending.length - Math.min(v1.length, limit)}；可用 --limit 分批）。加 --apply 才写盘。`)
  pending.slice(0, 20).forEach((r) => console.log(`  - ${r.roomPath} [${r.version === 0 ? '空档→v2索引' : 'v1→分片'}] (${(r.bytes / 1024).toFixed(0)}KB, ${r.nodeCount} 节点 / ${r.edgeCount} 边)`))
  if (pending.length > 20) console.log(`  ... 另有 ${pending.length - 20} 个`)
} else {
  if (pending.length === 0) {
    console.log('没有待迁移房间，退出。')
  } else {
    fs.mkdirSync(backupDir, { recursive: true })
    console.log(`备份目录: ${backupDir}`)
    let migrated = 0
    let failed = 0
    let quarantined = 0
    // 上一次迁移失败会留下「索引已恢复成 v1、但 _graph/ 分片还在」的房间。
    // 直接覆盖会丢未知数据，永久拒绝又会让房间再也迁不了 —— 统一移到备份区留证据。
    // 真实事故：首轮校验用严格边数组顺序，6 个多边房间误报失败并留下 148 个残留分片。
    const quarantineShards = (rel: string, shardDir: string) => {
      if (!fs.existsSync(shardDir)) return
      quarantined += 1
      const dest = path.join(backupDir, '_shards_quarantine', String(quarantined), rel, '_graph')
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(shardDir, dest)
      console.log(`  ↳ 残留分片已隔离到备份区: ${dest}`)
    }
    for (const room of pending) {
      const rel = room.roomPath === '(root)' ? '' : room.roomPath
      const backupFile = path.join(backupDir, rel, '_graph.json')
      const shardDir = path.join(path.dirname(room.graphFile), '_graph')
      let backupCreated = false
      try {
        // TOCTOU：应用可能仍在运行并保存房间。扫描后 _graph.json 被改动过就绝不覆盖，
        // 也不隔离分片、不备份，直接报错让本房间留在原状态，等下一轮重新扫描。
        const currentHash = crypto.createHash('sha256').update(fs.readFileSync(room.graphFile)).digest('hex')
        if (currentHash !== room.contentHash) {
          throw new Error('扫描后 _graph.json 已被其它进程改动，跳过本房间（请重新扫描）')
        }
        quarantineShards(rel, shardDir)
        fs.mkdirSync(path.dirname(backupFile), { recursive: true })
        fs.copyFileSync(room.graphFile, backupFile)
        backupCreated = true
        const changed = store.migrateRoom(workDir, rel) as boolean
        if (!changed) throw new Error('detectVersion 判定为需升级但 migrateRoom 未执行')
        migrated += 1
        console.log(`  ✓ ${room.roomPath} (${(room.bytes / 1024).toFixed(0)}KB → ${room.version === 0 ? 'v2 索引' : 'v2 分片'})`)
      } catch (e) {
        failed += 1
        console.error(`  ✗ ${room.roomPath}: ${(e as Error).message}`)
        // 只有真正写过盘才回滚。TOCTOU 提前中止时不能动分片目录，
        // 否则会把「别的进程刚写的新数据」的分片误隔离走。
        if (backupCreated) {
          if (fs.existsSync(backupFile)) fs.copyFileSync(backupFile, room.graphFile)
          try { quarantineShards(rel, shardDir) } catch (q) {
            console.error(`  ! 残留分片隔离失败，需人工处理: ${(q as Error).message}`)
          }
        }
      }
    }
    console.log(`迁移完成: 成功 ${migrated}，失败 ${failed}，隔离残留分片 ${quarantined}。备份: ${backupDir}`)
    if (failed > 0) process.exit(1)
  }
}

if (reportPath) {
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true })
  fs.writeFileSync(path.resolve(reportPath), JSON.stringify({ kbRoot, backupDir, rooms }, null, 2), 'utf-8')
  console.log(`清单已写入: ${path.resolve(reportPath)}`)
}
