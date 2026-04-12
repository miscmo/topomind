import { normalizeMeta } from '../src/core/meta.js'
import { unwrapGitResult } from '../src/core/git-result.js'

const INVALID_NAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/
function ensureValidName(name, label = '名称') {
  const normalized = String(name || '').trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  if (INVALID_NAME_CHARS.test(normalized)) {
    throw new Error(`${label}包含非法字符`)
  }
  if (normalized === '.' || normalized === '..') {
    throw new Error(`${label}不合法`)
  }
  return normalized
}

function assert(name, condition) {
  if (!condition) throw new Error(`❌ ${name}`)
  console.log(`✅ ${name}`)
}

function testNormalizeMeta() {
  const n1 = normalizeMeta(null)
  assert('normalizeMeta(null) children object', typeof n1.children === 'object' && !Array.isArray(n1.children))
  assert('normalizeMeta(null) edges array', Array.isArray(n1.edges))

  const n2 = normalizeMeta({
    name: 123,
    children: [],
    edges: {},
    zoom: '1',
    pan: { x: '1', y: 2 },
    canvasBounds: 'bad',
  })
  assert('normalizeMeta invalid name -> empty string', n2.name === '')
  assert('normalizeMeta invalid children -> {}', typeof n2.children === 'object' && !Array.isArray(n2.children))
  assert('normalizeMeta invalid edges -> []', Array.isArray(n2.edges) && n2.edges.length === 0)
  assert('normalizeMeta invalid zoom -> null', n2.zoom === null)
  assert('normalizeMeta invalid pan -> null', n2.pan === null)
}

function testUnwrapGitResult() {
  const files = unwrapGitResult({ ok: true, files: [{ path: 'a.md' }] }, { dataKey: 'files', fallback: [] })
  assert('unwrapGitResult dataKey files', Array.isArray(files) && files.length === 1)

  let thrown = false
  try {
    unwrapGitResult({ ok: false, error: 'boom' }, { requireOk: true, errorMessage: 'x' })
  } catch (e) {
    thrown = e.message.includes('boom')
  }
  assert('unwrapGitResult requireOk throws', thrown)
}

function testNameValidation() {
  let thrown = false
  try { ensureValidName('') } catch (e) { thrown = true }
  assert('ensureValidName empty throws', thrown)

  thrown = false
  try { ensureValidName('a/b') } catch (e) { thrown = true }
  assert('ensureValidName slash throws', thrown)

  thrown = false
  try { ensureValidName('..') } catch (e) { thrown = true }
  assert('ensureValidName dotdot throws', thrown)

  assert('ensureValidName ok', ensureValidName('NodeA') === 'NodeA')
}

function testGitResultMapping() {
  const files = unwrapGitResult({ ok: true, files: [{ path: 'a.md', insertions: 1, deletions: 0 }] }, { dataKey: 'files', fallback: [] })
  assert('unwrapGitResult files path', files[0].path === 'a.md')

  const commits = unwrapGitResult({ ok: true, commits: [{ hash: 'abc' }] }, { dataKey: 'commits', fallback: [] })
  assert('unwrapGitResult commits', commits.length === 1)
}

function run() {
  console.log('Running TopoMind lightweight tests...')
  testNormalizeMeta()
  testUnwrapGitResult()
  testNameValidation()
  testGitResultMapping()
  console.log('All tests passed.')
}

run()
