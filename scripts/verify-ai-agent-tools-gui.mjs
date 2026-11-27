/**
 * AI 工具调用（tool calling）真机端到端冒烟（P2 / C 遗留补齐 + P3 / D 简版 RAG）。
 *
 * 与 verify-ai-agent-gui.mjs 的区别：那个脚本在「无 Key」离线状态下验证配置与
 * UI 口径；本脚本在**本地 mock 模型服务**驱动下验证真实 tool calling 链路：
 *   user → 主进程 SSE 解析 tool_calls → 渲染层执行工具 → role:'tool' 回灌
 *   → 下一轮 → 写工具产出 AgentPatch → PatchPreview 人工确认 → commit → 落盘。
 *
 * 不需要真实 API Key / 不需要外网：mock 是脚本内起的 127.0.0.1 HTTP 服务，
 * 主进程用 Node fetch 访问（不受渲染层 CSP connect-src 'self' 限制）。
 * 独立 CDP 端口 9238、独立临时工作区、独立 Electron profile。
 *
 * 用法：node scripts/verify-ai-agent-tools-gui.mjs
 */
import puppeteer from 'puppeteer'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TOPOMIND_AI_TOOLS_CDP_PORT || 9238)
const CDP_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(os.tmpdir(), 'tm-ai-tools-gui-e2e')
const WORKDIR = path.join(ROOT, 'workdir')
const PROFILE = path.join(ROOT, 'profile')
const KB_NAME = 'AI工具冒烟库'
const KB_DIR = path.join(WORKDIR, 'kbs', KB_NAME)
const GRAPH_FILE = path.join(KB_DIR, '_graph.json')
const AI_DIR = path.join(WORKDIR, '.topomind', 'ai')
const CONFIG_FILE = path.join(AI_DIR, 'config.json')
const KEYRING_FILE = path.join(AI_DIR, 'keyring.json')
const AGENTS_FILE = path.join(AI_DIR, 'agents.json')
const INDEX_FILE = path.join(WORKDIR, '.topomind', 'ai-index', 'documents.json')
const SUB_AGENT_ID = 'sub.summary'
const SUB_PROMPT_MARKER = 'SUB_PROMPT_MARKER_9527'
const SUB_TASK_MARKER = 'SUB_DELEGATE_TASK_9527'
const SUB_ANSWER_MARKER = 'SUB_AGENT_ANSWER_9527'
// 标记一律不带下划线：AiMarkdown 的斜体解析会吃掉 `_`，导致 innerText 断言假失败。
const RAG_HIT_MARKER = 'RAGHIT9527'
const RAG_MISS_MARKER = 'RAGMISS9527'
const RAG_ANSWER_MARKER = 'RAGANSWER9527'
// 未命中场景用独立收尾标记：会话面板是累积的，共用标记会被上一条回答「假命中」。
const RAG_MISS_ANSWER_MARKER = 'RAGMISSANSWER9527'
// 达到轮次上限后的收尾答复标记：验证「到上限仍给出最终答案」而非硬掐断。
const LONGRUN_LIMIT_MARKER = 'LONGRUNLIMIT9527'
const ORCHESTRATOR_TOOL_IDS = [
  'workspace.getContext', 'document.read', 'document.search', 'graph.read',
  'graph.relations', 'kb.list', 'kb.ask', 'document.draft', 'document.polish',
  'document.outline', 'node.style', 'node.create', 'node.rename', 'node.link',
  'canvas.layout', 'cardspec.generate', 'agent.delegate',
]
// 文档夹具：放在 plain-a 的 _docs 下，tree.json + 物理文件成对存在，
// 才能被主进程 resolveDocumentById 的全库扫描识别（reconcile 会删掉无文件的索引项）。
const DOCS_DIR = path.join(KB_DIR, 'plain-a', '_docs')
const DRAFT_DOC = 'doc-draft-1'
const POLISH_DOC = 'doc-polish-1'
const CARD_DOC = 'doc-card-1'
const STALE_DOC = 'doc-stale-1'
const RAG_DOC = 'doc-rag-1'
const DRAFT_FILE = `${DRAFT_DOC}.tdoc.json`
const POLISH_FILE = `${POLISH_DOC}.tdoc.json`
const CARD_FILE = `${CARD_DOC}.cardspec.json`
const STALE_FILE = `${STALE_DOC}.tdoc.json`
const RAG_FILE = `${RAG_DOC}.tdoc.json`
// P5-r 附件回归夹具：引用预览必须和「节点关联文档 / 正常右栏」走同一套 adapter
// 附件解析链路，才能把文档里持久化的 `_attach/xxx` 相对引用变成 local-file://。
// 用 SVG 是为了夹具自包含（纯文本、无二进制 CRC 风险），listAttachments 也认图片。
const RAG_IMAGE_NAME = 'ref-preview.svg'
const RAG_IMAGE_REF = `_attach/${RAG_IMAGE_NAME}`
const ATTACH_DIR = path.join(KB_DIR, 'plain-a', '_attach')
const PANEL = '[data-tm-ai-agent-panel]'
const PREVIEW = '[data-tm-ai-patch-preview]'

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readGraph = () => (fs.existsSync(GRAPH_FILE) ? JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8')) : null)
const readAiConfig = () => (fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : null)
const docPath = (fileName) => path.join(DOCS_DIR, fileName)
const readJsonFile = (filePath) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}
const readDoc = (fileName) => readJsonFile(docPath(fileName))
const readDocRaw = (fileName) => {
  try { return fs.readFileSync(docPath(fileName), 'utf8') } catch { return null }
}
/** 递归找全库 .cardspec.json（含 AI 新建容器所在的新节点目录）。 */
function listCardspecFiles(base = KB_DIR, found = []) {
  if (!fs.existsSync(base)) return found
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name)
    if (entry.isDirectory()) listCardspecFiles(full, found)
    else if (entry.name.endsWith('.cardspec.json')) found.push(full)
  }
  return found
}
const graphSummary = () => {
  const g = readGraph()
  if (!g) return null
  const node = (id) => ({ name: g.children?.[id]?.name, x: g.children?.[id]?.x, y: g.children?.[id]?.y })
  return { nodes: Object.keys(g.children ?? {}).length, edges: (g.edges ?? []).length, a: node('plain-a'), b: node('plain-b') }
}

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

// ---------------------------------------------------------------------------
// 本地 mock 模型服务
// ---------------------------------------------------------------------------

/** SSE 帧：每帧一个完整 JSON，空行分隔；tool_calls 的 arguments 拆两帧模拟流式分片。 */
function toolCallFrames(calls) {
  const frames = []
  calls.forEach((call, index) => {
    frames.push({
      choices: [{ delta: { tool_calls: [{
        index, id: call.id, type: 'function',
        function: { name: call.name, arguments: '' },
      }] } }],
    })
  })
  calls.forEach((call, index) => {
    frames.push({
      choices: [{ delta: { tool_calls: [{
        index, function: { arguments: JSON.stringify(call.arguments) },
      }] } }],
    })
  })
  return frames
}

function textFrames(text) {
  return [{ choices: [{ delta: { content: text } }] }]
}

function writeSse(res, frames) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

/** 从回灌的 role:'tool' 消息里解析 workspace.getContext 给出的真实 roomPath。 */
function extractRoomPath(messages) {
  for (const item of messages) {
    if (item.role !== 'tool' || typeof item.content !== 'string') continue
    try {
      const parsed = JSON.parse(item.content)
      if (typeof parsed.roomPath === 'string') return parsed.roomPath
    } catch { /* 忽略非 JSON 的工具结果 */ }
  }
  return ''
}

function scenarioFromMessages(messages) {
  const users = messages.filter((item) => item.role === 'user' && typeof item.content === 'string')
  // 达到轮次上限时编排器会追加一条「请基于已有结果作答」的 user 提示，
  // 它不带场景标记；从后往前找第一条含标记的用户消息，才能继续命中原场景。
  for (let i = users.length - 1; i >= 0; i -= 1) {
    const match = /\[SCENARIO:([a-z]+)\]/.exec(users[i].content)
    if (match) return match[1]
  }
  return 'rename'
}

