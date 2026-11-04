/**
 * 把智能文档里内联的 data:image base64 图片外置成卡片 `_attach` 附件。
 *
 * 默认 dry-run：只读扫描、打印清单，不写任何文件。
 *   node --experimental-strip-types scripts/migrate-inline-images.mts
 * 真正落盘（写前自动整篇备份原文档）：
 *   node --experimental-strip-types scripts/migrate-inline-images.mts --apply
 *
 * 可选参数：
 *   --root <path>        知识库根目录，默认取 TOPOMIND_KB_ROOT 或 D:/Document/NoteBook/kbs
 *   --report <path>      把完整清单写到该文件（dry-run 也会写，方便审阅）
 *   --limit <n>          只处理前 n 篇「尚待迁移」的文档；分批执行时每批都取剩余的前 n 篇
 *   --backup-dir <path>  指定备份目录（分批执行时共用，避免每次生成新的时间戳目录）
 *
 * 背景：旧版编辑器把图片整段 base64 写进 .tdoc.json，全库 55 篇、252 张、
 * 解码后约 55MB，最大单篇 22.6MB。现在的 buildSmartDocumentPersistedValue
 * 只认 attachmentRef，不会自动外置历史数据；打开时 JSON.parse / stringify
 * 与保存 IPC 都要全量搬运这段文本，编辑会明显卡顿。
 *
 * 落盘后的块结构与新插入图片一致：
 *   props: { ..., name: 'inline-<hash>.png', attachmentRef: '_attach/inline-<hash>.png' }
 * 并把 url 删掉（运行时由 documentEditorRegistry 补回）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const argValue = (flag: string): string | null => {
  const index = args.indexOf(flag)
  return index >= 0 ? (args[index + 1] ?? null) : null
}
const kbRoot = argValue('--root') || process.env.TOPOMIND_KB_ROOT || 'D:/Document/NoteBook/kbs'
const reportPath = argValue('--report')
const limitArg = argValue('--limit')
const limit = limitArg ? Math.max(1, Number(limitArg) || 1) : Number.POSITIVE_INFINITY
const customBackupDir = argValue('--backup-dir')
const backupDir = customBackupDir
  ? path.resolve(customBackupDir)
  : path.join(
      path.dirname(kbRoot),
      `_topomind_backup_inline_${new Date().toISOString().replace(/[:.]/g, '-')}`,
    )

const DATA_URL = /^data:image\/([^;,]+);base64,([\s\S]+)$/i
const EXTENSIONS: Record<string, string> = {
  png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp',
  bmp: 'bmp', 'svg+xml': 'svg', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico',
}

interface BlockNode {
  props?: Record<string, unknown>
  children?: BlockNode[]
  [key: string]: unknown
}

interface PlannedImage {
  block: BlockNode
  props: Record<string, unknown>
  fileName: string
  attachmentRef: string
  binary: Buffer
}

function walkBlocks(blocks: BlockNode[], visit: (block: BlockNode) => void): void {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    visit(block)
    if (Array.isArray(block.children)) walkBlocks(block.children, visit)
  }
}

function collectDocuments(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) walk(full)
      } else if (entry.name.endsWith('.tdoc.json')) {
        found.push(full)
      }
    }
  }
  walk(root)
  return found.sort()
}

/** 文档位于 <card>/_docs/ 下，附件目录是 <card>/_attach/ */
function resolveCardDir(docPath: string): string {
  const docsDir = path.dirname(docPath)
  return path.basename(docsDir) === '_docs' ? path.dirname(docsDir) : docsDir
}

function planDocument(doc: { blocks?: BlockNode[] }): PlannedImage[] {
  const plan: PlannedImage[] = []
  if (!Array.isArray(doc.blocks)) return plan
  walkBlocks(doc.blocks, (block) => {
    const props = block.props
    if (!props || typeof props !== 'object') return
    const url = typeof props.url === 'string' ? props.url : ''
    const match = DATA_URL.exec(url)
    if (!match) return
    const mime = match[1].toLowerCase()
    const extension = EXTENSIONS[mime] || mime.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'png'
    const binary = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
    if (binary.length === 0) throw new Error('图片 base64 解码后为空')
    // 内容 hash 命名：同一卡片内相同图片可复用，重复执行也幂等
    const fileName = `inline-${crypto.createHash('sha256').update(binary).digest('hex').slice(0, 16)}.${extension}`
    plan.push({
      block,
      props,
      fileName,
      attachmentRef: `_attach/${fileName}`,
      binary,
    })
  })
  return plan
}

function verifyMigration(docPath: string, cardDir: string, plan: PlannedImage[]): number {
  const raw = fs.readFileSync(docPath, 'utf8')
  if (/data:image\/[^;]+;base64,/.test(raw)) throw new Error('仍有内联 base64 残留')
  const doc = JSON.parse(raw) as { blocks?: BlockNode[] }
  let refs = 0
  if (Array.isArray(doc.blocks)) {
    walkBlocks(doc.blocks, (block) => {
      if (typeof block.props?.attachmentRef === 'string') refs += 1
    })
  }
  if (refs < plan.length) throw new Error(`attachmentRef 数量不足：${refs} < ${plan.length}`)
  for (const item of plan) {
    const target = path.join(cardDir, item.attachmentRef)
    if (!fs.existsSync(target)) throw new Error(`附件缺失：${target}`)
    if (fs.readFileSync(target).length !== item.binary.length) {
      throw new Error(`附件字节数不符：${target}`)
    }
  }
  return Buffer.byteLength(raw)
}

