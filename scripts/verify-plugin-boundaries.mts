import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validatePluginManifest } from '../src/plugins/host/pluginManifest.ts'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..')
const builtinRoot = path.resolve(repoRoot, 'src/plugins/builtin')
const officialRoot = path.resolve(repoRoot, 'src/plugins/official')
const publicRoot = path.resolve(repoRoot, 'src/plugins/public')
const extensionPointsRoot = path.resolve(repoRoot, 'src/plugins/extension-points')
const sharedRoot = path.resolve(repoRoot, 'src/shared')
const ALLOWED_SHARED_DOMAINS = ['observability', 'ui', 'utils'] as const

const FORBIDDEN_ALIAS_PREFIXES = [
  '@/core/',
  '@/stores/',
  '@/features/',
  '@/application/',
  '@/plugins/host/',
  '@/plugins/bootstrap',
  '@/plugins/secondaryViews',
] as const

const ALLOWED_PLUGIN_SHARED_ALIAS_PREFIXES = ALLOWED_SHARED_DOMAINS.map((domain) => `@/shared/${domain}`) as readonly string[]

const FORBIDDEN_SHARED_ALIAS_PREFIXES = [
  '@/core/',
  '@/stores/',
  '@/features/',
  '@/application/',
  '@/plugins/',
] as const

const FORBIDDEN_GLOBAL_PATTERNS = [
  /window\s*\.\s*electronAPI/g,
] as const

const OFFICIAL_LEGACY_BOUNDARY_BASELINE = new Set<string>()

async function listDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name))
}

async function listSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name)
      if (entry.isDirectory()) {
        return listSourceFiles(fullPath)
      }

      return /\.(ts|tsx|mts|cts)$/.test(entry.name) ? [fullPath] : []
    }),
  )

  return files.flat()
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/')
}

function toRepoRelative(value: string): string {
  return normalizePath(path.relative(repoRoot, value))
}

function isInsideDirectory(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
}

function collectImportSpecifiers(source: string): string[] {
  const matches = new Set<string>()
  const patterns = [
    /import\s+(?:type\s+)?(?:[\w*\s{},]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+(?:type\s+)?(?:[\w*\s{},]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier) {
        matches.add(specifier)
      }
    }
  }

  return [...matches]
}

function getBuiltinPluginName(pluginDir: string): string {
  return path.basename(pluginDir)
}

function matchesAllowedSharedAlias(specifier: string): boolean {
  return ALLOWED_PLUGIN_SHARED_ALIAS_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))
}

function checkSpecifier(
  pluginDir: string,
  sourceFile: string,
  specifier: string,
): string | null {
  if (specifier === '@/plugins' || specifier.startsWith('@/plugins/public/') || specifier.startsWith('@/plugins/extension-points/')) {
    return null
  }

  if (specifier.startsWith('@/shared/')) {
    if (matchesAllowedSharedAlias(specifier)) {
      return null
    }
    return `shared import outside whitelist "${specifier}" in ${normalizePath(sourceFile)}`
  }

  if (FORBIDDEN_ALIAS_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
    return `forbidden import "${specifier}" in ${normalizePath(sourceFile)}`
  }

  if (specifier.startsWith('@/plugins/builtin/')) {
    const targetPluginName = specifier.slice('@/plugins/builtin/'.length).split('/')[0]
    if (targetPluginName && targetPluginName !== getBuiltinPluginName(pluginDir)) {
      return `cross-plugin import "${specifier}" in ${normalizePath(sourceFile)}`
    }
  }

  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
    return null
  }

  if (specifier.startsWith('@/')) {
    return null
  }

  const resolved = path.resolve(path.dirname(sourceFile), specifier)
  if (isInsideDirectory(resolved, pluginDir)) {
    return null
  }

  if (isInsideDirectory(resolved, publicRoot) || isInsideDirectory(resolved, extensionPointsRoot)) {
    return null
  }

  return `relative import escapes plugin boundary: "${specifier}" in ${normalizePath(sourceFile)}`
}

function checkSharedSpecifier(sourceFile: string, specifier: string): string | null {
  if (FORBIDDEN_SHARED_ALIAS_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
    return `forbidden shared import "${specifier}" in ${normalizePath(sourceFile)}`
  }

  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
    return null
  }

  if (specifier.startsWith('@/')) {
    if (specifier === '@/shared' || specifier.startsWith('@/shared/')) {
      return null
    }
    return `shared import escapes whitelist: "${specifier}" in ${normalizePath(sourceFile)}`
  }

  const resolved = path.resolve(path.dirname(sourceFile), specifier)
  if (isInsideDirectory(resolved, sharedRoot)) {
    return null
  }

  return `relative import escapes shared boundary: "${specifier}" in ${normalizePath(sourceFile)}`
}

