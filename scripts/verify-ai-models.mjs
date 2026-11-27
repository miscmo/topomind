/**
 * 多模型配置（P5）真跑契约。
 *
 * 与 verify-ai-agent-contracts 同口径：esbuild 把主进程存储 + 渲染层解析函数打成
 * 自包含 data URL 后在临时工作目录里真读写 config.json / keyring.json，不是文本匹配。
 * electron.safeStorage 用内存 mock 替换（加解密可逆），其余全部是生产代码。
 *
 * 手动运行：node scripts/verify-ai-models.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const mockElectron = {
  name: 'mock-electron-safe-storage',
  setup(ctx) {
    ctx.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'tm-mock' }))
    ctx.onLoad({ filter: /.*/, namespace: 'tm-mock' }, () => ({
      contents: [
        'export const safeStorage = {',
        '  isEncryptionAvailable: () => true,',
        '  encryptString: (text) => Buffer.from(`enc:${text}`),',
        '  decryptString: (buffer) => {',
        '    const raw = buffer.toString("utf8");',
        '    return raw.startsWith("enc:") ? raw.slice(4) : "";',
        '  },',
        '};',
      ].join('\n'),
      loader: 'js',
    }))
  },
}

const result = await build({
  stdin: {
    contents: [
      "import { createAiKeyStore, normalizeAiConfig, normalizeModelProfiles } from './electron/services/ai-key-store.js'",
      "import { normalizeAgentConfig } from './electron/services/ai-agent-store.js'",
      "import { resolveModelId } from './src/features/ai-agent/model/aiModelStore.ts'",
      'export { createAiKeyStore, normalizeAiConfig, normalizeModelProfiles, normalizeAgentConfig, resolveModelId }',
    ].join('\n'),
    resolveDir: ROOT,
    sourcefile: 'verify-ai-models-entry.js',
    loader: 'js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  plugins: [mockElectron],
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
  },
})
const bundle = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
)
const {
  createAiKeyStore, normalizeAiConfig, normalizeModelProfiles,
  normalizeAgentConfig, resolveModelId,
} = bundle

