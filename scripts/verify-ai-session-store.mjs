/**
 * P4-S 历史会话存储门禁。
 *
 * 直接驱动主进程 ai-session-store.js（不启动 Electron），覆盖用户需求的
 * 三条硬链路：新建 / 删除会话、正文持久化、**重新打开软件后仍能读回**。
 * 同时守住归一化白名单、容量上限与损坏自愈，避免 sessions.json 变成
 * 下一个「localStorage 被撑爆」的故事。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAiSessionStore, normalizeAiSession } from '../electron/services/ai-session-store.js'

let checks = 0
function check(name, fn) {
  fn()
  checks += 1
  console.log(`  OK  ${name}`)
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-sessions-'))
const sessionFile = path.join(workDir, '.topomind', 'ai', 'sessions.json')
const reopen = () => createAiSessionStore({ getWorkDir: () => workDir })
const store = reopen()

function record(id, overrides = {}) {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    messages: [
      { id: 'u1', role: 'user', content: '第一条问题', streaming: true },
      { id: 'a1', role: 'assistant', content: '历史回答内容' },
    ],
    ...overrides,
  }
}

try {
  check('空工作目录：列表为空且尚不创建文件', () => {
    assert.deepEqual(store.list().sessions, [])
    assert.equal(fs.existsSync(sessionFile), false)
  })

  check('新建会话：原子写 sessions.json，带 schema / version', () => {
    const summary = store.upsert(record('sess-a'))
    assert.equal(summary.id, 'sess-a')
    assert.equal(summary.messageCount, 2)
    assert.equal(fs.existsSync(sessionFile), true)
    const file = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
    assert.equal(file.schema, 'topomind.ai-session-file')
    assert.equal(file.version, 1)
    assert.equal(file.sessions.length, 1)
    assert.equal(fs.existsSync(`${sessionFile}.${process.pid}.tmp`), false)
  })

  check('重新打开软件：新实例仍读回完整历史正文', () => {
    const reopened = reopen()
    const list = reopened.list()
    assert.equal(list.sessions.length, 1)
    assert.equal(list.sessions[0].title, '会话 sess-a')
    const got = reopened.get('sess-a')
    assert.equal(got.messages.length, 2)
    assert.equal(got.messages[0].content, '第一条问题')
    assert.equal(got.messages[1].content, '历史回答内容')
    // streaming 是运行时标记，不能落盘。
    assert.equal('streaming' in got.messages[0], false)
  })

  check('归一化白名单：未知字段 / 明文密钥 / 磁盘路径一律丢弃', () => {
    const dirty = record('sess-a', {
      apiKey: 'sk-should-not-be-persisted',
      absolutePath: 'C:\\secret\\notes.md',
      toolRounds: [{ round: 1, calls: [{ summary: '内存明细' }] }],
      messages: [{ ...record('x').messages[0], injectedField: 'drop-me' }],
    })
    const clean = normalizeAiSession(dirty)
    assert.equal('apiKey' in clean, false)
    assert.equal('absolutePath' in clean, false)
    assert.equal('toolRounds' in clean, false)
    assert.equal('injectedField' in clean.messages[0], false)
    assert.ok(!JSON.stringify(clean).includes('sk-should-not-be-persisted'))
  })

  check('更新已有会话：覆盖正文但保留 createdAt，列表标题随写入更新', () => {
    store.upsert(record('sess-a', {
      createdAt: 1,
      updatedAt: 1700000009000,
      title: '改过的标题',
      messages: [{ id: 'u2', role: 'user', content: '新问题' }],
    }))
    const got = reopen().get('sess-a')
    assert.equal(got.createdAt, 1700000000000)
    assert.equal(got.title, '改过的标题')
    assert.equal(got.messages.length, 1)
    assert.equal(got.messages[0].content, '新问题')
  })

  check('容量上限：消息条数与单条正文长度都被钳制', () => {
    const many = Array.from({ length: 140 }, (_, i) => ({
      id: `m${i}`, role: 'user', content: `正文 ${i}`.repeat(3000),
    }))
    store.upsert(record('sess-big', { messages: many }))
    const got = reopen().get('sess-big')
    assert.equal(got.messages.length, 100)
    assert.equal(got.messages[0].id, 'm40')
    assert.ok(got.messages.every((item) => item.content.length <= 12000))
    // 非法 role 的消息整条丢弃。
    const mixed = normalizeAiSession(record('sess-mixed', {
      messages: [
        { id: 'ok', role: 'user', content: '保留' },
        { id: 'bad', role: 'system', content: '丢弃' },
      ],
    }))
    assert.equal(mixed.messages.length, 1)
  })

  check('列表按最近更新排序，会话总数上限 60', () => {
    for (let i = 0; i < 70; i += 1) {
      store.upsert(record(`sess-n${i}`, { updatedAt: 1700000100000 + i }))
    }
    const list = reopen().list()
    assert.ok(list.sessions.length <= 60)
    assert.equal(list.sessions[0].id, 'sess-n69')
    assert.ok(list.sessions.every((item) => !('messages' in item)))
  })

  check('删除会话：重开后列表不含该条，正文也读不到', () => {
    // 上一环把文件裁到 60 条，先重新写回确保该会话在窗口内。
    store.upsert(record('sess-a', { updatedAt: Date.now() }))
    assert.deepEqual(store.remove('sess-a'), { ok: true, removed: true })
    const reopened = reopen()
    assert.equal(reopened.get('sess-a'), null)
    assert.equal(reopened.list().sessions.some((item) => item.id === 'sess-a'), false)
    assert.deepEqual(store.remove('sess-a'), { ok: true, removed: false })
  })

  check('非法会话 id 不落盘、不读、不删', () => {
    assert.equal(normalizeAiSession(record('../escape')), null)
    assert.equal(store.get('../escape'), null)
    assert.deepEqual(store.remove('../escape'), { ok: true, removed: false })
    assert.throws(() => store.upsert(record('../escape')), /会话标识不合法/)
  })

  check('文件损坏 / 版本不符：读盘自愈为空，下一次写入可重建', () => {
    fs.writeFileSync(sessionFile, '{ this is not json', 'utf8')
    assert.deepEqual(reopen().list().sessions, [])
    fs.writeFileSync(sessionFile, JSON.stringify({ version: 999, sessions: [{}] }), 'utf8')
    assert.deepEqual(reopen().list().sessions, [])
    store.upsert(record('sess-after-repair'))
    assert.equal(reopen().get('sess-after-repair').messages.length, 2)
  })

  check('按工作目录隔离：另一个工作目录看不到前一个的会话', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-sessions-other-'))
    try {
      const other = createAiSessionStore({ getWorkDir: () => otherDir })
      assert.deepEqual(other.list().sessions, [])
      assert.equal(other.get('sess-after-repair'), null)
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true })
    }
  })

  console.log(`\nAI_SESSION_STORE_VERIFIED (${checks} checks)`)
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