function checkSharedFilePlacement(sourceFile: string): string | null {
  const relativePath = normalizePath(path.relative(sharedRoot, sourceFile))
  const topLevelDomain = relativePath.split('/')[0]
  if (ALLOWED_SHARED_DOMAINS.includes(topLevelDomain as (typeof ALLOWED_SHARED_DOMAINS)[number])) {
    return null
  }
  return `shared file outside whitelist domain "${relativePath}" in ${normalizePath(sourceFile)}`
}

async function verifyPlugin(pluginDir: string): Promise<string[]> {
  const violations: string[] = []
  const manifestPath = path.join(pluginDir, 'manifest.json')
  const manifestExists = await stat(manifestPath).then(() => true).catch(() => false)
  if (!manifestExists) {
    return [`missing manifest.json in ${normalizePath(pluginDir)}`]
  }

  const manifestData = JSON.parse(await readFile(manifestPath, 'utf8'))
  const manifest = validatePluginManifest(manifestData)
  const entryPath = path.resolve(pluginDir, manifest.entry)
  const entryExists = await stat(entryPath).then(() => true).catch(() => false)
  assert.equal(entryExists, true, `missing plugin entry: ${normalizePath(entryPath)}`)

  const sourceFiles = await listSourceFiles(pluginDir)
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8')

    for (const pattern of FORBIDDEN_GLOBAL_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`forbidden global access in ${normalizePath(sourceFile)}: ${pattern}`)
      }
    }

    for (const specifier of collectImportSpecifiers(source)) {
      const violation = checkSpecifier(pluginDir, sourceFile, specifier)
      if (violation) {
        violations.push(violation)
      }
    }
  }

  return violations
}

async function verifyOfficialModules(): Promise<{ violations: string[]; baselineHits: string[] }> {
  const sourceFiles = await listSourceFiles(officialRoot)
  const violations: string[] = []
  const baselineHits = new Set<string>()

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8')

    for (const pattern of FORBIDDEN_GLOBAL_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`forbidden global access in ${normalizePath(sourceFile)}: ${pattern}`)
      }
    }

    for (const specifier of collectImportSpecifiers(source)) {
      const violation = checkSpecifier(officialRoot, sourceFile, specifier)
      if (!violation) {
        continue
      }

      const baselineKey = `${toRepoRelative(sourceFile)}::${specifier}`
      if (OFFICIAL_LEGACY_BOUNDARY_BASELINE.has(baselineKey) && violation.startsWith('forbidden import ')) {
        baselineHits.add(baselineKey)
        continue
      }

      violations.push(violation)
    }
  }

  return { violations, baselineHits: [...baselineHits] }
}

async function verifyShared(): Promise<string[]> {
  const sourceFiles = await listSourceFiles(sharedRoot)
  const violations: string[] = []

  for (const sourceFile of sourceFiles) {
    const placementViolation = checkSharedFilePlacement(sourceFile)
    if (placementViolation) {
      violations.push(placementViolation)
    }

    const source = await readFile(sourceFile, 'utf8')

    for (const pattern of FORBIDDEN_GLOBAL_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`forbidden global access in ${normalizePath(sourceFile)}: ${pattern}`)
      }
    }

    for (const specifier of collectImportSpecifiers(source)) {
      const violation = checkSharedSpecifier(sourceFile, specifier)
      if (violation) {
        violations.push(violation)
      }
    }
  }

  return violations
}

const pluginDirs = await listDirectories(builtinRoot)
const builtinViolations = (await Promise.all(pluginDirs.map((pluginDir) => verifyPlugin(pluginDir)))).flat()
const { violations: officialViolations, baselineHits } = await verifyOfficialModules()
const sharedViolations = await verifyShared()
const violations = [...builtinViolations, ...officialViolations, ...sharedViolations]

if (violations.length > 0) {
  console.error('Plugin boundary verification failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

const staleOfficialBaseline = [...OFFICIAL_LEGACY_BOUNDARY_BASELINE].filter((entry) => !baselineHits.includes(entry))
if (baselineHits.length > 0) {
  console.log(`Known official boundary debt baseline: ${baselineHits.join(', ')}`)
}
if (staleOfficialBaseline.length > 0) {
  console.log(`Stale official boundary baseline entries: ${staleOfficialBaseline.join(', ')}`)
}

console.log(`Plugin boundaries verified: ${pluginDirs.map((pluginDir) => path.basename(pluginDir)).join(', ')}, official, shared`)