/** 每个场景第 0 轮先读上下文（拿 roomPath），第 1 轮起才产目标写工具。 */
function responseFor(scenario, round, roomPath, toolText = '') {
  const readContext = { id: 'call_ctx', name: 'workspace_getContext', arguments: {} }
  if (round === 0) return toolCallFrames([readContext])

  if (scenario === 'rounds' && round === 1) {
    return toolCallFrames([{ id: 'call_graph', name: 'graph_read', arguments: { roomPath } }])
  }
  // 长轮次场景：每轮都只读，不产写工具，直到编排器因轮次上限发改「无 tools 收尾请求」，
  // mock 见 body.tools 为空才返回正文（见 createMockServer）。用来证明不再是 3 轮硬截断。
  if (scenario === 'longrun') {
    return toolCallFrames([{ id: `call_long_${round}`, name: 'workspace_getContext', arguments: {} }])
  }
  // S3：委托发生在第 1 轮；第 2 轮主会话收尾，避免无限自动循环。
  if ((scenario === 'delegate' || scenario === 'delegatebad') && round >= 2) {
    return textFrames('主会话已整合子智能体结论，本次委托结束。')
  }
  // P3：kb.ask 第 2 轮收尾，严格按工具回灌的引用编号作答；命中场景故意带一个
  // 伪造编号 [ref:9]，用于验证「只有真实映射过的编号才会渲染成可点引用」。
  if ((scenario === 'kbask' || scenario === 'kbaskmiss') && round >= 2) {
    if (scenario === 'kbaskmiss' || toolText.includes('未检索到')) {
      return textFrames(`${RAG_MISS_ANSWER_MARKER} ${RAG_MISS_MARKER}：未检索到相关内容，不编造引用。`)
    }
    const ref = /\[ref:(\d+)\]/.exec(toolText)?.[1] ?? ''
    return textFrames(`${RAG_ANSWER_MARKER} 依据检索片段作答${ref ? ` [ref:${ref}]` : ''}，并忽略伪造引用 [ref:9]；未产生任何变更建议。`)
  }

  const writers = {
    rename: () => ({ id: 'call_w', name: 'node_rename', arguments: { nodeId: 'plain-a', title: 'AI 改名节点' } }),
    rounds: () => ({ id: 'call_w', name: 'node_rename', arguments: { nodeId: 'plain-b', title: 'AI 多轮改名' } }),
    style: () => ({
      id: 'call_w', name: 'node_style',
      arguments: { nodeIds: ['plain-a'], patch: { headerFontWeight: 'bold' } },
    }),
    link: () => ({
      id: 'call_w', name: 'node_link',
      arguments: { roomPath, source: 'plain-a', target: 'plain-b', relation: 'related', weight: 'main' },
    }),
    layout: () => ({
      id: 'call_w', name: 'canvas_layout',
      arguments: { roomPath, algorithm: 'grid', nodeIds: ['plain-a', 'plain-b'] },
    }),
    draft: () => ({
      id: 'call_w', name: 'document_draft',
      arguments: {
        documentId: DRAFT_DOC,
        afterBlockId: 'block-1',
        blocks: [
          { type: 'heading', text: 'AI 起草标题 DRAFT_MARKER', level: 2 },
          { type: 'paragraph', text: '本地 mock 生成的正文。' },
        ],
      },
    }),
    polish: () => ({
      id: 'call_w', name: 'document_polish',
      arguments: {
        documentId: POLISH_DOC,
        blockIds: ['block-1'],
        blocks: [{ type: 'paragraph', text: '润色后的正文 POLISH_MARKER。' }],
      },
    }),
    cardspec: () => ({
      id: 'call_w', name: 'cardspec_generate',
      arguments: {
        roomPath,
        title: 'AI 新建卡片',
        spec: {
          title: 'AI 新建卡片',
          layout: 'stack',
          components: [{ id: 'c-text-1', type: 'text', props: { text: 'CARDSPEC_CREATE_MARKER' } }],
        },
      },
    }),
    cardupdate: () => ({
      id: 'call_w', name: 'cardspec_generate',
      arguments: {
        documentId: CARD_DOC,
        spec: {
          title: 'AI 更新卡片',
          layout: 'grid',
          components: [{ id: 'c-text-2', type: 'text', props: { text: 'CARDSPEC_UPDATE_MARKER' } }],
        },
      },
    }),
    stale: () => ({
      id: 'call_w', name: 'document_draft',
      arguments: {
        documentId: STALE_DOC,
        blocks: [{ type: 'paragraph', text: 'STALE_AI_MARKER' }],
      },
    }),
    delegate: () => ({
      id: 'call_w', name: 'agent_delegate',
      arguments: { subAgentId: SUB_AGENT_ID, task: `${SUB_TASK_MARKER} 请概括当前图谱` },
    }),
    delegatebad: () => ({
      id: 'call_w', name: 'agent_delegate',
      arguments: { subAgentId: 'sub.not-allowed', task: `${SUB_TASK_MARKER} 越权任务` },
    }),
    kbask: () => ({
      id: 'call_w', name: 'kb_ask',
      arguments: { question: `量子纠缠 ${RAG_HIT_MARKER} 讲了什么`, scope: 'all', topK: 3 },
    }),
    kbaskmiss: () => ({
      id: 'call_w', name: 'kb_ask',
      arguments: { question: `绝对不存在的检索词 ${RAG_MISS_MARKER}ZZZ`, scope: 'all', topK: 3 },
    }),
  }
  const build = writers[scenario] ?? writers.rename
  return toolCallFrames([build()])
}

function createMockServer() {
  const requests = []
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* 非法请求按空处理 */ }
      const messages = Array.isArray(body.messages) ? body.messages : []
      const toolMessages = messages.filter((item) => item.role === 'tool')
      // S3：子调用只有一条 user（委托任务），没有 [SCENARIO:*] 标记，按任务标记识别。
      const isSubRequest = messages.some((item) => item.role === 'user'
        && typeof item.content === 'string' && item.content.includes(SUB_TASK_MARKER))
      const scenario = isSubRequest ? 'sub' : scenarioFromMessages(messages)
      const seq = requests.length
      requests.push({
        seq,
        scenario,
        round: toolMessages.length,
        model: body.model,
        toolChoice: body.tool_choice,
        toolNames: (body.tools ?? []).map((item) => item?.function?.name).filter(Boolean),
        systemCount: messages.filter((item) => item.role === 'system').length,
        systemContent: String(messages.find((item) => item.role === 'system')?.content ?? ''),
        firstUser: String(messages.find((item) => item.role === 'user')?.content ?? ''),
        hasToolMessage: toolMessages.length > 0,
        // P3：检查 kb.ask 外发内容只含 [ref:i] / 标题 / 片段，不含 docId / cardPath。
        toolResults: toolMessages.map((item) => ({
          id: String(item.tool_call_id ?? ''),
          content: String(item.content ?? ''),
        })),
        hasAssistantToolCalls: messages.some((item) => item.role === 'assistant' && Array.isArray(item.tool_calls)),
        temperature: body.temperature,
        reasoningEffort: body.reasoning_effort,
        roomPath: extractRoomPath(messages),
        // 每次回答带唯一 token：避免「上一次回答的文案还在面板里」造成 waitFor 假通过。
        answerToken: `ANSWER_TOKEN_${seq}`,
        rawKeys: Object.keys(body).sort(),
      })
      if (isSubRequest) {
        writeSse(res, textFrames(`${SUB_ANSWER_MARKER}：图谱含 2 个普通节点，无额外关系。`))
        return
      }
      if (scenario === 'answer') {
        writeSse(res, textFrames(`本地 mock 已完成检索 ${requests.at(-1).answerToken}，未产生任何变更建议。`))
        return
      }
      // 轮次上限收尾请求不下发 tools：此时才给出最终正文，验证「达到上限仍作答」。
      if (scenario === 'longrun' && (body.tools ?? []).length === 0) {
        writeSse(res, textFrames(`${LONGRUN_LIMIT_MARKER}：已达到轮次上限，已基于前 ${toolMessages.length} 轮只读结果给出最终答复。`))
        return
      }
      const toolText = toolMessages.map((item) => String(item.content ?? '')).join('\n')
      writeSse(res, responseFor(scenario, toolMessages.length, extractRoomPath(messages), toolText))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests })
    })
  })
}

// ---------------------------------------------------------------------------
// 真机骨架（与其余 GUI 冒烟同构，端口 / 工作区完全隔离）
// ---------------------------------------------------------------------------

function setupWorkDir() {
  if (!ROOT.includes('tm-ai-tools-gui-e2e')) throw new Error('拒绝重建非测试目录: ' + ROOT)
  if (fs.existsSync(WORKDIR)) fs.rmSync(WORKDIR, { recursive: true, force: true })
  for (const d of ['kbs', 'logs']) fs.mkdirSync(path.join(WORKDIR, d), { recursive: true })
  fs.writeFileSync(path.join(WORKDIR, '_config.json'), JSON.stringify({ version: 1 }), 'utf8')
  fs.mkdirSync(KB_DIR, { recursive: true })
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    children: {
      'plain-a': { name: '普通节点 A', kind: 'knowledge', x: 80, y: 80 },
      'plain-b': { name: '普通节点 B', kind: 'knowledge', x: 80, y: 260 },
    },
    edges: [], zoom: 1, pan: { x: 0, y: 0 },
  }, null, 2), 'utf8')
  writeDocFixtures()
  writeAgentFixtures()
}

