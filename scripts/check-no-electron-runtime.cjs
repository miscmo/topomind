const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')

const scanTargets = [
  'apps/web/src',
  'apps/web/package.json',
  'package.json',
]

const keywords = [
  'electron',
  'electronAPI',
  'ipcRenderer',
  'ipcMain',
  'BrowserWindow',
  'app:window',
  'fs:',
  'localdb:',
]

const whitelist = new Set([
  'apps/web/src/vite-env.d.ts',
  'apps/web/src/core/close-guard.ts',
  'apps/web/src/types/electron-api.ts',
  'apps/web/src/core/app-backend.ts',
  'apps/web/src/core/app-flow.ts',
  'apps/web/src/core/attachment-debug-backend.ts',
  'apps/web/src/core/attachment-upload-ticket.ts',
  'apps/web/src/core/cloud-api.ts',
  'apps/web/src/core/cloud-attachment-cache.ts',
  'apps/web/src/core/cloud-session-backend.ts',
  'apps/web/src/core/file-cache-backend.ts',
  'apps/web/src/core/fs-backend.ts',
  'apps/web/src/core/import-debug-backend.ts',
  'apps/web/src/core/localdb-backend.ts',
  'apps/web/src/core/localdb-graph.ts',
  'apps/web/src/core/log-backend.ts',
  'apps/web/src/core/platform.ts',
  'apps/web/src/core/sync-debug-backend.ts',
  'apps/web/src/features/documents/services/documentEditorRegistry.tsx',
  'apps/web/src/features/documents/SmartDocumentEditor/components/CustomCodeBlock.tsx',
  'apps/web/src/features/documents/components/Layout/AttachmentsTab.tsx',
  'apps/web/src/features/kb/HomePage.tsx',
  'apps/web/src/features/kb/model/useHomeImportJobs.ts',
  'apps/web/src/features/kb/model/useHomeKnowledgeBases.ts',
  'apps/web/src/features/layout/CustomTitleBar/CustomTitleBar.tsx',
  'apps/web/src/features/learning-tracker/LearningTrackerProvider.tsx',
  'apps/web/src/features/monitor/model/monitorStore.ts',
  'apps/web/src/features/monitor/MonitorPage.tsx',
  'apps/web/src/features/right-panel/model/useDetailDocuments.ts',
  'apps/web/src/shared/ui/ConfirmModal/ConfirmModal.tsx',
  'apps/web/src/shared/ui/ConfirmModal/confirmStore.ts',
  'apps/web/src/shared/ui/PromptModal/PromptModal.tsx',
])

const keywordPatterns = [
  { label: 'electron', regex: /\belectron\b/i },
  { label: 'electronAPI', regex: /\belectronAPI\b/i },
  { label: 'ipcRenderer', regex: /\bipcRenderer\b/i },
  { label: 'ipcMain', regex: /\bipcMain\b/i },
  { label: 'BrowserWindow', regex: /\bBrowserWindow\b/i },
  { label: 'app:window', regex: /app:window/i },
  { label: 'fs:', regex: /\bfs:/i },
  { label: 'localdb:', regex: /\blocaldb:/i },
]

const combinedKeywordRegex = new RegExp(
  `(${keywordPatterns.map((entry) => entry.regex.source).join('|')})`,
  'ig',
)

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toPosixPath(input) {
  return input.split(path.sep).join('/')
}

function walkFiles(targetPath) {
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) {
    return [targetPath]
  }

  const files = []
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
      continue
    }
    if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function collectMatches(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const matches = []

  lines.forEach((line, index) => {
    combinedKeywordRegex.lastIndex = 0
    const foundKeywords = new Set()
    let match = combinedKeywordRegex.exec(line)
    while (match) {
      const normalizedKeyword = keywordPatterns.find((entry) => entry.regex.test(match[0]))
      foundKeywords.add(normalizedKeyword ? normalizedKeyword.label : match[0])
      match = combinedKeywordRegex.exec(line)
    }

    if (foundKeywords.size === 0) {
      return
    }

    matches.push({
      lineNumber: index + 1,
      keywords: Array.from(foundKeywords).sort((a, b) => a.localeCompare(b)),
      text: line.trim(),
    })
  })

  return matches
}

function main() {
  const files = scanTargets.flatMap((target) => {
    const absoluteTarget = path.join(repoRoot, target)
    if (!fs.existsSync(absoluteTarget)) {
      throw new Error(`Scan target does not exist: ${target}`)
    }
    return walkFiles(absoluteTarget)
  })

  const matchedFiles = []
  for (const absoluteFilePath of files) {
    const relativeFilePath = toPosixPath(path.relative(repoRoot, absoluteFilePath))
    const matches = collectMatches(absoluteFilePath)
    if (matches.length === 0) {
      continue
    }

    matchedFiles.push({
      filePath: relativeFilePath,
      matches,
      whitelisted: whitelist.has(relativeFilePath),
    })
  }

  const whitelistedFiles = matchedFiles.filter((entry) => entry.whitelisted)
  const violations = matchedFiles.filter((entry) => !entry.whitelisted)

  console.log('Electron runtime guard scan')
  console.log(`Scanned targets: ${scanTargets.join(', ')}`)
  console.log(`Keyword set: ${keywords.join(', ')}`)
  console.log(`Scanned files: ${files.length}`)
  console.log(`Matched files: ${matchedFiles.length}`)
  console.log('')

  console.log(`Whitelisted legacy files: ${whitelistedFiles.length}`)
  for (const entry of whitelistedFiles) {
    console.log(`  - ${entry.filePath}`)
  }
  console.log('')

  if (violations.length === 0) {
    console.log('Violations: 0')
    console.log('Result: PASS (only explicit whitelist entries matched)')
    process.exit(0)
  }

  console.log(`Violations: ${violations.length}`)
  for (const entry of violations) {
    console.log(`  - ${entry.filePath}`)
    for (const match of entry.matches) {
      console.log(
        `      L${String(match.lineNumber).padStart(4, ' ')} [${match.keywords.join(', ')}] ${match.text}`,
      )
    }
  }

  console.log('Result: FAIL (new Electron runtime references detected outside whitelist)')
  process.exit(1)
}

main()