const documents = collectDocuments(kbRoot)
const rows: string[] = []
const targets: Array<{ docPath: string; raw: string; nextRaw: string; cardDir: string; plan: PlannedImage[] }> = []
let totalImages = 0
let beforeBytes = 0
let afterBytes = 0
let newAttachments = 0
const seenAttachments = new Set<string>()

for (const docPath of documents) {
  if (targets.length >= limit) break
  let raw: string
  let doc: { blocks?: BlockNode[] }
  try {
    raw = fs.readFileSync(docPath, 'utf8')
    doc = JSON.parse(raw) as { blocks?: BlockNode[] }
  } catch (error) {
    rows.push(`SKIP 解析失败 ${path.relative(kbRoot, docPath)}: ${String(error)}`)
    continue
  }
  let plan: PlannedImage[]
  try {
    plan = planDocument(doc)
  } catch (error) {
    rows.push(`SKIP 图片解码失败 ${path.relative(kbRoot, docPath)}: ${String(error)}`)
    continue
  }
  if (plan.length === 0) continue

  const cardDir = resolveCardDir(docPath)
  for (const item of plan) {
    const nextProps: Record<string, unknown> = {
      ...item.props,
      name: item.fileName,
      attachmentRef: item.attachmentRef,
    }
    delete nextProps.url
    item.block.props = nextProps
    const key = path.join(cardDir, item.attachmentRef)
    if (!seenAttachments.has(key)) {
      seenAttachments.add(key)
      newAttachments += 1
    }
  }
  const nextRaw = JSON.stringify(doc, null, 2)
  const before = Buffer.byteLength(raw)
  const after = Buffer.byteLength(nextRaw)
  totalImages += plan.length
  beforeBytes += before
  afterBytes += after
  targets.push({ docPath, raw, nextRaw, cardDir, plan })
  rows.push(
    `${path.relative(kbRoot, docPath)}\t${plan.length}张\t` +
    `${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB\t` +
    `减少 ${((before - after) / 1048576).toFixed(2)}MB`,
  )
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(2)
const summary = [
  `模式：${apply ? 'APPLY（会写文件）' : 'DRY-RUN（只读，未写任何文件）'}`,
  `知识库：${kbRoot}`,
  `扫描文档：${documents.length} 篇`,
  `待迁移：${targets.length} 篇 / ${totalImages} 张内联图片`,
  `文档体积：${mb(beforeBytes)}MB → ${mb(afterBytes)}MB（减少 ${mb(beforeBytes - afterBytes)}MB，${beforeBytes > 0 ? ((1 - afterBytes / beforeBytes) * 100).toFixed(1) : '0.0'}%）`,
  `将新增附件：${newAttachments} 个文件，合计 ${mb(targets.reduce((sum, t) => sum + t.plan.reduce((s, i) => s + i.binary.length, 0), 0))}MB（按内容去重后）`,
  apply ? `备份目录：${backupDir}` : `备份目录（执行 --apply 时生成）：与知识库同级`,
  '',
  '文档清单（相对知识库根目录）：',
  ...rows,
].join('\n')

console.log(summary)
if (reportPath) {
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true })
  fs.writeFileSync(reportPath, `${summary}\n`, 'utf8')
  console.log(`\n清单已写入：${path.resolve(reportPath)}`)
}

if (!apply) {
  console.log('\n这是 dry-run。确认无误后加 --apply 才会落盘；落盘前会逐篇备份原文档。')
  process.exit(0)
}

// ---- 以下才真正写文件 ----
let migrated = 0
for (const target of targets) {
  try {
    const relative = path.relative(kbRoot, target.docPath)
    const backupFile = path.join(backupDir, relative)
    fs.mkdirSync(path.dirname(backupFile), { recursive: true })
    fs.copyFileSync(target.docPath, backupFile)

    fs.mkdirSync(path.join(target.cardDir, '_attach'), { recursive: true })
    for (const item of target.plan) {
      const attachmentFile = path.join(target.cardDir, item.attachmentRef)
      if (!fs.existsSync(attachmentFile)) fs.writeFileSync(attachmentFile, item.binary)
    }
    fs.writeFileSync(target.docPath, target.nextRaw, 'utf8')
    verifyMigration(target.docPath, target.cardDir, target.plan)
    migrated += 1
    if (migrated % 10 === 0) console.log(`  已迁移 ${migrated}/${targets.length} 篇`)
  } catch (error) {
    console.error(`\n迁移中断于 ${path.relative(kbRoot, target.docPath)}：${String(error)}`)
    console.error(`已成功迁移 ${migrated} 篇，原文档备份在 ${backupDir}`)
    process.exit(1)
  }
}
console.log(`\n完成：${migrated} 篇文档已迁移并逐篇校验通过，备份位于 ${backupDir}`)