/** S3：真实 agents.json —— 1 个 orchestrator + 1 个白名单内的子 Agent。 */
function writeAgentFixtures() {
  fs.mkdirSync(AI_DIR, { recursive: true })
  const model = { reasoning: { mode: 'off', protocol: 'auto' } }
  const config = {
    schema: 'topomind.agent-config',
    version: 1,
    agents: [
      {
        schema: 'topomind.agent-definition', version: 1,
        id: 'main.orchestrator', name: '调度指挥官', description: '测试用总调度 Agent',
        kind: 'orchestrator',
        systemPrompt: '你是总调度 Agent。需要子任务时调用 agent.delegate。本次会话可用工具：{{tools}}。',
        promptVars: ['tools'], model, toolIds: ORCHESTRATOR_TOOL_IDS,
        enabled: true, origin: 'user', tags: [],
      },
      {
        schema: 'topomind.agent-definition', version: 1,
        id: SUB_AGENT_ID, name: '图谱摘要子助手', description: '只做只读概括',
        kind: 'sub',
        systemPrompt: `你是摘要子智能体。${SUB_PROMPT_MARKER} 只回答事实。本次会话可用工具：{{tools}}。`,
        promptVars: ['tools'], model,
        toolIds: ['workspace.getContext', 'graph.read'],
        enabled: true, origin: 'user', tags: [],
      },
    ],
    orchestratorId: 'main.orchestrator',
    allowedSubAgentIds: [SUB_AGENT_ID],
  }
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(config, null, 2), 'utf8')
}

/** 4 份真实结构化文档：2 份 smart（起草 / 润色 / 陈旧校验）、1 份 cardspec、1 份占位。 */
function writeDocFixtures() {
  fs.mkdirSync(DOCS_DIR, { recursive: true })
  // 附件物理目录在目标节点下（与 _docs 同级）：cardPath = AI工具冒烟库/plain-a。
  // 预览层必须按目标文档的 cardPath 解析这里的 _attach 引用，不能用当前选中节点。
  fs.mkdirSync(ATTACH_DIR, { recursive: true })
  fs.writeFileSync(path.join(ATTACH_DIR, RAG_IMAGE_NAME),
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8" fill="#d33"/></svg>', 'utf8')
  const now = Date.now()
  const smart = (title, text) => ({
    schema: 'topomind.smart-document',
    version: 1,
    title,
    blocks: [{ id: 'block-1', type: 'paragraph', content: text }],
    metadata: { createdAt: now, updatedAt: now, editor: 'blocknote', blocknoteVersion: '0.51.2' },
  })
  // RAG 命中文档里额外放一张图片块：正文能出来不代表图片能出来，两者解析链路不同。
  const ragDoc = smart('量子纠缠检索笔记',
    `量子纠缠是 ${RAG_HIT_MARKER} 的核心概念，可用于本地知识库检索与引用定位。`)
  ragDoc.blocks.push({
    id: 'block-rag-image',
    type: 'image',
    props: {
      url: RAG_IMAGE_REF,
      attachmentRef: RAG_IMAGE_REF,
      name: RAG_IMAGE_NAME,
      caption: '引用预览附件图',
    },
  })
  const fixture = [
    [DRAFT_DOC, DRAFT_FILE, 'smart', '起草测试文档', smart('起草测试文档', '原文段落')],
    [POLISH_DOC, POLISH_FILE, 'smart', '润色测试文档', smart('润色测试文档', '待润色原文')],
    [CARD_DOC, CARD_FILE, 'cardspec', '卡片测试文档', {
      schema: 'topomind.card-spec',
      version: 1,
      title: '卡片测试文档',
      layout: 'stack',
      components: [{ id: 'c-origin', type: 'text', props: { text: '原始组件' } }],
      metadata: { createdAt: now, updatedAt: now, generatedBy: 'user' },
    }],
    [STALE_DOC, STALE_FILE, 'smart', '陈旧校验文档', smart('陈旧校验文档', '预览前的原文')],
    // P3：RAG 命中夹具。正文同时包含检索词与唯一标记，供索引 / 外发片段断言。
    [RAG_DOC, RAG_FILE, 'smart', '量子纠缠检索笔记', ragDoc],
  ]
  const documents = {}
  fixture.forEach(([id, fileName, type, title, content], index) => {
    fs.writeFileSync(docPath(fileName), JSON.stringify(content, null, 2), 'utf8')
    documents[id] = {
      id, type, title, path: fileName, parentId: null, sortOrder: index,
      createdAt: now, updatedAt: now, version: 1,
    }
  })
  fs.writeFileSync(path.join(DOCS_DIR, 'tree.json'), JSON.stringify({ version: 2, documents }, null, 2), 'utf8')
}

async function cdpReachable() {
  try {
    const r = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1200) })
    return r.ok
  } catch { return false }
}

async function connectOrLaunch() {
  if (await cdpReachable()) return null
  const electronRoot = path.join(process.cwd(), 'node_modules', 'electron')
  const exe = process.platform === 'darwin'
    ? (() => {
        const pathTxt = path.join(electronRoot, 'path.txt')
        const rel = fs.existsSync(pathTxt)
          ? fs.readFileSync(pathTxt, 'utf8').trim()
          : 'Electron.app/Contents/MacOS/Electron'
        return path.join(electronRoot, 'dist', rel)
      })()
    : path.join(electronRoot, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  if (!fs.existsSync(exe)) throw new Error('找不到 electron 可执行文件: ' + exe)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  // 真机冒烟只连本机 mock 服务。宿主（例如 IDE / CI）常注入 HTTP_PROXY，
  // Node 24 的 fetch 会把 127.0.0.1:<随机端口> 也交给代理，主进程便报
  // 「网络连接失败」而 mock 收不到任何请求。这里强制直连并显式声明 NO_PROXY。
  for (const key of [
    'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy',
    'ALL_PROXY', 'all_proxy', 'NODE_USE_ENV_PROXY',
  ]) delete env[key]
  env.NO_PROXY = '127.0.0.1,localhost,::1'
  env.no_proxy = '127.0.0.1,localhost,::1'
  const spawned = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'], {
    cwd: process.cwd(), env, stdio: 'ignore', detached: false,
  })
  for (let i = 0; i < 60; i += 1) {
    if (await cdpReachable()) return spawned
    await sleep(500)
  }
  spawned.kill()
  throw new Error('Electron 调试端口未就绪: ' + CDP_URL)
}

async function waitFor(page, fn, timeout = 12000, ...args) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await page.evaluate(fn, ...args)) return true
    await sleep(200)
  }
  return false
}

/** 图落盘是 debounce 异步写，断言前轮询文件内容而不是读一次就下结论。 */
async function waitForGraphChange(before, timeout = 8000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (JSON.stringify(readGraph()) !== before) return true
    await sleep(150)
  }
  return false
}

/** 文档写入是主进程同步落盘，但 IPC 回推到渲染层前有一帧延迟，统一轮询。 */
async function waitForDocChange(fileName, before, timeout = 8000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (readDocRaw(fileName) !== before) return true
    await sleep(150)
  }
  return false
}

/** cardspec.create 会在一个新节点目录下生成载荷文件，轮询「比基线多一份」。 */
async function waitForCardspecCreate(beforeCount, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const found = listCardspecFiles()
    if (found.length > beforeCount) return found.find((file) => !file.startsWith(DOCS_DIR)) ?? null
    await sleep(200)
  }
  return null
}

async function findRendererPage(browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let pages = []
    try { pages = await browser.pages() } catch { /* 启动期偶发 */ }
    for (const candidate of pages) {
      try { if (candidate.url().includes('index.html')) return candidate } catch { /* 忽略 */ }
    }
    await sleep(300)
  }
  throw new Error('找不到 renderer 页面')
}

async function openKnowledgeBase(page) {
  return page.evaluate((name) => {
    const els = [...document.querySelectorAll('*')].filter((e) =>
      e.children.length === 0 && (e.textContent || '').includes(name))
    if (!els.length) return false
    els[0].parentElement?.click()
    return true
  }, KB_NAME)
}

async function ensureCanvas(page) {
  if (await waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="plain-a"]'), 4000)) return true
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => document.querySelector('[data-tm-nav-item="home"]')?.click())
    await sleep(450)
    await openKnowledgeBase(page)
    await sleep(900)
    if (await waitFor(page, () => !!document.querySelector('.react-flow__node[data-id="plain-a"]'), 4000)) return true
  }
  return false
}

async function enterWorkspace(page) {
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate((dir) => {
    localStorage.setItem('topomind_last_workspace', dir)
    localStorage.setItem('topomind_recent_workspaces', JSON.stringify([{ path: dir, lastOpened: Date.now() }]))
    localStorage.removeItem('topomind_node_tree_expanded_v2')
    localStorage.removeItem('topomind_left_dock_width_v1')
    localStorage.removeItem('topomind:ai-reasoning-mode')
    localStorage.removeItem('topomind:ai-reasoning-protocol')
  }, WORKDIR)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2200)
  return ensureCanvas(page)
}

