/**
 * AI Agent 契约门禁（S1-1 / S1-2 / S1-3 + P1 AgentPatch 三段）。
 *
 * 手动运行：node --experimental-strip-types --experimental-specifier-resolution=node \
 *   ./scripts/verify-ai-agent-contracts.mts
 *
 * 与 verify-critical 的 loadBundle 同口径：用 esbuild 把契约模块打包成 data URL
 * 后在 Node 里真跑，而不是只做源码文本匹配。检查内容：
 *  1. toolCatalog 与 docs/design/native-ai-agent-design.md §6.1 表格双向一致；
 *  2. 目录字段完整、never 组不可分配、无运行时能力；
 *  3. agentTypes 不含 baseURL / apiKeyRef（决策 9 的类型层封死）；
 *  4. renderPrompt 白名单 / 未命中降级 / 禁表达式 / 值不被二次求值 真跑；
 *  5. buildRequestBody 供应商能力位与 normalizeMessages 单 system 真跑；
 *  6. normalizeAgentPatch 校验闸 / dryRunAgentPatch 零副作用 / commitAgentPatch 事务真跑。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const { build } = await import('esbuild')

async function loadBundle(relativePath: string): Promise<Record<string, unknown>> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  ) as Promise<Record<string, unknown>>
}

const readText = (relativePath: string) => readFile(new URL(relativePath, import.meta.url), 'utf8')
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')

let checks = 0
const check = (label: string, fn: () => void) => {
  fn()
  checks += 1
  console.log(`  ok  ${label}`)
}

// ---------------------------------------------------------------------------
// 1) 解析 §6.1 表格：第一列里的每个反引号 id 都是一条工具，按 `/` 展开合并行。
// ---------------------------------------------------------------------------
const designDoc = await readText('../docs/design/native-ai-agent-design.md')
const sectionStart = designDoc.indexOf('### 6.1 工具清单')
const sectionEnd = designDoc.indexOf('### 6.2', sectionStart)
assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, '设计文档缺少 §6.1 工具清单')
const section = designDoc.slice(sectionStart, sectionEnd)
const tableRows = section.split('\n').filter((line) => line.trim().startsWith('|')).slice(2)
const docIds: string[] = []
for (const row of tableRows) {
  const firstCell = row.split('|')[1] ?? ''
  for (const match of firstCell.matchAll(/`([^`]+)`/g)) {
    for (const part of match[1].split('/')) {
      const id = part.trim()
      if (id) docIds.push(id)
    }
  }
}

const catalogModule = await loadBundle('../src/features/ai-agent/config/toolCatalog.ts')
const catalog = catalogModule.TOOL_CATALOG as Array<{
  id: string
  kind: string
  permission: string
  params: unknown[]
  output: string
  source: string
  status: string
}>
const catalogIds = catalog.map((entry) => entry.id)

check('§6.1 表格解析出 20 个工具 id', () => {
  assert.equal(docIds.length, 20, `实际解析到 ${docIds.length} 个：${docIds.join(', ')}`)
})
check('目录与 §6.1 双向一致（无遗漏 / 无多余 / 无重复）', () => {
  assert.deepEqual([...catalogIds].sort(), [...docIds].sort())
  assert.equal(new Set(catalogIds).size, catalogIds.length)
  assert.equal(catalogIds.length, 20)
})
check('每条目录项字段完整且为纯静态数据', () => {
  for (const entry of catalog) {
    assert.ok(entry.id && /^[a-z][a-zA-Z0-9._]*$/.test(entry.id), `非法 id: ${entry.id}`)
    assert.ok(entry.kind === 'read' || entry.kind === 'write', `${entry.id} kind 非法`)
    assert.ok(['read-only', 'suggest', 'never'].includes(entry.permission), `${entry.id} 权限档非法`)
    assert.ok(Array.isArray(entry.params), `${entry.id} params 必须是数组`)
    assert.ok(entry.output && entry.output.length > 0, `${entry.id} 缺少输出说明`)
    assert.equal(entry.source, 'builtin', `${entry.id} 来源必须是 builtin`)
    assert.ok(['not-wired', 'wired', 'never'].includes(entry.status), `${entry.id} status 非法`)
  }
})
check('P3 目录状态：17 条 wired + 0 条 not-wired + 3 条 never', () => {
  assert.equal(catalog.filter((e) => e.status === 'wired').length, 17)
  assert.deepEqual(catalog.filter((e) => e.status === 'not-wired').map((e) => e.id), [])
  const neverIds = catalog.filter((e) => e.status === 'never').map((e) => e.id).sort()
  assert.deepEqual(neverIds, ['document.clear', 'node.delete', 'node.move_room'])
  assert.equal(catalog.filter((e) => e.permission === 'never').length, 3)
})
check('破坏性工具不可分配给 Agent', () => {
  const isAssignable = catalogModule.isAssignableToolId as (id: unknown) => boolean
  assert.equal(isAssignable('node.delete'), false)
  assert.equal(isAssignable('document.clear'), false)
  assert.equal(isAssignable('document.read'), true)
  assert.equal(isAssignable('not.a.tool'), false)
  assert.equal(isAssignable(undefined), false)
})
// 目录源码的静态检查（不进 bundle，直接读源码）
const catalogSource = stripComments(await readText('../src/features/ai-agent/config/toolCatalog.ts'))
check('目录源码不含网络 / IPC / 动态求值', () => {
  assert.ok(!catalogSource.includes('fetch('))
  assert.ok(!catalogSource.includes('electronAPI'))
  assert.ok(!/\beval\s*\(/.test(catalogSource))
  assert.ok(!catalogSource.includes('new Function'))
})

// ---------------------------------------------------------------------------
// 2) agentTypes 契约
// ---------------------------------------------------------------------------
const typesModule = await loadBundle('../src/features/ai-agent/config/agentTypes.ts')
const typesSource = stripComments(await readText('../src/features/ai-agent/config/agentTypes.ts'))

check('Agent 定义不含连接配置（决策 9）', () => {
  assert.ok(!typesSource.includes('baseURL'), 'AgentDefinition 不得声明 baseURL')
  assert.ok(!typesSource.includes('apiKeyRef'), 'AgentDefinition 不得声明 apiKeyRef')
  assert.ok(!typesSource.includes('[key: string]'), 'AgentDefinition 不得使用索引签名')
})
check('版本 / 枚举 / 约束常量符合 §15.8', () => {
  assert.equal(typesModule.AGENT_DEFINITION_VERSION, 1)
  assert.equal(typesModule.AGENT_CONFIG_VERSION, 1)
  assert.equal(typesModule.AGENT_DEFINITION_SCHEMA, 'topomind.agent-definition')
  const limits = typesModule.AGENT_LIMITS as Record<string, number>
  assert.equal(limits.systemPromptMax, 8000)
  assert.equal(limits.maxAgents, 50)
  const vars = typesModule.PROMPT_VAR_IDS as string[]
  assert.equal(vars.length, 9)
  assert.equal(new Set(vars).size, 9)
  const protocols = typesModule.REASONING_PROTOCOLS as string[]
  assert.equal(protocols.length, 7)
})
check('白名单枚举判定函数', () => {
  const isVar = typesModule.isPromptVarId as (v: unknown) => boolean
  const isMode = typesModule.isReasoningMode as (v: unknown) => boolean
  assert.equal(isVar('nodeTitle'), true)
  assert.equal(isVar('__proto__'), false)
  assert.equal(isVar(null), false)
  assert.equal(isMode('auto'), true)
  assert.equal(isMode('sometimes'), false)
})

// ---------------------------------------------------------------------------
// 3) renderPrompt 真跑
// ---------------------------------------------------------------------------
const promptModule = await loadBundle('../src/features/ai-agent/config/renderPrompt.ts')
const renderPrompt = promptModule.renderPrompt as (
  template: string, values: Record<string, string>, declared?: string[],
) => { prompt: string; missingVars: string[]; declaredVars: string[] }
const validate = promptModule.validatePromptTemplate as (
  template: string, declared: string[],
) => { ok: boolean; invalid: string[]; undeclared: string[] }

check('白名单变量正常替换', () => {
  const result = renderPrompt(
    '节点 {{nodeTitle}} 位于 {{roomPath}}',
    { nodeTitle: '知识图谱', roomPath: '根目录/A' },
    ['nodeTitle', 'roomPath'],
  )
  assert.equal(result.prompt, '节点 知识图谱 位于 根目录/A')
  assert.deepEqual(result.missingVars, [])
})
check('声明但缺值降级为占位符，不猜测不删除', () => {
  const result = renderPrompt('文档：{{documentTitle}}', {}, ['documentTitle'])
  assert.equal(result.prompt, '文档：[未提供:documentTitle]')
  assert.deepEqual(result.missingVars, ['documentTitle'])
})
check('表达式 / 函数 / 嵌套一律不求值、原样保留', () => {
  const template = 'A {{ nodeTitle.toUpperCase() }} B {{ a + b }} C {{ {{nodeTitle}} }}'
  const result = renderPrompt(template, { nodeTitle: 'X' }, ['nodeTitle'])
  assert.equal(result.prompt, template)
  const issue = validate(template, ['nodeTitle'])
  assert.equal(issue.ok, false)
  assert.equal(issue.invalid.length, 3)
})
check('未声明变量原样保留，编辑期可拦截', () => {
  const template = '{{nodeTitle}} / {{date}}'
  assert.equal(renderPrompt(template, { nodeTitle: 'X', date: 'D' }, ['nodeTitle']).prompt, 'X / {{date}}')
  const issue = validate(template, ['nodeTitle'])
  assert.deepEqual(issue.undeclared, ['date'])
})
check('变量值不会被二次当作模板求值', () => {
  const result = renderPrompt('{{nodeTitle}}', { nodeTitle: '{{roomPath}}' }, ['nodeTitle'])
  assert.equal(result.prompt, '{{roomPath}}')
})
check('变量值限长 2000 字', () => {
  const result = renderPrompt('{{nodeTitle}}', { nodeTitle: 'x'.repeat(5000) }, ['nodeTitle'])
  assert.equal(result.prompt.length, 2000)
})

// ---------------------------------------------------------------------------
// 4) 主进程 toolIds 镜像与目录一致（主进程无法 import TS，双份真源由门禁兜底）
// ---------------------------------------------------------------------------
const agentStoreSource = stripComments(await readText('../electron/services/ai-agent-store.js'))
const readIdSet = (name: string): string[] => {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(agentStoreSource)
  return [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((item) => item[1])
}
check('主进程 ALLOWED_TOOL_IDS 与目录可分配集合一致', () => {
  const assignable = catalog.filter((entry) => entry.permission !== 'never').map((entry) => entry.id)
  assert.deepEqual(readIdSet('ALLOWED_TOOL_IDS').sort(), [...assignable].sort())
})
check('主进程 NEVER_TOOL_IDS 与目录 never 组一致', () => {
  const neverIds = catalog.filter((entry) => entry.permission === 'never').map((entry) => entry.id)
  assert.deepEqual(readIdSet('NEVER_TOOL_IDS').sort(), [...neverIds].sort())
})

// ---------------------------------------------------------------------------
// 5) buildRequestBody 能力位协商真跑（S2）
// ---------------------------------------------------------------------------
const builderModule = await loadBundle('../electron/services/ai-request-builder.js')
const buildRequestBody = builderModule.buildRequestBody as (
  config: Record<string, unknown>, agent: unknown,
) => { fields: Record<string, unknown>; meta: { protocol: string | null; reasoningSent: boolean; warnings: string[] } }
const BASE_CONFIG = {
  model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1', temperature: 0.7, maxTokens: 2048,
}

check('无 Agent 时沿用全局默认参数，不发推理字段', () => {
  const built = buildRequestBody(BASE_CONFIG, null)
  assert.equal(built.fields.model, 'gpt-4o-mini')
  assert.equal(built.fields.temperature, 0.7)
  assert.equal(built.fields.max_tokens, 2048)
  assert.equal(built.meta.reasoningSent, false)
})
check('Agent 覆盖采样参数并钳制到合法范围', () => {
  const built = buildRequestBody(BASE_CONFIG, {
    model: {
      model: 'custom-model', temperature: 99, topP: 0.4, maxTokens: 4096, presencePenalty: 0.3,
    },
    reasoning: { mode: 'off', protocol: 'auto' },
  })
  assert.equal(built.fields.model, 'custom-model')
  assert.equal(built.fields.temperature, 2)
  assert.equal(built.fields.top_p, 0.4)
  assert.equal(built.fields.max_tokens, 4096)
  assert.equal(built.fields.presence_penalty, 0.3)
})
check('自动模式按能力表识别火山方舟 thinking', () => {
  const built = buildRequestBody(
    { ...BASE_CONFIG, baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6' },
    { reasoning: { mode: 'auto', protocol: 'auto' } },
  )
  assert.deepEqual(built.fields.thinking, { type: 'enabled' })
  assert.equal(built.meta.protocol, 'volcengine.thinking')
  assert.equal(built.meta.reasoningSent, true)
})
check('reasoning_effort 协议剔除冲突的采样参数', () => {
  const built = buildRequestBody(BASE_CONFIG, {
    model: { temperature: 0.3, topP: 0.9 },
    reasoning: { mode: 'on', protocol: 'openai.reasoning_effort', effort: 'high' },
  })
  assert.equal(built.fields.reasoning_effort, 'high')
  assert.equal('temperature' in built.fields, false)
  assert.equal('top_p' in built.fields, false)
  assert.ok(built.meta.warnings.some((text) => text.includes('剔除')))
})
check('Qwen / SiliconFlow 走 enable_thinking', () => {
  const built = buildRequestBody(
    { ...BASE_CONFIG, baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { reasoning: { mode: 'on', protocol: 'auto' } },
  )
  assert.equal(built.fields.enable_thinking, true)
})
check('自动模式识别不到协议时降级为普通调用', () => {
  const built = buildRequestBody(
    { ...BASE_CONFIG, baseURL: 'https://example.invalid/v1', model: 'unknown-model' },
    { reasoning: { mode: 'auto', protocol: 'auto' } },
  )
  assert.equal(built.meta.protocol, null)
  assert.equal(built.meta.reasoningSent, false)
  assert.ok(built.meta.warnings.some((text) => text.includes('未识别推理协议')))
})
check('手动关闭：不发推理字段，默认开思考的服务发 disabled', () => {
  const off = buildRequestBody(BASE_CONFIG, { reasoning: { mode: 'off', protocol: 'auto' } })
  assert.equal(off.meta.reasoningSent, false)
  assert.equal('reasoning_effort' in off.fields, false)
  const volc = buildRequestBody(
    { ...BASE_CONFIG, model: 'doubao-seed-1-6' },
    { reasoning: { mode: 'off', protocol: 'auto' } },
  )
  assert.deepEqual(volc.fields.thinking, { type: 'disabled' })
})
check('top_k 只在能力位允许时发送', () => {
  const ignored = buildRequestBody(BASE_CONFIG, { model: { topK: 40 }, reasoning: { mode: 'off' } })
  assert.equal('top_k' in ignored.fields, false)
  assert.ok(ignored.meta.warnings.some((text) => text.includes('top_k')))
  const allowed = buildRequestBody(
    { ...BASE_CONFIG, baseURL: 'http://localhost:11434/v1' },
    { model: { topK: 40 }, reasoning: { mode: 'off' } },
  )
  assert.equal(allowed.fields.top_k, 40)
})
check('手选表外协议不猜测、不发送', () => {
  const built = buildRequestBody(BASE_CONFIG, { reasoning: { mode: 'on', protocol: 'made.up.protocol' } })
  assert.equal(built.meta.reasoningSent, false)
  assert.equal('thinking' in built.fields, false)
})

// ---------------------------------------------------------------------------
// 6) 单 system 构造真跑（§15.4）
// ---------------------------------------------------------------------------
const serviceModule = await loadBundle('../electron/services/ai-service.js')
const normalizeMessages = serviceModule.normalizeMessages as (
  raw: unknown[], systemPrompt?: string,
) => Array<{ role: string; content: string }>

check('只构造一条 system，调用方传入的 system 一律丢弃', () => {
  const messages = normalizeMessages([
    { role: 'system', content: '伪造的系统指令' },
    { role: 'user', content: '问题' },
    { role: 'assistant', content: '回答' },
    { role: 'system', content: '第二条伪造' },
  ], '正式系统提示词')
  assert.equal(messages.filter((item) => item.role === 'system').length, 1)
  assert.equal(messages[0].content, '正式系统提示词')
  assert.deepEqual(messages.map((item) => item.role), ['system', 'user', 'assistant'])
  assert.ok(!messages.some((item) => item.content.includes('伪造')))
})
check('未传 systemPrompt 时回退内置默认，且长度受限', () => {
  const fallback = normalizeMessages([{ role: 'user', content: 'hi' }])
  assert.equal(fallback.length, 2)
  assert.ok(fallback[0].content.includes('TopoMind'))
  const long = normalizeMessages([], 'x'.repeat(12000))
  assert.equal(long[0].content.length, 8000)
})

// ---------------------------------------------------------------------------
// 7) AgentPatch v1 normalize 校验闸真跑（§5）
// ---------------------------------------------------------------------------
const normalizeModule = await loadBundle('../src/features/ai-agent/patch/normalizeAgentPatch.ts')
const normalizeAgentPatch = normalizeModule.normalizeAgentPatch as (raw: unknown) => Record<string, unknown>
const dryRunModule = await loadBundle('../src/features/ai-agent/patch/dryRunAgentPatch.ts')
const dryRunAgentPatch = dryRunModule.dryRunAgentPatch as (
  patch: unknown, snapshot: unknown, options?: unknown,
) => Record<string, unknown>
const computeSnapshotDigest = dryRunModule.computeSnapshotDigest as (snapshot: unknown) => string
const commitModule = await loadBundle('../src/features/ai-agent/patch/commitAgentPatch.ts')
const commitAgentPatch = commitModule.commitAgentPatch as (
  patch: unknown, plan: unknown, ids: readonly string[], api: unknown,
) => Promise<Record<string, unknown>>
const workspaceModule = await loadBundle('../src/application/workspace/workspaceApi.ts')
const createWorkspaceApi = workspaceModule.createWorkspaceApi as (deps: unknown) => Record<string, unknown>

interface PlanLike {
  taskId: string
  items: Array<{
    opId: string; index: number; op: string; status: string; blockedReason?: string
    affectedCount: number; summary: string; graphDelta?: unknown
    documentWrite?: { nodeId?: string; kind?: string }
  }>
  readyCount: number
  blockedCount: number
  totalAffected: number
  snapshotDigest: string
  documentDigests?: Record<string, string>
  warnings: string[]
}
interface ApiLike {
  snapshot(): unknown
  isEditable(): boolean
  beginTransaction(): void
  endTransaction(): void
  abortTransaction(): void
  applyGraphDelta(delta: unknown): void
  flush(): Promise<void>
  log(actionId: string, detail: Record<string, unknown>): void
}
const checkAsync = async (label: string, fn: () => Promise<void>) => {
  await fn()
  checks += 1
  console.log(`  ok  ${label}`)
}
const errorCode = (fn: () => unknown): string => {
  try { fn() } catch (error) { return String((error as { code?: string }).code ?? 'unknown') }
  return 'no-throw'
}
const makePatch = (ops: unknown[], baseRevision: unknown = { roomRev: 7 }) => ({
  schema: 'topomind.agent-patch', version: 1, taskId: 'task-001', baseRevision, ops,
})
const renameOp = { op: 'node.rename', nodeId: 'n1', title: '新标题' }
const styleOp = { op: 'node.style', nodeIds: ['n1'], patch: { headerColor: 'token:accent' } }
const legalSpec = {
  version: 1, title: '卡片', layout: 'stack',
  components: [{ id: 'c1', type: 'text', props: { text: '正文' } }],
}

check('P2 真机回归：中文 / Unicode 房间名被接受（三类带 roomPath 的写工具可用）', () => {
  // 真机冒烟实测 graphSession.roomPath = 'AI工具冒烟库'；旧 ASCII-only 正则会让
  // node.link / canvas.layout / cardspec.create 在中文知识库里全部失效。
  for (const op of [
    { op: 'edge.create', roomPath: 'AI工具冒烟库', source: 'n1', target: 'n2', relation: 'related' },
    { op: 'canvas.layout', roomPath: 'AI工具冒烟库', algorithm: 'grid' },
    { op: 'cardspec.create', roomPath: 'AI工具冒烟库', title: '卡片', spec: legalSpec },
  ]) {
    const patch = normalizeAgentPatch(makePatch([op]))
    assert.equal((patch.ops[0] as { roomPath?: string }).roomPath, 'AI工具冒烟库')
  }
})
check('roomPath 放宽后仍拦截路径穿越 / URL / 控制字符', () => {
  for (const bad of ['../outside', 'kb/../other', 'https://example.com/v1', 'kb\\evil', 'kb\nroom']) {
    assert.throws(() => normalizeAgentPatch(makePatch([
      { op: 'node.create', roomPath: bad, title: 'X', position: { x: 0, y: 0 } },
    ])))
  }
})

check('normalize 合法 Patch：白名单构造且丢弃多余字段', () => {
  const raw = makePatch([{ ...renameOp, injected: 'should-drop' }], { roomRev: 7, junk: true })
  const patch = normalizeAgentPatch(raw) as { schema: string; version: number; ops: Record<string, unknown>[]; baseRevision: Record<string, unknown> }
  assert.equal(patch.schema, 'topomind.agent-patch')
  assert.equal(patch.version, 1)
  assert.equal(patch.ops.length, 1)
  assert.equal('injected' in patch.ops[0], false)
  assert.equal('junk' in patch.baseRevision, false)
})
check('未知 version / schema 抛错且不回写', () => {
  assert.equal(errorCode(() => normalizeAgentPatch({ ...makePatch([]), version: 2 })), 'version_invalid')
  assert.equal(errorCode(() => normalizeAgentPatch({ ...makePatch([]), schema: 'other' })), 'schema_invalid')
})
check('未知 op 抛 op_unknown', () => {
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch([{ op: 'node.teleport' }]))), 'op_unknown')
})
check('三个破坏性 op 全部永不开放', () => {
  for (const forbidden of ['node.delete', 'node.move_room', 'document.clear']) {
    assert.equal(errorCode(() => normalizeAgentPatch(makePatch([{ op: forbidden }]))), 'op_forbidden')
  }
})
check('ops 超过 50 上限抛 ops_limit', () => {
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch(Array.from({ length: 51 }, () => renameOp)))), 'ops_limit')
})
check('颜色拒绝任意 hex，token 引用放行', () => {
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch([
    { op: 'node.style', nodeIds: ['n1'], patch: { headerColor: '#ff0000' } },
  ]))), 'color_invalid')
  const ok = normalizeAgentPatch(makePatch([styleOp])) as { ops: Array<{ patch: Record<string, unknown> }> }
  assert.equal(ok.ops[0].patch.headerColor, 'token:accent')
})
check('文档块数量 / 文本长度受限', () => {
  const blocks = Array.from({ length: 201 }, () => ({ type: 'paragraph', text: 'x' }))
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch([
    { op: 'document.insert_blocks', documentId: 'doc-1', blocks },
  ]))), 'blocks_limit')
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch([
    { op: 'document.insert_blocks', documentId: 'doc-1', blocks: [{ type: 'paragraph', text: 'x'.repeat(4001) }] },
  ]))), 'text_too_long')
})
check('CardSpec 拒绝 html 组件，合法载荷二次归一化', () => {
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch([
    { op: 'cardspec.update', documentId: 'doc-1', spec: { ...legalSpec, components: [{ id: 'c1', type: 'html', props: {} }] } },
  ]))), 'cardspec_invalid')
  const ok = normalizeAgentPatch(makePatch([
    { op: 'cardspec.update', documentId: 'doc-1', spec: legalSpec },
  ])) as { ops: Array<{ spec: { components: unknown[] } }> }
  assert.equal(ok.ops[0].spec.components.length, 1)
})
check('baseRevision 结构非法被拒绝', () => {
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch([], { roomRev: -1 }))), 'base_revision_invalid')
  assert.equal(errorCode(() => normalizeAgentPatch(makePatch([], { documentRev: { 'doc-1': 'bad' } }))), 'base_revision_invalid')
})
check('normalize 不 mutate 入参', () => {
  const raw = makePatch([renameOp])
  const before = JSON.stringify(raw)
  normalizeAgentPatch(raw)
  assert.equal(JSON.stringify(raw), before)
})

// ---------------------------------------------------------------------------
// 8) dryRun 零副作用真跑（§5 第二段）
// ---------------------------------------------------------------------------
const DOCUMENTS = [{ id: 'doc-1', revision: 3, blockCount: 2, blockIds: ['b1', 'b2'], title: '文档一' }]
const makeNodes = () => ([
  {
    id: 'n1', type: 'knowledgeCard', position: { x: 10, y: 20 },
    data: {
      label: '节点一', container: { type: 'cardspec' },
      linkedDocuments: [{ docId: 'doc-1' }], treeOrder: 2,
      nodeStyle: { headerFontSize: 14 },
    },
  },
  { id: 'n2', type: 'knowledgeCard', position: { x: 200, y: 20 }, data: { label: '节点二' } },
])
const makeEdges = () => ([
  { id: 'e1', source: 'n1', target: 'n2', data: { relation: 'related', weight: 'main' } },
])
interface Harness {
  api: ApiLike
  storeApi: Record<string, unknown>
  state: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }
  calls: { setNodes: number; setEdges: number; pause: number; resume: number; historyPush: number; log: string[] }
}
function makeHarness(options: { editable?: boolean; flushFails?: boolean; roomRev?: number } = {}): Harness {
  const nodes = makeNodes()
  const edges = makeEdges()
  const state = { nodes, edges, historyRevision: 0 }
  const calls = { setNodes: 0, setEdges: 0, pause: 0, resume: 0, historyPush: 0, log: [] as string[] }
  const storeApi = {
    getState: () => state,
    setNodes: (next: typeof nodes) => { state.nodes = next; calls.setNodes += 1 },
    setEdges: (next: typeof edges) => { state.edges = next; calls.setEdges += 1 },
    temporal: {
      getState: () => ({
        pause: () => { calls.pause += 1 },
        resume: () => { calls.resume += 1 },
        pastStates: [] as unknown[],
        futureStates: [] as unknown[],
      }),
      setState: (fn: (s: { pastStates: unknown[]; futureStates: unknown[] }) => { pastStates: unknown[] }) => {
        calls.historyPush = fn({ pastStates: [], futureStates: [] }).pastStates.length
      },
    },
  }
  const api = createWorkspaceApi({
    storeApi,
    roomPath: 'kb/room-a',
    roomRev: options.roomRev ?? 7,
    documents: DOCUMENTS,
    guard: () => options.editable ?? true,
    logger: (actionId: string) => { calls.log.push(actionId) },
    storage: {
      saveGraphDebounced: async () => {
        if (options.flushFails) throw new Error('disk-full')
      },
    },
    dirPath: 'kb/room-a',
    buildMeta: () => ({}),
  }) as unknown as ApiLike
  return { api, storeApi, state, calls }
}
const runPlan = (h: Harness, ops: unknown[], baseRevision: unknown = { roomRev: 7 }) => {
  const patch = normalizeAgentPatch(makePatch(ops, baseRevision))
  const plan = dryRunAgentPatch(patch, h.api.snapshot(), { now: 0 }) as unknown as PlanLike
  return { patch, plan }
}

check('图类 op 产出 ready 预览（before / after / 影响数 / graphDelta）', () => {
  const h = makeHarness()
  const { plan } = runPlan(h, [renameOp])
  assert.equal(plan.readyCount, 1)
  assert.equal(plan.items[0].status, 'ready')
  assert.equal(plan.items[0].opId, '0:node.rename')
  assert.equal(plan.items[0].affectedCount, 1)
  assert.ok(plan.items[0].graphDelta)
  assert.ok(plan.items[0].summary.includes('新标题'))
})
check('跨房间引用被阻断', () => {
  const h = makeHarness()
  const { plan } = runPlan(h, [{ op: 'node.create', roomPath: 'kb/other-room', title: '越界', position: { x: 0, y: 0 } }])
  assert.equal(plan.items[0].blockedReason, 'cross_room_ref')
})
check('目标不存在被阻断', () => {
  const h = makeHarness()
  const { plan } = runPlan(h, [{ op: 'node.rename', nodeId: 'missing', title: 'X' }])
  assert.equal(plan.items[0].blockedReason, 'target_not_found')
})
check('文档版本不匹配被阻断', () => {
  const h = makeHarness()
  const { plan } = runPlan(h, [
    { op: 'document.update_meta', documentId: 'doc-1', patch: { title: '新标题' } },
  ], { roomRev: 7, documentRev: { 'doc-1': 2 } })
  assert.equal(plan.items[0].blockedReason, 'document_revision_mismatch')
})
check('房间版本不匹配阻断全部图类变更', () => {
  const h = makeHarness()
  const { plan } = runPlan(h, [renameOp], { roomRev: 6 })
  assert.equal(plan.items[0].blockedReason, 'room_revision_mismatch')
  assert.ok(plan.warnings.some((w) => w.includes('重新生成 Patch')))
})
check('文档 / CardSpec 写入未抓到目标文档状态时降级阻断（不猜、不读盘）', () => {
  const h = makeHarness()
  const { plan } = runPlan(h, [
    { op: 'document.insert_blocks', documentId: 'doc-1', blocks: [{ type: 'paragraph', text: '新增' }] },
    { op: 'cardspec.update', documentId: 'doc-1', spec: legalSpec },
  ])
  assert.equal(plan.blockedCount, 2)
  assert.equal(plan.items[0].blockedReason, 'document_state_unavailable')
  assert.equal(plan.items[1].blockedReason, 'document_state_unavailable')
  assert.ok(plan.warnings.some((w) => w.includes('未能读取')))
})
check('dryRun 零副作用：patch 与快照均未被修改', () => {
  const h = makeHarness()
  const patch = normalizeAgentPatch(makePatch([renameOp, styleOp]))
  const snapshot = h.api.snapshot()
  const patchBefore = JSON.stringify(patch)
  const snapshotBefore = JSON.stringify(snapshot)
  dryRunAgentPatch(patch, snapshot)
  assert.equal(JSON.stringify(patch), patchBefore)
  assert.equal(JSON.stringify(snapshot), snapshotBefore)
  assert.equal(h.calls.setNodes, 0)
  assert.equal(h.calls.setEdges, 0)
})
check('snapshotDigest 稳定且随内容变化', () => {
  const h = makeHarness()
  const a = computeSnapshotDigest(h.api.snapshot())
  assert.equal(a, computeSnapshotDigest(h.api.snapshot()))
  Object.assign(h.state.nodes[0].data as Record<string, unknown>, { label: '改动过' })
  assert.notEqual(a, computeSnapshotDigest(h.api.snapshot()))
})
check('多 op 顺序累积到同一份 graphDelta', () => {
  const h = makeHarness()
  const { plan } = runPlan(h, [renameOp, styleOp])
  assert.equal(plan.readyCount, 2)
  const last = plan.items[1].graphDelta as { nodes: Array<Record<string, unknown>> }
  const first = last.nodes.find((node) => node.id === 'n1') as { label: string; style: Record<string, unknown> }
  assert.equal(first.label, '新标题')
  assert.equal(first.style.headerColor, 'token:accent')
})

// ---------------------------------------------------------------------------
// 9) commit 事务真跑（§5 第三段 / §11.3 P1 验收）
// ---------------------------------------------------------------------------
await checkAsync('取消（零勾选）后节点零改动、零事务、零日志', async () => {
  const h = makeHarness()
  const { patch, plan } = runPlan(h, [renameOp])
  const before = JSON.stringify(h.state)
  const result = await commitAgentPatch(patch, plan, [], h.api) as { ok: boolean; undoSteps: number; appliedOpIds: string[] }
  assert.equal(result.ok, true)
  assert.equal(result.undoSteps, 0)
  assert.equal(result.appliedOpIds.length, 0)
  assert.equal(JSON.stringify(h.state), before)
  assert.equal(h.calls.pause, 0)
  assert.equal(h.calls.setNodes, 0)
  assert.equal(h.calls.log.length, 0)
})
await checkAsync('正常提交：一次任务 = 一步 undo、一次 setNodes、留痕 ai.patch_commit', async () => {
  const h = makeHarness()
  const { patch, plan } = runPlan(h, [renameOp])
  const result = await commitAgentPatch(patch, plan, [plan.items[0].opId], h.api) as {
    ok: boolean; undoSteps: number; appliedOpIds: string[]; issues: unknown[]
  }
  assert.equal(result.ok, true)
  assert.equal(result.undoSteps, 1)
  assert.equal(result.issues.length, 0)
  assert.equal(h.calls.pause, 1)
  assert.equal(h.calls.resume, 1)
  assert.equal(h.calls.historyPush, 1)
  assert.equal(h.calls.setNodes, 1)
  assert.deepEqual(h.calls.log, ['ai.patch_commit'])
  assert.equal((h.state.nodes[0].data as Record<string, unknown>).label, '新标题')
})
await checkAsync('7 处白名单字段往返不丢（container / linkedDocuments / treeOrder / nodeStyle）', async () => {
  const h = makeHarness()
  const { patch, plan } = runPlan(h, [renameOp])
  await commitAgentPatch(patch, plan, [plan.items[0].opId], h.api)
  const data = h.state.nodes[0].data as Record<string, unknown>
  assert.equal((data.container as { type: string }).type, 'cardspec')
  assert.equal((data.linkedDocuments as Array<{ docId: string }>)[0].docId, 'doc-1')
  assert.equal(data.treeOrder, 2)
  assert.equal((data.nodeStyle as { headerFontSize: number }).headerFontSize, 14)
})
await checkAsync('预览后快照变化（stale digest）直接拒绝且零写', async () => {
  const h = makeHarness()
  const { patch, plan } = runPlan(h, [renameOp])
  Object.assign(h.state.nodes[0].data as Record<string, unknown>, { label: '用户手动改过' })
  await assert.rejects(
    () => commitAgentPatch(patch, plan, [plan.items[0].opId], h.api),
    (error: unknown) => (error as { code?: string }).code === 'snapshot_stale',
  )
  assert.equal(h.calls.setNodes, 0)
  assert.equal(h.calls.pause, 0)
})
await checkAsync('只读闸门拒绝提交且零写', async () => {
  const h = makeHarness({ editable: false })
  const { patch, plan } = runPlan(h, [renameOp])
  await assert.rejects(
    () => commitAgentPatch(patch, plan, [plan.items[0].opId], h.api),
    (error: unknown) => (error as { code?: string }).code === 'guard_rejected',
  )
  assert.equal(h.calls.setNodes, 0)
})
await checkAsync('勾选被阻断的 op 直接拒绝且零写', async () => {
  const h = makeHarness()
  const { patch, plan } = runPlan(h, [
    { op: 'document.update_meta', documentId: 'doc-1', patch: { title: 'X' } },
  ])
  await assert.rejects(
    () => commitAgentPatch(patch, plan, [plan.items[0].opId], h.api),
    (error: unknown) => (error as { code?: string }).code === 'op_blocked',
  )
  assert.equal(h.calls.setNodes, 0)
})
await checkAsync('部分勾选：只应用选中项，被跳过的变更不出现', async () => {
  const h = makeHarness()
  const { patch, plan } = runPlan(h, [renameOp, styleOp])
  const result = await commitAgentPatch(patch, plan, [plan.items[1].opId], h.api) as {
    appliedOpIds: string[]; skippedOpIds: string[]
  }
  assert.deepEqual(result.appliedOpIds, ['1:node.style'])
  assert.deepEqual(result.skippedOpIds, ['0:node.rename'])
  const data = h.state.nodes[0].data as Record<string, unknown>
  assert.equal(data.label, '节点一')
  assert.equal((data.nodeStyle as Record<string, unknown>).headerColor, 'token:accent')
})
await checkAsync('落盘失败不回滚内存事务，撤销栈仍可用', async () => {
  const h = makeHarness({ flushFails: true })
  const { patch, plan } = runPlan(h, [renameOp])
  const result = await commitAgentPatch(patch, plan, [plan.items[0].opId], h.api) as {
    ok: boolean; undoSteps: number; warnings: string[]
  }
  assert.equal(result.ok, true)
  assert.equal(result.undoSteps, 1)
  assert.equal(h.calls.historyPush, 1)
  assert.ok(result.warnings.some((w) => w.includes('落盘失败')))
})
await checkAsync('多 op 一次提交仍只产生一次事务与一步撤销', async () => {
  const h = makeHarness()
  const { patch, plan } = runPlan(h, [renameOp, styleOp])
  const ids = plan.items.map((item) => item.opId)
  await commitAgentPatch(patch, plan, ids, h.api)
  assert.equal(h.calls.pause, 1)
  assert.equal(h.calls.resume, 1)
  assert.equal(h.calls.historyPush, 1)
  assert.equal(h.calls.setNodes, 1)
  assert.equal(h.calls.setEdges, 0)
})

// ---------------------------------------------------------------------------
// 7b) P2 遗留：图数据落盘链路（真机冒烟 72/74 → 74/74 的回归防线）
// ---------------------------------------------------------------------------
interface FlushHarness {
  api: ApiLike
  built: Array<{ nodes: unknown[]; edges: unknown[] }>
}
function makeFlushHarness(storage: Record<string, unknown>): FlushHarness {
  const state = { nodes: makeNodes(), edges: makeEdges(), historyRevision: 0 }
  const built: Array<{ nodes: unknown[]; edges: unknown[] }> = []
  const api = createWorkspaceApi({
    storeApi: {
      getState: () => state,
      setNodes: (nodes: unknown[]) => { state.nodes = nodes as typeof state.nodes },
      setEdges: (edges: unknown[]) => { state.edges = edges as typeof state.edges },
    },
    roomPath: 'kb/room-a',
    dirPath: 'kb/room-a',
    storage,
    buildMeta: (nodes: unknown[], edges: unknown[]) => {
      built.push({ nodes, edges })
      return { nodes, edges }
    },
  }) as unknown as ApiLike
  return { api, built }
}

await checkAsync('flush 真跑：优先立即 flushGraphSave，meta 含提交后的完整节点与边', async () => {
  let immediate = 0
  let debounced = 0
  let savedMeta: unknown = null
  const h = makeFlushHarness({
    flushGraphSave: async (_target: string, build: () => unknown) => {
      immediate += 1
      savedMeta = build()
    },
    saveGraphDebounced: async () => { debounced += 1 },
  })
  await h.api.flush()
  assert.equal(immediate, 1, '应立即 flush 而不是等 300ms debounce')
  assert.equal(debounced, 0)
  const meta = savedMeta as { nodes: unknown[]; edges: Array<{ id: string }> }
  assert.equal(meta.nodes.length, 2)
  assert.equal(meta.edges.length, 1)
  assert.equal(meta.edges[0].id, 'e1')
  assert.equal(h.built.length, 1)
})
await checkAsync('flush 向后兼容：调用方只提供 saveGraphDebounced 时仍能写盘', async () => {
  let debounced = 0
  const h = makeFlushHarness({ saveGraphDebounced: async () => { debounced += 1 } })
  await h.api.flush()
  assert.equal(debounced, 1)
})
const runtimeBindingSource = stripComments(await readText('../src/features/ai-agent/model/useAgentToolRuntime.ts'))
const workspaceBindingSource = stripComments(await readText('../src/application/workspace/useWorkspaceApi.ts'))
check('P2 遗留回归：渲染层绑定确实注入真实 storage + buildMeta，flush 不再是 no-op', () => {
  assert.match(runtimeBindingSource, /useWorkspaceApi\(\{\s*tabId: activeTabId,\s*\.\.\.saveDeps\s*\}\)/)
  assert.match(runtimeBindingSource, /store\.flushGraphSave/)
  assert.match(runtimeBindingSource, /buildMetaFromNodesEdges/)
})
check('P2 遗留回归：dirPath 缺省回落到订阅式 roomPath，房间切换后写盘目标同步更新', () => {
  assert.match(workspaceBindingSource, /useGraphSession\(tabId\)/)
  assert.match(workspaceBindingSource, /dirPath: dirPath \|\| roomPath/)
})

// ---------------------------------------------------------------------------
// 8) P2 工具层：注册表 / schema / 协议 / 三段链路真跑
// ---------------------------------------------------------------------------
const schemasModule = await loadBundle('../src/features/ai-agent/tools/toolSchemas.ts')
const toolSchemaIds = schemasModule.TOOL_SCHEMA_IDS as string[]
const handlersModule = await loadBundle('../src/features/ai-agent/tools/toolHandlers.ts')
const mapWriteToolToOp = handlersModule.mapWriteToolToOp as (
  id: string, args: Record<string, unknown>,
) => Record<string, unknown>
const registryModule = await loadBundle('../src/features/ai-agent/tools/toolRegistry.ts')
const wiredToolIds = registryModule.WIRED_TOOL_IDS as string[]
const exportToolSchemas = registryModule.exportToolSchemas as (ids: readonly string[]) => Array<{
  type: string; function: { name: string; description: string; parameters: Record<string, unknown> }
}>
const parseToolArguments = registryModule.parseToolArguments as (raw: string) => Record<string, unknown>
const executeToolCall = registryModule.executeToolCall as (options: unknown) => Promise<{
  callId: string; toolId: string; outcome: { kind: string; text?: string; code?: string; ops?: unknown[] }; content: string
}>
const toolIdToFunctionName = registryModule.toolIdToFunctionName as (id: string) => string
const functionNameToToolId = registryModule.functionNameToToolId as (name: string) => string | null
const registrySource = stripComments(await readText('../src/features/ai-agent/tools/toolRegistry.ts'))

check('P2 注册表与目录 wired 集合双向一致', () => {
  const catalogWired = catalog.filter((entry) => entry.status === 'wired').map((entry) => entry.id).sort()
  assert.deepEqual([...wiredToolIds].sort(), catalogWired)
  assert.deepEqual([...toolSchemaIds].sort(), catalogWired)
  assert.equal(wiredToolIds.length, 17)
})
check('三个破坏性工具没有被注册；P3 的 kb.ask 已接入', () => {
  for (const id of ['node.delete', 'node.move_room', 'document.clear']) {
    assert.ok(!wiredToolIds.includes(id), `${id} 不应出现在注册表`)
  }
  assert.equal(exportToolSchemas(['node.delete']).length, 0)
  assert.ok(wiredToolIds.includes('kb.ask'))
  assert.equal(exportToolSchemas(['kb.ask']).length, 1)
})
check('工具 name 无点号且可反查，schema 结构完整', () => {
  const schemas = exportToolSchemas(wiredToolIds)
  assert.equal(schemas.length, 17)
  for (const schema of schemas) {
    assert.equal(schema.type, 'function')
    assert.match(schema.function.name, /^[A-Za-z][A-Za-z0-9_-]*$/)
    assert.ok(schema.function.description.length > 0)
    assert.equal(schema.function.parameters.type, 'object')
    assert.ok(functionNameToToolId(schema.function.name))
  }
  assert.equal(toolIdToFunctionName('graph.read'), 'graph_read')
  assert.equal(functionNameToToolId('graph_read'), 'graph.read')
  assert.equal(exportToolSchemas([]).length, 0)
})
check('注册表源码无写执行点 / 网络 / 动态求值（auto 档无代码路径）', () => {
  assert.ok(!registrySource.includes('commitAgentPatch'))
  assert.ok(!registrySource.includes('fetch('))
  assert.ok(!registrySource.includes('electronAPI'))
  assert.ok(!/\beval\s*\(/.test(registrySource))
  assert.ok(!registrySource.includes('new Function'))
})
check('默认 orchestrator 开放 17 个已接入工具（含 kb.ask / agent.delegate）且不再声明「不能修改」', () => {
  const block = agentStoreSource.match(/const DEFAULT_TOOL_IDS = \[([\s\S]*?)\]/)
  assert.ok(block, '缺少 DEFAULT_TOOL_IDS')
  const ids = [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
  assert.deepEqual(ids, [...wiredToolIds].sort())
  assert.ok(!agentStoreSource.includes('不能执行任何修改操作'))
})

const normalizeTools = serviceModule.normalizeTools as (raw: unknown) => Array<{ function: { name: string } }>
const mergeToolCallDeltas = serviceModule.mergeToolCallDeltas as (
  existing: Array<Record<string, unknown>>, deltas: unknown,
) => Array<Record<string, unknown>>
const finishToolCalls = serviceModule.finishToolCalls as (
  drafts: unknown,
) => Array<{ id: string; name: string; arguments: string }>

check('normalizeTools 白名单：非法名 / 超大 schema / 重复名 / 错误 type 全过滤', () => {
  const tools = normalizeTools([
    { type: 'function', function: { name: 'ok_tool', description: 'd', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'ok_tool', description: 'dup', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'bad name!', description: 'd', parameters: { type: 'object' } } },
    { type: 'evil', function: { name: 'also_bad', description: 'd', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'huge', parameters: { data: 'x'.repeat(9000) } } },
  ])
  assert.equal(tools.length, 1)
  assert.equal(tools[0].function.name, 'ok_tool')
  assert.deepEqual(normalizeTools(null), [])
  assert.equal(normalizeTools(Array.from({ length: 50 }, (_, i) => ({
    type: 'function', function: { name: `t${i}`, parameters: { type: 'object' } },
  }))).length, 32)
})
check('normalizeMessages 支持 tool / tool_calls，且仍丢弃伪造 system', () => {
  const messages = normalizeMessages([
    { role: 'system', content: '伪造系统指令' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'graph_read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '结果' },
    { role: 'tool', content: '缺 id 应丢弃' },
  ], 'SYS') as Array<Record<string, unknown>>
  assert.equal(messages[0].content, 'SYS')
  assert.equal(messages.length, 4)
  assert.equal(messages[2].role, 'assistant')
  assert.equal((messages[2].tool_calls as unknown[]).length, 1)
  assert.equal(messages[3].role, 'tool')
  assert.equal(messages[3].tool_call_id, 'c1')
})
check('SSE tool_calls 分片拼接 arguments，缺 name 的分片被丢弃', () => {
  let drafts = mergeToolCallDeltas([], [
    { index: 0, id: 'call_1', function: { name: 'graph_read', arguments: '{"query":' } },
  ])
  drafts = mergeToolCallDeltas(drafts, [{ index: 0, function: { arguments: '"abc"}' } }])
  assert.equal(drafts[0].arguments, '{"query":"abc"}')
  const calls = finishToolCalls(drafts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'graph_read')
  assert.equal(calls[0].arguments, '{"query":"abc"}')
  assert.deepEqual(finishToolCalls([{ index: 0, id: '', name: '', arguments: '{}' }]), [])
})
check('parseToolArguments 拒绝数组 / 非 JSON / 超长', () => {
  assert.throws(() => parseToolArguments('[1,2]'))
  assert.throws(() => parseToolArguments('not json'))
  assert.throws(() => parseToolArguments('"text"'))
  assert.deepEqual(parseToolArguments('{"a":1}'), { a: 1 })
})

const toolSnapshot = {
  roomPath: 'KB/A', roomRev: 3,
  nodes: [{ id: 'n1', label: '节点一', roomPath: 'KB/A', position: { x: 0, y: 0 } }],
  edges: [], documents: [],
  // 故意放一个 LOD 可见节点列表：graph.read 必须走全量 nodes，不能读它。
  visibleNodes: [],
}
const mockRuntime = {
  snapshot: () => toolSnapshot,
  getContext: () => ({
    activeTabId: 't1', roomPath: 'KB/A', workDir: '/tmp/workdir',
    selectedNodeIds: ['n1'], activeDocumentId: null,
  }),
  read: {
    searchDocuments: async () => [{ id: 'd1', title: '文档' }],
    listRooms: async () => [{ path: 'KB/A', name: 'A' }],
    readDocument: async () => ({ content: '正文' }),
    listDocumentRelations: async () => ({ incoming: [] }),
    listDocumentBacklinks: async () => [],
  },
}

await checkAsync('读工具真跑：graph.read 取全量节点，不读 lod.visibleNodes', async () => {
  const result = await executeToolCall({
    call: { id: 'c1', name: 'graph_read', arguments: '{}' },
    runtime: mockRuntime,
    allowedIds: new Set(['graph.read']),
  })
  assert.equal(result.outcome.kind, 'result')
  assert.match(result.content, /"totalNodes":1/)
  assert.ok(!result.content.includes('"visibleNodes"'))
})
await checkAsync('读工具真跑：workspace.getContext 不把磁盘工作目录发给模型', async () => {
  const result = await executeToolCall({
    call: { id: 'c2', name: 'workspace_getContext', arguments: '{}' },
    runtime: mockRuntime,
    allowedIds: new Set(['workspace.getContext']),
  })
  assert.equal(result.outcome.kind, 'result')
  assert.ok(!result.content.includes('/tmp/workdir'))
  assert.match(result.content, /"nodeCount":1/)
})
await checkAsync('未授权工具 / 非法参数被拒绝，不执行任何 handler', async () => {
  const denied = await executeToolCall({
    call: { id: 'c3', name: 'node_delete', arguments: '{}' },
    runtime: mockRuntime,
    allowedIds: new Set(['graph.read']),
  })
  assert.equal(denied.outcome.kind, 'error')
  assert.equal(denied.outcome.code, 'tool_not_allowed')
  const invalid = await executeToolCall({
    call: { id: 'c4', name: 'node_rename', arguments: '[1]' },
    runtime: mockRuntime,
    allowedIds: new Set(['node.rename']),
  })
  assert.equal(invalid.outcome.kind, 'error')
  assert.equal(invalid.outcome.code, 'tool_args_invalid')
})
check('写工具映射：9 类 op 全部结构化产出，不解析自由文本', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['document.draft', { documentId: 'd1', blocks: [{ type: 'paragraph', text: '正文' }] }, 'document.insert_blocks'],
    ['document.polish', { documentId: 'd1', blockIds: ['b1'], blocks: [{ type: 'paragraph', text: '改' }] }, 'document.replace_blocks'],
    ['document.outline', { documentId: 'd1', blocks: [{ type: 'heading', text: '大纲' }] }, 'document.insert_blocks'],
    ['node.style', { nodeIds: ['n1'], patch: { headerColor: 'token:accent' } }, 'node.style'],
    ['node.create', { roomPath: 'KB/A', title: '新节点', position: { x: 10, y: 20 } }, 'node.create'],
    ['node.rename', { nodeId: 'n1', title: '新标题' }, 'node.rename'],
    ['node.link', { roomPath: 'KB/A', source: 'n1', target: 'n2', relation: 'related' }, 'edge.create'],
    ['canvas.layout', { roomPath: 'KB/A', algorithm: 'grid' }, 'canvas.layout'],
    ['cardspec.generate', { documentId: 'd1', spec: { components: [] } }, 'cardspec.update'],
  ]
  for (const [id, args, expected] of cases) {
    assert.equal(mapWriteToolToOp(id, args).op, expected, `${id} 映射错误`)
  }
  assert.throws(() => mapWriteToolToOp('node.rename', {}))
  assert.throws(() => mapWriteToolToOp('node.delete', {}))
})
await checkAsync('写工具 → normalize → dryRun 三段链路真跑，产出可确认的 PatchPlan', async () => {
  const result = await executeToolCall({
    call: { id: 'c5', name: 'node_rename', arguments: '{"nodeId":"n1","title":"新标题"}' },
    runtime: mockRuntime,
    allowedIds: new Set(['node.rename']),
  })
  assert.equal(result.outcome.kind, 'patch')
  const ops = result.outcome.ops as unknown[]
  assert.equal(ops.length, 1)
  const patch = normalizeAgentPatch({
    schema: 'topomind.agent-patch', version: 1, taskId: 'task-p2',
    baseRevision: { roomRev: 3 }, ops,
  })
  const before = JSON.stringify(toolSnapshot)
  const plan = dryRunAgentPatch(patch, toolSnapshot) as PlanLike
  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0].status, 'ready')
  assert.equal(plan.readyCount, 1)
  assert.equal(plan.requiresConfirmation, true)
  assert.equal(JSON.stringify(toolSnapshot), before, 'dryRun 不得 mutate 快照')
})

// ---------------------------------------------------------------------------
// 7c) P2 遗留：文档块级写入与 CardSpec 写入（§19.4 遗留 1 的回归防线）
// ---------------------------------------------------------------------------
const docWriteModule = await loadBundle('../src/features/ai-agent/patch/documentWrite.ts')
const smartModule = await loadBundle('../src/features/documents/SmartDocumentEditor/smartDocumentTypes.ts')
const stableContentDigest = docWriteModule.stableContentDigest as (v: unknown) => string
const readDocumentBlockIds = docWriteModule.readDocumentBlockIds as (v: unknown) => string[]
const joinRoomChildRef = docWriteModule.joinRoomChildRef as (a: string, b: string) => string
const toBlockNoteBlock = docWriteModule.toBlockNoteBlock as (b: unknown) => Record<string, unknown>
const buildDocumentWrite = docWriteModule.buildDocumentWrite as (
  op: unknown, opId: string, states: unknown, roomPath: string, index: number, taskId: string,
) => { write: Record<string, unknown>; summary: string }

const rawSmartDoc = (blocks: unknown[]) => ({
  schema: 'topomind.smart-document', version: 1, title: '文档一', blocks,
  metadata: { createdAt: 1, updatedAt: 1 },
})
const BASE_BLOCKS = [
  { id: 'b1', type: 'paragraph', content: '原文' },
  { id: 'b2', type: 'heading', props: { level: 2 }, content: '小标题' },
]
const rawCardSpec = {
  schema: 'topomind.card-spec', version: 1, title: '卡片', layout: 'stack',
  components: [{ id: 'c1', type: 'text', props: { text: '旧正文' } }],
  metadata: { createdAt: 1, updatedAt: 1, generatedBy: 'user' },
}
const makeDocStates = (content: unknown = rawSmartDoc(BASE_BLOCKS), overrides: Record<string, unknown> = {}) => ({
  'doc-1': {
    documentId: 'doc-1', cardPath: 'kb/room-a/card-1', type: 'smart', title: '文档一',
    digest: stableContentDigest(content), blockIds: readDocumentBlockIds(content),
    blockCount: BASE_BLOCKS.length, dirty: false, content, ...overrides,
  },
})
const runPlanWithDocs = (h: { api: ApiLike }, ops: unknown[], states: unknown) => {
  const patch = normalizeAgentPatch(makePatch(ops))
  const plan = dryRunAgentPatch(patch, h.api.snapshot(), { now: 0, documentStates: states }) as unknown as PlanLike
  return { patch, plan }
}

check('内容摘要对键顺序不敏感、对内容变化敏感', () => {
  assert.equal(stableContentDigest({ a: 1, b: { c: 2, d: 3 } }), stableContentDigest({ b: { d: 3, c: 2 }, a: 1 }))
  assert.notEqual(stableContentDigest({ a: 1 }), stableContentDigest({ a: 2 }))
})
check('白名单 DocumentBlock 全部落在本应用 BlockNote schema 内', () => {
  const cases: Array<[string, string]> = [
    ['paragraph', 'paragraph'],
    ['heading', 'heading'],
    ['bulletListItem', 'bulletListItem'],
    ['numberedListItem', 'numberedListItem'],
    ['quote', 'quote'],
    ['code', 'codeBlock'],
    ['divider', 'paragraph'],
  ]
  for (const [input, expectedType] of cases) {
    const block = toBlockNoteBlock({ type: input, text: '正文', level: 9 })
    assert.equal(block.type, expectedType, `${input} 类型错误`)
    assert.equal(block.content, input === 'divider' ? '---' : '正文')
  }
  assert.deepEqual(toBlockNoteBlock({ type: 'code', text: 'x' }).props, { language: '' })
  assert.equal((toBlockNoteBlock({ type: 'heading', text: 'H', level: 9 }).props as Record<string, unknown>).level, 3)
  assert.equal((toBlockNoteBlock({ type: 'heading', text: 'H' }).props as Record<string, unknown>).level, 2)
})
check('房间子节点路径拼接与 joinRefs 同口径', () => {
  assert.equal(joinRoomChildRef('AI工具冒烟库', 'card-1'), 'AI工具冒烟库/card-1')
  assert.equal(joinRoomChildRef('/KB//A/', '/card-1/'), 'KB/A/card-1')
})
check('document.insert_blocks 纯变换：生成完整规范化载荷并保留原有块', () => {
  const built = buildDocumentWrite(
    { op: 'document.insert_blocks', documentId: 'doc-1', afterBlockId: 'b1', blocks: [{ type: 'quote', text: 'AI 引用' }] },
    '0:document.insert_blocks', makeDocStates(), 'kb/room-a', 0, 'task-001',
  )
  const content = built.write.content as Record<string, unknown>
  assert.equal(built.write.kind, 'smart')
  assert.equal((content.blocks as unknown[]).length, 3)
  assert.equal(((content.blocks as Array<Record<string, unknown>>)[1]).type, 'quote')
  assert.equal(content.schema, 'topomind.smart-document')
  assert.equal((content.metadata as Record<string, unknown>).generatedBy, 'ai')
})
check('智能文档 normalize 透传 generatedBy，用户下一次 autosave 不丢 AI 来源标记', () => {
  const roundTrip = smartModule.normalizeSmartDocumentContent as (v: unknown, title: string) => Record<string, unknown>
  const once = roundTrip({
    schema: 'topomind.smart-document', version: 1, title: 'T', blocks: [],
    metadata: { generatedBy: 'ai', summary: 'S', tags: ['a'] },
  }, 'T')
  const twice = roundTrip(JSON.parse(JSON.stringify(once)), 'T')
  assert.deepEqual(twice.metadata, once.metadata)
  assert.equal((twice.metadata as Record<string, unknown>).generatedBy, 'ai')
  assert.equal('generatedBy' in (roundTrip({ blocks: [] }, 'T').metadata as Record<string, unknown>), false)
})
check('document.replace_blocks 按块 id 精确替换，不误删其它块', () => {
  const built = buildDocumentWrite(
    { op: 'document.replace_blocks', documentId: 'doc-1', blockIds: ['b2'], blocks: [{ type: 'heading', text: '新标题', level: 1 }] },
    '0:document.replace_blocks', makeDocStates(), 'kb/room-a', 0, 'task-001',
  )
  const blocks = (built.write.content as Record<string, unknown>).blocks as Array<Record<string, unknown>>
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].id, 'b1')
  assert.equal(blocks[1].type, 'heading')
  assert.equal((blocks[1].props as Record<string, unknown>).level, 1)
})
check('document.update_meta 的 summary / tags 经 normalize 后仍保留（下次 autosave 不丢）', () => {
  const built = buildDocumentWrite(
    { op: 'document.update_meta', documentId: 'doc-1', patch: { title: '改名', summary: '摘要', tags: ['AI', '知识'] } },
    '0:document.update_meta', makeDocStates(), 'kb/room-a', 0, 'task-001',
  )
  const content = built.write.content as Record<string, unknown>
  const metadata = content.metadata as Record<string, unknown>
  assert.equal(content.title, '改名')
  assert.equal(metadata.summary, '摘要')
  assert.deepEqual(metadata.tags, ['AI', '知识'])
  assert.equal(built.write.title, '改名')
})
check('cardspec.update 纯变换：过归一化闸并标记 generatedBy=ai', () => {
  const states = makeDocStates(rawCardSpec, { type: 'cardspec' })
  const built = buildDocumentWrite(
    { op: 'cardspec.update', documentId: 'doc-1', spec: legalSpec },
    '0:cardspec.update', states, 'kb/room-a', 0, 'task-001',
  )
  const content = built.write.content as Record<string, unknown>
  assert.equal(built.write.kind, 'cardspec')
  assert.equal(content.schema, 'topomind.card-spec')
  assert.equal(((content.metadata as Record<string, unknown>).generatedBy), 'ai')
})
check('cardspec.create 纯变换：生成容器路径与新建指令', () => {
  const built = buildDocumentWrite(
    { op: 'cardspec.create', roomPath: 'kb/room-a', title: '新卡片', spec: legalSpec },
    '0:cardspec.create', {}, 'kb/room-a', 0, 'task-001',
  )
  assert.equal(built.write.kind, 'cardspec-create')
  assert.equal(built.write.baseDigest, '')
  assert.ok(String(built.write.cardPath).startsWith('kb/room-a/agent-n-'))
})
check('文档写入硬门槛：脏草稿 / 类型不匹配 / 目标不存在全部阻断', () => {
  const dirty = makeDocStates(rawSmartDoc(BASE_BLOCKS), { dirty: true })
  const wrongType = makeDocStates(rawSmartDoc(BASE_BLOCKS), { type: 'cardspec' })
  const op = { op: 'document.insert_blocks', documentId: 'doc-1', blocks: [{ type: 'paragraph', text: 'X' }] }
  const codeOf = (states: unknown) => {
    try { buildDocumentWrite(op, '0:document.insert_blocks', states, 'kb/room-a', 0, 'task-001'); return 'no-throw' }
    catch (error) { return String((error as { code?: string }).code ?? 'unknown') }
  }
  assert.equal(codeOf(dirty), 'document_dirty')
  assert.equal(codeOf(wrongType), 'document_target_invalid')
  assert.equal(codeOf({}), 'target_not_found')
})
check('dryRun 注入文档状态后产出可提交预览与摘要表', () => {
  const h = makeHarness()
  const { plan } = runPlanWithDocs(h, [
    { op: 'document.insert_blocks', documentId: 'doc-1', blocks: [{ type: 'paragraph', text: '新增' }] },
    { op: 'cardspec.update', documentId: 'doc-1', spec: legalSpec },
  ], makeDocStates(rawCardSpec, { type: 'cardspec' }))
  // 两个 op 里只有 cardspec.update 与目标类型匹配；smart op 应单独降级为 blocked。
  assert.equal(plan.items[1].status, 'ready')
  assert.ok(plan.documentDigests !== undefined)
})

interface DocHarness {
  api: ApiLike
  writes: Array<{ cardPath: string; documentId: string; content: unknown }>
  published: string[]
  created: string[]
  setNodes: () => number
  state: { nodes: Array<Record<string, unknown>> }
}
function makeDocHarness(options: {
  content?: unknown
  mutateContent?: (content: unknown) => unknown
  dirty?: boolean
} = {}): DocHarness {
  const nodes = makeNodes()
  const state = { nodes: nodes as Array<Record<string, unknown>>, edges: makeEdges(), historyRevision: 0 }
  const writes: Array<{ cardPath: string; documentId: string; content: unknown }> = []
  const published: string[] = []
  const created: string[] = []
  let setNodesCount = 0
  let diskContent: unknown = options.content ?? rawSmartDoc(BASE_BLOCKS)
  if (options.mutateContent) diskContent = options.mutateContent(diskContent)
  const documentStorage = {
    resolveDocumentById: async (docId: string) => ({
      status: 'ok', cardPath: 'kb/room-a/card-1', title: '文档一',
      type: docId === 'doc-cs' ? 'cardspec' : 'smart',
    }),
    readTopoDocument: async () => diskContent,
    writeTopoDocument: async (cardPath: string, documentId: string, content: unknown) => {
      writes.push({ cardPath, documentId, content })
      diskContent = content
    },
    createTopoDocument: async (cardPath: string, input: { type: string; title: string }) => {
      created.push(`${cardPath}:${input.type}:${input.title}`)
      return { id: 'doc-new-9527' }
    },
    renameTopoDocument: async () => ({}),
  }
  const storeApi = {
    getState: () => state,
    setNodes: (next: unknown) => { state.nodes = next as Array<Record<string, unknown>>; setNodesCount += 1 },
    setEdges: () => {},
    temporal: {
      getState: () => ({ pause: () => {}, resume: () => {}, pastStates: [], futureStates: [] }),
      setState: () => {},
    },
  }
  const api = createWorkspaceApi({
    storeApi, roomPath: 'kb/room-a', roomRev: 7, documents: DOCUMENTS,
    dirPath: 'kb/room-a', buildMeta: () => ({}),
    documentStorage,
    documentBridge: {
      isDirty: () => options.dirty ?? false,
      onWritten: (id: string) => { published.push(id) },
    },
  }) as unknown as ApiLike
  return { api, writes, published, created, setNodes: () => setNodesCount, state }
}

await checkAsync('commit 真跑：文档写入落盘 + 广播外部写入 + 纯文档任务零图变更', async () => {
  const h = makeDocHarness()
  const states = makeDocStates()
  const { patch, plan } = runPlanWithDocs(h, [
    { op: 'document.insert_blocks', documentId: 'doc-1', blocks: [{ type: 'paragraph', text: 'AI 新增' }] },
  ], states)
  assert.equal(plan.items[0].status, 'ready')
  const result = await commitAgentPatch(patch, plan, [plan.items[0].opId], h.api) as {
    ok: boolean; undoSteps: number
  }
  assert.equal(result.ok, true)
  assert.equal(result.undoSteps, 0)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].documentId, 'doc-1')
  const blocks = (h.writes[0].content as Record<string, unknown>).blocks as Array<Record<string, unknown>>
  assert.equal(blocks.length, 3)
  assert.equal(blocks[2].content, 'AI 新增')
  assert.deepEqual(h.published, ['doc-1'])
  assert.equal(h.setNodes(), 0)
})
await checkAsync('commit 真跑：预览后磁盘内容变化 → 摘要不匹配，零写入', async () => {
  const h = makeDocHarness({
    mutateContent: (content) => ({ ...(content as Record<string, unknown>), title: '用户已改动' }),
  })
  const states = makeDocStates()
  const { patch, plan } = runPlanWithDocs(h, [
    { op: 'document.insert_blocks', documentId: 'doc-1', blocks: [{ type: 'paragraph', text: 'X' }] },
  ], states)
  const result = await commitAgentPatch(patch, plan, [plan.items[0].opId], h.api) as {
    ok: boolean; issues: Array<{ code: string }>
  }
  assert.equal(result.ok, false)
  assert.equal(result.issues[0]?.code, 'document_revision_mismatch')
  assert.equal(h.writes.length, 0)
})
await checkAsync('commit 真跑：脏草稿 → 零写入', async () => {
  const h = makeDocHarness({ dirty: true })
  const { patch, plan } = runPlanWithDocs(h, [
    { op: 'document.insert_blocks', documentId: 'doc-1', blocks: [{ type: 'paragraph', text: 'X' }] },
  ], makeDocStates())
  const result = await commitAgentPatch(patch, plan, [plan.items[0].opId], h.api) as {
    ok: boolean; issues: Array<{ code: string }>
  }
  assert.equal(result.ok, false)
  assert.equal(result.issues[0]?.code, 'document_dirty')
  assert.equal(h.writes.length, 0)
})
await checkAsync('commit 真跑：cardspec.create 建文档 + 建容器节点并写入真实 documentId', async () => {
  const h = makeDocHarness()
  const { patch, plan } = runPlanWithDocs(h, [
    { op: 'cardspec.create', roomPath: 'kb/room-a', title: '新卡片', spec: legalSpec },
  ], {})
  assert.equal(plan.items[0].status, 'ready')
  const result = await commitAgentPatch(patch, plan, [plan.items[0].opId], h.api) as {
    ok: boolean; undoSteps: number
  }
  assert.equal(result.ok, true)
  assert.equal(result.undoSteps, 1)
  assert.equal(h.created.length, 1)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].documentId, 'doc-new-9527')
  const container = h.state.nodes.find((node) => node.id === String(
    (plan.items[0] as unknown as { documentWrite?: { nodeId?: string } }).documentWrite?.nodeId,
  ))
  assert.ok(container, '应新建容器节点')
  assert.equal(container?.type, 'containerCard')
  assert.equal((container?.data as Record<string, unknown>).kind, 'container')
  assert.deepEqual((container?.data as Record<string, unknown>).container, {
    type: 'cardspec', documentId: 'doc-new-9527',
  })
})

await checkAsync('P2 遗留回归：右栏会话登记脏草稿、认领外部写入、拦截在途陈旧 autosave', async () => {
  const session = await readText('../src/features/right-panel/model/useDetailDocumentSession.ts')
  assert.ok(session.includes('markDocumentDirty'), '缺少脏草稿登记')
  assert.ok(session.includes('getDocumentExternalWrite'), '缺少外部写入认领')
  assert.ok(session.includes('getDocumentExternalRevision(activeTopoDocumentId) !== externalRevisionAtStart'),
    '缺少在途 autosave 拦截')
})
await checkAsync('P2 遗留回归：编辑器宿主按外部写入 revision 重挂载，避免旧 draft 回写', async () => {
  const registry = await readText('../src/features/documents/services/documentEditorRegistry.tsx')
  assert.ok(registry.includes('useDocumentExternalRevision'))
  assert.ok(registry.includes('editorInstanceKey'))
  const binding = await readText('../src/application/workspace/useWorkspaceApi.ts')
  assert.ok(binding.includes('bindDocumentPort'))
  assert.ok(binding.includes('publishDocumentExternalWrite'))
})

// ---------------------------------------------------------------------------
// 9) S3 自动调度：agent.delegate 真跑 + 白名单 / 预算 / 并发 / 级联取消回归
// ---------------------------------------------------------------------------
const subAgentToolIds = catalogModule.SUB_AGENT_TOOL_IDS as string[]
const readToolIds = handlersModule.READ_TOOL_IDS as string[]
const getReadHandler = handlersModule.getReadHandler as (
  id: string,
) => ((args: Record<string, unknown>, runtime: unknown) => Promise<{
  kind: string; text: string; code?: string; delegation?: unknown
}>) | null
const collectCascadeTargets = serviceModule.collectCascadeTargets as (
  parents: Iterable<[string, string]>, root: string,
) => Set<string>
const aiMaxConcurrent = serviceModule.AI_MAX_CONCURRENT as number

check('S3 目录 / schema / 注册表：agent.delegate 四处同源且已接入', () => {
  assert.ok(catalogIds.includes('agent.delegate'))
  const entry = catalog.find((item) => item.id === 'agent.delegate')
  assert.equal(entry?.status, 'wired')
  assert.equal(entry?.permission, 'read-only')
  assert.ok(toolSchemaIds.includes('agent.delegate'))
  assert.ok(wiredToolIds.includes('agent.delegate'))
  const schemas = exportToolSchemas(['agent.delegate'])
  assert.equal(schemas.length, 1)
  assert.equal(schemas[0].function.name, 'agent_delegate')
  assert.deepEqual((schemas[0].function.parameters as { required?: string[] }).required, ['subAgentId', 'task'])
  assert.equal(functionNameToToolId('agent_delegate'), 'agent.delegate')
})
check('S3 子调用工具子集：7 个已接入只读工具（含 kb.ask），无调度元工具 / 无写工具', () => {
  assert.equal(subAgentToolIds.length, 7)
  assert.ok(!subAgentToolIds.includes('agent.delegate'))
  assert.ok(subAgentToolIds.includes('kb.ask'))
  for (const id of subAgentToolIds) {
    const entry = catalog.find((item) => item.id === id)
    assert.equal(entry?.status, 'wired', `${id} 不是 wired`)
    assert.equal(entry?.permission, 'read-only', `${id} 不是只读`)
  }
  assert.deepEqual([...subAgentToolIds].sort(), [...readToolIds].sort())
})
await checkAsync('S3 delegate handler 真跑：注入端口才执行，回灌结构化摘要；无端口直接拒绝', async () => {
  const handler = getReadHandler('agent.delegate')
  assert.ok(handler, '缺少 agent.delegate handler')
  let seen: unknown = null
  const runtime = {
    delegate: {
      run: async (request: { subAgentId: string; task: string }) => {
        seen = request
        return {
          ok: true, agentId: request.subAgentId, agentName: '子助手',
          systemPrompt: 'SUB_SYS', task: request.task, summary: '子调用回答',
          elapsedMs: 12, rounds: 0, toolIds: ['graph.read'],
        }
      },
    },
  }
  const outcome = await handler({ subAgentId: 'sub-1', task: '查一下' }, runtime)
  assert.equal(outcome.kind, 'delegate')
  assert.deepEqual(seen, { subAgentId: 'sub-1', task: '查一下' })
  const wire = JSON.parse(outcome.text) as Record<string, unknown>
  assert.equal(wire.ok, true)
  assert.equal(wire.subAgentId, 'sub-1')
  assert.equal(wire.agentName, '子助手')
  assert.equal(wire.summary, '子调用回答')
  const denied = await handler({ subAgentId: 'sub-1', task: 'x' }, {})
  assert.equal(denied.kind, 'error')
  assert.equal(denied.code, 'delegate_unavailable')
  const invalid = await handler({ subAgentId: '', task: '' }, runtime)
  assert.equal(invalid.kind, 'error')
  assert.equal(invalid.code, 'tool_args_invalid')
})
check('S3 级联取消真跑：间接后代也能被主任务 cancel 覆盖', () => {
  const parents: Array<[string, string]> = [
    ['sub-1', 'main-r1'], ['sub-1-r1', 'main-r1'],
    ['sub-2', 'sub-1'], ['unrelated', 'other'],
  ]
  const targets = collectCascadeTargets(parents, 'main-r1')
  assert.deepEqual([...targets].sort(), ['main-r1', 'sub-1', 'sub-1-r1', 'sub-2'])
  assert.ok(!targets.has('unrelated'))
  assert.deepEqual([...collectCascadeTargets(parents, '')], [])
  assert.equal(aiMaxConcurrent, 4)
})

const delegationSource = stripComments(await readText('../src/features/ai-agent/model/agentDelegation.ts'))
const loopSource = stripComments(await readText('../src/features/ai-agent/model/agentToolLoop.ts'))
const mainSource = stripComments(await readText('../electron/main.js'))
const serviceSource = stripComments(await readText('../electron/services/ai-service.js'))
const backendSource = stripComments(await readText('../src/core/ai-backend.ts'))
const panelSource = stripComments(await readText('../src/features/ai-agent/AgentPanel.tsx'))
const settingsSource = stripComments(await readText('../src/features/settings/AgentSettingsSection.tsx'))
const cardSource = stripComments(await readText('../src/features/ai-agent/components/DelegationCard.tsx'))
check('S3 调度白名单只认 allowedSubAgentIds，且排除 orchestrator / 未启用 Agent', () => {
  assert.ok(delegationSource.includes('config.allowedSubAgentIds.includes(subAgentId)'))
  assert.ok(delegationSource.includes("agent.kind === 'orchestrator'"))
  assert.ok(delegationSource.includes('!agent.enabled'))
})
check('S3 预算 / 并发 / 子轮次上限显式存在，且子 runtime 不注入 delegate 端口', () => {
  assert.ok(delegationSource.includes('MAX_PARALLEL_DELEGATIONS = 3'))
  assert.ok(delegationSource.includes('MAX_DELEGATIONS_PER_TASK = 4'))
  assert.ok(delegationSource.includes('MAX_SUB_TOOL_ROUNDS = 2'))
  assert.ok(delegationSource.includes('const subRuntime'))
  assert.ok(!/subRuntime:\s*ToolRuntime\s*=\s*\{[^}]*delegate/s.test(delegationSource))
  assert.ok(delegationSource.includes('exportToolSchemas(toolIds)'))
})
check('S3 主任务取消 / 新建会话会级联取消全部在途子调用', () => {
  assert.ok(loopSource.includes('abortAllDelegations()'))
  assert.ok(loopSource.includes('resetDelegationBudget()'))
  assert.ok(loopSource.includes('recordDelegation('))
})
check('S3 parentTaskId 贯通 backend → main → ai-service，主进程按父子链 abort', () => {
  assert.ok(backendSource.includes('parentTaskId?: string'))
  assert.ok(backendSource.includes('...(parentTaskId ? { parentTaskId } : {})'))
  assert.ok(mainSource.includes('parentTaskId'))
  assert.ok(mainSource.includes('aiService.startChat({ taskId, messages: data.messages, agent, tools: data.tools, parentTaskId })'))
  assert.ok(serviceSource.includes('collectCascadeTargets(parents, root)'))
  assert.ok(serviceSource.includes('parents.set(taskId, parentTaskId)'))
  assert.ok(serviceSource.includes('MAX_CONCURRENT = 4'))
})
check('S3 委托卡片与设置页白名单入口已挂（可复盘 / 可配置）', () => {
  assert.ok(panelSource.includes('<DelegationCard'))
  assert.ok(cardSource.includes('data-tm-ai-delegation'))
  assert.ok(cardSource.includes('data-tm-ai-delegation-prompt'))
  assert.ok(settingsSource.includes('data-tm-agent-delegate-allowlist'))
  assert.ok(settingsSource.includes('toggleDelegateAllowed'))
})

// ---------------------------------------------------------------------------
// 10) P3 / D：简版 RAG（主进程索引 + 上下文信封 + kb.ask + 引用跳转）真跑
// ---------------------------------------------------------------------------
const indexModule = await loadBundle('../electron/services/ai-index-service.js')
const contextModule = await loadBundle('../src/features/ai-agent/model/contextBuilder.ts')
const createAiIndexService = indexModule.createAiIndexService as (deps: {
  getWorkDir: () => string
}) => {
  query: (raw: Record<string, unknown>) => {
    ok: boolean
    code?: string
    hits: Array<{
      ref: number
      docId: string
      cardPath: string
      title: string
      breadcrumb: string
      charRange: [number, number]
      text: string
      score: number
    }>
    meta: {
      created: boolean
      rebuiltSources: number
      removedSources: number
      totalSources: number
      totalChunks: number
      noHit: boolean
      scope: string
      tookMs: number
      termCoverage?: number
    }
  }
  stats: () => { built: boolean; sources: number; chunks: number }
}
const buildContextEnvelope = contextModule.buildContextEnvelope as (input: {
  l1?: string
  l2?: Array<{ label: string; text: string; score?: number }>
  l3?: Array<{ label: string; text: string; score?: number }>
  budget?: number
}) => {
  text: string
  usedTokens: number
  budget: number
  droppedL3: number
  droppedL2: number
  keptL3: number
  layers: string[]
}
const buildRetrievalEnvelope = contextModule.buildRetrievalEnvelope as (
  question: string,
  hits: readonly unknown[],
  budget?: number,
) => {
  text: string
  references: Array<{ ref: number; docId: string; cardPath: string; title: string }>
  noHit: boolean
}
const parseReferenceToken = contextModule.parseReferenceToken as (token: string) => number | null
const extractPlainText = indexModule.extractPlainText as (content: unknown, type: string) => string
const chunkText = indexModule.chunkText as (text: string, size?: number, overlap?: number) => Array<{ start: number; end: number; text: string }>
const tokenize = indexModule.tokenize as (text: string) => string[]

const markdownSource = stripComments(await readText('../src/features/ai-agent/AiMarkdown.tsx'))
const sessionSource = stripComments(await readText('../src/features/ai-agent/model/agentSessionStore.ts'))
const runtimeSource = stripComments(await readText('../src/features/ai-agent/model/useAgentToolRuntime.ts'))
const preloadSource = stripComments(await readText('../electron/preload.js'))
const indexServiceSource = stripComments(await readText('../electron/services/ai-index-service.js'))
const contextSource = stripComments(await readText('../src/features/ai-agent/model/contextBuilder.ts'))

const nodeFs = await import('node:fs')
const nodeOs = await import('node:os')
const nodePathMod = await import('node:path')
const ragDir = nodeFs.mkdtempSync(nodePathMod.join(nodeOs.tmpdir(), 'tm-rag-contract-'))
const ragDocsDir = nodePathMod.join(ragDir, 'kbs', '契约知识库', '节点甲', '_docs')
nodeFs.mkdirSync(ragDocsDir, { recursive: true })
const ragTdoc = (title: string, text: string) => ({
  schema: 'topomind.smart-document',
  version: 1,
  title,
  blocks: [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text }] }],
})
const ragA = 'doc-rag-a'
const ragB = 'doc-rag-b'
const ragAPath = nodePathMod.join(ragDocsDir, `${ragA}.tdoc.json`)
const ragBPath = nodePathMod.join(ragDocsDir, `${ragB}.tmind.json`)
const ragARaw = JSON.stringify(ragTdoc('量子纠缠笔记', '量子纠缠是本地知识检索的关键概念，可用于引用定位。'.repeat(3)))
nodeFs.writeFileSync(ragAPath, ragARaw, 'utf8')
nodeFs.writeFileSync(ragBPath, JSON.stringify({
  schema: 'topomind.mindmap-document',
  version: 2,
  title: '脑图标签',
  root: { data: { text: '中心主题' }, children: [{ data: { text: '拓扑记忆方法' }, children: [] }] },
}), 'utf8')
nodeFs.writeFileSync(nodePathMod.join(ragDocsDir, 'doc-rag-card.cardspec.json'), JSON.stringify({
  schema: 'topomind.card-spec',
  title: '不应被索引',
  components: [{ type: 'text', props: { text: 'CARDSPEC_SECRET_MARKER' } }],
}), 'utf8')
nodeFs.writeFileSync(nodePathMod.join(ragDocsDir, 'tree.json'), JSON.stringify({
  version: 2,
  documents: {
    [ragA]: { id: ragA, type: 'smart', title: '量子纠缠笔记', path: `${ragA}.tdoc.json`, parentId: null, sortOrder: 0 },
    [ragB]: { id: ragB, type: 'mindmap', title: '脑图标签', path: `${ragB}.tmind.json`, parentId: null, sortOrder: 1 },
    'doc-rag-card': { id: 'doc-rag-card', type: 'cardspec', title: '不应被索引', path: 'doc-rag-card.cardspec.json', parentId: null, sortOrder: 2 },
  },
}), 'utf8')
nodeFs.writeFileSync(nodePathMod.join(ragDir, 'kbs', '契约知识库', '_graph.json'), JSON.stringify({
  children: { '节点甲': { name: '节点甲', kind: 'knowledge' } }, edges: [],
}), 'utf8')

const ragService = createAiIndexService({ getWorkDir: () => ragDir })
const ragIndexPath = nodePathMod.join(ragDir, '.topomind', 'ai-index', 'documents.json')

check('P3 索引首次问答才建：只索引 .tdoc / .tmind，cardspec 正文不入索引', () => {
  assert.equal(nodeFs.existsSync(ragIndexPath), false)
  const first = ragService.query({ question: '量子纠缠' })
  assert.equal(first.ok, true)
  assert.equal(first.meta.created, true)
  assert.equal(first.meta.rebuiltSources, 2)
  assert.equal(first.meta.totalSources, 2)
  assert.equal(first.hits[0]?.docId, ragA)
  assert.equal(first.hits[0]?.cardPath, '契约知识库/节点甲')
  assert.equal(first.hits[0]?.charRange.length, 2)
  assert.ok(first.hits[0]?.text.includes('量子纠缠'))
  assert.equal(ragService.query({ question: 'CARDSPEC_SECRET_MARKER' }).meta.noHit, true)
  const index = JSON.parse(nodeFs.readFileSync(ragIndexPath, 'utf8')) as { version: number; postings: Record<string, unknown> }
  assert.equal(index.version, 1)
  assert.ok(Object.keys(index.postings).length > 0)
})
check('P3 中文切分命中脑图节点标签，未命中与范围过滤都不编造', () => {
  const mind = ragService.query({ question: '拓扑记忆方法' })
  assert.ok(mind.hits.some((hit) => hit.docId === ragB))
  assert.equal(ragService.query({ question: '完全不存在的词ZZZZ' }).meta.noHit, true)
  assert.equal(ragService.query({ question: '量子纠缠', scope: 'room', roomPath: '契约知识库/别的节点' }).meta.noHit, true)
  assert.equal(ragService.query({ question: '量子纠缠', scope: 'kb', roomPath: '契约知识库' }).hits.length > 0, true)
  assert.equal(ragService.query({ question: '' }).ok, false)
})
check('P3 通用词防误命中：中文长问题只撞上一个常见词时判定未命中', () => {
  // 正文含「检索」，但整句与文档无关；若无覆盖率下限，会误返回 [ref:1] 让模型编造引用。
  const irrelevant = ragService.query({ question: '绝对不存在的检索词 RAGMISS9527ZZZ' })
  assert.equal(irrelevant.meta.noHit, true)
  assert.equal(irrelevant.hits.length, 0)
  assert.ok((irrelevant.meta.termCoverage ?? 1) < 0.25)
  // 真实命中不受影响：完整词 + 常见词组合仍能定位到同一片段。
  const relevant = ragService.query({ question: '量子纠缠的知识检索讲了什么' })
  assert.equal(relevant.meta.noHit, false)
  assert.ok(relevant.hits.some((hit) => hit.docId === ragA))
})
check('P3 正文抽取 / chunk 重叠 / 中文 bigram 分词纯函数真跑', () => {
  const text = extractPlainText(ragTdoc('T', '一段正文'), 'smart')
  assert.ok(text.includes('一段正文'))
  assert.equal(extractPlainText({ blocks: [{ type: 'image', props: { url: 'data:image/png;base64,AAAA' } }] }, 'smart'), '')
  const chunks = chunkText('0123456789abcdef', 10, 3)
  assert.equal(chunks[0]?.start, 0)
  assert.ok(chunks.length > 1 && chunks[1].start < chunks[0].end)
  assert.equal(chunks[1].start, chunks[0].end - 3)
  const terms = tokenize('量子纠缠 knowledge')
  assert.ok(terms.includes('量子') || terms.includes('量子纠缠'))
  assert.ok(terms.includes('knowledge'))
})
check('P3 增量重建：只重解析签名变化的源文件，且不改写任何业务文件', () => {
  const before = ragService.stats().sources
  nodeFs.writeFileSync(ragAPath, JSON.stringify(ragTdoc('量子纠缠笔记', '量子纠缠补充段落，索引应按 stat 签名增量重建。'.repeat(3))), 'utf8')
  const future = new Date(Date.now() + 5000)
  nodeFs.utimesSync(ragAPath, future, future)
  const next = ragService.query({ question: '量子纠缠' })
  assert.equal(next.meta.created, false)
  assert.equal(next.meta.rebuiltSources, 1)
  assert.equal(next.meta.totalSources, before)
  assert.equal(nodeFs.readFileSync(ragBPath, 'utf8').includes('拓扑记忆方法'), true)
})
check('P3 索引损坏自愈：坏 JSON / 版本不符一律全量重建', () => {
  nodeFs.writeFileSync(ragIndexPath, '{broken json', 'utf8')
  const healed = ragService.query({ question: '量子纠缠' })
  assert.equal(healed.ok, true)
  assert.equal(healed.meta.created, true)
  assert.equal(healed.meta.totalSources, 2)
  assert.equal((JSON.parse(nodeFs.readFileSync(ragIndexPath, 'utf8')) as { version: number }).version, 1)
})

check('P3 上下文信封：预算超支按 L3 → L2 回收，L1 永不裁剪', () => {
  const env = buildContextEnvelope({
    l1: '锚点',
    l2: [{ label: 'l2', text: 'A'.repeat(500) }],
    l3: [{ label: 'l3', text: 'B'.repeat(500), score: 1 }],
    budget: 300,
  })
  assert.equal(env.budget, 300)
  assert.equal(env.keptL3, 1)
  assert.equal(env.droppedL2, 1)
  assert.ok(env.layers.includes('L1'))
  assert.ok(!env.layers.includes('L2'))
  assert.ok(env.text.includes('锚点') && env.text.includes('B'.repeat(20)))
})
const ragHit = {
  ref: 1,
  docId: ragA,
  cardPath: '契约知识库/节点甲',
  title: '量子纠缠笔记',
  breadcrumb: '契约知识库 / 节点甲',
  charRange: [0, 120] as [number, number],
  text: '量子纠缠是本地知识检索的关键概念。',
  score: 3,
}
check('P3 外发信封：只发 [ref:i] / 标题 / 片段，docId 与磁盘路径只留内存映射', () => {
  const env = buildRetrievalEnvelope('量子纠缠', [ragHit])
  assert.equal(env.noHit, false)
  assert.ok(env.text.includes('[ref:1]'))
  assert.ok(!env.text.includes(ragA))
  assert.ok(!env.text.includes('契约知识库/节点甲'))
  assert.equal(env.references[0]?.docId, ragA)
  assert.equal(env.references[0]?.cardPath, '契约知识库/节点甲')
})
check('P3 未命中不编造：明确「未检索到」且没有任何引用编号 / 映射', () => {
  const env = buildRetrievalEnvelope('没有的内容', [])
  assert.equal(env.noHit, true)
  assert.ok(env.text.includes('未检索到'))
  assert.equal(/\[ref:\d+\]/.test(env.text), false)
  assert.equal(env.references.length, 0)
})
check('P3 预算裁掉的片段不留死链；引用编号解析拒绝伪造值', () => {
  const env = buildRetrievalEnvelope('量子纠缠', [
    ragHit,
    { ...ragHit, ref: 2, text: 'C'.repeat(100000) },
  ], 400)
  assert.equal(env.references.length, 1)
  assert.equal(env.references[0]?.ref, 1)
  assert.equal(env.text.includes('[ref:2]'), false)
  assert.equal(parseReferenceToken('[ref:3]'), 3)
  assert.equal(parseReferenceToken('[ref:x]'), null)
  assert.equal(parseReferenceToken('[ref:0]'), null)
})
check('P3 kb.ask 四处同源：目录 / schema / 注册表 / handler，且是只读工具', () => {
  const entry = catalog.find((item) => item.id === 'kb.ask')
  assert.equal(entry?.status, 'wired')
  assert.equal(entry?.kind, 'read')
  assert.equal(entry?.permission, 'read-only')
  assert.ok(toolSchemaIds.includes('kb.ask'))
  assert.ok(wiredToolIds.includes('kb.ask'))
  assert.ok(readToolIds.includes('kb.ask'))
  assert.ok(handlersModule.getReadHandler)
  const schemas = exportToolSchemas(['kb.ask'])
  assert.equal(schemas.length, 1)
  assert.equal(schemas[0].function.name, 'kb_ask')
  assert.deepEqual((schemas[0].function.parameters as { required?: string[] }).required, ['question'])
  assert.equal(functionNameToToolId('kb_ask'), 'kb.ask')
})
await checkAsync('P3 kb.ask handler 真跑：命中 / 未命中 / 索引不可用三条路径', async () => {
  const handler = getReadHandler('kb.ask') as (
    args: Record<string, unknown>,
    runtime: Record<string, unknown>,
  ) => Promise<{ kind: string; text: string; references?: unknown[]; code?: string }>
  assert.ok(handler)
  const runtime = {
    getContext: () => ({ roomPath: '契约知识库/节点甲' }),
    index: {
      query: async (request: Record<string, unknown>) => {
        const noHit = String(request.question).includes('不存在')
        return {
          ok: true,
          hits: noHit ? [] : [ragHit],
          meta: { noHit },
        }
      },
    },
  }
  const hit = await handler({ question: '量子纠缠', scope: 'room' }, runtime)
  assert.equal(hit.kind, 'references')
  assert.ok(hit.text.includes('[ref:1]'))
  assert.equal(hit.references?.length, 1)
  const miss = await handler({ question: '完全不存在的词' }, runtime)
  assert.equal(miss.kind, 'references')
  assert.ok(miss.text.includes('未检索到'))
  assert.equal(miss.references?.length, 0)
  const noPort = await handler({ question: '量子纠缠' }, { getContext: () => ({ roomPath: '' }) })
  assert.equal(noPort.kind, 'error')
  assert.equal(noPort.code, 'kb_index_unavailable')
})
await checkAsync('P3 registry 把 references 挂到 ToolExecutionResult（不进 wire 之外）', async () => {
  const executeToolCall = registryModule.executeToolCall as (options: Record<string, unknown>) => Promise<Record<string, unknown>>
  const result = await executeToolCall({
    call: { id: 'call-rag', name: 'kb_ask', arguments: JSON.stringify({ question: '量子纠缠' }) },
    runtime: {
      getContext: () => ({ roomPath: '契约知识库/节点甲' }),
      index: { query: async () => ({ ok: true, hits: [ragHit] }) },
    },
    allowedIds: new Set(['kb.ask']),
  })
  assert.equal(result.toolId, 'kb.ask')
  assert.equal((result.outcome as { kind: string }).kind, 'references')
  assert.equal((result.references as unknown[]).length, 1)
  assert.ok(String(result.content).includes('[ref:1]'))
})
check('P3 IPC / 引用跳转链路：preload 三白名单 + 主进程 handler + 唯一外发点', () => {
  assert.ok(preloadSource.includes("'ai:index:query'"))
  assert.ok(mainSource.includes("'ai:index:query'"))
  assert.ok(mainSource.includes('createAiIndexService'))
  assert.ok(backendSource.includes('queryAiIndex'))
  assert.ok(runtimeSource.includes('queryAiIndex'))
  assert.ok(indexServiceSource.includes("'ai-index'"))
  assert.ok(contextSource.includes('buildRetrievalEnvelope'))
  assert.ok(loopSource.includes('recordReferences'))
  assert.ok(sessionSource.includes('recordReferences'))
  assert.ok(panelSource.includes('requestOpenDocumentLink'))
  assert.ok(markdownSource.includes('data-tm-ai-ref'))
  assert.ok(designDoc.includes('`kb.ask`'))
})
nodeFs.rmSync(ragDir, { recursive: true, force: true })

console.log(`\nAI_AGENT_CONTRACTS_PASSED (${checks} checks)`)