let checks = 0
const check = (label, fn) => {
  fn()
  checks += 1
  console.log(`  ok  ${label}`)
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-models-'))
const configPath = path.join(workDir, '.topomind', 'ai', 'config.json')
const keyringPath = path.join(workDir, '.topomind', 'ai', 'keyring.json')

try {
  const store = createAiKeyStore({ getWorkDir: () => workDir })

  check('老配置零迁移：无 models[] 时合成 1 个默认模型，顶层字段保持不变', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      config: {
        providerType: 'openai-compatible',
        baseURL: 'https://old.example/v1',
        model: 'old-model',
        temperature: 0.3,
        maxTokens: 1024,
        timeoutMs: 9000,
        contextBudget: 4000,
      },
    }, null, 2))
    const config = store.getPublicConfig()
    assert.equal(config.models.length, 1)
    assert.equal(config.models[0].model, 'old-model')
    assert.equal(config.models[0].baseURL, 'https://old.example/v1')
    assert.equal(config.defaultModelId, config.models[0].id)
    assert.equal(config.baseURL, 'https://old.example/v1')
    assert.equal(config.hasKey, false)
  })

  const legacyId = store.getPublicConfig().defaultModelId
  const secondId = 'model.second'

  check('新增 / 设为默认 / 专属 Key：顶层始终镜像默认模型', () => {
    const before = store.getPublicConfig()
    const saved = store.saveConfig({
      models: [
        { ...before.models[0], name: '甲模型' },
        { id: secondId, name: '乙模型', baseURL: 'https://b.example/v1', model: 'model-b' },
      ],
      defaultModelId: secondId,
      apiKey: 'shared-key',
      modelKeys: { [secondId]: 'own-key' },
    })
    assert.equal(saved.models.length, 2)
    assert.equal(saved.defaultModelId, secondId)
    assert.equal(saved.baseURL, 'https://b.example/v1')
    assert.equal(saved.model, 'model-b')
    assert.equal(saved.models[0].hasKey, true, '甲模型应回退共享 Key')
    assert.equal(saved.models[1].hasKey, true)
    assert.equal(saved.models.find((item) => item.id === secondId).model, 'model-b')
    // 新模型缺的参数继承旧顶层配置，不会出现 0 / NaN。
    assert.equal(saved.models.find((item) => item.id === secondId).timeoutMs, 9000)
  })

  check('resolveModel：专属 Key 优先、缺失回退共享、未知 id 回退默认', () => {
    const own = store.resolveModel(secondId)
    assert.equal(own.config.baseURL, 'https://b.example/v1')
    assert.equal(own.apiKey, 'own-key')
    assert.equal(store.resolveModel(legacyId).apiKey, 'shared-key')
    assert.equal(store.resolveModel('model.deleted').modelId, secondId)
  })

  check('clearKey 只清共享 Key，其它模型的专属 Key 不被误删', () => {
    const cleared = store.saveConfig({ clearKey: true })
    assert.equal(cleared.models.find((item) => item.id === secondId).hasKey, true)
    assert.equal(cleared.models.find((item) => item.id === legacyId).hasKey, false)
    assert.equal(store.resolveModel(secondId).apiKey, 'own-key')
    assert.equal(store.resolveModel(legacyId).apiKey, null)
  })

  check('删除模型：清理专属 Key，默认 id 自动落到仍存在的模型', () => {
    const before = store.getPublicConfig()
    const saved = store.saveConfig({
      models: before.models.filter((item) => item.id !== secondId),
      defaultModelId: secondId,
      clearModelKeys: [secondId],
    })
    assert.equal(saved.models.length, 1)
    assert.equal(saved.defaultModelId, legacyId)
    assert.equal(saved.baseURL, 'https://old.example/v1')
    assert.equal(store.resolveModel(secondId).apiKey, null)
  })

  check('旧接口只改顶层字段也会镜像进默认模型（既有 GUI 冒烟依赖）', () => {
    const saved = store.saveConfig({ baseURL: 'https://legacy.example/v1', model: 'legacy-model' })
    assert.equal(saved.baseURL, 'https://legacy.example/v1')
    assert.equal(saved.model, 'legacy-model')
    assert.equal(saved.models.find((item) => item.id === saved.defaultModelId).model, 'legacy-model')
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).config.model, 'legacy-model')
  })

  check('归一化丢弃未知字段 / 重复 id / 字面色值，且至少保留一个模型', () => {
    const profiles = normalizeModelProfiles([
      { id: 'dup', name: 'A', model: 'a' },
      { id: 'dup', name: 'B', model: 'b' },
    ], { baseURL: 'https://base.example/v1', model: 'base-model' })
    assert.equal(profiles.length, 2)
    assert.notEqual(profiles[0].id, profiles[1].id)
    assert.equal(profiles[0].baseURL, 'https://base.example/v1')
    assert.equal(normalizeModelProfiles([], {}).length, 1)
    const config = normalizeAiConfig({ model: 'keep', models: [], defaultModelId: 'missing' })
    assert.equal(config.defaultModelId, config.models[0].id)
    assert.equal(config.models[0].model, 'keep')
  })

  check('明文 Key 绝不写进 config.json，只以密文形式出现在 keyring.json', () => {
    const rawConfig = fs.readFileSync(configPath, 'utf8')
    const rawKeyring = fs.readFileSync(keyringPath, 'utf8')
    assert.ok(!rawConfig.includes('shared-key') && !rawConfig.includes('own-key'))
    assert.ok(!rawKeyring.includes('shared-key') && !rawKeyring.includes('own-key'))
  })

  check('Agent 定义保留 modelId，且仍拒绝连接配置字段', () => {
    const normalized = normalizeAgentConfig({
      version: 1,
      agents: [{
        id: 'orchestrator.a', name: 'A', kind: 'orchestrator',
        systemPrompt: 'hi', promptVars: [], toolIds: ['document.read'],
        modelId: secondId,
        model: { reasoning: { mode: 'auto', protocol: 'auto' }, baseURL: 'https://evil.example', apiKeyRef: 'x' },
      }],
      orchestratorId: 'orchestrator.a',
      allowedSubAgentIds: [],
    })
    assert.equal(normalized.agents[0].modelId, secondId)
    assert.equal(normalized.agents[0].model.baseURL, undefined)
    assert.equal(normalized.agents[0].model.apiKeyRef, undefined)
  })

  check('生效模型优先级：会话选择 > Agent 绑定 > 全局默认，死 id 一律回落', () => {
    const profiles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    assert.equal(resolveModelId(profiles, 'c', 'b', 'a'), 'b')
    assert.equal(resolveModelId(profiles, 'c', null, 'a'), 'a')
    assert.equal(resolveModelId(profiles, 'c', null, null), 'c')
    assert.equal(resolveModelId(profiles, 'c', 'deleted', 'also-deleted'), 'c')
    assert.equal(resolveModelId(profiles, 'deleted', null, null), 'a')
    assert.equal(resolveModelId([], '', 'x', null), '')
  })

  console.log(`多模型配置契约通过：${checks} 项`)
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