/**
 * AI 设置已迁到画布页覆盖式窗口：确保左栏 AI Agent 页展开 → 点齿轮（已开则不重复点）
 * → 切到目标 tab 并确认对应分区可见。窗口内两个分区常驻挂载，切 tab 不丢草稿。
 */
async function openSettings(page, tab = 'assistant') {
  if (!await openAgentPanel(page)) return false
  await page.evaluate(() => {
    if (document.querySelector('[data-tm-ai-settings-window]')) return
    document.querySelector('[data-tm-ai-settings-toggle]')?.click()
  })
  if (!await waitFor(page, () => !!document.querySelector('[data-tm-ai-settings-window]'), 10000)) return false
  await page.evaluate((id) => document.querySelector(`[data-tm-ai-settings-tab="${id}"]`)?.click(), tab)
  // 分区首次挂载会异步读主进程 AI 配置并回填输入框，等一拍再开始填写。
  await sleep(500)
  return waitFor(page, (id) => {
    const pane = document.querySelector(`[data-tm-ai-settings-pane="${id}"]`)
    return !!pane && !pane.hidden
  }, 8000, tab)
}

async function openAgentPanel(page) {
  const onCanvas = await ensureCanvas(page)
  if (!onCanvas) return false
  // DockTab 是 toggle：面板已激活时再点一次会把它收起。设置页返回画布时
  // agent 面板本来就还开着，这里必须先判存在，避免把已打开的面板点关。
  if (await page.evaluate(() => !!document.querySelector('[data-tm-ai-agent-panel]'))) return true
  await page.evaluate(() => document.querySelector('[data-tm-left-dock-tab="agent"]')?.click())
  return waitFor(page, () => !!document.querySelector('[data-tm-ai-agent-panel]'), 10000)
}

async function clickButton(page, scope, text) {
  return page.evaluate((sel, label) => {
    const root = document.querySelector(sel)
    if (!root) return false
    const button = [...root.querySelectorAll('button')]
      .find((item) => (item.textContent || '').trim() === label
        || (item.textContent || '').trim().includes(label))
    if (!button || button.disabled) return false
    button.click()
    return true
  }, scope, text)
}

async function typeInto(page, selector, text) {
  await page.focus(selector)
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await page.keyboard.type(text)
}

async function configureMockBackend(page, port) {
  await typeInto(page, '#ai-base-url', `http://127.0.0.1:${port}/v1`)
  await typeInto(page, '#ai-model', 'mock-model')
  await typeInto(page, '#ai-api-key', 'local-mock-key')
  const clicked = await clickButton(page, '[data-tm-settings-ai]', '保存')
  if (!clicked) return false
  for (let i = 0; i < 40; i += 1) {
    if (fs.existsSync(KEYRING_FILE) && readAiConfig()?.config?.baseURL?.includes(String(port))) return true
    await sleep(200)
  }
  return false
}

async function previewState(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return null
    const items = [...root.querySelectorAll('[data-tm-ai-patch-item]')].map((li) => ({
      op: li.querySelector('span')?.textContent?.trim() || '',
      text: li.innerText || '',
      disabled: !!li.querySelector('input[type="checkbox"]')?.disabled,
      checked: !!li.querySelector('input[type="checkbox"]')?.checked,
    }))
    return {
      header: root.innerText.slice(0, 120).replace(/\n/g, ' | '),
      items,
      checkedCount: items.filter((item) => item.checked).length,
      applyDisabled: [...root.querySelectorAll('button')]
        .find((item) => (item.textContent || '').includes('应用所选'))?.disabled ?? true,
    }
  }, PREVIEW)
}

async function clearPreview(page) {
  const exists = await page.evaluate((sel) => !!document.querySelector(sel), PREVIEW)
  if (!exists) return true
  await clickButton(page, PREVIEW, '放弃')
  return waitFor(page, (sel) => !document.querySelector(sel), 5000, PREVIEW)
}

/**
 * 发送一条带场景标记的消息。
 * 写场景等 PatchPreview；纯文本场景等「本次请求已被 mock 收到」+「回答气泡已渲染」，
 * 不依赖 token 文本本身（Markdown 渲染可能对下划线做处理）。
 */
async function sendScenario(page, scenario, answer, mockRequests) {
  await typeInto(page, '[data-tm-ai-composer]', `[SCENARIO:${scenario}] 请按工具执行`)
  const sent = await clickButton(page, PANEL, '发送')
  if (!sent) return false
  if (answer) {
    const end = Date.now() + 20000
    while (Date.now() < end) {
      const requestSeen = mockRequests.some((item) => item.seq === answer.beforeSeq)
      const rendered = await page.evaluate(() =>
        (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').includes('本地 mock 已完成检索'))
      if (requestSeen && rendered) return true
      await sleep(200)
    }
    return false
  }
  return waitFor(page, () => !!document.querySelector('[data-tm-ai-patch-preview]'), 20000)
}

/** 纯文本场景：token 用发送前的请求序号，mock 端按同一序号生成。 */
function answerToken(mock) {
  return `ANSWER_TOKEN_${mock.requests.length}`
}

function answerArgs(mock) {
  return { beforeSeq: mock.requests.length, token: answerToken(mock) }
}

/**
 * P3：kb.ask 是只读检索，不产 PatchPreview。两个场景使用不同的收尾标记，避免
 * 「历史回答里已有旧标记」造成 waitFor 假通过；同时等本场景第 2 轮请求真的
 * 到达 mock、且面板的「停止」按钮消失，确保 tool 回灌与流式回答都已完成。
 */
async function sendKbAsk(page, scenario, mockRequests, beforeSeq) {
  const marker = scenario === 'kbaskmiss' ? RAG_MISS_ANSWER_MARKER : RAG_ANSWER_MARKER
  await typeInto(page, '[data-tm-ai-composer]', `[SCENARIO:${scenario}] 请检索知识库`)
  const sent = await clickButton(page, PANEL, '发送')
  if (!sent) return false
  const end = Date.now() + 30000
  while (Date.now() < end) {
    const finalRoundSeen = mockRequests.some((item) => item.seq >= beforeSeq
      && item.scenario === scenario && item.round >= 2)
    const state = await page.evaluate((m) => {
      const panel = document.querySelector('[data-tm-ai-agent-panel]')
      if (!panel) return { rendered: false, stopped: false }
      return {
        rendered: (panel.innerText || '').includes(m),
        stopped: ![...panel.querySelectorAll('button')]
          .some((item) => (item.textContent || '').includes('停止')),
      }
    }, marker)
    if (finalRoundSeen && state.rendered && state.stopped) return true
    await sleep(200)
  }
  return false
}

// ---------------------------------------------------------------------------

async function main() {
  setupWorkDir()
  check('隔离测试库构造完成', fs.existsSync(GRAPH_FILE) && !fs.existsSync(CONFIG_FILE))

  const mock = await createMockServer()
  const baseURL = `http://127.0.0.1:${mock.port}/v1`
  console.log(`mock 模型服务已启动: ${baseURL}\n`)

  const spawned = await connectOrLaunch()
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 300000 })
  const pageErrors = []
  const externalRequests = []
  try {
    const page = await findRendererPage(browser)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      const url = request.url()
      if (/^https?:\/\//.test(url)
        && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
        externalRequests.push(url)
      }
    })

    check('进入工作空间并渲染普通节点', await enterWorkspace(page))

    // ===== A. 配置指向本地 mock =====
    check('打开 AI 设置窗口并填写 mock 服务地址 / 模型 / Key', await openSettings(page))
    check('AI 配置与加密 Key 落盘到测试工作区', await configureMockBackend(page, mock.port),
      JSON.stringify({ baseURL: readAiConfig()?.config?.baseURL, hasKeyring: fs.existsSync(KEYRING_FILE) }))
    check('打开 AI Agent 会话面板', await openAgentPanel(page))

    // ===== B. 纯文本回答（无 tool_call）仍按 P0 语义结束 =====
    const firstAnswer = answerArgs(mock)
    const answerBefore = firstAnswer.beforeSeq
    check('发送纯文本场景', await sendScenario(page, 'answer', firstAnswer, mock.requests))
    const answerRequest = mock.requests[answerBefore]
    check('本次回答确由本地 mock 产生（唯一 token 命中）',
      answerRequest?.answerToken === firstAnswer.token,
      JSON.stringify({ expected: firstAnswer.token, got: answerRequest?.answerToken }))
    console.log('[diagnostic] 首个回答后面板文本尾部:',
      JSON.stringify(await page.evaluate(() =>
        (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').slice(-260))))
    check('请求体下发 17 个工具 schema（含 kb_ask）与 tool_choice=auto',
      answerRequest?.toolNames.length === 17 && answerRequest?.toolChoice === 'auto'
      && answerRequest?.toolNames.includes('kb_ask'),
      JSON.stringify({ count: answerRequest?.toolNames.length, choice: answerRequest?.toolChoice }))
    check('单 system：请求体恰好一条 system，且不把调用方原始消息当 system',
      answerRequest?.systemCount === 1,
      JSON.stringify({ systemCount: answerRequest?.systemCount }))
    check('纯文本回答不产生变更预览',
      await page.evaluate((sel) => !document.querySelector(sel), PREVIEW))

    // ===== C. 图类 / 文档类 / CardSpec 类：逐场景驱动真实 tool calling + 人工确认 + 落盘 =====
    const scenarios = [
      { key: 'rounds', label: '多轮编排（读 → 读 → 写，3 轮）', op: 'node.rename', kind: 'graph' },
      { key: 'rename', label: '节点改名', op: 'node.rename', kind: 'graph' },
      { key: 'style', label: '节点样式', op: 'node.style', kind: 'graph' },
      { key: 'link', label: '节点连线', op: 'edge.create', kind: 'graph' },
      { key: 'layout', label: '画布布局', op: 'canvas.layout', kind: 'graph' },
      {
        key: 'draft', label: '文档起草（块级写入）', op: 'document.insert_blocks',
        kind: 'document', file: DRAFT_FILE, marker: 'DRAFT_MARKER',
        verify: (doc, before) => {
          const blocks = doc?.blocks ?? []
          return blocks.length === 3 && blocks[0]?.id === 'block-1'
            && JSON.stringify(doc).includes('DRAFT_MARKER')
            && !JSON.stringify(before).includes('DRAFT_MARKER')
            && doc?.metadata?.generatedBy === 'ai'
        },
      },
      {
        key: 'polish', label: '文档润色（按块 id 替换）', op: 'document.replace_blocks',
        kind: 'document', file: POLISH_FILE, marker: 'POLISH_MARKER',
        verify: (doc, before) => (doc?.blocks ?? []).length === 1
          && JSON.stringify(doc).includes('POLISH_MARKER')
          && !JSON.stringify(before).includes('POLISH_MARKER')
          && doc?.metadata?.generatedBy === 'ai',
      },
      {
        key: 'cardupdate', label: '知识卡片更新（CardSpec 写入）', op: 'cardspec.update',
        kind: 'document', file: CARD_FILE, marker: 'CARDSPEC_UPDATE_MARKER',
        verify: (doc, before) => doc?.schema === 'topomind.card-spec'
          && doc?.layout === 'grid'
          && doc?.components?.[0]?.props?.text === 'CARDSPEC_UPDATE_MARKER'
          && doc?.metadata?.generatedBy === 'ai'
          && !JSON.stringify(before).includes('CARDSPEC_UPDATE_MARKER'),
      },
      { key: 'cardspec', label: '知识卡片新建（容器 + 载荷）', op: 'cardspec.create', kind: 'cardspec-create' },
    ]

    for (const scenario of scenarios) {
      await clearPreview(page)
      const before = mock.requests.length
      const graphBefore = JSON.stringify(readGraph())
      const docBefore = scenario.file ? readDocRaw(scenario.file) : null
      const cardspecFileCount = scenario.kind === 'cardspec-create' ? listCardspecFiles().length : 0
      check(`[${scenario.label}] 发送消息并产出变更预览`, await sendScenario(page, scenario.key))
      const state = await previewState(page)
      const roundRequests = mock.requests.slice(before)
      const toolRounds = await page.evaluate(() =>
        [...document.querySelectorAll('[data-tm-ai-tool-round]')].map((item) => item.innerText.slice(0, 90)))
      check(`[${scenario.label}] 模型请求含 tool 回灌消息与 assistant.tool_calls`,
        roundRequests.length >= 2 && roundRequests.some((item) => item.hasToolMessage)
        && roundRequests.some((item) => item.hasAssistantToolCalls),
        JSON.stringify(roundRequests.map((item) => ({ round: item.round, tool: item.hasToolMessage }))))
      check(`[${scenario.label}] 工具调用轮次记录可折叠查看（${toolRounds.length} 轮）`,
        toolRounds.length >= (scenario.key === 'rounds' ? 3 : 2),
        JSON.stringify(toolRounds))
      check(`[${scenario.label}] 预览含 ${scenario.op} 且状态为可提交`,
        !!state && state.items.some((item) => item.op === scenario.op)
        && state.items.every((item) => item.disabled === false),
        JSON.stringify(state?.items.map((item) => ({ op: item.op, disabled: item.disabled, text: item.text.slice(0, 100) }))))

      check(`[${scenario.label}] 默认勾选可提交项且「应用所选」可用`,
        state?.checkedCount > 0 && state?.applyDisabled === false,
        JSON.stringify({ checked: state?.checkedCount, applyDisabled: state?.applyDisabled }))
      const appliedBefore = await page.evaluate(() =>
        (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').split('已应用').length - 1)
      const applied = await clickButton(page, PREVIEW, '应用所选')
      // 面板会累积历史提示：按「新增一条已应用」计数，避免上一场景的文案造成假通过。
      const appliedNote = await waitFor(page, (count) =>
        (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').split('已应用').length - 1 > count,
      8000, appliedBefore)
      check(`[${scenario.label}] 人工确认后真正提交并回写提示`, applied && appliedNote)

      if (scenario.kind === 'graph') {
        const graphChanged = await waitForGraphChange(graphBefore)
        check(`[${scenario.label}] 提交后 _graph.json 发生真实变化`, graphChanged,
          graphChanged ? JSON.stringify(graphSummary()) : `轮询 8s 内文件未变化 | ${JSON.stringify(graphSummary())}`)
        console.log('[diagnostic]', scenario.key, '应用后落盘摘要:', JSON.stringify(graphSummary()))
      } else if (scenario.kind === 'document') {
        const changed = await waitForDocChange(scenario.file, docBefore)
        check(`[${scenario.label}] 提交后 ${scenario.file} 发生真实变化`, changed,
          changed ? `写入 ${readDocRaw(scenario.file)?.length ?? 0} 字节` : '轮询 8s 内文件未变化')
        const doc = readDoc(scenario.file)
        const verified = !!doc && scenario.verify(doc, JSON.parse(docBefore || '{}'))
        check(`[${scenario.label}] 正文内容与 AI 来源标记符合预期`, verified,
          JSON.stringify({
            schema: doc?.schema, layout: doc?.layout, blocks: doc?.blocks?.length,
            components: doc?.components?.length, generatedBy: doc?.metadata?.generatedBy,
          }))
      } else if (scenario.kind === 'cardspec-create') {
        const createdPath = await waitForCardspecCreate(cardspecFileCount)
        const createdDoc = createdPath ? readJsonFile(createdPath) : null
        const createdId = createdPath ? path.basename(createdPath, '.cardspec.json') : ''
        const createdTree = createdPath
          ? readJsonFile(path.join(path.dirname(createdPath), 'tree.json')) : null
        check(`[${scenario.label}] .cardspec.json 载荷与 tree.json 索引同步落盘`,
          !!createdPath && createdDoc?.schema === 'topomind.card-spec'
          && createdDoc?.metadata?.generatedBy === 'ai'
          && JSON.stringify(createdDoc).includes('CARDSPEC_CREATE_MARKER')
          && !!createdTree?.documents?.[createdId],
          JSON.stringify({ createdPath, createdId, treeKeys: Object.keys(createdTree?.documents ?? {}) }))
        const graphChanged = await waitForGraphChange(graphBefore)
        const graph = readGraph()
        const containers = Object.values(graph?.children ?? {})
          .filter((child) => child?.container?.type === 'cardspec')
        check(`[${scenario.label}] _graph.json 新增容器节点并指向真实 documentId`,
          graphChanged && containers.some((child) => child.container.documentId === createdId),
          JSON.stringify({ graphChanged, containers }))
      }
    }
    console.log('[diagnostic] 各请求解析到的 roomPath:',
      JSON.stringify(mock.requests.map((item) => item.roomPath)))

    // ===== C2. 预览后磁盘内容变化 → 提交必须拒绝，绝不静默覆盖 =====
    await clearPreview(page)
    check('「陈旧写入」场景产出可提交预览', await sendScenario(page, 'stale'))
    const staleState = await previewState(page)
    check('陈旧场景预览项为可提交（提交时才做第二道摘要校验）',
      !!staleState && staleState.items.length === 1 && staleState.items[0].disabled === false
      && staleState.items[0].op === 'document.insert_blocks',
      JSON.stringify(staleState?.items))
    const stalePath = docPath(STALE_FILE)
    const userEdit = {
      ...readDoc(STALE_FILE),
      title: '用户手工改过的标题',
      blocks: [{ id: 'block-user', type: 'paragraph', content: 'USER_EDIT_MARKER' }],
    }
    fs.writeFileSync(stalePath, JSON.stringify(userEdit, null, 2), 'utf8')
    const externalSnapshot = fs.readFileSync(stalePath, 'utf8')
    const rejectedBefore = await page.evaluate(() =>
      (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').split('变更未应用').length - 1)
    await clickButton(page, PREVIEW, '应用所选')
    const rejected = await waitFor(page, (count) =>
      (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').split('变更未应用').length - 1 > count,
    8000, rejectedBefore)
    check('预览后文档被改动 → 提交被拒绝并明确提示「变更未应用」', rejected,
      JSON.stringify(await page.evaluate(() =>
        (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').slice(-200))))
    check('被拒绝的 AI 写入零落盘，用户手工内容未被覆盖',
      fs.readFileSync(stalePath, 'utf8') === externalSnapshot)
    await clearPreview(page)

    // ===== C3. S3 自动调度：真实 tool_call → 子 Agent 独立调用 → 委托卡片 =====
    await clearPreview(page)
    const delegateBefore = mock.requests.length
    await typeInto(page, '[data-tm-ai-composer]', '[SCENARIO:delegate] 请委托子智能体概括图谱')
    check('[自动调度] 发起委托消息', await clickButton(page, PANEL, '发送'))
    check('[自动调度] 真实 tool_call 触发委托并渲染委托卡片',
      await waitFor(page, () => !!document.querySelector('[data-tm-ai-delegation]'), 25000))
    const card = await page.evaluate(() => {
      const root = document.querySelector('[data-tm-ai-delegation]')
      const text = (sel) => root?.querySelector(sel)?.textContent?.trim() ?? ''
      return {
        count: document.querySelectorAll('[data-tm-ai-delegation]').length,
        agent: text('[data-tm-ai-delegation-agent]'),
        prompt: text('[data-tm-ai-delegation-prompt]'),
        summary: text('[data-tm-ai-delegation-summary]'),
        meta: text('[data-tm-ai-delegation-meta]'),
        task: text('[data-tm-ai-delegation-task]'),
      }
    })
    check('[自动调度] 委托卡片展示子 Agent、生效 prompt、耗时与结果摘要',
      card.count === 1 && card.agent.includes('图谱摘要子助手')
      && card.prompt.includes(SUB_PROMPT_MARKER) && card.summary.includes(SUB_ANSWER_MARKER)
      && /耗时 \d+ms/.test(card.meta) && card.task.includes(SUB_TASK_MARKER),
      JSON.stringify(card))
    const delegateRequests = mock.requests.slice(delegateBefore)
    const subRequests = delegateRequests.filter((item) => item.scenario === 'sub')
    check('[自动调度] 子调用是独立请求：单 system 用子 Agent 自己的 prompt',
      subRequests.length >= 1 && subRequests.every((item) => item.systemCount === 1
        && item.systemContent.includes(SUB_PROMPT_MARKER)
        && !item.systemContent.includes('你是总调度 Agent')),
      JSON.stringify(subRequests.map((item) => ({ system: item.systemContent.slice(0, 120), tools: item.toolNames }))))
    check('[自动调度] 子调用只下发只读工具子集，且不含 agent_delegate（防递归）',
      subRequests.length >= 1 && subRequests.every((item) => item.toolNames.length === 2
        && item.toolNames.includes('graph_read')
        && !item.toolNames.includes('agent_delegate')
        && !item.toolNames.includes('node_rename')),
      JSON.stringify(subRequests.map((item) => item.toolNames)))
    check('[自动调度] 主会话把委托结果以 tool 消息回灌并继续下一轮',
      delegateRequests.some((item) => item.scenario === 'delegate' && item.hasToolMessage
        && item.hasAssistantToolCalls)
      && delegateRequests.filter((item) => item.scenario === 'delegate').length >= 3,
      JSON.stringify(delegateRequests.map((item) => ({ scenario: item.scenario, round: item.round }))))
    check('[自动调度] 委托不产生变更预览，子调用不会自动 commit',
      await page.evaluate((sel) => !document.querySelector(sel), PREVIEW))

    const badBefore = mock.requests.length
    await typeInto(page, '[data-tm-ai-composer]', '[SCENARIO:delegatebad] 请委托一个不在白名单的子智能体')
    await clickButton(page, PANEL, '发送')
    const badReady = await waitFor(page, () =>
      document.querySelectorAll('[data-tm-ai-delegation]').length >= 2, 25000)
    const badCard = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-tm-ai-delegation]')]
      const root = cards.at(-1)
      return { text: root?.innerText ?? '', count: cards.length }
    })
    check('[自动调度] 白名单外子 Agent 被拒绝且卡片明确标注失败原因',
      badReady && badCard.text.includes('失败') && badCard.text.includes('delegate_not_allowed'),
      JSON.stringify(badCard))
    check('[自动调度] 被拒绝的委托不会发起任何子调用请求',
      !mock.requests.slice(badBefore).some((item) => item.scenario === 'sub'),
      JSON.stringify(mock.requests.slice(badBefore).map((item) => item.scenario)))

    // ===== C4. P3 / D：简版 RAG 真机链路 + [ref:i] 引用跳转 =====
    await clearPreview(page)
    const ragBefore = mock.requests.length
    check('[简版 RAG] 首次问答触发 kb_ask 并产出带引用的回答',
      await sendKbAsk(page, 'kbask', mock.requests, ragBefore))
    const ragRequests = mock.requests.slice(ragBefore)
    check('[简版 RAG] 请求含 kb_ask 工具且检索结果以 role:tool 回灌',
      ragRequests.length >= 3 && ragRequests.every((item) => item.toolNames.includes('kb_ask'))
      && ragRequests.some((item) => item.hasToolMessage && item.hasAssistantToolCalls),
      JSON.stringify(ragRequests.map((item) => ({ round: item.round, tools: item.toolNames.length }))))
    const ragToolText = ragRequests
      .flatMap((item) => item.toolResults ?? [])
      .filter((item) => item.content.includes('本地知识库检索'))
      .map((item) => item.content).join('\n')
    check('[简版 RAG] 外发片段含 [ref:1] 与命中标记，且不含 docId / cardPath / 磁盘路径',
      /\[ref:1\]/.test(ragToolText) && ragToolText.includes(RAG_HIT_MARKER)
      && !ragToolText.includes(RAG_DOC)
      && !ragToolText.includes(`${KB_NAME}/plain-a`)
      && !ragToolText.includes(WORKDIR.replace(/\\/g, '/')),
      JSON.stringify(ragToolText.slice(0, 260)))
    const indexAfterHit = readJsonFile(INDEX_FILE)
    const indexKeys = Object.keys(indexAfterHit?.sources ?? {})
    check('[简版 RAG] 首次问答才建倒排索引：只索引 .tdoc / .tmind，不索引 .cardspec',
      !!indexAfterHit && indexAfterHit.version === 1
      && indexKeys.some((key) => key.includes(RAG_FILE))
      && !indexKeys.some((key) => key.includes(CARD_FILE))
      && Object.keys(indexAfterHit.postings ?? {}).length > 0,
      JSON.stringify({ sources: indexKeys.length, terms: Object.keys(indexAfterHit?.postings ?? {}).length }))
    const refButtons = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-tm-ai-ref]')]
      return {
        refs: buttons.map((item) => item.getAttribute('data-tm-ai-ref')),
        titles: buttons.map((item) => item.getAttribute('title') ?? ''),
        fake: !!document.querySelector('[data-tm-ai-ref="9"]'),
        panel: (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').slice(-260),
      }
    })
    check('[简版 RAG] 回答里的 [ref:1] 渲染成可点引用，伪造编号 [ref:9] 保持纯文本',
      refButtons.refs.includes('1') && !refButtons.fake
      && refButtons.titles.some((title) => title.includes('量子纠缠')),
      JSON.stringify(refButtons))
    // P5-r：编号不再是给用户看的最终形态。chip 直接显示文档名，回答末尾的
    // 来源清单展开「文档 / 节点 / 块」三层名字，且不能把裸 cardPath id 露出来。
    const expectedNodeName = String(graphSummary()?.a?.name ?? '普通节点 A')
    const refReadable = await page.evaluate((nodeName) => {
      const chip = [...document.querySelectorAll('[data-tm-ai-ref="1"]')].at(-1)
      const sources = [...document.querySelectorAll('[data-tm-ai-ref-sources]')].at(-1)
      const item = [...document.querySelectorAll('[data-tm-ai-ref-source="1"]')].at(-1)
      return {
        chipText: chip?.textContent ?? '',
        chipLabel: chip?.getAttribute('data-tm-ai-ref-label') ?? '',
        chipTitle: chip?.getAttribute('title') ?? '',
        hasSources: !!sources,
        sourcesText: sources?.textContent ?? '',
        itemText: item?.textContent ?? '',
        expectedName: nodeName,
      }
    }, expectedNodeName)
    check('[P5-r 引用可读名] 按钮显示文档名，来源清单展开节点 / 块名',
      refReadable.chipLabel === '量子纠缠检索笔记'
      && refReadable.chipText.includes('量子纠缠检索笔记')
      && !refReadable.chipText.includes('[ref:1]')
      && refReadable.chipTitle.includes('节点：')
      && refReadable.hasSources
      && refReadable.sourcesText.includes('参考来源')
      && refReadable.itemText.includes(refReadable.expectedName)
      && /段落|标题|列表项|脑图/.test(refReadable.itemText)
      && !refReadable.itemText.includes('plain-a'),
      JSON.stringify(refReadable))
    // P5-r：点 [ref:i] 只是右栏临时预览目标文档，画布的房间 / 知识库 / 选中节点
    // 一律不动。先点画布空白处清空选中，再点引用，验证「零联动」。
    const paneBox = await page.evaluate(() => {
      const el = document.querySelector('.react-flow__pane')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    if (paneBox) await page.mouse.click(paneBox.x + paneBox.width - 30, paneBox.y + paneBox.height - 30)
    const selectionCleared = await waitFor(page, () =>
      document.querySelectorAll('.react-flow__node.selected').length === 0, 4000)
    check('[P5-r 引用预览] 前置条件：画布当前没有选中任何节点', selectionCleared,
      JSON.stringify(await page.evaluate(() => document.querySelectorAll('.react-flow__node.selected').length)))
    const readCanvas = () => page.evaluate(() => ({
      nodes: [...document.querySelectorAll('.react-flow__node')]
        .map((node) => node.getAttribute('data-id')).sort(),
      selected: document.querySelectorAll('.react-flow__node.selected').length,
    }))
    const canvasBefore = await readCanvas()
    const refClicked = await page.evaluate(() => {
      const button = document.querySelector('[data-tm-ai-ref="1"]')
      if (!button) return false
      button.click()
      return true
    })
    check('[简版 RAG] 点击引用打开右栏只读预览，未产生未捕获异常',
      refClicked && pageErrors.length === 0,
      JSON.stringify({ clicked: refClicked, errors: pageErrors.slice(0, 2) }))
    const previewShown = await waitFor(page, () => {
      const layer = document.querySelector('[data-tm-ai-reference-preview]')
      const text = layer?.textContent ?? ''
      return !!layer && text.includes('量子纠缠检索笔记') && text.includes('引用预览 · 只读')
    }, 10000)
    const previewBody = await waitFor(page, () => {
      const body = document.querySelector('[data-tm-ai-reference-preview-body]')
      return !!body && (body.textContent ?? '').includes('RAGHIT9527')
    }, 10000)
    // P5-r 附件回归：正文能显示不代表图片能显示。文档里图片持久化的是
    // `_attach/xxx` 相对引用，必须靠 adapter 的 listAttachments + resolveFileUrl
    // 解析成 local-file://；裸挂 SmartDocumentEditor 时这里会全部裂图。
    const previewImageLoaded = await waitFor(page, () => {
      const body = document.querySelector('[data-tm-ai-reference-preview-body]')
      if (!body) return false
      return [...body.querySelectorAll('img')].some((img) => {
        const src = img.getAttribute('src') ?? ''
        return src.startsWith('local-file://') && img.complete && img.naturalWidth > 0
      })
    }, 12000)
    const previewImageState = await page.evaluate(() => {
      const body = document.querySelector('[data-tm-ai-reference-preview-body]')
      return [...(body?.querySelectorAll('img') ?? [])].map((img) => ({
        src: (img.getAttribute('src') ?? '').slice(0, 180),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
      }))
    })
    check('[P5-r 引用预览] 文档内图片按目标节点附件目录解析成 local-file:// 并真实加载',
      previewImageLoaded,
      JSON.stringify(previewImageState))
    // 复用完整编辑器后，顶部工具栏的「样式 / 折叠」也必须在预览实例里禁用，
    // 否则只读预览里点一下就能改全局编辑器样式并落盘。
    const previewStyleLocked = await waitFor(page, () => {
      const layer = document.querySelector('[data-tm-ai-reference-preview]')
      const btn = layer?.querySelector('[data-tm-editor-style-trigger]')
      return !!btn && btn.disabled === true
    }, 8000)
    const previewToolbarState = await page.evaluate(() => {
      const layer = document.querySelector('[data-tm-ai-reference-preview]')
      const styleBtn = layer?.querySelector('[data-tm-editor-style-trigger]')
      const toggleBtn = layer?.querySelector('[data-tm-editor-top-toolbar-toggle]')
      return {
        styleExists: !!styleBtn,
        styleDisabled: styleBtn?.disabled ?? null,
        toggleExists: !!toggleBtn,
        toggleDisabled: toggleBtn?.disabled ?? null,
      }
    })
    check('[P5-r 引用预览] 只读隔离：预览实例的样式 / 折叠入口禁用，不改全局样式',
      previewStyleLocked && previewToolbarState.toggleDisabled === true,
      JSON.stringify(previewToolbarState))
    const refPanelText = await page.evaluate(() =>
      (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || '').slice(-600))
    check('[P5-r 引用预览] 无选中节点时点 [ref:1] 直接在右栏临时展示目标文档正文',
      refClicked && selectionCleared && previewShown && previewBody
      && !refPanelText.includes('请先在画布选中一个节点后重试')
      && pageErrors.length === 0,
      JSON.stringify({ previewShown, previewBody, oldHint: refPanelText.includes('请先在画布选中一个节点后重试'), errors: pageErrors.slice(0, 2) }))
    const canvasAfterClick = await readCanvas()
    check('[P5-r 引用预览] 画布零联动：不切房间/知识库、不自动选中目标节点',
      canvasAfterClick.selected === 0
      && JSON.stringify(canvasAfterClick.nodes) === JSON.stringify(canvasBefore.nodes)
      && !refPanelText.includes('请先在画布选中一个节点后重试'),
      JSON.stringify({ before: canvasBefore, after: canvasAfterClick }))
    const previewCloseClicked = await page.evaluate(() => {
      const button = document.querySelector('[data-tm-ai-reference-preview-close]')
      if (!button) return false
      button.click()
      return true
    })
    const previewClosed = previewCloseClicked && await waitFor(page, () =>
      !document.querySelector('[data-tm-ai-reference-preview]'), 5000)
    const canvasAfterClose = await readCanvas()
    check('[P5-r 引用预览] 「返回」关闭预览后右栏恢复，画布状态仍旧不变',
      previewClosed && canvasAfterClose.selected === 0
      && JSON.stringify(canvasAfterClose.nodes) === JSON.stringify(canvasBefore.nodes)
      && pageErrors.length === 0,
      JSON.stringify({ closed: previewClosed, after: canvasAfterClose, errors: pageErrors.slice(0, 2) }))

    await clearPreview(page)
    const missBefore = mock.requests.length
    check('[简版 RAG] 未命中场景给出明确回答',
      await sendKbAsk(page, 'kbaskmiss', mock.requests, missBefore))
    const missRequests = mock.requests.slice(missBefore)
    const missToolText = missRequests
      .flatMap((item) => item.toolResults ?? [])
      .filter((item) => item.content.includes('本地知识库检索'))
      .map((item) => item.content).join('\n')
    check('[简版 RAG] 未命中时要求模型说明「未检索到」且不产出任何引用编号',
      missToolText.includes('未检索到') && !/\[ref:\d+\]/.test(missToolText),
      JSON.stringify(missToolText.slice(0, 220)))
    const missPanelText = await page.evaluate(() =>
      (document.querySelector('[data-tm-ai-agent-panel]')?.innerText || ''))
    const missRefButtons = await page.evaluate(() =>
      document.querySelectorAll('[data-tm-ai-ref]').length)
    check('[简版 RAG] 回答明确说明未检索到相关内容，不编造可点引用',
      missPanelText.includes('未检索到相关内容') && missRefButtons === 0,
      JSON.stringify({ tail: missPanelText.slice(-220), refButtons: missRefButtons }))
    const indexAfterMiss = readJsonFile(INDEX_FILE)
    check('[简版 RAG] 源文件未变化 → 第二次问答不重建索引（增量生效）',
      !!indexAfterMiss && indexAfterMiss.generatedAt === indexAfterHit?.generatedAt,
      JSON.stringify({ before: indexAfterHit?.generatedAt, after: indexAfterMiss?.generatedAt }))

    // ===== D. 深度思考协议行为对比（mock 侧检查真实请求体，而非猜 UI 状态） =====
    const controls = '[data-tm-ai-agent-controls]'
    // 作用域限定在对话面板控件区：AI 设置窗口的「AI 智能体」分区有同名 aria-label。
    const sessionProtocol = `${controls} [aria-label="推理协议"]`
    check('深度思考切到「开启」并展开协议选择', await clickButton(page, controls, '开启')
      && await waitFor(page, () => !!document.querySelector('[data-tm-ai-agent-controls] [aria-label="推理协议"]'), 5000))
    await page.select(sessionProtocol, 'openai.reasoning_effort')
    await sleep(250)
    const onAnswer = answerArgs(mock)
    const onBefore = onAnswer.beforeSeq
    check('开启 + 手选 OpenAI 协议后发起纯文本请求',
      await sendScenario(page, 'answer', onAnswer, mock.requests))
    const onRequest = mock.requests.find((item) => item.seq === onBefore)
    check('协议协商生效：请求体带 reasoning_effort 且剔除冲突的 temperature',
      !!onRequest && onRequest.rawKeys.includes('reasoning_effort')
      && !onRequest.rawKeys.includes('temperature') && onRequest.reasoningEffort !== undefined,
      JSON.stringify({ keys: onRequest?.rawKeys, effort: onRequest?.reasoningEffort }))

    check('深度思考切回「关闭」', await clickButton(page, controls, '关闭'))
    const offAnswer = answerArgs(mock)
    const offBefore = offAnswer.beforeSeq
    check('关闭后发起纯文本请求', await sendScenario(page, 'answer', offAnswer, mock.requests))
    const offRequest = mock.requests.find((item) => item.seq === offBefore)
    check('关闭后请求体回到普通模式（无推理字段、采样参数恢复）',
      !!offRequest && !offRequest.rawKeys.includes('reasoning_effort')
      && offRequest.rawKeys.includes('temperature'),
      JSON.stringify({ keys: offRequest?.rawKeys }))

    // ===== E. 240 窄栏下 PatchPreview 排布 =====
    await page.evaluate(() => localStorage.setItem('topomind_left_dock_width_v1', '240'))
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(2000)
    check('240 窄栏下重新打开 AI Agent 面板', await openAgentPanel(page))
    check('240 窄栏下触发一次变更预览', await sendScenario(page, 'style'))
    const narrow = await page.evaluate((sel) => {
      const panel = document.querySelector('[data-tm-left-dock-panel="agent"]')
      const preview = document.querySelector(sel)
      const box = (el) => el ? { sw: el.scrollWidth, cw: el.clientWidth, w: Math.round(el.getBoundingClientRect().width) } : null
      return {
        panelW: Math.round(panel?.getBoundingClientRect().width ?? -1),
        preview: box(preview),
        buttonsVisible: [...(preview?.querySelectorAll('button') ?? [])]
          .every((item) => item.getBoundingClientRect().width > 0),
      }
    }, PREVIEW)
    check('240 窄栏下变更预览无横向溢出且按钮可见',
      narrow.panelW >= 235 && narrow.panelW <= 260 && !!narrow.preview
      && narrow.preview.sw <= narrow.preview.cw + 2 && narrow.buttonsVisible,
      JSON.stringify(narrow))
    await clearPreview(page)

    // ===== E2. S3 设置页自动调度白名单 =====
    check('打开 AI 设置窗口检查自动调度白名单', await openSettings(page, 'agents'))
    const allowlist = await page.evaluate(() => {
      const root = document.querySelector('[data-tm-agent-delegate-allowlist]')
      const boxes = [...(root?.querySelectorAll('input[type="checkbox"]') ?? [])]
      return {
        exists: !!root,
        total: boxes.length,
        checked: boxes.filter((box) => box.checked).length,
        labels: [...(root?.querySelectorAll('[data-tm-agent-delegate-option]') ?? [])]
          .map((item) => item.innerText.trim()),
      }
    })
    check('白名单只列出子 Agent 且已勾选，orchestrator 不在其中',
      allowlist.exists && allowlist.total === 1 && allowlist.checked === 1
      && !allowlist.labels.some((label) => label.includes('调度指挥官')),
      JSON.stringify(allowlist))
    // AI 设置窗口是画布页内的覆盖层，不再有独立 view tab：点关闭按钮即回到画布，
    // 左栏 dock 始终挂载，无需切标签页 / 整页重载。
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-close]')?.click())
    const closed = await waitFor(page, () => !document.querySelector('[data-tm-ai-settings-window]'), 6000)
    check('关闭 AI 设置窗口后回到画布且 AI Agent 面板仍可用',
      closed && await ensureCanvas(page) && await openAgentPanel(page))

    // ===== G. 工具轮次上限放开 + 达到上限仍给出最终答复 =====
    check('打开 AI 助手设置并把轮次上限调为 5 轮', await openSettings(page, 'assistant')
      && await page.evaluate(() => {
        const button = document.querySelector('[data-tm-ai-max-tool-rounds="5"]')
        if (!button) return false
        button.click()
        return true
      }))
    check('轮次上限写入偏好且按钮呈激活态', await waitFor(page, () =>
      localStorage.getItem('topomind:ai-max-tool-rounds') === '5'
      && document.querySelector('[data-tm-ai-max-tool-rounds="5"]')?.getAttribute('aria-pressed') === 'true', 6000))
    await page.evaluate(() => document.querySelector('[data-tm-ai-settings-close]')?.click())
    check('关闭设置窗口后回到会话面板',
      await waitFor(page, () => !document.querySelector('[data-tm-ai-settings-window]'), 6000)
      && await openAgentPanel(page))

    const longrunBefore = mock.requests.length
    await typeInto(page, '[data-tm-ai-composer]', '[SCENARIO:longrun] 请做多轮检索')
    check('发送长轮次只读任务', await clickButton(page, PANEL, '发送'))
    let longrunState = null
    const longrunEnd = Date.now() + 40000
    while (Date.now() < longrunEnd) {
      const finalSeen = mock.requests.slice(longrunBefore).some((item) =>
        item.scenario === 'longrun' && item.toolNames.length === 0)
      const state = await page.evaluate((m) => {
        const panel = document.querySelector('[data-tm-ai-agent-panel]')
        if (!panel) return { rendered: false, stopped: false, rounds: 0, text: '' }
        const text = panel.innerText || ''
        return {
          rendered: text.includes(m),
          stopped: ![...panel.querySelectorAll('button')]
            .some((item) => (item.textContent || '').includes('停止')),
          rounds: panel.querySelectorAll('[data-tm-ai-tool-round]').length,
          text: text.slice(-700),
        }
      }, LONGRUN_LIMIT_MARKER)
      if (finalSeen && state.rendered && state.stopped) {
        longrunState = state
        break
      }
      await sleep(200)
    }
    const longrunRequests = mock.requests.slice(longrunBefore)
    check('工具链路连续跑满 5 轮才收尾（不再是 3 轮硬截断）',
      !!longrunState && longrunState.rounds >= 5 && longrunRequests.length >= 6,
      JSON.stringify({ rounds: longrunState?.rounds, requests: longrunRequests.length }))
    check('收尾请求不下发 tools，且最后一轮工具结果确实回灌',
      longrunRequests.at(-1)?.toolNames.length === 0
      && longrunRequests.at(-1)?.hasToolMessage === true
      && longrunRequests.at(-1)?.hasAssistantToolCalls === true,
      JSON.stringify(longrunRequests.map((item) => ({
        round: item.round, tools: item.toolNames.length, toolMsg: item.hasToolMessage,
      }))))
    check('达到上限仍给出最终答复，而非只留一句「已达上限」',
      !!longrunState && longrunState.text.includes(LONGRUN_LIMIT_MARKER)
      && longrunState.text.includes('已达到工具调用轮次上限（5 轮）')
      && !longrunState.text.includes('本次自动检索结束'),
      JSON.stringify(longrunState?.text))

    // ===== F. 安全 =====
    check('mock 服务收到预期数量的请求（每写场景至少 2 轮）',
      mock.requests.length >= scenarios.length * 2,
      String(mock.requests.length))
    check('全流程零未捕获渲染异常、零外部网络请求',
      pageErrors.length === 0 && externalRequests.length === 0,
      JSON.stringify({ pageErrors: pageErrors.slice(0, 3), external: externalRequests.slice(0, 3) }))
  } finally {
    browser.disconnect()
    if (spawned) spawned.kill()
    mock.server.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.name).join(' | '))
    process.exitCode = 1
  } else {
    console.log('AI_AGENT_TOOLS_GUI_VERIFIED')
  }
}

main().catch((error) => {
  console.error('AI_AGENT_TOOLS_GUI_VERIFY_ERROR', error)
  process.exitCode = 1
})
